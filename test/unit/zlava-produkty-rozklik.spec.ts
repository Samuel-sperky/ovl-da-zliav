/**
 * Aura Zľavy — ROZKLIK „KTORÝCH 21" A ZAČATIE ZĽAVY ODTIAĽ (D127 body 1 a 2).
 *
 * @vitest-environment jsdom
 *
 * ČO SA TU DOKAZUJE
 * ─────────────────
 * Stránka Zliav do 1. 9. 2026 povedala „21 produktov" a čo to bolo za produkty,
 * sa z nej nedalo zistiť. `GET /api/insights/campaign/[id]/products` odpoveď má
 * — a presne to je trieda pasce, ktorú CLAUDE.md pomenúva: endpoint s testami
 * a bez konzumenta dokazuje, že odpoveď je pravdivá, nie že sa niekomu dostane
 * pred oči. Preto sa tu obrazovka naozaj vykresľuje.
 *
 * Tvrdenia:
 *
 *  1. rozklik na endpoint SIAHNE — a až po otvorení, nie pri načítaní detailu
 *     (strana má sto riadkov a detail sa otvára pri každom kliku v rebríku),
 *  2. v zozname je REFERENCIA a je to PRVÝ stĺpec (D122), pomenovaný jednotnou
 *     sadou (D124),
 *  3. produkt, ktorý z katalógu ZMIZOL, v zozname JE — s pomlčkou a s dôvodom,
 *     nie vypadnutý (LEFT JOIN na strane routy, I11),
 *  4. neobohatený produkt má tú istú pomlčku, ale INÝ dôvod: dve nevedomosti sa
 *     nezlievajú,
 *  5. „cena po" bez známej „ceny pred" je POMLČKA, nie nula, a všade ju
 *     sprevádza priznanie, že ju appka vypočítala (D4, I11),
 *  6. **z tejto cesty neodíde ANI JEDEN zápisový request** — zaškrtnutie
 *     riadkov vyrobí LEN adresu `/zlavy/nova?produkty=…`, teda hodnoty
 *     formulára; skúška naprázdno a potvrdenie sa odohrajú tam nanovo (I3).
 *     Meria sa to SPRÁVANÍM (čo odišlo do `fetch`), nie grepom nad zdrojom —
 *     grep nad priečinkom A o diere v priečinku B nepovie nič.
 *
 * Vlastník: úloha ZLAVA-PRODUKTY (V5, D127).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DiscountDetail,
  GONE_FROM_CATALOG_SK,
} from '@/components/campaigns/DiscountDetail';
import { newDiscountFromProductsHref } from '@/components/campaigns/DiscountsList';
import { TABLE_UNKNOWN_WORD } from '@/components/ui';
import { DISCOUNTED_PRICE_DISCLAIMER_SK } from '@/lib/domain/pricing';
import { PRODUCT_GAP_REASON } from '@/lib/ui/product-columns';

/* ═══════════════════════════ 1. Vzorka ════════════════════════════════════ */

const ID = 7;
const PRODUCTS_URL = `/api/insights/campaign/${ID}/products`;

const detailPayload = () => ({
  ok: true,
  data: {
    campaign: {
      id: ID,
      name: 'Letné dočistenie skladu',
      status: 'running',
      statusReason: null,
      percent: 20,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      mode: 'eager',
      itemsTotal: 3,
      itemsOk: 1,
      itemsFailed: 1,
      itemsUncertain: 0,
      itemsPending: 1,
      late: false,
      createdAt: '2026-08-01T08:00:00.000Z',
      tiers: [],
      estimate: null,
    },
    tiers: [],
    estimate: null,
    items: [],
    itemsTotal: 3,
    itemsOffset: 0,
    auditTrail: [],
  },
});

/**
 * Tri riadky, tri rôzne nevedomosti:
 *
 *   201 — obohatený, so všetkým,
 *   202 — v zrkadle JE, ale nie je obohatený (D118): referencia je pomlčka,
 *   303 — z katalógu ZMIZOL (`inCatalog: false`): pomlčka z iného dôvodu
 *         a bez známej ceny, takže ani „cena po" sa nevyrába.
 */
