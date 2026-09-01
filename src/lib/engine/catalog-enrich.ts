/**
 * Aura Zľavy — OBOHACOVANIE KATALÓGU Z `GET /api/products/getFull`
 * (KONTRAKT-V4-2026-08-28 §2b: D118, D119, D120; I1, I11).
 *
 * ZÁPISOVÁ strana obohatenia: jediné miesto, ktoré volá `getProductFull()` s
 * úmyslom výsledok ULOŽIŤ do `catalog_cache` (stĺpce z migrácie 0014). Čítacia
 * strana je `catalogRepo.enrichmentFor()`; overenie zľavy naživo bez ukladania
 * je `lib/catalog/reduction-check.ts` a s týmto modulom sa nemieša.
 *
 * PREČO SA CELÝ KATALÓG OBOHATIŤ NEDÁ (zmerané 28. 8. 2026)
 * ---------------------------------------------------------
 * Kvóta kľúča je ~20 volaní/min a ~200/UTC deň. `getFull` je volanie NA JEDEN
 * PRODUKT a NIE JE batchovateľné (shop pustí do dávky len `products/get` a
 * `order/get`; a aj keby pustil, 25 položiek stojí 25 hitov + 1 za dávku, takže
 * dávka kvótu nešetrí). Katalóg má 41 348 produktov, teda jeden plošný prechod
 * = **~207 dní**.
 *
 * Preto tu NEEXISTUJE a nesmie vzniknúť funkcia „obohať všetko". Sú len tri
 * cesty, všetky rozpočtované:
 *
 *   1. **NA DOPYT — JEDEN PRODUKT** (`enrichProductOnDemand`) — používateľ
 *      otvoril panel. Idempotentné a lacné: keď je riadok dosť svieži, `getFull`
 *      sa NEVOLÁ.
 *   2. **NA DOPYT — STRANA TABUĽKY** (`enrichPageOnDemand`, D123, 1. 9. 2026) —
 *      až 100 ID naraz, `getFull` len za nesvieže riadky. Umožnila to kvóta
 *      zdvihnutá 1. 9. 2026 na 150/min a 1000/deň: strana po 100 produktoch je
 *      ~50 s namiesto 6,3 min. Dnešný cieľ obohacovania je jej strop a pri
 *      naplnenom cieli NEOBOHACUJE — povie to číslom (R2 kontraktu V5).
 *   3. **DÁVKA NA POZADÍ** (`runEnrichBatch`) — `DEFAULT_ENRICH_DAILY_TARGET`
 *      produktov/deň v poradí priority (povolený zoznam → kampaňové → zvyšok).
 *      `ENRICH_QUOTA_RESERVE` zostáva na canary, sondy a práve na cesty (1) a
 *      (2); dávka si ju vzať NESMIE.
 *
 * Kto by aj tak chcel vedieť, „kedy to bude celé", má na to
 * `enrichDaysNeeded()` — vráti počet DNÍ, nie sľub.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ A PREČO
 * -------------------------------------------
 *  1. **Neobohatený produkt je „nevieme", nikdy nula (I11).** Modul nikdy
 *     nedopĺňa chýbajúce pole domnienkou; čo shop neposlal, ide do DB ako
 *     `NULL`. Prázdny string sa preto prevádza na `NULL` — `''` by na obrazovke
 *     vyzeral ako „referencia je prázdna", nie ako „referenciu nevieme".
 *  2. **Nekonzistentný stav zľavy sa NEUKLADÁ.** V DB znamená trojica
 *     `reduction_* = NULL` presne jednu vetu: „shop povedal, že žiadna zľava
 *     nebeží". Keď `getFull` pošle trojicu po častiach alebo s nezmyselným
 *     dátumom (`ShopReductionState.state === 'unknown'`), uložiť `NULL` by
 *     z medzery v poznaní urobilo TVRDENIE o produkčnom eshope. Riadok sa preto
 *     neuloží vôbec, `enriched_at` zostane `NULL` a pokus sa len zaznačí.
 *  3. **`ip_banned` a `429` sú PAUZA S DÔVODOM, nie zahodená chyba (D120).**
 *     Dávka sa zastaví, dôvod si zapíše do `catalog_enrich_state.pause_reason`
 *     a **žiadny produkt neoznačí ako obohatený**. Pri `ip_banned` zostáva
 *     `paused_until = NULL` — „stojí, kým do toho nezasiahne človek", pretože
 *     shop pri bane žiadny čas obnovenia nedáva a odblokovanie IP je akcia
 *     používateľa. `Retry-After` po 429 sa rešpektuje (a zastropuje).
 *  4. **Kľúč sa nikdy neloguje ani nevracia (I1).** Ide výhradne ako `SecretRef`
 *     do klienta shopu, ktorý ho dešifruje tesne pred odoslaním. Do stavu, logu
 *     ani do odpovede ide vždy len KÓD chyby, nikdy telo odpovede shopu.
 *  5. **Rozpočet sa rezervuje PRED volaním.** Request, ktorý skončil na 429
 *     alebo timeoute, sa do kvóty shopu počíta rovnako ako úspešný. Počítadlo
 *     modul NEVLASTNÍ — chodí cezň `ReadBudget`, aby existovalo jedno číslo.
 *  6. **Modul NIKDY nehádže.** Obohatenie je doplnok: keď eshop mlčí, obrazovka
 *     sa musí zobraziť aj tak, len s priznanou medzerou.
 *
 * KTORÁ DRÁHA ROZPOČTU (`product_read`, od 31. 8. 2026)
 * ----------------------------------------------------
 * `getFull` je čítanie S KĽÚČOM, takže shop ho účtuje NA KĽÚČ, kým dráha `anon`
 * je rozpočtovaná na IP. Dráhu vyberá VOLAJÚCI a tento modul o nej nevie ani
 * slovo; zapojenie (`/api/catalog/enrich`) používa `productReadBudget` — vlastnú
 * dráhu `product_read`, do jedného počítadla s `reduction-check`, lebo je to
 * ten istý kľúč. Do 31. 8. 2026 sa účtovalo do `anon`: obohacovanie si tak
 * bralo strop dvojdňovej synchronizácie katalógu a zároveň sa škrtilo na
 * čísle, ktoré shop pre kľúč nesleduje.
 *
 * DVE POČÍTADLÁ, KTORÉ SA NESMÚ ZLIAŤ
 * -----------------------------------
 * `ReadBudget` počíta REQUESTY (aj neúspešné — tie kvótu minú a produkt
 * neobohatia). `catalog_enrich_state.enriched_today` počíta OBOHATENÉ PRODUKTY
 * voči dennému cieľu dávky. Sú to dve rôzne čísla; druhé počítadlo tej istej
 * veci by znamenalo, že appka pri bane nevie, ktoré platí.
 *
 * Vlastník: V4 (obohacovanie).
 */
import type {
  CatalogEnrichmentRecord,
  Logger,
  ProductFullDetail,
  SecretRef,
  ShopCtx,
  Ulid,
  UtcDate,
} from '@/contracts';

import { recalledScopes, shopCapability, type ShopCapability } from '@/lib/catalog/product-codes';
import { todayInZone } from '@/lib/domain/dates';
import type { ApiKeyRepository } from '@/lib/repo/api-key.repo';
import type {
  CatalogEnrichPauseReason,
  CatalogEnrichState,
  CatalogEnrichWrite,
  CatalogRepoExt,
  EnrichPriorityRefresh,
} from '@/lib/repo/catalog.repo';
import { DEFAULT_ENRICH_DAILY_TARGET } from '@/lib/repo/catalog.repo';
import type { ShopClientV5 } from '@/lib/shop/client';
import { newOperationId } from '@/lib/shop/correlation';
import { isIpBanned, isShopRequestError } from '@/lib/shop/errors';
import { KEYED_FALLBACK_PER_MINUTE, KEYED_FALLBACK_PER_UTC_DAY } from '@/lib/shop/rate-limits';
import {
  READ_BUDGET_TIME_ZONE,
  type ReadBudget,
  type ReadBudgetStatus,
} from '@/lib/shop/read-budget';

/* ═══════════════════════════ 1. Konštanty ═════════════════════════════════ */

/**
 * Koľko z dennej kvóty kľúča dávka NESMIE minúť.
 *
 * Rozdiel medzi použiteľnou kvótou a cieľom dávky
 * (`DEFAULT_ENRICH_DAILY_TARGET`) nie je nevyužitá rezerva, ale rozpočet troch
 * vecí, ktoré musia ísť KEDYKOĽVEK: canary (stav dosiahnuteľnosti shopu), sonda
 * kľúča a obohatenie NA DOPYT, keď človek otvorí produkt. Keby si dávka vzala
 * všetko, obrazovka by po noci hlásila „nevieme" a nedalo by sa to obísť ani
 * kliknutím.
 *
 * Stráži sa to DVAKRÁT a zámerne: cieľom dávky (75 % kvóty) a týmto podlažím
 * nad zdieľaným počítadlom. Prvé chráni kvótu kľúča, druhé zdieľaný denný
 * rozpočet, z ktorého číta aj synchronizácia katalógu — a ten môže byť minutý
 * skôr.
 *
 * ODVODENÉ (1. 9. 2026): pri kvóte 1000/deň → 800 použiteľných a cieli 600 je
 * rezerva 200. Nepíš sem číslo ručne.
 */
export const ENRICH_QUOTA_RESERVE = KEYED_FALLBACK_PER_UTC_DAY - DEFAULT_ENRICH_DAILY_TARGET;

