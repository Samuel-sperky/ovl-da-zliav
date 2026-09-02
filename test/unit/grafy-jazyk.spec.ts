/**
 * Aura Zľavy — JEDEN JAZYK GRAFOV (D126, 1. 9. 2026).
 *
 * `grafy-paleta.spec.ts` meria FARBY, `grafy-predaj.spec.ts` meria čiarový graf
 * predaja. Tento súbor meria to, čo majú všetky tri formy SPOLOČNÉ, a všetko
 * v ňom je otázka, ktorá sa okom nedá zodpovedať:
 *
 *  A. **Je os naozaj jedna?** PRESMEROVANÉ 2. 9. 2026 (K5, V6b). Do tohto
 *     sprintu existovalo pravidlo hornej hranice v TROCH kópiách
 *     (`chartScaleMax`, `sales-view.niceCeiling`, `price-bins.niceCount`) a
 *     tvrdenie tu bolo to druhé najlepšie: porovnávalo ich na celom rozsahu
 *     hodnôt. Tri kópie sú teraz ZLÚČENÉ na jednu, takže sa nemá čo s čím
 *     porovnávať — a porovnávanie klonu s klonom bolo aj tak slabšie, než sa
 *     zdalo: keby sa niekto preklepol v rebríku `[1, 2, 5, 10]` v OBOCH
 *     kópiách naraz (copy-paste), test by zostal zelený. Namiesto toho tu
 *     stoja dve silnejšie tvrdenia:
 *       · hodnoty `chartScaleMax()` sú pribité na VLASTNÚ tabuľku očakávaní,
 *         nie na druhú implementáciu,
 *       · statická závora prehľadá `src/` a nájde nanajvýš JEDNO telo toho
 *         rebríka. Kto si napíše štvrtú kópiu, spadne na nej.
 *
 *  B. **Scitáva koláč 100 % z PRAVDY?** Diel „nevieme" je jediné miesto, kde
 *     appka priznáva, že o časti katalógu nevie nič. Keby vypadol, koláč by
 *     vyzeral dôveryhodnejšie a bol by nepravdivý: „92 % produktov nie je
 *     v zľave" znamená v skutočnosti „92 % produktov sme nikdy nečítali".
 *     Preto sa tu meria PRÍTOMNOSŤ dielu, jeho značka aj SÚČET percent.
 *
 *  C. **Sedí dátová tabuľka s grafom?** Tabuľka je doslovný prepis, nie druhý
 *     výpočet. Meria sa to porovnaním riadkov s geometriou, nie prečítaním kódu.
 *
 *  D. **Kreslí sa medzera ako nula?** Ani v jednej z troch foriem sa nesmie —
 *     nesťahovaný deň, nemeraná položka a neobohatený produkt dostanú tú istú
 *     šrafovanú značku a slovo, nikdy nulu.
 *
 * Bez prehliadača a bez databázy: geometria sú čisté funkcie, komponenty idú
 * cez `renderToStaticMarkup`.
 *
 * Vlastník: V5-GRAFY.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { CatalogDistributionResponse } from '@/app/api/insights/catalog-distribution/route';
import SalesChart from '@/components/dashboard/SalesChart';
import { salesChartView } from '@/components/dashboard/sales-chart-view';
import { tableRows } from '@/components/dashboard/SalesSection';
import TopFlopSection, { ThinWithPie } from '@/components/dashboard/TopFlopSection';
import { chartGeometry } from '@/components/dashboard/sales-view';
import type { RankRow } from '@/components/dashboard/overview-model';
import type { TopFlopView } from '@/components/dashboard/window-api';
import { RowBar, SharePie } from '@/components/ui/Charts';
import {
  CHART_KINDS,
  GAP_WORD,
  MAX_PIE_SLICES,
  PIE,
  UNKNOWN_WORD,
  barLayout,
  chartScaleMax,
  distributionPieInput,
  distributionSliceLabel,
  pieGeometry,
  piePercentText,
  readCatalogDistribution,
  type CatalogDistributionView,
  type PieGeometry,
  type PieInput,
} from '@/components/ui/chart-language';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/* ── Celý `src/` ako text — na závoru „druhé telo pravidla osi" ─────────── */

