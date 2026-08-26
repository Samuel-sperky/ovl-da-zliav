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
import { campaignSentence, toStatusCode, todayHere } from '@/lib/ui/vocabulary';

/* ═════════════════════════ 0. Kód stavu zo servera ════════════════════════ */

/**
 * Kód stavu z API → kód, ktorý slovník pozná.
 *
 * TENTO MODUL UŽ PREVOD NEROBÍ, LEN HO PODÁVA ĎALEJ. Funkcia sa presťahovala do
 * `lib/ui/vocabulary.ts`, vedľa zoznamu `CAMPAIGN_STATUS_CODES`, podľa ktorého
 * sa rozhoduje: prevod patrí k slovníku, nie k jednej obrazovke. Dovtedy si ju
 * zoznam zliav (`campaigns/discounts-model.ts`) importoval odtiaľto — krížny
 * import medzi dvomi obrazovkami len preto, aby nevznikla druhá kópia.
 *
 * Re-export je DOČASNÝ most pre miesta, ktoré ešte ukazujú sem. Nové miesta
 * majú siahať rovno po `@/lib/ui/vocabulary` a k volaniu prevodu už nemajú dôvod
 * vôbec: `campaignSentence()` si neznámy kód ošetrí sám a navyše ho PRIZNÁ.
 */
export { toStatusCode };

/* ═══════════════════════ 1. Stav dominantnej sekcie ═══════════════════════ */

/**
 * Päť stavov dominanty, presne podľa predlôh:
 *
 *  - `unknown`  — appka neodpovedala; nič sa netvrdí (`prazdne-stavy.html`),
 *  - `empty`    — ešte nie je žiadna zľava (`prazdne-stavy.html`),
 *  - `calm`     — nič sa práve nezapisuje (`prehlad-pokoj.html`),
 *  - `paused`   — fronta stojí po odstávke počítača (`prehlad-pozastavene.html`),
 *  - `running`  — fronta zapisuje, číslo v 64 px (`prehlad.html`).
 *
 * `calm` NIE JE „všetko je v poriadku". Znamená len, že sa v tejto chvíli
 * nezapisuje, a to má dva dôvody: fronta nemá čo zapisovať, alebo má a nikto to
 * nezapisuje. Ten druhý je STOJACA fronta a hovorí o ňom `stalled`; verdikt
 * (`overview-verdict.ts`) sa ho pýta skôr, než vysloví „Všetko v poriadku".
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
  /**
   * Stojí fronta na človeku? `null` je „nevieme" a je prísnejšie než `false`.
   *
   * Otázka má zmysel len pri `mode: 'calm'` — inak je odpoveď v samom stave
   * (`running` zapisuje, `paused` stojí, `empty` nemá čo zapisovať). Rozhoduje
   * o nej `queueStalled()`.
   */
  stalled: boolean | null;
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

/**
 * Stavy zľavy, ktorých položky sa počítajú do fronty.
 *
 * Musí to byť TEN ISTÝ zoznam ako v `SQL_QUEUE_TOTALS`
 * (`lib/repo/campaign-items.repo.ts`) — inak by obrazovka vysvetľovala inú
 * frontu, než akú server spočítal.
 */
const QUEUE_STATUSES: readonly CampaignStatusCode[] = [
  'scheduled',
  'needs_key',
  'running',
  'missed',
  'queued',
];

/**
 * Zľavy, ktoré sa samy nerozhýbu — čakajú na ČLOVEKA, nie na krok fronty.
 * `needs_key` a `missed` majú rovnakú váhu (D8/D33b) a rovnako ich už triedi
 * `findNeedsIntervention()` v `lib/ai/rules.ts`.
 */
const NEEDS_HUMAN: readonly CampaignStatusCode[] = ['needs_key', 'missed'];

/**
 * Stojí fronta na človeku? Odpoveď má tri hodnoty a `null` znamená „nevieme".
 *
 * Otázka sa kladie LEN vtedy, keď fronta má čo zapisovať (`queue.pending > 0`)
 * a server pritom nevrátil žiadnu kampaň v behu. `current` hľadá server priamo
 * medzi `running` a `queued` (`app/api/queue/route.ts`), takže čakajúce položky
 * v tej chvíli patria zľavám v stave `scheduled`, `needs_key` alebo `missed` —
 * a celý rozdiel je v tom, na čo čakajú:
 *
 *  - `needs_key` a `missed` čakajú na ČLOVEKA (D8/D33b) → fronta stojí,
 *  - `late` znamená, že okno už beží a položky sú stále nezapísané → stojí,
 *  - `scheduled` s oknom v budúcnosti čaká na svoj deň → nestojí.
 *
 * Keď v zozname nie je ani jedna zľava, ktorá by čakajúce položky mohla
 * vysvetliť (nečitateľný zoznam, alebo prvá strana 50 zliav, na ktorú sa
 * nezmestila), je odpoveď `null`. „Nevieme" je prísnejšie než „v poriadku" (P7)
 * a appka nesmie z chýbajúceho riadku vyrobiť dobrú správu.
 */
export function queueStalled(campaigns: readonly CampaignRow[] | null): boolean | null {
  if (campaigns === null) return null;
  const inQueue = campaigns.filter((row) => QUEUE_STATUSES.includes(toStatusCode(row.status)));
  if (inQueue.length === 0) return null;
  return inQueue.some((row) => NEEDS_HUMAN.includes(toStatusCode(row.status)) || row.late);
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
    // Bez odpovede appky sa o stojacej fronte netvrdí nič — ani to, že nestojí.
    stalled: null,
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
  // Prázdny stav nemá čo zapisovať, takže ani na čom stáť.
  if (queue.total === 0 && !hasCampaigns) return { ...base, mode: 'empty', stalled: false };

  // Fronta nemá čo zapisovať — pokojný stav, nie prázdny.
  if (queue.pending === 0) {
    return { ...base, mode: 'calm', stalled: false, done: queue.done, total: queue.total };
  }

  /*
   * Položky čakajú, ale server nemá čo zapisovať.
   *
   * `current` je LEN `running` alebo `queued` kampaň (`app/api/queue/route.ts`),
   * kým `queue.pending` počíta aj `scheduled`, `needs_key` a `missed`
   * (`lib/repo/campaign-items.repo.ts`). Do 26. 8. 2026 sa z tejto dvojice
   * vracal pokojný stav s `pending: 0` — appka teda zahodila jediné číslo,
   * ktorým sa stojaca fronta dá dokázať, a verdikt potom povedal „Všetko
   * v poriadku", kým tisíce položiek stáli (a zľava v `needs_key` je pritom
   * očakávaný stav). Číslo tu preto zostáva a otázku „stojí to na človeku?"
   * dostane verdikt zodpovedanú.
   */
  if (current === null) {
    return {
      ...base,
      mode: 'calm',
      stalled: queueStalled(campaigns),
      done: queue.done,
      total: queue.total,
      pending: queue.pending,
    };
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
    // Kampaň v behu je: o stojacej fronte tu rozhoduje `mode`, nie `stalled`.
    stalled: false,
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
