/**
 * Aura Zľavy — ČÍTANIE ODPOVEDÍ SERVERA NA KLIENTOVI (24. 8. 2026).
 *
 * Audit šprintu 20 našiel, že validované čítanie má len Prehľad:
 * `dashboard/api.ts` a `dashboard/status-api.ts` majú 58 kontrolovaných čítaní
 * cez `dashboard/json.ts`, kým `campaigns/api.ts` a `audit/api.ts` mali NULA —
 * ich `parse<T>` overil prítomnosť kľúča `ok` a celý zvyšok pretypoval. Tadiaľ
 * vošiel neznámy stav `writing`, ktorý zhodil obrazovku Zliav na bielo.
 *
 * ČO SA TU MERIA
 * --------------
 * Správanie, nie text zdroja. Obálka sa meria cez `getJson()`/`postJson()`
 * s podstrčeným `fetch`, obsah histórie cez `getAudit()`/`getAuditDetail()`.
 * Grep po `as Envelope<T>` by nevidel nič — pretypovanie je práve to, čo
 * v TypeScripte NEVYVOLÁ žiadnu udalosť.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Každá chybová cesta musí niesť VETU.** Volajúci kreslí
 *     `res.error.message`. Keď je `undefined`, obrazovka ukáže prázdny riadok
 *     a používateľ nevie, či appka zlyhala alebo či naozaj niet čo zobraziť.
 *     Sekcia 1 to preto meria PLOŠNE nad všetkými pokazenými telami, nie po
 *     jednom prípade — nová vetva sa tým nedá pridať mlčanlivá.
 *  B. **`data: null` NIE JE chyba.** Úspešná obálka musí niesť KĽÚČ `data`, nie
 *     hodnotu. Keby sa overovala hodnota, legitímna odpoveď „niet čo vrátiť"
 *     by sa zliala s „server to pole vôbec neposlal" — a to sú dve rôzne veci.
 *  C. **Nečitateľný RIADOK sa zahodí, nečitateľná STRÁNKA je chyba.** História
 *     je dôkazný záznam: prázdna tabuľka tvrdí „nič sa nestalo", chybová veta
 *     tvrdí „neprečítal som to". Zliať ich znamená klamať o audite.
 *  D. **`ok` v riadku histórie sú TRI stavy.** `null` = „appka nevie, či to
 *     dopadlo". Keby `readFlag` z „neviem" urobil „neúspech", audit by tvrdil
 *     viac, než prečítal.
 *
 * ČO TENTO SÚBOR ZÁMERNE NEMERIA
 * ------------------------------
 * **Obsah `data` pri `getJson<T>()`.** `T` za behu neexistuje, takže obálka
 * overená neznamená obsah overený. Cesta k overenému obsahu je `getJson<unknown>()`
 * + `parseX()` a stále na ňu čakajú tieto volania (majú vlastníkov, šprint 20
 * ich drží mimo tejto úlohy):
 *
 *  - `campaigns/DiscountDetail.tsx`, `campaigns/NewDiscount.tsx`,
 *    `campaigns/RetryFailed.tsx` — `CampaignDetailResponse`, `PreviewResponse`,
 *  - `campaigns/zlavy-api.ts` — preberá iný agent (obrazovka Zliav),
 *  - `settings/api.ts` — nastavenia.
 *
 * Zapísať to sem je zámer: kým ten zoznam nie je prázdny, „appka číta odpovede
 * validovane" je tvrdenie s hviezdičkou a toto je tá hviezdička.
 *
 * Vlastník: šprint 20 (24. 8. 2026).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_FILTERS,
  auditEventLabel,
  getAudit,
  getAuditDetail,
  parseAuditDetail,
  parseAuditPage,
  parseAuditRow,
  type AuditFilterState,
} from '@/components/audit/api';
import { getJson, parseSession, postJson } from '@/components/campaigns/api';

/* ═══════════════════════ 0. Podstrčený `fetch` ════════════════════════════ */

/**
 * Odpoveď servera bez siete. `raw` obchádza `JSON.stringify`, aby sa dalo
 * poslať aj telo, ktoré JSON vôbec nie je — presne to raz prišlo z reverznej
 * proxy ako HTML chybová stránka so statusom 200.
 */
function odpoved(body: unknown, { status = 200, raw }: { status?: number; raw?: string } = {}) {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (raw !== undefined) return JSON.parse(raw) as unknown;
        return body;
      },
    } as Response),
  );
}

