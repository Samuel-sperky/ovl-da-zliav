/**
 * Aura Zľavy — `DELETE /api/presets/[presetId]` (KONTRAKT-V4-2026-08-28: K7).
 *
 * Zmaže jeden uložený preset. Fail-closed: neexistujúci preset je 404
 * `preset_not_found`, nikdy tiché „ok" — „zmazal som nič" sa nesmie javiť ako
 * „zmazal som to, čo si chcel" (rovnaká úvaha ako v `presets.repo.ts`).
 *
 * ═══ PREČO TU NIE JE `confirmed: true` (a prečo to NIE JE diera) ═══
 *
 * Štyri uvoľňujúce mutácie appky majú bránu `confirmed: true` (D106) a I3 žiada
 * dry-run + potvrdenie pred KAŽDÝM zápisom. Zmazanie presetu ani jedno
 * nepotrebuje a je to rozdiel v podstate operácie, nie výnimka z pravidla:
 *
 *  1. **Nie je to zápis do shopu.** Táto route sa nedotýka `setReduction` ani
 *     `engine/executor.ts` (jediný jeho volajúci) a nemení ani jednu cenu
 *     v PRODUKČNOM eshope. Mení jeden riadok v lokálnej tabuľke
 *     `discount_presets`.
 *  2. **Nič neuvoľňuje.** Brány D106 stoja tam, kde jeden tichý POST ROZŠIRUJE
 *     to, čo appka smie (doména shopu, režim rozsahu, odomknutie zápisov,
 *     zmazanie kľúča). Zmazanie presetu rozsah len ZUŽUJE — po ňom sa dá
 *     naklikať MENEJ vecí jedným klikom, nie viac. Sprísnenie je v tomto repe
 *     zámerne voľné (viď asymetriu pri `scope-mode` v CLAUDE.md).
 *  3. **Nič sa tým nestráca nenávratne.** Preset je pomôcka na predplnenie
 *     formulára; po zmazaní sa ten istý filter dá naklikať znova. Nie sú to
 *     dáta o tom, čo sa v eshope stalo — tie sú v `campaigns` a v `audit_log`,
 *     a tie táto route nemaže (audit je append-only, I4).
 *  4. **Bežiace zľavy to nezasiahne.** Kampaň si pri potvrdení odkopírovala
 *     položky aj pásma do vlastných tabuliek; medzi presetom a kampaňou
 *     neexistuje FK ani žiadna iná väzba. Zmazanie presetu nezastaví, nezmení
 *     ani nezruší nič, čo už beží.
 *
 * Kto sem `confirmed` doplní, nič nezlepší; kto NAOPAK z tejto úvahy vyvodí, že
 * potvrdenie sa dá vypustiť aj tam, kde sa zapisuje do shopu, ruší poslednú
 * bránu pred produkčným eshopom (D98–D100). Rozdiel je jediný: **zapisuje sa
 * do shopu, alebo nie.**
 *
 * ═══ AUDIT (I4, D102) ═══
 *
 * Zmazanie zapíše `preset_deleted` s `userId = ctx.actor.id` a s `beforeSnapshot`
 * toho, čo zmizlo (meno, filter, pásma, okno). Snapshot sa číta PRED mazaním
 * zámerne: audit „zmazal sa preset #7" bez obsahu by o percentách, ktoré preset
 * niesol, nepovedal nič — a `discount_presets` je jediné miesto, kde boli.
 * Do 31. 8. 2026 tu audit nebol, lebo pre presety neexistoval `AuditEventType`;
 * história tejto medzery je v hlavičke `../route.ts`.
 *
 * Vlastník: V4 (presety).
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  presetIdParamSchema,
  resolvePresetsDeps,
  withPresetErrors,
  type PresetsRouteDeps,
} from '../_shared';

export interface DeletePresetResult {
  deleted: true;
  presetId: number;
}

export function createPresetDelete(
  overrides: PresetsRouteDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolvePresetsDeps(overrides);
  return defineRoute(
    {
      method: 'DELETE',
      params: presetIdParamSchema,
      // Origin check (D72) je na mutácii v pipeline povinný; limit je hrubá
      // brzda, nie brána.
      rateLimit: { limit: 20, windowMs: 60_000, bucket: 'presets-delete' },
      handler: (ctx): Promise<DeletePresetResult> =>
        withPresetErrors(async () => {
          const presetId = ctx.params.presetId;
          /*
           * Obsah pre audit sa číta PRED mazaním — po ňom už nie je odkiaľ.
           * `null` sa NEDOPLŇUJE ničím (I11): keď preset nebolo vidno,
           * `remove()` o riadok nižšie skončí 404 a auditný riadok nevznikne.
           */
          const before = await d.presetsRepo.getById(presetId);
          // Hádže `PresetNotFoundError` → 404 (`_shared.ts`). Žiadne tiché „ok".
          await d.presetsRepo.remove(presetId);
          await d.audit.appendAudit({
            actor: 'user',
            eventType: 'preset_deleted',
            ok: true,
            userId: ctx.actor.id,
            message:
              before === null
                ? `Preset #${presetId} zmazaný.`
                : `Preset „${before.name}" zmazaný.`,
            beforeSnapshot:
              before === null
                ? { presetId }
                : {
                    presetId: before.id,
                    name: before.name,
                    filterQuery: before.filterQuery,
                    durationDays: before.durationDays,
                    tiers: before.tiers.map((tier) => ({
                      ord: tier.ord,
                      label: tier.label,
                      percent: tier.percent,
                    })),
                  },
          });
          ctx.log.info('preset_deleted', { presetId, userId: ctx.actor.id });
          return { deleted: true, presetId };
        }),
    },
    routeDeps,
  );
}

export const DELETE = createPresetDelete();
