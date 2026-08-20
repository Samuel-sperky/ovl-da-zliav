/**
 * Aura Zľavy — `PUT /api/settings/eager-write-default` (BUILD-SPEC §5, D22).
 *
 * Prepína default režim vytvárania kampaní (`eager` = zápis hneď pri
 * potvrdení). Samotné potvrdenie kampane vždy vyžaduje sudo + preview token
 * (I3) — tento prepínač nič nezapisuje do shopu.
 *
 * Vlastník: A11.
 */
import { z } from 'zod';

import type { SettingsRepo } from '@/contracts';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';

export const eagerWriteBodySchema = z.object({
  enabled: z.boolean(),
});

export interface EagerWriteRouteDeps {
  settings?: Pick<SettingsRepo, 'setEagerWriteDefault'>;
  routeDeps?: RouteDeps;
}

export function createEagerWriteDefaultRoute(deps: EagerWriteRouteDeps = {}): NextRouteHandler {
  const settings = deps.settings ?? defaultSettingsRepo;

  return defineRoute(
    {
      method: 'PUT',
      auth: 'session',
      body: eagerWriteBodySchema,
      handler: async (ctx) => {
        await settings.setEagerWriteDefault(ctx.body.enabled);
        return { eagerWriteDefault: ctx.body.enabled };
      },
    },
    deps.routeDeps,
  );
}

export const PUT = createEagerWriteDefaultRoute();
