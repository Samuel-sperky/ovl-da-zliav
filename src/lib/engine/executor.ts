/**
 * Aura Zľavy — SEKVENČNÝ EXECUTOR ZÁPISOVEJ DÁVKY (BUILD-SPEC §9).
 *
 * Toto je JEDINÉ miesto v celej appke, ktoré volá `setReduction`. Route-y aj
 * scheduler zapisujú výhradne cez `executeCampaign()`.
 *
 * Poradie krokov (normatívne, §9):
 *   mutex (D37, I12) → guardy (I2/I9/I12/I13, D79) → potvrdenie (I3) → kľúč
 *   → per položka: runaway (D79) → denný rozpočet (K2) → pre-write GET (D48)
 *   → D36 skip → audit `write_attempt` → `setReduction` → vyhodnotenie
 *   → pauza ≥ 3 s (K2, D46, I10).
 *
 * Čo sa mení s KONTRAKTOM V3:
 *   - **K2 (fronta)** — zápis nie je akcia, je to fronta, ktorá beží týždne.
 *     Pred KAŽDOU položkou sa kontroluje denný rozpočet; pri vyčerpaní kampaň
 *     prejde do `queued`, zvyšné položky zostanú `pending` a druhý deň sa
 *     pokračuje presne tam, kde sa skončilo. `queued` NIE JE `failed` ani
 *     `partial` — vyčerpaný rozpočet je informácia, nie chyba (odpoveď 59).
 *   - **K2 (rýchlosť)** — pauza medzi položkami je ≥ 3 s (20 zápisov/min),
 *     nie 250 ms z D46. I10 tým nie je dotknuté: stále striktne sekvenčne.
 *   - **K3 (pásma)** — percento zápisu sa berie z `campaign_items.percent`,
 *     NIKDY z `campaigns.percent`. Pásma sa vyhodnotili pri POTVRDENÍ; executor
 *     ich nikdy nepočíta. Položka bez platného percenta sa nezapíše — je to
 *     rozbitý stav, nie dôvod hádať číslo.
 *
 * Tvrdé pravidlá:
 *   - **I10** — položky idú prísne sekvenčne podľa `position`; v tomto súbore
 *     ani jeden `Promise.all` nad zápismi neexistuje a existovať nesmie.
 *   - **I3** — bez `confirmed_at` + `confirm_payload_hash` (zhodný s hashom
 *     skutočnej sady) sa NEODOŠLE ani jeden request. `sudo_at` v tejto vete
 *     stálo do 27. 8. 2026; sudo zrušilo D100 a I3 odvtedy znie „žiadny zápis
 *     bez dry-runu a potvrdenia". Podrobne v `assertConfirmed()` nižšie.
 *   - **D34** — zlyhanie položky dávku nezastaví; pokračuje sa a report je
 *     na konci (`done`/`partial`/`failed`).
 *   - **D39c** — zmena ceny medzi preview a write zápis NEZASTAVÍ, ale
 *     `price_at_preview`, `price_at_write`, `price_mismatch` sa povinne uložia.
 *   - **D49** — `not_found` blokuje len daný produkt + označí ho v allowliste.
 *   - **D51/D52** — 401/403 uprostred dávky: okamžitý wipe kľúča, zvyšok
 *     `interrupted`, kampaň `needs_key`.
 *   - **D79** — runaway strop sa kontroluje aj PRED KAŽDOU položkou; 61. zápis
 *     v hodine zamkne zápisy a zvyšok dávky je `blocked`.
 *   - **D85** — `SIGTERM` nechá dobehnúť aktuálny produkt, zvyšok `interrupted`.
 *   - **I7** — neexistuje tu (ani nikde v engine) cesta, ktorá by zľavu rušila
 *     alebo posielala `to` v minulosti; guard `to ≥ dnes` + rovnaká kontrola
 *     v shop kliente sú fail-closed.
 *   - **I1** — `sent_payload`/`raw_response` idú do DB VŽDY cez `redact()`.
 *
 * Vlastník: A9.
 */
import type {
  AuditWriter,
  CampaignItemRecord,
  CampaignRecord,
  AllowlistRepo,
  ApiKeyRepo,
  ExecutorResult,
  ItemStatus,
  LastOwnWrite,
  SecretRef,
  ShopClient,
  ShopCtx,
  Ulid,
  WriteMutex,
} from '@/contracts';

