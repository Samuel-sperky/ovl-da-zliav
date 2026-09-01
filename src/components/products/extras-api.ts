/**
 * Aura Zľavy — DOŤAHOVANIE KÓDOV A SKLADU PRE VIDITEĽNÚ STRÁNKU.
 *
 * Spojka medzi `POST /api/catalog/details` a modelom, ktorý kreslí tabuľka
 * (`product-extras.ts`). Robí presne dve veci: pošle ID stránky a preloží
 * odpoveď repozitára na pohľad, ktorý pozná tri druhy prázdna.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Tri prázdna sa nesmú zliať do jedného.** Repozitár vracia `gap`:
 *    `not_fetched` (riadok sme ešte nedoťahali), `needs_product_read` (pole
 *    dáva len `getFull`, a na to chýba kľúč) a `shop_has_none` (shop ten údaj
 *    o produkte proste nevedie). V UI z toho je `pending`, `locked` a `none`.
 *    Keby sa zliali, používateľ by nevedel, či má počkať, vypýtať si kľúč,
 *    alebo či taký údaj neexistuje — a to je jediné, čo ho pri prázdnej bunke
 *    zaujíma.
 *
 * 2. **Doťahuje sa VIDITEĽNÁ stránka, nikdy katalóg.** 50 riadkov = dve dávky
 *    po 25 z denného rozpočtu 240 anonymných čítaní. Celý katalóg by bol
 *    1 649 dávok. Kto sem pridá „a načítajme rovno všetko", minie appke deň.
 *
 * 3. **Chyba nie je prázdny výsledok.** Keď sa doplnenie nepodarí, volajúci to
 *    musí vedieť rozlíšiť od „shop nič nemá" — inak by tabuľka po výpadku siete
 *    tvrdila, že produkty kód nemajú.
 *
 * Vlastník: doťahovanie detailov, 19. 8. 2026.
 */
import type { SalesDayCoverage } from '@/contracts';

import type {
  EnrichDayNumbers,
  EnrichPageOutcomeKind,
  EnrichPageView,
} from '@/components/products/enrich-note';
import {
  absent,
  fieldOf,
  kpiKnown,
  kpiMissing,
  productCurve,
  type AbsenceKind,
  type ApiErrorView,
  type DiscountWindowWire,
  type EnrichOutcomeKind,
  type ExtrasCapabilityState,
  type KpiDiscountStateKind,
  type KpiDiscountView,
  type KpiField,
  type KpiGapKind,
  type KpiWindowView,
  type ProductCurveView,
  type ProductExtraView,
  type ProductExtrasView,
  type ProductKpiView,
  type ProductVariantView,
  type Result,
  type SeriesDayWire,
  type UpliftReasonKind,
  type UpliftWindowWire,
  type UpliftWire,
} from '@/components/products/product-extras';

/** Hodnota z repozitára: `gap === null` znamená, že hodnotu poznáme. */
interface WireValue<T> {
  readonly value: T | null;
  readonly gap: 'not_fetched' | 'needs_product_read' | 'shop_has_none' | null;
}

interface WireVariant {
  readonly variantId: number;
  readonly reference: string | null;
  readonly ean13: string | null;
  readonly quantity: number | null;
  readonly values: readonly string[];
  readonly priceImpact?: string | null;
}

interface WireRow {
  readonly productId: number;
  readonly route: 'list' | 'get' | 'getFull';
  readonly fetchedAt: string | null;
  readonly reference: WireValue<string>;
  readonly ean13: WireValue<string>;
  readonly quantity: WireValue<number>;
  readonly variantStock: WireValue<number>;
  readonly variants: readonly WireVariant[];
  readonly full: WireFull | null;
}