/**
 * Ako dlho je obohatenie „dosť svieže" na to, aby sa `getFull` NEVOLAL.
 *
 * ČO SA MERIA: `getFull` nesie sklad (`qty`) a skutočný stav zľavy — obe sa
 * počas dňa menia, takže veľmi dlhá svieža doba by z obrazovky urobila včerajšie
 * čísla vydávané za dnešné. Na druhej strane KAŽDÉ otvorenie panela bez tejto
 * brány je jedno volanie z ~200 na deň: preklikanie päťdesiatich riadkov by
 * minulo štvrtinu dennej kvóty a dávka by v ten deň nestihla nič.
 *
 * ŠESŤ HODÍN je kompromis, ktorý sa dá obhájiť číslami: produkt otvorený
 * viackrát počas jednej pracovnej session stojí PRESNE JEDNO čítanie, a ten istý
 * produkt sa za deň nedotiahne viac ako 4×. Kto potrebuje stav zľavy naostro
 * TERAZ, má na to `GET /api/catalog/reduction-check` — tá cesta je od toho a
 * nič neukladá.
 *
 * Nie je to nemenná pravda: dá sa prepísať cez `deps.freshMs`, ale nie pod
 * `MIN_ENRICH_FRESH_MS` — inak by sa z „na dopyt" stalo hameranie kvóty.
 */
export const ENRICH_FRESH_MS = 6 * 60 * 60 * 1000;

/** Podlaha sviežosti, nie predvoľba. Nedá sa podliezť ani konfiguráciou. */
export const MIN_ENRICH_FRESH_MS = 60_000;

/**
 * Minimálna pauza medzi dvoma `getFull` v dávke: 60 000 / 16 = 3 750 ms.
 *
 * Menovateľ je minútový strop kľúča už po odrátaní rezervy
 * (`KEYED_FALLBACK_PER_MINUTE`), nie anonymný — dávka ide s kľúčom. Je to
 * PODLAHA rovnako ako `MIN_ANON_READ_PAUSE_MS` na katalógovej strane: bez nej
 * by dávka minútový strop vyčerpala naraz a shop by odmietol aj zápis, ktorý
 * práve beží. Testy tým nespomalia — podsúvajú si vlastné `sleepFn`.
 */
export const MIN_ENRICH_READ_PAUSE_MS = Math.ceil(60_000 / KEYED_FALLBACK_PER_MINUTE);

/**
 * Strop produktov na JEDEN beh dávky (nie na deň).
 *
 * Denný cieľ drží `catalog_enrich_state.daily_target`; toto je poistka proti
 * behu, ktorý by pri zle nastavenom cieli držal zámok hodiny. 150 × 3,75 s je
 * ~9,4 minúty, čo je pre nočnú dávku v poriadku.
 */
export const ENRICH_MAX_PER_RUN = 150;

/** Ako dlho dávka stojí po chybe, ktorá nie je 429 ani `ip_banned`. */
export const ENRICH_ERROR_PAUSE_MS = 15 * 60_000;

/**
 * Strop pauzy z `Retry-After`. Hlavička je cudzí vstup; beh, ktorý by podľa nej
 * stál pol dňa, by sa v UI tváril ako zaseknutý (rovnaká obrana ako
 * `CATALOG_MAX_PAUSE_MS` v `shop/catalog-sync.ts`).
 */
export const ENRICH_MAX_PAUSE_MS = 60 * 60 * 1000;

/** Záložná pauza po 429 bez použiteľného `Retry-After`. */
export const ENRICH_RATE_LIMIT_PAUSE_MS = 5 * 60_000;

/**
 * Koľko ĎALŠÍCH dní potrvá obohatiť `products` produktov pri dennom cieli.
 *
 * Existuje presne preto, aby sa „obohať všetko" nedalo povedať bez ceny:
 * 41 348 produktov pri cieli 150/deň je 276 dní, pri celej kvóte 200/deň je
 * 207 dní. Kto to číslo uvidí, plošný prechod nezadá.
 */
export function enrichDaysNeeded(
  products: number,
  perDay: number = DEFAULT_ENRICH_DAILY_TARGET,
): number {
  const left = Math.max(0, Math.trunc(products));
  if (left === 0) return 0;
  const speed = Math.max(1, Math.min(KEYED_FALLBACK_PER_UTC_DAY, Math.trunc(perDay)));
  return Math.ceil(left / speed);
}

/* ═══════════════ 2. `ProductFullDetail` → riadok obohatenia ═══════════════ */

/**
 * Text zo shopu do DB. `undefined` (pole neprišlo), `null` (prišlo prázdne) aj
 * `''` / samé medzery sú TO ISTÉ: **nevieme** (I11).
 *
 * Prázdny string sa zámerne NEUKLADÁ. V UI by `''` vyzeral ako „referencia je
 * prázdna" a filter „ref · názov" by na ňom kreslil oddeľovač bez hodnoty; ako
 * `NULL` sa nakreslí pomlčka, teda priznaná medzera.
 */
function textOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Číslo zo shopu do DB. Nekonečno ani `NaN` nie je číslo — je to „nevieme". */
function numOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Celé číslo. `0` je PLATNÁ NULA (vypredané), nikdy sa nezamení za „nevieme". */
function intOrNull(value: number | null | undefined): number | null {
  const num = numOrNull(value);
  return num === null ? null : Math.trunc(num);
}

/**
 * Odpoveď `getFull` → riadok obohatenia.
 *
 * ČO SA TU NEUKLÁDA A PREČO: `sell_price` (podľa dokumentácie shopu tá istá
 * hodnota ako `price`, ktorú `catalog_cache` už má — dva stĺpce s tým istým
 * číslom sú dva zdroje pravdy) a `date_add` (zostáva v `raw`). Rozhodnutie je
 * schémy 0014, nie tohto modulu; klient obe polia parsuje, takže keď ich raz
 * niekto bude potrebovať, netreba sa pýtať shopu znova.
 *
 * `margin` a `margin_percent` sa ukladajú TAK, AKO PRIŠLI. Appka si ich
 * NEPOČÍTA: keby shop zmenil definíciu (DPH, nákupná cena s dopravou), appka by
 * ticho klamala.
 *
 * @throws nikdy — funkcia je čistá a nevaliduje dosiahnuteľnosť shopu.
 */
export function toEnrichWrite(full: ProductFullDetail, enrichedAt?: UtcDate): CatalogEnrichWrite {
  const reduction = full.reduction;
  return {
    reference: textOrNull(full.reference),
    ean13: textOrNull(full.ean13),
    purchasePrice: numOrNull(full.purchase_price),
    margin: numOrNull(full.margin),
    marginPercent: numOrNull(full.margin_percent),
    sellPriceWithVat: numOrNull(full.sell_price_with_vat),
    lastTimeInOrder: textOrNull(full.last_time_in_order),
    qty: intOrNull(full.qty),
    qtyInOrders: intOrNull(full.qty_in_orders),
    supplier: textOrNull(full.supplier),
    // Trojica sa zapisuje NARAZ. `active` je jediný stav, v ktorom má hodnoty;
    // `none` je „shop povedal, že nič nebeží", teda tri `NULL`. Stav `unknown`
    // sem NIKDY nedorazí — volajúci ho odmietne skôr (`isReductionStorable`).
    reductionPercent: reduction.state === 'active' ? reduction.percent : null,
    reductionFrom: reduction.state === 'active' ? reduction.from : null,
    reductionTo: reduction.state === 'active' ? reduction.to : null,
    active: typeof full.active === 'boolean' ? full.active : null,
    categories: Array.isArray(full.categories) ? [...full.categories] : null,
    ...(enrichedAt !== undefined ? { enrichedAt } : {}),
  };
}

/**
 * Smie sa stav zľavy z tejto odpovede uložiť?
 *
 * `false` znamená, že shop poslal trojicu `reduction_*` nekonzistentne alebo
 * s nezmyselnou hodnotou. Uložiť ju nemôžeme: v DB znamenajú tri `NULL` vetu
 * „žiadna zľava nebeží", takže by sa z medzery stalo tvrdenie o produkčnom
 * eshope (I11, bod 2 doc-bloku modulu). Riadok preto zostane neobohatený a
 * pokus sa iba zaznačí — a keďže `ProductFullDetail` surovú trojicu už nenesie,
 * inak sa to dnes uložiť ani nedá.
 */
export function isReductionStorable(full: ProductFullDetail): boolean {
  return full.reduction.state !== 'unknown';
}

/* ═══════════════════════════ 3. Závislosti ════════════════════════════════ */

/** Časť repozitára katalógu, ktorú obohacovanie potrebuje. */
export type EnrichCatalogRepo = Pick<
  CatalogRepoExt,
  | 'saveEnrichment'
  | 'enrichmentFor'
  | 'markEnrichAttempt'
  | 'nextToEnrich'
  | 'refreshEnrichPriority'
  | 'loadEnrichState'
  | 'saveEnrichState'
>;

