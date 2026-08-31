'use client';

/**
 * Aura Zľavy — KÓD, EAN A ZVYŠOK TOHO, ČO SA Z ENDPOINTOV DÁ DOSTAŤ.
 *
 * Zadanie znie: „ten názov produktu potrebujem aj EAN alebo skladový kód…
 * potrebujem zobraziť všetko, čo je možné z endpointov." Tento modul je JEDINÉ
 * miesto, kde sa hovorí, čo z toho appka má, čo nemá a PREČO to nemá — obrazovky
 * (tabuľka, bočný panel) si tú odpoveď nesmú vyrobiť samy, inak povedia každá
 * niečo iné.
 *
 * ZMERANÝ STAV, Z KTORÉHO TENTO MODUL VYCHÁDZA (19.–20. 8. 2026)
 * ──────────────────────────────────────────────────────────────
 *  · Katalóg má 41 220 produktov; 8 663 z nich má varianty, 32 557 nie.
 *  · Zrkadlo katalógu (`catalog_cache`) obsahuje `{id, name, price,
 *    has_attributes}`. **Kód ani EAN v ňom nie sú ani raz.**
 *  · V appke je uložený jediný kľúč so scope `orders_read`. Kľúč so scope
 *    `product:read` neexistuje.
 *
 * Z toho plynie rozdelenie, ktoré drží celý tento modul:
 *
 *  A. **Bez kľúča** (verejný `products/get`) sa dá dostať popis, krátky popis
 *     a pre KAŽDÝ VARIANT `reference` (kód), `ean13`, `quantity` (sklad),
 *     `price_impact` a `values`. Teda kód a sklad len pre tých 8 663 kusov,
 *     ktoré varianty majú.
 *  B. **S kľúčom `product:read`** (`products/getFull`) pribudne to isté na
 *     úrovni PRODUKTU (`ean13`, `reference`), nákupná cena, marža, marža v %,
 *     cena s DPH, `active`, dátum pridania, posledná objednávka, skladové
 *     množstvo, celkovo objednané kusy, dodávateľ, skutočná zľava v eshope
 *     a kategórie.
 *
 * TRI RÔZNE „PRÁZDNO", KTORÉ SA NESMÚ ZLIAŤ
 * ─────────────────────────────────────────
 * Toto je celá podstata úlohy. Jedna pomlčka pre všetky tri stavy by zahodila
 * presne tú informáciu, kvôli ktorej sa obrazovka stavia:
 *
 *  1. `none`    — údaj NEEXISTUJE. Produkt nemá varianty, teda nemá ani kód
 *                 variantu; alebo shop pri tomto kuse `ean13` jednoducho
 *                 nevedie. Appka sa pozrela a nič tam nie je.
 *  2. `pending` — údaj appka ZATIAĽ NEDOŤAHLA. Nepozrela sa. Doťahuje sa len
 *                 viditeľná stránka a stojí to z rozpočtu čítaní.
 *  3. `locked`  — údaj je ZAMKNUTÝ, lebo chýba kľúč so scope `product:read`.
 *                 Existuje, appka naň nedovidí.
 *
 * `AbsenceKind` je jediný slovník týchto troch stavov v celej appke. Kto si
 * napíše štvrtý stav alebo si dva z nich zlúči, zoberie používateľovi rozdiel
 * medzi „toto neexistuje" a „na toto ti chýba oprávnenie".
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 *  a. **`quantity: 0` je PLATNÁ NULA** („vypredané"), nie chýbajúci údaj.
 *     Chýbajúce `quantity` je pomlčka. `stockText()` to rozlišuje a je to
 *     jediné miesto, kde sa sklad prekladá na text.
 *  b. **`unknown_scope` sa nikdy nesmie stať „kľúč to nemá".** Shop to
 *     rozlišuje (`ShopCapabilityState`) a povrch to rozlišovať nemusí —
 *     obidve znamenajú „appka na to nedovidí", teda `locked`. ROZDIEL medzi
 *     nimi patrí do JEDNEJ sekcie v Nastaveniach, nie na každý riadok
 *     (rozhodnutie K2). Preto `capability.note` prichádza zo servera a tento
 *     modul si žiadnu vetu o oprávneniach neskladá.
 *  c. **Doťahuje sa VÝHRADNE viditeľná stránka.** Jedna stránka (50 riadkov)
 *     stojí ≈ 2 dávkové volania z rozpočtu 240 anonymných čítaní na deň. Celý
 *     katalóg (41 220 kusov) by bol 1 649 volaní, teda skoro sedem dní
 *     rozpočtu — a ten istý rozpočet potrebuje synchronizácia katalógu.
 *     Obrazovka preto doťahuje stránku RAZ (`extras-api.ts` →
 *     `POST /api/catalog/details`) a výsledok si drží; NIKDY to nespúšťa efekt
 *     bežiaci pri každom prekreslení.
 *  d. **HTML z popisu sa nikdy nevkladá do stránky.** Shop vracia popis ako
 *     HTML; `plainText()` z neho spraví text. `dangerouslySetInnerHTML` sa
 *     v tomto tabe nepoužíva ani raz.
 *  e. **Modul nič nedopočítava.** Marža, sklad ani zľava sa tu nerátajú —
 *     berú sa tak, ako prišli. Čo server nepošle, je pomlčka.
 *
 * ROZHRANIE S DÁTOVOU STRANOU
 * ───────────────────────────
 * Typy nižšie sú TVAR, KTORÝ POVRCH POTREBUJE. Endpoint stavia dátová strana
 * súbežne; keď sa mená polí rozídu, zosúlaďuje ich integrátor na jednom mieste
 * — v tomto súbore a nikde inde. Preto obrazovky nikdy nesiahajú na odpoveď
 * servera priamo, ale výhradne cez typy odtiaľto.
 *
 * Vlastník: E2 (povrch), vlna „kód a EAN" 20. 8. 2026.
 */
import type { KpiGap, SalesDayCoverage } from '@/contracts';

import { formatDateSk, formatDateTimeSk, formatEur } from '@/lib/ui/format';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ═════════════════ 1. Tri „prázdna", jeden slovník ════════════════════════ */

/**
 * Prečo hodnota chýba. Tri dôvody, nikdy jeden.
 *
 *  · `none`    — neexistuje (pozri hlavičku, bod 1),
 *  · `pending` — appka to zatiaľ nedoťahla (bod 2),
 *  · `locked`  — chýba kľúč so scope `product:read` (bod 3).
 */
export type AbsenceKind = 'none' | 'pending' | 'locked';

/** Hodnota, alebo dôvod, prečo tam nie je. Tretia možnosť neexistuje. */
export type Field<T> = { readonly known: true; readonly value: T } | {
  readonly known: false;
  readonly why: AbsenceKind;
};

export const known = <T>(value: T): Field<T> => ({ known: true, value });
export const absent = <T>(why: AbsenceKind): Field<T> => ({ known: false, why });

/**
 * Hodnota zo servera → `Field`. `null`/`undefined`/prázdny reťazec je CHÝBAJÚCA
 * hodnota a volajúci musí povedať PREČO — preto je `why` povinné.
 */
export function fieldOf<T>(value: T | null | undefined, why: AbsenceKind): Field<T> {
  if (value === null || value === undefined) return absent(why);
  if (typeof value === 'string' && value.trim().length === 0) return absent(why);
  return known(value);
}

/**
 * Slovo pre každé z troch prázdien. Stav nikdy nie je len farba ani len
 * pomlčka — SLOVO je jediný kanál, ktorý prejde cez farbosleposť aj cez
 * čítačku obrazovky, takže je povinné.
 */
