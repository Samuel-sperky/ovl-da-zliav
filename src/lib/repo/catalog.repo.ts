/**
 * Aura Zľavy — repozitár tabuľky `catalog_cache` (BUILD-SPEC §3, D57;
 * KONTRAKT V3: K7, K8, K1 bod 2).
 *
 * `catalog_cache` prestala byť cache desiatich produktov a stala sa ZRKADLOM
 * katalógu (41 220 riadkov, K7). Z toho plynie všetko ostatné v tomto súbore:
 *
 *  - **Zápis po dávkach** (`upsertMany`, ~500 riadkov na príkaz). 40 tisíc
 *    jednotlivých `INSERT`-ov nie je synchronizácia, to je DoS na vlastnú DB.
 *    Dávky idú SEKVENČNE — paralelné upserty do jednej tabuľky si nič
 *    nezrýchlia a rozbijú poradie chýb.
 *  - **Stránkované čítanie** (`search`, `LIMIT/OFFSET`) a `counts()` pre čísla
 *    v bočnom paneli. Nikdy sa nevracia celý katalóg.
 *  - **K1 bod 2** — v režime `plny` nahrádza allowlist podmienka „produkt je
 *    v katalógu a nie je `not_found`". Preto je `shop_status` prvotriedny
 *    filter a `search()` ho fail-closed nastavuje na `ok` + `unknown`, keď si
 *    volajúci nepovie inak.
 *  - **I11** — v katalógu NIE JE stav zľavy zo shopu (shop ho cez API nevracia,
 *    backlog B1). „Práve v zľave" a „nikdy nezlacnené" sa počítajú výhradne
 *    z VLASTNÝCH úspešných zápisov (`campaign_items.status = 'ok'`) a tak sa
 *    to musí aj pomenovať na povrchu.
 *  - **K8 / D125** — kategória, kov a typ šperku v schéme NIE SÚ (kategórie sú
 *    len ID bez slovníka názvov). `search()` ich preto nepredstiera: vráti ich
 *    v `lockedFilters` a filter NEAPLIKUJE. Sklad, marža, celkovo objednané a
 *    posledný predaj sa naopak od migrácie 0014 filtrovať DAJÚ — sú v
 *    `ENRICHED_ONLY_FEATURES`, teda platia nad obohatenými riadkami a odpoveď
 *    to priznáva. Tichá „nula" alebo ignorovanie filtra bez slova by bolo
 *    presne to klamstvo, ktoré K8 zakazuje.
 *
 * `raw` MUSÍ prísť už redigované volajúcim (I1, D66) — repozitár ho len
 * serializuje do JSON stĺpca, nič nemaskuje. I4: žiadny prístup k `audit_log`.
 *
 * POKROK DVOJDŇOVÉHO BEHU (A2, migrácia 0013)
 * -------------------------------------------
 * 41 082 produktov po 100 je 411 čítaní, anonymný strop je 300 za UTC deň —
 * celý katalóg sa do jedného dňa nezmestí. Preto tu okrem samotných riadkov žije
 * aj POKROK behu (`catalog_sync_state`): kde sa skončilo, koľko hlási shop, kedy
 * sa naposledy čítalo a prečo sa prípadne čaká. Bez neho by sa beh po každom
 * prerušení vracal na stránku 1 a chvost katalógu by sa neprečítal nikdy.
 *
 * HĽADANIE: PREČO TU NIE JE ŽIADNY VYHĽADÁVACÍ ENGINE (19. 8. 2026)
 * -----------------------------------------------------------------
 * Hľadanie v katalógu stojí na `LIKE` nad jediným stĺpcom `c.name`. Nie preto,
 * že sa na lepšie nedostalo, ale preto, že každá „lepšia" možnosť sa zmerala
 * a prehrala. Čísla sú z tejto DB (41 220 riadkov), nie z návodu:
 *
 *  - **Slovenská diakritika už funguje, zadarmo.** Kolácia
 *    `utf8mb4_unicode_ci` skladá `á` a `a` na jednu vec: `LIKE '%naramok%'`
 *    aj `LIKE '%náramok%'` vrátia zhodne 7 379 riadkov. Vlastné odstraňovanie
 *    diakritiky by bola druhá implementácia toho, čo DB robí sama.
 *  - **Rýchlosť nie je problém.** Plná stránkovaná query so všetkými JOINmi
 *    nad 41 220 riadkami beží 85 ms. `COUNT(*)` s dvoma slovami 45 ms,
 *    so šiestimi 43 ms — slová navyše nič nestoja.
 *  - **FULLTEXT je pasca.** `innodb_ft_min_token_size` je 3, takže v BOOLEAN
 *    MODE vráti `+piercing +do +brady` aj `+4 +mm` NULA riadkov; `LIKE` vráti
 *    262, resp. 1 269. Zníženie premennej sa za behu nedá (je read-only) —
 *    znamenalo by zmenu konfigurácie DB kontajnera. A nula je v tejto appke
 *    tvrdenie, nie prázdny výsledok.
 *  - **Engine v appke (MiniSearch a spol.) by hľadal v tom istom.** Zrkadlo
 *    fyzicky nemá popis, kód produktu ani kategórie — `raw` je
 *    `{id, name, price, has_attributes}`. Index by čítal ten istý `name`,
 *    ktorý `LIKE` vidí celý, a pridal by pamäť a druhý zdroj pravdy.
 *
 * Čo sa naopak POKAZIŤ dalo a opravené je: term sa delí NA SLOVÁ a každé má
 * vlastný `LIKE` spojený cez `AND` (viď `buildWhere`). Jeden súvislý podreťazec
 * hľadal frázu v presnom poradí — „naramok zirkon" vracalo 10 zhôd, kým slová
 * cez `AND` ich nájdu 797. Kto do poľa napíše dve slová, nemyslí frázu.
 *
 * DETAILY PRODUKTU: ČO SA TU SMIE TICHO POKAZIŤ (20. 8. 2026)
 * ------------------------------------------------------------
 * Zoznamový prechod naplnil 41 220 riadkov, ale `raw` v nich je len
 * `{id, name, price, has_attributes}` — kód produktu, EAN ani sklad v zrkadle
 * nie sú. Doťahuje ich `@/lib/catalog/product-details` a ukladá do TÝCH ISTÝCH
 * riadkov (`source` = `get`/`batch`, `raw` = celá odpoveď). Čítacia strana je
 * `detailsFor()` a `catalogDetailFromRecord()`.
 *
 *  1. **Pomlčka nie je nula.** `quantity: 0` je platná nula, chýbajúci sklad je
 *     `{ value: null, gap }`. Preto `CatalogDetailValue`, nie holé `number | null`
 *     — z holého `null` sa na obrazovke `?? 0` spraví nula v jednom riadku kódu.
 *  2. **Tri dôvody chýbania, nikdy jeden.** `not_fetched` (nikto detail nepýtal)
 *     · `needs_product_read` (cesta `get` toto pole nedáva) · `shop_has_none`
 *     (shop to o produkte nevie). Zliať ich znamená poslať používateľa žiadať
 *     oprávnenie kvôli produktu, ktorý kód naozaj nemá — alebo naopak tvrdiť
 *     „nemá kód" o produkte, na ktorý sme sa nikdy nespýtali.
 *  3. **`raw` zostáva HOLÝ objekt odpovede**, nie obálka. Číta ho aj
 *     `variantStockFromRaw()` v `@/lib/ai/rules` (očakáva `raw.attributes`)
 *     a `api/ai/insights`. Zabaliť ho do `{via, product}` by tie dve miesta
 *     ticho oslepilo.
 *
 * OBOHATENIE Z `getFull` A JEHO FRONTA (28. 8. 2026, migrácia 0014)
 * -----------------------------------------------------------------
 * Sonda zmerala, že kvóta kľúča je ~200 čítaní za deň a `getFull` NIE JE
 * batchovateľný, takže obohatiť celý katalóg (41 348 produktov) by trvalo ~207
 * dní. Plošné obohacovanie preto NEEXISTUJE (D118): produkty sa obohacujú
 * PRIORITIZOVANE (povolený zoznam → kampane → zvyšok) a NA DOPYT.
 *
 * Z toho plynú tri veci v tomto súbore:
 *
 *  · `saveEnrichment()` / `enrichmentFor()` — zápis a čítanie polí z `getFull`.
 *    `margin` a `margin_percent` sa ukladajú TAK, AKO PRIŠLI; appka si ich
 *    nepočíta, inak by po zmene definície na strane shopu ticho klamala.
 *  · `nextToEnrich()` — fronta postavená na indexe, nie na výpočte. Priorita je
 *    STĹPEC (`enrich_priority`), lebo dopočítavať ju pri každom tiku dávky by
 *    znamenalo filesort nad 41 348 riadkami.
 *  · `loadEnrichState()` / `saveEnrichState()` — kde dávka stojí a PREČO. Dôvod
 *    `ip_banned` je pauza, nie zahodená chyba (D120): keď shop hlási ban, appka
 *    to povie a NEMENÍ dáta.
 *
 * `enriched_at IS NULL` je jediná pravda o neobohatenom produkte — všetky jeho
 * polia sú vtedy `NULL` ako „nevieme" a na obrazovke pomlčka, NIKDY nula (I11).
 *
 * Repozitár je zároveň JEDINÉ DVERE k zdieľanému rozpočtu čítaní
 * (`shop_read_budget` cez `@/lib/repo/read-budget.repo`), aby synchronizácia
 * nemusela poznať ani SQL, ani stropy — a aby si nikto nezaložil vlastné
 * počítadlo, ktoré by si so zvyškom appky kradlo rozpočet (A4).
 *
 * Raw parametrizované SQL, žiadne ORM. Do SQL sa NEINTERPOLUJE žiadna hodnota;
 * dynamické sú výhradne počty `?` placeholderov a whitelistované názvy stĺpcov
 * pri triedení.
 *
 * Vlastník: V4 (katalóg + pokrok behu: V7).
 */
