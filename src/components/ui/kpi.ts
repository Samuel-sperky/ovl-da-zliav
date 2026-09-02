/**
 * Aura Zľavy — ČISTÁ LOGIKA KPI SKUPINY (`StatTile`, `DeltaPill`, `BarList`).
 *
 * Skupina je z V6a (D133) a vznikla ZLÚČENÍM, nie portom (D142): `aura-roadmap`
 * má `StatCard`, tento repo má `StatTile`, a druhá takmer rovnaká dlaždica by sa
 * o mesiac rozišla s prvou. Preto tu nie je ani jeden riadok, ktorý by opisoval
 * niečo, čo repo už má — smer zmeny sa BERIE z `ui/primitives.ts` a pomlčka
 * z `lib/ui/product-label.ts`.
 *
 * Prečo vôbec `.ts` vedľa `.tsx`: to isté delenie ako `ui/primitives.ts`. Prah,
 * zaokrúhlenie a rozhodnutie „toto je priznanie, nie hodnota" sú presne tie
 * veci, ktoré sa pri prepisovaní obrazoviek tichučko pokazia, a tu sa dajú
 * merať bez vykresľovania.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Číslo má TRI stavy, nie dva** (I11). Hodnota · pomlčka „nevieme" ·
 *    dolná hranica so znakom `≥`. Nula je TVRDENIE a smie stáť len tam, kde sa
 *    naozaj zmerala; `null` nie je nula a nikdy sa ňou nesmie stať.
 *
 * 2. **`≥ 0` sa nevykreslí nikdy.** Dolná hranica nula nie je priznanie, ale
 *    prázdna veta („predalo sa aspoň nič"). Pri dnešnom pokrytí okna by ju
 *    appka napísala takmer na každý riadok. Tá istá závora stojí v
 *    `lib/ui/product-columns.ts` (`soldWindowCell`) a `kpi-skupina.spec.ts`
 *    porovnáva OBA moduly, aby sa nerozišli.
 *
 * 3. **Smer má ŠTVRTÝ stav: „zmenu nevieme".** `TrendDirection` z
 *    `ui/primitives.ts` pozná tri (`up`/`down`/`flat`) a štvrtý sa doň nedá
 *    vtesnať — preto `DeltaState`. Bez neho by pilulka musela neznámu zmenu
 *    vykresliť ako `flat`, teda ako **zmerané „bez zmeny"**, čo je presne to
 *    tvrdenie, ktoré appka o nezmeranom čísle robiť nesmie. Slová a značky
 *    troch známych stavov sú ODVODENÉ z `TREND_WORD` / `TREND_ICON`, nie
 *    prepísané: jeden slovník smeru, jedno miesto.
 *
 * 4. **Nekonečno a NaN sú „nevieme", nie „bez zmeny".** `aura-roadmap` mapoval
 *    v `deltaDirection()` každé nefinitné číslo na `flat`; tu je to `unknown`.
 *    Rozdiel nie je akademický: `NaN` z pokazeného menovateľa by inak dostal
 *    slovo „bez zmeny" a vedľa neho text „NaN".
 *
 * 5. **Smer sa určuje z ČÍSLA, KTORÉ JE VIDIEŤ.** Najprv sa zaokrúhli na
 *    zobrazený počet desatinných miest, až potom sa pýtame na smer — inak
 *    pilulka pri `+0,4 %` a nule desatinných miest napíše „nárast +0“.
 *    Je to tá istá zásada ako bod 4 v `ui/primitives.ts`: šírka aj text musia
 *    vychádzať z tej istej dvojice čísel.
 *
 * 6. **Rast sám osebe nie je dobrá správa.** Preto sa tón NEODVODZUJE zo smeru:
 *    predvolený zmysel je `neutral` a pilulka vtedy NEFARBÍ. `aura-roadmap` mal
 *    na to `invert?: boolean`, ktorý vie povedať len „obráť to" — nevie povedať
 *    „nehodnoť to", a práve to je predvolený stav tejto appky
 *    (pozri hlavičku `ui/StatTile.tsx` z 19. 8. 2026).
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V6a, KPI skupina.
 */
