/**
 * Aura Zľavy — chybové kódy z API v5 (bod F kontraktu KONTRAKT-API-V5-2026-08-13).
 *
 * Čo tento súbor stráži:
 *
 *  1. **`blocked_by_flash_sale` je terminálny, nikdy retryable a nikdy neistý.**
 *     Je to dočasná prekážka, čo zvádza označiť ju za opakovateľnú — a to je
 *     presne tá chyba, ktorá by minula zápisový rozpočet (I10, I13) na pokusy,
 *     ktoré počas bežiacej akcie vyjsť nemôžu.
 *  2. **Nedostal vlastný `kind` a testy to pripomínajú.** Taxonómia je uzavretý
 *     zoznam dôsledkov (D41); rozdiel medzi „zlé údaje" a „dočasná prekážka"
 *     nesie raw kód, slovenská veta a `isFlashSaleBlocked()`.
 *  3. **Vety hovoria ČO sa stalo a ČO S TÝM.** Pri blokovaní akciou nesmie
 *     veta nikoho poslať opravovať hodnoty, ktoré sú v poriadku.
 *  4. **`range_too_long` sa priznáva ako rozchod pravidiel**, nie ako bežná
 *     chyba zadania — appka má rovnaký strop ako shop, takže sa nemá ako stať.
 *  5. **`not found` (404) sa mapuje ďalej rovnako** — v5 na tom nič nezmenil.
 *
 * Beží výhradne s fake fetch — žiadny request neopustí proces (I6).
 *
 * Vlastník: A3.
 */
import { describe, expect, it } from 'vitest';

import type { SecretRef, ShopClient, ShopCtx } from '@/contracts';

import { MAX_WINDOW_MONTHS as DOMAIN_MAX_WINDOW_MONTHS } from '@/lib/domain/dates';
import {
  RETRYABLE_KINDS,
  TERMINAL_KINDS,
  UNCERTAIN_KINDS,
  classifyFailure,
  isFlashSaleBlocked,
  isFlashSaleBlockedCode,
  isRetryableKind,
  makeShopError,
} from '@/lib/shop/errors';
import {
  MAX_WINDOW_MONTHS as CLIENT_MAX_WINDOW_MONTHS,
  addMonthsDateOnly,
  createShopClient,
  todayInTimeZone,
  type FetchLike,
} from '@/lib/shop/client';
import {
  CODE_MESSAGES,
  KIND_MESSAGES,
  hasShopCodeMessage,
  shopMessageText,
  shopMessageTextForCodes,
} from '@/lib/shop/messages.sk';
import { newOperationContext } from '@/lib/shop/correlation';

/* ═════════════════════════ 0. Testovací harness ═══════════════════════════ */

/** Loopback base URL — ani omylom sa nedá trafiť reálna doména (I6). */
const BASE = 'https://127.0.0.1:8443';

const FLASH_SALE = 'blocked_by_flash_sale';

interface Harness {
  fetchImpl: FetchLike;
  calls: number;
}

