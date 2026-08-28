/**
 * Aura Zľavy — `GET /api/settings` (BUILD-SPEC §5; KONTRAKT V3: K1, K2).
 *
 * Číta singleton `settings` (A8) a vracia presne polia z tabuľky §5 plus
 * rozsah a rozpočet z V3 (`scope_mode`, `max_products_per_campaign`,
 * `daily_write_budget`). Žiadne tajomstvá tu nie sú (doména nie je tajomstvo,
 * kľúč žije v `/api/key`).
 *
 * Rozsah sa číta cez `readScope()` — FAIL-CLOSED (K1 bod 1): chýbajúca alebo
 * neznáma hodnota je `pilot`, nikdy `plny`. `scopeFailClosed` to priznáva, aby
 * Nastavenia vedeli povedať „toto nie je z DB", a nie tvrdiť, že prečítali
 * niečo, čo prečítať nešlo.
 *
 * ČO SEM PRIBUDLO A PREČO (B1, C2, C3)
 * ------------------------------------
 * Používateľ nevedel, že strop desiatich produktov je len prepínač: appka mu
 * ticho odmietla väčšiu zľavu a nikdy nepovedala, že existuje `plny` režim so
 * stropom 10 000. Odpoveď preto nesie CELÝ obraz rozsahu — platný režim,
 * efektívny strop, pilotný strop, tvrdý strop DB a to, či je prepnutie
 * uvoľnením (do 27. 8. 2026 „či chce heslo" — D100/D105)
 * — a k tomu strojovo spracovateľné prekážky z `lib/status/blockers.ts`, aby
 * obrazovka nemusela skladať vlastné vety.
 *
 * Rovnako sa priznáva stav env poistky zápisu (I13). `WRITES_ENABLED=false` je
 * VEDOMÉ nastavenie, nie porucha, a jediná pravdivá odpoveď na „ako to zapnem"
 * je „mimo appky, v jej konfigurácii" — prekážka `writes_disabled` to hovorí
 * presne tak (`resolution: 'mimo_appky'`, `path: null`).
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Vety sa tu nepíšu.** Prichádzajú z `blockers.ts`, rozhodnutie
 *     o uvoľnení z `settings.repo.scopeChangeIsLoosening()`. Kópia ktorejkoľvek z nich
 *     by sa raz rozišla s tým, čo route `/api/settings/scope-mode` naozaj robí.
 *  2. **Do `blockers` idú len oblasti, ktoré tento endpoint naozaj prečítal**
 *     (`zapisy`, `rozsah`). Kľúč, rozpočet, katalóg ani čítania sem nepatria —
 *     `collectOperationBlockers()` by ich fail-closed dopísal a Nastavenia by
 *     tvrdili, že chýba kľúč, hoci sa naň nikto nepýtal. Tie oblasti majú
 *     vlastné endpointy (`/api/key`, `/api/queue`, `/api/catalog`).
 *  3. **Fail-closed sa nesmie prepnúť na optimizmus.** Nečitateľné nastavenia
 *     sú `pilot`, nečitateľná env poistka je „zápisy vypnuté".
 *
 * Vlastník: A11 (rozšírenie V3: V8; rozsah a zápisy: A11).
 */
import type { SettingsRepo } from '@/contracts';

import { writesAllowedByEnv } from '@/env';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  settingsRepo as defaultSettingsRepo,
  effectiveMaxProducts,
  scopeChangeIsLoosening,
  FAIL_CLOSED_SCOPE,
  HARD_MAX_PRODUCTS,
  PILOT_MAX_PRODUCTS,
  type ScopeSettings,
  type SettingsRepoExt,
} from '@/lib/repo/settings.repo';
import { collectOperationBlockers, type Blocker } from '@/lib/status/blockers';

/** Oblasti, o ktorých smie tento endpoint hovoriť — viď bod 2 v hlavičke. */
const REPORTED_AREAS: readonly Blocker['area'][] = ['zapisy', 'rozsah'];

