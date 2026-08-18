/**
 * Aura Zľavy — DOHĽADANIE PRODUKTU V ESHOPE (kontrakt UI, body 25–28).
 *
 * ČO TENTO MODUL RIEŠI
 * --------------------
 * Zrkadlo katalógu (`catalog_cache`) má 2 900 zo 41 082 produktov a rýchlejšie
 * to nebude: anonymný denný strop dovolí 240 čítaní za UTC deň, celý prechod je
 * 411 stránok, teda dva dni. Kým to dobehne, hľadanie nad zrkadlom vracia
 * prázdnu tabuľku — a prázdna tabuľka vyzerá presne ako „taký produkt
 * neexistuje". Používateľ z toho vyvodí, že produkt nemá, hoci ho appka len
 * ešte nenačítala.
 *
 * `GET /api/products/searchIndex` to rieši BEZ jediného nového oprávnenia:
 * je verejný (rovnako ako `GET /api/products/get`), hľadá vo VŠETKÝCH 41 082
 * produktoch — v názve, popise, **kóde produktu** aj v kategóriách — a znáša
 * preklepy aj poradie slov. Vracia ale LEN ID, takže názov a cenu treba
 * dotiahnuť po jednom.
 *
 * Z toho plynie celý tvar tohto modulu: hľadanie je DVOJKROKOVÉ a druhý krok
 * je platený. Preto sa nespúšťa samo (kontrakt bod 4 — žiadne automatické
 * obnovovanie) a preto má strop na jedno hľadanie.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ A PREČO
 * -------------------------------------------
 *  1. **Rozpočet sa REZERVUJE PRED volaním, a z jediného počítadla.** Používa sa
 *     zdieľaný anonymný rozpočet cez `catalogRepo` (A4). Vlastné počítadlo by
 *     znamenalo, že hľadanie a synchronizácia katalógu si navzájom ticho kradnú
 *     strop — a ban od shopu (predvolene 10 minút na IP) by zhodil oboje.
 *  2. **Strop na jedno hľadanie je tvrdý.** `LOOKUP_RESOLVE_MAX` je 10 a nedá sa
 *     prekročiť ani parametrom. 41 082 volaní `get` nie je hľadanie, to je
 *     scraping — a dokumentácia shopu ho výslovne zakazuje.
 *  3. **Minútový strop sa kontroluje tiež, nielen denný.** `reserve()` stráži
 *     len denné číslo; minútový (24 z 30) by hľadanie prekročilo hravo, lebo
 *     posiela až 11 čítaní za sebou bez pauzy. Preto sa pred behom pozerá na
 *     `usedThisMinute` a plán sa podľa neho SKRÁTI, nie zruší.
 *  4. **Neznáme počítadlo NIE JE minutý rozpočet** (I11). `known: false` znamená
 *     „nevieme, koľko dnes odišlo" — nečítať je správne, ale tvrdiť „rozpočet je
 *     minutý" by bolo číslo, ktoré appka nepozná. Sú to dva rôzne výsledky.
 *  5. **Modul NIKDY nehádže.** Hľadanie je pomocná ruka nad zrkadlom; keď shop
 *     mlčí, tabuľka zo zrkadla sa musí zobraziť aj tak. Chyba ide von ako KÓD
 *     (I1), nikdy ako text odpovede shopu.
 *  6. **Do zrkadla sa NIČ nezapisuje.** Bolo by lákavé uložiť to, za čo sme už
 *     zaplatili, lenže `catalog_cache` je zrkadlo PRECHODU synchronizácie:
 *     `loadedProducts` (COUNT) sa porovnáva so `shopTotal` a z toho sa počíta
 *     „koľko chýba" aj „dokedy to potrvá". Riadky doplnené hľadaním by tie
 *     čísla posunuli bez toho, aby prechod čokoľvek prečítal — a karta stavu
 *     katalógu (kontrakt bod 16) je najdôležitejšia vec na obrazovke Produkty.
 *
 * Modul je čistý: žiadna DB, žiadny `fetch`, žiadny `process.env`. Všetko
 * prichádza cez `ShopLookupDeps`, takže sa testuje bez siete aj bez MariaDB.
 *
 * Vlastník: V15 (hľadanie).
 */
import type { Logger, MoneyString, ShopCtx, Ulid, UtcDate } from '@/contracts';

import type { CatalogRepoExt } from '@/lib/repo/catalog.repo';
import { newOperationId } from '@/lib/shop/correlation';
import { isShopRequestError } from '@/lib/shop/errors';
import type { ReadBudgetStatus } from '@/lib/shop/read-budget';
import type { ShopClientV5 } from '@/lib/shop/client';