/**
 * Blok spoza kľúča, PRESNE ako ho posiela `/api/catalog/details`.
 *
 * Trasa vracia `CatalogDetailRow` z repozitára doslova, takže toto je zrkadlo
 * typu `CatalogFullDetail` v `lib/repo/catalog.repo.ts`. Že sa tie dva
 * nerozídu, stráži typová kontrola v `test/unit/detaily-mapovanie.spec.ts` —
 * komponenty z `@/lib/repo/` neimportujú, tak sa zhoda vynucuje tam.
 *
 * PREDTÝM tu stálo `Record<string, unknown>` a čítalo sa z neho voľnými
 * reťazcami. Kompilátor tak nemal čo skontrolovať a šesť mien bolo zlých:
 * `wholesalePrice`, `priceWithTax`, `addedAt`, `lastOrderedAt`, `orderedTotal`
 * a `categories` čítané ako reťazce. Dnes to vidieť nie je — bez oprávnenia
 * `product:read` je `full` vždy `null` — ale po jeho doplnení by appka o šiestich
 * existujúcich hodnotách tvrdila „nemá". To je horšie než mlčať.
 */
interface WireFull {
  readonly purchasePrice: number | null;
  readonly margin: number | null;
  readonly marginPercent: number | null;
  readonly sellPrice: number | null;
  readonly sellPriceWithVat: number | null;
  readonly active: boolean | null;
  readonly dateAdd: string | null;
  readonly lastTimeInOrder: string | null;
  readonly qtyInOrders: number | null;
  readonly supplier: string | null;
  readonly categories: readonly number[] | null;
}

interface WireResponse {
  readonly route: 'get' | 'getFull';
  readonly capability: { readonly state?: string } | null;
  readonly notFilled: readonly number[];
  readonly notFilledReason: string;
  readonly readsUsed: number;
  readonly at: string;
  readonly error: string | null;
  readonly rows: readonly (WireRow | null)[];
}

/**
 * Preklad medzery repozitára na dôvod, ktorý sa dá povedať človeku.
 *
 * Je to jediné miesto, kde tento preklad žije. Druhá kópia by sa raz rozišla
 * a appka by o tom istom prázdne hovorila na dvoch obrazovkách inak.
 */
function absenceOf(gap: WireValue<unknown>['gap']): AbsenceKind {
  if (gap === 'needs_product_read') return 'locked';
  if (gap === 'not_fetched') return 'pending';
  return 'none';
}

function toVariant(v: WireVariant): ProductVariantView {
  return {
    variantId: v.variantId,
    reference: v.reference,
    ean13: v.ean13,
    quantity: v.quantity,
    priceImpact: v.priceImpact ?? null,
    values: v.values,
  };
}

