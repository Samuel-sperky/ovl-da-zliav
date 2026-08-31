/**
 * Aura Zľavy — PRESETY NA STRANE OBRAZOVKY (D112, K7; KONTRAKT-V4-2026-08-28).
 *
 * Preset je pomenovaná kombinácia filtra katalógu, pásiem s percentami a dĺžky
 * okna. Tento modul je jeho JEDINÁ cesta do appky: preloží uložený preset na
 * ADRESU formulára novej zľavy a naopak — aktuálne nastavenie formulára na telo
 * `POST /api/presets`.
 *
 * ═══ SPUSTENIE PRESETU JE PREDPLNENIE FORMULÁRA, NIE ZÁPIS (I3) ═══
 *
 * Tu NIE JE a nesmie vzniknúť funkcia, ktorá z presetu vyrobí kampaň alebo
 * zápis do shopu. `presetPrefillHref()` vracia obyčajný odkaz na
 * `/zlavy/nova` — teda na tú istú obrazovku, tú istú skúšku naprázdno
 * (`engine/preview`) a to isté potvrdenie ako každá zľava. Preset do zápisovej
 * cesty NEVSTUPUJE; vypĺňa polia.
 *
 * Dôvod nie je štýlový: appka nemá prihlásenie (D98–D100), takže dry-run
 * a potvrdenie sú JEDINÉ, čo pred PRODUKČNÝM eshopom zostalo. Preset drží
 * presne tie hodnoty, ktoré dry-run overuje — a preset uložený minulý mesiac
 * nad medzitým zmeneným katalógom je INÁ množina produktov než tá, ktorú
 * človek videl. Kto sem o mesiac príde „zjednodušiť dva kliky na jeden", ruší
 * poslednú bránu pred produkčným eshopom. To isté je napísané na serveri
 * v `src/app/api/presets/_shared.ts`; tieto dva texty patria k sebe.
 *
 * ═══ ČO SA TU NEDOPOČÍTAVA (I11) ═══
 *
 *  - Koľko produktov do pásma padne, sa vie až z dry-runu nad AKTUÁLNYM
 *    katalógom. Preset nesie percentá a pravidlo, nikdy počty.
 *  - `lastUsedAt: null` je „ešte nepoužitý", nie „použitý v epoche".
 *  - Pásmo bez čitateľného pravidla (`rule.bucket`) sa do predplnenia
 *    NEPREKLADÁ — percento by inak sadlo na náhodné pásmo. Prizná sa to
 *    (`unmappedTiers`), nie zamlčí.
 *
 * Vlastník: V4 (obrazovka Zľavy).
 */
import {
  DEFAULT_TIER_PERCENT,
  SOLD_BUCKET_ORDER,
  type SoldBucketKey,
  type TierPlan,
} from '@/components/campaigns/discounts-model';
import type { DiscountRow, TierView } from '@/components/campaigns/zlavy-api';
import {
  DEFAULT_CATALOG_FILTER,
  SOLD_WINDOWS,
  catalogFilterKey,
  type CatalogFilterState,
  type SoldWindow,
} from '@/components/products/catalog-filter';
import { diffDays } from '@/lib/domain/dates';

/* ═══════════════════════════ 1. Tvar presetu ══════════════════════════════ */

/** Pásmo presetu tak, ako ho vracia `GET /api/presets`. */
export interface PresetTierView {
  readonly ord: number;
  readonly label: string;
  readonly percent: number;
  /** LEN na zobrazenie a na predplnenie. Nikdy sa nevyhodnocuje pri zápise. */
  readonly rule?: unknown;
}

/** Preset v podobe, v akej ho číta obrazovka. */
export interface PresetView {
  readonly id: number;
  readonly name: string;
  readonly filterQuery: string;
  readonly tiers: readonly PresetTierView[];
  readonly durationDays: number;
  readonly createdAt: string;
  /** `null` = ešte nepoužitý (I11). */
  readonly lastUsedAt: string | null;
}

/** Telo `POST /api/presets`. Počty pásiem sa NEPOSIELAJÚ (viď hlavičku). */
export interface PresetDraft {
  readonly name: string;
  readonly filterQuery: string;
  readonly tiers: readonly {
    readonly ord: number;
    readonly label: string;
    readonly percent: number;
    readonly rule: { readonly soldWindowDays: number; readonly bucket: SoldBucketKey };
  }[];
  readonly durationDays: number;
}

