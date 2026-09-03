# Kontrakt — Aura Zľavy V7: čitateľný Prehľad

Vetva: `feat/v7-prehlad` · Zadal: Samuel, 3. 9. 2026 (31 otázok, 8 dávok)

> **Hades nebol dostupný** (`ConnectionRefused`, predtým `401`), takže kontext
> nie je z pamäte, ale z disku a z kódu. Všetko nižšie je zmerané alebo
> prečítané, nič zapamätané.

---

## 1. Prečo

V6 zjednotil vzhľad. Samuel ho preklikol a povedal: **„nie je to čitateľné
a prehľadné"**. Na otázku čo presne označil **všetky štyri** ponúknuté
príčiny — nízky kontrast, priveľa vecí na obrazovke, splývajúce panely,
malé písmo a slabé čísla. V7 preto nemení jazyk dizajnu, mení **čitateľnosť
a rozvrh jednej obrazovky**.

## 2. Tri veci, ktoré zadanie nemohlo vedieť

Samuel si vyžiadal KPI **„obrátkovosť tovaru za 90/180/360 dní"**. Pri čítaní
kódu sa ukázalo:

1. **„Obrátkovosť" je v tomto repe zakázané slovo.** `test/unit/sales-insights.spec.ts`
   ho brání ako meno metriky, premennej aj vzorca, pretože zásoba z `getFull`
   je **jedna momentka, nie priemer za obdobie** — účtovnú obrátkovosť
   (`Ø zásoba × dni / COGS`) z nej spočítať nemožno. Existuje `soldPerStock`
   (predané za okno ÷ dnešný sklad, `N×`), čo je **iná veličina s iným
   významom**.
