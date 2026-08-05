/**
 * Aura Zľavy — SEKVENČNÝ EXECUTOR ZÁPISOVEJ DÁVKY (BUILD-SPEC §9).
 *
 * Toto je JEDINÉ miesto v celej appke, ktoré volá `setReduction`. Route-y aj
 * scheduler zapisujú výhradne cez `executeCampaign()`.
 *
 * Poradie krokov (normatívne, §9):
 *   mutex (D37, I12) → guardy (I2/I9/I12/I13, D79) → potvrdenie (I3) → kľúč
 *   → per položka: pre-write GET (D48) → D36 skip → audit `write_attempt`
 *   → `setReduction` → vyhodnotenie → pauza 250 ms (D46, I10).
 *
 * Tvrdé pravidlá:
 *   - **I10** — položky idú prísne sekvenčne podľa `position`; v tomto súbore
 *     ani jeden `Promise.all` nad zápismi neexistuje a existovať nesmie.
 *   - **I3** — bez `confirmed_at` + `confirm_payload_hash` (zhodný s hashom
 *     skutočnej sady) + `sudo_at` sa NEODOŠLE ani jeden request.
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
  CampaignsRepo,
  CampaignItemsRepo,
  AllowlistRepo,
  ApiKeyRepo,
  SettingsRepo,
  ExecutorResult,
  SecretRef,
  ShopClient,
  ShopCtx,
  Ulid,
  WriteMutex,
} from '@/contracts';

import { env } from '@/env';
import { auditWriter as defaultAuditWriter } from '@/lib/audit/write';
import { computePayloadHash } from '@/lib/crypto/preview-token';
import { resolveFinalStatus } from '@/lib/domain/status';
import { logger as defaultLogger } from '@/lib/log/logger';
import { redact } from '@/lib/log/redact';
import { apiKeyRepo as defaultApiKeyRepo } from '@/lib/repo/api-key.repo';
import { allowlistRepo as defaultAllowlistRepo } from '@/lib/repo/allowlist.repo';
import { auditRepo as defaultAuditRepo } from '@/lib/repo/audit.repo';
import { campaignItemsRepo as defaultCampaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepo as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { newRequestId } from '@/lib/shop/correlation';
import { setReductionPayload } from '@/lib/shop/client';

import {
  checkRunawayAndMaybeLock,
  guardFlagsFromEnv,
  runPreWriteGuards,
  type GuardFlags,
  type GuardsDeps,
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

/* ═══════════════════════════ závislosti ═══════════════════════════════════ */

export interface ExecutorFlags extends GuardFlags {
  /** Pauza medzi zápismi (D46, I10). Default `SHOP_WRITE_PAUSE_MS` (250). */
  writePauseMs: number;
}

export function executorFlagsFromEnv(): ExecutorFlags {
  return { ...guardFlagsFromEnv(), writePauseMs: env.SHOP_WRITE_PAUSE_MS };
}

export interface ExecutorDeps {
  shopClient: Pick<ShopClient, 'getProduct' | 'setReduction'>;
  campaignsRepo?: Pick<CampaignsRepo, 'getById' | 'claim' | 'setStatus' | 'lastOwnWrite'>;
  campaignItemsRepo?: Pick<CampaignItemsRepo, 'listByCampaign' | 'update' | 'markRemaining'>;
  allowlistRepo?: Pick<AllowlistRepo, 'areAllActive' | 'markShopStatus'>;
  settingsRepo?: Pick<SettingsRepo, 'get' | 'lockWrites'>;
  auditRepo?: { countWritesInLastHour(): Promise<number> };
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
  /** ID prihláseného usera (pri `actor='user'`). */
  userId?: number | null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/* ═══════════════════════════ potvrdenie (I3) ══════════════════════════════ */

/**
 * I3 — kampaň musí mať doložený dry-run + potvrdenie + sudo. Hash sa
 * prepočítava z reálnej sady položiek: podvrhnutá kampaň s cudzím hashom
 * neprejde a na shop nedorazí žiadny request.
 */
export function assertConfirmed(campaign: CampaignRecord, items: CampaignItemRecord[]): void {
  if (campaign.confirmedAt === null || campaign.confirmPayloadHash === null) {
    throw new EngineError(
      'confirmation_missing',
      'Kampaň nemá doložený potvrdený dry-run (confirmed_at + confirm_payload_hash) — zápis je zakázaný (I3).',
      { campaignId: campaign.id },
    );
  }
  if (campaign.sudoAt === null) {
    throw new EngineError(
      'confirmation_missing',
      'Kampaň nemá doložené sudo potvrdenie — zápis je zakázaný (I3, D70).',
      { campaignId: campaign.id },
    );
  }
  const expected = computePayloadHash({
    kind: campaign.kind,
    productIds: items.map((i) => i.productId).sort((a, b) => a - b),
    percent: campaign.percent,
    from: campaign.dateFrom,
    to: campaign.dateTo,
  });
  if (expected !== campaign.confirmPayloadHash) {
    throw new EngineError(
      'confirmation_mismatch',
      'Potvrdený dry-run sa nezhoduje so skutočnou sadou kampane — zápis je odmietnutý (I3).',
      { campaignId: campaign.id },
    );
  }
}

/* ═══════════════════════════ executor ═════════════════════════════════════ */

export function createExecutor(deps: ExecutorDeps): {
  executeCampaign(campaignId: number, opts?: ExecuteOptions): Promise<ExecutorResult>;
} {
  const campaignsRepo = deps.campaignsRepo ?? defaultCampaignsRepo;
  const itemsRepo = deps.campaignItemsRepo ?? defaultCampaignItemsRepo;
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
    ...(deps.timeZone !== undefined ? { timeZone: deps.timeZone } : {}),
  };

