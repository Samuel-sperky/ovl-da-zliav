/**
 * Aura Zľavy — `GET /api/insights/catalog-distribution`
 * (D126 — koláčový graf: ROZDELENIE katalógu alebo aktuálneho VÝBERU).
 *
 * D126 dal koláču jedinú úlohu: „podiel z celku". Táto route je tá jediná
 * odpoveď, ktorú appka na otázku o podiele naozaj má — rozdelenie riadkov
 * miestnej kópie katalógu (alebo naklikaného výberu) do NEPREKRÝVAJÚCICH sa
 * častí, ktorých súčet dá celok.
 *
 * PRVÉ PRAVIDLO KOLÁČA: DIEL „NEVIEME" JE DIEL AKO KAŽDÝ INÝ
 * ----------------------------------------------------------
 * Neobohatený produkt nepatrí do žiadneho podielu (D118, I11) — patrí do
 * `unknown`. Ten diel sa vracia VŽDY, aj keď je nulový, a `sumMatchesTotal`
 * hovorí, či diely naozaj dávajú celok. Bez toho by koláč scítal 100 %
 * z nepravdy: „92 % produktov nie je v zľave" by v skutočnosti znamenalo
 * „92 % produktov appka nikdy nečítala".
 *
 * PREČO SÚ TU LEN TRI ROZMERY A KATEGÓRIA S KOVOM NIE
 * ---------------------------------------------------
 * D126 menuje „kategória, kov, pásmo". Dáta má z toho appka na JEDNO:
 *
 *   · **pásmo** (`by=sold`) — vedrá predajnosti, tie isté, podľa ktorých sa
 *     rozhodujú pásma zľavy. Merané z vlastných predajov; produkt, o ktorého
 *     predaji appka nevie, je v `unknown` (D121), nie vo vedre „nula".
 *   · **zľava podľa shopu** (`by=shop-discount`) — z obohatenia `reduction_*`.
 *     Neobohatený riadok je `unknown`: appka o stave shopu nevie nič.
 *   · **vlastná zľava** (`by=own-discount`) — z `campaign_items`. Tu je
 *     `unknown` nulové ZÁMERNE a je to pravda: vlastné zápisy appka pozná celé.
 *
 * **Kategória a kov v schéme NIE SÚ** (`LOCKED_FILTERS` v `catalog.repo.ts`).
 * `categories` z `getFull` je pole ID BEZ názvov a produkt patrí do viacerých
 * naraz — koláč z toho by mal diely, ktoré sa prekrývajú, a súčet nad 100 %.
 * Kov sa nedá odvodiť vôbec (hádať ho z názvu je vymýšľanie, nie meranie).
 * Preto sa vracajú v `locked` s dôvodom a UI ich MUSÍ ukázať ako zamknuté, nie
 * ponúknuť (K4). Zoznam sa NEKOPÍRUJE — berie sa z odpovede repozitára, takže
 * keď dáta pribudnú, rozmer sa odomkne sám.
 *
 * ROZSAH: KATALÓG alebo VÝBER
 * ---------------------------
 * Bez `?productIds=` je celkom miestna kópia katalógu, s ním naklikaný výber.
 * Výber sa ZAMLČANE NEOREŽE: nad stropom je to 400, nie tichá polovica čísel.
 *
 * Čisto čítacie: JEDEN agregačný `SELECT` cez `catalogRepo.counts()`, žiadne
 * volanie shopu na render ceste (K8), žiadny zápis.
 *
 * Vlastník: vlna V5-CITACIE.
 */
import { z } from 'zod';

import type { DateOnly } from '@/contracts';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  ALLOWED_SOLD_WINDOWS,
  catalogRepo as defaultCatalogRepo,
  type CatalogCounts,
  type LockedCatalogFilter,
} from '@/lib/repo/catalog.repo';

import { anchorQuery, resolveInsightsDeps, todayOf, type InsightsDeps } from '../_shared';

/* ═══════════════════════════ 1. Rozmery koláča ════════════════════════════ */

/** Rozmery, ktoré appka vie naplniť dátami. Zoznam je uzavretý (K4). */
export const DISTRIBUTION_DIMENSIONS = ['sold', 'shop-discount', 'own-discount'] as const;

export type DistributionDimension = (typeof DISTRIBUTION_DIMENSIONS)[number];

/**
 * Rozmery, ktoré koláč ponúknuť NEMÔŽE. Nie sú tu vypísané ručne — vyberajú sa
 * z toho, čo hlási repozitár (`lockedFilters`), aby existoval jeden zoznam.
 */
const LOCKED_PIE_DIMENSIONS: readonly LockedCatalogFilter[] = ['category', 'metal', 'jewelryType'];

/** Strop výberu. Nad ním je odpoveď 400 — nie orezaný koláč. */
export const MAX_SELECTION_IDS = 1_000;

/* ═══════════════════════════════ 2. Vstup ═════════════════════════════════ */

