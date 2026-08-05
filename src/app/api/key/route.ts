/**
 * Aura Zľavy — `/api/key` GET/PUT/DELETE (BUILD-SPEC §5, §7, R2, D24, D53,
 * D63–D67, I1, I3).
 *
 * Jediná cesta, ktorou API kľúč shopu vstupuje do systému:
 *
 *  - **GET** — výhradne metadáta: `last4`, časy, `verifyStatus` (D65, I1).
 *    Celý kľúč sa NEVRÁTI nikdy a nikam — repozitár (A1) ho ani nevie vydať.
 *  - **PUT** (sudo) — kľúč sa najprv overí sondou `setReduction` s
 *    `reduction=0` na neexistujúcom produkte (nikdy nič nezapíše, D53),
 *    až potom sa uloží zašifrovaný s TTL max 48 h (R2) a spustí sa
 *    auto-dopálenie kampaní v stave `needs_key`, ktoré sú stále vo svojom
 *    okne (D24, D25).
 *  - **DELETE** (sudo) — panic button (D67): heslo + literál `KLUC UNIKOL`,
 *    wipe kľúča, zrušenie čakajúcich kampaní, audit `key_panic_wipe`
 *    a odkaz na runbook. Po incidente nič nebeží automaticky.
 *
 * Business logika je v `lib/*` (A1 repo, A3 klient, A9 executor) — route len
 * skladá kroky v normatívnom poradí.
 *
 * Vlastník: A11.
 */
import { z } from 'zod';

import type {
  CampaignRecord,
  CampaignsRepo,
  ExecutorResult,
  KeyProbeResult,
  SecretRef,
  ShopCtx,
  Ulid,
} from '@/contracts';

