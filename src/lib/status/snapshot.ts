/**
 * Aura Zľavy — STAVITEĽ SNAPSHOTU: jedno miesto, kde sa fakty o stave appky
 * čítajú, a jeden tvar, v ktorom odchádzajú do UI.
 *
 * `status/blockers.ts` vie povedať, ČO PRÁVE BLOKUJE ČO — ale je čistý: nič
 * nečíta, dostane `StatusSnapshot` a vráti zoznam prekážok. Tento modul je tá
 * druhá polovica: naplní `StatusSnapshot` skutočnými faktami z repozitárov
 * a preloží ho (aj s hotovým zoznamom prekážok) do JSON tvaru, ktorý si
 * vypýta `GET /api/status`.
 *
 * ČO TENTO MODUL JE A ČO NIE JE
 * -----------------------------
 * Nerozhoduje o ničom. Nepočíta vlastné limity (tie prichádzajú z
 * `shop/rate-limits.ts` cez `blockers.ts`), nepíše vlastné vety (tie píše
 * `blockers.ts`), nevolá shop a nezapisuje. Číta, priznáva medzery a odovzdáva.
 *
 * PREČO NEMÁ ANI JEDEN SERVEROVÝ IMPORT
 * -------------------------------------
 * Zdroje faktov sa injektujú (`StatusSources`) a produkčné repozitáre zapája až
 * `src/app/api/status/route.ts` — presne ako `/api/health` a `/api/queue`.
 * Dôvod je praktický: `statusSnapshotFromPayload()` musí byť použiteľná aj
 * v client komponente (rovnako ako celý `blockers.ts`), aby si obrazovka
 * s výberom produktov vedela prekážky prepočítať lokálne nad VLASTNÝM výberom.
 * Keby modul ťahal `@/db/pool`, ťahal by `mariadb` a `node:fs` do prehliadača.
 * Statické importy sú preto len typové alebo z čistých modulov.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *  1. **Nečitateľný údaj sa VYNECHÁ alebo pošle ako `null` — nikdy sa
 *     nenahradí optimistickou domnienkou.** `blockers.ts` je fail-closed: keď
 *     sekciu nedostane, vyhodnotí ju prísnejšie a prizná `assumed: true`.
 *     Doplniť sem „asi to bude v poriadku" znamená, že appka bude klamať práve
 *     vtedy, keď má DB problém. Každá vynechaná sekcia sa hlási v `unreadable`.
 *  2. **Kľúč iba ako `{present, expiresAt}` (I1).** Meno `apiKey` je
 *     v denylistu redaktora (`lib/log/redact.ts`), takže telo odpovede by sa
 *     celé zamaskovalo na `***REDACTED***` — presne to sa už raz stalo
 *     `/api/health` a UI potom natrvalo tvrdilo, že kľúč chýba. Redaktor má na
 *     tento jediný tvar úzku výnimku (`SAFE_DENIED_SHAPES`), preto smie mať
 *     objekt PRESNE tieto dve polia a žiadne ďalšie. Odvodené hodnoty (koľko
 *     hodín ešte platí) patria do vety prekážky, nie sem.
 *  3. **`missingProductIds: []` platí len pre PRÁZDNY výber.** Snapshot tohto
 *     modulu žiadny výber nemá, takže „ktoré z vybraných produktov chýbajú
 *     v katalógu" je overene prázdna množina, nie domnienka. Do JSON payloadu
 *     sa preto NEPOSIELA — inak by si ju obrazovka s výberom stiahla, priložila
 *     k nemu vlastných 150 ID a tvárila sa, že sú overené. Kto má výber, musí
 *     si `missingProductIds` doplniť sám (`statusSnapshotFromPayload` má na to
 *     `overlay`), inak zostane fail-closed nedoplnený.
 *  4. **Každá sekcia je JEDNO čítanie.** Zdroje sú zámerne hrubé
 *     (`catalog.read()` namiesto troch funkcií), lebo produkčne za nimi stojí
 *     jeden dotaz, ktorý vracia všetko naraz. Kto ich rozdrobí, znásobí počet
 *     dotazov na endpointe, ktorý beží pri každom obnovení každej obrazovky.
 *     Konkrétny rozpočet dotazov drží `src/app/api/status/route.ts`.
 *
 * Vlastník: S2.
 */