const productsPayload = () => ({
  ok: true,
  data: {
    campaignId: ID,
    campaign: {
      name: 'Letné dočistenie skladu',
      status: 'running',
      percent: 20,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    },
    page: 1,
    perPage: 100,
    total: 3,
    items: [
      {
        itemId: 1,
        productId: 201,
        reference: 'NR-0041',
        catalogName: 'Náramok z chirurgickej ocele',
        nameAtWrite: 'Náramok z chirurgickej ocele',
        inCatalog: true,
        enriched: true,
        percent: 20,
        status: 'ok',
        priceBefore: '19.99',
        priceBeforeSource: 'write',
        priceAfter: '15.99',
        priceAfterEstimated: true,
        catalogPrice: '19.99',
        priceMismatch: false,
        reductionUnverifiable: false,
        attemptCount: 1,
        errorCode: null,
        finishedAt: '2026-08-01T09:00:00.000Z',
      },
      {
        itemId: 2,
        productId: 202,
        reference: null,
        catalogName: 'Retiazka strieborná',
        nameAtWrite: 'Retiazka strieborná',
        inCatalog: true,
        enriched: false,
        percent: 20,
        status: 'pending',
        priceBefore: '9.00',
        priceBeforeSource: 'preview',
        priceAfter: '7.20',
        priceAfterEstimated: true,
        catalogPrice: '9.00',
        priceMismatch: true,
        reductionUnverifiable: false,
        attemptCount: 0,
        errorCode: null,
        finishedAt: null,
      },
      {
        itemId: 3,
        productId: 303,
        reference: null,
        catalogName: null,
        nameAtWrite: 'Prívesok, ktorý už v katalógu nie je',
        inCatalog: false,
        enriched: false,
        percent: 20,
        status: 'failed',
        priceBefore: null,
        priceBeforeSource: null,
        priceAfter: null,
        priceAfterEstimated: false,
        catalogPrice: null,
        priceMismatch: false,
        reductionUnverifiable: false,
        attemptCount: 3,
        errorCode: 'not_found',
        finishedAt: '2026-08-01T09:05:00.000Z',
      },
    ],
  },
});

/* ═══════════════════════════ 2. Prostredie ════════════════════════════════ */

let container: HTMLElement;
let root: Root;
let calls: { url: string; method: string }[];
const povodnyFetch = globalThis.fetch;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  calls = [];

  const json = (body: unknown): Response =>
    ({ json: () => Promise.resolve(body) }) as unknown as Response;

  globalThis.fetch = vi.fn((input: unknown, init?: unknown) => {
    const url = String(input);
    const method =
      typeof init === 'object' && init !== null && 'method' in init
        ? String((init as { method?: unknown }).method ?? 'GET')
        : 'GET';
    calls.push({ url, method });
    if (url.startsWith(`/api/campaigns/${ID}?`)) return Promise.resolve(json(detailPayload()));
    if (url.startsWith(PRODUCTS_URL)) return Promise.resolve(json(productsPayload()));
    /*
     * Fronta, rozpad a výkon výberu sa tu nemerajú, ale odpovedať MUSIA:
     * prísľub, ktorý nedobehne, by nechal obrazovku v stave „Načítavam zľavu…"
     * a tvrdenia nižšie by nemali čo merať. Chybová obálka je presnejšia než
     * vymyslené telo — obrazovka si na ňu nič nedomýšľa.
     */
    return Promise.resolve(json({ ok: false, error: { code: 'nemerane', message: 'Nemerané.' } }));
  }) as unknown as typeof globalThis.fetch;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = povodnyFetch;
  vi.restoreAllMocks();
});

