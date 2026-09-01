/**
 * Aura Zľavy — JEDEN JAZYK GRAFOV (D126, 1. 9. 2026).
 *
 * Do V4 mala appka tri grafy a každý si svoj jazyk vymyslel sám: graf predaja
 * vedel priznať nesťahovaný deň, histogram cien vedel priznať zberný chvost
 * a rebríček nevedel priznať nič, lebo nebol graf. Tri jazyky v jednej
 * prístrojovej doske nie sú štýlový problém — človek si medzi nimi PRENÁŠA
 * návyk. Kto sa raz naučí, že šrafovaná plocha znamená „toto sme nemerali",
 * to isté očakáva aj v koláči; keby tam šrafovanie znamenalo „zvyšok", appka
 * by ho naučila čítať nepravdu.
 *
 * Tento modul je preto SLOVNÍK, nie knižnica grafov. Sú v ňom pravidlá, ktoré
 * musia platiť rovnako pre čiaru, stĺpec aj koláč, a čisté funkcie, ktoré ich
 * vedia spočítať bez prehliadača. Kreslenie je v `Charts.tsx`.
 *
 * ═══ 1. KTORÁ FORMA ODPOVEDÁ NA KTORÚ OTÁZKU (D126) ═══
 *
 *  · **čiara** — vývoj v ČASE (predaje po dňoch, tržba po dňoch),
 *  · **stĺpec** — porovnanie MEDZI POLOŽKAMI (top/flop, pásma),
 *  · **koláč** — ROZDELENIE katalógu alebo výberu (podiel z celku).
 *
 * Zoznam je uzavretý a je to `CHART_KINDS` nižšie — nie veta v komentári,
 * ktorú si nikto neprečíta. Kto pridá štvrtú formu, musí povedať, na akú
 * otázku odpovedá, inak sa graf vyberá podľa toho, ako vyzerá.
 *
 * ═══ 2. JEDNA OS PRE VŠETKY TRI ═══
 *
 * `chartScaleMax()` je jediné pravidlo hornej hranice osi: najbližšie okrúhle
 * číslo (1, 2, 5 × mocnina desiatich) NAD maximom, základňa vždy nula.
 * Useknutá os je pri stĺpci najsilnejšie skreslenie, aké sa dá urobiť —
 * pomer výšok prestane zodpovedať pomeru čísel a nikto si toho nevšimne.
 *
 * POZOR — TÚ ISTÚ FUNKCIU MAJÚ ZATIAĽ TRI MIESTA. `sales-view.niceCeiling()`
 * a `price-bins.niceCount()` sú jej znakovo zhodné kópie z V1. Zliať ich do
 * jednej je úprava dvoch súborov mimo rozsahu tohto sprintu, takže tu zostáva
 * to druhé najlepšie: `test/unit/grafy-jazyk.spec.ts` porovnáva všetky tri na
 * celom rozsahu hodnôt. Keď sa rozídu, spadne test, nie graf.
 *
 * ═══ 3. ZNAČKA „NEVIEME" JE JEDNA A TÁ ISTÁ ═══
 *
 * Nula je MERANÝ fakt, pomlčka je priznanie nevedomosti (I11). Naprieč všetkými
 * formami to nesie ŠRAFOVANIE v `--line2` (`charts.module.css` → `.gapHatch`)
 * plus slovo v legende plus riadok v dátovej tabuľke:
 *
 *  · čiara — nesťahovaný deň dostane šrafovaný pás, nie bod na nule,
 *  · stĺpec — položka bez merania dostane šrafovaný pahýľ, nie nulový stĺpec,
 *  · koláč — diel „nevieme" je DIEL AKO KAŽDÝ INÝ a kreslí sa šrafovaním.
 *
 * Koláč bez toho dielu je najhoršia z troch možností: scíta 100 % z nepravdy.
 * „92 % produktov nie je v zľave" znamená v skutočnosti „92 % produktov appka
 * nikdy nečítala" — a to je iná veta s iným ďalším krokom.
 *
 * ═══ 4. PRAVIDLO TROCH KANÁLOV ═══
 *
 * Farba NIE JE jediný kanál. Každý diel koláča nesie FARBU (krok sekvenčnej
 * rampy), ZNAČKU (poradové číslo na výseku aj v legende; „nevieme" navyše
 * šrafovanie) a SLOVO (názov v legende a v dátovej tabuľke). Pri stĺpci nesie
 * veľkosť dĺžka, číslo pri ňom a poradie v zozname — farba tam nekóduje nič,
 * a preto sú všetky stĺpce rovnaké.
 *
 * Vlastník: V5-GRAFY.
 */
