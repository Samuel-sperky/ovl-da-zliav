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

/**
 * Odstup po ticku, ktorý sa nič nesynchronizoval, pretože OBJEDNÁVKOVÝ KĽÚČ
 * ešte nie je vložený (alebo mu vypršala platnosť).
 *
 * Prečo vlastná, krátka hodnota: „bez kľúča" nie je vykonaná práca, len zistenie
 * stavu. Keby sa naň nasadil plný 20-hodinový odstup (a presne to sa tu pôvodne
 * robilo), platilo by toto: appka nabootuje bez kľúča, používateľ o pár minút
 * kľúč v UI vloží — a synchronizácia sa nerozbehne až do zajtra alebo do
 * restartu. Karta Predajnosť by celý ten čas pravdivo, ale zbytočne hlásila
 * „zatiaľ bez dát". Zároveň to nesmie byť „každý tick": hľadanie kľúča je dotaz
 * do DB a scheduler tiká každú minútu.
 */
export const SALES_NO_KEY_RETRY_MS = 5 * 60 * 1000;

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
/**
 * Najbližší čas (epoch ms), kedy sa smie znova skúsiť. `0` = hneď. Držíme
 * PRIAMO ten čas, nie čas posledného behu: odstup po úspešnom behu a odstup po
 * „bez kľúča" sú rôzne a jedna premenná „naposledy" ich nedokáže odlíšiť.
 */
let nextAllowedMs = 0;

/** Iba pre testy — vynuluje pamäť medzi behmi. */
export function resetSalesRunnerState(): void {
  running = false;
  nextAllowedMs = 0;
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
  if (nowMs < nextAllowedMs) return { outcome: 'too_soon', sync: null };

  running = true;
  try {
    // Bez kľúča sa nesynchronizuje — a nie je to chyba, len stav „kľúč ešte
    // nie je vložený" (alebo mu vypršala platnosť a repozitár ho zmazal).
    const key = await ordersKeyRepo.loadForUse();
    if (!key) {
      // Krátky odstup, nie celý interval — kľúč môže pribudnúť za pár minút.
      nextAllowedMs = nowMs + SALES_NO_KEY_RETRY_MS;
      log.info('sales_sync_skipped', { reason: 'no_orders_key' });
      return { outcome: 'no_orders_key', sync: null };
    }

    const sync = await syncSales({
      ordersClient: createOrdersClientFromSettings(settingsRepo),
      key,
      salesRepo,
      logger: log,
    });
    nextAllowedMs = nowMs + SALES_MIN_INTERVAL_MS;
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
    nextAllowedMs = nowMs + SALES_MIN_INTERVAL_MS;
    log.error('sales_sync_fatal_caught', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { outcome: 'failed', sync: null };
  } finally {
    running = false;
  }
}
