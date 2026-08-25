/**
 * Aura Zľavy — TRETIA VRSTVA REDAKTORA MUSÍ BEŽAŤ V PRODUKČNEJ CESTE
 * (BUILD-SPEC §6, D66, I1; nálezy A1 a A6).
 *
 * ČO SA TU DOKAZUJE A PREČO PRÁVE TAKTO
 * -------------------------------------
 * Redaktor má tri vrstvy. Prvé dve (denylist mien polí, inline `name: value`)
 * bežia vždy. Tretia — substring scan na HODNOTU uloženého kľúča — sa musí
 * zapnúť zvonku a zapnúť ju vie jediné miesto v appke, kde plaintext existuje:
 * `src/lib/repo/api-key.repo.ts`. To volanie tam dlho NEBOLO, takže `redaction_hit`
 * sa nemohol vyvolať ani raz a kľúč v reťazci bez rozpoznateľného tvaru (hláška
 * knižnice, `nonJsonBody`, chyba z `mariadb`) by prešiel.
 *
 * Existujúce testy to nechytili, lebo si scan **zapínali samy**
 * (`setActiveSecretForScan(KEY)` priamo v teste). To je presne vzor „test
 * s fake závislosťou zamaskoval, že produkčný wiring nefunguje".
 *
 * Preto tento súbor **zámerne NEIMPORTUJE** `setActiveSecretForScan()` ani
 * `setScanSecretForOwner()`. Jediné, čo z redaktora vie, je čítanie stavu
 * (`getRedactionState()`) a reset (`resetRedactionState()`, ktorý scan iba
 * ZHASÍNA). Ak je po `loadForUse()` scan zapnutý, zapol ho repozitár — iný
 * kandidát v tomto procese neexistuje.
 *
 * ČO JE NAOZAJ FAKE A ČO NIE
 * --------------------------
 * Nefake je: repozitár (`createApiKeyRepo()` — tá istá funkcia, z ktorej vzniká
 * produkčný singleton `apiKeyRepo`), `withTransaction()` nad reálnym poolom,
 * reálna MariaDB, reálny logger, reálny `AuditWriter` (repo si ho dotiahne samo)
 * a celý redaktor.
 *
 * Injektuje sa VÝHRADNE `masterKey` — `MASTER_KEY_FILE` z `test/setup.ts`
 * (`secrets/test-master.key`) v repe neexistuje a kontrola práv súboru je na
 * Windows práve to, čo zhadzuje `crypto.spec.ts`. `masterKey` nemá na cestu
 * k redaktoru žiadny vplyv: mení sa ním kľúč šifry, nie to, kto a kedy volá
 * `setScanSecretForOwner()`.
 *
 * Vlastník: S1.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closePool } from '@/db/pool';
import { logger, setLogLevel, setLogSink } from '@/lib/log/logger';
import { getRedactionState, redact, resetRedactionState } from '@/lib/log/redact';
import { createApiKeyRepo } from '@/lib/repo/api-key.repo';

import { dbAvailable, setupTestDb, truncateAll } from '../helpers/db';

const available = await dbAvailable();

/**
 * Master key VÝHRADNE pre testy (32 B konštanty) — nie je to tajomstvo, len
 * deterministický materiál pre AES-GCM.
 */
const TEST_MASTER_KEY = Buffer.alloc(32, 0x5a);

/**
 * Zjavne vymyslené kľúče (I1 — nikdy tvar reálneho poskytovateľa). Chvost je
 * schválne výrazný, aby sa dal `tail` scan (posledných 8 znakov, §6) odlíšiť
 * od zhody na celý kľúč.
 */
const SHOP_KEY = 'fake-shop-key-WIRING-Q7R8S9T0';
const ORDERS_KEY = 'fake-orders-key-WIRING-U1V2W3X4';
const SHOP_TAIL = SHOP_KEY.slice(-8);
const ORDERS_TAIL = ORDERS_KEY.slice(-8);

const last4 = (key: string): string => key.slice(-4);

/** Nový buffer pri každom uložení — `store()` ten vstupný vynuluje (D64). */
const keyBuffer = (key: string): Buffer => Buffer.from(key, 'utf8');

const shopRepo = () => createApiKeyRepo({ masterKey: TEST_MASTER_KEY });
const ordersRepo = () => createApiKeyRepo({ kind: 'orders_read', masterKey: TEST_MASTER_KEY });

