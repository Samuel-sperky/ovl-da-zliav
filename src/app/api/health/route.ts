/**
 * Aura Zľavy — `GET /api/health` (BUILD-SPEC §5, D87, D91, I1).
 *
 * Verejný v rámci compose siete (docker healthcheck), preto `auth: 'none'` —
 * a preto NESMIE prezradiť nič citlivé: žiadne `last4`, žiadne detaily kľúča,
 * žiadna doména, žiadne stacktrace. Kľúč sa hlási len ako `{present, expiresAt}`.
 *
 * Fail-closed: ak sa niektorý podsystém nedá prečítať, hlási sa ako nezdravý
 * a celkový stav je `degraded` — health nikdy nehodí 500 kvôli DB výpadku.
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
      auth: 'none',
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
