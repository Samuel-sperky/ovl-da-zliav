/**
 * Aura Zľavy — `POST /api/settings/unlock-writes` (BUILD-SPEC §5, D79, I12).
 *
 * Runaway zámok (`writes_locked`) sa odomyká VÝHRADNE explicitne: sudo okno
 * + heslo znova. Audit `writes_unlocked` je povinný (I4).
 *
 * DVE RÔZNE VECI, KTORÉ SA DAJÚ ĽAHKO POMÝLIŤ
 * -------------------------------------------
 *  - **`writes_locked`** je poistka appky v DB (D79). Odomyká ju tento endpoint
 *    heslom, teda z obrazovky.
 *  - **`WRITES_ENABLED`** je env poistka (I13). Z obrazovky sa nedá prepnúť
 *    vôbec a tento endpoint s ňou NIČ neurobí.
 *
 * Preto odpoveď vracia aj `writesEnabled` a prekážku `writes_disabled`: bez
 * toho používateľ odomkol zámok, nič sa nerozbehlo a nemal sa ako dozvedieť,
 * že ho zastavuje druhá, úplne iná poistka. Odomknutie je úspech aj vtedy —
 * len nie postačujúca podmienka zápisu.
 *
 * Vlastník: A11.
 */
import { z } from 'zod';

import type { SettingsRepo } from '@/contracts';

import { writesAllowedByEnv } from '@/env';
import { verifyPassword } from '@/lib/auth';
import { appendAudit } from '@/lib/audit/write';
import { writesBlockers } from '@/lib/engine/guards';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { unauthorized } from '@/lib/http/errors';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { usersRepo as defaultUsersRepo } from '@/lib/repo/users.repo';

export const unlockWritesBodySchema = z.object({
  password: z.string().min(1).max(200),
});

export interface UnlockWritesRouteDeps {
  settings?: Pick<SettingsRepo, 'get' | 'unlockWrites'>;
  users?: { getById(id: number): Promise<{ passwordHash: string } | null> };
  verify?: typeof verifyPassword;
  audit?: typeof appendAudit;
  /** Env poistka I13 (`writesAllowedByEnv()`) — injektovateľná pre testy. */
  writesEnabled?: () => boolean;
  routeDeps?: RouteDeps;
}

export function createUnlockWritesRoute(deps: UnlockWritesRouteDeps = {}): NextRouteHandler {
  const settings = deps.settings ?? defaultSettingsRepo;
  const users = deps.users ?? defaultUsersRepo;
  const verify = deps.verify ?? verifyPassword;
  const audit = deps.audit ?? appendAudit;
  const readWritesEnabled = deps.writesEnabled ?? ((): boolean => writesAllowedByEnv());

  return defineRoute(
    {
      method: 'POST',
      auth: 'sudo',
      body: unlockWritesBodySchema,
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'settings-unlock-writes' },
      handler: async (ctx) => {
        const user = await users.getById(ctx.claims.sub);
        const matches = await verify(user?.passwordHash ?? null, ctx.body.password);
        if (!matches) {
          throw unauthorized('Nesprávne heslo.', 'invalid_password', { logAsError: false });
        }

        const before = await settings.get();
        await settings.unlockWrites();
        await audit({
          actor: 'user',
          userId: ctx.claims.sub,
          eventType: 'writes_unlocked',
          ok: true,
          message: `zápisy explicitne odomknuté (predtým zamknuté: ${before.writesLockedReason ?? 'bez dôvodu / neboli'})`,
          ip: ctx.info.ip,
          userAgent: ctx.info.userAgent,
        });

        /* I13 — nečitateľná env poistka je „vypnuté", nie „asi zapnuté". */
        let writesEnabled = false;
        try {
          writesEnabled = readWritesEnabled() === true;
        } catch {
          writesEnabled = false;
        }

        return {
          writesLocked: false,
          /** Druhá, úplne iná poistka — z obrazovky sa neprepína (I13). */
          writesEnabled,
          /** Prázdne pole = po odomknutí už zápisom nič nebráni. */
          blockers: writesBlockers(writesEnabled),
        };
      },
    },
    deps.routeDeps,
  );
}

export const POST = createUnlockWritesRoute();