export const ABSENCE_WORD: Readonly<Record<AbsenceKind, string>> = {
  none: 'nemá',
  pending: 'zatiaľ nenačítané',
  locked: 'zamknuté',
};

/**
 * Celá veta do `title` — to, čo sa do riadku nezmestí.
 *
 * Vysvetlenie ZAMKNUTÉHO je zámerne krátke a bez slova „oprávnenie": prečo je
 * zamknuté, hovorí JEDNA sekcia v Nastaveniach (rozhodnutie K2). Keby to vetu
 * vysvetľovalo tu, žila by tá istá výhrada v appke na desiatkach riadkov
 * a po prvej zmene by si navzájom protirečili.
 */
export const ABSENCE_TITLE: Readonly<Record<AbsenceKind, string>> = {
  none: 'Eshop tento údaj pri tomto kuse nevedie.',
  pending: 'Appka si tento údaj zatiaľ nevypýtala. Doťahuje sa len zobrazená stránka.',
  locked: 'Appka na tento údaj zatiaľ nedovidí. Zoznam a dôvod sú v Nastaveniach.',
};

/**
 * Značka pre každé z troch prázdien. Tvary sú z jedinej sady (`ui/Icon.tsx`)
 * a nesú presne ten význam, aký v nej majú zapísaný: prázdny krúžok = nič tam
 * nie je, neúplný kruh = ešte sa nedopracovalo, zámok = zamknuté.
 */
export const ABSENCE_ICON: Readonly<Record<AbsenceKind, 'circle' | 'loader' | 'lock'>> = {
  none: 'circle',
  pending: 'loader',
  locked: 'lock',
};

/* ═════════════════ 2. Tvar dát, ktorý povrch potrebuje ════════════════════ */

/**
 * Či appka smie čítať to, čo je za `product:read`.
 *
 * `locked` = shop povedal, že kľúč to právo nemá (meraný fakt).
 * `unknown` = kľúč sa zatiaľ neoveril. Na POVRCHU sú obidve „appka nedovidí"
 * (pozri bod b hlavičky); rozdiel medzi nimi nesie `note` a patrí do
 * Nastavení, nie na riadok tabuľky.
 */
export type ExtrasCapabilityState = 'available' | 'locked' | 'unknown';

export interface ExtrasCapabilityView {
  readonly state: ExtrasCapabilityState;
  /** Oprávnenie, ktoré to potrebuje — to isté slovo, aké patrí správcovi shopu. */
  readonly requires: string;
  /** Hotová slovenská veta zo servera. `null` = funguje to. Nikdy sa neskladá tu. */
  readonly note: string | null;
}

/** Jeden variant. Kód, EAN a sklad sú tu BEZ kľúča — a len tu. */
export interface ProductVariantView {
  readonly variantId: number;
  /** Kód variantu (`reference`). `null` = shop ho pri tomto variante nevedie. */
  readonly reference: string | null;
  readonly ean13: string | null;
  /** Sklad. `0` je PLATNÁ NULA („vypredané"); `null` je „nevieme". */
  readonly quantity: number | null;
  /** Príplatok alebo zľava variantu oproti cene produktu, ako prišla zo shopu. */
  readonly priceImpact: string | null;
  /** Hodnoty, ktorými sa variant líši, napr. `['Veľkosť: 54']`. */
  readonly values: readonly string[];
}

/**
 * Údaje z `products/getFull` — VÝHRADNE za kľúčom `product:read`.
 *
 * Celý blok je `null`, keď kľúč chýba. Nie prázdny objekt: prázdny objekt by
 * znamenal „shop nič nevie", a to je iné tvrdenie než „appka nedovidí".
 */
export interface ProductKeyedView {
  readonly reference: string | null;
  readonly ean13: string | null;
  /** Nákupná cena, ako prišla — nič sa neprepočítava. */
  readonly wholesalePrice: string | null;
  /** Marža v eurách. */
  readonly margin: string | null;
  /** Marža v percentách. */
  readonly marginPercent: number | null;
  readonly priceWithTax: string | null;
  /** Či je kus v eshope zapnutý. */
  readonly active: boolean | null;
  /** Dátum pridania do eshopu, ISO. */
  readonly addedAt: string | null;
  /** Posledná objednávka tohto kusu, ISO. */
  readonly lastOrderedAt: string | null;
  /** Skladové množstvo na úrovni produktu. `0` je platná nula. */
  readonly stockQuantity: number | null;
  /** Celkovo objednané kusy. `0` je platná nula. */
  readonly orderedTotal: number | null;
  readonly supplier: string | null;
  /** SKUTOČNÁ zľava v eshope — nie vlastný zápis appky (I11). */
  readonly shopDiscountPercent: number | null;
  readonly shopDiscountFrom: string | null;
  readonly shopDiscountTo: string | null;
  readonly categories: readonly string[];
}

/** Všetko, čo sa o jednom kuse podarilo dotiahnuť. */
export interface ProductExtraView {
  readonly productId: number;
  /** Popis zo shopu — HTML. Na povrch ide výhradne cez `plainText()`. */
  readonly description: string | null;
  readonly shortDescription: string | null;
  readonly variants: readonly ProductVariantView[];
  /** `null` = za kľúčom, teda `locked`. Nikdy prázdny objekt (pozri typ vyššie). */
  readonly keyed: ProductKeyedView | null;
  /** Meraný čas načítania TOHTO kusu, ISO. Konkrétny čas, nikdy „pred chvíľou". */
  readonly at: string;
}

/** Odpoveď dávkového doplnenia jednej stránky tabuľky. */
export interface ProductExtrasView {
  readonly items: readonly ProductExtraView[];
  /**
   * ID, na ktoré sa nedostalo — strop dávky, vyčerpaný rozpočet čítaní alebo
   * zastavenie na chybe. Tieto riadky zostávajú `pending`, NIE `none`:
   * appka sa na ne nepozrela.
   */
  readonly skippedIds: readonly number[];
  readonly capability: ExtrasCapabilityView;
  /** Koľko čítaní to stálo. Meraný fakt, nie odhad. */
  readonly readsUsed: number;
  /** Meraný čas dávky, ISO. `null` = nečítalo sa nič. */
  readonly at: string | null;
  /** KÓD chyby, nikdy hodnota kľúča (I1). `null` = nič nespadlo. */
  readonly error: string | null;
}

/* ═════════════════ 3. Zásoba pre celú stránku tabuľky ═════════════════════ */

/**
 * Čo obrazovka drží medzi prekresleniami.
 *
 * `byId` je mapa, nie pole: tabuľka sa pýta na jeden riadok a hľadanie v poli
 * by pri 200 riadkoch na stránku bežalo 200×.
 */
export interface ExtrasStore {
  readonly byId: ReadonlyMap<number, ProductExtraView>;
  readonly capability: ExtrasCapabilityView | null;
  /** Meraný čas poslednej dávky. */
  readonly at: string | null;
  /** Koľko riadkov zo zobrazenej stránky sa nedotiahlo. */
  readonly skipped: number;
  readonly failed: boolean;
}

export const EMPTY_EXTRAS: ExtrasStore = {
  byId: new Map(),
  capability: null,
  at: null,
  skipped: 0,
  failed: false,
};

/**
 * Priloží dávku k tomu, čo už appka má.
 *
 * Zlučuje sa ZÁMERNE: pri návrate na predošlú stránku by sa inak tie isté
 * riadky doťahovali znova a každý návrat by stál ďalšie čítania.
 */