export interface CatalogEnrichDeps {
  /**
   * VÝHRADNE `getProductFull`. Zápis zľavy sa sem nedá podstrčiť — obohacovanie
   * je čítanie a v shope nič nemení (I7, I13 sa ho netýkajú).
   */
  readonly shop: Pick<ShopClientV5, 'getProductFull'>;
  /**
   * Kľúč a pamäť jeho scopes. `recallScopes()` ZÁMERNE namiesto `whoami`:
   * overenie kľúča je samostatné volanie so samostatnou cenou a otvorenie
   * produktu nie je dôvod ho spúšťať.
   */
  readonly apiKey: Pick<ApiKeyRepository, 'loadForUse' | 'recallScopes'>;
  readonly catalog: EnrichCatalogRepo;
  /** Zdieľané počítadlo čítaní. Dráhu vyberá volajúci (viď doc-blok modulu). */
  readonly reads: Pick<ReadBudget, 'reserve' | 'status'>;
  readonly logger?: Logger;
  readonly now?: () => UtcDate;
  /** Korelačné ID (D58). Default: nové. */
  readonly operationId?: Ulid;
  /** Ako dlho je obohatenie svieže. Podlaha `MIN_ENRICH_FRESH_MS`. */
  readonly freshMs?: number;
}

export interface EnrichBatchDeps extends CatalogEnrichDeps {
  /** Strop produktov na tento beh. Strop stropu je `ENRICH_MAX_PER_RUN`. */
  readonly maxProducts?: number;
  /** Pauza medzi volaniami. Podlaha `MIN_ENRICH_READ_PAUSE_MS`. */
  readonly pausePerReadMs?: number;
  readonly sleepFn?: (ms: number) => Promise<void>;
  /**
   * Prepočítať priority pred výberom z fronty (default `true`).
   *
   * Bez toho je priorita taká, akú ju niekto naposledy prepísal — a dnes ju
   * nezapína žiadna iná cesta (allowlist a kampane sú mimo tejto vlny), takže
   * by fronta išla podľa `product_id` a D118 by bolo len komentár. Sú to tri
   * cielené `UPDATE`-y RAZ na beh (nie na produkt), teda cena, ktorá sa proti
   * ~9 minútam čítania nepočíta.
   */
  readonly refreshPriority?: boolean;
}

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/* ═══════════════════════════ 4. Chyby a pauzy ═════════════════════════════ */

/**
 * Chyba → KÓD (I1). Nikdy `message`: hlášky z `fetch` a z `mariadb` bežne nesú
 * hostname alebo cestu k súboru, a odtiaľto ide kód do
 * `catalog_enrich_state.last_error`, do logu a do odpovede API.
 */
function errorCode(error: unknown): string {
  if (isShopRequestError(error)) return error.shopError.code ?? error.shopError.kind;
  if (error instanceof Error && error.name.length > 0) return `local_${error.name}`;
  return 'local_unknown';
}

/** `true` len pre 403 s kódom `ip_banned` — odmietnutá ADRESA, nie kľúč. */
function isBannedAddress(error: unknown): boolean {
  return isShopRequestError(error) && isIpBanned(error.shopError);
}

function isRateLimited(error: unknown): boolean {
  return isShopRequestError(error) && error.shopError.kind === 'rate_limited';
}

function isNotFound(error: unknown): boolean {
  return isShopRequestError(error) && error.shopError.kind === 'not_found';
}

/**
 * Ako dlho stáť po 429. `Retry-After` má prednosť (klient ho už zastropoval
 * podľa D42), ale zastropuje sa aj tu — je to cudzí vstup.
 */
function rateLimitPauseMs(error: unknown): number {
  const seconds = isShopRequestError(error) ? error.shopError.retryAfterSeconds : undefined;
  const fromHeader =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? Math.ceil(seconds * 1000)
      : ENRICH_RATE_LIMIT_PAUSE_MS;
  return Math.min(ENRICH_MAX_PAUSE_MS, Math.max(1_000, fromHeader));
}

/**
 * Stojí cesta k shopu na dôvode, ktorý povedal SHOP?
 *
 * Rozlišujú sa dva druhy pauzy a nezlievajú sa:
 *   - `ip_banned` / `rate_limited` — shop nás odmietol. Platí to pre KAŽDÚ
 *     cestu vrátane obohatenia na dopyt: poslať request, o ktorom vieme, že ho
 *     shop odmietne, je zbytočne minutá kvóta.
 *   - `daily_budget` / `no_key` / `error` — vlastné dôvody dávky. Cesta na dopyt
 *     si ich vyhodnotí sama (má vlastnú rezervu kvóty), takže ju nezastavujú.
 */
function shopSaidStop(state: CatalogEnrichState, at: UtcDate): boolean {
  if (state.pauseReason !== 'ip_banned' && state.pauseReason !== 'rate_limited') return false;
  if (state.pausedUntil === null) return true;
  return state.pausedUntil.getTime() > at.getTime();
}

/* ═════════════════════ 5. Spoločná brána (zadarmo → drahé) ════════════════ */

/**
 * Prečo sa `getFull` nezavolá. Poradie brán je zámerne od najlacnejšej
 * k najdrahšej — každá ďalšia stojí viac než tá pred ňou.
 */
export type EnrichGateBlock =
  /** Kľúč oprávnenie `product:read` preukázateľne NEMÁ (meraný fakt). */
  | 'locked'
  /** Nevieme, či ho má — kľúč sa zatiaľ neoveril. Nie je to „nemá" (I11). */
  | 'unknown_scope'
  /** Kľúč sa nedá načítať (chýba, expiroval, bol wipnutý). */
  | 'no_key'
  /** Dnešný rozpočet čítaní je minutý (meraný fakt). */
  | 'budget_day'
  /** Minútový strop je na hrane; o chvíľu to pôjde. */
  | 'budget_minute'
  /** Počítadlo sa nedá prečítať — NIE JE to „rozpočet je minutý" (I11). */
  | 'budget_unknown';

interface OpenGate {
  readonly blocked: null;
  readonly key: SecretRef;
  readonly budget: ReadBudgetStatus;
}

interface ClosedGate {
  readonly blocked: EnrichGateBlock;
  readonly budget: ReadBudgetStatus | null;
  readonly error: string | null;
}

type Gate = OpenGate | ClosedGate;

/**
 * Oprávnenie → kľúč → rozpočet. Nič z toho neposiela request na shop.
 *
 * `reserveFloor` je koľko z denného rozpočtu MUSÍ zostať nedotknuté; dávka
 * posiela `ENRICH_QUOTA_RESERVE`, cesta na dopyt `0` (ona je ten, pre koho sa
 * rezerva drží).
 */
async function openGate(
  deps: CatalogEnrichDeps,
  capability: ShopCapability,
  reserveFloor: number,
): Promise<Gate> {
  if (capability.state === 'unknown') return { blocked: 'unknown_scope', budget: null, error: null };
  if (capability.state === 'locked') return { blocked: 'locked', budget: null, error: null };

  let key: SecretRef | null;
  try {
    key = await deps.apiKey.loadForUse();
  } catch (cause) {
    // Expirovaný alebo wipnutý kľúč (`ApiKeyError`) nie je chyba obohatenia —
    // je to dôvod povedať „nedá sa", nie spadnúť.
    return { blocked: 'no_key', budget: null, error: errorCode(cause) };
  }
  if (key === null) return { blocked: 'no_key', budget: null, error: null };

  let budget: ReadBudgetStatus;
  try {
    budget = await deps.reads.status();
  } catch (cause) {
    return { blocked: 'budget_unknown', budget: null, error: errorCode(cause) };
  }

  // Neznáme počítadlo NIE JE minutý rozpočet — sú to dve rôzne vety (I11).
  if (!budget.known) return { blocked: 'budget_unknown', budget, error: null };
  if (budget.exhausted) return { blocked: 'budget_day', budget, error: null };
  if (budget.remaining <= Math.max(0, Math.trunc(reserveFloor))) {
    return { blocked: 'budget_day', budget, error: null };
  }
  if (budget.minuteLimit - budget.usedThisMinute < 1) {
    return { blocked: 'budget_minute', budget, error: null };
  }

  return { blocked: null, key, budget };
}

/* ═══════════════════ 6. Obohatenie NA DOPYT (D118 bod 1) ══════════════════ */

/**
 * Ako dopadlo obohatenie jedného produktu na dopyt.
 *
 * `fresh` je najdôležitejší člen: znamená, že `getFull` sa NEVOLAL a kvóta sa
 * neminula. Volajúci ho NESMIE hlásiť ako chybu — riadok v DB je platný.
 */
export type EnrichOneOutcome =
  | 'enriched'
  /** Riadok bol dosť svieži — API sa nevolalo (idempotencia, D118). */
  | 'fresh'
  | 'invalid_id'
  /** Zrkadlo katalógu produkt nemá, takže `UPDATE` nič netrafil. */
  | 'not_in_mirror'
  /** Shop nás odmietol už predtým a pauza ešte platí (`ip_banned`, `429`). */
  | 'paused'
  | EnrichGateBlock
  /** Shop odmieta našu ADRESU (D120). Dávka po tomto stojí. */
  | 'ip_banned'
  /** 429 — shop povedal „dosť"; `Retry-After` je v `resumeAt`. */
  | 'rate_limited'
  /** Eshop taký produkt nepozná. Nie je to porucha ani „zľava nebeží". */
  | 'not_found'
  /** Trojica `reduction_*` prišla nekonzistentne; riadok sa NEULOŽIL (bod 2). */
  | 'reduction_unknown'
  | 'failed';

