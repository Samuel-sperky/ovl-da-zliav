/**
 * Aura Zľavy — `POST /api/settings/scope-mode` (KONTRAKT V3: K1).
 *
 * Prepínač režimu rozsahu `pilot` ↔ `plny`. K1 nahradil pôvodné I2 („max 10
 * produktov") režimom, a tento endpoint je jediné miesto, kde sa režim mení.
 *
 * Asymetria, ktorá je celým zmyslom K1 bodu 4:
 *
 *  | Zmena | Zapíše sa do auditu ako |
 *  |---|---|
 *  | `pilot → plny` | UVOĽNENIE (`looseningScope: true`) |
 *  | zdvihnutie stropu v `plny` | UVOĽNENIE (`looseningScope: true`) |
 *  | `plny → pilot` | sprísnenie (`looseningScope: false`) |
 *  | zníženie stropu | sprísnenie (`looseningScope: false`) |
 *
 * Do 27. 8. 2026 od tejto asymetrie záviselo, či sa vypýta heslo: uvoľnenie
 * chcelo sudo, sprísnenie nikdy (aby sa appka dala v núdzi pribrzdiť aj bez
 * hesla). Sudo zrušilo D100 a s ním padla aj tá brána — ROZLÍŠENIE ale ostalo,
 * lebo z auditu sa musí dať prečítať, či niekto rozsah rozšíril alebo zúžil.
 *
 * Kde je to rozhodnutie napísané: `scopeChangeIsLoosening()` v
 * `lib/repo/settings.repo.ts`. Tu sa NEVYHODNOCUJE druhýkrát — `GET
 * /api/settings` ohlasuje tú istú odpoveď dopredu a dve kópie pravidla by
 * znamenali, že obrazovka sľúbi jedno a route urobí druhé.
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

import type { AuditEventType } from '@/contracts';

import { appendAudit } from '@/lib/audit/write';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { AppError } from '@/lib/http/errors';
import {
  settingsRepo as defaultSettingsRepo,
  effectiveMaxProducts,
  scopeChangeIsLoosening,
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
  /**
   * Potvrdenie UVOĽNENIA rozsahu (D106, 28. 8. 2026).
   *
   * PREČO NIE `z.literal(true)` ako pri doméne: tu potvrdenie závisí od stavu
   * v DB, nie od tela. Sprísnenie (`plny → pilot`, zníženie stropu) musí
   * zostať VOĽNÉ — je to presne ten prípad, keď človek appku brzdí a nemá
   * čas na obradnosť; tú asymetriu drží celá appka od D79. Zod preto vidí len
   * voliteľný boolean a rozhodnutie padá v handleri, keď je už známe
   * `looseningScope`. Do 27. 8. 2026 túto bránu držalo sudo (D70).
   */
  confirmed: z.boolean().optional(),
});

export interface ScopeModeRouteDeps {
  settings?: Pick<SettingsRepoExt, 'readScope' | 'setScopeMode' | 'setMaxProductsPerCampaign'>;
  audit?: typeof appendAudit;
  routeDeps?: RouteDeps;
}

export function createScopeModeRoute(deps: ScopeModeRouteDeps = {}): NextRouteHandler {
  const settings = deps.settings ?? defaultSettingsRepo;
  const audit = deps.audit ?? appendAudit;

  return defineRoute(
    {
      method: 'POST',
      body: scopeModeBodySchema,
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'settings-scope-mode' },
      handler: async (ctx) => {
        const next: ScopeMode = ctx.body.mode;

        /* 1. Čo je teraz. `readScope()` je fail-closed: nečitateľná DB je
         * `pilot` (K1 bod 1). Prepnutie z „neviem" do `plny` sa tým počíta
         * ako uvoľnenie rovnako ako z `pilot` — správne. */
        const before = await settings.readScope();

        /* 2. Bolo to uvoľnenie rozsahu, alebo sprísnenie? Rozhodnutie NEROBÍ
         * táto route, ale `scopeChangeIsLoosening()` v `settings.repo` — tú
         * istú otázku si kladie aj `GET /api/settings` dopredu a dve kópie
         * pravidla by znamenali, že obrazovka sľúbi jedno a route urobí druhé. */
        const looseningScope = scopeChangeIsLoosening(before, {
          mode: next,
          maxProductsPerCampaign: ctx.body.maxProductsPerCampaign,
        });

        /* 2b. UVOĽNENIE si žiada výslovné potvrdenie (D106, 28. 8. 2026).
         *
         * Fail-closed a PRED prvým zápisom: keď potvrdenie chýba, nesmie sa
         * zmeniť ani režim, ani strop, a nesmie vzniknúť audit riadok o zmene,
         * ktorá sa nekonala. Sprísnenie sem nikdy nedopadne — to je tá
         * asymetria, pre ktorú `confirmed` nie je `z.literal(true)` v schéme. */
        if (looseningScope && ctx.body.confirmed !== true) {
          throw new AppError(
            409,
            'confirmation_required',
            'Uvoľnenie rozsahu sa nespustilo: chýba výslovné potvrdenie (D106).',
            { logAsError: false },
          );
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
          userId: ctx.actor.id,
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
            /* Uvoľnenie (rozšírenie) vs. sprísnenie — bez tohto poľa sa to
             * z auditu o pol roka nedá rozlíšiť. */
            looseningScope,
          },
          message:
            before.mode === after.mode
              ? `Rozsah zostal „${after.mode}"; strop na jednu zľavu je ${effectiveMaxProducts(after)} produktov${looseningScope ? ' (uvoľnenie rozsahu)' : ''}.`
              : `Rozsah zmenený z „${before.mode}" na „${after.mode}"; strop na jednu zľavu je ${effectiveMaxProducts(after)} produktov${looseningScope ? ' (uvoľnenie rozsahu)' : ''}.`,
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
          /** Tvrdý strop DB — vyššie sa nedá ísť ani v plnom režime. */
          hardMaxProducts: HARD_MAX_PRODUCTS,
          /** `true` = hodnoty sú fail-closed default, nie čítanie z DB (K1 bod 1). */
          scopeFailClosed: after.failClosed,
          /** `true` = táto zmena rozsah ROZŠÍRILA (nie zúžila). */
          looseningScope,
        };
      },
    },
    deps.routeDeps,
  );
}

export const POST = createScopeModeRoute();
