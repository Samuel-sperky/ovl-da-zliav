# Čo všetko vieme ťahať zo shop API (stav k 13. 8. 2026)

Zdroj: `docs/api/sperky-api-v5.md`. Toto nie je želanie ani plán — je to zoznam
toho, čo API **naozaj vracia**, čo si to vyžaduje a čo z toho appka dnes používa.

---

## Rýchla orientácia

| Máme dnes, bez kľúča | Máme s kľúčom, ktorý vlastníme | Čaká na `product:read` |
|---|---|---|
| zoznam produktov (id, názov, cena) | zápis a zrušenie zľavy | **kód produktu** (`reference`, `ean13`) |
| detail produktu vrátane variantov | súčty predaja z objednávok | **nákupná cena a marža** |
| **fuzzy hľadanie cez celý katalóg** | introspekcia kľúča a rozpočtu | **skladová zásoba** |
| | | **skutočný stav zľavy na produkte** |
| | | **kategórie** a presné filtre |

Appka má dva kľúče: **`product:edit`** (zápis zliav) a **`orders:read`**
(objednávky). **`product:read` nemá** — a je to jediná vec, ktorá blokuje celý
pravý stĺpec.

---

## 1. Produkty — verejné, bez kľúča

### `GET /api/products` — zoznam

Parametre: `page`, `per_page` (max **100**), `id_lang`

| Pole | Čo to je |
|---|---|
| `id` | číslo produktu |
| `name` | názov |
| `price` | cena bez DPH |
| `has_attributes` | či má varianty |

**To je všetko.** Žiadny kód, žiadny sklad, žiadna kategória, žiadna zľava.
Toto je zdroj, z ktorého sa plní zrkadlo katalógu — preto v ňom nič viac nie je.

41 082 produktov po 100 = **411 stránok**.

### `GET /api/products/get?id=` — detail

Všetko zo zoznamu, plus `description`, `description_short` a `attributes[]`.

Každý variant nesie: `id_product_attribute`, `price_impact`, **`reference`**,
**`ean13`**, **`quantity`**, `is_default`, `values[]`.

> **Pozor na pascu:** kód a sklad tu SÚ, ale **iba pre varianty**. Produkt bez
> variantov (`has_attributes: false`) má `attributes: []`, takže o ňom týmto
> endpointom nezistíme ani kód, ani zásobu.

### `GET /api/products/searchIndex` — fuzzy hľadanie

Parametre: `search`, `minPrice`, `maxPrice`, `page`, `per_page` (max 100)

Hľadá cez Meilisearch **v názve, popise, kóde aj kategóriách**. Znesie preklepy
a iné poradie slov. Vracia **iba ID** — detaily treba dotiahnuť zvlášť.
Poradie určuje relevancia; **vlastné triedenie sa nastaviť nedá**.

> **Najužitočnejšia vec, ktorú máme zadarmo.** Zrkadlo má 2 900 zo 41 082
> produktov, ale hľadať vieme vo všetkých — vrátane hľadania podľa kódu.
> Appka to používa ako tlačidlo „Dohľadať v eshope".

---

## 2. Produkty — vyžadujú `product:read` (NEMÁME)

### `GET /api/products/getFull?id=` — detail so všetkým

Všetko z `get`, plus:

| Pole | Čo to odomkne v appke |
|---|---|
| **`reference`**, **`ean13`** | kód produktu aj pre nevariantné |
| **`purchase_price`** | nákupná cena |
| **`margin`**, **`margin_percent`** | marža a jej percento |
| `sell_price`, `sell_price_with_vat` | predajná cena bez a s DPH |
| **`qty`** | skladová zásoba (aj bez variantov) |
| `qty_in_orders` | koľko kusov sa celkovo objednalo |
| `last_time_in_order` | dátum poslednej objednávky s produktom |
| **`reduction_percent`**, **`reduction_from`**, **`reduction_to`** | **SKUTOČNÁ zľava** — alebo všetky tri `null` |
| **`categories`** | pole id kategórií |
| `active`, `date_add`, `supplier` | či je aktívny, kedy pribudol, dodávateľ |

> `reduction_*` je najdôležitejšia trojica v celom API. Bez nej appka vie len
> to, **čo sama zapísala** — keď niekto zmení zľavu v admine, nikdy sa to
> nedozvie. Preto je dnes všade výhrada „podľa vlastných zápisov".

**Je to volanie NA PRODUKT.** Pre celý katalóg by to bolo 41 082 volaní, teda
pri dnešnom strope týždne. Preto sa doťahuje len pre vybrané produkty.

### `GET /api/products/search` — presné filtre

| Parameter | Čo filtruje |
|---|---|
| `search` | text v názve a **kóde** |
| `minPrice`, `maxPrice` | cena |
| `categories[]` | kategórie |
| `manufacturers[]` | výrobcovia |
| `suppliers[]` | dodávatelia |
| `filters[groupId][]` | príznakové filtre z admina |
| `onlyDiscounted` | len produkty v zľave |
| `sortBy` | `id`, `name`, `price`, `date_add` |
| `sortDir` | `asc`, `desc` |

