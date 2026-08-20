/**
 * Aura Zľavy — pravidlový analytik V1 (plán 33 §4, sekcia C3).
 *
 * DETERMINISTICKÝ kód: žiadne LLM volanie, žiadna sieť, žiadna náhodnosť —
 * čistá funkcia `analyze(snapshot)` nad dátami, ktoré appka UŽ MÁ (vlastná DB
 * + cache katalógu). Rovnaký vstup = rovnaký výstup; testovateľné offline.
 *
 * Poctivosť (I11): každé zistenie hovorí len o VLASTNÝCH zápisoch a vlastnom
 * pláne appky, nikdy o skutočnom stave zľavy v shope. Zásoba je LEN zásoba
 * variantov (`quantity` z /products/get — jediná, ktorú shop API dáva) a text
 * to musí povedať.
 *
 * PREDAJNOSŤ (KONTRAKT-PREDAJNOST-2026-08-06, P1): pravidlá smú pracovať
 * s počtom predaných KUSOV na produkt a deň z vlastnej tabuľky súčtov. Platia
 * pri tom tri hranice:
 *   · nie je to obrátkovosť — na tú chýba COGS aj zásoba nevariantných
 *     produktov, a dopočítavať ju je zakázané (I11),
 *   · nie sú to peniaze — zaplatená suma patrí celej objednávke, nie položke,
 *     takže obrat na produkt sa priradiť nedá (P4),
 *   · pokryté obdobie je krátke a nočne sa rozširuje (P3), preto KAŽDÉ zistenie
 *     o predaji musí v texte povedať, za aké obdobie to platí. Keď snímka
 *     predaje nemá (`sales == null`), žiadne takéto pravidlo sa nespustí —
 *     mlčať je poctivejšie než hlásiť nulu bez dát.
 *
 * Výstup je ČISTO ČÍTACÍ návrh: `action.href` otvára sprievodcu novej zľavy
 * s predvyplneným výberom (`/zlavy/nova?produkty=…`), kde platí plný dvojkrok
 * so skúškou naprázdno a potvrdením (I3).
 * Analytik sám nikdy nič nezapisuje a ani nemá čím — nedostáva žiadny klient.
 *
 * TEXT ZISTENIA JE POVRCH APPKY — TRI VECI SA V ŇOM SMÚ TICHO POKAZIŤ
 * -------------------------------------------------------------------
 * Do 20. 8. 2026 mala veta pravidla `ending_soon` v sebe všetky tri naraz
 * a nikto si to nevšimol, lebo nič nespadlo:
 *
 * 1. **Interný názov entity na povrchu.** V kóde je entita `campaign` a tak
 *    sa aj menuje v typoch, `id` a `kind` — to je správne a nemení sa. Do
 *    VETY ale patrí slovo, ktorým appka hovorí s používateľom, a to je
 *    **„zľava"**. Slovo „kampaň" v `text` ani v `action.label` nesmie byť.
 * 2. **ISO dátum.** `${c.dateTo}` je `YYYY-MM-DD`. Vypísaný priamo dá
 *    `2026-08-26` — tvar, ktorý sa po slovensky nepíše. Každý dátum ide cez
 *    `formatDateSk` (jediný formátovač dátumu, kontrakt UI bod 10).
 * 3. **Relatívny čas.** „o 7 dní" sa čítalo inak ráno a inak o týždeň, keď
 *    ostala veta v cache. Na povrchu je vždy konkrétny deň.
 *
 * Stráži to `test/unit/datumy-povrch.spec.ts` — pravidlá spustí naprázdno
 * a číta, čo z nich vyšlo, nie ako je to napísané.
 *
 * Vlastník: C3.
 */
import { fireAtUtc, todayInZone } from '@/lib/domain/dates';
import { formatDateSk } from '@/lib/ui/format';

/* ═══════════════════════════════ 1. Vstup ═════════════════════════════════ */

