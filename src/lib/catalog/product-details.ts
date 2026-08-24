/**
 * Aura Zľavy — DOŤAHOVANIE DETAILOV PRODUKTU DO ZRKADLA
 * (kód produktu, EAN, sklad, varianty).
 *
 * ČO TENTO MODUL RIEŠI
 * --------------------
 * Zrkadlo katalógu má 41 220 riadkov a všetky prišli zoznamovým prechodom
 * (`source = 'list'`). V `raw` je preto len `{id, name, price, has_attributes}`
 * — kód produktu ani EAN v ňom nie sú ANI RAZ. Používateľ pritom potrebuje
 * k názvu aj kód alebo skladové číslo, inak sa produkt v tabuľke nedá
 * identifikovať.
 *
 * Tento modul dotiahne detail pre KONKRÉTNE ID a zapíše ho do TÝCH ISTÝCH
 * riadkov zrkadla: `raw` = celá odpoveď, `source` = `batch` (alebo `get`, keď
 * dávka spadne na jednotlivé volania), `fetched_at` = teraz. Názov, cena
 * a `has_attributes` sa AKTUALIZUJÚ, nie zdvojujú — je to jeden riadok na
 * produkt (`ON DUPLICATE KEY UPDATE` v `upsertMany`).
 *
 * DVE CESTY A JEDNO MIESTO, KDE SA MEDZI NIMI ROZHODUJE
 * -----------------------------------------------------
 * `chooseDetailRoute()` je JEDINÉ miesto, kde sa rozhoduje `get` vs. `getFull`.
 * Rozhodnutie sa nesmie rozliezť na päť miest — z piatich kópií sa po prvej
 * zmene stanú tri rôzne odpovede na tú istú otázku.
 *
 *  - **`get`** (verejný, bez kľúča, dávkovateľný). Dá `description`,
 *    `description_short` a `attributes[]`, kde KAŽDÝ VARIANT nesie `reference`,
 *    `ean13` a `quantity`. Na úrovni produktu kód ani sklad NEDÁVA.
 *  - **`getFull`** (za scope `product:read`). To isté plus `reference`,
 *    `ean13`, `qty`, maržu, dodávateľa a kategórie NA ÚROVNI PRODUKTU.
 *
 * Dôsledok, ktorý sa nesmie zamlčať: **bez `product:read` sa kód a sklad dajú
 * získať len pre produkty s variantmi — 8 663 zo 41 220.** O zvyšných 32 557
 * appka kód nemá a nesmie predstierať, že áno. Preto sa cesta ukladá do dát
 * (`catalogDetailRoute()` v `catalog.repo.ts`) a preto má každá chýbajúca
 * hodnota dôvod (`needs_product_read` vs. `shop_has_none`).
 *
 * ROZPOČET — NAJDÔLEŽITEJŠIA ČASŤ TOHTO SÚBORU
 * --------------------------------------------
 * **Dávka NEŠETRÍ rozpočet.** Dokumentácia shopu (`docs/api/sperky-api.md`,
 * sekcia Batch) to hovorí doslova: 25 položiek minie 25 hitov PLUS jeden za
 * samotné volanie dávky. Dávka šetrí latenciu a atomicitu volania, nie kvótu.
 * Kto si myslí, že stránka tabuľky stojí „2 dávky", počíta 2 namiesto 52.
 *
 * Anonymný strop je po rezerve 24 volaní za minútu a 240 za UTC deň na IP,
 * a delí sa so synchronizáciou katalógu (413 volaní na jeden prechod). Z toho
 * plynie všetko ostatné:
 *
 *  1. **Jedno zavolanie doplní nanajvýš jednu dávku.** Dávka o `k` položkách
 *     stojí `k + 1` a do minúty sa zmestí 24, takže `k ≤ 23`. Druhá dávka by
 *     v tej istej minúte strop prekročila a shop by IP zabanoval (predvolene
 *     na 10 minút) aj so synchronizáciou.
 *  2. **Nespí sa.** `MIN_ANON_READ_PAUSE_MS` (2 500 ms) je pauza, ktorá má
 *     zaručiť, že za minútu neodíde viac než 24 volaní. Tú istú záruku dáva
 *     `ANON_BURST_CAP` bez toho, aby HTTP request stál minútu a pol —
 *     rovnaké riešenie ako v `shop-lookup.ts`.
 *  3. **Nikdy sa nedopĺňa celý katalóg.** 41 220 / 25 = 1 649 dávok, teda
 *     42 869 volaní a pri 240 za deň skoro šesť mesiacov. Dokumentácia shopu
 *     hromadné sťahovanie výslovne zakazuje. Doťahuje sa VÝHRADNE to, čo si
 *     niekto naozaj pozrie.
 *  4. **Čo už detail má, sa nedoťahuje znova** (`force` to prebije). Za názov,
 *     ktorý appka má na disku, sa druhýkrát neplatí.
 *  5. **Keď rozpočet nestačí, appka to POVIE a nedoplní.** Nikdy sa nevráti
 *     staré číslo ako nové — nedoplnený riadok zostáva `not_fetched`.
 *
 * `getFull` míňa rozpočet NA KĽÚČ, nie anonymný na IP — do `shop_read_budget`
 * sa teda neúčtuje (rovnako ako `resolveProductCodes()`). Zato ukrojí z tej
 * istej kvóty, z ktorej zapisuje fronta bežiaca týždne, a naviac sa cez
 * `/api/batch` fanúť nedá (opt-in majú len `products/get` a `order/get`).
 * Preto má vlastný, oveľa nižší strop `DETAIL_FULL_MAX`.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *  - **Modul NIKDY nehádže.** Detail je doplnok; keď shop mlčí, tabuľka sa
 *    musí zobraziť aj tak. Chyba ide von ako KÓD (I1), nikdy ako text
 *    odpovede shopu.
 *  - **Rezervuje sa PRED volaním.** Request, ktorý skončil na 429, sa do
 *    stropu shopu počíta rovnako ako úspešný.
 *  - **Nečitateľné počítadlo NIE JE minutý rozpočet** (I11). Sú to dve rôzne
 *    vety: `budget_unknown` vs. `budget_day`.
 *  - **I8** — nová cesta na shop tu nevzniká; volá sa výhradne existujúci
 *    klient (`batchGetProducts`, `getProductFull`). I6: žiadna sieť mimo shopu.
 *
 * Vlastník: E1 (detaily katalógu).
 */
