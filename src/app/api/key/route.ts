/**
 * Aura Zľavy — `/api/key` GET/PUT/DELETE (BUILD-SPEC §5, §7, R2, D24, D53,
 * D63–D67, I1, I3).
 *
 * Jediná cesta, ktorou API kľúč shopu vstupuje do systému. Odkedy má appka DVA
 * kľúče (P5: `shop_write` na zápis zliav, `orders_read` na čítanie predajov),
 * pracuje táto route s oboma druhmi — druh sa vyberá parametrom `kind`
 * (query pri GET, telo pri PUT). Bez parametra je to vždy zápisový kľúč, takže
 * doterajšie chovanie a doterajší klient zostávajú nezmenené.
 *
 *  - **GET** — výhradne metadáta: `last4`, časy, `verifyStatus` (D65, I1).
 *    Celý kľúč sa NEVRÁTI nikdy a nikam — repozitár (A1) ho ani nevie vydať.
 *  - **PUT** (sudo) — kľúč sa najprv overí u shopu a až potom uloží:
 *      * `shop_write` sondou `setReduction` s `reduction=0` na neexistujúcom
 *        produkte (nikdy nič nezapíše, D53), TTL max 48 h (R2), a po uložení
 *        sa dopália kampane v stave `needs_key`, ktoré sú stále vo svojom okne
 *        (D24, D25);
 *      * `orders_read` sondou čítania objednávok, ktorú poskytuje VÝHRADNE
 *        `src/lib/shop/orders-client.ts` (I8' bod 1) a route ju dostane cez
 *        `lib/keys/orders-key-probe.ts`. TTL `ORDERS_KEY_TTL_DAYS` (P2).
 *        Kampane sa nedopaľujú — objednávkový kľúč so zápisom nemá nič
 *        spoločné (I8' bod 4).
 *    Keď sonda kľúč neprejde, kľúč sa NEULOŽÍ a používateľ dostane pravdivú
 *    hlášku — nikdy „uložené" bez uloženia.
 *  - **DELETE** (sudo) — panic button (D67): heslo + literál `KLUC UNIKOL`,
 *    wipe OBOCH kľúčov (wipe procedúru pre `panic_button` vlastní repozitár
 *    a maže cez všetky druhy naraz), zrušenie čakajúcich kampaní, audit
 *    `key_panic_wipe` za každý zmazaný kľúč a odkaz na runbook. Po incidente
 *    nič nebeží automaticky.
 *
 * Business logika je v `lib/*` (A1 repo, A3 klient, A9 executor) — route len
 * skladá kroky v normatívnom poradí.
 *
 * Vlastník: A11.
 */
import { z } from 'zod';