/** Server, ktorý neodpovedá vôbec. */
function siet(chyba: Error) {
  vi.stubGlobal('fetch', () => Promise.reject(chyba));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ═════════════ 1. Obálka je obálka — alebo je to REGULÁRNA chyba ══════════ */

/** Telá, ktoré sa tvária ako obálka a nie sú ňou. */
const POKAZENE: readonly { popis: string; body: unknown }[] = [
  { popis: 'úspech bez `data`', body: { ok: true } },
  { popis: '`ok` je truthy reťazec', body: { ok: 'yes', data: { items: [] } } },
  { popis: '`ok` je 1, nie true', body: { ok: 1, data: { items: [] } } },
  { popis: 'chyba bez `error`', body: { ok: false } },
  { popis: 'chyba s `error` ako reťazcom', body: { ok: false, error: 'zlyhalo' } },
  { popis: 'chyba s prázdnou vetou', body: { ok: false, error: { code: '', message: '' } } },
  { popis: 'telo bez `ok`', body: { data: { items: [] } } },
  { popis: 'telo je pole', body: [1, 2, 3] },
  { popis: 'telo je `null`', body: null },
  { popis: 'telo je reťazec', body: 'OK' },
];

describe('pokazená obálka sa zmení na chybu s vetou, nie na úspech s prázdnom', () => {
  it('ani jedno pokazené telo neprejde ako úspech (bod A)', async () => {
    // Plošne zámerne: nová vetva v `parse()` sa tým nedá pridať priepustná.
    const presli: string[] = [];
    for (const { popis, body } of POKAZENE) {
      odpoved(body);
      const res = await getJson<{ items: unknown }>('/api/campaigns/1');
      if (res.ok) presli.push(popis);
      vi.unstubAllGlobals();
    }
    expect(presli).toEqual([]);
  });

  it('a každé z nich nesie kód aj VETU, ktorú sa dá vykresliť (bod A)', async () => {
    const mlcanlive: string[] = [];
    for (const { popis, body } of POKAZENE) {
      odpoved(body);
      const res = await getJson<unknown>('/api/campaigns/1');
      if (res.ok) {
        mlcanlive.push(`${popis}: prešlo ako úspech`);
      } else if (res.error.code === '' || res.error.message === '') {
        mlcanlive.push(`${popis}: code=${res.error.code} message=${res.error.message}`);
      }
      vi.unstubAllGlobals();
    }
    expect(mlcanlive).toEqual([]);
  });

  it('pokazených tiel je aspoň desať — plošný zákaz má čo merať', () => {
    // Poistka na poistku: keby zoznam vyprázdnil, obe tvrdenia vyššie by
    // svietili zeleno nad ničím.
    expect(POKAZENE.length).toBeGreaterThanOrEqual(10);
  });
});

describe('poriadna obálka prejde nedotknutá', () => {
  it('úspech dá `data` presne tak, ako prišli', async () => {
    odpoved({ ok: true, data: { items: [1, 2], previewToken: 'abc' } });
    const res = await getJson<{ items: number[]; previewToken: string }>('/api/campaigns/preview');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.items).toEqual([1, 2]);
      expect(res.data.previewToken).toBe('abc');
    }
  });

  it('`data: null` je legitímna odpoveď „niet čo vrátiť", nie chyba (bod B)', async () => {
    // Overuje sa KĽÚČ, nie hodnota. Keby sa overovala hodnota, toto by sa
    // zlialo s „server pole `data` vôbec neposlal" — a to je iná vec.
    odpoved({ ok: true, data: null });
    const res = await getJson<null>('/api/campaigns/1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();
  });

  it('chybu servera prenesie s jeho kódom, vetou aj detailom', async () => {
    odpoved(
      { ok: false, error: { code: 'percent_out_of_range', message: 'Percento musí byť 1–30.', detail: { max: 30 } } },
      { status: 422 },
    );
    const res = await postJson<never>('/api/campaigns', { percent: 90 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('percent_out_of_range');
      expect(res.error.message).toBe('Percento musí byť 1–30.');
      expect(res.error.detail).toEqual({ max: 30 });
    }
  });

  it('pri HTTP chybe bez použiteľného tela pomenuje status, nie „bad_envelope"', async () => {
    // Rozdiel je pre človeka: `http_500` hovorí „server zlyhal", `bad_envelope`
    // hovorí „server odpovedal, ale inak, než sme sa dohodli".
    odpoved({ nieco: 'ine' }, { status: 500 });
    const res = await getJson<unknown>('/api/campaigns');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('http_500');
  });

  it('pri statuse 200 a cudzom tele pomenuje obálku, nie status', async () => {
    odpoved({ nieco: 'ine' });
    const res = await getJson<unknown>('/api/campaigns');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('bad_envelope');
  });

  it('telo, ktoré nie je JSON, je chyba a nie výnimka smerom von', async () => {
    odpoved(undefined, { status: 502, raw: '<html>502 Bad Gateway</html>' });
    const res = await getJson<unknown>('/api/campaigns');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).not.toBe('');
  });

  it('mlčiaci server je `network`, nie prázdna obálka', async () => {
    siet(new Error('ECONNREFUSED'));
    const res = await getJson<unknown>('/api/campaigns');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('network');
      expect(res.error.message).not.toBe('');
    }
  });
});

