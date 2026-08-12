/**
 * Aura Zľavy — JEDINÝ ZDROJ PRAVDY O TOM, ČO PRÁVE BLOKUJE ČO.
 *
 * Používateľ sa sťažoval, že nevidí, PREČO sa niečo nestalo: produkt neprejde,
 * fronta nebeží, katalóg sa nedočíta — a appka mlčí. Dôvody pritom v kóde
 * existujú, len sú rozsypané po ôsmich moduloch (`engine/guards.ts`,
 * `engine/budget.ts`, `repo/settings.repo.ts`, `repo/api-key.repo.ts`,
 * `shop/catalog-sync.ts`, `shop/rate-limits.ts`, `env.ts`, `scheduler/queue.ts`)
 * a každý z nich hovorí vlastným jazykom. Tento modul z nich robí JEDEN zoznam
 * prekážok, ktorý UI už len vykreslí.
 *
 * ČO TENTO MODUL JE A ČO NIE JE
 * -----------------------------
 * Je **čistý**: žiadna DB, žiadny fetch, žiadne `process.env`, žiadne
 * vyhodnocovanie na module scope. Dostane jeden `StatusSnapshot` (fakty, ktoré
 * si volajúci prečítal) a vráti zoznam `Blocker`-ov. Nič nerozhoduje o zápise —
 * o tom rozhoduje `engine/guards.ts`. Tento modul len POMENÚVA, čo tá brána
 * urobí a prečo, aby sa to používateľ dozvedel skôr než z logu.
 *
 * FAIL-CLOSED JE TU PRAVIDLO, NIE VÝNIMKA
 * ---------------------------------------
 * Chýbajúci alebo neznámy údaj sa VŽDY vyhodnotí prísnejšie, nikdy voľnejšie —
 * presne ako v `guards.resolveScope()` („neviem" = `pilot`) a v
 * `budget.resolveDailyBudget()` („neviem" = 1 zápis na deň). Prázdny snapshot
 * preto nevráti „všetko je v poriadku", ale plný zoznam prekážok, kde každá
 * nesie `assumed: true` — veta stojí na domnienke, nie na overenom fakte.
 *
 * Jediná dokumentovaná výnimka je sekcia `catalogReads`: čítací rozpočet
 * katalógu NEBRÁNI zápisu (čítania idú bez kľúča, na inú kvótu — viď
 * `shop/rate-limits.ts`), takže keď sa naň volajúci nepýta (sekcia v snapshote
 * vôbec nie je), modul o ňom mlčí. Keď sa pýta a hodnoty nepozná, platí
 * fail-closed ako všade inde.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *  1. **Veta musí niesť čísla.** Nie „limit prekročený", ale „v pilotnom režime
 *     prejde 10 produktov, vo výbere je 150". Bez čísel je to zase log.
 *  2. **`severity` NIE JE farba.** `blokuje` znamená „teraz cez to nič
 *     neprejde", nie „červená". Vyčerpaný denný rozpočet je `blokuje` +
 *     `resolution: 'cakanie'`, a `ui/vocabulary.ts` mu dáva neutrálny tón (K2,
 *     odpoveď 59) — UI si farbu volí podľa `resolution`, nie podľa závažnosti.
 *  3. **`resolution === 'cakanie'` ⟺ `passableNow === false`.** Kto tvrdí, že sa
 *     čaká, musí povedať aj na čo (`clearsAt`), a naopak.
 *  4. **Čísla sa neduplikujú, importujú sa.** Limity čítania prichádzajú
 *     z `@/lib/shop/rate-limits` — tam sa raz na tejto zámene („300 za deň" vs
 *     „300 za minútu") rozbil celý katalóg a druhá kópia by to zopakovala.
 *
 * PREČO SÚ TU PREDSA PÄŤ ZRKADLENÝCH KONŠTÁNT
 * -------------------------------------------
 * `PILOT_MAX_PRODUCTS`, `HARD_MAX_PRODUCTS`, `FAIL_CLOSED_DAILY_BUDGET`,
 * `API_KEY_MAX_TTL_HOURS` a `CATALOG_PAGE_SIZE` žijú v moduloch, ktoré ťahajú
 * `@/db/pool`, a s ním `mariadb` a `node:fs`. Tento modul musí zostať
 * použiteľný aj v client komponente (rovnako ako `ui/vocabulary.ts`), takže si
 * ich zrkadlí ako lokálne konštanty. Aby sa kópie nerozišli, zhodu čísel
 * kontroluje `test/unit/status-blockers.spec.ts` — importuje ORIGINÁLY a
 * porovná ich s tunajšími. Rozídenie hodnôt zhodí test, nie produkciu.
 *
 * Vlastník: S1.
 */
import type { DateOnly } from '@/contracts';
import type { ScopeMode } from '@/lib/repo/settings.repo';

import {
  ANON_READS_PER_MINUTE,
  ANON_READS_PER_UTC_DAY,
  SHOP_ANON_LIMIT,
  anonReadDaysNeeded,
  nextUtcDayReset,
} from '@/lib/shop/rate-limits';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ══════════════════ 1. Zrkadlené konštanty (stráži ich test) ═══════════════ */

/** Zhoda s `PILOT_MAX_PRODUCTS` v `repo/settings.repo.ts` (K1). */
export const PILOT_MAX_PRODUCTS = 10;

/** Zhoda s `HARD_MAX_PRODUCTS` v `repo/settings.repo.ts` (`ck_settings_max_products`). */
export const HARD_MAX_PRODUCTS = 10_000;

/** Zhoda s `FAIL_CLOSED_DAILY_BUDGET` v `engine/budget.ts` — „neviem" = 1/deň. */
export const FAIL_CLOSED_DAILY_BUDGET = 1;

/** Zhoda s `API_KEY_MAX_TTL_HOURS` v `repo/api-key.repo.ts` (R2). */
export const API_KEY_MAX_TTL_HOURS = 48;

