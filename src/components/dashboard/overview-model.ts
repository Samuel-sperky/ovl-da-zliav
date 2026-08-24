/**
 * Aura Zľavy — čisté rozhodovanie Prehľadu (V9).
 *
 * Obrazovka sa nesmie rozhodovať sama a už vôbec nie priamo v JSX: „ukáž
 * pokojný stav" alebo „fronta stojí" sú tvrdenia o produkčnom eshope a musia sa
 * dať otestovať bez prehliadača. Tento modul preto berie surové snímky z API
 * a vracia hotové rozhodnutie; komponenty ho už len kreslia.
 *
 * Slovo o stave si tu nikto nevymýšľa — každé ide cez `campaignSentence()`
 * zo slovníka, ktorý pozná presne štyri stavy a zvyšok pripája ako príznak.
 *
 * Vlastník: V9.
 */
import type { CampaignRow, QueueSnapshot } from '@/components/dashboard/api';
import type { CampaignSentence, CampaignStatusCode } from '@/lib/ui/vocabulary';
import { CAMPAIGN_STATUS_CODES, campaignSentence, todayHere } from '@/lib/ui/vocabulary';

/* ═════════════════════════ 0. Kód stavu zo servera ════════════════════════ */

/**
 * Kód stavu z API → kód, ktorý slovník pozná.
 *
 * Neznámy kód sa NEPOSIELA ďalej: slovník by zaňho nenašiel slovo a obrazovka
 * by vykreslila prázdnu bodku bez textu. Fail-closed náhrada je `draft`, teda
 * najpasívnejšie možné tvrdenie („pripravená") — appka radšej podcení, čo sa
 * deje, než aby tvrdila, že sa niekde zapisuje.
 */
export function toStatusCode(status: string): CampaignStatusCode {
  return (CAMPAIGN_STATUS_CODES as readonly string[]).includes(status)
    ? (status as CampaignStatusCode)
    : 'draft';
}

/* ═══════════════════════ 1. Stav dominantnej sekcie ═══════════════════════ */

/**
 * Päť stavov dominanty, presne podľa predlôh:
 *
 *  - `unknown`  — appka neodpovedala; nič sa netvrdí (`prazdne-stavy.html`),
 *  - `empty`    — ešte nie je žiadna zľava (`prazdne-stavy.html`),
 *  - `calm`     — nič sa nezapisuje, „Všetko beží" (`prehlad-pokoj.html`),
 *  - `paused`   — fronta stojí po odstávke počítača (`prehlad-pozastavene.html`),
 *  - `running`  — fronta zapisuje, číslo v 64 px (`prehlad.html`).
 */
export type QueueMode = 'unknown' | 'empty' | 'calm' | 'paused' | 'running';

export interface QueueProgress {
  mode: QueueMode;
  done: number;
  total: number;
  /** Podiel spracovaných položiek v percentách, orezaný na 0–100. */
  percent: number;
  /** Zostáva zapísať. */
  pending: number;
  campaignId: number | null;
  campaignName: string | null;
  sentence: CampaignSentence | null;
  /** `3 pásma · 30 / 20 / 15 %` alebo `30 %`; `null`, keď pásma nepoznáme. */
  tiersLabel: string | null;
  /** Odhad dobehnutia — na povrchu VŽDY so `≈`. */
  finishDay: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  failed: number;
  /** Kedy fronta prestala zapisovať; `null`, keď to appka nevie. */
  pausedSince: string | null;
}

/**
 * Pásma zľavy jedným riadkom: `3 pásma · 30 / 20 / 15 %`.
 *
 * Zoradené zostupne podľa percenta, nie podľa poradia pásma — používateľ číta
 * najprv najväčšiu zľavu, a hlavička zľavy hovorí práve najvyššie percento.
 */
export function tiersLabel(row: CampaignRow): string {
  if (row.tiers.length <= 1) return `${row.percent} %`;
  const percents = [...row.tiers]
    .map((tier) => tier.percent)
    .sort((a, b) => b - a)
    .join(' / ');
  return `${row.tiers.length} pásma · ${percents} %`;
}

/** Podiel v percentách, nikdy mimo 0–100 a nikdy `NaN`. */
export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (done / total) * 100));
}

export interface QueueProgressInput {
  snapshot: QueueSnapshot | null;
  campaigns: readonly CampaignRow[] | null;
  today?: string;
}