export function mergeExtras(store: ExtrasStore, batch: ProductExtrasView): ExtrasStore {
  const byId = new Map(store.byId);
  for (const item of batch.items) byId.set(item.productId, item);
  return {
    byId,
    capability: batch.capability,
    at: batch.at ?? store.at,
    skipped: batch.skippedIds.length,
    failed: batch.error !== null,
  };
}

/* ═════════════════ 4. Odvodenie: hodnota, alebo ktoré z troch prázdien ════ */

/** Kód, ktorý appka o kuse pozná — najprv produktový, potom z variantov. */
export function referenceField(
  extra: ProductExtraView | undefined,
  hasAttributes: boolean,
): Field<string> {
  if (extra === undefined) return absent('pending');
  const product = extra.keyed?.reference ?? null;
  if (product !== null && product.length > 0) return known(product);
  const variant = extra.variants.map((v) => v.reference).find((r) => r !== null && r.length > 0);
  if (variant !== undefined && variant !== null) return known(variant);
  // Kus BEZ variantov nemá kód variantu — jediný kód, ktorý existuje, je
  // produktový, a ten je za kľúčom. Preto `locked`, nie `none`.
  if (!hasAttributes && extra.keyed === null) return absent('locked');
  return absent('none');
}

/** To isté pre EAN. Rovnaké pravidlo, rovnaké tri prázdna. */
export function eanField(
  extra: ProductExtraView | undefined,
  hasAttributes: boolean,
): Field<string> {
  if (extra === undefined) return absent('pending');
  const product = extra.keyed?.ean13 ?? null;
  if (product !== null && product.length > 0) return known(product);
  const variant = extra.variants.map((v) => v.ean13).find((e) => e !== null && e.length > 0);
  if (variant !== undefined && variant !== null) return known(variant);
  if (!hasAttributes && extra.keyed === null) return absent('locked');
  return absent('none');
}

/**
 * Sklad. `0` je PLATNÁ NULA — „vypredané" je tvrdenie, ktoré appka SMIE
 * urobiť, keď ho shop poslal. Chýbajúce množstvo je pomlčka (bod a hlavičky).
 */
export function stockField(
  extra: ProductExtraView | undefined,
  hasAttributes: boolean,
): Field<number> {
  if (extra === undefined) return absent('pending');
  const product = extra.keyed?.stockQuantity ?? null;
  if (product !== null) return known(product);
  /*
   * SÚČET JE CELOK, ALEBO NIČ (28. 8. 2026).
   *
   * Do tohto dňa sa tu sčítali varianty, ktoré sklad POVEDALI, a tie, ktoré ho
   * nepovedali, sa ticho zahodili — jeden variant s neznámym množstvom teda
   * vyrobil číslo NIŽŠIE než skutočnosť a vydával ho za celok. To je presne
   * chyba, ktorú I11 zakazuje: nižšie číslo vyzerá ako meranie a nikto ho
   * neodhalí.
   *
   * Čítacia vrstva to rieši rovnako a bola tu prvá: `variantStock` v
   * `lib/repo/catalog.repo.ts` vracia pri hocijakom neznámom variante
   * `missing('shop_has_none')`, nie súčet. To isté pravidlo má na povrchu
   * `variantStockTotal()` v `ProductVariants.tsx`.
   */
  if (extra.variants.length > 0 && extra.variants.every((v) => v.quantity !== null)) {
    return known(extra.variants.reduce((sum, v) => sum + (v.quantity ?? 0), 0));
  }
  if (!hasAttributes && extra.keyed === null) return absent('locked');
  return absent('none');
}

/**
 * Koľko variantov nesie vlastný kód. Slúži na jedinú vetu v tabuľke —
 * „a ďalšie 2" — aby sa nezdalo, že kus má kód práve jeden.
 */
export function codedVariants(extra: ProductExtraView | undefined): number {
  if (extra === undefined) return 0;
  return extra.variants.filter(
    (v) => (v.reference !== null && v.reference.length > 0) || (v.ean13 !== null && v.ean13.length > 0),
  ).length;
}

/* ═════════════════ 5. Riadok pod názvom v tabuľke ═════════════════════════ */

/**
 * Jeden riadok pod názvom produktu — hotový na vykreslenie.
 *
 * `kind: 'value'` znamená, že aspoň jedna z dvoch hodnôt je známa. Chýbajúca
 * DRUHÁ hodnota sa v tabuľke píše holou pomlčkou, nie tretím slovom: keď sa
 * appka na kus pozrela, je jasné, že chýba preto, že ho shop nevedie. Celý
 * príbeh (aj rozdiel medzi variantom a produktom) je v bočnom paneli — tabuľka
 * má 41 220 riadkov a tri slová navyše na každom z nich sú šum, nie priznanie.
 */
export interface CodeLineView {
  readonly kind: 'value' | AbsenceKind;
  /** Text riadku. Pri prázdne vždy obsahuje SLOVO, nikdy len pomlčku. */
  readonly text: string;
  /** Značka pre prázdno; `null` pri hodnote — hodnota značku nepotrebuje. */
  readonly icon: 'circle' | 'loader' | 'lock' | null;
  /** Celá veta do `title`. */
  readonly title: string;
}

const DASH = '—';

export function codeLine(
  row: { readonly hasAttributes: boolean },
  extra: ProductExtraView | undefined,
): CodeLineView {
  const reference = referenceField(extra, row.hasAttributes);
  const ean = eanField(extra, row.hasAttributes);

  if (!reference.known && !ean.known) {
    // Obidve chýbajú z toho istého dôvodu — vezme sa dôvod kódu, lebo obidva
    // idú tou istou cestou (variant → produkt → kľúč).
    const why = reference.why;
    return {
      kind: why,
      text: `kód a EAN ${DASH} ${ABSENCE_WORD[why]}`,
      icon: ABSENCE_ICON[why],
      title: ABSENCE_TITLE[why],
    };
  }

  const parts = [
    `kód ${reference.known ? reference.value : DASH}`,
    `EAN ${ean.known ? ean.value : DASH}`,
  ];
  const coded = codedVariants(extra);
  if (coded > 1) {
    parts.push(`${coded} ${pluralSk(coded, 'variant', 'varianty', 'variantov')}`);
  }
  return {
    kind: 'value',
    text: parts.join(' · '),
    icon: null,
    title: 'Kód a EAN zo shopu. Podrobnosti po variantoch sú v detaile kusu.',
  };
}

/* ═════════════════ 6. Text z toho, čo shop pošle ══════════════════════════ */

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * HTML popis zo shopu → obyčajný text.
 *
 * Popis je jediné pole, ktoré shop posiela ako HTML. Do stránky sa NIKDY
 * nevkladá ako HTML (bod d hlavičky) — obsah produktu je cudzí vstup a appka
 * po zrušení prihlásenia (D99, 27. 8. 2026) nemá pred sebou už žiadnu bránu.
 *
 * 27. 8. 2026: pôvodné znenie tvrdilo „appka je verejne tunelovaná". To je
 * PRIAMY opak I5 a §2 kontraktu: jediný publikovaný port je `127.0.0.1:3070`
 * (docker-compose.yml, strážené `scripts/check-compose-bind`), `ports:` na
 * app ani DB nie sú a R4 tunel výslovne zakazuje. Na tom stojí celé
 * rozhodnutie zrušiť prihlásenie — bez auth vrstvy by verejný tunel bol
 * verejná brána do produkčného eshopu.
 */
