/**
 * Aura Zľavy — `GET /api/settings` (BUILD-SPEC §5).
 *
 * Číta singleton `settings` (A8) a vracia presne polia z tabuľky §5.
 * Žiadne tajomstvá tu nie sú (doména nie je tajomstvo, kľúč žije v `/api/key`).
 *
 * Vlastník: A11.
 */
import type { SettingsRepo } from '@/contracts';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';

export interface SettingsRouteDeps {
  settings?: Pick<SettingsRepo, 'get'>;
  routeDeps?: RouteDeps;
}

export function createSettingsRoute(deps: SettingsRouteDeps = {}): NextRouteHandler {
  const settings = deps.settings ?? defaultSettingsRepo;

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: async () => {
        const record = await settings.get();
        return {
          shopDomain: record.shopDomain,
          domainConfirmedAt: record.shopDomainConfirmedAt,
          eagerWriteDefault: record.eagerWriteDefault,
          writesLocked: record.writesLocked,
          writesLockedReason: record.writesLockedReason,
          onboardingDoneAt: record.onboardingDoneAt,
        };
      },
    },
    deps.routeDeps,
  );
}

export const GET = createSettingsRoute();
