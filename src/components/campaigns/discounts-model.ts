/**
 * Aura Zľavy — ČISTÝ MODEL TABU ZĽAVY (V11; kontrakt V3 K1–K6, architektúra §1, §4).
 *
 * Obrazovka „Nová zľava" rozhoduje o tom, čo sa zapíše do PRODUKČNÉHO eshopu:
 * ktoré produkty, o koľko percent, v akom okne a kedy fronta dobehne. Tie
 * rozhodnutia sa musia dať overiť bez prehliadača, preto tu žijú ako čisté
 * funkcie — žiadny React, žiadny `fetch`, žiadne `process.env`, žiadna DB.
 *
 * Štyri veci, na ktorých modul stojí:
 *
 *  1. **Pásma vznikajú z MERANÉHO čísla.** Jediná predajnosť, ktorú appka má,
 *     je „predaných kusov za zvolené okno" (K8 — kategória, kov ani marža
 *     dáta nemajú). Pásma sú preto vedrá tohto jedného čísla a ich pravidlo je
 *     veta, ktorú si používateľ vie overiť v tabe Produkty tým istým filtrom.
 *  2. **Nič sa nedopočítava z ničoho.** Priemerná cena je priemer cien, ktoré
 *     naozaj prišli; keď ceny chýbajú, je `null` a obrazovka to povie (P7).
 *  3. **Odhad dobehnutia kopíruje server.** `estimateFinishDay()` je zámerne
 *     ten istý výpočet ako `estimateFinish()` v `lib/engine/budget.ts` (K5) —
 *     server ho nevie ponúknuť pre zľavu, ktorá ešte neexistuje, a dve rôzne
 *     čísla na jednej obrazovke by boli horšie než jedno priznané.
 *     Rozpočtový deň je **UTC** (strop shopu), okno platnosti sa počíta
 *     v `Europe/Bratislava` (logický deň) — dva rôzne dni, dve rôzne funkcie.
 *  4. **Poradie zoznamu je poradie naliehavosti** (architektúra §1 TAB 3):
 *     `zapisuje sa` → `beží` → `pripravená` → `skončila`.
 *
 * Vlastník: V11.
 */
import type { DateOnly } from '@/contracts';

import { toStatusCode } from '@/components/dashboard/overview-model';
import { addDays, todayInZone, LOGIC_TIME_ZONE } from '@/lib/domain/dates';
import {
  campaignSentence,
  type CampaignSentence,
  type SurfaceFlag,
  type SurfaceState,
} from '@/lib/ui/vocabulary';

/* ═════════════════════════════ 1. Pásma (K3) ══════════════════════════════ */

/**
 * Vedrá predajnosti — rovnaké hranice ako `SOLD_BUCKET_SQL` v `catalog.repo`.
 * Keby sa rozišli, pásmo by tvrdilo iné pravidlo, než podľa akého sa produkty
 * naozaj rozdelili.
 */
export type SoldBucketKey = 'none' | 'low' | 'mid' | 'high';

export const SOLD_BUCKET_ORDER: readonly SoldBucketKey[] = ['none', 'low', 'mid', 'high'];

/**
 * Do ktorého vedra spadne MERANÝ počet predaných kusov.
 *
 * `null` na vstupe aj na výstupe znamená „nevieme" (D121, 28. 8. 2026).
 * Do 28. 8. 2026 bral tento typ `number` a `null` sa doň nedal vyjadriť, takže
 * neznámy predaj prišiel ako nula, spadol do vedra `none` a dostal
 * `DEFAULT_TIER_PERCENT.none`, teda **30 %** — najhlbšiu zľavu v appke. Kým je
 * obohacovanie pozastavené (D118, ~207 dní na celý katalóg), vyzerá tak väčšina
 * katalógu, takže by tisíce produktov dostali 30 % na základe čísla, ktoré
 * appka nikdy nezmerala. Zľava je nevratná (I7), takže je to fail-closed:
 * neznámy predaj sa do pásma NEZARADÍ.
 *
 * MERANÁ nula je iná vec a vedro `none` si drží: „za okno sa nepredal ani
 * jeden kus" je odpoveď, „nevieme" nie je.
 */
