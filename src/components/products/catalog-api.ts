'use client';

/**
 * Aura Zľavy — klientske volania tabu Produkty (V10; kontrakt V3 K7, K8, I11).
 *
 * Modul zámerne NEIMPORTUJE nič z `components/campaigns` ani z `products/api.ts`
 * (správa povolených produktov). Tab Produkty číta katalóg a do shopu NIKDY
 * nezapisuje; keby zdieľal klienta so zápisovou obrazovkou, jedna zmena tam by
 * mohla ticho zmeniť správanie tu.
 *
 * JEDNA VÝNIMKA A PREČO NIE JE ZÁPIS
 * ----------------------------------
 * `runCatalogBatch()` posiela `POST /api/catalog/sync`. Je to jediné `POST`
 * v tomto module a je to ČÍTANIE zo shopu: načíta ďalšiu stránku katalógu do
 * `catalog_cache`. Nedotkne sa zápisového rozpočtu ani zliav a nemá ako —
 * synchronizácia sa ku klientovi shopu dostane len cez `listProducts`. Tlačidlo
 * tu musí byť preto, že vety prekážok posielajú používateľa načítať katalóg
 * PRÁVE do Produktov (`BLOCKER_PATHS.products`); obrazovka bez toho tlačidla by
 * z tej vety urobila slepú uličku.
 *
 * Čo tento modul NEROBÍ:
 *
 *  · nevymýšľa dáta pre zamknuté filtre — `lockedFilters` z odpovede sa
 *    predáva ďalej tak, ako prišli (K8),
 *  · nedopočítava „Dáta k …" — `dataAsOf` je meraný fakt, `null` znamená
 *    prázdny katalóg a obrazovka to má povedať, nie odhadnúť (P7),
 *  · netvrdí, že pozná stav zľavy v shope — `discountedNow` je náš vlastný
 *    zápis (I11) a tak sa aj pomenúva na povrchu,
 *  · neskladá vety o prekážkach — `GET /api/status` ich vracia hotové
 *    z `lib/status/blockers.ts` a obrazovka ich len vykreslí.
 *
 * Vlastník: V10.
 */
import type { CatalogFilterState } from '@/components/products/catalog-filter';
import { catalogSearchQuery } from '@/components/products/catalog-filter';
import type {
  CatalogRunReportView,
  CatalogStatusView,
} from '@/components/products/catalog-status';
import type { StatusPayload } from '@/lib/status/snapshot';

/* ═══════════════════════════ 1. Obálka odpovede ═══════════════════════════ */

export interface ApiErrorView {
  readonly code: string;
  readonly message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiErrorView };

/** Hláška, keď server odpovie inak, než appka čaká. Bez kódu, bez čísla. */
const UNEXPECTED: ApiErrorView = {
  code: 'unexpected',
  message: 'Server odpovedal inak, než sme čakali. Skúste to znova.',
};

const OFFLINE: ApiErrorView = {
  code: 'network',
  message: 'Server neodpovedá. Skúste to znova.',
};

async function readJson<T>(url: string, signal?: AbortSignal): Promise<Result<T>> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
    try {
      const body = (await res.json()) as Result<T>;
      if (body !== null && typeof body === 'object' && 'ok' in body) return body;
    } catch {
      /* neplatné telo — spadne na `UNEXPECTED` nižšie */
    }
    return { ok: false, error: UNEXPECTED };
  } catch (error) {
    // Zrušený dotaz nie je chyba — používateľ len rýchlo klikol ďalej.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: { code: 'aborted', message: '' } };
    }
    return { ok: false, error: OFFLINE };
  }
}

/**
 * `POST` s prázdnym telom. Používa ho výhradne `runCatalogBatch()` — pozri
 * hlavičku modulu, prečo je jedno `POST` v čítacom klientovi v poriadku.
 */
async function postJson<T>(url: string, signal?: AbortSignal): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    });
    try {
      const body = (await res.json()) as Result<T>;
      if (body !== null && typeof body === 'object' && 'ok' in body) return body;
    } catch {
      /* neplatné telo — spadne na `UNEXPECTED` nižšie */
    }
    return { ok: false, error: UNEXPECTED };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: { code: 'aborted', message: '' } };
    }
    return { ok: false, error: OFFLINE };
  }
}

export const isAborted = (error: ApiErrorView): boolean => error.code === 'aborted';

/* ═══════════════════════════ 2. Katalóg ═══════════════════════════════════ */

export type ShopStatus = 'ok' | 'not_found' | 'unknown';

