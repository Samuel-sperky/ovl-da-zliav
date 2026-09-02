/**
 * Aura Zľavy — KPI RAD PREHĽADU: SKUTOČNÉ ZAPOJENIE (D136, V6b krok 1/3).
 *
 * @vitest-environment jsdom
 *
 * PREČO TENTO SÚBOR EXISTUJE
 * ──────────────────────────
 * `KpiRow.tsx` a `kpi-row-model.ts` boli hotové a otestované dva dni pred tým,
 * než ich `Overview.tsx` začal vykresľovať. Modul bez volajúceho je presne to,
 * ako sa do tohto repa dostal mŕtvy `runEnrichBatch()`, a testy modelu o tom
 * mlčia z definície: dokazujú, že funkcia počíta správne, nie že ju niekto volá.
 *
 * Merajú sa preto štyri veci, ktoré sa nedajú dokázať bez DOM-u:
 *
 *  1. **Rad je v DOM-e** (`data-testid="overview-kpi"`) so štyrmi dlaždicami
 *     v poradí `KPI_TILE_IDS`. Import bez vykreslenia toto tvrdenie nesplní.
 *  2. **Rad stojí NAD stavovým pásom** — rozhodnutie V6b, zdôvodnené
 *     v hlavičke `Overview.tsx`: pás sa sám otvorí pri každom nezelenom
 *     verdikte, čo je dnes (bez `shop_write` kľúča) bežný stav, takže rad pod
 *     ním by v obvyklom stave začínal až pod rozbalenou sekciou „Stav".
 *  3. **Prázdny rad vyzerá dobre a nelže** (R4 kontraktu V6, I11): keď sa
 *     neprečíta nič, sú tam štyri pomlčky a ani jedna nula. Nula je tvrdenie
 *     o produkčnom eshope.
 *  4. **Čísla z odpovedí naozaj DOTEČÚ do dlaždíc** — vrátane pilulky smeru,
 *     ktorá závisí od DRUHÉHO dotazu s `?anchor=`. Toto je tá časť drôtovania,
 *     ktorú model overiť nevie: keby `Overview` predchádzajúce okno nežiadal,
 *     model by naďalej správne hlásil „zmenu nevieme" a bol by zelený.
 *
 * ŽIADNY SHOP (K8): jediné adresy, ktoré tu smú padnúť, sú lokálne `/api/*`;
 * test to overuje zoznamom volaní, nie dobrou vôľou. Okná odpovedí sa počítajú
 * z `window` a `anchor` v URL presne tak, ako ich počíta route — inak by sa
 * dve okná neprekrývali len náhodou a `windowsAdjoin()` by porovnanie zahodilo.
 *
 * Vlastník: V6b, KPI riadok Prehľadu.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Overview from '@/components/dashboard/Overview';
import { KPI_TILE_IDS } from '@/components/dashboard/kpi-row-model';
import { dayFromNumber, dayNumber } from '@/components/dashboard/sales-view';
import { todayHere } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Prípravky ════════════════════════════════ */

const NEVIEME = '—';
/** Predvolené okno Prehľadu; odpovede sa preto skladajú pre 30 dní. */
const WINDOW = 30;

/** Okno odpovede tak, ako ho počíta route: `[kotva − (N−1), kotva]`. */
function windowOf(url: string): { from: string; to: string } {
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  const days = Number(params.get('window') ?? WINDOW);
  const to = params.get('anchor') ?? todayHere();
  const last = dayNumber(to);
  if (last === null) throw new Error(`nečitateľná kotva: ${to}`);
  return { from: dayFromNumber(last - (days - 1)), to };
}

/** Je to dotaz na PREDCHÁDZAJÚCE okno? Pilulka smeru stojí a padá na ňom. */
const isAnchored = (url: string): boolean => url.includes('anchor=');

const salesWindowPayload = (url: string) => ({
  ok: true,
  data: {
    window: windowOf(url),
    /* Staršie okno je slabšie, takže zmena je RAST — a je to jediný spôsob,
       ako sa dá odlíšiť „appka porovnala" od „appka porovnať nevedela". */
    windowUnits: isAnchored(url) ? 400 : 512,
    unitsState: 'measured',
    gaps: { unknownDays: 0 },
  },
});

