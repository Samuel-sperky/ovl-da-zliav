/**
 * Aura Zľavy — cesta `pilot → plny` nad SKUTOČNOU DB (K1 bod 4, B1).
 *
 * Unit testy (`test/unit/rozsah-a-zapisy.spec.ts`) bežia nad in-memory
 * repozitármi a fake auditom. To dokazuje správanie route, NEDOKAZUJE ale, že
 * produkčná cesta vôbec dobehne do databázy — presne tam už raz agentov report
 * zamaskoval, že wiring nebeží (pasca z CLAUDE.md). Tento súbor preto púšťa
 * PRODUKČNÝ `settingsRepo` a PRODUKČNÝ `appendAudit()` proti skutočnej MariaDB.
 *
 * Čo sa dokazuje:
 *  1. Prepnutie `pilot → plny` sa naozaj ULOŽÍ do `settings` a `readScope()` ho
 *     odvtedy vracia — nie je to len odpoveď route.
 *  2. Udalosť `scope_mode_changed` sa zapíše do `audit_log` (`event_type` je
 *     `VARCHAR(48)`, takže sa reálne zmestí) a NEZALOGUJE sa ako neznámy typ.
 *  3. V audite je STARÝ aj NOVÝ stav — inak sa o mesiac nedá zistiť, čo sa
 *     zmenilo a či to bolo uvoľnenie.
 *  4. Sprísnenie `plny → pilot` prejde bez hesla a rovnako sa zapíše.
 *  5. Efektívny strop po prepnutí naozaj vzrastie z 10 na uložený strop —
 *     to je celý dôvod, prečo K1 režim rozsahu vôbec zaviedol.
 *
 * Na shop neodíde ani jeden request (I6) — cesta je čisto lokálna.
 *
 * Vlastník: A11 / V5.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuditRecord, SessionClaims } from '@/contracts';

import { closePool } from '@/db/pool';
import { createScopeModeRoute } from '@/app/api/settings/scope-mode/route';
import { createSettingsRoute } from '@/app/api/settings/route';
import { auditEventLabelSk, isAuditEventType } from '@/lib/audit/events';
import { list as listAudit } from '@/lib/repo/audit.repo';
import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import {
  effectiveMaxProducts,
  settingsRepo,
  PILOT_MAX_PRODUCTS,
} from '@/lib/repo/settings.repo';

import { dbAvailable, setupTestDb, truncateAll, withAppConn } from '../helpers/db';

const available = await dbAvailable();

const APP_ORIGIN = 'https://zlavy.local';
const NOW = new Date('2026-08-12T10:00:00.000Z');

const claims: SessionClaims = {
  sub: 1,
  username: 'samuel',
  absoluteExpiresAt: new Date(NOW.getTime() + 8 * 3_600_000),
  idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
  sudoUntil: new Date(NOW.getTime() + 10 * 60_000),
};

function sessionRouteDeps(): RouteDeps {
  return {
    now: () => NOW,
    verifySession: async () => ({
      claims,
      refreshed: {
        token: 'test-token',
        claims,
        cookie: {
          name: 'ovl_zliav_session' as const,
          value: 'test-token',
          options: {
            httpOnly: true as const,
            secure: true as const,
            sameSite: 'strict' as const,
            path: '/',
            maxAge: 1800,
          },
        },
      },
    }),
  };
}

function makeRequest(method: string, path: string, body?: unknown): Request {
  const headers = new Headers({ host: 'zlavy.local', cookie: 'ovl_zliav_session=x' });
  const init: RequestInit = { method, headers };
  if (method !== 'GET') {
    headers.set('origin', APP_ORIGIN);
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(body ?? {});
  }
  return new Request(`${APP_ORIGIN}${path}`, init);
}

interface Parsed {
  status: number;
  body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } };
}

async function parse(response: Response): Promise<Parsed> {
  return { status: response.status, body: (await response.json()) as Parsed['body'] };
}

/** Route so skutočným repozitárom aj skutočným auditom — bez fakes. */
const realScopeRoute = () =>
  createScopeModeRoute({
    // `requireSudo` zostáva produkčný — sudo okno nesú `claims` vyššie. MUSÍ sa
    // však prepísať aj `now`: route si ho drží zvlášť od `routeDeps` a bez
    // prepisu by sa okno porovnávalo s hodinami stroja, takže by test prešiel
    // alebo padol podľa toho, koľko je práve hodín.
    now: () => NOW,
    routeDeps: sessionRouteDeps(),
  });