export function queueProgress(input: QueueProgressInput): QueueProgress {
  const today = input.today ?? todayHere();
  const snapshot = input.snapshot;

  const base: QueueProgress = {
    mode: 'unknown',
    done: 0,
    total: 0,
    percent: 0,
    pending: 0,
    campaignId: null,
    campaignName: null,
    sentence: null,
    tiersLabel: null,
    finishDay: null,
    dateFrom: null,
    dateTo: null,
    failed: 0,
    pausedSince: null,
  };

  if (snapshot === null) return base;

  const { queue, current } = snapshot;
  /*
   * `campaigns: null` je „NEVIEME" — zoznam kampaní sa nepodarilo prečítať.
   * `campaigns: []` je „nič tam nie je". Do 24. 8. 2026 z oboch vychádzalo
   * `hasCombination === false`, a s prázdnou frontou teda `mode: 'empty'`:
   * appka na nečitateľnú odpoveď povedala „žiadne zľavy" a používateľ videl
   * pokojnú prázdnu obrazovku namiesto priznania, že nič nevie. To je tá istá
   * rodina chýb, akú Sprint 20 našiel štyrikrát — tvrdiť číslo (alebo tu stav),
   * ktorý appka nezmerala.
   *
   * `mode: 'unknown'` je pritom už hotový a `StatusSection` preň kreslí
   * `UnknownBody`, takže priznanie nič nové nepotrebuje.
   */
  const campaigns = input.campaigns;
  const campaignsKnown = campaigns !== null;
  const hasCampaigns = campaigns !== null && campaigns.length > 0;

  if (queue.total === 0 && !campaignsKnown) return base;
  if (queue.total === 0 && !hasCampaigns) return { ...base, mode: 'empty' };

  // Fronta nemá čo zapisovať — pokojný stav, nie prázdny.
  if (queue.pending === 0 || current === null) {
    return { ...base, mode: 'calm', done: queue.done, total: queue.total };
  }

  // Brána je orientačná, heartbeat je fakt z databázy. Stačí jedno z dvoch:
  // keď scheduler nedáva o sebe vedieť, fronta nezapisuje, nech si brána
  // v tomto module grafe myslí čokoľvek.
  const stopped = snapshot.gate.paused || snapshot.heartbeat.stale;

  const sentence = campaignSentence({
    status: toStatusCode(current.status),
    dateFrom: current.dateFrom === '' ? null : current.dateFrom,
    dateTo: current.dateTo === '' ? null : current.dateTo,
    today,
    itemsWritten: current.itemsOk,
    failedCount: current.itemsFailed,
    paused: stopped,
    budgetExhausted: snapshot.budget !== null && snapshot.budget.exhausted,
    lateCount: current.late ? current.itemsPending : 0,
  });

  const known = (input.campaigns ?? []).find((row) => row.id === current.campaignId) ?? null;

  return {
    mode: stopped ? 'paused' : 'running',
    done: queue.done,
    total: queue.total,
    percent: progressPercent(queue.done, queue.total),
    pending: queue.pending,
    campaignId: current.campaignId,
    campaignName: current.name,
    sentence,
    tiersLabel: known === null ? null : tiersLabel(known),
    finishDay: snapshot.estimate === null ? null : snapshot.estimate.date,
    dateFrom: current.dateFrom === '' ? null : current.dateFrom,
    dateTo: current.dateTo === '' ? null : current.dateTo,
    failed: current.itemsFailed,
    pausedSince: snapshot.gate.since ?? snapshot.heartbeat.lastTickAt,
  };
}

/* ══════════════════════════ 2. Zľavy naživo ═══════════════════════════════ */

/** Poradie stavov v zoznamoch: zapisuje sa → beží → pripravená → skončila. */
const STATE_ORDER: Readonly<Record<string, number>> = {
  'zapisuje sa': 0,
  'beží': 1,
  'pripravená': 2,
  'skončila': 3,
};

export interface LiveCampaign {
  row: CampaignRow;
  sentence: CampaignSentence;
  /** `35 %` alebo `3 pásma` — hlavička hovorí najvyššie percento. */
  percentLabel: string;
  /** Zľava sa práve zapisuje, takže riadok nesie pruh priebehu. */
  writing: boolean;
  percent: number;
}

export function describeCampaign(row: CampaignRow, today: string): LiveCampaign {
  const sentence = campaignSentence({
    status: toStatusCode(row.status),
    dateFrom: row.dateFrom === '' ? null : row.dateFrom,
    dateTo: row.dateTo === '' ? null : row.dateTo,
    today,
    itemsWritten: row.itemsOk,
    failedCount: row.itemsFailed,
    lateCount: row.late ? row.itemsPending : 0,
  });
  const tierCount = row.tiers.length;
  return {
    row,
    sentence,
    percentLabel: tierCount > 1 ? `${tierCount} pásma` : `${row.percent} %`,
    writing: sentence.state === 'zapisuje sa',
    percent: progressPercent(row.itemsTotal - row.itemsPending, row.itemsTotal),
  };
}

/**
 * Zoznam „Zľavy naživo" — tri riadky, hore to, čo sa hýbe. Pri rovnakom stave
 * rozhoduje skorší začiatok okna, takže poradie sa medzi načítaniami nemení.
 */
export function liveCampaigns(
  rows: readonly CampaignRow[],
  today: string,
  limit = 3,
): LiveCampaign[] {
  return rows
    .map((row) => describeCampaign(row, today))
    .sort((a, b) => {
      const byState =
        (STATE_ORDER[a.sentence.state] ?? 9) - (STATE_ORDER[b.sentence.state] ?? 9);
      if (byState !== 0) return byState;
      if (a.row.dateFrom !== b.row.dateFrom) return a.row.dateFrom < b.row.dateFrom ? -1 : 1;
      return a.row.id - b.row.id;
    })
    .slice(0, limit);
}

/* ═════════════════════════ 3. Čísla pokojného stavu ═══════════════════════ */

export interface CalmNumbers {
  /** Zliav s otvoreným oknom — zákazníci ich práve vidia. */
  live: number;
  /** Zostavených, do fronty ešte nešli. */
  ready: number;
  /** Zlacnených produktov podľa VLASTNÝCH zápisov, nie podľa stavu eshopu. */
  discounted: number;
}

export function calmNumbers(rows: readonly CampaignRow[], today: string): CalmNumbers {
  let live = 0;
  let ready = 0;
  let discounted = 0;
  for (const row of rows) {
    const state = describeCampaign(row, today).sentence.state;
    if (state === 'beží') {
      live += 1;
      discounted += row.itemsOk;
    } else if (state === 'pripravená') {
      ready += 1;
    }
  }
  return { live, ready, discounted };
}
