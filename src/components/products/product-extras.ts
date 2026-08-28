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
 *     Obrazovka preto volá `fetchProductExtras()` raz na stránku a výsledok si
 *     drží; NIKDY to nespúšťa efekt bežiaci pri každom prekreslení.
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
import { pluralSk } from '@/lib/ui/vocabulary';

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
  const counted = extra.variants.filter((v) => v.quantity !== null);
  if (counted.length > 0) {
    return known(counted.reduce((sum, v) => sum + (v.quantity ?? 0), 0));
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

const UNEXPECTED: ApiErrorView = {
  code: 'unexpected',
  message: 'Server odpovedal inak, než sme čakali. Skúste to znova.',
};

const OFFLINE: ApiErrorView = {
  code: 'network',
  message: 'Server neodpovedá. Skúste to znova.',
};

export const isAbortedExtras = (error: ApiErrorView): boolean => error.code === 'aborted';

/**
 * Cesta k dávkovému doplneniu. Endpoint stavia dátová strana; keď sa cesta
 * zmení, mení sa TU a nikde inde.
 */
export const EXTRAS_ENDPOINT = '/api/catalog/extras';

/**
 * Doplní zobrazenú stránku tabuľky.
 *
 * POSIELA SA CELÁ STRÁNKA NARAZ a server si ju rozdelí sám — on jediný vie,
 * koľko čítaní mu z rozpočtu ostáva. Riadky, na ktoré sa nedostalo, vráti
 * v `skippedIds` a zostanú `pending`.
 *
 * MÍŇA ROZPOČET ČÍTANÍ. Volať výhradne pri zmene zobrazenej stránky, nikdy
 * v efekte bez podmienky (bod c hlavičky).
 */
export async function fetchProductExtras(
  productIds: readonly number[],
  signal?: AbortSignal,
): Promise<Result<ProductExtrasView>> {
  try {
    const res = await fetch(EXTRAS_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productIds: [...productIds] }),
      signal,
    });
    try {
      const body = (await res.json()) as Result<ProductExtrasView>;
      if (body !== null && typeof body === 'object' && 'ok' in body) return body;
    } catch {
      /* neplatné telo — spadne na `UNEXPECTED` nižšie */
    }
    return { ok: false, error: UNEXPECTED };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: { code: 'aborted', message: '' } };
    }
    return { ok: false, error: OFFLINE };
  }
}