import type { DateOnly } from '@/contracts';
import type { ScopeMode } from '@/lib/repo/settings.repo';
import type { SalesBlockKind } from '@/lib/sales/stop-policy';

import {
  HARD_MAX_PRODUCTS,
  PILOT_MAX_PRODUCTS,
  collectOperationBlockers,
  firstBlocking,
  summarizeBlockers,
  type Blocker,
  type BlockerArea,
  type BlockerId,
  type BlockerResolution,
  type BlockerSeverity,
  type BlockerSubject,
  type CatalogSnapshot,
  type SelectionSnapshot,
  type StatusSnapshot,
} from '@/lib/status/blockers';

/* ═══════════════════ 1. Fakty tak, ako ich vracajú zdroje ═════════════════ */

/**
 * Sekcie snapshotu. Meno sekcie je jediné, čo sa o zlyhaní čítania dozvie UI —
 * dôvod (výnimka z DB) sa zámerne neposiela, mohol by niesť vstup (I1).
 */
export type StatusSection =
  | 'writes'
  | 'apiKey'
  | 'writeBudget'
  | 'scope'
  | 'catalog'
  | 'catalogReads'
  | 'salesSync';

/** Tvar `ScopeSettings` z `repo/settings.repo.ts` — bez importu servera. */
export interface ScopeFacts {
  readonly mode: ScopeMode;
  readonly maxProductsPerCampaign: number;
  readonly dailyWriteBudget: number;
  /** `true` = hodnoty sú fail-closed default, nie čítanie z DB (K1 bod 1). */
  readonly failClosed: boolean;
}

/** Tvar `BudgetStatus` z `engine/budget.ts` — bez importu servera. */
export interface BudgetFacts {
  readonly day: DateOnly;
  readonly budget: number;
  readonly spent: number;
  readonly remaining: number;
  readonly exhausted: boolean;
}

/** Tvar `ApiKeyMeta` zúžený na to, čo smie opustiť server (I1, D65). */
export interface ApiKeyFacts {
  readonly present: boolean;
  readonly expiresAt: Date | null;
}

/** Runaway zámok zápisov (`settings.writes_locked`, D79/I12). */
export interface WriteLockFacts {
  readonly writesLocked: boolean;
  readonly writesLockedReason: string | null;
  readonly writesLockedAt: Date | null;
}

/**
 * Stav zrkadla katalógu. Mená polí sú zámerne zhodné s `CatalogSnapshot`
 * v `blockers.ts` aj s `CatalogSyncStatus` v `repo/catalog.repo.ts` — je to
 * jeden fakt, nie tri podobné.
 */
export interface CatalogFacts {
  /** Koľko riadkov má katalóg appky. */
  readonly loadedProducts: number;
  /** Koľko produktov hlási shop. `null` = nedozvedeli sme sa to (I11). */
  readonly shopTotalProducts: number | null;
  /** „Dáta k …" — meraný fakt, nie odhad (P7). */
  readonly lastFetchedAt: Date | null;
  /**
   * Koľko ďalších UTC dní potrvá dočítanie (`syncStatus().estimatedDaysLeft`).
   *
   * Prenáša sa preto, aby si ho `blockers.ts` NEPOČÍTAL druhýkrát: zdroj pozná
   * pokrok prechodu (`last_page`), prekážka len počty riadkov — a dva odhady
   * vedľa seba v jednom paneli sa raz rozišli o deň. Voliteľné: keď zdroj odhad
   * nepošle, prekážka si ho dopočíta TOU ISTOU funkciou z toho, čo má.
   */
  readonly estimatedDaysLeft?: number | null;
  /** Odhad dokončenia s presnosťou na deň — z neho je `clearsAt` prekážky. */
  readonly estimatedFinishAt?: Date | null;
}

