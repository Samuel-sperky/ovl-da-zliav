# Kontrakt — dokončenie UX a dizajnu (19. 8. 2026)

Nadväzuje na `KONTRAKT-UI-2026-08-13.md`. Ten rozhodol **čo obrazovky
hovoria**. Tento rozhoduje **ako to vyzerajú, keď to hovoria**.

Zdroj pravidiel: `design/v3/ARCHITEKTURA.md` §0, pravidlá P1–P8.
Zdroj možností API: `docs/api/sperky-api-v5.md` (zhodný s `api_docs (9).md`
od používateľa z 19. 8. — žiadny nový endpoint, žiadna nová schopnosť).

---

## Východiskový stav (zmeraný, nie odhadnutý)

Reálna inštancia `127.0.0.1:3070`, DB `ovl_zliav`, 19. 8. 2026:

| tabuľka | riadkov |
|---|---|
| `catalog_cache` | 41 220 |
| `products_allowlist` | 1 |
| `campaigns` / `campaign_items` | 1 / 21 |
| `product_sales_daily` | 872 |
| `audit_log` | 173 |

**Snímky v `screenshots/aktualne-*.png` sú z e2e prostredia
(`shop.e2e.invalid`), kde je katalóg prázdny.** Dizajn sa na nich posudzoval
proti nule, hoci appka reálne drží 41 220 riadkov. To je hlavný dôvod, prečo
obrazovky vyzerajú prázdno a prečo hustota nikdy nebola navrhnutá.

---

## Rozhodnutia používateľa (19. 8. 2026)

| # | Otázka | Rozhodnutie |
|---|---|---|
| R1 | Snímky „Šperky Ops" | **Len vizuálna inšpirácia.** Preberá sa pokoj, hustota, karty a chipy. Neberie sa ani jedno číslo — tržby, marža objednávky, storná, dobropisy, kupóny, dobierky, registrácie a scope `order:stats` v našom API **neexistujú**. |
| R2 | Rozsah | **Všetkých 6 obrazoviek** — Prehľad, Produkty, Zľavy, Nová zľava, Detail zľavy, Nastavenia. |
| R3 | Priehľadnosť | **Zdroj čísla zostáva pod rozklikom.** P6 drží, žiadna výnimka sa nezapisuje. |
| R4 | Chróm | **Horná navigácia zostáva.** Mení sa paleta a typografia. |
| R5 | Paleta | **Neutrálna základňa + jeden akcent.** Teal len na akcie a aktívny stav. Stavová škála oddelená od značky. |
| R6 | Typografia | **Inter zostáva.** Prestavia sa mierka a hrúbky; čísla, ceny, percentá a časy dostanú `tabular-nums`. |
| R7 | Overenie | **Snímka reálneho katalógu do e2e fixture.** Playwright cez existujúci harness. I5 a basic auth zostávajú nedotknuté. |

---

## Zmerané defekty, ktoré sa MUSIA opraviť

Nájdené na `screenshots/aktualne-1,2,3,11`. Každý má obrazovku a dôkaz.

### Naprieč všetkými obrazovkami

| # | Defekt | Dôkaz |
|---|---|---|
| **D1** | Plávajúci kruh „N" **prekrýva obsah** vľavo dole na každej obrazovke. Na Produktoch zakrýva filter „Obrátkovosť", na Detaile zľavy vetu „…dľa vlastných zápisov appky". | všetky 4 snímky |
| **D2** | Sekčné popisky sú **všade rovnaké** — 11 px verzálky. Sekcia, dlaždica aj stĺpec tabuľky vyzerajú rovnako dôležito, takže hierarchia neexistuje. | všetky |
| **D3** | Čísla nie sú tabuľkové — stĺpce `CENA`, `ZĽAVA`, `PREDANÉ 30 D` poskakujú. | Produkty, Položky |
| **D4** | Tá istá veta sa opakuje **trikrát na jednej obrazovke** (dlaždica → pás → prázdna tabuľka). | Produkty: „Katalóg je prázdny" 3× |

### Prehľad

| # | Defekt |
|---|---|
| **D5** | Dve dominanty naraz — „Zápis stojí" (48 px) a prázdny stav „Zatiaľ nie je žiadna zľava" s tlačidlom v strede tej istej karty. P1 porušené. |
| **D6** | V riadkoch prekážok je stav („zastavuje zápis", „nezastavuje nič") **pod** textom a vľavo, mimo značky, ku ktorej patrí. Nedá sa skenovať. |
| **D7** | Sekcia „PREDAJ" zaberá celú kartu, aby povedala jednu vetu. |

### Produkty

| # | Defekt |
|---|---|
| **D8** | Štyri dlaždice stavu katalógu zaberajú ~180 px a tri zo štyroch ukazujú pomlčku. |
| **D9** | Zamknuté filtre sú v zozname **dvakrát** — pri svojej skupine s popiskom „zamknuté" aj zvlášť v skupine „ZATIAĽ NEDOSTUPNÉ". |
| **D10** | Hustota nikdy nebola navrhnutá pre 41 220 riadkov — stránkovanie 50/100, žiadna virtualizácia, žiadny rýchly skok. |

