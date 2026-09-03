/**
 * Aura Zľavy — KPI RAD PREHĽADU: SKUTOČNÉ ZAPOJENIE (V7, krok 1/4).
 *
 * @vitest-environment jsdom
 *
 * PREČO TENTO SÚBOR EXISTUJE
 * ──────────────────────────
 * `KpiRow.tsx` a `kpi-row-model.ts` boli vo V6b hotové a otestované dva dni
 * pred tým, než ich `Overview.tsx` začal vykresľovať. Modul bez volajúceho je
 * presne to, ako sa do tohto repa dostal mŕtvy `runEnrichBatch()`, a testy
 * modelu o tom mlčia z definície: dokazujú, že funkcia počíta správne, nie že
 * ju niekto volá.
 *
 * V7 to isté pravidlo platí na PREPÍNAČ OKNA. `SoldWindowSwitch` môže byť
 * bezchybný a pritom neovládať nič — a `kpi-row-model.ts` by zostal zelený,
 * pretože „zmenu nevieme" a pomlčka sú jeho legitímne odpovede.
 *
 * Merajú sa preto veci, ktoré sa nedajú dokázať bez DOM-u:
 *
 *  1. **Rad je v DOM-e** (`data-testid="overview-kpi"`) s TROMI kartami
 *     v poradí `KPI_CARD_IDS` (D152). Import bez vykreslenia to nesplní.
 *  2. **Rad je PRVÝ obsah obrazovky** a prepínač okna stojí NAD ním (D155):
 *     prepínač pod číslami by sa čítal ako ovládanie toho, čo je pod ním.
 *     Do 3. 9. 2026 sa tu merala poloha rad → stavový PÁS; pás od V7 (D152)
 *     na Prehľade nie je vôbec, takže sa meria rad → GRAF a k tomu to, že
 *     pás ani prekážky na tejto obrazovke naozaj nie sú.
 *  3. **Prázdny rad vyzerá dobre a nelže** (R4, I11): keď sa neprečíta nič,
 *     sú tam tri pomlčky a ani jedna nula. Nula je tvrdenie o eshope.
 *  4. **Čísla z odpovedí naozaj DOTEČÚ do kariet** — vrátane pilulky smeru,
 *     ktorá závisí od DRUHÉHO dotazu s `?anchor=`.
 *  5. **Prepínač okna mení KARTY AJ TABUĽKU** (D155). Tabuľku kreslí iný krok
 *     V7, takže tu sa meria to, čo z nej už existuje a čo si z nej nemôže
 *     vybrať: **jediný stav okna na obrazovke**. Dokazuje sa to tromi
 *     tvrdeniami naraz — na Prehľade je PRESNE JEDEN prepínač okna predaja
 *     (tabuľka si teda vlastný otvoriť nemôže), po kliknutí nesie koreň
 *     obrazovky nové okno v `data-sold-window` (to je hodnota, z ktorej
 *     tabuľka čerpá) a KPI si ho hneď vypýtali zo servera. Statickú stranu
 *     toho istého pravidla — že si druhý stav okna neotvorí ani nikto ďalší
 *     v `components/dashboard/` — drží `prehlad-kpi-okno.spec.ts`.
 *  6. **Prepínač GRAFU zostáva samostatný** (D155): okno kariet ním nehýbe
 *     a naopak. Jeden prepínač pre oboje Samuel odmietol výslovne.
 *
 * ŽIADNY SHOP (K8): jediné adresy, ktoré tu smú padnúť, sú lokálne `/api/*`;
 * test to overuje zoznamom volaní, nie dobrou vôľou. Okná odpovedí sa počítajú
 * z `window` a `anchor` v URL presne tak, ako ich počíta route — inak by sa
 * dve okná neprekrývali len náhodou a `windowsAdjoin()` by porovnanie zahodilo.
 *
 * Vlastník: V7, krok 1/4 (KPI riadok a prepínače okna).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Overview from '@/components/dashboard/Overview';
import { KPI_CARD_IDS } from '@/components/dashboard/kpi-row-model';
import { dayFromNumber, dayNumber } from '@/components/dashboard/sales-view';
import { DEFAULT_SOLD_WINDOW, SOLD_WINDOW_DAYS } from '@/components/dashboard/sold-window';
import { todayHere } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Prípravky ════════════════════════════════ */

const NEVIEME = '—';

/** Okno odpovede tak, ako ho počíta route: `[kotva − (N−1), kotva]`. */
function windowOf(url: string): { from: string; to: string; days: number } {
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  const days = Number(params.get('window') ?? DEFAULT_SOLD_WINDOW);
  const to = params.get('anchor') ?? todayHere();
  const last = dayNumber(to);
  if (last === null) throw new Error(`nečitateľná kotva: ${to}`);
  return { from: dayFromNumber(last - (days - 1)), to, days };
}