  async function loadCampaign(campaignId: number): Promise<{
    campaign: CampaignRecord;
    items: CampaignItemRecord[];
  }> {
    const campaign = await campaignsRepo.getById(campaignId);
    if (campaign === null) {
      throw new EngineError('campaign_not_found', `Kampaň ${campaignId} neexistuje.`);
    }
    const items = await itemsRepo.listByCampaign(campaignId);
    return { campaign, items };
  }

  async function finishCampaign(
    campaign: CampaignRecord,
    items: CampaignItemRecord[],
    actor: 'user' | 'scheduler',
  ): Promise<ExecutorResult> {
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
    campaign: CampaignRecord,
    items: CampaignItemRecord[],
    reason: string,
    actor: 'user' | 'scheduler',
  ): Promise<ExecutorResult> {
    await campaignsRepo.setStatus(campaign.id, 'needs_key', {
      statusReason: reason,
      needsKeySince: now(),
    });
    await audit.appendAudit({
      actor,
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

  /** D36 — retry preskočí produkt s potvrdeným OK zápisom identických parametrov. */
  async function isAlreadyWritten(
    campaign: CampaignRecord,
    productId: number,
  ): Promise<boolean> {
    if (campaign.kind !== 'retry') return false;
    const last = await campaignsRepo.lastOwnWrite(productId);
    return (
      last !== null &&
      last.percent === campaign.percent &&
      last.from === campaign.dateFrom &&
      last.to === campaign.dateTo
    );
  }

  async function executeCampaign(
    campaignId: number,
    opts: ExecuteOptions = {},
  ): Promise<ExecutorResult> {
    installSigtermHandler();
    const actor = opts.actor ?? 'user';

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
        return toNeedsKey(campaign, items, 'no_key', actor);
      }

      /* 5. Claim → running (D84). Ak kampaň ešte nie je `running`, prevezmi ju. */
      if (campaign.status !== 'running') {
        // `missed` tu ZÁMERNE nie je (D33b): zmeškanú kampaň smie claimnúť len
        // manuálna route s NOVÝM potvrdením — executor ju z `missed` neprevezme.
        const claimed = await campaignsRepo.claim(campaign.id, ['scheduled', 'needs_key', 'draft']);
        if (!claimed) {
          throw new EngineError(
            'campaign_not_claimable',
            `Kampaň ${campaign.id} sa nedá spustiť zo stavu „${campaign.status}" — pravdepodobne ju už spracúva iný beh (D84).`,
          );
        }
        await audit.appendAudit({
          actor,
          eventType: 'campaign_claimed',
          ok: true,
          campaignId: campaign.id,
          operationId,
        });
      }
      await campaignsRepo.setStatus(campaign.id, 'running', { startedAt: now() });

      /* 6. Sekvenčná dávka (I10, D46). ŽIADNY Promise.all. */
      const ordered = [...items].sort((a, b) => a.position - b.position);
      const flags = flagsOf();

      for (let index = 0; index < ordered.length; index += 1) {
        const item = ordered[index] as CampaignItemRecord;
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
        if (await isAlreadyWritten(campaign, item.productId)) {
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

        /* 6c. Zápis. Payload je presne to, čo pošle klient (D50). */
        const params = {
          id: item.productId,
          from: campaign.dateFrom,
          to: campaign.dateTo,
          reduction: campaign.percent,
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

        const result = await deps.shopClient.setReduction(params, keyRef, ctx);
        await apiKeyRepo.touchLastUsed();
        const finishedAt = now();

        const commonAudit = {
          actor,
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
          const keyRejected = error.kind === 'unauthorized' || error.kind === 'forbidden';

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

        /* 6d. Pauza 250 ms medzi zápismi (D46, I10) — nie po poslednom. */
        const remaining = ordered.slice(index + 1).some((i) => i.status === 'pending');
        if (remaining) await sleepFn(flags.writePauseMs);
      }

      /* 7. Report a koncový stav (D34, §4). */
      return await finishCampaign(campaign, ordered, actor);
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
): Promise<ExecutorResult> {
  return createExecutor(deps).executeCampaign(campaignId, opts);
}