/** Hranice, ktoré drží zod na serveri aj `ck_presets_*` v migrácii 0015. */
export const PRESET_NAME_MAX = 60;
export const PRESET_DURATION_MIN = 1;
export const PRESET_DURATION_MAX = 90;

/* ═══════════════════════ 2. Pravidlo pásma z presetu ══════════════════════ */

/**
 * Pravidlo pásma („ktoré vedro predajnosti a za koľko dní") z `rule`.
 *
 * `rule` je zámerne `unknown` — príde zo servera tak, ako ho appka uložila, a
 * mohla ho uložiť starším tvarom. Nečitateľné pravidlo je `null`, teda
 * „nevieme, ktorého pásma sa to percento týka", nie tichý odhad na `none`.
 */
export function tierRuleOf(
  rule: unknown,
): { bucket: SoldBucketKey; soldWindowDays: SoldWindow | null } | null {
  if (typeof rule !== 'object' || rule === null) return null;
  const record = rule as Record<string, unknown>;
  const bucket = record['bucket'];
  if (typeof bucket !== 'string') return null;
  const known = SOLD_BUCKET_ORDER.find((key) => key === bucket);
  if (known === undefined) return null;
  const days = record['soldWindowDays'];
  const window = SOLD_WINDOWS.find((value) => value === days) ?? null;
  return { bucket: known, soldWindowDays: window };
}

/** Percentá pre `buildTiers()` + priznanie, koľko pásiem sa preložiť nedalo. */
export interface PresetPercents {
  readonly percents: Readonly<Partial<Record<SoldBucketKey, number>>>;
  /** Koľko pásiem nemalo čitateľné pravidlo — obrazovka to POVIE (I11). */
  readonly unmappedTiers: number;
}

export function presetPercents(tiers: readonly PresetTierView[]): PresetPercents {
  const percents: Partial<Record<SoldBucketKey, number>> = {};
  let unmapped = 0;
  for (const tier of tiers) {
    const rule = tierRuleOf(tier.rule);
    if (rule === null) {
      unmapped += 1;
      continue;
    }
    percents[rule.bucket] = tier.percent;
  }
  return { percents, unmappedTiers: unmapped };
}

/** Najvyššie percento presetu — to isté číslo, aké nesie hlavička zľavy (K3). */
export function presetHeadlinePercent(tiers: readonly PresetTierView[]): number {
  let max = 0;
  for (const tier of tiers) if (tier.percent > max) max = tier.percent;
  return max;
}

/* ═══════════════════════ 3. Preset → adresa formulára ═════════════════════ */

/** `{none: 30, low: 20}` → `none:30,low:20`. Poradie je poradie pásiem. */
export function formatPercentsParam(
  percents: Readonly<Partial<Record<SoldBucketKey, number>>>,
): string {
  const parts: string[] = [];
  for (const bucket of SOLD_BUCKET_ORDER) {
    const value = percents[bucket];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1 || value > 30) continue;
    parts.push(`${bucket}:${value}`);
  }
  return parts.join(',');
}

/**
 * `none:30,low:20` → `{none: 30, low: 20}`.
 *
 * Adresa je vstup od človeka (dá sa uložiť do záložiek), takže sa jej neverí:
 * neznáme vedro aj percento mimo 1–30 sa ZAHADZUJE, nie orezáva. Orezané
 * percento by bolo číslo, ktoré si appka vymyslela za používateľa — a pod ním
 * by sa podpisoval zápis do ostrého eshopu.
 */
export function parsePercentsParam(
  raw: string | undefined,
): Partial<Record<SoldBucketKey, number>> {
  const out: Partial<Record<SoldBucketKey, number>> = {};
  if (raw === undefined) return out;
  for (const part of raw.split(',')) {
    const [key, value] = part.split(':');
    if (key === undefined || value === undefined) continue;
    const bucket = SOLD_BUCKET_ORDER.find((known) => known === key.trim());
    if (bucket === undefined) continue;
    const percent = Number(value.trim());
    if (!Number.isInteger(percent) || percent < 1 || percent > 30) continue;
    out[bucket] = percent;
  }
  return out;
}

/** Dĺžka okna z adresy. Mimo 1–90 dní je `null` — appka si ju doplní sama. */
export function parseDurationParam(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const days = Number(raw.trim());
  if (!Number.isInteger(days)) return null;
  return days >= PRESET_DURATION_MIN && days <= PRESET_DURATION_MAX ? days : null;
}