import { tierRuleSentence, type SoldBucketKey } from '@/components/campaigns/discounts-model';

/* ═══════════════════ 1. Formy a otázky, na ktoré odpovedajú ═══════════════ */

export type ChartKind = 'line' | 'bar' | 'pie';

/**
 * D126 ako DÁTA, nie ako veta v komentári. Test to číta a obrazovky si tým
 * popisujú grafy, takže sa pravidlo nedá obísť tichým vybraním inej formy.
 */
export const CHART_KINDS: Readonly<Record<ChartKind, string>> = {
  line: 'vývoj v čase',
  bar: 'porovnanie medzi položkami',
  pie: 'rozdelenie katalógu alebo výberu',
};

/* ══════════════════════════ 2. Jedna os pre všetky ════════════════════════ */

/**
 * Horná hranica osi — najbližšie okrúhle číslo (1, 2, 5 × mocnina desiatich)
 * nad `value`. Základňa je vždy nula; toto je jediné, čo sa hýbe.
 */
export function chartScaleMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

/**
 * `useId()` vracia znaky, ktoré sa v odkaze `url(#…)` čítajú zle. Prefix je
 * povinný — dva grafy na jednej obrazovke nesmú siahnuť na ten istý vzor.
 */
export function chartPatternId(prefix: string, rawId: string): string {
  return `${prefix}-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
}

/* ════════════════════════ 3. Slová, ktoré sa nesmú líšiť ══════════════════ */

/** Šrafovaný pás v čiare: obdobie, ktoré sa nesťahovalo. */
export const GAP_WORD = 'nesťahované';

/** Diel, ktorý appka priznáva ako nevedomosť. Nikdy „ostatné", nikdy nula. */
export const UNKNOWN_WORD = 'nevieme';

/* ═════════════════════════════ 4. Koláč ═══════════════════════════════════ */

/**
 * Súradnice koláča. Štvorec, aby sa výseky nedeformovali na elipsu, a s rezervou
 * okolo kruhu — poradové číslo dielu sa kreslí VEDĽA výseku, nie doň.
 *
 * Číslo v žiadnej podobe nesmie ležať na výseku: rampa má päť krokov od takmer
 * bielej po tmavú tyrkysovú, takže jedna farba textu by na jednom konci rampy
 * kontrast nesplnila a nikto by to neodhalil okom. Vonku má číslo pod sebou
 * papier, teda ten istý kontrast ako každý iný popisok grafu.
 */
export const PIE = { size: 280, cx: 140, cy: 140, r: 96 } as const;

/** Kde leží poradové číslo dielu — tesne za oblúkom, v násobkoch polomeru. */
export const PIE_LABEL_RADIUS = 1.14;

/**
 * Najviac dielov, ktoré koláč nakreslí — VRÁTANE dielu „nevieme". Nad tým sa
 * výseky nedajú rozoznať ani pomenovať. Zvyšok sa zlieva do „ostatné" a koláč
 * povie, koľko položiek v ňom je.
 */
export const MAX_PIE_SLICES = 6;

/** Od akého uhla sa poradové číslo zmestí na výsek. Nižšie len do legendy. */
export const MIN_WEDGE_LABEL_DEGREES = 24;

export interface PieInputSlice {
  /** Symbol dielu (anglicky, z odpovede API). Nie je to text na obrazovke. */
  bucket: string;
  /** Pomenovanie na obrazovke — slovensky. */
  label: string;
  count: number;
}

export interface PieInput {
  slices: readonly PieInputSlice[];
  /** Diel „nevieme". Posiela sa VŽDY, aj keď je nulový (I11). */
  unknown: { label: string; count: number; note: string };
  total: number;
  /**
   * Dávajú diely dokopy celok? `false` = koláč sa NEKRESLÍ. Podiely by boli
   * z iného menovateľa, než ktorý je v odpovedi, a nikto by to nevidel.
   */
  sumMatchesTotal: boolean;
}

export interface PieSlice {
  bucket: string;
  label: string;
  count: number;
  /** Podiel 0–1 z presných počtov — z neho sa počítajú uhly. */
  share: number;
  /**
   * Percentá na jedno desatinné miesto, rozdelené metódou najväčších zvyškov.
   * Súčet cez všetky diely je PRESNE 100 — vrátane dielu „nevieme".
   */
  percent: number;
  /** Nenulový diel, ktorý sa zaokrúhlil na 0,0 % — píše sa „< 0,1 %". */
  tiny: boolean;
  /** Diel „nevieme". Kreslí sa šrafovaním a nikdy sa nezlieva do „ostatné". */
  unknown: boolean;
  /** Krok sekvenčnej rampy 1–5. `null` pri „nevieme" — to nie je veľkosť. */
  ramp: number | null;
  /** Poradové číslo — druhý kanál popri farbe (pravidlo troch kanálov). */
  order: number;
  /** Koľko pôvodných dielov sa sem zlialo. `0` = nezlialo sa nič. */
  merged: number;
  /** Cesta výseku. Prázdna pri nulovom diele aj pri celom kruhu. */
  path: string;
  /** Diel zaberá celý kruh — kreslí sa kružnicou, nie výsekom. */
  full: boolean;
  /** Uhol výseku v stupňoch. Pod `MIN_WEDGE_LABEL_DEGREES` sa naň nepíše. */
  degrees: number;
  labelX: number;
  labelY: number;
}

export interface PieGeometry {
  /** Diely v poradí kreslenia. Diel „nevieme" je VŽDY posledný a VŽDY tu je. */
  slices: readonly PieSlice[];
  unknown: PieSlice;
  total: number;
  /** Súčet percent. Musí byť 100 — inak koláč klame o celku. */
  percentSum: number;
}

/** Prečo sa koláč nekreslí. Vždy dôvod, nikdy prázdny kruh. */
export type PieBlocked = 'nothing_to_split' | 'parts_do_not_add_up';

export type PieResult =
  | { readonly ok: true; readonly geometry: PieGeometry }
  | { readonly ok: false; readonly reason: PieBlocked };

function polar(degrees: number): { x: number; y: number } {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return {
    x: Math.round((PIE.cx + PIE.r * Math.cos(rad)) * 100) / 100,
    y: Math.round((PIE.cy + PIE.r * Math.sin(rad)) * 100) / 100,
  };
}

function wedgePath(from: number, to: number): string {
  const start = polar(from);
  const end = polar(to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${String(PIE.cx)} ${String(PIE.cy)} L ${String(start.x)} ${String(start.y)} A ${String(PIE.r)} ${String(PIE.r)} 0 ${String(large)} 1 ${String(end.x)} ${String(end.y)} Z`;
}

