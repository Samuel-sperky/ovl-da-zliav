/**
 * Aura Zľavy — ČO IDE DO GRAFU TROCH KRIVIEK (V7, D156, D157, K5).
 *
 * OTÁZKA: „koľko kusov sa denne predalo — a bola v ten deň naša zľava?"
 * Os y sú PREDANÉ KUSY ZA DEŇ, forma je ČIARA, teda vývoj v čase (D126).
 *
 * PREČO SÚ KRIVKY TRI, A NIE DVE
 * ──────────────────────────────
 * Appka vie o zľave LEN to, čo sama zapísala. `discountedNow` v zrkadle
 * katalógu je momentka podľa VLASTNÉHO zápisu a zľava nastavená ručne
 * v administrácii eshopu je pre appku neviditeľná. Dvojkrivka „v zľave vs. bez
 * zľavy" by preto každý deň pred prvým zápisom appky (a každý deň, o ktorom
 * appka nemá záznam ani jedným smerom) hodila do vedra „bez zľavy" — a to nie
 * je nepresnosť, to je NEPRAVDA. Tretia krivka je priznanie, nie ozdoba
 * (D156, I11).
 *
 * ODKEDY APPKA O ZĽAVÁCH VIE — A ODKIAĽ SA TO BERIE
 * ─────────────────────────────────────────────────
 * Hranicu určuje `discountKnownFrom()` a je to NAJSKORŠÍ DEŇ, od ktorého bola
 * v eshope naša zľava podľa nášho vlastného zápisu v platnosti: `MIN(dateFrom)`
 * cez kampane, ktorých stav dokazuje, že sa položky naozaj zapísali
 * (`WROTE_STATUSES` — `done`, `partial`, `running`; stav kampane sa v tomto
 * repe odvodzuje z `campaign_items`, takže je to `campaigns` + `campaign_items`
 * prečítané jedným poľom odpovede `GET /api/insights/timeline`).
 *
 * Čo sa do hranice ZÁMERNE NEPOČÍTA:
 *
 *  · **Kampaň, ktorá sa nezapísala** (`failed`, `missed`, `cancelled`,
 *    `lapsed`, `draft`, `scheduled`, `needs_key`). Okno bez zápisu nie je
 *    tvrdenie o eshope — appka v tie dni nezlacnila nič.
 *  · **Deň, v ktorom appka niečo zapísala, ale ktorý nekryje ani jedno okno
 *    zľavy.** Zápis bez okna nehovorí, PRE KTORÉ dni zľava platila; brať ho za
 *    hranicu by z dní pred prvou kampaňou spravilo „bez zľavy" na základe
 *    záznamu, ktorý o nich nič netvrdí. Také dni preto zostávajú v krivke
 *    „nevieme, či bola". Je to smer PRIZNANIA: radšej menej tvrdení než jedno
 *    nepravdivé.
 *
 * Keď hranica neexistuje (appka v okne nemá ani jeden zapísaný deň zľavy), je
 * CELÉ okno v krivke „nevieme, či bola". To je dnes bežný stav — appka je bez
 * `shop_write` kľúča a IP je zabanovaná (R4) — a obrazovka to musí povedať
 * vetou, nie prázdnym grafom.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Nesťahovaný deň dostane nulu.** `units` je `number | null` a `null` sa
 *     NIKDY nedopĺňa. Nula je meraný fakt o eshope („deň sme stiahli, nepredalo
 *     sa nič"), `null` je fakt o appke („o tom dni nevieme"). Kto tu napíše
 *     `?? 0`, spraví z výpadku sťahovania prepad predaja a bude to vyzerať
 *     dôveryhodne. Presne to sa v tomto repe stalo pri D121 — model bol
 *     správny a dostal nepravdivý vstup; nenašlo to 3756 testov, ale preklik.
 *     Preto sa `test/unit/prehlad-graf-tri-krivky.spec.ts` meria na TELE DÁT
 *     (odpoveď → parser → tieto riadky), nie na modeli samom.
 *
 *  2. **Deň vypadne z radu.** Tichšia verzia tej istej lži: os by sa stiahla
 *     a graf by tvrdil, že medzi dvoma dňami nie je čo ukázať. Riadky sa preto
 *     skladajú cez CELÝ KALENDÁR okna (`windowDayList`), nie cez dni, ktoré
 *     niečo priniesli.
 *
 *  3. **Deň sa dostane do DVOCH kriviek.** Každý deň má práve jeden stav,
 *     takže hodnotu nesie práve jedna krivka a ostatné dve majú `null`. Keby
 *     hraničný deň dostal hodnotu do oboch (aby sa čiary „spojili"), bublina
 *     by ten istý predaj vypísala dvakrát a súčet kriviek by bol vyšší než
 *     predaj.
 *
 *  4. **Prázdna krivka dostane nulu, aby „niečo bolo vidieť".** Krivka bez
 *     jediného dňa sa nekreslí a v legende zostáva so slovom — nulová čiara
 *     po základni osi je tvrdenie „v takých dňoch sa nepredalo nič", ktoré
 *     nikto nezmeral.
 *
 *  5. **Poradie krivkových kľúčov sa rozíde s poradím kriviek.** `SPLIT_STATES`
 *     je uzavretý zoznam a legenda, súhrn aj bublina ho prechádzajú v tom istom
 *     poradí — nie každý svoj.
 *
 * Modul je ČISTÝ: žiadny React, žiadny Recharts, žiadne farby. Kreslí
 * `DiscountSplitChart.tsx`.
 *
 * Vlastník: V7, krok 2/4 (graf troch kriviek).
 */
