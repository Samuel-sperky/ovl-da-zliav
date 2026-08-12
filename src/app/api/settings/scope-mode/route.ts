/**
 * Aura Zľavy — `POST /api/settings/scope-mode` (KONTRAKT V3: K1).
 *
 * Prepínač režimu rozsahu `pilot` ↔ `plny`. K1 nahradil pôvodné I2 („max 10
 * produktov") režimom, a tento endpoint je jediné miesto, kde sa režim mení.
 *
 * Asymetria, ktorá je celým zmyslom K1 bodu 4:
 *
 *  | Smer | Sudo | Audit |
 *  |---|---|---|
 *  | `pilot → plny` (UVOĽNENIE) | **áno** | `scope_mode_changed` |
 *  | `plny → pilot` (SPRÍSNENIE) | nie | `scope_mode_changed` |
 *
 * „Sprísnenie je vždy voľné, uvoľnenie nikdy." Preto route beží na
 * `auth: 'session'` a sudo si vyžiada SAMA — `defineRoute({ auth: 'sudo' })`
 * je statické a vyžadovalo by heslo aj na cestu späť do `pilot`, čiže by
 * v núdzi bránilo pribrzdiť appku.
 *
 * Fail-closed detaily:
 *  - Neznámy/chýbajúci režim v DB sa číta ako `pilot` (K1 bod 1) — to zaručuje
 *    `settings.repo.readScope()`, nie táto route.
 *  - Audit sa zapisuje AŽ PO úspešnom `setScopeMode()`. Opačné poradie by
 *    vyrábalo záznamy o zmenách, ktoré sa nestali.
 *  - Zmena rozsahu NIKDY nič nezapisuje do shopu a nespúšťa frontu.
 *
 * Vlastník: V8.
 */
import { z } from 'zod';

import type { AuditEventType, SessionClaims, UtcDate } from '@/contracts';

import { appendAudit } from '@/lib/audit/write';
import { requireSudo } from '@/lib/auth/sudo';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  settingsRepo as defaultSettingsRepo,
  effectiveMaxProducts,
  HARD_MAX_PRODUCTS,
  PILOT_MAX_PRODUCTS,
  type ScopeMode,
  type SettingsRepoExt,
} from '@/lib/repo/settings.repo';

/**
 * K1 bod 4 — audit prepnutia režimu.
 *
 * Hodnota je od 12. 8. 2026 riadnym členom `AuditEventType` v `src/contracts.ts`
 * aj runtime zoznamu v `src/lib/audit/events.ts`. Dovtedy sa sem musela
 * pretypovať a `appendAudit()` pri každom prepnutí režimu zapísal riadok, ale
 * zároveň zalogoval `audit_unknown_event_type` — teda jediná udalosť, ktorú K1
 * bod 4 vyžaduje dohľadať, sa hlásila ako neznáma.
 */
export const SCOPE_MODE_CHANGED_EVENT: AuditEventType = 'scope_mode_changed';

export const scopeModeBodySchema = z.object({
  mode: z.enum(['pilot', 'plny']),
  /**
   * Voliteľný strop v režime `plny`. Mimo režimu `plny` sa IGNORUJE — v `pilot`
   * je strop vždy 10 (K1, tabuľka režimov) a uložená hodnota naň nemá vplyv.
   */
  maxProductsPerCampaign: z.number().int().min(1).max(HARD_MAX_PRODUCTS).optional(),
});

export interface ScopeModeRouteDeps {
  settings?: Pick<SettingsRepoExt, 'readScope' | 'setScopeMode' | 'setMaxProductsPerCampaign'>;
  audit?: typeof appendAudit;
  /** Testy si prinesú vlastnú kontrolu sudo okna; default je A4. */
  requireSudo?: (claims: SessionClaims | null | undefined, now?: Date) => UtcDate;
  now?: () => Date;
  routeDeps?: RouteDeps;
}

export function createScopeModeRoute(deps: ScopeModeRouteDeps = {}): NextRouteHandler {
  const settings = deps.settings ?? defaultSettingsRepo;
  const audit = deps.audit ?? appendAudit;
  const sudoGate = deps.requireSudo ?? requireSudo;
  const now = deps.now ?? ((): Date => new Date());

  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      body: scopeModeBodySchema,
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'settings-scope-mode' },
      handler: async (ctx) => {
        const next: ScopeMode = ctx.body.mode;

        /* 1. Čo je teraz. `readScope()` je fail-closed: nečitateľná DB je
         * `pilot` (K1 bod 1). Prepnutie z „neviem" do `plny` sa tým stáva
         * uvoľnením a sudo si vypýta rovnako ako z `pilot` — správne. */
        const before = await settings.readScope();

        /* 2. K1 bod 4 — sudo LEN pri uvoľnení. Kontrola je pred akýmkoľvek
         * zápisom, takže bez platného okna sa nezmení ani strop. */
        if (next === 'plny' && before.mode !== 'plny') {
          sudoGate(ctx.claims, now());
        }

        /* 3. Zmena režimu a (len v `plny`) stropu. */
        await settings.setScopeMode(next);
        if (next === 'plny' && ctx.body.maxProductsPerCampaign !== undefined) {
          await settings.setMaxProductsPerCampaign(ctx.body.maxProductsPerCampaign);
        }

        const after = await settings.readScope();

        /* 4. Audit so STARÝM aj NOVÝM stavom (K1 bod 4). */
        await audit({
          actor: 'user',
          userId: ctx.claims.sub,
          eventType: SCOPE_MODE_CHANGED_EVENT,
          ok: true,
          beforeSnapshot: {
            scopeMode: before.mode,
            maxProductsPerCampaign: before.maxProductsPerCampaign,
            effectiveMaxProducts: effectiveMaxProducts(before),
            failClosed: before.failClosed,
          },
          afterSnapshot: {
            scopeMode: after.mode,
            maxProductsPerCampaign: after.maxProductsPerCampaign,
            effectiveMaxProducts: effectiveMaxProducts(after),
            failClosed: after.failClosed,
          },
          message:
            before.mode === after.mode
              ? `Rozsah zostal „${after.mode}"; strop na jednu zľavu je ${effectiveMaxProducts(after)} produktov.`
              : `Rozsah zmenený z „${before.mode}" na „${after.mode}"; strop na jednu zľavu je ${effectiveMaxProducts(after)} produktov.`,
          ip: ctx.info.ip,
          userAgent: ctx.info.userAgent,
        });

        return {
          scopeMode: after.mode,
          /** Koľko produktov smie mať jedna zľava (v `pilot` vždy 10). */
          maxProducts: effectiveMaxProducts(after),
          maxProductsPerCampaign: after.maxProductsPerCampaign,
          dailyWriteBudget: after.dailyWriteBudget,
          previousScopeMode: before.mode,
          pilotMaxProducts: PILOT_MAX_PRODUCTS,
        };
      },
    },
    deps.routeDeps,
  );
}

export const POST = createScopeModeRoute();