function toItem(row: WireRow): ProductExtraView {
  const full = row.full;
  /*
   * Kľúč je `keyof WireFull`, nie voľný reťazec. Práve to je oprava: preklep
   * alebo premenované pole na serveri je odteraz chyba prekladu, nie tiché
   * „nemá" na obrazovke.
   */
  const num = (key: keyof WireFull): number | null => {
    const raw = full?.[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  };
  const text = (key: keyof WireFull): string | null => {
    const raw = full?.[key];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  };
  /** Peniaze prídu ako číslo; povrch ich chce ako reťazec a neprepočítava. */
  const money = (key: keyof WireFull): string | null => {
    const raw = num(key);
    return raw === null ? null : String(raw);
  };

  return {
    productId: row.productId,
    /*
     * Popis repozitár NENESIE. Čítal sa tu z bloku spoza kľúča, kde nikdy
     * nebol — teda vždy `null`, len to nebolo vidieť. Nechávame `null`
     * priznane: keď appka popis raz čítať bude, doplní ho tá istá cesta,
     * ktorá ho prinesie, a nie tento preklad.
     */
    description: null,
    shortDescription: null,
    variants: row.variants.map(toVariant),
    keyed:
      full === null
        ? null
        : {
            reference: row.reference.value,
            ean13: row.ean13.value,
            wholesalePrice: money('purchasePrice'),
            margin: money('margin'),
            marginPercent: num('marginPercent'),
            priceWithTax: money('sellPriceWithVat'),
            active: full.active,
            addedAt: text('dateAdd'),
            lastOrderedAt: text('lastTimeInOrder'),
            stockQuantity: row.quantity.value,
            orderedTotal: num('qtyInOrders'),
            supplier: text('supplier'),
            /*
             * Skutočnú zľavu v eshope repozitár dnes NENESIE — `CatalogFullDetail`
             * tie tri polia nemá. Nie je to teda „zamknuté za kľúčom", ale
             * „appka to zatiaľ nečíta". Kým to tak je, `null` je jediná pravdivá
             * odpoveď; vymyslieť sa nedá a hádať sa nesmie (I11).
             */
            shopDiscountPercent: null,
            shopDiscountFrom: null,
            shopDiscountTo: null,
            /* Kategórie prídu ako ID, nie mená. Povrch ich chce ako reťazce. */
            categories: (full.categories ?? []).map((id) => String(id)),
          },
    at: row.fetchedAt ?? '',
  };
}

/** Prečo je bunka prázdna, keď riadok vôbec neprišiel. */
export function rowAbsence(row: WireRow | null): AbsenceKind {
  if (row === null) return 'pending';
  return absenceOf(row.reference.gap);
}

export interface FetchExtrasResult {
  readonly view: ProductExtrasView | null;
  /** Veta pre používateľa, keď sa doplnenie nepodarilo. `null` = podarilo sa. */
  readonly failed: string | null;
}

/**
 * Doplní detaily pre ID viditeľnej stránky.
 *
 * Strop 100 drží route; tu sa zoznam len zbaví duplicít a zoradí, aby dve
 * rovnaké stránky poslali rovnakú požiadavku a dala sa cachovať.
 */
export async function fetchExtras(
  productIds: readonly number[],
  signal?: AbortSignal,
): Promise<FetchExtrasResult> {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  if (ids.length === 0) return { view: null, failed: null };

  try {
    const res = await fetch('/api/catalog/details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ productIds: ids }),
      signal,
    });

    const body = (await res.json()) as { ok?: boolean; data?: WireResponse };
    if (body.ok !== true || body.data === undefined) {
      return { view: null, failed: 'Kódy a sklad sa teraz nepodarilo doplniť.' };
    }

    const data = body.data;
    const rows = data.rows.filter((r): r is WireRow => r !== null);
    const state: ExtrasCapabilityState =
      data.capability?.state === 'available'
        ? 'available'
        : data.capability?.state === 'locked'
          ? 'locked'
          : 'unknown';

    return {
      view: {
        items: rows.map(toItem),
        skippedIds: data.notFilled,
        capability: {
          state,
          requires: 'product:read',
          note:
            state === 'available'
              ? null
              : 'Kód a sklad pre produkty bez variantov pozná len kľúč so scope product:read.',
        },
        readsUsed: data.readsUsed,
        at: data.at,
        error: data.error,
      },
      failed: data.error === null ? null : 'Časť údajov sa nepodarilo doplniť.',
    };
  } catch (error) {
    // Zrušený dotaz nie je chyba — používateľ len preklikol na ďalšiu stránku.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { view: null, failed: null };
    }
    return { view: null, failed: 'Kódy a sklad sa teraz nepodarilo doplniť.' };
  }
}

/** Prázdne pole s dôvodom — používa sa, kým doplnenie nedobehne. */
export const PENDING_FIELD = absent<string>('pending');

export { fieldOf };