import { SALES_TIP_NOTES } from '@/components/dashboard/sales-chart-view';
import { axisDay, windowDayList } from '@/components/dashboard/sales-view';
import { GAP_WORD, chartRowText, chartScaleMax } from '@/components/ui/chart-language';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Slová ═════════════════════════════════════ */

/**
 * Tri stavy dňa v uzavretom zozname. Poradie JE poradie kreslenia, legendy,
 * bubliny aj súhrnu — pridanie štvrtého stavu je rozhodnutie o tom, čo appka
 * o zľavách tvrdí, nie parameter grafu.
 */
export const SPLIT_STATES = ['discounted', 'plain', 'unknown'] as const;

export type SplitState = (typeof SPLIT_STATES)[number];

/**
 * TRETÍ KANÁL každej krivky (farba + značka + SLOVO, §4 bod 3). Formulácie sú
 * z D156 znak po znaku; „nevieme, či bola" nesmie zmäknúť na „neznáme" —
 * priznanie má byť veta, nie kategória.
 */
export const SPLIT_WORDS: Readonly<Record<SplitState, string>> = {
  discounted: 'v zľave',
  plain: 'bez zľavy',
  unknown: 'nevieme, či bola',
};

/**
 * Stavy kampane, ktoré DOKAZUJÚ zápis do eshopu. `partial` medzi ne patrí:
 * časť položiek sa zapísala, teda v tie dni bola časť produktov naozaj
 * zlacnená. Ostatné stavy (`failed`, `missed`, `cancelled`, `lapsed`, `draft`,
 * `scheduled`, `needs_key`) nezapísali nič a okno bez zápisu nie je tvrdenie
 * o eshope.
 */
export const WROTE_STATUSES = ['done', 'partial', 'running'] as const;

/**
 * Veta, ktorá drží celý graf v pravde a preto je POVINNÁ pod ním. Bez nej by
 * krivka „bez zľavy" vyzerala ako tvrdenie o eshope, a je to tvrdenie o NAŠICH
 * zápisoch (I11, D156).
 */
export const OWN_WRITES_NOTE =
  'Zľava je podľa vlastných zápisov appky. Zľavu nastavenú ručne v administrácii ' +
  'eshopu appka nevidí — taký deň nevie od dňa bez zľavy odlíšiť.';

/** Poznámka v bubline pri dni, o ktorého zľave nevieme. */
export const UNKNOWN_TIP_NOTE = 'o zľave v ten deň appka nemá záznam';

/* ═══════════════════════════ 2. Vstup ═════════════════════════════════════ */

/** Deň, ktorý sa NAOZAJ sťahoval, s kusmi. Presne riadok `days` z odpovede. */
export interface SplitDayInput {
  day: string;
  /** Kusy za deň. Nula je meranie. */
  units: number;
  /** `complete` = meranie, `partial` = dolná hranica. */
  status: string;
}

/** Riadok pokrytia — jeden na KAŽDÝ deň okna, aj na ten bez záznamu. */
export interface SplitCoverageInput {
  day: string;
  /** `complete` = meranie; všetko ostatné je „nevieme" (I11). */
  coverage: string;
}