import type { Logger, MoneyString, SecretRef, ShopCtx, Ulid, UtcDate } from '@/contracts';

import { shopCapability, recalledScopes, type ShopCapability } from '@/lib/catalog/product-codes';
import type { ApiKeyRepository } from '@/lib/repo/api-key.repo';
import type { CatalogRepoExt, CatalogUpsertInput } from '@/lib/repo/catalog.repo';
import { BATCH_MAX_ITEMS, type ShopClientV5 } from '@/lib/shop/client';
import { newOperationId } from '@/lib/shop/correlation';
import { isShopError, isShopRequestError } from '@/lib/shop/errors';
import { MIN_ANON_READ_PAUSE_MS } from '@/lib/shop/rate-limits';
import type { ReadBudgetStatus } from '@/lib/shop/read-budget';

/* ═══════════════════════════ 1. Stropy a ceny ═════════════════════════════ */

/**
 * Koľko anonymných čítaní smie odísť za sebou bez pauzy.
 *
 * Odvodené z `MIN_ANON_READ_PAUSE_MS`, nie zvolené: pauza 2 500 ms existuje
 * preto, aby za minútu neodišlo viac než 24 volaní. Táto konštanta je tá istá
 * záruka vyjadrená ako počet, aby sa nemuselo spať vnútri HTTP requestu.
 * Keď sa pauza zmení, zmení sa aj toto číslo samo.
 */
export const ANON_BURST_CAP = Math.floor(60_000 / MIN_ANON_READ_PAUSE_MS);

/**
 * Koľko ID smie prísť na jedno doplnenie. Stránka tabuľky má 50 riadkov;
 * strop 100 je priestor na dve stránky, nie pozvánka na katalóg.
 *
 * Doplní sa z nich len toľko, koľko dovolí rozpočet — zvyšok sa PRIZNÁ ako
 * nedoplnený, nie ticho zahodí.
 */
