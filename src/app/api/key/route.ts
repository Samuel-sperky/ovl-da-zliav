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
 *  - **GET** — výhradne metadáta: `last4`, časy, `verifyStatus` (D65, I1)
 *    a posledné známe oprávnenia kľúča (v5, bod D3).
 *    Celý kľúč sa NEVRÁTI nikdy a nikam — repozitár (A1) ho ani nevie vydať.
 *  - **PUT** (sudo) — kľúč sa najprv overí u shopu a až potom uloží:
 *      * `shop_write` cez `GET /api/whoami` (v5). TTL max 48 h (R2), a po
 *        uložení sa dopália kampane v stave `needs_key`, ktoré sú stále vo
 *        svojom okne (D24, D25);
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
 * ČO SA ZMENILO S API v5 A ČO SA V TOM NESMIE POKAZIŤ
 * ---------------------------------------------------
 * Do v4 sa zápisový kľúč overoval sondou `POST /api/products/setReduction`
 * s `reduction=0` na neexistujúcom produkte. Sonda nikdy nič nezapísala, ale
 * bila na PRODUKČNÝ zápisový endpoint a v štatistike shopu vyzerala ako zápis.
 * V5 pridal `GET /api/whoami`, takže overenie je odteraz čítanie.
 *
 * Má to jeden dôsledok, ktorý sa NESMIE prehliadnuť: **sonda mimochodom
 * overovala aj scope.** Kľúč bez `product:edit` na nej dostal 403 a neuložil sa.
 * `whoami` nevyžaduje žiadny scope, takže ním prejde aj kľúč, ktorý zapisovať
 * nesmie. Tú kontrolu preto robí táto route výslovne (`requiredScopeForKind`)
 * — bez nej by sa dal ako zápisový uložiť napríklad objednávkový kľúč a zlyhalo
 * by to až pri prvom skutočnom zápise zľavy, uprostred kampane.
 *
 * Z `whoami` sa ďalej NIKDY nevracia `id`, `name` ani `owner` kľúča (I1) —
 * `shop/client.ts` ich zámerne ani neparsuje. Von ide uzavretý číselník scopes
 * a dve čísla zostatku rozpočtu.
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
import {
  executeCampaign,
  type ExecuteOptions,
  type ExecutorResultV3,
} from '@/lib/engine/executor';
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
import {
  createShopClientFromSettings,
  hasShopScope,
  missingScopeSentence,
  type ShopScope,
  type WhoamiInfo,
  type WhoamiOutcome,
} from '@/lib/shop/client';
import { newRequestId } from '@/lib/shop/correlation';
import {
  keyedBudgetSentence,
  resolveKeyedBudget,
  type KeyedBudget,
  type RemainingFromWhoami,
} from '@/lib/shop/rate-limits';
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

/**
 * Dopálenie jednej kampane. Návratový typ je `ExecutorResultV3` (K2): odkedy je
 * zápis fronta, smie dávka skončiť aj v stave `queued` — vyčerpaný denný
 * rozpočet nie je chyba, je to informácia (odpoveď 59). `ExecutorResult`
 * z kontraktov ten stav nepozná; typ preto ide z engine, nie z `contracts.ts` —
 * inak by zmena v engine skončila ako `as` a tichá diera (nález E1).
 */
export type ExecuteCampaignById = (
  campaignId: number,
  opts: ExecuteOptions,
) => Promise<ExecutorResultV3>;