const ROOT = resolve(process.cwd());

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const SRC_FILES = tsFiles(resolve(ROOT, 'src'))
  .map((path) => ({
    path: relative(ROOT, path).split(sep).join('/'),
    code: readFileSync(path, 'utf8'),
  }))
  .sort((a, b) => (a.path < b.path ? -1 : 1));

/**
 * Telo pravidla hornej hranice osi: rebrík `[1, 2, 5, 10]` v cykle.
 *
 * Hľadá sa tvar, nie meno funkcie — kópia pod iným menom (a práve tak sa
 * `niceCeiling` a `niceCount` volali) by grepu na meno ušla.
 */
const LADDER = /\[\s*1\s*,\s*2\s*,\s*5\s*,\s*10\s*\]/;

/* ═══════════════════ A. Jedna os pre všetky tri formy ═════════════════════ */

describe('pravidlo hornej hranice osi je JEDNO a je pribité na vlastnú tabuľku', () => {
  /**
   * Očakávania sú vypísané RUČNE, nie dopočítané druhou implementáciou.
   * Presne to bola slabina predchádzajúceho tvrdenia: porovnávalo `chartScaleMax`
   * s dvoma jeho vlastnými kópiami, takže rovnaký preklep vo všetkých troch by
   * prešiel. Tabuľka pokrýva hranice rebríka (1, 2, 5, 10) v troch dekádach,
   * hodnoty tesne pod a nad nimi, nulu, zlomok a dve reálne čísla z tejto appky
   * (1 180 kusov za okno, 41 348 riadkov katalógu).
   */
  const OCAKAVANIA: ReadonlyArray<readonly [number, number]> = [
    [-5, 1],
    [0, 1],
    /* Zlomok: rebrík funguje aj pod jednotkou (0,1 · 0,2 · 0,5). Ručná
       tabuľka to odhalila, porovnávanie dvoch klonov nie — všetky tri kópie
       vracali 0,5 a test bol zelený. V grafoch tejto appky sa to nestane,
       lebo os nesie KUSY a produkty, ale pravidlo je zapísané tak, ako sa
       naozaj chová, nie tak, ako sa niekomu zdalo. */
    [0.4, 0.5],
    [1, 1],
    [2, 2],
    [3, 5],
    [7, 10],
    [9, 10],
    [10, 10],
    [11, 20],
    [14, 20],
    [20, 20],
    [21, 50],
    [49, 50],
    [50, 50],
    [51, 100],
    [99, 100],
    [100, 100],
    [101, 200],
    [199, 200],
    [200, 200],
    [501, 1000],
    [1180, 2000],
    [41348, 50000],
    [999999, 1000000],
  ];

  it('základňa je nula a hranica najbližšie okrúhle číslo NAD maximom', () => {
    for (const [value, expected] of OCAKAVANIA) {
      expect(chartScaleMax(value), `hodnota ${String(value)}`).toBe(expected);
    }
  });

  it('v `src/` neexistuje DRUHÉ telo toho istého pravidla', () => {
    /*
     * ZLÚČENIE TROCH KÓPIÍ NA JEDNU (K5, 2. 9. 2026) — a závora, ktorá ho drží.
     *
     * `niceCeiling()` v `dashboard/sales-view.ts` a `niceCount()`
     * v `charts/price-bins.ts` boli znakovo zhodné telá `chartScaleMax()`.
     * Kontrakt V6a §9 hlásil pod K5 „zlúčené", ale zlúčené neboli — zostal len
     * test, ktorý ich porovnával. Tu sa preto nemeria zhoda, ale POČET:
     * rebrík `[1, 2, 5, 10]` nad `Math.log10` smie mať v `src/` jedno jediné
     * telo a musí byť v jazyku grafov.
     */
    const hits = SRC_FILES.filter((file) => LADDER.test(file.code));
    expect(hits.map((f) => f.path)).toEqual(['src/components/ui/chart-language.ts']);
  });

  it('závora na druhé telo nie je slepá', () => {
    // Bez tejto vety by tvrdenie vyššie platilo aj pre pokazený detektor.
    expect(LADDER.test('for (const step of [1, 2, 5, 10]) {')).toBe(true);
    expect(LADDER.test('for (const step of [1,2,5,10]) {')).toBe(true);
    expect(LADDER.test('for (const step of [1, 2, 5]) {')).toBe(false);
    expect(SRC_FILES.length).toBeGreaterThan(100);
  });

  it('žiadne pole v dátach grafu sa nemenuje `key` (I1, redaktor)', () => {
    /*
     * Redaktor logov (`lib/log/redact.ts`) má `key` v `DENY_EXACT` a maskuje
     * HODNOTU každého poľa s tým menom v ľubovoľnej hĺbke vnorenia. Koláč to
     * už raz odniesol: kým sa diel volal `key`, route vracala
     * `{ key: '***REDACTED***', count: 3 }` — symbol dielu zmizol, počty
     * zostali, a graf sa dal nakresliť s tromi rovnako pomenovanými dielmi.
     *
     * Stĺpec mal to isté meno až do 2. 9. 2026. Cez redaktor síce nechodí
     * (je to klientská mierka), ale rozhodovať pri každom novom grafe, na
     * ktorej strane hranice stojí, je drahšie než jedno meno pre všetky tri
     * formy. Redaktor sa NESMIE oslabiť ani obísť výnimkou.
     */
    for (const rel of ['../../src/components/ui/chart-language.ts', '../../src/components/charts/price-bins.ts']) {
      const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, `${rel} deklaruje pole \`key\``).not.toMatch(/^\s*(readonly\s+)?key\??:/m);
    }
    // A pozitívna strana: symbol položky sa naozaj volá `bucket`.
    expect(barLayout([{ bucket: 'a', value: 1 }]).bars[0]?.bucket).toBe('a');
  });

  it('nečíslo ani záporné číslo os nezrútia — hranica je vždy aspoň 1', () => {
    expect(chartScaleMax(Number.NaN)).toBe(1);
    expect(chartScaleMax(Number.POSITIVE_INFINITY)).toBe(1);
    expect(chartScaleMax(-3)).toBe(1);
  });

  it('D126 menuje presne tri formy a ku každej otázku', () => {
    expect(Object.keys(CHART_KINDS).sort()).toEqual(['bar', 'line', 'pie']);
    expect(CHART_KINDS.line).toBe('vývoj v čase');
    expect(CHART_KINDS.bar).toBe('porovnanie medzi položkami');
    expect(CHART_KINDS.pie).toBe('rozdelenie katalógu alebo výberu');
  });
});