/** Kampaň v snímke — podmnožina `CampaignRecord` + produkty položiek. */
export interface RuleCampaign {
  id: number;
  name: string;
  status: string;
  percent: number;
  /** YYYY-MM-DD */
  dateFrom: string;
  /** YYYY-MM-DD */
  dateTo: string;
  itemsTotal: number;
  itemsOk: number;
  /** ID produktov kampane (na detekciu nadväznosti); môže byť prázdne. */
  productIds: number[];
}

/** Produkt allowlistu s posledným VLASTNÝM zápisom (I11). */
export interface RuleAllowlistProduct {
  productId: number;
  name: string | null;
  label: string | null;
  hasAttributes: boolean;
  lastOwnWrite: { percent: number; from: string; to: string } | null;
}

/** Zásoba variantov z cache katalógu — jediná zásoba, ktorú API dáva. */
export interface RuleVariantStock {
  productId: number;
  name: string | null;
  /** Množstvá jednotlivých variantov (len tie, ktoré shop vrátil). */
  quantities: number[];
  /** Kedy sa cache naposledy obnovila (ISO) — poctivosť o čerstvosti. */
  fetchedAt: string | null;
}

/**
 * Predajnosť jedného produktu za POKRYTÉ obdobie (nie za nastavené okno).
 * Kusy, nikdy peniaze (P4). `recentUnits`/`previousUnits` sú polovice obdobia
 * a sú `null`, keď je obdobie na porovnanie príliš krátke.
 */
export interface RuleProductSales {
  productId: number;
  name: string | null;
  label: string | null;
  unitsSold: number;
  unitsPerDay: number | null;
  lastSaleDay: string | null;
  daysSinceLastSale: number | null;
  recentUnits: number | null;
  previousUnits: number | null;
}

/** Pokryté obdobie predajnosti + metriky produktov v ňom. */
export interface RuleSalesWindow {
  /** Prvý a posledný deň, za ktorý appka predaje skutočne má. */
  from: string;
  to: string;
  /** Počet dní so skutočnými dátami — text zistenia ho musí uviesť. */
  daysCovered: number;
  /** Kedy prebehla poslednná synchronizácia (ISO) — poctivosť o čerstvosti. */
  lastSyncedAt: string | null;
  products: RuleProductSales[];
}

export interface RuleSnapshot {
  /** Dnešný deň v logickom pásme (YYYY-MM-DD). */
  today: string;
  /** Kľúč: prítomný a kedy expiruje (ISO) — NIKDY nič viac (I1). */
  keyPresent: boolean;
  keyExpiresAt: string | null;
  campaigns: RuleCampaign[];
  allowlist: RuleAllowlistProduct[];
  variantStock: RuleVariantStock[];
  /**
   * Predaje za pokryté obdobie. `null` alebo chýbajúce = appka o predaji nič
   * nevie (prvá synchronizácia ešte nebežala) a pravidlá o predajnosti mlčia.
   */
  sales?: RuleSalesWindow | null;
}

/* ═══════════════════════════════ 2. Výstup ════════════════════════════════ */

export type FindingKind =
  | 'ending_soon'
  | 'stale_product'
  | 'partial_campaign'
  | 'needs_intervention'
  | 'key_before_start'
  | 'low_variant_stock'
  | 'no_units_sold'
  | 'sales_declining';

export type FindingTone = 'attention' | 'info';

export interface Finding {
  /** Stabilné ID (kind + entita) — deterministické poradie aj deduplikácia. */
  id: string;
  kind: FindingKind;
  tone: FindingTone;
  /** Jedna slovenská veta — bez interných kódov rozhodnutí. */
  text: string;
  /** Kam sa dá preklikať (detail kampane, produkty…). */
  href: string;
  /** Odporúčaná akcia — otvára drawer s predvyplnením; dvojkrok platí ďalej. */
  action?: { label: string; href: string };
}

/* ═══════════════════════════ 3. Pomocníci dátumov ═════════════════════════ */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `day + n` dní → YYYY-MM-DD (UTC aritmetika nad date-only). */
export function addDaysOnly(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return dt.toISOString().slice(0, 10);
}