export interface KeyRouteDeps {
  /** Repozitár ZÁPISOVÉHO kľúča (`shop_write`). */
  apiKey?: ApiKeyRepository;
  /** Repozitár OBJEDNÁVKOVÉHO kľúča (`orders_read`, P5). */
  ordersKey?: ApiKeyRepository;
  campaigns?: Pick<CampaignsRepo, 'findNeedsKey' | 'list' | 'setStatus'>;
  users?: { getById(id: number): Promise<{ passwordHash: string } | null> };
  verify?: typeof verifyPassword;
  audit?: typeof appendAudit;
  /**
   * Overenie zápisového kľúča cez `GET /api/whoami` (v5). Default: shop klient
   * nad `settings` (A3). Toto je jediná cesta, ktorou sa dozvieme scopes.
   */
  inspectKey?: (key: SecretRef, ctx: ShopCtx) => Promise<WhoamiOutcome>;
  /**
   * Náhrada overenia, ktorá vracia len „platí / neplatí".
   *
   * Existuje pre volajúcich (a testy), ktorí nechcú stavať celú `whoami`
   * odpoveď. Keď je uvedená, PREBIJE `inspectKey` — a appka potom scopes kľúča
   * NEPOZNÁ, takže povie „nevieme" namiesto toho, aby si niečo domyslela.
   */
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
  const inspectKey =
    deps.inspectKey ??
    ((key: SecretRef, ctx: ShopCtx) =>
      createShopClientFromSettings(defaultSettingsRepo).whoami(key, ctx));
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
    inspectKey,
    // `null` = nikto vlastné overenie nedodal, ide sa cez `whoami`.
    probeKey: deps.probeKey ?? null,
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

/** Hlášky overenia podľa druhu kľúča — pravdivé a konkrétne, nikdy generické. */
const PROBE_REJECTION: Record<ApiKeyKind, { invalid: string; forbidden: string }> = {
  shop_write: {
    invalid:
      'Shop tento API kľúč odmietol (401) — kľúč sa NEULOŽIL. Skontroluj, či je skopírovaný celý.',
    forbidden:
      'Shop tento kľúč zablokoval (403) — kľúč sa NEULOŽIL. Over si u správcu shopu, či je kľúč ešte platný.',
  },
  orders_read: {
    invalid:
      'Shop tento objednávkový kľúč odmietol (401) — kľúč sa NEULOŽIL. Skontroluj, či je skopírovaný celý.',
    forbidden:
      'Kľúč shop prijal, ale čítanie objednávok mu nepovolil (403) — kľúč sa NEULOŽIL. Vygeneruj kľúč so scope na čítanie objednávok.',
  },
};

/* ═══════════════ oprávnenia kľúča (v5, bod D3) ════════════════════════════ */

/**
 * Scope, bez ktorého kľúč daného druhu nemá zmysel ukladať.
 *
 * Do v4 to overovala sonda mimochodom (403 na `setReduction`). `whoami` scope
 * nevyžaduje, takže sa to musí skontrolovať tu — inak by sa ako zápisový uložil
 * aj kľúč, ktorý zapisovať nesmie.
 *
 * Pre `orders_read` zostáva overením čítanie objednávok cez `orders-client.ts`
 * (I8'); scope sa mu tu nekontroluje, lebo `whoami` sa preň nevolá.
 */
export function requiredScopeForKind(kind: ApiKeyKind): ShopScope | null {
  return kind === 'shop_write' ? 'product:edit' : null;
}

/** `whoami` → „platí / neplatí" v reči, ktorej rozumie zvyšok route (D53). */
export function whoamiToProbeResult(outcome: WhoamiOutcome): KeyProbeResult {
  switch (outcome.status) {
    case 'ok':
      return 'valid';
    case 'invalid':
      return 'invalid';
    case 'forbidden':
      return 'forbidden';
    case 'address_banned':
      return 'address_banned';
    default:
      // 429, 500, timeout, zmenený tvar odpovede — nikdy sa z toho nestane
      // „kľúč platí"; uloží sa ako neoverený (fail-closed).
      return 'unknown';
  }
}

/**
 * Čo appka o oprávneniach kľúča vie a čo z toho plynie — v jednom tvare pre
 * GET aj PUT, aby obe obrazovky hovorili to isté.
 *
 * `productRead` je trojstavové: `true` má, `false` nemá, `null` NEVIEME.
 * Mlčanie je najhoršia možnosť — kľúč so `product:read` zatiaľ nemáme a keď
 * príde, musí byť na prvý pohľad vidieť, že sa niečo zmenilo.
 */
export interface KeyScopeReport {
  /** Posledné známe scopes; `null` = nevieme (neoverené od štartu appky). */
  scopes: readonly ShopScope[] | null;
  /** Má kľúč `product:read`? `null` = nevieme. */
  productRead: boolean | null;
  /** Veta pre používateľa, keď `product:read` chýba alebo o ňom nevieme. */
  productReadNote: string | null;
}

export function scopeReport(scopes: readonly ShopScope[] | null): KeyScopeReport {
  const productRead = hasShopScope(scopes, 'product:read');
  return {
    scopes,
    productRead,
    productReadNote:
      productRead === true ? null : missingScopeSentence('product:read', productRead === false),
  };
}

/* ═════════════ prečo kľúč nie je overený (bod A kontraktu 24. 8.) ══════════ */

/**
 * Veta, ktorá povie PRAVDU o tom, prečo sa uložený kľúč nedal overiť.
 *
 * `verifyStatus: 'unverified'` je jediné slovo pre dva úplne rôzne stavy:
 *  - shop bol nedostupný / odpovedal 429, 500, driftom — „skús to znova",
 *  - shop odmieta našu ADRESU (`ip_banned`) — „nový kľúč nepomôže, treba
 *    odblokovať adresu".
 *
 * Bez tejto vety by používateľ videl „uložený, neoverený" a hľadal chybu
 * v kľúči, ktorý je možno v poriadku. `null` = kľúč je overený, niet čo dodať.
 *
 * ČO SA TU NESMIE POKAZIŤ: veta nesmie tvrdiť príčinu banu. Appka vie, čo shop
 * odpovedal, nie prečo — rovnaké pravidlo ako v `sales/stop-policy.ts` bod 3.
 */
export function verifyNoteFor(probe: KeyProbeResult): string | null {
  if (probe === 'valid') return null;
  if (probe === 'address_banned') {
    return (
      'Kľúč je uložený, ale overiť sa ho nedalo: shop odmieta našu IP adresu ' +
      '(403 `ip_banned`), a to aj pri volaní bez kľúča. Nový kľúč s tým nepohne — ' +
      'treba požiadať správcu shopu o odblokovanie adresy. Zľavy sa dovtedy ' +
      'nezapisujú a fronta počká; nič sa nestratí.'
    );
  }
  return (
    'Kľúč je uložený, ale overiť sa ho zatiaľ nedalo — shop neodpovedal ' +
    'jednoznačne. Appka to skúsi znova sama; zľavy sa dovtedy nezapisujú.'
  );
}

/** Rozpočet do odpovede — vždy aj s tým, či je meraný, alebo len odhadnutý. */
function budgetReport(budget: KeyedBudget): {
  perMinute: number;
  perUtcDay: number;
  measured: boolean;
  note: string;
} {
  return {
    perMinute: budget.perMinute,
    perUtcDay: budget.perUtcDay,
    measured: !budget.hasUnknown,
    note: keyedBudgetSentence(budget),
  };
}

/** `SecretRef` nad plaintextom z tela requestu — len pre overenie (D64). */
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
        const repo = repoForKind(resolved, ctx.query.kind);
        const meta = await repo.getMeta();

