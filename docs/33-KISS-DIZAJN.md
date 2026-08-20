# Aura Zľavy — KISS redizajn podľa priloženého návrhu

**Dátum:** 2026-08-06 · **Predloha:** `discountcontrolui.html` (upload od Samuela)
**Stav:** SCHVÁLENÉ (10 otázok zodpovedaných) — vstup pre implementáciu C1–C4

Nadväzuje na `docs/32-UX-UI-PLAN.md` (B1 dizajnový systém je hotový a commitnutý).
KONTRAKT a invarianty I1–I14 platia bez zmeny. KISS = menej obrazoviek a menej
šumu, NIE menej poistiek — dry-run, potvrdenia, audit a read-only režim zostávajú.

---

## 1. Rozhodnutia z 10 otázok

| # | Téma | Rozhodnutie |
|---|---|---|
| 1 | Layout | **Horná navigácia zostáva** (nie sidebar). Z predlohy sa preberá štýl kariet, KPI, toolbar, drawer, prázdne stavy. |
| 2 | Téma | **Dark default zostáva**, svetlá prepínačom (B1 už postavené). Mäkký štýl predlohy sa adaptuje do tmavej: tiene → jemné ohraničenie + veľmi nízky ambient tieň. |
| 3 | Farba | **Aura teal + gold** — štruktúra a čistota predlohy, farby rodiny. Modrá #2855D9 sa NEpoužije. |
| 4 | 3 KPI karty | **Aktívne zľavy teraz** (n/10 podľa vlastných zápisov) · **Vyžaduje zásah** (needs_key + missed + partial; má byť 0) · **TTL kľúča** (hero číslo + oblúk zelená→jantár→červená). |
| 4b | Najbližšie spustenie | riadok pod grafom (nie karta). |
| 5 | 1 graf | **Časová os kampaní** (G1) — spany okien na 3-mesačnej osi s dnešnou čiarou, stavová farba + glyf, hover tooltip. |
| 6 | Taby | **Dashboard · Produkty · Kampane · Analytika · Nastavenia · AI agent** (6 tabov, audit ide do Analytiky). |
| 7 | Nová kampaň | **Drawer sprava** (2 kroky: výber → dry-run + potvrdenie v tom istom draweri). Invariant I3 nezmenený — bez preview tokenu a potvrdenia žiadny zápis. |
| 8 | Analytika | Grafy (hĺbka zľavy G2, aktivita zápisov G4, história na produkt G3) + **audit log s filtrami** + prázdna sekcia **„Výkon zliav"** s poctivým popisom, že čaká na orders:read. |
| 9 | AI agent | Samuel chce agentov navrhujúcich kampane podľa **obrátkovosti** `(Ø zásoba × dni) / COGS`. Viď §4 — čo sa dá dnes a čo blokujú dáta. |
| 10 | Štýl | **Mäkký štýl predlohy 1:1**: radius 12–16px, jemné tiene, KPI karty s kruhovým akcentom v rohu, soft plochy pre ikony, hover zdvih, view-in 220ms. V dark: tiene → hairline + nízky ambient. |

## 2. Mapovanie tokenov predlohy → Aura