/* ═════════ KPI, KRIVKA A OBOHATENIE NA DOPYT (V4, D115 / D118) ════════════
 *
 * Tri ďalšie cesty pre BOČNÝ PANEL. Prvé dve sú čisto čítacie, tretia doťahuje
 * `getFull` na JEDEN produkt:
 *
 *   `GET  /api/insights/product-kpi?ids=<id>` — fakty z obohatenia (D114),
 *   `GET  /api/insights/product/<id>`         — denná krivka, okná zliav, uplift,
 *   `POST /api/catalog/enrich`                — obohatenie TOHO produktu (D118).
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **`as` NIE JE overenie.** Odpoveď sa čítá po poliach (`kpiFieldOf`,
 *    `readNumber`, …). Pole v neznámom tvare skončí ako `unreadable`, nikdy ako
 *    hodnota a nikdy ako nula. Do 24. 8. 2026 sa v `catalog-api.ts` odpovede
 *    „overovali" pretypovaním a práve tadiaľ prišiel stav, ktorý zhodil
 *    obrazovku Zľavy.
 *
 * 2. **`gap` sa nesmie stratiť.** `KpiValue` zo servera nesie DÔVOD, prečo
 *    hodnota chýba (`not_enriched`, `shop_has_none`, `days_missing`,
 *    `not_computable`). Keby sa tu čítalo len `value`, obrazovka by mala `null`
 *    a z `null` sa `?? 0` spraví nula v jednom riadku — to je chyba, ktorá sa
 *    v tomto repe UŽ RAZ dostala do produkcie.
 *
 * 3. **Obohatenie NIKDY V CYKLE.** `enrichProduct()` sa volá RAZ na otvorenie
 *    panela nad jedným produktom. Route je idempotentná (svieži riadok
 *    `getFull` vôbec nezavolá) a má okenný limit, ale cyklus na povrchu by
 *    minul dennú kvótu aj tak — na doťahovanie mnohých riadkov je dávka
 *    na pozadí, nie panel.
 *
 * 4. **`ip_banned` nie je chyba tejto vrstvy.** Vracia sa ako `outcome`, teda
 *    ako MERANÝ výsledok, nie ako `failed`. Panel z toho spraví vetu
 *    (`enrichNotice()`), nie chybové hlásenie: od 28. 8. 2026 je to bežná cesta.
 */

/** Neznámy objekt → čitateľný záznam. Pole ani `null` záznam nie je. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const readText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const readBool = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const KPI_GAPS: readonly KpiGapKind[] = [
  'not_enriched',
  'shop_has_none',
  'days_missing',
  'not_computable',
  'not_loaded',
  'unreadable',
];

const isKpiGap = (value: unknown): value is KpiGapKind =>
  typeof value === 'string' && (KPI_GAPS as readonly string[]).includes(value);

/**
 * `KpiValue<T>` zo servera → `KpiField<T>`.
 *
 * `gap === null` znamená „hodnotu POZNÁME" a `0` je platná nula. Rozpor
 * (`gap === null`, ale hodnota sa prečítať nedá) NIE JE nula ani „shop to
 * nevie" — je to `unreadable`, teda priznanie, že sa rozišli tvary.
 */
function kpiFieldOf<T>(raw: unknown, coerce: (value: unknown) => T | null): KpiField<T> {
  const record = asRecord(raw);
  if (record === null) return kpiMissing<T>('unreadable');
  const gap = record['gap'];
  const value = coerce(record['value']);
  if (gap === null || gap === undefined) {
    return value === null ? kpiMissing<T>('unreadable') : kpiKnown(value);
  }
  return kpiMissing<T>(isKpiGap(gap) ? gap : 'unreadable');
}

/* ───────── Fakty z obohatenia: `/api/insights/product-kpi` ─────────────── */

const DISCOUNT_STATES: readonly KpiDiscountStateKind[] = [
  'running',
  'scheduled',
  'ended',
  'none',
  'unknown',
];

function parseDiscount(raw: unknown): KpiDiscountView {
  const record = asRecord(raw);
  const state = record === null ? null : record['state'];
  return {
    /* Neznámy stav je `unknown`, nie „bez zľavy": „bez zľavy" je MERANÝ fakt. */
    state:
      typeof state === 'string' && (DISCOUNT_STATES as readonly string[]).includes(state)
        ? (state as KpiDiscountStateKind)
        : 'unknown',
    activePercent: kpiFieldOf(record?.['activePercent'], readNumber),
    reportedPercent: kpiFieldOf(record?.['reportedPercent'], readNumber),
    from: readText(record?.['from']),
    to: readText(record?.['to']),
    measuredAt: readText(record?.['measuredAt']),
  };
}