/** Čítací rozpočet katalógu — opt-in, viď `CatalogReadsSnapshot` v `blockers.ts`. */
export interface CatalogReadFacts {
  readonly usedThisMinute: number | null;
  readonly usedThisUtcDay: number | null;
}

/**
 * Trvalá prekážka čítania objednávok — opt-in, viď `SalesSyncSnapshot`
 * v `blockers.ts`. Tvar je zhodný so `SalesBlock` zo `sales/stop-policy.ts`,
 * zúžený na to, čo smie opustiť server: druh a dva časy, nikdy kód chyby ani
 * čokoľvek z odpovede shopu (I1).
 */
export interface SalesSyncFacts {
  readonly block: SalesBlockKind | null;
  readonly since: Date | null;
  readonly probeAt: Date | null;
}

/* ═════════════════════════ 2. Zdroje (injektované) ════════════════════════ */

/**
 * Odkiaľ sa fakty berú. Každý zdroj je najmenší možný tvar, aby sa dal v teste
 * nahradiť objektom bez DB — a aby sa sem nedal omylom podstrčiť zápis.
 */
export interface StatusSources {
  /** `writesAllowedByEnv()` z `@/env` — celá poistka I13, nie len premenná. */
  writesEnabled(): boolean;
  settings: {
    /** Fail-closed čítanie rozsahu (K1 bod 1). Nikdy nehádže, ale aj tak sa istíme. */
    readScope(): Promise<ScopeFacts>;
    /** Runaway zámok. Voliteľné: keď chýba, sekcia `writes` len nepozná zámok. */
    readWriteLock?(): Promise<WriteLockFacts>;
  };
  apiKey: {
    getMeta(): Promise<ApiKeyFacts>;
  };
  writeBudget: {
    /**
     * Spotreba zápisov za aktuálny UTC deň (K2 — počíta sa z auditu).
     *
     * Denný strop sa posiela ako parameter zámerne: prečítal sa už pri rozsahu
     * a druhé čítanie `settings` by bolo zbytočné. Keď rozsah prečítať nejde,
     * táto funkcia sa NEVOLÁ — rozpočet, ktorého výšku nepoznáme, je fail-closed
     * neznámy rozpočet, nie rozpočet s vymysleným stropom.
     */
    remainingToday(dailyBudget: number): Promise<BudgetFacts>;
  };
  catalog: {
    /**
     * Celá sekcia katalógu jedným čítaním. Zámerne NIE tri funkcie: produkčne
     * to je jedno `catalogRepo.syncStatus()` a tri volania by z neho spravili
     * trojnásobok dotazov na endpointe, ktorý beží pri každom obnovení.
     */
    read(): Promise<CatalogFacts>;
  };
  /**
   * Spotreba anonymných čítaní katalógu. Opt-in: keď zdroj chýba, sekcia sa
   * NEPOSIELA, `blockers.ts` o nej mlčí a v `unreadable` sa NEOBJAVÍ. Je to
   * dokumentovaná výnimka z fail-closed — čítania idú bez kľúča na inú kvótu
   * než zápisy, takže vyčerpané čítania zápisu nebránia.
   */
  catalogReads?(): Promise<CatalogReadFacts>;
  /**
   * Stojí synchronizácia predajnosti na tom, že shop čítanie objednávok
   * odmieta? Opt-in z rovnakého dôvodu ako `catalogReads`: predajnosť beží na
   * vlastnom kľúči a vlastnej kvóte a jej zastavenie zápisu NEBRÁNI.
   */
  salesSync?(): Promise<SalesSyncFacts>;
  now?(): Date;
}

/* ══════════════════════════ 3. Prečítaný stav ═════════════════════════════ */

/**
 * Výsledok čítania: snapshot pre `blockers.ts` + to, čo sa do neho nezmestilo,
 * ale UI to potrebuje (zámok zápisov, čas posledného čítania katalógu).
 */
