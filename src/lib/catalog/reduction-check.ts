/**
 * Aura Zľavy — OVERENIE SKUTOČNÉHO STAVU ZĽAVY V ESHOPE
 * (KONTRAKT-API-V5-2026-08-13: body A1, A2, A4; rozhodnutie R2; I11).
 *
 * ČO TENTO MODUL RIEŠI
 * --------------------
 * Prečíta `GET /api/products/getFull` pre VYBRANÉ produkty a postaví skutočný
 * stav zľavy vedľa toho, čo si appka sama zapísala. Aritmetiku porovnania
 * vlastní `reduction-compare.ts`; tento modul rieši cestu k dátam: oprávnenie,
 * kľúč, rozpočet, strop a to, čo sa stane, keď sa niečo z toho nedá.
 *
 * PREČO LEN PRE VYBRANÉ PRODUKTY
 * ------------------------------
 * `getFull` je volanie NA PRODUKT a katalóg má 41 082 produktov. Pri dnešnom
 * strope (20 volaní s kľúčom za minútu, 200 za UTC deň) by jeden prechod trval
 * TÝŽDNE — a minul by presne ten rozpočet, z ktorého zapisuje fronta. Overuje sa
 * preto výhradne to, na čo sa niekto pýta: označené riadky a produkt otvorený
 * v detaile. Plošné overovanie tu neexistuje a nesmie vzniknúť (RZ3).
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ A PREČO
 * -------------------------------------------
 *  1. **Neprečítaný produkt sa NIKDY nestratí a NIKDY nevyzerá ako „sedí".**
 *     Každé vyžiadané ID (do stropu) dostane riadok. Keď sa `getFull` nevolal
 *     alebo neodpovedal, riadok má výrok `unknown` a stav eshopu `not_checked`
 *     alebo `read_failed`. Vynechať ho by bolo ticho, a ticho na obrazovke
 *     vyzerá presne ako „všetko v poriadku" (I11).
 *  2. **Oprávnenie sa zisťuje JEDNOU cestou.** `shopCapability()` nad pamäťou
 *     `whoami` (`product-codes.ts`) — druhá cesta k tej istej otázke by sa po
 *     prvej zmene rozišla. Tri stavy, nikdy dva: má · nemá · NEVIEME. Kým je
 *     stav `unknown` alebo `locked`, `getFull` sa NEVOLÁ vôbec — poslať volanie,
 *     o ktorom vieme, že ho shop odmietne, je zbytočne minutý zásah.
 *  3. **Rozpočet sa rezervuje PRED volaním a z počítadla, ktoré modul nevlastní.**
 *     Rezervácia chodí cez `ReadBudget` z `@/lib/shop/read-budget` — vlastné
 *     počítadlo by znamenalo dve čísla, ktoré si navzájom kradnú strop.
 *     POZOR: `getFull` je čítanie S KĽÚČOM, takže shop ho účtuje NA KĽÚČ, nie na
 *     IP. Vlastná dráha preň je `product_read` (od 31. 8. 2026; predtým sa to
 *     účtovalo do `anon`, teda do stropu NA IP) — volajúci ju vyberá sám
 *     a tento modul o nej nevie ani slovo.
 *  4. **Neznáme počítadlo NIE JE minutý rozpočet.** `known: false` znamená
 *     „nevieme, koľko dnes odišlo"; nečítať je správne, ale tvrdiť „rozpočet je
 *     minutý" by bolo číslo, ktoré appka nepozná. Dva rôzne výsledky (I11).
 *  5. **Modul NIKDY nehádže.** Overenie je doplnok k obrazovke; keď eshop mlčí,
 *     detail produktu aj detail zľavy sa musia zobraziť aj tak. Chyba ide von
 *     ako KÓD (I1), nikdy ako text odpovede shopu.
 *  6. **Nič sa NEUKLADÁ.** Ani do `catalog_cache` (osem stĺpcov, zrkadlo
 *     VEREJNÉHO zoznamu — dopísané riadky by posunuli „koľko chýba"), ani nikam
 *     inam. `getFull` hlási len práve bežiacu zľavu, takže uložená hodnota
 *     starne v okamihu zápisu a z merania by sa stalo tvrdenie bez merania.
 *     Overenie je preto vždy živé, na vyžiadanie, s časom vedľa čísla.
 *  7. **Žiadne automatické spúšťanie.** Volá sa výhradne z akcie človeka
 *     (kontrakt UI, bod 4). Overovanie na pozadí by ticho zjedlo rozpočet kľúča,
 *     z ktorého zapisuje fronta bežiaca týždne.
 *
 * KDE SA `capability.note` SMIE VYKRESLIŤ
 * ---------------------------------------
 * VÝHRADNE v Nastaveniach → Zamknuté funkcie (`components/settings/LockedFeatures.tsx`),
 * rovnako ako pri hľadaní (kontrakt UI, bod 18). Detail produktu a detail zľavy
 * z tohto výsledku kreslia `verdict` a `unknownCause` — to nie je mlčanie, to je
 * priznanie na mieste. Veta o oprávnení žije na jednom mieste a nerozširuje sa.
 *
 * Vlastník: V16 (overenie skutočnosti).
 */
