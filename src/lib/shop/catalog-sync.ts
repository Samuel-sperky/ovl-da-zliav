/**
 * Aura Zľavy — PLNÁ SYNCHRONIZÁCIA KATALÓGU (KONTRAKT V3: K7).
 *
 * `catalog_cache` prestala byť cache desiatich produktov a stala sa zrkadlom
 * katalógu — 40 483 riadkov. Tento modul ho stránkovane prečíta cez zoznamový
 * endpoint shopu a po dávkach zapíše do vlastnej DB.
 *
 * Čo je na tom podstatné a čo sa nesmie stratiť:
 *
 *  - **Synchronizácia je ČÍTANIE a NESMIE konzumovať zápisový rozpočet (K7).**
 *    Modul volá výhradne `listProducts()` a v celom súbore sa nevyskytuje
 *    `setReduction` ani audit event `write_attempt` — a je na to test, ktorý
 *    skenuje zdroj. Denný strop 200 zápisov (K2) sa počíta z auditu, takže
 *    keby sem `write_attempt` niekedy pribudol, ticho by ukradol rozpočet
 *    fronte, ktorá beží týždne.
 *  - **Kľúč sa nikdy nedotkne.** Čítacie volania shop klienta nemajú parameter
 *    pre `SecretRef` (D48), takže `X-Api-Key` sa pri synchronizácii vôbec
 *    nezostaví (I1). Sync teda funguje aj vtedy, keď kľúč nie je vložený.
 *  - **Stránky idú SEKVENČNE** s pauzou medzi nimi. Nie kvôli I10 (to je o
 *    zápisoch), ale kvôli čítaciemu limitu shopu. Ten je pre volania BEZ kľúča
 *    **30 za minútu a 300 za UTC deň** (`docs/api/sperky-api-v4.md`), nie
 *    „300 za 60 s", ako tu roky stálo — a z tej zámeny vzišla pauza 250 ms,
 *    teda 240 volaní za minútu, osemnásobok stropu. Čísla teraz žijú v
 *    `@/lib/shop/rate-limits` a nedajú sa podliezť ani konfiguráciou.
 *  - **`fetched_at` na riadok** je meraný fakt, nie odhad (K7, P7) — každá
 *    stránka nesie čas, kedy sa naozaj prečítala.
 *  - **Modul NIKDY nehádže.** Zlyhanie na stránke N zastaví beh, ale riadky
 *    zapísané dovtedy zostávajú platné a výsledok je `partial`. Katalóg je
 *    podklad pre výber produktov; jeho výpadok nesmie zhodiť tick ani frontu.
 *
 * Čo tu ZÁMERNE nie je: mazanie riadkov, ktoré shop už nevracia. Produkt, čo
 * zmizol zo zoznamu, môže byť len skrytý; zmazať ho z katalógu by znamenalo
 * tvrdiť o shope niečo, čo nevieme (I11). Na to slúži `markShopStatus()` po
 * konkrétnom `not found` (D49).
 *
 * Vlastník: V7.
 */
import type { AuditWriter, Logger, ProductListItem, ShopClient, ShopCtx, Ulid, UtcDate } from '@/contracts';

import type { CatalogUpsertInput } from '@/lib/repo/catalog.repo';
import { newOperationId } from '@/lib/shop/correlation';
import { MIN_ANON_READ_PAUSE_MS } from '@/lib/shop/rate-limits';

/* ═══════════════════════════ konštanty (K7) ═══════════════════════════════ */

/** Shop stránkuje `per_page` s tvrdým stropom 100 (`docs/api/sperky-api-v4.md`). */
export const CATALOG_PAGE_SIZE = 100;

/**
 * Pauza medzi stránkami — odvodená z anonymného minútového stropu, nie zvolená.
 * Pri 24 povolených čítaniach za minútu to je 2 500 ms.
 *
 * Denný strop 300 volaní znamená, že 405 stránok sa do jedného UTC dňa
 * nezmestí; celý katalóg je dvojdňový beh a musí vedieť pokračovať.
 */
