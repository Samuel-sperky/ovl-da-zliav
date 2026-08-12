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
 *
 * DENNÝ ROZPOČET ČÍTANÍ (A4) SA ZAPÁJA TU
 * ---------------------------------------
 * `syncSales()` si zdieľané počítadlo nikdy nezaobstaráva samo (rovnako ako si
 * nezaobstaráva kľúč) — dostane ho odtiaľto. Vďaka tomu je jediná cesta, ktorou
 * sa predajnosť opakovane spúšťa, aj jediné miesto, kde sa nedá zabudnúť na
 * strop shopu; testy modulu si podsúvajú vlastné počítadlo a k DB nesiahnu.
 *
 * Rozpočet je TRVALÝ (tabuľka `shop_read_budget`), takže prežije reštart appky.
 * Runner z toho ťaží pri plánovaní: keď beh skončí na minutom rozpočte, ďalší
 * pokus sa neodkladá o 20 hodín, ale na čas, keď sa strop obnoví (polnoc UTC).
 */
import type { UtcDate } from '@/contracts';

import { env } from '@/env';

import { syncSales, type SalesSyncResult } from '@/lib/engine/sales-sync';
import { logger } from '@/lib/log/logger';
import { ordersKeyRepo } from '@/lib/repo/api-key.repo';
import { ordersReadBudget } from '@/lib/repo/read-budget.repo';
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

/**
 * Najmenší odstup po behu, ktorý sa zastavil na minutom dennom rozpočte (A4).
 *
 * Prečo nie hneď a prečo nie celý interval: strop sa obnoví o polnoci UTC, takže
 * skutočný čas pokračovania diktuje `sync.resumeAt` a toto je len podlaha, aby
 * sa runner nezacyklil na každom ticku, keby počítadlo hlásilo obnovu v minulosti
 * (napr. po preskočení systémového času). Rovnaká rola ako `CATALOG_RESUME_MS`.
 */
export const SALES_RESUME_MS = 60 * 1000;

export type SalesRunOutcome =
  | 'disabled'
  | 'too_soon'
  | 'already_running'
  | 'no_orders_key'
  | 'ran'
  /** Denný rozpočet čítaní je minutý — beh sa nekonal a nie je to chyba (A4). */
  | 'budget_exhausted'
  | 'failed';

export interface SalesRunReport {
  outcome: SalesRunOutcome;
  sync: SalesSyncResult | null;
  /** Kedy sa oplatí skúsiť znova. `null` = nevieme / pri ďalšom vhodnom ticku. */
  resumeAt?: UtcDate | null;
}

let running = false;
/**
 * Najbližší čas (epoch ms), kedy sa smie znova skúsiť. `0` = hneď. Držíme
 * PRIAMO ten čas, nie čas posledného behu: odstup po úspešnom behu a odstup po
 * „bez kľúča" sú rôzne a jedna premenná „naposledy" ich nedokáže odlíšiť.
 */
let nextAllowedMs = 0;
/**
 * Posledné rozhodnutie, ktoré NIEČO znamenalo — beh, minutý rozpočet, chýbajúci
 * kľúč alebo pád. Tlmené ticky (`too_soon`, `already_running`) sa doň zámerne
 * nezapisujú: prepísali by dôvod, ktorý má appka ukázať používateľovi.
 */
let lastReport: SalesRunReport | null = null;

/**
 * Ako dopadol posledný pokus o synchronizáciu predajnosti. Pre UI a stav appky
 * (C1/C2) — bez neho sa „prečo nie sú čerstvé predaje" dá zistiť iba z logov.
 */
export function lastSalesRun(): SalesRunReport | null {
  return lastReport === null ? null : { ...lastReport };
}

/** Iba pre testy — vynuluje pamäť medzi behmi. */
export function resetSalesRunnerState(): void {
  running = false;
  nextAllowedMs = 0;
  lastReport = null;
}

/**
 * Kedy sa smie skúsiť ďalší beh.
 *
 * Minutý denný rozpočet nie je chyba, je to „pokračujem po polnoci UTC" (A4) —
 * a plný 20-hodinový odstup by okno nechal nedopočítané ešte dlho po tom, čo sa
 * strop obnovil. Preto sa v tom jedinom prípade čaká na `resumeAt`, nie na
 * interval podľa P3.
 */
function nextAllowedAfter(nowMs: number, sync: SalesSyncResult): number {
  if (sync.resumeAt !== null) {
    return Math.max(nowMs + SALES_RESUME_MS, sync.resumeAt.getTime());
  }
  return nowMs + SALES_MIN_INTERVAL_MS;
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
      lastReport = { outcome: 'no_orders_key', sync: null, resumeAt: null };
      return { ...lastReport };
    }

    const sync = await syncSales({
      ordersClient: createOrdersClientFromSettings(settingsRepo),
      key,
      // A4 — jedna zdieľaná inštancia počítadla dráhy `orders`. Vlastné
      // počítadlo si tu nikto nezakladá; katalóg má svoje na dráhe `anon`
      // a stropy shopu sú pre obe dráhy iné.
      budget: { reserveShopReads: (count = 1) => ordersReadBudget.reserve(count) },
      salesRepo,
      logger: log,
    });
    nextAllowedMs = nextAllowedAfter(nowMs, sync);
    log.info('sales_sync_done', {
      outcome: sync.outcome,
      windowFrom: sync.windowFrom,
      windowTo: sync.windowTo,
      requestsUsed: sync.requestsUsed,
      readsUsed: sync.readsUsed,
      capReached: sync.capReached,
      stoppedBy: sync.stoppedBy,
      resumeAt: sync.resumeAt?.toISOString(),
      error: sync.error ?? undefined,
    });
    // `paused` = rozpočet došiel a beh nič nezapísal. Pre appku je to iný stav
    // než „prebehlo": nemá zmysel tváriť sa, že predaje sú dopočítané.
    lastReport = {
      outcome: sync.outcome === 'paused' ? 'budget_exhausted' : 'ran',
      sync,
      resumeAt: sync.resumeAt,
    };
    return { ...lastReport };
  } catch (error) {
    // Poistka poslednej inštancie. `syncSales` výnimky neprepúšťa (P6), takže
    // sem by sa nemalo dať dostať — a keď áno, nesmie to nič zhodiť.
    nextAllowedMs = nowMs + SALES_MIN_INTERVAL_MS;
    log.error('sales_sync_fatal_caught', {
      error: error instanceof Error ? error.message : String(error),
    });
    lastReport = { outcome: 'failed', sync: null, resumeAt: null };
    return { ...lastReport };
  } finally {
    running = false;
  }
}