import type {
  DateOnly,
  Logger,
  SecretRef,
  ShopCtx,
  ShopReductionState,
  Ulid,
  UtcDate,
} from '@/contracts';

import {
  compareReduction,
  deriveOwnReduction,
  summarizeReductions,
  type OwnReductionState,
  type ReductionComparison,
  type ReductionSummary,
} from '@/lib/catalog/reduction-compare';
import { recalledScopes, shopCapability, type ShopCapability } from '@/lib/catalog/product-codes';
import type { ApiKeyRepository } from '@/lib/repo/api-key.repo';
import type { ProductWriteRow } from '@/lib/repo/insights.repo';
import type { ShopClientV5 } from '@/lib/shop/client';
import { newOperationId } from '@/lib/shop/correlation';
import { isShopRequestError } from '@/lib/shop/errors';
import type { ReadBudget, ReadBudgetStatus } from '@/lib/shop/read-budget';

/* ═══════════════════════════ 1. Stropy ════════════════════════════════════ */

/**
 * Tvrdý strop produktov na JEDNO overenie. Nedá sa prekročiť parametrom.
 *
 * Číslo je odvodené, nie zvolené, a je ZÁMERNE rovnaké ako `CODE_LOOKUP_MAX`
 * v `product-codes.ts`: obe volania idú na ten istý endpoint, s tým istým
 * kľúčom, a míňajú tú istú minútovú kvótu (20 volaní za minútu, z toho appka
 * berie 80 % ako rezervu — teda 16). Pri desiatich sa celé overenie zmestí do
 * jednej minúty aj s miestom pre zápis, ktorý práve beží. Vyššie číslo by
 * z overenia spravilo pomalé hromadné čítanie — a to je presne to, čím `getFull`
 * pri 41 082 produktoch byť nesmie (RZ3).
 */
export const REDUCTION_CHECK_MAX = 10;

/**
 * Koľko posledných vlastných zápisov na produkt sa načíta, aby sa dal určiť ten,
 * ktorý sa porovnávaného dňa týka. Produkt býva v jednej, výnimočne v niekoľkých
 * kampaniach; desať je pohodlná rezerva a zároveň strop, ktorý drží dotaz malý.
 */
export const OWN_WRITES_LOOKBACK = 10;