/* ═══════════════════ 2. Session — sudo okno stojí na obsahu ═══════════════ */

describe('session sa čita, nie pretypúva', () => {
  it('platná session prejde so všetkými štyrmi poľami', () => {
    const s = parseSession({
      username: 'admin',
      absoluteExpiresAt: '2026-08-13T10:00:00.000Z',
      idleExpiresAt: '2026-08-12T11:00:00.000Z',
      sudoUntil: '2026-08-12T10:30:00.000Z',
    });
    expect(s?.username).toBe('admin');
    expect(s?.sudoUntil).toBe('2026-08-12T10:30:00.000Z');
  });

  it('chýbajúce `absoluteExpiresAt` je „session sa nedá prečítať", nie NaN v odpočte', () => {
    expect(parseSession({ username: 'admin', idleExpiresAt: '2026-08-12T11:00:00.000Z' })).toBeNull();
  });

  it('`sudoUntil` ako číslo je `null`, nie čas z roku 1970', () => {
    // Toto je ten prípad, ktorý sa NESMIE zliať: `new Date(12345)` je platný
    // dátum, takže `sudoValid()` by povedal `false` a používateľ by dostal
    // heslové okno navyše. `null` znamená to isté, ale úmyselne.
    const s = parseSession({
      username: 'admin',
      absoluteExpiresAt: '2026-08-13T10:00:00.000Z',
      idleExpiresAt: '2026-08-12T11:00:00.000Z',
      sudoUntil: 12_345,
    });
    expect(s?.sudoUntil).toBeNull();
  });

  it('čokoľvek, čo nie je objekt, je `null`', () => {
    for (const zle of [null, undefined, 'admin', 42, [{ username: 'admin' }]]) {
      expect(parseSession(zle)).toBeNull();
    }
  });
});

/* ═══════════════ 3. História: riadok sa zahodí, stránka nie ═══════════════ */

const RIADOK = {
  id: 7,
  ts: '2026-08-12T10:00:00.000Z',
  actor: 'user',
  userId: 1,
  eventType: 'write_ok',
  ok: true,
  campaignId: 3,
  campaignItemId: 9,
  productId: 42,
  operationId: 'op-1',
  requestId: 'req-1',
  httpStatus: 200,
  message: null,
};

const FILTRE: AuditFilterState = { ...EMPTY_FILTERS, perPage: 25 };

