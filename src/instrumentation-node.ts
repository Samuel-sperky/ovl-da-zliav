/**
 * Aura Zľavy — boot assertions, Node-only časť (BUILD-SPEC §11, D78, D88, D93, I5, I14).
 *
 * Načítava ho VÝHRADNE `src/instrumentation.ts` a len v Node runtime (edge
 * bundle nesmie obsahovať `node:fs` ani `process.exit`).
 *
 * Poznámka k vlastníctvu: A0 vlastní `src/instrumentation.ts`; tento súbor je
 * jeho nevyhnutná Node-only polovica (Next.js kompiluje instrumentation pre oba
 * runtimy). Testy boot assertions (A17) importujú funkcie odtiaľto.
 *
 * Keď ktorákoľvek assertion zlyhá, proces sa UKONČÍ — appka nesmie bežať
 * v degradovanom režime, v ktorom by mohla zapisovať (I14).
 *
 * Poradie podľa §11:
 *   1. `env.ts` parse            -> fail-fast (D93)
 *   2. `PUBLIC_BIND === 127.0.0.1` (D78, I5)
 *   3. `NODE_ENV=production` + `SHOP_BASE_URL_OVERRIDE` -> exit (I6)
 *   4. stropy `MAX_PRODUCTS_PER_OPERATION` a `ALLOWLIST_MAX` ≤ 10 (I2)
 *   5. master key čitateľný, správna dĺžka a práva (D61)
 *   6. DB dosiahnuteľná a `_migrations` obsahuje všetky súbory z `db/migrations` (D88)
 *   7. audit `boot`, potom start schedulera (D82)
 *
 * Jednotlivé assertions sú exportované ako čisté funkcie, aby ich A17 vedel
 * testovať zvonku bez štartu servera.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { EnvError, loadEnv, type Env } from '@/env';
import { pingDb, query } from '@/db/pool';
import { startScheduler } from '@/lib/scheduler/boot';
import { APP_DISPLAY_NAME, APP_VERSION } from '@/version';

const MASTER_KEY_BYTES = 32;

export interface AssertionProblem {
  /** Číslo kroku podľa BUILD-SPEC §11. */
  step: number;
  message: string;
}

/* ───────────────────── 1.–4. konfigurácia (D93, I2, I5, I6) ───────────────── */

export function assertEnvAndLimits(): { env: Env | null; problems: AssertionProblem[] } {
  const problems: AssertionProblem[] = [];

  let env: Env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      return {
        env: null,
        problems: error.problems.map((message) => ({ step: 1, message })),
      };
    }
    return {
      env: null,
      problems: [{ step: 1, message: error instanceof Error ? error.message : String(error) }],
    };
  }

  // 2. I5/D78 — localhost-only garanciu dáva publikovaný mapping Caddy (O5),
  // deklarovaný `PUBLIC_BIND` je poistka proti omylu v compose.
  if (env.PUBLIC_BIND !== '127.0.0.1') {
    problems.push({
      step: 2,
      message: `PUBLIC_BIND="${env.PUBLIC_BIND}" — musí byť 127.0.0.1 (I5, D78, D96).`,
    });
  }

  // 3. I6 — mock override nesmie existovať v produkcii.
  if (env.NODE_ENV === 'production' && env.SHOP_BASE_URL_OVERRIDE) {
    problems.push({
      step: 3,
      message: 'SHOP_BASE_URL_OVERRIDE je nastavený v produkcii — zakázané (I6).',
    });
  }

  // 4. I2 — tvrdé stropy.
  if (env.MAX_PRODUCTS_PER_OPERATION > 10) {
    problems.push({
      step: 4,
      message: `MAX_PRODUCTS_PER_OPERATION=${env.MAX_PRODUCTS_PER_OPERATION} — strop je 10 (I2, R1).`,
    });
  }
  if (env.ALLOWLIST_MAX > 10) {
    problems.push({
      step: 4,
      message: `ALLOWLIST_MAX=${env.ALLOWLIST_MAX} — strop je 10 (I2, R1).`,
    });
  }
  if (env.API_KEY_TTL_HOURS > 48) {
    problems.push({
      step: 4,
      message: `API_KEY_TTL_HOURS=${env.API_KEY_TTL_HOURS} — strop je 48 (R2).`,
    });
  }

  return { env, problems };
}

/* ───────────────────────── 5. master key (D61, I14) ──────────────────────── */

export interface MasterKeyAssertion {
  ok: boolean;
  problems: string[];
}

