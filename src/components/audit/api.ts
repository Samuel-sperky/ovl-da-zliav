'use client';

/**
 * Aura Zľavy — klientske typy a čítanie audit logu (A16, D18, D39c, I4).
 *
 * Audit je append-only: tento modul má výhradne GET volania, žiadna mutácia
 * neexistuje (I4). Snapshoty prichádzajú zo servera už redigované (I1) —
 * UI ich len zobrazí.
 */
import { getJson } from '@/components/campaigns/api';

export interface AuditRow {
  id: number;
  ts: string;
  actor: 'user' | 'scheduler' | 'system';
  userId: number | null;
  eventType: string;
  ok: boolean | null;
  campaignId: number | null;
  campaignItemId: number | null;
  productId: number | null;
  operationId: string | null;
  requestId: string | null;
  httpStatus: number | null;
  message: string | null;
}

export interface AuditDetail extends AuditRow {
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  /** D39c — „rozhodoval si nad inou cenou". */
  priceMismatch: boolean;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditPage {
  data: AuditRow[];
  page: number;
  perPage: number;
  total: number;
}

/** Stav filtrov `/audit` (D18) — produkt, dátum, typ operácie, výsledok. */
export interface AuditFilterState {
  productId: string;
  campaignId: string;
  eventType: string;
  from: string;
  to: string;
  /** `''` = všetko, `'true'` = úspešné, `'false'` = neúspešné. */
  ok: '' | 'true' | 'false';
  page: number;
  perPage: number;
}

export const EMPTY_FILTERS: AuditFilterState = {
  productId: '',
  campaignId: '',
  eventType: '',
  from: '',
  to: '',
  ok: '',
  page: 1,
  perPage: 25,
};

/** Skupiny typov operácií pre select (podzoznam `AUDIT_EVENT_TYPES` z §3). */
export const AUDIT_EVENT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'všetky typy' },
  { value: 'write_attempt', label: 'pokus o zápis' },
  { value: 'write_ok', label: 'zápis OK' },
  { value: 'write_failed', label: 'zápis zlyhal' },
  { value: 'write_uncertain', label: 'zápis neistý' },
  { value: 'write_skipped', label: 'zápis preskočený' },
  { value: 'campaign_created', label: 'kampaň vytvorená' },
  { value: 'campaign_confirmed', label: 'kampaň potvrdená' },
  { value: 'campaign_cancelled', label: 'kampaň zrušená' },
  { value: 'campaign_needs_key', label: 'kampaň čaká na kľúč' },
  { value: 'campaign_missed', label: 'kampaň zmeškaná' },
  { value: 'campaign_finished', label: 'kampaň dokončená' },
  { value: 'allowlist_added', label: 'allowlist — pridanie' },
  { value: 'allowlist_removed', label: 'allowlist — odobranie' },
  { value: 'allowlist_marked_unknown', label: 'allowlist — stav neznámy' },
  { value: 'catalog_refreshed', label: 'katalóg obnovený' },
  { value: 'key_stored', label: 'kľúč uložený' },
  { value: 'key_wiped', label: 'kľúč zmazaný' },
  { value: 'key_panic_wipe', label: 'panic button' },
  { value: 'domain_changed', label: 'zmena domény' },
  { value: 'canary_ok', label: 'test spojenia OK' },
  { value: 'canary_fail', label: 'test spojenia zlyhal' },
  { value: 'writes_locked', label: 'zápisy zamknuté' },
  { value: 'writes_unlocked', label: 'zápisy odomknuté' },
  { value: 'login_ok', label: 'prihlásenie OK' },
  { value: 'login_fail', label: 'prihlásenie zlyhalo' },
  { value: 'lockout', label: 'uzamknutie účtu' },
  { value: 'sudo_ok', label: 'sudo OK' },
  { value: 'sudo_fail', label: 'sudo zlyhalo' },
];

/** Filtre → query string (prázdne polia sa vynechávajú). */
export function toQuery(f: AuditFilterState): string {
  const q = new URLSearchParams();
  if (/^\d+$/.test(f.productId.trim())) q.set('productId', f.productId.trim());
  if (/^\d+$/.test(f.campaignId.trim())) q.set('campaignId', f.campaignId.trim());
  if (f.eventType !== '') q.set('eventType', f.eventType);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from)) q.set('from', f.from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to)) q.set('to', f.to);
  if (f.ok !== '') q.set('ok', f.ok);
  q.set('page', String(f.page));
  q.set('perPage', String(f.perPage));
  return q.toString();
}

export const getAudit = (f: AuditFilterState) => getJson<AuditPage>(`/api/audit?${toQuery(f)}`);
export const getAuditDetail = (id: number) => getJson<AuditDetail>(`/api/audit/${id}`);