/* ═══════════════════════════ 1. Stropy hľadania ═══════════════════════════ */

/**
 * Koľko ID si pýtame od `searchIndex` na jedno hľadanie.
 *
 * Je to JEDNO čítanie bez ohľadu na číslo, takže väčšia stránka nič nestojí —
 * a čím viac ID vidíme, tým presnejšie vieme povedať, koľko z nich zrkadlo
 * nemá (overenie je jeden dotaz do vlastnej DB, teda zadarmo). Doťahovanie
 * názvov má vlastný, oveľa nižší strop nižšie.
 */
export const LOOKUP_CANDIDATE_LIMIT = 25;

/** Koľko neznámych ID sa dotiahne, keď si volajúci nepovie inak. */
export const LOOKUP_RESOLVE_DEFAULT = 5;

/**
 * Tvrdý strop dotiahnutých ID na JEDNO hľadanie. Nedá sa prekročiť parametrom.
 *
 * Číslo je odvodené, nie zvolené: anonymný minútový strop je 24 z 30 po
 * odrátaní rezervy a hľadanie posiela čítania za sebou bez pauzy. Pri 10 sa
 * do minúty zmestia dve hľadania a ešte zostane na synchronizáciu katalógu.
 */
export const LOOKUP_RESOLVE_MAX = 10;

/* ═══════════════════════════ 2. Tvar výsledku ═════════════════════════════ */

/**
 * Odkiaľ je riadok na obrazovke. Nie je to detail — je to odpoveď na otázku
 * „čomu z toho môžem veriť" (I11), a preto ju nesie KAŽDÝ produkt.
 *
 *  - `mirror` — názov a cena sú zo zrkadla katalógu, teda z posledného
 *    prechodu synchronizácie. Riadok má aj predajnosť a históriu vlastných
 *    zliav.
 *  - `shop`   — appka si produkt práve teraz vypýtala z eshopu, lebo ho
 *    v zrkadle nemá. Názov a cena sú čerstvé na sekundu; všetko ostatné
 *    je z vlastných tabuliek rovnako ako pri zrkadle.
 */
export type ProductOrigin = 'mirror' | 'shop';

/** Produkt dotiahnutý z eshopu — presne to, čo dáva `GET /api/products/get`. */
export interface ShopFoundProduct {
  readonly productId: number;
  readonly name: string | null;
  /** `DECIMAL(10,2)` ako string — cena nikdy neprechádza cez float (§2). */
  readonly price: MoneyString | null;
  readonly hasAttributes: boolean;
  /** Kedy sa produkt naozaj prečítal — MERANÝ fakt, nie odhad (P7). */
  readonly fetchedAt: UtcDate;
}

/**
 * Ako dopadlo hľadanie ako celok (teda `searchIndex`).
 *
 * `budget_day` a `budget_unknown` sa ZÁMERNE nezlievajú: prvé je meraný fakt
 * („dnes už nič, pokračujem po polnoci UTC"), druhé je medzera v poznaní
 * („počítadlo sa nedá prečítať"). Zliať ich by znamenalo tvrdiť číslo, ktoré
 * appka nepozná (I11).
 */
export type ShopLookupOutcome =
  /** Eshop odpovedal; podrobnosti sú v číslach nižšie. */
  | 'done'
  /** Nebolo sa na čo pýtať — prázdna otázka. Nič sa nevolalo. */
  | 'no_query'
  /** Dnešný rozpočet anonymných čítaní je minutý (meraný fakt). */
  | 'budget_day'
  /** Minútový strop je na hrane; o chvíľu to pôjde. */
  | 'budget_minute'
  /** Počítadlo čítaní sa nedá prečítať — nevieme, koľko dnes odišlo. */
  | 'budget_unknown'
  /** Eshop neodpovedal, alebo odpovedal inak, než appka čaká. */
  | 'failed';

/**
 * Prečo sa nedotiahli všetky neznáme ID. `none` = dotiahli sa všetky.
 *
 * `limit` (strop jedného hľadania) a `budget_minute` (o chvíľu to pôjde) sú
 * dve rôzne vety pre používateľa: prvá znamená „spresni otázku", druhá
 * „skús o chvíľu znova". Zliať ich by poslalo človeka opravovať niečo, čo
 * nie je pokazené.
 */
export type ShopFetchStop =
  | 'none'
  | 'limit'
  | 'budget_minute'
  | 'budget_day'
  | 'budget_unknown'
  | 'failed';