/**
 * Kam vedie klik na preset. Je to odkaz na FORMULÁR novej zľavy — nič viac.
 *
 * Filter ide ako hotový query string (ten istý tvar, aký posiela tlačidlo
 * `Zlacniť` z Produktov), percentá ako `pasma`, dĺžka okna ako `dni`. Meno
 * presetu sa posiela ako `preset` výhradne na to, aby formulár mohol povedať,
 * odkiaľ sú predplnené polia — na zápis nemá vplyv.
 */
export function presetPrefillHref(preset: PresetView): string {
  const params = new URLSearchParams();
  if (preset.filterQuery.trim() !== '') params.set('filter', preset.filterQuery);
  const percents = formatPercentsParam(presetPercents(preset.tiers).percents);
  if (percents !== '') params.set('pasma', percents);
  params.set('dni', String(preset.durationDays));
  params.set('preset', preset.name);
  return `/zlavy/nova?${params.toString()}`;
}

/* ═══════════════════ 4. Formulár → telo `POST /api/presets` ═══════════════ */

/**
 * Aktuálne nastavenie formulára ako preset.
 *
 * `null` znamená „z tohto sa preset uložiť nedá" a je to fail-closed: bez mena,
 * bez pásiem alebo s oknom mimo 1–90 dní by server odpovedal 400 a používateľ
 * by videl chybu servera namiesto vety o vlastnom formulári.
 */
export function presetDraftFrom(input: {
  readonly name: string;
  readonly filter: CatalogFilterState;
  readonly tiers: readonly TierPlan[];
  readonly windowDays: number;
}): PresetDraft | null {
  const name = input.name.trim();
  if (name === '' || name.length > PRESET_NAME_MAX) return null;
  if (input.tiers.length === 0) return null;
  if (
    !Number.isInteger(input.windowDays) ||
    input.windowDays < PRESET_DURATION_MIN ||
    input.windowDays > PRESET_DURATION_MAX
  ) {
    return null;
  }
  return {
    name,
    filterQuery: catalogFilterKey(input.filter),
    tiers: input.tiers.map((tier) => ({
      ord: tier.ord,
      // Ten istý label, aký ide do `campaign_tiers` — pásmo sa musí dať spoznať.
      label: `${tier.letter} · ${tier.label}`,
      percent: tier.percent,
      // Pravidlo je to jediné, čo z percenta robí pásmo. Bez neho by sa preset
      // predplniť nedal (viď `presetPercents`).
      rule: { soldWindowDays: input.filter.soldWindowDays, bucket: tier.bucket },
    })),
    durationDays: input.windowDays,
  };
}

/** Prečo sa uložiť nedá — veta pre človeka, alebo `null` keď sa dá. */
export function presetSaveBlockedReason(input: {
  readonly name: string;
  readonly tiers: readonly TierPlan[];
  readonly windowDays: number;
}): string | null {
  const name = input.name.trim();
  if (name === '') return 'Preset potrebuje meno.';
  if (name.length > PRESET_NAME_MAX) return `Meno má najviac ${PRESET_NAME_MAX} znakov.`;
  if (input.tiers.length === 0) return 'Bez výberu produktov nie je čo uložiť.';
  if (
    !Number.isInteger(input.windowDays) ||
    input.windowDays < PRESET_DURATION_MIN ||
    input.windowDays > PRESET_DURATION_MAX
  ) {
    return `Okno zľavy musí mať ${PRESET_DURATION_MIN}–${PRESET_DURATION_MAX} dní.`;
  }
  return null;
}

/* ═══════════════════ 5. Zopakovanie minulej zľavy (K7) ════════════════════ */

/**
 * „Zopakovať zľavu" — adresa formulára predplnená podľa MINULEJ kampane.
 *
 * Prenáša sa pravidlo pásiem, percentá a DĹŽKA okna. Produkty sa NEPRENÁŠAJÚ
 * a je to zámer: sada sa vyberie znova z aktuálneho katalógu, pretože minulá
 * kampaň bežala nad iným (produkt medzitým pribudol, vypredal sa, alebo už má
 * inú zľavu). Prenesený zoznam ID by predstieral, že appka vie, čo je dnes
 * v pásme — a to vie až dry-run.
 *
 * Keď pásma kampane nenesú čitateľné pravidlo (jedno percento na celý výber),
 * filter sa NEPOSIELA vôbec: formulár si vtedy nechá svoj predvolený výber
 * ležiakov a percento sa predplní pre všetky pásma.
 */
