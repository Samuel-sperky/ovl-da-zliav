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
 *
 * TRVALÁ PREKÁŽKA NEDOSTANE ROZVRH (od 24. 8. 2026)
 * -------------------------------------------------
 * Do 24. 8. 2026 tu bolo pre všetko okrem minutého rozpočtu jediné pravidlo:
 * skús o 20 hodín. Pri 403 z objednávkovej cesty to znamenalo, že appka rovnakú
 * odmietnutú požiadavku posielala deň za dňom — `sales_sync_state` má o tom
 * dvanásť riadkov (7. 8. – 18. 8. 2026) a od 19. 8. shop na tú istú cestu
 * odpovedá kódom `ip_banned`.
 *
 * Runner sa preto pred behom pýta DB, či synchronizácia nestojí na trvalej
 * prekážke (`lib/sales/insights.ts` → `lib/sales/stop-policy.ts`). Prečo z DB
 * a nie z pamäte: appka beží na pracovnom počítači, ktorý sa vypína, takže
 * pamäťová značka by po každom štarte zmizla a opakovanie by sa vrátilo.
 *
 * Dva stupne:
 *   · `permission` (401/403) — na rozvrhu sa NESKÚŠA. Prekážka padá vtedy, keď
 *     človek vloží objednávkový kľúč znova (`ApiKeyMeta.savedAt`).
 *   · `ip_ban` — appka sa ozve JEDNOU požiadavkou, prvýkrát po šiestich
 *     hodinách a potom s rastúcim odstupom až po týždeň (`stop-policy.ts`).
 */
import type { UtcDate } from '@/contracts';

import { env } from '@/env';

import {
  salesSyncFlagsFromEnv,
  syncSales,
  type SalesSyncFlags,
  type SalesSyncResult,
} from '@/lib/engine/sales-sync';
import { logger } from '@/lib/log/logger';
import { ordersKeyRepo } from '@/lib/repo/api-key.repo';
import { ordersReadBudget } from '@/lib/repo/read-budget.repo';
import { salesRepo } from '@/lib/repo/sales.repo';
import { settingsRepo } from '@/lib/repo/settings.repo';
import { latestSyncStop } from '@/lib/sales/insights';
import { classifySalesStop, decideSalesBlock, type SalesBlock } from '@/lib/sales/stop-policy';
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

/**
 * Ako často sa počas trvalej prekážky POZERÁ do DB (nie do shopu).
 *
 * Je to jediná práca, ktorú appka v tomto stave robí: dva `SELECT`-y, žiadny
 * request. Odstup je krátky zámerne — človek, ktorý práve vložil nový
 * objednávkový kľúč, nemá čakať do zajtra, kým si to appka všimne. Rovnaká
 * úvaha ako pri `SALES_NO_KEY_RETRY_MS`.
 */
export const SALES_BLOCK_RECHECK_MS = 5 * 60 * 1000;

export type SalesRunOutcome =
  | 'disabled'
  | 'too_soon'
  | 'already_running'
  | 'no_orders_key'
  | 'ran'
  /** Denný rozpočet čítaní je minutý — beh sa nekonal a nie je to chyba (A4). */
  | 'budget_exhausted'
  /** Shop čítanie objednávok odmieta (401/403, zablokovaná IP) — nekonal sa beh. */
  | 'blocked'
  | 'failed';

export interface SalesRunReport {
  outcome: SalesRunOutcome;
  sync: SalesSyncResult | null;
  /** Kedy sa oplatí skúsiť znova. `null` = nevieme / pri ďalšom vhodnom ticku. */
  resumeAt?: UtcDate | null;
  /**
   * Trvalá prekážka aj s vetami pre povrch. `null` = nič netrvá. Toto je jediné
   * miesto, z ktorého sa appka o odmietnutom čítaní objednávok dozvie bez logu.
   */
  block?: SalesBlock | null;
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
 * Nastavenia OVEROVACEJ požiadavky po zablokovanej IP.
 *
 * Jeden deň a jeden request — nie preto, že by sa viac nezmestilo, ale preto,
 * že sa appka pýta jedinú otázku: „pustíš ma?". Bežný beh by sa síce na prvej
 * chybe zastavil tiež, ale keby blokáda medzitým skončila a shop odpovedal,
 * rozbehol by celé okno v okamihu, keď o svojom stave ešte nič nevie.
 */
function probeFlags(): SalesSyncFlags {
  return { ...salesSyncFlagsFromEnv(), windowDays: 1, maxRequestsPerRun: 1 };
}

/**
 * Stojí synchronizácia na trvalej prekážke? Číta sa DB, nie pamäť — dôvod je
 * v hlavičke modulu.
 */
async function readBlock(): Promise<SalesBlock | null> {
  const [stop, meta] = await Promise.all([latestSyncStop(), ordersKeyRepo.getMeta()]);
  return decideSalesBlock(stop, { keySavedAt: meta.savedAt });
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

    // Trvalá prekážka sa vyhodnocuje PRED behom a z DB, takže ju neprežije ani
    // reštart appky. Bez tejto vetvy sa 403 opakuje na rozvrhu donekonečna.
    const standing = await readBlock();
    let probing = false;
    if (standing !== null) {
      const probeAtMs = standing.probeAt?.getTime() ?? null;
      if (probeAtMs === null || nowMs < probeAtMs) {
        nextAllowedMs =
          probeAtMs === null
            ? nowMs + SALES_BLOCK_RECHECK_MS
            : Math.max(nowMs + SALES_BLOCK_RECHECK_MS, probeAtMs);
        log.warn('sales_sync_blocked', {
          block: standing.kind,
          errorCode: standing.code,
          since: standing.since.toISOString(),
          probeAt: standing.probeAt?.toISOString(),
        });
        lastReport = {
          outcome: 'blocked',
          sync: null,
          resumeAt: standing.probeAt,
          block: standing,
        };
        return { ...lastReport };
      }
      // Čas overovacej požiadavky nastal. Nie je to bežný beh: jeden deň,
      // jeden request (viď `probeFlags()`).
      probing = true;
      log.info('sales_sync_probe', { block: standing.kind, since: standing.since.toISOString() });
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
      ...(probing ? { flags: probeFlags() } : {}),
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
    // Beh skončil na trvalej prekážke. Ďalší termín sa TU nepočíta: prekážku
    // práve zapísal `sales_sync_state` a ten je zdroj pravdy aj po reštarte —
    // o pár minút si ju runner prečíta a odstup určí `stop-policy.ts`. Keby sa
    // termín počítal aj tu, existovali by dve pravidlá pre to isté a rozišli by
    // sa presne vtedy, keď na tom záleží.
    if (classifySalesStop(sync.error) !== null) {
      nextAllowedMs = nowMs + SALES_BLOCK_RECHECK_MS;
      lastReport = {
        outcome: 'blocked',
        sync,
        resumeAt: null,
        block: await readBlock(),
      };
      return { ...lastReport };
    }

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