export interface StatusReading {
  readonly now: Date;
  /** Presne to, čo sa posiela do `collectOperationBlockers()`. */
  readonly snapshot: StatusSnapshot;
  /** Sekcie, ktoré sa nepodarilo prečítať celé. Prázdne pole = všetko sedí. */
  readonly unreadable: readonly StatusSection[];
  /** Runaway zámok (D79). `null` = nevieme. */
  readonly writeLock: WriteLockFacts | null;
  /** Efektívny strop jednej zľavy. `null` = nedá sa odvodiť. */
  readonly effectiveMaxProducts: number | null;
  readonly catalogLastFetchedAt: Date | null;
}

/**
 * `missingProductIds` pre PRÁZDNY výber. Nie je to domnienka: prienik prázdnej
 * množiny s čímkoľvek je prázdna množina. Do JSON payloadu sa neposiela —
 * dôvod je v hlavičke súboru, bod 3.
 */
const EMPTY_SELECTION_MISSING: readonly number[] = [];

/** Bezpečné volanie zdroja: výnimka je „neviem", nie pád endpointu. */
async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/** Celé nezáporné číslo, alebo `null`. */
function count(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  return truncated < 0 ? null : truncated;
}

/**
 * Efektívny strop jednej zľavy — rovnaké pravidlo ako
 * `settings.effectiveMaxProducts()`: v `pilot` vždy 10, v `plny` uložená
 * hodnota zastropovaná tvrdým DB stropom. Konštanty sa berú zo zrkadla
 * v `blockers.ts`, ktorého zhodu s originálmi stráži `status-blockers.spec.ts`.
 */
export function effectiveMaxProducts(scope: ScopeFacts | null): number | null {
  if (scope === null) return null;
  if (scope.failClosed || scope.mode !== 'plny') return PILOT_MAX_PRODUCTS;
  const stored = count(scope.maxProductsPerCampaign);
  if (stored === null || stored < 1) return null;
  return Math.min(HARD_MAX_PRODUCTS, stored);
}

/**
 * Prečíta stav zo zdrojov a zloží `StatusSnapshot`.
 *
 * NIKDY nehádže — endpoint stavu, ktorý spadne, je horší než endpoint, ktorý
 * prizná medzeru. Každé zlyhané čítanie skončí ako vynechaná sekcia a meno tej
 * sekcie v `unreadable`.
 *
 * Čítania idú ZÁMERNE za sebou, nie cez `Promise.all`. Vyzerá to ako
 * premárnená optimalizácia, ale nie je: pool má 8 spojení
 * (`DB_CONNECTION_LIMIT`) a tento endpoint volá päť obrazoviek pri každom
 * obnovení. Paralelný vejár by z jednej požiadavky spravil päť súbežných
 * spojení a bral by ich fronte, ktorá zapisuje. Latencia stavu nikoho nebolí,
 * zastavená fronta áno. Jediná výnimka je rozpočet: ten sa nedá čítať skôr,
 * než je známy strop z nastavení, takže je aj tak závislý.
 */