export function plainText(html: string | null | undefined): string | null {
  if (html === null || html === undefined) return null;
  const text = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[#a-z0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length === 0 ? null : text;
}

/**
 * Sklad na text. `0` je „0 (vypredané)", nie pomlčka — pozri bod a hlavičky.
 * Chýbajúce množstvo sem vôbec nepríde; to rieši `Field`.
 */
export function stockText(quantity: number): string {
  return quantity === 0 ? '0 — vypredané' : String(quantity);
}

/** Hodnoty variantu do jedného popisu: `Veľkosť: 54 · Farba: biela`. */
export function variantLabel(variant: ProductVariantView, index: number): string {
  if (variant.values.length > 0) return variant.values.join(' · ');
  return `variant ${index + 1}`;
}

/* ═════════════════ 7. Volanie na server ═══════════════════════════════════ */

export interface ApiErrorView {
  readonly code: string;
  readonly message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiErrorView };

export const isAbortedExtras = (error: ApiErrorView): boolean => error.code === 'aborted';

/*
 * TU STÁL MŔTVY KLIENT `fetchProductExtras()` NA NEEXISTUJÚCU CESTU
 * ────────────────────────────────────────────────────────────────
 * `EXTRAS_ENDPOINT = '/api/catalog/extras'` a funkcia pod ním mali NULA
 * volajúcich a route toho mena v `src/app/api/catalog/` nikdy nevznikla
 * (sú tam `details`, `enrich`, `reduction-check`, `refresh`, `search`, `sync`).
 * Živá cesta je `extras-api.ts` → `POST /api/catalog/details`. Kto sa riadil
 * hlavičkou tohto súboru, dostal 404 na každý fakt o produkte — preto je
 * odstránené aj to, aj tá veta v hlavičke (31. 8. 2026).
 */

/* ═════════════════ 8. KPI, obohatenie na dopyt a uplift (V4) ══════════════
 *
 * DRUHÁ POLOVICA TOHTO MODULU — a je zámerne oddelená od prvej.
 *
 * Sekcie 1–7 hovoria o `products/get` a o troch prázdnach, ktoré z neho plynú
 * (`AbsenceKind`). Od 28. 8. 2026 (KONTRAKT-V4 §2b) má panel druhý zdroj:
 * obohatenie `getFull` uložené v `catalog_cache` a čítané cez
 * `/api/insights/product-kpi`, `/api/insights/product/[productId]`
 * a `POST /api/catalog/enrich`.
 *
 * PREČO TO NEPOUŽÍVA `AbsenceKind`
 * ────────────────────────────────
 * `AbsenceKind` má tri stavy a všetky tri hovoria o oprávnení a o doťahovaní
 * verejnej cesty. Čítacia vrstva KPI má INÉ prázdna (`KpiGap` v `@/contracts`)
 * a rozdiel medzi nimi je presne to, čo I11 chrániť káže:
 *
 *   `not_enriched`   — `getFull` sa na produkt NIKDY nepýtalo. Kvóta je ~200
 *                      čítaní na deň a katalóg má 41 348 produktov (~207 dní),
 *                      takže je to NORMÁLNY stav väčšiny riadkov (D118).
 *   `shop_has_none`  — pýtalo sa a shop o tom poli nič nevie.
 *   `days_missing`   — okno predajov nie je celé stiahnuté, takže súčet by bol
 *                      nanajvýš dolná hranica (D119).
 *   `not_computable` — obe ingrediencie poznáme, ale pomer hodnotu nemá.
 *
 * Zliať `not_enriched` a `days_missing` do jednej pomlčky by zahodilo rozdiel
 * medzi „o produkte nevieme nič" a „o TOMTO OKNE nevieme": prvé sa spraví
 * jedným čítaním, druhé len sťahovaním predajov. A zliať ktorékoľvek z nich do
 * NULY je chyba, ktorá sa v tomto repe už raz dostala do produkcie (pozri
 * `KpiGap` v `@/contracts`).
 *
 * Preto je tu DRUHÝ slovník — `KpiGapKind` — a nie štvrtý stav v prvom.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *  a. **Nič sa nedopočítava.** Marža, percentá, uplift ani rozdiel sa tu
 *     NERÁTAJÚ; berú sa tak, ako prišli (D114: shop dáva maržu hotovú).
 *  b. **Uplift, ktorý sa spočítať nedá, nedostane číslo.** `upliftView()` má
 *     v neúspešnej vetve tvar, ktorý čísla porovnania NEOBSAHUJE — nie „číslo
 *     s výhradou". 26. 8. 2026 (commit `d00e081`) sa v tomto repe dve okná
 *     PRED zľavou vydávali za výkon zľavy; endpoint to už rieši a povrch to
 *     nesmie zakryť.
 *  c. **`ip_banned` nie je porucha appky.** Od 28. 8. 2026 shop odmieta našu
 *     adresu na všetko (KONTRAKT-V4 §2b), takže „nedotiahlo sa" je BEŽNÁ cesta
 *     a hovorí sa vetou, nie chybovým hlásením.
 *
 * Vlastník: vlna V4-DETAIL (bočný panel, D115).
 */

/* ───────── 8a. Prázdna čítacej vrstvy KPI ─────────────────────────────── */

/**
 * Prečo KPI nemá hodnotu. Štyri dôvody sú `KpiGap` zo servera, dva pribudli
 * na povrchu, lebo server ich povedať nemá odkiaľ:
 *
 *  · `not_loaded` — odpoveď zatiaľ neprišla (panel sa práve otvoril). Bez
 *    tohto stavu by nedotiahnuté KPI vyzeralo ako `not_enriched`, teda ako
 *    tvrdenie o produkte namiesto tvrdenia o nás.
 *  · `unreadable` — pole v odpovedi je v tvare, ktorý sa prečítať nedá.
 *    NIE JE to „shop to nevie": je to priznanie, že sa rozišli tvary.
 */
export type KpiGapKind = KpiGap | 'not_loaded' | 'unreadable';

/** Hodnota KPI, alebo dôvod, prečo tam nie je. Tretia možnosť neexistuje. */
export type KpiField<T> =
  | { readonly known: true; readonly value: T }
  | { readonly known: false; readonly gap: KpiGapKind };

export const kpiKnown = <T>(value: T): KpiField<T> => ({ known: true, value });
export const kpiMissing = <T>(gap: KpiGapKind): KpiField<T> => ({ known: false, gap });

/**
 * Slovo pre každé prázdno. Povinné — je to jediný kanál, ktorý prejde cez
 * farbosleposť aj cez čítačku obrazovky (pozri hlavičku `ProductFacts.tsx`).
 */
export const KPI_GAP_WORD: Readonly<Record<KpiGapKind, string>> = {
  not_enriched: 'produkt nie je obohatený',
  shop_has_none: 'eshop to nevedie',
  days_missing: 'dni chýbajú',
  not_computable: 'nedá sa spočítať',
  not_loaded: 'zatiaľ nenačítané',
  unreadable: 'nečitateľná odpoveď',
};

/** Celá veta do `title` — to, čo sa do riadku nezmestí. */
export const KPI_GAP_TITLE: Readonly<Record<KpiGapKind, string>> = {
  not_enriched:
    'Appka si tento produkt z eshopu ešte nevypýtala. Doťahuje sa prioritizovane, nie plošne — celý katalóg by pri kvóte kľúča trval mesiace.',
  shop_has_none: 'Appka sa pýtala a eshop pri tomto kuse tento údaj nevedie.',
  days_missing:
    'Časť dní okna nie je stiahnutá, takže súčet by bol nanajvýš dolná hranica. Nula by tvrdila, že sa nepredalo.',
  not_computable: 'Obe čísla poznáme, ale pomer z nich hodnotu nemá (delenie nulou).',
  not_loaded: 'Odpoveď servera zatiaľ neprišla.',
  unreadable: 'Pole v odpovedi má tvar, ktorý sa prečítať nedá. Appka si nič nedomyslela.',
};

/**
 * Značka pre každé prázdno. Tvary sú z jedinej sady (`ui/Icon.tsx`).
 *
 * Dve mená sa zámerne opakujú: `shop_has_none` aj `not_computable` znamenajú
 * „hodnota neexistuje" (prázdny krúžok) a `days_missing` aj `unreadable`
 * znamenajú „pozor, číslo by klamalo". ROZDIEL medzi nimi nesie SLOVO, nie
 * značka — značiek je v sade menej než dôvodov a vymýšľať pre povrch nový tvar
 * by rozbilo sadu, ktorá platí pre celú appku.
 *
 * `not_enriched` má štvorec („strop vyčerpaný") zámerne: dôvod, prečo produkt
 * obohatený nie je, JE strop kvóty (~200 čítaní na deň, D118).
 */
export const KPI_GAP_ICON: Readonly<
  Record<KpiGapKind, 'circle' | 'loader' | 'square' | 'alertTriangle'>
> = {
  not_enriched: 'square',
  shop_has_none: 'circle',
  days_missing: 'alertTriangle',
  not_computable: 'circle',
  not_loaded: 'loader',
  unreadable: 'alertTriangle',
};

/* ───────── 8b. Tvar, ktorý povrch potrebuje ───────────────────────────── */

/** Stav zľavy PODĽA SHOPU (`KpiDiscountState` v `@/contracts`). */
export type KpiDiscountStateKind = 'running' | 'scheduled' | 'ended' | 'none' | 'unknown';

export interface KpiDiscountView {
  readonly state: KpiDiscountStateKind;
  /** % zľavy, ktorá v posudzovaný deň NAOZAJ beží. Mimo `running` vždy prázdno. */
  readonly activePercent: KpiField<number>;
  /** % okna tak, ako ho shop nahlásil — aj pre okno mimo dneška. */
  readonly reportedPercent: KpiField<number>;
  readonly from: string | null;
  readonly to: string | null;
  /** Kedy sa stav zmeral. `null` = produkt nie je obohatený (I11). */
  readonly measuredAt: string | null;
}

/** Okno predajov a to, koľko z neho appka NEMÁ (D119). */
export interface KpiWindowView {
  readonly windowDays: number;
  readonly from: string;
  readonly to: string;
  readonly completeDays: number;
  readonly unknownDays: number;
  readonly units: KpiField<number>;
  /** `true` ⇔ hodnota je len DOLNÁ HRANICA. */
  readonly lowerBound: boolean;
}

/** KPI jedného produktu, ako ich povrch potrebuje. Dátumy sú ISO reťazce. */
export interface ProductKpiView {
  readonly productId: number;
  /** `true` = zrkadlo katalógu produkt vôbec nemá. */
  readonly missing: boolean;
  readonly name: string | null;
  readonly reference: KpiField<string>;
  readonly supplier: KpiField<string>;
  readonly purchasePrice: KpiField<number>;
  /** Marža v EUR TAK, AKO JU POSLAL SHOP. Nikdy dopočítaná. */
  readonly margin: KpiField<number>;
  readonly marginPercent: KpiField<number>;
  readonly priceWithVat: KpiField<number>;
  readonly stock: KpiField<number>;
  readonly soldTotal: KpiField<number>;
  readonly lastSaleAt: KpiField<string>;
  readonly daysSinceLastSale: KpiField<number>;
  readonly discount: KpiDiscountView;
  readonly units30: KpiWindowView;
  readonly units90: KpiWindowView;
  readonly noSale: {
    readonly mark: boolean;
    readonly proof: 'shop_never_ordered' | 'no_sale_in_covered_days' | null;
  };
  /** Kedy sa obohatenie zmeralo. `null` = produkt NIE JE obohatený. */
  readonly enrichedAt: string | null;
}

/* ───────── 8c. Fakty z obohatenia ako riadky ──────────────────────────── */

/** Jeden riadok skupiny faktov. Hodnota je UŽ NAFORMÁTOVANÁ na text. */
export interface KpiFactRow {
  readonly key: string;
  readonly label: string;
  readonly field: KpiField<string>;
}

/**
 * Percento BEZ znamienka mínus.
 *
 * `formatPercentSk()` píše `−12 %`, lebo vznikol pre ZĽAVU. Marža ani „koľko
 * percent zľavy v eshope beží" zľavou v tomto zmysle nie sú a mínus pred nimi
 * je vecná chyba, nie kozmetika.
 */
export function percentPlain(value: number): string {
  return `${value} %`;
}

/** Kusy ako počet so slovom — `0` je platná nula, nie prázdno. */
function pieces(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'kus', 'kusy', 'kusov')}`;
}

/** Prepis hodnoty na text; prázdno si nesie svoj dôvod nedotknuté. */
function mapField<T>(field: KpiField<T>, render: (value: T) => string): KpiField<string> {
  return field.known ? kpiKnown(render(field.value)) : field;
}

/**
 * Marža ako JEDEN údaj: eurá a percentá vedľa seba.
 *
 * Percento samo je bez sumy nečitateľné a suma bez percenta sa nedá porovnať
 * naprieč cenami. Nič sa nedopočítava — keď shop percento nepošle, riadok ho
 * neuvedie a NEODVODÍ ho z nákupnej a predajnej ceny (D114).
 */
export function marginText(view: ProductKpiView): KpiField<string> {
  const eur = view.margin;
  if (!eur.known) return eur;
  if (!view.marginPercent.known) return kpiKnown(formatEur(eur.value));
  return kpiKnown(`${formatEur(eur.value)} · ${percentPlain(view.marginPercent.value)}`);
}

/**
 * Aktívna zľava PODĽA SHOPU ako jeden text.
 *
 * `state: 'none'` je MERANÝ FAKT („shop k `measuredAt` povedal, že nič nebeží"),
 * takže je to hodnota, nie prázdno. `unknown` je naopak prázdno — a keď produkt
 * nie je obohatený, je to `not_enriched`, nie „bez zľavy".
 */
export function activeDiscountText(view: ProductKpiView): KpiField<string> {
  const { discount } = view;
  const range =
    discount.from === null && discount.to === null
      ? null
      : `${formatDateSk(discount.from)} – ${formatDateSk(discount.to)}`;

  if (discount.state === 'running') {
    if (!discount.activePercent.known) return discount.activePercent;
    const percent = percentPlain(discount.activePercent.value);
    return kpiKnown(range === null ? percent : `${percent} · ${range}`);
  }
  if (discount.state === 'scheduled') {
    const percent = discount.reportedPercent.known
      ? `${percentPlain(discount.reportedPercent.value)} `
      : '';
    return kpiKnown(`${percent}naplánovaná${range === null ? '' : ` · ${range}`}`.trim());
  }
  if (discount.state === 'ended') {
    return kpiKnown(`skončila${range === null ? '' : ` · ${range}`}`);
  }
  if (discount.state === 'none') return kpiKnown('bez zľavy');
  return kpiMissing(view.enrichedAt === null ? 'not_enriched' : 'shop_has_none');
}

/** Menovky a poradie faktov. Jedno miesto — riadok sa pridáva aj uberá tu. */
const FACT_LABELS: readonly { key: string; label: string }[] = [
  { key: 'reference', label: 'Referencia' },
  { key: 'supplier', label: 'Dodávateľ' },
  { key: 'stock', label: 'Sklad' },
  { key: 'soldTotal', label: 'Celkovo predané' },
  { key: 'lastSale', label: 'Posledný predaj' },
  { key: 'purchasePrice', label: 'Nákupná cena' },
  { key: 'margin', label: 'Marža' },
  { key: 'discount', label: 'Aktívna zľava v eshope' },
];

/**
 * Osem faktov z obohatenia (D114 v revízii §2b) ako ZOZNAM.
 *
 * Zoznam, nie natvrdo napísané `<dt>`/`<dd>` páry: počet v nadpise zavretej
 * skupiny sa počíta z tohto poľa, takže sa nedá rozísť s tým, čo je vnútri.
 *
 * `view === null` znamená „odpoveď zatiaľ neprišla", teda `not_loaded` na
 * VŠETKÝCH riadkoch. Riadky sa NEVYNECHÁVAJÚ: z chýbajúceho riadku sa nedá
 * zistiť, že tá informácia vôbec existuje.
 */
export function kpiFactRows(view: ProductKpiView | null | undefined): readonly KpiFactRow[] {
  const values: Readonly<Record<string, KpiField<string>>> =
    view === null || view === undefined
      ? {}
      : {
          reference: view.reference,
          supplier: view.supplier,
          stock: mapField(view.stock, stockText),
          soldTotal: mapField(view.soldTotal, pieces),
          lastSale: mapField(view.lastSaleAt, formatDateSk),
          purchasePrice: mapField(view.purchasePrice, formatEur),
          margin: marginText(view),
          discount: activeDiscountText(view),
        };

  return FACT_LABELS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    field: values[entry.key] ?? kpiMissing<string>('not_loaded'),
  }));
}

/**
 * Veta o tom, KEDY sa fakty z eshopu zmerali.
 *
 * Bez nej by panel tvrdil, že pozná stav eshopu TERAZ — a to je presne to, čo
 * I11 zakazuje. Neobohatený produkt preto nedostane čas, ale priznanie.
 */
export function measuredNote(view: ProductKpiView | null | undefined): string {
  if (view === null || view === undefined) return 'Fakty z eshopu sa načítavajú.';
  if (view.enrichedAt === null) {
    return 'Tento produkt sa z eshopu ešte nedoťahoval, takže fakty o ňom appka nemá.';
  }
  return `Fakty z eshopu zmerané ${formatDateSk(view.enrichedAt)} — nie je to stav v tejto sekunde.`;
}

/**
 * Veta o tom, KEDY sa zmerali podrobnosti spoza kľúča (`extra`).
 *
 * PREČO EXISTUJE. Panel mal dve skupiny z eshopu a čas merania niesla len
 * jedna: „Fakty z eshopu" (`measuredNote()` vyššie). Druhá — „Podrobnosti
 * z eshopu" — mlčala o tom, kedy vznikla, takže sa nedalo povedať, ktoré
 * z dvoch čísel o TOM ISTOM poli je novšie. Duplicitné polia z nej odišli
 * (rozhodnutie 31. 8. 2026, viď hlavičku `ProductDetailPanel.tsx`), ale to
 * mlčanie by zostalo aj nad piatimi zvyšnými riadkami: **skupina bez času
 * merania sa v tejto appke nekreslí.**
 *
 * PREČO MINÚTY, KEĎ `measuredNote()` DÁVA LEN DEŇ. Sú to dva rôzne merania
 * s dvoma rôznymi kadenciami. `enriched_at` je fakt dávky obohacovania (D118 —
 * priorita, ~150/deň), tam je zmysluplná jednotka DEŇ. `fetched_at` je čas
 * doťahovania detailu, ktoré sa spúšťa OTVORENÍM panela, takže dva pokusy
 * v ten istý deň by mali rovnaký dátum a veta by neinformovala o ničom.
 *
 * TRI STAVY, TRI VETY — a ani v jednom sa čas nevymyslí:
 *  · `undefined` — appka sa ešte nepýtala,
 *  · `keyed === null` — odpoveď prišla bez bloku spoza kľúča (nedovidíme),
 *  · `at === ''` — blok prišiel, ale bez času; potom sa PRIZNÁ, že sa čas
 *    nedá povedať. Doplniť ho „asi teraz" by bolo presne to tvrdenie o stave
 *    v tejto sekunde, ktoré I11 zakazuje.
 */
export function keyedMeasuredNote(extra: ProductExtraView | undefined): string {
  if (extra === undefined) return 'Podrobnosti z eshopu sa načítavajú.';
  if (extra.keyed === null) {
    return 'Podrobnosti z eshopu appka zatiaľ nedovidí, takže ani čas ich merania nemá.';
  }
  if (extra.at === '') {
    return 'Podrobnosti z eshopu prišli bez času merania, takže appka nevie povedať, ako sú staré.';
  }
  return `Podrobnosti z eshopu zmerané ${formatDateTimeSk(extra.at)} — nie je to stav v tejto sekunde.`;
}

/**
 * Veta o tom, KEDY sa zmerali varianty.
 *
 * Varianty sú tá istá odpoveď (`extra`) ako podrobnosti spoza kľúča, len ich
 * dá aj VEREJNÁ cesta `products/get` — chýbajúci kľúč ich teda nezamkne
 * a stav „nedovidíme" tu neexistuje. Preto dve funkcie a nie jedna
 * s parametrom: tretí stav `keyedMeasuredNote()` by tu bol nepravdivý.
 *
 * Dôvod, prečo veta vôbec je: skupina, ktorá kreslí meranie z eshopu a mlčí
 * o jeho čase, sa v tomto paneli nekreslí (bod 7 hlavičky
 * `ProductDetailPanel.tsx`). Kreslí ju `ProductVariants`, teda ten istý
 * komponent, ktorý kreslí zoznam — tak sa skupina nedá vykresliť bez nej.
 */
export function variantsMeasuredNote(extra: ProductExtraView | undefined): string {
  if (extra === undefined) return 'Varianty sa načítavajú.';
  if (extra.at === '') {
    return 'Varianty prišli bez času merania, takže appka nevie povedať, ako sú staré.';
  }
  return `Varianty zmerané ${formatDateTimeSk(extra.at)} — nie je to stav v tejto sekunde.`;
}

/* ───────── 8d. Obohatenie na dopyt (D118) ─────────────────────────────── */

/**
 * Ako sa skončil pokus obohatiť JEDEN produkt.
 *
 * Zrkadlo `EnrichOneOutcome` z `@/lib/engine/catalog-enrich`; komponenty
 * z `@/lib/engine/` neimportujú, tak zhodu drží typová kontrola v
 * `test/unit/panel-kpi-produktu.spec.ts`.
 */
export type EnrichOutcomeKind =
  | 'enriched'
  | 'fresh'
  | 'invalid_id'
  | 'not_in_mirror'
  | 'paused'
  | 'locked'
  | 'unknown_scope'
  | 'no_key'
  | 'budget_day'
  | 'budget_minute'
  | 'budget_unknown'
  | 'ip_banned'
  | 'rate_limited'
  | 'not_found'
  | 'reduction_unknown'
  | 'failed';

/**
 * Veta, ktorou panel povie, ako sa doťahovanie skončilo.
 *
 * `tone: 'note'` je BEŽNÁ CESTA — nie porucha. Od 28. 8. 2026 shop odmieta
 * našu adresu na všetko (`ip_banned`, KONTRAKT-V4 §2b), takže „nedotiahlo sa"
 * je dnes NORMÁLNY stav a hlásiť ho ako chybu appky by bolo zavádzajúce:
 * appka funguje, len jej eshop neodpovedá.
 *
 * `tone: 'attention'` je vtedy, keď sa s tým dá niečo urobiť (kľúč, kvóta).
 * Zamknuté sa TU NEVYSVETĽUJE — vysvetlenie má jedno miesto (Nastavenia →
 * Zamknuté funkcie) a odtiaľ vedie odkaz.
 */
export interface EnrichNoticeView {
  readonly tone: 'note' | 'attention';
  readonly text: string;
}

const ENRICH_NOTICE: Readonly<Record<EnrichOutcomeKind, EnrichNoticeView | null>> = {
  /* Dotiahlo sa — fakty hovoria samé a ďalšia veta by bola šum. */
  enriched: null,
  /* Riadok bol dosť svieži, takže sa nič nevolalo. Úspora, nie problém. */
  fresh: null,
  invalid_id: { tone: 'attention', text: 'Toto číslo produktu appka za platné nepovažuje.' },
  not_in_mirror: {
    tone: 'note',
    text: 'Tento produkt v načítanom katalógu nie je, takže obohatenie nemá čo doplniť.',
  },
  paused: {
    tone: 'note',
    text: 'Doťahovanie faktov je pozastavené po tom, čo nás eshop odmietol. Panel ukazuje to, čo je v appke.',
  },
  locked: {
    tone: 'attention',
    text: 'Fakty z eshopu sú zamknuté — kľúč na ich čítanie právo nemá.',
  },
  unknown_scope: {
    tone: 'attention',
    text: 'Appka zatiaľ nevie, či kľúč na fakty z eshopu právo má.',
  },
  no_key: { tone: 'attention', text: 'Bez kľúča sa fakty z eshopu dotiahnuť nedajú.' },
  budget_day: {
    tone: 'note',
    text: 'Dnešný rozpočet čítaní z eshopu je minutý. Panel ukazuje to, čo je v appke.',
  },
  budget_minute: { tone: 'note', text: 'Minútový strop čítaní je na hrane; o chvíľu to pôjde.' },
  budget_unknown: {
    tone: 'note',
    text: 'Rozpočet čítaní sa nedal prečítať, takže sa nič nedoťahovalo.',
  },
  ip_banned: {
    tone: 'note',
    text: 'Eshop odmieta našu adresu, takže fakty sa teraz dotiahnuť nedajú. Panel ukazuje to, čo je v appke.',
  },
  rate_limited: {
    tone: 'note',
    text: 'Eshop nás na chvíľu zastavil. Panel ukazuje to, čo je v appke.',
  },
  not_found: { tone: 'note', text: 'Eshop tento produkt nepozná, takže fakty o ňom nemá.' },
  reduction_unknown: {
    tone: 'note',
    text: 'Eshop poslal stav zľavy v tvare, ktorý sa prečítať nedá, takže sa neuložilo nič.',
  },
  failed: {
    tone: 'note',
    text: 'Doťahovanie faktov z eshopu sa nepodarilo. Panel ukazuje to, čo je v appke.',
  },
};

/** `null` = niet čo hlásiť (obohatilo sa, alebo bol riadok svieži). */
export function enrichNotice(outcome: EnrichOutcomeKind | null): EnrichNoticeView | null {
  if (outcome === null) return null;
  /*
   * `?? ENRICH_NOTICE.failed` sa tu použiť NEDÁ a bola to tu skutočná chyba:
   * `enriched` a `fresh` majú v mape ZÁMERNE `null` („niet čo hlásiť") a `??`
   * z toho spravilo vetu „doťahovanie sa nepodarilo" — teda hlásenie poruchy
   * nad úspešne dotiahnutými faktmi. Preto sa neznámy výsledok rozlišuje
   * PRÍTOMNOSŤOU kľúča, nie hodnotou.
   */
  if (!(outcome in ENRICH_NOTICE)) return ENRICH_NOTICE.failed;
  return ENRICH_NOTICE[outcome];
}

/* ───────── 8e. Denná krivka 90 dní ────────────────────────────────────── */

/** Jeden deň krivky zo servera. `units: null` = deň sa nesťahoval (NIE nula). */
export interface SeriesDayWire {
  readonly day: string;
  readonly units: number | null;
  readonly coverage: SalesDayCoverage;
}

/** Okno VLASTNEJ úspešne zapísanej zľavy (I11), nie stav v shope. */
export interface DiscountWindowWire {
  readonly campaignId: number;
  readonly campaignName: string;
  readonly percent: number;
  readonly from: string;
  readonly to: string;
}

export interface CurveDayView {
  readonly day: string;
  /** `null` = deň nie je dočítaný. NEKRESLÍ sa ako nula (bod A route). */
  readonly units: number | null;
  readonly coverage: SalesDayCoverage;
  /** Ležal ten deň vo VLASTNOM okne zľavy? */
  readonly inDiscount: boolean;
}

/** Pás pod krivkou — jedno vlastné okno zľavy, v indexoch dní. */
export interface CurveBandView {
  readonly campaignId: number;
  readonly campaignName: string;
  readonly percent: number;
  readonly fromIndex: number;
  readonly toIndex: number;
}

export interface ProductCurveView {
  readonly days: readonly CurveDayView[];
  readonly from: string;
  readonly to: string;
  /** Najvyšší DOČÍTANÝ deň. `null` = ani jeden deň dočítaný, takže niet mierky. */
  readonly maxUnits: number | null;
  readonly coveredDays: number;
  readonly unknownDays: number;
  /** Súčet za dočítané dni. `null` = ani jeden deň dočítaný (nie nula). */
  readonly units: number | null;
  readonly bands: readonly CurveBandView[];
}

/**
 * Krivka a pásy zliav z toho, čo prišlo. NIČ SA NEDOPOČÍTAVA.
 *
 * Nedočítaný deň si nechá `units: null` — pruh sa nekreslí, kreslí sa šrafovaná
 * medzera a legenda ju pomenuje slovom. Keby dostal nulu, krivka by tvrdila
 * prepad predaja, ktorý nikto nezmeral (tá istá pasca ako v `SalesChart`).
 */
export function productCurve(
  days: readonly SeriesDayWire[],
  windows: readonly DiscountWindowWire[],
): ProductCurveView {
  const points: CurveDayView[] = days.map((entry) => ({
    day: entry.day,
    units: entry.coverage === 'complete' ? entry.units : null,
    coverage: entry.coverage,
    inDiscount: windows.some((window) => window.from <= entry.day && entry.day <= window.to),
  }));

  const covered = points.filter((point) => point.units !== null);
  const bands: CurveBandView[] = [];
  for (const window of windows) {
    let fromIndex = -1;
    let toIndex = -1;
    for (let i = 0; i < points.length; i += 1) {
      const day = points[i]!.day;
      if (day < window.from || day > window.to) continue;
      if (fromIndex === -1) fromIndex = i;
      toIndex = i;
    }
    /* Okno mimo krivky sa NEPRETIAHNE na jej okraj — nakreslilo by pás tam,
       kde zľava nebola. */
    if (fromIndex === -1) continue;
    bands.push({
      campaignId: window.campaignId,
      campaignName: window.campaignName,
      percent: window.percent,
      fromIndex,
      toIndex,
    });
  }

  return {
    days: points,
    from: points[0]?.day ?? '',
    to: points[points.length - 1]?.day ?? '',
    maxUnits:
      covered.length === 0
        ? null
        : covered.reduce((max, point) => Math.max(max, point.units ?? 0), 0),
    coveredDays: covered.length,
    unknownDays: points.length - covered.length,
    units:
      covered.length === 0 ? null : covered.reduce((sum, point) => sum + (point.units ?? 0), 0),
    bands,
  };
}

/** Veta o priznanej medzere. „Nič nechýba" je tiež tvrdenie a hovorí sa nahlas. */
export function curveGapNote(curve: ProductCurveView): string {
  const total = curve.days.length;
  if (total === 0) return 'Za toto okno appka nemá ani jeden deň.';
  if (curve.unknownDays === 0) {
    return `Všetky dni okna (${formatCountSk(total)}) sú stiahnuté.`;
  }
  return `${formatCountSk(curve.unknownDays)} z ${formatCountSk(total)} dní okna appka nemá stiahnutých — v krivke chýbajú, nie sú nula.`;
}

/* ───────── 8f. Uplift „pred / počas" (D115, pasca d00e081) ────────────── */

/** Okno uplift-u zo servera. */
export interface UpliftWindowWire {
  readonly from: string;
  readonly to: string;
  readonly days: number;
  readonly units: number | null;
  readonly perDay: number | null;
}

/** Prečo sa uplift spočítať NEDÁ (`UpliftReason` v `insights/_shared.ts`). */
export type UpliftReasonKind =
  | 'no_discount_window'
  | 'not_started'
  | 'window_too_short'
  | 'baseline_overlaps_discount'
  | 'coverage_gap';

/** Zrkadlo `UpliftResult`. Zhodu drží typová kontrola v teste panela. */
export interface UpliftWire {
  readonly available: boolean;
  readonly reason: UpliftReasonKind | null;
  readonly campaignId: number | null;
  readonly campaignName: string | null;
  readonly percent: number | null;
  readonly startsOn: string | null;
  readonly spanDays: number | null;
  readonly duringTruncated: boolean;
  readonly before: UpliftWindowWire | null;
  readonly during: UpliftWindowWire | null;
  readonly deltaPercent: number | null;
  readonly deltaReason: 'zero_baseline' | null;
  readonly missingDuring: readonly string[];
  readonly missingBefore: readonly string[];
}

/**
 * Uplift na vykreslenie — a v neúspešnej vetve BEZ ČÍSEL POROVNANIA.
 *
 * Toto je celý dôvod, prečo je to funkcia a nie `if` v JSX. 26. 8. 2026
 * (commit `d00e081`) sa v tomto repe porovnávali dve okná, ktoré zľave OBE
 * predchádzali, a nazývalo sa to výkonom zľavy. Endpoint to už rieši
 * (`upliftFor()` v `app/api/insights/_shared.ts`) a povrch to má NEZAKRYŤ:
 *
 *  · keď server povie `available: false`, výsledok je tvaru `unavailable`
 *    a číslo porovnania v ňom NIE JE ani ako „hodnota s výhradou",
 *  · povrch uplift NIKDY nepočíta ani nedopočítava; číslo, ktoré server
 *    nepošle, na obrazovke nevznikne.
 */
export interface UpliftValueView {
  readonly kind: 'value';
  readonly campaign: string | null;
  readonly percent: string | null;
  readonly beforeText: string;
  readonly beforeRange: string;
  readonly duringText: string;
  readonly duringRange: string;
  /** Rozdiel kusov na deň. `null` = vyjadriť sa nedá (nulová základňa). */
  readonly deltaText: string | null;
  readonly deltaNote: string | null;
  /** `true` = zľava ešte beží, „počas" je len po dnešok. */
  readonly truncatedNote: string | null;
  /** Výhrada, ktorá k číslu PATRÍ: sú to dve čísla, nie príčina (P8). */
  readonly caveat: string;
}

export interface UpliftGapView {
  readonly kind: 'unavailable';
  /** Priznanie. Vždy slovo, nikdy číslo. */
  readonly word: string;
  readonly why: string;
  readonly campaign: string | null;
  /** Čo by sa porovnávalo, keby dáta boli. Dátumy okien, nikdy hodnoty. */
  readonly ranges: string | null;
}

export type UpliftView = UpliftValueView | UpliftGapView;

/** Priznanie, ktoré panel vypíše, keď sa uplift spočítať nedá. */
export const UPLIFT_UNAVAILABLE_WORD = 'nedá sa spočítať';

const UPLIFT_WHY: Readonly<Record<UpliftReasonKind, string>> = {
  no_discount_window:
    'Appka na tento produkt nikdy zľavu nezapísala, takže niet čo s čím porovnať.',
  not_started: 'Zľava sa ešte nezačala, takže o jej výkone sa nedá povedať nič.',
  window_too_short: 'Okno zľavy je zatiaľ kratšie než tri dni — porovnanie by bolo šum.',
  baseline_overlaps_discount:
    'Do porovnávanej základne zasahuje iná zľava toho istého produktu; zľava sa so zľavou porovnávať nesmie.',
  coverage_gap:
    'Niektoré dni porovnávaných okien nie sú stiahnuté, takže rozdiel by meral výpadok sťahovania, nie zľavu.',
};

const upliftRange = (window: UpliftWindowWire): string =>
  `${formatDateSk(window.from)} – ${formatDateSk(window.to)}`;

/** Kusy a kusy na deň, VÝHRADNE tak, ako prišli. */
const upliftUnits = (window: UpliftWindowWire): string => {
  if (window.perDay === null || window.units === null) return KPI_GAP_WORD.days_missing;
  return `${pieces(window.units)} · ${window.perDay} na deň`;
};

export function upliftView(wire: UpliftWire | null | undefined): UpliftView {
  if (wire === null || wire === undefined) {
    return {
      kind: 'unavailable',
      word: KPI_GAP_WORD.not_loaded,
      why: KPI_GAP_TITLE.not_loaded,
      campaign: null,
      ranges: null,
    };
  }

  const campaign =
    wire.campaignName === null
      ? null
      : wire.percent === null
        ? wire.campaignName
        : `${wire.campaignName} · ${percentPlain(wire.percent)}`;

  if (!wire.available || wire.before === null || wire.during === null) {
    /*
     * ŽIADNE `wire.before.units` ANI `wire.deltaPercent` V TEJTO VETVE.
     * Server ich pri `available: false` posiela `null`, ale keby ich niekedy
     * poslal, panel ich vypísať NESMIE — bolo by to číslo vydávané za výkon
     * zľavy, teda presne d00e081.
     */
    const reason = wire.reason;
    const why =
      reason === null
        ? 'Server porovnanie nespočítal a dôvod nepovedal.'
        : reason === 'not_started' && wire.startsOn !== null
          ? `${UPLIFT_WHY.not_started} Začína ${formatDateSk(wire.startsOn)}.`
          : UPLIFT_WHY[reason];
    const ranges =
      wire.before === null || wire.during === null
        ? null
        : `pred: ${upliftRange(wire.before)} · počas: ${upliftRange(wire.during)}`;
    return { kind: 'unavailable', word: UPLIFT_UNAVAILABLE_WORD, why, campaign, ranges };
  }

  return {
    kind: 'value',
    campaign,
    percent: wire.percent === null ? null : percentPlain(wire.percent),
    beforeText: upliftUnits(wire.before),
    beforeRange: upliftRange(wire.before),
    duringText: upliftUnits(wire.during),
    duringRange: upliftRange(wire.during),
    /* Rozdiel PRICHÁDZA zo servera. Tu sa nepočíta ani nezaokrúhľuje. */
    deltaText:
      wire.deltaPercent === null
        ? null
        : `${wire.deltaPercent > 0 ? '+' : ''}${wire.deltaPercent} %`,
    deltaNote:
      wire.deltaReason === 'zero_baseline'
        ? 'Pred zľavou sa nepredalo nič, takže rozdiel v percentách sa vyjadriť nedá.'
        : null,
    truncatedNote: wire.duringTruncated ? 'Zľava ešte beží — „počas" je len po dnešok.' : null,
    caveat:
      'Sú to dve čísla vedľa seba, nie príčina: appka nevie oddeliť vplyv zľavy od sezóny a skladu.',
  };
}