/** Okno vlastnej zľavy z `GET /api/insights/timeline`. */
export interface SplitCampaignInput {
  dateFrom: string;
  dateTo: string;
  /** Stav kampane. `null` = odpoveď ho neposlala, teda zápis nie je dokázaný. */
  status: string | null;
}

export interface DiscountSplitInput {
  /** Prvý a posledný deň osi — okno prepínača grafu, nie pokrytie. */
  from: string;
  to: string;
  /** Dnešok v logickom pásme. Deň ešte beží, takže sa značí a hovorí sa to. */
  today: string;
  coverage: readonly SplitCoverageInput[];
  days: readonly SplitDayInput[];
  campaigns: readonly SplitCampaignInput[];
}

/* ═══════════════════════════ 3. Výstup ════════════════════════════════════ */

export interface DiscountSplitPoint {
  /** Kľúč osi — ISO deň. Popis z neho robí `axisDay()` v `tickFormatter`. */
  day: string;
  /** Popis do bubliny a do súhrnu: `7. 8.`. */
  label: string;
  /**
   * Do ktorej krivky deň patrí. `null` = deň sa nesťahoval, takže NEPATRÍ ani
   * do jednej: nemeriame predaj, nie zľavu.
   */
  state: SplitState | null;
  /** Kusy za deň. `null` = MEDZERA, nikdy nula. */
  units: number | null;
  /** Kľúč krivky „v zľave" — hodnota len keď deň patrí jej. */
  discounted: number | null;
  plain: number | null;
  unknown: number | null;
  /** Číslo je dolná hranica (neúplne stiahnutý deň) — dostane `≥`, resp. `≈`. */
  lowerBound: boolean;
  isToday: boolean;
}

/** Šrafovaný pás pod osou — súvislé pásmo dní, ktoré sa nesťahovali (D157). */
export interface DiscountSplitUnderlay {
  key: string;
  fromDay: string;
  toDay: string;
  days: number;
  /** Slovo do plochy; `null` = pás je na text príliš úzky. */
  label: string | null;
}

export interface DiscountSplitLegendItem {
  /** `gap` je značka „nesťahované", nie štvrtá krivka. */
  kind: SplitState | 'gap';
  label: string;
}

/** Jeden riadok tabuľkovej alternatívy pre čítačku. Tie isté čísla ako plocha. */
export interface DiscountSplitSummaryRow {
  day: string;
  label: string;
  /** Text hodnoty pre každú krivku v poradí `SPLIT_STATES`: číslo, `≥ N`, `—`. */
  cells: readonly string[];
  /** Priznanie k dňu („deň sa nesťahoval", „deň ešte beží"), inak `''`. */
  note: string;
}

export interface DiscountSplitView {
  points: DiscountSplitPoint[];
  /** Pásma bez merania. Poradie v poli je poradie kreslenia. */
  gaps: DiscountSplitUnderlay[];
  /** Horná hranica osi y. Základňa je vždy nula (D126, `chartScaleMax`). */
  scaleMax: number;
  legend: DiscountSplitLegendItem[];
  /** Priznania pod plochou. Prázdne pole = nie je čo priznať. */
  notes: string[];
  /** Odkedy appka o zľavách vie. `null` = nevie o žiadnom dni okna. */
  knownFrom: string | null;
  /** Koľko dní okna nesie ktorá krivka a koľko z nich je medzera. */
  counts: Readonly<Record<SplitState | 'gap', number>>;
  /** Koľko dní osi má naozaj číslo. Toľko a nie viac graf meria. */
  measuredDays: number;
  summaryRows: DiscountSplitSummaryRow[];
}

/* ═══════════════════════ 4. Hranica poznania ══════════════════════════════ */

/** Bol taký zápis do eshopu, že sa mu dá veriť? Fail-closed. */
function wrote(status: string | null): boolean {
  if (status === null) return false;
  return (WROTE_STATUSES as readonly string[]).includes(status);
}

/**
 * Odkedy appka o zľavách vie — najskorší deň, od ktorého bola NAŠA zľava
 * v platnosti podľa nášho vlastného zapísaného okna.
 *
 * `null` znamená „ani jeden dokázaný deň zľavy", nie „nula dní" — celý graf
 * potom padne do krivky „nevieme, či bola". Prevrátené okno (`dateTo` pred
 * `dateFrom`) a nečitateľný dátum sa ZAHADZUJÚ: hranica z pokazeného riadku by
 * bola tvrdenie z neznalosti.
 */