/* ═══════════════════════════ B. Koláč ═════════════════════════════════════ */

function pieInput(over: Partial<PieInput> = {}): PieInput {
  return {
    slices: [
      { bucket: 'none', label: '0 predaných', count: 60 },
      { bucket: 'low', label: '1–2 predané', count: 25 },
      { bucket: 'high', label: '10 a viac', count: 5 },
    ],
    unknown: { label: UNKNOWN_WORD, count: 10, note: 'dni predajov chýbajú' },
    total: 100,
    sumMatchesTotal: true,
    ...over,
  };
}

function geometryOf(input: PieInput): PieGeometry {
  const result = pieGeometry(input);
  if (!result.ok) throw new Error(`koláč sa nenakreslil: ${result.reason}`);
  return result.geometry;
}

describe('koláč — diel „nevieme" je diel ako každý iný', () => {
  it('diel „nevieme" je v geometrii VŽDY a je posledný', () => {
    const geometry = geometryOf(pieInput());
    const last = geometry.slices[geometry.slices.length - 1];
    expect(last?.bucket).toBe('unknown');
    expect(geometry.unknown.bucket).toBe('unknown');
    expect(geometry.unknown.count).toBe(10);
  });

  it('nulový diel „nevieme" NEZMIZNE — nula je odpoveď, chýbanie je klamstvo', () => {
    const geometry = geometryOf(
      pieInput({
        slices: [
          { bucket: 'active_now', label: 'beží', count: 40 },
          { bucket: 'never', label: 'nikdy', count: 60 },
        ],
        unknown: { label: UNKNOWN_WORD, count: 0, note: 'o vlastných zápisoch vieme všetko' },
      }),
    );
    expect(geometry.unknown.count).toBe(0);
    expect(geometry.unknown.path).toBe('');
    expect(geometry.slices.some((slice) => slice.unknown)).toBe(true);
  });

  it('súčet percent je PRESNE 100 vrátane dielu „nevieme"', () => {
    const vstupy: PieInput[] = [
      pieInput(),
      pieInput({
        slices: [
          { bucket: 'a', label: 'a', count: 1 },
          { bucket: 'b', label: 'b', count: 1 },
          { bucket: 'c', label: 'c', count: 1 },
        ],
        unknown: { label: UNKNOWN_WORD, count: 0, note: 'nič nechýba' },
        total: 3,
      }),
      pieInput({
        slices: [{ bucket: 'a', label: 'a', count: 41_344 }],
        unknown: { label: UNKNOWN_WORD, count: 4, note: 'nečítané' },
        total: 41_348,
      }),
      pieInput({
        slices: [{ bucket: 'a', label: 'a', count: 7 }],
        unknown: { label: UNKNOWN_WORD, count: 41_341, note: 'nečítané' },
        total: 41_348,
      }),
    ];
    for (const vstup of vstupy) {
      const geometry = geometryOf(vstup);
      expect(geometry.percentSum, JSON.stringify(vstup.slices)).toBe(100);
      const sum = geometry.slices.reduce((acc, slice) => acc + slice.count, 0);
      expect(sum).toBe(geometry.total);
    }
  });

  it('nenulový diel sa NIKDY nenapíše ako „0,0 %" — dostane „< 0,1 %"', () => {
    const geometry = geometryOf(
      pieInput({
        slices: [{ bucket: 'a', label: 'a', count: 41_344 }],
        unknown: { label: UNKNOWN_WORD, count: 4, note: 'nečítané' },
        total: 41_348,
      }),
    );
    expect(geometry.unknown.tiny).toBe(true);
    expect(piePercentText(geometry.unknown)).toBe('< 0,1 %');
    expect(piePercentText({ percent: 12.5, tiny: false })).toBe('12,5 %');
  });

  it('„nevieme" nesie ŠRAFOVANIE, nie krok rampy — nevedomosť nie je veľkosť', () => {
    const geometry = geometryOf(pieInput());
    expect(geometry.unknown.ramp).toBeNull();
    const ramps = geometry.slices.filter((slice) => !slice.unknown).map((slice) => slice.ramp);
    expect(new Set(ramps).size).toBe(ramps.length);
    expect(ramps.every((ramp) => ramp !== null && ramp >= 1 && ramp <= 5)).toBe(true);
  });

  it('nad šesť dielov sa zvyšok zlieva do „ostatné" a POVIE, koľko ich je', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      bucket: `b${String(index)}`,
      label: `diel ${String(index)}`,
      count: 10 - index,
    }));
    const geometry = geometryOf(
      pieInput({
        slices: many,
        unknown: { label: UNKNOWN_WORD, count: 46, note: 'nečítané' },
        total: many.reduce((sum, slice) => sum + slice.count, 0) + 46,
      }),
    );
    expect(geometry.slices.length).toBe(MAX_PIE_SLICES);
    const other = geometry.slices.find((slice) => slice.bucket === 'other');
    expect(other?.merged).toBe(5);
    /* Diel „nevieme" sa do „ostatné" NEZLIEVA — je to jediný diel, ktorý
       hovorí o appke, nie o katalógu. */
    expect(geometry.unknown.count).toBe(46);
    expect(geometry.unknown.merged).toBe(0);
    expect(geometry.percentSum).toBe(100);
  });

  it('koláč sa NEKRESLÍ, keď diely nedávajú celok ani keď niet čo deliť', () => {
    expect(pieGeometry(pieInput({ sumMatchesTotal: false }))).toEqual({
      ok: false,
      reason: 'parts_do_not_add_up',
    });
    expect(pieGeometry(pieInput({ total: 0, slices: [], unknown: { label: UNKNOWN_WORD, count: 0, note: 'x' } }))).toEqual({
      ok: false,
      reason: 'nothing_to_split',
    });
  });

  it('výsek je naozaj výsek: zo stredu, oblúkom o polomere koláča, späť', () => {
    const geometry = geometryOf(pieInput());
    const uhly = geometry.slices.map((slice) => slice.degrees);
    expect(Math.round(uhly.reduce((sum, deg) => sum + deg, 0))).toBe(360);
    for (const slice of geometry.slices) {
      if (slice.count === 0) continue;
      expect(slice.path, slice.bucket).toMatch(
        new RegExp(`^M ${String(PIE.cx)} ${String(PIE.cy)} L [-\\d.]+ [-\\d.]+ A ${String(PIE.r)} ${String(PIE.r)} 0 [01] 1 [-\\d.]+ [-\\d.]+ Z$`),
      );
      /* Poradové číslo leží MIMO kruhu — na výseku by mu kontrast kolísal
         s krokom rampy a nikto by to okom neodhalil. */
      const vzdialenost = Math.hypot(slice.labelX - PIE.cx, slice.labelY - PIE.cy);
      expect(vzdialenost).toBeGreaterThan(PIE.r);
      expect(slice.labelX).toBeGreaterThanOrEqual(0);
      expect(slice.labelX).toBeLessThanOrEqual(PIE.size);
      expect(slice.labelY).toBeGreaterThanOrEqual(0);
      expect(slice.labelY).toBeLessThanOrEqual(PIE.size);
    }
  });

  it('jediný diel je celý kruh, nie výsek s neviditeľnou hranou', () => {
    const geometry = geometryOf(
      pieInput({
        slices: [{ bucket: 'a', label: 'všetko', count: 100 }],
        unknown: { label: UNKNOWN_WORD, count: 0, note: 'nič nechýba' },
      }),
    );
    const first = geometry.slices[0];
    expect(first?.full).toBe(true);
    expect(first?.path).toBe('');
    expect(first?.percent).toBe(100);
  });
});

