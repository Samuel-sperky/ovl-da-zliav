/**
 * Aura Zľavy — INVARIANT I2: max 10 aktívnych produktov, fail-closed
 * (A17, BUILD-SPEC §3, R1).
 *
 * Podstata testu: strop 10 NESMIE držať len aplikačná validácia. Preto sa tu
 * aplikačná vrstva ZÁMERNE obchádza a jedenásty aktívny záznam sa vkladá
 * priamym `INSERT`-om do reálnej DB migračným userom (teda s maximálnymi
 * právami) — a aj tak musí zlyhať na constrainte.
 *
 * Druhá časť overuje aplikačnú vrstvu (`allowlistRepo`, `areAllActive`), aby
 * bolo isté, že fail-closed kontrola beží PRED volaním shop API.
 *
 * Vlastník: A17.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closePool } from '@/db/pool';
import { env } from '@/env';
import { allowlistRepo, AllowlistError } from '@/lib/repo/allowlist.repo';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';

const available = await dbAvailable();

interface DbError {
  errno?: number;
  code?: string;
  message?: string;
}

/** Priamy INSERT do DB — obchádza celú aplikačnú validáciu (to je zámer). */
async function rawInsert(productId: number, slot: number | null, removedAt: string | null): Promise<DbError | null> {
  return withMigrationConn(async (conn) => {
    try {
      await conn.query(
        'INSERT INTO products_allowlist (product_id, slot, label, removed_at) VALUES (?, ?, ?, ?)',
        [productId, slot, `raw-${productId}`, removedAt],
      );
      return null;
    } catch (caught) {
      return caught as DbError;
    }
  });
}

async function activeCount(): Promise<number> {
  return withMigrationConn(async (conn) => {
    const rows = (await conn.query(
      'SELECT COUNT(*) AS total FROM products_allowlist WHERE removed_at IS NULL',
    )) as Array<{ total: number | bigint }>;
    return Number(rows[0]?.total ?? 0);
  });
}

describe('I2 — strop allowlistu je vynútený ENV schémou', () => {
  it('ALLOWLIST_MAX aj MAX_PRODUCTS_PER_OPERATION sú ≤ 10 aj v testovom ENV', () => {
    expect(env.ALLOWLIST_MAX).toBeLessThanOrEqual(10);
    expect(env.MAX_PRODUCTS_PER_OPERATION).toBeLessThanOrEqual(10);
  });
});

describe.skipIf(!available)('I2 — 11. aktívny záznam zlyhá na DB constrainte', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await truncateAll();
    await closePool();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('10 aktívnych záznamov v slotoch 1–10 prejde', async () => {
    for (let slot = 1; slot <= 10; slot += 1) {
      expect(await rawInsert(1000 + slot, slot, null), `slot ${slot}`).toBeNull();
    }
    expect(await activeCount()).toBe(10);
  });

  it('11. aktívny záznam so slotom 11 zlyhá na CHECK constrainte (ck_allowlist_slot)', async () => {
    for (let slot = 1; slot <= 10; slot += 1) await rawInsert(1000 + slot, slot, null);
    const error = await rawInsert(1011, 11, null);
    expect(error, 'I2: 11. aktívny záznam sa NESMIE vložiť').not.toBeNull();
    expect(await activeCount()).toBe(10);
  });

  it('11. aktívny záznam s opakovaným slotom zlyhá na UNIQUE (uq_allowlist_slot)', async () => {
    for (let slot = 1; slot <= 10; slot += 1) await rawInsert(1000 + slot, slot, null);
    const error = await rawInsert(1011, 5, null);
    expect(error).not.toBeNull();
    expect(error?.errno).toBe(1062); // ER_DUP_ENTRY
    expect(await activeCount()).toBe(10);
  });

  it('aktívny záznam bez slotu (obídenie číslovania) zlyhá na ck_allowlist_slot_active', async () => {
    const error = await rawInsert(2001, null, null);
    expect(error, 'aktívny záznam MUSÍ mať slot 1–10').not.toBeNull();
    expect(await activeCount()).toBe(0);
  });

  it('odobraný záznam so slotom je tiež neplatný (slot sa musí uvoľniť)', async () => {
    const error = await rawInsert(2002, 3, '2026-08-05 10:00:00.000');
    expect(error).not.toBeNull();
  });

  it('odobrané záznamy strop nezaberajú — po uvoľnení slotu prejde nový produkt', async () => {
    for (let slot = 1; slot <= 10; slot += 1) await rawInsert(1000 + slot, slot, null);
    await withMigrationConn(async (conn) => {
      await conn.query(
        "UPDATE products_allowlist SET slot = NULL, removed_at = '2026-08-05 10:00:00.000' WHERE slot = 4",
      );
    });
    expect(await activeCount()).toBe(9);
    expect(await rawInsert(1011, 4, null)).toBeNull();
    expect(await activeCount()).toBe(10);
  });

  it('slot 0 ani negatívny slot neexistuje', async () => {
    expect(await rawInsert(3001, 0, null)).not.toBeNull();
  });
});

describe.skipIf(!available)('I2 — aplikačná vrstva je fail-closed pred shopom', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await truncateAll();
    await closePool();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('11. `addProduct()` skončí doménovou chybou allowlist_full', async () => {
    for (let i = 1; i <= 10; i += 1) {
      const record = await allowlistRepo.addProduct(5000 + i, `produkt ${i}`);
      expect(record.slot).toBeGreaterThanOrEqual(1);
      expect(record.slot).toBeLessThanOrEqual(10);
    }
    await expect(allowlistRepo.addProduct(5011, 'jedenásty')).rejects.toBeInstanceOf(AllowlistError);
    await expect(allowlistRepo.addProduct(5011, 'jedenásty')).rejects.toMatchObject({
      code: 'allowlist_full',
    });
    expect(await activeCount()).toBe(10);
  });

  it('`areAllActive()` je fail-closed: prázdny vstup aj neznáme ID => false (R1)', async () => {
    await allowlistRepo.addProduct(6001, 'jeden');
    expect(await allowlistRepo.areAllActive([])).toBe(false);
    expect(await allowlistRepo.areAllActive([6001])).toBe(true);
    expect(await allowlistRepo.areAllActive([6001, 9999])).toBe(false);
    expect(await allowlistRepo.areAllActive([9999])).toBe(false);
  });

  it('viac než 10 ID v jednej operácii nie je nikdy „všetko aktívne"', async () => {
    for (let i = 1; i <= 10; i += 1) await allowlistRepo.addProduct(7000 + i, `p${i}`);
    const eleven = Array.from({ length: 11 }, (_, i) => 7001 + i);
    expect(eleven.length).toBeGreaterThan(env.MAX_PRODUCTS_PER_OPERATION);
    expect(await allowlistRepo.areAllActive(eleven)).toBe(false);
  });

  it('odobraný produkt prestane byť aktívny okamžite', async () => {
    await allowlistRepo.addProduct(8001, 'na odobranie');
    expect(await allowlistRepo.areAllActive([8001])).toBe(true);
    expect(await allowlistRepo.removeProduct(8001)).toBe(true);
    expect(await allowlistRepo.areAllActive([8001])).toBe(false);
  });
});
