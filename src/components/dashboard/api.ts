'use client';

/**
 * Aura Zľavy — typy a čítanie dashboardových dát z API kontraktu §5.
 *
 * Route-y dodávajú A11/A12 — kontrakt v BUILD-SPEC §5 je normatívny,
 * tento modul proti nemu len číta. Všetky chyby siete sa mapujú na `null`
 * a dashboard ich zobrazí ako degradovaný stav, nikdy nie ako falošné dáta.
 */
import type { CampaignStatus, DerivedCampaignView } from '@/contracts';
import { fetchJson } from '@/components/layout/health';

/** `GET /api/key` (D65) — nikdy nič viac než metadáta (I1). */
export interface KeyData {
  present: boolean;
  last4: string | null;
  savedAt: string | null;
  expiresAt: string | null;
  secondsLeft: number | null;
  verifyStatus: 'unverified' | 'valid' | 'invalid' | 'forbidden' | null;
}

/** Položka `GET /api/allowlist` (D7). */
export interface AllowlistItem {
  productId: number;
  slot: number;
  label: string | null;
  shopStatus: 'ok' | 'not_found' | 'unknown';
  name: string | null;
  price: string | null;
  hasAttributes: boolean;
  lastOwnWrite: { percent: number; from: string; to: string; at: string } | null;
}

/** Riadok `GET /api/campaigns` (D14) + derivované UI stavy (§4). */
export interface CampaignRow {
  id: number;
  name: string;
  status: CampaignStatus;
  derivedView?: DerivedCampaignView;
  percent: number;
  dateFrom: string;
  dateTo: string;
  mode: 'eager' | 'scheduled';
  itemsTotal: number;
  itemsOk: number;
  itemsFailed: number;
  fireAt?: string | null;
}

export interface CampaignsPage {
  data: CampaignRow[];
  page: number;
  perPage: number;
  total: number;
}

/** `GET /api/notifications` (D17). */
export interface UnackedResult {
  campaignId: number;
  name: string;
  status: CampaignStatus;
  finishedAt: string | null;
}

export const getKey = () => fetchJson<KeyData>('/api/key');
export const getAllowlist = () => fetchJson<AllowlistItem[]>('/api/allowlist');
export const getCampaigns = (query = '') =>
  fetchJson<CampaignsPage>(`/api/campaigns${query ? `?${query}` : ''}`);
export const getNotifications = () =>
  fetchJson<{ unacked: UnackedResult[] }>('/api/notifications');

/** POST `/api/campaigns/[id]/ack` (D17). */
export async function ackCampaign(campaignId: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/campaigns/${campaignId}/ack`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}