export function soldBucketOf(unitsSold: number | null): SoldBucketKey | null {
  if (unitsSold === null) return null;
  if (!Number.isFinite(unitsSold)) return null;
  const units = Math.max(0, Math.trunc(unitsSold));
  if (units === 0) return 'none';
  if (units <= 2) return 'low';
  if (units <= 9) return 'mid';
  return 'high';
}

/**
 * Predvolené percentá pásiem. Sú to NÁVRHY — používateľ ich prepíše a strop
 * 1–30 % drží `validateTierPercent()` aj `CHECK` v databáze (I9, K3).
 */
export const DEFAULT_TIER_PERCENT: Readonly<Record<SoldBucketKey, number>> = {
  none: 30,
  low: 20,
  mid: 15,
  high: 10,
};

/** Písmeno pásma na povrchu (A, B, C, D) — nikdy kód vedra. */
export const TIER_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** Pravidlo pásma ako veta, ktorú si používateľ vie overiť v Produktoch. */
export function tierRuleSentence(bucket: SoldBucketKey, windowDays: number): string {
  const w = Math.max(1, Math.trunc(windowDays));
  if (bucket === 'none') return `0 predaných za ${w} dní`;
  if (bucket === 'low') return `1–2 predané za ${w} dní`;
  if (bucket === 'mid') return `3–9 predaných za ${w} dní`;
  return `10 a viac predaných za ${w} dní`;
}

/** Riadok katalógu, z ktorého sa pásma skladajú. */
export interface SelectableRow {
  readonly productId: number;
  readonly name: string | null;
  /**
   * Kód produktu z obohatenia (D116). Chýbajúce pole aj `null` znamenajú
   * „appka referenciu nepozná" (produkt nie je obohatený, D118) — pomenovanie
   * skladá `productLabel()`, nie táto štruktúra.
   */
  readonly reference?: string | null;
  readonly price: string | null;
  /**
   * Predané kusy za okno. **`null` = appka to NEVIE** (produkt nie je obohatený,
   * D118, alebo okno nemá stiahnuté dni) — nie „nula predaných" (D121,
   * 28. 8. 2026). Do 28. 8. 2026 tu stálo `number` a „nevieme" sa nedalo
   * vyjadriť, takže sa z neho stala nula a z nuly 30 % zľava.
   */
  readonly unitsSold: number | null;
  /** I11 — podľa VLASTNÝCH zápisov appky, nie podľa stavu shopu. */
  readonly discountedNow: boolean;
}

/** Pásmo tak, ako ho vidí obrazovka aj `POST /api/campaigns/preview`. */
export interface TierPlan {
  readonly ord: number;
  readonly letter: string;
  readonly bucket: SoldBucketKey;
  /** Ľudské pravidlo — ide do `campaign_tiers.label` aj do UI. */
  readonly label: string;
  readonly percent: number;
  readonly productIds: readonly number[];
}

/**
 * Výsledok rozdelenia do pásiem (D121).
 *
 * Návratový typ je ZÁMERNE dvojica a nie `TierPlan[]`: neznáme predaje musí
 * volajúci prevziať vedome. Keby `buildTiers()` vracalo len pásma, dali by sa
 * preskočené produkty prehliadnuť — a to je presne ten druh ticha, ktorý sa
 * v tejto appke už raz dostal do produkcie. Typecheck je dôkaz úplnosti.
 */
export interface TierPartition {
  readonly tiers: TierPlan[];
  /**
   * Produkty, ktorých predaj appka NEPOZNÁ. Do žiadneho pásma nepatria a do
   * kampane sa NESMÚ dostať; obrazovka ich má priznať ako „nevieme,
   * preskočené" s počtom (D121).
   */
  readonly unknownProductIds: readonly number[];
}

/**
 * Rozdelí vybrané riadky do pásiem podľa predajnosti. Prázdne pásmo sa
 * NEVYTVORÍ — pásmo bez produktov je len riadok, ktorý klame o rozsahu.
 *
 * Riadky s neznámym predajom idú do `unknownProductIds`, nie do vedra `none`
 * (D121 — dôvod v `soldBucketOf()`).
 */
