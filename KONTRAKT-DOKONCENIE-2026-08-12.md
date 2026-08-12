# Kontrakt — dokončenie do prvej reálnej zľavy (2026-08-12)

**Nadradenosť.** Tento kontrakt NEMENÍ `docs/50-KONTRAKT-V3.md` ani invarianty
z `docs/10-KONTRAKT.md`. Kde by si odporovali, vyhráva invariant. Tento
dokument hovorí, čo sa v appke dorobí, nie čo v nej smie prestať platiť.

Zdroj pravdy pre limity shopu: `docs/api/sperky-api-v4.md`.

---

## Prečo tento šprint

Appka je postavená, otestovaná a nasadená, ale Samuel ju nevie použiť
z dvoch dôvodov:

1. **Nevidí do nej.** Nevie čo práve robí, prečo sa niečo nestalo, ani čo appka
   vôbec vie — napríklad že strop desiatich produktov je len prepínač
   v Nastaveniach a dá sa zdvihnúť na 10 000.
2. **Nedôjde do konca.** Cesta výber → náhľad → potvrdenie → fronta → zapísané
   nebola nikdy prejdená naostro.

Cieľ šprintu je jedna veta: **Samuel spustí reálnu zľavu na produktoch svojho
eshopu a po celý čas vidí, čo sa deje — bez toho, aby otvoril logy alebo DB.**

### Pozor — jeden ostrý zápis UŽ PREBEHOL

Zistené 12. 8. z produkčného auditu (`audit_log` id 22–23), nie z dokumentácie:

```
2026-08-07 11:19:09  write_ok  product_id=72  http 200
sentPayload: {"id":72,"from":"2026-08-07","to":"2026-08-31","reduction":10}
message:     „Rýchla zľava zapísaná bez vytvorenia kampane."
```

Z toho plynú tri veci:

1. **Na produkte 72 je pravdepodobne živá 10 % zľava** s oknom do 31. 8. 2026.
   Appka ju zrušiť nevie a ani nebude (I7) — expiruje sama.
2. Zápisová cesta proti produkčnému shopu je **overená v praxi**, nielen proti
   mocku. Akceptačné kritérium 5 je tým menej rizikové, než sa zdalo.
3. Zápis prišiel z funkcie „rýchla zľava", ktorá žije na neintegrovanej vetve
   `wip/rychla-zlava-2026-08-07` a mala **vlastný zápisový príznak** mimo
   `executor.ts`. Vo V3 taká cesta neexistuje a nesmie vzniknúť — grep test
   stráži, že `setReduction` volá jediné miesto. Pri prípadnom preberaní tej
   vetvy je toto prvá vec na kontrolu.

---

## Tvrdé limity, ktoré určujú, čo je vôbec možné

Zmerané z `docs/api/sperky-api-v4.md`, nie odhadnuté:

| Volanie | Limit | Čo z toho plynie |
|---|---|---|
| S kľúčom (zápisy `setReduction`) | 20/min, **200 / UTC deň** | 150 produktov = 1 deň. 5 000 = 25 dní. |
| Bez kľúča (čítanie katalógu) | 30/min, **300 / UTC deň** | 411 strán katalógu = **2 dni** behu. |

Ďalšie overené obmedzenia:

- **`setReduction` NIE JE batchable.** Opted-in sú len `products/get`
  a `order/get`. Navyše dávka nešetrí rozpočet — 25 položiek = 25 zásahov.