/** Zhoda s `CATALOG_PAGE_SIZE` v `shop/catalog-sync.ts` — stránka katalógu. */
export const CATALOG_PAGE_SIZE = 100;

/**
 * Od koľkých zostávajúcich hodín sa o platnosti kľúča hovorí nahlas. Nie je to
 * limit shopu, je to rozhodnutie povrchu: pod pol dňa už má zmysel kľúč
 * vymeniť skôr, než sa fronta zastaví uprostred noci.
 */
export const KEY_WARNING_HOURS = 12;

/**
 * Minútový strop shopu je KLZAVÉ okno a jeho začiatok appka nepozná. Najhorší
 * možný prípad je celá minúta od teraz — a fail-closed sa hovorí najhorší
 * prípad, nie ten pekný.
 */
const MINUTE_MS = 60_000;

/** Koľko ID sa vypíše do vety, kým sa začne písať „a ďalšie". */
const SAMPLE_IDS = 5;

/* ═══════════════════════════════ 2. Typy ══════════════════════════════════ */

/**
 * Závažnosť prekážky.
 *
 *  - `blokuje`    — teraz cez to neprejde nič (produkt sa nezapíše, fronta stojí),
 *  - `obmedzuje`  — časť prejde, časť nie (alebo prejde pomalšie),
 *  - `informuje`  — nič nezastavuje, ale patrí to do obrazu (napr. platný strop).
 */
export type BlockerSeverity = 'blokuje' | 'obmedzuje' | 'informuje';

/** Oblasť, z ktorej prekážka pochádza — UI podľa nej zoskupuje. */
export type BlockerArea = 'zapisy' | 'kluc' | 'rozpocet' | 'rozsah' | 'katalog' | 'citanie';

/** Čoho sa prekážka týka: celej operácie, alebo konkrétnych produktov. */
export type BlockerSubject = 'operacia' | 'produkt';

/**
 * Ako sa prekážka odstráni.
 *
 *  - `sam`        — používateľ to vyrieši sám v appke (`path`),
 *  - `sudo`       — cesta v appke existuje, ale vyžiada si heslo (sudo okno),
 *  - `cakanie`    — nedá sa urobiť nič, čaká sa (`clearsAt`),
 *  - `mimo_appky` — rieši sa mimo appky (konfigurácia počítača).
 */
export type BlockerResolution = 'sam' | 'sudo' | 'cakanie' | 'mimo_appky';

/**
 * Stabilné ID prekážky. Je to KĽÚČ, nie text — na povrch sa nikdy nevypisuje
 * (K10), UI podľa neho páruje ikonu, poradie a prípadný vlastný widget.
 */
export type BlockerId =
  | 'writes_disabled'
  | 'key_missing'
  | 'key_expired'
  | 'key_expires_soon'
  | 'write_budget_exhausted'
  | 'write_budget_low'
  | 'scope_unknown'
  | 'scope_pilot_cap'
  | 'scope_full_cap'
  | 'catalog_unknown'
  | 'catalog_product_missing'
  | 'catalog_incomplete'
  | 'catalog_reads_day_exhausted'
  | 'catalog_reads_minute_exhausted';

/**
 * Kanonické poradie prekážok v rámci rovnakej závažnosti. Zoznam je zámerne
 * ručný, nie abecedný: hore je to, čo zastaví VŠETKO (vypnuté zápisy, chýbajúci
 * kľúč), dole to, čo len spomaľuje. Poradie je súčasťou správania a testuje sa —
 * UI ho nesmie prehadzovať.
 */
export const BLOCKER_ORDER: readonly BlockerId[] = [
  'writes_disabled',
  'key_missing',
  'key_expired',
  'write_budget_exhausted',
  'scope_unknown',
  'scope_pilot_cap',
  'scope_full_cap',
  'catalog_unknown',
  'catalog_product_missing',
  'catalog_incomplete',
  'write_budget_low',
  'key_expires_soon',
  'catalog_reads_day_exhausted',
  'catalog_reads_minute_exhausted',
];

/** Poradie závažností. Nižšie číslo = vyššie v zozname. */
export const SEVERITY_ORDER: Readonly<Record<BlockerSeverity, number>> = {
  blokuje: 0,
  obmedzuje: 1,
  informuje: 2,
};

/**
 * Cesty v appke, kam prekážky vedú. Jediné miesto, kde sa píšu ako reťazce —
 * a zámerne sú tu len tie, ktoré niektorá prekážka naozaj používa. Cesta, ktorú
 * nikam nevedie žiadna prekážka, by bola sľub, čo tento modul nedrží.
 */
export const BLOCKER_PATHS = {
  settings: '/nastavenia',
  products: '/produkty',
} as const;

/** Jedna prekážka — jeden riadok v zozname „čo práve blokuje čo". */
export interface Blocker {
  readonly id: BlockerId;
  readonly area: BlockerArea;
  readonly severity: BlockerSeverity;
  /** Či ide o prekážku celej operácie, alebo konkrétnych produktov. */
  readonly subject: BlockerSubject;
  /** Ktorých produktov sa týka. Prázdne pole pri `subject === 'operacia'`. */
  readonly productIds: readonly number[];
  /** ČO sa deje — slovenská veta s konkrétnymi číslami. */
  readonly what: string;
  /** ČO S TÝM — konkrétny ďalší krok, slovensky. */
  readonly nextStep: string;
  /** Kam v appke to vedie. `null` = v appke sa to vyriešiť nedá. */
  readonly path: string | null;
  /** Kto a ako prekážku odstráni. */
  readonly resolution: BlockerResolution;
  /** `true` = dá sa prekonať hneď. `false` = musí sa počkať (viď `clearsAt`). */
  readonly passableNow: boolean;
  /** Kedy sa prekážka sama uvoľní. `null` = čas s ňou nepohne. */
  readonly clearsAt: Date | null;
  /**
   * `true` = veta stojí na fail-closed domnienke, lebo údaj chýbal alebo bol
   * neznámy. UI to MÁ priznať — appka sa nesmie tváriť, že niečo vie.
   */
  readonly assumed: boolean;
}