/** Je to dotaz na PREDCHÁDZAJÚCE okno? Pilulka smeru stojí a padá na ňom. */
const isAnchored = (url: string): boolean => url.includes('anchor=');

/**
 * Odpoveď koláča vlastných zliav. `dimension` je PODMIENKA, nie ozdoba —
 * bez nej sa odpoveď zámerne nečíta (karta by nevedela, čí zápis počíta).
 */
const distributionPayload = () => ({
  ok: true,
  data: {
    dimension: 'own-discount',
    scope: 'catalog',
    selectionSize: null,
    total: 41_348,
    slices: [
      { bucket: 'active_now', count: 620, share: 0.015 },
      { bucket: 'discounted_before', count: 1_200, share: 0.029 },
      { bucket: 'never', count: 39_528, share: 0.956 },
    ],
    unknown: { bucket: 'unknown', count: 0, share: 0, reason: 'none' },
    sumMatchesTotal: true,
    locked: [],
    soldWindow: { days: 30, from: '2026-08-05', to: '2026-09-03' },
    enrichedRows: 612,
  },
});

/**
 * Odpoveď pomeru. Staršie okno je slabšie, takže zmena je RAST — a je to
 * jediný spôsob, ako sa dá odlíšiť „appka porovnala" od „appka porovnať
 * nevedela". Okná dlhšie než 90 dní priznávajú nedočítanú históriu (R3).
 */
const soldPerStockPayload = (url: string) => {
  const window = windowOf(url);
  const lowerBound = window.days > 90;
  return {
    ok: true,
    data: {
      window: { from: window.from, to: window.to },
      soldPerStock: isAnchored(url) ? 1.2 : 1.5,
      ratioState: lowerBound ? 'lower_bound' : 'measured',
      windowUnits: 900,
      stock: 600,
      gaps: { unknownDays: lowerBound ? 274 : 0 },
      coverage: { productsWithStock: 612, catalogRows: 41_348 },
    },
  };
};

/* ═══════════════════════════ 2. Prostredie ═══════════════════════════════ */

let container: HTMLElement;
let root: Root;
let calls: string[];
const povodnyFetch = globalThis.fetch;

/** `true` = VŠETKY endpointy odpovedia chybou (dôkaz o troch pomlčkách). */
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
    if (url.startsWith('/api/insights/catalog-distribution')) {
      return Promise.resolve(json(distributionPayload()));
    }
    if (url.startsWith('/api/insights/sold-per-stock')) {
      return Promise.resolve(json(soldPerStockPayload(url)));
    }
    /* Ostatné dotazy obrazovky (stav, fronta, zľavy, rebríček, graf) tento
       súbor nemeria. Odpovedajú chybou zámerne: karty, ktoré z nich nečerpajú,
       musia zostať pravdivé aj vtedy, keď je zvyšok obrazovky bez dát. */
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

