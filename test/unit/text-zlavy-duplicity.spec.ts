/**
 * Aura Zľavy — JEDEN FAKT NA JEDNOM MIESTE V TABE ZĽAVY
 * (šprint 20, vlna 2, B3, 20. 8. 2026).
 *
 * Audit tabu Zľavy našiel obrazovky, na ktorých ten istý fakt stál dva až päť
 * raz v priestore dvesto pixelov. Najhorší prípad bol panel uvoľnenia rozsahu:
 * riadok výberu, jantárová škatuľa, tri veľké čísla, ďalší krok a zámok —
 * dokopy vyše šesťdesiat slov o jedinej veci, totiž že do zľavy prejde desať
 * produktov z 41 220. Tento test stráži, aby sa opakovanie nevrátilo, a rovnako
 * dôsledne stráži aj to, čo sa v rámci skracovania zmazať NESMIE.
 *
 * PREČO SA MERIA NAD VYKRESLENÝM MARKUPOM
 * ---------------------------------------
 * Duplicita je vlastnosť OBRAZOVKY, nie súboru. Grep na literál by o nej
 * nedokázal nič: dve kópie toho istého faktu sú tu poskladané z rôznych zdrojov
 * — jedna zo `lib/status/blockers.ts` (veta s číslami), druhá z troch samostatných
 * `formatCountSk()` v mriežke. V zdroji nie sú ani podobné; zhodné sú až na
 * obrazovke. Komponenty sa preto vykresľujú cez `renderToStaticMarkup` a počíta
 * sa VÝSKYT v texte, ktorý človek prečíta.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Počíta sa výskyt, nie prítomnosť.** Tvrdenie „v HTML je 41 220" prejde
 *     aj vtedy, keď je tam trikrát. Preto sa všade porovnáva POČET.
 *  B. **Číslo, ktoré sa smie zopakovať, sa vymenuje.** `10` stojí v mriežke aj
 *     v ďalšom kroku („Zúžte výber na 10 produktov") — to je zámer, lebo krok
 *     bez cieľa nie je krok. Test preto stráži `41 220` a `41 210`, teda tie
 *     dve čísla, ktoré nikde inde ako v mriežke stáť nemajú.
 *  C. **Skracovanie sa nesmie stať mazaním.** Druhá polovica testu tvrdí, že
 *     veta o skúške naprázdno, veta o orientačnom prepočte, slovo pri každej
 *     dlaždici a cesta von zo stropu na obrazovke ZOSTALI. Bez nich by sa
 *     z tlačidiel nad ostrým eshopom stali tlačidlá neznámeho účinku (I3).
 *  D. **Slovo aj značka pri dlaždici sú nedotknuteľné.** Tretí riadok dlaždice
 *     pri nule padá; popisok a značka nie. Tie zvlášť a po jednej meria
 *     `test/unit/znacky-zlavy-fronta.spec.ts` (A1, A2) — tu sa tvrdia znovu
 *     len preto, aby sa skracovanie textu nedalo urobiť na ich úkor.
 *  E. **Ďalší krok sa neporovnáva na literál.** Vetu vlastní
 *     `lib/status/blockers.ts` a mení ju iný pracovník tej istej vlny; test si
 *     ju preto pýta z toho istého zdroja ako appka.
 *
 * Vlastník: B3, šprint 20.
 */
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { QueueTiles } from '@/components/campaigns/DiscountDetail';
import { PerformanceCard } from '@/components/campaigns/DiscountPerformance';
import { queueBlockedReason, type QueueGateState } from '@/components/campaigns/NewDiscount';
import NewDiscountConfirm from '@/components/campaigns/NewDiscountConfirm';
import ScopeRelease from '@/components/campaigns/ScopeRelease';
import { buildTiers, type SelectableRow } from '@/components/campaigns/discounts-model';
import type { BlockerCard } from '@/components/campaigns/queue-model';
import { collectOperationBlockers } from '@/lib/status/blockers';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═══════════════════ 0. Náradie — text a výskyty ══════════════════════════ */

const render = (el: ReactElement): string => renderToStaticMarkup(el);