export function discountKnownFrom(campaigns: readonly SplitCampaignInput[]): string | null {
  let earliest: string | null = null;
  for (const campaign of campaigns) {
    if (!wrote(campaign.status)) continue;
    const from = campaign.dateFrom;
    const to = campaign.dateTo;
    if (!isDay(from) || !isDay(to) || to < from) continue;
    if (earliest === null || from < earliest) earliest = from;
  }
  return earliest;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Dá sa deň prečítať? Reťazcové porovnanie ISO dní inak nemá zmysel. */
function isDay(value: string): boolean {
  return DAY_RE.test(value);
}

/* ═══════════════════════ 5. Riadky grafu ══════════════════════════════════ */

/** Koľko dní, slovom. Jedno miesto — číslo bez jednotky je hluk. */
function dayCount(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'deň', 'dni', 'dní')}`;
}

/** Text hodnoty jednej krivky: číslo, `≥ N`, alebo pomlčka (nikdy nula). */
export function splitCellText(value: number | null, lowerBound: boolean): string {
  return chartRowText({ label: '', value, lowerBound: value !== null && lowerBound }, formatCountSk);
}

/**
 * Priznanie k dňu do bubliny a do súhrnu. Tri stavy, tri vety — nikdy
 * mlčanie tam, kde číslo nie je celé.
 */
export function splitPointNote(point: DiscountSplitPoint): string {
  if (point.units === null) return SALES_TIP_NOTES.unmeasured;
  if (point.lowerBound) return SALES_TIP_NOTES.estimate;
  if (point.isToday) return SALES_TIP_NOTES.today;
  if (point.state === 'unknown') return UNKNOWN_TIP_NOTE;
  return '';
}

/** Pás unesie slovo, až keď má aspoň toľko dní. Pod tým je z textu kaša. */
const GAP_LABEL_MIN_DAYS = 3;

/**
 * Odpoveď → riadky, z ktorých graf kreslí tri krivky.
 *
 * Deň sa klasifikuje v tomto poradí a poradie NESIE VÝZNAM:
 *  1. nesťahovaný (`coverage !== 'complete' | 'partial'`) → medzera, žiadna krivka,
 *  2. pred hranicou poznania (alebo bez hranice) → `unknown`,
 *  3. v okne zapísanej zľavy → `discounted`,
 *  4. inak → `plain`.
 *
 * Krok 2 stojí NAD krokom 3 zámerne: kampaň zapísaná dnes môže mať okno
 * v minulosti (`mode` `eager` píše dopredu), a taký deň by inak vyzeral ako
 * zľava, o ktorej appka v tom čase ešte nemohla vedieť.
 */
export function discountSplitView(input: DiscountSplitInput): DiscountSplitView {
  const knownFrom = discountKnownFrom(input.campaigns);

  const unitsByDay = new Map<string, { units: number; lowerBound: boolean }>();
  for (const row of input.days) {
    if (!isDay(row.day)) continue;
    if (!Number.isFinite(row.units)) continue;
    /* `partial` deň je DOLNÁ HRANICA a bez jediného kusu nie je meranie
       vôbec — sťahovanie spadlo skôr, než čokoľvek prinieslo. Nulu by
       obrazovka vydala za fakt o eshope. */
    if (row.status === 'partial' && row.units <= 0) continue;
    unitsByDay.set(row.day, { units: row.units, lowerBound: row.status === 'partial' });
  }

  const coverageByDay = new Map<string, string>();
  for (const row of input.coverage) {
    if (!isDay(row.day)) continue;
    coverageByDay.set(row.day, row.coverage);
  }

  /*
   * Dni, na ktoré appka zľavu ZAPÍSALA. Okno sa najprv OREŽE na os — kampaň
   * môže začať pred oknom prepínača aj pokračovať za ním (route ju vracia
   * celú, orezanie je práca grafu) a `windowDayList` má poistku 400 dní, takže
   * neorezané dlhé okno by sa rozbalilo na prázdno a deň so zľavou by spadol
   * do „bez zľavy".
   */
  const discountDays = new Set<string>();
  for (const campaign of input.campaigns) {
    if (!wrote(campaign.status)) continue;
    if (!isDay(campaign.dateFrom) || !isDay(campaign.dateTo)) continue;
    if (campaign.dateTo < campaign.dateFrom) continue;
    const from = campaign.dateFrom > input.from ? campaign.dateFrom : input.from;
    const to = campaign.dateTo < input.to ? campaign.dateTo : input.to;
    if (to < from) continue;
    for (const day of windowDayList(from, to)) discountDays.add(day);
  }

  const points: DiscountSplitPoint[] = [];
  const counts: Record<SplitState | 'gap', number> = {
    discounted: 0,
    plain: 0,
    unknown: 0,
    gap: 0,
  };
  let maxUnits = 0;

  for (const day of windowDayList(input.from, input.to)) {
    const measurement = unitsByDay.get(day);
    const coverage = coverageByDay.get(day);
    /* Meraním je LEN deň, ktorý odpoveď priniesla. Pokrytie samo o sebe
       nestačí: `complete` bez riadku v `days` znamená, že deň v odpovedi
       nie je, a dosadiť mu nulu by bolo tvrdenie o eshope. */
    const measured =
      measurement !== undefined && (coverage === undefined || coverage !== 'missing');

    const state: SplitState | null = !measured
      ? null
      : knownFrom === null || day < knownFrom
        ? 'unknown'
        : discountDays.has(day)
          ? 'discounted'
          : 'plain';

    const units = measured && measurement !== undefined ? measurement.units : null;
    const lowerBound = measured && measurement !== undefined ? measurement.lowerBound : false;
    if (units !== null && units > maxUnits) maxUnits = units;
    if (state === null) counts.gap += 1;
    else counts[state] += 1;

    points.push({
      day,
      label: axisDay(day),
      state,
      units,
      /* Hodnotu nesie PRÁVE JEDNA krivka (bod 3 hlavičky) — porovnáva sa
         výslovne, skrátený guard tu už raz Turbopack zahodil. */
      discounted: state === 'discounted' ? units : null,
      plain: state === 'plain' ? units : null,
      unknown: state === 'unknown' ? units : null,
      lowerBound,
      isToday: day === input.today,
    });
  }

  /* Súvislé pásma bez merania. Jednodenná medzera na osi 360 dní je takmer
     nevidieť, preto ide k medzere v čiare aj šrafované pozadie (D157). */
  const gaps: DiscountSplitUnderlay[] = [];
  let run: DiscountSplitPoint[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const first = run[0] as DiscountSplitPoint;
    const last = run[run.length - 1] as DiscountSplitPoint;
    gaps.push({
      key: `gap-${first.day}`,
      fromDay: first.day,
      toDay: last.day,
      days: run.length,
      label: run.length >= GAP_LABEL_MIN_DAYS ? GAP_WORD : null,
    });
    run = [];
  };
  for (const point of points) {
    if (point.state === null) run.push(point);
    else flush();
  }
  flush();

  const legend: DiscountSplitLegendItem[] = SPLIT_STATES.map((state) => ({
    kind: state,
    label: SPLIT_WORDS[state],
  }));
  /* Značka „nesťahované" je v legende LEN keď je čo priznať. „0 nesťahovaných
     dní" je hluk, nie priznanie (rovnaké pravidlo ako `gapLegendSentence`). */
  if (counts.gap > 0) legend.push({ kind: 'gap', label: `${GAP_WORD}, predaj nepoznáme` });

  const notes: string[] = [];
  if (counts.gap > 0) {
    notes.push(
      `${dayCount(counts.gap)} okna je ${GAP_WORD} — v čiare je medzera a pozadie ` +
        'šrafované, nie nula.',
    );
  }
  if (knownFrom === null) {
    notes.push(
      'Appka v tomto okne nemá ani jeden zapísaný deň zľavy, takže o žiadnom dni ' +
        `nevie, či zľava bežala — celé okno nesie krivka „${SPLIT_WORDS.unknown}".`,
    );
  } else if (counts.unknown > 0) {
    notes.push(
      `Dni pred ${axisDay(knownFrom)} nesie krivka „${SPLIT_WORDS.unknown}": appka ` +
        `o zľavách vie až od svojho prvého zapísaného dňa (${axisDay(knownFrom)}).`,
    );
  }
  notes.push(OWN_WRITES_NOTE);

  const summaryRows: DiscountSplitSummaryRow[] = points.map((point) => ({
    day: point.day,
    label: point.label,
    cells: SPLIT_STATES.map((state) =>
      splitCellText(point[state], point.lowerBound),
    ),
    note: splitPointNote(point),
  }));

  return {
    points,
    gaps,
    scaleMax: chartScaleMax(maxUnits),
    legend,
    notes,
    knownFrom,
    counts,
    measuredDays: counts.discounted + counts.plain + counts.unknown,
    summaryRows,
  };
}

export default discountSplitView;