/**
 * Percentá metódou najväčších zvyškov, v desatinách percenta.
 *
 * Obyčajné zaokrúhlenie každého dielu zvlášť dá súčet 99,8 alebo 100,2 % a nič
 * to nenahlási — koláč potom tvrdí celok, ktorý nemá. Tu sa najprv rozdá celá
 * časť a zvyšok dostanú diely s najväčším zvyškom, takže súčet je 1000 desatín,
 * teda presne 100 %.
 */
function largestRemainder(counts: readonly number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);
  const exact = counts.map((count) => (count / total) * 1000);
  const floors = exact.map((value) => Math.floor(value));
  let rest = 1000 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value), count: counts[index] ?? 0 }))
    .sort((a, b) => b.remainder - a.remainder || b.count - a.count || a.index - b.index);
  for (const entry of order) {
    if (rest <= 0) break;
    floors[entry.index] = (floors[entry.index] ?? 0) + 1;
    rest -= 1;
  }
  return floors;
}

/**
 * Diely → geometria koláča.
 *
 * Poradie krokov je zámerné: najprv sa zlejú prebytočné diely (aby percentá
 * a rampa platili pre to, čo sa naozaj nakreslí), potom sa rozdajú percentá
 * a až nakoniec uhly. Diel „nevieme" sa nezlieva NIKDY a je vždy posledný —
 * je to jediný diel, ktorý hovorí o appke, nie o katalógu.
 */
