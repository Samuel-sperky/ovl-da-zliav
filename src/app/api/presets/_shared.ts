/**
 * Aura Zľavy — SPOLOČNÉ ZÁZEMIE ROUTE-OV PRESETOV (KONTRAKT-V4-2026-08-28:
 * D112, K7). NIE JE to route — Next.js registruje výhradne `route.ts`.
 *
 * ═══ ČO PRESET JE A ČO NIE JE (I3 — čítaj pred každou úpravou) ═══
 *
 * Preset je pomenovaná kombinácia filtra katalógu, pásiem s percentami a dĺžky
 * okna. Jeho JEDINÁ úloha je PREDPLNIŤ FORMULÁR novej zľavy. Tým to preň
 * končí.
 *
 * **Tu NIKDY nesmie vzniknúť route, ktorá „spustí preset".** Ani
 * `POST /api/presets/[id]/run`, ani `?apply=1`, ani nič, čo z uloženého presetu
 * vyrobí kampaň alebo zápis do shopu. Dôvod nie je štýlový:
 *
 *  - I3 znie „žiadny zápis bez dry-runu a potvrdenia" a po zrušení prihlásenia
 *    (D98–D100) je to JEDINÉ, čo pred PRODUKČNÝM eshopom zostalo. Appka nemá
 *    login, takže brána nie je „kto to je", ale „videl to človek naprázdno
 *    a potvrdil to".
 *  - Preset drží percentá a filter, teda presne tie hodnoty, ktoré dry-run
 *    overuje. Route, ktorá by ich vzala z DB a poslala na shop, by tie hodnoty
 *    potvrdila SAMA SEBOU — a preset uložený minulý mesiac nad medzitým
 *    zmeneným katalógom je iná množina produktov než tá, ktorú človek videl.
 *  - Zľava sa preto vždy vytvára tou istou cestou ako bez presetu:
 *    dry-run (`engine/preview`) → `previewToken` → potvrdenie →
 *    `POST /api/campaigns` → `engine/executor`. Preset do tejto cesty
 *    NEVSTUPUJE, len vyplní polia vo formulári.
 *
 * Kto sem o mesiac príde „zjednodušiť dva kliky na jeden", ruší poslednú
 * bránu pred produkčným eshopom. Zjednodušenie patrí do UI (predplnené polia),
 * nie do novej zápisovej cesty.
 *
 * ═══ ČO TU EŠTE PLATÍ ═══
 *
 *  - Mutácie (POST, DELETE) idú `defineRoute()` pipeline, takže dedia Origin
 *    check (D72, vrstva 3) a lokálneho actora (D102, vrstva 1, fail-closed).
 *    Vlastnosť `auth:` v `RouteDefinition` NEEXISTUJE (D103).
 *  - Presety sú mutácia LOKÁLNEJ DB, nie shopu. `setReduction` sa tu nevolá
 *    a volať nebude — jeho jediný volajúci je `engine/executor.ts`.
 *  - I11 — `lastUsedAt: null` znamená „ešte nepoužitý"; nikdy sa nedopĺňa
 *    z `createdAt` ani na epochu.
 *
 * Vlastník: V4 (presety).
 */
import { z } from 'zod';

import type { DiscountPercent, DiscountPreset } from '@/contracts';

import { AppError } from '@/lib/http/errors';
import {
  presetsRepo as defaultPresetsRepo,
  type PresetsRepoContract,
} from '@/lib/repo/presets.repo';

/* ═══════════════════════════ 1. Závislosti ════════════════════════════════ */

export interface PresetsRouteDeps {
  /** Produkčne `presetsRepo` nad poolom; testy si prinesú in-memory alebo DB. */
  presetsRepo?: PresetsRepoContract;
  now?: () => Date;
}

export interface ResolvedPresetsDeps {
  presetsRepo: PresetsRepoContract;
  now: () => Date;
}

export function resolvePresetsDeps(overrides: PresetsRouteDeps = {}): ResolvedPresetsDeps {
  return {
    presetsRepo: overrides.presetsRepo ?? defaultPresetsRepo,
    now: overrides.now ?? ((): Date => new Date()),
  };
}

/* ═══════════════════════════ 2. Zod schémy ════════════════════════════════ */