describe('stránka histórie sa čita po riadkoch', () => {
  it('platná stránka prejde a tri stavy `ok` zostanú tri (bod D)', () => {
    const page = parseAuditPage(
      {
        data: [
          { ...RIADOK, id: 1, ok: true },
          { ...RIADOK, id: 2, ok: false },
          { ...RIADOK, id: 3, ok: null },
        ],
        page: 2,
        perPage: 10,
        total: 57,
      },
      25,
    );
    expect(page?.data.map((r) => r.ok)).toEqual([true, false, null]);
    expect(page?.page).toBe(2);
    expect(page?.total).toBe(57);
  });

  it('`ok` ako reťazec „true" je „neviem", nie úspech (bod D)', () => {
    // Presne toto by `readFlag` zmenil na `false` a audit by tvrdil neúspech
    // o udalosti, o ktorej appka nevie nič.
    const row = parseAuditRow({ ...RIADOK, ok: 'true' });
    expect(row?.ok).toBeNull();
  });

  it('neznáma rola sa nevypustí na povrch surová (K10)', () => {
    const row = parseAuditRow({ ...RIADOK, actor: 'robot' });
    expect(row?.actor).toBe('system');
  });

  it('neznámy kód udalosti riadok NEZAHODÍ — dostane vetu', () => {
    // Zahodiť riadok preto, že appka nepozná jeho meno, by z auditu urobil
    // neúplný dôkaz. Čas aj výsledok sú čitateľné aj tak.
    const row = parseAuditRow({ ...RIADOK, eventType: 'nieco_nove' });
    expect(row?.eventType).toBe('nieco_nove');
    expect(auditEventLabel(row?.eventType ?? '')).toBe('iná udalosť appky');
  });

  it('riadok bez `id` alebo bez času sa zahodí, ostatné zostanú (bod C)', () => {
    const page = parseAuditPage(
      {
        data: [{ ...RIADOK, id: 1 }, { ...RIADOK, id: undefined }, { ...RIADOK, id: 3, ts: '' }, 'nie objekt'],
        total: 4,
      },
      25,
    );
    expect(page?.data.map((r) => r.id)).toEqual([1]);
  });

  it('chýbajúci `total` padne na počet PREČÍTANÝCH riadkov, nie na nulu', () => {
    // Nula by z tabuľky, ktorá riadky má, urobila vetu „história je prázdna".
    const page = parseAuditPage({ data: [{ ...RIADOK, id: 1 }, { ...RIADOK, id: 2 }] }, 25);
    expect(page?.total).toBe(2);
  });

  it('chýbajúci `perPage` padne na ten, s ktorým sa pýtalo', () => {
    const page = parseAuditPage({ data: [] }, 25);
    expect(page?.perPage).toBe(25);
  });

  it('`data`, ktoré nie je pole, je NEPREČÍTANÁ stránka, nie prázdna (bod C)', () => {
    for (const zle of [{ data: null }, { data: 'nic' }, { data: { 0: RIADOK } }, {}, null, [RIADOK]]) {
      expect(parseAuditPage(zle, 25), JSON.stringify(zle)).toBeNull();
    }
  });
});

describe('`getAudit()` vráti vetu, keď telo nevie prečítať', () => {
  it('platná odpoveď prejde ako stránka', async () => {
    odpoved({ ok: true, data: { data: [RIADOK], page: 1, perPage: 25, total: 1 } });
    const res = await getAudit(FILTRE);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.data[0]?.id).toBe(7);
  });

  it('telo bez pola riadkov je chyba s vetou — NIE prázdna tabuľka (bod C)', async () => {
    // Toto je celý dôvod, prečo úloha existuje: `AuditPanel` robí
    // `setPage(res.data)` a hneď `page.data.map(…)`. Bez tejto vetvy tu
    // spadol render, nie čítanie — biela obrazovka namiesto hlásenia.
    odpoved({ ok: true, data: { page: 1, total: 0 } });
    const res = await getAudit(FILTRE);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('unreadable_body');
      expect(res.error.message).not.toBe('');
    }
  });

  it('chybu z obálky prenesie tak, ako prišla — neprepíše ju vlastnou', async () => {
    odpoved({ ok: false, error: { code: 'forbidden', message: 'Nemáš právo čítať históriu.' } }, { status: 403 });
    const res = await getAudit(FILTRE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('forbidden');
  });
});

describe('detail udalosti', () => {
  it('snapshoty prejdú nedotknuté a `priceMismatch` len pri skutočnom `true`', () => {
    const detail = parseAuditDetail({
      ...RIADOK,
      beforeSnapshot: { price: '10.00' },
      afterSnapshot: { price: '9.00' },
      priceMismatch: 'ano',
      ip: '10.0.0.1',
      userAgent: 'Firefox',
    });
    expect(detail?.beforeSnapshot).toEqual({ price: '10.00' });
    expect(detail?.afterSnapshot).toEqual({ price: '9.00' });
    expect(detail?.priceMismatch).toBe(false);
    expect(detail?.ip).toBe('10.0.0.1');
  });

  it('chýbajúce snapshoty sú `undefined`, nie vymyslený prázdny objekt (P7)', () => {
    const detail = parseAuditDetail(RIADOK);
    expect(detail?.beforeSnapshot).toBeUndefined();
    expect(detail?.afterSnapshot).toBeUndefined();
  });

  it('nepoužiteľný detail je chyba s vetou', async () => {
    odpoved({ ok: true, data: { ts: '2026-08-12T10:00:00.000Z' } });
    const res = await getAuditDetail(7);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('unreadable_body');
  });

  it('platný detail prejde', async () => {
    odpoved({ ok: true, data: { ...RIADOK, priceMismatch: true } });
    const res = await getAuditDetail(7);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.priceMismatch).toBe(true);
  });
});