### Nová zľava

| # | Defekt |
|---|---|
| **D11** | **Namiesto veľkého čísla je čierny obdĺžnik.** Dominanta karty potvrdenia je rozbitá — „PRODUKTOV DOSTANE ZĽAVU" nemá hodnotu. |
| **D12** | Potvrdenie sa robí prepísaním počtu do políčka, ktoré je vizuálne slabšie než tlačidlo vedľa neho. |
| **D13** | Prekážky sú v pravom stĺpci ešte raz, hoci sú už v stavovom pruhu hore. |
| **D14** | Ľavý stĺpec má pri prázdnom katalógu ~300 px prázdna. |

### Detail zľavy

| # | Defekt |
|---|---|
| **D15** | „21 / 21" ako dominanta a hneď pod ňou štyri dlaždice s tými istými číslami (21, 0, 0, 0). |
| **D16** | Dve červené škatule pod sebou — chyba behu a „ČO BRÁNI ZÁPISU". |
| **D17** | „VÝKON VÝBERU" sú tri karty, všetky hovoria, že dáta nie sú. |
| **D18** | Preklep v popisku „VLANI ROVNAKÉ OBDOBIE". |

### Nastavenia

| # | Defekt |
|---|---|
| **D19** | Rozcestník je nescommitnutý v stagingu — treba dokončiť a zosúladiť s novou paletou. |

---

## Čo sa postaví

### F — základ (jeden autor, pred vlnou obrazoviek)

1. **Tokeny palety** v `src/app/globals.css`: neutrálna škála, jeden akcent
   (teal) výhradne na akcie a aktívny stav, **oddelená stavová škála**
   (bráni / obmedzuje / informuje / v poriadku).
2. Každá dvojica pozadie–text **zmeraná** validátorom zo skillu `dataviz`
   (WCAG kontrast + deuteranopia/protanopia ΔE). Do kontraktu sa zapíšu
   namerané hodnoty, nie tvrdenie „vyzerá to dobre".
3. Platí staré pravidlo projektu: **stav nikdy nie je len farba** — vždy
   farba + glyf + text.
4. **Typografická mierka**: 5 stupňov, každý s veľkosťou, hrúbkou a výškou
   riadka. Sekcia / dlaždica / stĺpec dostanú tri rôzne stupne (rieši D2).
5. `font-variant-numeric: tabular-nums` na triedu pre čísla (rieši D3).
6. Oprava **D1** (plávajúci kruh) — patrí do základu, lebo je na každej
   obrazovke.
7. **e2e fixture s reálnym katalógom**: export `catalog_cache` (41 220),
   `campaigns`, `campaign_items`, `product_sales_daily` z reálnej DB do
   seedu pre Playwright. Osobné údaje sa neexportujú — sú to názvy, ceny,
   ID a počty kusov. `audit_log` sa neexportuje.

### O — obrazovky (tri agenti paralelne, disjunktné vlastníctvo)

| Agent | Vlastní | Rieši |
|---|---|---|
| **O1** | Prehľad, Zľavy (zoznam) | D5, D6, D7 |
| **O2** | Nová zľava, Detail zľavy | D11–D18 |
| **O3** | Produkty, Nastavenia | D8, D9, D10, D19 |

Každý agent smie meniť **len svoje** súbory. Tokeny a mierku z F **nesmie
prepisovať** — smie ich len použiť.

### Z — záver (hlavný agent)

Integrácia → typecheck, lint, celý balík, e2e, build → jeden nezávislý
review agent na konzistenciu naprieč šiestimi obrazovkami → snímky všetkých
šiestich naraz proti reálnemu katalógu → aktualizácia `ARCHITEKTURA.md`,
`README.md` a sekcie Výsledok v tomto kontrakte.

---

## Čo NIE

- Mobil.
- Automatické obnovovanie čísel.
- Ľavý sidebar. Horná navigácia zostáva (R4).
- Nové písmo. Inter zostáva (R6).
- Akékoľvek číslo, ktoré API nedáva — menovite tržby v eurách, marža
  objednávky, náklady, storná, dobropisy, neprevzaté, kupóny, dobierky,
  registrácie, `order:stats` (R1).
- Zapnutie ostrých zápisov. `WRITES_ENABLED` zostáva `false`.
- Zmena schémy DB.
- Rozšírenie vysvetlení o chýbajúcich dátach mimo `LockedFeatures.tsx`.

---

## Akceptačné kritériá

1. Všetkých 19 defektov D1–D19 opravených, každý s dôkazom na snímke.
2. Deväť kritérií z `KONTRAKT-UI-2026-08-13.md` platí ďalej — najmä P3
   (žiadny žargón), P7 (odhady označené `≈`), P8 (žiadna kauzalita).
