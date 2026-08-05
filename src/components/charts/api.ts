'use client';

/**
 * Aura Zľavy — klientske typy a čítacie volania pre grafy (sekcia B2).
 *
 * Modul volá VÝHRADNE `GET /api/insights/*`. Žiadna mutácia, žiadne `POST`,
 * žiadny zápis — grafy sa na stav appky len pozerajú (I3 sa ich netýka,
 * pretože zapisovaciu cestu neotvárajú).
 *
 * Vlastný `getJson` (namiesto importu z `components/campaigns/api.ts`) drží
 * grafy nezávislé od súborov iného agenta.
 */

export interface ApiError {
  code: string;
  message: string;
}

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function getJson<T>(url: string): Promise<Envelope<T>> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    try {
      const body = (await res.json()) as Envelope<T>;
      if (body && typeof body === 'object' && 'ok' in body) return body;
    } catch {
      /* neplatný JSON — spadne nižšie */
    }
    return {
      ok: false,
      error: { code: `http_${res.status}`, message: 'Server vrátil neočakávanú odpoveď.' },
    };
  } catch {
    return { ok: false, error: { code: 'network', message: 'Server neodpovedá. Skús znova.' } };
  }
}

/* ═══════════════════════════ G1 — časová os ═══════════════════════════════ */

export interface TimelineCampaign {
  id: number;
  name: string;
  status: string;
  percent: number;
  dateFrom: string;
  dateTo: string;
  mode: string;
  fireAt: string | null;
  productIds: number[];
}

export interface TimelineData {
  today: string;
  from: string;
  to: string;
  campaigns: TimelineCampaign[];
}

export const getTimeline = () => getJson<TimelineData>('/api/insights/timeline');

/* ═══════════════════════ G2 — hĺbka zľavy ═════════════════════════════════ */

export interface DepthOwnWrite {
  percent: number;
  from: string;
  to: string;
  at: string;
  campaignId: number;
}

export interface DepthProduct {
  productId: number;
  slot: number | null;
  label: string | null;
  name: string | null;
  price: string | null;
  hasAttributes: boolean;
  shopStatus: string;
  /** `null` = appka na produkt nikdy nezapísala (prázdna dráha, I11). */
  lastOwnWrite: DepthOwnWrite | null;
}

export interface DepthData {
  today: string;
  products: DepthProduct[];
}

export const getDiscountDepth = () => getJson<DepthData>('/api/insights/discount-depth');

/* ═════════════════ G3 — história zápisov na produkt ═══════════════════════ */

export interface ProductWrite {
  itemId: number;
  campaignId: number;
  campaignName: string;
  status: string;
  percent: number;
  dateFrom: string;
  dateTo: string;
  at: string | null;
}

export interface ProductWritesData {
  productId: number;
  today: string;
  writes: ProductWrite[];
}

export const getProductWrites = (productId: number) =>
  getJson<ProductWritesData>(`/api/insights/product/${productId}`);

/* ═══════════════════ G4 — aktivita zápisov v čase ═════════════════════════ */

export interface ActivityDay {
  day: string;
  ok: number;
  failed: number;
  uncertain: number;
  skipped: number;
}

export interface ActivityData {
  today: string;
  from: string;
  to: string;
  days: ActivityDay[];
  truncated: boolean;
}

export const getActivity = (days = 30) =>
  getJson<ActivityData>(`/api/insights/activity?days=${Math.trunc(days)}`);

/* ═════════════════ G5 — rozpad položiek kampane ═══════════════════════════ */

export interface CampaignItemsData {
  campaignId: number;
  total: number;
  tally: Record<string, number>;
}

export const getCampaignItems = (campaignId: number) =>
  getJson<CampaignItemsData>(`/api/insights/campaign/${campaignId}/items`);
