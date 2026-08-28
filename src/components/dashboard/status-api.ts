'use client';

/**
 * Aura Zľavy — ČÍTANIE ŽIVÉHO STAVU PRE PREHĽAD (V9; kontrakt dokončenia C1, C2).
 *
 * Používateľ povedal dve veci naraz: „nevidím, čo appka robí" a „nevidím, prečo
 * sa niečo NEstalo". Odpoveď na obe už na serveri existuje a tento modul ju len
 * prinesie na obrazovku — nič si k nej nedomýšľa:
 *
 *   `GET /api/status`        — fakty (zápisy, kľúč, rozpočet, rozsah, katalóg)
 *                              a HOTOVÝ zoznam prekážok z `lib/status/blockers`,
 *   `GET /api/catalog/sync`  — kde je synchronizácia katalógu, prečo čaká
 *                              a dokedy to potrvá (A5).
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *
 * 1. **Vety sa tu NESKLADAJÚ.** `what` aj `nextStep` píše `blockers.ts` — je to
 *    jediný zdroj pravdy o tom, čo blokuje čo, a druhá formulácia tej istej
 *    prekážky by sa s ním rozišla presne vtedy, keď na tom bude záležať.
 * 2. **Kód chyby sa na povrch nedostane** (I1, K10). Z `lastError` katalógu si
 *    modul berie IBA odpovede na otázky, nie samotný kód — ten by bol žargón
 *    a mohol by niesť kus odpovede shopu. Preto booleany, nie reťazec.
 *
 *    Booleany sú DVA, a to je od 26. 8. 2026 podstatné: `failedLastTime`
 *    hovorí „posledný beh skončil chybou", `ipBanned` hovorí „shop ODMIETOL
 *    našu adresu". Do 26. 8. tu bol len prvý, takže obrazovka nedokázala
 *    odlíšiť mlčanie shopu od jeho odmietnutia a `shopPill()` na ban napísala
 *    „Shop naposledy neodpovedal" — shop pritom odpovedal, len nás nepustil.
 *    Rozdiel je celý ďalší krok: mlčanie sa vyrieši čakaním, odmietnutie
 *    adresy nie a čakať naň by bola nekonečná slučka. Kód `ip_banned` sa tým
 *    NA POVRCH nedostáva ani teraz — rozhoduje o ňom `isIpBannedCode()`
 *    a von ide `true`/`false`.
 * 3. **Neznámy kód je `null`, nie surová hodnota.** Závažnosť ani spôsob
 *    riešenia sa nedopĺňajú odhadom; obrazovka vie prekážku vykresliť aj vtedy,
 *    keď jej spôsob riešenia nepozná, a povie to.
 * 4. **Nečitateľná odpoveď je `null` pre CELÝ blok, nie nula v jeho poliach.**
 *    Prístrojová doska appky, ktorá píše do produkčného eshopu, radšej prizná
 *    medzeru, než by nakreslila upokojujúcu nulu (P7).
 *
 * Vlastník: V9.
 */
import {
  asRecord,
  readCode,
  readCount,
  readFlag,
  readText,
  readTriState,
} from '@/components/dashboard/json';
import { fetchJson } from '@/components/layout/health';
import { isIpBannedCode } from '@/lib/shop/errors';

/* ═══════════════════════════ 1. Prekážky ══════════════════════════════════ */

/** Závažnosť prekážky — presne tri hodnoty z `lib/status/blockers.ts`. */
export const BLOCKER_SEVERITIES = ['blokuje', 'obmedzuje', 'informuje'] as const;
export type BlockerSeverityCode = (typeof BLOCKER_SEVERITIES)[number];

/** Ako sa prekážka odstráni — štyri hodnoty z `lib/status/blockers.ts`. */
export const BLOCKER_RESOLUTIONS = ['sam', 'potvrdenie', 'cakanie', 'mimo_appky'] as const;
export type BlockerResolutionCode = (typeof BLOCKER_RESOLUTIONS)[number];

/**
 * Jedna prekážka tak, ako ju Prehľad kreslí.
 *
 * `severity` chýbať nesmie — bez nej by sa riadok nedal zaradiť, a fail-closed
 * zaradenie je `blokuje` (radšej ukázať navyše než zamlčať). `resolution` chýbať
 * SMIE: obrazovka vtedy nepovie, kto to vyrieši, namiesto toho, aby to hádala.
 */
export interface BlockerRow {
  readonly id: string;
  readonly severity: BlockerSeverityCode;
  readonly resolution: BlockerResolutionCode | null;
  /** ČO sa deje — slovenská veta s číslami. Skladá ju server. */
  readonly what: string;
  /** ČO S TÝM — konkrétny ďalší krok. Tiež zo servera. */
  readonly nextStep: string;
  /** Kam v appke to vedie; `null` = v appke sa to vyriešiť nedá. */
  readonly path: string | null;
  /** `true` = veta stojí na fail-closed domnienke, nie na overenom fakte. */
  readonly assumed: boolean;
}

