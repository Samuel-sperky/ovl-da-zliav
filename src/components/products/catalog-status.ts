/**
 * Aura Zľavy — STAV KATALÓGU A DÔVODY PRI PRODUKTE AKO ČISTÁ LOGIKA (V10).
 *
 * Tab Produkty je miesto, kde si používateľ vyberá tých ~150 kusov na prvú
 * reálnu zľavu. Dnes má appka načítaných len okolo 2 900 zo 41 082 produktov,
 * takže **vyberá z neúplného zoznamu a nemá ako to zistiť**. Tento modul je
 * polovica opravy: prekladá fakty z `GET /api/catalog/sync` a `GET /api/status`
 * na slovenské vety a rozhodnutia o tóne. Druhá polovica je značkovanie
 * v `CatalogStatusPanel.tsx`.
 *
 * PREČO JE TO SAMOSTATNÝ `.ts` SÚBOR
 * ----------------------------------
 * `vitest.config.ts` zbiera výhradne `test/**\/*.spec.ts` a beží v
 * `environment: 'node'` — test, ktorý by chcel vykresliť JSX, tu nemá ako
 * vzniknúť. Presne tá istá deľba ako v `components/ui/primitives.ts`: sem
 * všetko, čo sa dá spočítať a otestovať bez prehliadača, do `.tsx` len značky.
 * Vety o neúplnom katalógu sú pritom to prvé, čo sa pri prepisovaní obrazovky
 * ticho pokazí.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *
 *  1. **Vety o prekážkach sa TU NEPÍŠU.** Jediný zdroj pravdy o tom, čo blokuje
 *     čo, je `lib/status/blockers.ts`; obrazovka jeho vety len vykreslí.
 *     Vlastné vety má tento modul výhradne na dva stavy, ktoré prekážky
 *     nepokrývajú, lebo o nich nevedia: pauza po odmietnutí zo strany shopu
 *     a chyba posledného behu (`waiting`). Tretia vlastná veta o tom istom by
 *     znamenala dva texty, ktoré sa raz rozídu.
 *  2. **Tón sa volí podľa TOHO, KTO to vyrieši, nie podľa závažnosti.**
 *     `noteVariantForResolution()` mapuje `Blocker.resolution`, nie
 *     `Blocker.severity` — je to napísané v doc-bloku `blockers.ts` a je to
 *     jediný spôsob, ako sa čakanie na rozpočet neprefarbí na poruchu.
 *  3. **Červená je vyhradená pre zastavený zápis** (§4). Katalóg sa ČÍTA — keď
 *     sa čítanie nepodarí, je to `warn`, nikdy `err`. Preto tu tón `critical`
 *     nikde nevzniká; jediná cesta k nemu vedie cez prekážku, ktorú sa nedá
 *     vyriešiť z appky (`mimo_appky`, teda vypnuté zápisy).
 *  4. **Nič sa nedopočítava.** `percent`, `pagesLeft`, `estimatedFinishAt`
 *     a `estimatedDaysLeft` počíta `catalogRepo.syncStatus()`; keď ich neposlal,
 *     obrazovka povie „nevieme" a nedomýšľa si. Odhad, ktorý si vyrobí povrch,
 *     je presnejšie vyzerajúce klamstvo.
 *  5. **Formátovače `Intl` sa vyrábajú vo funkcii, nie na module scope.**
 *     `next build` volá modul pri kompilácii a formátovač na module scope by si
 *     zapamätal zónu build stroja.
 *
 * Vlastník: V10.
 */
import type { NoteVariant } from '@/components/ui/primitives';
import type { StatusTone } from '@/components/ui/ToneBadge';
import type { CatalogRowView } from '@/components/products/catalog-api';
import type { CatalogFilterState } from '@/components/products/catalog-filter';
import { LOGIC_TIME_ZONE } from '@/lib/domain/dates';
import type { Blocker, BlockerId, BlockerResolution } from '@/lib/status/blockers';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ═══════════════ 1. Tvar odpovede `GET /api/catalog/sync` ═════════════════ */