/**
 * `?productIds=1,2,3` — naklikaný výber. Fail-closed: nečíselná položka celý
 * parameter odmietne, nezahodí sa len ona (výber o jeden produkt kratší by bol
 * iný celok a nikto by si to nevšimol).
 */
const productIdsQuery = z
  .string()
  .transform((raw) => raw.split(',').map((part) => part.trim()))
  .refine(
    (parts) => parts.every((part) => /^[1-9]\d*$/.test(part)),
    'Výber smie obsahovať len celé kladné ID produktov oddelené čiarkou.',
  )
  .transform((parts) => [...new Set(parts.map((part) => Number(part)))])
  .refine(
    (ids) => ids.length > 0 && ids.length <= MAX_SELECTION_IDS,
    `Výber smie mať 1 až ${String(MAX_SELECTION_IDS)} produktov.`,
  )
  .optional();

const querySchema = z.object({
  by: z.enum(DISTRIBUTION_DIMENSIONS).optional(),
  productIds: productIdsQuery,
  soldWindow: z.coerce
    .number()
    .int()
    .refine(
      (v) => ALLOWED_SOLD_WINDOWS.includes(v),
      `Okno predajnosti smie byť ${ALLOWED_SOLD_WINDOWS.join(', ')} dní.`,
    )
    .optional(),
  anchor: anchorQuery,
});

/* ═══════════════════════════════ 3. Výstup ════════════════════════════════ */

/**
 * Jeden diel koláča. `share` je zlomok 0–1, nie percentá.
 *
 * POLE SA MENUJE `bucket` A **NIKDY** `key` — NEPREMENOVÁVAJ HO SPÄŤ
 * ----------------------------------------------------------------
 * Odpoveď každej route prechádza centrálnym redaktorom (`lib/log/redact.ts`,
 * invariant I1: „API kľúč nikdy v logoch, audite ani v UI"), ktorý má `key`
 * v `DENY_EXACT` — teda maskuje HODNOTU každého poľa s tým menom, v ľubovoľnej
 * hĺbke vnorenia. Kým sa diel volal `key`, koláč vracal
 * `{ key: '***REDACTED***', count: 3 }`: symbol dielu zmizol, počty zostali,
 * takže graf sa dal nakresliť s tromi rovnako pomenovanými dielmi a nikto by
 * si nevšimol, ktorý je ktorý.
 *
 * Redaktor sa NESMIE oslabiť ani obísť výnimkou — robil presne to, čo má.
 * Chybné bolo meno poľa. To isté platí pre `token`, `secret` a `password`.
 */
export interface DistributionSlice {
  /** Symbol dielu (anglicky). Pomenovanie v jazyku obrazovky robí UI. */
  bucket: string;
  count: number;
  /** `null` = celok je nula, takže podiel sa vyjadriť NEDÁ (nie „0 %"). */
  share: number | null;
}

/** Prečo diel „nevieme" existuje. Vždy kód, nikdy vymyslená nula. */
export type UnknownReason =
  /** Dni predajov, z ktorých by vedro vyšlo, appka nemá (D121). */
  | 'sales_days_missing'
  /** Riadok neprešiel `getFull`, takže o stave zľavy v shope appka nevie (D118). */
  | 'not_enriched'
  /** Nič nechýba — o tomto rozmere appka vie všetko (vlastné zápisy). */
  | 'none';

export interface CatalogDistributionResponse {
  dimension: DistributionDimension;
  /** `catalog` = miestna kópia katalógu, `selection` = naklikaný výber. */
  scope: 'catalog' | 'selection';
  /** Koľko produktov si klient vyžiadal (pri `catalog` je to `null`). */
  selectionSize: number | null;
  /**
   * Celok, z ktorého sa počítajú podiely: riadky miestnej kópie katalógu, ktoré
   * shop neoznačil ako neexistujúce (`shop_status <> 'not_found'`, K1 bod 2).
   * NIE počet produktov v eshope — appka pozná len to, čo stiahla.
   */
  total: number;
  slices: DistributionSlice[];
  /** Diel, ktorý appka priznáva ako nevedomosť. Vracia sa VŽDY, aj s nulou. */
  unknown: DistributionSlice & { reason: UnknownReason };
  /**
   * `false` = diely nedávajú celok. Vtedy obrazovka koláč NESMIE nakresliť:
   * podiely by boli z iného menovateľa než z toho, ktorý je v odpovedi.
   */
  sumMatchesTotal: boolean;
  /** Rozmery, na ktoré appka dáta nemá. UI ich ukáže zamknuté, nie skryté (K4). */
  locked: Array<{ dimension: LockedCatalogFilter; reason: 'no_data_in_schema' }>;
  /** Okno predajnosti, za ktoré platia vedrá `by=sold`. */
  soldWindow: { days: number; from: DateOnly; to: DateOnly };
  /** Z `total` tie riadky, ktoré prešli `getFull` (D118) — kontext dielu „nevieme". */
  enrichedRows: number;
}