const revenueDailyPayload = (url: string) => ({
  ok: true,
  data: {
    /* Bez `scope: 'eshop'` sa odpoveď zámerne NEČÍTA (D117) — nechať to na
       náhodu by znamenalo test, ktorý prejde aj s tržbou neznámeho pôvodu. */
    scope: 'eshop',
    today: todayHere(),
    window: windowOf(url),
    series: [
      {
        currency: 'EUR',
        days: [],
        sum: isAnchored(url) ? '800.00' : '999.90',
        sumState: 'measured',
        lowerBoundDays: 0,
      },
    ],
    missing: [],
    hasGap: false,
  },
});

const enrichPayload = () => ({
  ok: true,
  data: {
    state: {
      everRan: true,
      batchDay: todayHere(),
      enrichedToday: 120,
      dailyTarget: 600,
      startedAt: null,
      lastReadAt: null,
      pauseReason: null,
      pausedUntil: null,
      paused: false,
      waitsForHuman: false,
      failedLastTime: false,
      updatedAt: null,
    },
    coverage: {
      enriched: 612,
      catalogProducts: 41_348,
      shopTotalProducts: null,
      remaining: 40_736,
      percent: 1.5,
      estimatedDaysLeft: 68,
    },
    unreadable: [],
    at: '2026-09-02T06:00:00.000Z',
  },
});

/* ═══════════════════════════ 2. Prostredie ═══════════════════════════════ */

let container: HTMLElement;
let root: Root;
let calls: string[];
const povodnyFetch = globalThis.fetch;