| Predloha | Aura ekvivalent |
|---|---|
| `--color-primary #2855d9` | `--brand` (teal #03797E / #05BCC4) |
| `--color-primary-soft #edf2ff` | `--brand-tint` |
| `--color-bg #f4f7fb` | `--paper` (light #f8f4f7 / dark #0e1413) |
| `--color-surface #fff` | `--surface-solid` |
| success/warning/danger | `--st-good` / `--st-attention` / `--st-critical` (validované, s glyfmi) |
| radius 8/12/16/22 | prevziať ako `--r-sm/md/lg/xl` |
| shadow-sm/md, focus-ring | prevziať; v dark nahradiť hairline + ambient 0 10px 30px rgba(0,0,0,.35) |
| eyebrow text (modrý) | gold `--gold` (rodinné pravidlo) |
| kpi-card::after kruhový akcent | áno, v `--brand-tint`; NIKDY v stavovej farbe |

Pruh PRODUKCIA (D6), TTL badge (D5), stavové glyfy a read-only pás z B1 zostávajú
nad/na tejto štruktúre — sú to bezpečnostné prvky, nie dekorácia.

## 3. Obrazovky

### Dashboard (KISS)
1. Page-head: eyebrow „Riadenie zliav" (gold), titul, `+ Nová kampaň` (primary, otvára drawer)
2. **3 KPI karty** (grid-kpis, štýl predlohy)
3. **1 graf** — časová os kampaní v karte s hlavičkou a prepínačom rozsahu (30/90 dní)
4. Riadok „Najbližšie spustenie: …" pod grafom (alebo „žiadne naplánované")
5. Banner „vyžaduje zásah" LEN keď n > 0 (needs_key a missed s ROVNAKOU váhou — D8/D33b)
Nič viac. Dokumentačná karta „čo dashboard vie a nevie" sa ruší — jej obsah ide
do tooltipu ⓘ pri KPI karte Aktívne zľavy a do Nastavení.

### Produkty
Toolbar (hľadanie, filter stavu) + tabuľka/karty allowlistu: monogram, názov,
`#id`, cena (tabulárne), mini-bar hĺbky zľavy, skrátený badge vlastného zápisu,
`⚙ varianty`. Pridanie produktu = drawer. Odobranie = inline „Naozaj?".

### Kampane
Toolbar (hľadanie, filter stavu — štýl predlohy) + tabuľka kampaní (stav s glyfom,
%, okno, produkty, fireAt). Detail zostáva samostatná stránka (rozpad položiek G5,
retry, audit stopa). `+ Nová kampaň` = ten istý drawer ako z Dashboardu.

### Analytika
Filter-strip (obdobie, produkt) + grid-halves:
G2 hĺbka zľavy · G4 aktivita zápisov · G3 história na produkt (s výberom produktu)
+ sekcia **Audit** (tabuľka s filtrami a detail drawerom — presunuté z tabu Audit)
+ prázdna sekcia **„Výkon zliav"**: empty-state štýlom predlohy, text presne:
„Tržby a využitie zliav vyžadujú prístup k objednávkam (scope orders:read).
Rozhodnutím 8 ho appka nemá — zmena je možná v Nastaveniach po vydaní kľúča."

### AI agent — viď §4

### Nastavenia
Settings-layout predlohy (bočná mini-navigácia): Doména a spojenie · API kľúč
(+ panic button) · Zápisy a limity · Vzhľad · Servis (zálohy, runbooky, verzia).

## 4. Tab AI agent — poctivý rozsah

**Čo Samuel chce:** agenti autonómne navrhujú a analyzujú kampane podľa
obrátkovosti `(Ø zásoba × počet dní) / COGS`.

**Tvrdý fakt o dátach:** shop API dáva `id, name, price, has_attributes` a pri
variantoch `quantity` (zásoba LEN variantných produktov). **COGS nedáva vôbec**
a predaje vyžadujú `orders:read` (vylúčené rozhodnutím 8, vynucované I8).
Obrátkovosť sa teda DNES vypočítať nedá a nič ju nesmie predstierať.

**V1 (implementuje sa teraz) — pravidlový analytik z vlastných dát:**
karta „Zistenia" generovaná pri načítaní zo skutočných dát:
- kampane končiace do 7 dní bez nadväzujúcej kampane
- produkty allowlistu bez aktívnej zľavy dlhšie než 30 dní
- čiastočné kampane s nedopísanými produktmi (+ koľko)
- kampane v needs_key / missed (s odkazom)
- kľúč expiruje pred štartom naplánovanej kampane
- variantné produkty s nízkou zásobou (`quantity` z /products/get, jediná
  zásoba, ktorú API dáva) — označené „len variantné produkty"
Každé zistenie: veta + odkaz + odporúčaná akcia (otvorí drawer s predvyplnením).
ŽIADNE LLM volanie — je to deterministický kód, rýchly a offline.

**V2 (pripravené, vypnuté) — sekcia „Obrátkovosť":**
zamknutá karta s presným zoznamom, čo chýba:
1. COGS — shop API ho neposkytuje (pridané do backlogu na maintainera, KONTRAKT §I)
2. zásoba nevariantných produktov — API ju neposkytuje (backlog)
3. predaje — vyžaduje orders:read = zmena rozhodnutia 8 (rozhoduje Samuel)
+ vzorec zobrazený tak, ako ho Samuel zadal, aby bolo jasné, čo sa buduje.

**V3 (mimo tohto sprintu) — LLM agent:** karta „Agent" s popisom a CTA
„vyžaduje konfiguráciu" (model, API kľúč ako ďalší secret s vlastným TTL,
čo smie čítať). Zapisovať agent NIKDY nebude sám — návrh vždy končí v drafte
a prechádza dry-run potvrdením (I3).