export function buildTiers(
  rows: readonly SelectableRow[],
  windowDays: number,
  percents: Readonly<Partial<Record<SoldBucketKey, number>>> = {},
): TierPartition {
  const groups = new Map<SoldBucketKey, number[]>();
  const unknownProductIds: number[] = [];
  for (const row of rows) {
    const bucket = soldBucketOf(row.unitsSold);
    if (bucket === null) {
      unknownProductIds.push(row.productId);
      continue;
    }
    const ids = groups.get(bucket);
    if (ids === undefined) groups.set(bucket, [row.productId]);
    else ids.push(row.productId);
  }

  const plans: TierPlan[] = [];
  for (const bucket of SOLD_BUCKET_ORDER) {
    const ids = groups.get(bucket);
    if (ids === undefined || ids.length === 0) continue;
    const ord = plans.length + 1;
    plans.push({
      ord,
      letter: TIER_LETTERS[plans.length] ?? String(ord),
      bucket,
      label: tierRuleSentence(bucket, windowDays),
      percent: percents[bucket] ?? DEFAULT_TIER_PERCENT[bucket],
      productIds: ids,
    });
  }
  return { tiers: plans, unknownProductIds };
}

/** Pásmo v tvare, aký prijíma `POST /api/campaigns/preview` aj `POST /api/campaigns`. */
export interface TierWire {
  readonly ord: number;
  readonly label: string;
  readonly percent: number;
  readonly productIds: readonly number[];
}

/** Telo zápisu zľavy — produkty a pásma, ktoré sa NEMÔŽU rozísť. */
export interface DiscountWriteRequest {
  readonly productIds: readonly number[];
  readonly percent: number;
  readonly tiers: readonly TierWire[];
}

/**
 * Zloží zoznam produktov a pásma pre zápis Z JEDNÉHO ZDROJA (D121, 28. 8. 2026).
 *
 * PREČO TO NIE JE DVA VÝRAZY NA MIESTE VOLANIA
 * --------------------------------------------
 * Do 28. 8. 2026 obrazovka posielala `productIds: rows.map(…)` a `tiers`
 * postavené z pásiem — dva nezávislé výrazy o tej istej veci. Produkt
 * s neznámym predajom tak v pásmach nebol, ale v `productIds` áno, takže do
 * kampane šiel bez platného percenta.
 *
 * Horšie než chyba samotná bolo, že ju NEZACHYTIL ani jeden test: mutácia
 * (vrátenie `rows.map(…)`) nechala 93 tvrdení zelených. Model bol otestovaný,
 * ZAPOJENIE nie — tá istá trieda diery, akú v tomto sprinte odkrylo mutačné
 * overenie presetov (grep nad priečinkom A nepovie nič o diere v priečinku B).
 *
 * Odpoveď nie je ďalší test, ale to, že sa nesprávna odpoveď NEDÁ VYJADRIŤ:
 * `productIds` sa tu odvodzuje z tých istých pásiem, aké idú do `tiers`, takže
 * sa nemajú ako rozísť. Kto to zmení, musí zmeniť túto funkciu — a tú test
 * kryje priamo, vrátane invariantu „`productIds` == zjednotenie pásiem".
 */
export function discountWriteRequest(partition: TierPartition): DiscountWriteRequest {
  const tiers: TierWire[] = partition.tiers.map((tier) => ({
    ord: tier.ord,
    label: `${tier.letter} · ${tier.label}`,
    percent: tier.percent,
    productIds: tier.productIds,
  }));
  return {
    /* Zjednotenie pásiem — NIE pôvodné riadky výberu. Produkty s neznámym
       predajom sú v `partition.unknownProductIds` a sem sa nedostanú (D121). */
    productIds: tiers.flatMap((tier) => [...tier.productIds]),
    percent: headlinePercent(partition.tiers),
    tiers,
  };
}

