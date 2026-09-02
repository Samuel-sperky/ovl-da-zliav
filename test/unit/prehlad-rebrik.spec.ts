/**
 * Aura Zľavy — TOP A FLOP PREHĽADU AKO VODOROVNÝ REBRÍK (V6b, D136, D121).
 *
 * ČO TENTO SÚBOR MERIA
 * ────────────────────
 *
 *  A. **Rebrík naozaj kreslí primitívum `BarList`**, nie vlastný zoznam. Meria
 *     sa VÝSTUP (`data-testid="bar-list-row"`, `row-bar`), nie import: modul,
 *     ktorý sa len naimportuje, tento test nesplní. Tá istá pasca ako pri
 *     `KpiRow` — hotové primitívum bez volajúceho je mŕtvy kód.
 *
 *  B. **Jedna mierka cez oba zoznamy.** Flop má z definície menšie čísla než
 *     top; keby si škáloval sám, jeho najslabší produkt by mal pás cez celý
 *     riadok a vyzeral by ako najpredávanejší. Meria sa to šírkami pásov.
 *
 *  C. **KOĽKÝCH produktov sa vylúčenie týka — ČÍSLOM (D121).** Veta „produkt
 *     bez nameraného predaja tu nie je" je pravdivá a bez čísla NEMERATEĽNÁ:
 *     človek z nej nevie, či je rebrík obrazom eshopu, alebo jeho stotinou.
 *     Dve čísla („nemerali sme" a „namerali sme nulu") sa nesmú zliať a
 *     chýbajúce číslo sa nesmie dopísať nulou (I11).
 *
 *     Telo odpovede, z ktorej to číslo prichádza, meria
 *     `test/integration/insights-v4.spec.ts` — model, ktorý číta správne
 *     `null`, je zelený aj vtedy, keď mu server posiela nulu. Presne takto
 *     D121 raz už end-to-end neplatil.
 *
 *  D. **Pomenovanie ide cez `productLabel()`**, nie `productNameCell()`: v
 *     rebríku je na produkt JEDEN RIADOK TEXTU, kým `productNameCell()` je pre
 *     tabuľky, kde má referencia vlastný stĺpec (D122). Chýbajúca referencia je
 *     POMLČKA, nikdy vymyslené číslo.
 *
 *  E. **Prázdno rozlišuje štyri príbehy** (D134): načítava · zlyhalo ·
 *     nemerané · prázdno. Posledné dva sú ten rozdiel, na ktorom appka stojí.
 *
 *  F. **Staré triedy sú ZMAZANÉ (D139)** a nikto ich nedrží — inak by vedľa
 *     `ui/kpi.module.css` žila druhá, takmer rovnaká sada tried riadku.
 *
 * Prehľad má tabuľku ZAKÁZANÚ (architektúra §1) a stráži to `prehlad.spec.ts`
 * skenerom nad `components/dashboard`; ten skener komentáre neodstrihuje, takže
 * sa tabuľková značka nesmie napísať ani do tejto hlavičky.
 *
 * Vlastník: V6b, Prehľad.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import TopFlopSection, { excludedCountSentence } from '@/components/dashboard/TopFlopSection';
import type { RankRow } from '@/components/dashboard/overview-model';
import type { TopFlopView } from '@/components/dashboard/window-api';
import { parseTopFlop } from '@/components/dashboard/window-api';

const read = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8');

/* ═══════════════════════════ 1. Prípravky ════════════════════════════════ */

function row(patch: Partial<RankRow> & { productId: number; units: number }): RankRow {
  return {
    reference: `AU-${String(patch.productId)}`,
    name: 'Prsteň',
    discountedNow: false,
    marginPercent: null,
    qty: null,
    enriched: false,
    ...patch,
  };
}

/**
 * Prípravok nesie počty vylúčených ako ČÍSLA — predvolene teda „appka to vie".
 * Test, ktorý meria priznanie chýbajúceho čísla, si ich prepíše na `null`.
 */
function view(patch: Partial<TopFlopView> = {}): TopFlopView {
  return {
    available: true,
    reason: null,
    top: [row({ productId: 11, units: 40 }), row({ productId: 12, units: 20 })],
    flop: [row({ productId: 13, units: 1 })],
    cohortSize: 3,
    unknownDays: 0,
    rankingState: 'measured',
    unknownSales: 38_900,
    measuredZeroSales: 2_445,
    ...patch,
  };
}