/* ══════════════ C. Dátová tabuľka je doslovný prepis grafu ════════════════ */

describe('koláč — čo je v grafe, je aj v tabuľke', () => {
  const input = pieInput();
  const geometry = geometryOf(input);
  const html = renderToStaticMarkup(
    createElement(SharePie, { input, caption: 'rozdelenie', label: 'koláč' }),
  );

  it('tabuľka má práve toľko riadkov, koľko má koláč dielov', () => {
    const table = html.slice(html.indexOf('<table'));
    // Jedna hlavička + jeden riadok na diel, vrátane dielu „nevieme".
    expect((table.match(/<tr/g) ?? []).length).toBe(geometry.slices.length + 1);
  });

  it('každý diel má v tabuľke SVOJ podiel aj SVOJ počet, nie dopočítaný', () => {
    for (const slice of geometry.slices) {
      expect(html, `diel ${slice.bucket}`).toContain(`${String(slice.order)}. ${slice.label}`);
      expect(html, `podiel ${slice.bucket}`).toContain(piePercentText(slice));
    }
    expect(html).toContain('>60<');
    expect(html).toContain('>10<');
  });

  it('diel „nevieme" je vidieť v koláči, v legende aj v tabuľke', () => {
    expect(html).toContain('data-slice="unknown"');
    expect(html).toContain(UNKNOWN_WORD);
    expect(html).toContain('dni predajov chýbajú');
    expect(html).toContain('data-testid="share-pie-unknown"');
    // Šrafovanie je tá istá značka, akou čiara kreslí nesťahovaný deň.
    expect(html).toContain('url(#pie-hatch');
  });

  it('zablokovaný koláč povie DÔVOD a nenakreslí ani tabuľku', () => {
    const blocked = renderToStaticMarkup(
      createElement(SharePie, {
        input: pieInput({ sumMatchesTotal: false }),
        caption: 'rozdelenie',
        label: 'koláč',
      }),
    );
    expect(blocked).toContain('data-mode="empty"');
    expect(blocked).toContain('data-reason="parts_do_not_add_up"');
    expect(blocked).not.toContain('<table');
  });
});