/**
 * Overí, že master key je čitateľný, má 32 B a nie je prístupný pre group/other.
 * Obsah súboru sa NIKDY nikam nevypisuje (I1) — kontroluje sa len dĺžka.
 *
 * `strictPermissions` je zapnuté v produkcii; mimo produkcie sa nevhodné práva
 * hlásia ako varovanie, aby vývoj na hostiteľskom FS (bind mount, Windows)
 * nebol nemožný. Rozhodnutie A0 — v produkcii sa NIČ nezľavuje.
 */
export function assertMasterKeyFile(
  path: string,
  strictPermissions: boolean,
): MasterKeyAssertion {
  const problems: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8').trim();
  } catch {
    return { ok: false, problems: [`Master key sa nedá prečítať: ${path} (D61, I14).`] };
  }

  const bytes = decodeKeyLength(raw);
  if (bytes === null) {
    problems.push(`Master key ${path} nie je 64 hex znakov ani base64 (D61).`);
  } else if (bytes !== MASTER_KEY_BYTES) {
    problems.push(`Master key ${path} má ${bytes} B, očakáva sa ${MASTER_KEY_BYTES} B (D61).`);
  }

  try {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      const message =
        `Master key ${path} má práva ${mode.toString(8)} — group/other nesmie mať prístup ` +
        '(očakáva sa 400, D61).';
      if (strictPermissions) problems.push(message);
      else console.warn(`[boot] VAROVANIE: ${message}`);
    }
  } catch {
    problems.push(`Nedajú sa zistiť práva master key súboru ${path}.`);
  }

  return { ok: problems.length === 0, problems };
}

function decodeKeyLength(raw: string): number | null {
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) return raw.length / 2;
  if (/^[A-Za-z0-9+/=]+$/.test(raw)) {
    const buf = Buffer.from(raw, 'base64');
    return buf.length > 0 ? buf.length : null;
  }
  return null;
}

/* ─────────────────────────── 6. DB a migrácie (D88) ──────────────────────── */

export function listMigrationNames(dir = resolve(process.cwd(), 'db/migrations')): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export async function assertDbAndMigrations(): Promise<string[]> {
  const problems: string[] = [];

  if (!(await pingDb())) {
    problems.push('DB nie je dosiahnuteľná (D91, I14).');
    return problems;
  }

  let expected: string[];
  try {
    expected = listMigrationNames();
  } catch {
    problems.push('Priečinok db/migrations neexistuje — chyba nasadenia (D88).');
    return problems;
  }

  try {
    const rows = await query<Array<{ name: string }>>('SELECT name FROM _migrations ORDER BY id');
    const applied = new Set(rows.map((row) => row.name));
    const missing = expected.filter((name) => !applied.has(name));
    if (missing.length > 0) {
      problems.push(
        `Neaplikované migrácie: ${missing.join(', ')} — migrácie mal spustiť entrypoint ` +
          '(D88, I14).',
      );
    }
  } catch {
    problems.push(
      'Tabuľka `_migrations` sa nedá prečítať — migrácie nebehali alebo DB user nemá práva (D88).',
    );
  }

  return problems;
}

/* ──────────────────────────── beh všetkých assertions ───────────────────── */

export async function runBootAssertions(): Promise<AssertionProblem[]> {
  const { env, problems } = assertEnvAndLimits();
  if (!env) return problems;

  const masterKey = assertMasterKeyFile(
    env.MASTER_KEY_FILE,
    env.NODE_ENV === 'production',
  );
  for (const message of masterKey.problems) problems.push({ step: 5, message });

  for (const message of await assertDbAndMigrations()) problems.push({ step: 6, message });

  return problems;
}

/* ───────────────────────────── Next.js boot hook ─────────────────────────── */

let registered = false;

export async function register(): Promise<void> {
  if (registered) return;
  registered = true;

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'boot_start',
      app: APP_DISPLAY_NAME,
      version: APP_VERSION,
      ts: new Date().toISOString(),
    }),
  );

  const problems = await runBootAssertions();
  if (problems.length > 0) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'boot_assertions_failed',
        count: problems.length,
        problems: problems.map((p) => `[§11.${p.step}] ${p.message}`),
        ts: new Date().toISOString(),
      }),
    );
    // I14 — žiadny degradovaný režim.
    process.exit(1);
  }

  // TODO(A2/A10): audit event `boot` sa zapíše cez `appendAudit()` z
  // `src/lib/audit/write.ts` — jediná povolená cesta do `audit_log` (I4).
  // A0 ho úmyselne NEZAPISUJE priamym INSERTom, aby nevznikla druhá cesta.

  startScheduler();

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'boot_ok',
      version: APP_VERSION,
      ts: new Date().toISOString(),
    }),
  );
}