import { env } from '@/env';
import { auditWriter as defaultAuditWriter } from '@/lib/audit/write';
import {
  PreviewTokenError,
  computePayloadHash,
  payloadHashItemsFromRows,
} from '@/lib/crypto/preview-token';
import { resolveFinalStatus } from '@/lib/domain/status';
import { logger as defaultLogger } from '@/lib/log/logger';
import { redact } from '@/lib/log/redact';
import { ApiKeyError, apiKeyRepo as defaultApiKeyRepo } from '@/lib/repo/api-key.repo';
import { allowlistRepo as defaultAllowlistRepo } from '@/lib/repo/allowlist.repo';
import { auditRepo as defaultAuditRepo } from '@/lib/repo/audit.repo';
import { campaignItemsRepo as defaultCampaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import {
  campaignsRepo as defaultCampaignsRepo,
  type CampaignStatusV3,
} from '@/lib/repo/campaigns.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { newRequestId } from '@/lib/shop/correlation';
import { isIpBanned } from '@/lib/shop/errors';
import { setReductionPayload } from '@/lib/shop/client';

import { createBudget, type BudgetSource, type WriteAttemptCounter } from '@/lib/engine/budget';
import {
  checkRunawayAndMaybeLock,
  guardFlagsFromEnv,
  runPreWriteGuards,
  type CatalogScopeSource,
  type GuardFlags,
  type GuardsDeps,
  type ScopeSettingsSource,
} from '@/lib/engine/guards';
import { writeMutex as defaultWriteMutex } from '@/lib/engine/mutex';
import { takePreWriteSnapshot } from '@/lib/engine/snapshot';

/* ═══════════════════════════ chyby engine ═════════════════════════════════ */

export type EngineErrorCode =
  | 'campaign_not_found'
  | 'campaign_not_claimable'
  | 'confirmation_missing'
  | 'confirmation_mismatch'
  | 'write_in_progress'
  | (string & {});

/** Odmietnutie PRED prvým requestom na shop — mapuje sa na 4xx v route. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly detail: unknown;

  constructor(code: EngineErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.detail = detail;
  }
}

/* ═══════════════════ SIGTERM — graceful stop (D85) ════════════════════════ */

let gracefulStopRequested = false;
let sigtermInstalled = false;

/** D85 — po tomto volaní executor dobehne aktuálny produkt a zvyšok preruší. */
export function requestGracefulStop(): void {
  gracefulStopRequested = true;
}

/** Výhradne pre testy. */
export function resetGracefulStop(): void {
  gracefulStopRequested = false;
}

export function isGracefulStopRequested(): boolean {
  return gracefulStopRequested;
}

/** Idempotentná registrácia SIGTERM handlera (compose má `stop_grace_period: 30s`). */
export function installSigtermHandler(): void {
  if (sigtermInstalled) return;
  sigtermInstalled = true;
  process.once('SIGTERM', () => {
    gracefulStopRequested = true;
  });
}

/* ═══════════════════════════ typy V3 (K2, K3) ═════════════════════════════ */

/**
 * Kampaň, ako ju vidí executor. `src/contracts.ts` (vlastník A0) stav `queued`
 * ešte nepozná; `late` je voliteľné, aby sem pasovali aj staršie tvary.
 */
export type ExecutorCampaign = Omit<CampaignRecord, 'status'> & {
  status: CampaignStatusV3;
  late?: boolean;
};

/**
 * Položka, ako ju vidí executor. `percent` je K3 — rozhodnuté pri POTVRDENÍ.
 * Je voliteľné len typovo (kontrakt A0 ho nemá); v behu je jeho absencia
 * rozbitý stav a položka sa NEZAPÍŠE.
 */
export type ExecutorItem = CampaignItemRecord & { percent?: number };

/**
 * Položka, ako ju vracia `listForWrite()` — bez `sent_payload`
 * a `raw_response`. Executor tie dva stĺpce nikdy nečíta (B2, K2).
 */
export type ExecutorItemForWrite = Omit<ExecutorItem, 'sentPayload' | 'rawResponse'>;

type ExecutorCampaignPatch = Partial<
  Pick<
    CampaignRecord,
    | 'statusReason'
    | 'needsKeySince'
    | 'startedAt'
    | 'finishedAt'
    | 'itemsTotal'
    | 'itemsOk'
    | 'itemsFailed'
    | 'itemsUncertain'
    | 'resultAckAt'
  >
>;

export interface ExecutorCampaignsRepo {
  getById(id: number): Promise<ExecutorCampaign | null>;
  claim(id: number, allowedFrom: CampaignStatusV3[]): Promise<boolean>;
  setStatus(id: number, status: CampaignStatusV3, patch?: ExecutorCampaignPatch): Promise<void>;
  lastOwnWrite(productId: number): Promise<LastOwnWrite | null>;
}

export interface ExecutorItemsRepo {
  listByCampaign(campaignId: number): Promise<ExecutorItem[]>;
  /**
   * K2 — sada položiek bez `sent_payload`/`raw_response`. Voliteľná rovnako
   * ako `listPage()` v detaile zľavy: fake repozitáre v testoch ju nemusia
   * mať a `loadCampaign()` vtedy padá na `listByCampaign()`.
   */
  listForWrite?(campaignId: number): Promise<ExecutorItemForWrite[]>;
  update(
    id: number,
    patch: Partial<Omit<CampaignItemRecord, 'id' | 'campaignId' | 'productId'>>,
  ): Promise<void>;
  markRemaining(
    campaignId: number,
    fromPosition: number,
    status: ItemStatus,
    reason: string,
  ): Promise<void>;
}

/** Výsledok dávky vrátane stavu `queued` (K2). */
export interface ExecutorResultV3 extends Omit<ExecutorResult, 'status' | 'items'> {
  status: ExecutorResult['status'] | 'queued';
  items: CampaignItemRecord[];
}

/* ═══════════════════════════ závislosti ═══════════════════════════════════ */

/**
 * K2 — minimálna pauza medzi zápismi. Shop dovolí 20 zápisov/min, takže
 * 60 000 / 20 = 3 000 ms. Nahrádza doterajších 250 ms z D46.
 */
export const MIN_WRITE_PAUSE_MS = 3_000;

export interface ExecutorFlags extends GuardFlags {
  /**
   * Pauza medzi zápismi (K2, D46, I10). Produkčne VŽDY ≥ `MIN_WRITE_PAUSE_MS`
   * — o to sa stará `executorFlagsFromEnv()`. Nižšia hodnota sa dá injektovať
   * len v testoch, rovnako ako env poistky v `guardFlagsFromEnv()` (I13);
   * inak by jeden test s reálnou pauzou bežal hodinu.
   */
  writePauseMs: number;
}

export function executorFlagsFromEnv(): ExecutorFlags {
  // ENV sa číta vo funkcii, nie na module scope — inak sa láme `next build`.
  return {
    ...guardFlagsFromEnv(),
    writePauseMs: Math.max(MIN_WRITE_PAUSE_MS, env.SHOP_WRITE_PAUSE_MS),
  };
}

export interface ExecutorDeps {
  shopClient: Pick<ShopClient, 'getProduct' | 'setReduction'>;
  campaignsRepo?: ExecutorCampaignsRepo;
  campaignItemsRepo?: ExecutorItemsRepo;
  allowlistRepo?: Pick<AllowlistRepo, 'areAllActive' | 'markShopStatus'>;
  settingsRepo?: ScopeSettingsSource;
  /** K1 bod 2 — rozsah v režime `plny`. */
  catalogRepo?: CatalogScopeSource;
  auditRepo?: { countWritesInLastHour(): Promise<number> };
  /** K2 — počítadlo `write_attempt` za UTC deň (default `SELECT` nad auditom). */
  writeAttemptCounter?: WriteAttemptCounter;
  /** K2 — celý rozpočet naraz; má prednosť pred `writeAttemptCounter`. */
  budget?: BudgetSource;
  apiKeyRepo?: Pick<ApiKeyRepo, 'loadForUse' | 'wipe' | 'touchLastUsed'>;
  audit?: AuditWriter;
  mutex?: WriteMutex;
  logger?: import('@/contracts').Logger;
  flags?: ExecutorFlags | (() => ExecutorFlags);
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** D85 — default číta modulový SIGTERM flag. */
  isStopping?: () => boolean;
  timeZone?: string;
}

export interface ExecuteOptions {
  /** Kto dávku spustil — do auditu (`user` = manuál/eager, `scheduler` = fire). */
  actor?: 'user' | 'scheduler';
  /**
   * `id` lokálneho actora (D102) — ide do `audit_log.user_id` KAŽDÉHO riadku,
   * ktorý tento beh zapíše. Do 27. 8. 2026 tu hodnota len stála: route ju
   * posielali, ale `commonAudit` ju neobsahoval, takže práve riadky
   * dokladujúce zápis do PRODUKCIE (`write_ok`, `write_failed`,
   * `write_uncertain`) mali `user_id = NULL` a nevedeli, kto ich spustil.
   * To bolo porušenie D102 aj I11 („nevieme" je horšie než odpoveď).
   *
   * Pri `actor='scheduler'` sa NEPOSIELA (dávku nespustil človek) a executor
   * si od 28. 8. 2026 dosadí `campaigns.created_by`, teda toho, kto kampaň
   * potvrdil — viď D108 v tele `executeCampaign()`. `user_id` tak odpovedá na
   * „kto to autorizoval" a stĺpec `actor` oddelene na „kto to spustil".
   */
  userId?: number | null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * K3 — percento pásma z položky. `null` = položka ho nemá alebo je mimo 1–30
 * (I9). Fallback na `campaigns.percent` tu ZÁMERNE nie je: bol by to tichý
 * zápis iného čísla, než aké používateľ potvrdil.
 */
export function itemPercent(item: ExecutorItem): number | null {
  const value = item.percent;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 30 ? value : null;
}

/* ═══════════════════════════ potvrdenie (I3) ══════════════════════════════ */

/**
 * I3 — kampaň musí mať doložený dry-run + potvrdenie + sudo. Hash sa
 * prepočítava z reálnej sady položiek: podvrhnutá kampaň s cudzím hashom
 * neprejde a na shop nedorazí žiadny request.
 *
 * K4 — hash sa počíta STREAMOVO nad trojicami `product_id:percent:price` zo
 * SKUTOČNÝCH riadkov `campaign_items` (`payloadHashItemsFromRows`), nie nad
 * hlavičkovým percentom kampane. Pri pásmach (K3) je to jediný tvar, ktorý sa
 * môže zhodovať s tým, čo podpísal dry-run.
 *
 * Položka bez platného percenta (1–30) preto neprejde už tu: hash sa z nej
 * nedá poskladať a I3 znamená, že bez zhody sa neodošle ani jeden request.
 * Zápis „radšej s hlavičkovým percentom" by bol presne to, čo K3 zakazuje.
 *
 * D25 — pri dopálení s posunutým `date_from` (scheduler/relight po zadaní
 * kľúča) je pôvodné potvrdenie počítané nad PÔVODNÝM `from`, ktorý žije
 * v `date_from_original` a posun je doložený auditom `campaign_from_shifted`.
 * Preto sa akceptuje hash nad aktuálnym `date_from` (bežná cesta aj manuálne
 * dopálenie s čerstvým tokenom) ALEBO nad `date_from_original` (posunuté okno
 * s pôvodným potvrdením). Nič iné — podvrhnutá sada stále neprejde: percentá,
 * ceny z náhľadu, produkty, `to` aj `kind` musia sedieť presne, `from` len
 * v týchto dvoch doložených podobách.
 */
export function assertConfirmed(campaign: ExecutorCampaign, items: ExecutorItem[]): void {
  if (campaign.confirmedAt === null || campaign.confirmPayloadHash === null) {
    throw new EngineError(
      'confirmation_missing',
      'Kampaň nemá doložený potvrdený dry-run (confirmed_at + confirm_payload_hash) — zápis je zakázaný (I3).',
      { campaignId: campaign.id },
    );
  }
  /*
   * Tu do 27. 8. 2026 stála TRETIA podmienka: `campaign.sudoAt === null` →
   * odmietnuté. Sudo zrušilo D100 a `_shared.ts` odvtedy zapisuje `sudo_at`
   * ako NULL (zapisovať čas by bolo tvrdenie „potvrdené heslom vtedy", ktoré
   * by nebolo pravdivé). Podmienka by teda odmietla KAŽDÚ novú kampaň —
   * appka by prestala zapisovať a hlásila by pritom chýbajúce potvrdenie.
   *
   * NIE JE to medzera v I3. I3 po D100 znie „žiadny zápis bez dry-runu
   * a potvrdenia" a obe nohy sú tu nad aj pod týmto komentárom:
   *  - `confirmed_at` + `confirm_payload_hash` musia byť doložené (vyššie),
   *  - hash sa PREPOČÍTAVA z riadkov položiek a musí sedieť (nižšie) — to je
   *    tá silná noha, ktorá zachytí aj podvrhnuté potvrdenie.
   *
   * Staré kampane si svoj `sudo_at` v DB ponechávajú; nikto ho už nečíta.
   */
  // K3/K4 — hash z riadkov položiek. Bez percenta sa hash nedá poskladať a
  // I3 tak zápis odmieta ešte pred prvým requestom.
  const broken = items.filter((item) => itemPercent(item) === null).map((i) => i.productId);
  if (broken.length > 0) {
    throw new EngineError(
      'confirmation_mismatch',
      'Aspoň jedna položka nemá percento pásma (campaign_items.percent) — potvrdenie sa nedá prepočítať a zápis je odmietnutý (K3, I3).',
      { campaignId: campaign.id, productIds: broken.slice(0, 20) },
    );
  }
  const hashItems = payloadHashItemsFromRows(
    items.map((item) => ({
      productId: item.productId,
      percent: itemPercent(item) as number,
      priceAtPreview: item.priceAtPreview,
    })),
  );
  const hashFor = (from: ExecutorCampaign['dateFrom']): string => {
    try {
      return computePayloadHash({
        kind: campaign.kind,
        from,
        to: campaign.dateTo,
        items: hashItems,
      });
    } catch (error) {
      // `PreviewTokenError('bad_input')` = sada sa nedá kanonizovať (rozbitá
      // cena, duplicita, obrátené okno). Fail-closed: žiadny zápis.
      if (error instanceof PreviewTokenError) {
        throw new EngineError(
          'confirmation_mismatch',
          `Sada kampane sa nedá kanonizovať pre potvrdzovací hash: ${error.message} (K4, I3).`,
          { campaignId: campaign.id },
        );
      }
      throw error;
    }
  };
  const accepted = [campaign.dateFrom];
  if (campaign.dateFromOriginal !== null && campaign.dateFromOriginal !== campaign.dateFrom) {
    accepted.push(campaign.dateFromOriginal);
  }
  if (!accepted.some((from) => hashFor(from) === campaign.confirmPayloadHash)) {
    throw new EngineError(
      'confirmation_mismatch',
      'Potvrdený dry-run sa nezhoduje so skutočnou sadou kampane — zápis je odmietnutý (I3).',
      { campaignId: campaign.id },
    );
  }
}

/* ═══════════════════════════ executor ═════════════════════════════════════ */

export function createExecutor(deps: ExecutorDeps): {
  executeCampaign(campaignId: number, opts?: ExecuteOptions): Promise<ExecutorResultV3>;
} {
  const campaignsRepo: ExecutorCampaignsRepo = deps.campaignsRepo ?? defaultCampaignsRepo;
  const itemsRepo: ExecutorItemsRepo = deps.campaignItemsRepo ?? defaultCampaignItemsRepo;
  const allowlistRepo = deps.allowlistRepo ?? defaultAllowlistRepo;
  const settingsRepo = deps.settingsRepo ?? defaultSettingsRepo;
  const auditRepo = deps.auditRepo ?? defaultAuditRepo;
  const apiKeyRepo = deps.apiKeyRepo ?? defaultApiKeyRepo;
  const audit = deps.audit ?? defaultAuditWriter;
  const mutex = deps.mutex ?? defaultWriteMutex;
  const log = deps.logger ?? defaultLogger;
  const flagsOf =
    typeof deps.flags === 'function'
      ? deps.flags
      : deps.flags !== undefined
        ? (): ExecutorFlags => deps.flags as ExecutorFlags
        : executorFlagsFromEnv;
  const sleepFn = deps.sleepFn ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const isStopping = deps.isStopping ?? isGracefulStopRequested;

  const guardsDeps: GuardsDeps = {
    settingsRepo,
    allowlistRepo,
    auditRepo,
    audit,
    flags: () => flagsOf(),
    now,
    ...(deps.catalogRepo !== undefined ? { catalogRepo: deps.catalogRepo } : {}),
    ...(deps.writeAttemptCounter !== undefined
      ? { writeAttemptCounter: deps.writeAttemptCounter }
      : {}),
    ...(deps.timeZone !== undefined ? { timeZone: deps.timeZone } : {}),
  };

  /**
   * K2 — rozpočet. Výška ide z `settings.daily_write_budget` (alebo z flags,
   * keď ju volajúci už načítal), spotreba VÝHRADNE z auditu.
   */
  const budget: BudgetSource =
    deps.budget ??
    createBudget({
      ...(deps.writeAttemptCounter !== undefined ? { counter: deps.writeAttemptCounter } : {}),
      ...(flagsOf().dailyWriteBudget !== undefined
        ? { dailyBudget: flagsOf().dailyWriteBudget as number }
        : {}),
      settingsRepo,
      now,
    });

  async function loadCampaign(campaignId: number): Promise<{
    campaign: ExecutorCampaign;
    items: ExecutorItem[];
  }> {
    const campaign = await campaignsRepo.getById(campaignId);
    if (campaign === null) {
      throw new EngineError('campaign_not_found', `Kampaň ${campaignId} neexistuje.`);
    }
    /*
     * K2 — položky sa ťahajú BEZ `sent_payload` a `raw_response`. Executor tie
     * dva stĺpce nikdy nečíta (píše ich cez `update()`), zato na 30. deň
     * 10 000-položkovej fronty je to pri každom prechode 10 000 riadkov
     * s celou históriou odpovedí shopu — aby sa zapísalo 200 položiek.
     *
     * Riadky sa neubrali: `assertConfirmed()` prepočítava hash nad VŠETKÝMI
     * (K4, I3), takže sada tu musí byť celá. Šetria sa stĺpce, nie riadky.
     *
     * Vo výsledku behu tak `sentPayload`/`rawResponse` zostávajú `null`. Nič
     * sa tým nestratilo: in-memory riadok sa počas zápisu neaktualizuje, takže
     * doteraz tam boli hodnoty z PREDCHÁDZAJÚCEHO behu, nikdy z tohto — a
     * žiadny volajúci ich z výsledku executora nečíta.
     */
    if (itemsRepo.listForWrite !== undefined) {
      const rows = await itemsRepo.listForWrite(campaignId);
      return {
        campaign,
        items: rows.map((row) => ({ ...row, sentPayload: null, rawResponse: null })),
      };
    }
    const items = await itemsRepo.listByCampaign(campaignId);
    return { campaign, items };
  }

  async function finishCampaign(
    campaign: ExecutorCampaign,
    items: ExecutorItem[],
    actor: 'user' | 'scheduler',
    userId: number | null,
  ): Promise<ExecutorResultV3> {
    const statuses = items.map((i) => i.status);
    const finalStatus = resolveFinalStatus(statuses);
    const itemsOk = statuses.filter((s) => s === 'ok' || s === 'skipped').length;
    const itemsUncertain = statuses.filter((s) => s === 'uncertain').length;
    const itemsFailed = statuses.length - itemsOk - itemsUncertain;

    await campaignsRepo.setStatus(campaign.id, finalStatus, {
      finishedAt: now(),
      itemsTotal: statuses.length,
      itemsOk,
      itemsFailed,
      itemsUncertain,
      resultAckAt: null,
    });
    await audit.appendAudit({
      actor,
      userId,
      eventType: 'campaign_finished',
      ok: finalStatus === 'done',
      campaignId: campaign.id,
      operationId: campaign.operationId,
      message: `Dávka dobehla so stavom „${finalStatus}" (ok=${itemsOk}, failed=${itemsFailed}, uncertain=${itemsUncertain}).`,
    });

    return {
      campaignId: campaign.id,
      status: finalStatus,
      itemsTotal: statuses.length,
      itemsOk,
      itemsFailed,
      itemsUncertain,
      items,
    };
  }

  async function toNeedsKey(
    campaign: ExecutorCampaign,
    items: ExecutorItem[],
    reason: string,
    actor: 'user' | 'scheduler',
    userId: number | null,
  ): Promise<ExecutorResultV3> {
    await campaignsRepo.setStatus(campaign.id, 'needs_key', {
      statusReason: reason,
      needsKeySince: now(),
    });
    await audit.appendAudit({
      actor,
      userId,
      eventType: 'campaign_needs_key',
      ok: false,
      campaignId: campaign.id,
      operationId: campaign.operationId,
      message: reason,
    });
    const statuses = items.map((i) => i.status);
    return {
      campaignId: campaign.id,
      status: 'needs_key',
      itemsTotal: statuses.length,
      itemsOk: statuses.filter((s) => s === 'ok' || s === 'skipped').length,
      itemsFailed: statuses.filter(
        (s) => s === 'failed' || s === 'not_found' || s === 'blocked' || s === 'interrupted',
      ).length,
      itemsUncertain: statuses.filter((s) => s === 'uncertain').length,
      items,
    };
  }

  /**
   * K2 — kampaň sa vracia do fronty. Zvyšné položky zostávajú `pending`:
   * NIČ sa neoznačuje ako `blocked` ani `interrupted`, lebo sa nič nepokazilo.
   * Druhý deň sa pokračuje presne tam, kde sa skončilo — žiadna položka sa
   * nezapíše druhý raz a žiadna sa nepreskočí.
   *
   * `finished_at` sa ZÁMERNE nenastavuje (kampaň nedobehla) a `result_ack_at`
   * sa nedotýka — `queued` nie je výsledok, ktorý by mal niekto odklikávať.
   */
  async function toQueued(
    campaign: ExecutorCampaign,
    items: ExecutorItem[],
    reason: string,
    actor: 'user' | 'scheduler',
  ): Promise<ExecutorResultV3> {
    const statuses = items.map((i) => i.status);
    const itemsOk = statuses.filter((s) => s === 'ok' || s === 'skipped').length;
    const itemsUncertain = statuses.filter((s) => s === 'uncertain').length;
    const itemsFailed = statuses.filter(
      (s) => s === 'failed' || s === 'not_found' || s === 'blocked' || s === 'interrupted',
    ).length;

    await campaignsRepo.setStatus(campaign.id, 'queued', {
      statusReason: reason,
      itemsTotal: statuses.length,
      itemsOk,
      itemsFailed,
      itemsUncertain,
    });

    // Audit event `campaign_queued` v `AuditEventType` (A0) zatiaľ nie je,
    // takže tento prechod nesie `campaigns.status_reason` a stdout log. Keď
    // A2 event doplní, patrí sem `appendAudit({ eventType: 'campaign_queued' })`.
    log.info('campaign_queued', {
      actor,
      campaignId: campaign.id,
      operationId: campaign.operationId,
      reason,
      pending: statuses.filter((s) => s === 'pending').length,
    });

    return {
      campaignId: campaign.id,
      status: 'queued',
      itemsTotal: statuses.length,
      itemsOk,
      itemsFailed,
      itemsUncertain,
      items,
    };
  }

  /** D36 — retry preskočí produkt s potvrdeným OK zápisom identických parametrov. */
  async function isAlreadyWritten(
    campaign: ExecutorCampaign,
    item: ExecutorItem,
    percent: number,
  ): Promise<boolean> {
    if (campaign.kind !== 'retry') return false;
    const last = await campaignsRepo.lastOwnWrite(item.productId);
    return (
      last !== null &&
      // K3 — porovnáva sa percento POLOŽKY, nie hlavičky kampane.
      last.percent === percent &&
      last.from === campaign.dateFrom &&
      last.to === campaign.dateTo
    );
  }

  async function executeCampaign(
    campaignId: number,
    opts: ExecuteOptions = {},
  ): Promise<ExecutorResultV3> {
    installSigtermHandler();
    const actor = opts.actor ?? 'user';
    /*
     * D102 — `user_id` do KAŽDÉHO auditného riadku tohto behu (27. 8. 2026).
     * Do tohto dátumu sa `opts.userId` deklarovalo, route ho posielali a
     * `commonAudit` ho neobsahoval, takže `write_ok`/`write_failed`/
     * `write_uncertain` — teda práve riadky dokladujúce zápis do PRODUKCIE —
     * mali `user_id = NULL`. Audit potom nevedel, kto zápis spustil (I11).
     */
    let userId = opts.userId ?? null;

    /* 1. Globálny mutex — druhá operácia sa odmietne, nečaká (D37, I12). */
    const held = await mutex.tryAcquire(`campaign:${campaignId}`);
    if (held === null) {
      throw new EngineError(
        'write_in_progress',
        'Prebieha iná zápisová operácia — skús znova, keď dobehne (D37, I12).',
      );
    }

    try {
      const { campaign, items } = await loadCampaign(campaignId);

      /*
       * D108 (28. 8. 2026) — schedulerový fire tiež musí povedať, KTO ten zápis
       * autorizoval.
       *
       * Scheduler nedostane `opts.userId` (nespustil ho človek), takže do
       * 28. 8. 2026 mali všetky auditné riadky dávkových zápisov
       * `user_id = NULL` — a to sú riadky dokladujúce zápis do PRODUKČNÉHO
       * eshopu. D102 pritom hovorí „každý zápis a každý audit riadok", a I11
       * hovorí, že „nevieme" je horšie než odpoveď.
       *
       * Odpoveď nie je vymyslená: `campaigns.created_by` drží actora, ktorý
       * kampaň vytvoril a POTVRDIL — teda toho, kto zápis autorizoval. Kto ho
       * spustil, hovorí ODDELENE stĺpec `actor` (`scheduler` vs. `user`), takže
       * sa tu nič nezastiera: dva stĺpce, dve rôzne otázky. Preto fallback až
       * PO načítaní kampane a nikdy prepis explicitného `opts.userId`.
       */
      if (userId === null) userId = campaign.createdBy;

      const operationId = campaign.operationId;
      const opLog = log.child({ operationId, campaignId: campaign.id });

      /* 2. Potvrdenie (I3) — PRED guardmi aj pred kľúčom: bez neho nič. */
      assertConfirmed(campaign, items);

      /* 3. Guardy (I2, I9, I12, I13, D79) — fail-closed pred prvým requestom. */
      const guard = await runPreWriteGuards(
        {
          productIds: items.map((i) => i.productId),
          percent: campaign.percent,
          from: campaign.dateFrom,
          to: campaign.dateTo,
        },
        guardsDeps,
      );
      if (!guard.ok) {
        throw new EngineError(guard.code, guard.message, guard.detail);
      }

      /* 4. Kľúč — chýbajúci/expirovaný = `needs_key`, nikdy `failed` (D21). */
      const keyRef: SecretRef | null = await apiKeyRepo.loadForUse();
      if (keyRef === null) {
        return toNeedsKey(campaign, items, 'no_key', actor, userId);
      }

      /* 5. Claim → running (D84). Ak kampaň ešte nie je `running`, prevezmi ju. */
      if (campaign.status !== 'running') {
        // `missed` tu ZÁMERNE nie je (D33b): zmeškanú kampaň smie claimnúť len
        // manuálna route s NOVÝM potvrdením — executor ju z `missed` neprevezme.
        // `draft` tu NAOPAK byť musí: `POST /api/campaigns` s `mode='eager'`
        // (D22) vkladá kampaň ako `draft` a executor si ju claimne sám
        // (spúšťač `create_eager`, §4 `draft → running`).
        // K2: `queued` PATRÍ medzi claimovateľné stavy — je to kampaň, ktorá
        // včera minula rozpočet a dnes pokračuje. Bez toho by fronta po prvom
        // vyčerpaní rozpočtu už nikdy nenaskočila.
        const claimed = await campaignsRepo.claim(campaign.id, [
          'scheduled',
          'needs_key',
          'draft',
          'queued',
        ]);
        if (!claimed) {
          throw new EngineError(
            'campaign_not_claimable',
            `Kampaň ${campaign.id} sa nedá spustiť zo stavu „${campaign.status}" — pravdepodobne ju už spracúva iný beh (D84).`,
          );
        }

        // Dopálenie z `needs_key` (D24, D51/D52, D85): položky `interrupted`
        // z prerušeného behu sa vracajú na `pending`, inak by sa už nikdy
        // nedopísali a kampaň by sa uzavrela `partial` s nulou nových zápisov.
        let resetInterrupted = 0;
        if (campaign.status === 'needs_key') {
          for (const item of items) {
            if (item.status !== 'interrupted') continue;
            item.status = 'pending';
            await itemsRepo.update(item.id, {
              status: 'pending',
              errorCode: null,
              errorMessage: null,
              finishedAt: null,
            });
            resetInterrupted += 1;
          }
        }

        await audit.appendAudit({
          actor,
          userId,
          eventType: 'campaign_claimed',
          ok: true,
          campaignId: campaign.id,
          operationId,
          ...(resetInterrupted > 0
            ? {
                message: `Dopálenie z „needs_key": ${resetInterrupted} prerušených položiek vrátených na „pending" a dopíšu sa v tomto behu.`,
              }
            : {}),
        });
      }
      // `status_reason` sa pri prevzatí čistí: dôvod, prečo kampaň čakala
      // (`budget_exhausted`, `no_key`, …), už neplatí a nesmie zostať visieť
      // na dobehnutej kampani (K2, K10 — na povrchu je to veta pre človeka).
      await campaignsRepo.setStatus(campaign.id, 'running', {
        startedAt: now(),
        statusReason: null,
      });

      /* 6. Sekvenčná dávka (I10, D46, K2). ŽIADNY Promise.all. */
      const ordered = [...items].sort((a, b) => a.position - b.position);
      const flags = flagsOf();

      for (let index = 0; index < ordered.length; index += 1) {
        const item = ordered[index] as ExecutorItem;
        if (item.status !== 'pending') continue;

        /* D85 — SIGTERM: aktuálny produkt dobehol, zvyšok `interrupted`. */
        if (isStopping()) {
          await itemsRepo.markRemaining(
            campaign.id,
            item.position,
            'interrupted',
            'Prerušené (SIGTERM) — manuálny retry (D85).',
          );
          for (const rest of ordered.slice(index)) {
            if (rest.status === 'pending') rest.status = 'interrupted';
          }
          break;
        }

        /* D79 — runaway strop pred KAŽDÝM zápisom: 61. zápis v hodine neprejde. */
        const runaway = await checkRunawayAndMaybeLock(guardsDeps);
        if (!runaway.ok) {
          await itemsRepo.markRemaining(
            campaign.id,
            item.position,
            'blocked',
            'Zápisy zamknuté runaway stropom (D79).',
          );
          for (const rest of ordered.slice(index)) {
            if (rest.status === 'pending') rest.status = 'blocked';
          }
          break;
        }

        /*
         * K2 — denný rozpočet pred KAŽDOU položkou. Spotreba sa číta z auditu
         * (`write_attempt` za UTC deň), takže sa počíta aj to, čo zapísal
         * predchádzajúci beh alebo iná kampaň.
         *
         * Pri vyčerpaní kampaň prejde do `queued`, položky zostávajú `pending`
         * a NIČ sa neoznačuje ako chyba — vyčerpaný rozpočet je informácia.
         * Nečitateľný rozpočet je fail-closed to isté: radšej zajtra než
         * naslepo (`budget_unknown` sa líši len dôvodom v `status_reason`).
         */
        let budgetStatus;
        try {
          budgetStatus = await budget.remainingToday();
        } catch (error) {
          opLog.error('budget_read_failed', {
            campaignId: campaign.id,
            reason: error instanceof Error ? error.message : 'neznáma chyba',
          });
          return toQueued(campaign, ordered, 'budget_unknown', actor);
        }
        if (budgetStatus.exhausted) {
          opLog.info('daily_write_budget_exhausted', {
            campaignId: campaign.id,
            day: budgetStatus.day,
            budget: budgetStatus.budget,
            spent: budgetStatus.spent,
          });
          return toQueued(campaign, ordered, 'budget_exhausted', actor);
        }

        /*
         * K3 — percento zápisu je na POLOŽKE, rozhodnuté pri potvrdení.
         * `campaigns.percent` je len hlavička (najvyššie percento pásiem) a do
         * shopu sa NIKDY nedostane. `assertConfirmed()` už zaručil, že každá
         * položka percento má (bez neho sa nedá prepočítať hash, K4) — tento
         * riadok je posledná poistka, nie druhá cesta k číslu.
         */
        const percent = itemPercent(item);
        if (percent === null) {
          throw new EngineError(
            'confirmation_mismatch',
            `Položka ${item.id} (produkt ${item.productId}) nemá percento pásma — zápis je odmietnutý (K3, I3).`,
            { campaignId: campaign.id, productId: item.productId },
          );
        }

        const requestId: Ulid = newRequestId();
        const ctx: ShopCtx = { operationId, requestId };
        const startedAt = now();

        /* 6a. Povinný pre-write GET (D48) + D39c snapshot. */
        const outcome = await takePreWriteSnapshot(
          { productId: item.productId, priceAtPreview: item.priceAtPreview },
          {
            shopClient: deps.shopClient,
            lastOwnWrite: (productId) => campaignsRepo.lastOwnWrite(productId),
          },
          ctx,
        );

        if (outcome.kind === 'not_found') {
          /* D49 — blokni len tento produkt a označ ho v allowliste. */
          item.status = 'not_found';
          await itemsRepo.update(item.id, {
            status: 'not_found',
            errorCode: 'not_found',
            errorMessage: 'Produkt sa v shope nenašiel — zápis tohto produktu je zablokovaný (D49).',
            startedAt,
            finishedAt: now(),
            priceMismatch: outcome.snapshot.priceMismatch,
          });
          await allowlistRepo.markShopStatus(
            item.productId,
            'not_found',
            'Pre-write GET vrátil not found (D49).',
          );
          await audit.appendAudit({
            actor,
            userId,
            eventType: 'allowlist_marked_unknown',
            ok: false,
            campaignId: campaign.id,
            campaignItemId: item.id,
            productId: item.productId,
            operationId,
            requestId,
            message: 'Produkt nenájdený v shope pri pre-write GET — označený v allowliste (D49).',
          });
          continue;
        }

        if (outcome.kind === 'error' && isIpBanned(outcome.error)) {
          /*
           * ZABLOKOVANÁ ADRESA UŽ NA ČÍTANÍ (X1, druhá polovica, 26. 8. 2026).
           *
           * Prvá oprava X1 dala banu vlastnú vetvu na ZÁPISE. Verifikácia ju
           * označila za v reálnom stave nedosiahnuteľnú a mala pravdu: skutočný
           * ban platí aj na čítanie, takže padne povinný pre-write GET (D48) —
           * a tá vetva robila `continue`. Dôsledok: appka by proti zabanovanej
           * adrese vystrieľala jeden GET NA KAŽDÚ položku fronty, teda pri 8 000
           * produktoch 8 000 odsúdených requestov, čo je presne to, čím sa ban
           * zhoršuje. A položky by hovorili „Pre-write GET zlyhal (forbidden)",
           * teda nič o adrese.
           *
           * Prvá taká odpoveď preto zastaví celú dávku, rovnako ako na zápise:
           * zvyšok `interrupted`, kampaň `needs_key` s dôvodom `shop_ip_banned`,
           * a KĽÚČ SA NEDOTKNE. Nič sa nestratí — po odblokovaní fronta
           * pokračuje tam, kde stála (K6).
           */
          item.status = 'failed';
          await itemsRepo.update(item.id, {
            status: 'failed',
            errorCode: outcome.error.code ?? outcome.error.kind,
            errorMessage:
              'Eshop odmieta našu IP adresu (403) — kľúč je v poriadku a zostáva uložený.',
            httpStatus: outcome.error.httpStatus,
            startedAt,
            finishedAt: now(),
          });
          await audit.appendAudit({
            actor,
            userId,
            eventType: 'write_failed',
            ok: false,
            campaignId: campaign.id,
            campaignItemId: item.id,
            productId: item.productId,
            operationId,
            requestId,
            httpStatus: outcome.error.httpStatus,
            message:
              'Eshop odmieta našu IP adresu už pri pre-write GET — dávka sa zastavila, ' +
              'kľúča sa nedotklo (D48, X1).',
          });
          await itemsRepo.markRemaining(
            campaign.id,
            item.position + 1,
            'interrupted',
            'Prerušené — eshop odmieta našu IP adresu; kľúč sa nedotklo.',
          );
          for (const rest of ordered.slice(index + 1)) {
            if (rest.status === 'pending') rest.status = 'interrupted';
          }
          return toNeedsKey(campaign, ordered, 'shop_ip_banned', actor, userId);
        }

        if (outcome.kind === 'error') {
          item.status = 'failed';
          await itemsRepo.update(item.id, {
            status: 'failed',
            errorCode: outcome.error.code ?? outcome.error.kind,
            errorMessage: outcome.error.message,
            httpStatus: outcome.error.httpStatus,
            startedAt,
            finishedAt: now(),
          });
          await audit.appendAudit({
            actor,
            userId,
            eventType: 'write_failed',
            ok: false,
            campaignId: campaign.id,
            campaignItemId: item.id,
            productId: item.productId,
            operationId,
            requestId,
            httpStatus: outcome.error.httpStatus,
            message: `Pre-write GET zlyhal (${outcome.error.kind}) — zápis sa neodoslal (D48, fail-closed).`,
          });
          continue;
        }

        const { snapshot } = outcome;

        /* 6b. D36 — idempotentný retry: identický potvrdený zápis sa preskočí. */
        if (await isAlreadyWritten(campaign, item, percent)) {
          item.status = 'skipped';
          await itemsRepo.update(item.id, {
            status: 'skipped',
            nameAtWrite: snapshot.name,
            priceAtWrite: snapshot.priceAtWrite,
            priceMismatch: snapshot.priceMismatch,
            hasAttributes: snapshot.hasAttributes,
            startedAt,
            finishedAt: now(),
          });
          await audit.appendAudit({
            actor,
            userId,
            eventType: 'write_skipped',
            ok: true,
            campaignId: campaign.id,
            campaignItemId: item.id,
            productId: item.productId,
            operationId,
            requestId,
            message: 'Retry: identické parametre už majú potvrdený OK zápis — preskočené (D36).',
          });
          continue;
        }

        /* 6c. Zápis. Payload je presne to, čo pošle klient (D50).
         * `reduction` je percento POLOŽKY (K3) — `campaign.percent` je len
         * hlavička pre zoznamy a do shopu sa nikdy neposiela. */
        const params = {
          id: item.productId,
          from: campaign.dateFrom,
          to: campaign.dateTo,
          reduction: percent,
        };
        const sentPayload = setReductionPayload(params);

        await itemsRepo.update(item.id, {
          startedAt,
          attemptCount: item.attemptCount + 1,
          nameAtWrite: snapshot.name,
          priceAtWrite: snapshot.priceAtWrite,
          priceMismatch: snapshot.priceMismatch,
          hasAttributes: snapshot.hasAttributes,
          requestId,
        });
        await audit.appendAudit({
          actor,
          userId,
          eventType: 'write_attempt',
          campaignId: campaign.id,
          campaignItemId: item.id,
          productId: item.productId,
          operationId,
          requestId,
          beforeSnapshot: {
            name: snapshot.name,
            price_at_preview: snapshot.priceAtPreview,
            price_at_write: snapshot.priceAtWrite,
            price_mismatch: snapshot.priceMismatch,
            last_own_write: snapshot.lastOwnWrite,
            reduction_unverifiable: snapshot.reductionUnverifiable,
          },
        });
        if (snapshot.priceMismatch) {
          opLog.warn('price_mismatch_between_preview_and_write', {
            productId: item.productId,
            requestId,
          });
        }

        /* D21/D63 — kľúč sa dešifruje až v kliente; ak medzičasom expiroval
         * alebo bol wipnutý, `SecretRef` hodí `ApiKeyError`. To NIE JE sieťová
         * chyba: žiadny retry/backoff, položka a zvyšok dávky `interrupted`
         * a kampaň ide do `needs_key` (konzistentne s 401/403, D51/D52). */
        let result: Awaited<ReturnType<typeof deps.shopClient.setReduction>>;
        try {
          result = await deps.shopClient.setReduction(params, keyRef, ctx);
        } catch (error) {
          if (!(error instanceof ApiKeyError)) throw error;
          item.status = 'interrupted';
          await itemsRepo.update(item.id, {
            status: 'interrupted',
            errorCode: 'key_unavailable',
            errorMessage:
              'API kľúč nebol v momente zápisu k dispozícii (expiroval alebo bol vymazaný) — zápis sa neodoslal.',
            finishedAt: now(),
          });
          await audit.appendAudit({
            actor,
            userId,
            eventType: 'write_failed',
            ok: false,
            campaignId: campaign.id,
            campaignItemId: item.id,
            productId: item.productId,
            operationId,
            requestId,
            message:
              'API kľúč expiroval/zmizol uprostred dávky — položka aj zvyšok dávky sú prerušené, kampaň čaká na kľúč (D21).',
          });
          await itemsRepo.markRemaining(
            campaign.id,
            item.position + 1,
            'interrupted',
            'Prerušené — API kľúč expiroval/zmizol uprostred dávky (D21).',
          );
          for (const rest of ordered.slice(index + 1)) {
            if (rest.status === 'pending') rest.status = 'interrupted';
          }
          return toNeedsKey(campaign, ordered, 'key_unavailable', actor, userId);
        }
        await apiKeyRepo.touchLastUsed();
        const finishedAt = now();

        const commonAudit = {
          actor,
          // D102 — bez tohto poľa mali `write_ok`/`write_failed`/
          // `write_uncertain` `user_id = NULL` (27. 8. 2026).
          userId,
          campaignId: campaign.id,
          campaignItemId: item.id,
          productId: item.productId,
          operationId,
          requestId: result.requestId ?? requestId,
          httpStatus: result.httpStatus,
          afterSnapshot: {
            sent_payload: sentPayload,
            raw_response: result.raw,
            http_status: result.httpStatus,
            attempts: result.attempts,
            price_at_preview: snapshot.priceAtPreview,
            price_at_write: snapshot.priceAtWrite,
            price_mismatch: snapshot.priceMismatch,
          },
        } as const;

        if (result.outcome === 'ok') {
          item.status = 'ok';
          await itemsRepo.update(item.id, {
            status: 'ok',
            httpStatus: result.httpStatus,
            requestId: result.requestId,
            sentPayload: redact(sentPayload),
            rawResponse: redact(result.raw),
            finishedAt,
          });
          await audit.appendAudit({ ...commonAudit, eventType: 'write_ok', ok: true });
        } else {
          const { error } = result;
          /*
           * `ip_banned` NIE JE výrok o kľúči (X1, 25. 8. 2026).
           *
           * Shop ho vracia s 403, ale aj na volanie BEZ kľúča — je to stav
           * NÁŠHO PRÍSTUPU. Do 25. 8. sa tu rozhodovalo len z `error.kind`,
           * takže ban spadol do vetvy D51/D52: kľúč sa WIPNUL, kampaň dostala
           * „chýba kľúč na zápis" a položka vetu „Kľúč nemá scope product:edit".
           * Používateľ vložil nový kľúč, fronta narazila na to isté 403 a kľúč
           * sa zmazal znovu — a ban nepomenoval nikto. Od 19. 8. je to stav,
           * v ktorom appka reálne bežala.
           *
           * `shop/client.ts` to rozlíšenie drží (`onKeyRejected` sa pri
           * `isIpBanned` zámerne nevolá), ale executor callback nečíta a
           * rozhodoval sa nanovo — takže oprava v klientovi ho neochránila.
           * Preto sa tu tá istá otázka kladie tým istým nástrojom.
           */
          const addressBanned = isIpBanned(error);
          const keyRejected =
            !addressBanned && (error.kind === 'unauthorized' || error.kind === 'forbidden');

          if (result.outcome === 'uncertain') {
            item.status = 'uncertain';
            await itemsRepo.update(item.id, {
              status: 'uncertain',
              httpStatus: result.httpStatus,
              requestId: result.requestId,
              errorCode: error.code ?? error.kind,
              errorMessage: error.message,
              sentPayload: redact(sentPayload),
              rawResponse: redact(result.raw),
              finishedAt,
            });
            await audit.appendAudit({ ...commonAudit, eventType: 'write_uncertain', ok: null });
            if (error.kind === 'schema_drift') {
              await audit.appendAudit({
                ...commonAudit,
                eventType: 'schema_drift',
                ok: false,
                message: 'Shop vrátil nečakaný tvar odpovede — API sa možno zmenilo (D54).',
              });
            }
          } else if (addressBanned) {
            /*
             * Zablokovaná adresa: kľúč sa NEDOTKNE. Zvyšok dávky sa preruší
             * rovnako ako pri odmietnutom kľúči — fronta nemá čím pokračovať,
             * kým ban platí — ale dôvod hovorí pravdu a kľúč zostáva, takže po
             * odblokovaní netreba nič vkladať znova.
             */
            item.status = 'failed';
            await itemsRepo.update(item.id, {
              status: 'failed',
              httpStatus: result.httpStatus,
              requestId: result.requestId,
              errorCode: error.code ?? error.kind,
              errorMessage:
                'Eshop odmieta našu IP adresu (403) — kľúč je v poriadku a zostáva uložený.',
              sentPayload: redact(sentPayload),
              rawResponse: redact(result.raw),
              finishedAt,
            });
            await audit.appendAudit({ ...commonAudit, eventType: 'write_failed', ok: false });

            await itemsRepo.markRemaining(
              campaign.id,
              item.position + 1,
              'interrupted',
              'Prerušené — eshop odmieta našu IP adresu; kľúč sa nedotklo.',
            );
            for (const rest of ordered.slice(index + 1)) {
              if (rest.status === 'pending') rest.status = 'interrupted';
            }
            return toNeedsKey(campaign, ordered, 'shop_ip_banned', actor, userId);
          } else if (error.kind === 'rate_limited') {
            /*
             * 429 — SHOP NÁS ZASTAVIL, nie táto položka je zlá (31. 8. 2026).
             *
             * Do tohto dňa spadol 429 do všeobecnej vetvy nižšie: položka
             * `failed` a cyklus pokračoval ďalej. Keďže dôvodom 429 je
             * vyčerpaná kvóta kľúča (a tú si appka odteraz míňa aj ČÍTANÍM —
             * obohacovanie D118 beží na tom istom kľúči), ďalšia položka
             * dostane to isté 429 a kampaň sa v PRODUKČNOM eshope dopíše len
             * spolovice: časť zliav zapísaná, zvyšok `failed`, a nikde nie je
             * napísané, že to bola kvóta a nie chyba produktov.
             *
             * Preto sa beh zastaví ako pri vyčerpanom rozpočte: zvyšok
             * zostáva `pending` (NEoznačuje sa ako chyba) a kampaň ide do
             * `queued` s dôvodom. Fronta pokračuje, keď kvóta nabehne — bez
             * ľudského zásahu a bez druhého zápisu na tie isté položky.
             * Kľúča sa to NEDOTÝKA: 429 nie je výrok o kľúči (X1).
             */
            item.status = 'failed';
            await itemsRepo.update(item.id, {
              status: 'failed',
              httpStatus: result.httpStatus,
              requestId: result.requestId,
              errorCode: error.code ?? error.kind,
              errorMessage:
                'Eshop odmietol zápis pre prekročenú kvótu (429) — kľúč je v poriadku a zostáva uložený.',
              sentPayload: redact(sentPayload),
              rawResponse: redact(result.raw),
              finishedAt,
            });
            await audit.appendAudit({ ...commonAudit, eventType: 'write_failed', ok: false });

            opLog.info('shop_rate_limited_mid_batch', {
              campaignId: campaign.id,
              productId: item.productId,
              position: item.position,
            });
            return toQueued(campaign, ordered, 'shop_rate_limited', actor);
          } else if (keyRejected) {
            /* D51/D52 — wipe + zvyšok `interrupted` + kampaň `needs_key`. */
            item.status = 'failed';
            await itemsRepo.update(item.id, {
              status: 'failed',
              httpStatus: result.httpStatus,
              requestId: result.requestId,
              errorCode: error.code ?? error.kind,
              errorMessage:
                error.kind === 'forbidden'
                  ? 'Kľúč nemá scope product:edit (D52).'
                  : 'Shop kľúč odmietol (401) — kľúč bol okamžite wipnutý (D51).',
              sentPayload: redact(sentPayload),
              rawResponse: redact(result.raw),
              finishedAt,
            });
            await audit.appendAudit({ ...commonAudit, eventType: 'write_failed', ok: false });

            await apiKeyRepo.wipe(error.kind === 'forbidden' ? 'http_403' : 'http_401');
            await itemsRepo.markRemaining(
              campaign.id,
              item.position + 1,
              'interrupted',
              'Prerušené — shop odmietol kľúč uprostred dávky (D51/D52).',
            );
            for (const rest of ordered.slice(index + 1)) {
              if (rest.status === 'pending') rest.status = 'interrupted';
            }
            return toNeedsKey(
              campaign,
              ordered,
              error.kind === 'forbidden' ? 'key_forbidden' : 'key_rejected',
              actor,
              userId,
            );
          } else {
            item.status = 'failed';
            await itemsRepo.update(item.id, {
              status: 'failed',
              httpStatus: result.httpStatus,
              requestId: result.requestId,
              errorCode: error.code ?? error.kind,
              errorMessage: error.message,
              sentPayload: redact(sentPayload),
              rawResponse: redact(result.raw),
              finishedAt,
            });
            await audit.appendAudit({ ...commonAudit, eventType: 'write_failed', ok: false });
          }
        }

        /* 6d. Pauza ≥ 3 s medzi zápismi (K2, D46, I10) — nie po poslednom.
         * Shop dovolí 20 zápisov/min; `executorFlagsFromEnv()` drží podlahu
         * `MIN_WRITE_PAUSE_MS`, spánok je závislosť kvôli testom. */
        const remaining = ordered.slice(index + 1).some((i) => i.status === 'pending');
        if (remaining) await sleepFn(flags.writePauseMs);
      }

      /* 7. Report a koncový stav (D34, §4). */
      return await finishCampaign(campaign, ordered, actor, userId);
    } finally {
      await held.release();
    }
  }

  return { executeCampaign };
}

/**
 * Default executor nad produkčnými singletonmi. Scheduler (A10) a route-y
 * (A12) volajú túto funkciu — nikdy shop klienta priamo.
 */
export async function executeCampaign(
  campaignId: number,
  deps: ExecutorDeps,
  opts: ExecuteOptions = {},
): Promise<ExecutorResultV3> {
  return createExecutor(deps).executeCampaign(campaignId, opts);
}
