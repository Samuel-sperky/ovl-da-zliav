/**
 * Aura Zľavy — `GET /api/ai/insights` (plán 33 §4, V1 pravidlový analytik).
 *
 * ČISTO ČÍTACIA route: poskladá snímku z vlastnej DB (`campaigns`,
 * `campaign_items`, `products_allowlist`, `catalog_cache`) a meta kľúča
 * (`present` + `expiresAt`, NIKDY viac — I1) a spustí deterministické
 * pravidlá zo `src/lib/ai/rules.ts`. Žiadne LLM, žiadne volanie shopu,
 * žiadny zápis — teda ani cesta, ktorá by obišla dry-run potvrdenie (I3).
 * Žiadne orders dáta (I8): zásoba je výhradne `quantity` variantov
 * z poslednej obnovy katalógu.
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
  type RuleSnapshot,
  type RuleVariantStock,
} from '@/lib/ai/rules';
import { addDays, todayInZone } from '@/lib/domain/dates';
import { apiKeyRepo as defaultApiKeyRepo } from '@/lib/repo/api-key.repo';
import { campaignsRepo as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { catalogRepo as defaultCatalogRepo } from '@/lib/repo/catalog.repo';
import { insightsRepo as defaultInsightsRepo } from '@/lib/repo/insights.repo';

/** Okno, v ktorom sa hľadajú kampane s produktmi (±~3 mesiace od dneška). */
const WINDOW_DAYS = 95;

export interface AiInsightsDeps {
  campaignsRepo?: Pick<CampaignsRepo, 'list'>;
  insightsRepo?: Pick<typeof defaultInsightsRepo, 'campaignWindows' | 'discountDepth'>;
  catalogRepo?: Pick<typeof defaultCatalogRepo, 'getMany'>;
  apiKey?: { getMeta(): Promise<{ present: boolean; expiresAt: Date | null }> };
  now?: () => Date;
  timeZone?: string;
}

export function createAiInsightsGet(
  overrides: AiInsightsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const campaigns = overrides.campaignsRepo ?? defaultCampaignsRepo;
  const insights = overrides.insightsRepo ?? defaultInsightsRepo;
  const catalog = overrides.catalogRepo ?? defaultCatalogRepo;
  const apiKey = overrides.apiKey ?? defaultApiKeyRepo;
  const now = overrides.now ?? (() => new Date());

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
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

        const snapshot: RuleSnapshot = {
          today,
          keyPresent,
          keyExpiresAt,
          campaigns: [...byId.values()],
          allowlist,
          variantStock,
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