- **Limity sú per-kľúč z DB politiky** („default staff policy"). Vyšší strop je
  administratívny úkon na strane shopu, nie zmena v tejto appke.
- **Kľúč žije 48 h.** Fronta dlhšia než dva dni ho prežije a musí si vypýtať nový.

---

## Odsúhlasené rozhodnutia (12. 8. 2026)

| # | Rozhodnutie | Dôsledok |
|---|---|---|
| **R1** | Prvá reálna zľava má **do ~150 produktov** | Zmestí sa do jedného denného rozpočtu. Nečaká sa na nikoho. |
| **R2** | Šprint končí **skutočným zápisom** do sperky-eshop.sk | `WRITES_ENABLED` sa zapne. Prepnutie a potvrdenie robí Samuel. |
| **R3** | Priehľadnosť naprieč **celou appkou** (4 taby) | Najdrahšia z ponúknutých možností; Samuel ju zvolil po upozornení na cenu. |
| **R4** | Režim rozsahu `pilot → plny` | Nutné pre viac než 10 produktov. Prepína Samuel heslom (sudo), appka mu to má sama ponúknuť. |

Predvolené, dá sa zmeniť počas behu:

- **P1** Cieľová sada 150 produktov sa vyberá z katalógu ručne (filtre + hľadanie),
  nie automatickým pravidlom.
- **P2** Fronta ostáva sekvenčná s pauzou; žiadna paralelizácia zápisov (I10).
- **P3** Texty ostávajú slovenské, kód anglický. Vizuálna identita (farby, typografia)
  sa nemení — mení sa hierarchia, obsah a prázdne stavy.
- **P4** Dizajnová predloha `sperky-admin.html` (Downloads, 12. 8.) sa berie
  **čiastočne — vzory áno, chróm nie**, viď nižšie.

### P4 — čo sa z predlohy preberá a čo nie

Predloha rieši presne tie štyri problémy, ktoré Samuel označil, preto sa
preberajú jej **vzory**:

| Preberám | Načo to je |
|---|---|
| Meracie prúžky `minúta 0/18` a `dnes 0/200` v stálej pätke | C1 — rozpočet zápisov je konečne vidieť |
| `conn-pill` — stavová bodka + doména shopu | C1 — na čo je appka napojená a či to žije |
| `🔒` pri zamknutej položke navigácie + veta prečo | C3 — funkcia sa dá nájsť skôr, než na ňu mám právo |
| `.note` / `.note.warn` / `.note.err` v karte, kde problém vznikol | C2 — dôvod pri mieste výskytu |
| Prázdne stavy, ktoré hovoria ako ich naplniť | C4 |
| KPI dlaždice, husté tabuľky s verzálkovou hlavičkou, pravý drawer | C5 |

**Nepreberám** (a je to vedomé rozhodnutie, nie opomenutie):

- svetlú tému — appka ostáva tmavá,
- modrú `#2a78d6` — ostáva Aura teal + gold,
- ľavý sidebar — ostáva horná navigácia so 4 tabmi.

Dôvod: toto trojo si Samuel zvolil pri KISS redizajne 6. 8. 2026 a zmena by
znamenala prepísať každú obrazovku, nie zjednotiť ich. Farby navyše prešli
meraním na farbosleposť (`ΔE`) a swap na modrú by to overenie zahodil.

---

## Rozsah — ČO ÁNO

### A. Katalóg (predpoklad, bez neho nie je z čoho vyberať)

Dnes je v `catalog_cache` **2 900 zo 41 082** produktov a synchronizácia sa
zasekne na 30. strane.

- A1 Opraviť tempo: kód predpokladá „300 volaní / 60 s", skutočný anonymný limit
  je **30/min**. Pauza 250 ms je 8× rýchlejšia, než sa smie.
- A2 Pokračovanie od poslednej zapísanej strany namiesto reštartu od strany 1 —
  inak sa chvost katalógu neprečíta nikdy.
- A3 Rešpektovať `Retry-After` pozastavením celej synchronizácie, nie opakovaním
  jednej strany trikrát.
- A4 Denný strop 300 čítaní zdieľať so synchronizáciou predajnosti, aby si
  navzájom nebrali rozpočet.
- A5 V UI vidieť: koľko z 41 082 je načítaných, kedy naposledy, kedy bude ďalšia
  dávka, prečo sa čaká.

**Meradlo:** katalóg dosiahne 41 082 riadkov do dvoch dní behu na pozadí a UI
po celý čas hovorí pravdu o tom, kde je.

### B. Cesta jednej zľavy

- B1 Appka sama ponúkne prepnutie do `plny`, keď Samuel vyberie viac než 10
  produktov — namiesto tichého odmietnutia.
- B2 Výber do ~150 produktov: hľadanie, filtre, počítadlo, zapamätaná sada.
- B3 Náhľad: koľko produktov, aké ceny pred a po, koľko dní bude fronta bežať,
  kedy zľava reálne nabehne.
- B4 Potvrdenie a spustenie fronty bez zmeny invariantu I3 (žiadny zápis bez
  potvrdenia) a I13 (zápis len s `WRITES_ENABLED`).
- B5 Priebeh fronty naživo: koľko hotových, koľko ostáva, koľko zo 200 denného
  rozpočtu je minutých, čo sa stane zajtra.
- B6 Expirácia kľúča počas behu je stav, z ktorého sa dá vyjsť z obrazovky —
  nie mŕtvy bod.
- B7 Zopakovanie zlyhaných položiek a jasné rozlíšenie „nezapísalo sa"
  vs. „nevieme, či sa zapísalo" (D45).

**Meradlo:** reálna zľava na produktoch eshopu, viditeľná na sperky-eshop.sk,
spustená z UI bez jediného pohľadu do logov.

### C. Priehľadnosť (4 taby: Prehľad, Produkty, Zľavy, Nastavenia)

- C1 **Živý stav** — čo beží teraz, kedy naposledy bežal scheduler, koľko
  zápisov ostáva z denného rozpočtu, dokedy platí kľúč, či sú zápisy zapnuté.
- C2 **Dôvod pri mieste výskytu** — keď produkt neprejde alebo zápis nebeží,
  obrazovka povie ktoré pravidlo to zastavilo (režim rozsahu, katalóg, rozpočet,
  kľúč, `WRITES_ENABLED`) a čo s tým.
- C3 **Objaviteľnosť** — funkcie, ktoré existujú, ale nikto ich nenájde
  (režim rozsahu, panic button, obnova katalógu, predajnosť, audit).
- C4 **Prázdne a chybové stavy** — každá obrazovka povie, čo tam má byť a ako sa
  to tam dostane, namiesto prázdnej tabuľky.
- C5 **Hierarchia a texty** — čísla dostanú kontext, kroky dostanú poradie.

**Meradlo:** Samuel prejde celú cestu a v žiadnom kroku sa nemusí pýtať „a čo
teraz" ani otvoriť terminál.

---

## Rozsah — ČO NIE

- **Zvýšenie denného limitu zápisov** (B7 v `docs/20-BACKLOG-SHOP-API.md`).
  Je to nastavenie kľúča na strane shopu, nie kód tejto appky. Pripravím presné
  zadanie pre Delaju ako výstup, nič viac.
- **Zľavy nad ~150 produktov naostro.** Technicky pôjdu, ale prvý ostrý beh
  zámerne nie je maratón na 25 dní.
- **Dávkové zápisy.** API ich pre `setReduction` nepovoľuje.
- **Rušenie zliav.** Invariant I7 platí ďalej — zľavy expirujú, appka ich neruší.
- **Zmena vizuálnej identity.** Farby a typografia ostávajú (P3).
- **Refaktor, ktorého sa šprint nedotkne.** Upratovanie ide ako samostatné úlohy.

---

## Akceptačné kritériá

1. `catalog_cache` obsahuje všetkých 41 082 produktov; synchronizácia neprekročí
   30 volaní/min ani 300/deň a po prerušení pokračuje tam, kde skončila.
2. V UI je kedykoľvek vidieť stav katalógu, fronty, rozpočtu, kľúča a zápisov —
   bez logov a bez DB.
3. Každé zamietnutie produktu alebo zápisu ukáže konkrétny dôvod a ďalší krok.
4. Prepnutie `pilot → plny` je z UI nájditeľné bez znalosti kontraktu a appka ho
   ponúkne sama, keď na strop narazíš.
5. Zľava na ~150 reálnych produktov prejde celú cestu a je **overiteľná na
   sperky-eshop.sk**.
6. Expirácia kľúča uprostred fronty sa dá vyriešiť z obrazovky.
7. Celý testovací balík zelený (okrem 9 známych Windows-prostredových zlyhaní),
   typecheck a lint čisté, `npm audit` bez kritických.
8. Každá zmenená obrazovka overená v prehliadači cez Playwright + screenshot
   v reporte. Caddy basic auth sa z agenta vyplniť nedá, preto sa jazdí cez
   e2e harness, ktorý servuje appku priamo.
9. Invarianty I1, I3, I7, I8', I10, I13 a K1 doložené testami aj po zmenách.

---

## Otvorené riziká

| # | Riziko | Ako s ním narábam |
|---|---|---|
| **RZ1** | Prvý ostrý zápis ide do **produkčného eshopu bez stagingu**. Chyba je vidieť zákazníkom. | Zápis až po prejdení kontrolného zoznamu so Samuelom. Začne sa malou sadou, nie 150 naraz. |
| **RZ2** | Katalóg potrebuje 2 dni behu. Ak PC v noci nebeží, potrvá dlhšie. | Pokračovanie od poslednej strany (A2) to robí odolným voči vypnutiu. |
| **RZ3** | 48-hodinová životnosť kľúča vs. viacdňová fronta. | B6 — obnova kľúča z obrazovky, bez straty rozbehnutej fronty. |
| **RZ4** | `scope_mode_changed` nie je v zozname `AuditEventType`, zapíše sa s varovaním. | Doplním pri B1, je to jednoriadková vec s testom. |
| **RZ5** | Lokálna `ovl_zliav_test` je prázdna, balík testov kolíše (9/39/54/56 zlyhaní). | Musí sa opraviť skôr, než sa balík použije ako brána. Je to prvá úloha vlny 1. |
| **RZ6** | Rozsah C (celá appka) je najdrahšia možnosť a Samuel ju zvolil po upozornení. | Ak spend narastie o viac než 30 % oproti odhadu, zastavím sa a poviem to. |

---

## Výsledok (12. 8. 2026)

Vetva `feat/dokoncenie-prva-zlava`, 9 commitov, ~21 000 riadkov v ~95 súboroch.
14 agentov v štyroch vlnách. Nasadené lokálne, appka je zdravá.

### Brána

| | |
|---|---|
| `npm run typecheck` | čisté |
| `npm run lint` | čisté |
| `npm test` | **5 zlyhaní / 1 791 prešlo / 0 preskočených** |
| `npm run build` | prejde |
| `npx playwright test` | **18/18** |
| migrácia 0013 | aplikovaná na produkčnú schému |

Tých 5 zlyhaní sú testy práv `chmod 400`, ktoré na Windows technicky nejdú.
Pred šprintom sa buď 111 testov preskakovalo, alebo si balík sám mazal schému
(kolísalo 9 → 39 → 54 → 56). Teraz beží všetko a výsledok je stabilný.

### Akceptačné kritériá

| # | Stav |
|---|---|
| 1. katalóg 41 082, tempo pod stropom, pokračovanie | **čiastočne** — kód aj migrácia hotové a otestované (dvojdňový beh dokázaný testom), ale živý beh proti shopu ešte neprebehol |
| 2. stav bez logov a bez DB | **splnené** |
| 3. každé zamietnutie s dôvodom a ďalším krokom | **splnené** |
| 4. prepnutie `pilot → plny` je nájditeľné | **splnené** |
| 5. zľava na ~150 reálnych produktov na eshope | **nesplnené** — čaká na dva kliky s heslom |
| 6. expirácia kľúča sa rieši z obrazovky | **splnené** |
| 7. testy, typecheck, lint, audit | **splnené** |
| 8. overenie v prehliadači + screenshoty | **splnené** — `screenshots/v13-*.png` |
| 9. invarianty doložené testami | **splnené** — I1, I3, I7, I8', I10, I13, K1 |

### Čo ostáva a prečo

- **Dva kliky s heslom** (kritérium 5): prepnutie do plného rozsahu a zapnutie
  `WRITES_ENABLED`. Robí ich človek, appka ich robiť nesmie.
- **Živý beh katalógu** (kritérium 1): spúšťač má 20-hodinový odstup, počas
  šprintu sa netrafil. Overí sa sám pri ďalšom behu.

### Odložené nálezy z review — dorobené (12. 8. 2026)

Osem bodov, ktoré review označila ako neblokujúce a šprint ich odložil. Každý
najprv padajúcim testom, potom oprava; brána zelená (1 816 prešlo, 5 známych
Windows `chmod 400`, `npx playwright test` 20/20, build prejde).

| # | Nález | Čo sa zmenilo |
|---|---|---|
| 1 | Nečitateľné počítadlo čítaní sa nedalo odlíšiť od minutého rozpočtu — jedna chyba DB zamrazila katalóg na 24 h a nepustil ho ani `restart` | `syncCatalog()` berie `known === false` ako prechodnú chybu (`read_budget_unknown`), nezapisuje `paused_until`; `syncStatus()` z domnienky nerobí `waiting: 'daily_budget'` ani odhad |
| 2 | Po každom dokončenom prechode karta hlásila „0 chýba" vedľa „382 stránok ostáva, ešte 2 dni" | `CatalogSyncStatus.refreshing` rozlišuje obnovu od prvého napĺňania; karta v Produktoch aj riadok na Prehľade hovoria to isté (snímky `screenshots/katalog-obnova-*.png`) |
| 3 | Dva odhady dočítania v jednom paneli, líšili sa o deň | Jediná formula `readDaysNeeded()`; prekážka použije číslo, ktoré už spočítal `syncStatus()`. `anonReadDaysNeeded()` zrušená |
| 4 | `catalog_incomplete` čakala bez `clearsAt` (bod 3 hlavičky modulu) | Prekážka nesie odhad dokončenia; plošný invariant testuje OBA smery pravidla |
| 5 | `errorCode()` vracal hlášku knižnice, hoci doc aj migrácia 0013 sľubujú kód | `local_${name}` ako v `sales-sync`; test dokazuje, že sa do `last_error` nedostane text s prihlasovacími údajmi DB |
| 6 | „Druhý súbežný beh sa odmietne" nebolo zaručené cez dva module grafy | DB advisory lock `ovl_zliav_catalog_sync` nad in-process `running`; `lastCatalogRun()` je priznane best-effort |
| 7 | `POST /api/queue/resume` bez `rateLimit` pri ~200 zápisoch na volanie | `limit: 6 / 60 s` |
| 8 | `syncStatus()` bral štyri spojenia z poolu naraz | Dotazy idú po jednom (test meria súbežnosť) |

### Poznámka ku kontraktu

Bod P4 tvrdil, že appka je tmavá. **Nie je** — je svetlá, s hornou navigáciou
a farbami Aura teal + gold. Zistilo sa to až zo snímky. Na výsledok to nemalo
vplyv: zákaz meniť tému platil tak či tak a agenti ho dodržali.