/** `true` = VŠETKY endpointy odpovedia chybou (dôkaz o štyroch pomlčkách). */
let vsetkoZlyha = false;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  calls = [];
  vsetkoZlyha = false;

  const json = (body: unknown): Response =>
    ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;
  const chyba = (): Response =>
    json({ ok: false, error: { code: 'db_down', message: 'Nedostupné.' } });

  globalThis.fetch = vi.fn((input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (vsetkoZlyha) return Promise.resolve(chyba());
    if (url.startsWith('/api/insights/sales-daily')) {
      return Promise.resolve(json(salesWindowPayload(url)));
    }
    if (url.startsWith('/api/insights/revenue-daily')) {
      return Promise.resolve(json(revenueDailyPayload(url)));
    }
    if (url.startsWith('/api/catalog/enrich')) return Promise.resolve(json(enrichPayload()));
    /* Ostatné dotazy obrazovky (stav, fronta, zľavy, rebríček) tento súbor
       nemeria. Odpovedajú chybou zámerne: dlaždice, ktoré z nich čerpajú,
       musia zostať pomlčkami aj vtedy, keď ich susedia čísla majú. */
    return Promise.resolve(chyba());
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

/** Vykreslí Prehľad a nechá dobehnúť efekty aj prísľuby oboch načítaní. */
async function otvor(): Promise<void> {
  await act(async () => {
    root.render(createElement(Overview));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const rad = (): Element | null => container.querySelector('[data-testid="overview-kpi"]');
const dlazdica = (id: string): Element | null =>
  container.querySelector(`[data-testid="kpi-${id}"]`);
const hodnota = (id: string): Element | null | undefined =>
  dlazdica(id)?.querySelector('.v');

/* ═════════════════════ 3. Rad je naozaj vykreslený ═══════════════════════ */

describe('D136 — KPI rad Prehľadu je VYKRESLENÝ, nie len naimportovaný', () => {
  it('rad je v DOM-e a nesie štyri dlaždice v záväznom poradí', async () => {
    await otvor();
    const node = rad();
    expect(node).not.toBeNull();
    // Poradie sa neopisuje ručne — berie sa z modelu, takže piata dlaždica
    // alebo iné poradie zčervená tu, nie až v prehliadači.
    expect([...(node?.children ?? [])].map((el) => el.getAttribute('data-testid'))).toEqual(
      KPI_TILE_IDS.map((id) => `kpi-${id}`),
    );
  });

  it('zlatý vlas má PRESNE JEDNA dlaždica radu', async () => {
    await otvor();
    const zlate = [...(rad()?.children ?? [])].filter(
      (el) => el.getAttribute('data-accent') === 'gold',
    );
    expect(zlate.length).toBe(1);
  });

  it('rad stojí NAD stavovým pásom (rozhodnutie V6b)', async () => {
    await otvor();
    const node = rad();
    const pas = container.querySelector('[data-testid="overview-status-band"]');
    expect(node).not.toBeNull();
    expect(pas).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING: pás nasleduje ZA radom.
    const vztah = node?.compareDocumentPosition(pas as Node) ?? 0;
    expect(vztah & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('na render ceste sa nevolá shop, len lokálne `/api/*` (K8)', async () => {
    await otvor();
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) expect(url.startsWith('/api/')).toBe(true);
  });
});

/* ═══════════════════ 4. Prázdny rad (R4) — pomlčky, nie nuly ══════════════ */

describe('R4 — rad bez dát je štyri pomlčky a ani jedna nula', () => {
  it('keď sa neprečíta nič, každá dlaždica priznáva „nevieme"', async () => {
    vsetkoZlyha = true;
    await otvor();
    expect(rad()).not.toBeNull();
    for (const id of KPI_TILE_IDS) {
      const cell = hodnota(id);
      expect(cell?.textContent, id).toBe(NEVIEME);
      expect(cell?.getAttribute('data-unknown'), id).toBe('ano');
    }
  });

  it('ani jedna dlaždica prázdneho radu sa nevykreslí ako nula', async () => {
    vsetkoZlyha = true;
    await otvor();
    const nuly = [...(rad()?.querySelectorAll('.v') ?? [])].filter(
      (node) => node.textContent === '0',
    );
    expect(nuly.length).toBe(0);
  });

  it('pilulka smeru prázdneho radu hovorí „zmenu nevieme", nie 0 %', async () => {
    vsetkoZlyha = true;
    await otvor();
    for (const id of ['predane', 'trzba']) {
      const pill = container.querySelector(`[data-testid="kpi-delta-${id}"]`);
      expect(pill?.getAttribute('data-delta'), id).toBe('unknown');
      expect(pill?.textContent, id).not.toContain('0 %');
    }
  });
});

/* ═════════════ 5. Čísla z odpovedí naozaj dotečú do dlaždíc ═══════════════ */

describe('D136 — dlaždice ukazujú to, čo prišlo z čítacích endpointov', () => {
  it('predané kusy a tržba sedia na odpovedi okna', async () => {
    await otvor();
    expect(hodnota('predane')?.textContent).toBe('512');
    expect(hodnota('predane')?.getAttribute('data-unknown')).toBe('nie');
    // Desatinná ČIARKA a znak meny — suma sa nesmie prekresliť ako číslo kusov.
    expect(hodnota('trzba')?.textContent).toContain('999,90');
    expect(hodnota('trzba')?.textContent).toContain('€');
  });

  it('obohatené z katalógu sedí na stave dávky', async () => {
    await otvor();
    expect(hodnota('obohatene')?.textContent).toBe('612');
  });

  it('Prehľad si vypýtal aj PREDCHÁDZAJÚCE okno a pilulka z neho počíta', async () => {
    await otvor();
    // Bez druhého dotazu s `?anchor=` by porovnanie neexistovalo — a model by
    // pritom zostal zelený, lebo „zmenu nevieme" je jeho legitímna odpoveď.
    const anchored = calls.filter(
      (url) => url.startsWith('/api/insights/sales-daily') && url.includes('anchor='),
    );
    expect(anchored.length).toBe(1);

    const pill = container.querySelector('[data-testid="kpi-delta-predane"]');
    expect(pill?.getAttribute('data-delta')).not.toBe('unknown');
    expect(pill?.textContent).toContain('%');
  });

  it('dlaždica z nečitateľného endpointu zostane pomlčkou vedľa dlaždíc s číslami', async () => {
    await otvor();
    // `/api/campaigns` v tomto súbore odpovedá chybou, takže `calm === null`.
    expect(hodnota('zlavy')?.textContent).toBe(NEVIEME);
    expect(hodnota('zlavy')?.getAttribute('data-unknown')).toBe('ano');
    // A susedná dlaždica pritom číslo MÁ — priznanie je per dlaždica, nie per rad.
    expect(hodnota('predane')?.textContent).toBe('512');
  });
});