export const DETAIL_FILL_MAX = 100;

/**
 * Strop cesty `getFull` na jedno volanie.
 *
 * Rovnaké číslo a rovnaký dôvod ako `CODE_LOOKUP_MAX` v `product-codes.ts`:
 * `getFull` sa nedá dávkovať, ide s kľúčom a shop rozpočtuje volania s kľúčom
 * na kľúč — teda z tej istej kvóty, z ktorej zapisuje fronta. Kým appka nemá
 * samostatný kľúč na čítanie, je každý dotiahnutý detail jeden nezapísaný
 * produkt.
 */
export const DETAIL_FULL_MAX = 10;

/**
 * Koľko anonymných čítaní stojí doplnenie `count` produktov cez `/api/batch`.
 *
 * `count` hitov za položky + jeden za obálku každej dávky. NIE `count / 25`.
 * Toto je jediné miesto, kde sa cena dávky počíta — plánovanie aj odhad pre
 * UI berú číslo odtiaľto, aby sa nedali rozísť.
 */
export function anonReadCost(count: number): number {
  const items = Math.max(0, Math.trunc(count));
  if (items === 0) return 0;
  return items + Math.ceil(items / BATCH_MAX_ITEMS);
}

/* ═══════════════════════════ 2. Tvar výsledku ═════════════════════════════ */

/** Ktorou cestou sa doťahovalo. Rozhoduje sa v `chooseDetailRoute()`. */
export type DetailFetchRoute = 'get' | 'getFull';

/**
 * Ako dopadlo doplnenie ako celok.
 *
 * `budget_day` (meraný fakt — dnes už nič) a `budget_unknown` (počítadlo sa
 * nedá prečítať) sa ZÁMERNE nezlievajú: druhé je medzera v poznaní a tvrdiť
 * pri ňom „rozpočet je minutý" by bolo číslo, ktoré appka nepozná (I11).
 */
export type DetailFillOutcome =
  /** Aspoň niečo sa doplnilo, alebo nebolo čo dopĺňať. */
  | 'done'
  /** Prišiel prázdny zoznam ID. Nič sa nevolalo. */
  | 'no_ids'
  /** Dnešný anonymný rozpočet je minutý (meraný fakt). */
  | 'budget_day'
  /** Minútový strop je vyčerpaný; o chvíľu to pôjde. */
  | 'budget_minute'
  /** Počítadlo čítaní sa nedá prečítať — nevieme, koľko dnes odišlo. */
  | 'budget_unknown'
  /** Cesta `getFull` bola zvolená, ale kľúč sa nedá načítať. */
  | 'no_key'
  /** Shop neodpovedal, alebo odpovedal inak, než appka čaká. */
  | 'failed';

/** Prečo sa nedoplnili všetky ID. `none` = doplnili sa všetky. */
export type DetailFillStop =
  | 'none'
  | 'limit'
  | 'budget_minute'
  | 'budget_day'
  | 'budget_unknown'
  | 'failed';

export interface ProductDetailsResult {
  readonly outcome: DetailFillOutcome;
  /** Cesta, ktorou sa (malo) doťahovať — aj keď sa nakoniec nič nedotiahlo. */
  readonly route: DetailFetchRoute;
  /** Stav oprávnenia `product:read`: má · nemá · nevieme. */
  readonly capability: ShopCapability;
  /** ID, ktorých riadok v zrkadle sa práve teraz doplnil. */
  readonly filled: readonly number[];
  /** ID, ktoré už detail malo — nič sa za ne neplatilo. */
  readonly alreadyDetailed: readonly number[];
  /** ID, na ktoré shop odpovedal „taký produkt nemám" (riadok dostal `not_found`). */
  readonly notInShop: readonly number[];
  /** ID, na ktoré sa nedostalo. Dôvod v `notFilledReason`. */
  readonly notFilled: readonly number[];
  readonly notFilledReason: DetailFillStop;
  /** Koľko anonymných čítaní doplnenie minulo. Cesta `getFull` míňa kľúč, nie toto. */
  readonly readsUsed: number;
  /** Stav anonymného rozpočtu PO doplnení. `null` = nedá sa prečítať (I11). */
  readonly reads: ReadBudgetStatus | null;
  /** Kedy sa dopĺňalo. Konkrétny čas, nikdy „pred chvíľou". */
  readonly at: UtcDate;
  /** KÓD chyby (I1). `null` = nič nespadlo. */
  readonly error: string | null;
}