        // Oprávnenia kľúča (v5, bod D3). `recallScopes` je v rozhraní nepovinné
        // (in-memory fakes ho nemajú) a pamäť je len v procese — po reštarte
        // teda `null`, čo znamená „nevieme", nie „nemá".
        const remembered = meta.present ? (repo.recallScopes?.() ?? null) : null;
        const scopes = scopeReport(remembered?.scopes ?? null);

        return {
          present: meta.present,
          last4: meta.last4,
          savedAt: meta.savedAt,
          expiresAt: meta.expiresAt,
          secondsLeft: meta.secondsLeft,
          verifyStatus: meta.verifyStatus,
          // Uzavretý číselník scopes — nič, z čoho sa dá odvodiť kľúč (I1).
          scopes: scopes.scopes,
          productRead: scopes.productRead,
          productReadNote: scopes.productReadNote,
          scopesCheckedAt: remembered?.checkedAt ?? null,
        };
      },
    },
    deps.routeDeps,
  );
}

/* ════════════════════════════════ PUT ═════════════════════════════════════ */

export function createKeyPutRoute(deps: KeyRouteDeps = {}): NextRouteHandler {
  const resolved = resolveDeps(deps);
  const { inspectKey, probeKey } = resolved;

  return defineRoute(
    {
      method: 'PUT',
      auth: 'sudo',
      body: putKeyBodySchema,
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'key-put' },
      handler: async (ctx) => {
        const kind: ApiKeyKind = ctx.body.kind;
        const repo = repoForKind(resolved, kind);

        /* 1. Overenie PRED uložením — pre `shop_write` `GET /api/whoami` (v5,
         * čítanie, žiadny zápisový endpoint), pre `orders_read` čítanie
         * objednávok z jediného povoleného modulu (I8'). Bez prejdeného
         * overenia sa NEUKLADÁ nič. */
        const operationId: Ulid = newRequestId();

        // Čo o kľúči povedalo `whoami`. `null` znamená „nevieme" — buď overoval
        // niekto iný (`probeKey`), alebo odpoveď nebola jednoznačná.
        let inspected: WhoamiInfo | null = null;
        let probe: KeyProbeResult;

        if (kind === 'shop_write') {
          if (probeKey !== null) {
            // Vlastné overenie od volajúceho — scopes z neho nevieme.
            probe = await probeKey(ephemeralSecretRef(ctx.body.apiKey), { operationId });
          } else {
            const outcome = await inspectKey(ephemeralSecretRef(ctx.body.apiKey), { operationId });
            probe = whoamiToProbeResult(outcome);
            inspected = outcome.status === 'ok' ? outcome.info : null;
          }
        } else {
          const ordersProbe = resolved.probeOrdersKey ?? getOrdersKeyProbe();
          if (!ordersProbe) {
            // Fail-closed: neoverený kľúč sa neuloží a hláška je pravdivá.
            throw conflict(ORDERS_PROBE_MISSING_MESSAGE, ORDERS_PROBE_MISSING_CODE, {
              logAsError: false,
            });
          }
          probe = await ordersProbe(ephemeralSecretRef(ctx.body.apiKey), { operationId });
        }

        /* 1a. Odmietnutie kľúča — VÝHRADNE keď shop hovorí o KĽÚČI.
         *
         * `address_banned` je tu zámerne NIE: je to tiež 403, ale o kľúči
         * nevypovedá nič (shop ho vráti aj bez kľúča), takže by sa odmietol
         * kľúč, ktorý je možno v poriadku — a to v jedinom stave, v ktorom sa
         * žiadny nový kľúč overiť nedá. Pokračuje sa a uloží sa ako neoverený;
         * prečo je to bezpečné, je pri bode 3. */
        if (probe === 'invalid') {
          throw conflict(PROBE_REJECTION[kind].invalid, 'key_invalid', { logAsError: false });
        }
        if (probe === 'forbidden') {
          throw conflict(PROBE_REJECTION[kind].forbidden, 'key_invalid', { logAsError: false });
        }

        /* 1b. Scope, bez ktorého kľúč daného druhu zapisovať nemôže.
         *
         * `whoami` nevyžaduje žiadny scope, takže ním prejde aj kľúč, ktorý
         * `setReduction` volať nesmie — kontrolu, ktorú do v4 robila sonda
         * mimochodom, musíme spraviť tu. Odmieta sa VÝHRADNE pri istote:
         * keď scopes nepoznáme (`null`), kľúč sa uloží ako doteraz a chýbajúce
         * oprávnenie sa prizná vo vete, nie sa domyslí. */
        const required = requiredScopeForKind(kind);
        if (
          required !== null &&
          inspected !== null &&
          hasShopScope(inspected.scopes, required) === false
        ) {
          throw conflict(
            `Kľúč nemá oprávnenie ${required}, takže ním zľavu zapísať nejde — kľúč sa NEULOŽIL. Vypýtaj si od správcu shopu kľúč s týmto oprávnením.`,
            'key_invalid',
            { logAsError: false },
          );
        }

        /* 2. Uloženie zašifrované, TTL podľa druhu (R2 pre zápis, P2 pre
         * objednávky). `store()` plaintext wipne. */
        const ttlHours = ttlHoursForKind(kind);
        const plain = Buffer.from(ctx.body.apiKey, 'utf8');
        const stored = await repo.store(plain, ctx.body.apiKey.slice(-4), ttlHours, undefined, {
          userId: ctx.claims.sub,
        });

        /* 3. Verify status podľa overenia; `unknown` (sieť) aj `address_banned`
         * (zablokovaná adresa) = `unverified`.
         *
         * PREČO JE ULOŽENIE NEOVERENÉHO KĽÚČA BEZPEČNÉ. `unverified` nie je
         * medzistupeň medzi „platí" a „neplatí" — je to priznanie, že sa to
         * nezmeralo, a appka sa podľa neho chová fail-closed: bod 4 nedopáli
         * kampane, executor bez overeného kľúča nezapisuje a `verifyNoteFor()`
         * to napíše na obrazovku. Uložený kľúč teda nič nezapne; jediné, čo
         * pridá, je že po odblokovaní adresy netreba nič dopisovať.
         *
         * ČO SA TÝM SMIE TICHO POKAZIŤ: keby shop niekedy začal vracať
         * `ip_banned` aj na NEPLATNÝ kľúč, appka by taký kľúč uložila. Nie je
         * to diera v zápise (ten stojí na `valid`), ale hláška by bola falošne
         * zmierlivá. Držať to musí test nad správaním, nie dôvera v shop. */
        const verifyStatus = probe === 'valid' ? 'valid' : 'unverified';
        await repo.setVerifyStatus(verifyStatus);

        /* 3b. Zapamätanie scopes (v5, bod D3). `store()` predchádzajúce scopes
         * zabudol (wipe `replaced_by_new_key`), takže sa zapisujú AŽ TERAZ
         * a výhradne vtedy, keď ich shop naozaj povedal. */
        if (inspected !== null) repo.rememberScopes?.(inspected.scopes);

        /* 4. D24 — dopálenie `needs_key` kampaní, ktoré sú stále vo svojom okne.
         * Výhradne pre zápisový kľúč: objednávkový kľúč nemá so zápisom zliav
         * nič spoločné (I8' bod 4), takže ním sa nikdy nič nedopaľuje. */
        if (kind === 'shop_write' && verifyStatus === 'valid') {
          await relightNeedsKeyCampaigns(resolved, ctx.claims.sub, ctx.log);
        }

        /* 5. Odpoveď. Ide do nej uzavretý číselník scopes a dve čísla rozpočtu
         * — nikdy `id`, `name` ani `owner` kľúča z `whoami` (I1). */
        const remaining: RemainingFromWhoami | null = inspected?.remaining ?? null;
        const scopes = scopeReport(inspected?.scopes ?? null);

        return {
          last4: stored.last4,
          expiresAt: stored.expiresAt,
          verifyStatus,
          verifyNote: verifyNoteFor(probe),
          kind,
          scopes: scopes.scopes,
          productRead: scopes.productRead,
          productReadNote: scopes.productReadNote,
          budget: budgetReport(resolveKeyedBudget(remaining)),
        };
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
        // `draft`/`scheduled`/`needs_key`/`missed` — zrušiteľné stavy (§4) —
        // a `queued` (K2). Kampaň čakajúca vo fronte JE čakajúca kampaň: keby
        // tu chýbala, panic button by ju nechal bežať a fronta by po vložení
        // nového kľúča pokračovala v zápise do shopu, z ktorého kľúč unikol.
        // `CampaignStatus` (A0) `queued` zatiaľ nevie pomenovať — repozitár si
        // hodnotu sám whitelistuje proti DB enumu z migrácie `0010`.
        const waitingStatuses: CampaignStatus[] = [
          'draft',
          'scheduled',
          'needs_key',
          'missed',
          'queued' as CampaignStatus,
        ];
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
