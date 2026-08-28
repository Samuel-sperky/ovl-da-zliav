/**
 * Aura Zľavy — `GET /api/health` (BUILD-SPEC §5, D87, D91, I1).
 *
 * Volá ho docker healthcheck z compose siete, takže tu NIKDY nebolo prihlásenie
 * a od 27. 8. 2026 už nie je nikde (D99) — o to prísnejšie platí, čo route
 * NESMIE prezradiť: žiadne `last4`, žiadne detaily kľúča, žiadna doména, žiadne
 * stacktrace. Kľúč sa hlási len ako `{present, expiresAt}`.
 *
 * Fail-closed: ak sa niektorý podsystém nedá prečítať, hlási sa ako nezdravý
 * a celkový stav je `degraded` — health nikdy nehodí 500 kvôli DB výpadku.
 *
 * TENTO SĽUB DRŽÍ AJ ACTOR VRSTVA (27. 8. 2026, D102). Od zrušenia loginu
 * dohľadáva `defineRoute()` lokálneho actora, a to ide do DB poolu. Kým to
 * robil bezpodmienečne, nedostupná MariaDB skončila ako 500 `internal_error`
 * ešte pred handlerom — teda presne tu sľub padal a docker healthcheck by
 * appku poslal do restart loopu vtedy, keď má appka povedať „DB je dole".
 * Čítacia cesta si preto actora dohľadáva fail-soft a až keď ho handler chce
 * (`define-route.ts`, vrstva 1); tento handler ho nechce vôbec, takže o výpadku
 * hovorí `db: false` a `status: 'degraded'`, nie 500. Strážené v
 * `test/integration/health.spec.ts`.
 *
 * Vlastník: A11.
 */
import type { HealthReport, SchedulerStateRepo, SettingsRepo } from '@/contracts';

import { env, writesAllowedByEnv } from '@/env';
import { pingDb } from '@/db/pool';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { apiKeyRepo as defaultApiKeyRepo } from '@/lib/repo/api-key.repo';
import { schedulerStateRepo as defaultSchedulerStateRepo } from '@/lib/repo/scheduler-state.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { APP_VERSION } from '@/version';

export interface HealthRouteDeps {
  db?: () => Promise<boolean>;
  apiKey?: { getMeta(): Promise<{ present: boolean; expiresAt: Date | null }> };
  schedulerState?: Pick<SchedulerStateRepo, 'get'>;
  settings?: Pick<SettingsRepo, 'get'>;
  /** Env poistky I13 — injektovateľné pre testy. */
  writesEnabled?: () => boolean;
  version?: string;
  routeDeps?: RouteDeps;
}

/** Tick starší než 5 intervalov = scheduler sa považuje za nezdravý. */
export const SCHEDULER_STALE_TICKS = 5;

function schedulerTickMs(): number {
  try {
    return env.SCHEDULER_TICK_MS;
  } catch {
    return 60_000;
  }
}

function schedulerEnabled(): boolean {
  try {
    return env.SCHEDULER_ENABLED;
  } catch {
    return true;
  }
}

export function createHealthRoute(deps: HealthRouteDeps = {}): NextRouteHandler {
  const db = deps.db ?? pingDb;
  const apiKey = deps.apiKey ?? defaultApiKeyRepo;
  const schedulerState = deps.schedulerState ?? defaultSchedulerStateRepo;
  const settings = deps.settings ?? defaultSettingsRepo;
  const writesEnabled = deps.writesEnabled ?? (() => writesAllowedByEnv());
  const version = deps.version ?? APP_VERSION;

  return defineRoute(
    {
      method: 'GET',
      handler: async (ctx): Promise<HealthReport> => {
        const now = (deps.routeDeps?.now ?? (() => new Date()))();

        let dbOk = false;
        try {
          dbOk = await db();
        } catch {
          dbOk = false;
        }

        /* Kľúč: LEN `present` + `expiresAt` — nikdy `last4` (I1, §5). */
        let key: HealthReport['key'] = { present: false, expiresAt: null };
        try {
          const meta = await apiKey.getMeta();
          key = { present: meta.present, expiresAt: meta.expiresAt?.toISOString() ?? null };
        } catch {
          key = { present: false, expiresAt: null };
        }

        let lastTickAt: string | null = null;
        let ageSec: number | null = null;
        try {
          const state = await schedulerState.get();
          if (state.lastTickAt !== null) {
            lastTickAt = state.lastTickAt.toISOString();
            ageSec = Math.max(
              0,
              Math.floor((now.getTime() - state.lastTickAt.getTime()) / 1000),
            );
          }
        } catch {
          lastTickAt = null;
          ageSec = null;
        }

        let writesLocked = false;
        let settingsOk = true;
        try {
          writesLocked = (await settings.get()).writesLocked;
        } catch {
          // Fail-closed: keď sa settings nedajú prečítať, hlásime zámok.
          writesLocked = true;
          settingsOk = false;
        }

        const staleAfterSec = (schedulerTickMs() / 1000) * SCHEDULER_STALE_TICKS;
        const schedulerHealthy =
          !schedulerEnabled() || (ageSec !== null && ageSec <= staleAfterSec);

        const status: HealthReport['status'] =
          dbOk && settingsOk && schedulerHealthy ? 'ok' : 'degraded';

        ctx.log.debug('health_checked', { httpStatus: 200 });

        return {
          status,
          db: dbOk,
          key,
          scheduler: { lastTickAt, ageSec },
          writesEnabled: writesEnabled(),
          writesLocked,
          version,
        };
      },
    },
    deps.routeDeps,
  );
}

export const GET = createHealthRoute();
