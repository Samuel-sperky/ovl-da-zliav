'use client';

/**
 * Aura Zľavy — klientske typy a volania správy allowlistu (A16, §5).
 *
 * Route-y dodal A12; tento modul programuje proti NORMATÍVNEMU kontraktu
 * z BUILD-SPEC §5. Strop 10 produktov je fail-closed vynútený aj tu v UI
 * (I2) — tlačidlo „pridať" sa pri 10 aktívnych záznamoch vypne s vysvetlením
 * a request sa ani neodošle. Odobranie produktu s naplánovanou kampaňou
 * blokuje server (409 `campaign_planned`, D40) a UI dôvod zobrazí doslova.
 */
import type { Envelope } from '@/components/campaigns/api';
import { getJson, postJson } from '@/components/campaigns/api';

/** Strop allowlistu (I2, R1). */
export const ALLOWLIST_MAX = 10;

export interface AllowlistRow {
  productId: number;
  slot: number | null;
  label: string | null;
  shopStatus: 'ok' | 'not_found' | 'unknown';
  name: string | null;
  price: string | null;
  hasAttributes: boolean;
  lastOwnWrite: { percent: number; from: string; to: string; at: string } | null;
}

export interface CatalogRefreshResult {
  items: Array<{ productId: number; name?: string | null; price?: string | null }>;
  via: 'batch' | 'single' | 'get';
  staleCount: number;
}

/** Spoločný odosielač pre metódy, ktoré `campaigns/api.ts` neponúka. */
async function sendJson<T>(
  url: string,
  method: 'PUT' | 'DELETE' | 'POST',
  body?: unknown,
): Promise<Envelope<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    try {
      const parsed = (await res.json()) as Envelope<T>;
      if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed;
    } catch {
      /* neplatný JSON */
    }
    return {
      ok: false,
      error: { code: `http_${res.status}`, message: 'Server vrátil neočakávanú odpoveď.' },
    };
  } catch {
    return { ok: false, error: { code: 'network', message: 'Server neodpovedá. Skús znova.' } };
  }
}

export const getAllowlist = () => getJson<AllowlistRow[]>('/api/allowlist');

export const addProduct = (productId: number, label?: string) =>
  postJson<{ productId: number; slot: number }>(
    '/api/allowlist',
    label && label.trim().length > 0 ? { productId, label: label.trim() } : { productId },
  );

export const removeProduct = (productId: number) =>
  sendJson<{ removed: true }>(`/api/allowlist/${productId}`, 'DELETE');

export const markUnknown = (productId: number) =>
  postJson<{ shopStatus: 'unknown' }>(`/api/allowlist/${productId}/mark-unknown`);

export const refreshCatalog = (productIds?: number[]) =>
  postJson<CatalogRefreshResult>(
    '/api/catalog/refresh',
    productIds && productIds.length > 0 ? { productIds } : {},
  );

/**
 * Lokálna validácia ID produktu pred odoslaním (fail-closed, I2):
 * celé kladné číslo a allowlist ešte nesmie byť plný.
 */
export function validateNewProduct(raw: string, currentCount: number): string | null {
  if (currentCount >= ALLOWLIST_MAX) {
    return `Allowlist je plný (${ALLOWLIST_MAX}/${ALLOWLIST_MAX}). Najprv odober iný produkt — strop 10 produktov je tvrdý a appka ho neobchádza.`;
  }
  const trimmed = raw.trim();
  if (trimmed === '') return 'Zadaj ID produktu zo shopu.';
  if (!/^\d+$/.test(trimmed)) return 'ID produktu musí byť celé kladné číslo.';
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) return 'ID produktu musí byť celé kladné číslo.';
  return null;
}
