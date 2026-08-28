/**
 * Aura Zľavy — `GET /api/ai/insights` (plán 33 §4, V1 pravidlový analytik).
 *
 * ČISTO ČÍTACIA route: poskladá snímku z vlastnej DB (`campaigns`,
 * `campaign_items`, `products_allowlist`, `catalog_cache`) a meta kľúča
 * (`present` + `expiresAt`, NIKDY viac — I1) a spustí deterministické
 * pravidlá zo `src/lib/ai/rules.ts`. Žiadne LLM, žiadne volanie shopu,
 * žiadny zápis — teda ani cesta, ktorá by obišla dry-run potvrdenie (I3).
 * Zásoba je výhradne `quantity` variantov z poslednej obnovy katalógu.
 *
 * Predajnosť (KONTRAKT-PREDAJNOST, P1): do snímky ide počet predaných KUSOV
 * na produkt za obdobie, ktoré je v DB SKUTOČNE pokryté — čítané z vlastných
 * tabuliek súčtov, nikdy zo siete. Keď pokrytý nie je ani jeden deň, snímka
 * predaje vôbec nedostane (`sales: null`) a pravidlá o predajnosti mlčia:
 * nula bez dát by vyzerala ako „nepredáva sa" (I11).
 *
 * Vlastník: C3.
 */
import type { CampaignsRepo } from '@/contracts';

