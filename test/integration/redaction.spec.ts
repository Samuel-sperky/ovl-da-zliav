/**
 * Aura Zľavy — DÔKAZ REDAKCIE KĽÚČA (A9; INVARIANT I1, D50, D66).
 *
 * Po CELOM write flow (pre-write GET → setReduction → audit → campaign_items)
 * sa API kľúč NESMIE vyskytovať:
 *   - v tabuľke `audit_log` (vrátane before/after snapshotov),
 *   - v tabuľke `campaign_items` (sent_payload, raw_response, error stĺpce),
 *   - v zachytenom stdout logu.
 * Kontroluje sa celý kľúč AJ jeho posledných 8 znakov (substring scan D66).
 *
 * Jediné miesto, kde kľúč smie byť vidno, je mock shop — hlavička `X-Api-Key`
 * (sanity check, že zápis naozaj prebehol s kľúčom).
 *
 * Beží proti reálnej testovacej MariaDB — bez nej sa preskočí.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePool } from '@/db/pool';
import { computePayloadHash } from '@/lib/crypto/preview-token';
import { createExecutor, type ExecutorFlags } from '@/lib/engine/executor';
import { createWriteMutex } from '@/lib/engine/mutex';
import { createMemoryApiKeyRepo } from '@/lib/engine/testing';
import { auditWriter } from '@/lib/audit/write';
import { setLogLevel, setLogSink } from '@/lib/log/logger';
import { resetRedactionState, setActiveSecretForScan } from '@/lib/log/redact';
import { allowlistRepo } from '@/lib/repo/allowlist.repo';
import { auditRepo } from '@/lib/repo/audit.repo';
import { campaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepo } from '@/lib/repo/campaigns.repo';
import { settingsRepo } from '@/lib/repo/settings.repo';
import { createShopClient } from '@/lib/shop/client';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';
import { useMockShop } from '../helpers/mock';
import { testUlid } from '../helpers/factories';

const available = await dbAvailable();

/** Falošný kľúč s výrazným chvostom (I1 — nikdy tvar reálneho poskytovateľa). */
const SECRET_KEY = 'fake-shop-key-redakcia-Z9Y8X7W6';
const SECRET_TAIL = SECRET_KEY.slice(-8);

const mock = useMockShop({ keys: [{ key: SECRET_KEY, scopes: ['product:edit'] }] });

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const FLAGS: ExecutorFlags = {
  nodeEnv: 'production',
  writesEnabled: true,
  maxProductsPerOperation: 10,
  runawayLimitPerHour: 60,
  writePauseMs: 5,
};

async function seedUser(): Promise<number> {
  return withMigrationConn(async (conn) => {
    const result = (await conn.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      ['samuel-redakcia', '$argon2id$fake-hash-for-tests'],
    )) as { insertId?: number | bigint };
    return Number(result.insertId ?? 0);
  });
}

/** Kompletný obsah tabuľky ako jeden JSON string — na substring assert. */
async function dumpTable(table: string): Promise<string> {
  return withMigrationConn(async (conn) => {
    const rows = (await conn.query(`SELECT * FROM \`${table}\``)) as unknown[];
    return JSON.stringify(rows, (_k, v: unknown) => {
      if (typeof v === 'bigint') return v.toString();
      if (Buffer.isBuffer(v)) return v.toString('base64');
      return v;
    });
  });
}

describe.skipIf(!available)('I1 — kľúč nie je v DB ani v logoch (redaction)', () => {
  const logLines: string[] = [];

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    setLogSink(null);
    setLogLevel(null);
    resetRedactionState();
    await closePool();
  });

  it('celý write flow neprepustí kľúč mimo hlavičky na shop', async () => {
    await truncateAll();
    const userId = await seedUser();

    // Kľúč je „uložený" → redaktor ho skenuje presne ako v produkcii (D66).
    setActiveSecretForScan(SECRET_KEY);
    setLogLevel('debug');
    setLogSink((line) => logLines.push(line));

    const productIds = [601, 602];
    mock.state.setProducts(
      productIds.map((id) => ({ id, name: `Šperk ${id}`, price: 15, has_attributes: false })),
    );
    for (const id of productIds) await allowlistRepo.addProduct(id, `Šperk ${id}`);

    const from = day(1);
    const to = day(7);
    const campaign = await campaignsRepo.create({
      operationId: testUlid(),
      name: 'Redakčný test',
      kind: 'new',
      percent: 10,
      dateFrom: from,
      dateTo: to,
      mode: 'eager',
      status: 'scheduled',
      confirmedAt: new Date(),
      confirmPayloadHash: computePayloadHash({ kind: 'new', productIds, percent: 10, from, to }),
      sudoAt: new Date(),
      createdBy: userId,
    });
    await campaignItemsRepo.createMany(
      campaign.id,
      productIds.map((productId, index) => ({
        productId,
        position: index + 1,
        priceAtPreview: '15.00',
        hasAttributes: false,
      })),
    );

    const executor = createExecutor({
      shopClient: createShopClient({
        baseUrl: () => mock.baseUrl,
        version: '0.1.0-test',
        readTimeoutMs: 2000,
        writeTimeoutMs: 2000,
      }),
      campaignsRepo,
      campaignItemsRepo,
      allowlistRepo,
      settingsRepo,
      auditRepo,
      apiKeyRepo: createMemoryApiKeyRepo(SECRET_KEY),
      audit: auditWriter,
      mutex: createWriteMutex(), // reálny GET_LOCK v DB (I12)
      flags: FLAGS,
    });

    const result = await executor.executeCampaign(campaign.id);
    expect(result.status).toBe('done');
    expect(result.itemsOk).toBe(2);

    /* Sanity: kľúč NAOZAJ odišiel na shop (inak by test nič nedokazoval). */
    expect(mock.state.seenApiKeys()).toContain(SECRET_KEY);
    expect(mock.state.keyLeakedToReads()).toBe(false); // D48 — čítania bez kľúča

    /* 1. audit_log — kompletný dump bez kľúča a bez jeho chvosta. */
    const auditDump = await dumpTable('audit_log');
    expect(auditDump.length).toBeGreaterThan(0);
    expect(auditDump).not.toContain(SECRET_KEY);
    expect(auditDump).not.toContain(SECRET_TAIL);
    // Auditná stopa write flow pritom existuje (D50).
    expect(auditDump).toContain('write_ok');
    expect(auditDump).toContain('write_attempt');

    /* 2. campaign_items — sent_payload/raw_response sú redigované (I1). */
    const itemsDump = await dumpTable('campaign_items');
    expect(itemsDump).not.toContain(SECRET_KEY);
    expect(itemsDump).not.toContain(SECRET_TAIL);
    expect(itemsDump).toContain('"reduction":"10"'); // payload je uložený (D50)

    /* 3. campaigns pre istotu tiež. */
    const campaignsDump = await dumpTable('campaigns');
    expect(campaignsDump).not.toContain(SECRET_KEY);
    expect(campaignsDump).not.toContain(SECRET_TAIL);

    /* 4. zachytený stdout log — ani riadok s kľúčom či chvostom. */
    const logDump = logLines.join('\n');
    expect(logDump.length).toBeGreaterThan(0);
    expect(logDump).not.toContain(SECRET_KEY);
    expect(logDump).not.toContain(SECRET_TAIL);
  }, 30_000);
});