/* ─────────────────────────── vstupný snapshot ─────────────────────────── */

/**
 * Poistky zápisu z `env.ts`. `enabled` je celé `writesAllowedByEnv()`, teda
 * `NODE_ENV=production && WRITES_ENABLED=true` (I13, D77) — nie samotná
 * premenná, aby sa polovica poistky nedala prehliadnuť.
 */
export interface WritesSnapshot {
  /** `null`/chýba = nevieme → fail-closed sa berie ako vypnuté. */
  readonly enabled?: boolean | null;
}

/** Rozsah podľa `guards.readScopeForWrite()` / `settingsRepo.readScope()` (K1). */
export interface ScopeSnapshot {
  /** `null`/chýba = nevieme → fail-closed `pilot`. */
  readonly mode?: ScopeMode | null;
  /** Efektívny strop na jednu operáciu (`ResolvedScope.maxProducts`). */
  readonly maxProducts?: number | null;
  /** `true` = hodnoty sú fail-closed default, nie čítanie z DB (K1 bod 1). */
  readonly failClosed?: boolean | null;
}

/** Čo sa práve chystá zapísať. */
export interface SelectionSnapshot {
  /** Koľko produktov operácia chce zapísať. Chýba = dopočíta sa z `productIds`. */
  readonly selectedCount?: number | null;
  /** Konkrétne ID vo výbere (voliteľné — pri veľkých výberoch sa neposielajú). */
  readonly productIds?: readonly number[] | null;
}

/** Stav zrkadla katalógu (`catalog_cache`, K7 + K1 bod 2). */
export interface CatalogSnapshot {
  /** Koľko riadkov katalóg appky má (`catalogRepo.totalRows()`). */
  readonly loadedProducts?: number | null;
  /** Koľko produktov hlási shop (`CatalogSyncResult.total`). */
  readonly shopTotalProducts?: number | null;
  /**
   * Vybrané ID, ktoré v katalógu nie sú alebo ich shop nenašiel (`not_found`).
   * Prázdne pole = overené, nechýba nič. `null`/chýba = NEOVERENÉ (fail-closed).
   */
  readonly missingProductIds?: readonly number[] | null;
}

/** Denný zápisový rozpočet (`BudgetStatus` z `engine/budget.ts`, K2). */
export interface WriteBudgetSnapshot {
  readonly budget?: number | null;
  readonly spent?: number | null;
  /** UTC deň, za ktorý sa počítalo (`YYYY-MM-DD`). */
  readonly day?: DateOnly | null;
}

/** Kľúč na zápis do shopu (`apiKeyRepo.getMeta()`, R2/D63). */
export interface ApiKeySnapshot {
  /** `null`/chýba = nevieme → fail-closed sa berie, že kľúč nie je. */
  readonly present?: boolean | null;
  /** Dokedy platí. `null` pri chýbajúcom kľúči; neznáme pri vloženom = prísnejšie. */
  readonly expiresAt?: Date | null;
}

/**
 * Čítací rozpočet katalógu (anonymné volania, `shop/rate-limits.ts`).
 *
 * Sekcia je ZÁMERNE opt-in: čítanie katalógu ide bez kľúča a na inú kvótu než
 * zápisy, takže vyčerpané čítania NEBRÁNIA zápisu. Keď sa volajúci na katalóg
 * nepýta, sekciu neposiela a modul o nej mlčí.
 */
export interface CatalogReadsSnapshot {
  /** Koľko anonymných čítaní odišlo za poslednú minútu. */
  readonly usedThisMinute?: number | null;
  /** Koľko ich odišlo za aktuálny UTC deň. */
  readonly usedThisUtcDay?: number | null;
}

/**
 * Všetko, čo modul potrebuje vedieť. Každá sekcia je voliteľná a každá chýbajúca
 * hodnota znamená „neviem" — a „neviem" sa vyhodnotí prísnejšie.
 */
export interface StatusSnapshot {
  /** Referenčný čas. Default `new Date()`; testy si posielajú vlastný. */
  readonly now?: Date;
  readonly writes?: WritesSnapshot;
  readonly apiKey?: ApiKeySnapshot;
  readonly writeBudget?: WriteBudgetSnapshot;
  readonly scope?: ScopeSnapshot;
  readonly selection?: SelectionSnapshot;
  readonly catalog?: CatalogSnapshot;
  readonly catalogReads?: CatalogReadsSnapshot;
}

/** Zhrnutie zoznamu — jedna odpoveď na otázku „ide to, alebo nie?". */
export interface BlockerSummary {
  /** Celý zoznam, zoradený podľa závažnosti (`sortBlockers`). */
  readonly blockers: readonly Blocker[];
  /** Len tie, cez ktoré teraz neprejde nič. */
  readonly blocking: readonly Blocker[];
  /** `true` = aspoň jedna prekážka má závažnosť `blokuje`. */
  readonly blocked: boolean;
  /** Najbližší čas, keď sa niečo pohne samo. `null` = čakaním sa nič nezmení. */
  readonly waitUntil: Date | null;
}

/* ═══════════════════ 3. Pomocníci (čísla, slovenčina) ═════════════════════ */

/** Celé nezáporné číslo, alebo `null` pri čomkoľvek, čo sa nedá prečítať. */
function readCount(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  return truncated < 0 ? null : truncated;
}