/** Počet dní `a → b` (kladný, keď `b` je neskôr). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000);
}

const isDay = (v: string): boolean => DAY_RE.test(v);

function productLabel(p: { productId: number; name: string | null; label: string | null }): string {
  return p.name ?? p.label ?? `produkt #${p.productId}`;
}

function pluralSk(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

/* ══════════════════════════════ 4. Konštanty ══════════════════════════════ */

/** Kampaň „končí čoskoro" = jej DO padne do 7 dní vrátane dneška. */
export const ENDING_SOON_DAYS = 7;
/** Produkt „dlho bez zľavy" = posledné vlastné okno skončilo pred >30 dňami. */
export const STALE_PRODUCT_DAYS = 30;
/** Variant s množstvom ≤ 3 sa hlási ako nízka zásoba. */
export const LOW_STOCK_THRESHOLD = 3;

/**
 * Koľko kusov musí byť v staršej polovici obdobia, aby sa dalo hovoriť
 * o poklese. Pri jednom kuse je „pokles" len šum jedného nákupu, nie trend.
 */
export const SALES_DROP_MIN_PREVIOUS = 2;
/** Pokles sa hlási, keď novšia polovica dosiahne najviac túto časť staršej. */
export const SALES_DROP_RATIO = 0.5;

/** Stavy, v ktorých kampaň reálne pokrýva/pokryje svoje okno. */
const COVERING_STATUSES = new Set(['scheduled', 'running', 'done', 'partial', 'needs_key']);

/* ═══════════════════════════════ 5. Pravidlá ══════════════════════════════ */

/**
 * URL akcie „otvor novú zľavu s predvyplneným výberom" — dvojkrok (skúška
 * naprázdno + potvrdenie) platí ďalej, návrh nič nezapisuje.
 *
 * Mieri PRIAMO na `/zlavy/nova` (K9); cez starú `/kampane?nova=1` to fungovalo
 * tiež, ale cez zbytočný skok presmerovaním.
 *
 * `od`/`do` nesie okno nadväzujúcej zľavy — bez neho by ho používateľ po
 * kliknutí na návrh prepisoval ručne. `percent` sa NEPOSIELA: percento sa v
 * sprievodcovi rozhoduje pásmami (K3), jedno číslo z návrhu preň nemá miesto.
 */
function drawerHref(productIds: number[], _percent?: number, from?: string, to?: string): string {
  const qs = new URLSearchParams();
  if (productIds.length > 0) qs.set('produkty', productIds.join(','));
  // `od` chodí aj samo — návrh vie, kedy predošlá zľava končí, ale dĺžku novej
  // určuje sprievodca.
  if (from !== undefined) qs.set('od', from);
  if (to !== undefined) qs.set('do', to);
  const query = qs.toString();
  return query === '' ? '/zlavy/nova' : `/zlavy/nova?${query}`;
}

/** 1 — kampane končiace do 7 dní bez nadväzujúcej kampane. */
function findEndingSoon(s: RuleSnapshot): Finding[] {
  const horizon = addDaysOnly(s.today, ENDING_SOON_DAYS);
  const out: Finding[] = [];
  for (const c of s.campaigns) {
    const activeNow =
      (c.status === 'done' || c.status === 'partial' || c.status === 'running') &&
      c.dateFrom <= s.today &&
      c.dateTo >= s.today;
    if (!activeNow || c.dateTo > horizon) continue;

    const hasFollowUp = s.campaigns.some(
      (other) =>
        other.id !== c.id &&
        COVERING_STATUSES.has(other.status) &&
        other.dateFrom > c.dateTo &&
        (c.productIds.length === 0 ||
          other.productIds.some((id) => c.productIds.includes(id))),
    );
    if (hasFollowUp) continue;

    out.push({
      id: `ending_soon:${c.id}`,
      kind: 'ending_soon',
      tone: 'info',
      text: `„${c.name}" končí ${formatDateSk(c.dateTo)}. Nenadväzuje žiadna ďalšia zľava.`,
      href: `/zlavy/${c.id}`,
      action: {
        label: 'Pripraviť nadväzujúcu zľavu',
        href: drawerHref(c.productIds, c.percent, addDaysOnly(c.dateTo, 1)),
      },
    });
  }
  return out;
}