export interface EnrichOneResult {
  readonly outcome: EnrichOneOutcome;
  readonly productId: number;
  /** Stav oprávnenia `product:read`. `note` patrí VÝHRADNE do `LockedFeatures`. */
  readonly capability: ShopCapability;
  /** Koľko čítaní zo shopu toto volanie minulo. `0` pri `fresh` aj pri bráne. */
  readonly readsUsed: number;
  /** Stav rozpočtu. `null` = počítadlo sa nedalo prečítať (I11). */
  readonly reads: ReadBudgetStatus | null;
  /** Kedy sa produkt naposledy ÚSPEŠNE obohatil (aj pri `fresh`). */
  readonly enrichedAt: UtcDate | null;
  /** Kedy sa smie skúsiť znova. `null` = hneď / nevieme. */
  readonly resumeAt: UtcDate | null;
  readonly at: UtcDate;
  /** KÓD chyby (I1), nikdy telo odpovede shopu. */
  readonly error: string | null;
}

/**
 * Dotiahne `getFull` pre JEDEN produkt a uloží ho — ak to treba a ak sa smie.
 *
 * Poradie krokov (zadarmo → drahé):
 *   1. platnosť ID (zadarmo),
 *   2. **sviežosť** — riadok mladší než `freshMs` znamená, že sa nič nevolá.
 *      Toto je jediná vec, ktorá drží cenu preklikávania na nule,
 *   3. pauza, ktorú povedal SHOP (`ip_banned`, `429`) — vlastná DB, zadarmo,
 *   4. oprávnenie, kľúč, rozpočet (`openGate`),
 *   5. `getFull` a zápis.
 *
 * @returns report; NIKDY nehádže.
 */
export async function enrichProductOnDemand(
  productId: number,
  deps: CatalogEnrichDeps,
): Promise<EnrichOneResult> {
  const now = deps.now ?? ((): UtcDate => new Date());
  const log = deps.logger;
  const capability = shopCapability(recalledScopes(deps.apiKey), 'product:read');
  const freshMs = Math.max(MIN_ENRICH_FRESH_MS, Math.trunc(deps.freshMs ?? ENRICH_FRESH_MS));

  const report = (
    outcome: EnrichOneOutcome,
    patch: Partial<EnrichOneResult> = {},
  ): EnrichOneResult => ({
    outcome,
    productId,
    capability,
    readsUsed: 0,
    reads: null,
    enrichedAt: null,
    resumeAt: null,
    at: now(),
    error: null,
    ...patch,
  });

  if (!Number.isInteger(productId) || productId <= 0) return report('invalid_id');

  /* ── 2. sviežosť: najlacnejšia brána, a jediná, ktorá šetrí kvótu ──────── */

  let enrichedAt: UtcDate | null = null;
  try {
    const record = (await deps.catalog.enrichmentFor([productId])).get(productId) ?? null;
    // Turbopack tu už raz zahodil `if (!record)` ako compile-time falsy.
    if (record !== null) enrichedAt = record.enrichedAt;
  } catch (cause) {
    // Nečitateľné zrkadlo nie je dôvod nečítať shop — je to dôvod nevedieť,
    // či to treba. Fail-open smerom k čítaniu by bola tichá cena, preto sa
    // radšej nevolá nič a povie sa kód chyby.
    return report('failed', { error: errorCode(cause) });
  }

  if (enrichedAt !== null && now().getTime() - enrichedAt.getTime() < freshMs) {
    return report('fresh', { enrichedAt });
  }

  /* ── 3. povedal shop „dosť"? ───────────────────────────────────────────── */

  let state: CatalogEnrichState | null = null;
  try {
    state = await deps.catalog.loadEnrichState();
  } catch (cause) {
    // Stav dávky je diagnostika, nie brána bezpečnosti: keď sa nedá prečítať,
    // pokračuje sa (rozpočet a oprávnenie sú brány, ktoré naozaj chránia).
    log?.warn('catalog_enrich_state_unreadable', { error: errorCode(cause) });
  }
  if (state !== null && shopSaidStop(state, now())) {
    return report('paused', {
      enrichedAt,
      resumeAt: state.pausedUntil,
      error: state.pauseReason,
    });
  }

  /* ── 4. oprávnenie, kľúč, rozpočet ─ rezerva je TU nulová (viď doc-blok) ── */

  const gate = await openGate(deps, capability, 0);
  if (gate.blocked !== null) {
    return report(gate.blocked, {
      enrichedAt,
      reads: gate.budget,
      error: gate.error,
      resumeAt: gate.blocked === 'budget_day' ? (gate.budget?.resetAt ?? null) : null,
    });
  }

  /* ── 5. rezervácia PRED volaním, potom `getFull` ───────────────────────── */

  const slot = await deps.reads.reserve(1).catch(() => null);
  if (slot === null || slot.granted < 1) {
    const status = slot?.status ?? null;
    const blocked: EnrichOneOutcome =
      status === null || !status.known ? 'budget_unknown' : 'budget_day';
    return report(blocked, {
      enrichedAt,
      reads: status,
      resumeAt: blocked === 'budget_day' ? (status?.resetAt ?? null) : null,
    });
  }

  const ctx: ShopCtx = { operationId: deps.operationId ?? newOperationId() };
  try {
    const full = await deps.shop.getProductFull(productId, gate.key, ctx);

    if (!isReductionStorable(full)) {
      // Bod 2 doc-bloku: radšej neobohatené než nepravdivé. Pokus sa zaznačí,
      // aby ten istý produkt nezjedol kvótu opakovaním.
      await markAttemptQuietly(deps, productId, log);
      log?.warn('catalog_enrich_reduction_unknown', { productId });
      return report('reduction_unknown', {
        enrichedAt,
        readsUsed: slot.granted,
        reads: slot.status,
        error: 'shop_reduction_unknown',
      });
    }

    const at = now();
    const saved = await deps.catalog.saveEnrichment(productId, toEnrichWrite(full, at));
    if (!saved) {
      // `false` = riadok v zrkadle nie je. Je to platná odpoveď, nie chyba:
      // zrkadlo je úplné k času posledného prechodu a eshop medzitým pridáva.
      return report('not_in_mirror', {
        enrichedAt,
        readsUsed: slot.granted,
        reads: slot.status,
      });
    }

    // Shop nám odpovedal — to je MERANÝ fakt, že adresa už zabanovaná nie je.
    // Je to jediná ruka, ktorá `ip_banned` pauzu v tejto vlne uvoľní (D120
    // hovorí „stojí, kým nezasiahne človek", a otvorenie produktu človekom
    // presne to je).
    await clearBanPauseQuietly(deps, state, log);

    log?.info('catalog_enrich_on_demand_done', { productId, readsUsed: slot.granted });
    return report('enriched', {
      enrichedAt: at,
      readsUsed: slot.granted,
      reads: slot.status,
    });
  } catch (cause) {
    const code = errorCode(cause);

    if (isBannedAddress(cause)) {
      // D120 — dôvod pauzy, nie zahodená chyba. Produkt sa NEOZNAČÍ ani ako
      // obohatený, ani ako pokus: nie je to jeho vina, a posunutie na konec
      // priority by fronte prehodilo poradie pri chybe, ktorá platí pre všetko.
      await pauseQuietly(deps, state, { reason: 'ip_banned', until: null, error: code }, log);
      log?.error('catalog_enrich_address_banned', { productId, error: code });
      return report('ip_banned', {
        enrichedAt,
        readsUsed: slot.granted,
        reads: slot.status,
        error: code,
      });
    }

    if (isRateLimited(cause)) {
      const until = new Date(now().getTime() + rateLimitPauseMs(cause));
      await pauseQuietly(deps, state, { reason: 'rate_limited', until, error: code }, log);
      return report('rate_limited', {
        enrichedAt,
        readsUsed: slot.granted,
        reads: slot.status,
        resumeAt: until,
        error: code,
      });
    }

    await markAttemptQuietly(deps, productId, log);
    if (isNotFound(cause)) {
      return report('not_found', {
        enrichedAt,
        readsUsed: slot.granted,
        reads: slot.status,
        error: code,
      });
    }
    log?.warn('catalog_enrich_on_demand_failed', { productId, error: code });
    return report('failed', {
      enrichedAt,
      readsUsed: slot.granted,
      reads: slot.status,
      error: code,
    });
  }
}

/* ═══════ 6b. Obohatenie STRANY na dopyt (D123, 1. 9. 2026) ════════════════ */

/**
 * Koľko produktov smie pokryť JEDNO volanie „obohať stranu".
 *
 * Je to STRANA TABUĽKY, nie kus katalógu: obrazovka Produktov ukazuje 100
 * riadkov a viac ich naraz nikto nevidí. Pri pauze 500 ms na produkt
 * (`MIN_ENRICH_READ_PAUSE_MS` po zdvihnutí kvóty na 120/min) je to ~50 s.
 *
 * PREČO TO STÁLE NIE JE „OBOHAŤ VŠETKO": plošný prechod 41 348 produktov je aj
 * pri kvóte 1000/deň ~69 dní (`enrichDaysNeeded()` to povie číslom). Strana je
 * to, na čo sa človek práve pozerá — a to je celý rozdiel medzi D118 a D123.
 */
export const ENRICH_PAGE_MAX_PRODUCTS = 100;

/**
 * Wall-clock strop JEDNÉHO volania.
 *
 * ODVODENÉ: 100 produktov × 500 ms pauza + 15 s na samotné odpovede shopu
 * (~150 ms na request). Keď sa beh do stropu nezmestí, vráti sa to, čo sa
 * STIHLO, a zvyšok ID ide von v `skipped` — obrazovka má dostať odpoveď
 * a dopýtať sa znova, nie visieť na otvorenom spojení.
 */