function parseBlocker(raw: unknown): BlockerRow | null {
  const record = asRecord(raw);
  if (record === null) return null;

  const id = readText(record, 'id');
  const what = readText(record, 'what');
  const nextStep = readText(record, 'nextStep');
  if (id === null || what === null || nextStep === null) return null;

  return {
    id,
    // Fail-closed: prekážka bez rozpoznanej závažnosti sa berie ako tá, ktorá
    // zastavuje. Skryť ju by znamenalo mlčať o dôvode, a presne to sa rieši.
    severity: readCode(record, 'severity', BLOCKER_SEVERITIES) ?? 'blokuje',
    resolution: readCode(record, 'resolution', BLOCKER_RESOLUTIONS),
    what,
    nextStep,
    path: readText(record, 'path'),
    assumed: readFlag(record, 'assumed'),
  };
}

/* ═══════════════════════════ 2. Stav appky ════════════════════════════════ */

/** Poistky zápisu: `enabled` je celá env poistka, `locked` je runaway zámok. */
export interface WritesView {
  readonly enabled: boolean | null;
  readonly locked: boolean | null;
}

/** Kľúč na zápis. PRESNE dve polia — nič z kľúča samotného tu nikdy nebude. */
export interface KeyView {
  readonly present: boolean | null;
  readonly expiresAt: string | null;
}

/** Denný zápisový rozpočet za aktuálny UTC deň. */
export interface WriteBudgetView {
  readonly budget: number;
  readonly spent: number;
  readonly remaining: number;
  readonly exhausted: boolean;
}

/** Režim rozsahu a efektívny strop jednej zľavy. */
export interface ScopeView {
  readonly pilot: boolean | null;
  /** Koľko produktov prejde na jednu zľavu; `null` = nevieme. */
  readonly maxProducts: number | null;
}

/** Počty katalógu tak, ako ich hlási agregátor stavu. */
export interface CatalogCountsView {
  readonly loadedProducts: number | null;
  readonly shopTotalProducts: number | null;
}

/**
 * Sekcie stavu, ktoré sa nepodarilo prečítať celé. Server ich posiela ako
 * vnútorné kódy; Prehľad z nich robí slovenské slová (`live-status-model.ts`)
 * a surový kód nevykreslí nikdy (K10).
 */
export const STATUS_SECTIONS = [
  'writes',
  'apiKey',
  'writeBudget',
  'scope',
  'catalog',
  'catalogReads',
  'salesSync',
] as const;
export type StatusSectionCode = (typeof STATUS_SECTIONS)[number];

export interface StatusView {
  readonly writes: WritesView;
  readonly apiKey: KeyView;
  readonly writeBudget: WriteBudgetView | null;
  readonly scope: ScopeView;
  readonly catalog: CatalogCountsView | null;
  /** Prekážky zoradené serverom podľa závažnosti — poradie sa nemení. */
  readonly blockers: readonly BlockerRow[];
  /** `true` = aspoň jedna prekážka zastavuje všetko. */
  readonly blocked: boolean;
  readonly unreadable: readonly StatusSectionCode[];
}

export function parseStatus(raw: unknown): StatusView | null {
  const root = asRecord(raw);
  if (root === null) return null;

  const writesRaw = asRecord(root['writes']);
  const keyRaw = asRecord(root['apiKey']);
  const budgetRaw = asRecord(root['writeBudget']);
  const scopeRaw = asRecord(root['scope']);
  const catalogRaw = asRecord(root['catalog']);
  const summaryRaw = asRecord(root['summary']);

  let writeBudget: WriteBudgetView | null = null;
  if (budgetRaw !== null) {
    const budget = readCount(budgetRaw, 'budget');
    const spent = readCount(budgetRaw, 'spent');
    if (budget !== null && budget > 0 && spent !== null) {
      writeBudget = {
        budget,
        spent,
        remaining: Math.max(0, budget - spent),
        exhausted: budget - spent <= 0,
      };
    }
  }

  const blockersRaw = root['blockers'];
  const blockers = Array.isArray(blockersRaw)
    ? blockersRaw.map(parseBlocker).filter((row): row is BlockerRow => row !== null)
    : [];

  const unreadableRaw = root['unreadable'];
  const unreadable = Array.isArray(unreadableRaw)
    ? unreadableRaw.filter((value): value is StatusSectionCode =>
        (STATUS_SECTIONS as readonly string[]).includes(value as string),
      )
    : [];

  // Režim rozsahu: čokoľvek iné než vedome prečítané `plny` je fail-closed
  // pilotný režim — rovnaké pravidlo ako v `guards.resolveScope()`.
  const scopeMode = scopeRaw === null ? null : readText(scopeRaw, 'mode');
  const scopeFailClosed = scopeRaw !== null && readFlag(scopeRaw, 'failClosed');

  return {
    writes: {
      enabled: writesRaw === null ? null : readTriState(writesRaw, 'enabled'),
      locked: writesRaw === null ? null : readTriState(writesRaw, 'locked'),
    },
    apiKey: {
      present: keyRaw === null ? null : readTriState(keyRaw, 'present'),
      expiresAt: keyRaw === null ? null : readText(keyRaw, 'expiresAt'),
    },
    writeBudget,
    scope: {
      pilot: scopeMode === null || scopeFailClosed ? null : scopeMode !== 'plny',
      maxProducts: scopeRaw === null ? null : readCount(scopeRaw, 'maxProducts'),
    },
    catalog:
      catalogRaw === null
        ? null
        : {
            loadedProducts: readCount(catalogRaw, 'loadedProducts'),
            shopTotalProducts: readCount(catalogRaw, 'shopTotalProducts'),
          },
    blockers,
    // Fail-closed: keď zhrnutie chýba, odvodí sa zo zoznamu. Prázdny zoznam
    // pritom NIE JE dôkaz pokoja — je to len to, čo sa podarilo prečítať.
    blocked:
      summaryRaw === null
        ? blockers.some((row) => row.severity === 'blokuje')
        : readFlag(summaryRaw, 'blocked'),
    unreadable,
  };
}