2. **Okná 180 a 360 dní sa nedali naplniť.** `SALES_WINDOW_DAYS` má
   v `src/env.ts:107` strop **90** (default 3), kým `SOLD_WINDOWS` ponúka
   `[30, 60, 90, 180, 360]`. Filter teda sľuboval okná, za ktorými nikdy
   nemohli byť dáta — presne pasca D125 („filter bez dátového zdroja je sľub,
   ktorý appka nedodrží").
3. **Appka vie o zľave len to, čo sama zapísala.** `discountedNow` je
   momentka podľa **vlastného** zápisu; zľava nastavená ručne v administrácii
   eshopu je pre ňu neviditeľná. Dvojkrivka „v zľave vs. bez zľavy" by preto
   deň s ručnou zľavou počítala ako „bez zľavy" — a to nie je nepresnosť, to
   je nepravda.

Samuel na všetky tri odpovedal a rozhodnutia sú v §3.

## 3. Rozhodnutia (31 odpovedí, 3. 9. 2026)

| # | Rozhodnutie | Dôvod |
|---|---|---|
| **D148** | KPI karta nesie **`soldPerStock` ako `N×`** a volá sa **„Predané na sklad"**, nie obrátkovosť. | Voľba Samuela. Je to číslo, ktoré appka naozaj má, a odpovedá na tú istú otázku (ako rýchlo sa tovar hýbe) bez zakázaného slova. |
| **D149** | **`SALES_WINDOW_DAYS` strop 90 → 360** (`src/env.ts`). | Voľba Samuela. Bez toho sú dve z troch jeho okien trvalo prázdne. **Cena je reálna:** dočítať 360 dní objednávok stojí kvótu a pôjde to po dňoch, nie naraz — koľko presne, sa nedá povedať, lebo počet objednávok za deň nie je zmeraný (otvorená položka K9 z V5). |
| **D150** | **Referencia je hlavný identifikátor**, EAN má vlastný stĺpec a hľadá sa podľa neho. | Voľba Samuela. Podľa referencie sa produkt hľadá v sklade aj v administrácii; EAN je pre čítačku. |
| **D151** | Neobohatený produkt: **pomlčka + `#id` stlmene**. | Voľba Samuela. Riadok bez akéhokoľvek identifikátora sa nedá priradiť ani nahlásiť. Je to dnešný `productNameCell()`. |
| **D152** | Prehľad má **štyri sekcie**: KPI riadok · line chart · tabuľka · bežiace zľavy. Stavový pás a poistky **odchádzajú na Nastavenia**. | Voľba Samuela. Šesť sekcií bolo „priveľa vecí na obrazovke“; bežiace zľavy si nechal, prekážky nie. |
| **D153** | Karta a panel majú **výraznejšie pozadie + 1 px linku**, žiadne tiene. | Voľba Samuela. Tieň je v tmavej téme takmer nevidieť, takže by štruktúra zmizla práve tam, kde je potrebná. |
| **D154** | **KPI číslo ~40 px**, tabulárne číslice, popisok nad ním malý a tlmený. | Voľba Samuela. „Slabé čísla“ bola jedna zo štyroch príčin. |
| **D155** | **DVA prepínače okna**: jeden pre KPI (a s ním ide tabuľka), jeden pre graf. | Voľba Samuela — proti môjmu odporúčaniu jedného. Tabuľka ide s KPI, pretože stĺpce „predané za okno“ a „predané/sklad“ sú TÁ ISTÁ veličina, akú nesie tretia karta; tabuľka je jej rozpis. |
| **D156** | Line chart: **predané kusy za deň**, **tri krivky** — v zľave · bez zľavy · **nevieme, či bola**. | Voľba Samuela. Tretia krivka je odpoveď na §2 bod 3: do nej padne každý deň pred prvým zápisom appky. Bez nej by graf tvrdil, čo nevie. |
| **D157** | Nesťahovaný deň: **medzera v čiare + šrafované pozadie**. Legenda hore, tooltip so všetkými tromi (krivka „nevieme“ má v ňom **pomlčku, nie nulu**). Mriežka len vodorovná, tlmená; základňa osi vždy nula. | Voľba Samuela. Jednodenná medzera na osi 360 dní je takmer nevidieť — druhý kanál je preto povinný. |
| **D158** | Graf **~300 px** (token `--chart-h`). | Voľba Samuela. Pod grafom musí byť vidno prvé riadky tabuľky. |
| **D159** | Tabuľka: **deväť stĺpcov** — referencia · názov · cena · zľava v shope · predané za okno · predané/sklad · sklad · marža · EAN. Riadok **~40 px**, písmo **13 px**, prilepená hlavička a prvé dva stĺpce. | Voľba Samuela (vybral všetky štyri skupiny stĺpcov). O 4 px vyšší riadok než V6 a písmo z 12 na 13 — „malé písmo“ bola jedna zo štyroch príčin. |
| **D160** | Filtre: hľadanie (názov + referencia + EAN) · stav zľavy · pásmo predaných · **kategória, kov, typ šperku VIDITEĽNE ZAMKNUTÉ s dôvodom**. | Voľba Samuela (vybral aj tie tri zamknuté). Zamknuté sa **nekreslia ako funkčné** — zdroj v zrkadle nemajú (`locked-dimensions.ts`) a filter bez dát je sľub, ktorý appka nedodrží. |
| **D161** | **50/100 riadkov**, číslovaný stránkovač. | Voľba Samuela. 200 zobral späť už V4: route KPI má strop `MAX_KPI_IDS = 100`, takže širšia strana znamená riadky bez KPI. |
| **D162** | Triedenie **klikom na hlavičku, tri stavy** (vzestupne → zestupne → zrušené), `aria-sort`. | Voľba Samuela. Bez tretieho stavu sa človek nedostane k pôvodnému poradiu. |
| **D163** | **Riadok na Prehľade NIE JE klikateľný.** Produkty zostávajú pracovnou obrazovkou (detail, výber, obohacovanie strany). | Voľba Samuela. Prehľad je na čítanie; druhá plná kópia tabuľky by sa o mesiac rozišla s prvou. |
| **D164** | **Kontrastný cieľ 7 : 1 pre VŠETOK text**, v oboch témach. Strážny test sa prepíše zo 4,5 na 7. | Voľba Samuela. Overené výpočtom, že to ide: `--dim` sa posunie z `#8b919b` na ~`#9ca0a6` (tmavá) a z `#63696f` na ~`#505458` (svetlá); `--ink2` už dnes dáva 10,78 a 9,00. **Dôsledok, ktorý treba uniesť:** odstup medzi hlavným a tlmeným textom sa zmenší, takže hierarchiu musí viac niesť VEĽKOSŤ a ŤAHA písma, nie farba. |
| **D165** | Tmavá téma zostáva predvolená, akcent zostáva **teál**, stav zľavy nesie **značku + slovo, farba je tretia**. | Voľba Samuela. Zlatá ako akcent bola odmietnutá správne — má vyhradenú úlohu značky a ako text je nedostatočne kontrastná. |
| **D166** | Redizajn **prepíše dnešný Prehľad** (`/`), vetva `feat/v7-prehlad`. | Voľba Samuela. Dva Prehľady vedľa seba by znamenali piatu položku v navigácii a dvojkolajnosť. |

## 4. Čo je NEDOTKNUTEĽNÉ (nesie sa z V6 §4)

1. **Priznania „nevieme"** — pomlčka, `≥`, vety o nesťahovaných dňoch (I11).
   V7 ich pridáva, neuberá: tretia krivka grafu je nové priznanie.
2. **Dry-run a potvrdenie** (I3). Prehľad na zápisovú cestu nesiaha vôbec.
3. **Pravidlo troch kanálov** — farba + značka + slovo.
4. **Slovenské UI texty.**

## 5. Rozsah NIE

- Obrazovky Produkty, Zľavy, Nová zľava, Nastavenia (okrem presunu stavového
  pásu a poistiek tam).
- Účtovná obrátkovosť v akejkoľvek podobe (D148).
- Tretí prepínač okna pre tabuľku · nekonečné rolovanie · klikateľný riadok
  na Prehľade · zlatá ako akcent · svetlá téma ako predvolená.

## 6. Riziká

- **R1 — 7 : 1 zúži farebnú hierarchiu.** Ak sa po prepnutí ukáže, že tlmený
  a hlavný text sú na oko rovnaké, riešenie je veľkosť a ťaha, **nie vrátenie
  kontrastu**. Strážny test na 7 : 1 to má zabetónovať.
- **R2 — niektorý pár 7 : 1 nemusí uniesť.** Farby ako TEXT (`--gold-text`,
  `--success-text`, `--danger-text`, `--warn-text`) sú na svojich tónoch dnes
  tesne nad 4,5. Ak sa niektorý na 7 nedá dostať bez toho, aby stratil
  význam, **napíše sa to ako NESPLNENÉ s číslom**, nekritérium sa neupraví.
- **R3 — 360 dní objednávok je dlhý beh.** D149 zdvihne strop, ale dočítanie
  histórie potrvá a spotrebuje kvótu. Kým sa nedočíta, karty a graf budú mať
  `≥` a šrafovanie. To nie je chyba dizajnu.
- **R4 — appka je bez `shop_write` kľúča a IP je zabanovaná.** Prehľad musí
  vyzerať dobre s pomlčkami vo väčšine buniek. Kreslí sa pre prázdny stav ako
  pre bežný.
- **R5 — v inej session bežia tri úlohy nad tým istým repom**
  (`task_5529e4de` preview route, `task_52dc1ac5` šrafovanie v krivke detailu
  produktu, `task_4c964bcf` mŕtvy `chart-hover.ts`). Druhá z nich sa dotýka
  grafov, teda **toho istého, čo V7**. Pri konflikte platí V7 a ich zmena sa
  zlúči ručne — nie naopak.

## 7. Akceptačné kritériá

| # | Kritérium | Ako sa dokazuje |
|---|---|---|
| K1 | Kontrast **≥ 7 : 1** pre všetok text v OBOCH témach | prepísaný `dizajn-kontrast.spec.ts`; pár, ktorý to neunesie, je vymenovaný s číslom |
| K2 | Prehľad má **štyri sekcie**, stavový pás a poistky sú na Nastaveniach | test + preklik |
| K3 | KPI karta „Predané na sklad" nesie `N×`; slovo „obrátkovosť" v kóde ani v UI **nie je** | grep-test, ktorý už existuje |
| K4 | Tri KPI karty majú **trojstavovosť** — hodnota / pomlčka / `≥` | mutačne overený test |
| K5 | Graf má **tri krivky** vrátane „nevieme"; nesťahovaný deň je medzera + šrafovanie; tooltip má pri „nevieme" pomlčku, nie nulu | test na TELE DÁT, nie na modeli |
| K6 | Tabuľka: 9 stĺpcov v poradí D159, riadok ~40 px, písmo 13 px, prilepená hlavička + 2 stĺpce, riadok neklikateľný | test + preklik |
| K7 | Tri zamknuté filtre sú **viditeľne zamknuté s dôvodom**, nie funkčné; zoznam sa berie z `locked-dimensions.ts` | test, ktorý padne pri rozchode |
| K8 | Triedenie má tri stavy a `aria-sort` | test |
| K9 | `SALES_WINDOW_DAYS` prijme 360 a nikde nie je napísané ručne | test + grep |
| K10 | Štyri nedotknuteľné veci (§4) prežili | mutačne overené |
| K11 | Žiadne mŕtve `.ovl-*` po prepísanom Prehľade; CSS-ako-text strážca zelený | `css-moduly-strazca.spec.ts` |
| K12 | Celý balík zelený v izolácii, žiadny nový `.skip` | výstup v reporte |
| K13 | **Samuel preklikol a potvrdil, že je to čitateľné** | jeho slovo. Screenshoty skúsim (jeho voľba), ale dôkaz je preklik. |

## 8. Výsledok

### K1 — kontrast 7 : 1 (3. 9. 2026)

**SPLNENÉ s jednou pomenovanou výnimkou.** `test/unit/dizajn-kontrast.spec.ts`
meria hranicu **7 : 1** a je zelený. Meria sa **7319 párov na tému nad 26
plochami** (do V7: 2656 párov nad desiatimi). Najhorší textový pár je
**7,12 : 1** v tmavej (biele písmo na `--st-critical-fill`) a **7,19 : 1**
v svetlej (pruh PRODUKCIA).

**NESPLNENÉ — jedna farba 7 : 1 neunesie a je to zmerané, nie zamlčané:**
značkový teal svetlej témy (`--deep` = `#007278`, na ktorý ukazujú `--accent`
aj `--brand`). Ako TEXT má na najhoršej ploche svetlej témy **4,60 : 1**, ako
PLOCHA pod bielym písmom **5,71 : 1**. Obe sú nad WCAG 1.4.3 (AA), ani jedna
nedosiahne 7 : 1 (AAA). Dotknutých je **218 párov, všetky v svetlej téme**
(v tmavej je uvoľnených nula). Kritérium sa NEZNÍŽILO: `HRANICA_TEXT` je
stále 7 a výnimka je viazaná na FARBU, nie na zoznam selektorov, plus nesie
dva prepočítané dôkazy (§10a, §10b), ktoré sčervenajú, keď taký teal začne
existovať. Dôvod je kolízia s farbosleposťou: na 7 : 1 sa teal dostane až pri
~`#005156` a tam padne pod ΔE 8 od troch stavov (`paleta.spec.ts`). Vyhráva
značenie — farba, ktorú časť ľudí nerozlíši od stavu, je horšia než farba,
ktorá sa horšie číta.

**Zatvorená diera, ktorú našla verifikácia V6c:** plochy boli RUČNÝ zoznam
desiatich položiek, kým appka ich má 26 — sedem plôch nieslo text, ktorý sa
nemeral ani raz. Odteraz sa plochy ODVODZUJÚ z CSS (94 pravidiel kreslí
plochu; 51 sú plochy stránky, 10 sa meria farbou svojho základného stavu alebo
predka, 35 párov pridávajú pravidlá potomkov, 33 je menovaných ako kresba bez
textu — každé s dôvodom a s tvrdením, že naň naozaj nikto text nepíše).
Nezaradená plocha padne v teste, nie o mesiac na obrazovke.

**Čo to stálo (a čo sa preto nesmie „zjednotiť" späť):** stavové tinty zo 14 %
na 10 % (nečinná z 12 % na 9 %), značková tinta z priesvitnej na plnú,
`--st-critical-press` a `.btn.primary:hover` miešajú k `--ink` namiesto
k `--mix-shade`, `<code>` v pruhu PRODUKCIA je tmavý čip namiesto svetlého.
Všetky štyri boli pod hranicou a ani jednu žiadny test predtým nemeral:
4,31 : 1 (stlačené červené tlačidlo v tmavej téme), 5,33 : 1 (čip v pruhu),
6,76 : 1 (tlmený text na tinte), 6,85 : 1 (biele písmo na hoveri značky).

### Ostatné kritériá (dopísané 3. 9. 2026 — agent `dokaz-a-kontrakt` padol na `529 Overloaded`, takže toto je moje meranie)

**Balík:** `npm run typecheck`, `npm run lint` a `npm run check-compose-bind`
čisté, **243 súborov / 5111 testov zelených v izolácii** (pred V7 236/4912,
teda **+199 tvrdení**).

| K | Stav | Čím sa to dokázalo |
|---|---|---|
| K2 | **áno** | Na ŽIVOM DOM-e (`localhost:3070`) sú sekcie `overview-kpi` · `discount-split` · `overview-products` · `overview-campaigns`. Stavový pás a poistky sú na `/nastavenia/co-smie#stav`. |
| K3 | **áno** | Karty: „Produktov v katalógu" · „V zľave" · **„Predané na sklad"**. Slovo „obrátkovosť" v kóde ani v UI nie je a grep-test má v zozname aj nové súbory V7. |
| K4 | **áno, mutačne** | Na živej appke ukazuje „Predané na sklad" **pomlčku** a `— zmenu nevieme` (kľúč chýba, R4). Mutácia pomlčka → `0` zhodí 4 tvrdenia zo 4323, nie plošne súbor. |
| K5 | **áno, mutačne** | Legenda má **tri** položky: `v zľave` · `bez zľavy` · `nevieme, či bola`, plus `nesťahované, predaj nepoznáme`. Tabuľková alternatíva pre čítačku má stĺpce `Deň · v zľave · bez zľavy · nevieme, či bola · Poznámka` — overené na DOM-e. Mutácia medzera → nula zhodí **15** tvrdení, pomlčka v tooltipe → nula **4**. |
| K6 | **áno** | Na živom DOM-e **všetkých deväť stĺpcov v poradí D159**: REFERENCIA · NÁZOV · CENA · ZĽAVA V SHOPE · PREDANÉ 30 D · PREDANÉ / SKLAD · SKLAD · MARŽA · EAN. Referencia je pri neobohatených **pomlčka** (D151). Riadok neklikateľný. |
| K7 | **áno** | Tri zamknuté rozmery (kategória, kov, typ šperku) sú na obrazovke **viditeľne zamknuté s dôvodom**, nie funkčné; zoznam odvodený z `locked-dimensions.ts`. |
| K8 | **áno** | `CENA` a `PREDANÉ 30 D` nesú v prístupnom mene `ZORADIŤ`; triedenie má tri stavy. |
| K9 | **áno** | Strop je `MAX_SALES_WINDOW_DAYS`, odvodený z jedného zoznamu (`src/lib/sales/windows.ts`). Číslo 360 nie je napísané ručne ani raz — a zmizli pritom **dve tiché kópie** tej istej vedomosti (`ALLOWED_SOLD_WINDOWS` v repozitári a `MAX_KPI_WINDOW_DAYS = 400` v `insights.ts`). |
| K10 | **áno, mutačne** | Pomlčka → nula (4 pady) · stav bez značky aj slova (3) · veta o nesťahovaných dňoch → prázdna (1) · `≥ N` → obyčajné číslo (5). Každá zhodila **správne** tvrdenie. |
| K11 | **áno** | `css-moduly-strazca.spec.ts` zelený. |
| K12 | **áno** | 243/243 · 5111/5111 v izolácii, žiadny nový `.skip`. |
| K13 | **NESPLNENÉ — čaká na Samuela** | Screenshoty sa **podarili** (obe témy, `760×1300`) a sú v konverzácii. Dôkaz čitateľnosti je ale jeho preklik, nie môj screenshot — a toto kritérium sa preškrtnúť nemá. |

**Overil som, že výnimka pre teál nie sú zadné dvierka:** keď som oslobodenú
farbu skúsil použiť v TMAVEJ téme, test **aj tak padol**. Je zúžená na svetlú.
Rovnako pokazenie `--dim` v tmavej zhodí test s konkrétnymi pármi a číslami
(3,85 · 3,29 · 3,42) — nie plošne.

### Čo som pri prekliku videl a nesedí mi (nález, nie chyba)

**Tri zamknuté filtre zaberajú deväť riadkov textu.** Každý má vlastný
dvoj- až trojriadkový odsek s takmer rovnakou vetou („appka na tento rozmer
nemá dáta v zrkadle katalógu…"), takže nad tabuľkou stojí stena textu, ktorá
hovorí trikrát to isté. Samuel označil **„priveľa vecí na obrazovke"** ako
jednu zo štyroch príčin nečitateľnosti — a toto ju pridáva, nie uberá.
Návrh: JEDEN zamknutý pás s tromi menami a JEDNOU vetou. Nechal som to tak,
lebo je to zmena rozsahu, nie oprava chyby.

**Vedľajšia poznámka:** hlavička hlási `Zápisy 0/200 dnes`. Nie je to chyba —
`daily_write_budget` je nastavenie a 200 je jeho uložená hodnota. Kvóta shopu
je od 1. 9. 2026 **1000**, takže sa dá zdvihnúť v Nastaveniach.

## 9. Čo preklikať

`http://localhost:3070/` — **`localhost`, nie `127.0.0.1`** (HSTS, dôvod
v README). Prihlásenie neexistuje.

**Najprv toto, inak budeš hlásiť ako chyby veci, ktoré chybami nie sú.** Appka
je bez `shop_write` kľúča a IP je zabanovaná shopom:

- **Karta „Predané na sklad" je pomlčka**, pod ňou `— zmenu nevieme`. Pomlčka
  je odpoveď „nevieme", nie prázdno a nie nula.
- **Stĺpec REFERENCIA je celý pomlčky** — referencia aj EAN sú v zrkadle len
  pri obohatených produktoch a obohacovanie bez kľúča nebeží.
- **Graf je takmer celý šrafovaný** a nesie vetu s číslom, koľko dní okna sa
  nesťahovalo. Šrafovanie znamená „toto sme nemerali".
- **Krivka „nevieme, či bola"** pokrýva celé okno, lebo appka ešte nezapísala
  žiadnu zľavu — o žiadnom dni teda nemôže tvrdiť, či v ňom zľava bola.

Čo je NOVÉ oproti V6:

1. **Kontrast.** Tlmený text už nie je sivý na sivom. Ak sa ti teraz zdá, že
   hlavný a tlmený text sú **priveľmi podobné**, je to predpovedaný následok
   (R1) a rieši sa veľkosťou a ťahou písma, **nie vrátením farby** — povedz to
   a upravím typografiu.
2. **Štyri sekcie namiesto šesť.** Prekážky odišli na `/nastavenia/co-smie#stav`;
   na Prehľade zostal **jeden tichý riadok** so slovom, značkou a odkazom
   „Stav a prekážky".
3. **Panely majú hranicu a vlastné pozadie** — karta je zjavne svetlejšia než
   stránka, žiadne tiene.
4. **Dva prepínače okna:** `Okno predaja` (30/60/90/180/360) nad kartami platí
   pre karty **aj tabuľku** a je to pri ňom napísané; graf má vlastný (7/30/90).
5. **Tabuľka má deväť stĺpcov** vrátane EAN a marže, riadok 40 px, písmo 13 px.
   Široká je zámerne — roluje sa **vnútri** svojho rámu, telo stránky nie.
6. **Tri zamknuté filtre sú vidieť aj s dôvodom.** Vyžiadal si ich; funkčné
   nie sú, lebo zrkadlo pre ne stĺpec nemá.

**Prepínač témy** je vpravo v hlavičke. **Svetlú tému som prvýkrát videl dnes**
pri tomto prekliku — screenshot je v konverzácii, ale posúdiť ju musíš ty.
Prejdi Prehľad v oboch témach.
