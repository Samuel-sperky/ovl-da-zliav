# Kontrakt — priehľadnosť produktov (13. 8. 2026)

Nadväzuje na `KONTRAKT-UI-2026-08-13.md`. Zadanie používateľa:

> „Potrebujem priehľadnosť lepšiu tých produktov aké máme na eshope /
> ktoré sú zapnuté v zľave. Zároveň tam potrebujem mať search a všetky
> údaje vypísané + filtre."

---

## Najprv to, čo sa NEDÁ, a prečo

**„Ktoré sú zapnuté v zľave" dnes appka nevie.** Vie len to, **čo sama
zapísala** (`campaign_items.status = 'ok'`). Keď niekto zapne alebo zmení
zľavu v admine eshopu, appka o tom nemá ako vedieť.

Skutočný stav je `reduction_percent` / `reduction_from` / `reduction_to`
z `GET /api/products/getFull`, a hromadný filter „len zľavnené" je
`onlyDiscounted` v `GET /api/products/search`. **Oboje vyžaduje scope
`product:read`, ktorý appka nemá.**

Preto tento kontrakt rozdeľuje prácu na dve časti, ktoré sa nesmú zliať:

| | |
|---|---|
| **A. Dá sa dnes** | hľadanie, všetky údaje, ktoré máme, filtre nad nimi, poctivé označenie istoty |
| **B. Čaká na kľúč** | skutočná zľava, kód, sklad, marža, kategórie, filter „len zľavnené" |

Časť B sa **naprogramuje a otestuje proti mocku**, ale zostane viditeľne
zamknutá, kým kľúč nepríde. Nesmie sa predstierať, že dáta máme.

---

## A. Čo sa dá dnes

### A1. Hľadanie — hotové, treba dotiahnuť UI

`GET /api/catalog/search` už vie hľadať v zrkadle aj dohľadať v eshope
(`?lookup=1`, verejný `searchIndex` + `get`). Tlačidlo „Dohľadať v eshope"
a veta o výsledku sú zapojené. Ostáva:

- hľadanie **podľa čísla produktu** nech je zjavné, nie len podľa názvu,
- pri neúplnom zrkadle nech je počet zhôd označený `≈` (P7) — je to dolná
  hranica, nie fakt,
- dohľadanie nech sa dá spustiť aj vtedy, keď zrkadlo NIEČO našlo (dnes je
  ponuka len pri prázdnom výsledku).

### A2. Všetky údaje, ktoré máme

Zrkadlo drží: `product_id`, `name`, `price`, `has_attributes`, `shop_status`,
`source`, `fetched_at`. Predajnosť je zvlášť v `product_sales_daily`.

**Tabuľka** (ostáva skenovateľná, P4 — skroluje len ona):
`Názov · Predané za okno · Cena · Zľava teraz`

**Detail produktu** (bočný panel) nech vypíše VŠETKO, čo appka o produkte vie:

| Údaj | Zdroj | Poznámka |
|---|---|---|
| názov, cena | zrkadlo | „Dáta k …" = `fetched_at` tohto riadku |
| má varianty | zrkadlo | |
| stav v eshope | zrkadlo | `ok` / `not_found` (D49) |
| predané kusy | vlastný výpočet z objednávok | okno je voliteľné |
| zľava teraz | **vlastné zápisy** | vždy s výhradou, nikdy ako stav eshopu |
| kedy naposledy zlacnené | vlastné zápisy | percento a okno |
| odkiaľ je riadok | `origin` | zrkadlo / dohľadané v eshope |

### A3. Filtre nad tým, čo máme

Fungujú dnes: predajnosť (0 / 1–2 / 3–9 / 10+), cena od–do, „práve v zľave"
a „nikdy nezlacnené" — obe **podľa vlastných zápisov**.

Dotiahnuť: filter podľa toho, či je produkt v zrkadle alebo dohľadaný, a
podľa stavu v eshope (`not_found`).

---

## B. Čo čaká na `product:read`

Naprogramovať, otestovať proti mocku, nechať **viditeľné a vypnuté so zámkom**
(kontrakt UI, bod 18). Vysvetlenie zostáva na jednom mieste — `LockedFeatures.tsx`
sa NEROZŠIRUJE.

| Funkcia | Endpoint | Čo dá |
|---|---|---|
| **Skutočná zľava** | `getFull` → `reduction_*` | či na produkte NAOZAJ beží zľava a aká |
| **Rozdiel oproti nášmu záznamu** | porovnanie | „appka si myslí 10 %, v eshope je 15 %" |
| Kód produktu | `getFull` → `reference`, `ean13` | aj pre nevariantné |
| Sklad | `getFull` → `qty` | aj pre nevariantné |
| Marža | `getFull` → `purchase_price`, `margin` | odomkne odhad dopadu |
| Kategórie | `getFull` → `categories` + `/api/categories` | filter podľa kategórie |
| Filter „len zľavnené" | `search` → `onlyDiscounted` | hromadne, nie po produkte |

**`getFull` je volanie NA PRODUKT.** Pre 41 082 produktov je to týždne. Preto:
doťahovať len pre **vybrané** a pre produkty **otvorené v detaile**, nikdy
plošne. Kontrakt UI, bod 20.

---

## Akceptačné kritériá

1. Produkt, ktorý NIE JE v zrkadle, sa dá nájsť podľa názvu aj podľa čísla.
2. Pri každom riadku je vidieť, či je zo zrkadla, alebo dohľadaný v eshope.
3. Detail produktu vypíše všetko, čo appka o ňom vie, aj s časom merania.
4. „Zľava teraz" je VŽDY označená ako vlastný záznam, nikdy ako stav eshopu —
   kým nepríde `product:read`.
5. Zamknuté údaje a filtre sú vidieť a vypnuté so zámkom; vysvetlenie je na
   jednom mieste.
6. Počet zhôd je pri neúplnom zrkadle označený `≈`.
7. Tabuľka ostáva skenovateľná; skroluje len ona (P4).
8. Typecheck, lint, celý balík, e2e a build zelené.

---

## Poznámka k orchestrácii

Táto práca sa **nedala spustiť 13. 8. doobeda** — limit session bol vyčerpaný
a resetuje sa o 16:30. Predchádzajúci pokus o sedem agentov zhorel bez výsledku
(600 k tokenov, nula dodaných súborov), preto sa druhý pokus pred resetom
nespúšťal.

Rozdelenie pre agentov, keď bude limit späť:

| Agent | Vlastní |
|---|---|
| **P1 — hľadanie a tabuľka** | `CatalogPanel.tsx`, `CatalogTable.tsx`, `catalog-api.ts` |
| **P2 — detail produktu** | `ProductDetailPanel.tsx` |
| **P3 — filtre** | `CatalogFilters.tsx`, `catalog-filter.ts` |
| **P4 — `getFull` a porovnanie so skutočnosťou** | `src/lib/catalog/`, route `/api/catalog/search` |

P4 je jediný, ktorý sa nedá overiť naostro — chýba mu kľúč.