function parseWindow(raw: unknown, fallbackDays: number): KpiWindowView {
  const record = asRecord(raw);
  return {
    windowDays: readNumber(record?.['windowDays']) ?? fallbackDays,
    from: readText(record?.['from']) ?? '',
    to: readText(record?.['to']) ?? '',
    completeDays: readNumber(record?.['completeDays']) ?? 0,
    /*
     * Neprečítané pokrytie je NAJHORŠÍ prípad, nie nula: `unknownDays: 0` by
     * znamenalo „celé okno je stiahnuté" a to je tvrdenie, ktoré sa
     * z nečitateľnej odpovede urobiť nesmie.
     */
    unknownDays: readNumber(record?.['unknownDays']) ?? fallbackDays,
    units: kpiFieldOf(record?.['units'], readNumber),
    lowerBound: readBool(record?.['lowerBound']) ?? true,
  };
}

const NO_SALE_PROOFS: readonly string[] = ['shop_never_ordered', 'no_sale_in_covered_days'];

export function parseProductKpi(raw: unknown, productId: number): ProductKpiView | null {
  const page = asRecord(raw);
  if (page === null) return null;
  const rows = page['rows'];
  if (!Array.isArray(rows)) return null;
  const row = rows.map(asRecord).find((entry) => readNumber(entry?.['productId']) === productId);
  if (row === undefined || row === null) return null;

  const noSale = asRecord(row['noSale']);
  const proof = noSale === null ? null : noSale['proof'];

  return {
    productId,
    /* Neznáme `missing` je `false`: „zrkadlo ho nemá" je tvrdenie o katalógu. */
    missing: readBool(row['missing']) ?? false,
    name: readText(row['name']),
    reference: kpiFieldOf(row['reference'], readText),
    supplier: kpiFieldOf(row['supplier'], readText),
    purchasePrice: kpiFieldOf(row['purchasePrice'], readNumber),
    margin: kpiFieldOf(row['margin'], readNumber),
    marginPercent: kpiFieldOf(row['marginPercent'], readNumber),
    priceWithVat: kpiFieldOf(row['priceWithVat'], readNumber),
    stock: kpiFieldOf(row['stock'], readNumber),
    soldTotal: kpiFieldOf(row['soldTotal'], readNumber),
    lastSaleAt: kpiFieldOf(row['lastSaleAt'], readText),
    daysSinceLastSale: kpiFieldOf(row['daysSinceLastSale'], readNumber),
    discount: parseDiscount(row['discount']),
    units30: parseWindow(row['units30'], 30),
    units90: parseWindow(row['units90'], 90),
    noSale: {
      mark: readBool(noSale?.['mark']) ?? false,
      proof:
        typeof proof === 'string' && NO_SALE_PROOFS.includes(proof)
          ? (proof as 'shop_never_ordered' | 'no_sale_in_covered_days')
          : null,
    },
    enrichedAt: readText(row['enrichedAt']),
  };
}

/**
 * KPI jedného produktu.
 *
 * `null` v úspešnej odpovedi znamená, že riadok pre toto ID neprišiel — panel
 * to kreslí ako „zatiaľ nenačítané", nie ako nuly.
 */
export async function fetchProductKpi(
  productId: number,
  signal?: AbortSignal,
): Promise<Result<ProductKpiView | null>> {
  const res = await getJson(
    `/api/insights/product-kpi?ids=${encodeURIComponent(String(productId))}`,
    signal,
  );
  if (!res.ok) return res;
  return { ok: true, data: parseProductKpi(res.data, productId) };
}

/* ───────── Krivka, okná zliav a uplift: `/api/insights/product/<id>` ───── */

const COVERAGES: readonly SalesDayCoverage[] = ['missing', 'pending', 'partial', 'complete'];

export interface ProductInsightsView {
  readonly today: string | null;
  readonly curve: ProductCurveView;
  readonly windows: readonly DiscountWindowWire[];
  /** `null` = odpoveď uplift neniesla. Panel z toho urobí priznanie, nie číslo. */
  readonly uplift: UpliftWire | null;
}