/** Boolean, alebo `null` pri čomkoľvek inom (vrátane `undefined`). */
function readFlag(value: boolean | null | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Platný `Date`, alebo `null`. `Invalid Date` je „neviem", nie čas. */
function readDate(value: Date | null | undefined): Date | null {
  if (!(value instanceof Date)) return null;
  return Number.isFinite(value.getTime()) ? value : null;
}

/** `1` → „1 produkt", `3` → „3 produkty", `150` → „150 produktov". */
function products(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'produkt', 'produkty', 'produktov')}`;
}

/** Sloveso „je"/„sú" podľa slovenskej zhody (2–4 → „sú"). */
function isAre(count: number): string {
  return count >= 2 && count <= 4 ? 'sú' : 'je';
}

/** „zvyšný 1 sa nezapíše" / „zvyšné 3 sa nezapíšu" / „zvyšných 140 sa nezapíše". */
function remainderPhrase(count: number): string {
  const adjective = pluralSk(count, 'zvyšný', 'zvyšné', 'zvyšných');
  const verb = count >= 2 && count <= 4 ? 'nezapíšu' : 'nezapíše';
  return `${adjective} ${formatCountSk(count)} sa ${verb}`;
}

/** „1 deň" / „3 dni" / „12 dní". */
function days(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'deň', 'dni', 'dní')}`;
}