const render = (data: TopFlopView | null | undefined, windowDays: 7 | 30 | 90 = 30): string =>
  renderToStaticMarkup(createElement(TopFlopSection, { data, windowDays }));

const count = (html: string, needle: RegExp): number => (html.match(needle) ?? []).length;

/* ═══════════ A + B. Rebrík je primitívum a mierka je jedna ═══════════════ */

describe('A — rebrík kreslí `BarList`, nie vlastný zoznam', () => {
  const html = render(view());

  it('každý riadok oboch zoznamov je riadkom primitíva', () => {
    // Tri produkty (2 top + 1 flop) = tri riadky primitíva a tri pásy.
    expect(count(html, /data-testid="bar-list-row"/g)).toBe(3);
    expect(count(html, /data-testid="row-bar"/g)).toBe(3);
  });

  it('oba zoznamy sú adresovateľné a stoja v panelovom rámci', () => {
    expect(html).toContain('data-testid="rank-top"');
    expect(html).toContain('data-testid="rank-flop"');
    // Sekcia je PLOCHA (`Panel`), teda ten istý rámec ako na ostatných
    // obrazovkách; jej nadpis je `h2` pod `h1` hlavičky stránky.
    expect(html).toContain('data-testid="overview-rank"');
    expect(html).toContain('<h2>Čo sa predáva</h2>');
    expect(html).toContain('<h3>Najviac predané</h3>');
    expect(html).toContain('<h3>Najmenej predané z predávaných</h3>');
  });
});

describe('B — mierka je JEDNA cez top aj flop', () => {
  it('najslabší produkt flopu nemá pás cez celý riadok', () => {
    const html = render(view());
    /*
     * `chartScaleMax(40)` = 50, takže 40 → 80 %, 20 → 40 %, 1 → 2 %. Keby si
     * flop mierku počítal sám, jeho jediný riadok (1 kus) by mal 100 %.
     */
    expect(html).toContain('width:80%');
    expect(html).toContain('width:40%');
    expect(html).toContain('width:2%');
    expect(html).not.toContain('width:100%');
  });

  it('nedočítané okno robí z každého súčtu DOLNÚ HRANICU, nie počet', () => {
    const html = render(view({ rankingState: 'lower_bound', unknownDays: 9 }));
    // Znak `≥` je ten istý, akým appka priznáva dolnú hranicu všade inde.
    expect(html).toContain('≥ 40 kusov');
    expect(html).toContain('data-lower-bound="true"');
    // A veta pod rebríkom to zopakuje slovom, nie len znakom.
    expect(html).toContain('poradie sú dolná hranica');
  });
});

/* ═══════════════ C. Koho sa to netýka — a KOĽKÝCH (D121) ═════════════════ */