import { env } from '@/env';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  analyze,
  variantStockFromRaw,
  type RuleCampaign,
  type RuleSalesWindow,
  type RuleSnapshot,
  type RuleVariantStock,
} from '@/lib/ai/rules';
import { addDays, todayInZone } from '@/lib/domain/dates';
import { apiKeyRepo as defaultApiKeyRepo } from '@/lib/repo/api-key.repo';
import { campaignsRepo as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { catalogRepo as defaultCatalogRepo } from '@/lib/repo/catalog.repo';
import { insightsRepo as defaultInsightsRepo } from '@/lib/repo/insights.repo';
import {
  dailyUnits as defaultDailyUnits,
  salesMetrics,
  summarizeCoverage,
  syncDays as defaultSyncDays,
} from '@/lib/sales/insights';

/** Okno, v ktorom sa hľadajú kampane s produktmi (±~3 mesiace od dneška). */
const WINDOW_DAYS = 95;

export interface AiInsightsDeps {
  campaignsRepo?: Pick<CampaignsRepo, 'list'>;
  insightsRepo?: Pick<typeof defaultInsightsRepo, 'campaignWindows' | 'discountDepth'>;
  catalogRepo?: Pick<typeof defaultCatalogRepo, 'getMany'>;
  apiKey?: { getMeta(): Promise<{ present: boolean; expiresAt: Date | null }> };
  salesInsights?: {
    syncDays: typeof defaultSyncDays;
    dailyUnits: typeof defaultDailyUnits;
  };
  now?: () => Date;
  timeZone?: string;
  syncEnabled?: boolean;
  windowDays?: number;
}

export function createAiInsightsGet(
  overrides: AiInsightsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const campaigns = overrides.campaignsRepo ?? defaultCampaignsRepo;
  const insights = overrides.insightsRepo ?? defaultInsightsRepo;
  const catalog = overrides.catalogRepo ?? defaultCatalogRepo;
  const apiKey = overrides.apiKey ?? defaultApiKeyRepo;
  const sales = overrides.salesInsights ?? {
    syncDays: defaultSyncDays,
    dailyUnits: defaultDailyUnits,
  };
  const now = overrides.now ?? (() => new Date());

  return defineRoute(
    {
      method: 'GET',
      handler: async () => {
        // LAZY env — rovnaký dôvod ako `api/insights/_shared.ts` (build bez ENV).
        const timeZone = overrides.timeZone ?? env.LOGIC_TIMEZONE;
        const today = todayInZone(now(), timeZone);

        /* 1. Kampane s produktmi v okne ±3 mesiace (nadväznosť, konce). */
        const windows = await insights.campaignWindows(
          addDays(today, -WINDOW_DAYS),
          addDays(today, WINDOW_DAYS),
        );
        const byId = new Map<number, RuleCampaign>();
        for (const w of windows) {
          byId.set(w.id, {
            id: w.id,
            name: w.name,
            status: w.status,
            percent: w.percent,
            dateFrom: w.dateFrom,
            dateTo: w.dateTo,
            itemsTotal: 0,
            itemsOk: 0,
            productIds: w.productIds,
          });
        }

        /* 2. Stavové kampane aj mimo okna + počty položiek (partial). */
        const paged = await campaigns.list({
          status: ['scheduled', 'needs_key', 'missed', 'partial'],
          perPage: 100,
        });
        for (const c of paged.data) {
          const existing = byId.get(c.id);
          byId.set(c.id, {
            id: c.id,
            name: c.name,
            status: c.status,
            percent: c.percent,
            dateFrom: c.dateFrom,
            dateTo: c.dateTo,
            itemsTotal: c.itemsTotal,
            itemsOk: c.itemsOk,
            productIds: existing?.productIds ?? [],
          });
        }

        /* 3. Allowlist + posledné vlastné zápisy; `not_found` produkty sa
              nenavrhujú (v shope neexistujú — kampaň by nemala zmysel). */
        const depth = await insights.discountDepth();
        const allowlist = depth
          .filter((row) => row.shopStatus !== 'not_found')
          .map((row) => ({
            productId: row.productId,
            name: row.name,
            label: row.label,
            hasAttributes: row.hasAttributes,
            lastOwnWrite: row.lastOwnWrite
              ? {
                  percent: row.lastOwnWrite.percent,
                  from: row.lastOwnWrite.from,
                  to: row.lastOwnWrite.to,
                }
              : null,
          }));

        /* 4. Zásoba variantov z cache katalógu — len variantné produkty. */
        const variantIds = allowlist.filter((p) => p.hasAttributes).map((p) => p.productId);
        const cached = await catalog.getMany(variantIds);
        const variantStock: RuleVariantStock[] = [];
        for (const id of variantIds) {
          const record = cached.get(id);
          if (!record) continue;
          const stock = variantStockFromRaw(
            id,
            record.name,
            record.raw,
            record.fetchedAt instanceof Date ? record.fetchedAt.toISOString() : null,
          );
          if (stock) variantStock.push(stock);
        }

        /* 5. Kľúč: len present + expiresAt (I1). */
        let keyPresent = false;
        let keyExpiresAt: string | null = null;
        try {
          const meta = await apiKey.getMeta();
          keyPresent = meta.present;
          keyExpiresAt = meta.expiresAt?.toISOString() ?? null;
        } catch {
          keyPresent = false;
          keyExpiresAt = null;
        }

        /* 6. Predajnosť za SKUTOČNE pokryté obdobie. Bez pokrytia zostáva
              `null` — pravidlá o predaji potom nepovedia nič (I11). */
        let salesWindow: RuleSalesWindow | null = null;
        try {
          const coverage = summarizeCoverage(await sales.syncDays(), {
            syncEnabled: overrides.syncEnabled ?? env.SALES_SYNC_ENABLED,
            windowDays: overrides.windowDays ?? env.SALES_WINDOW_DAYS,
          });
          if (coverage.hasData && coverage.from != null && coverage.to != null) {
            const days = await sales.dailyUnits(
              allowlist.map((p) => p.productId),
              coverage.from,
              coverage.to,
            );
            salesWindow = {
              from: coverage.from,
              to: coverage.to,
              daysCovered: coverage.daysCovered,
              lastSyncedAt: coverage.lastSyncedAt,
              products: salesMetrics({ products: allowlist, days, coverage, today }),
            };
          }
        } catch {
          // Fail-soft (P6): keď tabuľky predaja nie sú dostupné, zistenia
          // o kampaniach a zásobe fungujú ďalej a o predaji sa nič netvrdí.
          salesWindow = null;
        }

        const snapshot: RuleSnapshot = {
          today,
          keyPresent,
          keyExpiresAt,
          campaigns: [...byId.values()],
          allowlist,
          variantStock,
          sales: salesWindow,
        };

        return {
          engine: 'rules-v1' as const,
          generatedAt: now().toISOString(),
          today,
          findings: analyze(snapshot),
        };
      },
    },
    routeDeps,
  );
}

export const GET = createAiInsightsGet();
