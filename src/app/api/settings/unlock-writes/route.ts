/**
 * Aura Zľavy — `POST /api/settings/unlock-writes` (BUILD-SPEC §5, D79, I12).
 *
 * Runaway zámok (`writes_locked`) sa odomyká VÝHRADNE explicitne. Do
 * 27. 8. 2026 to znamenalo sudo okno + heslo znova; sudo zrušilo D100 (I3 znie
 * odteraz „žiadny zápis bez dry-runu + potvrdenia") a heslo strieda výslovné
 * `confirmed: true` z tela — viď schéma nižšie. Audit `writes_unlocked` je
 * povinný (I4).
 *
 * DVE RÔZNE VECI, KTORÉ SA DAJÚ ĽAHKO POMÝLIŤ
 * -------------------------------------------
 *  - **`writes_locked`** je poistka appky v DB (D79). Odomyká ju tento endpoint
 *    výslovným potvrdením, teda z obrazovky.
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
import { appendAudit } from '@/lib/audit/write';
import { writesBlockers } from '@/lib/engine/guards';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';

/**
 * Telo požiadavky. Heslo tu stálo do 27. 8. 2026 (D99) a bolo JEDINÉ potvrdenie
 * tejto akcie. Keby sa len vytrhlo, odomknutie zápisov do produkčného eshopu by
 * sa stalo jedným tichým klikom — a to nie je „bez hesla", to je „bez
 * potvrdenia". I3 potvrdenie vyžaduje aj po zrušení sudo (D100), takže heslo
 * strieda výslovné `confirmed: true`, ktoré UI posiela zo zaškrtávacieho polia.
 *
 * `z.literal(true)` je zámer: chýbajúce aj `false` skončí 400, nikdy odomknutím.
 */
export const unlockWritesBodySchema = z.object({
  confirmed: z.literal(true),
});

export interface UnlockWritesRouteDeps {
  settings?: Pick<SettingsRepo, 'get' | 'unlockWrites'>;
  audit?: typeof appendAudit;
  /** Env poistka I13 (`writesAllowedByEnv()`) — injektovateľná pre testy. */
  writesEnabled?: () => boolean;
  routeDeps?: RouteDeps;
}

export function createUnlockWritesRoute(deps: UnlockWritesRouteDeps = {}): NextRouteHandler {
  const settings = deps.settings ?? defaultSettingsRepo;
  const audit = deps.audit ?? appendAudit;
  const readWritesEnabled = deps.writesEnabled ?? ((): boolean => writesAllowedByEnv());

  return defineRoute(
    {
      method: 'POST',
      body: unlockWritesBodySchema,
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'settings-unlock-writes' },
      handler: async (ctx) => {
        const before = await settings.get();
        await settings.unlockWrites();
        await audit({
          actor: 'user',
          userId: ctx.actor.id,
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
