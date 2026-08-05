/**
 * Aura Zľavy — start schedulera (D82, §9).
 *
 * STUB od A0. Vlastníctvo tohto súboru PREBERÁ A10, ktorý sem zapojí
 * `tick.ts` (60 s cyklus, in-process, stav v DB). Do tej doby je to no-op,
 * aby `instrumentation.ts` mal stabilný kontrakt.
 *
 * Kontrakt, ktorý A10 musí dodržať:
 *  - `startScheduler()` je idempotentný (druhé zavolanie nesmie spustiť druhý tick),
 *  - `SCHEDULER_ENABLED=false` scheduler úplne vypne (testy, dev),
 *  - výnimka v ticku NESMIE zhodiť proces — zapíše sa do
 *    `scheduler_state.last_error` (D87),
 *  - poradie krokov ticku je normatívne (§9): heartbeat -> TTL wipe -> reconcile
 *    pri prvom ticku -> missed -> due/claim -> reminders -> heartbeat.
 */
import { env } from '@/env';

let running = false;

export function startScheduler(): void {
  if (running) return;
  if (!env.SCHEDULER_ENABLED) {
    console.log(
      JSON.stringify({ level: 'info', msg: 'scheduler_disabled', ts: new Date().toISOString() }),
    );
    return;
  }
  running = true;
  // STUB (A10 prevezme): tu sa naplánuje `setInterval(tick, env.SCHEDULER_TICK_MS)`.
  console.log(
    JSON.stringify({
      level: 'warn',
      msg: 'scheduler_stub_started',
      detail: 'A0 stub — tick ešte nie je implementovaný (A10)',
      tickMs: env.SCHEDULER_TICK_MS,
      ts: new Date().toISOString(),
    }),
  );
}

export function stopScheduler(): void {
  running = false;
}

export function isSchedulerRunning(): boolean {
  return running;
}
