/**
 * Aura Zľavy — `POST /api/queue/resume` (KONTRAKT V3: K2; odpoveď 43).
 *
 * Po odstávke počítača scheduler označí prepadnuté kampane ako `missed` a tie
 * sa NIKDY nerozbehnú samy (`src/lib/scheduler/missed.ts`). Táto route je tá
 * jediná „manuálna akcia", ktorá ich vráti do fronty — je to vedomý klik
 * človeka na tlačidlo „Pokračovať" v Prehľade, nie automatika.
 *
 * Prečo to nie je `campaigns/[id]/execute`: používateľ po zapnutí počítača
 * nevie, koľko zliav medzitým prepadlo, a klikať ich po jednej by bolo
 * absurdné. Vracia ich teda do `queued` naraz — a `queued` znamená „čaká na
 * rad vo fronte", nie „zapisuje sa teraz". Samotný zápis potom rieši scheduler
 * v rámci denného rozpočtu, so všetkými guardmi, ktoré preň platia (K2).
 *
 * Čo táto route ZÁMERNE nerobí:
 *   - nezapisuje do shopu (nevolá executor ani `setReduction`),
 *   - neposúva okno platnosti (I7 — appka zľavu nikdy neskracuje),
 *   - nedvíha denný rozpočet ani neobchádza runaway poistku.
 *
 * Vracia sa výhradne zo stavu `missed`. Kampaň v `needs_key` sa takto
 * neodomkne — tej chýba kľúč, nie potvrdenie, a mieša sa to len zdanlivo.
 *
 * Vlastník: V8 (dopísané po náleze V13 — klient `resumeQueue()` volal cestu,
 * ktorá neexistovala, takže tlačidlo „Pokračovať" dostávalo 404).
 */
import { AuditEvent } from '@/lib/audit/events';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../../campaigns/_shared';

export function createQueueResumePost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      handler: (ctx) =>
        withRouteErrors(async () => {
          // Stránkujeme naschvál vysoko: po dlhšej odstávke môže prepadnúť
          // viac zliav naraz a tichý strop by časť z nich nechal ležať.
          const missed = await d.campaignsRepo.list({
            status: 'missed',
            page: 1,
            perPage: 100,
          });

          const resumed: number[] = [];
          for (const campaign of missed.data) {
            // Jeden atomický UPDATE (I12): keď medzitým stav zmenil niekto
            // iný — scheduler, druhá karta prehliadača — vráti false a my ho
            // preskočíme. Žiadny SELECT-a-potom-UPDATE.
            const requeued = await d.campaignsRepo.requeueMissed(campaign.id);
            if (!requeued) continue;
            await d.audit.appendAudit({
              actor: 'user',
              userId: ctx.claims.sub,
              eventType: AuditEvent.QUEUE_RESUMED,
              campaignId: campaign.id,
              ok: true,
            });
            resumed.push(campaign.id);
          }

          return Response.json({
            ok: true,
            data: { resumed: resumed.length, campaignIds: resumed },
          });
        }),
    },
    routeDeps,
  );
}

export const POST = createQueueResumePost();