export function pieGeometry(input: PieInput): PieResult {
  if (!input.sumMatchesTotal) return { ok: false, reason: 'parts_do_not_add_up' };
  if (!Number.isFinite(input.total) || input.total <= 0) {
    return { ok: false, reason: 'nothing_to_split' };
  }

  const named = input.slices
    .map((slice) => ({ ...slice, count: Math.max(0, Math.trunc(slice.count)), merged: 0 }))
    .sort((a, b) => b.count - a.count);

  /* Zvyšok do „ostatné" — a povie sa, koľko položiek v ňom je. Diel „nevieme"
     si drží vlastné miesto, takže na pomenované diely zostáva o jedno menej. */
  const maxNamed = MAX_PIE_SLICES - 1;
  const kept =
    named.length <= maxNamed
      ? named
      : [
          ...named.slice(0, maxNamed - 1),
          {
            bucket: 'other',
            label: 'ostatné',
            count: named.slice(maxNamed - 1).reduce((sum, slice) => sum + slice.count, 0),
            merged: named.length - (maxNamed - 1),
          },
        ];

  const unknownCount = Math.max(0, Math.trunc(input.unknown.count));
  const parts = [...kept, { bucket: 'unknown', label: input.unknown.label, count: unknownCount, merged: 0 }];
  const percents = largestRemainder(
    parts.map((part) => part.count),
    input.total,
  );

  let acc = 0;
  const slices: PieSlice[] = parts.map((part, index) => {
    const from = (acc / input.total) * 360;
    acc += part.count;
    const to = (acc / input.total) * 360;
    const degrees = to - from;
    const mid = (from + to) / 2;
    const rad = ((mid - 90) * Math.PI) / 180;
    const isUnknown = index === parts.length - 1;
    const percentTenths = percents[index] ?? 0;
    return {
      bucket: part.bucket,
      label: part.label,
      count: part.count,
      share: part.count / input.total,
      percent: percentTenths / 10,
      tiny: part.count > 0 && percentTenths === 0,
      unknown: isUnknown,
      /* Rampa kóduje veľkosť, a „nevieme" veľkosť NIE JE — dostane šrafovanie.
         Najväčší diel berie najtmavší krok, aby sa poradie dalo čítať aj bez
         legendy. */
      ramp: isUnknown ? null : Math.max(1, 5 - index),
      order: index + 1,
      merged: part.merged,
      path: part.count <= 0 || degrees >= 360 ? '' : wedgePath(from, to),
      full: degrees >= 360,
      degrees,
      labelX: Math.round((PIE.cx + PIE.r * PIE_LABEL_RADIUS * Math.cos(rad)) * 100) / 100,
      labelY: Math.round((PIE.cy + PIE.r * PIE_LABEL_RADIUS * Math.sin(rad)) * 100) / 100,
    };
  });

  const unknown = slices[slices.length - 1];
  if (unknown === undefined) return { ok: false, reason: 'nothing_to_split' };

  return {
    ok: true,
    geometry: {
      slices,
      unknown,
      total: input.total,
      percentSum: Math.round(slices.reduce((sum, slice) => sum + slice.percent, 0) * 10) / 10,
    },
  };
}

/** Percento dielu ako text. Nenulový diel sa NIKDY nenapíše ako „0,0 %". */
export function piePercentText(slice: Pick<PieSlice, 'percent' | 'tiny'>): string {
  if (slice.tiny) return '< 0,1 %';
  return `${slice.percent.toFixed(1).replace('.', ',')} %`;
}

/* ═════════════════════════════ 5. Stĺpec ══════════════════════════════════ */

export interface BarInput {
  key: string;
  /** `null` = nemerané. NIE nula — nula je odpoveď, `null` je jej absencia. */
  value: number | null;
}

export interface Bar {
  key: string;
  value: number | null;
  /** Šírka v percentách rámu. Pri „nevieme" je nula a kreslí sa šrafovaný pahýľ. */
  widthPercent: number;
  unknown: boolean;
}