/**
 * Aký podiel DENNEJ čítacej dráhy smie minúť overenie zľavy.
 *
 * `GET /api/catalog/reduction-check` je čítanie, takže bránu pôvodu (D72, len
 * mutácie) mať nemôže, a appka nemá prihlásenie (D98–D100). Cudzia stránka
 * otvorená v tom istom prehliadači teda dokáže na túto cestu posielať GETy —
 * a keďže od 31. 8. 2026 účtuje do dráhy `product_read` (kvóta ZÁPISOVÉHO
 * kľúča), vyčerpala by dennú dráhu (160) za pár minút a vzala by obohacovaniu
 * všetko, čo mu patrí.
 *
 * Strop preto NIE JE len minútový: overenie sa zastaví, keď dráha ako celok
 * prekročí tento podiel. Polovica je vedomé rozdelenie — obohacovaniu katalógu
 * (behu, ktorý trvá dni a nikto ho nespúšťa z prehliadača) zostane vždy aspoň
 * druhá polovica, bez ohľadu na to, koľko GETov niekto pošle. Zápisy chráni
 * `WRITE_QUOTA_RESERVE` na druhej strane (`lib/engine/budget.ts`).
 */
export const REDUCTION_CHECK_LANE_SHARE = 0.5;

/**
 * Koľko čítaní dráhy smie overenie minúť za UTC deň — počíta sa zo stropu,
 * ktorý ohlásil samotný rozpočet (`ReadBudgetStatus.limit`), nie z ručne
 * opísaného čísla. Aspoň jedno: overenie jedného produktu musí ísť aj vtedy,
 * keď je dráha smiešne malá.
 */
export function reductionCheckDailyCeiling(laneLimit: number): number {
  const limit = Number.isFinite(laneLimit) ? Math.max(0, Math.trunc(laneLimit)) : 0;
  return Math.max(1, Math.floor(limit * REDUCTION_CHECK_LANE_SHARE));
}

/* ═══════════════════════════ 2. Tvar výsledku ═════════════════════════════ */

/**
 * Ako dopadlo overenie ako celok.
 *
 * `locked` a `unknown_scope` sa nezlievajú (shop povedal nie × nepýtali sme sa)
 * a `budget_day` a `budget_unknown` tiež nie (meraný fakt × medzera v poznaní).
 * Pri KAŽDOM z týchto výsledkov sú riadky produktov aj tak vyplnené — s výrokom
 * `unknown`, nikdy prázdne.
 */
export type ReductionCheckOutcome =
  /** Eshop odpovedal aspoň na časť; podrobnosti sú v riadkoch. */
  | 'done'
  /** Nebolo sa na čo pýtať. */
  | 'no_ids'
  /** Kľúč oprávnenie `product:read` preukázateľne nemá (meraný fakt). */
  | 'locked'
  /** Nevieme, či ho má — kľúč sa zatiaľ neoveril. */
  | 'unknown_scope'
  /** Kľúč sa nedá načítať (chýba, expiroval, bol wipnutý). */
  | 'no_key'
  /** Dnešný rozpočet čítaní je minutý (meraný fakt). */
  | 'budget_day'
  /** Minútový strop je na hrane; o chvíľu to pôjde. */
  | 'budget_minute'
  /**
   * Denný PODIEL dráhy vyhradený overeniu je minutý (meraný fakt). Dráha ako
   * celok ešte miesto má — zvyšok patrí obohacovaniu katalógu, ktoré sa z
   * prehliadača nespúšťa. Nie je to `budget_day`: tvrdiť „rozpočet je minutý",
   * keď v dráhe zostáva 80 čítaní, by bolo číslo, ktoré appka nepozná (I11).
   */
  | 'budget_shared'
  /** Počítadlo čítaní sa nedá prečítať. */
  | 'budget_unknown'
  /** Čítanie spadlo a beh sa zastavil; to, čo sa stihlo, ostáva v riadkoch. */
  | 'failed';

/** Overenie jedného produktu. Nesie OBE strany, nikdy len výsledok. */
export interface ProductReductionCheck extends ReductionComparison {
  readonly productId: number;
  /**
   * Kedy sa eshopu naozaj pýtalo — konkrétny čas (kontrakt UI, bod 10).
   * `null` = nepýtalo sa, čo je samo o sebe odpoveď na otázku „odkedy to platí".
   */
  readonly checkedAt: UtcDate | null;
  /**
   * KÓD chyby čítania (I1), nikdy text odpovede shopu. `null` = nič nespadlo.
   * Hodnota `'not found'` má vlastný význam: index eshopu ID pozná, ale produkt
   * v ňom nie je — opakovať sa neoplatí a nie je to porucha.
   */
  readonly error: string | null;
}

