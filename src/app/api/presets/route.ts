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
 * ═══ AUDIT (I4, D102) — CHÝBAJÚCI TYP UDALOSTI, VEDOMÁ MEDZERA ═══
 *
 * Vytvorenie presetu sa do `audit_log` NEZAPISUJE, a to zámerne: `audit_log.
 * event_type` je uzavretá únia `AuditEventType` (`src/contracts.ts`) zosúladená
 * s runtime zoznamom v `src/lib/audit/events.ts` typovou kontrolou, a hodnota
 * pre presety v nej NIE JE. Vymyslený string by neprešiel typecheckom a keby
 * prešiel, `appendAudit()` by ho zahodil ako `audit_unknown_event_type` — čiže
 * zápis, o ktorom si volajúci myslí, že je v audite, a v audite nie je. To je
 * horšie než priznaná medzera (I11).
 *
 * Doplniť to znamená pridať `preset_created`/`preset_deleted` na TRI miesta
 * naraz (`contracts.ts` únia, `AUDIT_EVENT_TYPES` + `AuditEvent` +
 * `AUDIT_EVENT_LABEL_SK` v `events.ts`) — inak typecheck padne. Tie súbory sú
 * mimo sady tejto route, takže je to samostatná úloha.
 *
 * Riziko medzery je malé a treba ho povedať nahlas: preset nič nezapisuje do
 * shopu a nič neuvoľňuje. Čo sa naozaj stalo v eshope, drží audit kampane
 * (`campaign_created`, `write_*`) — a tam sa preset ani nedostane, pretože
 * kampaň vzniká z dry-runu a potvrdenia, nie z presetu.
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
          // Audit sem patrí, ale chýba mu typ udalosti — viď hlavičku súboru.
          // `ctx.actor` je aj tak dohľadaný pipeline pred handlerom (D102),
          // takže mutácia bez actora neprejde.
          ctx.log.info('preset_created', { presetId: preset.id, userId: ctx.actor.id });
          return presetView(preset);
        }),
    },
    routeDeps,
  );
}

export const GET = createPresetsGet();
export const POST = createPresetsPost();
