'use client';

/**
 * Aura Zľavy — klientske volania tabu Produkty (V10; kontrakt V3 K7, K8, I11).
 *
 * Modul zámerne NEIMPORTUJE nič z `components/campaigns` ani z `products/api.ts`
 * (správa povolených produktov). Tab Produkty číta katalóg a nič nezapisuje;
 * keby zdieľal klienta so zápisovou obrazovkou, jedna zmena tam by mohla ticho
 * zmeniť správanie tu.
 *
 * Čo tento modul NEROBÍ:
 *
 *  · nevymýšľa dáta pre zamknuté filtre — `lockedFilters` z odpovede sa
 *    predáva ďalej tak, ako prišli (K8),
 *  · nedopočítava „Dáta k …" — `dataAsOf` je meraný fakt, `null` znamená
 *    prázdny katalóg a obrazovka to má povedať, nie odhadnúť (P7),
 *  · netvrdí, že pozná stav zľavy v shope — `discountedNow` je náš vlastný
 *    zápis (I11) a tak sa aj pomenúva na povrchu.
 *
 * Vlastník: V10.
 */
import type { CatalogFilterState } from '@/components/products/catalog-filter';
import { catalogSearchQuery } from '@/components/products/catalog-filter';

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
}

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
}

export function searchCatalog(
  filter: CatalogFilterState,
  signal?: AbortSignal,
): Promise<Result<CatalogSearchView>> {
  return readJson<CatalogSearchView>(`/api/catalog/search?${catalogSearchQuery(filter)}`, signal);
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

/* ═══════════════════════════ 4. Strop na zľavu ════════════════════════════ */

export interface ScopeLimitsView {
  /** Účinný strop produktov na jednu zľavu (K1). */
  readonly maxProducts: number;
  readonly scopeFailClosed: boolean;
}

export function scopeLimits(signal?: AbortSignal): Promise<Result<ScopeLimitsView>> {
  return readJson<ScopeLimitsView>('/api/settings', signal);
}