3. Každá obrazovka do 1,5 obrazovky pri 1440×900, max 4 sekcie, jedna
   dominanta — alebo zapísaná výnimka s dôvodom v `ARCHITEKTURA.md`.
4. Použiteľné na 720 px šírky.
5. Kontrast každej dvojice **zmeraný a zapísaný**; žiadny stav rozlíšený
   výhradne farbou.
6. Snímky vzniknuté proti **reálnemu katalógu** (41 220 riadkov), nie proti
   prázdnemu e2e.
7. Typecheck, lint, celý vitest balík, e2e a produkčný build zelené.
8. Žiadne nové volanie shop API mimo existujúcich klientov; invariant I8'
   (jediný volajúci `/api/order`) a I5 (jediný publikovaný port) nedotknuté.

---

## Namerané hodnoty palety (vlna F, 19. 8. 2026)

Merané `test/helpers/palette-math.ts`, strážené `test/unit/paleta.spec.ts`
(74 testov). Validátor má vlastný self-test — okrem iného reprodukuje historický
nález tohto projektu (`#B45309` ↔ `#C62F26` pod deuteranopiou ΔE 0,9).

### Stavová škála

| stav | svetlá | kontrast | tmavá | kontrast |
|---|---|---|---|---|
| bráni | `#d13228` | 5,00:1 | `#fa8076` | 7,11:1 |
| obmedzuje | `#6b4300` | 8,65:1 | `#eab254` | 9,29:1 |
| prebieha | `#2f2585` | 12,18:1 | `#8e83e8` | 5,54:1 |
| v poriadku | `#1a5e33` | 7,80:1 | `#3d9448` | 4,67:1 |
| nečinný | `#4f555c` | 7,54:1 | `#7b818a` | 4,52:1 |
| akcent (teal) | `#03797e` | 5,20:1 | `#05bcc4` | 7,60:1 |

**Rozdiel nesie svetlosť, nie odtieň.** Pod deuteranopiou a protanopiou odtieň
červenej, jantárovej a zelenej splýva — rozlíšiť sa dajú len jasom. Preto je
„obmedzuje" v svetlej téme tmavšie než „bráni", hoci je menej závažné. Poradie
závažnosti nesie glyf a slovo, nie farba (a bod 7 kontraktu UI aj tak hovorí, že
farbu prekážky volí spôsob riešenia, nie závažnosť).

### Výsledok merania

| | pred | po |
|---|---|---|
| dvojice stavov nerozlíšiteľné pri farbosleposti (ΔE < 8), svetlá | **5** | **0** |
| to isté, tmavá | **2** | **0** |
| kontrastné dvojice pod 4,5:1 | 2 | 0 |
| najtesnejšia dvojica, svetlá | ΔE 0,9 | ΔE 8,6 |
| najtesnejšia dvojica, tmavá | ΔE 5,5 | ΔE 8,7 |

Základňa je neutrálna: odchýlka kanálov od priemeru je pri `--paper`,
`--paper2`, `--paper3`, `--line` a `--line2` najviac 6/255 v oboch témach.
Predtým bola tónovaná doružova (`--paper: #f7f5f7`, `--line: #e3dde4`).

---

## Opravy zadania oproti pôvodnému zoznamu defektov

Dva body z pôvodného zoznamu boli určené zle a tu sa opravujú:

- **D1 nie je chyba appky.** Tmavý kruh vľavo dole je **indikátor `next dev`**.
  E2e harness (`test/e2e/serve.ts`) spúšťa vývojový server, takže odznak končil
  na každej snímke. Riešené `devIndicators: false` v `next.config.ts`.
- **D3 neplatil.** `font-variant-numeric: tabular-nums lining-nums` je na `body`
  nastavené už dlho. Tvrdenie „stĺpce poskakujú" bolo odvodené z prázdnej
  tabuľky, bez dôkazu.

### D20 — nález, ktorý nahradil D3 (závažnejší)

Appka deklarovala `--ovl-font: 'Inter', 'Inter var', …`, ale **v repozitári
nebol ani jeden súbor písma** — žiadny `@font-face`, žiadny `next/font`. Na
cieľovom Windows PC Inter nainštalovaný nie je, takže sa appka celý čas
vykresľovala v **Segoe UI** a každé rozhodnutie o typografii sa robilo proti
písmu, ktoré nikto nevidel. Navyše `'Inter var'` nie je názov žiadnej rodiny.

Riešené balíkom `@fontsource-variable/inter` (lokálne súbory, žiadne CDN — I6
platí). Variant je **variabilný** zámerne: `globals.css` používa rezy 550, 620,
640, 650, 660 a 680, ktoré by statický Inter zaokrúhlil na stovky. Načítava sa aj
kurzíva (appka ju používa) a podmnožina **latin-ext**, bez ktorej by slovenské
č, š, ž, ť, ľ a ô vypadli do náhradného písma uprostred slova. Strážené
`test/unit/typografia.spec.ts` (14 testov).

---

## Výsledok

*(dopĺňa sa po dokončení)*