/** I9 / D11 — percento je celé číslo 1–30. Vracia hlášku alebo `null`. */
export function validateTierPercent(value: number): string | null {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return 'Percento musí byť celé číslo.';
  }
  if (value < 1 || value > 30) return 'Percento musí byť od 1 do 30.';
  return null;
}

/** K3 — hlavička zľavy nesie NAJVYŠŠIE percento pásiem. */
export function headlinePercent(tiers: readonly TierPlan[]): number {
  let max = 0;
  for (const tier of tiers) if (tier.percent > max) max = tier.percent;
  return max;
}

/**
 * Vzorka 6 riadkov ROZLOŽENÝCH naprieč pásmami (nie prvých 6) — presne ako
 * `pickSample()` v `engine/preview.ts`. Vzorka, ktorá ukáže len najlacnejšie
 * pásmo, je horšia než žiadna: používateľ potvrdzuje to, čo vidí.
 */
export function spreadSample(
  rows: readonly SelectableRow[],
  tiers: readonly TierPlan[],
  size = 6,
): SelectableRow[] {
  if (rows.length === 0 || tiers.length === 0) return [];
  const byId = new Map<number, SelectableRow>();
  for (const row of rows) byId.set(row.productId, row);

  const perTier: SelectableRow[][] = tiers.map((tier) =>
    tier.productIds
      .map((id) => byId.get(id))
      .filter((row): row is SelectableRow => row !== undefined),
  );

  const picked: SelectableRow[] = [];
  let round = 0;
  while (picked.length < size) {
    let addedInRound = 0;
    for (const list of perTier) {
      if (picked.length >= size) break;
      const row = list[round];
      if (row === undefined) continue;
      picked.push(row);
      addedInRound += 1;
    }
    if (addedInRound === 0) break;
    round += 1;
  }
  return picked;
}

/* ════════════════════════ 2. Ceny a počty (P7) ════════════════════════════ */

/** Priemer cien, ktoré NAOZAJ prišli. `null` = ani jedna cena nie je známa. */
export function averagePrice(rows: readonly SelectableRow[]): number | null {
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    if (row.price === null) continue;
    const value = Number(row.price);
    if (!Number.isFinite(value)) continue;
    sum += value;
    count += 1;
  }
  if (count === 0) return null;
  return sum / count;
}

/** Cena po zľave — orientačný výpočet appky (D4); zaokrúhlenie shopu sa líši. */
export function discountedPriceOf(price: string | null, percent: number): number | null {
  if (price === null) return null;
  const value = Number(price);
  if (!Number.isFinite(value)) return null;
  const pct = Number.isFinite(percent) ? percent : 0;
  return Math.round(value * (1 - pct / 100) * 100) / 100;
}

/**
 * I3 na povrchu: bez ručne vpísaného počtu sa zľava nezaradí. Porovnáva sa
 * ČÍSLO, nie text — `8 000`, `8000` aj ` 8000 ` je tá istá odpoveď, `8 0 0 0`
 * tiež (medzery sú oddeľovač tisícok). Čokoľvek iné je nezhoda.
 */
export function typedCountMatches(typed: string, expected: number): boolean {
  const digits = typed.replace(/\s/g, '');
  if (digits.length === 0 || !/^\d+$/.test(digits)) return false;
  return Number(digits) === expected;
}

/* ═══════════════════ 3. Rozpočet, odhad a štart (K2, K5) ══════════════════ */

/** Rozpočtový deň je **UTC** — je to strop shopu, nie náš (K2). */
export const BUDGET_TIME_ZONE = 'UTC';

export interface FinishEstimate {
  /** Koľko položiek sa ešte musí zapísať. */
  readonly pending: number;
  readonly perDay: number;
  /** Koľko ĎALŠÍCH UTC dní fronta pobeží; `0` = dobehne ešte dnes. */
  readonly days: number;
  readonly date: DateOnly;
}

/**
 * K5 — kedy fronta dobehne. Zhodné s `estimateFinish()` v `engine/budget.ts`:
 * dnešok sa počíta len tým, čo z rozpočtu zostalo, ďalšie dni celým rozpočtom.
 * Je to PLÁN, nie sľub — nezapočítava zlyhania ani odstávky počítača, a preto
 * ho obrazovka označuje `≈` (P7).
 */