Vracia **iba ID**, stránkovane. Oproti `searchIndex` sa dá triediť a filtrovať
presne, ale neznesie preklepy.

### `GET /api/categories` — strom kategórií

Vracia `id`, `name`, `id_parent`, `level_depth`. Tie `id` sú presne tie, ktoré
vracia `getFull` v poli `categories`.

---

## 3. Zápisy — `product:edit` (MÁME)

### `POST /api/products/setReduction`

Telo (form-encoded): `id`, `from`, `to`, `reduction` (0–30)

- Okno je zastropované na **3 mesiace**.
- **Nie je dávkovateľné** — jeden produkt = jeden request.
- `409 blocked_by_flash_sale`, keď na produkte beží TurboSaleUltimate; tá
  mechanika vlastní polia zľavy, kým trvá.
- Ďalšie chyby: `invalid_dates`, `invalid_reduction`, `range_too_long`,
  `not found` (404).

### `POST /api/products/clearReduction`

Telo: `id`. Zruší bežiacu zľavu. Rovnaké obmedzenie s flash sale.

> Pribudlo v v5. Dovtedy sa zľava nedala zrušiť, len nechať vypršať — preto mala
> appka invariant „nikdy neruší zľavu".

---

## 4. Objednávky — `orders:read` (MÁME)

### `GET /api/order` — zoznam

Parametre: `page`, `per_page` (max 100), `date_from`, `date_to`, `country`,
`total_min`, `total_max`

Vracia: `id`, `date_add`, `total_paid`, `currency`.

### `GET /api/order/get?id=` — detail

Navyše `products[]` s `id` a `qty`, plus `country` a `country_iso`.

> **Appka z toho berie výhradne id objednávky, deň a kusy po produkte.**
> `total_paid`, `country` ani `currency` sa nikam neukladajú — invariant I8
> s čiarkou. Je na to test, ktorý skenuje zdrojový kód.

---

## 5. Kľúč — akýkoľvek platný

### `GET /api/whoami`

| Pole | Čo to je |
|---|---|
| `id`, `name`, `owner` | identita kľúča |
| `expires_at` | dokedy platí (`null` = bez expirácie) |
| **`scopes[]`** | čo kľúč smie |
| **`remaining`** | `{per_minute, per_day}` — **živý zostatok rozpočtu** |

`per_day` môže byť `null`, keď kľúč nemá dennú kvótu.

> Appka odtiaľto číta skutočný rozpočet. Nahradilo to sondu, ktorá platnosť
> kľúča overovala volaním na zápisový endpoint.

---

## 6. Dávka

### `POST /api/batch` — max 25 požiadaviek naraz

**Opted-in sú iba `GET /api/products/get` a `GET /api/order/get`.** Zápisy
dávkovať nejde.

Dve veci, ktoré sa oplatí vedieť:

- **Dávka NEŠETRÍ rozpočet** — 25 položiek minie 25 zásahov plus jeden za dávku.
- Položky bežia za sebou, takže čas je súčet. Dávkuje sa kvôli réžii, nie
  kvôli rýchlosti.

---

## 7. Limity

`whoami` vracia živý zostatok. Dokumentácia v5 **už neuvádza konkrétne čísla**;
posledné známe z v4 boli:

| | za minútu | za UTC deň |
|---|---|---|
| s kľúčom | 20 | 200 |
| bez kľúča (na IP) | 30 | 300 |

Appka si z toho berie 80 % ako rezervu a živé číslo zo `whoami` má prednosť.

---

## 8. Čo appka dnes reálne ukladá

Zrkadlo katalógu (`catalog_cache`) má osem stĺpcov:

```
product_id · name · price · has_attributes · shop_status · source · fetched_at · raw
```

Teda presne to, čo dáva verejný zoznamový endpoint. **Kód produktu, sklad,
marža ani kategórie tam nie sú** — a ani byť nemôžu, kým nie je `product:read`.

Predajnosť sa počíta zvlášť z objednávok do `product_sales_daily`: id produktu,
deň, počet kusov. Nič iné.

---

## 9. Čo API nedáva vôbec

- **Obrázky produktov.**
- **Zoznam výrobcov a dodávateľov** — v `search` sa dajú filtrovať podľa id, ale
  zistiť, aké id existujú, sa nedá.
- **História zliav** — koľkokrát a kedy bol produkt zlacnený. Vieme len aktuálny
  stav (`reduction_*`) a to, čo sme sami zapísali.
- **Predajnosť po produkte v čase** — `getFull` dá len celkové `qty_in_orders`
  a `last_time_in_order`. Rozpad po dňoch si appka počíta sama z objednávok.
- **Príznak flash sale dopredu** — že produkt je v TurboSaleUltimate, sa
  dozvieme až z chyby `409` pri pokuse o zápis.