/** 2 — produkty allowlistu bez vlastnej zľavy dlhšie než 30 dní. */
function findStaleProducts(s: RuleSnapshot): Finding[] {
  const out: Finding[] = [];
  for (const p of s.allowlist) {
    if (p.lastOwnWrite == null) {
      out.push({
        id: `stale_product:${p.productId}:never`,
        kind: 'stale_product',
        tone: 'info',
        text: `${productLabel(p)} (#${p.productId}) nemá žiadny vlastný zápis zľavy — appka o jeho zľavách nič nevie.`,
        href: '/produkty',
        action: { label: 'Navrhnúť zľavu', href: drawerHref([p.productId]) },
      });
      continue;
    }
    if (p.lastOwnWrite.to >= s.today) continue;
    const daysSince = daysBetween(p.lastOwnWrite.to, s.today);
    if (daysSince <= STALE_PRODUCT_DAYS) continue;
    out.push({
      id: `stale_product:${p.productId}`,
      kind: 'stale_product',
      tone: 'info',
      text: `${productLabel(p)} (#${p.productId}) je podľa vlastných zápisov bez zľavy od ${formatDateSk(p.lastOwnWrite.to)}.`,
      href: '/produkty',
      action: {
        label: 'Navrhnúť zľavu',
        href: drawerHref([p.productId], p.lastOwnWrite.percent),
      },
    });
  }
  return out;
}

/** 3 — čiastočné kampane s nedopísanými produktmi. */
function findPartialCampaigns(s: RuleSnapshot): Finding[] {
  return s.campaigns
    .filter((c) => c.status === 'partial')
    .map((c) => {
      const missing = Math.max(0, c.itemsTotal - c.itemsOk);
      return {
        id: `partial_campaign:${c.id}`,
        kind: 'partial_campaign' as const,
        tone: 'attention' as const,
        text: `Zľava „${c.name}" je čiastočná — ${missing} z ${c.itemsTotal} ${pluralSk(c.itemsTotal, 'produktu', 'produktov', 'produktov')} sa nezapísalo.`,
        href: `/zlavy/${c.id}`,
        action: { label: 'Otvoriť detail a zopakovať zlyhané', href: `/zlavy/${c.id}` },
      };
    });
}

/** 4 — kampane vyžadujúce zásah: needs_key a missed s ROVNAKOU váhou (D8/D33b). */
function findNeedsIntervention(s: RuleSnapshot): Finding[] {
  return s.campaigns
    .filter((c) => c.status === 'needs_key' || c.status === 'missed')
    .map((c) => ({
      id: `needs_intervention:${c.id}`,
      kind: 'needs_intervention' as const,
      tone: 'attention' as const,
      text:
        c.status === 'needs_key'
          ? `Zľava „${c.name}" čaká na kľúč na zápis — bez neho sa okno ${formatDateSk(c.dateFrom)} – ${formatDateSk(c.dateTo)} nezapíše.`
          : `Zľava „${c.name}" sa zmeškala — plánovaný zápis pre okno ${formatDateSk(c.dateFrom)} – ${formatDateSk(c.dateTo)} neprebehol.`,
      href: `/zlavy/${c.id}`,
      action: { label: 'Otvoriť detail zľavy', href: `/zlavy/${c.id}` },
    }));
}

/**
 * 5 — kľúč expiruje (alebo chýba) pred štartom naplánovanej kampane.
 *
 * Porovnáva sa OKAMIH: `fire_at` kampane (`date_from` o čase spustenia
 * v logickej zóne, `fireAtUtc`) proti UTC okamihu expirácie kľúča. Porovnanie
 * UTC `slice(0,10)` s lokálnym `dateFrom` by okolo polnoci dávalo ±1 deň
 * falošné poplachy aj falošné ticho.
 */
