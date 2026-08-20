# Aura Zľavy V3 — informačná architektúra a dátový model

**Zdroj pravdy:** `docs/40-ODPOVEDE-V3.md`. Kde si čokoľvek iné (design/mockups/,
docs/32, docs/33) odporuje s týmto dokumentom, platí tento dokument.

**Kontext, ktorý určuje všetko:** katalóg má 40 483 produktov, jedna zľava sa
nastavuje na 5–10 tisíc naraz, `setReduction` je 1 request na produkt, limit
20/min + 200/UTC deň. Zápis preto nie je akcia, ale **fronta bežiaca týždne**.
Používateľ zlacňuje **to, čo sa nepredáva**.

Tento dokument je záväzný pre E1–E7. Čísla v ňom sú **kanonické** — žiadny
mockup si nesmie vymyslieť vlastné.

---

## 0. Pravidlá, ktoré platia na každej obrazovke

Vychádzajú zo štyroch zákazov (odpoveď 100). Sú testovateľné, nie dekoratívne.

| # | Pravidlo | Ako sa kontroluje |
|---|---|---|
| P1 | **Jedna dominanta na obrazovku.** Presne jeden prvok je vizuálne najväčší. | Zmeraj: druhý najväčší prvok má max. 55 % veľkosti dominanty. |
| P2 | **Žiadne vysvetľujúce odstavce.** Pod nadpisom sekcie nie je veta „tu vidíte…". | Žiadny `<p>` dlhší ako 90 znakov mimo rozkliku. |
| P3 | **Žiadny žargón.** Zakázané na povrchu: `needs_key`, dry-run, allowlist, I3, D28, `setReduction`, HTTP kódy, názvy tabuliek, ID produktov v hlavných stĺpcoch. | Grep cez `design/v3/*.html`. |
| P4 | **Obrazovka sa zmestí.** Max. 1 „obrazovka a pol" pri 1440×900; skroluje **len** dátová tabuľka vo vlastnom ráme. | Vizuálna kontrola PNG. |
| P5 | **Max. 4 sekcie na obrazovku.** Piata musí ísť pod rozklik alebo na iný tab. | Počítanie. |
| P6 | **Technika pod rozklik.** Kódy, ID, raw odpovede, presné časy pokusov → `<details>` s neutrálnym názvom („Technický detail"). | — |
| P7 | **Odhady sú označené.** Znak `≈` + tlmenejší odtieň. Nikdy nie v rovnakom štýle ako merané číslo. | — |
| P8 | **Appka nehodnotí kauzalitu.** Žiadne „zľava priniesla +18 %". Len čísla vedľa seba. | — |

### Zápisník ohnutí pravidiel

P3, P7 a P8 sú nedotknuteľné a v tejto tabuľke sa neobjavia nikdy. P1, P2, P4
a P5 sa ohnúť smú — ale nie ticho. Kto ich ohne, dopíše sem riadok, a v riadku
musí stáť CENA: merateľná podmienka, pri ktorej výnimka padá.

| Dátum | Pravidlo | Obrazovka | Dôvod |
|---|---|---|---|
| 13. 8. 2026 | **P4, P5** | chróm — stavový pruh | Pruh je chróm, nie sekcia: do výšky obrazovky ani do počtu sekcií sa nepočíta (kontrakt UI, bod 1). Cena za výnimku je tvrdá a merateľná — **jeden riadok, 32 px, najviac štyri veci**. Keby pruh potreboval piatu vec alebo druhý riadok, výnimka padá a stáva sa z neho sekcia so všetkými dôsledkami. |
| 13. 8. 2026 | **P4** | chróm — výzva „len na čítanie" | Pri chýbajúcom alebo expirovanom kľúči pribúda pod pruh štvrtý riadok chrómu s odkazom na opravu (D10). Nie je to opakovanie menovky v pruhu: pruh hlási fakt, výzva ponúka akciu, ktorou sa fakt zmení. Kým kľúč platí, chróm sú tri riadky. |
| 18. 8. 2026 | **P4, P5** | Produkty — bočný panel detailu | Zadanie žiada „všetky údaje vypísané", takže panel má päť blokov (predané kusy ako dominanta · prekážky · údaje o produkte · zľavy podľa vlastných zápisov · zatiaľ nedostupné) a je vyšší než obrazovka. Cena za výnimku je merateľná: panel je **prekryv 400 px so svojím vlastným skrolom**, obrazovka pod ním sa nehýbe a tabuľka ostáva dominantou. Zamknuté riadky sa nedajú vynechať — z chýbajúceho riadku sa nedá zistiť, že tá informácia existuje, a práve to je dôvod, prečo panel vznikol. Keby panel prestal byť prekryvom alebo posunul obsah stránky, výnimka padá. |
| 18. 8. 2026 | **P4** | Nastavenia — podstránka „Čo smie robiť a koľko toho smie" | Nastavenia sa rozpadli z jednej stránky (12 sekcií, 4,7 obrazovky) na rozcestník so štyrmi kartami a štyri podstránky. Tri z nich sú pod hranicou; táto má tri sekcie a pri 1440×900 meria **1,8 obrazovky**. Rozdeliť ju na dve by znamenalo piatu kartu, a rozsah so zápismi a rozpočtami patria k sebe: sú to tri odpovede na jednu otázku „prečo appka zapíše práve toľko". Cena za výnimku je merateľná — **tri sekcie a ani jedna štvrtá**, každá s technickým detailom pod rozklikom. Keby pribudla štvrtá sekcia, výnimka padá a rozpočty idú na vlastnú podstránku. |
| 19. 8. 2026 | **P4, P5** | Nastavenia — podstránka „Čo sa už stalo a ako appku zastaviť" | Päť sekcií (História · Diagnostika · Zamknuté funkcie · Poistky · Odhlásenie) a pri 1440×900 **1,6 obrazovky**. Šiesta karta na rozcestníku by rozbila „štyri otázky, štyri stránky" (kontrakt UI, bod 13), a história, diagnostika aj brzdy sú jedna otázka: „čo sa stalo a ako to zastavím". Cena za výnimku je merateľná — **audit tabuľka skroluje vo vlastnom ráme (340 px)** a každá sekcia má techniku pod rozklikom. Keby pribudla šiesta sekcia, výnimka padá. |
| 20. 8. 2026 | **P2** | päť obrazoviek — veta o vypnutých zápisoch (`lib/status/blockers.ts`, prekážka `writes_disabled`) | Veta „Zápisy do shopu sú vypnuté — appka teraz nezapíše ani jeden produkt, **nech je vo výbere čokoľvek**." má **96 znakov, teda 6 nad limitom P2**. Skracuje sa jedine odtrhnutím poslednej časti — a práve tá časť je dôvod, prečo veta existuje: bez nej používateľ prečíta „nezapíše ani jeden produkt" ako dôsledok svojho VÝBERU, zúži ho a stlačí Zaradiť znova. Vypnuté zápisy pritom nie sú vlastnosť výberu, ale konfigurácie počítača, a z obrazovky sa prepnúť nedajú (I13). Šesť znakov je menšia cena než opakovaný pokus o zápis do ostrého eshopu. Cena za výnimku je merateľná — **výnimka platí pre túto JEDNU vetu a len kým `WRITES_ENABLED=false`**. Keby sa veta rozrástla nad 96 znakov, alebo keby si niekto to isté ohnutie vypýtal pre druhú vetu, výnimka padá a veta ide pod rozklik. |
| ~~18. 8. 2026~~ | ~~**P4**~~ | ~~Produkty — ľavý panel filtrov~~ | Pribudla skupina „Stav v eshope" (tri možnosti) a podmienená skupina „Odkiaľ je riadok". Ľavý stĺpec tým narástol pod hranu 900 px. Cena za výnimku: **skupiny sú riadkové voľby bez kariet a bez vysvetliviek**, a „Odkiaľ je riadok" sa kreslí len vtedy, keď obrazovka riadky naozaj filtruje. Dominantou obrazovky zostáva tabuľka. **ZRUŠENÁ 19. 8. 2026** — po zjednotení zamknutých filtrov do jednej skupiny (D9) meria panel pri 1440 px **772 px**, teda pod hranou 900 px. Výnimka už nie je na čo. Riadok zostáva ako záznam, nie ako povolenie. |

### Spoločná hlavička (na každej stránke identická)

Jeden riadok, výška 56 px, sticky:

```
[Aura Zľavy]   Prehľad · Produkty · Zľavy · Nastavenia        Zápisy 100/200 dnes ▮▮▮▯▯   Fronta 3 420/8 000   ☾
```

- **Zápisy 100/200 dnes** — rozpočet zápisov; malý pruh. Pri vyčerpaní sa text
  zmení na `Zápisy 200/200 · pokračujem o 02:00` — **neutrálna farba, nie
  červená** (odpoveď 59: informácia, nie chyba).
- **Fronta 3 420/8 000** — súhrn všetkých bežiacich front; klik → tab Zľavy.
  Keď nič nezapisuje: `Fronta prázdna`.
- **☾** — prepínač témy. Svetlá je predvolená.
- Hlavička **neobsahuje** nič iné: žiadne vyhľadávanie, žiadne notifikácie
  (odpoveď 43: upozornenia mimo appky žiadne).

> Rozpočet zápisov sa z hlavičky presunul o riadok nižšie, do stavového pruhu
> (kontrakt UI, bod 2). V hlavičke ostáva fronta a téma.

### Stavový pruh (chróm, kontrakt UI 13. 8. 2026, body 1–5)

Jeden riadok, 32 px, pod hlavičkou. Nesie **presne štyri veci** a v tomto
poradí, vľavo:

```
✓ Ostrý zápis zapnutý · ✓ Kľúč do 09.09.2026 · ○ Zápisy 21/200 dnes ·
○ Katalóg 2 900 z 41 082                          Stav k 12:53 · [Obnoviť]
```

- **Pokojné je tiché.** Menovka v poriadku je značka a text; farebnú pilulku
  dostane výhradne to, čo si žiada pozornosť. Zelená značka pri zápisoch je
  celá odpoveď na bod 3: keď nič nebráni zápisu, **obrazovka nekreslí sekciu
  prekážok**. Či prekážka existuje, sa zisťuje jedinou funkciou
  `hasBlockers()` v `components/layout/status.ts` — nie počítaním po svojom.
- **Čo appka nevie, je pomlčka, nikdy nula.** Dôvody pomlčiek sú pozbierané do
  jedného rozkliku „Prečo —" (P6), nie na povrchu.
- **Piata vec doň nepatrí** — ani stav fronty (ten je v hlavičke), ani dôvod
  zámku tabu (ten visí pri tabe), ani rozpad rozpočtu (ten je v Nastaveniach).

### Čerstvosť dát a obnovovanie

**Nič sa neobnovuje samo** (kontrakt UI, bod 4). Čísla sa načítajú pri otvorení
obrazovky a potom až na vyžiadanie. Mechanizmus je jeden pre celú appku —
`components/layout/refresh.ts`; obrazovka si zaregistruje svoje načítanie cez
`useRefreshable()` a **vlastné tlačidlo Obnoviť nekreslí.** Jediné tlačidlo je
v stavovom pruhu a obnoví všetko naraz.

Čas sa píše vždy konkrétne (`12:53`, `14.08.2026`), nikdy relatívne
(„pred 3 minútami").

- V pruhu: `Stav k 12:53` — čerstvosť **čísel v pruhu**, čas servera.
- Na obrazovke: jeden riadok šedým 12 px **pod skupinou čísel**, ktorých sa
  týka: `Dáta k 10. 8. 03:00`. Objaví sa v Prehľade (raz), v Produktoch (raz
  nad tabuľkou) a v detaile zľavy (raz). Nikde inde.

---

## 1. Mapa obrazoviek

### Hranica Prehľad ↔ Produkty (rozhodnuté)

Obe ukazujú čísla, preto tvrdé pravidlo:

> **Prehľad odpovedá na „čo sa práve deje a ako sa darí".**
> **Produkty odpovedajú na „ktoré konkrétne kusy a aké majú čísla".**

| | Prehľad | Produkty |
|---|---|---|
| Zrnitosť | agregát celého eshopu | riadok = produkt |
| Čas | dnes / 14 dní / trend | stav a história jedného produktu |
| Tabuľka produktov | **NIKDY** | vždy |
| Predaj eshopu | **áno, graf** | **NIKDY** |
| Stav fronty | áno, hneď pod verdiktom | len v hlavičke |
| Verdikt „je všetko v poriadku?" | **áno, dominanta stránky** | **NIKDY** |
| Cieľ kliku | „pusti ma do práce" | „vyber mi tie správne kusy" |

Duplicita, ktorá je povolená a zámerná: **jedno číslo** — počet ležiakov
(11 640) — je v Prehľade ako návrh a v Produktoch ako výsledok filtra. Je to ten
istý filter, klik z Prehľadu vedie presne naň.

---

### TAB 1 — Prehľad (`prehlad.html`)

**Otázka, na ktorú obrazovka odpovedá do troch sekúnd: „je všetko v poriadku?"**
Nie „aké mám čísla". Podľa toho je vybraná dominanta.

**Dominanta:** VERDIKT — jedna veta v 44 px (`Všetko v poriadku` · `Zápis
stojí` · `Zápis čaká` · `Zapisuje sa pomalšie` · `Stav appky nevieme`).

> **Zmena z 18. 8. 2026.** Do tohto dátumu bolo dominantou číslo fronty
> `3 420 / 8 000` v 64 px (odpoveď 41). Číslo je pekné, ale odpovedá na inú
> otázku: `3 420 / 8 000` vyzerá rovnako, keď fronta beží, aj keď stojí od
> včera, takže odpoveď na „je všetko v poriadku?" sa z neho musela odvodiť
> prečítaním piatich sekcií. Dominantou je preto veta, ktorá JE odpoveďou.
> Fronta zostáva hneď pod ňou v 22 px, teda na 50 % veľkosti dominanty —
> P1 povoľuje 55 %, takže sa pravidlo neohýba, len sa mení, čo je dominantou.
> Verdikt počíta `dashboard/overview-verdict.ts` z prekážok, poistiek zápisu
> a posledného kroku fronty; „Všetko v poriadku" padne LEN vtedy, keď sa stav
> dal prečítať celý.

Sekcie (4, zhora):

1. **Stav** — dominanta. Verdikt, pod ním fronta (`3 420 / 8 000`, pruh, jeden
   riadok faktov `Hotové ≈ 2. 9. · Okno 4. 9. – 18. 9. · Dnes zapísaných
   21 z 200`) a **riadok kontrol**: posledný krok fronty, spojenie so shopom,
   čo robí katalóg, strop rozsahu. Riadok kontrol nesie VÝHRADNE to, čo nie je
   v stavovom pruhu — pruh má ostrý zápis, kľúč, rozpočet a počty katalógu.
   Vpravo stĺpec akcií: **Nová zľava** (primárne, prvý klik používateľa,
   odpoveď 25), **Detail zľavy** / **Zoznam zliav**, **Zastaviť frontu**. Po
   odstávke je primárnym tlačidlom **Pokračovať**.
   Keď fronta nebeží → namiesto čísla riadok `2 zľavy bežia · 1 pripravená ·
   2 380 zlacnených` (odpoveď 42, pokojný stav). Keď v appke nie je ani jedna
   zľava → JEDNA VETA a JEDNO TLAČIDLO (kontrakt UI, bod 11).
2. **Prečo sa nezapisuje** / **Čo appku brzdí** — prekážky zo `/api/status`,
   všetky tri úrovne (kontrakt UI, bod 6). Kreslí sa LEN vtedy, keď aspoň
   jedna prekážka zastavuje alebo brzdí; inak sa nekreslí vôbec a celou
   odpoveďou je zelená značka v stavovom pruhu (bod 3). Farbu volí spôsob
   riešenia, závažnosť nesie SLOVO (`zastavuje zápis` · `spomaľuje zápis` ·
   `nezastavuje nič`).
3. **Zľavy** — dva stĺpce. Vľavo **Beží teraz**: 3 riadky bežiacich zliav, bez
   tabuľky, bez akcií okrem prekliku. Vpravo **Návrhy** (rozpustený agent,
   odpoveď 27): riadky typu `11 640 produktov sa 180 dní nepredalo` s tlačidlom
   `Použiť`, hore to, čo si pýta pozornosť. Návrh nie je karta ani chatbot — je
   to riadok s číslom a slovesom. Posledný riadok je zamknutá funkcia so
   zámkom a odkazom do Nastavení (vysvetlenie sa tu NEROZŠIRUJE).
4. **Predaj** — čiarový graf 14 dní s trendovou čiarou (odpoveď 85) a tri čísla
   vľavo. Nadpis hovorí `Predaj`, nie `Tržby`: appka pozná predané KUSY, sumu
   v eurách nemá odkiaľ vziať (`order/get` viaže sumu na objednávku, nie na
   položku), a nadpis nesmie tvrdiť viac než obsah.

Pod rozklik: len pomlčka. Keď sa stav fronty nedá prečítať, je na mieste čísla
`—` a dôvod je pod rozklikom `Prečo —` — rovnaký tvar, aký má stavový pruh
(kontrakt UI, bod 5). Inak Prehľad rozkliky nemá; je to prístrojová doska.

**Čo z Prehľadu 18. 8. zmizlo a prečo:** sekcia **Živý stav** (opakovala štyri
veci, ktoré od 13. 8. nesie stavový pruh — dve kópie toho istého faktu sa raz
rozídu o minútu a nedá sa povedať, ktorá klame) a sekcia **Čaká na vás**
(splynula so *Zľavami*: „čo beží" a „čo by mohlo bežať" sú dva pohľady na tú
istú vec). Prázdny stav *Prvá zľava* prestal byť sekciou a tri očíslované kroky
v ňom sa zrušili — návod patrí do rozcestníka „Čo appka vie" v Nastaveniach.
Zo šiestich sekcií sú tak štyri a v pokojnom stave tri.

---

### TAB 2 — Produkty (`produkty.html`, `produkt-detail.html`)

**Dominanta:** tabuľka. Nie filtre, nie nadpis.

Rozloženie: ľavý panel filtrov 260 px (zbalený na ikonky nie je — je stále
otvorený, hustý), zvyšok tabuľka.

- **Filtre** (odpoveď 49): obrátkovosť/ležiaky · kategória/kov/typ · cena a marža
  · sklad a história zliav. Prepínač obdobia **30 / 60 / 90 / 180 / 360**,
  predvolené 30 (odpoveď 53). Zamknuté filtre sú v zozname viditeľné, sivé,
  neklikateľné (viď §5).
- **Hľadanie**: jedno pole nad tabuľkou — názov, ID aj SKU (odpoveď 71).
- **Stĺpce** (odpoveď 58): Názov · Kategória/Kov · Predané ks (30 d) + Sklad ·
  Cena + Marža · Aktuálna zľava. Zamknuté bunky = `—` s tenkým zámkom.
- **Stránkovanie 50 / 100 / 200**, predvolených 50 (odpoveď 58), počet vľavo
  dole: `41 220 produktov`. Od 19. 8. 2026 aj **skok na stránku** (kreslí sa až
  od 8 strán) a ukazovateľ `strana 412 z 825` v pätke — bez nich sa na riadok
  30 000 nedalo nijako dostať. Virtualizácia to nerieši: v DOM nikdy nie je
  41 220 riadkov, stránkuje server.
- **Lišta výberu** (odpoveď 59): keď je niečo označené, zdola vysunie tmavý pruh:
  `Vybraných 8 000  ·  [Zlacniť]  [Uložiť filter]  [Zrušiť výber]`.
  V ňom aj `Vybrať všetkých 11 640, ktoré vyhovujú filtru`.
- **Uložené výbery** = uložené **filtre**, nie zoznamy ID (odpoveď 92). Zobrazujú
  sa ako čipy nad filtrami: `Ležiaky 180 dní`, `Striebro nad 40 €`.

**Detail produktu** (`produkt-detail.html`, odpoveď 91) — panel sprava, nie nová
stránka: názov, cena, sklad, **história predajov** (mini-graf 12 mesiacov) a
**história zliav** (zoznam: `15 % · 12. 5. – 26. 5. 2026`).
Pod rozklik: ID, SKU, čas posledného syncu, posledná odpoveď shopu.

---

### TAB 3 — Zľavy (`zlavy.html`, `zlava-detail.html`)

**Dominanta zoznamu:** prvá karta = zľava, ktorá sa práve zapisuje.

Zoznam (odpoveď 53): **bežiace a rozpísané hore, hotové dole.** Poradie stavov:
`zapisuje sa` → `beží` → `pripravená` → `skončila`. Hotové sú v tlmenej sekcii
s nadpisom `Skončené` a dajú sa zbaliť.

Riadok zľavy: názov · stav (viď §4) · počet produktov · percento alebo `3 pásma`
· okno `4. 9. – 18. 9.` · pruh, ak sa zapisuje.

**Detail zľavy** (`zlava-detail.html`), 4 sekcie:

1. **Priebeh + čo sa nepodarilo** — hore, dominanta (odpoveď 55). Pruh, číslo,
   odhad, tlačidlo `Zastaviť frontu`. Vedľa: `12 sa nepodarilo` → rozklik so
   zoznamom 12 produktov a ľudským dôvodom.
2. **Súhrn po pásmach** — 3 riadky: pásmo, pravidlo, počet, percento.
3. **Výkon** — tri uhly vedľa seba (odpoveď 86): *pred zľavou · vlani ·
   zlacnené vs nezlacnené*. Tri malé grafy v rade, žiadny záver textom (P8).
4. **Položky: len súhrn + zlyhané a podozrivé** (odpoveď 56) — nie 8 000 riadkov.
   Tabuľka má max. ~20 riadkov: zlyhané a tie, kde sa zapísané percento
   nezhoduje s očakávaným.

Pod rozklik v detaile: **audit** (odpoveď 31 — v detaile výsek, celý
v Nastaveniach).

**Nová zľava** = 3-krokový sprievodca, nie samostatný tab:
`zlava-nova-vyber.html` → `zlava-nova-pasma.html` → `zlava-nova-potvrdenie.html`.
Viď §2.

---

### TAB 4 — Nastavenia (`nastavenia.html`)

**Jedna stránka s kotvami** (odpoveď 32). Ľavý stĺpec = kotvy, pravý = obsah.
**Dominanta:** žiadne veľké číslo — dominantou je zoznam kotiev, stránka je
referenčná. (Jediná výnimka z P1: dominanta je navigačná, nie číselná.)

Kotvy, v tomto poradí:

1. **Pravidlá pre percento** — appka navrhuje percento podľa pravidiel a
   pravidlá bývajú tu (odpoveď 54). Tabuľka: podmienka → percento.
2. **Poistky** — strop produktov na jednu zľavu (predvolene 10 000) + povinné
   ručné potvrdenie (odpoveď 11).
3. **Kľúče a rozpočet** — tri kľúče oddelene: **zápis · objednávky · štatistiky**
   (odpoveď 58a), pri každom platnosť (`platí do 9. 9.`) a jeho spotreba dnes.
   Detail rozpočtu je tu, v hlavičke je len súhrn (odpoveď 59).
4. **Povolené zariadenia** — zoznam zariadení v lokálnej sieti (odpoveď 77).
5. **Zálohy** — denne + kópia do OneDrive, čas poslednej (odpoveď 82).
6. **Audit** — celý, filtrovateľný (odpoveď 31).
7. **Diagnostika** — jedno tlačidlo `Stiahnuť diagnostiku` (odpoveď 83).
8. **Zamknuté funkcie** — zoznam toho, čo čaká na API, s dôvodom (viď §5).

`WRITES_ENABLED` sa v UI **nezobrazuje ako prepínač** (odpoveď 60) — keď je
vypnutý, celá appka má v hlavičke pruh `Ostrý zápis vypnutý`.

---

### Vedľajšie obrazovky

- `prihlasenie.html` — meno a heslo (odpoveď 79). Nič viac.
- `prazdne-stavy.html` — onboarding sú **len prázdne stavy s odkazmi**, žiadny
  sprievodca (odpoveď 73). Jedna stránka, 3 varianty vedľa seba.

---

## 2. Tok „zlacniť ležiaky" — 6 klikov

Východisko: používateľ otvorí appku a chce zlacniť to, čo sa nepredáva.

| # | Obrazovka | Akcia | Klikov |
|---|---|---|---|
| 0 | Prehľad | vidí návrh `11 640 produktov sa 180 dní nepredalo` | 0 |
| 1 | Prehľad | **`Použiť`** pri návrhu (alebo `Nová zľava` → rovnaká obrazovka s predvoleným filtrom ležiakov) | **1** |
| 2 | Výber (krok 1/3) | filter je už nastavený na ležiaky; prepne obdobie 180 | **2** |
| 3 | Výber | v spodnej lište **`Vybrať všetkých 11 640`**, potom zúži stropom na 8 000 — appka ponúkne `Najhoršie ležiaky prvé, strop 10 000` | **3** |
| 4 | Výber | **`Pokračovať`** | **4** |
| 5 | Pásma (krok 2/3) | appka **už navrhla 3 pásma** podľa pravidiel z Nastavení; používateľ len skontroluje | 0 |
| 6 | Pásma | **`Pokračovať`** | **5** |
| 7 | Potvrdenie (krok 3/3) | vidí `8 000` najväčším písmom, súhrn po pásmach, vzorku 10 produktov, `≈ dopad na maržu`, a navrhnutý štart `pri 200/deň to stihnem do 2. 9., navrhujem štart 4. 9.` | 0 |
| 8 | Potvrdenie | **napíše `8000` do poľa** (nie klik) | 0 |
| 9 | Potvrdenie | **`Zaradiť do fronty`** | **6** |
| 10 | Prehľad | fronta beží, dominanta ukazuje priebeh | 0 |

**Spolu 6 klikov + 1 ručne vpísané číslo.** Nižšie sa ísť nedá bez toho, aby sa
zrušila poistka „napísať počet ručne" (odpoveď 38), ktorá je zámerná.

Skúška naprázdno (odpoveď 40) je na kroku 3/3 **sekundárne tlačidlo**
`Skúška naprázdno` vedľa primárneho: prepočíta všetko lokálne + zapíše **vzorku
na shop**. Nie je to samostatný krok ani prepínač.

---

## 3. Kanonické dáta

Dnes je **10. 8. 2026, pondelok, 11:40**. Dáta zo syncu k **10. 8. 03:00**.

### 3.1 Katalóg

| | |
|---|---|
| Produktov celkom | **40 483** |
| Z toho v nejakej zľave práve teraz | **2 380** |
| Ležiaky 30 dní (0–2 ks predané) | **19 204** |
| Ležiaky 180 dní (0 ks predané) | **11 640** |
| Sync katalógu | raz denne, 03:00 |

### 3.2 Rozpočet a fronta — odvodenie (všetko musí sedieť)

- Limit: **20 zápisov/min, 200 zápisov/UTC deň.** Reset **02:00** miestneho času.
- Fronta píše v dávkach po 20, každé 2 hodiny: sloty **02, 04, 06, 08, 10, 12,
  14, 16, 18, 20** → 10 × 20 = **200/deň.** (Rovnomerné rozloženie, nie 200
  naraz o 02:10 — necháva rezervu na ručný zásah cez deň.)
- Fronta zľavy Z-1 spustená **24. 7. 2026 o 09:47** → v ten deň stihla sloty
  10–20 = **6 dávok = 120**.
- **25. 7. – 9. 8.** = 16 plných dní × 200 = **3 200**.
- **Dnes 10. 8. do 11:40** = sloty 02–10 = 5 dávok = **100**.
- **Spolu spracovaných: 120 + 3 200 + 100 = 3 420** ✅ → pruh `3 420 / 8 000`.
- Z toho **3 408 úspešne zapísaných, 12 zlyhalo aj po treťom pokuse** → príznak
  `12 sa nepodarilo`. (Pruh počíta spracované, nie úspešné — inak by číslo
  skákalo pri opakovaniach.)
- Dnes ešte zvyšných 5 dávok = 100 → koniec dňa **3 520**.
- Zostáva **8 000 − 3 520 = 4 480**. Pri 200/deň: **11. 8. – 1. 9. = 22 dní ×
  200 = 4 400**, zvyšných **80 sa dopíše 2. 9. do 10:00**.
- **Odhad dokončenia: ≈ 2. 9. 2026.** Navrhnutý **štart zľavy 4. 9. 2026**
  (2 dni rezerva na sklz). Koniec **18. 9. 2026** (14 dní).
- Ak sa rozpočet stratí (súbežná zľava, výpadok), štart sa **automaticky posunie
  + audit záznam** (odpoveď 63).

Hlavička dnes: **`Zápisy 100/200 dnes`.**

### 3.3 Tri zľavy (+ jedna navyše, viď poznámka)

Zadanie žiada 3, ale stavov je 4. Ukazujem **4**, aby každý stav mal svoju
kartu a mockupy nemuseli nič dovymýšľať.

**Z-1 · „Ležiaky striebro — jeseň"** — stav **zapisuje sa**
- 8 000 produktov, priebeh **3 420 / 8 000**, príznak **12 sa nepodarilo**
- Fronta spustená 24. 7. 09:47 · odhad hotové **≈ 2. 9.**
- Okno zľavy: **4. 9. – 18. 9. 2026** (zapisuje sa už s týmto dátumom OD)
- Pásma:
  | Pásmo | Pravidlo | Produktov | Zľava |
  |---|---|---|---|
  | A | 0 predaných za 360 dní | 3 180 | **30 %** |
  | B | 0 predaných za 180 dní | 3 420 | **20 %** |
  | C | 1–2 predané za 180 dní | 1 400 | **15 %** |
- Priemerná cena vo výbere 46,20 € · `≈ −18 400 € marže` (odhad)

**Z-2 · „Náušnice bez pohybu"** — stav **pripravená**
- 1 240 produktov, jednotných **25 %**
- Okno **1. 10. – 15. 10. 2026**
- Riadok: `Zapisovať začnem, keď dobehne Ležiaky striebro — jeseň`
  (rozpočet sa delí, odpoveď 15 — používateľ tu vidí dôsledok, nie mechaniku)

**Z-3 · „Prstene 2024 — dopredaj"** — stav **beží**
- 640 produktov, **35 %**, okno **1. 8. – 31. 8. 2026**
- Príznak **3 sa nepodarilo** (zapísaných 637)
- Výkon: tržby zlacnených za 9 dní **4 180 €**, nezlacnených **31 720 €**

**Z-4 · „Jarná obnova skladu"** — stav **skončila**
- 2 100 produktov, 2 pásma (20 % / 10 %), okno **15. 6. – 15. 7. 2026**
- Bez príznaku zlyhaní

Súčet produktov v zľave práve teraz: 640 (Z-3) + 1 740 (zvyšky starších
jednotlivých zliav) = **2 380** ✅ zhoduje sa s §3.1. Z-1 sa **nepočíta** —
zapisuje sa dopredu, beží až od 4. 9.

### 3.4 Tržby za 14 dní (28. 7. – 10. 8. 2026), EUR

| Deň | | Deň | |
|---|---|---|---|
| ut 28. 7. | 2 940 | ut 4. 8. | 3 480 |
| st 29. 7. | 3 115 | st 5. 8. | 3 210 |
| št 30. 7. | 2 780 | št 6. 8. | 3 060 |
| pi 31. 7. | 3 640 | pi 7. 8. | 3 890 |
| so 1. 8. | 2 460 | so 8. 8. | 2 640 |
| ne 2. 8. | 2 180 | ne 9. 8. | 2 310 |
| po 3. 8. | 3 320 | **po 10. 8.** | **1 180** (do 11:40) |

- **Spolu 14 dní: 40 205 €** · 13 uzavretých dní: 39 025 € · priemer 3 002 €/deň
- Prehľad hore: **`Dnes 1 180 €`** vs **`Včera do 11:40 ≈ 1 040 €`** (+13 %)
- Trendová čiara: mierne stúpajúca, +4 % za 14 dní
- Objednávok za 14 dní: **412**, priemerná objednávka **97,60 €**

### 3.5 Vzorka katalógu — 20 produktov

Kanonická vzorka pre všetky tabuľky (Produkty, vzorka v potvrdení, položky
v detaile zľavy). Ceny v EUR s DPH. „Predané" = 180 dní. Kategória, kov a marža
sú **zamknuté** (§5) — v tabuľkách sa kreslia ako `—` so zámkom; hodnoty nižšie
sú len pre orientáciu E2–E7, do HTML sa **nepíšu**.

| # | ID | SKU | Názov | Cena | Predané 180 d | Sklad | Zľava teraz | Pásmo |
|---|---|---|---|---|---|---|---|---|
| 1 | 18342 | STR-NAU-0412 | Strieborné náušnice Lumen, kubický zirkón | 34,90 | 0 | 12 | — | A |
| 2 | 21170 | STR-PRS-1188 | Strieborný prsteň Aurora, biely opál | 49,00 | 0 | 7 | — | A |
| 3 | 9084 | STR-RET-0233 | Strieborná retiazka Ancora, 45 cm | 27,50 | 2 | 31 | — | C |
| 4 | 30512 | ZLA-PRS-0079 | Zlatý prsteň Solis 585, briliant 0,05 ct | 389,00 | 1 | 2 | — | C |
| 5 | 15903 | STR-PRI-0561 | Strieborný prívesok Nova, srdce | 22,90 | 0 | 44 | — | A |
| 6 | 27441 | STR-NAR-0305 | Strieborný náramok Vela, pletený | 41,00 | 0 | 18 | — | B |
| 7 | 33028 | ZLA-NAU-0142 | Zlaté náušnice Perla 585, sladkovodná perla | 214,00 | 0 | 3 | — | B |
| 8 | 6712 | CHI-NAR-0018 | Oceľový náramok Fortis, matný | 19,90 | 6 | 60 | 10 % | — |
| 9 | 24880 | STR-PRS-1402 | Strieborný prsteň Mira, ametyst | 38,50 | 0 | 9 | — | A |
| 10 | 11265 | STR-NAU-0877 | Strieborné náušnice Kruhy Orbita, 20 mm | 24,00 | 3 | 27 | — | — |
| 11 | 38104 | ZLA-RET-0051 | Zlatá retiazka Filo 585, 50 cm | 268,00 | 0 | 1 | — | B |
| 12 | 4590 | STR-PRI-0128 | Strieborný prívesok Anjel strážny | 18,90 | 11 | 85 | — | — |
| 13 | 29337 | STR-SET-0064 | Strieborná súprava Elyra, náušnice + prívesok | 62,00 | 0 | 6 | — | A |
| 14 | 17726 | STR-PRS-0993 | Strieborný prsteň Lira, snubný hladký | 45,00 | 4 | 22 | 15 % | — |
| 15 | 35619 | ZLA-PRS-0210 | Zlatý prsteň Verona 750, smaragd | 742,00 | 0 | 1 | — | A |
| 16 | 8043 | STR-NAR-0176 | Strieborný náramok Minuet, s guličkami | 33,00 | 1 | 15 | — | C |
| 17 | 22984 | STR-NAU-1055 | Strieborné náušnice Tara, visiace kvapky | 29,90 | 0 | 20 | — | B |
| 18 | 13470 | CHI-PRS-0092 | Oceľový prsteň Basalt, čierny | 16,50 | 8 | 48 | — | — |
| 19 | 31855 | STR-PRI-0742 | Strieborný prívesok Strom života, 18 mm | 26,00 | 2 | 37 | — | C |
| 20 | 39901 | ZLA-NAU-0198 | Zlaté náušnice Klasik 585, napichovacie | 129,00 | 0 | 4 | — | B |

Orientačne (do HTML **nie**): 1–5 = striebro/zlato, kategórie náušnice · prstene
· retiazky · prívesky · náramky · súpravy; marža 38–62 %.

**Produkty s príznakom „nepodarilo sa"** (pre detail zľavy Z-1, prvých 5 z 12):
ID 21170, 33028, 38104, 35619, 29337. Ľudský dôvod:
`Shop produkt nenašiel — možno bol medzitým zmazaný` (3×) a
`Shop neodpovedal ani po treťom pokuse` (2×).

### 3.6 Kľúče

| Kľúč | Platí do | Spotreba dnes |
|---|---|---|
| Zápis | 9. 9. 2026 | 100 / 200 |
| Objednávky | 2. 9. 2026 | 14 / 1 000 |
| Štatistiky | 2. 9. 2026 | zatiaľ nepoužitý |

Platnosť **30 dní** (odpoveď 57 — 48 h nesadá na frontu bežiacu týždne).

---

## 4. Stavy a príznaky

### Štyri stavy (odpoveď 54) — jediné povolené slová

| Stav | Znamená | Vizuál |
|---|---|---|
| **pripravená** | zostavená, do fronty ešte nešla | sivá bodka, tlmené |
| **zapisuje sa** | fronta beží, zľava zákazníkom ešte nesvieti | **teal** bodka + pruh |
| **beží** | okno zľavy je otvorené, zákazníci ju vidia | **zlatá** bodka |
| **skončila** | okno sa zavrelo | prázdna bodka, celý riadok tlmený |

Zakázané: „aktívna", „naplánovaná", „čaká", „chyba", „zlyhala", „needs_key",
„draft", „pending".

### Zlyhanie je príznak, nie stav

Píše sa **za stav, oddelené bodkou, menším písmom, jantárovou farbou**:

```
zapisuje sa · 12 sa nepodarilo
beží · 3 sa nepodarilo
```

Pravidlá:
- Nikdy nemení stav ani jeho farbu. Zľava so zlyhaniami **stále beží**.
- Nikdy nie červená — červená je len pre stratu dát a zastavený zápis.
- Klik na príznak → rozklik so zoznamom a ľudským dôvodom. Kód shopu je až
  v druhej úrovni (`Technický detail`).
- Zlyhania sa **automaticky opakujú** (odpoveď 24); príznak sa zobrazí až po
  treťom neúspešnom pokuse. Do tej doby nič nesvieti.

### Ďalšie príznaky (rovnaká gramatika, `stav · príznak`)

- `zapisuje sa · pozastavené` — po odstávke PC fronta čaká na potvrdenie
  (odpoveď 46). Pri nej tlačidlo `Pokračovať`.
- `zapisuje sa · štart posunutý na 6. 9.` — automatický posun pri sklze
  (odpoveď 63).
- `beží · zmenené v admine?` — appka nevie zistiť cudziu zmenu a **prizná to**
  (odpoveď 81). Text v rozkliku: `Percentá sme naposledy zapisovali my 5. 8.
  Ak ich niekto zmenil v administrácii shopu, nevieme o tom.`

---

## 5. Čo je zamknuté

Čaká na API (odpovede 64–66, 70): **kategórie · kov · COGS/marža · sklad
nevariantných produktov**. Bez COGS sa **neodomkne obrátkovosť** (odpoveď 51),
teda ani plnohodnotné pásma podľa marže.

### Ako to obrazovka ukáže bez toho, aby to otravovalo

**Tri úrovne, žiadna štvrtá:**

1. **V bunke tabuľky** — `—` a 10 px zámok, sivo. Bez tooltipu s odstavcom;
   tooltip je jedno slovné spojenie: `Čaká na dáta zo shopu`.
2. **Vo filtri** — položka zostáva v zozname, je sivá, neklikateľná, s tenkým
   zámkom. Nezmizne (aby používateľ vedel, že s tým rátame), ale ani nekričí.
3. **V Nastaveniach → Zamknuté funkcie** — jediné miesto s vysvetlením. Tabuľka:
   | Funkcia | Chýba | |
   |---|---|---|
   | Filter podľa kategórie a kovu | zoznam kategórií a kovov | |
   | Marža a odhad dopadu | nákupné ceny | |
   | Obrátkovosť | nákupné ceny | |
   | Sklad nevariantných | stavy skladu | |
   Pod tabuľkou jedno tlačidlo: **`Skopírovať zoznam pre dodávateľa shopu`**
   (odpoveď 65 — e-mail si používateľ napíše sám).

**Zakázané:** žltý pruh cez celú stránku, opakované hlášky pri každom čísle,
modálne okno pri otvorení tabu, slovo „API" v texte pri bunke, počítadlo
„4 funkcie zamknuté" v hlavičke.

Výnimka: **predané kusy fungujú** (máme z objednávok) — nikdy nie sú zamknuté.
Odhad dopadu na maržu sa v potvrdení ukáže ako `≈ −18 400 €` s poznámkou
`odhad z priemernej marže` — E4 to vykreslí, keďže odpoveď 39 ho žiada.

---

## 6. Rozdelenie práce E1–E7

Šírka **1440**. Každá stránka je self-contained HTML v `design/v3/`, spoločné CSS
cez `<link rel="stylesheet" href="_v3.css">`. Žiadne externé zdroje, žiadny
JavaScript okrem `<details>`. Svetlá téma predvolená, tmavá cez
`[data-theme="dark"]` na `<html>`.

Nikto nesiaha na `src/**`, `docs/**`, `design/mockups/**`.

| Agent | Zodpovednosť | Súbory |
|---|---|---|
| **E1** | Dizajnový systém: `_v3.css` — tokeny (teal + zlatá, rodina Aura), svetlá + tmavá téma, hustá typografia, tabuľky, pruhy priebehu, bodky stavov, príznaky, `<details>` rozkliky, spodná lišta výberu, **hotová hlavička ako HTML snippet v komentári na začiatku CSS**. Ostatní ju kopírujú, nekreslia znovu. | `_v3.css` |
| **E2** | Tab Prehľad + prázdne stavy + prihlásenie | `prehlad.html`, `prazdne-stavy.html`, `prihlasenie.html` |
| **E3** | Tab Produkty vrátane filtrov, lišty výberu a bočného detailu produktu | `produkty.html`, `produkt-detail.html` |
| **E4** | Sprievodca Nová zľava, 3 kroky, vrátane skúšky naprázdno a odhadu marže | `zlava-nova-vyber.html`, `zlava-nova-pasma.html`, `zlava-nova-potvrdenie.html` |
| **E5** | Tab Zľavy: zoznam + detail (priebeh, pásma, výkon 3 uhly, položky, audit pod rozklik) | `zlavy.html`, `zlava-detail.html` |
| **E6** | Tab Nastavenia (8 kotiev) + stránka zamknutých funkcií, ak sa nezmestí do kotvy | `nastavenia.html` |
| **E7** | Mobil (iné rozloženie, rovnaké dáta) + ukážka tmavej témy + render do PNG | `prehlad-mobil.html`, `zlava-nova-mobil.html`, `prehlad-tmava.html`, `render.sh`, `design/v3/png/*.png` |

**Poradie:** E1 musí byť hotový skôr než E2–E7. E7 čaká na E2 a E4.

**Kontrolný zoznam pred odovzdaním každej stránky:** P1–P8 z §0 · čísla presne
podľa §3 · slová stavov presne podľa §4 · hlavička identická s E1 · žiadny
horizontálny skrol · funguje aj v tmavej téme.