/* ═════════════════════════════ 4. Rozdelenie ═════════════════════════════ */

interface RawSlices {
  slices: Array<{ bucket: string; count: number }>;
  unknown: { count: number; reason: UnknownReason };
}

/**
 * Diely jedného rozmeru z jedného agregačného riadku.
 *
 * Odčítania (`enrichedRows − shopDiscountedNow`) sú tu ZÁMERNE a nie v SQL:
 * repozitár vracia merané počty, toto je ich rozklad na celok, a keby sa tie
 * dve definície niekedy rozišli, `sumMatchesTotal` to ukáže namiesto toho, aby
 * to koláč zaokrúhlil do stopy.
 */
export function sliceCounts(dimension: DistributionDimension, counts: CatalogCounts): RawSlices {
  if (dimension === 'sold') {
    return {
      slices: [
        { bucket: 'none', count: counts.sold.none },
        { bucket: 'low', count: counts.sold.low },
        { bucket: 'mid', count: counts.sold.mid },
        { bucket: 'high', count: counts.sold.high },
      ],
      // D121: „nevieme, koľko sa predalo" NIE JE vedro `none`. Vedro `none` je
      // meraná nula, tento diel je medzera v stiahnutých dňoch.
      unknown: { count: counts.soldUnknown, reason: 'sales_days_missing' },
    };
  }

  if (dimension === 'shop-discount') {
    return {
      slices: [
        { bucket: 'discounted', count: counts.shopDiscountedNow },
        {
          bucket: 'not_discounted',
          count: Math.max(0, counts.enrichedRows - counts.shopDiscountedNow),
        },
      ],
      unknown: {
        count: Math.max(0, counts.total - counts.enrichedRows),
        reason: 'not_enriched',
      },
    };
  }

  /*
   * `own-discount`: `discountedNow` a `neverDiscounted` sú VLASTNÉ zápisy (I11),
   * takže tretí diel je zvyšok — produkty, na ktoré appka zľavu zapísala, ale
   * jej okno dnes neplatí. Diel „nevieme" je tu nulový a je to pravda, nie
   * zamlčanie: `campaign_items` je vlastná tabuľka a appka ju vidí celú.
   */
  const past = counts.total - counts.discountedNow - counts.neverDiscounted;
  return {
    slices: [
      { bucket: 'active_now', count: counts.discountedNow },
      { bucket: 'discounted_before', count: Math.max(0, past) },
      { bucket: 'never', count: counts.neverDiscounted },
    ],
    unknown: { count: 0, reason: 'none' },
  };
}

/** Podiel na štyri desatinné miesta. `null` pri nulovom celku (nie „0 %"). */
function shareOf(count: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((count / total) * 10_000) / 10_000;
}

/* ══════════════════════════════ 5. Route ══════════════════════════════════ */

export interface CatalogDistributionDeps extends InsightsDeps {
  catalogRepo?: Pick<typeof defaultCatalogRepo, 'counts'>;
}

export function createInsightsCatalogDistributionGet(
  overrides: CatalogDistributionDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  const catalog = overrides.catalogRepo ?? defaultCatalogRepo;

  return defineRoute(
    {
      method: 'GET',
      query: querySchema,
      handler: async (ctx): Promise<CatalogDistributionResponse> => {
        const dimension: DistributionDimension = ctx.query.by ?? 'sold';
        const selection = ctx.query.productIds;
        const today = ctx.query.anchor ?? todayOf(d);

        const counts = await catalog.counts({
          today,
          ...(selection === undefined ? {} : { productIds: selection }),
          ...(ctx.query.soldWindow === undefined ? {} : { soldWindowDays: ctx.query.soldWindow }),
        });

        const raw = sliceCounts(dimension, counts);
        const sum =
          raw.slices.reduce((acc, slice) => acc + slice.count, 0) + raw.unknown.count;

        return {
          dimension,
          scope: selection === undefined ? 'catalog' : 'selection',
          selectionSize: selection === undefined ? null : selection.length,
          total: counts.total,
          slices: raw.slices.map((slice) => ({
            bucket: slice.bucket,
            count: slice.count,
            share: shareOf(slice.count, counts.total),
          })),
          unknown: {
            bucket: 'unknown',
            count: raw.unknown.count,
            share: shareOf(raw.unknown.count, counts.total),
            reason: raw.unknown.reason,
          },
          sumMatchesTotal: sum === counts.total,
          locked: counts.lockedFilters
            .filter((filter) => LOCKED_PIE_DIMENSIONS.includes(filter))
            .map((filter) => ({ dimension: filter, reason: 'no_data_in_schema' as const })),
          soldWindow: {
            days: counts.soldWindowDays,
            from: counts.soldFrom,
            to: counts.soldTo,
          },
          enrichedRows: counts.enrichedRows,
        };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsCatalogDistributionGet();
