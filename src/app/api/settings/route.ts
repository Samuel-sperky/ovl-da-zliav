/**
 * Aura Zľavy — `GET /api/settings` (BUILD-SPEC §5; KONTRAKT V3: K1, K2).
 *
 * Číta singleton `settings` (A8) a vracia presne polia z tabuľky §5 plus
 * rozsah a rozpočet z V3 (`scope_mode`, `max_products_per_campaign`,
 * `daily_write_budget`). Žiadne tajomstvá tu nie sú (doména nie je tajomstvo,
 * kľúč žije v `/api/key`).
 *
 * Rozsah sa číta cez `readScope()` — FAIL-CLOSED (K1 bod 1): chýbajúca alebo
 * neznáma hodnota je `pilot`, nikdy `plny`. `scopeFailClosed` to priznáva, aby
 * Nastavenia vedeli povedať „toto nie je z DB", a nie tvrdiť, že prečítali
 * niečo, čo prečítať nešlo.
 *
 * Vlastník: A11 (rozšírenie V3: V8).
 */
import type { SettingsRepo } from '@/contracts';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  settingsRepo as defaultSettingsRepo,
  effectiveMaxProducts,
  FAIL_CLOSED_SCOPE,
  PILOT_MAX_PRODUCTS,
  type ScopeSettings,
  type SettingsRepoExt,
} from '@/lib/repo/settings.repo';

export interface SettingsRouteDeps {
  /**
   * `readScope()` je ZÁMERNE voliteľné: staršie fakes ho nemajú a chýbajúca
   * metóda nie je dôvod, aby Nastavenia prestali odpovedať. Bez nej platí
   * fail-closed default (`pilot`, K1 bod 1) — nikdy `plny`.
   */
  settings?: Pick<SettingsRepo, 'get'> & Partial<Pick<SettingsRepoExt, 'readScope'>>;
  routeDeps?: RouteDeps;
}

export function createSettingsRoute(deps: SettingsRouteDeps = {}): NextRouteHandler {
  const settings = deps.settings ?? defaultSettingsRepo;

  /** K1 bod 1 — pri akejkoľvek pochybnosti `pilot`. Nikdy výnimka, nikdy `plny`. */
  const readScope = async (): Promise<ScopeSettings> => {
    if (typeof settings.readScope !== 'function') return { ...FAIL_CLOSED_SCOPE };
    try {
      return await settings.readScope();
    } catch {
      return { ...FAIL_CLOSED_SCOPE };
    }
  };

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: async () => {
        const record = await settings.get();
        const scope = await readScope();
        return {
          shopDomain: record.shopDomain,
          domainConfirmedAt: record.shopDomainConfirmedAt,
          eagerWriteDefault: record.eagerWriteDefault,
          writesLocked: record.writesLocked,
          writesLockedReason: record.writesLockedReason,
          onboardingDoneAt: record.onboardingDoneAt,
          /* K1 — rozsah a jeho efektívny strop. */
          scopeMode: scope.mode,
          maxProducts: effectiveMaxProducts(scope),
          maxProductsPerCampaign: scope.maxProductsPerCampaign,
          pilotMaxProducts: PILOT_MAX_PRODUCTS,
          /** `true` = hodnoty sú fail-closed default, nie z DB (K1 bod 1). */
          scopeFailClosed: scope.failClosed,
          /* K2 — denný rozpočet zápisov (spotrebu vracia `/api/queue`). */
          dailyWriteBudget: scope.dailyWriteBudget,
        };
      },
    },
    deps.routeDeps,
  );
}

export const GET = createSettingsRoute();
