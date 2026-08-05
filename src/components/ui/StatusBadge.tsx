/**
 * Aura Zľavy — badge stavu kampane / položky (D14, §8; redizajn §3.2, §3.3).
 *
 * Tón hovorí, ČO MÁM ROBIŤ, nie aký je to typ udalosti:
 *   critical  — zlyhala (stalo sa, je to chyba)
 *   attention — vyžaduje kľúč, zmeškaná, čiastočná, neistý výsledok
 *   progress  — beží zápis
 *   good      — zapísaná / aktívna / OK
 *   idle       — naplánovaná, návrh, zrušená, prepadnutá, preskočený, čaká
 *
 * Zmena oproti pôvodu: `scheduled` (naplánovaná) už NIE je zelená — nič sa
 * ešte nestalo, zelená sa uvolnila pre „stalo sa a je to dobre" (rozhodnutie
 * D14 revidované v pláne §7). `needs_key` a `missed` majú ten istý tón
 * (D8/D33b — rovnaká vizuálna váha, žiadna hierarchia medzi nimi).
 *
 * Farba nikdy nestojí sama: každý záznam nesie glyf aj slovenský text.
 */
import type { CampaignStatus, DerivedCampaignView, ItemStatus } from '@/contracts';
import ToneBadge, { type StatusTone } from '@/components/ui/ToneBadge';

interface Entry {
  label: string;
  tone: StatusTone;
  glyph: string;
}

const CAMPAIGN_LABELS: Record<CampaignStatus, Entry> = {
  draft: { label: 'návrh', tone: 'idle', glyph: '✎' },
  scheduled: { label: 'naplánovaná', tone: 'idle', glyph: '○' },
  needs_key: { label: 'vyžaduje kľúč', tone: 'attention', glyph: '⚿' },
  running: { label: 'beží zápis', tone: 'progress', glyph: '◐' },
  done: { label: 'zapísaná', tone: 'good', glyph: '✓' },
  partial: { label: 'čiastočná', tone: 'attention', glyph: '◧' },
  failed: { label: 'zlyhala', tone: 'critical', glyph: '✕' },
  missed: { label: 'zmeškaná', tone: 'attention', glyph: '⏱' },
  cancelled: { label: 'zrušená', tone: 'idle', glyph: '–' },
  lapsed: { label: 'prepadnutá', tone: 'idle', glyph: '⊘' },
};

const DERIVED_LABELS: Record<'aktivna' | 'expirovana', Entry> = {
  aktivna: { label: 'aktívna', tone: 'good', glyph: '✓' },
  expirovana: { label: 'expirovaná', tone: 'idle', glyph: '⌛' },
};

const ITEM_LABELS: Record<ItemStatus, Entry> = {
  pending: { label: 'čaká', tone: 'idle', glyph: '○' },
  skipped: { label: 'preskočený', tone: 'idle', glyph: '⤼' },
  ok: { label: 'zapísaný', tone: 'good', glyph: '✓' },
  failed: { label: 'zlyhal', tone: 'critical', glyph: '✕' },
  uncertain: { label: 'neistý', tone: 'attention', glyph: '?' },
  interrupted: { label: 'prerušený', tone: 'attention', glyph: '⏸' },
  not_found: { label: 'nenájdený', tone: 'attention', glyph: '∅' },
  blocked: { label: 'blokovaný', tone: 'attention', glyph: '⊗' },
};

export interface StatusBadgeProps {
  status?: CampaignStatus;
  /** Derivovaný pohľad (§4) — má prednosť pred `status`, ak nie je null. */
  derived?: DerivedCampaignView;
  itemStatus?: ItemStatus;
}

export function StatusBadge({ status, derived, itemStatus }: StatusBadgeProps) {
  let entry: Entry | null = null;
  if (itemStatus) entry = ITEM_LABELS[itemStatus];
  else if (derived) entry = DERIVED_LABELS[derived];
  else if (status) entry = CAMPAIGN_LABELS[status];
  if (!entry) return null;
  return (
    <ToneBadge tone={entry.tone} glyph={entry.glyph} data-status-tone={entry.tone}>
      {entry.label}
    </ToneBadge>
  );
}

export default StatusBadge;