/* ════════ Odpoveď servera → koláč (rozdelenie katalógu, D126) ════════════ */

describe('rozdelenie katalógu z API', () => {
  const payload: CatalogDistributionResponse = {
    dimension: 'sold',
    scope: 'catalog',
    selectionSize: null,
    total: 41_348,
    slices: [
      { bucket: 'none', count: 120, share: 0.0029 },
      { bucket: 'low', count: 40, share: 0.001 },
      { bucket: 'mid', count: 12, share: 0.0003 },
      { bucket: 'high', count: 4, share: 0.0001 },
    ],
    unknown: { bucket: 'unknown', count: 41_172, share: 0.9957, reason: 'sales_days_missing' },
    sumMatchesTotal: true,
    locked: [{ dimension: 'category', reason: 'no_data_in_schema' }],
    soldWindow: { days: 30, from: '2026-08-02', to: '2026-09-01' },
    enrichedRows: 176,
  };

  it('nečitateľná odpoveď je `null`, nie prázdny koláč', () => {
    expect(readCatalogDistribution(null)).toBeNull();
    expect(readCatalogDistribution({ dimension: 'vymyslene' })).toBeNull();
    expect(readCatalogDistribution({ ...payload, slices: [{ bucket: 1, count: 2 }] })).toBeNull();
    expect(readCatalogDistribution({ ...payload, unknown: undefined })).toBeNull();
  });

  it('vedrá si berú vetu z pravidla pásiem, nevymýšľajú si vlastné slová', () => {
    expect(distributionSliceLabel('sold', 'none', 30)).toBe('0 predaných za 30 dní');
    expect(distributionSliceLabel('sold', 'high', 30)).toBe('10 a viac predaných za 30 dní');
    expect(distributionSliceLabel('shop-discount', 'discounted', 30)).toBe('shop ich má v zľave');
  });

  it('takmer celý katalóg v „nevieme" sa aj tak scíta na 100 %', () => {
    const view = readCatalogDistribution(payload);
    expect(view).not.toBeNull();
    if (view === null) return;
    const geometry = geometryOf(distributionPieInput(view));
    expect(geometry.unknown.count).toBe(41_172);
    expect(geometry.percentSum).toBe(100);
    expect(geometry.unknown.percent).toBeGreaterThan(99);
    expect(distributionPieInput(view).unknown.note).toContain('dni predajov');
  });
});