function parseSeriesDays(raw: unknown): readonly SeriesDayWire[] {
  const series = asRecord(raw);
  const days = series === null ? null : series['days'];
  if (!Array.isArray(days)) return [];
  const out: SeriesDayWire[] = [];
  for (const entry of days) {
    const record = asRecord(entry);
    const day = readText(record?.['day']);
    if (day === null) continue;
    const coverage = record?.['coverage'];
    out.push({
      day,
      units: readNumber(record?.['units']),
      /*
       * Neznáme pokrytie je `missing`, nie `complete`. Opačná voľba by z dňa
       * bez čísla urobila „stiahnutý deň s nulou", teda vymyslený prepad.
       */
      coverage:
        typeof coverage === 'string' && (COVERAGES as readonly string[]).includes(coverage)
          ? (coverage as SalesDayCoverage)
          : 'missing',
    });
  }
  return out;
}

function parseWindows(raw: unknown): readonly DiscountWindowWire[] {
  if (!Array.isArray(raw)) return [];
  const out: DiscountWindowWire[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const from = readText(record?.['from']);
    const to = readText(record?.['to']);
    const percent = readNumber(record?.['percent']);
    if (from === null || to === null || percent === null) continue;
    out.push({
      campaignId: readNumber(record?.['campaignId']) ?? 0,
      campaignName: readText(record?.['campaignName']) ?? 'zľava bez názvu',
      percent,
      from,
      to,
    });
  }
  return out;
}

function parseUpliftWindow(raw: unknown): UpliftWindowWire | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const from = readText(record['from']);
  const to = readText(record['to']);
  if (from === null || to === null) return null;
  return {
    from,
    to,
    days: readNumber(record['days']) ?? 0,
    units: readNumber(record['units']),
    perDay: readNumber(record['perDay']),
  };
}

/** Chýbajúce dni okna. Nečitateľný záznam sa zahodí, nie „nič nechýba". */
const readDays = (raw: unknown): readonly string[] =>
  Array.isArray(raw) ? raw.map(readText).filter((day): day is string => day !== null) : [];

const UPLIFT_REASONS: readonly string[] = [
  'no_discount_window',
  'not_started',
  'window_too_short',
  'baseline_overlaps_discount',
  'coverage_gap',
];

/**
 * Uplift zo servera.
 *
 * `available: true` sa uzná LEN vtedy, keď to server naozaj povedal — čokoľvek
 * iné (chýbajúce pole, iný tvar) je `false`, teda priznanie. Opačná predvoľba by
 * z nečitateľnej odpovede urobila „porovnanie platí".
 */
function parseUplift(raw: unknown): UpliftWire | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const reason = record['reason'];
  const deltaReason = record['deltaReason'];
  return {
    available: readBool(record['available']) === true,
    reason:
      typeof reason === 'string' && UPLIFT_REASONS.includes(reason)
        ? (reason as UpliftReasonKind)
        : null,
    campaignId: readNumber(record['campaignId']),
    campaignName: readText(record['campaignName']),
    percent: readNumber(record['percent']),
    startsOn: readText(record['startsOn']),
    spanDays: readNumber(record['spanDays']),
    duringTruncated: readBool(record['duringTruncated']) === true,
    before: parseUpliftWindow(record['before']),
    during: parseUpliftWindow(record['during']),
    deltaPercent: readNumber(record['deltaPercent']),
    deltaReason: deltaReason === 'zero_baseline' ? 'zero_baseline' : null,
    missingDuring: readDays(record['missingDuring']),
    missingBefore: readDays(record['missingBefore']),
  };
}

export async function fetchProductInsights(
  productId: number,
  windowDays: number,
  signal?: AbortSignal,
): Promise<Result<ProductInsightsView>> {
  const res = await getJson(
    `/api/insights/product/${encodeURIComponent(String(productId))}?window=${encodeURIComponent(String(windowDays))}`,
    signal,
  );
  if (!res.ok) return res;
  const body = asRecord(res.data);
  if (body === null) return { ok: false, error: UNREADABLE };
  const windows = parseWindows(body['discountWindows']);
  return {
    ok: true,
    data: {
      today: readText(body['today']),
      curve: productCurve(parseSeriesDays(body['series']), windows),
      windows,
      uplift: parseUplift(body['uplift']),
    },
  };
}

