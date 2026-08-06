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
 * to musí povedať. Žiadne orders dáta (I8) — predajnosť tu neexistuje.
 *
 * Výstup je ČISTO ČÍTACÍ návrh: `action.href` otvára drawer s predvyplnením
 * (`/kampane?nova=1&…`), kde platí plný dvojkrok s dry-run potvrdením (I3).
 * Analytik sám nikdy nič nezapisuje a ani nemá čím — nedostáva žiadny klient.
 *
 * Vlastník: C3.
 */

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

export interface RuleSnapshot {
  /** Dnešný deň v logickom pásme (YYYY-MM-DD). */
  today: string;
  /** Kľúč: prítomný a kedy expiruje (ISO) — NIKDY nič viac (I1). */
  keyPresent: boolean;
  keyExpiresAt: string | null;
  campaigns: RuleCampaign[];
  allowlist: RuleAllowlistProduct[];
  variantStock: RuleVariantStock[];
}

/* ═══════════════════════════════ 2. Výstup ════════════════════════════════ */

export type FindingKind =
  | 'ending_soon'
  | 'stale_product'
  | 'partial_campaign'
  | 'needs_intervention'
  | 'key_before_start'
  | 'low_variant_stock';

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

/** Stavy, v ktorých kampaň reálne pokrýva/pokryje svoje okno. */
const COVERING_STATUSES = new Set(['scheduled', 'running', 'done', 'partial', 'needs_key']);

/* ═══════════════════════════════ 5. Pravidlá ══════════════════════════════ */

/** URL akcie „otvor drawer s predvyplnením" — dvojkrok v draweri platí ďalej. */
function drawerHref(productIds: number[], percent?: number, from?: string, to?: string): string {
  const qs = new URLSearchParams({ nova: '1' });
  if (productIds.length > 0) qs.set('produkty', productIds.join(','));
  if (percent != null) qs.set('percent', String(percent));
  if (from) qs.set('od', from);
  if (to) qs.set('do', to);
  return `/kampane?${qs.toString()}`;
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

    const days = daysBetween(s.today, c.dateTo);
    out.push({
      id: `ending_soon:${c.id}`,
      kind: 'ending_soon',
      tone: 'info',
      text: `Kampaň „${c.name}" končí ${days === 0 ? 'dnes' : `o ${days} ${pluralSk(days, 'deň', 'dni', 'dní')}`} (${c.dateTo}) a na jej produkty nenadväzuje žiadna ďalšia kampaň.`,
      href: `/kampane/${c.id}`,
      action: {
        label: 'Pripraviť nadväzujúcu kampaň',
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
        action: { label: 'Navrhnúť kampaň', href: drawerHref([p.productId]) },
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
      text: `${productLabel(p)} (#${p.productId}) je podľa vlastných zápisov bez zľavy už ${daysSince} dní (posledné okno skončilo ${p.lastOwnWrite.to}).`,
      href: '/produkty',
      action: {
        label: 'Navrhnúť kampaň',
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
        text: `Kampaň „${c.name}" je čiastočná — ${missing} z ${c.itemsTotal} ${pluralSk(c.itemsTotal, 'produktu', 'produktov', 'produktov')} sa nezapísalo.`,
        href: `/kampane/${c.id}`,
        action: { label: 'Otvoriť detail a zopakovať zlyhané', href: `/kampane/${c.id}` },
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
          ? `Kampaň „${c.name}" čaká na API kľúč — bez neho sa okno ${c.dateFrom} – ${c.dateTo} nezapíše.`
          : `Kampaň „${c.name}" sa zmeškala — plánovaný zápis pre okno ${c.dateFrom} – ${c.dateTo} neprebehol.`,
      href: `/kampane/${c.id}`,
      action: { label: 'Otvoriť detail kampane', href: `/kampane/${c.id}` },
    }));
}

/** 5 — kľúč expiruje (alebo chýba) pred štartom naplánovanej kampane. */
function findKeyBeforeStart(s: RuleSnapshot): Finding[] {
  const out: Finding[] = [];
  const expiresDay =
    s.keyExpiresAt != null && !Number.isNaN(new Date(s.keyExpiresAt).getTime())
      ? s.keyExpiresAt.slice(0, 10)
      : null;
  for (const c of s.campaigns) {
    if (c.status !== 'scheduled') continue;
    if (!isDay(c.dateFrom) || c.dateFrom < s.today) continue;
    if (!s.keyPresent) {
      out.push({
        id: `key_before_start:${c.id}:missing`,
        kind: 'key_before_start',
        tone: 'attention',
        text: `Kampaň „${c.name}" štartuje ${c.dateFrom}, ale API kľúč nie je uložený — zápis by skončil v stave „vyžaduje kľúč".`,
        href: `/kampane/${c.id}`,
        action: { label: 'Vložiť kľúč v Nastaveniach', href: '/nastavenia' },
      });
      continue;
    }
    if (expiresDay != null && expiresDay < c.dateFrom) {
      out.push({
        id: `key_before_start:${c.id}`,
        kind: 'key_before_start',
        tone: 'attention',
        text: `API kľúč expiruje ${expiresDay}, teda pred štartom kampane „${c.name}" (${c.dateFrom}) — bez nového kľúča sa zápis nevykoná.`,
        href: `/kampane/${c.id}`,
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
      text: `${v.name ?? `Produkt #${v.productId}`} má ${low.length} ${pluralSk(low.length, 'variant', 'varianty', 'variantov')} so zásobou ≤ ${LOW_STOCK_THRESHOLD} ks (najmenej ${min} ks) — údaj platí len pre variantné produkty a pochádza z poslednej obnovy katalógu${v.fetchedAt ? ` (${v.fetchedAt.slice(0, 10)})` : ''}.`,
      href: '/produkty',
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