import type { ReactNode } from 'react';

import type { IconName } from '@/components/ui/Icon';
import {
  TREND_ICON,
  TREND_WORD,
  trendTone,
  type TrendMeaning,
} from '@/components/ui/primitives';
import type { StatusTone } from '@/components/ui/ToneBadge';
import { UNKNOWN_WORD, barLayout, type Bar, type BarInput } from '@/components/ui/chart-language';
import { NEVIEME } from '@/lib/ui/product-label';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════ 0. Je tu vôbec čo vykresliť ══════════════════════ */

/**
 * `null`, `undefined`, `false` a prázdny reťazec sú „nič".
 *
 * Z podmienky `cond && <x/>` chodí `false` a prázdny riadok dlaždice by
 * v mriežke `.kpis` zdvihol výšku CELÉHO radu (bunky sú rovnako vysoké — to
 * už raz na Prehľade rozišlo rad štyroch dlaždíc). Porovnáva sa explicitne:
 * Turbopack v tomto repe už raz skrátený guard vyhodnotil zle.
 */
export function hasNode(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/* ═══════════════════ 1. Tri stavy jedného čísla (I11) ═════════════════════ */

/**
 * Pomlčka „nevieme". NIE je tu napísaná — je to `NEVIEME` z
 * `lib/ui/product-label.ts`, teda ten istý znak (U+2014), akým appka priznáva
 * nevedomosť v tabuľkách, v audite aj v grafoch. Druhý literál by sa raz
 * ukázal ako spojovník a nikto by nevedel, ktorý je ten správny.
 */
export const KPI_UNKNOWN = NEVIEME;

/** Znak dolnej hranice. Predchádza mu ČÍSLO, ktoré appka naozaj zmerala. */
export const KPI_LOWER_BOUND = '≥';

/** Jedna hodnota a to, čím naozaj je: číslom, priznaním, alebo hranicou. */
export interface StatValueView {
  /** Čo sa vypíše. Už naformátované — dlaždica nič neprepočítava. */
  readonly text: string;
  /** `true` ⇔ je to pomlčka, teda priznanie „nevieme", nie hodnota. */
  readonly unknown: boolean;
  /** `true` ⇔ hodnota JE, ale je to len dolná hranica (`≥ N`). */
  readonly lowerBound: boolean;
}

export interface StatValueOptions {
  /** `true` = číslo je len dolná hranica (okno nie je dočítané). */
  readonly lowerBound?: boolean;
  /** Ako sa číslo napíše. Predvolene slovenské tisícky (`formatCountSk`). */
  readonly format?: (known: number) => string;
}

/**
 * Číslo → jeden z troch stavov.
 *
 * Poradie podmienok je záväzné a je to to isté poradie ako v
 * `product-columns.ts`: najprv sa pýtame, či hodnotu VÔBEC máme, potom, či je
 * to len hranica. Kto sa najprv pozrie na číslo, vypíše medzeru ako nulu.
 */
export function statValue(
  value: number | null | undefined,
  options: StatValueOptions = {},
): StatValueView {
  const unknownView: StatValueView = { text: KPI_UNKNOWN, unknown: true, lowerBound: false };
  if (value === null || value === undefined) return unknownView;
  if (!Number.isFinite(value)) return unknownView;

  const lowerBound = options.lowerBound === true;
  /* Bod 2 hlavičky: `≥ 0` nie je priznanie, ale prázdna veta. */
  if (lowerBound && value === 0) return unknownView;

  const format = options.format ?? formatCountSk;
  const body = format(value);
  return {
    text: lowerBound ? `${KPI_LOWER_BOUND} ${body}` : body,
    unknown: false,
    lowerBound,
  };
}

/**
 * Čím je HOTOVÝ text, ktorý dlaždici podal volajúci.
 *
 * Existuje preto, aby sa značka stavu nemusela posielať zvlášť: `unknown`
 * podaný ručne vedľa textu je tá istá informácia dvakrát a raz sa rozíde
 * (dlaždica by potom pomlčku vykreslila ako zmeranú hodnotu, alebo naopak).
 * Rovnaký odhad si dnes robí `CatalogTiles.tsx` (`view.value === UNKNOWN_VALUE`)
 * a `StatusSection.tsx` — tu je pre celú skupinu na jednom mieste.
 */
export function statValueMarks(value: unknown): { unknown: boolean; lowerBound: boolean } {
  if (typeof value !== 'string') return { unknown: false, lowerBound: false };
  const text = value.trim();
  return {
    unknown: text === KPI_UNKNOWN,
    lowerBound: text.startsWith(KPI_LOWER_BOUND),
  };
}

/* ═══════════════════ 2. Štvrtý stav smeru (DeltaPill) ═════════════════════ */

/**
 * Stavy smeru zmeny. Prvé tri sú `TrendDirection` z `ui/primitives.ts`, štvrtý
 * je ten, ktorý sa doň nevmestil — pozri bod 3 hlavičky.
 */
export const DELTA_STATES = ['up', 'down', 'flat', 'unknown'] as const;

export type DeltaState = (typeof DELTA_STATES)[number];

/**
 * Čo znamená RAST tohto čísla. Predvolene `neutral` — appka nehodnotí smer,
 * kým jej volajúci nepovie, či je to dobre (bod 6 hlavičky).
 */
export type DeltaSense = 'rise-good' | 'rise-bad' | 'neutral';

/** Slovo pre neznámu zmenu. Nikdy „0 %", nikdy „bez zmeny". */
export const DELTA_UNKNOWN_WORD = `zmenu ${UNKNOWN_WORD}`;

/**
 * Veta, ktorú pilulka povie, keď zmenu nepozná a volajúci vlastnú nedal.
 * Priznanie bez výmyslu — nehádame, PREČO porovnanie chýba.
 */
export const DELTA_UNKNOWN_TITLE =
  'Appka nemá s čím porovnať, takže zmenu nevypisuje. Nie je to nula.';

/**
 * Slová smeru. Tri známe sú ODVODENÉ z `TREND_WORD` (jeden slovník smeru
 * v celom repe), štvrté pribudlo.
 */
export const DELTA_WORD: Readonly<Record<DeltaState, string>> = {
  up: TREND_WORD.up,
  down: TREND_WORD.down,
  flat: TREND_WORD.flat,
  unknown: DELTA_UNKNOWN_WORD,
};

/**
 * Značky smeru. `unknown` je `null` ZÁMERNE: jeho značkou je pomlčka
 * `KPI_UNKNOWN`, teda ten istý znak, akým appka priznáva nevedomosť všade
 * inde. Ikonová sada je kreslená na mriežku 16 a pomlčku v nej nemá — a
 * vymyslieť pre priznanie novú, štvrtú značku by znamenalo, že sa priznanie
 * v pilulke a v tabuľke kreslí inak.
 */
export const DELTA_ICON: Readonly<Record<DeltaState, IconName | null>> = {
  up: TREND_ICON.up,
  down: TREND_ICON.down,
  flat: TREND_ICON.flat,
  unknown: null,
};

/**
 * Zaokrúhlenie na zobrazený počet desatinných miest — bod 5 hlavičky.
 * `null` znamená „toto číslo nemáme" a vracia sa aj pre `NaN`/`±Infinity`.
 */
export function roundDelta(value: number | null | undefined, digits = 0): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  const safe = Math.max(0, Math.min(6, Math.trunc(digits)));
  return Number(value.toFixed(safe));
}