/**
 * Zrkadlo `CatalogStatusView` z `app/api/catalog/sync/route.ts`.
 *
 * Zámerne KÓPIA, nie import: originál žije vedľa route, ktorá ťahá
 * `@/lib/repo/catalog.repo`, a s ním `mariadb` aj `node:fs`. Rovnaký dôvod, pre
 * ktorý si `lib/status/snapshot.ts` zrkadlí `ScopeFacts` a `BudgetFacts`.
 * Rozídenie tvaru chytí `produkty-katalog.spec.ts`, nie prehliadač.
 */
export interface CatalogReadsView {
  readonly day: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
  readonly exhausted: boolean;
  readonly resetAt: string;
  readonly minuteLimit: number;
  readonly usedThisMinute: number;
  /** `false` = počítadlo sa nedalo prečítať, čísla sú fail-closed domnienka. */
  readonly known: boolean;
}

/** Prečo sa práve teraz nečíta. `null` = ďalšej dávke nič nebráni. */
export type CatalogWaiting = 'rate_limited' | 'daily_budget' | 'error' | 'catalog_complete';

export interface CatalogStatusView {
  readonly loadedProducts: number;
  readonly shopTotalProducts: number | null;
  readonly percent: number | null;
  readonly complete: boolean;
  /**
   * `true` = katalóg appka MÁ celý, ale beží nad ním nový (obnovovací) prechod.
   * Bez tohto poľa si karta protirečila: `pagesDone` patrí prechodu, ktorý po
   * dokončení predchádzajúceho začína od nuly, takže vedľa „0 chýba" stálo
   * „382 stránok, na každej 100 produktov" a „ešte 2 dni".
   */
  readonly refreshing: boolean;
  readonly lastFetchedAt: string | null;
  readonly lastReadAt: string | null;
  /** Pokrok AKTUÁLNEHO prechodu — nie „koľko z katalógu appka má". */
  readonly pagesDone: number;
  readonly pagesTotal: number | null;
  /** Koľko stránok appke CHÝBA. Pri obnove `0` — nechýba nič. */
  readonly pagesLeft: number | null;
  readonly perPage: number;
  readonly reads: CatalogReadsView;
  readonly waiting: CatalogWaiting | null;
  readonly nextBatchAt: string | null;
  readonly estimatedDaysLeft: number | null;
  readonly estimatedFinishAt: string | null;
  /** KÓD poslednej chyby behu — na povrch smie len do „Technického detailu". */
  readonly lastError: string | null;
}

/** Čo urobil posledný beh synchronizácie. Z `lastRun` v odpovedi route. */
export type CatalogRunOutcomeView =
  | 'already_running'
  | 'too_soon'
  | 'peak_hours'
  | 'writes_first'
  | 'paused'
  | 'budget_exhausted'
  | 'ran'
  | 'failed';

/** Surová správa o behu tak, ako ju posiela route. */
export interface CatalogRunReportView {
  readonly outcome: CatalogRunOutcomeView;
  /** `null` = beh sa vôbec nerozbehol (pauza, príliš skoro, súbeh). */
  readonly sync: { readonly pages: number; readonly products: number } | null;
  readonly resumeAt: string | null;
}

/** Sploštená podoba pre vetu na obrazovke — bez `null` vnorenia. */
export interface CatalogRunView {
  readonly outcome: CatalogRunOutcomeView;
  readonly pages: number;
  readonly products: number;
  readonly resumeAt: string | null;
}

/**
 * Beh nevykonal nič ⟹ nula stránok a nula produktov. Nula tu NIE JE domnienka:
 * `sync: null` znamená, že sa beh vôbec nerozbehol, takže prečítať nemohol nič.
 */