export interface SettingsRouteDeps {
  /**
   * `readScope()` je ZÁMERNE voliteľné: staršie fakes ho nemajú a chýbajúca
   * metóda nie je dôvod, aby Nastavenia prestali odpovedať. Bez nej platí
   * fail-closed default (`pilot`, K1 bod 1) — nikdy `plny`.
   */
  settings?: Pick<SettingsRepo, 'get'> & Partial<Pick<SettingsRepoExt, 'readScope'>>;
  /** Env poistka I13 (`writesAllowedByEnv()`) — injektovateľná pre testy. */
  writesEnabled?: () => boolean;
  routeDeps?: RouteDeps;
}

export function createSettingsRoute(deps: SettingsRouteDeps = {}): NextRouteHandler {
  const settings = deps.settings ?? defaultSettingsRepo;
  const readWritesEnabled = deps.writesEnabled ?? ((): boolean => writesAllowedByEnv());

  /** K1 bod 1 — pri akejkoľvek pochybnosti `pilot`. Nikdy výnimka, nikdy `plny`. */
  const readScope = async (): Promise<ScopeSettings> => {
    if (typeof settings.readScope !== 'function') return { ...FAIL_CLOSED_SCOPE };
    try {
      return await settings.readScope();
    } catch {
      return { ...FAIL_CLOSED_SCOPE };
    }
  };

  /** I13 — nečitateľná env poistka je „zápisy vypnuté", nie „asi zapnuté". */
  const readWrites = (): boolean => {
    try {
      return readWritesEnabled() === true;
    } catch {
      return false;
    }
  };

  return defineRoute(
    {
      method: 'GET',
      handler: async () => {
        const record = await settings.get();
        const scope = await readScope();
        const writesEnabled = readWrites();

        return {
          shopDomain: record.shopDomain,
          domainConfirmedAt: record.shopDomainConfirmedAt,
          eagerWriteDefault: record.eagerWriteDefault,
          writesLocked: record.writesLocked,
          writesLockedReason: record.writesLockedReason,
          onboardingDoneAt: record.onboardingDoneAt,
          /* K1 — rozsah a jeho efektívny strop. */
          scopeMode: scope.mode,
          maxProducts: effectiveMaxProducts(scope),
          maxProductsPerCampaign: scope.maxProductsPerCampaign,
          pilotMaxProducts: PILOT_MAX_PRODUCTS,
          /** Tvrdý strop DB (`ck_settings_max_products`) — vyššie sa nedá ísť. */
          hardMaxProducts: HARD_MAX_PRODUCTS,
          /** `true` = hodnoty sú fail-closed default, nie z DB (K1 bod 1). */
          scopeFailClosed: scope.failClosed,
          /**
           * K1 bod 4 — či je prepnutie do plného rozsahu UVOĽNENÍM. Odpoveď
           * pochádza z tej istej funkcie, ktorou sa to rozlíšenie aj zapisuje
           * do auditu. Do 27. 8. 2026 od nej záviselo, či sa vypýta heslo;
           * heslá zmazalo D99 a sudo D100, rozlíšenie zostalo.
           */
          scopeSwitchToFullIsLoosening: scopeChangeIsLoosening(scope, { mode: 'plny' }),
          /** Sprísnenie je vždy voľné (K1 bod 4) — a je to fakt, nie domnienka. */
          scopeSwitchToPilotIsLoosening: scopeChangeIsLoosening(scope, { mode: 'pilot' }),
          /* K2 — denný rozpočet zápisov (spotrebu vracia `/api/queue`). */
          dailyWriteBudget: scope.dailyWriteBudget,
          /* I13 — vedomé nastavenie mimo appky, nie tichý neúspech. */
          writesEnabled,
          /**
           * Prekážky oblastí `zapisy` a `rozsah` slovami `blockers.ts`:
           * čo sa deje, čo s tým, kam v appke to vedie a či to chce
           * výslovné potvrdenie (do 27. 8. 2026 heslo — D105).
           */
          blockers: collectOperationBlockers({
            writes: { enabled: writesEnabled },
            scope: {
              mode: scope.mode,
              maxProducts: effectiveMaxProducts(scope),
              failClosed: scope.failClosed,
            },
          }).filter((blocker) => REPORTED_AREAS.includes(blocker.area)),
        };
      },
    },
    deps.routeDeps,
  );
}

export const GET = createSettingsRoute();