/** Text, ktorý človek prečíta — bez značiek a bez zdvojených medzier. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t\n\r]+/g, ' ')
    .trim();
}

/** Koľkokrát sa reťazec v texte naozaj vyskytne (bod A). */
function kolkokrat(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/** Počet slov v texte — miera „koľko toho obrazovka povie". */
const slov = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/**
 * Vnútro `<div>` s daným `data-testid`, so správnym zanorením.
 *
 * Regex „od testid po najbližší `</div>`" by odrezal dlaždicu po prvom
 * vnútornom riadku a test by tvrdil o kuse markupu, nie o dlaždici.
 */
function vnutroDivu(html: string, testId: string): string {
  const znacka = `data-testid="${testId}"`;
  const at = html.indexOf(znacka);
  expect(at, `uzol ${testId} sa nevykreslil`).toBeGreaterThan(-1);
  const start = html.indexOf('>', at) + 1;
  let hlbka = 1;
  let i = start;
  while (i < html.length && hlbka > 0) {
    const otvor = html.indexOf('<div', i);
    const zavri = html.indexOf('</div>', i);
    expect(zavri, `uzol ${testId} sa nezavrel`).toBeGreaterThan(-1);
    if (otvor !== -1 && otvor < zavri) {
      hlbka += 1;
      i = otvor + 4;
      continue;
    }
    hlbka -= 1;
    if (hlbka === 0) return html.slice(start, zavri);
    i = zavri + 6;
  }
  throw new Error(`uzol ${testId} sa nezavrel`);
}

/* ═════ 1. Rozsah — jeden fakt raz, nie päťkrát na dvesto pixeloch ═════════ */

/**
 * Prekážka stropu z jediného zdroja pravdy, presne v situácii z auditu:
 * pilotný režim, strop 10, vo filtri celý katalóg.
 */
const KATALOG = 41_220;
const STROP = 10;
const OSTANE = KATALOG - STROP;

const stropBlocker = collectOperationBlockers({
  now: new Date('2026-08-20T10:00:00.000Z'),
  writes: { enabled: true },
  apiKey: { present: true, expiresAt: new Date('2026-09-14T09:00:00.000Z') },
  writeBudget: { budget: 200, spent: 0, day: '2026-08-20' },
  scope: { mode: 'pilot', maxProducts: STROP, failClosed: false },
  selection: { selectedCount: KATALOG },
}).find((b) => b.id === 'scope_pilot_cap');

const card: BlockerCard | null =
  stropBlocker === undefined
    ? null
    : {
        id: stropBlocker.id,
        severity: stropBlocker.severity,
        resolution: stropBlocker.resolution,
        what: stropBlocker.what,
        nextStep: stropBlocker.nextStep,
        path: stropBlocker.path,
        assumed: stropBlocker.assumed,
        clearsAt: null,
      };

const scopeHtml = (): string =>
  render(createElement(ScopeRelease, { wanted: KATALOG, allowed: STROP, blocker: card }));

describe('panel rozsahu povie fakt raz — nie vetou aj číslami naraz', () => {
  it('prekážka stropu sa dá zostaviť a naozaj nesie tie tri čísla', () => {
    // Bez tohto by celý oddiel meral prázdno: `null` blocker kreslí iný text.
    expect(stropBlocker, 'scope_pilot_cap sa nezostavil').toBeDefined();
    expect(stropBlocker!.what).toContain(formatCountSk(KATALOG));
    expect(stropBlocker!.what).toContain(formatCountSk(OSTANE));
  });

  it('veta prekážky na paneli NIE JE — mriežka hovorí to isté', () => {
    expect(text(scopeHtml())).not.toContain(stropBlocker!.what);
  });

  it('každé z dvoch veľkých čísel stojí na paneli PRÁVE RAZ (bod A, B)', () => {
    const t = text(scopeHtml());
    expect(kolkokrat(t, formatCountSk(KATALOG)), 'koľko vyhovuje — povedané dvakrát').toBe(1);
    expect(kolkokrat(t, formatCountSk(OSTANE)), 'koľko ostane — povedané dvakrát').toBe(1);
  });

  it('nad číslami nestojí žiadna jantárová škatuľa', () => {
    const html = scopeHtml();
    expect(html).not.toContain('data-variant="warn"');
    expect(html).not.toContain('ovl-note');
  });

  it('mriežka aj tak povie všetky tri čísla aj s popiskami', () => {
    const t = text(scopeHtml());
    for (const [popis, cislo] of [
      ['Výberu vyhovuje', KATALOG],
      ['Na jednu zľavu prejde', STROP],
      ['Ostane nezlacnených', OSTANE],
    ] as const) {
      expect(t, popis).toContain(popis);
      expect(t, popis).toContain(formatCountSk(cislo));
    }
  });

  it('cesta von zo stropu zostala celá — krok, odkaz aj upozornenie na potvrdenie', () => {
    const html = scopeHtml();
    // Bod E — veta sa pýta zo `blockers.ts`, neporovnáva sa na literál.
    expect(text(html), 'ďalší krok zmizol so škatuľou').toContain(stropBlocker!.nextStep);
    expect(html).toContain('/nastavenia#rozsah');
    expect(text(html)).toContain('Prepnúť rozsah v Nastaveniach');
    // Do 27. 8. 2026 tu stálo „heslo"; D105 ho vymenilo za „potvrdenie".
    expect(
      text(html),
      'zámok nesmie zmiznúť — potvrdenie je prekvapenie až pri prepnutí',
    ).toContain('potvrdenie');
  });

  it('panel bez prekážky povie čísla aj cestu — a tiež bez škatule', () => {
    const html = render(
      createElement(ScopeRelease, { wanted: KATALOG, allowed: STROP, blocker: null }),
    );
    const t = text(html);
    expect(kolkokrat(t, formatCountSk(KATALOG))).toBe(1);
    expect(html).toContain('/nastavenia#rozsah');
    expect(html).not.toContain('data-variant="warn"');
  });
});

/* ═════ 2. Dlaždice fronty — tretí riadok len keď má čo povedať ════════════ */

const PLNA = { itemsOk: 12, itemsPending: 3, itemsFailed: 2, itemsUncertain: 1, itemsTotal: 18 };
const HOTOVA = { itemsOk: 18, itemsPending: 0, itemsFailed: 0, itemsUncertain: 0, itemsTotal: 18 };

const DLAZDICE = [
  { testId: 'tile-ok', word: 'Zapísané', nulova: false },
  { testId: 'tile-pending', word: 'Čaká na zápis', nulova: true },
  { testId: 'tile-failed', word: 'Nepodarilo sa', nulova: true },
  { testId: 'tile-uncertain', word: 'Nevieme, či sa zapísalo', nulova: true },
] as const;

const tiles = (counts: typeof PLNA): string =>
  render(createElement(QueueTiles, { campaign: counts as never }));

describe('dlaždica fronty pri nule nevysvetľuje nulu', () => {
  it('všetky štyri dlaždice sú tam aj pri nule (kontrakt UI, bod 22)', () => {
    const html = tiles(HOTOVA);
    for (const d of DLAZDICE) expect(html, d.testId).toContain(`data-testid="${d.testId}"`);
  });

  it('pri hodnote má dlaždica tretí riadok — vysvetlivku k číslu', () => {
    const html = tiles(PLNA);
    for (const d of DLAZDICE) {
      expect(vnutroDivu(html, d.testId), `${d.testId} stratil vysvetlivku`).toContain(
        '<div class="s">',
      );
    }
  });

  it('pri nule tretí riadok NIE JE — vzor `products/CatalogTiles.tsx`', () => {
    const html = tiles(HOTOVA);
    for (const d of DLAZDICE.filter((x) => x.nulova)) {
      expect(vnutroDivu(html, d.testId), `${d.testId} vysvetľuje nulu`).not.toContain(
        '<div class="s">',
      );
    }
  });

  it('slovo aj značka pri nule ZOSTÁVAJÚ — skracuje sa vysvetlivka, nie stav (bod D)', () => {
    const html = tiles(HOTOVA);
    for (const d of DLAZDICE) {
      // Značka je súrodenec dlaždice, teda mimo `data-testid` uzla — hľadá sa
      // v celom páse; po jednej ju meria `znacky-zlavy-fronta.spec.ts`.
      expect(text(vnutroDivu(html, d.testId)), `${d.testId} bez slova`).toContain(d.word);
    }
    expect((html.match(/<svg/g) ?? []).length, 'pás stratil značky').toBe(4);
  });

  it('veta dominanty sa v dlaždiciach neopakuje', () => {
    // „21 / 21 · fronta má túto zľavu vybavenú" je nad pásom. Dlaždica
    // „Čaká na zápis 0" hovorievala presne to isté, 85 px pod ňou.
    for (const counts of [PLNA, HOTOVA]) {
      expect(text(tiles(counts))).not.toContain('fronta má túto zľavu vybavenú');
    }
  });
});

/* ═════ 3. Zamknuté uhly — meno raz, dôvod krátko, žiadne rozvíjanie ═══════ */

const perfHtml = (): string => render(createElement(PerformanceCard, { view: null, failed: false }));

/** Riadky `LockedAngle` tak, ako sa vykreslili. */
function zamknuteRiadky(html: string): string[] {
  // Riadok nesie len dva `<span>`, takže sa zavrie prvým `</div>`; zanorený
  // `<div>` by tu bol karta, a práve tou `LockedAngle` zámerne nie je (D17).
  return [...html.matchAll(/<div[^>]*data-testid="performance-locked"[^>]*>([\s\S]*?)<\/div>/g)].map(
    (m) => text(m[1]!),
  );
}

describe('zamknutý uhol je meno a krátky dôvod, nie odstavec', () => {
  it('sú dva a nesú svoje mená', () => {
    const riadky = zamknuteRiadky(perfHtml());
    expect(riadky).toHaveLength(2);
    expect(riadky[0]).toContain('Tržby');
    expect(riadky[1]).toContain('Rovnaké obdobie vlani');
  });

  it('dôvod meno neopakuje a nekončí vetou — je to popiska, nie odsek', () => {
    for (const riadok of zamknuteRiadky(perfHtml())) {
      expect(kolkokrat(riadok, 'Tržby'), riadok).toBeLessThanOrEqual(1);
      expect(riadok.endsWith('.'), `${riadok} — dôvod sa rozvinul na vetu`).toBe(false);
      expect(slov(riadok), `${riadok} — priveľa slov na tichý riadok`).toBeLessThanOrEqual(9);
    }
  });

  it('appka ani tu nepredstiera eurá', () => {
    expect(perfHtml()).not.toContain('€');
  });
});

/* ═════ 4. Dopad na maržu — jedno slovo, dvakrát rovnako ═══════════════════ */

const ROWS: SelectableRow[] = [
  { productId: 1, name: 'Strieborná retiazka', price: '39.00', unitsSold: 0, discountedNow: false },
  { productId: 2, name: 'Zlatý prsteň', price: '129.00', unitsSold: 2, discountedNow: false },
];

const confirmHtml = (): string =>
  render(
    createElement(NewDiscountConfirm, {
      itemsCount: 2,
      tiers: buildTiers(ROWS, 20).tiers,
      averagePrice: 84,
      typed: '',
      onTyped: () => {},
      previewFresh: false,
      preview: null,
      previewAt: null,
      busy: 'idle' as const,
      blockedReason: queueBlockedReason({
        itemsCount: 2,
        writesLocked: false,
        percentError: undefined,
        windowError: null,
        previewFresh: false,
        previewBlockers: 0,
        typed: '2',
      } satisfies QueueGateState),
      error: null,
      created: null,
      onPreview: () => {},
      onQueue: () => {},
    }),
  );

describe('o chýbajúcich dátach sa hovorí jedným slovom, nie výkladom', () => {
  it('potvrdenie povie „Dopad na maržu — zamknuté" a nič nedovysvetľuje', () => {
    const html = confirmHtml();
    expect(html).toContain('<span class="lockline">zamknuté</span>');
    expect(text(html), 'výklad o nákupných cenách patrí na jedno miesto').not.toContain(
      'nákupných cien',
    );
  });

  it('dopad na maržu sa nikde nepremení na číslo (K8)', () => {
    const t = text(confirmHtml());
    const at = t.indexOf('Dopad na maržu');
    expect(at).toBeGreaterThan(-1);
    expect(t.slice(at, at + 40)).not.toMatch(/\d/);
  });
});

/* ═════ 5. Čo skracovanie zmazať NESMIE (bod C, I3) ════════════════════════ */

describe('vety, bez ktorých by tlačidlá nad ostrým eshopom stratili účinok', () => {
  it('skúška naprázdno o sebe stále hovorí, že nič nezapíše', () => {
    expect(text(confirmHtml())).toContain('Skúška nič nezapíše');
  });

  it('bez čerstvej skúšky poistka stále povie, čo sa má urobiť najprv', () => {
    const reason = queueBlockedReason({
      itemsCount: 2,
      writesLocked: false,
      percentError: undefined,
      windowError: null,
      previewFresh: false,
      previewBlockers: 0,
      typed: '2',
    } satisfies QueueGateState);
    expect(reason).toContain('Najprv spustite skúšku naprázdno');
  });
});