export function toRunView(report: CatalogRunReportView | null): CatalogRunView | null {
  if (report === null) return null;
  return {
    outcome: report.outcome,
    pages: report.sync?.pages ?? 0,
    products: report.sync?.products ?? 0,
    resumeAt: report.resumeAt,
  };
}

/* ═══════════════════════ 2. Slovenské tvary čísel ═════════════════════════ */

/** `1` → „1 produkt", `3` → „3 produkty", `150` → „150 produktov". */
export function productsPhrase(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'produkt', 'produkty', 'produktov')}`;
}

/** `1` → „1 stránka", `3` → „3 stránky", `382` → „382 stránok". */
export function pagesPhrase(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'stránka', 'stránky', 'stránok')}`;
}

/**
 * Akuzatív do vety „Dávka prečítala …": `1` → „1 stránku", `3` → „3 stránky",
 * `382` → „382 stránok". Slovenčina po slovese žiada iný pád než po číslovke
 * na začiatku vety — jedna fráza pre oba tvary by bola v jednom z nich chybná.
 */
export function pagesAccusativePhrase(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'stránku', 'stránky', 'stránok')}`;
}

/** `1` → „1 deň", `3` → „3 dni", `12` → „12 dní". */
export function daysPhrase(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'deň', 'dni', 'dní')}`;
}

/* ═════════════════════════ 3. Čas ako fráza ═══════════════════════════════ */