export async function buildStatusSnapshot(sources: StatusSources): Promise<StatusReading> {
  const now = sources.now?.() ?? new Date();
  const unreadable = new Set<StatusSection>();

  /* ── 1. Poistky zápisu (I13). ─────────────────────────────────────────── */
  let writesEnabled: boolean | null;
  try {
    writesEnabled = sources.writesEnabled();
  } catch {
    // Nečitateľné ENV je „neviem"; `blockers.ts` z toho spraví „vypnuté".
    writesEnabled = null;
    unreadable.add('writes');
  }

  // `bind` zámerne: zdroj smie byť aj metóda objektu, ktorá si drží `this`.
  const readWriteLock = sources.settings.readWriteLock?.bind(sources.settings);
  const writeLock = readWriteLock === undefined ? null : await attempt(readWriteLock);
  if (readWriteLock !== undefined && writeLock === null) unreadable.add('writes');

  /* ── 2. Rozsah (K1). `readScope()` je sám fail-closed, aj tak sa istíme. ── */
  const scopeRaw = await attempt(() => sources.settings.readScope());
  const scope = scopeRaw !== null && !scopeRaw.failClosed ? scopeRaw : null;
  if (scope === null) unreadable.add('scope');

  /* ── 3. Kľúč (R2, D63). Iba `{present, expiresAt}` — I1. ───────────────── */
  const keyFacts = await attempt(() => sources.apiKey.getMeta());
  if (keyFacts === null) unreadable.add('apiKey');

  /* ── 4. Denný rozpočet zápisov (K2). Bez známeho stropu sa nečíta vôbec. ── */
  const budget =
    scope === null ? null : await attempt(() => sources.writeBudget.remainingToday(scope.dailyWriteBudget));
  if (budget === null) unreadable.add('writeBudget');

  /* ── 5. Katalóg (K7). ─────────────────────────────────────────────────── */
  const catalogFacts = await attempt(() => sources.catalog.read());
  if (catalogFacts === null) unreadable.add('catalog');
  const loadedProducts = catalogFacts === null ? null : count(catalogFacts.loadedProducts);
  const shopTotalProducts = catalogFacts === null ? null : count(catalogFacts.shopTotalProducts);
  const catalogLastFetchedAt = catalogFacts?.lastFetchedAt ?? null;

  /* ── 6. Čítací rozpočet katalógu — opt-in, viď `StatusSources`. ────────── */
  const readCatalogReads = sources.catalogReads?.bind(sources);
  const catalogReads = readCatalogReads === undefined ? null : await attempt(readCatalogReads);
  if (readCatalogReads !== undefined && catalogReads === null) unreadable.add('catalogReads');

  /* ── 7. Odmietnuté čítanie objednávok — opt-in, viď `StatusSources`. ──── */
  const readSalesSync = sources.salesSync?.bind(sources);
  const salesSync = readSalesSync === undefined ? null : await attempt(readSalesSync);
  if (readSalesSync !== undefined && salesSync === null) unreadable.add('salesSync');

  const catalog: CatalogSnapshot | undefined =
    loadedProducts === null
      ? undefined
      : {
          loadedProducts,
          shopTotalProducts,
          // Výber je prázdny, takže „chýbajúce z vybraných" je overene prázdne.
          missingProductIds: EMPTY_SELECTION_MISSING,
          // Odhad od zdroja — prekážka si druhý nedopočítava (viď `CatalogFacts`).
          estimatedDaysLeft: catalogFacts?.estimatedDaysLeft ?? null,
          estimatedFinishAt: catalogFacts?.estimatedFinishAt ?? null,
        };

  const snapshot: StatusSnapshot = {
    now,
    writes: { enabled: writesEnabled },
    apiKey: {
      present: keyFacts === null ? null : keyFacts.present,
      expiresAt: keyFacts === null ? null : keyFacts.expiresAt,
    },
    ...(budget === null
      ? {}
      : { writeBudget: { budget: budget.budget, spent: budget.spent, day: budget.day } }),
    scope: {
      mode: scope === null ? null : scope.mode,
      maxProducts: scope === null ? null : scope.maxProductsPerCampaign,
      failClosed: scope === null,
    },
    ...(catalog === undefined ? {} : { catalog }),
    ...(catalogReads === null ? {} : { catalogReads }),
    ...(salesSync === null ? {} : { salesSync }),
  };

  return {
    now,
    snapshot,
    unreadable: [...unreadable],
    writeLock,
    effectiveMaxProducts: effectiveMaxProducts(scope),
    catalogLastFetchedAt,
  };
}

/* ═══════════════════════ 4. Tvar odpovede pre UI ══════════════════════════ */

/** Jedna prekážka v JSON tvare — `clearsAt` je ISO 8601 UTC, nie `Date`. */
export interface BlockerWire {
  readonly id: BlockerId;
  readonly area: BlockerArea;
  readonly severity: BlockerSeverity;
  readonly subject: BlockerSubject;
  readonly productIds: readonly number[];
  readonly what: string;
  readonly nextStep: string;
  readonly path: string | null;
  readonly resolution: BlockerResolution;
  readonly passableNow: boolean;
  readonly clearsAt: string | null;
  readonly assumed: boolean;
}

/**
 * Poistky zápisu. `enabled` je celé `writesAllowedByEnv()` (I13), `locked` je
 * runaway zámok z nastavení (D79). `null` v ktoromkoľvek poli = nevieme.
 */