/** Vykreslí detail a nechá dobehnúť efekty aj prísľuby. */
async function otvorDetail(): Promise<void> {
  await act(async () => {
    root.render(createElement(DiscountDetail, { id: ID }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function najdi(testId: string): HTMLElement {
  const node = container.querySelector(`[data-testid="${testId}"]`);
  expect(node, `útvar ${testId} sa nevykreslil`).not.toBeNull();
  return node as HTMLElement;
}

/** Otvorí rozklik s produktmi tak, ako to spraví klik na jeho nadpis. */
async function otvorRozklik(): Promise<void> {
  const fold = najdi('detail-products') as HTMLDetailsElement;
  await act(async () => {
    fold.open = true;
    fold.dispatchEvent(new Event('toggle'));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const productCalls = (): { url: string; method: string }[] =>
  calls.filter((call) => call.url.startsWith(PRODUCTS_URL));

const riadky = (): HTMLElement[] =>
  [...container.querySelectorAll('[data-testid="detail-products-row"]')] as HTMLElement[];

/** Bunka riadku podľa `data-col` alebo `data-l`. */
function bunka(row: HTMLElement, selector: string): HTMLElement {
  const node = row.querySelector(selector);
  expect(node, `bunka ${selector} chýba`).not.toBeNull();
  return node as HTMLElement;
}

const text = (node: Element): string => (node.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * Text, ktorý človek na obrazovke VIDÍ — bez uzlov len pre čítačku.
 *
 * PREČO TO VO V6b PRIBUDLO (2. 9. 2026)
 * ─────────────────────────────────────
 * Bunky zoznamu odteraz kreslí primitívum `ui/Table.tsx` a k pomlčke dopisuje
 * slovo `TABLE_UNKNOWN_WORD` do `.srOnly` uzla (bod B jeho hlavičky): čítačka
 * pomlčku spravidla neprečíta, takže riadok by znel ako PRÁZDNY — a to je
 * „tichšie", nie „krajšie" (§4 bod 1 kontraktu V6). Viditeľne sa nemení nič.
 *
 * Tvrdenia nižšie preto merajú pomlčku BEZ toho slova a k nej aj strojový
 * kanál `data-value="unknown"`. Oslabenie to nie je — pridal sa tretí kanál
 * k tomu istému priznaniu a merajú sa oba; slovo pre čítačku stráži nad
 * primitívom `test/unit/tabulka-skupina.spec.ts`.
 */
function vidno(node: HTMLElement): string {
  const kopia = node.cloneNode(true) as HTMLElement;
  for (const uzol of [...kopia.querySelectorAll('span')]) {
    if ((uzol.textContent ?? '').trim() === TABLE_UNKNOWN_WORD) uzol.remove();
  }
  return text(kopia);
}

/* ═════════════ 3. Rozklik ten endpoint naozaj číta — a až po otvorení ═════ */

describe('rozklik „Produkty v zľave" siaha na svoj endpoint', () => {
  it('načítanie detailu naň NESIAHNE — sto riadkov sa neťahá do zásoby', async () => {
    await otvorDetail();
    expect(productCalls()).toHaveLength(0);
  });

  it('otvorenie rozkliku vyvolá práve jeden dotaz', async () => {
    await otvorDetail();
    await otvorRozklik();
    expect(productCalls()).toHaveLength(1);
    expect(productCalls()[0]!.method).toBe('GET');
  });

  it('na render ceste nepadne nič mimo lokálnych `/api/*` (K8)', async () => {
    await otvorDetail();
    await otvorRozklik();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.url.startsWith('/api/'), call.url).toBe(true);
  });
});

/* ═══════ 4. Referencia je prvý stĺpec a riadok sa nestratí (D122, I11) ════ */

describe('zoznam produktov zľavy', () => {
  it('vypíše všetky tri riadky vrátane toho, čo z katalógu zmizol', async () => {
    await otvorDetail();
    await otvorRozklik();
    expect(riadky()).toHaveLength(3);
  });

  it('prvý stĺpec je Referencia a volá sa jednotným menom (D122, D124)', async () => {
    await otvorDetail();
    await otvorRozklik();
    const hlavicky = [...najdi('detail-products-table').querySelectorAll('thead th')];
    // Prvá bunka je zaškrtávadlo výberu, hneď za ním referencia — pred názvom.
    const pomenovane = hlavicky.filter((th) => text(th) !== '');
    expect(text(pomenovane[0]!)).toBe('Referencia');
    expect(text(pomenovane[1]!)).toBe('Názov');
  });

  it('obohatený produkt ukáže svoju referenciu', async () => {
    await otvorDetail();
    await otvorRozklik();
    expect(text(bunka(riadky()[0]!, '[data-col="reference"]'))).toBe('NR-0041');
  });

  it('produkt zmiznutý z katalógu má pomlčku a dôvod, nie vypadnutý riadok', async () => {
    await otvorDetail();
    await otvorRozklik();
    const cell = bunka(riadky()[2]!, '[data-col="reference"]');
    expect(vidno(cell)).toBe('—');
    // Tretí kanál toho istého priznania — stroj ho vie prečítať bez textu.
    expect(cell.getAttribute('data-value')).toBe('unknown');
    expect(cell.getAttribute('title')).toBe(GONE_FROM_CATALOG_SK);
  });

  it('neobohatený produkt má tú istú pomlčku, ale INÝ dôvod (D118)', async () => {
    await otvorDetail();
    await otvorRozklik();
    const cell = bunka(riadky()[1]!, '[data-col="reference"]');
    expect(vidno(cell)).toBe('—');
    expect(cell.getAttribute('data-value')).toBe('unknown');
    expect(cell.getAttribute('title')).toBe(PRODUCT_GAP_REASON.not_enriched);
    // Dve nevedomosti sa nezlievajú — inak by pomlčka prestala byť priznaním.
    expect(cell.getAttribute('title')).not.toBe(GONE_FROM_CATALOG_SK);
  });

  it('názov z času zápisu stojí pod dnešným názvom s vlastným menom (I4)', async () => {
    await otvorDetail();
    await otvorRozklik();
    const cell = bunka(riadky()[2]!, '[data-col="name"]');
    expect(text(cell)).toContain('pri zápise: Prívesok, ktorý už v katalógu nie je');
  });
});

/* ═══════════ 5. Cena po je ORIENTAČNÁ a bez ceny pred neexistuje ══════════ */

describe('cena pred a cena po (D4, I11)', () => {
  it('zľavnená cena je označená ako vypočítaná a nesie priznanie', async () => {
    await otvorDetail();
    await otvorRozklik();
    const cell = bunka(riadky()[0]!, '[data-l="Cena po"]');
    expect(text(cell)).toContain('15,99');
    expect(text(cell)).toContain('orientačne');
    expect(cell.getAttribute('title')).toBe(DISCOUNTED_PRICE_DISCLAIMER_SK);
  });

  it('bez známej ceny pred je cena po POMLČKA, nikdy nula', async () => {
    await otvorDetail();
    await otvorRozklik();
    const cell = bunka(riadky()[2]!, '[data-l="Cena po"]');
    expect(text(cell)).toContain('—');
    expect(text(cell)).not.toContain('0,00');
  });

  it('rozišlá cena náhľadu a zápisu je priznaná pri cene, ktorú vysvetľuje (D39c)', async () => {
    await otvorDetail();
    await otvorRozklik();
    expect(text(bunka(riadky()[1]!, '[data-l="Cena pred"]'))).toContain(
      'cena sa medzitým zmenila',
    );
  });
});

/* ════════════ 6. Z tejto cesty neodíde ani jeden zápis (I3) ═══════════════ */

describe('začatie zľavy z výberu je ODKAZ do sprievodcu, nie zápis (I3)', () => {
  it('kým nie je nič zaškrtnuté, tlačidlo neexistuje a vysvetlí sa to vetou', async () => {
    await otvorDetail();
    await otvorRozklik();
    expect(container.querySelector('[data-testid="detail-products-new"]')).toBeNull();
    expect(text(najdi('detail-products-start'))).toContain('nezapíše');
  });

  it('zaškrtnutie riadkov vyrobí LEN adresu sprievodcu s vybranými produktmi', async () => {
    await otvorDetail();
    await otvorRozklik();
    const boxes = [
      ...container.querySelectorAll('[data-testid="detail-products-pick"]'),
    ] as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    await act(async () => {
      boxes[0]!.click();
      boxes[2]!.click();
    });

    const odkaz = najdi('detail-products-new') as HTMLAnchorElement;
    expect(odkaz.getAttribute('href')).toBe('/zlavy/nova?produkty=201%2C303');
  });

  it('zaškrtávanie ani odkaz nevyvolajú ŽIADNY request mimo čítania', async () => {
    await otvorDetail();
    await otvorRozklik();
    const boxes = [
      ...container.querySelectorAll('[data-testid="detail-products-pick"]'),
    ] as HTMLInputElement[];
    await act(async () => {
      boxes[0]!.click();
      boxes[1]!.click();
    });
    await act(async () => {
      (najdi('detail-products-new') as HTMLAnchorElement).click();
    });

    /*
     * Jadro I3 merané SPRÁVANÍM: z tejto cesty neodišiel ani jeden `POST`.
     * Grep nad `DiscountDetail.tsx` by to nedokázal — brána stojí v
     * `POST /api/campaigns` a skratka by sa mohla volať akokoľvek.
     */
    for (const call of calls) expect(call.method.toUpperCase(), call.url).toBe('GET');
    expect(calls.filter((call) => call.url.startsWith('/api/campaigns/'))).not.toHaveLength(0);
    expect(
      calls.filter((call) => call.url === '/api/campaigns' || call.url.endsWith('/execute')),
    ).toHaveLength(0);
  });
});

/* ═════════════════ 7. Adresa sprievodcu — čistý model ════════════════════ */

describe('newDiscountFromProductsHref()', () => {
  it('prázdny výber nie je odkaz — sprievodca „s ničím" by predstieral výber', () => {
    expect(newDiscountFromProductsHref([])).toBeNull();
    expect(newDiscountFromProductsHref([0, -3, 1.5, Number.NaN])).toBeNull();
  });

  it('duplicity a nezmysly sa zahadzujú, nie opravujú', () => {
    expect(newDiscountFromProductsHref([5, 5, -1, 7])).toBe('/zlavy/nova?produkty=5%2C7');
  });

  it('adresa vedie VÝHRADNE do sprievodcu, nikdy na zápisovú routu', () => {
    const href = newDiscountFromProductsHref([201, 202]);
    expect(href).not.toBeNull();
    expect(href!.startsWith('/zlavy/nova?')).toBe(true);
    expect(href).not.toContain('/api/');
  });
});