/** „1 hodinu" / „3 hodiny" / „12 hodín" — akuzatív do „platí ešte …". */
function hoursAccusative(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'hodinu', 'hodiny', 'hodín')}`;
}

/** Vzorka ID do vety; nad `SAMPLE_IDS` sa dopíše, koľko ďalších je. */
function sampleIds(ids: readonly number[]): string {
  const shown = ids.slice(0, SAMPLE_IDS).join(', ');
  const rest = ids.length - SAMPLE_IDS;
  return rest > 0 ? `${shown} a ďalších ${formatCountSk(rest)}` : shown;
}

/** Celé hodiny medzi dvoma časmi (vždy nezáporné). */
function hoursBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 3_600_000));
}

/**
 * Koľko ĎALŠÍCH UTC dní bude fronta bežať. Zámerne rovnaká aritmetika ako
 * `estimateFinish()` v `engine/budget.ts` (ktorý sa sem nedá importovať —
 * ťahá `@/db/pool`); zhodu výsledkov stráži test.
 */
function daysToFinish(pending: number, perDay: number, remainingToday: number): number {
  if (pending <= 0) return 0;
  const speed = Math.max(1, perDay);
  const today = Math.min(speed, Math.max(0, remainingToday));
  if (pending <= today) return 0;
  return Math.ceil((pending - today) / speed);
}

/** Spoločný tvar „nemusíte nič robiť, pokračuje to samo". */
const WAIT_STEP = 'Netreba robiť nič — pokračuje to samo';

/* ═════════════════ 4. Normalizácia snapshotu (fail-closed) ════════════════ */

interface ResolvedScope {
  readonly mode: ScopeMode;
  /** `false` = režim sme neprečítali, platí fail-closed `pilot` (K1 bod 1). */
  readonly known: boolean;
  /** Efektívny strop na jednu operáciu (v `pilot` vždy 10). */
  readonly maxProducts: number;
  /** `true` = strop je fail-closed náhrada, nie hodnota z nastavení. */
  readonly capAssumed: boolean;
}

/**
 * Rozsah presne podľa `guards.resolveScope()` a `settings.effectiveMaxProducts()`:
 * čokoľvek iné než vedome prečítané `plny` je `pilot` so stropom 10, a strop
 * v `plny` sa zastropuje tvrdým DB stropom.
 */
function resolveScope(scope: ScopeSnapshot | undefined): ResolvedScope {
  const failClosed = readFlag(scope?.failClosed) === true;
  const mode = scope?.mode;
  const knownMode = mode === 'pilot' || mode === 'plny';

  if (!knownMode || failClosed || mode === 'pilot') {
    return {
      mode: 'pilot',
      known: knownMode && !failClosed,
      // V `pilot` je strop 10 vždy — nie je to náhrada, je to samotné pravidlo.
      maxProducts: PILOT_MAX_PRODUCTS,
      capAssumed: false,
    };
  }

  const raw = readCount(scope?.maxProducts);
  const capKnown = raw !== null && raw >= 1;
  const maxProducts = capKnown ? Math.min(HARD_MAX_PRODUCTS, raw) : PILOT_MAX_PRODUCTS;
  return { mode: 'plny', known: true, maxProducts, capAssumed: !capKnown };
}

/** Koľko produktov je vo výbere. `null` = volajúci to nepovedal. */
function resolveSelectedCount(selection: SelectionSnapshot | undefined): number | null {
  const explicit = readCount(selection?.selectedCount);
  if (explicit !== null) return explicit;
  const ids = selection?.productIds;
  return Array.isArray(ids) ? ids.length : null;
}

/* ═══════════════════ 5. Jednotlivé oblasti prekážok ═══════════════════════ */

/** 5.1 — env poistky zápisu (I13, D77). Bez nich sa nezapíše nič. */
function writesBlockers(snapshot: StatusSnapshot): Blocker[] {
  const enabled = readFlag(snapshot.writes?.enabled);
  if (enabled === true) return [];
  const assumed = enabled === null;

  return [
    {
      id: 'writes_disabled',
      area: 'zapisy',
      severity: 'blokuje',
      subject: 'operacia',
      productIds: [],
      what: assumed
        ? 'Nevieme overiť, či má appka zápisy do shopu vôbec zapnuté — kým to nevieme, počíta s tým, že sú vypnuté, a nezapíše ani jeden produkt.'
        : 'Zápisy do shopu sú vypnuté — appka teraz nezapíše ani jeden produkt, nech je vo výbere čokoľvek.',
      nextStep:
        'Zapnúť ich môže len správca počítača v konfigurácii appky; z obrazovky sa to prepnúť nedá.',
      path: null,
      resolution: 'mimo_appky',
      passableNow: true,
      clearsAt: null,
      assumed,
    },
  ];
}

/** 5.2 — kľúč na zápis: či je vložený a dokedy platí (R2, D63). */
function keyBlockers(snapshot: StatusSnapshot, now: Date, pending: number | null): Blocker[] {
  const present = readFlag(snapshot.apiKey?.present);
  const expiresAt = readDate(snapshot.apiKey?.expiresAt);

  if (present !== true) {
    const assumed = present === null;
    return [
      {
        id: 'key_missing',
        area: 'kluc',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        what: assumed
          ? 'Nevieme, či je kľúč na zápis do shopu vložený — kým to nevieme, appka počíta s tým, že chýba, a nezapisuje.'
          : 'Kľúč na zápis do shopu nie je vložený — bez neho sa nedá zapísať ani jeden produkt.',
        nextStep: `Vložte kľúč v Nastaveniach (platí ${API_KEY_MAX_TTL_HOURS} hodín); fronta potom plynulo pokračuje tam, kde stojí.`,
        path: BLOCKER_PATHS.settings,
        resolution: 'sam',
        passableNow: true,
        clearsAt: null,
        assumed,
      },
    ];
  }

  // Kľúč je vložený, ale nevieme dokedy platí. Fail-closed: berieme to tak, že
  // dopadol rovnako ako expirovaný — `api-key.repo` ho pri prvom použití aj tak
  // lazy skontroluje a prípadne wipne (D63).
  if (expiresAt === null) {
    return [
      {
        id: 'key_expired',
        area: 'kluc',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        what: 'Kľúč na zápis je vložený, ale nevieme, dokedy platí — kým to nevieme, appka s ním nepočíta.',
        nextStep: `Vložte kľúč v Nastaveniach znova; platnosť je ${API_KEY_MAX_TTL_HOURS} hodín od vloženia.`,
        path: BLOCKER_PATHS.settings,
        resolution: 'sam',
        passableNow: true,
        clearsAt: null,
        assumed: true,
      },
    ];
  }

  if (expiresAt.getTime() <= now.getTime()) {
    const ago = hoursBetween(expiresAt, now);
    const agoText = ago < 1 ? 'pred chvíľou' : `pred ${hoursAccusative(ago)}`;
    return [
      {
        id: 'key_expired',
        area: 'kluc',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        what: `Kľúč na zápis do shopu expiroval ${agoText} — appka ho už nepoužije.`,
        nextStep: `Vložte nový kľúč v Nastaveniach; platí ${API_KEY_MAX_TTL_HOURS} hodín od vloženia.`,
        path: BLOCKER_PATHS.settings,
        resolution: 'sam',
        passableNow: true,
        clearsAt: null,
        assumed: false,
      },
    ];
  }

  const hoursLeft = hoursBetween(now, expiresAt);
  const budget = snapshot.writeBudget;
  const perDay = readCount(budget?.budget);
  const spent = readCount(budget?.spent);
  const remainingToday = perDay !== null && spent !== null ? Math.max(0, perDay - spent) : null;

  // K6 — fronta, ktorá beží dlhšie než platnosť kľúča, sa o kľúč zastaví.
  const needsDays =
    pending !== null && perDay !== null && remainingToday !== null
      ? daysToFinish(pending, perDay, remainingToday)
      : 0;
  const outlivesKey = needsDays > 0 && hoursLeft < needsDays * 24;

  if (!outlivesKey && hoursLeft >= KEY_WARNING_HOURS) return [];

  return [
    {
      id: 'key_expires_soon',
      area: 'kluc',
      severity: outlivesKey ? 'obmedzuje' : 'informuje',
      subject: 'operacia',
      productIds: [],
      what: outlivesKey
        ? `Kľúč na zápis platí ešte ${hoursAccusative(hoursLeft)}, ale fronta ${products(pending ?? 0)} potrvá pri ${formatCountSk(perDay ?? 0)} zápisoch na deň ešte ${days(needsDays)} — kľúč dovtedy vyprší a fronta sa zastaví.`
        : `Kľúč na zápis platí ešte ${hoursAccusative(hoursLeft)}.`,
      nextStep: outlivesKey
        ? 'Vložte nový kľúč v Nastaveniach skôr, než tento vyprší — inak fronta počká na kľúč a odloží zvyšok na neskôr.'
        : 'Keď vyprší, vložte v Nastaveniach nový; dovtedy sa nič nedeje.',
      path: BLOCKER_PATHS.settings,
      resolution: 'sam',
      passableNow: true,
      clearsAt: null,
      assumed: false,
    },
  ];
}

/** 5.3 — denný zápisový rozpočet (K2): 200 zápisov na UTC deň z auditu. */
function writeBudgetBlockers(
  snapshot: StatusSnapshot,
  now: Date,
  pending: number | null,
): Blocker[] {
  const perDay = readCount(snapshot.writeBudget?.budget);
  const spent = readCount(snapshot.writeBudget?.spent);
  const day = typeof snapshot.writeBudget?.day === 'string' ? snapshot.writeBudget.day : null;
  const dayNote = day === null ? '' : ` (UTC deň ${day})`;
  const reset = nextUtcDayReset(now);

  // Fail-closed presne ako `resolveDailyBudget()`: „neviem, koľko som už minul"
  // je najprísnejší stav, teda vyčerpaný rozpočet — nie voľná ruka.
  if (perDay === null || spent === null) {
    return [
      {
        id: 'write_budget_exhausted',
        area: 'rozpocet',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        what: `Nevieme, koľko zápisov dnes už odišlo${dayNote} — kým to nevieme, appka počíta s tým, že denný rozpočet je vyčerpaný, a ďalej nezapisuje. Bezpečný predpoklad je ${FAIL_CLOSED_DAILY_BUDGET} zápis na deň.`,
        nextStep: `${WAIT_STEP}: rozpočet sa obnoví o polnoci UTC a fronta pokračuje sama.`,
        path: null,
        resolution: 'cakanie',
        passableNow: false,
        clearsAt: reset,
        assumed: true,
      },
    ];
  }

  const remaining = Math.max(0, perDay - spent);

  if (remaining === 0) {
    return [
      {
        id: 'write_budget_exhausted',
        area: 'rozpocet',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        what: `Dnešný rozpočet zápisov je vyčerpaný${dayNote} — minutých je ${formatCountSk(spent)} z ${formatCountSk(perDay)}, ktoré shop pustí za jeden UTC deň.`,
        nextStep: `${WAIT_STEP}: rozpočet sa obnoví o polnoci UTC a fronta pokračuje presne tam, kde skončila.`,
        path: null,
        resolution: 'cakanie',
        passableNow: false,
        clearsAt: reset,
        assumed: false,
      },
    ];
  }

  if (pending === null || pending <= remaining) return [];

  const needsDays = daysToFinish(pending, perDay, remaining);
  const later = pending - remaining;
  return [
    {
      id: 'write_budget_low',
      area: 'rozpocet',
      severity: 'obmedzuje',
      subject: 'operacia',
      productIds: [],
      what: `Dnes sa zmestí ešte ${formatCountSk(remaining)} zápisov${dayNote}, vo výbere ${isAre(pending)} ${products(pending)} — ${formatCountSk(later)} z nich sa dnes nezapíše.`,
      nextStep: `${WAIT_STEP}: fronta pokračuje každý deň sama, hotovo bude približne o ${days(needsDays)}.`,
      path: null,
      resolution: 'cakanie',
      passableNow: false,
      clearsAt: reset,
      assumed: false,
    },
  ];
}

/** 5.4 — režim rozsahu (K1): `pilot` stropuje na 10, `plny` na uložený strop. */
function scopeBlockers(scope: ResolvedScope, selected: number | null): Blocker[] {
  const list: Blocker[] = [];

  if (!scope.known) {
    list.push({
      id: 'scope_unknown',
      area: 'rozsah',
      severity: 'obmedzuje',
      subject: 'operacia',
      productIds: [],
      what: `Nastavenia rozsahu sa nepodarilo prečítať — appka preto beží v najprísnejšom, pilotnom režime so stropom ${products(PILOT_MAX_PRODUCTS)} na jednu zľavu.`,
      nextStep:
        'Skúste obrazovku o chvíľu obnoviť; kým je režim neznámy, appka nepustí viac než pilotný strop, aj keby bol v Nastaveniach uložený vyšší.',
      path: BLOCKER_PATHS.settings,
      resolution: 'sam',
      passableNow: true,
      clearsAt: null,
      assumed: true,
    });
  }

  const pilot = scope.mode === 'pilot';
  const id: BlockerId = pilot ? 'scope_pilot_cap' : 'scope_full_cap';
  const cap = scope.maxProducts;
  /**
   * Strop je domnienka aj vtedy, keď sme neprečítali samotný REŽIM: pilotných
   * 10 vtedy neplatí preto, že je to nastavené, ale preto, že sa nevie nič iné.
   */
  const capAssumed = !scope.known || scope.capAssumed;
  const capText = pilot
    ? `V pilotnom režime prejde na jednu zľavu najviac ${products(cap)}`
    : `V plnom režime prejde na jednu zľavu najviac ${products(cap)}`;

  // Strop platí aj vtedy, keď ho výber neprekročil — je to trvalé pravidlo appky
  // a používateľ ho má vidieť skôr, než doň narazí. Nad stropom `blokuje`,
  // pod stropom `informuje`; UI si informatívne riadky vie odfiltrovať.
  if (selected === null) {
    list.push({
      id,
      area: 'rozsah',
      severity: 'informuje',
      subject: 'operacia',
      productIds: [],
      what: `${capText}. Koľko ich je vo výbere, appka teraz nevie.`,
      nextStep: pilot
        ? 'Ak potrebujete viac, prepnite rozsah na plný v Nastaveniach — prepnutie si vyžiada heslo.'
        : `Strop sa dá zmeniť v Nastaveniach, najviac na ${products(HARD_MAX_PRODUCTS)}.`,
      path: BLOCKER_PATHS.settings,
      resolution: pilot ? 'sudo' : 'sam',
      passableNow: true,
      clearsAt: null,
      assumed: true,
    });
    return list;
  }

  if (selected <= cap) {
    list.push({
      id,
      area: 'rozsah',
      severity: 'informuje',
      subject: 'operacia',
      productIds: [],
      what: `${capText}, vo výbere ${isAre(selected)} ${products(selected)}.`,
      nextStep: pilot
        ? 'Ak potrebujete viac, prepnite rozsah na plný v Nastaveniach — prepnutie si vyžiada heslo.'
        : `Strop sa dá zmeniť v Nastaveniach, najviac na ${products(HARD_MAX_PRODUCTS)}.`,
      path: BLOCKER_PATHS.settings,
      resolution: pilot ? 'sudo' : 'sam',
      passableNow: true,
      clearsAt: null,
      assumed: capAssumed,
    });
    return list;
  }

  const over = selected - cap;
  const atHardMax = !pilot && cap >= HARD_MAX_PRODUCTS;
  list.push({
    id,
    area: 'rozsah',
    severity: 'blokuje',
    subject: 'operacia',
    productIds: [],
    what: `${capText}, vo výbere ${isAre(selected)} ${products(selected)} — ${remainderPhrase(over)}.`,
    nextStep: pilot
      ? `Zúžte výber na ${products(cap)}, alebo v Nastaveniach prepnite rozsah na plný — prepnutie si vyžiada heslo.`
      : atHardMax
        ? `Rozdeľte výber na viac zliav — vyšší strop než ${products(HARD_MAX_PRODUCTS)} sa nastaviť nedá.`
        : `Zúžte výber na ${products(cap)}, alebo strop zvýšte v Nastaveniach (najviac ${products(HARD_MAX_PRODUCTS)}).`,
    path: BLOCKER_PATHS.settings,
    resolution: pilot ? 'sudo' : 'sam',
    passableNow: true,
    clearsAt: null,
    assumed: capAssumed,
  });
  return list;
}

/**
 * 5.5 — katalóg (K1 bod 2, K7). V režime `plny` je prítomnosť v `catalog_cache`
 * podmienkou zápisu; v `pilot` o zápise nerozhoduje, ale neúplný katalóg aj tak
 * treba priznať — používateľ v ňom vyberá.
 */
function catalogBlockers(
  snapshot: StatusSnapshot,
  scope: ResolvedScope,
  selected: number | null,
): Blocker[] {
  const list: Blocker[] = [];
  const catalog = snapshot.catalog;
  const full = scope.mode === 'plny';
  const missing = Array.isArray(catalog?.missingProductIds) ? catalog.missingProductIds : null;

  if (full) {
    if (missing === null) {
      list.push({
        id: 'catalog_unknown',
        area: 'katalog',
        severity: 'blokuje',
        subject: 'operacia',
        productIds: [],
        what: 'V plnom režime appka zapíše len do produktov, ktoré má vo svojom katalógu — a teraz sa nedá overiť, či tam vybrané produkty sú.',
        nextStep:
          'Načítajte katalóg v Produktoch a výber zopakujte; kým to appka nevie overiť, radšej nezapíše nič.',
        path: BLOCKER_PATHS.products,
        resolution: 'sam',
        passableNow: true,
        clearsAt: null,
        assumed: true,
      });
    } else if (missing.length > 0) {
      const count = missing.length;
      const ofSelected = selected === null ? '' : ` z ${products(selected)} vo výbere`;
      list.push({
        id: 'catalog_product_missing',
        area: 'katalog',
        severity: 'blokuje',
        subject: 'produkt',
        productIds: [...missing],
        what: `${formatCountSk(count)} ${pluralSk(count, 'produkt', 'produkty', 'produktov')}${ofSelected} appka v katalógu nevidí (${sampleIds(missing)}) — do ${pluralSk(count, 'neho', 'nich', 'nich')} nezapíše.`,
        nextStep: `Načítajte katalóg znova v Produktoch, alebo ${pluralSk(count, 'tento produkt', 'tieto produkty', 'tieto produkty')} z výberu odoberte.`,
        path: BLOCKER_PATHS.products,
        resolution: 'sam',
        passableNow: true,
        clearsAt: null,
        assumed: false,
      });
    }
  }

  const loaded = readCount(catalog?.loadedProducts);
  const total = readCount(catalog?.shopTotalProducts);

  if (loaded === null) return list;

  if (loaded === 0) {
    list.push({
      id: 'catalog_incomplete',
      area: 'katalog',
      severity: full ? 'blokuje' : 'informuje',
      subject: 'operacia',
      productIds: [],
      what: full
        ? 'Katalóg je prázdny — v plnom režime sa z neho nedá vybrať ani jeden produkt.'
        : 'Katalóg je prázdny — appka zatiaľ nemá načítaný ani jeden produkt zo shopu.',
      nextStep: 'Spustite načítanie katalógu v Produktoch a nechajte ho dobehnúť.',
      path: BLOCKER_PATHS.products,
      resolution: 'sam',
      passableNow: true,
      clearsAt: null,
      assumed: false,
    });
    return list;
  }

  if (total === null || loaded >= total) return list;

  const rest = total - loaded;
  const pages = Math.ceil(rest / CATALOG_PAGE_SIZE);
  const needsDays = anonReadDaysNeeded(pages);
  const estimate =
    needsDays <= 1
      ? 'Zvyšok sa dočíta ešte dnes, ak sa zmestí do denného rozpočtu čítaní.'
      : `Dočítanie potrvá približne ${days(needsDays)} — za jeden UTC deň sa zmestí ${formatCountSk(ANON_READS_PER_UTC_DAY)} čítaní po ${products(CATALOG_PAGE_SIZE)}.`;

  list.push({
    id: 'catalog_incomplete',
    area: 'katalog',
    severity: full ? 'obmedzuje' : 'informuje',
    subject: 'operacia',
    productIds: [],
    what: `Načítaných je ${formatCountSk(loaded)} z ${products(total)}, ktoré shop hlási — ${formatCountSk(rest)} zatiaľ chýba. ${estimate}`,
    nextStep: `${WAIT_STEP}: synchronizácia katalógu pokračuje sama. Produkty, ktoré ešte nie sú načítané, sa zatiaľ vybrať nedajú.`,
    path: BLOCKER_PATHS.products,
    resolution: 'cakanie',
    passableNow: false,
    clearsAt: null,
    assumed: false,
  });
  return list;
}

/**
 * 5.6 — čítací rozpočet katalógu (`shop/rate-limits.ts`): 30/min a 300/UTC deň
 * bez kľúča, z čoho si appka berie 80 % ako rezervu. Zápisu to NEBRÁNI —
 * čítania idú bez kľúča a na inú kvótu.
 */
function catalogReadBlockers(snapshot: StatusSnapshot, now: Date): Blocker[] {
  const reads = snapshot.catalogReads;
  if (reads === undefined) return [];

  const list: Blocker[] = [];
  const perDay = readCount(reads.usedThisUtcDay);
  const perMinute = readCount(reads.usedThisMinute);

  if (perDay === null || perDay >= ANON_READS_PER_UTC_DAY) {
    const assumed = perDay === null;
    list.push({
      id: 'catalog_reads_day_exhausted',
      area: 'citanie',
      severity: 'obmedzuje',
      subject: 'operacia',
      productIds: [],
      what: assumed
        ? `Nevieme, koľko čítaní katalógu dnes odišlo — appka preto počíta s tým, že denný rozpočet ${formatCountSk(ANON_READS_PER_UTC_DAY)} čítaní je vyčerpaný, a katalóg ďalej nečíta.`
        : `Dnešný rozpočet čítaní katalógu je vyčerpaný — odišlo ${formatCountSk(perDay)} z ${formatCountSk(ANON_READS_PER_UTC_DAY)}, ktoré si appka za UTC deň dovolí (shop pustí ${formatCountSk(SHOP_ANON_LIMIT.perUtcDay)}, zvyšok je rezerva).`,
      nextStep: `${WAIT_STEP}: rozpočet čítaní sa obnoví o polnoci UTC a synchronizácia katalógu pokračuje sama. Zápisov sa to netýka, tie majú vlastný rozpočet.`,
      path: BLOCKER_PATHS.products,
      resolution: 'cakanie',
      passableNow: false,
      clearsAt: nextUtcDayReset(now),
      assumed,
    });
  }

  if (perMinute === null || perMinute >= ANON_READS_PER_MINUTE) {
    const assumed = perMinute === null;
    list.push({
      id: 'catalog_reads_minute_exhausted',
      area: 'citanie',
      severity: 'obmedzuje',
      subject: 'operacia',
      productIds: [],
      what: assumed
        ? `Nevieme, koľko čítaní katalógu odišlo za poslednú minútu — appka preto počíta s tým, že minútový strop ${formatCountSk(ANON_READS_PER_MINUTE)} je vyčerpaný.`
        : `Za poslednú minútu odišlo ${formatCountSk(perMinute)} z ${formatCountSk(ANON_READS_PER_MINUTE)} čítaní katalógu, ktoré si appka dovolí (shop pustí ${formatCountSk(SHOP_ANON_LIMIT.perMinute)} za minútu).`,
      nextStep: `${WAIT_STEP}: synchronizácia si sama počká a do minúty pokračuje.`,
      path: BLOCKER_PATHS.products,
      resolution: 'cakanie',
      passableNow: false,
      clearsAt: new Date(now.getTime() + MINUTE_MS),
      assumed,
    });
  }

  return list;
}

/* ═══════════════════════════ 6. Verejné API ═══════════════════════════════ */

/**
 * Zoradí prekážky: najprv závažnosť (`blokuje` → `obmedzuje` → `informuje`),
 * potom kanonické poradie `BLOCKER_ORDER`. Vstup sa nemení (vracia nové pole).
 */
export function sortBlockers(blockers: readonly Blocker[]): readonly Blocker[] {
  const rank = (id: BlockerId): number => {
    const index = BLOCKER_ORDER.indexOf(id);
    return index === -1 ? BLOCKER_ORDER.length : index;
  };
  return [...blockers].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return bySeverity !== 0 ? bySeverity : rank(a.id) - rank(b.id);
  });
}

/**
 * PREČO NEBEŽÍ CELÁ OPERÁCIA — všetky prekážky nad jedným snapshotom, zoradené
 * podľa závažnosti.
 *
 * Prázdny snapshot NIE JE „všetko v poriadku": vráti fail-closed zoznam, kde
 * každá prekážka nesie `assumed: true`.
 */
export function collectOperationBlockers(snapshot: StatusSnapshot = {}): readonly Blocker[] {
  const now = readDate(snapshot.now) ?? new Date();
  const scope = resolveScope(snapshot.scope);
  const selected = resolveSelectedCount(snapshot.selection);

  return sortBlockers([
    ...writesBlockers(snapshot),
    ...keyBlockers(snapshot, now, selected),
    ...writeBudgetBlockers(snapshot, now, selected),
    ...scopeBlockers(scope, selected),
    ...catalogBlockers(snapshot, scope, selected),
    ...catalogReadBlockers(snapshot, now),
  ]);
}

/**
 * PREČO NEPREJDE PRÁVE TENTO PRODUKT — ten istý zoznam zúžený na jeden produkt.
 *
 * Výber sa prepíše na tento jediný produkt (stropy rozsahu sa teda počítajú
 * voči jednotke) a katalógové prekážky sa orežú na jeho ID. Prekážky celej
 * operácie (vypnuté zápisy, chýbajúci kľúč, vyčerpaný rozpočet) ZOSTÁVAJÚ —
 * blokujú aj tento produkt, len nie kvôli nemu.
 */
export function collectProductBlockers(
  productId: number,
  snapshot: StatusSnapshot = {},
): readonly Blocker[] {
  const missing = snapshot.catalog?.missingProductIds;
  const narrowed: StatusSnapshot = {
    ...snapshot,
    selection: { selectedCount: 1, productIds: [productId] },
    ...(snapshot.catalog === undefined
      ? {}
      : {
          catalog: {
            ...snapshot.catalog,
            missingProductIds: Array.isArray(missing)
              ? missing.filter((id) => id === productId)
              : missing,
          },
        }),
  };
  return collectOperationBlockers(narrowed);
}

/** Len prekážky, cez ktoré teraz neprejde nič. */
export function blockingOnly(blockers: readonly Blocker[]): readonly Blocker[] {
  return blockers.filter((blocker) => blocker.severity === 'blokuje');
}

/** Prvá prekážka, ktorá zastavuje. `null` = nič nezastavuje. */
export function firstBlocking(blockers: readonly Blocker[]): Blocker | null {
  return blockingOnly(sortBlockers(blockers))[0] ?? null;
}

/**
 * Zhrnutie zoznamu pre hlavičku a pruhy: ide to / neide to, a kedy sa niečo
 * pohne samo. `waitUntil` je NAJBLIŽŠÍ čas obnovy spomedzi prekážok, ktoré sa
 * dajú prekonať iba čakaním.
 */
export function summarizeBlockers(blockers: readonly Blocker[]): BlockerSummary {
  const sorted = sortBlockers(blockers);
  const blocking = blockingOnly(sorted);
  // Bez pretypovania: `flatMap` zúži `clearsAt` na `Date` sám, `filter` by to
  // neurobil a musel by sa doháňať `as`.
  const waits = sorted.flatMap((blocker) =>
    !blocker.passableNow && blocker.clearsAt !== null && blocker.severity !== 'informuje'
      ? [blocker.clearsAt.getTime()]
      : [],
  );

  return {
    blockers: sorted,
    blocking,
    blocked: blocking.length > 0,
    waitUntil: waits.length > 0 ? new Date(Math.min(...waits)) : null,
  };
}