describe('C — vylúčené produkty sa priznávajú ČÍSLOM', () => {
  it('veta nesie oba počty a rozlišuje „nemerali sme" od „namerali sme nulu"', () => {
    const html = render(view());
    expect(html).toContain('data-testid="rank-excluded-count"');
    // Tisícky slovenskou medzerou, tak ako všade inde v appke.
    expect(html).toContain('38 900');
    expect(html).toContain('2 445');
    // Pôvodné priznanie sa NEZOSLABILO — stojí vedľa čísla, nie namiesto neho.
    expect(html).toContain('Produkt bez nameraného predaja');
    expect(html).toContain('Ležiaky sú v Produktoch');
  });

  it('dve čísla nie sú jedno: veta ich nesčítava do „vylúčených"', () => {
    const veta = excludedCountSentence(
      { unknownSales: 38_900, measuredZeroSales: 2_445 },
      30,
    );
    expect(veta).toContain('nemerala');
    expect(veta).toContain('nameranú nulu');
    // 38 900 + 2 445 = 41 345. To číslo sa nesmie objaviť — je to súčet merania
    // a jeho absencie, teda veličina, ktorá nič neznamená (I11).
    expect(veta).not.toContain('41 345');
  });

  it('chýbajúce číslo sa PRIZNÁ, nedopíše sa nulou', () => {
    const veta = excludedCountSentence({ unknownSales: null, measuredZeroSales: null }, 30);
    expect(veta).toContain('sa nepodarilo zistiť');
    expect(veta).not.toContain('0 produktov');

    const html = render(view({ unknownSales: null, measuredZeroSales: null }));
    expect(html).toContain('sa nepodarilo zistiť');
  });

  it('polovičné číslo sa povie a druhé sa NEVYMYSLÍ', () => {
    const veta = excludedCountSentence({ unknownSales: 7, measuredZeroSales: null }, 30);
    expect(veta).toContain('7 produktov');
    expect(veta).not.toContain('nameranú nulu');
  });

  it('nečitateľné `excludes` v odpovedi je „nevieme", nie nula (fail-closed)', () => {
    /*
     * Tá istá trieda chyby, akú 31. 8. 2026 mal `gaps`: `?? 0` by z nečitateľnej
     * odpovede spravilo vetu „nemerala u 0 produktov", teda priznanie, ktoré si
     * protirečí číslom, aké appka nezmerala.
     */
    const parsed = parseTopFlop({
      available: true,
      top: [],
      flop: [],
      cohort: { size: 0 },
      excludes: 'nečitateľné',
      gaps: { unknownDays: 0 },
      rankingState: 'measured',
    });
    expect(parsed?.unknownSales).toBeNull();
    expect(parsed?.measuredZeroSales).toBeNull();

    const bezCisla = parseTopFlop({
      available: true,
      top: [],
      flop: [],
      cohort: { size: 0 },
      excludes: { zeroSales: true, notFound: true, unknownSales: null },
      gaps: { unknownDays: 0 },
      rankingState: 'measured',
    });
    expect(bezCisla?.unknownSales).toBeNull();
  });

  it('číslo z odpovede DOTEČIE až na obrazovku', () => {
    /*
     * Toto je to drôtovanie, ktoré samotný model overiť nevie: parser môže
     * čítať správne a sekcia to číslo aj tak nevypíše.
     */
    const parsed = parseTopFlop({
      available: true,
      top: [{ productId: 11, reference: 'AU-11', name: 'Prsteň', units: 5 }],
      flop: [],
      cohort: { size: 1 },
      excludes: {
        zeroSales: true,
        notFound: true,
        unknownSales: 40_512,
        measuredZeroSales: 831,
      },
      gaps: { unknownDays: 0 },
      rankingState: 'measured',
    });
    expect(parsed?.unknownSales).toBe(40_512);

    const html = render(parsed);
    expect(html).toContain('40 512');
    expect(html).toContain('831');
  });
});

/* ══════════════════════ D. Pomenovanie produktu (D116) ═══════════════════ */