const realSettingsRoute = () => createSettingsRoute({ routeDeps: sessionRouteDeps() });

async function scopeAuditRows(): Promise<AuditRecord[]> {
  const page = await listAudit({ eventType: 'scope_mode_changed', perPage: 50 });
  return page.data;
}

describe.skipIf(!available)('K1 bod 4 — `pilot → plny` končí v DB aj v audite', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
    resetRateLimiter();
    // `audit_log.user_id` má cudzí kľúč na `users` (fk_audit_user) a
    // `truncateAll()` používateľov zmaže. Bez tohto riadku by audit zápis
    // padol na FK — a `appendAudit()` chyby ZÁMERNE prehĺta, aby výpadok
    // auditu nezhodil operáciu, takže by test nevidel chybu, len chýbajúci
    // riadok. Používateľ musí mať `id = 1`, lebo toľko nesú `claims.sub`.
    await withAppConn(async (conn) => {
      await conn.query('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)', [
        claims.sub,
        claims.username,
        'argon2id$fake-hash-pre-test',
      ]);
    });
  });

  afterAll(async () => {
    await closePool();
  });

  it('uvoľnenie sa uloží, zapíše sa audit a strop naozaj vzrastie', async () => {
    // Východiskový stav z migrácie: pilotný režim so stropom desať.
    const before = await settingsRepo.readScope();
    expect(before.mode).toBe('pilot');
    expect(effectiveMaxProducts(before)).toBe(PILOT_MAX_PRODUCTS);

    const res = await parse(
      await realScopeRoute()(
        makeRequest('POST', '/api/settings/scope-mode', {
          mode: 'plny',
          maxProductsPerCampaign: 150,
        }),
      ),
    );
    expect(res.status).toBe(200);

    // 1. Stav je v DB, nielen v odpovedi.
    const after = await settingsRepo.readScope();
    expect(after.mode).toBe('plny');
    expect(after.failClosed).toBe(false);
    expect(effectiveMaxProducts(after)).toBe(150);

    // 2. + 3. Audit má riadok so starým aj novým stavom.
    const rows = await scopeAuditRows();
    expect(rows).toHaveLength(1);
    const row = rows[0] as AuditRecord;
    expect(isAuditEventType(row.eventType)).toBe(true);
    expect(row.beforeSnapshot).toMatchObject({ scopeMode: 'pilot' });
    expect(row.afterSnapshot).toMatchObject({ scopeMode: 'plny', requiredSudo: true });

    // Popis v histórii je slovenský, nie surový kód (K10).
    const label = auditEventLabelSk(row.eventType);
    expect(label).not.toBe('scope_mode_changed');
    expect(label.length).toBeGreaterThan(0);
  });

  it('sprísnenie `plny → pilot` prejde bez hesla a tiež sa zapíše', async () => {
    await settingsRepo.setScopeMode('plny');
    await settingsRepo.setMaxProductsPerCampaign(150);

    const res = await parse(
      await realScopeRoute()(makeRequest('POST', '/api/settings/scope-mode', { mode: 'pilot' })),
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.requiredSudo).toBe(false);

    const after = await settingsRepo.readScope();
    expect(after.mode).toBe('pilot');
    expect(effectiveMaxProducts(after)).toBe(PILOT_MAX_PRODUCTS);
    expect(await scopeAuditRows()).toHaveLength(1);
  });

  it('`GET /api/settings` hovorí o rozsahu to isté, čo je v DB', async () => {
    await settingsRepo.setScopeMode('plny');
    await settingsRepo.setMaxProductsPerCampaign(150);

    const res = await parse(await realSettingsRoute()(makeRequest('GET', '/api/settings')));
    expect(res.status).toBe(200);

    expect(res.body.data).toMatchObject({
      scopeMode: 'plny',
      maxProducts: 150,
      pilotMaxProducts: PILOT_MAX_PRODUCTS,
      hardMaxProducts: 10_000,
      scopeFailClosed: false,
      scopeSwitchToFullRequiresSudo: false,
      scopeSwitchToPilotRequiresSudo: false,
    });
  });
});