export function repeatDiscountHref(row: DiscountRow): string {
  const params = new URLSearchParams();
  const rules = row.tiers.map((tier) => ({ tier, rule: tierRuleOf(tier.rule) }));
  const mapped = rules.filter(
    (entry): entry is { tier: TierView; rule: NonNullable<ReturnType<typeof tierRuleOf>> } =>
      entry.rule !== null,
  );

  if (mapped.length > 0) {
    const windowDays =
      mapped.map((entry) => entry.rule.soldWindowDays).find((days) => days !== null) ??
      DEFAULT_CATALOG_FILTER.soldWindowDays;
    const filter: CatalogFilterState = {
      ...DEFAULT_CATALOG_FILTER,
      soldWindowDays: windowDays,
      soldBuckets: mapped.map((entry) => entry.rule.bucket),
    };
    params.set('filter', catalogFilterKey(filter));
    const percents: Partial<Record<SoldBucketKey, number>> = {};
    for (const entry of mapped) percents[entry.rule.bucket] = entry.tier.percent;
    const formatted = formatPercentsParam(percents);
    if (formatted !== '') params.set('pasma', formatted);
  } else {
    // Bez pravidiel sa dá zopakovať len percento a dĺžka. Percento kampane
    // dostanú všetky pásma — je to presne to, čo mala kampaň: jedno číslo.
    const percents: Partial<Record<SoldBucketKey, number>> = {};
    for (const bucket of SOLD_BUCKET_ORDER) percents[bucket] = row.percent;
    const formatted = formatPercentsParam(percents);
    if (formatted !== '') params.set('pasma', formatted);
  }

  const days = campaignWindowDays(row.dateFrom, row.dateTo);
  if (days !== null) params.set('dni', String(days));
  params.set('zopakovat', row.name);
  return `/zlavy/nova?${params.toString()}`;
}

/** Inkluzívna dĺžka okna kampane, alebo `null` keď je mimo 1–90 dní. */
export function campaignWindowDays(from: string, to: string): number | null {
  const shape = /^\d{4}-\d{2}-\d{2}$/;
  if (!shape.test(from) || !shape.test(to)) return null;
  const days = diffDays(from, to) + 1;
  return days >= PRESET_DURATION_MIN && days <= PRESET_DURATION_MAX ? days : null;
}

/* ═══════════════════════════ 6. Vety pre obrazovku ════════════════════════ */

/**
 * Čo preset robí a čo NEROBI. Jedna veta, jedno miesto — obrazovka Zliav aj
 * formulár novej zľavy ju vypisujú tú istú, aby sa nedali rozísť (K7).
 */
export const PRESET_NOTE =
  'Preset iba predplní formulár novej zľavy. Nič nezapisuje: zľava sa aj z presetu ' +
  'zapíše až po skúške naprázdno a po potvrdení, presne ako bez presetu.';

/**
 * Veta „polia sú predplnené odkiaľsi" pre formulár novej zľavy.
 *
 * Vždy hovorí OBE veci: odkiaľ hodnoty sú a že sa nimi ešte nič nezapísalo.
 * Pri zopakovaní zľavy k tomu pridáva, že produkty sa vyberajú znova
 * z aktuálneho katalógu — minulá kampaň bežala nad iným (I11).
 */
export function prefillNoteText(
  from: { readonly kind: 'preset' | 'campaign'; readonly label: string } | null,
): string | null {
  if (from === null) return null;
  const name = from.label.trim();
  if (name === '') return null;
  if (from.kind === 'preset') {
    return `Polia sú predplnené z presetu „${name}". Preset nič nezapísal — zľava sa zapíše až po skúške naprázdno a po potvrdení.`;
  }
  return `Polia sú predplnené podľa zľavy „${name}". Produkty sa vyberajú znova z aktuálneho katalógu a zapíše sa až po skúške naprázdno a po potvrdení.`;
}

/** Súhrn presetu do riadka: koľko pásiem, do koľkých % a na koľko dní. */
export function presetSummarySk(preset: PresetView): string {
  const count = preset.tiers.length;
  const word = count === 1 ? 'pásmo' : count < 5 ? 'pásma' : 'pásiem';
  const percent = presetHeadlinePercent(preset.tiers);
  const dayWord =
    preset.durationDays === 1 ? 'deň' : preset.durationDays < 5 ? 'dni' : 'dní';
  return `${count} ${word} · do ${percent} % · ${preset.durationDays} ${dayWord}`;
}

/** Predvolené percentá formulára — na porovnanie „preset nič nemení". */
export function defaultPercents(): Record<SoldBucketKey, number> {
  return { ...DEFAULT_TIER_PERCENT };
}