describe('D — riadok pomenúva `productLabel()`, nie tabuľková bunka', () => {
  it('„ref · názov" a `#id` až v technickom detaile', () => {
    const html = render(
      view({
        top: [row({ productId: 18_342, units: 12, reference: 'NR-0042', name: 'Náramok' })],
        flop: [],
      }),
    );
    expect(html).toContain('NR-0042 · Náramok');
    expect(html).toContain('#18342');
  });

  it('chýbajúca referencia je POMLČKA a priznanie, nikdy vymyslené číslo', () => {
    const html = render(
      view({
        top: [row({ productId: 900, units: 4, reference: null, name: 'Prívesok' })],
        flop: [],
      }),
    );
    expect(html).toContain('kód produktu ešte nemáme');
    /*
     * Kód sa NEVYMÝŠĽA: `#900` je technický detail (a je v riadku pod textom),
     * nikdy nie referencia, a žiadny „AU-900" appka nezloží.
     */
    expect(html).not.toContain('AU-900');
    // Neobohatené hodnoty sú POMLČKY (U+2014), nie nuly — sklad a marža naraz.
    expect(html).toContain(`sklad ${'—'}`);
    expect(html).toContain(`marža ${'—'}`);
    expect(html).not.toContain('sklad 0');
  });

  it('sekcia nesiaha na `productNameCell()` — to je nástroj tabuliek (D122)', () => {
    const kod = read('src/components/dashboard/TopFlopSection.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
    expect(kod).toContain('productLabel(');
    expect(kod).not.toContain('productNameCell');
  });
});

/* ═════════════════ E. Štyri príbehy prázdna sa nezlievajú ════════════════ */

describe('E — prázdny rebrík povie, KTORÝ z príbehov to je (D134, R4)', () => {
  it('„ešte nedošlo" je kostra, nie prázdny stav ani porucha', () => {
    const html = render(undefined);
    expect(html).toContain('aria-busy');
    expect(html).toContain('data-story="nacitava"');
    expect(html).not.toContain('data-testid="overview-rank"');
  });

  it('nečitateľná odpoveď je ZLYHANIE, nie prázdno', () => {
    const html = render(null);
    expect(html).toContain('data-story="zlyhalo"');
    expect(html).toContain('data-mode="empty"');
    expect(html).toContain('rebríček sa nepodarilo načítať');
  });

  it('nedostupný rebríček je NEMERANÉ a povie dôvod', () => {
    const bezPokrytia = render(view({ available: false, reason: 'no_coverage' }), 7);
    expect(bezPokrytia).toContain('data-story="nemerane"');
    expect(bezPokrytia).toContain('nie je dočítaný ani jeden deň predajov');

    const velkaKohorta = render(
      view({ available: false, reason: 'cohort_too_large' }),
      7,
    );
    expect(velkaKohorta).toContain('data-story="nemerane"');
    expect(velkaKohorta).toContain('priveľa');
  });

  it('prázdno pri DOČÍTANOM okne je nula, pri nedočítanom „nemerali sme"', () => {
    const nula = render(view({ top: [], flop: [], cohortSize: 0 }));
    expect(nula).toContain('data-story="prazdno"');
    expect(nula).toContain('Ani jeden nameraný predaj');

    const nevieme = render(
      view({ top: [], flop: [], cohortSize: 0, rankingState: 'lower_bound', unknownDays: 9 }),
    );
    expect(nevieme).toContain('data-story="nemerane"');
    expect(nevieme).not.toContain('Ani jeden nameraný predaj');
  });

  it('každý prázdny stav má JEDNU cestu ďalej — do Produktov', () => {
    for (const html of [
      render(null),
      render(view({ available: false, reason: 'no_coverage' })),
      render(view({ top: [], flop: [], cohortSize: 0 })),
    ]) {
      expect(count(html, /Otvoriť Produkty/g)).toBe(1);
    }
  });
});

/* ═════════════ F. Staré triedy sú zmazané a nikto ich nedrží ═════════════ */

describe('F — D139: prevedená obrazovka si staré triedy zmazala', () => {
  const CSS = read('src/components/dashboard/overview.module.css');
  const TSX = read('src/components/dashboard/TopFlopSection.tsx');

  it('meranie má nad čím bežať', () => {
    expect(CSS.length).toBeGreaterThan(500);
    // Rozloženie dvoch stĺpcov primitívum nepozná, takže tieto dve ZOSTÁVAJÚ.
    expect(CSS).toContain('.rankGrid');
    expect(CSS).toContain('.rankCol');
  });

  for (const trieda of ['.rankList', '.rankRow', '.rankName', '.rankNote']) {
    it(`\`${trieda}\` v module Prehľadu už nie je`, () => {
      /*
       * Komentáre sa odstrihnú — hlavička bloku o zmazaných triedach PÍŠE, a to
       * je vysvetlenie, nie pravidlo. Bez tohto kroku by test hlásil chybu tam,
       * kde stojí dôvod.
       */
      const bezKomentarov = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
      expect(bezKomentarov).not.toContain(`${trieda} `);
      expect(bezKomentarov).not.toContain(`${trieda}{`);
      expect(bezKomentarov).not.toContain(`${trieda}:`);
    });
  }

  it('a nedrží ich ani sekcia — geometriu riadku vlastní `ui/kpi.module.css`', () => {
    for (const meno of ['rankList', 'rankRow', 'rankName', 'rankNote']) {
      expect(TSX, `${meno} sa v sekcii ešte používa`).not.toContain(`styles.${meno}`);
    }
  });
});

/* ═════════════ Hlavička stránky je JEDNA a je v Prehľade (K4) ════════════ */

describe('Prehľad má hlavičku stránky, a práve jednu', () => {
  const SOURCE = read('src/components/dashboard/Overview.tsx');

  it('obrazovka stojí na `PageHeader`, nie na vlastnom nadpise', () => {
    expect(SOURCE).toContain('<PageHeader');
    // `h1` kreslí výhradne primitívum — dva by čítačke ohlásili dva dokumenty.
    expect(SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ')).not.toContain('<h1');
  });

  it('hlavička je jeden komponent, takže kostra a dáta ju nenapíšu inak', () => {
    /*
     * Vetva kostry (`data === null`) aj vetva s dátami kreslia TEN ISTÝ
     * `<OverviewHeader/>`. Dve kópie hlavičky by boli dve vety o tej istej
     * obrazovke a nadpis by sa po načítaní pod rukami zmenil.
     */
    expect(count(SOURCE, /<OverviewHeader \/>/g)).toBe(2);
    expect(count(SOURCE, /<PageHeader/g)).toBe(1);
  });
});