import type {
  AllowlistShopStatus,
  CatalogCacheRecord,
  CatalogEnrichmentRecord,
  CatalogRepo,
  CatalogSource,
  DateOnly,
  MoneyString,
  Paged,
  Queryable,
  UtcDate,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import { addDays, todayInZone } from '@/lib/domain/dates';
import { anonReadBudget } from '@/lib/repo/read-budget.repo';
import { KEYED_FALLBACK_PER_UTC_DAY } from '@/lib/shop/rate-limits';
import {
  readDaysNeeded,
  type ReadBudget,
  type ReadBudgetStatus,
  type ReadReservation,
} from '@/lib/shop/read-budget';

/* ═══════════════════════════════ 1. Typy ══════════════════════════════════ */

/**
 * Stav produktu v shope. Zámerne tie isté hodnoty ako v `products_allowlist`
 * (D49, D38) — je to jedna vec, nie dve podobné.
 */
export type CatalogShopStatus = AllowlistShopStatus;

/** Riadok katalógu aj so stavom v shope (K1 bod 2). */
export interface CatalogCacheRecordV3 extends CatalogCacheRecord {
  shopStatus: CatalogShopStatus;
}

/**
 * POKRYTIE OKNA PREDAJNOSTI — koľko dní okna appka NAOZAJ má (I11, D121).
 *
 * Je to vlastnosť OKNA, nie produktu: `sales_sync_state` je kľúčované dňom,
 * takže „koľko dní je dočítaných" je jedno číslo na celú odpoveď a nie stĺpec
 * v každom riadku. Rovnaká definícia ako `salesRepo.coverageFor()` — dočítaný
 * je LEN deň so `status = 'complete'`; `pending`, `partial` aj chýbajúci riadok
 * sú „nevieme".
 */
export interface SoldWindowCoverage {
  /** Dní v okne (30/60/90/180/360). */
  readonly windowDays: number;
  /** Z toho dní so `status = 'complete'`. */
  readonly completeDays: number;
  /** Z toho dní, o ktorých appka nič nevie. `0` ⇒ okno je celé dočítané. */
  readonly unknownDays: number;
}

/**
 * Riadok výsledku vyhľadávania. `unitsSold`, `everDiscounted` a `discountedNow`
 * sú DOPOČÍTANÉ z vlastných tabuliek, nie zo shopu (I11).
 */
export interface CatalogSearchRow extends CatalogCacheRecordV3 {
  /**
   * Predané kusy za okno `soldWindowDays`, alebo `null` = **„za toto okno to
   * NEVIEME"** (D121, 31. 8. 2026). Tri stavy, jedno pravidlo — to isté, aké už
   * používajú KPI (`soldUnitsForWindow()`, dôvod tam).
   *
   * Do 31. 8. 2026 tu bolo `number` a SQL malo `COALESCE(s.units, 0)` bez brány
   * `status = 'complete'`, takže nestiahnutý deň vyšiel ako deň s nulou. Pri
   * okne 180 dní a dvoch stiahnutých prišiel KAŽDÝ produkt ako meraná nula,
   * `soldBucketOf(0)` ho zaradil do vedra `none` a obrazovka Nová zľava hlásila
   * „10 000 produktov dostane zľavu · 30 %" o predajoch, ktoré appka nezmerala.
   */
  unitsSold: number | null;
  /** `true` = appka na produkt už niekedy úspešne zapísala zľavu (I11). */
  everDiscounted: boolean;
  /** `true` = podľa VLASTNÉHO zápisu je dnes v okne zľavy (I11). */
  discountedNow: boolean;
}

/**
 * Čísla, ktoré appka o produkte vie z VLASTNÝCH tabuliek — bez ohľadu na to,
 * či ten produkt zrkadlo katalógu má (kontrakt UI, bod 26).
 *
 * Existuje to preto, že hľadanie cez `searchIndex` nájde produkt aj vtedy, keď
 * ho `catalog_cache` nemá — zrkadlo je úplné k času posledného prechodu, ale
 * eshop medzitým pridáva a maže. Taký produkt by inak prišiel na
 * obrazovku s prázdnymi číslami, hoci predajnosť (`product_sales_daily`) aj
 * vlastné zápisy zliav (`campaign_items`) sú kľúčované PRODUKTOM, nie zrkadlom
 * — a teda o ňom vieme presne to isté, čo o ktoromkoľvek riadku zrkadla.
 * Vracať tam nulu bez merania by bolo tvrdenie, nie údaj.
 */
export interface CatalogProductFacts {
  /**
   * Predané kusy za okno. `0` je MERANÝ fakt „za okno sa nepredal" — a smie ním
   * byť len vtedy, keď je okno celé dočítané. `null` = „nevieme" (D121); to isté
   * pravidlo ako `CatalogSearchRow.unitsSold`, spoločné v `soldUnitsForWindow()`.
   */
  unitsSold: number | null;
  /** `true` = appka na produkt už niekedy úspešne zapísala zľavu (I11). */
  everDiscounted: boolean;
  /** `true` = podľa VLASTNÉHO zápisu je dnes v okne zľavy (I11). */
  discountedNow: boolean;
}

export interface CatalogFactsResult {
  /**
   * Kľúč je `product_id`. Riadok dostane KAŽDÉ platné ID zo vstupu — aj to, ku
   * ktorému niet ani predaja, ani zľavy. Chýbajúci kľúč by volajúceho nútil
   * dosadiť si default sám, a práve z takého `?? 0` v `catalog/search` sa stalo,
   * že neznámy predaj prišiel na obrazovku ako nula (D121).
   */
  facts: Map<number, CatalogProductFacts>;
  soldWindowDays: number;
  soldFrom: DateOnly;
  soldTo: DateOnly;
  /** Koľko dní okna je dočítaných — bez toho je `unitsSold` nečitateľné (I11). */
  soldCoverage: SoldWindowCoverage;
}

/* ───────── Doťahnuté detaily produktu (kód, EAN, sklad, varianty) ───────── */

/**
 * Ktorou cestou riadok zrkadla prišiel.
 *
 * `list` je zoznamový prechod synchronizácie a nesie len `{id, name, price,
 * has_attributes}` — teda ŽIADNY kód, EAN ani sklad. `get` je verejný
 * `GET /api/products/get` (aj cez `/api/batch`): pridá popis a VARIANTY, kde
 * každý variant nesie `reference`, `ean13` a `quantity`. `getFull` je
 * `GET /api/products/getFull` za scope `product:read`: to isté plus tie isté
 * polia NA ÚROVNI PRODUKTU, takže kód a sklad vie povedať aj o produkte, ktorý
 * varianty nemá.
 *
 * Rozdiel `get` vs. `getFull` NIE JE kozmetika. Bez neho sa nedá odlíšiť
 * „produkt kód nemá" od „nemali sme kľúč, tak sme sa nepýtali" — a 32 557
 * z 41 220 produktov zrkadla varianty nemá, takže pri ceste `get` je o ich
 * kóde známe presne nič.
 */
export type CatalogDetailRoute = 'list' | 'get' | 'getFull';

/**
 * Prečo hodnota chýba. Tri dôvody, ktoré sa NIKDY nesmú zliať do jedného „—":
 * prvý sa rieši kliknutím (dotiahni detail), druhý oprávnením (`product:read`),
 * tretí sa nerieši vôbec — shop to o produkte proste nevedie.
 */
export type CatalogDetailGap =
  /** Riadok je stále zo zoznamového prechodu (alebo v zrkadle vôbec nie je). */
  | 'not_fetched'
  /** Detail prišiel cez `get`; toto pole dáva výhradne `getFull` (`product:read`). */
  | 'needs_product_read'
  /** Detail prišiel z tej cesty, ktorá pole nesie — a shop ho pri produkte nevedie. */
  | 'shop_has_none';

/**
 * Jedna hodnota z detailu. `gap === null` ⇔ hodnotu POZNÁME.
 *
 * `quantity: 0` je platná nula a má `gap: null`; chýbajúci sklad má
 * `value: null` a dôvod v `gap`. To sú dve rôzne vety a rozdiel medzi nimi je
 * celý zmysel tohto typu — „Sklad 0" a „sklad nevieme" sa na obrazovke nesmú
 * napísať rovnako.
 */
export interface CatalogDetailValue<T> {
  readonly value: T | null;
  readonly gap: CatalogDetailGap | null;
}

/** Jeden variant produktu tak, ako ho vrátil `get`/`getFull`. */
export interface CatalogVariantDetail {
  readonly variantId: number;
  /** Kód variantu. `null` = shop ho pri tomto variante nevedie. */
  readonly reference: string | null;
  readonly ean13: string | null;
  /** Sklad variantu. `null` = shop ho neposlal; `0` je platná nula. */
  readonly quantity: number | null;
  readonly isDefault: boolean | null;
  /** Hodnoty atribútov („Zlatá / 52") tak, ako prišli. */
  readonly values: readonly string[];
}

/** Polia, ktoré dáva VÝHRADNE `getFull` (scope `product:read`). */
export interface CatalogFullDetail {
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

/**
 * Všetko, čo appka o produkte vie nad rámec názvu a ceny — aj s priznaním,
 * čo nevie a prečo.
 */
export interface CatalogDetailRow {
  readonly productId: number;
  /** `true` = riadok v zrkadle vôbec nie je (potom je všetko `not_fetched`). */
  readonly missing: boolean;
  /** Ktorou cestou riadok prišiel. `list` = detail sa nikdy nedoťahoval. */
  readonly route: CatalogDetailRoute;
  /** Hodnota stĺpca `source` — `list` · `get` · `batch`. Diagnostika. */
  readonly source: CatalogSource | null;
  /** Kedy sa riadok naozaj čítal zo shopu (P7). `null` = riadok neexistuje. */
  readonly fetchedAt: UtcDate | null;
  readonly name: string | null;
  readonly price: MoneyString | null;
  readonly hasAttributes: boolean;
  /** Kód produktu na úrovni PRODUKTU. Len `getFull`. */
  readonly reference: CatalogDetailValue<string>;
  /** EAN na úrovni PRODUKTU. Len `getFull`. */
  readonly ean13: CatalogDetailValue<string>;
  /** Sklad na úrovni PRODUKTU. Len `getFull`. */
  readonly quantity: CatalogDetailValue<number>;
  readonly variants: readonly CatalogVariantDetail[];
  /**
   * Súčet skladu cez varianty — jediné skladové číslo dostupné BEZ
   * `product:read`. Známy je len vtedy, keď sklad povedal KAŽDÝ variant;
   * čiastočný súčet by bol nižšie číslo vydávané za celok.
   */
  readonly variantStock: CatalogDetailValue<number>;
  /** Polia za `product:read`. `null` = riadok cez `getFull` neprišiel. */
  readonly full: CatalogFullDetail | null;
}

/** Vedrá predajnosti podľa bočného panela (`design/v3/produkty.html`). */
export type SoldBucket = 'none' | 'low' | 'mid' | 'high';

/** Podľa čoho sa dá triediť. Whitelist — do SQL sa nedostane nič iné. */
export type CatalogSort =
  | 'name'
  | 'price_asc'
  | 'price_desc'
  | 'sold_asc'
  | 'sold_desc'
  | 'id';

/**
 * Filtre, ktoré appka NEVIE splniť, lebo shop API dáta nevracia (K8).
 *
 * ČO SA 1. 9. 2026 ZMENILO (D125, K4)
 * ───────────────────────────────────
 * Zoznam schudol zo šiestich na tri. `stock`, `margin` a `turnover` už majú
 * v schéme svoje pole (migrácia 0014: `qty`, `margin_percent`, `qty_in_orders`)
 * a filtrujú sa naozaj — sú v `ENRICHED_ONLY_FEATURES`, nie tu. Zostali tri,
 * ktoré NEMAJÚ zdroj vôbec:
 *
 *  · `category`   — `catalog_cache.categories` je pole ID bez slovníka názvov,
 *                   takže z neho nemá UI čo ponúknuť (výber „12345"),
 *  · `metal`      — také pole `getFull` nevracia,
 *  · `jewelryType`— to isté.
 *
 * Tento zoznam UŽ NIE JE zoznamom sivých riadkov v paneli: podľa K4 filter bez
 * dátového zdroja na obrazovke NEEXISTUJE (`CatalogFilters.tsx` ho nekreslí).
 * Ostáva ako priznanie na úrovni API — „tento parameter si poslal a ja som ho
 * NEPOUŽILA" — aby cudzí odkaz s `?category=…` nevracal ticho iné riadky.
 */
export type LockedCatalogFilter = 'category' | 'metal' | 'jewelryType';

/** Sklad ako filter (D125). `NULL` v `qty` je „nevieme" a nespadne ani sem, ani tam. */
export type CatalogStockFilter = 'in' | 'out';

/**
 * Čo appka vie LEN o OBOHATENÝCH riadkoch zrkadla (`enriched_at IS NOT NULL`).
 *
 * Je to tretí stav medzi „vieme" a `LockedCatalogFilter` („nemáme dáta vôbec"):
 * filter sa APLIKUJE a vráti pravdivé riadky, ale nad ČASŤOU katalógu. Zamlčať
 * to by znamenalo vydávať neobohatený produkt za produkt bez zľavy a produkt
 * bez referencie za neexistujúci (I11) — presne tá tichá nula, ktorú K8 zakazuje.
 * Koľko riadkov je obohatených, hovorí `CatalogCounts.enrichedRows`.
 */
export type EnrichedOnlyFeature =
  | 'referenceSearch'
  | 'ean13Search'
  | 'shopDiscounted'
  /* D125 (1. 9. 2026) — štyri filtre nad stĺpcami z `getFull`. Zdroj MAJÚ,
   * takže zamknuté nie sú; platia ale len nad obohatenými riadkami a `NULL`
   * v nich znamená „nevieme", nie nulu (I11). Preto sú tu, nie v
   * `LOCKED_FILTERS` — a preto ich panel kreslí pod jednou vetou o tom,
   * z koľkých obohatených riadkov odpoveď je. */
  | 'marginPercent'
  | 'stock'
  | 'orderedTotal'
  | 'lastSale';

export const ENRICHED_ONLY_FEATURES: readonly EnrichedOnlyFeature[] = [
  'referenceSearch',
  'ean13Search',
  'shopDiscounted',
  'marginPercent',
  'stock',
  'orderedTotal',
  'lastSale',
];

export interface CatalogSearchFilter {
  /** Text: časť názvu, alebo presné ID (keď je vstup celé číslo). */
  query?: string;
  /** Cena v EUR ako string alebo číslo. Neplatná hodnota sa IGNORUJE. */
  priceFrom?: MoneyString | number | null;
  priceTo?: MoneyString | number | null;
  /** Okno predajnosti v dňoch (30/60/90/180/360). Default 180. */
  soldWindowDays?: number;
  /** Vedrá predajnosti spojené cez OR. Prázdne = bez filtra. */
  soldBuckets?: SoldBucket[];
  /** Len produkty, na ktoré appka NIKDY úspešne nezapísala zľavu (I11). */
  neverDiscounted?: boolean;
  /** Len produkty, ktoré sú podľa VLASTNÉHO zápisu dnes v okne zľavy (I11). */
  currentlyDiscounted?: boolean;
  /**
   * Len produkty, na ktorých podľa SHOPU beží zľava v deň `today` (D116).
   *
   * Zdroj je `catalog_cache.reduction_*` z obohatenia, NIE `campaign_items` —
   * `currentlyDiscounted` hovorí o vlastných zápisoch appky a tieto dva filtre
   * sa dajú kombinovať (napr. „shop zlacnil, my nie"). Neobohatený produkt sa
   * NEVRÁTI: o ňom appka stav shopu nepozná (`ENRICHED_ONLY_FEATURES`).
   */
  shopDiscounted?: boolean;
  /**
   * Marža v PERCENTÁCH z obohatenia (`catalog_cache.margin_percent`, D117).
   *
   * Číslo je TAK, AKO HO POSLAL SHOP — appka maržu nepočíta (0014, bod 2
   * hlavičky migrácie). Neobohatený riadok má `NULL`, takže sem NESPADNE: je to
   * fail-closed „nevieme", nie „marža nula" (I11, `ENRICHED_ONLY_FEATURES`).
   * Záporná hodnota je platná — predaj pod nákupnou cenou existuje.
   */
  marginPercentFrom?: MoneyString | number | null;
  marginPercentTo?: MoneyString | number | null;
  /**
   * Sklad z obohatenia (`catalog_cache.qty`, D119). `in` = viac než nula,
   * `out` = nula a menej (shop vie viesť aj zápornú zásobu). `NULL` nespadne
   * ani do jednej možnosti — „nevieme" nie je „vypredané".
   */
  stock?: CatalogStockFilter;
  /**
   * CELKOVO objednané kusy (`catalog_cache.qty_in_orders`, D119) — za celú
   * históriu shopu, NIE za okno (R3 kontraktu V5). Okno sa z tohto stĺpca
   * odvodiť NEDÁ a meno filtra to preto nesľubuje.
   */
  orderedTotalFrom?: number;
  orderedTotalTo?: number;
  /**
   * Posledný predaj starší než N dní (`catalog_cache.last_time_in_order`, D119).
   *
   * Zámerne sem patria aj riadky, o ktorých shop NEVIE ŽIADNY predaj
   * (`last_time_in_order IS NULL` pri OBOHATENOM riadku) — to sú tie najhoršie
   * ležiaky a filter „posledný predaj starší než pol roka" by bez nich klamal.
   * Neobohatený riadok (`enriched_at IS NULL`) je naopak „nevieme" a von.
   */
  lastSaleOlderDays?: number;
  /** Stavy v shope. Default `['ok','unknown']` — `not_found` von (K1 bod 2). */
  shopStatus?: CatalogShopStatus[];
  /** Konkrétne produkty (napr. hromadný výber z UI). */
  productIds?: number[];
  /** Deň, voči ktorému sa počíta okno a „práve v zľave". Default: dnes (D31). */
  today?: DateOnly;
  sort?: CatalogSort;
  page?: number;
  perPage?: number;
}

export interface CatalogSearchResult extends Paged<CatalogSearchRow> {
  /** Okno, za ktoré je `unitsSold` — bez neho je číslo nečitateľné (P7). */
  soldWindowDays: number;
  soldFrom: DateOnly;
  soldTo: DateOnly;
  /**
   * Koľko dní okna je naozaj dočítaných (I11, D121). Hovorí, ako sa má číslo
   * `unitsSold` čítať: pri `unknownDays > 0` je to DOLNÁ HRANICA, nie počet.
   */
  soldCoverage: SoldWindowCoverage;
  /** Filtre, ktoré sa NEAPLIKOVALI, lebo na ne nie sú dáta (K8). */
  lockedFilters: LockedCatalogFilter[];
  /** Čo platí len pre obohatené riadky — aplikované, ale nad časťou katalógu (I11). */
  enrichedOnly: EnrichedOnlyFeature[];
}

/** Čísla do bočného panela (K7). Jeden dotaz, nie šesť. */
export interface CatalogCounts {
  total: number;
  /**
   * Vedrá predajnosti. `none` je „0 predaných" ako MERANÝ fakt, takže pri
   * nedočítanom okne je nula — produkty, o ktorých appka nič nevie, sú
   * v `soldUnknown` a do žiadneho vedra nepatria (D121).
   */
  sold: Record<SoldBucket, number>;
  /**
   * Koľko riadkov má za okno „nevieme" (`unitsSold === null`). Vedrá plus toto
   * číslo dá `total`; bez neho by nula vo vedre `none` vyzerala ako „takých
   * produktov niet", hoci ich je celý katalóg (I11).
   */
  soldUnknown: number;
  neverDiscounted: number;
  discountedNow: number;
  /**
   * Koľko riadkov má PODĽA SHOPU dnes bežiacu zľavu (D116) — z obohatenia, nie
   * z vlastných zápisov. Je to DOLNÁ HRANICA: neobohatené riadky sa nepočítajú,
   * a preto sa vedľa toho vracia `enrichedRows`.
   */
  shopDiscountedNow: number;
  /** Z `total` tie, ktoré sú obohatené (`enriched_at IS NOT NULL`). */
  enrichedRows: number;
  soldWindowDays: number;
  soldFrom: DateOnly;
  soldTo: DateOnly;
  lockedFilters: LockedCatalogFilter[];
  /** Viď `CatalogSearchResult.enrichedOnly`. */
  enrichedOnly: EnrichedOnlyFeature[];
}

/**
 * Rozdelenie cien v zrkadle katalógu (V1 — podklad histogramu cien).
 *
 * Je to DB-tvar, nie tvar grafu, a rozdiel je zámerný:
 *
 *  · `buckets` sú RIEDKE — pásmo, v ktorom nie je ani jeden riadok, tu
 *    CHÝBA. Dopĺňanie núl je práca čítacej strany (`foldBuckets`), lebo tá
 *    vie, koľko pásiem graf kreslí. Repozitár hovorí len to, čo dotaz naozaj
 *    našiel.
 *  · Čísla pásiem sú indexy (`0` = najlacnejšie), nie eurá. Šírku pásma
 *    pozná volajúci — on ju poslal.
 *
 * `rows` je CELÉ zrkadlo vrátane riadkov bez ceny, `withoutPrice` je z nich
 * podmnožina. Súčet `buckets` je preto `rows - withoutPrice`, nikdy `rows`;
 * kto to zamení, začne grafom tvrdiť, že produkty bez ceny sú zadarmo.
 */
export interface CatalogPriceBuckets {
  /** Riedke počty: len pásma, v ktorých dotaz našiel aspoň jeden riadok. */
  buckets: Array<{ bucket: number; count: number }>;
  /** Koľko riadkov má zrkadlo spolu — aj tie bez ceny. */
  rows: number;
  /** Z toho `price IS NULL`. Do pásiem NEVSTUPUJÚ (viď `priceBuckets`). */
  withoutPrice: number;
  minPrice: number | null;
  /** Kam siaha chvost za posledným pásmom. `null` = zrkadlo nemá ani jednu cenu. */
  maxPrice: number | null;
  /** Najstarší a najnovší čas stiahnutia riadku — ceny sú KÓPIA, nie cenník. */
  oldestFetchedAt: UtcDate | null;
  newestFetchedAt: UtcDate | null;
}

/** Vstup upsertu — `shopStatus` je voliteľný, default `ok` (viď `upsertMany`). */
export type CatalogUpsertInput = Omit<CatalogCacheRecord, 'fetchedAt'> & {
  fetchedAt?: UtcDate;
  shopStatus?: CatalogShopStatus;
};

/* ─────────────── Pokrok dvojdňového behu (`catalog_sync_state`) ─────────── */

/**
 * Prečo beh stojí. `daily_budget` a `rate_limited` NIE SÚ chyby — sú to
 * naplánované čakania, z ktorých sa appka prebudí sama.
 */
export type CatalogPauseReason = 'rate_limited' | 'daily_budget' | 'error';

/**
 * Kde beh skončil. Jeden riadok pre celý katalóg (`id = 1`).
 *
 * `lastPage` je posledná stránka, ktorá sa ÚSPEŠNE zapísala — nie posledná,
 * o ktorú sa žiadalo. Pokračuje sa od `lastPage + 1`, takže prerušenie stojí
 * najviac jednu stránku.
 */
export interface CatalogSyncProgress {
  /** Veľkosť stránky, voči ktorej má `lastPage` význam. */
  perPage: number;
  /** Posledná úspešne zapísaná stránka; `0` = prechod sa ešte nezačal. */
  lastPage: number;
  /** Koľko produktov hlási shop. `null` = zatiaľ sme sa to nedozvedeli (I11). */
  shopTotal: number | null;
  /** Koľko riadkov zapísal AKTUÁLNY prechod (nie koľko má tabuľka celkovo). */
  rowsWritten: number;
  /** `true` = prechod dočítal katalóg po koniec; ďalší začne od stránky 1. */
  completed: boolean;
  startedAt: UtcDate | null;
  /** Kedy sa naposledy naozaj čítalo zo shopu (meraný fakt, P7). */
  lastReadAt: UtcDate | null;
  finishedAt: UtcDate | null;
  /** Dokedy beh stojí (`Retry-After`, polnoc UTC). `null` = nič nebráni. */
  pausedUntil: UtcDate | null;
  pauseReason: CatalogPauseReason | null;
  /** KÓD chyby, nikdy obsah odpovede shopu (I1). */
  lastError: string | null;
  updatedAt: UtcDate | null;
}

/** Prečo sa práve teraz nečíta. `null` = nič nebráni ďalšej dávke. */
export type CatalogWaitingReason = CatalogPauseReason | 'catalog_complete';

/**
 * Stav katalógu pre UI (A5) — „koľko z koľkých, kedy naposledy, kedy ďalšia
 * dávka, prečo sa čaká, dokedy to potrvá".
 *
 * Vracajú sa FAKTY a kódy, nie hotové vety: slovenské vety o katalógu skladá
 * `@/lib/status/blockers` (`catalog_incomplete`, `catalog_reads_day_exhausted`)
 * a duplikovať ich tu by znamenalo dva texty o tej istej veci. Názvy
 * `loadedProducts` a `shopTotalProducts` sú zámerne zhodné s `CatalogSnapshot`
 * v blockers, aby ich agregátor stavu vedel odovzdať bez prekladu.
 */
export interface CatalogSyncStatus {
  /** Koľko riadkov má katalóg teraz (`COUNT(*)`). */
  loadedProducts: number;
  /** Koľko ich hlási shop. `null` = nevieme — appka si číslo nedopočítava. */
  shopTotalProducts: number | null;
  /** `0`–`100`, alebo `null`, keď nevieme, z koľkých. */
  percent: number | null;
  /** `true` = posledný prechod dočítal katalóg po koniec. */
  complete: boolean;
  /**
   * `true` = katalóg už appka MÁ celý, ale práve nad ním beží nový prechod
   * (obnova). Je to iná vec než `complete` a bez nej si dve čísla v tej istej
   * karte protirečia: `loadedProducts` je `COUNT(*)` za celý katalóg, kdežto
   * `pagesDone` patrí AKTUÁLNEMU prechodu — a ten po dokončení predchádzajúceho
   * začína od stránky 0. Karta potom vedľa seba tvrdila „0 chýba" aj „411
   * stránok ostáva, ešte 2 dni". Nechýba nič; len sa znova čítajú tie isté
   * stránky, aby boli ceny čerstvé.
   */
  refreshing: boolean;
  /** „Dáta k …" — `MAX(fetched_at)`, meraný fakt (P7). */
  lastFetchedAt: UtcDate | null;
  /** Kedy sa naposledy čítalo zo shopu (aj keď stránka nič nezmenila). */
  lastReadAt: UtcDate | null;
  /** Koľko stránok má AKTUÁLNY prechod za sebou (nie celý katalóg). */
  pagesDone: number;
  /** Koľko stránok má katalóg celkovo. `null` = nevieme koľko. */
  pagesTotal: number | null;
  /**
   * Koľko stránok katalógu appka ešte NEMÁ. `null` = nevieme koľko.
   *
   * Pri obnove je to `0` — nie počet stránok, ktoré prechod ešte prečíta.
   * Pýtame sa „čo appke chýba", nie „kde je prechod"; to druhé je `pagesDone`.
   */
  pagesLeft: number | null;
  perPage: number;
  /** Zdieľaný denný rozpočet ANONYMNÝCH čítaní (A4). */
  reads: ReadBudgetStatus;
  /** Prečo sa nečíta. `null` = nič nebráni ďalšej dávke. */
  waiting: CatalogWaitingReason | null;
  /** Kedy sa smie čítať ďalšia dávka. `null` = hneď, ako scheduler tikne. */
  nextBatchAt: UtcDate | null;
  /** Koľko ďalších UTC dní potrvá dočítanie. `0` = ešte dnes, `null` = nevieme. */
  estimatedDaysLeft: number | null;
  /** Odhad dokončenia (presnosť na deň). `null` = nevieme. */
  estimatedFinishAt: UtcDate | null;
  /** KÓD poslednej chyby behu (I1). */
  lastError: string | null;
  /** Surový pokrok — pre diagnostiku a pre runner. */
  progress: CatalogSyncProgress;
}

/* ───── Obohatenie z `getFull` a fronta obohacovania (0014, D116–D119) ───── */

/**
 * Zápis obohatenia — presne to, čo vrátil `GET /api/products/getFull`.
 *
 * ČASOVÉ PEČIATKY SA NEPREPOČÍTAVAJÚ. `lastTimeInOrder`, `reductionFrom` a
 * `reductionTo` prichádzajú v HODINÁCH SHOPU (`'2026-07-28 12:29:28'`). String
 * v tomto tvare ide do `?` parametra NEDOTKNUTÝ a MariaDB ho uloží znak za
 * znakom — v DB potom stojí presne ten čas, ktorý povedal shop. Kto sem posiela
 * `Date`, hovorí tým „tento okamih už poznám".
 *
 * Zmerané na tejto DB (28. 8. 2026), aby to nikto nemusel hádať: string
 * `'2026-07-28 12:29:28'` sa uloží ako `2026-07-28 12:29:28` a ovládač ho pri
 * čítaní vyhodnotí v zóne procesu, takže sa vráti ako ten istý okamih (shop aj
 * appka bežia v `Europe/Bratislava`). `Date` s `12:29:28Z` sa naopak uloží ako
 * `14:29:28` a prečíta späť ako `12:29:28Z` — round-trip `Date`-u je presný.
 * Čo by pečiatku POKAZILO, je prerobiť string na okamih ručne (`text + 'Z'`,
 * `Date.parse` ako UTC): tým by sa hodiny shopu posunuli o offset zóny.
 *
 * `margin` a `marginPercent` sa ukladajú TAK, AKO PRIŠLI — appka si ich
 * NEPOČÍTA (hlavička migrácie 0014, bod 2).
 */
export interface CatalogEnrichWrite {
  reference: string | null;
  ean13: string | null;
  purchasePrice: number | null;
  margin: number | null;
  marginPercent: number | null;
  sellPriceWithVat: number | null;
  /** Hodiny shopu ako string, alebo `Date` v UTC. `null` = shop nič nevie. */
  lastTimeInOrder: string | UtcDate | null;
  qty: number | null;
  qtyInOrders: number | null;
  supplier: string | null;
  reductionPercent: number | null;
  reductionFrom: string | UtcDate | null;
  reductionTo: string | UtcDate | null;
  active: boolean | null;
  categories: readonly number[] | null;
  /** Kedy sa obohatilo. Default „teraz" — je to meraný fakt, nie odhad (P7). */
  enrichedAt?: UtcDate;
}

/**
 * Prečo dávka obohacovania stojí (0014, D120).
 *
 * `ip_banned` je DÔVOD PAUZY, nie zahodená chyba: shop vracia `ip_banned` na
 * všetko vrátane verejného čítania, appka to má POVEDAŤ a nemeniť dáta.
 * Odblokovanie IP je akcia používateľa, preto pri ňom `pausedUntil` zostáva
 * `null` — „stojí, kým do toho nezasiahne človek".
 */
export type CatalogEnrichPauseReason =
  | 'rate_limited'
  | 'daily_budget'
  | 'ip_banned'
  | 'no_key'
  | 'error';

/**
 * Kde stojí dávka obohacovania (singleton `catalog_enrich_state`, 0014).
 *
 * `enrichedToday` je počet OBOHATENÝCH PRODUKTOV, nie spotrebovaných requestov
 * — tie počíta zdieľaný `shop_read_budget` (0013, dráha `product_read`).
 * Neúspešný `getFull` kvótu spotrebuje a produkt neobohatí, takže sú to dve
 * rôzne čísla a zliať sa nesmú.
 */
export interface CatalogEnrichState {
  /** UTC deň, ku ktorému platí `enrichedToday`. `null` = dávka dnes nebežala. */
  batchDay: DateOnly | null;
  enrichedToday: number;
  /** Koľko produktov má dávka za deň obohatiť (~150, D118). */
  dailyTarget: number;
  /** Posledné spracované `product_id` — DIAGNOSTIKA, nie kurzor fronty. */
  lastProductId: number | null;
  enrichedTotal: number;
  startedAt: UtcDate | null;
  /** Kedy sa naposledy naozaj čítalo zo shopu (meraný fakt, P7). */
  lastReadAt: UtcDate | null;
  /** `null` pri vyplnenom `pauseReason` = stojí, kým nezasiahne človek. */
  pausedUntil: UtcDate | null;
  pauseReason: CatalogEnrichPauseReason | null;
  /** KÓD chyby, nikdy obsah odpovede shopu (I1). */
  lastError: string | null;
  updatedAt: UtcDate | null;
}

/** Koľko riadkov prehodila jedna obnova priorít (D118). Diagnostika, nie odhad. */
export interface EnrichPriorityRefresh {
  /** Presunuté na prioritu 1 (povolený zoznam). */
  allowlist: number;
  /** Presunuté na prioritu 2 (aktívna/plánovaná kampaň). */
  campaigns: number;
  /** Vrátené na prioritu 3, lebo dôvod prednosti zanikol. */
  demoted: number;
}

/**
 * Riadok zrkadla pre KPI produktu (D114 v revízii D117–D119) — identita
 * produktu A jeho obohatenie, JEDNÝM dotazom.
 *
 * Prečo to nie je `getMany()` + `enrichmentFor()`: KPI sa čítajú pre celú
 * stránku (100 produktov) a dva dotazy nad TOU ISTOU tabuľkou a tými istými
 * riadkami sú dve čítania toho istého. Mapovanie obohatenia sa tu ale
 * NEZDVOJUJE — beží cez to isté `mapEnrichRow()` ako `enrichmentFor()`, takže
 * druhý zdroj pravdy o tom, čo znamená `NULL`, nevzniká.
 *
 * `missing: true` je to, čo `enrichmentFor()` povedať NEVIE: prázdne obohatenie
 * vracia rovnako pre produkt, ktorý zrkadlo nemá, ako pre ten, ktorý sa len
 * neobohatil. Pre KPI sú to dve rôzne vety („eshop ho pridal po poslednom
 * prechode" verzus „ešte sme sa naň nepýtali") a obrazovka ich má rozlíšiť.
 */
export interface CatalogKpiRow {
  readonly productId: number;
  /** `true` = riadok v zrkadle vôbec NIE JE; všetko ostatné je potom „nevieme". */
  readonly missing: boolean;
  readonly name: string | null;
  /** Cenníková cena zo zoznamového prechodu — NIE z `getFull`. */
  readonly price: MoneyString | null;
  /** Polia z `getFull`. Pri `missing` (a pri neobohatenom produkte) samé `null`. */
  readonly enrichment: CatalogEnrichmentRecord;
}

/* ═══════════════════════════ 2. Konštanty ═════════════════════════════════ */

/** Koľko riadkov ide do jedného `INSERT … ON DUPLICATE KEY UPDATE` (K7). */
const UPSERT_CHUNK_ROWS = 500;

/** Strop jednej stránky výsledkov — tabuľka v UI stránkuje po 50–100. */
const MAX_PER_PAGE = 200;

/** Default okno predajnosti (bočný panel má prednastavených 180 dní). */
const DEFAULT_SOLD_WINDOW_DAYS = 180;

/**
 * Povolené okná predajnosti podľa prepínača v UI.
 *
 * JEDINÝ ZDROJ toho, ktoré okná zrkadlo vie triediť v SQL. Exportuje sa preto,
 * že `api/insights/top-products` si z toho počíta, kedy poradie zvládne SQL a
 * kedy musí ísť obchádzkou cez kohortu (`MIRROR_SORTABLE_WINDOWS`) — ručná
 * kópia toho zoznamu sa pri prvej zmene ticho rozišla.
 */
export const ALLOWED_SOLD_WINDOWS: readonly number[] = [30, 60, 90, 180, 360];

/**
 * Filtre bez dát v schéme (K8, po D125 už len tri — pozri `LockedCatalogFilter`).
 * Zoznam je ZÁMERNE tu a nie v UI: keď dáta pribudnú, zmizne filter odtiaľto.
 */
const LOCKED_FILTERS: readonly LockedCatalogFilter[] = ['category', 'metal', 'jewelryType'];

const KNOWN_SHOP_STATUSES: readonly CatalogShopStatus[] = ['ok', 'not_found', 'unknown'];

/**
 * Koľko slov z hľadania sa premietne do `WHERE`. Slová nad strop sa ZAHODIA.
 *
 * Strop je poistka proti zlepenému vstupu, nie proti používateľovi: šesť slov
 * je viac, než sa do názvu šperku zmestí, ale štyridsať `LIKE`-ov v jednom
 * `WHERE` je pomalý full scan bez šance na skratku. Zmerané tu: `COUNT(*)` so
 * šiestimi slovami beží 43 ms, s dvoma 45 ms — pri tomto strope slová navyše
 * nič nestoja, a práve preto sa strop nemá kam posúvať vyššie.
 */
const MAX_SEARCH_WORDS = 6;

/** Najdlhšie slovo, ktoré má zmysel hľadať — `name` je `VARCHAR(255)`. */
const MAX_SEARCH_WORD_LENGTH = 191;

/**
 * Stĺpce, v ktorých hľadá `?query=` (D116).
 *
 * `name` má KAŽDÝ riadok zrkadla. `reference` a `ean13` pribudli migráciou 0014
 * a sú vyplnené LEN pri OBOHATENÝCH produktoch (`enriched_at IS NOT NULL`) —
 * pri ostatných sú `NULL`, na ktoré `LIKE` nikdy nesadne. Hľadanie podľa kódu
 * teda funguje, ale NIE nad celým katalógom, a to sa musí priznať na povrchu
 * (I11): `search()` aj `counts()` vracajú `enrichedOnly`.
 *
 * Prečo `OR` nad tromi stĺpcami a nie `CONCAT_WS(...) LIKE ?`: zlepený stĺpec
 * by našiel aj zhodu, ktorá vznikla až spojením dvoch polí, a v `EXPLAIN` by
 * zmizlo, v čom sa naozaj hľadá. Rýchlosť to nemení — `LIKE '%x%'` je full scan
 * tak či tak (85 ms nad 41 220 riadkami, viď hlavička).
 */
const SEARCH_LIKE_COLUMNS = ['c.name', 'c.reference', 'c.ean13'] as const;

/** `?` na KAŽDÝ stĺpec — jedno slovo sa preto pushuje `SEARCH_LIKE_COLUMNS.length`-krát. */
const SEARCH_LIKE_SQL = SEARCH_LIKE_COLUMNS.map(
  (column) => `${column} LIKE CONCAT('%', ?, '%') ESCAPE '\\\\'`,
).join(' OR ');

/**
 * Stav zľavy PODĽA SHOPU v deň, na ktorý sa pýtame (D116, migrácia 0014).
 *
 * NIE JE to `JOIN_OWN_DISCOUNTS`: ten hovorí „posledný VLASTNÝ zápis appky"
 * (I11), toto hovorí „takto to videl shop v čase `enriched_at`". Dve rôzne vety,
 * dva rôzne filtre, a zliať sa nesmú.
 *
 * Neobohatený riadok má všetky tri stĺpce `NULL`, takže sem NESPADNE — je to
 * fail-closed „nevieme", nie „nie je v zľave". Preto `shopDiscounted`
 * v `ENRICHED_ONLY_FEATURES`.
 *
 * Hranice sú CELÝ deň (`00:00:00` až `23:59:59`), lebo stĺpce sú `DATETIME`, ale
 * pýtame sa dňom (D31): zľava končiaca dnes o 12:00 dnes ešte bežala.
 * `reduction_percent > 0` zámerne — nula percent nie je zľava.
 */
const SQL_SHOP_DISCOUNT_ACTIVE =
  '(c.reduction_percent IS NOT NULL AND c.reduction_percent > 0 ' +
  'AND (c.reduction_from IS NULL OR c.reduction_from <= ?) ' +
  'AND (c.reduction_to IS NULL OR c.reduction_to >= ?))';

/** Hranice dňa pre `SQL_SHOP_DISCOUNT_ACTIVE` — v tomto poradí, ako `?`. */
function shopDiscountDayValues(day: DateOnly): [string, string] {
  return [`${day} 23:59:59`, `${day} 00:00:00`];
}

/**
 * Posledný predaj starší než hranica (D125, R3 kontraktu V5).
 *
 * Druhá polovica podmienky NIE JE ozdoba: `last_time_in_order IS NULL` pri
 * OBOHATENOM riadku znamená „shop nevie o žiadnej objednávke", teda najhorší
 * možný ležiak. Bez nej by filter „posledný predaj starší než pol roka"
 * vynechal práve tie kusy, ktoré sa nepredali NIKDY. Neobohatený riadok
 * (`enriched_at IS NULL`) je naopak „nevieme" a von (I11).
 *
 * Hranica je DEŇ (D31), nie okamih: `<= '<deň> 23:59:59'` znamená „naposledy sa
 * predal najneskôr v ten deň". Deň sa počíta v `Europe/Bratislava` cez
 * `dates.ts`, nikdy v UTC — stĺpec je `DATETIME` v lokálnych hodinách procesu
 * (pozri docblock `src/db/pool.ts`).
 */
const SQL_LAST_SALE_OLDER =
  '(c.last_time_in_order <= ? OR (c.enriched_at IS NOT NULL AND c.last_time_in_order IS NULL))';

/** Najdlhšia hranica „posledný predaj starší než" — poistka proti nezmyslu. */
const MAX_LAST_SALE_OLDER_DAYS = 3650;

/**
 * Veľkosť stránky, s ktorou sa počíta, kým pokrok neexistuje. Zhoda
 * s `CATALOG_PAGE_SIZE` v `shop/catalog-sync.ts` (tvrdý strop `per_page` shopu);
 * zrkadlí sa tu zámerne, aby repozitár nezávisel na module synchronizácie —
 * zhodu čísel stráži `test/unit/catalog-sync.spec.ts`.
 */
export const DEFAULT_CATALOG_PER_PAGE = 100;

const KNOWN_PAUSE_REASONS: readonly CatalogPauseReason[] = [
  'rate_limited',
  'daily_budget',
  'error',
];

const KNOWN_ENRICH_PAUSE_REASONS: readonly CatalogEnrichPauseReason[] = [
  'rate_limited',
  'daily_budget',
  'ip_banned',
  'no_key',
  'error',
];

/** Priorita 1 — povolený zoznam (D118). Menšie číslo ide vo fronte skôr. */
export const ENRICH_PRIORITY_ALLOWLIST = 1;
/** Priorita 2 — produkt v aktívnej alebo plánovanej kampani (D118). */
export const ENRICH_PRIORITY_CAMPAIGN = 2;
/** Priorita 3 — zvyšok katalógu. Default stĺpca `enrich_priority`. */
export const ENRICH_PRIORITY_REST = 3;

/**
 * Podiel dennej kľúčovej kvóty, ktorý smie minúť DÁVKA obohacovania na pozadí.
 * Zvyšok (25 %) zostáva na canary, sondy, overenie zliav a obohatenie NA DOPYT
 * — dávka si nesmie vzať všetko, inak by detail produktu, ktorý človek otvorí,
 * nemal z čoho dotiahnuť dáta.
 */
export const ENRICH_DAILY_SHARE = 0.75;

/**
 * Koľko produktov obohatí dávka za deň (D118). ODVODENÉ z kvóty kľúča —
 * `getFull` NIE JE batchovateľný (25 položiek = 25 hitov), takže je to priamo
 * počet produktov. Je to len default pre prázdny riadok; platná hodnota žije
 * v `catalog_enrich_state.daily_target`.
 *
 * Pri kvóte zdvihnutej 1. 9. 2026 (1000/deň → 800 použiteľných) je to **600
 * produktov denne**, teda celý katalóg (41 348) za ~69 dní namiesto ~276.
 * Nepíš sem číslo ručne: pri ďalšom zdvihnutí limitov sa prepočíta samo.
 */
export const DEFAULT_ENRICH_DAILY_TARGET = Math.floor(
  KEYED_FALLBACK_PER_UTC_DAY * ENRICH_DAILY_SHARE,
);

/** Strop jednej dávky výberu z fronty — poistka proti `LIMIT` bez rozumu. */
const MAX_ENRICH_BATCH = 500;

/** Fail-closed default (K1 bod 2): `not_found` produkt sa neponúka na zápis. */
const DEFAULT_SHOP_STATUSES: readonly CatalogShopStatus[] = ['ok', 'unknown'];

/** Whitelist triedenia — jediné miesto, kde sa do SQL dostane názov stĺpca. */
const SORT_SQL: Record<CatalogSort, string> = {
  name: 'c.name ASC, c.product_id ASC',
  price_asc: 'c.price ASC, c.product_id ASC',
  price_desc: 'c.price DESC, c.product_id ASC',
  /*
   * Radí sa `COALESCE(s.units, 0)`, nie alias `units_sold`: ten je od D121
   * NULLOVATEĽNÝ („nevieme"), a `ORDER BY` s NULL-mi by ticho zmenilo poradie
   * obrazovky. Neznámy riadok sa radí ako nula — poradie nie je tvrdenie
   * o predaji, to hovorí pomlčka v bunke.
   */
  sold_asc: 'COALESCE(s.units, 0) ASC, c.product_id ASC',
  sold_desc: 'COALESCE(s.units, 0) DESC, c.product_id ASC',
  id: 'c.product_id ASC',
};

/* ═══════════════════════════ 3. SQL fragmenty ═════════════════════════════ */

const COLUMNS = 'product_id, name, price, has_attributes, shop_status, source, fetched_at, raw';

const SQL_GET = `SELECT ${COLUMNS} FROM catalog_cache WHERE product_id = ? LIMIT 1`;
const SQL_GET_MANY_PREFIX = `SELECT ${COLUMNS} FROM catalog_cache WHERE product_id IN `;

const SQL_UPSERT_PREFIX =
  'INSERT INTO catalog_cache ' +
  '(product_id, name, price, has_attributes, shop_status, source, fetched_at, raw) VALUES ';
/*
 * ZOZNAMOVÝ PRECHOD NESMIE ZAHODIŤ DOŤAHNUTÝ DETAIL (24. 8. 2026)
 * ---------------------------------------------------------------
 * Predtým tu stálo `source = VALUES(source), raw = VALUES(raw)` BEZ podmienky.
 * Riadok obohatený cez `product-details` (`source` = `get`/`batch`, `raw` =
 * celá odpoveď shopu) tak pri najbližšom prechode synchronizácie spadol späť na
 * `source = 'list'` a `raw = {id, name, price, has_attributes}` — detail sa
 * stratil a `fillProductDetails()` ho vyhodnotil ako nedoplnený a zaplatil zaň
 * znova. Zmerané v prevádzkovej DB: `list: 41 220, get: 0, batch: 0` po ôsmich
 * dňoch, počas ktorých bol `shop_read_budget` každý deň na `240/240` a beh
 * skončil na `ip_banned`. Doplniť katalóg raz stojí ≈ 42 869 čítaní ≈ 179 dní
 * rozpočtu; bez tejto podmienky sa tá čiastka platí na KAŽDOM prechode.
 *
 * ČO ZNAMENÁ „BOHATŠÍ": VÝHRADNE `source`, NIE dĺžka `raw` ani `fetched_at`
 * ------------------------------------------------------------------------
 * Rozhoduje `source`, lebo presne z neho (a z prítomnosti poľa `reduction`)
 * číta `catalogDetailRoute()`, ktorá určuje, na ktoré otázky riadok vôbec vie
 * odpovedať: `list` < `get`/`batch`. Je to vlastnosť CESTY, ktorou riadok
 * prišiel, a tá sa nemení podľa toho, aký produkt to je.
 *
 *  - **Nie dĺžka `raw`.** Dĺžka meria produkt, nie cestu. `get` na produkte bez
 *    variantov a bez popisu je kratší než zoznamová položka s dlhým názvom —
 *    a porovnávanie dĺžok by ho zahodilo. Navyše by to bol odhad tam, kde je
 *    k dispozícii meraný fakt.
 *  - **Nie `fetched_at`.** Ten meria čerstvosť, nie obsah — a v tomto poli je
 *    novší riadok práve ten CHUDOBNEJŠÍ (zoznamový prechod beží denne, detail
 *    raz). „Novší vyhráva" je presne pravidlo, ktoré tú chybu spôsobilo.
 *
 * KEĎ SA PRODUKT V SHOPE NAOZAJ ZMENÍ
 * -----------------------------------
 * Zastaraný detail je tiež nepravda, takže ochrana NIE JE bezpodmienečná.
 * Zoznam nesie `{id, name, price, has_attributes}` — a to je zadarmo dostupný
 * dôkaz o zmene: keď sa ktorékoľvek z troch polí líši od uloženého riadku,
 * produkt sa v shope zmenil, uložený detail je preukázateľne neaktuálny a
 * ochrana sa VYPNE. Riadok spadne na `list`, `fillProductDetails()` ho uvidí
 * ako nedoplnený a doťahne ho znova — raz, za jedno čítanie, a až vtedy, keď
 * na to naozaj bol dôvod. Žiadny ďalší mechanizmus (TTL, príznak, fronta) na
 * to netreba a žiadne čítanie navyše to nestojí.
 *
 * Porovnáva sa kolláciou stĺpca (`name` je `utf8mb4_unicode_ci`), teda zmena
 * veľkosti písmen či diakritiky v názve detail NEZHODÍ. Je to vedomé: názov
 * nie je detailové pole (má vlastný stĺpec a obnovuje sa vždy), kým hromadná
 * normalizácia názvov v shope by pri binárnom porovnaní zhodila celý katalóg
 * naraz — 42 869 čítaní za preklep. `price` a `has_attributes` sú tie silné
 * signály: s cenou sa hýbe `sell_price`, `margin` aj `reduction`, s
 * `has_attributes` celé pole `attributes` a z neho skladové číslo.
 *
 * ČO TÁTO OPRAVA NERIEŠI (a vedome nechávam otvorené)
 * ---------------------------------------------------
 * Detail môže zostarnúť aj bez toho, aby sa zmenil názov, cena či
 * `has_attributes` — typicky sklad variantu alebo EAN. Riadok si pritom drží
 * `fetched_at` posledného ZOZNAMOVÉHO čítania, lebo ten stĺpec je podklad pre
 * `MAX(fetched_at)` v `lastFetchedAt()` (rozhoduje o novom prechode),
 * pre `dataAsOf` v `engine/preview` a pre pásma cien — a všetky tri sa pýtajú
 * na cenu, ktorú prechod naozaj obnovil. Zmraziť ho spolu s `raw` by z appky
 * spravilo klamára v opačnom smere a runner by prechádzal katalóg donekonečna.
 * Vek SAMOTNÉHO detailu sa v tejto schéme nedá vyjadriť; chce to stĺpec
 * `detail_fetched_at`, čo je migrácia nad 41 220 riadkami — a tá sa nerobí
 * mimochodom. Je to navrhnuté, nie spravené.
 *
 * ZÁLEŽÍ NA PORADÍ PRIRADENÍ — NEPREHADZOVAŤ
 * ------------------------------------------
 * MariaDB vykonáva priradenia v `ON DUPLICATE KEY UPDATE` ZĽAVA DOPRAVA a
 * neskoršie výrazy už vidia PREPÍSANÉ hodnoty. Keby `name`/`price`/
 * `has_attributes` stáli pred `source`/`raw`, podmienka by porovnávala novú
 * hodnotu samu so sebou, vyšla by vždy „nezmenené" a detail by prežil aj
 * skutočnú zmenu ceny. Zmerané na MariaDB 11.4: pri opačnom poradí zmena ceny
 * 10,00 → 20,00 detail NEzhodila. Preto `source` a `raw` idú PRVÉ.
 * Stráži to `test/integration/katalog-nedegraduje.spec.ts` skutočným behom.
 */
const SQL_KEEP_DETAIL =
  "VALUES(source) = 'list' AND source IN ('get', 'batch') " +
  'AND name <=> VALUES(name) AND price <=> VALUES(price) ' +
  'AND has_attributes <=> VALUES(has_attributes)';
const SQL_UPSERT_SUFFIX =
  ' ON DUPLICATE KEY UPDATE ' +
  // Detailové stĺpce PRVÉ — podmienka musí vidieť ešte STARÝ názov a cenu.
  `source = IF(${SQL_KEEP_DETAIL}, source, VALUES(source)), ` +
  `raw = IF(${SQL_KEEP_DETAIL}, raw, VALUES(raw)), ` +
  // Až potom to, čo zoznam nesie vždy a čo teda smie prepísať bez podmienky.
  'name = VALUES(name), price = VALUES(price), ' +
  'has_attributes = VALUES(has_attributes), shop_status = VALUES(shop_status), ' +
  'fetched_at = VALUES(fetched_at)';

/** D49: produkt, ktorý shop nenašiel. Ostatné stĺpce sa NEPREPISUJÚ. */
const SQL_MARK_SHOP_STATUS = 'UPDATE catalog_cache SET shop_status = ? WHERE product_id = ?';

const SQL_TOTAL_ROWS = 'SELECT COUNT(*) AS total FROM catalog_cache';
const SQL_LAST_FETCHED = 'SELECT MAX(fetched_at) AS last_fetched FROM catalog_cache';

/*
 * Rozdelenie cien (V1). Zaraďovanie do pásiem robí DATABÁZA, nie prehliadač:
 * 41 220 cien cez sieť pri každom otvorení rozkliku je záťaž, ktorú si nikto
 * nevyžiadal, a von takto ide dvadsaťjeden čísel.
 *
 * `LEAST(…, ?)` posadí všetko nad hranicou do ZBERNÉHO pásma — ceny idú po
 * 1 758 €, ale drvivá väčšina katalógu leží pod 200 €, takže bez zberného
 * pásma je histogram jeden stĺpec vľavo a 170 prázdnych vpravo.
 *
 * `GREATEST(…, 0)` je poistka na poškodený riadok: `price` je DECIMAL BEZ
 * `UNSIGNED`, takže záporná cena je v schéme možná. Bez nej by taký riadok
 * vypadol z pásiem, ale zostal v `rows` — a súčet stĺpcov by prestal sedieť
 * s číslom pod grafom bez toho, aby to bolo na čomkoľvek vidieť. Radšej ho
 * vidieť v najlacnejšom pásme než ho stratiť.
 */
const SQL_PRICE_BUCKETS =
  'SELECT GREATEST(LEAST(FLOOR(price / ?), ?), 0) AS bucket, COUNT(*) AS n ' +
  'FROM catalog_cache WHERE price IS NOT NULL GROUP BY bucket ORDER BY bucket ASC';

/*
 * Čísla, ktoré graf MUSÍ priznať: koľko riadkov zrkadlo pozná, koľko z nich je
 * bez ceny, kam siaha chvost a odkedy dokedy sú ceny stiahnuté. Jeden dotaz,
 * nie päť — a nad tou istou tabuľkou ako pásma, takže si čísla neodskočia.
 */
const SQL_PRICE_TOTALS =
  'SELECT COUNT(*) AS rows_total, ' +
  'SUM(CASE WHEN price IS NULL THEN 1 ELSE 0 END) AS rows_without_price, ' +
  'MIN(price) AS min_price, MAX(price) AS max_price, ' +
  'MIN(fetched_at) AS oldest, MAX(fetched_at) AS newest ' +
  'FROM catalog_cache';

/* Pokrok dvojdňového behu (`catalog_sync_state`, migrácia 0013). */

const PROGRESS_COLUMNS =
  'per_page, last_page, shop_total, rows_written, completed, started_at, ' +
  'last_read_at, finished_at, paused_until, pause_reason, last_error, updated_at';

const SQL_PROGRESS_GET = `SELECT ${PROGRESS_COLUMNS} FROM catalog_sync_state WHERE id = 1 LIMIT 1`;

/**
 * Zápis pokroku. `INSERT … ON DUPLICATE KEY UPDATE`, a nie `UPDATE`, zámerne:
 * riadok síce zakladá migrácia, ale beh, ktorý by kvôli chýbajúcemu riadku
 * potichu nezapisoval pokrok, by sa vrátil presne k pôvodnej chybe — reštart od
 * stránky 1 po každom prerušení.
 */
const SQL_PROGRESS_SAVE =
  'INSERT INTO catalog_sync_state ' +
  '(id, per_page, last_page, shop_total, rows_written, completed, started_at, ' +
  'last_read_at, finished_at, paused_until, pause_reason, last_error) ' +
  'VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
  'ON DUPLICATE KEY UPDATE per_page = VALUES(per_page), last_page = VALUES(last_page), ' +
  'shop_total = VALUES(shop_total), rows_written = VALUES(rows_written), ' +
  'completed = VALUES(completed), started_at = VALUES(started_at), ' +
  'last_read_at = VALUES(last_read_at), finished_at = VALUES(finished_at), ' +
  'paused_until = VALUES(paused_until), pause_reason = VALUES(pause_reason), ' +
  'last_error = VALUES(last_error)';

/**
 * Predané kusy za okno. Odvodená tabuľka (nie korelovaný poddotaz v SELECT-e):
 * poddotaz na riadok by sa pri 40 tisícoch riadkov vyhodnocoval 40-tisíckrát.
 *
 * BRÁNA `status = 'complete'` (D121, 31. 8. 2026). Kusy sa sčítavajú VÝHRADNE
 * z dní, ktoré sú naozaj stiahnuté. `product_sales_daily` má riadok len pre
 * (produkt, deň) s predajom, takže bez tejto brány je nestiahnutý deň na
 * nerozoznanie od dňa bez predaja — a súčet za okno potom tvrdí nulu o dňoch,
 * ktoré appka nikdy nečítala (0014 §4, hlavička `product_sales_daily` v 0009).
 *
 * `JOIN` (nie `LEFT JOIN`) na `sales_sync_state` je zámer: deň bez riadku je
 * „nevieme", a ten sa do súčtu dostať NESMIE. Je to spojenie na PRIMARY KEY
 * (`sale_day`), takže plán zostáva `ref` — dôkaz `EXPLAIN`-om je v
 * `test/integration/predaje-brana-pokrytia.spec.ts`.
 */
const JOIN_SALES =
  'LEFT JOIN (SELECT p.product_id, SUM(p.units_sold) AS units FROM product_sales_daily p ' +
  "JOIN sales_sync_state ss ON ss.sale_day = p.sale_day AND ss.status = 'complete' " +
  'WHERE p.sale_day >= ? AND p.sale_day <= ? GROUP BY p.product_id) s ' +
  'ON s.product_id = c.product_id ';

/**
 * Koľko dní okna je dočítaných. Jeden riadok, `PRIMARY KEY` range nad tabuľkou
 * s jedným riadkom na deň — lacnejšie než niesť pokrytie v každom riadku.
 */
const SQL_COMPLETE_DAYS =
  "SELECT COUNT(*) AS complete_days FROM sales_sync_state WHERE status = 'complete' " +
  'AND sale_day >= ? AND sale_day <= ?';

/**
 * VLASTNÉ úspešné zápisy zliav (I11). `now_on` je „dnes v okne" — okno berieme
 * z kampane, lebo shop skutočný stav zľavy nevracia (backlog B1).
 */
const JOIN_OWN_DISCOUNTS =
  'LEFT JOIN (SELECT i.product_id, ' +
  'MAX(CASE WHEN cm.date_from <= ? AND cm.date_to >= ? THEN 1 ELSE 0 END) AS now_on ' +
  'FROM campaign_items i JOIN campaigns cm ON cm.id = i.campaign_id ' +
  "WHERE i.status = 'ok' GROUP BY i.product_id) d ON d.product_id = c.product_id ";

/*
 * Tie isté dva výpočty pre ĽUBOVOĽNÉ ID — bez `catalog_cache` v `FROM`
 * (`factsFor()`). Sú to zámerne DVA dotazy a nie jeden JOIN: obe tabuľky sa
 * kľúčujú produktom, ale ani jedna nemusí mať riadok, takže by driving table
 * musela byť `catalog_cache` — a práve o produkty, ktoré v nej NIE SÚ, tu ide.
 */

/* Tá istá brána pokrytia ako v `JOIN_SALES` — dôvod tam (D121). */
const SQL_FACTS_SALES_PREFIX =
  'SELECT p.product_id, SUM(p.units_sold) AS units FROM product_sales_daily p ' +
  "JOIN sales_sync_state ss ON ss.sale_day = p.sale_day AND ss.status = 'complete' " +
  'WHERE p.sale_day >= ? AND p.sale_day <= ? AND p.product_id IN ';
const SQL_FACTS_SALES_SUFFIX = ' GROUP BY p.product_id';

const SQL_FACTS_DISCOUNTS_PREFIX =
  'SELECT i.product_id, ' +
  'MAX(CASE WHEN cm.date_from <= ? AND cm.date_to >= ? THEN 1 ELSE 0 END) AS now_on ' +
  'FROM campaign_items i JOIN campaigns cm ON cm.id = i.campaign_id ' +
  "WHERE i.status = 'ok' AND i.product_id IN ";
const SQL_FACTS_DISCOUNTS_SUFFIX = ' GROUP BY i.product_id';

/* ── Obohatenie z `getFull` a fronta obohacovania (0014, D116–D119) ──────── */

const ENRICH_COLUMNS =
  'product_id, reference, ean13, purchase_price, margin, margin_percent, ' +
  'sell_price_with_vat, last_time_in_order, qty, qty_in_orders, supplier, ' +
  'reduction_percent, reduction_from, reduction_to, active, categories, ' +
  'enriched_at, enrich_attempted_at, enrich_priority';

const SQL_ENRICH_GET_MANY_PREFIX = `SELECT ${ENRICH_COLUMNS} FROM catalog_cache WHERE product_id IN `;

/**
 * KPI strany: identita produktu + obohatenie jedným dotazom (`kpiRowsFor`).
 * Stĺpce obohatenia sa berú z `ENRICH_COLUMNS`, nie z vlastného zoznamu —
 * pribudnutý stĺpec sa tým dostane na obe cesty naraz.
 */
const SQL_KPI_ROWS_PREFIX =
  `SELECT name, price, ${ENRICH_COLUMNS} FROM catalog_cache WHERE product_id IN `;

/**
 * Zápis obohatenia. `UPDATE`, nie `INSERT … ON DUPLICATE KEY UPDATE`, zámerne:
 * obohatiť sa dá len produkt, ktorý zrkadlo UŽ MÁ. Zakladať riadok tu by
 * znamenalo produkt bez názvu, ceny a `source`, ktorý by zoznamový prechod
 * musel doplniť — a dovtedy by v katalógu strašil poloprázdny záznam.
 * `affectedRows = 0` je preto platná odpoveď „taký produkt v zrkadle nie je".
 */
const SQL_ENRICH_SAVE =
  'UPDATE catalog_cache SET reference = ?, ean13 = ?, purchase_price = ?, ' +
  'margin = ?, margin_percent = ?, sell_price_with_vat = ?, last_time_in_order = ?, ' +
  'qty = ?, qty_in_orders = ?, supplier = ?, reduction_percent = ?, ' +
  'reduction_from = ?, reduction_to = ?, active = ?, categories = ?, ' +
  'enriched_at = ?, enrich_attempted_at = ? WHERE product_id = ?';

/** D118: neúspešný pokus. `enriched_at` sa NEDOTKNE — obohatené nie je. */
const SQL_ENRICH_ATTEMPT =
  'UPDATE catalog_cache SET enrich_attempted_at = ? WHERE product_id = ?';

/**
 * Ktorý produkt obohatiť ako ďalší (D118).
 *
 * `ORDER BY` je ZÁMERNE presne v poradí stĺpcov indexu `ix_catalog_enrich_queue
 * (enriched_at, enrich_priority, enrich_attempted_at, product_id)`, takže výber
 * dávky je range scan bez filesortu nad 41 348 riadkami. `enriched_at IS NULL`
 * je pre index rovnocenné s rovnosťou, preto je v indexe PRVÉ.
 *
 * `enrich_attempted_at ASC` dáva NIKDY NESKÚŠANÉ dopredu, lebo MariaDB radí
 * `NULL` v `ASC` ako prvé — a to je presne to poradie, ktoré index drží.
 * Vďaka tomu produkt, na ktorom `getFull` padá, spadne na konec svojej priority
 * namiesto toho, aby zjedol celú dennú kvótu.
 *
 * `shop_status <> 'not_found'` je fail-closed: kvóta sa nemá platiť za produkt,
 * o ktorom shop povedal, že neexistuje (D49).
 */
const SQL_ENRICH_NEXT =
  'SELECT product_id FROM catalog_cache ' +
  "WHERE enriched_at IS NULL AND shop_status <> 'not_found' " +
  'ORDER BY enrich_priority ASC, enrich_attempted_at ASC, product_id ASC LIMIT ?';

/**
 * Stavy kampane, ktoré znamenajú „aktívna alebo plánovaná" (D118, O1).
 *
 * `draft` tu NIE JE: rozpracovaná kampaň ešte nemá potvrdené okno a jej položky
 * sa menia pod rukami. `done` a `partial` naopak ÁNO — zapísaná kampaň, ktorej
 * okno ešte beží, je práve ten prípad, o ktorom obrazovka potrebuje čísla.
 * Ukončené a zrušené stavy (`failed`, `missed`, `cancelled`, `lapsed`) prednosť
 * nedávajú.
 */
const ENRICH_CAMPAIGN_STATUSES: readonly string[] = [
  'scheduled',
  'needs_key',
  'running',
  'done',
  'partial',
];

const ENRICH_CAMPAIGN_PLACEHOLDERS = ENRICH_CAMPAIGN_STATUSES.map(() => '?').join(', ');

/** Priorita 1 — povolený zoznam (aktívny záznam má `removed_at IS NULL`, I2). */
const SQL_ENRICH_PRIORITY_ALLOWLIST =
  'UPDATE catalog_cache c ' +
  'JOIN products_allowlist a ON a.product_id = c.product_id AND a.removed_at IS NULL ' +
  'SET c.enrich_priority = 1 WHERE c.enrich_priority <> 1';

/**
 * Priorita 2 — produkt v aktívnej/plánovanej kampani. `enrich_priority = 3`
 * v `WHERE` je dôležité: produkt z povoleného zoznamu (1) sa NESMIE zhoršiť na
 * 2 len preto, že je aj v kampani. Preto sa allowlist prepisuje PRVÝ.
 */
const SQL_ENRICH_PRIORITY_CAMPAIGNS =
  'UPDATE catalog_cache c ' +
  'JOIN campaign_items i ON i.product_id = c.product_id ' +
  'JOIN campaigns m ON m.id = i.campaign_id ' +
  'SET c.enrich_priority = 2 ' +
  `WHERE c.enrich_priority = 3 AND m.status IN (${ENRICH_CAMPAIGN_PLACEHOLDERS}) ` +
  'AND m.date_to >= ?';

/**
 * Vrátenie na prioritu 3, keď dôvod prednosti zanikol (produkt odobraný z
 * allowlistu, kampaň dobehla). Bez tohto by fronta navždy vozila dopredu
 * produkty, ktoré už nikoho nezaujímajú.
 *
 * `enrich_priority < 3` nie je krytý indexom, takže tento príkaz prejde zrkadlo
 * raz. Je to vedomý obchod: beží LEN pri zmene allowlistu alebo kampaní (teda
 * ručne, zopár krát za deň), kým dotaz fronty beží pri každom tiku dávky — a
 * ten indexovaný je. Vlastný index na `enrich_priority` by za to platil pri
 * každom zápise a slúžil by jednému príkazu.
 */
const SQL_ENRICH_PRIORITY_DEMOTE =
  'UPDATE catalog_cache c SET c.enrich_priority = 3 WHERE c.enrich_priority < 3 ' +
  'AND NOT EXISTS (SELECT 1 FROM products_allowlist a ' +
  'WHERE a.product_id = c.product_id AND a.removed_at IS NULL) ' +
  'AND NOT EXISTS (SELECT 1 FROM campaign_items i JOIN campaigns m ON m.id = i.campaign_id ' +
  `WHERE i.product_id = c.product_id AND m.status IN (${ENRICH_CAMPAIGN_PLACEHOLDERS}) ` +
  'AND m.date_to >= ?)';

const ENRICH_STATE_COLUMNS =
  'batch_day, enriched_today, daily_target, last_product_id, enriched_total, ' +
  'started_at, last_read_at, paused_until, pause_reason, last_error, updated_at';

const SQL_ENRICH_STATE_GET =
  `SELECT ${ENRICH_STATE_COLUMNS} FROM catalog_enrich_state WHERE id = 1 LIMIT 1`;

/**
 * Zápis stavu dávky. `INSERT … ON DUPLICATE KEY UPDATE` z rovnakého dôvodu ako
 * `SQL_PROGRESS_SAVE`: riadok síce zakladá migrácia, ale dávka, ktorá by kvôli
 * chýbajúcemu riadku potichu nezapisovala stav, by po prerušení stratila dôvod
 * pauzy — a pri `ip_banned` by sa o kvótu pokúsila znova.
 */
const SQL_ENRICH_STATE_SAVE =
  'INSERT INTO catalog_enrich_state ' +
  '(id, batch_day, enriched_today, daily_target, last_product_id, enriched_total, ' +
  'started_at, last_read_at, paused_until, pause_reason, last_error) ' +
  'VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
  'ON DUPLICATE KEY UPDATE batch_day = VALUES(batch_day), ' +
  'enriched_today = VALUES(enriched_today), daily_target = VALUES(daily_target), ' +
  'last_product_id = VALUES(last_product_id), enriched_total = VALUES(enriched_total), ' +
  'started_at = VALUES(started_at), last_read_at = VALUES(last_read_at), ' +
  'paused_until = VALUES(paused_until), pause_reason = VALUES(pause_reason), ' +
  'last_error = VALUES(last_error)';

/* ═══════════════════════════ 4. Pomocníci ═════════════════════════════════ */

interface CatalogRow {
  product_id: number;
  name: string | null;
  price: string | number | null;
  has_attributes: number | boolean;
  shop_status: string | null;
  source: CatalogSource;
  fetched_at: Date | string;
  raw: unknown;
}

interface SearchRow extends CatalogRow {
  units_sold: number | string | null;
  ever_discounted: number | string | null;
  discounted_now: number | string | null;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

/** `DECIMAL(10,2)` chodí ako string (pool má `decimalAsNumber:false`) — nikdy float (§2). */
const toMoney = (value: string | number | null): MoneyString | null =>
  value == null ? null : String(value);

/** JSON stĺpec môže prísť ako string aj ako už rozparsovaný objekt. */
function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const isShopStatus = (value: unknown): value is CatalogShopStatus =>
  KNOWN_SHOP_STATUSES.includes(value as CatalogShopStatus);

function mapRow(row: CatalogRow): CatalogCacheRecordV3 {
  return {
    productId: Number(row.product_id),
    name: row.name,
    price: toMoney(row.price),
    hasAttributes: Boolean(row.has_attributes),
    // Neznámu hodnotu čítame ako `unknown`, nie ako `ok` — o produkte, ktorého
    // stav nevieme prečítať, nesmieme tvrdiť, že v shope existuje (K1 bod 2).
    shopStatus: isShopStatus(row.shop_status) ? row.shop_status : 'unknown',
    source: row.source,
    fetchedAt: toDate(row.fetched_at),
    raw: parseJsonColumn(row.raw),
  };
}

function mapSearchRow(row: SearchRow, coverage: SoldWindowCoverage): CatalogSearchRow {
  return {
    ...mapRow(row),
    unitsSold: soldUnitsForWindow(row.units_sold, coverage),
    everDiscounted: Number(row.ever_discounted ?? 0) === 1,
    discountedNow: Number(row.discounted_now ?? 0) === 1,
  };
}

const isValidProductId = (id: number): boolean => Number.isInteger(id) && id > 0;

/* ── detaily z `raw`: kód, EAN, sklad, varianty ─────────────────────────── */

/** Pomlčka, ktorou sa priznáva nevedomosť. JEDEN znak na celú appku. */
export const CATALOG_DASH = '—';

/**
 * Hodnota na obrazovku. `null` → pomlčka, `0` → „0".
 *
 * Existuje preto, aby sa „sklad 0" a „sklad nevieme" nedali napísať rovnako
 * omylom: `String(value ?? '')` aj `value || '—'` z platnej nuly urobia
 * prázdno, resp. pomlčku. Tu sa nula prepustí.
 */
export function catalogDetailText(value: CatalogDetailValue<string | number>): string {
  return value.value === null ? CATALOG_DASH : String(value.value);
}

const known = <T>(value: T): CatalogDetailValue<T> => ({ value, gap: null });
const missing = <T>(gap: CatalogDetailGap): CatalogDetailValue<T> => ({ value: null, gap });

/** Neprázdny text zo shopu; `''` a `'   '` znamenajú „shop nič nevedie". */
function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Celé číslo aj z PHP stringu (`'12'`). Nula prejde; nezmysel je `null`. */
function intOrNull(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

/** To isté pre desatinné čísla (marža, nákupná cena). */
function numOrNull(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function boolOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return null;
}

/**
 * Ktorou cestou riadok prišiel — z toho, čo v `raw` naozaj leží.
 *
 * ROZLIŠOVAČ JE POLE `reduction`, A TO ZÁMERNE
 * --------------------------------------------
 * Stĺpec `source` je `enum('list','get','batch')` a `getFull` v ňom NIE JE.
 * Pridať ho by bola migrácia, a tá sa robiť nemá; `getFull` sa navyše cez
 * `/api/batch` fanúť nedá (dokumentácia shopu má opt-in len na
 * `products/get` a `order/get`), takže by aj tak vždy pristál ako `get`
 * a od jednotlivého `get` by sa nelíšil ničím.
 *
 * `reduction` je pole, ktoré NEPOSIELA shop — skladá ho `toShopReduction()`
 * z trojice `reduction_*`, a tá je v `productFullSchema` POVINNÁ (smie byť
 * `null`, ale musí prísť). Na `ProductDetail` z `get` teda neexistuje a na
 * `ProductFullDetail` existuje vždy. Preto je to spoľahlivá značka a nie
 * hádanie.
 *
 * Keby ju niekto z ukladaného objektu odstránil, riadky z `getFull` by sa
 * začali čítať ako `get` a ich kód by zmizol za „chýba oprávnenie" — presne
 * to tvrdenie, ktoré sa tu nesmie stať. Stráži to `detaily-katalog.spec.ts`.
 */
export function catalogDetailRoute(source: CatalogSource | null, raw: unknown): CatalogDetailRoute {
  if (source !== 'get' && source !== 'batch') return 'list';
  if (typeof raw !== 'object' || raw === null) return 'list';
  return 'reduction' in (raw as Record<string, unknown>) ? 'getFull' : 'get';
}

function readVariants(raw: unknown): CatalogVariantDetail[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const attributes = (raw as { attributes?: unknown }).attributes;
  if (!Array.isArray(attributes)) return [];

  const out: CatalogVariantDetail[] = [];
  for (const item of attributes) {
    if (typeof item !== 'object' || item === null) continue;
    const attribute = item as Record<string, unknown>;
    const variantId = intOrNull(attribute.id_product_attribute);
    if (variantId === null) continue;
    const values = Array.isArray(attribute.values)
      ? attribute.values.filter((v): v is string => typeof v === 'string')
      : [];
    out.push({
      variantId,
      reference: textOrNull(attribute.reference),
      ean13: textOrNull(attribute.ean13),
      quantity: intOrNull(attribute.quantity),
      isDefault: boolOrNull(attribute.is_default),
      values,
    });
  }
  return out;
}

/**
 * Súčet skladu cez varianty — jediné skladové číslo bez `product:read`.
 *
 * Známy je LEN vtedy, keď sklad povedal každý variant. Súčet troch známych
 * z piatich variantov je nižšie číslo vydávané za celkový sklad, a to je
 * horšie než pomlčka: podľa nižšieho čísla sa rozhodne inak než podľa „nevieme".
 */
function readVariantStock(
  route: CatalogDetailRoute,
  variants: readonly CatalogVariantDetail[],
): CatalogDetailValue<number> {
  if (route === 'list') return missing('not_fetched');
  if (variants.length === 0) return missing('shop_has_none');
  if (variants.some((variant) => variant.quantity === null)) return missing('shop_has_none');
  return known(variants.reduce((sum, variant) => sum + (variant.quantity ?? 0), 0));
}

/** Pole, ktoré nesie výhradne `getFull`. Dôvod chýbania závisí od cesty. */
function fullOnly<T>(route: CatalogDetailRoute, value: T | null): CatalogDetailValue<T> {
  if (route === 'list') return missing('not_fetched');
  if (route === 'get') return missing('needs_product_read');
  return value === null ? missing('shop_has_none') : known(value);
}

function readFullFields(route: CatalogDetailRoute, raw: unknown): CatalogFullDetail | null {
  if (route !== 'getFull' || typeof raw !== 'object' || raw === null) return null;
  const full = raw as Record<string, unknown>;
  const categories = Array.isArray(full.categories)
    ? full.categories.map(intOrNull).filter((id): id is number => id !== null)
    : null;
  return {
    purchasePrice: numOrNull(full.purchase_price),
    margin: numOrNull(full.margin),
    marginPercent: numOrNull(full.margin_percent),
    sellPrice: numOrNull(full.sell_price),
    sellPriceWithVat: numOrNull(full.sell_price_with_vat),
    active: boolOrNull(full.active),
    dateAdd: textOrNull(full.date_add),
    lastTimeInOrder: textOrNull(full.last_time_in_order),
    qtyInOrders: intOrNull(full.qty_in_orders),
    supplier: textOrNull(full.supplier),
    categories,
  };
}

/**
 * Riadok zrkadla → detaily aj s priznaním, čo o ňom nevieme.
 *
 * Čistá funkcia bez DB, aby sa dala testovať nad ručne zloženým `raw` —
 * a aby sa dala použiť aj tam, kde riadok príde inou cestou než z `getMany()`.
 */
export function catalogDetailFromRecord(record: CatalogCacheRecordV3): CatalogDetailRow {
  const route = catalogDetailRoute(record.source, record.raw);
  const raw = (typeof record.raw === 'object' && record.raw !== null ? record.raw : {}) as Record<
    string,
    unknown
  >;
  const variants = readVariants(record.raw);

  return {
    productId: record.productId,
    missing: false,
    route,
    source: record.source,
    fetchedAt: record.fetchedAt,
    name: record.name,
    price: record.price,
    hasAttributes: record.hasAttributes,
    reference: fullOnly(route, textOrNull(raw.reference)),
    ean13: fullOnly(route, textOrNull(raw.ean13)),
    quantity: fullOnly(route, intOrNull(raw.qty)),
    variants,
    variantStock: readVariantStock(route, variants),
    full: readFullFields(route, record.raw),
  };
}

/** Produkt, ktorý zrkadlo vôbec nemá — všetko je `not_fetched`, nič nie je nula. */
export function emptyCatalogDetail(productId: number): CatalogDetailRow {
  return {
    productId,
    missing: true,
    route: 'list',
    source: null,
    fetchedAt: null,
    name: null,
    price: null,
    hasAttributes: false,
    reference: missing('not_fetched'),
    ean13: missing('not_fetched'),
    quantity: missing('not_fetched'),
    variants: [],
    variantStock: missing('not_fetched'),
    full: null,
  };
}

/* ── pokrok behu: riadok ⇄ objekt ───────────────────────────────────────── */

interface ProgressRow {
  per_page: number | string | null;
  last_page: number | string | null;
  shop_total: number | string | null;
  rows_written: number | string | null;
  completed: number | boolean | null;
  started_at: Date | string | null;
  last_read_at: Date | string | null;
  finished_at: Date | string | null;
  paused_until: Date | string | null;
  pause_reason: string | null;
  last_error: string | null;
  updated_at: Date | string | null;
}

const toDateOrNull = (value: Date | string | null): UtcDate | null =>
  value == null ? null : toDate(value);

/** Nezáporné celé číslo, alebo `fallback` pri čomkoľvek, čo sa nedá prečítať. */
function toCount(value: number | string | null, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

const isPauseReason = (value: unknown): value is CatalogPauseReason =>
  KNOWN_PAUSE_REASONS.includes(value as CatalogPauseReason);

/** Pokrok, ktorý platí, kým sa nič neprečítalo — „ešte sa nezačalo". */
export function emptyCatalogProgress(perPage = DEFAULT_CATALOG_PER_PAGE): CatalogSyncProgress {
  return {
    perPage,
    lastPage: 0,
    shopTotal: null,
    rowsWritten: 0,
    completed: false,
    startedAt: null,
    lastReadAt: null,
    finishedAt: null,
    pausedUntil: null,
    pauseReason: null,
    lastError: null,
    updatedAt: null,
  };
}

function mapProgressRow(row: ProgressRow): CatalogSyncProgress {
  const shopTotal = row.shop_total == null ? null : Number(row.shop_total);
  return {
    perPage: Math.max(1, toCount(row.per_page, DEFAULT_CATALOG_PER_PAGE)),
    lastPage: toCount(row.last_page, 0),
    shopTotal: shopTotal !== null && Number.isFinite(shopTotal) ? shopTotal : null,
    rowsWritten: toCount(row.rows_written, 0),
    completed: Boolean(row.completed),
    startedAt: toDateOrNull(row.started_at),
    lastReadAt: toDateOrNull(row.last_read_at),
    finishedAt: toDateOrNull(row.finished_at),
    pausedUntil: toDateOrNull(row.paused_until),
    pauseReason: isPauseReason(row.pause_reason) ? row.pause_reason : null,
    lastError: row.last_error,
    updatedAt: toDateOrNull(row.updated_at),
  };
}

/* ── obohatenie: riadok ⇄ objekt (0014, D116–D119) ──────────────────────── */

/** Tvar, v akom shop posiela dátum/čas (`'2026-07-28'` aj s časom). */
const SHOP_STAMP_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;

/**
 * Časová pečiatka zo shopu do `?` parametra.
 *
 * String v tvare shopu ide DO DB NEDOTKNUTÝ, takže v stĺpci stojí presne ten
 * čas, ktorý shop povedal (zmerané — viď docblok `CatalogEnrichWrite`). Prerobiť
 * ho na okamih ručne by hodiny posunulo o offset zóny; `Date` prijmeme tak, ako
 * je, lebo ovládač si s ním poradí sám.
 *
 * Nerozpoznaný tvar je `null`: uložiť ho nevieme a MariaDB by ním zhodila celú
 * dávku. Surová odpoveď zostáva v `raw`, takže sa nič nestráca — a `NULL` tu
 * znamená presne to, čo znamenať má: „nevieme" (I11).
 */
function shopStampParam(value: string | UtcDate | null | undefined): Date | string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = value.trim();
  if (!SHOP_STAMP_RE.test(text)) return null;
  return text.replace('T', ' ');
}

interface EnrichRow {
  product_id: number | string;
  reference: string | null;
  ean13: string | null;
  purchase_price: string | number | null;
  margin: string | number | null;
  margin_percent: string | number | null;
  sell_price_with_vat: string | number | null;
  last_time_in_order: Date | string | null;
  qty: number | string | null;
  qty_in_orders: number | string | null;
  supplier: string | null;
  reduction_percent: string | number | null;
  reduction_from: Date | string | null;
  reduction_to: Date | string | null;
  active: number | boolean | null;
  categories: unknown;
  enriched_at: Date | string | null;
  enrich_attempted_at: Date | string | null;
  enrich_priority: number | string | null;
}

/**
 * Riadok obohatenia → objekt. Každé pole prechádza `…OrNull`, takže `0` prežije
 * ako nula a nezmysel skončí ako `null` — nikdy naopak (I11).
 */
function mapEnrichRow(row: EnrichRow): CatalogEnrichmentRecord {
  const categories = parseJsonColumn(row.categories);
  return {
    productId: Number(row.product_id),
    reference: textOrNull(row.reference),
    ean13: textOrNull(row.ean13),
    purchasePrice: numOrNull(row.purchase_price),
    margin: numOrNull(row.margin),
    marginPercent: numOrNull(row.margin_percent),
    sellPriceWithVat: numOrNull(row.sell_price_with_vat),
    lastTimeInOrder: toDateOrNull(row.last_time_in_order),
    qty: intOrNull(row.qty),
    qtyInOrders: intOrNull(row.qty_in_orders),
    supplier: textOrNull(row.supplier),
    reductionPercent: numOrNull(row.reduction_percent),
    reductionFrom: toDateOrNull(row.reduction_from),
    reductionTo: toDateOrNull(row.reduction_to),
    active: boolOrNull(row.active),
    categories: Array.isArray(categories)
      ? categories.map(intOrNull).filter((id): id is number => id !== null)
      : null,
    enrichedAt: toDateOrNull(row.enriched_at),
    enrichAttemptedAt: toDateOrNull(row.enrich_attempted_at),
    enrichPriority: toCount(
      typeof row.enrich_priority === 'string' ? row.enrich_priority : (row.enrich_priority ?? null),
      ENRICH_PRIORITY_REST,
    ),
  };
}

/** Obohatenie, ktoré platí o produkte, čo zrkadlo vôbec nemá — všetko „nevieme". */
export function emptyCatalogEnrichment(productId: number): CatalogEnrichmentRecord {
  return {
    productId,
    reference: null,
    ean13: null,
    purchasePrice: null,
    margin: null,
    marginPercent: null,
    sellPriceWithVat: null,
    lastTimeInOrder: null,
    qty: null,
    qtyInOrders: null,
    supplier: null,
    reductionPercent: null,
    reductionFrom: null,
    reductionTo: null,
    active: null,
    categories: null,
    enrichedAt: null,
    enrichAttemptedAt: null,
    enrichPriority: ENRICH_PRIORITY_REST,
  };
}

/* ── stav dávky obohacovania: riadok ⇄ objekt (0014) ─────────────────────── */

interface EnrichStateRow {
  batch_day: Date | string | null;
  enriched_today: number | string | null;
  daily_target: number | string | null;
  last_product_id: number | string | null;
  enriched_total: number | string | null;
  started_at: Date | string | null;
  last_read_at: Date | string | null;
  paused_until: Date | string | null;
  pause_reason: string | null;
  last_error: string | null;
  updated_at: Date | string | null;
}

const isEnrichPauseReason = (value: unknown): value is CatalogEnrichPauseReason =>
  KNOWN_ENRICH_PAUSE_REASONS.includes(value as CatalogEnrichPauseReason);

/** `DATE` stĺpec chodí ako `Date` aj ako string — chceme `YYYY-MM-DD`. */
function dayOrNull(value: Date | string | null): DateOnly | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const pad = (n: number): string => String(n).padStart(2, '0');
    // `DATE` je kalendárny deň bez zóny; pool ho dáva ako lokálnu polnoc, preto
    // sa čítajú LOKÁLNE zložky — `toISOString()` by deň posunul (rovnako ako
    // `toDateOnly()` v `sales.repo.ts`).
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const text = String(value);
  return DATE_ONLY_RE.test(text) ? text : (text.slice(0, 10) as DateOnly);
}

/** Stav dávky, ktorý platí, kým sa nič neobohatilo — „ešte sa nezačalo". */
export function emptyCatalogEnrichState(): CatalogEnrichState {
  return {
    batchDay: null,
    enrichedToday: 0,
    dailyTarget: DEFAULT_ENRICH_DAILY_TARGET,
    lastProductId: null,
    enrichedTotal: 0,
    startedAt: null,
    lastReadAt: null,
    pausedUntil: null,
    pauseReason: null,
    lastError: null,
    updatedAt: null,
  };
}

function mapEnrichStateRow(row: EnrichStateRow): CatalogEnrichState {
  const lastProductId = intOrNull(row.last_product_id);
  return {
    batchDay: dayOrNull(row.batch_day),
    enrichedToday: toCount(Number(row.enriched_today ?? 0), 0),
    dailyTarget: Math.max(0, toCount(Number(row.daily_target ?? 0), DEFAULT_ENRICH_DAILY_TARGET)),
    lastProductId: lastProductId !== null && lastProductId > 0 ? lastProductId : null,
    enrichedTotal: toCount(Number(row.enriched_total ?? 0), 0),
    startedAt: toDateOrNull(row.started_at),
    lastReadAt: toDateOrNull(row.last_read_at),
    pausedUntil: toDateOrNull(row.paused_until),
    pauseReason: isEnrichPauseReason(row.pause_reason) ? row.pause_reason : null,
    lastError: row.last_error,
    updatedAt: toDateOrNull(row.updated_at),
  };
}

const DECIMAL_RE = /^-?\d{1,8}(\.\d{1,2})?$/;

/** Cena do `?` parametra ako string; nezmysel sa ticho IGNORUJE (filter odpadne). */
function toPriceParam(value: MoneyString | number | null | undefined): string | null {
  if (value == null) return null;
  const text = typeof value === 'number' ? String(value) : value.trim().replace(',', '.');
  return DECIMAL_RE.test(text) ? text : null;
}

/**
 * Celé kladné číslo do `?` parametra (kusy skladu, celkovo objednané). Nezmysel
 * sa ticho IGNORUJE a filter odpadne — rovnaká zásada ako pri cene: odkaz
 * z uloženého filtra nesmie obrazovku zhodiť.
 */
function toCountParam(value: number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Escapuje `LIKE` wildcardy, aby `%` vo vyhľadávaní neznamenal „všetko". */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Hľadaný text na slová (strop `MAX_SEARCH_WORDS`). Poradie sa zachováva, aby
 * sa parametre dotazu dali čítať zľava doprava tak, ako ich človek napísal.
 */
function searchWords(term: string): string[] {
  return term
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, MAX_SEARCH_WORDS)
    .map((word) => word.slice(0, MAX_SEARCH_WORD_LENGTH));
}

function normalizeWindowDays(value: number | undefined): number {
  const parsed = Math.trunc(Number(value));
  return ALLOWED_SOLD_WINDOWS.includes(parsed) ? parsed : DEFAULT_SOLD_WINDOW_DAYS;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Predikáty vedier predajnosti. Výraz `COALESCE(s.units, 0)` sa opakuje, lebo
 * alias zo SELECT-u sa v `WHERE` použiť nedá (a `HAVING` by zabilo `LIMIT`).
 *
 * VEDRO `none` JE „0 PREDANÝCH", NIE „NEVIEME" (D121, 31. 8. 2026)
 * ───────────────────────────────────────────────────────────────
 * Do 31. 8. 2026 bolo `none` doslova `COALESCE(s.units, 0) = 0` bez ohľadu na
 * pokrytie, takže pri okne 180 dní a dvoch stiahnutých vybral filter „0
 * predaných" CELÝ katalóg — a obrazovka Nová zľava, ktorá s tým filtrom
 * ŠTARTUJE (`app/zlavy/nova/page.tsx`), na ňom postavila „10 000 produktov ·
 * 30 %". Filter „0 predaných" musí vyberať produkty, o ktorých appka VIE, že sa
 * nepredali; produkty, o ktorých nevie, sa doň nesmú dostať (`soldUnknown`).
 *
 * Preto pri nedočítanom okne `none` NEVYBERIE NIČ (`1 = 0`) — je to tá istá
 * hranica ako v `soldUnitsForWindow()`: meraná nula existuje len vtedy, keď je
 * okno celé dočítané. Vedrá `low`/`mid`/`high` bránu nepotrebujú: `s.units > 0`
 * je zmeraný predaj v dočítaných dňoch, teda dolná hranica, a tá do vedra pod
 * svojou skutočnou hodnotou nespadne (`≥` sa priznáva na povrchu).
 */
function soldBucketSql(coverage: SoldWindowCoverage): Record<SoldBucket, string> {
  const measuredZero = coverage.completeDays > 0 && coverage.unknownDays === 0;
  return {
    none: measuredZero ? 'COALESCE(s.units, 0) = 0' : '1 = 0',
    low: 'COALESCE(s.units, 0) BETWEEN 1 AND 2',
    mid: 'COALESCE(s.units, 0) BETWEEN 3 AND 9',
    high: 'COALESCE(s.units, 0) >= 10',
  };
}

/** Riadky, o ktorých predaji appka za okno nič nevie — doplnok vedier (D121). */
function soldUnknownSql(coverage: SoldWindowCoverage): string {
  if (coverage.completeDays === 0) return '1 = 1';
  if (coverage.unknownDays === 0) return '1 = 0';
  // Čiastočne dočítané okno: nula nie je meraná, kladné číslo je dolná hranica.
  return 'COALESCE(s.units, 0) = 0';
}

/**
 * TRI STAVY JEDNÉHO ČÍSLA (I11, D121) — a je to to isté pravidlo, aké už
 * používajú KPI (`sales/insights.ts` → `kpiWindowUnits`) aj dominanta bočného
 * panela (`products/sold-coverage.ts` → `soldUnitsViaCoverage`). Nie štvrté
 * pravidlo, len presunuté tam, kde sa číslo rodí — pred `soldBucketOf()`:
 *
 *  · ani jeden dočítaný deň  → `null`. Nula by bola tvrdenie o nepredaní.
 *  · okno celé dočítané      → číslo; `0` je MERANÝ fakt „nepredalo sa nič".
 *  · okno dočítané len z časti:
 *      – súčet > 0 → číslo. Toľko kusov appka NAOZAJ zmerala; povrch to ukáže
 *        ako `≥ N` (`kpiUnitsCell`) a skryť to by bolo druhé zlyhanie I11.
 *      – súčet = 0 → `null`. `≥ 0` nie je priznanie, ale prázdna veta — a práve
 *        z tejto nuly vzniklo vedro `none` s 30 % zľavou (D121).
 *
 * Dôsledok, ktorý je ZÁMER: najhlbšie pásmo (`none`, 30 %) je odteraz
 * dosiahnuteľné VÝHRADNE z celého dočítaného okna.
 */
function soldUnitsForWindow(
  raw: number | string | bigint | null | undefined,
  coverage: SoldWindowCoverage,
): number | null {
  if (coverage.completeDays === 0) return null;
  const parsed = raw === null || raw === undefined ? 0 : Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const units = Math.max(0, Math.trunc(parsed));
  if (coverage.unknownDays === 0) return units;
  return units === 0 ? null : units;
}

const isSoldBucket = (value: unknown): value is SoldBucket =>
  value === 'none' || value === 'low' || value === 'mid' || value === 'high';

interface ResolvedWindow {
  windowDays: number;
  from: DateOnly;
  to: DateOnly;
}

/**
 * Okno predajnosti. Deň sa počíta v `Europe/Bratislava` cez `dates.ts` (D31) —
 * nikdy v UTC, inak by sa medzi 22:00 a 24:00 UTC filtrovalo podľa zajtrajška.
 */
function resolveWindow(filter: CatalogSearchFilter): ResolvedWindow {
  const windowDays = normalizeWindowDays(filter.soldWindowDays);
  const to =
    typeof filter.today === 'string' && DATE_ONLY_RE.test(filter.today)
      ? filter.today
      : todayInZone(new Date());
  // Okno vrátane dnešného dňa: 30 dní = dnes + 29 predchádzajúcich.
  const from = addDays(to, -(windowDays - 1));
  return { windowDays, from, to };
}

interface WhereParts {
  sql: string;
  values: unknown[];
}

/**
 * Zloží `WHERE` časť. Každá hodnota ide ako `?` — do SQL sa neinterpoluje nič
 * okrem počtu placeholderov a konštantných fragmentov z tohto súboru.
 */
function buildWhere(
  filter: CatalogSearchFilter,
  includeFacets: boolean,
  day: DateOnly,
  coverage: SoldWindowCoverage,
): WhereParts {
  const where: string[] = [];
  const values: unknown[] = [];

  const statuses = (filter.shopStatus ?? []).filter(isShopStatus);
  const effectiveStatuses = statuses.length > 0 ? statuses : [...DEFAULT_SHOP_STATUSES];
  where.push(`c.shop_status IN (${effectiveStatuses.map(() => '?').join(', ')})`);
  values.push(...effectiveStatuses);

  if (filter.productIds !== undefined) {
    const unique = [...new Set(filter.productIds.filter(isValidProductId))];
    if (unique.length === 0) {
      // Prázdny výber nie je „bez filtra" — je to prázdny výsledok (fail-closed).
      where.push('1 = 0');
    } else {
      where.push(`c.product_id IN (${unique.map(() => '?').join(', ')})`);
      values.push(...unique);
    }
  }

  const term = (filter.query ?? '').trim();
  if (term.length > 0) {
    if (/^\d{1,9}$/.test(term)) {
      /*
       * Celé číslo je buď ID, alebo text v názve, referencii či EAN-e — hľadáme
       * všetko. `ean13` je celé číslo, takže bez tejto vetvy by sa dal nájsť len
       * omylom (ako „slovo"), a to len pri obohatených produktoch (I11).
       */
      where.push(`(c.product_id = ? OR ${SEARCH_LIKE_SQL})`);
      values.push(Number(term));
      for (const _column of SEARCH_LIKE_COLUMNS) values.push(escapeLike(term));
    } else {
      /*
       * KAŽDÉ SLOVO MÁ VLASTNÝ `LIKE`, SPOJENÉ CEZ `AND`.
       *
       * Jeden súvislý podreťazec cez celý term hľadal FRÁZU v presnom poradí,
       * a to nikto do poľa nepíše: „naramok zirkon" tak našlo 10 produktov,
       * kým slovo po slove ich je 797 (zmerané, 41 220 riadkov). Zvyšok
       * príbehu — prečo tu nie je engine ani FULLTEXT — je v hlavičke súboru.
       *
       * Poradie slov je tým pádom jedno a diakritika sa nerieši: kolácia
       * `utf8mb4_unicode_ci` skladá `á` a `a` sama.
       */
      for (const word of searchWords(term)) {
        // Jedno slovo = jedna ZÁTVORKA nad `name`/`reference`/`ean13` spojená
        // cez `OR`. Zátvorka je nutná: bez nej by `OR` rozvalilo `AND` medzi
        // slovami a „naramok zirkon" by našlo aj samotné náramky.
        where.push(`(${SEARCH_LIKE_SQL})`);
        for (const _column of SEARCH_LIKE_COLUMNS) values.push(escapeLike(word));
      }
    }
  }

  const priceFrom = toPriceParam(filter.priceFrom);
  if (priceFrom !== null) {
    where.push('c.price >= ?');
    values.push(priceFrom);
  }
  const priceTo = toPriceParam(filter.priceTo);
  if (priceTo !== null) {
    where.push('c.price <= ?');
    values.push(priceTo);
  }

  /*
   * ── Filtre nad obohatením (D125, K4) ──────────────────────────────────────
   *
   * Stoja TU, mimo `includeFacets`, teda platia aj v `counts()`. Je to zámer:
   * bočný panel nemá pri nich vlastné číslo, ktoré by si vynulovali, a čísla
   * vedier majú hovoriť o tom istom výbere, aký je v tabuľke.
   *
   * Všetky štyri sú fail-closed nad `NULL`: neobohatený riadok NEVYHOVIE ani
   * jednej podmienke, takže výsledok je „toľko, koľko vieme", nie „toľko ich
   * je" (I11). Že je to zlomok katalógu, priznáva `enrichedOnly` v odpovedi
   * a číslo `counts.enrichedRows` v paneli.
   *
   * VÝKON (zmerané `EXPLAIN`-om nad `ovl_zliav`, 41 348 riadkov): plán zostáva
   * `range` nad `ix_catalog_shop_status` ako bez týchto podmienok; `stock` si
   * navyše siahne na `ix_catalog_qty` a `lastSaleOlderDays` na `sort_union`
   * (`ix_catalog_last_order`, `ix_catalog_enrich_queue`). Žiadny nový full scan
   * ani filesort — `Using temporary; Using filesort` je z `ORDER BY` nad
   * pripojenou predajnosťou a bol tam aj predtým.
   */
  const marginFrom = toPriceParam(filter.marginPercentFrom);
  if (marginFrom !== null) {
    where.push('c.margin_percent >= ?');
    values.push(marginFrom);
  }
  const marginTo = toPriceParam(filter.marginPercentTo);
  if (marginTo !== null) {
    where.push('c.margin_percent <= ?');
    values.push(marginTo);
  }

  if (filter.stock === 'in') {
    // `> 0` samo vylučuje `NULL` (porovnanie s `NULL` nie je pravda) — a to je
    // správne: o neobohatenom produkte appka sklad nepozná.
    where.push('c.qty > 0');
  } else if (filter.stock === 'out') {
    // Nula a menej. `IS NOT NULL` je tu VÝSLOVNE, hoci `<= 0` by NULL zahodilo
    // samo: „nevieme" sa nesmie čítať ako „vypredané" ani po budúcej úprave.
    where.push('(c.qty IS NOT NULL AND c.qty <= 0)');
  }

  const orderedFrom = toCountParam(filter.orderedTotalFrom);
  if (orderedFrom !== null) {
    where.push('c.qty_in_orders >= ?');
    values.push(orderedFrom);
  }
  const orderedTo = toCountParam(filter.orderedTotalTo);
  if (orderedTo !== null) {
    where.push('c.qty_in_orders <= ?');
    values.push(orderedTo);
  }

  const olderDays = toCountParam(filter.lastSaleOlderDays);
  if (olderDays !== null && olderDays > 0 && olderDays <= MAX_LAST_SALE_OLDER_DAYS) {
    where.push(SQL_LAST_SALE_OLDER);
    values.push(`${addDays(day, -olderDays)} 23:59:59`);
  }

  if (includeFacets) {
    const buckets = [...new Set((filter.soldBuckets ?? []).filter(isSoldBucket))];
    if (buckets.length > 0 && buckets.length < 4) {
      const bucketSql = soldBucketSql(coverage);
      where.push(`(${buckets.map((bucket) => bucketSql[bucket]).join(' OR ')})`);
    }
    if (filter.neverDiscounted === true) {
      where.push('d.product_id IS NULL');
    }
    if (filter.currentlyDiscounted === true) {
      where.push('COALESCE(d.now_on, 0) = 1');
    }
    if (filter.shopDiscounted === true) {
      // Stav SHOPU z obohatenia (D116) — nie vlastné zápisy. Neobohatený riadok
      // sem nespadne, a to je fail-closed „nevieme", nie „nie je v zľave" (I11).
      where.push(SQL_SHOP_DISCOUNT_ACTIVE);
      values.push(...shopDiscountDayValues(day));
    }
  }

  return { sql: where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '', values };
}

/* ═══════════════════════════ 5. Factory ═══════════════════════════════════ */

export interface CatalogRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
  /**
   * Zdieľaný rozpočet anonymných čítaní. Default je jediná produkčná inštancia
   * (`anonReadBudget`) — vlastné počítadlo si tu nikto nezakladá (A4). Prepis
   * je výhradne pre testy.
   */
  readBudget?: ReadBudget;
}

/** Rozhranie po KONTRAKTE V3 — nadmnožina `CatalogRepo` z kontraktov. */
export interface CatalogRepoExt extends CatalogRepo {
  get(productId: number, conn?: Queryable): Promise<CatalogCacheRecordV3 | null>;
  getMany(productIds: number[], conn?: Queryable): Promise<Map<number, CatalogCacheRecordV3>>;
  upsert(record: CatalogUpsertInput, conn?: Queryable): Promise<void>;
  /** K7: dávkový upsert stránky synchronizácie. Vracia počet zapísaných riadkov. */
  upsertMany(records: CatalogUpsertInput[], conn?: Queryable): Promise<number>;
  /** D49: produkt, ktorý shop nenašiel — ostatné stĺpce zostanú (I11). */
  markShopStatus(
    productId: number,
    status: CatalogShopStatus,
    conn?: Queryable,
  ): Promise<void>;
  search(filter: CatalogSearchFilter, conn?: Queryable): Promise<CatalogSearchResult>;
  counts(filter: CatalogSearchFilter, conn?: Queryable): Promise<CatalogCounts>;
  /**
   * V1 — rozdelenie cien pre histogram. `binWidth` je šírka pásma v eurách,
   * `binCount` index ZBERNÉHO pásma (všetko nad ním sa doň zhrnie). Oboje
   * prichádza zvonku: repozitár o geometrii grafu nevie nič.
   */
  priceBuckets(binWidth: number, binCount: number, conn?: Queryable): Promise<CatalogPriceBuckets>;
  /**
   * Predajnosť a vlastné zľavy pre konkrétne ID — aj pre produkty, ktoré
   * zrkadlo katalógu ešte nemá (kontrakt UI, bod 26). Čisto čítacie.
   */
  factsFor(
    productIds: readonly number[],
    opts?: { soldWindowDays?: number; today?: DateOnly; conn?: Queryable },
  ): Promise<CatalogFactsResult>;
  /**
   * Doťahnuté detaily (kód, EAN, sklad, varianty) pre konkrétne ID.
   *
   * Vracia riadok pre KAŽDÉ platné ID, aj pre to, ktoré zrkadlo nemá — vtedy
   * je `missing: true` a všetko je `not_fetched`. Chýbajúci kľúč v mape by
   * volajúceho nútil dopĺňať si prázdno sám a prázdno sa ľahko nakreslí ako
   * nula. Čisto čítacie, žiadny shop.
   */
  detailsFor(productIds: readonly number[], conn?: Queryable): Promise<Map<number, CatalogDetailRow>>;
  /** Koľko riadkov katalóg vôbec má (hlavička „z 41 220 produktov"). */
  totalRows(conn?: Queryable): Promise<number>;
  /** K7: „Dáta k …" — meraný fakt, nie odhad (P7). `null` = katalóg je prázdny. */
  lastFetchedAt(conn?: Queryable): Promise<UtcDate | null>;

  /* ── A2/A4: dvojdňový beh ────────────────────────────────────────────── */

  /** Kde beh skončil. Prázdny pokrok = „ešte sa nezačalo", nikdy výnimka. */
  loadSyncProgress(conn?: Queryable): Promise<CatalogSyncProgress>;
  /** Uloží pokrok (celý riadok naraz — jeden zápis na stránku). */
  saveSyncProgress(progress: CatalogSyncProgress, conn?: Queryable): Promise<void>;
  /**
   * A4 — rezervácia zo ZDIEĽANÉHO denného rozpočtu anonymných čítaní. Volá sa
   * PRED requestom na shop; neúspešný request sa do stropu shopu počíta rovnako
   * ako úspešný.
   */
  reserveShopReads(count?: number): Promise<ReadReservation>;
  /** Stav zdieľaného čítacieho rozpočtu bez rezervovania (pre UI). */
  shopReadBudget(): Promise<ReadBudgetStatus>;
  /** A5 — stav katalógu pre UI a pre agregátor stavu. */
  syncStatus(opts?: { now?: UtcDate; conn?: Queryable }): Promise<CatalogSyncStatus>;

  /* ── D116–D119: obohatenie z `getFull` a fronta obohacovania ─────────── */

  /**
   * Zapíše obohatenie jedného produktu a označí ho ako obohatené.
   *
   * Vracia `true`, len keď riadok naozaj existoval. `false` = produkt v zrkadle
   * NIE JE, takže sa nič nezapísalo — a je to platná odpoveď, nie chyba: zrkadlo
   * je úplné k času posledného prechodu a eshop medzitým pridáva aj maže.
   */
  saveEnrichment(
    productId: number,
    data: CatalogEnrichWrite,
    conn?: Queryable,
  ): Promise<boolean>;
  /**
   * Obohatenie pre konkrétne ID. Vracia riadok pre KAŽDÉ platné ID — aj pre to,
   * ktoré zrkadlo nemá (vtedy je všetko `null`, teda „nevieme"). Chýbajúci kľúč
   * v mape by volajúceho nútil dopĺňať si prázdno sám a prázdno sa ľahko
   * nakreslí ako nula (I11).
   */
  enrichmentFor(
    productIds: readonly number[],
    conn?: Queryable,
  ): Promise<Map<number, CatalogEnrichmentRecord>>;
  /**
   * D114 — podklad KPI pre celú stránku produktov: názov, cenníková cena a
   * obohatenie, JEDNÝM dotazom na 500 ID (bez N+1).
   *
   * Vracia riadok pre KAŽDÉ platné ID, aj pre to, ktoré zrkadlo nemá — vtedy je
   * `missing: true` a obohatenie samé `null`. Čisto čítacie, žiadny shop (K8).
   */
  kpiRowsFor(productIds: readonly number[], conn?: Queryable): Promise<Map<number, CatalogKpiRow>>;
  /**
   * D118 — neúspešný pokus o obohatenie. `enriched_at` zostáva `NULL` (obohatené
   * naozaj nie je), ale produkt spadne na konec svojej priority, takže jeden
   * padajúci `getFull` nezje celú dennú kvótu.
   */
  markEnrichAttempt(productId: number, at?: UtcDate, conn?: Queryable): Promise<void>;
  /** D118 — ktoré produkty obohatiť ako ďalšie, v poradí priority. */
  nextToEnrich(limit: number, conn?: Queryable): Promise<number[]>;
  /**
   * D118 — prepočíta prioritu podľa povoleného zoznamu a kampaní. Volá sa pri
   * ZMENE týchto dvoch vecí, nie pri každom dotaze (viď komentáre pri
   * `SQL_ENRICH_PRIORITY_*`).
   */
  refreshEnrichPriority(opts?: {
    today?: DateOnly;
    conn?: Queryable;
  }): Promise<EnrichPriorityRefresh>;
  /** Kde stojí dávka obohacovania. Prázdny stav = „ešte sa nezačalo". */
  loadEnrichState(conn?: Queryable): Promise<CatalogEnrichState>;
  /** Uloží stav dávky (celý riadok naraz — jeden zápis na dávku). */
  saveEnrichState(state: CatalogEnrichState, conn?: Queryable): Promise<void>;
}

export function createCatalogRepo(deps: CatalogRepoDeps = {}): CatalogRepoExt {
  const readBudget = deps.readBudget ?? anonReadBudget;

  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  /**
   * Pokrytie okna: koľko jeho dní je `complete` (D121). Strop je `windowDays`,
   * lebo `sales_sync_state` môže mať aj deň mimo okna — a viac dočítaných dní,
   * než okno má, by z medzery spravilo zápornú hodnotu.
   */
  const completeDaysFor = async (
    window: ResolvedWindow,
    conn?: Queryable,
  ): Promise<SoldWindowCoverage> => {
    const rows = await run<Array<{ complete_days: number | bigint | null }>>(
      conn,
      SQL_COMPLETE_DAYS,
      [window.from, window.to],
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    const measured = row === undefined ? 0 : Math.max(0, Math.trunc(Number(row.complete_days ?? 0)));
    const windowDays = Math.max(0, Math.trunc(window.windowDays));
    const completeDays = Math.min(measured, windowDays);
    return { windowDays, completeDays, unknownDays: windowDays - completeDays };
  };

  const repo: CatalogRepoExt = {
    async get(productId: number, conn?: Queryable): Promise<CatalogCacheRecordV3 | null> {
      if (!isValidProductId(productId)) return null;
      const rows = await run<CatalogRow[]>(conn, SQL_GET, [productId]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      // Turbopack tu už raz zahodil `if (!row)` ako compile-time falsy.
      return row === undefined ? null : mapRow(row);
    },

    async getMany(
      productIds: number[],
      conn?: Queryable,
    ): Promise<Map<number, CatalogCacheRecordV3>> {
      const result = new Map<number, CatalogCacheRecordV3>();
      const unique = [...new Set(productIds.filter(isValidProductId))];
      if (unique.length === 0) return result;
      // Aj čítanie ide po dávkach — `IN (…)` s desiatimi tisíckami `?` by
      // narazilo na limit parametrov skôr než na limit trpezlivosti.
      for (let start = 0; start < unique.length; start += UPSERT_CHUNK_ROWS) {
        const chunk = unique.slice(start, start + UPSERT_CHUNK_ROWS);
        const placeholders = `(${chunk.map(() => '?').join(', ')})`;
        const rows = await run<CatalogRow[]>(conn, SQL_GET_MANY_PREFIX + placeholders, chunk);
        for (const row of Array.isArray(rows) ? rows : []) {
          const record = mapRow(row);
          result.set(record.productId, record);
        }
      }
      return result;
    },

    async upsert(record: CatalogUpsertInput, conn?: Queryable): Promise<void> {
      if (!isValidProductId(record.productId)) {
        throw new Error(`Neplatné product ID pre catalog_cache: ${String(record.productId)}.`);
      }
      await repo.upsertMany([record], conn);
    },

    /**
     * Dávkový upsert (K7). `shopStatus` je predvolene `ok`: do katalógu sa
     * zapisuje to, čo shop práve vrátil, takže produkt existuje. Produkt,
     * ktorý shop nenašiel, sa označuje `markShopStatus()` (D49), nie tu.
     */
    async upsertMany(records: CatalogUpsertInput[], conn?: Queryable): Promise<number> {
      const valid = records.filter((record) => isValidProductId(record.productId));
      if (valid.length === 0) return 0;

      let written = 0;
      for (let start = 0; start < valid.length; start += UPSERT_CHUNK_ROWS) {
        const chunk = valid.slice(start, start + UPSERT_CHUNK_ROWS);
        const tuples = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const values: unknown[] = [];
        for (const record of chunk) {
          values.push(
            record.productId,
            record.name == null ? null : record.name.slice(0, 255),
            record.price,
            record.hasAttributes ? 1 : 0,
            isShopStatus(record.shopStatus) ? record.shopStatus : 'ok',
            record.source,
            record.fetchedAt ?? new Date(),
            record.raw == null ? null : JSON.stringify(record.raw),
          );
        }
        await run(conn, SQL_UPSERT_PREFIX + tuples + SQL_UPSERT_SUFFIX, values);
        written += chunk.length;
      }
      return written;
    },

    async markShopStatus(
      productId: number,
      status: CatalogShopStatus,
      conn?: Queryable,
    ): Promise<void> {
      if (!isValidProductId(productId)) return;
      if (!isShopStatus(status)) {
        throw new Error(`Neznámy stav produktu v shope: ${String(status)}.`);
      }
      await run(conn, SQL_MARK_SHOP_STATUS, [status, productId]);
    },

    /**
     * Stránkované vyhľadávanie s filtrami. Tri dotazy: pokrytie okna, `COUNT(*)`
     * a stránka — `SQL_CALC_FOUND_ROWS` je v MariaDB deprecated a pomalší.
     *
     * Pokrytie ide PRVÉ a je to jeden `COUNT(*)` nad `sales_sync_state`: bez
     * neho sa `unitsSold` prečítať nedá (nula verzus „nevieme", D121).
     */
    async search(filter: CatalogSearchFilter, conn?: Queryable): Promise<CatalogSearchResult> {
      const page = Math.max(1, Math.trunc(filter.page ?? 1));
      const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Math.trunc(filter.perPage ?? 50)));
      const window = resolveWindow(filter);
      const sort = SORT_SQL[filter.sort ?? 'name'] ?? SORT_SQL.name;
      const coverage = await completeDaysFor(window, conn);

      // Poradie parametrov MUSÍ zodpovedať poradiu JOIN-ov v `FROM`.
      const joinValues = [window.from, window.to, window.to, window.to];
      const from = `FROM catalog_cache c ${JOIN_SALES}${JOIN_OWN_DISCOUNTS}`;
      const where = buildWhere(filter, true, window.to, coverage);

      const countRows = await run<Array<{ total: number | bigint }>>(
        conn,
        `SELECT COUNT(*) AS total ${from}${where.sql}`,
        [...joinValues, ...where.values],
      );
      const total = Array.isArray(countRows) ? Number(countRows[0]?.total ?? 0) : 0;

      /*
       * `s.units` sa vracia SUROVÉ, bez `COALESCE(…, 0)`: `NULL` znamená „za
       * dočítané dni sa nepredal", a rozdiel medzi tým a „dni nie sú stiahnuté"
       * rozhoduje `soldUnitsForWindow()`. Dosadená nula tu bola presne to, čo
       * D121 porušilo.
       */
      const dataSql =
        `SELECT ${COLUMNS.replace(/(^|, )/g, '$1c.')}, ` +
        's.units AS units_sold, ' +
        'CASE WHEN d.product_id IS NULL THEN 0 ELSE 1 END AS ever_discounted, ' +
        'COALESCE(d.now_on, 0) AS discounted_now ' +
        `${from}${where.sql} ORDER BY ${sort} LIMIT ? OFFSET ?`;

      const rows = await run<SearchRow[]>(conn, dataSql, [
        ...joinValues,
        ...where.values,
        perPage,
        (page - 1) * perPage,
      ]);

      return {
        data: (Array.isArray(rows) ? rows : []).map((row) => mapSearchRow(row, coverage)),
        page,
        perPage,
        total,
        soldWindowDays: window.windowDays,
        soldFrom: window.from,
        soldTo: window.to,
        soldCoverage: coverage,
        lockedFilters: [...LOCKED_FILTERS],
        enrichedOnly: [...ENRICHED_ONLY_FEATURES],
      };
    },

    /**
     * Čísla do bočného panela. Vedrá predajnosti a história zliav sa počítajú
     * BEZ vlastných facetových filtrov (inak by zaškrtnuté vedro vynulovalo
     * počty ostatných), ale S filtrami ceny, textu a stavu — presne tak, ako
     * to bočný panel v `design/v3/produkty.html` ukazuje.
     */
    async counts(filter: CatalogSearchFilter, conn?: Queryable): Promise<CatalogCounts> {
      const window = resolveWindow(filter);
      const coverage = await completeDaysFor(window, conn);
      const joinValues = [window.from, window.to, window.to, window.to];
      const from = `FROM catalog_cache c ${JOIN_SALES}${JOIN_OWN_DISCOUNTS}`;
      const where = buildWhere(filter, false, window.to, coverage);
      /*
       * Hranice dňa pre stav zľavy V SHOPE. Sú v SELECT-e, takže ich parametre
       * idú PRVÉ — pred parametrami JOIN-ov a `WHERE`. Poradie `?` je poradie
       * v SQL, nie poradie významu.
       */
      const selectValues = shopDiscountDayValues(window.to);

      /*
       * Vedrá idú z TÝCH ISTÝCH predikátov ako filter (`soldBucketSql`) — inak
       * by bočný panel sľuboval počet, ktorý zaškrtnutie filtra nedodrží. Piate
       * číslo `sold_unknown` je doplnok: vedrá plus ono dávajú `total` (D121).
       */
      const bucketSql = soldBucketSql(coverage);
      const sql =
        'SELECT COUNT(*) AS total, ' +
        `SUM(CASE WHEN ${bucketSql.none} THEN 1 ELSE 0 END) AS sold_none, ` +
        `SUM(CASE WHEN ${bucketSql.low} THEN 1 ELSE 0 END) AS sold_low, ` +
        `SUM(CASE WHEN ${bucketSql.mid} THEN 1 ELSE 0 END) AS sold_mid, ` +
        `SUM(CASE WHEN ${bucketSql.high} THEN 1 ELSE 0 END) AS sold_high, ` +
        `SUM(CASE WHEN ${soldUnknownSql(coverage)} THEN 1 ELSE 0 END) AS sold_unknown, ` +
        'SUM(CASE WHEN d.product_id IS NULL THEN 1 ELSE 0 END) AS never_discounted, ' +
        'SUM(CASE WHEN COALESCE(d.now_on, 0) = 1 THEN 1 ELSE 0 END) AS discounted_now, ' +
        // D116 — dve čísla o obohatení: koľko riadkov má zľavu PODĽA SHOPU a
        // koľko ich je vôbec obohatených. Prvé bez druhého je dolná hranica
        // vydávaná za počet (I11).
        `SUM(CASE WHEN ${SQL_SHOP_DISCOUNT_ACTIVE} THEN 1 ELSE 0 END) AS shop_discounted_now, ` +
        'SUM(CASE WHEN c.enriched_at IS NULL THEN 0 ELSE 1 END) AS enriched_rows ' +
        `${from}${where.sql}`;

      const rows = await run<Array<Record<string, number | bigint | null>>>(conn, sql, [
        ...selectValues,
        ...joinValues,
        ...where.values,
      ]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      const num = (key: string): number => Number(row?.[key] ?? 0);

      return {
        total: num('total'),
        sold: {
          none: num('sold_none'),
          low: num('sold_low'),
          mid: num('sold_mid'),
          high: num('sold_high'),
        },
        soldUnknown: num('sold_unknown'),
        neverDiscounted: num('never_discounted'),
        discountedNow: num('discounted_now'),
        shopDiscountedNow: num('shop_discounted_now'),
        enrichedRows: num('enriched_rows'),
        soldWindowDays: window.windowDays,
        soldFrom: window.from,
        soldTo: window.to,
        lockedFilters: [...LOCKED_FILTERS],
        enrichedOnly: [...ENRICHED_ONLY_FEATURES],
      };
    },

    /**
     * Rozdelenie cien pre histogram (V1). Dva dotazy PO SEBE, nie `Promise.all`
     * — rovnaký dôvod ako v `factsFor()`: dve súbežné spojenia z jedného
     * čítania nemajú čo zrýchliť a rozbíjajú poradie chýb.
     *
     * ČO SA TU SMIE TICHO POKAZIŤ
     *
     *  1. **Riadok bez ceny sa započíta ako nula.** `price` je `NULL`, kým sa
     *     produkt nestiahol. Nula by ho posadila do najlacnejšieho pásma a
     *     vyrobila neexistujúci vrchol pri nule — preto `WHERE price IS NOT
     *     NULL` a preto sa tie riadky vracajú ZVLÁŠŤ (`withoutPrice`), aby ich
     *     graf priznal a nezamlčal.
     *  2. **Rozmery pásiem sa dostanú do textu dotazu.** Idú výhradne ako `?`
     *     parametre, ako všetko ostatné v tomto súbore. Nezmysel (nula, zápor,
     *     necelé číslo) by v `FLOOR(price / ?)` znamenal delenie nulou, preto
     *     má šírka aj index zberného pásma dolný strop `1`.
     */
    async priceBuckets(
      binWidth: number,
      binCount: number,
      conn?: Queryable,
    ): Promise<CatalogPriceBuckets> {
      const width = Math.max(1, Math.trunc(binWidth));
      const lastBucket = Math.max(1, Math.trunc(binCount));

      const bucketRows = await run<Array<{ bucket: number | string | null; n: number | bigint }>>(
        conn,
        SQL_PRICE_BUCKETS,
        [width, lastBucket],
      );

      const buckets: Array<{ bucket: number; count: number }> = [];
      for (const row of Array.isArray(bucketRows) ? bucketRows : []) {
        const bucket = toCount(typeof row.bucket === 'bigint' ? Number(row.bucket) : row.bucket, -1);
        // Pásmo mimo rozsahu nevie vzniknúť (SQL ho zovrie), ale ak by prišlo,
        // je to poškodená odpoveď — nie tichý stĺpec na neexistujúcom mieste.
        if (bucket < 0 || bucket > lastBucket) continue;
        buckets.push({ bucket, count: toCount(Number(row.n), 0) });
      }

      const totalRows = await run<Array<Record<string, number | bigint | string | Date | null>>>(
        conn,
        SQL_PRICE_TOTALS,
        [],
      );
      const totals = (Array.isArray(totalRows) ? totalRows[0] : undefined) ?? {};

      /* Cena je DECIMAL — driver ju podáva ako string. `null` musí prežiť ako
         `null`: pod grafom je z nej POMLČKA, nikdy nula. */
      const money = (value: unknown): number | null => {
        if (value == null) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const stamp = (value: unknown): UtcDate | null =>
        value == null ? null : toDateOrNull(value as Date | string);

      return {
        buckets,
        rows: toCount(Number(totals.rows_total ?? 0), 0),
        withoutPrice: toCount(Number(totals.rows_without_price ?? 0), 0),
        minPrice: money(totals.min_price),
        maxPrice: money(totals.max_price),
        oldestFetchedAt: stamp(totals.oldest),
        newestFetchedAt: stamp(totals.newest),
      };
    },

    /**
     * Čísla z vlastných tabuliek pre zoznam ID. Dva dotazy PO SEBE, nie
     * `Promise.all`: rovnaký dôvod ako v `syncStatus()` — dve súbežné spojenia
     * z poolu (default 8) na požiadavku, ktorú vyvolá každé hľadanie, sú horší
     * obchod než jednotky milisekúnd navyše.
     */
    async factsFor(
      productIds: readonly number[],
      opts: { soldWindowDays?: number; today?: DateOnly; conn?: Queryable } = {},
    ): Promise<CatalogFactsResult> {
      const window = resolveWindow({
        ...(opts.soldWindowDays !== undefined ? { soldWindowDays: opts.soldWindowDays } : {}),
        ...(opts.today !== undefined ? { today: opts.today } : {}),
      });
      const coverage = await completeDaysFor(window, opts.conn);
      const empty: CatalogFactsResult = {
        facts: new Map<number, CatalogProductFacts>(),
        soldWindowDays: window.windowDays,
        soldFrom: window.from,
        soldTo: window.to,
        soldCoverage: coverage,
      };

      const unique = [...new Set(productIds.filter(isValidProductId))];
      if (unique.length === 0) return empty;

      const facts = empty.facts;
      /*
       * Default riadku je „bez predaja" PODĽA POKRYTIA, nie nula (D121): produkt
       * bez riadku v `product_sales_daily` sa v dočítanom okne naozaj nepredal,
       * ale v nedočítanom o ňom appka nevie NIČ. Riadok dostane každé platné ID,
       * aby volajúci nemusel dosadzovať default sám — presne tým `?? 0` v
       * `catalog/search` sa neznámy predaj menil na meranú nulu.
       */
      const touch = (productId: number): CatalogProductFacts => {
        const existing = facts.get(productId);
        if (existing !== undefined) return existing;
        const created: CatalogProductFacts = {
          unitsSold: soldUnitsForWindow(0, coverage),
          everDiscounted: false,
          discountedNow: false,
        };
        facts.set(productId, created);
        return created;
      };
      for (const productId of unique) touch(productId);

      // Dávkovanie z rovnakého dôvodu ako v `getMany()`: `IN (…)` s tisíckami
      // `?` narazí na limit parametrov. Volajúci sem posiela desiatky ID, nie
      // tisíce — dávka je poistka, nie očakávaný stav.
      for (let start = 0; start < unique.length; start += UPSERT_CHUNK_ROWS) {
        const chunk = unique.slice(start, start + UPSERT_CHUNK_ROWS);
        const placeholders = `(${chunk.map(() => '?').join(', ')})`;

        const salesRows = await run<Array<{ product_id: number; units: number | string | null }>>(
          opts.conn,
          SQL_FACTS_SALES_PREFIX + placeholders + SQL_FACTS_SALES_SUFFIX,
          [window.from, window.to, ...chunk],
        );
        for (const row of Array.isArray(salesRows) ? salesRows : []) {
          touch(Number(row.product_id)).unitsSold = soldUnitsForWindow(row.units, coverage);
        }

        const discountRows = await run<
          Array<{ product_id: number; now_on: number | string | null }>
        >(
          opts.conn,
          SQL_FACTS_DISCOUNTS_PREFIX + placeholders + SQL_FACTS_DISCOUNTS_SUFFIX,
          [window.to, window.to, ...chunk],
        );
        for (const row of Array.isArray(discountRows) ? discountRows : []) {
          const entry = touch(Number(row.product_id));
          // Riadok v `campaign_items` so stavom `ok` JE ten úspešný zápis —
          // preto `everDiscounted` bez ohľadu na to, či okno práve beží.
          entry.everDiscounted = true;
          entry.discountedNow = Number(row.now_on ?? 0) === 1;
        }
      }

      return { ...empty, facts };
    },

    /**
     * Detaily pre konkrétne ID. Žiadne vlastné SQL — `getMany()` už číta
     * presne tie stĺpce, ktoré treba (`source`, `fetched_at`, `raw`), a druhý
     * dotaz nad tou istou tabuľkou by bol druhý zdroj pravdy o tom istom.
     *
     * Neplatné ID (nula, zápor, necelé číslo) sa ZAHODÍ a v mape nebude —
     * rovnako ako v `getMany()`. Platné ID, ktoré zrkadlo nemá, naopak V MAPE
     * JE, len s `missing: true`.
     */
    async detailsFor(
      productIds: readonly number[],
      conn?: Queryable,
    ): Promise<Map<number, CatalogDetailRow>> {
      const unique = [...new Set(productIds.filter(isValidProductId))];
      const out = new Map<number, CatalogDetailRow>();
      if (unique.length === 0) return out;

      const records = await repo.getMany([...unique], conn);
      for (const productId of unique) {
        const record = records.get(productId);
        out.set(
          productId,
          record === undefined ? emptyCatalogDetail(productId) : catalogDetailFromRecord(record),
        );
      }
      return out;
    },

    async totalRows(conn?: Queryable): Promise<number> {
      const rows = await run<Array<{ total: number | bigint }>>(conn, SQL_TOTAL_ROWS, []);
      return Array.isArray(rows) ? Number(rows[0]?.total ?? 0) : 0;
    },

    async lastFetchedAt(conn?: Queryable): Promise<UtcDate | null> {
      const rows = await run<Array<{ last_fetched: Date | string | null }>>(
        conn,
        SQL_LAST_FETCHED,
        [],
      );
      const value = Array.isArray(rows) ? rows[0]?.last_fetched : null;
      return value == null ? null : toDate(value);
    },

    /* ── A2/A4: dvojdňový beh ──────────────────────────────────────────── */

    async loadSyncProgress(conn?: Queryable): Promise<CatalogSyncProgress> {
      const rows = await run<ProgressRow[]>(conn, SQL_PROGRESS_GET, []);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      // Chýbajúci riadok nie je chyba: migrácia ho síce zakladá, ale „ešte sa
      // nezačalo" je platný stav a beh z neho vie vyjsť (začne od stránky 1).
      return row === undefined ? emptyCatalogProgress() : mapProgressRow(row);
    },

    async saveSyncProgress(progress: CatalogSyncProgress, conn?: Queryable): Promise<void> {
      await run(conn, SQL_PROGRESS_SAVE, [
        Math.max(1, Math.trunc(progress.perPage)),
        Math.max(0, Math.trunc(progress.lastPage)),
        progress.shopTotal === null ? null : Math.max(0, Math.trunc(progress.shopTotal)),
        Math.max(0, Math.trunc(progress.rowsWritten)),
        progress.completed ? 1 : 0,
        progress.startedAt,
        progress.lastReadAt,
        progress.finishedAt,
        progress.pausedUntil,
        progress.pauseReason,
        // I1 — do `last_error` ide KÓD, nikdy obsah odpovede shopu; orez je
        // poistka proti stĺpcu `VARCHAR(200)`, nie filter obsahu.
        progress.lastError === null ? null : progress.lastError.slice(0, 200),
      ]);
    },

    reserveShopReads(count = 1): Promise<ReadReservation> {
      return readBudget.reserve(count);
    },

    shopReadBudget(): Promise<ReadBudgetStatus> {
      return readBudget.status();
    },

    /**
     * A5 — jeden dotaz do sveta pre celé UI: koľko z koľkých, kedy naposledy,
     * kedy ďalšia dávka, prečo sa čaká a dokedy to potrvá.
     *
     * Odhad je zámerne hrubý (presnosť na deň): denný strop čítaní je tvrdý,
     * takže o dokončení rozhodujú DNI, nie minúty. Presnejší odhad by bol
     * presnejšie vyzerajúce klamstvo.
     *
     * DOTAZY IDÚ PO JEDNOM, NIE V `Promise.all`. Endpoint `GET /api/status` sa
     * volá z každej obrazovky pri každom obnovení a tri súbežné dotazy si berú
     * tri spojenia z poolu (`DB_CONNECTION_LIMIT`, default 8) namiesto jedného.
     * Dve otvorené karty a pool je na hrane presne vtedy, keď má appka povedať,
     * čo sa deje. Séria je tu o jednotky milisekúnd pomalšia a o tri spojenia
     * lacnejšia.
     */
    async syncStatus(opts: { now?: UtcDate; conn?: Queryable } = {}): Promise<CatalogSyncStatus> {
      const now = opts.now ?? new Date();
      const conn = opts.conn;

      const loadedProducts = await repo.totalRows(conn);
      const lastFetchedAt = await repo.lastFetchedAt(conn);
      const progress = await repo.loadSyncProgress(conn);
      const reads = await readBudget.status();

      const perPage = Math.max(1, progress.perPage);
      const shopTotalProducts = progress.shopTotal;
      const pagesTotal =
        shopTotalProducts === null ? null : Math.max(1, Math.ceil(shopTotalProducts / perPage));

      /**
       * OBNOVA NIE JE CHÝBAJÚCI KATALÓG.
       *
       * `pagesDone` je pokrok AKTUÁLNEHO prechodu, `loadedProducts` je `COUNT(*)`
       * za celý katalóg. Po dokončenom prechode začína obnova od stránky 0, takže
       * holý rozdiel `pagesTotal - pagesDone` tvrdil, že appke chýba celý katalóg,
       * ktorý má na disku — a karta vedľa seba ukázala „0 chýba" aj „411 stránok
       * ostáva, ešte 2 dni". Keď máme aspoň toľko riadkov, koľko shop hlási,
       * nechýba ani stránka; prechod len osviežuje ceny.
       */
      const refreshing =
        !progress.completed &&
        shopTotalProducts !== null &&
        shopTotalProducts > 0 &&
        loadedProducts >= shopTotalProducts;

      const pagesDone = progress.completed ? (pagesTotal ?? progress.lastPage) : progress.lastPage;
      const pagesLeft =
        pagesTotal === null ? null : refreshing ? 0 : Math.max(0, pagesTotal - pagesDone);

      const paused =
        progress.pausedUntil !== null && progress.pausedUntil.getTime() > now.getTime();

      /**
       * NEZNÁME POČÍTADLO NIE JE MINUTÝ ROZPOČET (A4, I11).
       *
       * `reads.exhausted` je pri `known: false` fail-closed domnienka: nečítať je
       * správne, ale hlásiť „dnešný rozpočet je vyčerpaný" znamená tvrdiť číslo,
       * ktoré appka nepozná — počítadlo môže stáť na 12 z 240. Dôvod čakania sa
       * preto uvádza len z prečítaného stavu; neprečítané počítadlo má vlastnú
       * prekážku (`catalog_reads_day_exhausted` s `assumed: true`), ktorá to
       * povie ako domnienku.
       */
      const budgetSpent = reads.known && reads.exhausted;

      const waiting: CatalogWaitingReason | null = progress.completed
        ? 'catalog_complete'
        : paused
          ? (progress.pauseReason ?? 'rate_limited')
          : budgetSpent
            ? 'daily_budget'
            : null;

      const nextBatchAt: UtcDate | null = progress.completed
        ? null
        : paused
          ? progress.pausedUntil
          : budgetSpent
            ? reads.resetAt
            : null;

      /**
       * Koľko ďalších UTC dní to potrvá. `0` = dočíta sa ešte dnes, `null` =
       * nevieme, z koľkých stránok (shop zatiaľ nepovedal `total`) — a vtedy sa
       * odhad NEVYMÝŠĽA (I11). Rovnako sa nevymýšľa z neprečítaného počítadla:
       * fail-closed `remaining: 0` by aj pri jednej chýbajúcej stránke tvrdilo
       * „ešte deň".
       */
      let estimatedDaysLeft: number | null = null;
      if (progress.completed || refreshing) estimatedDaysLeft = 0;
      else if (pagesLeft !== null && reads.known) {
        estimatedDaysLeft = readDaysNeeded(pagesLeft, reads.remaining, reads.limit);
      }

      // Odhad dokončenia s presnosťou na deň: `0` je koniec dnešného UTC dňa
      // (`reads.resetAt` je najbližšia polnoc UTC), každý ďalší deň o 24 h viac.
      // Pri dočítanom katalógu to nie je odhad, ale meraný čas dokončenia.
      // Pri obnove nie je čo dokončovať — katalóg už je celý, preto `null`;
      // vetu o obnove nesie `refreshing`, nie vymyslený dátum.
      let estimatedFinishAt: UtcDate | null = progress.finishedAt;
      if (refreshing) {
        estimatedFinishAt = null;
      } else if (!progress.completed) {
        estimatedFinishAt =
          estimatedDaysLeft === null
            ? null
            : new Date(reads.resetAt.getTime() + Math.max(0, estimatedDaysLeft - 1) * 86_400_000);
      }

      return {
        loadedProducts,
        shopTotalProducts,
        percent:
          shopTotalProducts === null || shopTotalProducts <= 0
            ? null
            : Math.min(100, Math.round((loadedProducts / shopTotalProducts) * 100)),
        complete: progress.completed,
        refreshing,
        lastFetchedAt,
        lastReadAt: progress.lastReadAt,
        pagesDone,
        pagesTotal,
        pagesLeft,
        perPage,
        reads,
        waiting,
        nextBatchAt,
        estimatedDaysLeft,
        estimatedFinishAt,
        lastError: progress.lastError,
        progress,
      };
    },

    /* ── D116–D119: obohatenie z `getFull` a fronta obohacovania ───────── */

    async saveEnrichment(
      productId: number,
      data: CatalogEnrichWrite,
      conn?: Queryable,
    ): Promise<boolean> {
      if (!isValidProductId(productId)) return false;
      const enrichedAt = data.enrichedAt ?? new Date();
      /*
       * `enrich_attempted_at` sa nastavuje NA TEN ISTÝ čas ako `enriched_at`:
       * úspešné obohatenie je tiež pokus a bez toho by riadok tvrdil, že sa
       * o produkt nikdy nikto nepokúsil.
       *
       * `categories` ide do JSON stĺpca ako `JSON.stringify`; `null` zostáva
       * `null`, ale PRÁZDNE POLE prežije ako `[]`. Sú to dve rôzne vety:
       * „nevieme, do akých kategórií patrí" a „shop hovorí, že do žiadnej".
       */
      const result = await run<{ affectedRows?: number | bigint }>(conn, SQL_ENRICH_SAVE, [
        data.reference === null ? null : data.reference.slice(0, 64),
        data.ean13 === null ? null : data.ean13.slice(0, 20),
        data.purchasePrice,
        data.margin,
        data.marginPercent,
        data.sellPriceWithVat,
        shopStampParam(data.lastTimeInOrder),
        data.qty,
        data.qtyInOrders,
        data.supplier === null ? null : data.supplier.slice(0, 191),
        data.reductionPercent,
        shopStampParam(data.reductionFrom),
        shopStampParam(data.reductionTo),
        data.active === null ? null : data.active ? 1 : 0,
        data.categories === null ? null : JSON.stringify([...data.categories]),
        enrichedAt,
        enrichedAt,
        productId,
      ]);
      return Number(result?.affectedRows ?? 0) > 0;
    },

    async enrichmentFor(
      productIds: readonly number[],
      conn?: Queryable,
    ): Promise<Map<number, CatalogEnrichmentRecord>> {
      const out = new Map<number, CatalogEnrichmentRecord>();
      const unique = [...new Set(productIds.filter(isValidProductId))];
      if (unique.length === 0) return out;

      // Dávkovanie z rovnakého dôvodu ako v `getMany()`: `IN (…)` s tisíckami
      // `?` narazí na limit parametrov skôr než na limit trpezlivosti.
      for (let start = 0; start < unique.length; start += UPSERT_CHUNK_ROWS) {
        const chunk = unique.slice(start, start + UPSERT_CHUNK_ROWS);
        const placeholders = `(${chunk.map(() => '?').join(', ')})`;
        const rows = await run<EnrichRow[]>(conn, SQL_ENRICH_GET_MANY_PREFIX + placeholders, chunk);
        for (const row of Array.isArray(rows) ? rows : []) {
          const record = mapEnrichRow(row);
          out.set(record.productId, record);
        }
      }

      // Produkt, ktorý zrkadlo nemá, je v mape s prázdnym obohatením — nie
      // chýbajúci kľúč (viď docblok v rozhraní).
      for (const productId of unique) {
        if (!out.has(productId)) out.set(productId, emptyCatalogEnrichment(productId));
      }
      return out;
    },

    /**
     * KPI podklad pre stránku produktov. Jeden dotaz na dávku ID — nie dotaz
     * na produkt: sto riadkov v tabuľke znamená sto KPI, nie sto čítaní z DB.
     *
     * Neplatné ID (nula, zápor, necelé číslo) sa ZAHODÍ a v mape nebude; platné
     * ID, ktoré zrkadlo nemá, naopak V MAPE JE, len s `missing: true`. Rovnaká
     * dohoda ako v `detailsFor()` — prázdno nesmie byť chýbajúci kľúč.
     */
    async kpiRowsFor(
      productIds: readonly number[],
      conn?: Queryable,
    ): Promise<Map<number, CatalogKpiRow>> {
      const out = new Map<number, CatalogKpiRow>();
      const unique = [...new Set(productIds.filter(isValidProductId))];
      if (unique.length === 0) return out;

      for (let start = 0; start < unique.length; start += UPSERT_CHUNK_ROWS) {
        const chunk = unique.slice(start, start + UPSERT_CHUNK_ROWS);
        const placeholders = `(${chunk.map(() => '?').join(', ')})`;
        const rows = await run<Array<EnrichRow & { name: string | null; price: string | null }>>(
          conn,
          SQL_KPI_ROWS_PREFIX + placeholders,
          chunk,
        );
        for (const row of Array.isArray(rows) ? rows : []) {
          const enrichment = mapEnrichRow(row);
          out.set(enrichment.productId, {
            productId: enrichment.productId,
            missing: false,
            name: textOrNull(row.name),
            price: toMoney(row.price),
            enrichment,
          });
        }
      }

      for (const productId of unique) {
        if (!out.has(productId)) {
          out.set(productId, {
            productId,
            missing: true,
            name: null,
            price: null,
            enrichment: emptyCatalogEnrichment(productId),
          });
        }
      }
      return out;
    },

    async markEnrichAttempt(productId: number, at?: UtcDate, conn?: Queryable): Promise<void> {
      if (!isValidProductId(productId)) return;
      await run(conn, SQL_ENRICH_ATTEMPT, [at ?? new Date(), productId]);
    },

    async nextToEnrich(limit: number, conn?: Queryable): Promise<number[]> {
      const take = Math.min(MAX_ENRICH_BATCH, Math.max(0, Math.trunc(Number(limit) || 0)));
      if (take === 0) return [];
      const rows = await run<Array<{ product_id: number | string }>>(conn, SQL_ENRICH_NEXT, [take]);
      return (Array.isArray(rows) ? rows : []).map((row) => Number(row.product_id));
    },

    /**
     * Tri `UPDATE`-y v tomto poradí a nie v inom: allowlist si berie prioritu 1
     * PRVÝ, aby ho kampaňový krok nemohol zhoršiť na 2, a demote ide POSLEDNÝ,
     * aby nezhodil to, čo práve pribudlo.
     *
     * Ide to po sebe, nie v `Promise.all` — tri súbežné `UPDATE`-y nad tou istou
     * tabuľkou si nič nezrýchlia a vyrobili by deadlock na tých istých riadkoch.
     */
    async refreshEnrichPriority(
      opts: { today?: DateOnly; conn?: Queryable } = {},
    ): Promise<EnrichPriorityRefresh> {
      // Deň v zóne logiky (D31) — nikdy v UTC, inak by sa medzi 22:00 a 24:00
      // UTC porovnávalo voči zajtrajšku a kampaň končiaca dnes by prednosť
      // stratila o dve hodiny skôr.
      const today =
        typeof opts.today === 'string' && DATE_ONLY_RE.test(opts.today)
          ? opts.today
          : todayInZone(new Date());
      const affected = (result: { affectedRows?: number | bigint } | undefined): number =>
        Number(result?.affectedRows ?? 0);

      const allowlist = affected(
        await run<{ affectedRows?: number | bigint }>(
          opts.conn,
          SQL_ENRICH_PRIORITY_ALLOWLIST,
          [],
        ),
      );
      const campaigns = affected(
        await run<{ affectedRows?: number | bigint }>(opts.conn, SQL_ENRICH_PRIORITY_CAMPAIGNS, [
          ...ENRICH_CAMPAIGN_STATUSES,
          today,
        ]),
      );
      const demoted = affected(
        await run<{ affectedRows?: number | bigint }>(opts.conn, SQL_ENRICH_PRIORITY_DEMOTE, [
          ...ENRICH_CAMPAIGN_STATUSES,
          today,
        ]),
      );

      return { allowlist, campaigns, demoted };
    },

    async loadEnrichState(conn?: Queryable): Promise<CatalogEnrichState> {
      const rows = await run<EnrichStateRow[]>(conn, SQL_ENRICH_STATE_GET, []);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      // Chýbajúci riadok nie je chyba: migrácia ho síce zakladá, ale „ešte sa
      // nezačalo" je platný stav a dávka z neho vie vyjsť.
      return row === undefined ? emptyCatalogEnrichState() : mapEnrichStateRow(row);
    },

    async saveEnrichState(state: CatalogEnrichState, conn?: Queryable): Promise<void> {
      await run(conn, SQL_ENRICH_STATE_SAVE, [
        state.batchDay !== null && DATE_ONLY_RE.test(state.batchDay) ? state.batchDay : null,
        Math.max(0, Math.trunc(state.enrichedToday)),
        Math.max(0, Math.trunc(state.dailyTarget)),
        state.lastProductId === null || !isValidProductId(state.lastProductId)
          ? null
          : state.lastProductId,
        Math.max(0, Math.trunc(state.enrichedTotal)),
        state.startedAt,
        state.lastReadAt,
        state.pausedUntil,
        state.pauseReason,
        // I1 — do `last_error` ide KÓD, nikdy obsah odpovede shopu; orez je
        // poistka proti stĺpcu `VARCHAR(200)`, nie filter obsahu.
        state.lastError === null ? null : state.lastError.slice(0, 200),
      ]);
    },
  };

  return repo;
}

/** Singleton pre route-y a engine preview. */
export const catalogRepo: CatalogRepoExt = createCatalogRepo();