/** Smer zmeny. `null`, `NaN` aj `±Infinity` sú `unknown`, nikdy `flat`. */
export function deltaState(value: number | null | undefined): DeltaState {
  if (value === null || value === undefined) return 'unknown';
  if (!Number.isFinite(value)) return 'unknown';
  if (value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

/**
 * Smer + zmysel → hodnotenie §3.2. `neutral` nehodnotí NIKDY, ani pri
 * jednoznačnom smere — to je celý bod predvoleného stavu.
 */
export function deltaMeaning(state: DeltaState, sense: DeltaSense = 'neutral'): TrendMeaning {
  if (sense === 'neutral') return 'idle';
  if (state === 'up') return sense === 'rise-good' ? 'good' : 'bad';
  if (state === 'down') return sense === 'rise-good' ? 'bad' : 'good';
  return 'idle';
}

/** Tón pilulky. Ide cez `trendTone()`, takže mapovanie žije na jednom mieste. */
export function deltaTone(state: DeltaState, sense: DeltaSense = 'neutral'): StatusTone {
  return trendTone(deltaMeaning(state, sense));
}

/**
 * Zmena so znamienkom, slovensky: `+12`, `−7`, `1 240`, `+3,5`.
 *
 * Mínus je U+2212 (typografický), nie spojovník — tá istá voľba ako
 * `signedPercent()` v `SalesSection.tsx`. Tisícky delí MEDZERA
 * (`formatCountSk`), desatinné miesta ČIARKA; `Intl.NumberFormat` sa tu
 * nepoužíva, lebo dáva nezlomiteľnú medzeru a repo by mal dva tvary čísla.
 *
 * Nula nedostane znamienko — `+0` vyzerá ako pohyb, ktorý sa nestal.
 */
export function formatDeltaSk(value: number | null | undefined, digits = 0): string {
  const shown = roundDelta(value, digits);
  if (shown === null) return KPI_UNKNOWN;

  const safe = Math.max(0, Math.min(6, Math.trunc(digits)));
  const [int, frac] = Math.abs(shown).toFixed(safe).split('.');
  const grouped = formatCountSk(Number(int));
  const body = frac === undefined ? grouped : `${grouped},${frac}`;

  if (shown === 0) return body;
  return shown > 0 ? `+${body}` : `−${body}`;
}

/* ══════════════════════ 3. Rebrík porovnania (BarList) ════════════════════ */

/**
 * Jedna mierka pre VIAC zoznamov naraz.
 *
 * Rebríček „top" a „flop" sú dva zoznamy jedného merania a musia sa dať
 * porovnať medzi sebou — keby si flop škáloval sám, jeho najslabší produkt by
 * mal pás cez celý riadok a vyzeral by ako najpredávanejší (presne to už raz
 * riešil `TopFlopSection.tsx`). Mierku aj tak počíta `barLayout()`; táto
 * funkcia iba zliepa vstupy do jednej skupiny a vracia ich podľa kľúča.
 */
export function barListBars(
  ...groups: readonly (readonly BarInput[])[]
): ReadonlyMap<string, Bar> {
  const all = groups.flat();
  const layout = barLayout(all);
  return new Map(layout.bars.map((bar) => [bar.bucket, bar]));
}

/**
 * Veta pod rebríkom o položkách bez merania — TRETÍ KANÁL pre celý zoznam.
 *
 * `BarLayout` si to žiada vo vlastnej hlavičke („legenda to musí povedať
 * slovom"): šrafovaný pahýľ je značka a pomlčka v riadku je značka, ale bez
 * slova sa nikto nedozvie, že tie riadky do porovnania nevstupujú.
 * `null` = niet čo povedať, a vtedy sa veta NEKRESLÍ (prázdna veta je šum).
 */
export function barListUnknownSentence(unknown: number, total: number): string | null {
  if (!Number.isFinite(unknown) || !Number.isFinite(total)) return null;
  if (unknown <= 0) return null;
  const items = pluralSk(total, 'položky', 'položiek', 'položiek');
  return (
    `Bez merania ${formatCountSk(unknown)} z ${formatCountSk(total)} ${items} — ` +
    `${UNKNOWN_WORD}, nie nula.`
  );
}