export interface CatalogRowView {
  readonly productId: number;
  readonly name: string | null;
  readonly price: string | null;
  readonly hasAttributes: boolean;
  readonly shopStatus: ShopStatus;
  /** Predané kusy za zvolené okno — jediné číslo predajnosti, ktoré máme. */
  readonly unitsSold: number;
  /** I11 — z vlastných úspešných zápisov, nie zo shopu. */
  readonly everDiscounted: boolean;
  readonly discountedNow: boolean;
  readonly fetchedAt: string;
  /**
   * I11 — ODKIAĽ je tento riadok. `mirror` = názov a cena z posledného
   * prechodu synchronizácie katalógu. `shop` = appka si ich práve vypýtala
   * z eshopu, lebo v zrkadle neboli.
   *
   * Bez tohto poľa by na jednej obrazovke stáli vedľa seba dva rôzne stupne
   * istoty a vyzerali by rovnako.
   */
  readonly origin: ProductOrigin;
}

/** Odkiaľ pochádza riadok katalógu (I11). */
export type ProductOrigin = 'mirror' | 'shop';

export interface CatalogCountsView {
  readonly total: number;
  readonly sold: Readonly<Record<'none' | 'low' | 'mid' | 'high', number>>;
  readonly neverDiscounted: number;
  readonly discountedNow: number;
  readonly soldWindowDays: number;
}

/** Jeden zamknutý filter (K8). `requested` = poslali sme ho a nepoužil sa. */
export interface LockedFilterView {
  readonly locked: true;
  readonly requested: boolean;
}

