/**
 * Aura Zľavy — spúšťač synchronizácie predajov
 * (KONTRAKT-PREDAJNOST-2026-08-06, rozhodnutia P3, P6).
 *
 * Prečo samostatný modul a nie priamo v `scheduler/boot.ts`: invariant I8' bod 4
 * hovorí, že ZÁPISOVÁ cesta (engine, scheduler) sa o objednávkový kľúč nesmie
 * ani obtrieť — a test to vynucuje skenom zdrojov. Objednávkový kľúč preto žije
 * výhradne tu; scheduler vidí jednu nepriehľadnú funkciu `runSalesSyncIfDue()`,
 * ktorá mu nič o kľúči neprezradí. Oddelenie nie je kozmetické: vďaka nemu sa
 * kľúč na čítanie nikdy nemôže omylom dostať do volania `setReduction`.
 *
 * Modul NIKDY nehádže — predaje sú analytika a nesmú zhodiť ani zdržať zľavy.
 */
import { env } from '@/env';

import { syncSales, type SalesSyncResult } from '@/lib/engine/sales-sync';
import { logger } from '@/lib/log/logger';
import { ordersKeyRepo } from '@/lib/repo/api-key.repo';
import { salesRepo } from '@/lib/repo/sales.repo';
import { settingsRepo } from '@/lib/repo/settings.repo';
import { createOrdersClientFromSettings } from '@/lib/shop/orders-client';

const log = logger.child({ module: 'sales-sync' });

/**
 * Najmenší odstup medzi dvoma synchronizáciami.
 *
 * Prečo interval a nie „o polnoci", ako píše kontrakt P3: appka beží na
 * PRACOVNOM POČÍTAČI, ktorý býva v noci vypnutý — nočné okno by znamenalo, že
 * synchronizácia neprebehne nikdy. Spustí sa teda pri prvom vhodnom ticku a
 * potom najskôr o 20 hodín. Kampane majú pevný čas spúšťania ďalej (D82); toto
 * sa týka VÝHRADNE čítania predajov. Odchýlka je reverzibilná.
 */
export const SALES_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

export type SalesRunOutcome =
  | 'disabled'
  | 'too_soon'
  | 'already_running'
  | 'no_orders_key'
  | 'ran'
  | 'failed';

export interface SalesRunReport {
  outcome: SalesRunOutcome;
  sync: SalesSyncResult | null;
}

let running = false;
let lastRunMs = 0;

/** Iba pre testy — vynuluje pamäť medzi behmi. */
export function resetSalesRunnerState(): void {
  running = false;
  lastRunMs = 0;
}

/**
 * Spustí synchronizáciu, ak je na čase. Vracia dôvod rozhodnutia, aby sa dalo
 * testovať a logovať, čo sa naozaj stalo — nie len „prebehlo/neprebehlo".
 */
export async function runSalesSyncIfDue(
  nowMs: number = Date.now(),
): Promise<SalesRunReport> {
  if (!env.SALES_SYNC_ENABLED) return { outcome: 'disabled', sync: null };
  if (running) return { outcome: 'already_running', sync: null };
  if (lastRunMs !== 0 && nowMs - lastRunMs < SALES_MIN_INTERVAL_MS) {
    return { outcome: 'too_soon', sync: null };
  }

  running = true;
  try {
    // Bez kľúča sa nesynchronizuje — a nie je to chyba, len stav „kľúč ešte
    // nie je vložený" (alebo mu vypršala platnosť a repozitár ho zmazal).
    const key = await ordersKeyRepo.loadForUse();
    if (!key) {
      lastRunMs = nowMs; // neskúšaj to každú minútu
      log.info('sales_sync_skipped', { reason: 'no_orders_key' });
      return { outcome: 'no_orders_key', sync: null };
    }

    const sync = await syncSales({
      ordersClient: createOrdersClientFromSettings(settingsRepo),
      key,
      salesRepo,
      logger: log,
    });
    lastRunMs = Date.now();
    log.info('sales_sync_done', {
      outcome: sync.outcome,
      windowFrom: sync.windowFrom,
      windowTo: sync.windowTo,
      requestsUsed: sync.requestsUsed,
      capReached: sync.capReached,
      error: sync.error ?? undefined,
    });
    return { outcome: 'ran', sync };
  } catch (error) {
    // Poistka poslednej inštancie. `syncSales` výnimky neprepúšťa (P6), takže
    // sem by sa nemalo dať dostať — a keď áno, nesmie to nič zhodiť.
    lastRunMs = Date.now();
    log.error('sales_sync_fatal_caught', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { outcome: 'failed', sync: null };
  } finally {
    running = false;
  }
}