/** Deň v doménovej zóne ako porovnateľný kľúč. Formátovač vzniká tu, nie hore. */
function dayKey(at: Date): string {
  return new Intl.DateTimeFormat('sk-SK', {
    timeZone: LOGIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** `04:12` v doménovej zóne. */
function clock(at: Date): string {
  return new Intl.DateTimeFormat('sk-SK', {
    timeZone: LOGIC_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/** `4. 9.` v doménovej zóne. */
export function dayMonth(at: Date): string {
  return new Intl.DateTimeFormat('sk-SK', {
    timeZone: LOGIC_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
  }).format(at);
}

/**
 * HOTOVÁ fráza aj s predložkou — presne to, čo si pýta `BudgetMeter.resetsAt`
 * a čo sa dá vložiť doprostred vety: `o 04:12`, `zajtra o 02:00`, `4. 9. o 02:00`.
 * `null` = čas nepoznáme a veta o ňom sa nemá kresliť vôbec.
 */
export function clockPhrase(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string | null {
  if (value === null || value === undefined || value === '') return null;
  const at = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(at.getTime())) return null;

  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000));
  const when = dayKey(at);
  const time = clock(at);

  if (when === today) return `o ${time}`;
  if (when === tomorrow) return `zajtra o ${time}`;
  return `${dayMonth(at)} o ${time}`;
}

/* ═════════════════ 4. Prekážka → tón vysvetlivky (bod 2) ══════════════════ */

/**
 * Farbu volí TO, KTO prekážku odstráni — nie to, aká je závažná.
 *
 *  · `cakanie`    — nedá sa nič urobiť, appka počká sama → pokojná vysvetlivka.
 *    Vyčerpaný denný rozpočet je `blokuje`, a predsa nie je chyba (K2).
 *  · `sam`/`sudo` — používateľ s tým niečo urobiť MÔŽE → `warn`, aby to našiel.
 *  · `mimo_appky` — z obrazovky sa to vyriešiť nedá → `err`; je to jediná cesta
 *    k červenej na tejto obrazovke a vedie k nej výhradne zastavený zápis (§4).
 */
export function noteVariantForResolution(resolution: BlockerResolution): NoteVariant {
  if (resolution === 'cakanie') return 'info';
  if (resolution === 'mimo_appky') return 'err';
  return 'warn';
}

/**
 * Prekážky, ktoré patria do karty stavu katalógu — sú o KATALÓGU ako celku
 * a s výberom nemajú nič spoločné.
 */
export const CATALOG_PANEL_BLOCKERS: readonly BlockerId[] = [
  'catalog_incomplete',
  'catalog_reads_day_exhausted',
  'catalog_reads_minute_exhausted',
];

/**
 * Prekážky, ktoré patria k VÝBERU — menia sa s každým označeným riadkom, preto
 * stoja nad tabuľkou a nie v karte katalógu. Karta a výber majú zámerne
 * NEPREKRÝVAJÚCE sa zoznamy: tá istá veta na obrazovke dvakrát je šum a pri
 * ďalšej zmene sa jedna z kópií zabudne prepísať.
 */
export const SELECTION_BLOCKERS: readonly BlockerId[] = [
  'scope_unknown',
  'scope_pilot_cap',
  'scope_full_cap',
  'catalog_unknown',
  'catalog_product_missing',
];

/** Vyberie prekážky podľa zoznamu ID a NEZMENÍ ich poradie (`BLOCKER_ORDER`). */
export function pickBlockers(
  blockers: readonly Blocker[],
  ids: readonly BlockerId[],
): readonly Blocker[] {
  return blockers.filter((blocker) => ids.includes(blocker.id));
}

/**
 * Opak `pickBlockers()`. Bočný panel produktu ním vyhadzuje prekážky celého
 * KATALÓGU: veta o tom, že sa dočítava 38 182 produktov, už stojí v karte nad
 * tabuľkou a v paneli o jednom kuse by bola len druhou kópiou.
 */
export function dropBlockers(
  blockers: readonly Blocker[],
  ids: readonly BlockerId[],
): readonly Blocker[] {
  return blockers.filter((blocker) => !ids.includes(blocker.id));
}

/** Slovenské meno obrazovky, kam prekážka vedie. Neznáma cesta = žiadny odkaz. */
export function pathLabel(path: string | null): string | null {
  if (path === '/nastavenia') return 'Nastavenia';
  if (path === '/produkty') return 'Produkty';
  return null;
}

/* ═══════════════════════ 5. Stav katalógu jednou vetou ════════════════════ */

export interface CatalogStateView {
  readonly tone: StatusTone;
  readonly label: string;
  /** Podtitulok pilulky — percento načítaného katalógu, alebo `null`. */
  readonly detail: string | null;
}

/**
 * Jedna veta o tom, v akom stave katalóg je.
 *
 * Tón `critical` tu nevzniká ani pri chybe čítania — červená je v tejto appke
 * vyhradená pre zastavený ZÁPIS (bod 3 v hlavičke). Chybu preto nesie slovo,
 * nie farba.
 */
export function catalogStateView(status: CatalogStatusView | null): CatalogStateView {
  if (status === null) {
    return { tone: 'idle', label: 'Stav katalógu appka práve zisťuje', detail: null };
  }

  const detail = status.percent === null ? null : `${formatCountSk(status.percent)} % katalógu`;

  if (status.loadedProducts === 0) {
    return { tone: 'attention', label: 'Katalóg je zatiaľ prázdny', detail: null };
  }
  if (status.complete) {
    return { tone: 'good', label: 'Katalóg je načítaný celý', detail };
  }
  // Obnova nad celým katalógom NIE JE dopĺňanie — nechýba nič, len sa znova
  // čítajú tie isté stránky. Rovnaká veta ako na Prehľade, inak by dve
  // obrazovky o tom istom stave tvrdili dve rôzne veci.
  if (status.refreshing) {
    return { tone: 'good', label: 'Katalóg je načítaný celý, obnovuje sa', detail };
  }
  if (status.waiting === 'error') {
    return { tone: 'attention', label: 'Načítanie katalógu sa zastavilo', detail };
  }
  if (status.waiting === 'daily_budget') {
    return { tone: 'attention', label: 'Katalóg čaká na denný rozpočet čítaní', detail };
  }
  if (status.waiting === 'rate_limited') {
    return { tone: 'attention', label: 'Katalóg čaká, shop ho spomalil', detail };
  }
  return { tone: 'progress', label: 'Katalóg sa dopĺňa', detail };
}

/* ═════════════ 6. Dve vety, ktoré prekážky nepokrývajú (bod 1) ════════════ */

export interface CatalogWaitingNote {
  readonly variant: NoteVariant;
  readonly what: string;
  readonly nextStep: string;
}

/**
 * Prečo sa čaká — LEN pre dva dôvody, o ktorých `blockers.ts` nevie:
 *
 *  · shop odmietol ďalšie čítanie a appka drží pauzu za celý beh,
 *  · posledný beh spadol a čaká sa na ďalší pokus.
 *
 * Vyčerpaný denný a minútový rozpočet čítaní má vlastné prekážky
 * (`catalog_reads_day_exhausted`, `catalog_reads_minute_exhausted`) a neúplný
 * katalóg tiež (`catalog_incomplete`) — tie sa kreslia z `GET /api/status`
 * a druhá veta o tom istom by sa raz rozišla s prvou.
 */
export function catalogWaitingNote(
  status: CatalogStatusView | null,
  now: Date = new Date(),
): CatalogWaitingNote | null {
  if (status === null) return null;

  const resume = clockPhrase(status.nextBatchAt, now);
  const resumeTail = resume === null ? 'o chvíľu' : resume;

  if (status.waiting === 'rate_limited') {
    return {
      variant: 'info',
      what: 'Shop appke povedal, že si pýta stránky príliš rýchlo, tak celé načítanie na chvíľu zastavila.',
      nextStep: `Netreba robiť nič — ďalšia dávka pôjde ${resumeTail}.`,
    };
  }

  if (status.waiting === 'error') {
    return {
      variant: 'warn',
      what: 'Poslednú dávku katalógu sa nepodarilo prečítať, takže katalóg zostal tam, kde bol.',
      nextStep: `Appka to skúsi sama ${resumeTail}. Ak to bude padať ďalej, skúste tlačidlo Načítať ďalšiu dávku a pozrite Technický detail.`,
    };
  }

  return null;
}

/* ══════════════════ 7. Tri čísla do dlaždíc nad tabuľkou ══════════════════ */

export interface CatalogTileView {
  readonly value: string;
  readonly detail: string;
}

/** Koľko z koľkých je načítaných. Bez čísla zo shopu sa celok NEDOPOČÍTAVA. */
export function loadedTile(status: CatalogStatusView | null): CatalogTileView {
  if (status === null) return { value: '—', detail: 'stav sa načítava' };
  if (status.shopTotalProducts === null) {
    return {
      value: formatCountSk(status.loadedProducts),
      detail: 'koľko ich má shop celkovo, appka zatiaľ nevie',
    };
  }
  return {
    value: formatCountSk(status.loadedProducts),
    detail: `z ${productsPhrase(status.shopTotalProducts)}, ktoré hlási shop`,
  };
}

/** Koľko ešte chýba — a v koľkých stránkach sa to dočíta. */
export function missingTile(status: CatalogStatusView | null): CatalogTileView {
  if (status === null) return { value: '—', detail: 'stav sa načítava' };
  if (status.complete) return { value: '0', detail: 'katalóg je celý' };
  // Obnova: nechýba nič, takže `pagesLeft` sa NESMIE vydávať za zvyšok. Predtým
  // tu stálo „0" a hneď pod tým „382 stránok, na každej 100 produktov".
  if (status.refreshing) return { value: '0', detail: 'katalóg je celý, appka ho obnovuje' };
  if (status.shopTotalProducts === null) {
    return { value: '—', detail: 'bez celkového počtu zo shopu sa to nedá povedať' };
  }
  const missing = Math.max(0, status.shopTotalProducts - status.loadedProducts);
  const pages = status.pagesLeft;
  return {
    value: formatCountSk(missing),
    detail:
      pages === null
        ? 'produktov, ktoré appka ešte nevidí'
        : `${pagesPhrase(pages)}, na každej ${productsPhrase(status.perPage)}`,
  };
}

/** Kedy pôjde ďalšia dávka. */
export function nextBatchTile(
  status: CatalogStatusView | null,
  now: Date = new Date(),
): CatalogTileView {
  if (status === null) return { value: '—', detail: 'stav sa načítava' };
  if (status.complete) return { value: '—', detail: 'netreba, katalóg je celý' };
  const phrase = clockPhrase(status.nextBatchAt, now);
  return {
    value: phrase ?? 'hneď',
    detail:
      phrase === null
        ? 'appka si vypýta ďalšiu stránku pri najbližšom kole'
        : 'kedy si appka vypýta ďalšie stránky',
  };
}

/**
 * Kedy bude katalóg celý. Je to ODHAD, preto značka `≈` (P7) — na rozdiel od
 * „Dáta k …", ktoré je meraný čas.
 */
export function finishTile(status: CatalogStatusView | null): CatalogTileView {
  if (status === null) return { value: '—', detail: 'stav sa načítava' };
  if (status.complete) return { value: 'hotovo', detail: 'nič sa už nedočítava' };
  // Pri obnove nie je čo dokončovať — odhad „ešte 2 dni" by hovoril o katalógu,
  // ktorý appka má celý na disku.
  if (status.refreshing) {
    return { value: 'hotovo', detail: 'katalóg je celý, obnova beží na pozadí' };
  }

  const days = status.estimatedDaysLeft;
  const at = status.estimatedFinishAt === null ? null : new Date(status.estimatedFinishAt);
  const known = at !== null && Number.isFinite(at.getTime());

  if (!known) {
    return { value: '—', detail: 'kým shop nepovie celkový počet, odhad si appka nevymýšľa' };
  }
  return {
    value: `≈ ${dayMonth(at)}`,
    detail:
      days === null || days <= 0
        ? 'ak sa zvyšok zmestí do dnešného rozpočtu čítaní'
        : `pri dnešnom tempe ešte ${daysPhrase(days)}`,
  };
}

/* ═══════════════════ 8. Prečo neprejde PRÁVE tento produkt ════════════════ */

/**
 * Dôvod, ktorý sa viaže na jeden konkrétny riadok katalógu.
 *
 * ZÁMERNE to nie je `Blocker`: `BlockerId` je uzavretý zoznam a patrí
 * `blockers.ts`, ktorý o stave produktu v shope ani o vlastnom zápise appky
 * nevie. Prekážky a tieto dôvody sa preto kreslia vedľa seba a nikdy sa
 * neprekrývajú — prekážka hovorí o operácii, dôvod o kuse.
 */
export interface ProductReason {
  readonly id: 'shop_not_found' | 'shop_unknown' | 'already_discounted';
  /** `attention` = zápis na tento kus neprejde. `neutral` = len to treba vedieť. */
  readonly tone: 'attention' | 'neutral';
  /** Krátky tvar do tabuľky — vedľa mena produktu. */
  readonly short: string;
  /** Celá veta do bočného panela. */
  readonly what: string;
  readonly nextStep: string;
}

/**
 * Dôvody pri jednom riadku. Poradie je od najtvrdšieho po najmäkší a je
 * súčasťou správania — tabuľka kreslí len prvý.
 */
export function productReasons(row: CatalogRowView): readonly ProductReason[] {
  const out: ProductReason[] = [];

  if (row.shopStatus === 'not_found') {
    out.push({
      id: 'shop_not_found',
      tone: 'attention',
      short: 'shop ho nenašiel',
      what: 'Pri poslednom načítaní tento produkt shop nenašiel — možno bol medzitým zmazaný.',
      nextStep: 'Zľava sa naň nezapíše. Odoberte ho z výberu, alebo ho skontrolujte v eshope.',
    });
  }

  if (row.shopStatus === 'unknown') {
    out.push({
      id: 'shop_unknown',
      tone: 'neutral',
      short: 'shop ho zatiaľ nepotvrdil',
      what: 'Či tento produkt shop pozná, appka zatiaľ nevie — pri poslednom načítaní sa to nedozvedela.',
      nextStep: 'Ukáže sa to po ďalšej dávke katalógu; do tej doby to nie je prekážka.',
    });
  }

  if (row.discountedNow) {
    out.push({
      id: 'already_discounted',
      tone: 'neutral',
      short: 'už je v zľave',
      what: 'Podľa vlastných zápisov appky je tento produkt práve v zľave.',
      nextStep:
        'Appka zľavy neruší — počkajte, kým doterajšia skončí, alebo ho zlacnite znova vedome.',
    });
  }

  return out;
}

/** Prvý dôvod pre tabuľku. `null` = riadku nič nevyčítame. */
export function rowReason(row: CatalogRowView): ProductReason | null {
  // „Už je v zľave" tabuľka NEOPAKUJE — stĺpec „Zľava teraz" to hovorí sám
  // a dva rovnaké údaje v jednom riadku sú šum, nie dôraz.
  return productReasons(row).find((reason) => reason.id !== 'already_discounted') ?? null;
}

/* ═════════════════════ 9. Prázdna tabuľka, ktorá radí ═════════════════════ */

/** Má filter vôbec nejakú podmienku? Prázdna tabuľka bez filtra je iný príbeh. */
export function filterIsNarrowed(filter: CatalogFilterState): boolean {
  return (
    filter.query.trim() !== '' ||
    filter.soldBuckets.length > 0 ||
    filter.priceFrom.trim() !== '' ||
    filter.priceTo.trim() !== '' ||
    filter.currentlyDiscounted ||
    filter.neverDiscounted
  );
}

export interface CatalogEmptyView {
  readonly title: string;
  readonly description: string;
  /** `true` = má zmysel ponúknuť načítanie ďalšej dávky priamo tu. */
  readonly offerLoad: boolean;
}

/**
 * Prázdna tabuľka povie, ČO tam má byť a AKO sa to tam dostane — nikdy „žiadne
 * dáta" (`EmptyState`, bod 1 jeho hlavičky). Rozlišujú sa tri príbehy a každý
 * má iný ďalší krok:
 *
 *  1. katalóg je prázdny — nie je z čoho vyberať,
 *  2. filter nenašiel nič a katalóg je NEÚPLNÝ — hľadaný kus môže byť medzi
 *     nenačítanými a používateľ to musí vedieť, inak si myslí, že neexistuje,
 *  3. filter nenašiel nič nad úplným katalógom — vtedy je vinný filter.
 */
export function catalogEmptyView(opts: {
  readonly narrowed: boolean;
  readonly status: CatalogStatusView | null;
}): CatalogEmptyView {
  const { narrowed, status } = opts;
  const loaded = status?.loadedProducts ?? null;
  const total = status?.shopTotalProducts ?? null;
  const missing = loaded !== null && total !== null ? Math.max(0, total - loaded) : null;

  if (loaded === 0) {
    return {
      title: 'Katalóg je zatiaľ prázdny',
      description:
        'Appka nemá zo shopu načítaný ani jeden produkt, takže nie je z čoho vyberať. Prvá dávka načíta stovku produktov a ďalšie si appka doberá sama.',
      offerLoad: true,
    };
  }

  if (missing !== null && missing > 0) {
    return {
      title: narrowed
        ? 'Medzi načítanými produktmi nič takéto nie je'
        : 'Tu zatiaľ nie je čo ukázať',
      description: narrowed
        ? `Appka má načítaných ${formatCountSk(loaded ?? 0)} z ${productsPhrase(total ?? 0)} a ${formatCountSk(missing)} ešte nevidí — to, čo hľadáte, môže byť medzi nimi. Uvoľnite niektorú podmienku vľavo, alebo počkajte, kým sa katalóg dočíta.`
        : `Appka má načítaných ${formatCountSk(loaded ?? 0)} z ${productsPhrase(total ?? 0)}. Zvyšok si doberá sama; skúste to o chvíľu znova.`,
      offerLoad: true,
    };
  }

  if (narrowed) {
    return {
      title: 'Filtru nevyhovuje ani jeden produkt',
      description:
        'Katalóg je načítaný celý, takže to nie je neúplnými dátami. Uvoľnite niektorú podmienku vľavo alebo vymažte text v hľadaní.',
      offerLoad: false,
    };
  }

  return {
    title: 'Tu zatiaľ nie je čo ukázať',
    description:
      'Katalóg sa načítava. Keď v ňom pribudnú produkty, objavia sa v tejto tabuľke samy.',
    offerLoad: true,
  };
}

/* ═══════════════ 10. Čo urobilo tlačidlo „Načítať ďalšiu dávku" ═══════════ */

/**
 * Odpoveď na kliknutie musí byť VIDIEŤ — aj keď sa nič nenačítalo. Tlačidlo,
 * po ktorom sa nič nestane a nič sa nepovie, je horšie než žiadne tlačidlo:
 * používateľ ho stlačí päťkrát a myslí si, že appka zamrzla.
 */
export function runOutcomeNote(run: CatalogRunView, now: Date = new Date()): CatalogWaitingNote {
  const resume = clockPhrase(run.resumeAt, now);
  const resumeTail = resume === null ? 'o chvíľu' : resume;

  switch (run.outcome) {
    case 'ran':
      return {
        variant: 'info',
        what:
          run.products === 0
            ? 'Dávka prebehla, ale nič nové nepribudlo.'
            : `Dávka prečítala ${pagesAccusativePhrase(run.pages)} a pridala ${productsPhrase(run.products)}.`,
        nextStep: 'Zvyšok si appka doberá sama, netreba na to klikať.',
      };
    case 'already_running':
      return {
        variant: 'info',
        what: 'Načítanie katalógu práve beží.',
        nextStep: 'Počkajte, kým dobehne — dva behy naraz by si prepisovali pokrok.',
      };
    case 'too_soon':
      return {
        variant: 'info',
        what: 'Ďalšia dávka je príliš skoro po tej poslednej.',
        nextStep: `Skúste to ${resumeTail}; rýchlejšie by shop čítania odmietol.`,
      };
    case 'peak_hours':
      return {
        variant: 'info',
        what: 'Cez deň appka katalóg zámerne nečíta, aby eshopu nebrala kapacitu.',
        nextStep: `Ďalšia dávka pôjde ${resumeTail}.`,
      };
    case 'writes_first':
      return {
        variant: 'info',
        what: 'Prednosť má práve bežiaci zápis zliav — čítanie katalógu mu neberie miesto.',
        nextStep: 'Katalóg sa dočíta hneď, ako fronta zápisov dobehne.',
      };
    case 'budget_exhausted':
      return {
        variant: 'info',
        what: 'Dnešný rozpočet čítaní je minutý, takže sa ďalšia stránka nepýtala.',
        nextStep: `Rozpočet sa obnoví ${resumeTail} a appka pokračuje sama.`,
      };
    case 'paused':
      return {
        variant: 'info',
        what: 'Shop appku spomalil, tak drží pauzu.',
        nextStep: `Pokračuje sa ${resumeTail}, netreba robiť nič.`,
      };
    case 'failed':
      return {
        variant: 'warn',
        what: 'Dávku sa nepodarilo prečítať a katalóg zostal tam, kde bol.',
        nextStep: 'Skúste to o chvíľu znova; kód poslednej chyby je v Technickom detaile.',
      };
  }
}