export interface WritesWire {
  readonly enabled: boolean | null;
  readonly locked: boolean | null;
  readonly lockedReason: string | null;
  readonly lockedAt: string | null;
}

/**
 * Kľúč na zápis. PRESNE dve polia — viac ich mať nesmie, viď hlavička súboru,
 * bod 2. Kto potrebuje „koľko hodín ešte platí", odvodí si to z `expiresAt`.
 */
export interface ApiKeyWire {
  readonly present: boolean | null;
  readonly expiresAt: string | null;
}

export interface WriteBudgetWire {
  readonly day: DateOnly;
  readonly budget: number;
  readonly spent: number;
  readonly remaining: number;
  readonly exhausted: boolean;
}

export interface ScopeWire {
  /** `null` = režim sa nepodarilo prečítať; platí fail-closed `pilot`. */
  readonly mode: ScopeMode | null;
  /** Strop uložený v nastaveniach. V `pilot` sa NEPOUŽÍVA. */
  readonly maxProductsSetting: number | null;
  /** Efektívny strop jednej zľavy — to, čo naozaj platí teraz. */
  readonly maxProducts: number | null;
  /** `true` = hodnoty sú fail-closed default, nie čítanie z DB. */
  readonly failClosed: boolean;
}

export interface CatalogWire {
  /** Koľko produktov má appka vo svojom katalógu. */
  readonly loadedProducts: number | null;
  /** Koľko ich hlási shop. `null` = nevieme (best-effort, viď `StatusSources`). */
  readonly shopTotalProducts: number | null;
  readonly lastFetchedAt: string | null;
}

export interface CatalogReadsWire {
  readonly usedThisMinute: number | null;
  readonly usedThisUtcDay: number | null;
}

export interface SalesSyncWire {
  readonly block: SalesBlockKind | null;
  /** ISO 8601 UTC — odkedy prekážka stojí. */
  readonly since: string | null;
  /** ISO 8601 UTC — kedy sa appka ozve jednou požiadavkou. `null` = nikdy sama. */
  readonly probeAt: string | null;
}

/** Odpoveď na otázku „ide to, alebo nie?" — jedna veta pre hlavičku. */
export interface StatusSummaryWire {
  readonly blocked: boolean;
  readonly blockingCount: number;
  /** `id` najzávažnejšej prekážky, ktorá zastavuje. `null` = nič nezastavuje. */
  readonly worstBlockerId: BlockerId | null;
  /** Najbližší čas, keď sa niečo pohne samo. ISO 8601 UTC alebo `null`. */
  readonly waitUntil: string | null;
  /** `true` = aspoň jedna veta stojí na fail-closed domnienke. */
  readonly anyAssumed: boolean;
}

/** Celé telo `GET /api/status` (v obálke `{ok:true,data:…}`). */
export interface StatusPayload {
  /** Serverový čas, ku ktorému snapshot platí. ISO 8601 UTC. */
  readonly now: string;
  readonly writes: WritesWire;
  readonly apiKey: ApiKeyWire;
  readonly writeBudget: WriteBudgetWire | null;
  readonly scope: ScopeWire;
  readonly catalog: CatalogWire | null;
  /** `null`, kým spotrebu čítaní katalógu niekto nemeria (opt-in). */
  readonly catalogReads: CatalogReadsWire | null;
  /** `null`, kým sa na predajnosť nikto nepýta (opt-in). */
  readonly salesSync: SalesSyncWire | null;
  /** Hotový zoznam prekážok pre PRÁZDNY výber, zoradený podľa závažnosti. */
  readonly blockers: readonly BlockerWire[];
  readonly summary: StatusSummaryWire;
  /** Sekcie, ktoré sa nepodarilo prečítať celé. UI to má priznať, nie skryť. */
  readonly unreadable: readonly StatusSection[];
}

const iso = (value: Date | null): string | null =>
  value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;