export const ENRICH_PAGE_MAX_MS = ENRICH_PAGE_MAX_PRODUCTS * MIN_ENRICH_READ_PAUSE_MS + 15_000;

/** Ako dopadlo obohatenie strany. */
export type EnrichPageOutcome =
  /** Prešli všetky nesvieže ID (aj keď niektoré skončili `not_found`). */
  | 'done'
  /** Všetko bolo dosť svieže — `getFull` sa NEVOLAL ani raz. Nie je to chyba. */
  | 'fresh_only'
  /** Po očistení nezostalo ani jedno použiteľné ID. */
  | 'no_ids'
  /** Iná strana sa obohacuje práve teraz; dve dávky naraz by rozbili tempo. */
  | 'busy'
  /** Dnešný cieľ obohacovania je naplnený (R2 kontraktu) — čísla sú v `day`. */
  | 'target_reached'
  /** Shop nás odmietol už predtým a pauza ešte platí (`ip_banned`, `429`). */
  | 'paused'
  /** Došel čas jedného volania; zvyšok ID je v `skipped`. */
  | 'deadline'
  | EnrichGateBlock
  | 'ip_banned'
  | 'rate_limited'
  /** Čítanie alebo zápis spadli; čo sa stihlo uložiť, zostáva uložené. */
  | 'failed';

/**
 * Čísla dňa — to, čo obrazovka MUSÍ povedať namiesto mlčania (R2 kontraktu).
 *
 * Sú tu DVE nezávislé počítadlá a zámerne sa nesčítavajú:
 *
 *  - `enrichedTodayByBatch` / `dailyTarget` / `targetLeft` — cieľ DÁVKY
 *    (`catalog_enrich_state`). Táto cesta ho RESPEKTUJE, ale NEMÍŇA: progres
 *    dávky prepisuje výhradne `runEnrichBatch()` (dva zapisovatelia jedného
 *    riadku by si číslo prepisovali).
 *  - `readsUsedToday` / `readsLeftToday` / `readsLimitToday` — dráha
 *    `product_read` zdieľaného rozpočtu. Toto počítadlo počíta KAŽDÉ čítanie:
 *    dávku, canary, sondu aj túto stranu. Je to jediné číslo, ktoré o dnešnej
 *    spotrebe hovorí celú pravdu, preto je v odpovedi vždy.
 *
 * `null` znamená VÝHRADNE „nevieme" (I11), nikdy nulu.
 */
export interface EnrichPageDayNumbers {
  /** Koľko obohatila dnešná DÁVKA. `null` = dnes nebežala, nie nula. */
  readonly enrichedTodayByBatch: number | null;
  readonly dailyTarget: number | null;
  /** Koľko z dnešného cieľa zostáva. `null` = stav dávky sa nedal prečítať. */
  readonly targetLeft: number | null;
  readonly readsUsedToday: number | null;
  readonly readsLeftToday: number | null;
  readonly readsLimitToday: number | null;
}

export interface EnrichPageResult {
  readonly outcome: EnrichPageOutcome;
  /** Stav oprávnenia `product:read`. */
  readonly capability: ShopCapability;
  /** Koľko ID prišlo (po očistení o neplatné a duplikáty). */
  readonly requested: number;
  /** Koľko ID sa zahodilo ako neplatné alebo duplicitné. */
  readonly dropped: number;
  /** Koľko riadkov bolo dosť svieže — `getFull` sa pre ne NEVOLAL. */
  readonly fresh: number;
  /** Koľko riadkov obohatenie potrebovalo. */
  readonly stale: number;
  readonly attempted: number;
  readonly enriched: number;
  readonly notInMirror: number;
  readonly reductionUnknown: number;
  readonly notFound: number;
  /** Nesvieže ID, na ktoré sa NEDOSTALO (čas, kvóta, pauza). Nie je to chyba. */
  readonly skipped: readonly number[];
  readonly readsUsed: number;
  readonly reads: ReadBudgetStatus | null;
  readonly day: EnrichPageDayNumbers;
  readonly resumeAt: UtcDate | null;
  readonly startedAt: UtcDate;
  readonly finishedAt: UtcDate;
  readonly durationMs: number;
  /** KÓD chyby (I1), nikdy telo odpovede shopu. */
  readonly error: string | null;
}