import { env } from '@/env';
import { verifyPassword } from '@/lib/auth';
import { appendAudit } from '@/lib/audit/write';
import { wipeBuffer } from '@/lib/crypto/secret-box';
import { resolveFireWindow } from '@/lib/domain/campaign-rules';
import { todayInZone } from '@/lib/domain/dates';
import { executeCampaign, type ExecuteOptions } from '@/lib/engine/executor';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { conflict, unauthorized } from '@/lib/http/errors';
import {
  apiKeyRepo as defaultApiKeyRepo,
  API_KEY_MAX_TTL_HOURS,
  type ApiKeyRepository,
} from '@/lib/repo/api-key.repo';
import { campaignsRepo as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { usersRepo as defaultUsersRepo } from '@/lib/repo/users.repo';
import { createShopClientFromSettings } from '@/lib/shop/client';
import { newRequestId } from '@/lib/shop/correlation';

/* ══════════════════════════════ konštanty ═════════════════════════════════ */

/** Literál potvrdenia panic buttonu (D67) — presne takto, bez diakritiky. */
export const PANIC_CONFIRM_LITERAL = 'KLUC UNIKOL' as const;

/** Runbook R5 — „kontaktuj maintainera na revokáciu kľúča" (D67). */
export const PANIC_RUNBOOK_URL = 'docs/21-RUNBOOKY.md#r5-panic-button-kluc-unikol-d67';

export const putKeyBodySchema = z.object({
  apiKey: z.string().min(16).max(256),
});

export const deleteKeyBodySchema = z.object({
  password: z.string().min(1).max(200),
  confirm: z.literal(PANIC_CONFIRM_LITERAL),
});

/* ═══════════════════════════ závislosti route ═════════════════════════════ */

export type ExecuteCampaignById = (
  campaignId: number,
  opts: ExecuteOptions,
) => Promise<ExecutorResult>;

export interface KeyRouteDeps {
  apiKey?: ApiKeyRepository;
  campaigns?: Pick<CampaignsRepo, 'findNeedsKey' | 'list' | 'setStatus'>;
  users?: { getById(id: number): Promise<{ passwordHash: string } | null> };
  verify?: typeof verifyPassword;
  audit?: typeof appendAudit;
  /** Sonda `reduction=0` (D53). Default: shop klient nad `settings` (A3). */
  probeKey?: (key: SecretRef, ctx: ShopCtx) => Promise<KeyProbeResult>;
  /** Dopálenie jednej kampane (A9). Default: `engine/executor`. */
  execute?: ExecuteCampaignById;
  now?: () => Date;
  timeZone?: string;
  routeDeps?: RouteDeps;
}

function resolveDeps(deps: KeyRouteDeps) {
  const apiKey = deps.apiKey ?? defaultApiKeyRepo;
  const campaigns = deps.campaigns ?? defaultCampaignsRepo;
  const users = deps.users ?? defaultUsersRepo;
  const verify = deps.verify ?? verifyPassword;
  const audit = deps.audit ?? appendAudit;
  const now = deps.now ?? (() => new Date());
  const probeKey =
    deps.probeKey ??
    ((key: SecretRef, ctx: ShopCtx) =>
      createShopClientFromSettings(defaultSettingsRepo).probeKey(key, ctx));
  const execute: ExecuteCampaignById =
    deps.execute ??
    ((campaignId, opts) =>
      executeCampaign(
        campaignId,
        { shopClient: createShopClientFromSettings(defaultSettingsRepo) },
        opts,
      ));
  const timeZone = deps.timeZone ?? ((): string => {
    try {
      return env.LOGIC_TIMEZONE;
    } catch {
      return 'Europe/Bratislava';
    }
  })();
  return { apiKey, campaigns, users, verify, audit, now, probeKey, execute, timeZone };
}

/** `SecretRef` nad plaintextom z tela requestu — len pre sondu (D53, D64). */
function ephemeralSecretRef(plaintext: string): SecretRef {
  return async () => {
    const value = Buffer.from(plaintext, 'utf8');
    return {
      value,
      release: () => {
        wipeBuffer(value);
      },
    };
  };
}

/* ═══════════════ D24 — auto-dopálenie `needs_key` kampaní ═════════════════ */

/**
 * Po uložení platného kľúča sa dopália kampane v `needs_key`, ktoré sú stále
 * vo svojom okne (D24). Okno sa prepočítava podľa D25: celé v minulosti →
 * `lapsed` (žiadny zápis), `from` v minulosti → posun na dnes s auditom.
 * Chyba jednej kampane nezastaví ostatné a nikdy nezhodí PUT — kľúč už je
 * uložený a scheduler si zvyšok vezme v ďalšom ticku.
 */
export async function relightNeedsKeyCampaigns(
  deps: Pick<
    ReturnType<typeof resolveDeps>,
    'campaigns' | 'audit' | 'execute' | 'now' | 'timeZone'
  >,
  userId: number,
  log: { warn(msg: string, fields?: Record<string, unknown>): void },
): Promise<{ relit: number; lapsed: number; failed: number }> {
  const outcome = { relit: 0, lapsed: 0, failed: 0 };
  let waiting: CampaignRecord[];
  try {
    waiting = await deps.campaigns.findNeedsKey();
  } catch (error) {
    log.warn('relight_list_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return outcome;
  }

  const today = todayInZone(deps.now(), deps.timeZone);

  for (const campaign of waiting) {
    try {
      const window = resolveFireWindow(campaign.dateFrom, campaign.dateTo, today);

      if (window.action === 'lapse') {
        await deps.campaigns.setStatus(campaign.id, 'lapsed', {
          statusReason: window.reason,
          finishedAt: deps.now(),
        });
        await deps.audit({
          actor: 'user',
          userId,
          eventType: 'campaign_lapsed',
          ok: false,
          campaignId: campaign.id,
          operationId: campaign.operationId,
          message: window.reason,
        });
        outcome.lapsed += 1;
        continue;
      }

      if (window.action === 'shift_from') {
        await deps.campaigns.setStatus(campaign.id, 'needs_key', {
          dateFrom: window.from,
          dateFromOriginal: campaign.dateFromOriginal ?? window.originalFrom,
        });
        await deps.audit({
          actor: 'user',
          userId,
          eventType: 'campaign_from_shifted',
          ok: true,
          campaignId: campaign.id,
          operationId: campaign.operationId,
          message: `Posun date_from z ${window.originalFrom} na ${window.from} pri dopálení po zadaní kľúča (D24, D25).`,
        });
      }

      // Claim `needs_key` → running, guardy, potvrdenie (I3) a sekvenčný zápis
      // rieši executor (A9) — tu sa shop nevolá nikdy priamo.
      const result = await deps.execute(campaign.id, { actor: 'user', userId });
      if (result.status !== 'needs_key') outcome.relit += 1;
    } catch (error) {
      // Fail-closed: kampaň zostáva v `needs_key`/`missed`, nič sa nezapísalo navyše.
      outcome.failed += 1;
      log.warn('relight_campaign_failed', {
        campaignId: campaign.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcome;
}

/* ════════════════════════════════ GET ═════════════════════════════════════ */

export function createKeyGetRoute(deps: KeyRouteDeps = {}): NextRouteHandler {
  const { apiKey } = resolveDeps(deps);

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: async () => {
        // `getMeta()` vracia VÝHRADNE last4 + časy + verifyStatus (D65, I1).
        const meta = await apiKey.getMeta();
        return {
          present: meta.present,
          last4: meta.last4,
          savedAt: meta.savedAt,
          expiresAt: meta.expiresAt,
          secondsLeft: meta.secondsLeft,
          verifyStatus: meta.verifyStatus,
        };
      },
    },
    deps.routeDeps,
  );
}

/* ════════════════════════════════ PUT ═════════════════════════════════════ */

export function createKeyPutRoute(deps: KeyRouteDeps = {}): NextRouteHandler {
  const resolved = resolveDeps(deps);
  const { apiKey, probeKey } = resolved;

  return defineRoute(
    {
      method: 'PUT',
      auth: 'sudo',
      body: putKeyBodySchema,
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'key-put' },
      handler: async (ctx) => {
        /* 1. Sonda `reduction=0` PRED uložením — nikdy nič nezapíše (D53). */
        const operationId: Ulid = newRequestId();
        const probe = await probeKey(ephemeralSecretRef(ctx.body.apiKey), { operationId });

        if (probe === 'invalid') {
          throw conflict(
            'Shop tento API kľúč odmietol (401) — kľúč sa NEULOŽIL. Skontroluj, či je skopírovaný celý.',
            'key_invalid',
            { logAsError: false },
          );
        }
        if (probe === 'forbidden') {
          throw conflict(
            'Kľúč shop prijal, ale nemá scope product:edit (403) — kľúč sa NEULOŽIL. Vygeneruj kľúč so správnym scope.',
            'key_invalid',
            { logAsError: false },
          );
        }

        /* 2. Uloženie zašifrované, TTL max 48 h (R2). `store()` plaintext wipne. */
        const ttlHours = ((): number => {
          try {
            return Math.min(env.API_KEY_TTL_HOURS, API_KEY_MAX_TTL_HOURS);
          } catch {
            return API_KEY_MAX_TTL_HOURS;
          }
        })();
        const plain = Buffer.from(ctx.body.apiKey, 'utf8');
        const stored = await apiKey.store(plain, ctx.body.apiKey.slice(-4), ttlHours, undefined, {
          userId: ctx.claims.sub,
        });

        /* 3. Verify status podľa sondy; `unknown` (sieť) = `unverified`. */
        const verifyStatus = probe === 'valid' ? 'valid' : 'unverified';
        await apiKey.setVerifyStatus(verifyStatus);

        /* 4. D24 — dopálenie `needs_key` kampaní, ktoré sú stále vo svojom okne. */
        if (verifyStatus === 'valid') {
          await relightNeedsKeyCampaigns(resolved, ctx.claims.sub, ctx.log);
        }

        return { last4: stored.last4, expiresAt: stored.expiresAt, verifyStatus };
      },
    },
    deps.routeDeps,
  );
}

/* ═══════════════════════════════ DELETE ═══════════════════════════════════ */

export function createKeyDeleteRoute(deps: KeyRouteDeps = {}): NextRouteHandler {
  const { apiKey, campaigns, users, verify, audit, now } = resolveDeps(deps);

  return defineRoute(
    {
      method: 'DELETE',
      auth: 'sudo',
      body: deleteKeyBodySchema,
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'key-delete' },
      handler: async (ctx) => {
        /* 1. Heslo znova aj v sudo okne — panic button je nevratný (D67). */
        const user = await users.getById(ctx.claims.sub);
        const matches = await verify(user?.passwordHash ?? null, ctx.body.password);
        if (!matches) {
          throw unauthorized('Nesprávne heslo.', 'invalid_password', { logAsError: false });
        }

        /* 2. Okamžitý wipe (prepis náhodnými bajtmi → DELETE → audit, D63). */
        await apiKey.wipe('panic_button', undefined, {
          actor: 'user',
          userId: ctx.claims.sub,
          message: `panic button „${PANIC_CONFIRM_LITERAL}" — kľúč unikol (D67)`,
        });

        /* 3. Zrušenie VŠETKÝCH čakajúcich kampaní — po incidente nič nebeží samo. */
        let cancelled = 0;
        // `draft`/`scheduled`/`needs_key`/`missed` — zrušiteľné stavy (§4).
        const waiting = await campaigns.list({
          status: ['draft', 'scheduled', 'needs_key', 'missed'],
          page: 1,
          perPage: 1000,
        });
        for (const campaign of waiting.data) {
          await campaigns.setStatus(campaign.id, 'cancelled', {
            statusReason: 'panic_button: kľúč unikol, kampaň zrušená (D67).',
            finishedAt: now(),
          });
          await audit({
            actor: 'user',
            userId: ctx.claims.sub,
            eventType: 'campaign_cancelled',
            ok: true,
            campaignId: campaign.id,
            operationId: campaign.operationId,
            message: 'Zrušené panic buttonom (D67).',
          });
          cancelled += 1;
        }

        return { wiped: true, cancelledCampaigns: cancelled, runbookUrl: PANIC_RUNBOOK_URL };
      },
    },
    deps.routeDeps,
  );
}

/* ══════════════════════ Next.js exporty (produkčné) ═══════════════════════ */

export const GET = createKeyGetRoute();
export const PUT = createKeyPutRoute();
export const DELETE = createKeyDeleteRoute();