export interface BarLayout {
  bars: readonly Bar[];
  /** Horná hranica osi. Rovnaká pre všetky stĺpce, inak sa nedajú porovnať. */
  scaleMax: number;
  /** Koľko položiek nemá meranie. Legenda to musí povedať slovom. */
  unknownCount: number;
}

/**
 * Položky → šírky stĺpcov.
 *
 * Jedna mierka pre celú skupinu (`scaleMax` z najväčšej hodnoty), základňa
 * nula. Kto by dal každému stĺpcu vlastnú mierku, urobí z porovnania ozdobu.
 */
export function barLayout(items: readonly BarInput[]): BarLayout {
  const measured = items.flatMap((item) => (item.value === null ? [] : [item.value]));
  const scaleMax = chartScaleMax(measured.length === 0 ? 0 : Math.max(...measured));
  return {
    scaleMax,
    unknownCount: items.length - measured.length,
    bars: items.map((item) => ({
      key: item.key,
      value: item.value,
      widthPercent:
        item.value === null ? 0 : Math.round((Math.max(0, item.value) / scaleMax) * 1000) / 10,
      unknown: item.value === null,
    })),
  };
}

/* ═══════════ 6. Rozdelenie katalógu z API → vstup koláča ══════════════════ */

/**
 * Rozmery, ktoré `GET /api/insights/catalog-distribution` vie naplniť. Zoznam
 * je uzavretý a zhoduje sa s `DISTRIBUTION_DIMENSIONS` v route (K4).
 */
export const DISTRIBUTION_DIMENSIONS = ['sold', 'shop-discount', 'own-discount'] as const;

export type DistributionDimension = (typeof DISTRIBUTION_DIMENSIONS)[number];

export interface CatalogDistributionView {
  dimension: DistributionDimension;
  scope: 'catalog' | 'selection';
  total: number;
  slices: ReadonlyArray<{ bucket: string; count: number }>;
  unknown: { count: number; reason: string };
  sumMatchesTotal: boolean;
  /**
   * Rozmery, podľa ktorých sa katalóg rozdeliť NEDÁ (K4).
   *
   * Do 1. 9. 2026 toto pole klient ZAHADZOVAL, hoci ho routa posiela a jej
   * vlastný komentár hovorí, čo s ním má UI robiť: „UI ich ukáže zamknuté, nie
   * skryté". Koláč teda ukázal rozdelenie podľa predajnosti a o tom, že
   * kategóriu, kov ani typ šperku appka rozdeliť nevie, nepovedal ani slovo —
   * človek si myslel, že viac rozmerov appka neponúka.
   */
  locked: readonly string[];
  soldWindowDays: number;
  enrichedRows: number;
}

/**
 * Odpoveď servera → pohľad obrazovky. Nečitateľná odpoveď je `null`, nie
 * prázdny koláč: „nedá sa prečítať" a „katalóg je prázdny" sú dve rôzne veci.
 */
export function readCatalogDistribution(body: unknown): CatalogDistributionView | null {
  if (body === null || typeof body !== 'object') return null;
  const row = body as Record<string, unknown>;

  const dimension = DISTRIBUTION_DIMENSIONS.find((known) => known === row.dimension);
  if (dimension === undefined) return null;
  if (typeof row.total !== 'number' || !Number.isFinite(row.total)) return null;
  if (typeof row.sumMatchesTotal !== 'boolean') return null;
  if (!Array.isArray(row.slices)) return null;

  const slices: Array<{ bucket: string; count: number }> = [];
  for (const entry of row.slices) {
    if (entry === null || typeof entry !== 'object') return null;
    const slice = entry as Record<string, unknown>;
    if (typeof slice.bucket !== 'string') return null;
    if (typeof slice.count !== 'number' || !Number.isFinite(slice.count)) return null;
    slices.push({ bucket: slice.bucket, count: slice.count });
  }

  const rawUnknown = row.unknown;
  if (rawUnknown === null || typeof rawUnknown !== 'object') return null;
  const unknown = rawUnknown as Record<string, unknown>;
  if (typeof unknown.count !== 'number' || !Number.isFinite(unknown.count)) return null;

  const soldWindow = row.soldWindow;
  const days =
    soldWindow !== null &&
    typeof soldWindow === 'object' &&
    typeof (soldWindow as Record<string, unknown>).days === 'number'
      ? (soldWindow as { days: number }).days
      : 30;

  return {
    dimension,
    scope: row.scope === 'selection' ? 'selection' : 'catalog',
    total: row.total,
    slices,
    unknown: {
      count: unknown.count,
      reason: typeof unknown.reason === 'string' ? unknown.reason : 'not_enriched',
    },
    sumMatchesTotal: row.sumMatchesTotal,
    /* Nečitateľná položka sa ZAHODÍ, nie dosadí: zámok s vymysleným menom by
       tvrdil o rozmere niečo, čo odpoveď nepovedala. */
    locked: Array.isArray(row.locked)
      ? row.locked
          .map((entry) =>
            entry !== null && typeof entry === 'object'
              ? (entry as Record<string, unknown>).dimension
              : null,
          )
          .filter((dimension): dimension is string => typeof dimension === 'string')
      : [],
    soldWindowDays: days,
    enrichedRows:
      typeof row.enrichedRows === 'number' && Number.isFinite(row.enrichedRows)
        ? row.enrichedRows
        : 0,
  };
}

