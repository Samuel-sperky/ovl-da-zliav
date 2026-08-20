/**
 * Aura Zľavy — brána fronty po odstávke počítača (odpoveď 43, KONTRAKT V3 K2).
 *
 * Appka beží na PRACOVNOM POČÍTAČI, ktorý sa vypína. Fronta zápisov do
 * PRODUKČNÉHO shopu sa preto po odstávke **NEROZBEHNE SAMA** — čaká na
 * potvrdenie („Pokračovať" v Prehľade, `design/v3/prehlad-pozastavene.html`).
 * Je to ten istý fail-closed princíp ako `missed` pri zmeškanom fire (D33b),
 * len pre frontu: appka po prebudení nevie, čo sa medzitým v shope stalo, a
 * nikdy nezačne zapisovať bez toho, aby jej to niekto povedal.
 *
 * Ako sa odstávka rozpozná: PRI PRVOM TICKU po štarte procesu sa prečíta
 * `scheduler_state.last_tick_at` (heartbeat predchádzajúceho behu) ešte PRED
 * tým, než tento tick zapíše svoj vlastný heartbeat. Diera väčšia než
 * `DOWNTIME_GRACE_MS` = odstávka.
 *
 * Čo tu ZÁMERNE nie je:
 *  - **žiadny automatický resume po čase.** Bránu otvára výhradne človek
 *    (`resumeQueue()` z route „Pokračovať"). Nijaká konštanta typu
 *    `AUTO_RESUME_AFTER` v tomto module nesmie vzniknúť — bola by to tá istá
 *    chyba, akú D33b zakazuje pre `missed`.
 *  - **žiadny zápis do DB.** Brána je in-process stav. Trvalá by musela byť
 *    stĺpcom v `settings`/`scheduler_state`, a to je cudzia migrácia (V1).
 *    Nie je to diera: rozhodnutie sa po každom štarte prepočíta z heartbeatu,
 *    takže po skutočnej odstávke je brána zatvorená vždy — aj keď proces
 *    medzitým spadol. Nezachytí len restart KRATŠÍ než `DOWNTIME_GRACE_MS`,
 *    čo podľa definície nie je odstávka.
 *
 * Vlastník: V7.
 */
import type { UtcDate } from '@/contracts';

/**
 * Ako dlho smie chýbať heartbeat, aby to ešte nebola odstávka. Scheduler tiká
 * každých 60 s (`SCHEDULER_TICK_MS`), takže 15 minút je s rezervou nad bežným
 * restartom appky, upgradom podľa D100 aj nad dlhým tickom, počas ktorého
 * fronta zapisovala (200 zápisov × 3 s ≈ 10 min).
 */
export const DOWNTIME_GRACE_MS = 15 * 60 * 1000;

/**
 * Prečo je brána zatvorená.
 *  - `pc_downtime` — diera v heartbeate, teda vypnutý počítač (odpoveď 43),
 *  - `state_unreadable` — heartbeat sa NEDAL prečítať, takže nevieme, či bola
 *    odstávka. „Neviem" znamená nezapisovať, nie pokračovať,
 *  - `manual` — človek frontu zastavil (odpoveď 45).
 */
export type QueuePauseReason = 'pc_downtime' | 'state_unreadable' | 'manual';

export interface QueueGate {
  /** `true` = fronta nezapisuje a čaká na potvrdenie. */
  paused: boolean;
  reason: QueuePauseReason | null;
  /** Kedy sa brána zatvorila (pri odstávke = čas posledného heartbeatu). */
  since: UtcDate | null;
  /**
   * Ako dlho bola appka mimo (ms). `null` pri ručnom zastavení a pri prvom
   * štarte na čistej DB. UI z toho vie povedať „zastavené 9. 8. 21:04".
   */
  downtimeMs: number | null;
}

const OPEN: QueueGate = { paused: false, reason: null, since: null, downtimeMs: null };

let gate: QueueGate = { ...OPEN };
/** Odstávka sa vyhodnocuje RAZ za život procesu — pri prvom ticku. */
let downtimeAssessed = false;

/**
 * Čistá časť rozhodnutia: bola medzi posledným heartbeatom a teraz odstávka?
 *
 * `lastTickAt === null` znamená, že heartbeat ešte nikdy nebežal (čistá DB,
 * prvý štart). Vtedy niet čo prerušiť — fronta je prázdna a brána zostáva
 * otvorená. Heartbeat z BUDÚCNOSTI (posun hodín dozadu) sa počíta ako nulová
 * diera, nie ako záporná: čas sa nedá dôverovať, ale zastaviť frontu kvôli
 * prestavenému systémovému času by bolo horšie než pokračovať.
 */
export function assessDowntime(
  lastTickAt: UtcDate | null,
  now: UtcDate,
  graceMs: number = DOWNTIME_GRACE_MS,
): { downtime: boolean; downtimeMs: number } {
  if (lastTickAt === null) return { downtime: false, downtimeMs: 0 };
  const gap = Math.max(0, now.getTime() - lastTickAt.getTime());
  return { downtime: gap > graceMs, downtimeMs: gap };
}

/**
 * Zatvorí bránu, keď od posledného heartbeatu prešlo viac než `graceMs`.
 * Vyhodnocuje sa VÝHRADNE raz za život procesu (prvý tick) — po tomto ticku už
 * heartbeat beží každú minútu a diera by nikdy nevznikla.
 *
 * @returns `true` keď tento krok bránu práve zatvoril.
 */
export function assessDowntimeOnce(
  lastTickAt: UtcDate | null,
  now: UtcDate,
  graceMs: number = DOWNTIME_GRACE_MS,
): boolean {
  if (downtimeAssessed) return false;
  downtimeAssessed = true;

  const { downtime, downtimeMs } = assessDowntime(lastTickAt, now, graceMs);
  if (!downtime) return false;

  gate = {
    paused: true,
    reason: 'pc_downtime',
    // `since` je čas, kedy appka naposledy žila — to je „Zastavené" v UI.
    since: lastTickAt,
    downtimeMs,
  };
  return true;
}

/**
 * Heartbeat sa nedal prečítať — o odstávke NIČ nevieme. Fail-closed: brána sa
 * zatvorí a čaká na človeka, rovnako ako po skutočnej odstávke. Vyhodnocuje sa
 * tiež raz za život procesu, aby rozbitá DB nezatvárala bránu opakovane po
 * tom, čo ju používateľ otvoril.
 *
 * @returns `true` keď tento krok bránu práve zatvoril.
 */
export function assessDowntimeUnknown(at: UtcDate): boolean {
  if (downtimeAssessed) return false;
  downtimeAssessed = true;
  gate = { paused: true, reason: 'state_unreadable', since: at, downtimeMs: null };
  return true;
}

/** Ručné zastavenie fronty (odpoveď 45: „zastaviť frontu, zapísané dobehnú"). */
export function pauseQueue(reason: QueuePauseReason = 'manual', at: UtcDate = new Date()): void {
  gate = { paused: true, reason, since: at, downtimeMs: null };
}

/**
 * Potvrdenie „Pokračovať". Jediná cesta, ktorá bránu otvára — volá ju človek
 * z UI, nikdy nie tick.
 */
export function resumeQueue(): void {
  gate = { ...OPEN };
}

export function isQueuePaused(): boolean {
  return gate.paused;
}

export function getQueueGate(): QueueGate {
  return { ...gate };
}

/** Výhradne pre testy — vráti modul do stavu „čerstvý proces". */
export function resetQueueGate(): void {
  gate = { ...OPEN };
  downtimeAssessed = false;
}