/* ═══════════════════════════ 3. Závislosti ════════════════════════════════ */

export interface ProductDetailsDeps {
  /**
   * Čítacia časť klienta. `setReduction` sa sem nedá podstrčiť; `getProductFull`
   * je jediné, čo berie `SecretRef`, a berie ho ako VÝSLOVNÝ parameter (D48).
   */
  readonly shop: Pick<ShopClientV5, 'batchGetProducts' | 'getProductFull'>;
  /**
   * Zrkadlo a JEDINÉ dvere k zdieľanému rozpočtu čítaní (A4). Vlastné
   * počítadlo si tu nikto nezakladá.
   */
  readonly catalog: Pick<
    CatalogRepoExt,
    'detailsFor' | 'upsertMany' | 'markShopStatus' | 'reserveShopReads' | 'shopReadBudget'
  >;
  /**
   * Kľúč a pamäť jeho scopes. `recallScopes()` ZÁMERNE namiesto `whoami`:
   * overenie kľúča je samostatné volanie so samostatnou cenou a doplnenie
   * tabuľky nie je dôvod ho spúšťať.
   */
  readonly apiKey: Pick<ApiKeyRepository, 'loadForUse' | 'recallScopes'>;
  readonly logger?: Logger;
  readonly now?: () => UtcDate;
  readonly operationId?: Ulid;
  /** Doplň aj to, čo detail už má (napr. „obnov tento riadok"). Default `false`. */
  readonly force?: boolean;
}

/* ═══════════════════════════ 4. Pomocníci ═════════════════════════════════ */

/**
 * Chyba → KÓD (I1). Rovnaké pravidlo aj rovnaká implementácia ako
 * v `shop-lookup.ts`: nikdy `message`, lebo hlášky z `fetch` bežne nesú
 * hostname alebo cestu k súboru.
 */
function errorCode(error: unknown): string {
  if (isShopRequestError(error)) return error.shopError.code ?? error.shopError.kind;
  if (isShopError(error)) return error.code ?? error.kind;
  if (error instanceof Error && error.name.length > 0) return `local_${error.name}`;
  return 'local_unknown';
}

function isNotFound(error: unknown): boolean {
  if (isShopRequestError(error)) return error.shopError.kind === 'not_found';
  return isShopError(error) && error.kind === 'not_found';
}

/** Cena v `DECIMAL(10,2)` ako string — nikdy float na povrchu (§2). */
function toMoneyString(price: unknown): MoneyString | null {
  return typeof price === 'number' && Number.isFinite(price)
    ? (price.toFixed(2) as MoneyString)
    : null;
}

/**
 * JEDINÉ miesto, kde sa rozhoduje `get` vs. `getFull`.
 *
 * `getFull` sa použije LEN vtedy, keď je oprávnenie `product:read`
 * preukázateľne k dispozícii. Pri `unknown` (kľúč sa zatiaľ neoveril) sa ide
 * verejnou cestou: `getFull` by bez oprávnenia vrátil `forbidden`, minul by
 * kvótu kľúča a používateľ by namiesto kódu variantov, ktoré appka vie
 * prečítať zadarmo, nedostal nič.
 */
export function chooseDetailRoute(capability: ShopCapability): DetailFetchRoute {
  return capability.state === 'available' ? 'getFull' : 'get';
}

/* ═══════════════════════════ 5. Doplnenie detailov ════════════════════════ */

/**
 * Dotiahne detaily pre zadané ID a zapíše ich do zrkadla.
 *
 * @returns report; NIKDY nehádže.
 */