const SOLD_BUCKETS: readonly SoldBucketKey[] = ['none', 'low', 'mid', 'high'];

/**
 * Pomenovanie dielu na obrazovke.
 *
 * Vedrá predajnosti si NEVYMÝŠĽAJÚ vlastné slová — berú si vetu z
 * `tierRuleSentence()`, teda z toho istého miesta, podľa ktorého sa počítajú
 * pásma zľavy. Keby mal koláč vlastný text, ukazoval by pravidlo, ktoré sa
 * pri zľave neuplatní.
 */
export function distributionSliceLabel(
  dimension: DistributionDimension,
  bucket: string,
  windowDays: number,
): string {
  if (dimension === 'sold') {
    const known = SOLD_BUCKETS.find((key) => key === bucket);
    return known === undefined ? bucket : tierRuleSentence(known, windowDays);
  }
  if (dimension === 'shop-discount') {
    if (bucket === 'discounted') return 'shop ich má v zľave';
    if (bucket === 'not_discounted') return 'shop ich v zľave nemá';
    return bucket;
  }
  if (bucket === 'active_now') return 'naša zľava beží teraz';
  if (bucket === 'discounted_before') return 'našu zľavu už mali';
  if (bucket === 'never') return 'nikdy sme ich nezlacnili';
  return bucket;
}

/**
 * Prečo diel „nevieme" existuje — vetou, nie kódom. Bez nej je šrafovaný výsek
 * len zvláštna farba; s ňou je to konkrétny ďalší krok (obohatiť, dosťahovať).
 */
export function distributionUnknownNote(reason: string, windowDays: number): string {
  if (reason === 'sales_days_missing') {
    return `dni predajov za ${String(windowDays)} dní appke chýbajú, takže vedro nevie určiť`;
  }
  if (reason === 'not_enriched') return 'produkt sme z eshopu ešte nečítali, o zľave shopu nevieme nič';
  return 'o tomto rozmere vieme všetko z vlastných zápisov';
}

/** Čo koláč vlastne delí — do popisu nad rámom. */
export function distributionCaption(view: CatalogDistributionView): string {
  const scope = view.scope === 'selection' ? 'vybrané produkty' : 'miestna kópia katalógu';
  if (view.dimension === 'sold') {
    return `${scope} podľa predaja za ${String(view.soldWindowDays)} dní`;
  }
  if (view.dimension === 'shop-discount') return `${scope} podľa zľavy v shope`;
  return `${scope} podľa našich zliav`;
}

/** Pohľad → vstup koláča. Diel „nevieme" sa dopĺňa vždy, aj keď je nulový. */
export function distributionPieInput(view: CatalogDistributionView): PieInput {
  return {
    slices: view.slices.map((slice) => ({
      bucket: slice.bucket,
      label: distributionSliceLabel(view.dimension, slice.bucket, view.soldWindowDays),
      count: slice.count,
    })),
    unknown: {
      label: UNKNOWN_WORD,
      count: view.unknown.count,
      note: distributionUnknownNote(view.unknown.reason, view.soldWindowDays),
    },
    total: view.total,
    sumMatchesTotal: view.sumMatchesTotal,
  };
}
