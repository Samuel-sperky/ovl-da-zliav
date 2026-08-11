/**
 * Aura Zľavy — `GET /api/diagnostics` (návrh V3, `nastavenia.html` #diagnostika,
 * odpoveď 83).
 *
 * Vráti JEDEN súbor na stiahnutie so stavom appky. Obsah a poistky proti úniku
 * tajomstiev žijú v `@/lib/diagnostics/collect` — táto route je len zapojenie
 * skutočných zdrojov a `Content-Disposition`.
 *
 * `auth: 'session'` — nie `sudo`. Súbor neobsahuje tajomstvá (I1, viď whitelist
 * v collectore) a je to nástroj na riešenie poruchy; vyžadovať heslo navyše by
 * ho robilo nedostupným práve vtedy, keď je appka rozbitá. Zvonku sa naň aj tak
 * nedá dostať — appka beží len na `127.0.0.1` (I5) za basic auth.
 *
 * Zdroje sa čítajú NAPRIAMO z produkčných repozitárov. V tomto repe už raz
 * integračné testy s fake závislosťou zamaskovali, že produkčné zapojenie vôbec
 * nefunguje (scheduler nikdy nezapisoval), takže `deps` sú tu len pre testy a
 * predvolené hodnoty ukazujú na to, čo naozaj beží.
 *
 * Vlastník: V3 (dobeh návrhu podľa `docs/53-AUDIT-1-1-V3.md` §C bod 2).
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AuditRepo, SchedulerStateRepo } from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import {
  collectDiagnostics,
  diagnosticsFileName,
  type DiagnosticsMigrations,
  type DiagnosticsQueue,
} from '@/lib/diagnostics/collect';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { auditRepo as defaultAuditRepo } from '@/lib/repo/audit.repo';
import { campaignsRepoV3 as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { schedulerStateRepo as defaultSchedulerState } from '@/lib/repo/scheduler-state.repo';

import type { CampaignsRepoExt } from '@/lib/repo/campaigns.repo';

/* ═════════════════════════ 1. Skutočné zdroje ═════════════════════════════ */

/** `SELECT VERSION()` — pri chybe `null`, nikdy domnelá verzia. */
async function readDbVersion(): Promise<string | null> {
  const rows = await poolQuery<Array<{ v: unknown }>>('SELECT VERSION() AS v', []);
  const value = rows[0]?.v;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Stav migrácií = `_migrations` v DB porovnané so súbormi v repe.
 *
 * Checksum sa počíta rovnako ako v `scripts/migrate.ts` (SHA-256 nad obsahom
 * súboru), inak by sa „checksumy OK" tvrdilo podľa iného výpočtu, než akým sa
 * migrácie aplikujú. Keď sa adresár nedá prečítať, výsledok je fail-closed
 * `checksumyOk: false` s dôvodom — nie tichá pravda.
 */
async function readMigrations(): Promise<DiagnosticsMigrations> {
  const rows = await poolQuery<Array<{ id: unknown; name: unknown; checksum: unknown }>>(
    'SELECT id, name, checksum FROM _migrations ORDER BY id',
    [],
  );
  const applied = rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    checksum: String(row.checksum),
  }));
  const pocet = applied.length;
  const rozsah =
    pocet === 0
      ? null
      : `${String(applied[0]!.id).padStart(4, '0')}–${String(applied[pocet - 1]!.id).padStart(4, '0')}`;

  let files: Map<string, string>;
  try {
    const dir = path.join(process.cwd(), 'db', 'migrations');
    const names = (await readdir(dir)).filter((n) => n.endsWith('.sql'));
    files = new Map(
      await Promise.all(
        names.map(async (name): Promise<[string, string]> => {
          const raw = await readFile(path.join(dir, name), 'utf8');
          return [name, createHash('sha256').update(raw, 'utf8').digest('hex')];
        }),
      ),
    );
  } catch {
    return {
      pocet,
      rozsah,
      checksumyOk: false,
      nesuhlasia: ['súbory migrácií nie sú čitateľné — checksumy sa nedali overiť'],
    };
  }

  const nesuhlasia = applied
    .filter((row) => {
      const fileChecksum = files.get(row.name);
      // Chýbajúci súbor je tiež rozpor: DB tvrdí migráciu, ktorú repo nepozná.
      return fileChecksum === undefined || fileChecksum !== row.checksum;
    })
    .map((row) => row.name);

  return { pocet, rozsah, checksumyOk: nesuhlasia.length === 0, nesuhlasia };
}

/** Stav fronty z tých istých repozitárov, aké používa `/api/queue`. */
async function readQueue(
  campaigns: CampaignsRepoExt,
  scheduler: SchedulerStateRepo,
): Promise<DiagnosticsQueue> {
  const [running, state] = await Promise.all([campaigns.findRunningUnfinished(), scheduler.get()]);
  const head = running[0] ?? null;
  return {
    bezi: head !== null,
    spracovane: head === null ? null : head.itemsOk + head.itemsFailed + head.itemsUncertain,
    zlyhane: head === null ? null : head.itemsFailed,
    poslednyTick: state.lastTickAt === null ? null : state.lastTickAt.toISOString(),
    pocetTikov: state.tickCount,
    poslednaChyba: state.lastError,
  };
}

/**
 * Počty výsledkov zápisu z auditu. Používa `list({ eventType, perPage: 1 })` a
 * berie `total` — teda existujúce čítacie rozhranie (I4: žiadne nové SQL nad
 * `audit_log` mimo repozitára).
 */
async function readWriteOutcomes(audit: AuditRepo): Promise<{
  write_ok: number;
  write_failed: number;
  write_skipped: number;
  write_uncertain: number;
}> {
  const events = ['write_ok', 'write_failed', 'write_skipped', 'write_uncertain'] as const;
  const totals = await Promise.all(
    events.map(async (eventType) => {
      const page = await audit.list({ eventType, page: 1, perPage: 1 });
      return page.total;
    }),
  );
  return {
    write_ok: totals[0] ?? 0,
    write_failed: totals[1] ?? 0,
    write_skipped: totals[2] ?? 0,
    write_uncertain: totals[3] ?? 0,
  };
}

/* ═══════════════════════════════ 2. Route ═════════════════════════════════ */

export interface DiagnosticsRouteDeps {
  audit?: AuditRepo;
  campaigns?: CampaignsRepoExt;
  scheduler?: SchedulerStateRepo;
  dbVersion?: () => Promise<string | null>;
  migrations?: () => Promise<DiagnosticsMigrations>;
}

export function createDiagnosticsRoute(
  deps: DiagnosticsRouteDeps & RouteDeps = {},
): NextRouteHandler {
  const audit = deps.audit ?? defaultAuditRepo;
  const campaigns = deps.campaigns ?? defaultCampaignsRepo;
  const scheduler = deps.scheduler ?? defaultSchedulerState;
  const dbVersion = deps.dbVersion ?? readDbVersion;
  const migrations = deps.migrations ?? readMigrations;
  const clock = deps.now ?? ((): Date => new Date());

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: async () => {
        const now = clock();
        const file = await collectDiagnostics({
          now: () => now,
          dbVersion,
          migrations,
          queue: () => readQueue(campaigns, scheduler),
          writeOutcomes: () => readWriteOutcomes(audit),
        });

        // Vlastná Response, nie `{ok:true,data}` — je to súbor na stiahnutie.
        return new Response(`${JSON.stringify(file, null, 2)}\n`, {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="${diagnosticsFileName(now)}"`,
            'cache-control': 'no-store',
          },
        });
      },
    },
    deps,
  );
}

export const GET = createDiagnosticsRoute();