/** ISO reťazec → `Date`. Nečitateľný čas je „neviem", nie `Invalid Date`. */
function parseIso(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** `Blocker` → JSON tvar. */
export function toBlockerWire(blocker: Blocker): BlockerWire {
  return {
    id: blocker.id,
    area: blocker.area,
    severity: blocker.severity,
    subject: blocker.subject,
    productIds: [...blocker.productIds],
    what: blocker.what,
    nextStep: blocker.nextStep,
    path: blocker.path,
    resolution: blocker.resolution,
    passableNow: blocker.passableNow,
    clearsAt: iso(blocker.clearsAt),
    assumed: blocker.assumed,
  };
}

/** JSON tvar → `Blocker`. Pre UI, ktoré chce použiť `summarizeBlockers()`. */
export function blockerFromWire(wire: BlockerWire): Blocker {
  const clearsAt = wire.clearsAt === null ? null : new Date(wire.clearsAt);
  return {
    id: wire.id,
    area: wire.area,
    severity: wire.severity,
    subject: wire.subject,
    productIds: [...wire.productIds],
    what: wire.what,
    nextStep: wire.nextStep,
    path: wire.path,
    resolution: wire.resolution,
    passableNow: wire.passableNow,
    clearsAt: clearsAt !== null && Number.isFinite(clearsAt.getTime()) ? clearsAt : null,
    assumed: wire.assumed,
  };
}

/**
 * Prečítaný stav + prekážky → telo odpovede.
 *
 * Prekážky sa počítajú TU, nad tým istým snapshotom, ktorý ide do payloadu —
 * aby sa čísla vo vetách nemohli rozísť s číslami v sekciách.
 */
export function toStatusPayload(reading: StatusReading): StatusPayload {
  const blockers = collectOperationBlockers(reading.snapshot);
  const summary = summarizeBlockers(blockers);
  const worst = firstBlocking(blockers);
  const budget = reading.snapshot.writeBudget;
  const scope = reading.snapshot.scope;
  const catalog = reading.snapshot.catalog;
  const reads = reading.snapshot.catalogReads;
  const sales = reading.snapshot.salesSync;

  const budgetWire: WriteBudgetWire | null =
    budget === undefined ||
    typeof budget.budget !== 'number' ||
    typeof budget.spent !== 'number' ||
    typeof budget.day !== 'string'
      ? null
      : {
          day: budget.day,
          budget: budget.budget,
          spent: budget.spent,
          remaining: Math.max(0, budget.budget - budget.spent),
          exhausted: budget.budget - budget.spent <= 0,
        };

  return {
    now: reading.now.toISOString(),
    writes: {
      enabled: reading.snapshot.writes?.enabled ?? null,
      locked: reading.writeLock === null ? null : reading.writeLock.writesLocked,
      lockedReason: reading.writeLock === null ? null : reading.writeLock.writesLockedReason,
      lockedAt: reading.writeLock === null ? null : iso(reading.writeLock.writesLockedAt),
    },
    // PRESNE dve polia — úzka výnimka redaktora (I1), viď hlavička, bod 2.
    apiKey: {
      present: reading.snapshot.apiKey?.present ?? null,
      expiresAt: iso(reading.snapshot.apiKey?.expiresAt ?? null),
    },
    writeBudget: budgetWire,
    scope: {
      mode: scope?.mode ?? null,
      maxProductsSetting: scope?.maxProducts ?? null,
      maxProducts: reading.effectiveMaxProducts,
      failClosed: scope?.failClosed === true,
    },
    catalog:
      catalog === undefined
        ? null
        : {
            loadedProducts: catalog.loadedProducts ?? null,
            shopTotalProducts: catalog.shopTotalProducts ?? null,
            lastFetchedAt: iso(reading.catalogLastFetchedAt),
          },
    catalogReads:
      reads === undefined
        ? null
        : {
            usedThisMinute: reads.usedThisMinute ?? null,
            usedThisUtcDay: reads.usedThisUtcDay ?? null,
          },
    salesSync:
      sales === undefined
        ? null
        : {
            block: sales.block ?? null,
            since: iso(sales.since ?? null),
            probeAt: iso(sales.probeAt ?? null),
          },
    blockers: blockers.map(toBlockerWire),
    summary: {
      blocked: summary.blocked,
      blockingCount: summary.blocking.length,
      worstBlockerId: worst === null ? null : worst.id,
      waitUntil: iso(summary.waitUntil),
      anyAssumed: blockers.some((blocker) => blocker.assumed),
    },
    unreadable: [...reading.unreadable],
  };
}

/** Skratka pre route: prečítať a rovno preložiť. NIKDY nehádže. */
export async function readStatusPayload(sources: StatusSources): Promise<StatusPayload> {
  return toStatusPayload(await buildStatusSnapshot(sources));
}

/* ══════════════ 5. Späť do snapshotu (pre obrazovky s výberom) ════════════ */

/**
 * Čo si volajúci k snapshotu dokladá sám.
 *
 * `selection` je jediný spôsob, ako z globálneho stavu urobiť odpoveď na
 * otázku „prejde MOJICH 150 produktov?". A keď sa výber pridá, MUSÍ sa doplniť
 * aj `missingProductIds` — payload ich zámerne nenesie (hlavička, bod 3).
 * Keď sa nedoplnia, `blockers.ts` v režime `plny` fail-closed povie, že sa to
 * nedá overiť. To je správne: neoverené nie je to isté ako overene v poriadku.
 */
export interface StatusSnapshotOverlay {
  readonly selection?: SelectionSnapshot;
  /** Ktoré z VYBRANÝCH produktov appka v katalógu nevidí. */
  readonly missingProductIds?: readonly number[] | null;
  /** Vlastný referenčný čas (testy, prerátanie staršieho payloadu). */
  readonly now?: Date;
}

/**
 * JSON payload → `StatusSnapshot` pre `collectOperationBlockers()`.
 *
 * Je to jediná podporovaná cesta, ako si obrazovka prepočíta prekážky nad
 * vlastným výberom bez druhého volania servera. Funkcia je čistá a beží aj
 * v prehliadači.
 */
export function statusSnapshotFromPayload(
  payload: StatusPayload,
  overlay: StatusSnapshotOverlay = {},
): StatusSnapshot {
  const parsed = new Date(payload.now);
  const now = overlay.now ?? (Number.isFinite(parsed.getTime()) ? parsed : new Date());
  const keyExpiresAt = payload.apiKey.expiresAt === null ? null : new Date(payload.apiKey.expiresAt);

  const hasSelection =
    overlay.selection !== undefined &&
    (count(overlay.selection.selectedCount ?? null) !== null ||
      Array.isArray(overlay.selection.productIds));

  return {
    now,
    writes: { enabled: payload.writes.enabled },
    apiKey: {
      present: payload.apiKey.present,
      expiresAt:
        keyExpiresAt !== null && Number.isFinite(keyExpiresAt.getTime()) ? keyExpiresAt : null,
    },
    ...(payload.writeBudget === null
      ? {}
      : {
          writeBudget: {
            budget: payload.writeBudget.budget,
            spent: payload.writeBudget.spent,
            day: payload.writeBudget.day,
          },
        }),
    scope: {
      mode: payload.scope.mode,
      maxProducts: payload.scope.maxProductsSetting,
      failClosed: payload.scope.failClosed,
    },
    ...(overlay.selection === undefined ? {} : { selection: overlay.selection }),
    ...(payload.catalog === null
      ? {}
      : {
          catalog: {
            loadedProducts: payload.catalog.loadedProducts,
            shopTotalProducts: payload.catalog.shopTotalProducts,
            // Bez výberu je prázdna množina fakt; s výberom platí len to, čo
            // volajúci naozaj overil — inak zostáva „neoverené" (fail-closed).
            missingProductIds:
              overlay.missingProductIds !== undefined
                ? overlay.missingProductIds
                : hasSelection
                  ? null
                  : EMPTY_SELECTION_MISSING,
          },
        }),
    ...(payload.catalogReads === null ? {} : { catalogReads: payload.catalogReads }),
    ...(payload.salesSync === null
      ? {}
      : {
          salesSync: {
            block: payload.salesSync.block,
            since: parseIso(payload.salesSync.since),
            probeAt: parseIso(payload.salesSync.probeAt),
          },
        }),
  };
}