/*
 * Limity sú ZÁMERNE tie isté ako v `presets.repo.ts` a v migrácii 0015. Dôvod
 * pre dva zdroje jednej hodnoty: repozitár hádže na prekročení obyčajný
 * `Error`, ktorý `toAppError()` (správne, I1) zredukuje na 500 `internal_error`
 * bez detailu. Zle vyplnený formulár nie je porucha servera, takže vstup musí
 * padnúť už na zode a vrátiť 400 so zoznamom polí. Repozitár tým prestáva byť
 * druhou bránou — zostáva poslednou.
 */

/** `VARCHAR(60)`, `ck_presets_name_not_blank` (0015). */
const nameSchema = z.string().trim().min(1).max(60);

/** Query string z `catalogFilterKey()`; prázdny = „celý katalóg bez filtra". */
const filterQuerySchema = z.string().max(1000);

/** I9 / K3 — percento je celé číslo 1–30 a nič iné. */
const percentSchema = z.number().int().min(1).max(30);

/**
 * Pásmo presetu. `itemsCount` sa NEPRIJÍMA ani keď ho volajúci pošle: koľko
 * produktov do pásma padne sa vie až pri dry-rune nad AKTUÁLNYM katalógom,
 * takže uložené číslo by bolo výmysel (I11). Zod ho zahodí spolu s ostatnými
 * neznámymi kľúčmi.
 */
const tierSchema = z.object({
  ord: z.number().int().min(1).max(255),
  label: z.string().trim().min(1).max(191),
  percent: percentSchema,
  /** Len na zobrazenie a zopakovanie filtra; pri zápise sa nevyhodnocuje (K3). */
  rule: z.unknown().optional(),
});

/** `ck_presets_duration` (0015) — inkluzívne dni okna, 1–90 (I9, D29). */
const durationDaysSchema = z.number().int().min(1).max(90);

export const createPresetBodySchema = z.object({
  name: nameSchema,
  filterQuery: filterQuerySchema,
  tiers: z.array(tierSchema).min(1).max(50),
  durationDays: durationDaysSchema,
});

export type CreatePresetBody = z.infer<typeof createPresetBodySchema>;

export const presetIdParamSchema = z.object({
  presetId: z.coerce.number().int().positive(),
});

/* ═══════════════════════════ 3. Tvar odpovede ═════════════════════════════ */

/** Preset v JSON — časy ako ISO 8601, `lastUsedAt: null` = ešte nepoužitý (I11). */
export interface PresetView {
  id: number;
  name: string;
  filterQuery: string;
  tiers: readonly {
    ord: number;
    label: string;
    percent: DiscountPercent;
    rule?: unknown;
  }[];
  durationDays: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export function presetView(preset: DiscountPreset): PresetView {
  return {
    id: preset.id,
    name: preset.name,
    filterQuery: preset.filterQuery,
    tiers: preset.tiers.map((tier) =>
      tier.rule === undefined
        ? { ord: tier.ord, label: tier.label, percent: tier.percent }
        : { ord: tier.ord, label: tier.label, percent: tier.percent, rule: tier.rule },
    ),
    durationDays: preset.durationDays,
    createdAt: preset.createdAt.toISOString(),
    // I11 — pomlčku si domyslí UI, appka tu nepodstrčí `createdAt` ani epochu.
    lastUsedAt: preset.lastUsedAt === null ? null : preset.lastUsedAt.toISOString(),
  };
}

/* ═══════════════════════════ 4. Mapovanie chýb ════════════════════════════ */

/**
 * Kódy chýb repozitára → HTTP status. `toAppError()` v A5 ich nepozná
 * (`DOMAIN_CODE_STATUS` je mimo tejto sady) a bez tejto tabuľky by z nich boli
 * 500 `internal_error` — čiže „appka je pokazená" namiesto „preset s tým menom
 * už existuje".
 */
const PRESET_ERROR_STATUS: Record<string, number> = {
  preset_not_found: 404,
  preset_name_taken: 409,
  preset_limit: 409,
};

function presetErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code in PRESET_ERROR_STATUS ? code : null;
}

/**
 * Obal handlera: preloží chyby `presets.repo.ts` na 4xx a zvyšok nechá
 * pipeline A5 (teda 500 bez detailu, I1). Fail-closed: nič sa tu nepohltí
 * a nikdy sa nepokračuje ďalej (I14).
 */
export async function withPresetErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const code = presetErrorCode(error);
    if (code === null) throw error;
    throw new AppError(PRESET_ERROR_STATUS[code]!, code, (error as Error).message, {
      cause: error,
      logAsError: false,
    });
  }
}