export async function fillProductDetails(
  productIds: readonly number[],
  deps: ProductDetailsDeps,
): Promise<ProductDetailsResult> {
  const now = deps.now ?? ((): UtcDate => new Date());
  const log = deps.logger;
  const ctx: ShopCtx = { operationId: deps.operationId ?? newOperationId() };

  const capability = shopCapability(recalledScopes(deps.apiKey), 'product:read');
  const route = chooseDetailRoute(capability);

  const unique = [...new Set(productIds.filter((id) => Number.isInteger(id) && id > 0))].slice(
    0,
    DETAIL_FILL_MAX,
  );

  /** Jediné miesto, kde sa skladá výsledok — aby žiadna vetva na pole nezabudla. */
  const report = (
    outcome: DetailFillOutcome,
    patch: Partial<ProductDetailsResult> = {},
  ): ProductDetailsResult => ({
    outcome,
    route,
    capability,
    filled: [],
    alreadyDetailed: [],
    notInShop: [],
    notFilled: [],
    notFilledReason: 'none',
    readsUsed: 0,
    reads: null,
    at: now(),
    error: null,
    ...patch,
  });

  if (unique.length === 0) return report('no_ids');

  /* ── 1. Čo detail už má (jeden dotaz do vlastnej DB, zadarmo) ──────────── */

  let alreadyDetailed: number[] = [];
  let pending = [...unique];
  if (deps.force !== true) {
    try {
      const existing = await deps.catalog.detailsFor(unique);
      alreadyDetailed = unique.filter((id) => {
        const row = existing.get(id);
        if (row === undefined) return false;
        // Riadok z `getFull` je nadmnožina `get` — verejnou cestou by sa
        // prepísal na chudobnejší a kód produktu by z tabuľky zmizol.
        return row.route === 'getFull' || row.route === route;
      });
      const skip = new Set(alreadyDetailed);
      pending = unique.filter((id) => !skip.has(id));
    } catch (cause) {
      // Nečitateľné zrkadlo nie je dôvod nedoplniť — nanajvýš sa zaplatí za
      // detail, ktorý appka možno už má. Chybu vidí log, nie používateľ.
      log?.warn('detail_fill_mirror_unreadable', { error: errorCode(cause) });
    }
  }

  if (pending.length === 0) return report('done', { alreadyDetailed });

  return route === 'getFull'
    ? await fillViaGetFull({ pending, alreadyDetailed, capability, deps, ctx, now, report })
    : await fillViaBatch({ pending, alreadyDetailed, deps, ctx, now, log, report });
}

/* ─────────────── 5a. Verejná cesta: `/api/batch` + `get` ──────────────── */

interface FillInput {
  readonly pending: number[];
  readonly alreadyDetailed: number[];
  readonly deps: ProductDetailsDeps;
  readonly ctx: ShopCtx;
  readonly now: () => UtcDate;
  readonly log?: Logger | undefined;
  readonly report: (
    outcome: DetailFillOutcome,
    patch?: Partial<ProductDetailsResult>,
  ) => ProductDetailsResult;
}