export const CATALOG_PAGE_PAUSE_MS = MIN_ANON_READ_PAUSE_MS;

/**
 * Poistka proti nekonečnému stránkovaniu. 40 483 produktov po 100 je 405
 * stránok; 1 000 je päťnásobná rezerva na rast katalógu a zároveň strop, pri
 * ktorom sa beh zastaví aj vtedy, keby shop stránkovanie pokazil.
 */
export const CATALOG_MAX_PAGES = 1_000;

/* ═══════════════════════════════ typy ═════════════════════════════════════ */

/**
 * Zápisová strana synchronizácie. Zámerne najmenší možný tvar — produkčne to je
 * `catalogRepo` (V4), v testoch in-memory zberač.
 */
export interface CatalogSyncSink {
  /** Dávkový upsert stránky. Vracia počet zapísaných riadkov. */
  upsertMany(records: CatalogUpsertInput[]): Promise<number>;
}

export interface CatalogSyncDeps {
  /** VÝHRADNE čítacia časť klienta — zápis sa sem nedá podstrčiť. */
  shopClient: Pick<ShopClient, 'listProducts'>;
  catalog: CatalogSyncSink;
  audit?: AuditWriter;
  logger?: Logger;
  now?: () => UtcDate;
  sleepFn?: (ms: number) => Promise<void>;
  perPage?: number;
  pausePerPageMs?: number;
  maxPages?: number;
  /** Korelačné ID celého behu (D58). Default: nové. */
  operationId?: Ulid;
}

export type CatalogSyncOutcome = 'ok' | 'partial' | 'failed' | 'empty';