export interface ReductionCheckResult {
  readonly outcome: ReductionCheckOutcome;
  /** Stav oprávnenia `product:read`. `note` patrí VÝHRADNE do `LockedFeatures`. */
  readonly capability: ShopCapability;
  /** Deň, voči ktorému sa porovnávalo (D31 — logické pásmo, nie UTC). */
  readonly day: DateOnly;
  /** Riadok pre KAŽDÉ vyžiadané ID do stropu, v poradí, v akom prišli. */
  readonly products: readonly ProductReductionCheck[];
  readonly summary: ReductionSummary;
  /** ID nad strop `REDUCTION_CHECK_MAX` — na tie sa vôbec nepozeralo. */
  readonly skippedIds: readonly number[];
  /** Koľko čítaní zo shopu toto overenie minulo. */
  readonly readsUsed: number;
  /** Stav rozpočtu po overení. `null` = počítadlo sa nedalo prečítať (I11). */
  readonly reads: ReadBudgetStatus | null;
  /** Kedy overenie prebehlo — konkrétny čas (kontrakt UI, bod 10). */
  readonly at: UtcDate;
  /** KÓD chyby, ktorá beh zastavila (I1). `null` = nič nespadlo. */
  readonly error: string | null;
}

/* ═══════════════════════════ 3. Závislosti ════════════════════════════════ */

export interface ReductionCheckDeps {
  /**
   * VÝHRADNE `getFull`. Zápis ani rušenie zľavy sa sem nedá podstrčiť — overenie
   * je čítanie a nič v shope nemení.
   */
  readonly shop: Pick<ShopClientV5, 'getProductFull'>;
  /**
   * Kľúč a pamäť jeho scopes. `recallScopes()` sa používa ZÁMERNE namiesto
   * `whoami`: overenie kľúča je samostatné volanie so samostatnou cenou a
   * otvorenie detailu produktu nie je dôvod ho spúšťať.
   */
  readonly apiKey: Pick<ApiKeyRepository, 'loadForUse' | 'recallScopes'>;
  /**
   * História VLASTNÝCH zápisov na jeden produkt — produkčne
   * `insightsRepo.productWrites(id, OWN_WRITES_LOOKBACK)`. Je to dep a nie
   * priamy import repozitára, aby sa porovnanie dalo testovať bez MariaDB.
   */
  readonly ownWrites: (productId: number) => Promise<readonly ProductWriteRow[]>;
  /**
   * Zdieľané počítadlo čítaní zo shopu (A4). Dráhu vyberá volajúci — viď bod 3
   * v doc-bloku modulu.
   */
  readonly reads: Pick<ReadBudget, 'reserve' | 'status'>;
  /** Deň, voči ktorému sa porovnáva. Default: dnešok volajúceho. */
  readonly day: DateOnly;
  readonly logger?: Logger;
  readonly now?: () => UtcDate;
  /** Korelačné ID (D58). Default: nové. */
  readonly operationId?: Ulid;
  /** Koľko produktov overiť. Strop `REDUCTION_CHECK_MAX`. */
  readonly limit?: number;
}

/* ═══════════════════════════ 4. Pomocníci ═════════════════════════════════ */

/**
 * Chyba → KÓD (I1). Rovnaké pravidlo aj rovnaká implementácia ako v
 * `shop-lookup.ts` a `product-codes.ts`: nikdy `message`, lebo hlášky z `fetch`
 * a z `mariadb` bežne nesú hostname alebo cestu k súboru.
 */
function errorCode(error: unknown): string {
  if (isShopRequestError(error)) return error.shopError.code ?? error.shopError.kind;
  if (error instanceof Error && error.name.length > 0) return `local_${error.name}`;
  return 'local_unknown';
}