function harness(respond: () => Response): Harness {
  const state: Harness = {
    calls: 0,
    fetchImpl: async () => {
      state.calls += 1;
      return respond();
    },
  };
  return state;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(fetchImpl: FetchLike): ShopClient {
  return createShopClient({
    baseUrl: BASE,
    fetchImpl,
    version: '0.0.0-test',
    readTimeoutMs: 5000,
    writeTimeoutMs: 5000,
    timeZone: 'Europe/Bratislava',
    sleepFn: async () => {},
    policy: { maxAttempts: 3, retryAfterCapSeconds: 90, backoffMs: [1, 1, 1] },
  });
}

const ctx = (): ShopCtx => newOperationContext();

const fakeKey = (): SecretRef => async () => {
  const value = Buffer.from('TESTKEY-abc123deadbeef99', 'utf8');
  return {
    value,
    release: () => {
      value.fill(0);
    },
  };
};

/** Zľava, ktorá je vždy v budúcnosti a v okne ≤ 3 mesiace. */
function futureWindow(): { from: string; to: string } {
  const today = todayInTimeZone('Europe/Bratislava');
  return { from: today, to: addMonthsDateOnly(today, 1) };
}

/* ═════════════ 1. Zaradenie `blocked_by_flash_sale` (bod F, F1) ═══════════ */

describe('blocked_by_flash_sale — zaradenie', () => {
  it('409 s týmto kódom je terminálna chyba, nie retryable a nie neistá', () => {
    const kind = classifyFailure(409, [FLASH_SALE]);
    expect(TERMINAL_KINDS.has(kind)).toBe(true);
    expect(RETRYABLE_KINDS.has(kind)).toBe(false);
    expect(UNCERTAIN_KINDS.has(kind)).toBe(false);
    expect(isRetryableKind(kind)).toBe(false);
  });

  /**
   * Vedomé rozhodnutie, nie opomenutie: vlastný `kind` by nepridal ani jedno
   * nové rozhodnutie a `ShopErrorKind` je zdieľaný kontrakt. Keby ho niekto
   * pridával, tento test padne a pošle ho do doc-bloku `errors.ts`.
   */
  it('nemá vlastný druh chyby — rozlíšenie nesie kód, nie taxonómia', () => {
    expect(classifyFailure(409, [FLASH_SALE])).toBe('bad_request');
    const error = makeShopError({ kind: classifyFailure(409, [FLASH_SALE]), code: FLASH_SALE, httpStatus: 409 });
    expect(error.code).toBe(FLASH_SALE);
    expect(error.retryable).toBe(false);
  });

  it('platí aj pri HTTP 200 s `ok:false` (tvarová konvencia §6)', () => {
    expect(classifyFailure(200, [FLASH_SALE])).toBe('bad_request');
  });

  it('keď shop pošle aj „not found", vyhrá neexistujúci produkt', () => {
    // Poradie je určené v `classifyFailure`: produkt, ktorý neexistuje, sa
    // nedá zlacniť ani po skončení akcie — to je pre človeka dôležitejšie.
    expect(classifyFailure(409, ['not found', FLASH_SALE])).toBe('not_found');
  });

  it('kód sa dá rozpoznať strojovo aj z auditu a z DB', () => {
    expect(isFlashSaleBlockedCode(FLASH_SALE)).toBe(true);
    expect(isFlashSaleBlockedCode('  BLOCKED_BY_FLASH_SALE  ')).toBe(true);
    expect(isFlashSaleBlockedCode('invalid_dates')).toBe(false);
    expect(isFlashSaleBlockedCode(null)).toBe(false);
    expect(isFlashSaleBlockedCode(undefined)).toBe(false);
    expect(isFlashSaleBlockedCode('')).toBe(false);

    expect(isFlashSaleBlocked(makeShopError({ kind: 'bad_request', code: FLASH_SALE }))).toBe(true);
    expect(isFlashSaleBlocked(makeShopError({ kind: 'not_found', code: 'not found' }))).toBe(false);
    expect(isFlashSaleBlocked(makeShopError({ kind: 'network' }))).toBe(false);
  });
});

/* ═══════════ 2. Slovenská veta pri blokovaní akciou (D47, K10) ════════════ */

describe('blocked_by_flash_sale — veta pre človeka', () => {
  const text = shopMessageText('bad_request', FLASH_SALE);

  it('nepoužije generickú vetu o neplatnej požiadavke', () => {
    expect(text).not.toBe(
      `${KIND_MESSAGES.bad_request.message} ${KIND_MESSAGES.bad_request.recommendation}`,
    );
    expect(text).not.toContain('neplatnú');
    expect(hasShopCodeMessage(FLASH_SALE)).toBe(true);
  });

  it('povie, že sa produkt preskočil a že to nie je chyba používateľa', () => {
    expect(text).toContain('preskočila');
    expect(text).toContain('Nie je to chyba');
    // Nikoho neposiela opravovať hodnoty, ktoré sú v poriadku.
    expect(text).not.toContain('Oprav');
  });

  it('povie, kedy a ako to skúsiť znova', () => {
    expect(text).toContain('akcia');
    expect(text).toContain('Zopakovať');
  });

  it('neukazuje číslo stavu ani surový kód (K10, D47)', () => {
    expect(text).not.toContain('409');
    expect(text).not.toContain(FLASH_SALE);
  });

  it('platí rovnako pre zápis zľavy aj pre jej odstránenie — veta je jedna', () => {
    // Kód je pre obe operácie ten istý, takže rovnaká je aj veta; keby sa raz
    // rozišli, musí to byť vedomé a nie vedľajší účinok inej zmeny.
    expect(shopMessageText('bad_request', FLASH_SALE)).toBe(text);
    expect(shopMessageTextForCodes('bad_request', [FLASH_SALE])).toBe(text);
  });
});

/* ═════════════ 3. `range_too_long` je rozchod pravidiel (F2) ══════════════ */

describe('range_too_long — rozchod nášho stropu so shopom', () => {
  const text = shopMessageText('bad_request', 'range_too_long');

  it('appka má rovnaký strop ako shop, preto by kód nemal nastať', () => {
    expect(DOMAIN_MAX_WINDOW_MONTHS).toBe(3);
    expect(CLIENT_MAX_WINDOW_MONTHS).toBe(DOMAIN_MAX_WINDOW_MONTHS);
  });

  it('veta hovorí nahlas, že sa pravidlá rozišli, nie len „skráť dátum"', () => {
    expect(text).toContain('3 mesiace');
    expect(text).toContain('rozišlo');
    expect(text).toContain('nahlás');
  });

  it('zostáva terminálna — opakovanie rovnakého okna nepomôže', () => {
    expect(isRetryableKind(classifyFailure(400, ['range_too_long']))).toBe(false);
  });
});

/* ══════════════ 4. Validačné kódy zápisu (400) — F2 ═══════════════════════ */

describe('invalid_reduction a invalid_dates (400)', () => {
  it('sú terminálne a majú vlastnú vetu', () => {
    for (const code of ['invalid_reduction', 'invalid_dates']) {
      expect(classifyFailure(400, [code])).toBe('bad_request');
      expect(hasShopCodeMessage(code)).toBe(true);
    }
  });

  it('povedia, že sa nič nezapísalo, a čo opraviť', () => {
    const reduction = shopMessageText('bad_request', 'invalid_reduction');
    expect(reduction).toContain('nič nezapísalo');
    expect(reduction).toContain('1 do 30');

    const dates = shopMessageText('bad_request', 'invalid_dates');
    expect(dates).toContain('nič nezapísalo');
    expect(dates).toContain('kalendárne');
  });

  it('dva kódy v jednej odpovedi dajú obe vety', () => {
    const both = shopMessageTextForCodes('bad_request', ['invalid_dates', 'invalid_reduction']);
    expect(both).toContain(CODE_MESSAGES.invalid_dates.message);
    expect(both).toContain(CODE_MESSAGES.invalid_reduction.message);
  });
});

/* ══════════════════ 5. `not found` (404) sa nezmenil ═════════════════════ */

describe('not found (404) — mapovanie platí ďalej', () => {
  it('so statusom, bez statusu aj s podtržníkom je to vždy not_found', () => {
    expect(classifyFailure(404, ['not found'])).toBe('not_found');
    expect(classifyFailure(404, ['not_found'])).toBe('not_found');
    expect(classifyFailure(404, [])).toBe('not_found');
    expect(classifyFailure(200, ['not found'])).toBe('not_found');
    expect(classifyFailure(409, ['not found'])).toBe('not_found');
  });

  it('veta je pre oba tvary kódu rovnaká a bez žargónu (K10)', () => {
    const text = shopMessageText('not_found', 'not found');
    expect(text).toBe(shopMessageText('not_found', 'not_found'));
    expect(text.toLowerCase()).not.toContain('allowlist');
    expect(text).toContain('povolenými produktmi');
  });
});

/* ═══════ 6. Celá cesta klientom: 409 skončí ako zlyhanie, bez retry ═══════ */

describe('setReduction pri bežiacej akcii (I10, I13, RZ4)', () => {
  it('vráti `failed` s kódom akcie a NEOPAKUJE zápis', async () => {
    const h = harness(() => json({ ok: false, errors: [FLASH_SALE] }, 409));
    const result = await client(h.fetchImpl).setReduction(
      { id: 49, reduction: 15, ...futureWindow() },
      fakeKey(),
      ctx(),
    );

    expect(result.outcome).toBe('failed');
    if (result.outcome === 'failed') {
      expect(result.error.code).toBe(FLASH_SALE);
      expect(result.error.retryable).toBe(false);
      expect(result.error.httpStatus).toBe(409);
      expect(isFlashSaleBlocked(result.error)).toBe(true);
      expect(result.error.message).toBe(shopMessageText('bad_request', FLASH_SALE));
    }
    // Presne jeden pokus — dočasná prekážka sa neopakuje do rozpočtu zápisov.
    expect(h.calls).toBe(1);
  });

  it('rozumie aj obálke `{"result":…}`, ktorou odpovedá produkčný shop', async () => {
    const h = harness(() => json({ result: { ok: false, errors: [FLASH_SALE] } }, 409));
    const result = await client(h.fetchImpl).setReduction(
      { id: 49, reduction: 15, ...futureWindow() },
      fakeKey(),
      ctx(),
    );

    expect(result.outcome).toBe('failed');
    if (result.outcome === 'failed') expect(result.error.code).toBe(FLASH_SALE);
    expect(h.calls).toBe(1);
  });

  it('nie je to „stav neistý" — o zápise vieme, že sa nestal (D45, D54)', async () => {
    const h = harness(() => json({ ok: false, errors: [FLASH_SALE] }, 409));
    const result = await client(h.fetchImpl).setReduction(
      { id: 49, reduction: 15, ...futureWindow() },
      fakeKey(),
      ctx(),
    );
    expect(result.outcome).not.toBe('uncertain');
  });
});