import type {
  CampaignRecord,
  CampaignStatus,
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
  ordersKeyRepo as defaultOrdersKeyRepo,
  API_KEY_MAX_TTL_HOURS,
  ORDERS_KEY_MAX_TTL_HOURS,
  type ApiKeyKind,
  type ApiKeyRepository,
} from '@/lib/repo/api-key.repo';
import { campaignsRepo as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { usersRepo as defaultUsersRepo } from '@/lib/repo/users.repo';
import { createShopClientFromSettings } from '@/lib/shop/client';
import { newRequestId } from '@/lib/shop/correlation';
import {
  getOrdersKeyProbe,
  registerOrdersKeyProbe,
  ORDERS_PROBE_MISSING_CODE,
  ORDERS_PROBE_MISSING_MESSAGE,
  type OrdersKeyProbe,
} from '@/lib/keys/orders-key-probe';
import { probeOrdersKeyFromSettings } from '@/lib/shop/orders-client';

/* ═══════════════════════════ zapojenie sondy ══════════════════════════════ */

/**
 * Sonda objednávkového kľúča sa registruje TU, v module route, a nie v
 * `instrumentation` ani side-effect importom. Dva dôvody z minulosti tohto
 * projektu: (1) Next.js kompiluje `instrumentation` do vlastného module grafu,
 * takže singleton z bootu NIE JE ten istý objekt, aký vidí route handler;
 * (2) side-effect import bez použitej hodnoty je kandidát na odstránenie
 * bundlerom, a Turbopack v tomto projekte už raz zahodil kód, o ktorý sme sa
 * opierali. Volanie s importovanou hodnotou je oproti tomu nespochybniteľné.
 *
 * `probeOrdersKeyFromSettings` len postaví closure — doménu shopu ani ENV
 * nečíta, kým sondu niekto nezavolá (na module scope by eager ENV lámal build).
 *
 * Testy si registráciu čistia (`resetOrdersKeyProbe()`), takže fail-closed
 * chovanie „bez sondy sa kľúč neuloží" sa dá ďalej overiť.
 */
registerOrdersKeyProbe(probeOrdersKeyFromSettings(defaultSettingsRepo));

/* ══════════════════════════════ konštanty ═════════════════════════════════ */

/** Literál potvrdenia panic buttonu (D67) — presne takto, bez diakritiky. */
export const PANIC_CONFIRM_LITERAL = 'KLUC UNIKOL' as const;

/** Runbook R5 — „kontaktuj maintainera na revokáciu kľúča" (D67). */
export const PANIC_RUNBOOK_URL = 'docs/21-RUNBOOKY.md#r5-panic-button-kluc-unikol-d67';

/**
 * Druh kľúča. Chýbajúca hodnota = zápisový kľúč do shopu, aby staršie volania
 * (a existujúce testy zápisovej cesty) fungovali bez zmeny.
 */
export const keyKindSchema = z
  .enum(['shop_write', 'orders_read'])
  .default('shop_write');

export const keyQuerySchema = z.object({
  kind: keyKindSchema,
});

export const putKeyBodySchema = z.object({
  apiKey: z.string().min(16).max(256),
  kind: keyKindSchema,
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
  /** Repozitár ZÁPISOVÉHO kľúča (`shop_write`). */
  apiKey?: ApiKeyRepository;
  /** Repozitár OBJEDNÁVKOVÉHO kľúča (`orders_read`, P5). */
  ordersKey?: ApiKeyRepository;
  campaigns?: Pick<CampaignsRepo, 'findNeedsKey' | 'list' | 'setStatus'>;
  users?: { getById(id: number): Promise<{ passwordHash: string } | null> };
  verify?: typeof verifyPassword;
  audit?: typeof appendAudit;
  /** Sonda `reduction=0` (D53). Default: shop klient nad `settings` (A3). */
  probeKey?: (key: SecretRef, ctx: ShopCtx) => Promise<KeyProbeResult>;
  /**
   * Sonda objednávkového kľúča (I8'). Default: sonda zaregistrovaná
   * objednávkovým klientom (`lib/keys/orders-key-probe.ts`). Keď nie je
   * zaregistrovaná, PUT s `kind=orders_read` fail-closed odmietne uložiť kľúč.
   */
  probeOrdersKey?: OrdersKeyProbe;
  /** Dopálenie jednej kampane (A9). Default: `engine/executor`. */
  execute?: ExecuteCampaignById;
  now?: () => Date;
  timeZone?: string;
  routeDeps?: RouteDeps;
}

function resolveDeps(deps: KeyRouteDeps) {
  const apiKey = deps.apiKey ?? defaultApiKeyRepo;
  const ordersKey = deps.ordersKey ?? defaultOrdersKeyRepo;
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
  return {
    apiKey,
    ordersKey,
    campaigns,
    users,
    verify,
    audit,
    now,
    probeKey,
    probeOrdersKey: deps.probeOrdersKey ?? null,
    execute,
    timeZone,
  };
}

/** Repozitár podľa druhu — route nikdy nesiaha na `kind` inak než cez toto. */
function repoForKind(
  resolved: Pick<ReturnType<typeof resolveDeps>, 'apiKey' | 'ordersKey'>,
  kind: ApiKeyKind,
): ApiKeyRepository {
  return kind === 'orders_read' ? resolved.ordersKey : resolved.apiKey;
}

/**
 * TTL podľa druhu kľúča. `shop_write` má `API_KEY_TTL_HOURS` so stropom 48 h
 * (R2); `orders_read` má `ORDERS_KEY_TTL_DAYS` (default 30 dní) so stropom
 * 90 dní — vedomá odchýlka P2, kľúč je len na čítanie a nevidí osobné údaje.
 * Keď ENV nie je čitateľné, použije sa strop druhu (nikdy dlhšie).
 */
export function ttlHoursForKind(kind: ApiKeyKind): number {
  if (kind === 'orders_read') {
    try {
      return Math.min(env.ORDERS_KEY_TTL_DAYS * 24, ORDERS_KEY_MAX_TTL_HOURS);
    } catch {
      return Math.min(30 * 24, ORDERS_KEY_MAX_TTL_HOURS);
    }
  }
  try {
    return Math.min(env.API_KEY_TTL_HOURS, API_KEY_MAX_TTL_HOURS);
  } catch {
    return API_KEY_MAX_TTL_HOURS;
  }
}

/** Hlášky sondy podľa druhu kľúča — pravdivé a konkrétne, nikdy generické. */
const PROBE_REJECTION: Record<ApiKeyKind, { invalid: string; forbidden: string }> = {
  shop_write: {
    invalid:
      'Shop tento API kľúč odmietol (401) — kľúč sa NEULOŽIL. Skontroluj, či je skopírovaný celý.',
    forbidden:
      'Kľúč shop prijal, ale nemá scope product:edit (403) — kľúč sa NEULOŽIL. Vygeneruj kľúč so správnym scope.',
  },
  orders_read: {
    invalid:
      'Shop tento objednávkový kľúč odmietol (401) — kľúč sa NEULOŽIL. Skontroluj, či je skopírovaný celý.',
    forbidden:
      'Kľúč shop prijal, ale čítanie objednávok mu nepovolil (403) — kľúč sa NEULOŽIL. Vygeneruj kľúč so scope na čítanie objednávok.',
  },
};

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
  const resolved = resolveDeps(deps);

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      query: keyQuerySchema,
      handler: async (ctx) => {
        // Tvar odpovede je pre oba druhy ROVNAKÝ a plochý. Zámerne sa nevnára do
        // poľa `…Key`: redaktor (I1) maskuje polia s koncovkou `key` celé a UI by
        // potom tvrdilo, že kľúč chýba (presne ten bug, ktorý riešila výnimka
        // `{present, expiresAt}` v `lib/log/redact.ts`).
        // `getMeta()` vracia VÝHRADNE last4 + časy + verifyStatus (D65, I1).
        const meta = await repoForKind(resolved, ctx.query.kind).getMeta();
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
  const { probeKey } = resolved;

  return defineRoute(
    {
      method: 'PUT',
      auth: 'sudo',
      body: putKeyBodySchema,
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'key-put' },
      handler: async (ctx) => {
        const kind: ApiKeyKind = ctx.body.kind;
        const repo = repoForKind(resolved, kind);

        /* 1. Sonda PRED uložením — pre `shop_write` `reduction=0` (D53, nikdy
         * nič nezapíše), pre `orders_read` čítanie objednávok z jediného
         * povoleného modulu (I8'). Bez prejdenej sondy sa NEUKLADÁ nič. */
        const operationId: Ulid = newRequestId();
        const probe = await ((): Promise<KeyProbeResult> => {
          if (kind === 'shop_write') {
            return probeKey(ephemeralSecretRef(ctx.body.apiKey), { operationId });
          }
          const ordersProbe = resolved.probeOrdersKey ?? getOrdersKeyProbe();
          if (!ordersProbe) {
            // Fail-closed: neoverený kľúč sa neuloží a hláška je pravdivá.
            throw conflict(ORDERS_PROBE_MISSING_MESSAGE, ORDERS_PROBE_MISSING_CODE, {
              logAsError: false,
            });
          }
          return ordersProbe(ephemeralSecretRef(ctx.body.apiKey), { operationId });
        })();

        if (probe === 'invalid') {
          throw conflict(PROBE_REJECTION[kind].invalid, 'key_invalid', { logAsError: false });
        }
        if (probe === 'forbidden') {
          throw conflict(PROBE_REJECTION[kind].forbidden, 'key_invalid', { logAsError: false });
        }

        /* 2. Uloženie zašifrované, TTL podľa druhu (R2 pre zápis, P2 pre
         * objednávky). `store()` plaintext wipne. */
        const ttlHours = ttlHoursForKind(kind);
        const plain = Buffer.from(ctx.body.apiKey, 'utf8');
        const stored = await repo.store(plain, ctx.body.apiKey.slice(-4), ttlHours, undefined, {
          userId: ctx.claims.sub,
        });

        /* 3. Verify status podľa sondy; `unknown` (sieť) = `unverified`. */
        const verifyStatus = probe === 'valid' ? 'valid' : 'unverified';
        await repo.setVerifyStatus(verifyStatus);

        /* 4. D24 — dopálenie `needs_key` kampaní, ktoré sú stále vo svojom okne.
         * Výhradne pre zápisový kľúč: objednávkový kľúč nemá so zápisom zliav
         * nič spoločné (I8' bod 4), takže ním sa nikdy nič nedopaľuje. */
        if (kind === 'shop_write' && verifyStatus === 'valid') {
          await relightNeedsKeyCampaigns(resolved, ctx.claims.sub, ctx.log);
        }

        return { last4: stored.last4, expiresAt: stored.expiresAt, verifyStatus, kind };
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

        /* 2. Okamžitý wipe (prepis náhodnými bajtmi → DELETE → audit, D63).
         *
         * Jedno volanie mazá OBA kľúče: `panic_button` je v repozitári zámerne
         * jediný dôvod, ktorý ignoruje `kind` a prejde celú tabuľku (P5, D67,
         * akceptačné kritérium 3). Route preto NESMIE mazať po druhoch v cykle —
         * tretí druh kľúča by taký cyklus tichým opomenutím obišiel. */
        await apiKey.wipe('panic_button', undefined, {
          actor: 'user',
          userId: ctx.claims.sub,
          message: `panic button „${PANIC_CONFIRM_LITERAL}" — kľúč unikol (D67)`,
        });

        /* 3. Zrušenie VŠETKÝCH čakajúcich kampaní — po incidente nič nebeží samo.
         * Repozitár `list()` clampuje `perPage` na 100, preto sa stránkuje:
         * zrušené kampane z filtra vypadnú, takže sa vždy číta 1. stránka,
         * kým nie je prázdna. Tvrdý strop iterácií je poistka proti zacykleniu,
         * keby `setStatus` stav nezmenil. */
        let cancelled = 0;
        // `draft`/`scheduled`/`needs_key`/`missed` — zrušiteľné stavy (§4).
        const waitingStatuses: CampaignStatus[] = ['draft', 'scheduled', 'needs_key', 'missed'];
        for (let pass = 0; pass < 1000; pass += 1) {
          const waiting = await campaigns.list({
            status: waitingStatuses,
            page: 1,
            perPage: 100,
          });
          if (waiting.data.length === 0) break;
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
          // Táto dávka pokryla všetko, čo filter ešte videl.
          if (waiting.data.length >= waiting.total) break;
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