export function estimateFinishDay(
  pending: number,
  dailyBudget: number,
  options: { readonly remainingToday?: number; readonly now?: Date } = {},
): FinishEstimate {
  const perDay =
    Number.isFinite(dailyBudget) && dailyBudget >= 1 ? Math.trunc(dailyBudget) : 200;
  const left = Number.isFinite(pending) ? Math.max(0, Math.trunc(pending)) : 0;
  const today = todayInZone(options.now ?? new Date(), BUDGET_TIME_ZONE);

  if (left === 0) return { pending: 0, perDay, days: 0, date: today };

  const rawCapacity =
    options.remainingToday === undefined ? perDay : Math.trunc(options.remainingToday);
  const todayCapacity = Number.isFinite(rawCapacity)
    ? Math.min(perDay, Math.max(0, rawCapacity))
    : perDay;

  if (left <= todayCapacity) return { pending: left, perDay, days: 0, date: today };

  const days = Math.ceil((left - todayCapacity) / perDay);
  return { pending: left, perDay, days, date: addDays(today, days) };
}

/** K5 — dva dni rezervy na sklz. Zľava má nabehnúť až keď je všetko zapísané. */
export const START_RESERVE_DAYS = 2;

/**
 * Navrhovaný štart: deň dobehnutia + rezerva, ale nikdy skôr než dnes
 * (logický deň, `Europe/Bratislava` — nikdy UTC).
 */
export function proposeStart(
  finishDay: DateOnly,
  options: { readonly reserveDays?: number; readonly now?: Date } = {},
): DateOnly {
  const reserve = options.reserveDays ?? START_RESERVE_DAYS;
  const today = todayInZone(options.now ?? new Date(), LOGIC_TIME_ZONE);
  const proposed = addDays(finishDay, Math.max(0, reserve));
  return proposed > today ? proposed : today;
}

/** Dnešok v logickej zóne — `from ≥ dnes` sa nikdy nepočíta v UTC (I9, D31). */
export function todayLogical(now: Date = new Date()): DateOnly {
  return todayInZone(now, LOGIC_TIME_ZONE);
}

/* ══════════════════ 4. Poradie zoznamu zliav (architektúra §1) ════════════ */

/** Zľava tak, ako ju zoznam potrebuje — spoločný podpis pre model aj UI. */
export interface DiscountLike {
  readonly id: number;
  readonly status: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly itemsOk: number;
  readonly itemsFailed: number;
  readonly itemsPending: number;
  readonly late: boolean;
}

const STATE_ORDER: Readonly<Record<SurfaceState, number>> = {
  'zapisuje sa': 0,
  'beží': 1,
  'pripravená': 2,
  'skončila': 3,
};

/** Kam ide stav, ktorý v číselníku nie je — na koniec, za všetky známe. */
const UNKNOWN_STATE_ORDER = 9;

/**
 * Poradie jedného stavu v zozname.
 *
 * Stráž `?? UNKNOWN_STATE_ORDER` nie je opatrnosť navyše, je to zarovnanie
 * s dvojičkou na Prehľade (`overview-model.liveCampaigns()`), ktorá ju má od
 * začiatku. Bez nej dá `STATE_ORDER[neznámy]` hodnotu `undefined`, odčítanie
 * `NaN`, `sort()` porovnávač, ktorý nie je usporiadaním — a poradie zoznamu sa
 * medzi dvoma načítaniami toho istého zoznamu mení. `Record<SurfaceState, …>`
 * to nechytí: typ hovorí, že iný stav neexistuje, presne ako to o kóde
 * `writing` hovoril `as CampaignStatusCode`.
 *
 * Dnes sem neznámy stav nedôjde (`sentenceOf()` je fail-closed), ale práve
 * asymetria dvoch dvojičiek vyrobila pôvodnú chybu.
 */
export function stateRank(state: SurfaceState): number {
  return STATE_ORDER[state] ?? UNKNOWN_STATE_ORDER;
}