/** `true` len pre „eshop taký produkt nemá" — jediná chyba, ktorá nezastaví zvyšok. */
function isNotFound(error: unknown): boolean {
  return isShopRequestError(error) && error.shopError.kind === 'not_found';
}

/** Stav eshopu, ktorý znamená „nepýtali sme sa" — nikdy „žiadna zľava". */
const NOT_CHECKED: ShopReductionState = { state: 'unknown', reason: 'not_checked' };

/** Stav eshopu, ktorý znamená „pýtali sme sa a nedozvedeli sme sa to". */
const READ_FAILED: ShopReductionState = { state: 'unknown', reason: 'read_failed' };

/** Vlastné zápisy sa nedali prečítať — NIE JE to „appka nič nezapísala". */
const OWN_UNKNOWN: OwnReductionState = { state: 'unknown' };

/**
 * Vlastné zápisy pre produkt — fail-soft.
 *
 * Keď sa vlastná DB nedá prečítať, vracia sa `unknown`, nie `none`: „appka nič
 * nezapísala" je tvrdenie o vlastných dátach, ktoré nikto nevidel, a viedlo by
 * k tomu, že každá bežiaca zľava by sa ohlásila ako cudzia zmena v admine.
 */
async function safeOwn(productId: number, deps: ReductionCheckDeps): Promise<OwnReductionState> {
  try {
    return deriveOwnReduction(await deps.ownWrites(productId), deps.day);
  } catch (cause) {
    deps.logger?.warn('reduction_check_own_unreadable', {
      productId,
      error: errorCode(cause),
    });
    return OWN_UNKNOWN;
  }
}

/* ═══════════════════════════ 5. Overenie ══════════════════════════════════ */

/**
 * Overí skutočný stav zľavy pre vybrané produkty a porovná ho s vlastnými zápismi.
 *
 * Poradie brán je zámerne toto a nie iné — každá ďalšia stojí viac než tá pred ňou:
 *
 *   1. strop a duplicity (zadarmo),
 *   2. oprávnenie z pamäte `whoami` (zadarmo, bez siete),
 *   3. kľúč (lokálne dešifrovanie),
 *   4. rozpočet — denný, minútový aj denný PODIEL dráhy vyhradený overeniu
 *      (`reductionCheckDailyCeiling()`); jeden dotaz do vlastnej DB,
 *   5. vlastné zápisy (vlastná DB),
 *   6. `getFull` po jednom, sekvenčne (jediná platená časť).
 *
 * Krok 6 je sekvenčný nie kvôli I10 (to je o zápisoch), ale preto, že paralelné
 * čítania s kľúčom by minútový strop kľúča vyčerpali naraz a shop by odmietol aj
 * zápis, ktorý práve beží.
 *
 * @returns report; NIKDY nehádže.
 */