describe.skipIf(!available)('A1/A6 — 3. vrstva redaktora sa zapína v produkčnej ceste', () => {
  let lines: string[] = [];

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
    lines = [];
    resetRedactionState();
    setLogLevel('debug');
    setLogSink((line) => lines.push(line));
  });

  afterEach(() => {
    setLogSink(null);
    setLogLevel(null);
    resetRedactionState();
  });

  afterAll(async () => {
    await closePool();
  });

  /* ─────────────────────────── 1. samotný wiring ─────────────────────────── */

  it('`store()` zapne scan a `loadForUse()` ho zapne aj po „reštarte procesu"', async () => {
    const repo = shopRepo();

    // Východisko: redaktor o žiadnom kľúči nevie. Bez tohto by test prešiel
    // aj vtedy, keby scan zapol niekto iný skôr.
    expect(getRedactionState().hasActiveSecret).toBe(false);

    await repo.store(keyBuffer(SHOP_KEY), last4(SHOP_KEY), 1);
    expect(
      getRedactionState().hasActiveSecret,
      'store() musí zapnúť substring scan (§6)',
    ).toBe(true);

    // Simulácia reštartu appky: kľúč zostáva v DB, ale redaktor o ňom nevie.
    // Presne v tomto stave beží produkcia po každom `docker restart`.
    resetRedactionState();
    expect(getRedactionState().hasActiveSecret).toBe(false);

    const ref = await repo.loadForUse();
    expect(ref).not.toBeNull();

    // JADRO DÔKAZU: scan zapla bežná cesta `loadForUse()`, nie tento test.
    expect(
      getRedactionState().hasActiveSecret,
      'loadForUse() musí zapnúť substring scan EŠTE PRED použitím kľúča (§6, D66)',
    ).toBe(true);
    expect(getRedactionState().secretLength).toBe(SHOP_KEY.length);
  });

  /* ─────────────── 2. alarm naozaj strieľa, nielen svieti diódou ────────── */

  it('po `loadForUse()` zmizne kľúč aj z hlášky bez rozpoznateľného tvaru a vznikne `redaction_hit`', async () => {
    const repo = shopRepo();
    await repo.store(keyBuffer(SHOP_KEY), last4(SHOP_KEY), 1);
    resetRedactionState();
    await repo.loadForUse();

    lines = [];
    // Text, ktorý NEZACHYTÍ ani denylist mien polí (1. vrstva), ani inline
    // `name: value` (2. vrstva) — takto vyzerá hláška z knižnice alebo
    // `nonJsonBody` zo `shop/client.ts`. Chytiť ho vie jedine 3. vrstva.
    logger.error(`shop odpovedal 500 a do tela zabalil ${SHOP_KEY} bez ladu a skladu`);

    const dump = lines.join('\n');
    expect(dump).not.toContain(SHOP_KEY);
    expect(dump).not.toContain(SHOP_TAIL);
    expect(dump).toContain('***REDACTED***');

    const hit = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === 'redaction_hit');
    expect(hit, '`redaction_hit` sa musí dať vyvolať (§6)').toBeDefined();
    expect(hit?.level).toBe('error');
    expect(JSON.stringify(hit)).not.toContain(SHOP_KEY);
  });

  /* ───────────────────────── 3. wipe alarm zhasína ───────────────────────── */

  it('`wipe()` scan vypne — po wipe je ten istý text opäť nedotknutý', async () => {
    const repo = shopRepo();
    await repo.store(keyBuffer(SHOP_KEY), last4(SHOP_KEY), 1);
    expect(getRedactionState().hasActiveSecret).toBe(true);

    await repo.wipe('panic_button');

    expect(getRedactionState().hasActiveSecret).toBe(false);
    // Kontrola, že predchádzajúce maskovanie robila naozaj 3. vrstva: rovnaký
    // text bez aktívneho kľúča prejde nedotknutý (1. ani 2. vrstva ho nevidia).
    expect(redact({ note: `zvyšok po ${SHOP_KEY}` }).note).toContain(SHOP_KEY);
  });

  /* ──────────────── 4. dva kľúče naraz (P5) — jeden nezhasne druhý ───────── */

  it('zápisový aj objednávkový kľúč sú pod alarmom SÚČASNE', async () => {
    const shop = shopRepo();
    const orders = ordersRepo();

    await shop.store(keyBuffer(SHOP_KEY), last4(SHOP_KEY), 1);
    await orders.store(keyBuffer(ORDERS_KEY), last4(ORDERS_KEY), 1);

    resetRedactionState();
    await shop.loadForUse();
    await orders.loadForUse();

    expect(
      getRedactionState().activeSecrets,
      'jediný slot v redaktore by znamenal, že druhý kľúč je bez alarmu (P5)',
    ).toBe(2);

    const out = redact({ raw: `${SHOP_KEY} aj ${ORDERS_KEY} v jednej hláške` });
    expect(out.raw).not.toContain(SHOP_KEY);
    expect(out.raw).not.toContain(SHOP_TAIL);
    expect(out.raw).not.toContain(ORDERS_KEY);
    expect(out.raw).not.toContain(ORDERS_TAIL);

    // Panic wipe (D67) zhasína alarm OBOM kľúčom naraz.
    await shop.wipe('panic_button');
    expect(getRedactionState().activeSecrets).toBe(0);
  });

  /* ─────────────── 5. A6 — logger repozitára už nie je mŕtvy ─────────────── */

  it('`api_key_last4_mismatch` sa objaví v logu bez injektovaného loggera', async () => {
    const repo = shopRepo();

    // `last4` z UI úmyselne nesedí s plaintextom — presne stav, o ktorom malo
    // varovanie hovoriť a ktorý doteraz nikde nezaznel.
    await repo.store(keyBuffer(SHOP_KEY), 'zzzz', 1);

    const warning = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === 'api_key_last4_mismatch');

    expect(warning, 'varovanie o nesúlade last4 musí byť niekde vidieť (A6)').toBeDefined();
    expect(warning?.level).toBe('warn');
    expect(warning?.kind).toBe('shop_write');
    // Varovanie o kľúči nesmie kľúč obsahovať (I1).
    const serialized = JSON.stringify(warning);
    expect(serialized).not.toContain(SHOP_KEY);
    expect(serialized).not.toContain(SHOP_TAIL);
    expect(serialized).not.toContain(last4(SHOP_KEY));
  });
});