async function fillViaBatch(input: FillInput): Promise<ProductDetailsResult> {
  const { deps, ctx, now, log, report } = input;
  const pending = [...input.pending];
  const alreadyDetailed = input.alreadyDetailed;

  let status: ReadBudgetStatus;
  try {
    status = await deps.catalog.shopReadBudget();
  } catch (cause) {
    log?.warn('detail_fill_budget_unreadable', { error: errorCode(cause) });
    return report('budget_unknown', {
      alreadyDetailed,
      notFilled: pending,
      notFilledReason: 'budget_unknown',
      error: errorCode(cause),
    });
  }

  // Neznáme počítadlo NIE JE minutý rozpočet (I11).
  if (!status.known) {
    return report('budget_unknown', {
      alreadyDetailed,
      notFilled: pending,
      notFilledReason: 'budget_unknown',
      reads: status,
    });
  }
  if (status.exhausted) {
    return report('budget_day', {
      alreadyDetailed,
      notFilled: pending,
      notFilledReason: 'budget_day',
      reads: status,
    });
  }

  const filled: number[] = [];
  const notInShop: number[] = [];
  let readsUsed = 0;
  let stop: DetailFillStop = 'none';
  let error: string | null = null;

  while (pending.length > 0) {
    /*
     * Koľko sa ešte zmestí. Cena dávky o `k` položkách je `k + 1`, takže sa
     * plánuje `k = room - 1`. Pri prázdnej minúte je `room` 24 a `k` teda 23 —
     * druhá dávka v tej istej minúte už neprejde a to je správne.
     */
    const minuteRoom = Math.min(status.minuteLimit - status.usedThisMinute, ANON_BURST_CAP);
    const planned = Math.min(BATCH_MAX_ITEMS, pending.length, minuteRoom - 1, status.remaining - 1);
    if (planned < 1) {
      stop = minuteRoom - 1 < 1 ? 'budget_minute' : 'budget_day';
      break;
    }

    const reservation = await deps.catalog.reserveShopReads(anonReadCost(planned));
    status = reservation.status;
    readsUsed += reservation.granted;
    // Pod dve rezervované čítania sa nezmestí ani obálka dávky s jednou položkou.
    if (reservation.granted < 2) {
      stop = status.known ? 'budget_day' : 'budget_unknown';
      break;
    }

    // Rezervácia smie byť čiastočná; plán sa vtedy SKRÁTI na to, čo sa ušlo.
    // Prebytočné rezervované čítanie sa nevracia — chyba smerom k opatrnosti.
    const chunk = pending.splice(0, Math.min(planned, reservation.granted - 1));

    let outcome: Awaited<ReturnType<ShopClientV5['batchGetProducts']>>;
    try {
      outcome = await deps.shop.batchGetProducts([...chunk], ctx);
    } catch (cause) {
      // `batchGetProducts` chyby normálne vracia, nie hádže — sem sa dostane
      // len porucha pod ním (napr. nečitateľná doména shopu).
      error = errorCode(cause);
      stop = 'failed';
      pending.unshift(...chunk);
      log?.warn('detail_fill_batch_failed', { count: chunk.length, error });
      break;
    }

    const source = outcome.via === 'single' ? 'get' : 'batch';
    const records: CatalogUpsertInput[] = [];
    for (const productId of chunk) {
      const value = outcome.results.get(productId);
      if (value === undefined) continue;
      if (isShopError(value)) {
        if (value.kind === 'not_found') {
          notInShop.push(productId);
          continue;
        }
        // Čokoľvek iné je porucha jednej položky — dávka pokračuje, ale
        // dôvod sa nezamlčí. Prvý kód vyhrá; ďalšie sú to isté.
        error ??= value.code ?? value.kind;
        continue;
      }
      records.push({
        productId: value.id,
        name: typeof value.name === 'string' ? value.name : null,
        price: toMoneyString(value.price),
        hasAttributes: value.has_attributes === true,
        shopStatus: 'ok',
        source,
        fetchedAt: now(),
        // `raw` je HOLÁ odpoveď, nie obálka — číta ju aj `variantStockFromRaw()`.
        raw: value,
      });
    }

    if (records.length > 0) {
      try {
        await deps.catalog.upsertMany(records);
        for (const record of records) filled.push(record.productId);
      } catch (cause) {
        // Zaplatené a nezapísané. Nedá sa nič vrátiť, ale nesmie sa tváriť,
        // že riadok detail má — inak by ho `alreadyDetailed` navždy preskočilo.
        error ??= errorCode(cause);
        stop = 'failed';
        log?.warn('detail_fill_write_failed', { count: records.length, error });
        break;
      }
    }

    for (const productId of notInShop) {
      // D49 — riadok zostáva, mení sa len stav. Nikdy sa nemaže.
      try {
        await deps.catalog.markShopStatus(productId, 'not_found');
      } catch {
        // Stav sa nezapísal; produkt sa nabudúce skúsi znova. Neškodí.
      }
    }

    if (error !== null && stop === 'none') stop = 'failed';
  }

  const notFilled = pending;
  return report(error !== null && filled.length === 0 ? 'failed' : 'done', {
    alreadyDetailed,
    filled,
    notInShop,
    notFilled,
    notFilledReason: notFilled.length === 0 ? 'none' : stop === 'none' ? 'limit' : stop,
    readsUsed,
    reads: await safeBudget(deps, status),
    error,
  });
}

/* ─────────────── 5b. Cesta s kľúčom: `getFull` po jednom ──────────────── */

interface FullFillInput extends FillInput {
  readonly capability: ShopCapability;
}