/**
 * Príznak pre kód stavu, ktorý appka nepozná.
 *
 * Slovník preň vetu nemá a nemôže mať — nepozná ho ani on. Znenie preto žije
 * tu, rovnako ako veta „nevieme, či sa zapísalo" v `DiscountsList` (D45).
 * Kód sa do textu NEDÁVA: vnútorné kódy na povrch nepatria (K10).
 *
 * Tón je jantárový, nie červený a nie sivý — presne ako
 * `UNKNOWN_RESOLUTION_LOOK` pri prekážkach: netvrdíme poruchu ani pokoj,
 * len že sa treba pozrieť.
 */
export const UNKNOWN_STATUS_FLAG: SurfaceFlag = {
  text: 'tento stav nepoznáme',
  tone: 'attention',
};

/**
 * Stav zľavy ako veta povrchu — jediná cesta k slovu o stave (K10).
 *
 * KÓD SA NEPRETYPOVÁVA, OVERUJE SA. Do 24. 8. 2026 tu stálo
 * `row.status as CampaignStatusCode`. Kód, ktorý appka nepozná (stalo sa
 * s `writing`), tak prešiel do slovníka, `CAMPAIGN_STATE` preň nemal slovo,
 * tón bol `undefined` a značka stavu zhodila celý tab na bielu stránku.
 *
 * Prevod robí `toStatusCode()` z Prehľadu — TÁ ISTÁ funkcia, nie druhá kópia.
 * Dva fail-closed prevody by sa po prvej zmene rozišli a jedna obrazovka by
 * o tej istej zľave tvrdila niečo iné než druhá.
 *
 * Neznámy kód nie je chyba appky, je to fakt o dátach. Slovo preto padá na
 * najpasívnejšie tvrdenie („pripravená" — nič sa nezapisuje), ale veta to
 * PRIZNÁVA príznakom za bodkou: `pripravená · tento stav nepoznáme`. Tichá
 * náhrada by predstierala jeden zo známych stavov.
 */
export function sentenceOf(row: DiscountLike, today?: DateOnly): CampaignSentence {
  const status = toStatusCode(row.status);
  const sentence = campaignSentence({
    status,
    dateFrom: row.dateFrom as DateOnly,
    dateTo: row.dateTo as DateOnly,
    ...(today !== undefined ? { today } : {}),
    itemsWritten: row.itemsOk,
    failedCount: row.itemsFailed,
    lateCount: row.late ? row.itemsPending : 0,
  });

  // Prevod, ktorý kód ZMENIL, je jediný dôkaz, že sme ho nepoznali.
  if (status === row.status) return sentence;

  const flags = [...sentence.flags, UNKNOWN_STATUS_FLAG];
  return {
    ...sentence,
    flags,
    // Gramatika povrchu je `stav · príznak · príznak` (§4) — rovnako ako ju
    // skladá slovník; skladá sa znovu, lebo príznak pribudol až tu.
    text: [sentence.state, ...flags.map((flag) => flag.text)].join(' · '),
  };
}

export interface OrderedDiscounts<T extends DiscountLike> {
  /** Zľava, ktorá sa práve zapisuje — dominanta zoznamu (P1). `null` = žiadna. */
  readonly leading: T | null;
  /** Bežiace a rozpísané, bez dominanty. */
  readonly active: readonly T[];
  /** Hotové — tlmená, zbaliteľná sekcia „Skončené". */
  readonly finished: readonly T[];
}

/**
 * Poradie stavov `zapisuje sa` → `beží` → `pripravená` → `skončila`. Dominantou
 * je prvá zľava, ktorá sa naozaj zapisuje — nie najnovšia a nie najväčšia.
 */