export interface ShopLookupResult {
  readonly outcome: ShopLookupOutcome;
  /**
   * Koľko produktov eshop na túto otázku našiel CELKOVO. Je to meraný fakt zo
   * shopu nad celým katalógom — nie odhad a nikdy sa neoznačuje `≈` (P7).
   * `null` = nedozvedeli sme sa to.
   */
  readonly shopTotal: number | null;
  /** ID, ktoré eshop poslal, v poradí RELEVANCIE. Ostáva nedotknuté. */
  readonly candidateIds: readonly number[];
  /** Z nich tie, ktoré zrkadlo katalógu už má. */
  readonly knownIds: readonly number[];
  /** Z nich tie, ktoré zrkadlo NEMÁ — kvôli nim sa hľadanie robí. */
  readonly missingIds: readonly number[];
  /** Naozaj dotiahnuté produkty. Podmnožina `missingIds`. */
  readonly fetched: readonly ShopFoundProduct[];
  /**
   * ID, ktoré index hľadania pozná, ale `get` na ne odpovedal „taký produkt
   * nemám". Je to VLASTNÁ skupina, nie chyba a nie nedotiahnutý produkt:
   * opakovať sa neoplatí a používateľovi sa nemá tvrdiť, že mu niečo chýba.
   */
  readonly notInShopIds: readonly number[];
  /** Neznáme ID, na ktoré sa už nedostalo. Dôvod je v `notFetchedReason`. */
  readonly notFetchedIds: readonly number[];
  readonly notFetchedReason: ShopFetchStop;
  /** Koľko anonymných čítaní toto hľadanie minulo. */
  readonly readsUsed: number;
  /**
   * Stav zdieľaného rozpočtu PO hľadaní — aby UI vedelo, čo ešte ide.
   * `null` = počítadlo sa nedalo prečítať; to je „nevieme", nie nula (I11).
   */
  readonly reads: ReadBudgetStatus | null;
  /** Kedy sa hľadalo. Konkrétny čas, nikdy „pred chvíľou" (kontrakt bod 10). */
  readonly at: UtcDate;
  /** KÓD chyby (I1) — nikdy text odpovede shopu. `null` = nič nespadlo. */
  readonly error: string | null;
}

/* ═══════════════════════════ 3. Závislosti ════════════════════════════════ */

export interface ShopLookupDeps {
  /**
   * VÝHRADNE verejná časť klienta. Zápis ani čítanie s kľúčom sa sem nedá
   * podstrčiť: ani `searchIndex`, ani `getProduct` neprijímajú `SecretRef`,
   * takže `X-Api-Key` sa pri hľadaní vôbec nezostaví (D48, I1).
   */
  readonly shop: Pick<ShopClientV5, 'searchIndex' | 'getProduct'>;
  /**
   * Zrkadlo a JEDINÉ dvere k zdieľanému rozpočtu čítaní (A4). Vlastné
   * počítadlo si tu nikto nezakladá.
   */
  readonly catalog: Pick<CatalogRepoExt, 'getMany' | 'reserveShopReads' | 'shopReadBudget'>;
  readonly logger?: Logger;
  readonly now?: () => UtcDate;
  /** Korelačné ID (D58). Default: nové. */
  readonly operationId?: Ulid;
  /** Koľko ID si vypýtať od eshopu. Strop `LOOKUP_CANDIDATE_LIMIT`. */
  readonly candidateLimit?: number;
  /** Koľko neznámych ID dotiahnuť. Strop `LOOKUP_RESOLVE_MAX`. */
  readonly resolveLimit?: number;
}

export interface ShopLookupInput {
  /** Otázka používateľa: názov, časť názvu, alebo KÓD produktu. */
  readonly query: string;
  readonly minPrice?: number;
  readonly maxPrice?: number;
}

/* ═══════════════════════════ 4. Pomocníci ═════════════════════════════════ */

/**
 * Chyba → KÓD (I1). Rovnaké pravidlo aj rovnaká implementácia ako
 * v `shop/catalog-sync.ts`: nikdy `message`, lebo hlášky z `fetch` a z `mariadb`
 * bežne nesú hostname alebo cestu k súboru — teda presne to, čo I1 z povrchu
 * vyhadzuje. Diagnostiku má logger, nie stav appky.
 */
function errorCode(error: unknown): string {
  if (isShopRequestError(error)) return error.shopError.code ?? error.shopError.kind;
  if (error instanceof Error && error.name.length > 0) return `local_${error.name}`;
  return 'local_unknown';
}

/** `true` len pre „shop taký produkt nemá" — jediná chyba, ktorá nezastaví zvyšok. */
function isNotFound(error: unknown): boolean {
  return isShopRequestError(error) && error.shopError.kind === 'not_found';
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  const parsed = Math.trunc(Number(value ?? fallback));
  if (!Number.isFinite(parsed) || parsed < 0) return Math.min(fallback, max);
  return Math.min(parsed, max);
}