export interface CatalogSyncResult {
  outcome: CatalogSyncOutcome;
  /** Koľko stránok sa naozaj prečítalo. */
  pages: number;
  /** Koľko riadkov sa zapísalo do `catalog_cache`. */
  products: number;
  /** Koľko produktov hlási shop celkovo. `null` = nedozvedeli sme sa to. */
  total: number | null;
  startedAt: UtcDate;
  finishedAt: UtcDate;
  durationMs: number;
  /** Kód chyby, ktorá beh zastavila. `null` = dobehol celý. */
  error: string | null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** `ProductListItem` → riadok `catalog_cache`. Cena je DECIMAL, nikdy float (§2). */
export function toCatalogRow(
  product: ProductListItem,
  fetchedAt: UtcDate,
): CatalogUpsertInput {
  return {
    productId: product.id,
    name: typeof product.name === 'string' ? product.name : null,
    // `DECIMAL(10,2)` sa do DB posiela ako string — číslo by prešlo cez float.
    price: Number.isFinite(product.price) ? product.price.toFixed(2) : null,
    hasAttributes: product.has_attributes === true,
    // Produkt, ktorý zoznam práve vrátil, v shope existuje (K1 bod 2).
    shopStatus: 'ok',
    source: 'list',
    fetchedAt,
    // I1 — `raw` musí byť redigované; zoznam nesie len id/name/price/atribúty,
    // takže sa ukladá presne to, čo sme dostali, a nič citlivé v ňom nie je.
    raw: product,
  };
}

/* ═══════════════════════════ synchronizácia ═══════════════════════════════ */

/**
 * Prečíta celý katalóg stránkovane a zrkadlí ho do `catalog_cache`.
 *
 * @returns report behu; NIKDY nehádže.
 */
export async function syncCatalog(deps: CatalogSyncDeps): Promise<CatalogSyncResult> {
  const now = deps.now ?? ((): UtcDate => new Date());
  const log = deps.logger;
  const sleepFn = deps.sleepFn ?? defaultSleep;
  const perPage = Math.min(CATALOG_PAGE_SIZE, Math.max(1, Math.trunc(deps.perPage ?? CATALOG_PAGE_SIZE)));
  // Podlaha, nie predvoľba: pauza sa nedá podliezť ani konfiguráciou, rovnako
  // ako `MIN_WRITE_PAUSE_MS` na zápisovej strane. Rýchlosť testov to nebrzdí —
  // tie si podsúvajú vlastné `sleepFn`.
  const pauseMs = Math.max(
    MIN_ANON_READ_PAUSE_MS,
    Math.trunc(deps.pausePerPageMs ?? CATALOG_PAGE_PAUSE_MS),
  );
  const maxPages = Math.max(1, Math.trunc(deps.maxPages ?? CATALOG_MAX_PAGES));
  const ctx: ShopCtx = { operationId: deps.operationId ?? newOperationId() };

  const startedAt = now();
  let pages = 0;
  let products = 0;
  let total: number | null = null;
  let error: string | null = null;
  /** Prvé ID predchádzajúcej stránky — obrana proti shopu, čo ignoruje `page`. */
  let previousFirstId: number | null = null;

  for (let page = 1; page <= maxPages; page += 1) {
    let batch: Awaited<ReturnType<ShopClient['listProducts']>>;
    try {
      batch = await deps.shopClient.listProducts({ page, perPage }, ctx);
    } catch (cause) {
      error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      log?.error('catalog_sync_page_failed', { page, error });
      break;
    }

    const data = Array.isArray(batch.data) ? batch.data : [];
    if (Number.isFinite(batch.total)) total = batch.total;
    if (data.length === 0) break;

    // Shop, ktorý `page` ignoruje, by nám donekonečna vracal prvú stránku a
    // upsert by to nikdy neodhalil (kľúč je rovnaký). Radšej zastaviť.
    const firstId = data[0]?.id ?? null;
    if (page > 1 && firstId !== null && firstId === previousFirstId) {
      error = 'pagination_stuck';
      log?.error('catalog_sync_pagination_stuck', { page, firstId });
      break;
    }
    previousFirstId = firstId;

    const fetchedAt = now();
    try {
      products += await deps.catalog.upsertMany(data.map((item) => toCatalogRow(item, fetchedAt)));
    } catch (cause) {
      error = cause instanceof Error ? `upsert_failed: ${cause.message}` : 'upsert_failed';
      log?.error('catalog_sync_upsert_failed', { page, error });
      break;
    }
    pages += 1;

    const done = total !== null && page * perPage >= total;
    if (done || data.length < perPage) break;
    if (pauseMs > 0) await sleepFn(pauseMs);
  }

  const finishedAt = now();
  const outcome: CatalogSyncOutcome =
    error !== null ? (products > 0 ? 'partial' : 'failed') : products > 0 ? 'ok' : 'empty';

  const result: CatalogSyncResult = {
    outcome,
    pages,
    products,
    total,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    error,
  };

  log?.[error === null ? 'info' : 'warn']('catalog_sync_done', {
    outcome,
    pages,
    products,
    total: total ?? undefined,
    durationMs: result.durationMs,
    error: error ?? undefined,
  });

  // Audit je append-only (I4) a zapisuje sa cez `appendAudit()`, ktoré samo
  // nikdy nehádže — napriek tomu je tu poistka, aby výpadok auditu nezmenil
  // úspešnú synchronizáciu na výnimku.
  if (deps.audit !== undefined) {
    try {
      await deps.audit.appendAudit({
        actor: 'scheduler',
        eventType: 'catalog_refreshed',
        ok: error === null,
        operationId: ctx.operationId,
        message:
          `Synchronizácia katalógu: ${products} riadkov z ${pages} stránok` +
          `${total === null ? '' : ` (shop hlási ${total} produktov)`}` +
          `${error === null ? '.' : ` — zastavené na chybe ${error}.`}`,
      });
    } catch {
      /* audit nesmie zhodiť synchronizáciu */
    }
  }

  return result;
}
