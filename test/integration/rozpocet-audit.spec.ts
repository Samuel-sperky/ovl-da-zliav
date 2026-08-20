/**
 * Aura Zľavy — denný rozpočet nad SKUTOČNOU DB (V5, KONTRAKT V3 K2).
 *
 * Unit testy rozpočtu (`test/unit/budget.spec.ts`) bežia nad injektovaným
 * počítadlom. To ale nedokazuje, že produkčná cesta vôbec funguje — presne na
 * tomto mieste už raz agentov report zamaskoval, že produkčný wiring nebeží
 * (pasca z CLAUDE.md). Tento súbor preto púšťa PRODUKČNÝ adaptér
 * `auditWriteAttemptCounter` proti skutočnej MariaDB s migráciami 0010–0012.
 *
 * Čo sa dokazuje:
 *  - spotreba je počet `write_attempt` v `audit_log` za daný **UTC** deň,
 *  - iné eventy (`write_ok`, `write_uncertain`, `write_skipped`) rozpočet
 *    nemíňajú — tie patria runaway stropu, nie rozpočtu,
 *  - včerajší deň sa do dneška nezapočíta a naopak,
 *  - `remainingToday()` nad reálnym `settings.daily_write_budget` (default 200)
 *    dá zvyšok, ktorý sedí s počtom riadkov v audite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closePool } from '@/db/pool';
import { appendAudit } from '@/lib/audit/write';
import { addDays } from '@/lib/domain/dates';
import { auditWriteAttemptCounter, budgetDay, createBudget } from '@/lib/engine/budget';
import { settingsRepo } from '@/lib/repo/settings.repo';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';

const available = await dbAvailable();

/**
 * Riadok auditu s VLASTNÝM `ts` — `appendAudit()` zámerne používa
 * `UTC_TIMESTAMP(3)` (I4, §2), takže „včerajšok" sa musí vložiť migračným
 * spojením. Je to jediné miesto, kde test obchádza `appendAudit()`, a robí to
 * len preto, aby vedel vyrobiť iný deň než dnešok.
 */
async function seedAttemptOnDay(day: string, count: number): Promise<void> {
  await withMigrationConn(async (conn) => {
    for (let i = 0; i < count; i += 1) {
      await conn.query(
        'INSERT INTO audit_log (ts, actor, event_type, product_id) VALUES (?, ?, ?, ?)',
        [`${day} 12:00:00.000`, 'system', 'write_attempt', 900 + i],
      );
    }
  });
}

describe.skipIf(!available)('K2 — spotreba rozpočtu zo skutočného audit_log', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closePool();
  });

  it('počíta `write_attempt` za aktuálny UTC deň a nič iné', async () => {
    const today = budgetDay();

    // Jediná povolená cesta zápisu do auditu (I4).
    await appendAudit({ actor: 'user', eventType: 'write_attempt', productId: 201 });
    await appendAudit({ actor: 'user', eventType: 'write_attempt', productId: 202 });
    // Tieto rozpočet NEMÍŇAJÚ — patria runaway stropu (D79), nie K2.
    await appendAudit({ actor: 'user', eventType: 'write_ok', ok: true, productId: 201 });
    await appendAudit({ actor: 'user', eventType: 'write_uncertain', ok: null, productId: 202 });
    await appendAudit({ actor: 'user', eventType: 'write_skipped', ok: true, productId: 203 });

    expect(await auditWriteAttemptCounter.countWriteAttemptsOn(today)).toBe(2);
  });

  it('včerajšie pokusy sa do dnešného rozpočtu nerátajú (a naopak)', async () => {
    const today = budgetDay();
    const yesterday = addDays(today, -1);

    await seedAttemptOnDay(yesterday, 5);
    await appendAudit({ actor: 'scheduler', eventType: 'write_attempt', productId: 301 });

    expect(await auditWriteAttemptCounter.countWriteAttemptsOn(yesterday)).toBe(5);
    expect(await auditWriteAttemptCounter.countWriteAttemptsOn(today)).toBe(1);
  });

  it('remainingToday() nad reálnym settings.daily_write_budget (200) sedí s auditom', async () => {
    await appendAudit({ actor: 'scheduler', eventType: 'write_attempt', productId: 401 });
    await appendAudit({ actor: 'scheduler', eventType: 'write_attempt', productId: 402 });
    await appendAudit({ actor: 'scheduler', eventType: 'write_attempt', productId: 403 });

    const budget = createBudget({ settingsRepo });
    const status = await budget.remainingToday();

    expect(status).toMatchObject({
      day: budgetDay(),
      budget: 200, // default z migrácie 0010 (`daily_write_budget`)
      spent: 3,
      remaining: 197,
      exhausted: false,
    });
  });

  it('rozpočet znížený v nastaveniach sa prejaví hneď (K2 — konfigurovateľný nadol)', async () => {
    await settingsRepo.setDailyWriteBudget(3);
    for (const productId of [501, 502, 503]) {
      await appendAudit({ actor: 'scheduler', eventType: 'write_attempt', productId });
    }

    const status = await createBudget({ settingsRepo }).remainingToday();
    expect(status).toMatchObject({ budget: 3, spent: 3, remaining: 0, exhausted: true });
  });
});
