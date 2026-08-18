# OVL-DA-ZLIAV — Rozhodnutia (smerovacie odpovede)

**Dátum:** 2026-08-18
**Branch:** `claude/beautiful-mayer-5fd41j`
**Stav:** smerovacie otázky zodpovedané → beží generovanie 100-otázkového dotazníka (plný proces)

## Zvolený stack (mení doc #3)

- **Laravel (PHP 8.4)**, UI vrstva Blade/Livewire (návrh v dotazníku)
- **DB SQLite** (predbežne; MariaDB ak si zadávateľ vyžiada rodinovú konvenciu)
- Lokálny beh na `127.0.0.1`, **bez Caddy**

## Odpovede na 10 smerovacích otázok

1. **„max 10 produktov" → padá.** Nie pevný allowlist. Bezpečnostný model = **konfigurovateľný strop na dávku**;
   zápisy **dávkované a throttlované** (`setReduction` NIE je batchable → N produktov = N requestov pod
   rate-limit 300/60 s), s počítadlom a **potvrdením pred spustením**.
2. **API kľúč → `.env` + pripomienka.** `.env` mimo gitu; evidencia „kľúč nastavený dňa X"; UI upozornenie
   na rotáciu po 48 h; appka kľúč sama nemaže.
3. **Stack → Laravel** (viď vyššie).
4. **Dostupnosť → bez Caddy, čisto lokál** (`127.0.0.1`).
5. **Cieľ → produkčný shop**, doména a stav kľúča `product:edit` čakajú na doplnenie zadávateľom.
6. **Rušenie zľavy → reálny endpoint `clearReduction`** (nové v API, viď nižšie). Hack s `to` do minulosti netreba.
7. **Ovládanie → manuálne + scheduler** (Laravel scheduler + queue) na plánované kampane; vyžaduje trvalý kľúč (sedí s `.env`).
8. **`orders:read` → ÁNO.** Appka bude vedieť predajnosť a radiť čo zlevniť. Pozor: kľúč s prístupom k
   zákazníckym dátam → povinné GDPR pravidlá (čo/ako dlho sa loguje, prístup).
9. **Audit → plný audit log + snapshot pred/po** (cez `getFull`) + uložená odpoveď API.
10. **Názvy/porty → z doc:** port `3050`, kontajner `ovl-zliav-app` (+ `ovl-zliav-db` iba pri MariaDB),
    cookie `ovl_zliav_session`. Zobrazovaný názov v UI: čaká na potvrdenie (`ovl-da-zliav` vs. `aura-zlavy`).

## Dry-run pravidlo (bezpečnostné jadro)

Každá operácia meniaca cenu (`setReduction`, `clearReduction`) beží **najprv ako dry-run**: appka ukáže
presne, čo by zapísala (produkt, staré vs. nové `reduction`, okno, marža po zľave), a **reálny zápis prebehne
až po explicitnom potvrdení**. Platí aj pre plánované kampane — „armovanie" kampane = explicitné potvrdenie
reálneho behu vopred.

## Zmeny oproti `docs/00-KONTEXT` (nový API doc je novší)

Tri pôvodné premisy doc už NEPLATIA:

1. `POST /api/products/clearReduction` **existuje** → zrušenie zľavy je reálna operácia.
2. `getFull` vracia **aktuálnu zľavu** (`reduction_percent/from/to`) + `margin`, `margin_percent`,
   `sell_price_with_vat`, `qty` (sklad), `qty_in_orders`, `last_time_in_order`, `supplier`, `categories`,
   `active` → appka vidí **skutočný stav** zľavy a **maržu po zľave**, nielen čo sama zapísala.
3. K dispozícii sú aj `products/search` (filtre, sort), `products/searchIndex` (fuzzy Meilisearch),
   `categories`, `whoami` (scopes, expiry, zostávajúci rate-limit).

## Obmedzenia kontraktu (appka musí validovať pred volaním)

- `setReduction`: `reduction` **0–30 %**, okno **≤ 3 mesiace**, `409` ak beží flash sale (TurboSaleUltimate).
- Rate-limit ~300/60 s; dávka nie je atomická → pri chybe v strede treba **kompenzáciu**, nie rollback.
- Čítacie endpointy `products`, `products/get`, `products/searchIndex` sú verejné; `getFull`, `search`,
  `categories` vyžadujú `product:read`; write vyžaduje `product:edit`; objednávky `orders:read`.

## Čaká na doplnenie zadávateľom

- Doména testovacieho/produkčného eshopu.
- Stav kľúča `product:edit` (mám / treba vyžiadať / testovací).
- DB: potvrdiť SQLite vs. MariaDB.
- Zobrazovaný názov appky.
