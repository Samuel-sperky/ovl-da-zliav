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

/**
 * Vnútorný kód udalosti → veta, ktorú používateľ prečíta bez slovníka.
 *
 * Toto je JEDINÉ miesto, kde sa kódy histórie prekladajú. Tabuľka aj výber
 * v filtri z neho čerpajú, takže sa nemôžu rozísť — a keď pribudne nový kód,
 * `auditEventLabel()` ho nikdy nevypustí na povrch surový.
 */
export const AUDIT_EVENT_LABELS: Readonly<Record<string, string>> = {
  write_attempt: 'pokus o zlacnenie produktu',
  write_ok: 'produkt zlacnený',
  write_failed: 'produkt sa nepodarilo zlacniť',
  write_uncertain: 'nevieme, či sa produkt zlacnil',
  write_skipped: 'zlacnenie preskočené, už tam bolo',
  campaign_created: 'zľava vytvorená',
  campaign_confirmed: 'zľava potvrdená',
  campaign_cancelled: 'zľava zrušená',
  campaign_needs_key: 'zľava čaká na kľúč',
  campaign_missed: 'zľava zmeškala svoj štart',
  campaign_finished: 'zľava dopísaná',
  allowlist_added: 'pridané medzi povolené produkty',
  allowlist_removed: 'odobrané z povolených produktov',
  allowlist_marked_unknown: 'stav produktu označený za neznámy',
  scope_mode_changed: 'zmena rozsahu zliav',
  catalog_refreshed: 'načítaný katalóg',
  key_stored: 'vložený kľúč',
  key_wiped: 'zmazaný kľúč',
  key_panic_wipe: 'kľúče zmazané po úniku',
  domain_changed: 'zmena adresy eshopu',
  canary_ok: 'skúška spojenia prešla',
  canary_fail: 'skúška spojenia neprešla',
  writes_locked: 'zápisy zastavené',
  writes_unlocked: 'zápisy odomknuté',
  login_ok: 'prihlásenie',
  login_fail: 'neúspešné prihlásenie',
  lockout: 'účet dočasne uzamknutý',
  sudo_ok: 'potvrdenie heslom',
  sudo_fail: 'neúspešné potvrdenie heslom',
};

/** Kód udalosti → veta. Neznámy kód sa NIKDY nezobrazí surový. */
export function auditEventLabel(eventType: string): string {
  const known = Object.prototype.hasOwnProperty.call(AUDIT_EVENT_LABELS, eventType)
    ? AUDIT_EVENT_LABELS[eventType]
    : undefined;
  return known ?? 'iná udalosť appky';
}

/** Kto to urobil — na povrchu jedno slovo, nie názov vnútornej role. */
export const AUDIT_ACTOR_LABELS: Readonly<Record<AuditRow['actor'], string>> = {
  user: 'človek',
  scheduler: 'appka',
  system: 'appka',
};

/** Možnosti výberu v filtri histórie; prázdna hodnota = bez obmedzenia. */
export const AUDIT_EVENT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'všetko' },
  ...Object.keys(AUDIT_EVENT_LABELS).map((value) => ({
    value,
    label: auditEventLabel(value),
  })),
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