## 5. Rozdelenie práce — C1–C4

Exkluzívne vlastníctvo súborov; proti cudzím modulom sa programuje cez rozhrania.

### C1 — KISS shell + Dashboard *(sám, vlna 1)*
**Vlastní:** `src/app/globals.css` (rozšírenie o štýl predlohy) ·
`src/components/ui/{Drawer,KpiCard,Toolbar,EmptyState,Eyebrow}.tsx` (nové) ·
`src/app/page.tsx` · `src/components/dashboard/**` · `src/app/layout.tsx` (taby)
**Robí:** tokeny §2 (radius, tiene, focus-ring, kpi akcent) · 6 tabov v Nav ·
3 KPI karty · zasadenie `<CampaignTimeline/>` (od C2) · riadok najbližšieho
spustenia · banner zásahu · zrušenie dokumentačnej karty (obsah do ⓘ tooltipu)

### C2 — Grafy + Produkty + Analytika *(vlna 2)*
**Vlastní:** `src/components/charts/**` · `src/app/api/insights/**` ·
`src/lib/repo/insights.repo.ts` · `src/app/produkty/**` (premenované z existujúcej
štruktúry, ak treba) · `src/app/analytika/**` (nové) · `src/components/products/**` ·
`src/components/audit/**` (presun do Analytiky) · príslušné testy
**Robí:** G1 (časová os — C1 ju importuje), G2, G3, G4 podľa §4 plánu 32 ·
Produkty podľa §3 · Analytika vrátane auditu a prázdnej sekcie Výkon zliav ·
starý tab Audit presmeruje na /analytika#audit

### C3 — Drawer kampane + Kampane tab + AI agent *(vlna 2)*
**Vlastní:** `src/components/campaigns/**` · `src/app/kampane/**` ·
`src/app/ai-agent/**` (nové) · `src/components/ai/**` (nové) ·
`src/app/api/ai/insights/route.ts` (nové, read-only) ·
`src/lib/ai/rules.ts` (nové — pravidlový analytik) · príslušné testy
**Robí:** drawer novej kampane (2 kroky, I3 nezmenený, sady produktov +
posledná sada + duplikovanie + presety) · Kampane tab s toolbar štýlom ·
AI agent tab podľa §4 (V1 pravidlá + V2 zamknutá obrátkovosť + V3 karta)
· dokončenie rozpracovaného B3 vo vlastných súboroch (write-gate, retry poznámka)

### C4 — Overenie + snímky *(sám, vlna 3)*
**Vlastní:** `docs/34-KISS-OVERENIE.md` · `test/e2e/**` (úpravy selektorov)
**Robí:** tsc/lint/vitest/playwright zelené · nové snímky všetkých tabov
(rovnaký postup ako screenshots/) · protokol čo je hotové/odložené

## 6. Čo sa KISS-om RUŠÍ (aby to bolo povedané nahlas)

- samostatný tab Audit (obsah žije v Analytike, URL presmeruje)
- dokumentačná karta na dashboarde
- samostatná stránka novej kampane (nahrádza drawer; stránka detailu zostáva)
- duplikované disclaimery (už rozhodnuté v 32, otázky 7–8)

Nič z toho nemaže dáta ani funkcie — len ich presúva na jedno miesto.