function findKeyBeforeStart(s: RuleSnapshot): Finding[] {
  const out: Finding[] = [];
  const expiresAt =
    s.keyExpiresAt != null && !Number.isNaN(new Date(s.keyExpiresAt).getTime())
      ? new Date(s.keyExpiresAt)
      : null;
  for (const c of s.campaigns) {
    if (c.status !== 'scheduled') continue;
    if (!isDay(c.dateFrom) || c.dateFrom < s.today) continue;
    if (!s.keyPresent) {
      out.push({
        id: `key_before_start:${c.id}:missing`,
        kind: 'key_before_start',
        tone: 'attention',
        text: `Zľava „${c.name}" štartuje ${formatDateSk(c.dateFrom)}, ale kľúč na zápis nie je uložený — zľava by sa nezapísala.`,
        href: `/zlavy/${c.id}`,
        action: { label: 'Vložiť kľúč v Nastaveniach', href: '/nastavenia' },
      });
      continue;
    }
    if (expiresAt != null && expiresAt.getTime() < fireAtUtc(c.dateFrom).getTime()) {
      const expiresDayLocal = todayInZone(expiresAt);
      out.push({
        id: `key_before_start:${c.id}`,
        kind: 'key_before_start',
        tone: 'attention',
        text: `Kľúč na zápis platí len do ${formatDateSk(expiresDayLocal)}, teda pred štartom zľavy „${c.name}" (${formatDateSk(c.dateFrom)}) — bez nového kľúča sa zápis nevykoná.`,
        href: `/zlavy/${c.id}`,
        action: { label: 'Vložiť nový kľúč v Nastaveniach', href: '/nastavenia' },
      });
    }
  }
  return out;
}

/** 6 — nízka zásoba variantov (LEN variantné produkty — jediná zásoba z API). */
function findLowVariantStock(s: RuleSnapshot): Finding[] {
  const out: Finding[] = [];
  for (const v of s.variantStock) {
    const low = v.quantities.filter((q) => Number.isFinite(q) && q <= LOW_STOCK_THRESHOLD);
    if (low.length === 0) continue;
    const min = Math.min(...low);
    out.push({
      id: `low_variant_stock:${v.productId}`,
      kind: 'low_variant_stock',
      tone: 'info',
      text: `${v.name ?? `Produkt #${v.productId}`} má ${low.length} ${pluralSk(low.length, 'variant', 'varianty', 'variantov')} so zásobou ≤ ${LOW_STOCK_THRESHOLD} ks (najmenej ${min} ks) — údaj platí len pre variantné produkty a pochádza z poslednej obnovy katalógu${v.fetchedAt ? ` (${formatDateSk(v.fetchedAt)})` : ''}.`,
      href: '/produkty',
    });
  }
  return out;
}

/** Popis pokrytého obdobia do textu zistenia — nikdy sa nesmie vynechať (P3). */
function salesPeriodSk(sales: RuleSalesWindow): string {
  const span =
    sales.from === sales.to
      ? formatDateSk(sales.from)
      : `${formatDateSk(sales.from)} – ${formatDateSk(sales.to)}`;
  return `${span}, ${sales.daysCovered} ${pluralSk(sales.daysCovered, 'sledovaný deň', 'sledované dni', 'sledovaných dní')}`;
}

/**
 * 7 — produkt sa za sledované obdobie nepredal ani raz.
 *
 * Text POVINNE hovorí, že obdobie je krátke: pri troch dňoch je „nepredal sa"
 * úplne normálne aj u produktu, ktorý sa predáva raz za týždeň (P3). Zistenie
 * je preto návrh (`info`), nie zásah — appka nevie, či je to problém.
 */