/* ═══════════════════════════ 5. Hľadanie ══════════════════════════════════ */

/**
 * Dohľadá v eshope to, čo zrkadlo katalógu nemá.
 *
 * Postup je zámerne v tomto poradí a nie v inom:
 *
 *   1. rozpočet (denný aj minútový) — bez neho sa nič nevolá,
 *   2. `searchIndex` (1 čítanie) → ID v poradí relevancie,
 *   3. jeden dotaz do vlastnej DB → ktoré z nich zrkadlo už má (zadarmo),
 *   4. `get` po jednom pre tie, ktoré nemá — do stropu.
 *
 * Krok 3 je pred krokom 4 preto, že bez neho by sa platilo za názvy produktov,
 * ktoré appka má na disku. Práve tam sa dá minúť rozpočet za nič.
 *
 * @returns report hľadania; NIKDY nehádže.
 */
export async function lookupProductsInShop(
  input: ShopLookupInput,
  deps: ShopLookupDeps,
): Promise<ShopLookupResult> {
  const now = deps.now ?? ((): UtcDate => new Date());
  const log = deps.logger;
  const ctx: ShopCtx = { operationId: deps.operationId ?? newOperationId() };
  const candidateLimit = Math.max(
    1,
    clamp(deps.candidateLimit, LOOKUP_CANDIDATE_LIMIT, LOOKUP_CANDIDATE_LIMIT),
  );
  const resolveLimit = clamp(deps.resolveLimit, LOOKUP_RESOLVE_DEFAULT, LOOKUP_RESOLVE_MAX);

  const query = input.query.trim();

  /** Jediné miesto, kde sa skladá výsledok — aby žiadna vetva na pole nezabudla. */
  const report = (
    outcome: ShopLookupOutcome,
    reads: ReadBudgetStatus | null,
    patch: Partial<ShopLookupResult> = {},
  ): ShopLookupResult => ({
    outcome,
    shopTotal: null,
    candidateIds: [],
    knownIds: [],
    missingIds: [],
    fetched: [],
    notInShopIds: [],
    notFetchedIds: [],
    notFetchedReason: 'none',
    readsUsed: 0,
    reads,
    at: now(),
    error: null,
    ...patch,
  });

  // `status()` je fail-soft už na svojej strane (nečitateľné počítadlo vracia
  // ako `known: false`), takže sem sa výnimka dostane len pri poruche pod ním.
  // Ani vtedy sa nesmie hádzať: tabuľka zo zrkadla sa má zobraziť aj tak.
  let budget: ReadBudgetStatus | null;
  try {
    budget = await deps.catalog.shopReadBudget();
  } catch (cause) {
    log?.warn('shop_lookup_budget_unreadable', { error: errorCode(cause) });
    return report('budget_unknown', null, { error: errorCode(cause) });
  }

  if (query.length === 0) return report('no_query', budget);

  // Neznáme počítadlo NIE JE minutý rozpočet (I11): nečítať je správne, ale
  // „dnes už nič" by bolo tvrdenie o čísle, ktoré appka nepozná.
  if (!budget.known) return report('budget_unknown', budget);
  if (budget.exhausted) return report('budget_day', budget);

  /*
   * Minútový strop. `reserve()` stráži len denné číslo, lenže hľadanie posiela
   * až 11 čítaní za sebou bez pauzy — a minútový strop je 24 z 30. Preto sa
   * plán najprv SKRÁTI podľa toho, koľko sa do minúty ešte zmestí, a hľadanie
   * sa ruší len vtedy, keď sa nezmestí ani samotný `searchIndex`.
   *
   * `usedThisMinute` je počítadlo v pamäti procesu (po reštarte 0). Nie je to
   * záruka, je to najlepší dostupný signál — a je to ten istý objekt, ktorý
   * počíta aj synchronizácia katalógu, takže obe strany vidia to isté tempo.
   */
  const minuteRoom = Math.max(0, budget.minuteLimit - budget.usedThisMinute);
  if (minuteRoom < 1) return report('budget_minute', budget);

  const fetchCap = Math.max(0, Math.min(resolveLimit, minuteRoom - 1));
  /** Čí je to strop — vlastný strop hľadania, alebo minúta shopu. */
  const capReason: ShopFetchStop = minuteRoom - 1 < resolveLimit ? 'budget_minute' : 'limit';

  /* ── 1. `searchIndex` — jedno čítanie cez celý katalóg ─────────────────── */

  let readsUsed = 0;
  const reservation = await deps.catalog.reserveShopReads(1);
  if (reservation.granted < 1) {
    return report(reservation.status.known ? 'budget_day' : 'budget_unknown', reservation.status);
  }
  readsUsed += reservation.granted;

  let page: Awaited<ReturnType<ShopClientV5['searchIndex']>>;
  try {
    page = await deps.shop.searchIndex(
      {
        search: query,
        ...(input.minPrice !== undefined ? { minPrice: input.minPrice } : {}),
        ...(input.maxPrice !== undefined ? { maxPrice: input.maxPrice } : {}),
        page: 1,
        perPage: candidateLimit,
      },
      ctx,
    );
  } catch (cause) {
    const error = errorCode(cause);
    log?.warn('shop_lookup_failed', { error });
    return report('failed', await safeBudget(deps, reservation.status), { readsUsed, error });
  }

  const candidateIds = page.ids
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, candidateLimit);

  /* ── 2. Čo z toho zrkadlo už má (jeden dotaz do vlastnej DB, zadarmo) ──── */

  const inMirror = await deps.catalog.getMany([...candidateIds]);
  const knownIds = candidateIds.filter((id) => inMirror.has(id));
  const missingIds = candidateIds.filter((id) => !inMirror.has(id));

  /* ── 3. Neznáme ID po jednom — do stropu a do rozpočtu ─────────────────── */

  const fetched: ShopFoundProduct[] = [];
  const notInShopIds: number[] = [];
  let notFetchedReason: ShopFetchStop = missingIds.length > fetchCap ? capReason : 'none';
  let error: string | null = null;
  let lastBudget: ReadBudgetStatus = reservation.status;
  /** Koľko ID sa naozaj oslovilo — vrátane tých, čo shop nenašiel. */
  let attempted = 0;

  for (const productId of missingIds) {
    if (attempted >= fetchCap) break;

    const slot = await deps.catalog.reserveShopReads(1);
    lastBudget = slot.status;
    if (slot.granted < 1) {
      notFetchedReason = slot.status.known ? 'budget_day' : 'budget_unknown';
      break;
    }
    readsUsed += slot.granted;
    attempted += 1;

    try {
      const detail = await deps.shop.getProduct(productId, ctx);
      fetched.push({
        productId: detail.id,
        name: typeof detail.name === 'string' ? detail.name : null,
        price: Number.isFinite(detail.price) ? (detail.price.toFixed(2) as MoneyString) : null,
        hasAttributes: detail.has_attributes === true,
        fetchedAt: now(),
      });
    } catch (cause) {
      if (isNotFound(cause)) {
        // Index hľadania ID pozná, ale produkt už v shope nie je (skrytý,
        // zmazaný, ešte nezaindexovaný). Nie je to porucha ani nedotiahnutý
        // produkt — je to vlastná skupina a zvyšok pokračuje.
        notInShopIds.push(productId);
        continue;
      }
      // Čokoľvek iné (429, výpadok, zmenený tvar odpovede) zastaví ZVYŠOK:
      // ďalšie ID by narazilo na to isté a každý pokus stojí čítanie.
      error = errorCode(cause);
      notFetchedReason = 'failed';
      log?.warn('shop_lookup_detail_failed', { productId, error });
      break;
    }
  }

  const settled = new Set<number>([...fetched.map((p) => p.productId), ...notInShopIds]);
  const notFetchedIds = missingIds.filter((id) => !settled.has(id));

  log?.info('shop_lookup_done', {
    candidates: candidateIds.length,
    known: knownIds.length,
    missing: missingIds.length,
    fetched: fetched.length,
    notInShop: notInShopIds.length,
    readsUsed,
    shopTotal: page.total,
    error: error ?? undefined,
  });

  return {
    outcome: 'done',
    shopTotal: page.total,
    candidateIds,
    knownIds,
    missingIds,
    fetched,
    notInShopIds,
    notFetchedIds,
    notFetchedReason: notFetchedIds.length === 0 ? 'none' : notFetchedReason,
    readsUsed,
    reads: await safeBudget(deps, lastBudget),
    at: now(),
    error,
  };
}

/**
 * Stav rozpočtu po behu. Keď sa nedá prečítať, vráti sa POSLEDNÝ ZNÁMY —
 * hľadanie už prebehlo a zhodiť jeho výsledok kvôli počítadlu by znamenalo
 * zahodiť aj to, za čo sa zaplatilo.
 */
async function safeBudget(
  deps: ShopLookupDeps,
  fallback: ReadBudgetStatus,
): Promise<ReadBudgetStatus> {
  try {
    return await deps.catalog.shopReadBudget();
  } catch {
    return fallback;
  }
}