/* ───────── Obohatenie na dopyt: `POST /api/catalog/enrich` ─────────────── */

const ENRICH_OUTCOMES: readonly string[] = [
  'enriched',
  'fresh',
  'invalid_id',
  'not_in_mirror',
  'paused',
  'locked',
  'unknown_scope',
  'no_key',
  'budget_day',
  'budget_minute',
  'budget_unknown',
  'ip_banned',
  'rate_limited',
  'not_found',
  'reduction_unknown',
  'failed',
];

export interface EnrichResultView {
  readonly outcome: EnrichOutcomeKind;
  /** `true` = `getFull` sa nevolal, lebo riadok bol svieži. Úspora, nie chyba. */
  readonly fresh: boolean;
  /** Kedy sa produkt naposledy obohatil. `null` = nikdy (I11). */
  readonly enrichedAt: string | null;
}

/**
 * Dotiahne fakty pre JEDEN produkt.
 *
 * Volá sa RAZ na otvorenie panela nad jedným kusom (bod 3 hlavičky sekcie).
 * NIKDY nehádže a nikdy nevracia „chybu appky": aj odmietnutie shopu je
 * `outcome`, teda meraný výsledok.
 */
export async function enrichProduct(
  productId: number,
  signal?: AbortSignal,
): Promise<Result<EnrichResultView>> {
  let raw: unknown;
  try {
    const res = await fetch('/api/catalog/enrich', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
      signal,
    });
    raw = await bodyOf(res);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: ABORTED };
    }
    return { ok: false, error: OFFLINE };
  }

  const envelope = envelopeOf(raw);
  if (!envelope.ok) return envelope;
  const body = asRecord(envelope.data);
  if (body === null) return { ok: false, error: UNREADABLE };
  const outcome = body['outcome'];
  const enrichment = asRecord(body['enrichment']);
  return {
    ok: true,
    data: {
      /* Neznámy výsledok je `failed`, nie `enriched`: „obohatilo sa" je
         tvrdenie, ktoré sa z nečitateľnej odpovede urobiť nesmie. */
      outcome:
        typeof outcome === 'string' && ENRICH_OUTCOMES.includes(outcome)
          ? (outcome as EnrichOutcomeKind)
          : 'failed',
      fresh: readBool(body['fresh']) === true,
      enrichedAt: enrichment === null ? null : readText(enrichment['enrichedAt']),
    },
  };
}

/* ───────── Obohatenie STRANY: `POST /api/catalog/enrich` s `productIds` ─── */

const ENRICH_PAGE_OUTCOMES: readonly string[] = [
  'done',
  'fresh_only',
  'no_ids',
  'busy',
  'target_reached',
  'paused',
  'deadline',
  'locked',
  'unknown_scope',
  'no_key',
  'budget_day',
  'budget_minute',
  'budget_unknown',
  'ip_banned',
  'rate_limited',
  'failed',
];

/** Počet z odpovede. Chýbajúce číslo je NULA POKUSOV, nie „nevieme". */
const readTally = (value: unknown): number => readNumber(value) ?? 0;

/**
 * Dnešné počty. Tu sa `?? 0` NESMIE použiť: `null` znamená „stav dávky sa
 * nedal prečítať" alebo „dnes dávka nebežala", a nula by z toho urobila
 * tvrdenie, že sa dnes neobohatilo nič (I11).
 */
function readDayNumbers(raw: unknown): EnrichDayNumbers {
  const day = asRecord(raw);
  return {
    enrichedTodayByBatch: readNumber(day?.['enrichedTodayByBatch']),
    dailyTarget: readNumber(day?.['dailyTarget']),
    targetLeft: readNumber(day?.['targetLeft']),
    readsUsedToday: readNumber(day?.['readsUsedToday']),
    readsLeftToday: readNumber(day?.['readsLeftToday']),
    readsLimitToday: readNumber(day?.['readsLimitToday']),
  };
}