function findNoUnitsSold(s: RuleSnapshot): Finding[] {
  const sales = s.sales;
  if (!sales || sales.daysCovered <= 0 || !isDay(sales.from) || !isDay(sales.to)) return [];
  const out: Finding[] = [];
  for (const p of sales.products) {
    if (p.unitsSold !== 0) continue;
    out.push({
      id: `no_units_sold:${p.productId}`,
      kind: 'no_units_sold',
      tone: 'info',
      text: `${productLabel(p)} (#${p.productId}) sa za sledované obdobie (${salesPeriodSk(sales)}) nepredal ani raz. Obdobie je krátke — produkt s predajom raz za týždeň tu vyzerá rovnako, história sa dopĺňa ďalšími behmi synchronizácie.`,
      href: '/produkty',
      action: { label: 'Navrhnúť zľavu', href: drawerHref([p.productId]) },
    });
  }
  return out;
}

/**
 * 8 — predajnosť klesla: novšia polovica obdobia proti staršej.
 *
 * Porovnávajú sa KUSY, nie peniaze (P4), a len keď má obdobie dosť dní na
 * rozdelenie (polovice prídu z výpočtu už hotové; `null` znamená „nemeriteľné").
 */
function findSalesDeclining(s: RuleSnapshot): Finding[] {
  const sales = s.sales;
  if (!sales || sales.daysCovered <= 0 || !isDay(sales.from) || !isDay(sales.to)) return [];
  const out: Finding[] = [];
  for (const p of sales.products) {
    const { recentUnits, previousUnits } = p;
    if (recentUnits == null || previousUnits == null) continue;
    if (previousUnits < SALES_DROP_MIN_PREVIOUS) continue;
    if (recentUnits > previousUnits * SALES_DROP_RATIO) continue;
    out.push({
      id: `sales_declining:${p.productId}`,
      kind: 'sales_declining',
      tone: 'info',
      text: `${productLabel(p)} (#${p.productId}) predal v novšej polovici sledovaného obdobia ${recentUnits} ${pluralSk(recentUnits, 'kus', 'kusy', 'kusov')} proti ${previousUnits} v staršej (${salesPeriodSk(sales)}) — predajnosť klesla. Ide o počet kusov, nie o obrat.`,
      href: '/produkty',
      action: { label: 'Navrhnúť zľavu', href: drawerHref([p.productId]) },
    });
  }
  return out;
}

/* ═══════════════════════════════ 6. Analýza ═══════════════════════════════ */

const TONE_ORDER: Record<FindingTone, number> = { attention: 0, info: 1 };

/**
 * Spustí všetky pravidlá V1 nad snímkou. Poradie výstupu je deterministické:
 * najprv tón (zásah pred informáciou), potom druh pravidla, potom ID entity.
 */
export function analyze(snapshot: RuleSnapshot): Finding[] {
  if (!isDay(snapshot.today)) return [];
  const findings = [
    ...findNeedsIntervention(snapshot),
    ...findPartialCampaigns(snapshot),
    ...findKeyBeforeStart(snapshot),
    ...findEndingSoon(snapshot),
    ...findStaleProducts(snapshot),
    ...findLowVariantStock(snapshot),
    ...findNoUnitsSold(snapshot),
    ...findSalesDeclining(snapshot),
  ];
  return findings.sort(
    (a, b) =>
      TONE_ORDER[a.tone] - TONE_ORDER[b.tone] ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Zásoby variantov z `catalog_cache.raw` (uložený `ProductDetail`).
 * Fail-closed parsovanie: čokoľvek mimo očakávaného tvaru sa ticho vynechá —
 * radšej žiadne zistenie než vymyslené číslo (I11).
 */
export function variantStockFromRaw(
  productId: number,
  name: string | null,
  raw: unknown,
  fetchedAt: string | null,
): RuleVariantStock | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const attributes = (raw as { attributes?: unknown }).attributes;
  if (!Array.isArray(attributes)) return null;
  const quantities: number[] = [];
  for (const attr of attributes) {
    if (typeof attr !== 'object' || attr === null) continue;
    const q = (attr as { quantity?: unknown }).quantity;
    const n = typeof q === 'number' ? q : typeof q === 'string' ? Number(q) : NaN;
    if (Number.isFinite(n)) quantities.push(n);
  }
  if (quantities.length === 0) return null;
  return { productId, name, quantities, fetchedAt };
}