export function orderDiscounts<T extends DiscountLike>(
  rows: readonly T[],
  today?: DateOnly,
): OrderedDiscounts<T> {
  const withState = rows.map((row) => ({ row, state: sentenceOf(row, today).state }));
  const sorted = [...withState].sort((a, b) => {
    const order = stateRank(a.state) - stateRank(b.state);
    if (order !== 0) return order;
    return b.row.id - a.row.id;
  });

  const finished = sorted.filter((entry) => entry.state === 'skončila').map((entry) => entry.row);
  const live = sorted.filter((entry) => entry.state !== 'skončila');

  const leadingIndex = live.findIndex(
    (entry) => entry.state === 'zapisuje sa' && entry.row.itemsPending > 0,
  );
  if (leadingIndex === -1) {
    return { leading: null, active: live.map((entry) => entry.row), finished };
  }
  return {
    leading: live[leadingIndex]!.row,
    active: live.filter((_, index) => index !== leadingIndex).map((entry) => entry.row),
    finished,
  };
}

/** Rozdelenie zoznamu na dominantu, zvyšok a rozklik „Skončené". */
export interface FeaturedDiscounts<T extends DiscountLike> {
  /** Zľava na čele obrazovky. `null` = v appke nie je ani jedna. */
  readonly featured: T | null;
  /** Ostatné živé zľavy — riadky zoznamu pod dominantou. */
  readonly rest: readonly T[];
  /** Skončené do rozkliku, VŽDY bez tej, ktorá stojí na čele. */
  readonly finished: readonly T[];
}

/**
 * Kto stojí na čele obrazovky Zľavy. Rozhodnutie je tu, nie v JSX — je to
 * pravidlo o dominante (P1) a pravidlo sa musí dať overiť bez prehliadača.
 *
 * TRI ZÁCHYTY V PORADÍ:
 *
 *   1. zľava, ktorá sa práve zapisuje (`leading`) — to sa deje teraz,
 *   2. prvá živá v poradí naliehavosti (`beží` → `pripravená`),
 *   3. posledná SKONČENÁ.
 *
 * Tretí záchyt pribudol 19. 8. 2026 a nie je to detail. Kým existoval len prvý
 * a druhý, obrazovka so samými skončenými zľavami — po prvej sezóne bežný stav
 * — nemala dominantu žiadnu: celý tab bol jeden zbalený rozklik a percento,
 * kvôli ktorému sa tab otvára (kontrakt UI, bod 21), sa nedalo prečítať nikde.
 *
 * Zľava na čele sa v rozkliku „Skončené" NEOPAKUJE. Ten istý riadok dvakrát na
 * jednej obrazovke je najlacnejší spôsob, ako pokaziť počítanie — číslo pri
 * slove „Skončené" musí sedieť s počtom riadkov pod ním.
 */
export function featureDiscounts<T extends DiscountLike>(
  ordered: OrderedDiscounts<T>,
): FeaturedDiscounts<T> {
  if (ordered.leading !== null) {
    return { featured: ordered.leading, rest: ordered.active, finished: ordered.finished };
  }
  const firstActive = ordered.active[0];
  if (firstActive !== undefined) {
    return {
      featured: firstActive,
      rest: ordered.active.slice(1),
      finished: ordered.finished,
    };
  }
  const firstFinished = ordered.finished[0];
  if (firstFinished !== undefined) {
    return { featured: firstFinished, rest: [], finished: ordered.finished.slice(1) };
  }
  return { featured: null, rest: [], finished: [] };
}

/**
 * Koľko položiek je vo fronte PRED novou zľavou. Rozpočet sa delí — bez tohto
 * čísla by odhad dobehnutia klamal o týždne (odpoveď 15).
 */
export function queueAhead<T extends DiscountLike & { readonly name: string }>(
  rows: readonly T[],
  today?: DateOnly,
): { readonly pending: number; readonly names: readonly { name: string; pending: number }[] } {
  const ahead = rows.filter((row) => {
    if (row.itemsPending <= 0) return false;
    const state = sentenceOf(row, today).state;
    return state === 'zapisuje sa' || state === 'pripravená';
  });
  return {
    pending: ahead.reduce((sum, row) => sum + row.itemsPending, 0),
    names: ahead.map((row) => ({ name: row.name, pending: row.itemsPending })),
  };
}

/** Podiel spracovaných položiek v percentách — pruh nikdy nepreteká. */
export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (done / total) * 100));
}
