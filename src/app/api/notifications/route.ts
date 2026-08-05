/**
 * Aura Zľavy — `GET /api/notifications` (BUILD-SPEC §5, D8, D17, D26, O6).
 *
 * Notifikačný panel bez SMTP. Vracia tri veci, ktoré dashboard potrebuje:
 *
 *  1. `unacked` — dobehnuté/zmeškané kampane bez `result_ack_at` (D17, O6).
 *     Odkliknutie robí `POST /api/campaigns/[id]/ack`.
 *  2. `reminders` — pásma 48/24/2 h pred plánovaným spustením (D26).
 *     Scheduler ich počíta pri každom ticku (`setActiveReminders`); tu sa
 *     prepočítajú z aktuálneho zoznamu kampaní, aby odpoveď nezávisela od
 *     toho, či tick už v tomto procese prebehol. In-process stav zostáva
 *     ako záloha, keď zoznam kampaní nie je dostupný.
 *  3. `atRisk` — naplánované kampane, ktoré sa majú zapísať AŽ PO expirácii
 *     kľúča (D8). Bez zásahu skončia v `needs_key`; appka to má povedať
 *     dopredu, nie po fakte.
 *
 * Kľúč sa v odpovedi objaví výhradne ako `present` + `expiresAt` (I1) —
 * nikdy hodnota ani `last4`.
 *
 * Vlastník: A12 (rozšírenie B3).
 */
import type { CampaignRecord } from '@/contracts';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  computeAtRisk,
  computeReminders,
  getActiveReminders,
} from '@/lib/scheduler/reminders';

import {
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../campaigns/_shared';

/** Koľko čakajúcich kampaní sa berie do úvahy pri pripomienkach (D26). */
const WAITING_PAGE_SIZE = 200;

export function createNotificationsGet(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: (ctx) =>
        withRouteErrors(async () => {
          void ctx;
          const now = d.now();

          const unacked = await d.campaignsRepo.findUnacked();

          /* Čakajúce kampane — podklad pre pripomienky (D26) aj riziko (D8). */
          let waiting: CampaignRecord[] = [];
          let waitingLoaded = true;
          try {
            const paged = await d.campaignsRepo.list({
              status: ['scheduled', 'needs_key'],
              page: 1,
              perPage: WAITING_PAGE_SIZE,
            });
            waiting = paged.data;
          } catch {
            waitingLoaded = false;
          }

          // Záloha: keď zoznam nešiel načítať, poslúži posledný výpočet ticku.
          const reminders = waitingLoaded
            ? computeReminders(waiting, now)
            : [...getActiveReminders()];

          let keyPresent = false;
          let keyExpiresAt: Date | null = null;
          try {
            const meta = await d.apiKeyRepo.getMeta();
            keyPresent = meta.present;
            keyExpiresAt = meta.expiresAt;
          } catch {
            keyPresent = false; // fail-closed: bez istoty o kľúči sú kampane ohrozené
          }

          // Kľúč bez známej expirácie sa nedá vyhodnotiť ako riziko — nehádame.
          const atRisk =
            keyPresent && keyExpiresAt === null
              ? []
              : computeAtRisk(waiting, keyPresent ? keyExpiresAt : null);

          return {
            unacked: unacked.map((c) => ({
              campaignId: c.id,
              name: c.name,
              status: c.status,
              finishedAt: c.finishedAt === null ? null : c.finishedAt.toISOString(),
            })),
            reminders: reminders.map((r) => ({
              campaignId: r.campaignId,
              name: r.name,
              band: r.band,
              fireAt: r.fireAt.toISOString(),
            })),
            atRisk: atRisk.map((r) => ({
              campaignId: r.campaignId,
              name: r.name,
              fireAt: r.fireAt.toISOString(),
            })),
            key: {
              present: keyPresent,
              expiresAt: keyExpiresAt === null ? null : keyExpiresAt.toISOString(),
            },
          };
        }),
    },
    routeDeps,
  );
}

export const GET = createNotificationsGet();