/**
 * `getFull` po jednom, sekvenčne a do nízkeho stropu.
 *
 * Sekvenčne nie kvôli I10 (to je o zápisoch), ale preto, že paralelné čítania
 * s kľúčom by minútový strop kľúča vyčerpali naraz a shop by odmietol aj
 * zápis, ktorý práve beží.
 *
 * Anonymné počítadlo sa tu ZÁMERNE nerezervuje: volanie ide s kľúčom a shop
 * rozpočtuje volania s kľúčom na kľúč, nie na IP. Účtovať ich do
 * `shop_read_budget` by ukradlo strop synchronizácii katalógu za volania,
 * ktoré ju vôbec neminuli.
 */
async function fillViaGetFull(input: FullFillInput): Promise<ProductDetailsResult> {
  const { deps, ctx, now, report } = input;
  const log = deps.logger;
  const alreadyDetailed = input.alreadyDetailed;
  const planned = input.pending.slice(0, DETAIL_FULL_MAX);
  const overLimit = input.pending.slice(DETAIL_FULL_MAX);

  let key: SecretRef | null;
  try {
    key = await deps.apiKey.loadForUse();
  } catch (cause) {
    // Expirovaný alebo wipnutý kľúč nie je chyba doplnenia — je to dôvod
    // povedať „nedá sa", nie spadnúť.
    return report('no_key', {
      alreadyDetailed,
      notFilled: input.pending,
      notFilledReason: 'failed',
      error: errorCode(cause),
    });
  }
  if (key === null) {
    return report('no_key', {
      alreadyDetailed,
      notFilled: input.pending,
      notFilledReason: 'failed',
    });
  }

  const filled: number[] = [];
  const notInShop: number[] = [];
  const notFilled: number[] = [...overLimit];
  let stop: DetailFillStop = overLimit.length > 0 ? 'limit' : 'none';
  let error: string | null = null;

  for (let index = 0; index < planned.length; index += 1) {
    const productId = planned[index] as number;
    try {
      const full = await deps.shop.getProductFull(productId, key, ctx);
      await deps.catalog.upsertMany([
        {
          productId: full.id,
          name: typeof full.name === 'string' ? full.name : null,
          price: toMoneyString(full.price),
          hasAttributes: full.has_attributes === true,
          shopStatus: 'ok',
          // `source` je `enum('list','get','batch')` — `getFull` v ňom nie je
          // a migrácia sa nerobí. Cestu prezradí pole `reduction` v `raw`,
          // ktoré `get` nikdy nenesie (viď `catalogDetailRoute()`).
          source: 'get',
          fetchedAt: now(),
          raw: full,
        },
      ]);
      filled.push(full.id);
    } catch (cause) {
      if (isNotFound(cause)) {
        notInShop.push(productId);
        try {
          await deps.catalog.markShopStatus(productId, 'not_found');
        } catch {
          // Stav sa nezapísal; produkt sa nabudúce skúsi znova.
        }
        continue;
      }
      // Zastavenie na prvej chybe je vedomé: ďalšie ID narazí na to isté
      // (odmietnutý kľúč, limit, výpadok) a každý pokus ukrojí z kvóty,
      // ktorú potrebuje fronta.
      error = errorCode(cause);
      stop = 'failed';
      notFilled.unshift(...planned.slice(index));
      log?.warn('detail_fill_full_failed', { productId, error });
      break;
    }
  }

  return report(error !== null && filled.length === 0 ? 'failed' : 'done', {
    alreadyDetailed,
    filled,
    notInShop,
    notFilled,
    notFilledReason: notFilled.length === 0 ? 'none' : stop === 'none' ? 'limit' : stop,
    readsUsed: 0,
    reads: await safeBudget(deps, null),
    error,
  });
}

/**
 * Stav rozpočtu po behu. Keď sa nedá prečítať, vráti sa POSLEDNÝ ZNÁMY —
 * doplnenie už prebehlo a zhodiť jeho výsledok kvôli počítadlu by znamenalo
 * zahodiť aj to, za čo sa zaplatilo.
 */
async function safeBudget(
  deps: ProductDetailsDeps,
  fallback: ReadBudgetStatus | null,
): Promise<ReadBudgetStatus | null> {
  try {
    return await deps.catalog.shopReadBudget();
  } catch {
    return fallback;
  }
}