export async function getStatus(): Promise<StatusView | null> {
  return parseStatus(await fetchJson<unknown>('/api/status'));
}

/* ═══════════════════════ 3. Synchronizácia katalógu ═══════════════════════ */

/**
 * Prečo sa práve teraz nečíta zo shopu. Kódy sú zhodné s `CatalogWaitingReason`
 * v `repo/catalog.repo.ts`; zámerne sa sem NEIMPORTUJÚ, lebo ten modul ťahá
 * databázový pool a s ním `mariadb` do prehliadača. Rozídenie zoznamu by sa
 * prejavilo tichým `null` (appka by o dôvode mlčala), nie pádom — preto to
 * kontroluje test.
 */
export const CATALOG_WAITING_CODES = [
  'rate_limited',
  'daily_budget',
  'error',
  'catalog_complete',
] as const;
export type CatalogWaitingCode = (typeof CATALOG_WAITING_CODES)[number];

export interface CatalogSyncView {
  readonly loadedProducts: number | null;
  readonly shopTotalProducts: number | null;
  readonly complete: boolean;
  /**
   * `true` = katalóg appka MÁ celý, ale beží nad ním nový (obnovovací) prechod.
   * Bez tohto poľa Prehľad hlásil „načítaný celý", kým karta v Produktoch vedľa
   * toho tvrdila „382 stránok ostáva" — pokrok prechodu sa zamieňal za
   * chýbajúce dáta.
   */
  readonly refreshing: boolean;
  /** Kedy sa naposledy naozaj čítalo zo shopu — meraný fakt, nie odhad. */
  readonly lastReadAt: string | null;
  /** Prečo sa čaká; `null` = nič nebráni ďalšej dávke. */
  readonly waiting: CatalogWaitingCode | null;
  readonly nextBatchAt: string | null;
  /** Odhad dokončenia (presnosť na deň); na povrchu vždy so značkou odhadu. */
  readonly estimatedFinishAt: string | null;
  /** `true` = posledný beh skončil chybou. KÓD chyby sa na povrch nedostane. */
  readonly failedLastTime: boolean;
  /**
   * `true` = shop odmietol našu ADRESU (`ip_banned`), nie našu požiadavku.
   *
   * Je to podtrieda `failedLastTime` a NIE JE to výrok o kľúči (`shop/errors.ts`):
   * shop ten kód vracia aj na volanie bez kľúča. Pre obrazovku je to iný príbeh
   * než „shop neodpovedal" — čakanie ho nevylieči, takže veta nesmie ponúkať
   * „skúste to o chvíľu znova".
   */
  readonly ipBanned: boolean;
}

export function parseCatalogSync(raw: unknown): CatalogSyncView | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const catalog = asRecord(root['catalog']);
  if (catalog === null) return null;

  // Kód sa prečíta RAZ a hneď sa premení na dva booleany — do vráteného
  // pohľadu sa nedostane (bod 2 hlavičky), takže ho nemôže vypísať ani omylom.
  const lastError = readText(catalog, 'lastError');

  return {
    loadedProducts: readCount(catalog, 'loadedProducts'),
    shopTotalProducts: readCount(catalog, 'shopTotalProducts'),
    complete: readFlag(catalog, 'complete'),
    refreshing: readFlag(catalog, 'refreshing'),
    lastReadAt: readText(catalog, 'lastReadAt'),
    waiting: readCode(catalog, 'waiting', CATALOG_WAITING_CODES),
    nextBatchAt: readText(catalog, 'nextBatchAt'),
    estimatedFinishAt: readText(catalog, 'estimatedFinishAt'),
    failedLastTime: lastError !== null,
    ipBanned: isIpBannedCode(lastError),
  };
}

export async function getCatalogSync(): Promise<CatalogSyncView | null> {
  return parseCatalogSync(await fetchJson<unknown>('/api/catalog/sync'));
}