export interface CatalogSearchView {
  readonly data: readonly CatalogRowView[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly soldWindowDays: number;
  readonly soldFrom: string;
  readonly soldTo: string;
  readonly counts: CatalogCountsView | null;
  readonly catalogTotal: number;
  /** P7 — meraný čas posledného načítania katalógu; `null` = katalóg je prázdny. */
  readonly dataAsOf: string | null;
  readonly lockedFilters: Readonly<Record<string, LockedFilterView>>;
  readonly discountSource: 'own_writes';
  /**
   * `total` je počet v ZRKADLE, nie v eshope. Kým zrkadlo nie je úplné, je to
   * DOLNÁ HRANICA a obrazovka ho musí označiť znakom `≈` (P7).
   */
  readonly totalSource: 'mirror';
  /** Výsledok dohľadania v eshope. Spúšťa sa VÝHRADNE na vyžiadanie. */
  readonly lookup: LookupView;
  /** Čo appka zatiaľ nesmie — presné filtre, kategórie, kód produktu. */
  readonly capabilities: readonly CapabilityView[];
}

/**
 * Dohľadanie v eshope (`?lookup=1`). Míňa anonymný rozpočet čítaní, preto sa
 * NIKDY nespúšťa samo — vždy až na kliknutie.
 */
export interface LookupView {
  readonly requested: boolean;
  readonly outcome: string;
  /** Koľko produktov hlási eshop pre túto otázku. `null` = nevieme. */
  readonly shopTotal: number | null;
  /** Koľko riadkov pribudlo z eshopu (v zrkadle neboli). */
  readonly addedFromShop: number;
  /** Koľko sa ich nestihlo dotiahnuť — zvyčajne pre rozpočet. */
  readonly notFetched: number;
  readonly readsUsed: number;
  /** Meraný čas hľadania, nie odhad. */
  readonly at: string | null;
  readonly error: string | null;
}

/** Funkcia, ktorú appka pozná, ale zatiaľ na ňu nemá oprávnenie (K8). */
export interface CapabilityView {
  readonly id: string;
  readonly available: boolean;
  /** Slovenská veta, prečo nie je dostupná. `null` = dostupná je. */
  readonly note: string | null;
}

export function searchCatalog(
  filter: CatalogFilterState,
  signal?: AbortSignal,
): Promise<Result<CatalogSearchView>> {
  return readJson<CatalogSearchView>(`/api/catalog/search?${catalogSearchQuery(filter)}`, signal);
}

/**
 * To isté hľadanie, ale s dohľadaním v eshope (`?lookup=1`).
 *
 * Zrkadlo katalógu má 2 900 zo 41 082 produktov, takže „ešte som to nenačítal"
 * vyzerá presne ako „taký produkt neexistuje". Toto ten rozdiel odstráni:
 * pýta sa verejného `searchIndex` a chýbajúce riadky dotiahne cez `get`.
 *
 * MÍŇA ANONYMNÝ ROZPOČET ČÍTANÍ (30/min, 300/UTC deň na IP), preto sa NIKDY
 * nevolá samo pri písaní — výhradne na kliknutie. Kontrakt UI, bod 26.
 */
export function lookupInShop(
  filter: CatalogFilterState,
  signal?: AbortSignal,
): Promise<Result<CatalogSearchView>> {
  return readJson<CatalogSearchView>(
    `/api/catalog/search?${catalogSearchQuery(filter)}&lookup=1`,
    signal,
  );
}

/**
 * Jeden produkt v inom okne predajnosti — do bočného panela („za 360 dní 11").
 * Je to ten istý meraný údaj, len iné okno; nič sa nedopočítava.
 */
export function catalogRow(
  productId: number,
  soldWindowDays: number,
  signal?: AbortSignal,
): Promise<Result<CatalogSearchView>> {
  const params = new URLSearchParams({
    productIds: String(productId),
    soldWindowDays: String(soldWindowDays),
    perPage: '1',
    counts: '0',
  });
  return readJson<CatalogSearchView>(`/api/catalog/search?${params.toString()}`, signal);
}

/* ═══════════════════════ 3. História zliav produktu ═══════════════════════ */

/**
 * Jeden VLASTNÝ zápis appky na produkt (I11). Nie je to história zliav
 * v shope — je to história toho, čo appka sama urobila, a tak sa to na
 * povrchu aj volá.
 */
export interface ProductWriteView {
  readonly itemId: number;
  readonly campaignId: number;
  readonly campaignName: string;
  readonly status: string;
  readonly percent: number;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly at: string | null;
}

export interface ProductWritesView {
  readonly productId: number;
  readonly today: string;
  readonly writes: readonly ProductWriteView[];
}

export function productWrites(
  productId: number,
  signal?: AbortSignal,
): Promise<Result<ProductWritesView>> {
  return readJson<ProductWritesView>(`/api/insights/product/${productId}`, signal);
}

/* ═════════════════ 4. Stav katalógu (koľko z koľkých, prečo sa čaká) ══════ */

/**
 * Odpoveď `GET /api/catalog/sync`.
 *
 * Route posiela aj `lastRun` — posledný beh synchronizácie. Obrazovka ho
 * ZÁMERNE ignoruje: pri otvorení tabu by to bola veta o dávke, ktorú spustil
 * scheduler o tretej v noci, a používateľ by hľadal, čo práve urobil on. Vetu
 * o behu ukazujeme len ako odpoveď na kliknutie (`runCatalogBatch`).
 */
export interface CatalogSyncView {
  readonly catalog: CatalogStatusView;
}

/**
 * Stav katalógu BEZ toho, aby sa čokoľvek spustilo — na shop neodíde ani jeden
 * request, takže sa to dá volať aj opakovane pri otvorení obrazovky.
 */
export function catalogSyncStatus(signal?: AbortSignal): Promise<Result<CatalogSyncView>> {
  return readJson<CatalogSyncView>('/api/catalog/sync', signal);
}

/** Odpoveď `POST` — čo urobil TENTO beh, plus stav katalógu po ňom. */
export interface CatalogBatchView extends CatalogRunReportView {
  readonly catalog: CatalogStatusView;
}

/**
 * Načíta ďalšiu dávku katalógu. Jeden `POST` NIE JE celý katalóg — prečíta, čo
 * sa zmestí do rozpočtu čítaní, uloží pokrok a povie, kde skončil. Pokračovanie
 * od poslednej strany je vlastnosť servera, nie tohto volania.
 */
export function runCatalogBatch(signal?: AbortSignal): Promise<Result<CatalogBatchView>> {
  return postJson<CatalogBatchView>('/api/catalog/sync', signal);
}

/* ═══════════ 5. Prekážky a stropy — jeden endpoint pre celý obraz ═════════ */

/**
 * Fakty o stave appky aj HOTOVÝ zoznam prekážok z `lib/status/blockers.ts`.
 * Obrazovka Produkty si z neho berie tri veci: účinný strop na jednu zľavu
 * (K1), prekážky okolo katalógu a podklad na prepočet prekážok nad VLASTNÝM
 * výberom (`statusSnapshotFromPayload`). Endpoint je lacný a nevolá shop.
 *
 * Doteraz sa strop čítal z `/api/settings`; dvom zdrojom toho istého čísla sa
 * obrazovka vyhýba zámerne — rozišli by sa v okamihu, keď jeden z nich
 * fail-closed spadne na pilotnú desiatku a druhý nie.
 */
export function appStatus(signal?: AbortSignal): Promise<Result<StatusPayload>> {
  return readJson<StatusPayload>('/api/status', signal);
}
