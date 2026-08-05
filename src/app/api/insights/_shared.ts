/**
 * Aura Zľavy — SPOLOČNÉ ZÁZEMIE ČÍTACÍCH ROUTE-OV PRE GRAFY (sekcia B2).
 * NIE JE to route — Next.js registruje výhradne `route.ts`.
 *
 * Pravidlá, ktoré tu platia bez výnimky:
 *   · **Žiadna mutácia.** Každá route je `GET`, `auth: 'session'`, a jediné,
 *     čo robí, je `SELECT` cez `insightsRepo`. Neexistuje tu cesta k zápisu do
 *     shopu ani do DB — teda ani cesta, ktorá by obišla potvrdenie (I3).
 *   · **Žiadny kľúč, žiadne tajomstvo v odpovedi (I1).** Telo aj tak prechádza
 *     centrálnym redaktorom v `responses.ts`, ale grafy o kľúči nevedia nič
 *     a ani ho nepotrebujú — TTL kreslí hlavička z vlastných dát.
 *   · **Žiadne dáta o objednávkach (I8).** Zdroje sú `catalog_cache`,
 *     `campaigns`, `campaign_items`, `audit_log` — nič iné.
 *   · **I11.** Odpovede nesú `lastOwnWrite`, nie „stav zľavy v shope".
 *     Pomenovanie v UI je povinné a robia ho komponenty grafov.
 *
 * Vlastník: B2.
 */
import { z } from 'zod';

import type { DateOnly } from '@/contracts';

import { env } from '@/env';
import { addCalendarMonths, addDays, isDateOnly, todayInZone } from '@/lib/domain/dates';
import { insightsRepo as defaultInsightsRepo } from '@/lib/repo/insights.repo';

/* ═══════════════════════ 1. Závislosti route-ov ═══════════════════════════ */

export interface InsightsDeps {
  insightsRepo?: typeof defaultInsightsRepo;
  now?: () => Date;
  timeZone?: string;
}

export type ResolvedInsightsDeps = Required<Omit<InsightsDeps, 'timeZone'>> & {
  timeZone: string;
};

export function resolveInsightsDeps(overrides: InsightsDeps = {}): ResolvedInsightsDeps {
  return {
    insightsRepo: overrides.insightsRepo ?? defaultInsightsRepo,
    now: overrides.now ?? (() => new Date()),
    // LAZY: route moduly volajú resolve na module scope, takže eager čítanie
    // `env.*` by spustilo validáciu ENV už počas `next build` (rovnaký dôvod
    // ako v `api/campaigns/_shared.ts`).
    get timeZone(): string {
      return overrides.timeZone ?? env.LOGIC_TIMEZONE;
    },
  };
}

export const todayOf = (d: ResolvedInsightsDeps): DateOnly => todayInZone(d.now(), d.timeZone);

/* ═══════════════════════════ 2. Zod schémy ════════════════════════════════ */

export const productIdParamSchema = z.object({
  productId: z.coerce.number().int().positive(),
});

export const campaignIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Voliteľné kotvenie osi na konkrétny deň — inak „dnes" v logickom pásme. */
export const anchorQuery = z
  .string()
  .refine((v) => isDateOnly(v), 'Očakáva sa existujúci kalendárny deň v tvare RRRR-MM-DD.')
  .optional();

/* ═══════════════════════ 3. Rozsahy osí (§4) ══════════════════════════════ */

/** Prvý deň mesiaca, do ktorého `day` patrí. */
export function startOfMonth(day: DateOnly): DateOnly {
  return `${day.slice(0, 7)}-01` as DateOnly;
}

/** Posledný deň mesiaca, do ktorého `day` patrí. */
export function endOfMonth(day: DateOnly): DateOnly {
  return addDays(addCalendarMonths(startOfMonth(day), 1), -1);
}

/**
 * G1 — 3-mesačná os: predchádzajúci, aktuálny a nasledujúci kalendárny mesiac.
 * „Dnes" tak leží v prostrednej tretine a je vidieť aj to, čo práve dobehlo.
 */
export function timelineRange(today: DateOnly): { from: DateOnly; to: DateOnly } {
  const from = addCalendarMonths(startOfMonth(today), -1);
  const to = endOfMonth(addCalendarMonths(startOfMonth(today), 1));
  return { from, to };
}

/** G4 — okno aktivity zápisov; default 30 dní vrátane dneška. */
export function activityRange(today: DateOnly, days: number): { from: DateOnly; to: DateOnly } {
  const span = Math.min(Math.max(1, Math.trunc(days)), 90);
  return { from: addDays(today, -(span - 1)), to: today };
}