export async function checkReductionsInShop(
  productIds: readonly number[],
  deps: ReductionCheckDeps,
): Promise<ReductionCheckResult> {
  const now = deps.now ?? ((): UtcDate => new Date());
  const log = deps.logger;
  const ctx: ShopCtx = { operationId: deps.operationId ?? newOperationId() };
  const limit = Math.max(
    0,
    Math.min(REDUCTION_CHECK_MAX, Math.trunc(deps.limit ?? REDUCTION_CHECK_MAX)),
  );

  const unique = [...new Set(productIds.filter((id) => Number.isInteger(id) && id > 0))];
  const planned = unique.slice(0, limit);
  const skippedIds = unique.slice(limit);
  const capability = shopCapability(recalledScopes(deps.apiKey), 'product:read');

  /**
   * Jediné miesto, kde sa skladá výsledok — aby žiadna vetva nezabudla na pole
   * a aby sa riadky produktov nedali vynechať ani omylom.
   */
  const report = (
    outcome: ReductionCheckOutcome,
    products: readonly ProductReductionCheck[],
    patch: Partial<ReductionCheckResult> = {},
  ): ReductionCheckResult => ({
    outcome,
    capability,
    day: deps.day,
    products,
    summary: summarizeReductions(products),
    skippedIds,
    readsUsed: 0,
    reads: null,
    at: now(),
    error: null,
    ...patch,
  });

  if (planned.length === 0) return report('no_ids', []);

  /**
   * Riadky pre stav, v ktorom sa `getFull` nevolal ani raz. Vlastné zápisy sa
   * načítajú aj tak: sú z vlastnej DB, nič nestoja a obrazovka vďaka nim vie
   * ukázať aspoň to, čo appka sama zapísala — vedľa priznaného „skutočnosť
   * nevieme".
   */
  const unreadRows = async (): Promise<ProductReductionCheck[]> => {
    const rows: ProductReductionCheck[] = [];
    for (const productId of planned) {
      rows.push({
        productId,
        ...compareReduction(await safeOwn(productId, deps), NOT_CHECKED),
        checkedAt: null,
        error: null,
      });
    }
    return rows;
  };

  /* ── 2. oprávnenie — bez neho sa `getFull` NEVOLÁ ───────────────────────── */

  if (capability.state === 'unknown') return report('unknown_scope', await unreadRows());
  if (capability.state === 'locked') return report('locked', await unreadRows());

  /* ── 3. kľúč ────────────────────────────────────────────────────────────── */

  let key: SecretRef | null;
  try {
    key = await deps.apiKey.loadForUse();
  } catch (cause) {
    // Expirovaný alebo wipnutý kľúč (`ApiKeyError`) nie je chyba overenia — je
    // to dôvod povedať „nedá sa", nie spadnúť.
    return report('no_key', await unreadRows(), { error: errorCode(cause) });
  }
  if (key === null) return report('no_key', await unreadRows());

  /* ── 4. rozpočet — denný aj minútový ────────────────────────────────────── */

  let budget: ReadBudgetStatus;
  try {
    budget = await deps.reads.status();
  } catch (cause) {
    log?.warn('reduction_check_budget_unreadable', { error: errorCode(cause) });
    return report('budget_unknown', await unreadRows(), { error: errorCode(cause) });
  }

  // Neznáme počítadlo NIE JE minutý rozpočet (I11).
  if (!budget.known) return report('budget_unknown', await unreadRows(), { reads: budget });
  if (budget.exhausted) return report('budget_day', await unreadRows(), { reads: budget });

  /*
   * Minútový strop. `reserve()` stráži len denné číslo, lenže overenie posiela
   * až desať čítaní za sebou bez pauzy a v tej istej minúte zapisuje fronta.
   * Plán sa preto SKRÁTI podľa toho, koľko sa do minúty ešte zmestí, a ruší sa
   * len vtedy, keď sa nezmestí ani jedno volanie. Zvyšné riadky ostanú
   * `not_checked` — teda priznané, nie zamlčané.
   */
  const minuteRoom = Math.max(0, budget.minuteLimit - budget.usedThisMinute);
  if (minuteRoom < 1) return report('budget_minute', await unreadRows(), { reads: budget });

  /*
   * DENNÝ PODIEL DRÁHY (31. 8. 2026). Nad `reductionCheckDailyCeiling()` sa
   * overenie nedostane ani po tisíc GEToch — zvyšok dráhy patrí obohacovaniu.
   * Je to jediná brzda, ktorá funguje aj po minútach: minútový strop cudziemu
   * GETu nebráni prísť znova o minútu neskôr.
   */
  const dailyCeiling = reductionCheckDailyCeiling(budget.limit);
  const shareRoom = Math.max(0, dailyCeiling - budget.used);
  if (shareRoom < 1) return report('budget_shared', await unreadRows(), { reads: budget });

  const fetchCap = Math.min(planned.length, minuteRoom, shareRoom);
  /** Prečo sa plán skrátil — minúta shopu, alebo denný podiel dráhy. */
  const capReason: 'none' | 'budget_minute' | 'budget_shared' =
    fetchCap === planned.length ? 'none' : shareRoom <= minuteRoom ? 'budget_shared' : 'budget_minute';

  /* ── 5.+6. vlastné zápisy a `getFull` po jednom ─────────────────────────── */

  const rows: ProductReductionCheck[] = [];
  let readsUsed = 0;
  /** Koľko volaní na eshop sa naozaj poslalo — strop sa počíta z toho, nie z riadkov. */
  let attempted = 0;
  let lastBudget: ReadBudgetStatus = budget;
  let stopped:
    | 'none'
    | 'budget_day'
    | 'budget_unknown'
    | 'budget_minute'
    | 'budget_shared'
    | 'failed' = 'none';
  let error: string | null = null;

  for (const productId of planned) {
    const own = await safeOwn(productId, deps);

    // Vlastná DB mlčí, beh už stojí, alebo sa minúta shopu naplnila: riadok
    // vznikne aj tak, len s priznaným „nevieme". Nikdy sa nevynechá (bod 1).
    if (own.state === 'unknown' || stopped !== 'none' || attempted >= fetchCap) {
      if (stopped === 'none' && attempted >= fetchCap && capReason !== 'none') {
        stopped = capReason;
      }
      rows.push({
        productId,
        ...compareReduction(own, NOT_CHECKED),
        checkedAt: null,
        error: null,
      });
      continue;
    }

    const slot = await deps.reads.reserve(1);
    lastBudget = slot.status;
    if (slot.granted < 1) {
      stopped = slot.status.known ? 'budget_day' : 'budget_unknown';
      rows.push({
        productId,
        ...compareReduction(own, NOT_CHECKED),
        checkedAt: null,
        error: null,
      });
      continue;
    }
    readsUsed += slot.granted;
    attempted += 1;

    try {
      const full = await deps.shop.getProductFull(productId, key, ctx);
      rows.push({
        productId,
        ...compareReduction(own, full.reduction),
        checkedAt: now(),
        error: null,
      });
    } catch (cause) {
      const code = errorCode(cause);
      if (isNotFound(cause)) {
        // Eshop produkt nepozná. Nie je to porucha čítania ani dôvod prestať —
        // je to fakt o tomto jednom produkte a zvyšok pokračuje. Stav zľavy
        // z toho ale NEODVODZUJEME: „produkt nemám" nie je „zľava nebeží".
        rows.push({
          productId,
          ...compareReduction(own, READ_FAILED),
          checkedAt: now(),
          error: code,
        });
        continue;
      }
      // Čokoľvek iné (odmietnutý kľúč, 429, výpadok, zmenený tvar odpovede)
      // zastaví ZVYŠOK: ďalšie ID narazí na to isté a každý pokus ukrojí
      // z kvóty, ktorú potrebuje fronta.
      stopped = 'failed';
      error = code;
      log?.warn('reduction_check_read_failed', { productId, error: code });
      rows.push({
        productId,
        ...compareReduction(own, READ_FAILED),
        checkedAt: now(),
        error: code,
      });
    }
  }

  const summary = summarizeReductions(rows);
  log?.info('reduction_check_done', {
    requested: unique.length,
    checked: rows.filter((row) => row.checkedAt !== null).length,
    match: summary.match,
    differs: summary.differs,
    unknown: summary.unknown,
    readsUsed,
    error: error ?? undefined,
  });

  return report(stopped === 'failed' ? 'failed' : stopped === 'none' ? 'done' : stopped, rows, {
    readsUsed,
    reads: await safeBudget(deps, lastBudget),
    error,
  });
}

/**
 * Stav rozpočtu po behu. Keď sa nedá prečítať, vráti sa POSLEDNÝ ZNÁMY —
 * overenie už prebehlo a zhodiť jeho výsledok kvôli počítadlu by znamenalo
 * zahodiť aj to, za čo sa zaplatilo.
 */
async function safeBudget(
  deps: ReductionCheckDeps,
  fallback: ReadBudgetStatus,
): Promise<ReadBudgetStatus> {
  try {
    return await deps.reads.status();
  } catch {
    return fallback;
  }
}
