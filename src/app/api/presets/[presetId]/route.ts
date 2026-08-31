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
 * Audit zmazania chýba pre chýbajúci `AuditEventType` — zdôvodnenie a čo treba
 * doplniť je v hlavičke `../route.ts`.
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
          // Hádže `PresetNotFoundError` → 404 (`_shared.ts`). Žiadne tiché „ok".
          await d.presetsRepo.remove(presetId);
          // Audit sem patrí, ale chýba typ udalosti — viď hlavičku súboru.
          ctx.log.info('preset_deleted', { presetId, userId: ctx.actor.id });
          return { deleted: true, presetId };
        }),
    },
    routeDeps,
  );
}

export const DELETE = createPresetDelete();