/** Vykreslí Prehľad a nechá dobehnúť efekty aj prísľuby všetkých načítaní. */
async function otvor(): Promise<void> {
  await act(async () => {
    root.render(createElement(Overview));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const strom = (): Element | null => container.querySelector('[data-testid="overview"]');
const rad = (): Element | null => container.querySelector('[data-testid="overview-kpi"]');
const karta = (id: string): Element | null =>
  container.querySelector(`[data-testid="kpi-${id}"]`);
const hodnota = (id: string): Element | null | undefined => karta(id)?.querySelector('.v');
const detail = (id: string): string | null | undefined =>
  karta(id)?.querySelector('.s')?.textContent;

/** Prepínač okna kariet a tabuľky. */
const prepinac = (): Element | null =>
  container.querySelector('[data-testid="overview-sold-window-segmented"]');

/** Klik na okno v prepínači kariet. Meno segmentu je celá fráza („180 dní"). */
async function prepni(days: number): Promise<void> {
  const button = prepinac()?.querySelector<HTMLButtonElement>(
    `[aria-label="${String(days)} dní"]`,
  );
  if (button === null || button === undefined) throw new Error(`segment ${days} nie je`);
  await act(async () => {
    button.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/* ═════════════════════ 3. Rad je naozaj vykreslený ═══════════════════════ */

describe('D152 — KPI rad Prehľadu je VYKRESLENÝ, nie len naimportovaný', () => {
  it('rad je v DOM-e a nesie TRI karty v záväznom poradí', async () => {
    await otvor();
    const node = rad();
    expect(node).not.toBeNull();
    // Poradie sa neopisuje ručne — berie sa z modelu, takže štvrtá karta
    // alebo iné poradie zčervená tu, nie až v prehliadači.
    expect([...(node?.children ?? [])].map((el) => el.getAttribute('data-testid'))).toEqual(
      KPI_CARD_IDS.map((id) => `kpi-${id}`),
    );
  });

  it('zlatý vlas má PRESNE JEDNA karta radu', async () => {
    await otvor();
    const zlate = [...(rad()?.children ?? [])].filter(
      (el) => el.getAttribute('data-accent') === 'gold',
    );
    expect(zlate.length).toBe(1);
  });

  it('rad stojí NAD grafom a prepínač okna NAD radom (D155)', async () => {
    await otvor();
    const node = rad();
    const seg = container.querySelector('[data-testid="overview-sold-window"]');
    const graf = container.querySelector('[data-testid="discount-split"]');
    expect(node).not.toBeNull();
    expect(seg).not.toBeNull();
    expect(graf).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING: rad nasleduje ZA prepínačom, graf ZA radom.
    expect(
      (seg?.compareDocumentPosition(node as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (node?.compareDocumentPosition(graf as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /*
   * D152 — pás a prekážky odišli na Nastavenia. Meria sa to TU, vedľa merania
   * poradia: keby sa vrátili, poradie rad → graf by zostalo zelené a jediné,
   * čo by sa zmenilo, je počet vecí na obrazovke, teda práve tá príčina, pre
   * ktorú V7 existuje. Celý presun (aj cieľovú obrazovku) meria
   * `prehlad-styri-sekcie.spec.ts`.
   */
  it('stavový pás ani prekážky na Prehľade NIE SÚ (D152)', async () => {
    await otvor();
    expect(container.querySelector('[data-testid="overview-status-band"]')).toBeNull();
    expect(container.querySelector('[data-testid="overview-status"]')).toBeNull();
    expect(container.querySelector('[data-testid="overview-blockers"]')).toBeNull();
  });

  it('na render ceste sa nevolá shop, len lokálne `/api/*` (K8)', async () => {
    await otvor();
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) expect(url.startsWith('/api/')).toBe(true);
  });
});

/* ═══════════════════ 4. Prázdny rad (R4) — pomlčky, nie nuly ══════════════ */

describe('R4 — rad bez dát je tri pomlčky a ani jedna nula', () => {
  it('keď sa neprečíta nič, každá karta priznáva „nevieme"', async () => {
    vsetkoZlyha = true;
    await otvor();
    expect(rad()).not.toBeNull();
    for (const id of KPI_CARD_IDS) {
      const cell = hodnota(id);
      expect(cell?.textContent, id).toBe(NEVIEME);
      expect(cell?.getAttribute('data-unknown'), id).toBe('ano');
    }
  });

  it('ani jedna karta prázdneho radu sa nevykreslí ako nula', async () => {
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
    const pill = container.querySelector('[data-testid="kpi-delta-predane-na-sklad"]');
    expect(pill?.getAttribute('data-delta')).toBe('unknown');
    expect(pill?.textContent).not.toContain('0 %');
  });
});

/* ═════════════ 5. Čísla z odpovedí naozaj dotečú do kariet ════════════════ */

describe('D152 — karty ukazujú to, čo prišlo z čítacích endpointov', () => {
  it('katalóg a počet vlastných zliav sedia na jednej odpovedi', async () => {
    await otvor();
    expect(hodnota('katalog')?.textContent).toBe('41 348');
    expect(hodnota('katalog')?.getAttribute('data-unknown')).toBe('nie');
    expect(hodnota('zlacnene')?.textContent).toBe('620');
    // Podiel aj menovka „čí zápis to je" musia byť VIDIEŤ (I11, D156).
    expect(detail('zlacnene')).toContain('1,5 %');
    expect(detail('zlacnene')).toContain('podľa vlastných zápisov');
  });

  it('pomer sa píše ako `N×` a hovorí, z koľkých produktov je', async () => {
    await otvor();
    expect(hodnota('predane-na-sklad')?.textContent).toBe('1.5×');
    expect(detail('predane-na-sklad')).toContain('612');
    expect(detail('predane-na-sklad')).toContain('30 dní');
  });

  it('Prehľad si vypýtal aj PREDCHÁDZAJÚCE okno a pilulka z neho počíta', async () => {
    await otvor();
    // Bez druhého dotazu s `?anchor=` by porovnanie neexistovalo — a model by
    // pritom zostal zelený, lebo „zmenu nevieme" je jeho legitímna odpoveď.
    const anchored = calls.filter(
      (url) => url.startsWith('/api/insights/sold-per-stock') && url.includes('anchor='),
    );
    expect(anchored.length).toBe(1);

    const pill = container.querySelector('[data-testid="kpi-delta-predane-na-sklad"]');
    expect(pill?.getAttribute('data-delta')).not.toBe('unknown');
    expect(pill?.textContent).toContain('%');
  });

  it('karta z nečitateľného endpointu zostane pomlčkou vedľa kariet s číslami', async () => {
    /* Koláč odpovie, pomer nie: priznanie je per karta, nie per rad. */
    const povodny = globalThis.fetch;
    globalThis.fetch = vi.fn((input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('/api/insights/catalog-distribution')) {
        return Promise.resolve(
          { ok: true, json: () => Promise.resolve(distributionPayload()) } as unknown as Response,
        );
      }
      return Promise.resolve(
        {
          ok: true,
          json: () => Promise.resolve({ ok: false, error: { code: 'db_down' } }),
        } as unknown as Response,
      );
    }) as unknown as typeof globalThis.fetch;

    await otvor();
    globalThis.fetch = povodny;

    expect(hodnota('predane-na-sklad')?.textContent).toBe(NEVIEME);
    expect(hodnota('predane-na-sklad')?.getAttribute('data-unknown')).toBe('ano');
    expect(hodnota('katalog')?.textContent).toBe('41 348');
  });
});

/* ═══════ 6. Prepínač okna mení KARTY AJ TABUĽKU (D155, bod 5 hlavičky) ════ */

describe('D155 — jeden prepínač okna pre karty aj tabuľku', () => {
  it('prepínač ponúka presne tie okná, ktoré appka pozná', async () => {
    await otvor();
    const labels = [...(prepinac()?.querySelectorAll('[role="radio"]') ?? [])].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(SOLD_WINDOW_DAYS.map((days) => String(days)));
    // Zvolené je predvolené okno a nesie to ARIA, nie len farba.
    const checked = prepinac()?.querySelector('[aria-checked="true"]');
    expect(checked?.textContent).toBe(String(DEFAULT_SOLD_WINDOW));
  });

  it('na obrazovke je PRESNE JEDEN prepínač okna predaja', async () => {
    await otvor();
    /*
     * Druhý by znamenal, že karty a tabuľka môžu ukazovať dve rôzne obdobia.
     * Tabuľku kreslí iný krok V7 a toto tvrdenie je brána, cez ktorú nesmie
     * prejsť s vlastným prepínačom.
     */
    expect(container.querySelectorAll('[data-testid="overview-sold-window"]').length).toBe(1);
  });

  it('klik prepíše okno na koreni obrazovky — to je zdroj okna tabuľky', async () => {
    await otvor();
    expect(strom()?.getAttribute('data-sold-window')).toBe(String(DEFAULT_SOLD_WINDOW));
    await prepni(180);
    expect(strom()?.getAttribute('data-sold-window')).toBe('180');
  });

  it('klik si HNEĎ vypýta nové okno zo servera a karta ho ukáže', async () => {
    await otvor();
    const predtym = calls.filter((url) => url.includes('window=180')).length;
    expect(predtym).toBe(0);

    await prepni(180);

    const potom = calls.filter(
      (url) => url.startsWith('/api/insights/sold-per-stock') && url.includes('window=180'),
    );
    // Aktuálne okno aj predchádzajúce okno rovnakej dĺžky.
    expect(potom.length).toBe(2);
    expect(potom.filter((url) => url.includes('anchor=')).length).toBe(1);

    // 180 dní histórie appka dnes celé nemá, takže karta nesie `≥` a POVIE to.
    expect(hodnota('predane-na-sklad')?.textContent).toBe('≥ 1.5×');
    expect(hodnota('predane-na-sklad')?.getAttribute('data-lower-bound')).toBe('true');
    expect(detail('predane-na-sklad')).toContain('274 dní okna nemáme');
    expect(detail('predane-na-sklad')).toContain('180 dní');
  });

  it('prepínač kariet NEHÝBE prepínačom grafu (D155 — sú to dva)', async () => {
    await otvor();
    const grafPredtym = container
      .querySelector('[data-testid="overview-window"]')
      ?.querySelector('.on')?.textContent;
    await prepni(180);
    const grafPotom = container
      .querySelector('[data-testid="overview-window"]')
      ?.querySelector('.on')?.textContent;
    expect(grafPotom).toBe(grafPredtym);
    // A okno grafu sa ani nedožadovalo prekreslenia na 180 dní (server ho
    // v `WINDOW_DAYS_ALLOWED` nemá a odmietol by ho 400-kou).
    expect(calls.some((url) => url.startsWith('/api/insights/timeline?window=180'))).toBe(false);
  });
});
