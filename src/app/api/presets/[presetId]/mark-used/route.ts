/**
 * Aura Zľavy — `POST /api/presets/[presetId]/mark-used` (D112, K7; 31. 8. 2026).
 *
 * Zapíše JEDINÚ vec: `discount_presets.last_used_at = teraz`. Nič nevracia
 * z presetu, nič nepočíta a nikoho nepúšťa nikam ďalej.
 *
 * ═══ PREČO TO NIE JE „SPUSTI PRESET" (I3 — čítaj pred každou úpravou) ═══
 *
 * `_shared.ts` zakazuje route, ktorá z uloženého presetu vyrobí kampaň alebo
 * zápis do shopu, a ten zákaz platí. Táto route je jeho protipól:
 *
 *  1. Nedotýka sa `setReduction`, `engine/executor.ts`, `previewToken` ani
 *     `campaignsRepo` — jediné, čo volá, je `presetsRepo.markUsed()`, ktorý má
 *     v celom repozitári jediný SQL príkaz: `UPDATE ... SET last_used_at`.
 *  2. Nevracia obsah presetu, takže z jej odpovede sa nedá nič zapísať.
 *  3. Nič neuvoľňuje. Brány `confirmed: true` (D106) stoja tam, kde jeden tichý
 *     POST ROZŠIRUJE to, čo appka smie. Po tomto zápise smie appka presne to
 *     isté, čo predtým; zmení sa iba PORADIE v zozname presetov.
 *  4. Zľava sa aj z predplneného formulára zapíše až po skúške naprázdno
 *     a potvrdení. Tie sa odohrajú na `/zlavy/nova` a `POST /api/campaigns`,
 *     ktoré o presetoch nevedia (stráži to `preset-nie-je-zapisova-cesta`).
 *
 * ═══ PREČO PRÁVE KLIK NA „PREDPLNIŤ FORMULÁR" ═══
 *
 * „Použil som preset" má dva možné okamihy a appka pozná len jeden. Klik na
 * „Predplniť formulár" je jediný moment, kedy vie, že po presete niekto siahol.
 * Druhý okamih — „z presetu vznikla zľava" — appka NEVIE a vedieť nemá: preset
 * do zápisovej cesty nevstupuje (I3), kampaň vzniká z dry-runu nad DNEŠNÝM
 * katalógom a predplnené polia sa medzi formulárom a potvrdením dajú prepísať.
 * Priradiť kampaň k presetu by znamenalo pretiahnuť `presetId` cez dry-run až
 * do potvrdenia, čiže naučiť zápisovú cestu o presetoch — presne tú väzbu, ktorú
 * I3 nechce.
 *
 * Preto `last_used_at` znamená „naposledy predplnil formulár" a nič viac. To
 * isté sľubuje `SQL_LIST` v `presets.repo.ts` aj veta v paneli presetov; keď sa
 * jedno z toho zmení, musia sa zmeniť všetky tri.
 *
 * ═══ AUDIT ═══
 *
 * Tento zápis sa do `audit_log` NEZAPISUJE a je to rozhodnutie, nie medzera.
 * `last_used_at` je sám záznamom o použití — nesie čas, je vidieť na obrazovke
 * a nedá sa ním nič uvoľniť. História je forenzný záznam o zápisoch do
 * PRODUKČNÉHO eshopu (I4, D75, nemaže sa nikdy); riadok za každé predplnenie
 * formulára by z nej urobil zoznam klikov a utopil v ňom `write_*`. Uloženie
 * a zmazanie presetu auditované SÚ — tie zoznam presetov menia.
 *
 * Vlastník: V4 (presety).
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  presetIdParamSchema,
  resolvePresetsDeps,
  withPresetErrors,
  type PresetsRouteDeps,
} from '../../_shared';

export interface MarkPresetUsedResult {
  presetId: number;
  /** Čas, ktorý sa NAOZAJ zapísal, v ISO 8601 — nie „asi teraz" (I11). */
  lastUsedAt: string;
}

export function createPresetMarkUsed(
  overrides: PresetsRouteDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolvePresetsDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      params: presetIdParamSchema,
      // Origin check (D72) je na mutácii v pipeline povinný. Limit je hrubá
      // brzda proti opakovanému kliku, nie brána — a je vyšší než pri ukladaní,
      // pretože predplniť formulár je bežný pohyb po obrazovke.
      rateLimit: { limit: 60, windowMs: 60_000, bucket: 'presets-mark-used' },
      handler: (ctx): Promise<MarkPresetUsedResult> =>
        withPresetErrors(async () => {
          const presetId = ctx.params.presetId;
          const at = d.now();
          /*
           * FAIL-CLOSED: neexistujúci preset je 404 `preset_not_found`, nie
           * tiché „ok". Zoznam by inak tvrdil, že sa niečo použilo, hoci
           * `markUsed()` nezapísala nič.
           */
          await d.presetsRepo.markUsed(presetId, at);
          return { presetId, lastUsedAt: at.toISOString() };
        }),
    },
    routeDeps,
  );
}

export const POST = createPresetMarkUsed();
