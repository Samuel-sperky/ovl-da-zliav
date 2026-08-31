/**
 * Aura Zľavy — `/api/presets` (KONTRAKT-V4-2026-08-28: D112, K7; migrácia 0015).
 *
 *  - `GET`  — zoznam presetov; naposledy použité zhora, nepoužité pod nimi.
 *  - `POST` — uloženie nového presetu (mutácia LOKÁLNEJ DB, nie shopu).
 *
 * **Preset len PREDPLNÍ formulár novej zľavy.** Route, ktorá by z presetu
 * vyrobila kampaň alebo zápis do shopu, tu NESMIE vzniknúť — celé zdôvodnenie
 * je v hlavičke `_shared.ts` a je to o I3, nie o štýle. Zľava sa aj z presetu
 * vytvára tou istou cestou: dry-run → potvrdenie → `POST /api/campaigns`.
 *
 * ═══ AUDIT (I4, D102) — DOPOJENÝ 31. 8. 2026 ═══
 *
 * Uloženie presetu zapíše riadok `preset_created` s `userId = ctx.actor.id`
 * (lokálny actor `samuel`, D102). Do 31. 8. 2026 tu bola priznaná medzera:
 * `AuditEventType` hodnotu pre presety nemal a vymyslený string by `appendAudit()`
 * zahodil ako `audit_unknown_event_type` — teda zápis, o ktorom si volajúci
 * myslí, že je v audite, a v audite nie je. Typ pribudol v `src/contracts.ts`
 * a `src/lib/audit/events.ts`; migráciu nepotreboval, `audit_log.event_type`
 * je `VARCHAR(48)` (hlavička 0006).
 *
 * Snapshot nesie meno, filter, pásma a dĺžku okna — teda PERCENTÁ, ktoré niekto
 * o mesiac naklikne jedným klikom. Zápis do shopu tým nevzniká: čo sa naozaj
 * stalo v eshope, drží audit kampane (`campaign_created`, `write_*`), a preset
 * sa tam nedostane, pretože kampaň vzniká z dry-runu a potvrdenia.
 *
 * Vlastník: V4 (presety).
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  createPresetBodySchema,
  presetView,
  resolvePresetsDeps,
  withPresetErrors,
  type PresetView,
  type PresetsRouteDeps,
} from './_shared';

/* ═══════════════════════════════ GET ══════════════════════════════════════ */

export function createPresetsGet(
  overrides: PresetsRouteDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolvePresetsDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      handler: (ctx): Promise<PresetView[]> =>
        withPresetErrors(async () => {
          // Čítacia cesta actora nepotrebuje (a `ctx.actor` je na GET getter,
          // ktorý pri nedostupnej DB hádže) — nečítame ho.
          void ctx;
          const presets = await d.presetsRepo.list();
          return presets.map(presetView);
        }),
    },
    routeDeps,
  );
}

/* ═══════════════════════════════ POST ═════════════════════════════════════ */

export function createPresetsPost(
  overrides: PresetsRouteDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolvePresetsDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      body: createPresetBodySchema,
      // Mutácia lokálnej DB. Origin check (D72) je v pipeline povinný a nedá sa
      // vypnúť; limit je hrubá brzda proti opakovanému kliku a strop 20
      // presetov drží repozitár.
      rateLimit: { limit: 20, windowMs: 60_000, bucket: 'presets-post' },
      handler: (ctx): Promise<PresetView> =>
        withPresetErrors(async () => {
          /*
           * Repozitár ODMIETNE obsadené meno (409 `preset_name_taken`) — preset
           * sa nikdy neprepíše. Rozdiel oproti uloženým filtrom v prehliadači
           * je zámerný: tie nič nezapisujú, preset nesie percentá.
           */
          const preset = await d.presetsRepo.create({
            name: ctx.body.name,
            filterQuery: ctx.body.filterQuery,
            tiers: ctx.body.tiers,
            durationDays: ctx.body.durationDays,
          });
          /*
           * I4 / D102 — audit až PO úspešnom vložení a s lokálnym actorom;
           * `ctx.actor` dohľadá pipeline pred handlerom (fail-closed), takže
           * mutácia bez actora sa k tomuto riadku ani nedostane. `appendAudit()`
           * nikdy nehodí — stratený audit sa hlási v logu, nezhodí odpoveď.
           */
          await d.audit.appendAudit({
            actor: 'user',
            eventType: 'preset_created',
            ok: true,
            userId: ctx.actor.id,
            message: `Preset „${preset.name}" uložený (${preset.tiers.length} pásiem, ${preset.durationDays} dní).`,
            afterSnapshot: {
              presetId: preset.id,
              name: preset.name,
              filterQuery: preset.filterQuery,
              durationDays: preset.durationDays,
              tiers: preset.tiers.map((tier) => ({
                ord: tier.ord,
                label: tier.label,
                percent: tier.percent,
              })),
            },
          });
          ctx.log.info('preset_created', { presetId: preset.id, userId: ctx.actor.id });
          return presetView(preset);
        }),
    },
    routeDeps,
  );
}

export const GET = createPresetsGet();
export const POST = createPresetsPost();
