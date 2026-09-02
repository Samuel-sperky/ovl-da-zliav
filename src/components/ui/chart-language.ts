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
 * vedia spočítať bez prehliadača. Kreslenie je v `Charts.tsx` (inline SVG)
 * a v `charts/ChartCard.tsx` (Recharts).
 *
 * ROZŠÍRENIE V6a (D135, D142, 2. 9. 2026): Recharts prišiel s vlastnou sadou
 * pojmov — paleta ako reťazce, `connectNulls`, `ResponsiveContainer`. Sekcie 7
 * a 8 nižšie ich vťahujú DO TOHTO slovníka, namiesto aby vedľa neho vznikol
 * druhý (`useChartTheme` z `aura-roadmap` mal vlastný `lib/chartTheme.ts`;
 * tu by to bol presne ten „druhý, takmer rovnaký" modul, ktorý si tento repo
 * zakázal v `primitives.module.css`). Vstupný bod pre komponenty je
 * `charts/useChartTheme.ts` a je to tenká obálka nad `chartTheme()` odtiaľto —
 * nie druhá paleta. Tento súbor zostáva bez prehliadača a bez Rechartsu: sú
 * v ňom mená tokenov a pravidlá, nie farby a nie kreslenie.
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
 * HISTOGRAM NIE JE ŠTVRTÁ FORMA — je to STĹPEC (V6b, 2. 9. 2026)
 * ─────────────────────────────────────────────────────────────
 * Rozdelenie cien (`charts/PriceHistogram.tsx`) je rozdelenie SPOJITEJ
 * veličiny, takže sa na prvé prečítanie hlási ku koláču. Nie je to tak a
 * `CHART_KINDS` sa preto NEROZŠIRUJE: len čo sú ceny nakrájané na pomenované
 * pásma, sú tie pásma POLOŽKY a otázka „v ktorom pásme je viac produktov" je
 * porovnanie medzi položkami. Koláč to uniesť nevie ani technicky —
 * `MAX_PIE_SLICES` je šesť, pásiem je dvadsaťjeden, a kruh nemá os, na ktorej
 * by cena zostala usporiadaná. Celý rozbor je v hlavičke `PriceHistogram.tsx`;
 * tu je zapísaný preto, aby si ho ďalší graf nemusel vymyslieť znova.
 *
 * Presne takto sa časová os Zliav NEstala grafom: okno platnosti nemeria
 * veličinu, ale interval, a to nie je ani jedna z troch foriem — zostala
 * tabuľkou. Kto siahne na `CHART_KINDS`, musí to pomenovať ako rozhodnutie.
 *
 * ═══ 2. JEDNA OS PRE VŠETKY TRI ═══
 *
 * `chartScaleMax()` je jediné pravidlo hornej hranice osi: najbližšie okrúhle
 * číslo (1, 2, 5 × mocnina desiatich) NAD maximom, základňa vždy nula.
 * Useknutá os je pri stĺpci najsilnejšie skreslenie, aké sa dá urobiť —
 * pomer výšok prestane zodpovedať pomeru čísel a nikto si toho nevšimne.
 *
 * TRI KÓPIE SÚ ZLÚČENÉ NA JEDNU (V6b, 2. 9. 2026). Do tohto sprintu žilo to
 * isté pravidlo na TROCH miestach: `chartScaleMax()` tu, `niceCeiling()`
 * v `dashboard/sales-view.ts` a `niceCount()` v `charts/price-bins.ts` — tri
 * znakovo zhodné telá. Kontrakt V6a §9 hlásil pod K5 „zlúčené", ale zlúčené
 * neboli; zostal len test, ktorý ich porovnával. Teraz je telo JEDNO a oba
 * ostatné moduly ho importujú.
 *
 * Čo zlúčenie stráži namiesto starého porovnávania (obe v `grafy-jazyk.spec.ts`):
 *  · hodnoty `chartScaleMax()` sú pribité na VLASTNÚ tabuľku očakávaní, nie na
 *    druhú implementáciu — klon a jeho test sa vedeli pokaziť spolu,
 *  · statická závora prehľadá `src/` a nájde nanajvýš JEDNO telo rebríka
 *    `[1, 2, 5, 10]`. Kto si napíše štvrtú kópiu, spadne na nej.
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
 * ŠRAFOVANIE NESMIE ZNAMENAŤ NIČ INÉ — a raz už znamenalo (V6b, 2. 9. 2026).
 * Histogram cien kreslil ZBERNÉ PÁSMO („200 € a viac") tým istým vzorom.
 * Vyzeralo to ako vlastná farba, lebo `<pattern>` mal napísané
 * `stroke="var(--seq-teal-3)"` — ale trieda `.gapHatch` je v CSS a CSS
 * prebíja prezentačný atribút, takže sa kreslilo `--line2`, teda ZNAK
 * „nemerali sme" nad 180 poctivo zmeranými produktmi. Ten atribút bol mŕtvy
 * a test naň mal tvrdenie, takže o rozchode nepovedal nič.
 *
 * ZHRNUTÝ CHVOST JE DOLNÁ HRANICA, NIE NEVEDOMOSŤ. Má preto značku dolnej
 * hranice — PRERUŠOVANÝ tvar (`ChartLegendEntry.open`, `.barOpen`) a `≥`
 * v texte — presne ako nedočítaný deň (`.dotEstimate`). Kto sa chystá
 * šrafovať čokoľvek, čo appka NAMERALA, hľadá túto značku.
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
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

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

/**
 * Jeden stĺpec na vstupe.
 *
 * POLE SA MENUJE `bucket` A **NIKDY** `key` — NEPREMENOVÁVAJ HO SPÄŤ
 * ----------------------------------------------------------------
 * Je to to isté pravidlo a ten istý dôvod ako pri koláči, ktorý ho už raz
 * porušil (rozbor je v `app/api/insights/catalog-distribution/route.ts`,
 * sekcia 3): centrálny redaktor (`lib/log/redact.ts`, invariant I1) má `key`
 * v `DENY_EXACT` a maskuje HODNOTU každého poľa s tým menom v ľubovoľnej
 * hĺbke vnorenia. Kým sa diel koláča volal `key`, vracal sa
 * `{ key: '***REDACTED***', count: 3 }` — symbol zmizol, počty zostali a graf
 * sa dal nakresliť s tromi rovnako pomenovanými dielmi.
 *
 * Stĺpec dnes cez redaktor NECHODÍ (je to klientská mierka, nie odpoveď
 * route). To ale nie je dôvod čakať, kým to niekto naloguje alebo pošle:
 * jedno meno pre „symbol položky" naprieč všetkými tromi formami je lacnejšie
 * než rozhodovať pri každom novom grafe, na ktorej strane hranice stojí.
 * Redaktor sa NESMIE oslabiť ani obísť výnimkou — robil presne to, čo má.
 *
 * `BarListItem.key` v `ui/BarList.tsx` je iná vec a menuje sa inak zámerne:
 * je to React `key` riadku zoznamu, nie pole v dátach grafu.
 */
export interface BarInput {
  /** Symbol položky. Musí byť v skupine jedinečný — nesie ho aj mierka. */
  bucket: string;
  /** `null` = nemerané. NIE nula — nula je odpoveď, `null` je jej absencia. */
  value: number | null;
}

export interface Bar {
  bucket: string;
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
      bucket: item.bucket,
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

/* ═══════════ 7. PALETA GRAFU — MENÁ TOKENOV, NIE FARBY (D135) ═════════════ */

/**
 * Recharts kreslí z JavaScriptu, takže farbu chce ako REŤAZEC. To vyzerá ako
 * dôvod napísať paletu do konštanty — a je to pasca: napísaný odtieň zostane
 * v druhej téme ten istý a nikto to neodhalí okom pri jednom nastavení
 * systému. Presne preto tento súbor stráži `grafy-jazyk.spec.ts` vetou „nemá
 * ani jednu farbu napísanú ručne".
 *
 * ODPOVEĎ NIE JE ČÍTAŤ CSS ZA BEHU, ALE PODAŤ `var()`.
 *
 * `aura-roadmap` má `lib/chartTheme.ts`, ktorý za behu volá `getComputedStyle`
 * a drží zoznam svetlých hexov ako zálohu pre beh bez DOM. Tu to netreba a bolo
 * by to horšie: prehliadač doriešuje `var()` aj v prezentačných atribútoch SVG
 * a táto appka sa na to už spolieha — `Charts.tsx` kreslí výseky koláča
 * hodnotou `var(--seq-teal-3)` v atribúte `fill` a funguje to v oboch témach.
 * Recharts stavia tie isté atribúty na tie isté prvky, takže mu stačí to isté.
 *
 * Čo sa tým získalo:
 *  · **nula napísaných farieb** — ani zálohy, ktorá by sa mohla rozísť
 *    s tokenovou vrstvou (a rozišla by sa tichučko, v jednej téme),
 *  · prepnutie témy prekreslí graf BEZ JavaScriptu, teda aj počas prvého
 *    renderu a aj keď efekt nikdy nebeží (server render),
 *  · inline SVG z V1 a Recharts z V6a berú farbu tým istým spôsobom — je to
 *    jeden jazyk aj na úrovni farieb, nie dva.
 *
 * Kedy by sa to muselo zmeniť: keby graf potreboval farbu ako HODNOTU v JS
 * (počítať kontrast, kresliť do canvasu, poslať ju do knižnice, ktorá CSS
 * nevidí). Vtedy pribudne čitateľ tokenov TU, na jednom mieste, a nie
 * v komponente.
 *
 * ZLATÁ TU NIE JE a nie je to nedopatrenie. Trendovú čiaru kreslí `globals.css`
 * pravidlom `.line.trend` (odstup od série je zmeraný naprieč typmi videnia
 * v `grafy-paleta.spec.ts`), takže rad Rechartsu dostane triedu, nie farbu.
 * Stavová mierka v grafe nemá čo robiť vôbec: rad zafarbený „na zle" by povedal
 * hodnotenie, ktoré nikto nezmeral.
 */

/** Osem kategorických radov v poradí kreslenia. Deviaty sa už nedá odlíšiť. */
export const CHART_SERIES_VARS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-7',
  '--chart-8',
] as const;

export type ChartSeriesVar = (typeof CHART_SERIES_VARS)[number];

/**
 * Kroky sekvenčnej rampy. Kódujú VEĽKOSŤ, nie kategóriu — preto sú mimo
 * `CHART_SERIES_VARS` a preto sa po stĺpcoch jednej série NEROZVÍJAJÚ
 * (`charts.module.css` → `.bar`).
 */
export const CHART_RAMP_VARS = [
  '--seq-teal-1',
  '--seq-teal-2',
  '--seq-teal-3',
  '--seq-teal-4',
  '--seq-teal-5',
] as const;

/**
 * Meno tokenu → hodnota, ktorú prehliadač doriešuje sám.
 *
 * Jediné miesto, kde sa v grafoch skladá `var(…)`. Keby si to skladal každý
 * komponent, prvý preklep v mene tokenu by nakreslil rad bez farby a nikde by
 * nič nespadlo — `var(--chart-9)` je platný CSS, len neexistuje.
 */
export function chartVar(name: string): string {
  return `var(${name})`;
}

/**
 * Paleta jedného grafu — roly, nie farby.
 *
 * Nie sú tu `success`, `warn` ani `danger`, ktoré má `aura-roadmap`: v tejto
 * appke je stav vec tokenov `--st-*` a troch kanálov, nie vec grafu. Nie je tu
 * ani trend — pozri poslednú vetu hlavičky sekcie.
 */
export interface ChartTheme {
  /** Osem kategorických radov v poradí kreslenia. */
  series: readonly string[];
  /** Päť krokov rampy — magnitúda, nie kategória. */
  ramp: readonly string[];
  /** Mriežka. Musí ustúpiť dátam; meria to `grafy-paleta.spec.ts`. */
  grid: string;
  /** Os a jej popisky. */
  axis: string;
  /** Text v ploche grafu — priamy popisok, číslo pri bode. */
  ink: string;
  /** Bublina s hodnotou: plocha, písmo, okraj. */
  tooltipBg: string;
  tooltipInk: string;
  tooltipBorder: string;
  /** Šrafovanie „nevieme" — silnejšie než mriežka, slabšie než dáta. */
  gap: string;
  /** Jediný rad, keď je rad jeden. */
  accent: string;
}

/**
 * Paleta grafu. Je to ČISTÁ funkcia bez DOM: to isté na serveri aj v klientovi,
 * v tmavej aj vo svetlej téme — rozdiel dorieši prehliadač z tokenovej vrstvy.
 *
 * Že každý token nižšie v `globals.css` naozaj EXISTUJE a je definovaný pre obe
 * témy, overuje `test/unit/grafy-chartcard.spec.ts`. To je tá kontrola, ktorú
 * by inak musela robiť záloha s hexmi — len bez rizika, že sa rozíde.
 */
export function chartTheme(): ChartTheme {
  return {
    series: CHART_SERIES_VARS.map((name) => chartVar(name)),
    ramp: CHART_RAMP_VARS.map((name) => chartVar(name)),
    grid: chartVar('--line'),
    axis: chartVar('--dim'),
    ink: chartVar('--ink'),
    tooltipBg: chartVar('--paper2'),
    tooltipInk: chartVar('--ink'),
    tooltipBorder: chartVar('--line2'),
    gap: chartVar('--line2'),
    accent: chartVar('--accent'),
  };
}

/** Farba radu `index`, po ôsmom sa vracia na začiatok. */
export function seriesColor(index: number): string {
  const count = CHART_SERIES_VARS.length;
  const i = ((Math.trunc(index) % count) + count) % count;
  return chartVar(CHART_SERIES_VARS[i] as ChartSeriesVar);
}

/**
 * Výplň pod čiarou je TÓN farby radu, nikdy plná farba: plocha sa číta ako
 * hodnota a dve plné plochy nad sebou vyrobia tretiu, ktorá nič neznamená.
 * `color-mix()` je jediný povolený spôsob tónovania (D147); `rgba()` by tu bola
 * porušením aj vtedy, keby vyšla rovnako.
 */
export function areaFill(color: string, percent = 14): string {
  return `color-mix(in srgb, ${color} ${String(percent)}%, transparent)`;
}

/** Popisky osi majú naprieč appkou jednu veľkosť, inak grafy nečítať ako rodinu. */
export const AXIS_TICK = { fontSize: 11 } as const;
/* ══════ 8. TROJSTAVOVÝ RIADOK: hodnota · nula · nevieme (I11, K6) ═════════ */

/**
 * Toto je jadro I11 preložené do jazyka Rechartsu.
 *
 * Nula je MERANÝ fakt a kreslí sa. `null` je priznanie nevedomosti a NEKRESLÍ
 * sa — Recharts pri `connectNulls: false` líniu na takom riadku pretne a vznikne
 * medzera. Kto `null` po ceste z API do grafu nahradí nulou, spraví z výpadku
 * sťahovania prepad predaja a bude to vyzerať dôveryhodne. Presne to sa už raz
 * stalo (D121: server posielal `unitsSold: 0` namiesto `null`, klientský model
 * bol správny a dostal nepravdivý vstup) a nenašlo to 3756 testov, ale preklik.
 *
 * Preto je `chartValue()` STRIKTNÁ: meranie je len konečné číslo. `undefined`,
 * `NaN`, `'0'` ani `null` meraním nie sú a všetky štyri končia ako medzera.
 */
export function chartValue(raw: unknown): number | null {
  if (typeof raw !== 'number') return null;
  if (!Number.isFinite(raw)) return null;
  return raw;
}

export interface ChartRowInput {
  /** Popis na osi — hotový text, nie surový symbol z API. */
  label: string;
  /** Čokoľvek z odpovede. Meraním sa stane len konečné číslo. */
  value: unknown;
  /** Číslo je DOLNÁ HRANICA (nedočítané obdobie) — v prepise dostane `≥`. */
  lowerBound?: boolean;
}

export interface ChartRow {
  label: string;
  /** Meranie, alebo `null` = medzera. Nula je meranie. */
  value: number | null;
  lowerBound: boolean;
}

/**
 * Odpoveď → riadky pre Recharts.
 *
 * Riadok sa NIKDY nevynecháva: vynechaný deň by os stiahla a graf by tvrdil, že
 * medzi 6. a 22. augustom nie je čo ukázať. Riadok s `null` je opak — medzera,
 * ktorú je VIDIEŤ.
 *
 * `lowerBound` na medzere je nezmysel (nie je čo ohraničovať), takže ho tu
 * zámerne strácame — inak by prepis pod grafom napísal `≥ —`.
 */
export function chartRows(items: readonly ChartRowInput[]): ChartRow[] {
  return items.map((item) => {
    const value = chartValue(item.value);
    return { label: item.label, value, lowerBound: value !== null && item.lowerBound === true };
  });
}

/**
 * Props, ktoré MUSÍ dostať každý rad Rechartsu (`<Line>`, `<Area>`, `<Bar>`).
 *
 * `connectNulls` je názov z Rechartsu, pravidlo je naše: `true` by cez medzeru
 * natiahlo spojnicu a z priznania „toto sme nemerali" by spravilo tvrdenie
 * „medzi týmito dvoma dňami to šlo takto". Recharts má dnes `false` aj ako
 * predvolenú hodnotu; napísané je to tu preto, že predvolená hodnota cudzej
 * knižnice nie je náš invariant a pri veľkej verzii sa môže zmeniť bez slova.
 */
export const GAP_SERIES_PROPS = { connectNulls: false } as const;

/** Koľko riadkov je priznanie, nie meranie. Legenda to musí povedať slovom. */
export function gapRowCount(rows: readonly ChartRow[]): number {
  return rows.reduce((sum, row) => (row.value === null ? sum + 1 : sum), 0);
}

/**
 * Veta o medzerách pod graf. Bez nej je šrafovaná plocha len zvláštna farba;
 * s ňou je to konkrétny ďalší krok. Keď nie je čo priznať, funkcia MLČÍ —
 * „0 nesťahovaných bodov" je hluk, nie priznanie.
 */
export function gapLegendSentence(rows: readonly ChartRow[]): string | null {
  const count = gapRowCount(rows);
  if (count === 0) return null;
  const unit = pluralSk(count, 'bod', 'body', 'bodov');
  return `${formatCountSk(count)} ${unit} grafu je ${GAP_WORD} — kreslí sa medzera, nie nula.`;
}

/**
 * Hodnota riadku ako text do prepisu grafu.
 *
 * Tri stavy, tri tvary: pomlčka U+2014 pri medzere, `≥ N` pri dolnej hranici,
 * samotné číslo pri meraní. Pomlčka sa NIKDY nesmie stať nulou a `≥` sa nikdy
 * nesmie stratiť — obe sú priznania (I11), nie formátovanie.
 */
export function chartRowText(row: ChartRow, format: (value: number) => string): string {
  if (row.value === null) return '—';
  const text = format(row.value);
  return row.lowerBound ? `≥ ${text}` : text;
}