/* ═══════════════════ D. Stĺpec: porovnanie medzi položkami ════════════════ */

describe('stĺpec — jedna mierka, základňa nula, „nevieme" nie je nula', () => {
  it('mierka je spoločná pre celú skupinu a rastie od nuly', () => {
    const layout = barLayout([
      { bucket: 'a', value: 40 },
      { bucket: 'b', value: 10 },
      { bucket: 'c', value: 1 },
    ]);
    expect(layout.scaleMax).toBe(50);
    expect(layout.bars.map((bar) => bar.widthPercent)).toEqual([80, 20, 2]);
    expect(layout.unknownCount).toBe(0);
  });

  it('MERANÁ nula je nulový stĺpec, `null` je „nevieme" a šrafovaný pahýľ', () => {
    const layout = barLayout([
      { bucket: 'a', value: 10 },
      { bucket: 'b', value: 0 },
      { bucket: 'c', value: null },
    ]);
    expect(layout.unknownCount).toBe(1);
    const measuredZero = layout.bars[1];
    const unknown = layout.bars[2];
    expect(measuredZero?.unknown).toBe(false);
    expect(measuredZero?.widthPercent).toBe(0);
    expect(unknown?.unknown).toBe(true);
    expect(unknown?.widthPercent).toBe(0);

    const html = renderToStaticMarkup(
      createElement(RowBar, { bar: unknown ?? { bucket: 'c', value: null, widthPercent: 0, unknown: true } }),
    );
    expect(html).toContain('data-unknown="ano"');
    // Bez čísla v riadku musí pás prehovoriť sám.
    expect(html).toContain(UNKNOWN_WORD);
  });

  it('meraný stĺpec je pre čítačku skrytý — číslo vedľa neho hovorí to isté', () => {
    const layout = barLayout([{ bucket: 'a', value: 12 }]);
    const bar = layout.bars[0];
    expect(bar).toBeDefined();
    if (bar === undefined) return;
    const html = renderToStaticMarkup(createElement(RowBar, { bar }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
  });
});

/* ═════════════ D. Medzera v čase sa nikdy nekreslí ako nula ═══════════════ */

describe('čiara — nesťahovaný deň nedostane bod ani nulu', () => {
  const TODAY = '2026-08-24';
  const series = [
    { day: '2026-08-18', units: 4 },
    { day: '2026-08-19', units: 6 },
    { day: '2026-08-22', units: 5 },
    { day: '2026-08-23', units: 7 },
  ];

  /*
   * PRESMEROVANÉ VO V6b (2. 9. 2026): graf prešiel na `ChartCard` + Recharts
   * (D135) a jeho plocha sa v teste nekreslí — `ResponsiveContainer` bez
   * rozmerov nevykreslí ani `path`, ani `circle`. Šrafovanie a slovo sa preto
   * merajú tam, kde po prevode žijú: vzor je v `<defs>` vedľa plochy, slovo
   * v legende a v priznaní pod ňou, a POČET bodov je vlastnosť radu — riadok
   * s `null` bod nedostane. Tvrdenie sa nezmenilo, zmenil sa nosič.
   */
  it('graf kreslí šrafovaný pás a slovo zo SPOLOČNÉHO jazyka', () => {
    const geometry = chartGeometry(series, TODAY);
    expect(geometry).not.toBeNull();
    if (geometry === null) return;
    expect(geometry.gaps.length).toBeGreaterThan(0);

    const html = renderToStaticMarkup(
      createElement(SalesChart, { geometry, caption: 'test', label: 'test' }),
    );
    // Vzor „nevieme" je v dokumente a je to TEN ISTÝ vzor ako v koláči.
    expect(html).toContain('id="sales-hatch');
    expect(html).toContain(GAP_WORD);

    const view = salesChartView(geometry);
    // Šrafovaný pás je pás DNÍ, nie ozdoba — a je to tá istá diera, akú
    // priznáva geometria.
    expect(view.underlays.filter((area) => area.kind === 'gap')).toHaveLength(
      geometry.gaps.length,
    );
    expect(view.underlays.some((area) => area.label === GAP_WORD)).toBe(true);
    // Bodov je toľko, koľko je MERANÍ — nie koľko je dní na osi.
    expect(view.points.filter((point) => point.units !== null).length).toBe(
      geometry.points.length,
    );
    expect(view.points.length).toBeGreaterThan(geometry.points.length);
  });

  it('tabuľka pod grafom pomenúva dieru tým istým slovom ako graf', () => {
    const geometry = chartGeometry(series, TODAY);
    expect(geometry).not.toBeNull();
    if (geometry === null) return;
    const rows = tableRows(geometry, TODAY);
    const gapRow = rows.find((row) => row.cells[2]?.startsWith(GAP_WORD));
    expect(gapRow, 'riadok o nesťahovaných dňoch chýba').toBeDefined();
    // V stĺpci kusov je PRÁZDNO, z ktorého `ChartTable` spraví pomlčku.
    expect(gapRow?.cells[1]).toBe('');
    expect(rows.filter((row) => row.cells[1] !== '').length).toBe(geometry.points.length);
  });
});

/* ══════════ Rebríček hovorí jazykom stĺpca a priznáva, koho nemá ══════════ */

describe('top a flop — stĺpce z jednej mierky', () => {
  function row(over: Partial<RankRow> & { productId: number; units: number }): RankRow {
    return {
      reference: `REF-${String(over.productId)}`,
      name: 'Produkt',
      discountedNow: false,
      marginPercent: null,
      qty: null,
      enriched: false,
      ...over,
    };
  }

  const data: TopFlopView = {
    available: true,
    reason: null,
    top: [row({ productId: 1, units: 40 }), row({ productId: 2, units: 20 })],
    flop: [row({ productId: 3, units: 1 })],
    cohortSize: 3,
    unknownDays: 0,
    rankingState: 'measured',
    /* Koho sa rebrík netýka — číslom (D121, 2. 9. 2026). Tento blok meria
       stĺpce a mierku, takže tu tie počty len musia BYŤ; že sa naozaj
       vypisujú, meria `test/unit/prehlad-rebrik.spec.ts`. */
    unknownSales: 41_000,
    measuredZeroSales: 345,
  };

  const html = renderToStaticMarkup(createElement(TopFlopSection, { data, windowDays: 30 }));

  it('každý riadok nesie stĺpec a mierka je spoločná pre top aj flop', () => {
    expect((html.match(/data-testid="row-bar"/g) ?? []).length).toBe(3);
    // scaleMax = 50 (z 40), takže 40 → 80 %, 20 → 40 %, 1 → 2 %.
    expect(html).toContain('width:80%');
    expect(html).toContain('width:40%');
    expect(html).toContain('width:2%');
  });

  it('rozdelenie katalógu sa pri prvom vykreslení netvári ako dáta', () => {
    // `undefined` = ešte sa nenačítalo. Prázdny koláč by tvrdil, že katalóg
    // nemá čo deliť, a to je iná veta.
    expect(html).not.toContain('data-testid="rank-distribution"');
  });
});

/* ═════ Koláč prežije chudobný rebríček — dnešný stav appky (I11) ══════════ */

describe('koláč sa kreslí AJ vtedy, keď rebríček nie je z čoho postaviť', () => {
  /**
   * 100 % katalógu v diele „nevieme" — presne dnešný stav: `orders_read` je
   * neoverený a nie je stiahnutý ani jeden deň predajov (P1 kontraktu V5).
   */
  const NIC_NEVIEME: CatalogDistributionView = {
    dimension: 'sold',
    scope: 'catalog',
    total: 41348,
    slices: [
      { bucket: 'none', count: 0 },
      { bucket: 'low', count: 0 },
      { bucket: 'mid', count: 0 },
      { bucket: 'high', count: 0 },
    ],
    unknown: { count: 41348, reason: 'no_complete_days' },
    sumMatchesTotal: true,
    locked: ['category', 'metal', 'jewelryType'],
    soldWindowDays: 30,
    enrichedRows: 0,
  };

  /*
   * Do 1. 9. 2026 stál koláč až v poslednej vetve `TopFlopSection`, takže sa
   * pri nedostupnom rebríčku nenakreslil VÔBEC — a nedostupný rebríček je
   * dnešný stav. Človek videl jednu vetu a NEVIDEL jediný graf, ktorý mu vie
   * povedať, že o celom katalógu appka predaj nezmerala.
   */
  it('prázdny rebríček nesie vetu s dôvodom AJ koláč rozdelenia', () => {
    const html = renderToStaticMarkup(
      createElement(ThinWithPie, {
        reason: 'za 30 dní nie je dočítaný ani jeden deň predajov.',
        distribution: NIC_NEVIEME,
        windowDays: 30,
      }),
    );
    expect(html).toContain('nie je dočítaný ani jeden deň predajov');
    expect(html).toContain('data-testid="rank-distribution"');
    expect(html).toContain('data-testid="rank-distribution-pie"');
    // Diel „nevieme" je plnohodnotný diel, nie vynechaný zvyšok.
    expect(html).toMatch(/nevieme/i);
    /* K4 — zamknutý rozmer je VIDIEŤ, nie skrytý. Do 1. 9. 2026 klient pole
       `locked` z odpovede zahodil, takže koláč o nemožných rozmeroch mlčal. */
    expect(html).toContain('data-testid="rank-distribution-locked"');
    expect(html).toContain('kategória');
    expect(html).toContain('typ šperku');
  });

  it('nečitateľné rozdelenie NEVYRÁBA prázdny koláč', () => {
    const html = renderToStaticMarkup(
      createElement(ThinWithPie, {
        reason: 'rebríček sa nepodarilo načítať.',
        distribution: null,
        windowDays: 30,
      }),
    );
    expect(html).toContain('data-mode="unreadable"');
    expect(html).not.toContain('data-testid="rank-distribution-pie"');
  });
});

/* ═════════════ Nový modul sa drží tých istých farieb ako ostatné ══════════ */

describe('jazyk grafov nesiaha na vyhradené farby', () => {
  const ZDROJE: ReadonlyArray<[string, string]> = [
    ['chart-language.ts', read('../../src/components/ui/chart-language.ts')],
    ['Charts.tsx', read('../../src/components/ui/Charts.tsx')],
  ];

  for (const [nazov, zdroj] of ZDROJE) {
    const kod = zdroj.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

    it(`${nazov} nekreslí značkovou zlatou ani stavovou škálou`, () => {
      expect(kod).not.toMatch(/var\(\s*--gold/);
      expect(kod).not.toMatch(/var\(\s*--st-/);
    });

    it(`${nazov} nemá ani jednu farbu napísanú ručne`, () => {
      expect(kod.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    });
  }
});