/**
 * Obohatí RIADKY PRÁVE ZOBRAZENEJ STRANY (D123, K2) — do 100 ID naraz.
 *
 * Toto je konzument, ktorý ceste `enrichPageOnDemand()` do 1. 9. 2026 chýbal:
 * engine aj routa boli hotové a otestované, ale z prehliadača ich nevolal
 * NIKTO, takže tabuľka zostávala plná pomlčiek bez ohľadu na kvótu. Volá sa
 * raz na otvorenie strany; o sviežosť (6 h), poradie priority, denný cieľ
 * a pauzy sa stará engine — klient si tu žiadnu vlastnú bránu nestavia, inak
 * by boli dve pravidlá o tom istom.
 *
 * NIKDY nehádže: aj odmietnutie shopu je `outcome`, teda meraný výsledok.
 */
export async function enrichPage(
  productIds: readonly number[],
  signal?: AbortSignal,
): Promise<Result<EnrichPageView>> {
  let raw: unknown;
  try {
    const res = await fetch('/api/catalog/enrich', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productIds: [...productIds] }),
      signal,
    });
    raw = await bodyOf(res);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: ABORTED };
    }
    return { ok: false, error: OFFLINE };
  }

  const envelope = envelopeOf(raw);
  if (!envelope.ok) return envelope;
  const body = asRecord(envelope.data);
  if (body === null) return { ok: false, error: UNREADABLE };
  const outcome = body['outcome'];
  const skipped = body['skipped'];
  return {
    ok: true,
    data: {
      /* Neznámy výsledok je `failed`, nie `done`: „obohatilo sa" je tvrdenie,
         ktoré sa z nečitateľnej odpovede urobiť nesmie. */
      outcome:
        typeof outcome === 'string' && ENRICH_PAGE_OUTCOMES.includes(outcome)
          ? (outcome as EnrichPageOutcomeKind)
          : 'failed',
      requested: readTally(body['requested']),
      fresh: readTally(body['fresh']),
      stale: readTally(body['stale']),
      attempted: readTally(body['attempted']),
      enriched: readTally(body['enriched']),
      skipped: Array.isArray(skipped) ? skipped.length : 0,
      day: readDayNumbers(body['day']),
      resumeAt: readText(body['resumeAt']),
      error: readText(body['error']),
    },
  };
}

/* ───────── Jedno miesto na `GET` s obálkou `{ok, data}` ────────────────── */

const ABORTED: ApiErrorView = { code: 'aborted', message: '' };
const UNREADABLE: ApiErrorView = {
  code: 'unreadable',
  message: 'Odpoveď servera sa nedá prečítať.',
};
const OFFLINE_MESSAGE = 'Server neodpovedá. Skúste to znova.';
const OFFLINE: ApiErrorView = { code: 'network', message: OFFLINE_MESSAGE };
const BAD_ENVELOPE: ApiErrorView = {
  code: 'unexpected',
  message: 'Server odpovedal inak, než sme čakali.',
};

/** Telo ako `unknown`; neplatný JSON je `undefined`, nie výnimka. */
async function bodyOf(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  }
}

/** Obálka `{ok, data}` → `Result<unknown>`. Čokoľvek iné je neprečítateľné. */
function envelopeOf(body: unknown): Result<unknown> {
  const record = asRecord(body);
  if (record === null || !('ok' in record)) return { ok: false, error: BAD_ENVELOPE };
  if (record['ok'] !== true) {
    const error = asRecord(record['error']);
    return {
      ok: false,
      error: {
        code: readText(error?.['code']) ?? BAD_ENVELOPE.code,
        message: readText(error?.['message']) ?? BAD_ENVELOPE.message,
      },
    };
  }
  return { ok: true, data: record['data'] };
}

async function getJson(url: string, signal?: AbortSignal): Promise<Result<unknown>> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
    return envelopeOf(await bodyOf(res));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: ABORTED };
    }
    return { ok: false, error: OFFLINE };
  }
}
