# Aura Zľavy — overenie KISS redizajnu (C4)

**Dátum:** 2026-08-06 · **Vstup:** plán `33-KISS-DIZAJN.md` (C1–C3 hotové) ·
**Vlastník:** C4 (§5 plánu 33)

---

## 1. Výsledky kontrol

| Kontrola | Výsledok |
| --- | --- |
| `npx tsc --noEmit` | ✅ bez chýb |
| `npm run lint` (eslint) | ✅ bez chýb |
| `npx vitest run` | ✅ **650/650** (s bežiacou DB; bez DB 599 passed + 51 skipped) |
| `npx playwright test` | ✅ **20/20** (po 1 úprave selektora, viď §2) |

E2E beží proti lokálnej MariaDB (schéma `ovl_zliav_e2e`) a mock shopu —
invarianty I1/I6 harnessu bez zmeny.

## 2. Úpravy testov (vlastné súbory `test/e2e/**`)

Jediná zmena: **`onboarding.spec.ts`** — test „I2: 11. produkt sa do allowlistu
nedostane". KISS presunul formulár pridania produktu do drawera; pri plnom
allowliste (10/10) je tlačidlo `+ Pridať produkt` **vypnuté s viditeľným
dôvodom** a starý `allowlist-full-notice` (žil vo formulári) sa na stránke bez
otvoreného drawera nevyskytuje. Test teraz overuje `open-add-product`
disabled + text „Allowlist je plný". Fail-closed správanie (I2) sa nemení —
API stále vracia ≥ 400 a test to ďalej kontroluje.

Ostatné e2e prešli bez úprav (audit test funguje aj cez presmerovanie
`/audit` → `/analytika#audit`). Pri úplne studenom `next dev` môžu prvé
testy naraziť na 15 s timeout kvôli prvej Turbopack kompilácii — druhý beh
je stabilne zelený; nejde o chybu appky ani testov.

## 3. Vizuálne overenie invariantov (snímky `screenshots/`)

Overované priamo v snímacom scenári tvrdeniami, nie iba okom:

- **Pruh PRODUKCIA (D6)** — viditeľný na každom zo 6 tabov aj v light téme. ✅
- **TTL badge kľúča (D5)** — viditeľný na každom tabe (47 h 59 min v seede). ✅
- **Drawer nevie zapísať bez potvrdenia (I3)** — krok 1 → dry-run → krok 2
  obsahuje `DryRunTable` + samostatný `ConfirmPanel`; počítadlo zápisov mocku
  sa počas celého toku po krok 2 **nezmenilo** (0 zápisov). ✅
- **AI agent bez vymyslených čísel (I11/§4)** — Zistenia sú generované zo
  skutočných seedov (expirácia kľúča pred štartom kampane, čiastočná kampaň,
  produkty bez vlastného zápisu); karta Obrátkovosť je zamknutá
  (`aria-disabled`) s vymenovanými chýbajúcimi vstupmi, karta Agent len
  popisná. Žiadne číslo, ktoré by appka nepoznala z vlastných dát. ✅
- **I1** — HTML žiadneho tabu neobsahuje testovací kľúč (kontrola
  `page.content()`). ✅
- **I2** — plný allowlist blokuje pridanie v UI aj na API (e2e). ✅

## 4. Snímky (nové, staré prepísané)

Generované dočasným specom v `test/e2e/` cez harness (seed: 8 produktov,
kampane done/partial/scheduled, audit záznamy vrátane price-mismatch);
spec bol po vygenerovaní zmazaný. Viewport 1440×900.

| Súbor | Obsah |
| --- | --- |
| `01-dashboard.png` | Dashboard dark: 3 KPI karty, G1 časová os, najbližšie spustenie, banner zásahu |
| `02-produkty.png` | Produkty: toolbar + mriežka kariet allowlistu |
| `03-kampane.png` | Kampane: toolbar + tabuľka so stavovými glyfmi |
| `04-analytika.png` | Analytika: G2/G4/G3 + Audit s filtrami + prázdny „Výkon zliav" |
| `05-nastavenia.png` | Nastavenia: settings-layout s bočnou mini-navigáciou |
| `06-ai-agent.png` | AI agent: Zistenia (V1) + zamknutá Obrátkovosť (V2) + karta Agent (V3) |
| `07-drawer-krok1.png` | Drawer novej kampane, krok 1 (percento čipy, okno) |
| `08-drawer-krok2.png` | Drawer, krok 2 — dry-run tabuľka + potvrdenie zápisu |
| `09-dashboard-light.png` | Dashboard vo svetlej téme (prepínač) |

## 5. Zistenia v cudzích súboroch (needitované — vlastníctvo C1–C3)

1. **G1 časová os** (`src/components/charts/**`, C2): popisok „dnes" sa
   prekrýva s popiskom mesiaca („aug 2026"), keď dnešná čiara padne blízko
   začiatku mesiaca. Kozmetické.
2. **Analytika — G3 história na produkt** (C2): pri snímke sa karta G3
   vykreslila ako prázdna plocha bez viditeľného obsahu/empty-state textu
   (produkt #201 mal pritom kampaň). Treba preveriť loading/empty stav.
3. **Drawer krok 2** (C3): riadok dry-run tabuľky v draweri mierne pretečie
   horizontálne (dátum „14.08.2026" odseknutý pri šírke drawera). Kozmetické.
4. **Dashboard „+ Nová kampaň"** (C1): vedie cez `/kampane/nova` →
   presmerovanie `/kampane?nova=1` — drawer sa otvorí, ale s medzikrokom
   navigácie; priamy stav drawera na Dashboarde by bol čistejší.

Nič z toho neporušuje invarianty — všetko sú vizuálne/UX drobnosti.

## 6. Odložené (zámerne, podľa plánu 33)

- **V2 Obrátkovosť** — zamknutá karta; čaká na COGS + zásobu nevariantných
  produktov (backlog na maintainera, KONTRAKT §I) a na predaje.
- **V3 LLM agent** — len popisná karta „vyžaduje konfiguráciu"; mimo sprintu.
- **Výkon zliav** (Analytika) — prázdna sekcia s poctivým textom; čaká na
  `orders:read`.
- **Mobilná snímka** — sada KISS snímok je desktopová (1440×900); mobilné
  overenie nebolo v zadaní C4, responzivita tabov vizuálne nekontrolovaná.

## 7. Čo treba od Samuela

1. **Rozhodnutie o `orders:read`** — bez neho zostáva „Výkon zliav" prázdny
   a obrátkovosť sa nedopočíta (zmena rozhodnutia 8 = nový kľúč so scope).
2. **Odoslať backlog maintainerovi shopu** (`docs/20-BACKLOG-SHOP-API.md`):
   COGS a zásoba nevariantných produktov sú nutné pre V2.
3. **Ak chce V3 (LLM agent):** vybrať model/poskytovateľa a odsúhlasiť, že
   API kľúč modelu bude ďalší secret s vlastným TTL.
4. Pozrieť snímky `screenshots/01–09` a odklepnúť KISS vzhľad (teal/gold,
   dark default) pred ďalšou iteráciou.