export interface EnrichPageDeps extends CatalogEnrichDeps {
  /** Strop produktov na toto volanie. Strop stropu je `ENRICH_PAGE_MAX_PRODUCTS`. */
  readonly maxProducts?: number;
  /** Pauza medzi volaniami. Podlaha `MIN_ENRICH_READ_PAUSE_MS`. */
  readonly pausePerReadMs?: number;
  /** Wall-clock strop volania. Strop stropu je `ENRICH_PAGE_MAX_MS`. */
  readonly maxMs?: number;
  readonly sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Beží už jedna strana? Modulová premenná, presne ako `running` v
 * `lib/scheduler/enrich-runner.ts`: dve strany naraz by rozbili tempo (pauza
 * medzi čítaniami platí na beh, nie globálne) a minútový strop kľúča by padol
 * na 429 uprostred oboch. Je to obrana v rámci procesu — druhú vrstvu drží
 * rozpočet čítaní, ktorý je v DB.
 */
let pageInFlight = false;

/**
 * Obohatí STRANU tabuľky na dopyt (D123): až `ENRICH_PAGE_MAX_PRODUCTS` ID,
 * z toho `getFull` odíde LEN pre tie, ktoré nie sú svieže.
 *
 * Poradie brán je to isté ako pri jednom produkte (zadarmo → drahé), len
 * vyhodnotené RAZ na celú stranu:
 *   1. jedna strana naraz (`pageInFlight`),
 *   2. očistenie ID (zadarmo),
 *   3. **sviežosť JEDNÝM dotazom** (`enrichmentFor`) — žiadne N+1 nad vlastnou
 *      DB a hlavne žiadny request za už obohatený riadok. Toto je jediná brána,
 *      ktorá drží kvótu pri preklikávaní tabuľky,
 *   4. pauza, ktorú povedal SHOP (`ip_banned`, `429`),
 *   5. dnešný cieľ obohacovania — pri naplnenom sa NEOBOHACUJE a čísla idú von,
 *   6. oprávnenie, kľúč, rozpočet (`openGate` s rezervou 0 — táto cesta je ten,
 *      pre koho sa `ENRICH_QUOTA_RESERVE` drží),
 *   7. sekvenčné čítanie s pauzou a s wall-clock stropom.
 *
 * @returns report; NIKDY nehádže.
 */
export async function enrichPageOnDemand(
  productIds: readonly number[],
  deps: EnrichPageDeps,
): Promise<EnrichPageResult> {
  const now = deps.now ?? ((): UtcDate => new Date());
  const log = deps.logger;
  const sleepFn = deps.sleepFn ?? defaultSleep;
  const capability = shopCapability(recalledScopes(deps.apiKey), 'product:read');
  const freshMs = Math.max(MIN_ENRICH_FRESH_MS, Math.trunc(deps.freshMs ?? ENRICH_FRESH_MS));
  const pauseMs = Math.max(
    MIN_ENRICH_READ_PAUSE_MS,
    Math.trunc(deps.pausePerReadMs ?? MIN_ENRICH_READ_PAUSE_MS),
  );
  const maxMs = Math.min(
    ENRICH_PAGE_MAX_MS,
    Math.max(1, Math.trunc(deps.maxMs ?? ENRICH_PAGE_MAX_MS)),
  );
  const take = Math.min(
    ENRICH_PAGE_MAX_PRODUCTS,
    Math.max(0, Math.trunc(deps.maxProducts ?? ENRICH_PAGE_MAX_PRODUCTS)),
  );
  const startedAt = now();

  let fresh = 0;
  let attempted = 0;
  let enriched = 0;
  let notInMirror = 0;
  let reductionUnknown = 0;
  let notFound = 0;
  let readsUsed = 0;
  const stale: number[] = [];
  let done = 0;

  const noNumbers: EnrichPageDayNumbers = {
    enrichedTodayByBatch: null,
    dailyTarget: null,
    targetLeft: null,
    readsUsedToday: null,
    readsLeftToday: null,
    readsLimitToday: null,
  };

  /* ── 1. očistenie ID: platné, bez duplikátov, po strop (zadarmo) ────────── */

  const unique: number[] = [];
  const seen = new Set<number>();
  for (const raw of productIds) {
    if (!Number.isInteger(raw) || raw <= 0) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    if (unique.length < take) unique.push(raw);
  }
  const dropped = productIds.length - unique.length;
  const requested = unique.length;

  const report = (
    outcome: EnrichPageOutcome,
    patch: Partial<EnrichPageResult> = {},
  ): EnrichPageResult => {
    const finishedAt = now();
    return {
      outcome,
      capability,
      requested,
      dropped,
      fresh,
      stale: stale.length,
      attempted,
      enriched,
      notInMirror,
      reductionUnknown,
      notFound,
      skipped: stale.slice(done),
      readsUsed,
      reads: null,
      day: noNumbers,
      resumeAt: null,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      error: null,
      ...patch,
    };
  };

  if (requested === 0) return report('no_ids');

  /* ── 2. jedna strana naraz ─────────────────────────────────────────────── */

  if (pageInFlight) {
    log?.info('catalog_enrich_page_busy', { requested });
    return report('busy');
  }
  pageInFlight = true;
  try {
    /* ── 3. sviežosť JEDNÝM dotazom (žiadne N+1) ─────────────────────────── */

    let records: Map<number, CatalogEnrichmentRecord>;
    try {
      records = await deps.catalog.enrichmentFor(unique);
    } catch (cause) {
      // Rovnaký dôvod ako pri jednom produkte: nečitateľné zrkadlo nie je dôvod
      // volať shop naslepo. Radšej sa nepošle nič a povie sa kód chyby.
      return report('failed', { error: errorCode(cause) });
    }

    const at = now();
    for (const productId of unique) {
      const record = records.get(productId) ?? null;
      // Turbopack tu už raz zahodil `if (!record)` ako compile-time falsy.
      const enrichedAt = record === null ? null : record.enrichedAt;
      if (enrichedAt !== null && at.getTime() - enrichedAt.getTime() < freshMs) fresh += 1;
      else stale.push(productId);
    }

    /* ── 4. stav dávky: pauza od shopu a dnešný cieľ ─────────────────────── */

    let state: CatalogEnrichState | null = null;
    try {
      state = await deps.catalog.loadEnrichState();
    } catch (cause) {
      // Stav je diagnostika, nie brána bezpečnosti (rovnako ako pri jednom
      // produkte): keď sa nedá prečítať, čísla dňa budú `null` a ide sa ďalej.
      log?.warn('catalog_enrich_state_unreadable', { error: errorCode(cause) });
    }

    // Deň v zóne ROZPOČTU (UTC) a cez `Intl` — kvótu resetuje shop o polnoci
    // UTC, nie appka o polnoci v Bratislave (D31).
    const today = todayInZone(startedAt, READ_BUDGET_TIME_ZONE);
    const spentByBatch = state !== null && state.batchDay === today ? state.enrichedToday : 0;
    const enrichedTodayByBatch =
      state !== null && state.batchDay === today ? state.enrichedToday : null;
    const dailyTarget = state === null ? null : state.dailyTarget;
    const targetLeft = state === null ? null : Math.max(0, state.dailyTarget - spentByBatch);

    const numbers = (budget: ReadBudgetStatus | null): EnrichPageDayNumbers => ({
      enrichedTodayByBatch,
      dailyTarget,
      targetLeft,
      // Fail-closed domnienka NIE JE meraný fakt: pri `known: false` je to `null`.
      readsUsedToday: budget !== null && budget.known ? budget.used : null,
      readsLeftToday: budget !== null && budget.known ? budget.remaining : null,
      readsLimitToday: budget === null ? null : budget.limit,
    });

    /* ── 5. všetko svieže? Potom sa nič nevolá a nič sa neplatí ──────────── */

    if (stale.length === 0) {
      const budget = await deps.reads.status().catch(() => null);
      return report('fresh_only', { reads: budget, day: numbers(budget) });
    }

    if (state !== null && shopSaidStop(state, now())) {
      return report('paused', {
        day: numbers(null),
        resumeAt: state.pausedUntil,
        error: state.pauseReason,
      });
    }

    /*
     * Dnešný cieľ (R2 kontraktu). Kto preklikne desiatu stranu, dostane pomlčky
     * — a TU sa hovorí prečo, číslom. Cieľ sa touto cestou NEMÍŇA (progres
     * dávky prepisuje výhradne `runEnrichBatch`), ale respektuje sa: je to jediné
     * číslo, ktoré hovorí, koľko obohatení dnešný deň ešte znesie.
     */
    if (targetLeft === 0) {
      const budget = await deps.reads.status().catch(() => null);
      log?.info('catalog_enrich_page_target_reached', {
        enrichedToday: enrichedTodayByBatch,
        dailyTarget,
      });
      return report('target_reached', {
        reads: budget,
        day: numbers(budget),
        resumeAt: budget?.resetAt ?? null,
      });
    }

    /* ── 6. oprávnenie, kľúč, rozpočet ─ rezerva je TU nulová ────────────── */

    const gate = await openGate(deps, capability, 0);
    if (gate.blocked !== null) {
      return report(gate.blocked, {
        reads: gate.budget,
        day: numbers(gate.budget),
        error: gate.error,
        resumeAt: gate.blocked === 'budget_day' ? (gate.budget?.resetAt ?? null) : null,
      });
    }

    /* ── 7. sekvenčné čítanie s pauzou a s wall-clock stropom ────────────── */

    // Cieľ dňa je strop aj pre túto stranu: viac ako `targetLeft` produktov sa
    // dnes neobohatí ani kliknutím. Zvyšok ide von ako `skipped`, nie ako chyba
    // — a výsledok sa potom menuje `target_reached`, aby obrazovka vedela, že
    // to nie je porucha, ale dnešný strop (R2 kontraktu).
    const plan = stale.slice(0, Math.min(stale.length, targetLeft ?? stale.length));
    const cutByTarget = plan.length < stale.length;
    const deadline = startedAt.getTime() + maxMs;
    const ctx: ShopCtx = { operationId: deps.operationId ?? newOperationId() };
    let lastBudget: ReadBudgetStatus = gate.budget;
    let stopped: EnrichPageOutcome | null = null;
    let pause: PausePatch | null = null;
    let resumeAt: UtcDate | null = null;
    let error: string | null = null;

    for (const productId of plan) {
      if (lastBudget.known && lastBudget.usedThisMinute >= lastBudget.minuteLimit) {
        stopped = 'budget_minute';
        break;
      }

      const waitMs = attempted > 0 ? pauseMs : 0;
      // Wall-clock strop sa kontroluje PRED pauzou, nie po nej: inak by sa
      // o pauzu prekročil a odpoveď by prišla neskôr, než volajúci čaká.
      if (now().getTime() + waitMs >= deadline) {
        stopped = 'deadline';
        break;
      }
      if (waitMs > 0) await sleepFn(waitMs);

      const slot = await deps.reads.reserve(1).catch(() => null);
      if (slot === null || slot.granted < 1) {
        stopped = slot === null || !slot.status.known ? 'budget_unknown' : 'budget_day';
        if (slot !== null) lastBudget = slot.status;
        if (stopped === 'budget_day') resumeAt = lastBudget.resetAt;
        break;
      }
      lastBudget = slot.status;
      readsUsed += slot.granted;
      attempted += 1;

      let full: ProductFullDetail;
      try {
        full = await deps.shop.getProductFull(productId, gate.key, ctx);
      } catch (cause) {
        const code = errorCode(cause);

        if (isBannedAddress(cause)) {
          /*
           * D120 — `ip_banned` platí pre CELÚ cestu k shopu, nie pre tento
           * produkt: nič sa neoznačí ako obohatené ANI ako pokus, dôvod sa
           * zapíše do stavu (dozvie sa ho aj nočná dávka) a strana sa vzdá.
           */
          stopped = 'ip_banned';
          error = code;
          pause = { reason: 'ip_banned', until: null, error: code };
          log?.error('catalog_enrich_address_banned', { productId, error: code });
          break;
        }

        if (isRateLimited(cause)) {
          const until = new Date(now().getTime() + rateLimitPauseMs(cause));
          stopped = 'rate_limited';
          error = code;
          resumeAt = until;
          pause = { reason: 'rate_limited', until, error: code };
          log?.warn('catalog_enrich_rate_limited', { productId, error: code });
          break;
        }

        // Chyba, ktorá patrí TOMUTO produktu: pokus sa zaznačí, aby jeden
        // padajúci `getFull` nezjedol dennú kvótu opakovaním.
        await markAttemptQuietly(deps, productId, log);
        done += 1;

        if (isNotFound(cause)) {
          notFound += 1;
          log?.info('catalog_enrich_not_found', { productId });
          continue;
        }

        stopped = 'failed';
        error = code;
        log?.warn('catalog_enrich_page_read_failed', { productId, error: code });
        break;
      }

      if (!isReductionStorable(full)) {
        // Bod 2 doc-bloku modulu: radšej neobohatené než nepravdivé.
        reductionUnknown += 1;
        await markAttemptQuietly(deps, productId, log);
        done += 1;
        log?.warn('catalog_enrich_reduction_unknown', { productId });
        continue;
      }

      try {
        const saved = await deps.catalog.saveEnrichment(productId, toEnrichWrite(full, now()));
        if (saved) enriched += 1;
        else notInMirror += 1;
        done += 1;
      } catch (cause) {
        stopped = 'failed';
        error = errorCode(cause);
        log?.error('catalog_enrich_save_failed', { productId, error });
        break;
      }
    }

    /*
     * Pauzu, ktorú povedal SHOP, zapíše aj táto cesta: `ip_banned` a `429` sú
     * výrok o ceste k shopu, nie o strane, a nočná dávka sa o nich má dozvedieť
     * aj vtedy, keď ich prvý našiel človek kliknutím. Progres dávky
     * (`enriched_today`, `enriched_total`) sa NEMENÍ — to je číslo dávky.
     */
    if (pause !== null) await pauseQuietly(deps, state, pause, log);
    else if (enriched > 0) await clearBanPauseQuietly(deps, state, log);

    const outcome: EnrichPageOutcome =
      stopped ?? (cutByTarget && done < stale.length ? 'target_reached' : 'done');

    log?.info('catalog_enrich_page_done', {
      outcome,
      requested,
      fresh,
      stale: stale.length,
      attempted,
      enriched,
      notInMirror,
      reductionUnknown,
      notFound,
      readsUsed,
      error: error ?? undefined,
    });

    return report(outcome, {
      reads: lastBudget,
      day: numbers(lastBudget),
      resumeAt,
      error,
    });
  } finally {
    pageInFlight = false;
  }
}

/* ═════════════════ 7. Pomocné zápisy stavu (nikdy nehádžu) ════════════════ */

/** Pokus sa zaznačí, `enriched_at` zostáva `NULL` — obohatené naozaj nie je. */
async function markAttemptQuietly(
  deps: CatalogEnrichDeps,
  productId: number,
  log: Logger | undefined,
): Promise<void> {
  try {
    await deps.catalog.markEnrichAttempt(productId, (deps.now ?? ((): UtcDate => new Date()))());
  } catch (cause) {
    log?.warn('catalog_enrich_attempt_unsaved', { productId, error: errorCode(cause) });
  }
}

interface PausePatch {
  readonly reason: CatalogEnrichPauseReason;
  /** `null` = stojí, kým nezasiahne človek (D120 — presne prípad `ip_banned`). */
  readonly until: UtcDate | null;
  readonly error: string | null;
}

/**
 * Zapíše dôvod pauzy do `catalog_enrich_state`.
 *
 * Robí to aj cesta NA DOPYT, a to zámerne: `ip_banned` a `429` nie sú výrok
 * o jednom produkte, ale o celej ceste k shopu — dávka na pozadí sa o nich má
 * dozvedieť aj vtedy, keď ich prvý našiel človek kliknutím. Progres dávky
 * (`enriched_today`, `enriched_total`) cesta na dopyt NIKDY nemení: to je číslo
 * dávky a dva zapisovatelia jedného riadku by si ho prepisovali.
 */
async function pauseQuietly(
  deps: CatalogEnrichDeps,
  state: CatalogEnrichState | null,
  patch: PausePatch,
  log: Logger | undefined,
): Promise<void> {
  if (state === null) return;
  try {
    await deps.catalog.saveEnrichState({
      ...state,
      pausedUntil: patch.until,
      pauseReason: patch.reason,
      lastError: patch.error,
    });
  } catch (cause) {
    log?.warn('catalog_enrich_pause_unsaved', {
      reason: patch.reason,
      error: errorCode(cause),
    });
  }
}

/** Shop odpovedal, takže `ip_banned` pauza už neplatí. Iné pauzy sa nedotkne. */
async function clearBanPauseQuietly(
  deps: CatalogEnrichDeps,
  state: CatalogEnrichState | null,
  log: Logger | undefined,
): Promise<void> {
  if (state === null || state.pauseReason !== 'ip_banned') return;
  try {
    await deps.catalog.saveEnrichState({
      ...state,
      pausedUntil: null,
      pauseReason: null,
      lastError: null,
    });
    log?.info('catalog_enrich_ban_pause_cleared', {});
  } catch (cause) {
    log?.warn('catalog_enrich_pause_unsaved', { reason: 'ip_banned', error: errorCode(cause) });
  }
}

/* ═════════════════════ 8. Dávka na pozadí (D118 bod 2) ════════════════════ */

export type EnrichBatchOutcome =
  /** Dávka prešla svoj plán do konca. */
  | 'done'
  /** Fronta je prázdna — nie je čo obohatiť (alebo je všetko obohatené). */
  | 'no_ids'
  /** Denný cieľ (`daily_target`) je už naplnený. */
  | 'target_reached'
  /** Dávka stojí na dôvode zapísanom skôr (`pause_reason`). */
  | 'paused'
  | EnrichGateBlock
  /** Zvyšok dennej kvóty patrí canary a dopytu — dávka do rezervy nesmie. */
  | 'budget_reserve'
  | 'ip_banned'
  | 'rate_limited'
  /** Čítanie spadlo; čo sa stihlo uložiť, zostáva uložené. */
  | 'failed';

export interface EnrichBatchResult {
  readonly outcome: EnrichBatchOutcome;
  readonly capability: ShopCapability;
  /** Koľko ID fronta na tento beh vydala. */
  readonly planned: number;
  /** Koľko `getFull` naozaj odišlo (aj tie, ktoré spadli). */
  readonly attempted: number;
  /** Koľko riadkov sa naozaj obohatilo. */
  readonly enriched: number;
  /** Koľko produktov zrkadlo medzitým nemá (`saveEnrichment` → `false`). */
  readonly notInMirror: number;
  /** Koľko odpovedí prišlo s nekonzistentnou trojicou `reduction_*` (bod 2). */
  readonly reductionUnknown: number;
  readonly readsUsed: number;
  readonly reads: ReadBudgetStatus | null;
  /** Ako dopadol prepočet priorít. `null` = nespúšťal sa. */
  readonly priority: EnrichPriorityRefresh | null;
  /** Koľko produktov ešte chýba do dnešného cieľa PO tomto behu. */
  readonly targetLeft: number;
  readonly pauseReason: CatalogEnrichPauseReason | null;
  readonly resumeAt: UtcDate | null;
  readonly startedAt: UtcDate;
  readonly finishedAt: UtcDate;
  readonly durationMs: number;
  /** KÓD chyby, ktorá beh zastavila (I1). `null` = nespadlo nič. */
  readonly error: string | null;
}

/**
 * Obohatí ďalšiu dávku produktov v poradí priority.
 *
 * Beh NIE JE „celý katalóg": je to porcia, ktorá sa zmestí do dnešného cieľa
 * a do zdieľaného rozpočtu MÍNUS rezerva, plus stav, z ktorého sa dá pokračovať
 * po reštarte (`catalog_enrich_state`). Nový UTC deň nuluje `enriched_today` a
 * uvoľňuje pauzu, ktorá bola o rozpočte — nikdy nie pauzu z `ip_banned`.
 *
 * @returns report; NIKDY nehádže.
 */
export async function runEnrichBatch(deps: EnrichBatchDeps): Promise<EnrichBatchResult> {
  const now = deps.now ?? ((): UtcDate => new Date());
  const log = deps.logger;
  const sleepFn = deps.sleepFn ?? defaultSleep;
  const pauseMs = Math.max(
    MIN_ENRICH_READ_PAUSE_MS,
    Math.trunc(deps.pausePerReadMs ?? MIN_ENRICH_READ_PAUSE_MS),
  );
  const capability = shopCapability(recalledScopes(deps.apiKey), 'product:read');
  const startedAt = now();

  let planned = 0;
  let attempted = 0;
  let enriched = 0;
  let notInMirror = 0;
  let reductionUnknown = 0;
  let readsUsed = 0;
  let priority: EnrichPriorityRefresh | null = null;

  const report = (
    outcome: EnrichBatchOutcome,
    state: CatalogEnrichState | null,
    patch: Partial<EnrichBatchResult> = {},
  ): EnrichBatchResult => {
    const finishedAt = now();
    return {
      outcome,
      capability,
      planned,
      attempted,
      enriched,
      notInMirror,
      reductionUnknown,
      readsUsed,
      priority,
      targetLeft:
        state === null ? 0 : Math.max(0, state.dailyTarget - state.enrichedToday),
      pauseReason: state?.pauseReason ?? null,
      resumeAt: state?.pausedUntil ?? null,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      reads: null,
      error: null,
      ...patch,
    };
  };

  /* ── 1. odkiaľ pokračujeme ─────────────────────────────────────────────── */

  let state: CatalogEnrichState;
  try {
    state = await deps.catalog.loadEnrichState();
  } catch (cause) {
    // Bez stavu sa nesmie začať: dávka by nevedela, koľko už dnes minula, a
    // po reštarte by kvótu prekročila. Fail-closed — ďalší tik to skúsi znova.
    const code = errorCode(cause);
    log?.error('catalog_enrich_state_unreadable', { error: code });
    return report('failed', null, { error: code });
  }

  /* ── 2. nový UTC deň = nový rozpočet ──────────────────────────────────── */

  // Deň sa počíta v tej istej zóne ako rozpočet čítaní (`READ_BUDGET_TIME_ZONE`
  // = UTC): strop resetuje SHOP o polnoci UTC, nie appka o polnoci v Bratislave.
  // Nikdy `toISOString().slice(0, 10)` — deň sa počíta cez `Intl` (D31).
  const today = todayInZone(startedAt, READ_BUDGET_TIME_ZONE);
  if (state.batchDay !== today) {
    state = {
      ...state,
      batchDay: today,
      enrichedToday: 0,
      // Pauza „minutý denný rozpočet" novým dňom stráca dôvod. `ip_banned`,
      // `no_key` ani `error` sa tým NEUVOĽNIA — tie o dni nič nehovoria.
      ...(state.pauseReason === 'daily_budget'
        ? { pausedUntil: null, pauseReason: null, lastError: null }
        : {}),
    };
  }

  /* ── 3. stojí dávka? ───────────────────────────────────────────────────── */

  if (state.pauseReason !== null) {
    if (state.pausedUntil === null || state.pausedUntil.getTime() > startedAt.getTime()) {
      log?.info('catalog_enrich_still_paused', {
        reason: state.pauseReason,
        until: state.pausedUntil?.toISOString(),
      });
      return report('paused', state, { error: state.lastError });
    }
    // Čas pauzy vypršal — dôvod sa zahodí a beh pokračuje.
    state = { ...state, pausedUntil: null, pauseReason: null };
  }

  const targetLeftBefore = Math.max(0, state.dailyTarget - state.enrichedToday);
  if (targetLeftBefore === 0) {
    await saveStateQuietly(deps, state, log);
    return report('target_reached', state);
  }

  /* ── 4. brána: oprávnenie, kľúč, rozpočet — s REZERVOU ────────────────── */

  const gate = await openGate(deps, capability, ENRICH_QUOTA_RESERVE);
  if (gate.blocked !== null) {
    /*
     * Pauza sa zapisuje LEN pre dôvod, ktorý sa v rámci dnešného dňa nezmení:
     * minutý denný rozpočet (aj keď je „minutý" kvôli rezerve). Chýbajúci kľúč,
     * chýbajúce oprávnenie ani nečitateľné počítadlo pauzu NEDOSTANÚ — sú to
     * lacné brány (pamäť a jeden lokálny dotaz), ďalší tik ich vyhodnotí znova
     * a pauza, ktorú by nemal kto uvoľniť, by dávku zabila natrvalo.
     */
    const budgetDay = gate.blocked === 'budget_day';
    // Rozlíšenie „strop je naozaj vyčerpaný" od „nesmieme do rezervy" —
    // v prvom prípade nemá kvótu ani dopyt, v druhom ju má.
    const reserveOnly = budgetDay && gate.budget !== null && !gate.budget.exhausted;
    const next: CatalogEnrichState = budgetDay
      ? {
          ...state,
          pausedUntil: gate.budget?.resetAt ?? null,
          pauseReason: 'daily_budget',
          lastError: reserveOnly ? 'quota_reserve' : 'daily_budget',
        }
      : { ...state, lastError: gate.error ?? gate.blocked };
    await saveStateQuietly(deps, next, log);
    return report(reserveOnly ? 'budget_reserve' : gate.blocked, next, {
      reads: gate.budget,
      error: next.lastError,
    });
  }

  /* ── 5. priorita a plán ────────────────────────────────────────────────── */

  if (deps.refreshPriority !== false) {
    try {
      priority = await deps.catalog.refreshEnrichPriority();
    } catch (cause) {
      // Bez prepočtu ide fronta podľa poslednej známej priority. Je to horšie
      // poradie, nie nesprávne dáta — beh sa preň nezastaví.
      log?.warn('catalog_enrich_priority_unrefreshed', { error: errorCode(cause) });
    }
  }

  const budgetRoom = Math.max(0, gate.budget.remaining - ENRICH_QUOTA_RESERVE);
  const take = Math.max(
    0,
    Math.min(
      targetLeftBefore,
      budgetRoom,
      ENRICH_MAX_PER_RUN,
      Math.trunc(deps.maxProducts ?? ENRICH_MAX_PER_RUN),
    ),
  );
  if (take === 0) {
    await saveStateQuietly(deps, state, log);
    return report('budget_reserve', state, { reads: gate.budget });
  }

  let ids: readonly number[];
  try {
    ids = await deps.catalog.nextToEnrich(take);
  } catch (cause) {
    const code = errorCode(cause);
    await saveStateQuietly(deps, { ...state, lastError: code }, log);
    return report('failed', state, { reads: gate.budget, error: code });
  }
  planned = ids.length;
  if (planned === 0) {
    await saveStateQuietly(deps, state, log);
    return report('no_ids', state, { reads: gate.budget });
  }

  /* ── 6. čítanie po jednom, sekvenčne, s pauzou ────────────────────────── */

  const ctx: ShopCtx = { operationId: deps.operationId ?? newOperationId() };
  let lastBudget: ReadBudgetStatus = gate.budget;
  let lastProductId: number | null = state.lastProductId;
  let lastReadAt: UtcDate | null = state.lastReadAt;
  let stopped: EnrichBatchOutcome | null = null;
  let pause: PausePatch | null = null;
  let error: string | null = null;

  for (const productId of ids) {
    if (stopped !== null) break;

    /*
     * Minútový strop kľúča. Tempo drží PAUZA (`pauseMs` ≥ 60 000/16), takže sa
     * strop dosiahnuť ani nedá; táto brána je poistka pre volajúceho, ktorý si
     * podsunul vlastné `sleepFn` (testy). Číslo sa berie z počítadla rozpočtu,
     * nie z vlastnej premennej — vlastná by nevedela, že minúta už uplynula, a
     * dávku by po šestnástich produktoch zastavila navždy.
     */
    if (lastBudget.known && lastBudget.usedThisMinute >= lastBudget.minuteLimit) {
      stopped = 'budget_minute';
      break;
    }

    if (attempted > 0) await sleepFn(pauseMs);

    const slot = await deps.reads.reserve(1).catch(() => null);
    if (slot === null || slot.granted < 1) {
      stopped = slot === null || !slot.status.known ? 'budget_unknown' : 'budget_day';
      if (slot !== null) lastBudget = slot.status;
      if (stopped === 'budget_day') {
        pause = { reason: 'daily_budget', until: lastBudget.resetAt, error: 'daily_budget' };
      }
      break;
    }
    lastBudget = slot.status;
    readsUsed += slot.granted;
    attempted += 1;
    lastReadAt = now();

    let full: ProductFullDetail;
    try {
      full = await deps.shop.getProductFull(productId, gate.key, ctx);
    } catch (cause) {
      const code = errorCode(cause);

      if (isBannedAddress(cause)) {
        /*
         * D120 — `ip_banned` je DÔVOD PAUZY. Produkt sa NEOZNAČÍ ako obohatený
         * a ani ako pokus: ban platí pre všetko (shop ním odpovedá aj na verejné
         * čítanie), takže posunúť ho na konec priority by prehodilo poradie
         * fronty za chybu, ktorá s ním nemá nič spoločné.
         * `paused_until = NULL` = stojí, kým nezasiahne človek.
         */
        stopped = 'ip_banned';
        error = code;
        pause = { reason: 'ip_banned', until: null, error: code };
        log?.error('catalog_enrich_address_banned', { productId, error: code });
        break;
      }

      if (isRateLimited(cause)) {
        // Rovnako ako pri bane: shop povedal „dosť", nie „tento produkt je zlý".
        const until = new Date(now().getTime() + rateLimitPauseMs(cause));
        stopped = 'rate_limited';
        error = code;
        pause = { reason: 'rate_limited', until, error: code };
        log?.warn('catalog_enrich_rate_limited', { productId, error: code });
        break;
      }

      // Chyba, ktorá patrí TOMUTO produktu: pokus sa zaznačí, aby jeden padajúci
      // `getFull` nezjedol celú dennú kvótu opakovaním.
      await markAttemptQuietly(deps, productId, log);
      lastProductId = productId;

      if (isNotFound(cause)) {
        // Eshop produkt nepozná. Nie je to porucha čítania a zvyšok pokračuje.
        log?.info('catalog_enrich_not_found', { productId });
        continue;
      }

      stopped = 'failed';
      error = code;
      pause = {
        reason: 'error',
        until: new Date(now().getTime() + ENRICH_ERROR_PAUSE_MS),
        error: code,
      };
      log?.warn('catalog_enrich_read_failed', { productId, error: code });
      break;
    }

    lastProductId = productId;

    if (!isReductionStorable(full)) {
      reductionUnknown += 1;
      await markAttemptQuietly(deps, productId, log);
      log?.warn('catalog_enrich_reduction_unknown', { productId });
      continue;
    }

    try {
      const saved = await deps.catalog.saveEnrichment(productId, toEnrichWrite(full, now()));
      if (saved) enriched += 1;
      else notInMirror += 1;
    } catch (cause) {
      // Zápis do vlastnej DB spadol — to nie je chyba shopu a opakovať čítanie
      // by len minulo kvótu. Beh sa zastaví, kvóta sa už minula.
      stopped = 'failed';
      error = errorCode(cause);
      pause = {
        reason: 'error',
        until: new Date(now().getTime() + ENRICH_ERROR_PAUSE_MS),
        error,
      };
      log?.error('catalog_enrich_save_failed', { productId, error });
      break;
    }

    // Rezerva sa kontroluje aj PO zápise: `reserve()` vracia stav po pripočítaní,
    // takže tu je vidieť, či ďalšie volanie už do rezervy nezasiahne.
    if (lastBudget.known && lastBudget.remaining <= ENRICH_QUOTA_RESERVE) {
      stopped = 'budget_reserve';
      pause = { reason: 'daily_budget', until: lastBudget.resetAt, error: 'quota_reserve' };
      break;
    }
  }

  /* ── 7. stav po behu ──────────────────────────────────────────────────── */

  const next: CatalogEnrichState = {
    ...state,
    batchDay: today,
    enrichedToday: state.enrichedToday + enriched,
    enrichedTotal: state.enrichedTotal + enriched,
    lastProductId,
    startedAt: state.startedAt ?? startedAt,
    lastReadAt,
    pausedUntil: pause?.until ?? null,
    pauseReason: pause?.reason ?? null,
    lastError: pause?.error ?? error,
  };
  await saveStateQuietly(deps, next, log);

  log?.info('catalog_enrich_batch_done', {
    outcome: stopped ?? 'done',
    planned,
    attempted,
    enriched,
    notInMirror,
    reductionUnknown,
    readsUsed,
    error: error ?? undefined,
  });

  return report(stopped ?? 'done', next, { reads: lastBudget, error });
}

/** Stav dávky sa ukladá vždy — jeho nezapísanie nesmie zhodiť beh. */
async function saveStateQuietly(
  deps: CatalogEnrichDeps,
  state: CatalogEnrichState,
  log: Logger | undefined,
): Promise<void> {
  try {
    await deps.catalog.saveEnrichState(state);
  } catch (cause) {
    log?.warn('catalog_enrich_state_unsaved', { error: errorCode(cause) });
  }
}
