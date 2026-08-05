/**
 * Aura Zľavy — farebný badge stavu kampane / položky (D14, §8).
 *
 * Zobrazuje plnú sadu stavov ako farebné badge so slovenským labelom.
 * Derivované UI stavy `aktivna`/`expirovana` (§4) sa podávajú cez `derived`.
 */
import type { CampaignStatus, DerivedCampaignView, ItemStatus } from '@/contracts';

type Tone = 'ok' | 'warning' | 'danger' | 'neutral' | 'outline';

const CAMPAIGN_LABELS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: 'návrh', tone: 'neutral' },
  scheduled: { label: 'naplánovaná', tone: 'ok' },
  needs_key: { label: 'vyžaduje kľúč', tone: 'danger' },
  running: { label: 'beží zápis', tone: 'warning' },
  done: { label: 'zapísaná', tone: 'ok' },
  partial: { label: 'čiastočná', tone: 'warning' },
  failed: { label: 'zlyhala', tone: 'danger' },
  missed: { label: 'zmeškaná', tone: 'danger' },
  cancelled: { label: 'zrušená', tone: 'neutral' },
  lapsed: { label: 'prepadnutá', tone: 'neutral' },
};

const DERIVED_LABELS: Record<'aktivna' | 'expirovana', { label: string; tone: Tone }> = {
  aktivna: { label: 'aktívna', tone: 'ok' },
  expirovana: { label: 'expirovaná', tone: 'outline' },
};

const ITEM_LABELS: Record<ItemStatus, { label: string; tone: Tone }> = {
  pending: { label: 'čaká', tone: 'neutral' },
  skipped: { label: 'preskočený', tone: 'outline' },
  ok: { label: '✓ zapísaný', tone: 'ok' },
  failed: { label: '✗ zlyhal', tone: 'danger' },
  uncertain: { label: '? neistý', tone: 'warning' },
  interrupted: { label: 'prerušený', tone: 'warning' },
  not_found: { label: 'nenájdený', tone: 'danger' },
  blocked: { label: 'blokovaný', tone: 'danger' },
};

export interface StatusBadgeProps {
  status?: CampaignStatus;
  /** Derivovaný pohľad (§4) — má prednosť pred `status`, ak nie je null. */
  derived?: DerivedCampaignView;
  itemStatus?: ItemStatus;
}

export function StatusBadge({ status, derived, itemStatus }: StatusBadgeProps) {
  let entry: { label: string; tone: Tone } | null = null;
  if (itemStatus) entry = ITEM_LABELS[itemStatus];
  else if (derived) entry = DERIVED_LABELS[derived];
  else if (status) entry = CAMPAIGN_LABELS[status];
  if (!entry) return null;
  return <span className={`ovl-badge ovl-badge--${entry.tone}`}>{entry.label}</span>;
}

export default StatusBadge;
