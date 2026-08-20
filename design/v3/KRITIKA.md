# KRITIKA V3 — nálezy E8

**Dátum:** 10. 8. 2026 · **Predmet:** `design/v3/*.html` (11 stránok + `_v3.css`)
**Meradlo:** `docs/40-ODPOVEDE-V3.md` (jediný zdroj pravdy) + štyri zákazy z odpovede 100.
**Metóda:** čítanie zdroja + render v Chromiu, 1440 × 1100 (mobil 420 × 1400).

Priorita: **P1** = musí padnúť pred odovzdaním · **P2** = vážne, opraviť v tejto vlne ·
**P3** = kozmetika.

---

## A. Rozbité toky — používateľ sa zasekne

### K1 · P1 · Hlavné tlačidlo appky nikam nevedie
**Súbor:** `prehlad.html`, `prehlad-pokoj.html`, `zlavy.html`
„Nová zľava“ (a všetkých 5 tlačidiel „Použiť“ / „Zopakovať“ v návrhoch) smeruje na
`zlava-nova-vyber.html`, **ktorý neexistuje**. Existuje `nova-zlava.html`.
Odpoveď 34 hovorí, že prvý klik je „Prehľad → Nová zľava“ — teda práve tento tok je
mŕtvy na všetkých vstupných bodoch.
**Oprava:** prelinkovať na `nova-zlava.html`; ak mal existovať medzikrok výberu, dokresliť ho.

### K2 · P1 · Výber z Produktov sa do novej zľavy neprenesie
**Súbor:** `produkty.html` → `nova-zlava.html`
V Produktoch označím 11 640 kusov a kliknem „Zlacniť“ — je to `<button>` bez cieľa.
Na `nova-zlava.html` je pritom chip **„Z označených **0**“**, čiže druhá vetva výberu
je mŕtva aj vizuálne. Tok „zlacniť ležiaky“ sa dá prejsť len náhodou.
**Oprava:** „Zlacniť“ → `nova-zlava.html`; chip „Z označených“ ukázať s reálnym počtom
(11 640) a mať ho aktívny, keď prídem z Produktov.

### K3 · P1 · Predvyplnené potvrdenie ruší zmysel potvrdenia
**Súbor:** `nova-zlava.html`
Pole „Napíšte počet produktov“ má **`value="8000"`**. Odpoveď 22 a 38 žiada, aby sa počet
písal ručne — predvyplnené pole je len ďalší klik. `m-schvalenie.html` to má správne
(prázdne, `placeholder`), takže dva mockupy si odporujú aj navzájom.
**Oprava:** prázdne pole, `placeholder="8000"`, tlačidlo „Zaradiť do fronty“ neaktívne,
kým sa čísla nezhodujú.

### K4 · P2 · Z mobilu sa zľava nedá vytvoriť
**Súbor:** `m-prehlad.html`, `m-schvalenie.html`
Odpoveď 138: „z telefónu **všetko** vrátane tvorby“. Mobil má len prehľad a schválenie
už pripravenej zľavy; „Nová zľava“ v spodnej lište je `<button>` bez cieľa a mobilná
verzia výberu produktov / pásiem neexistuje. Taby z mobilu navyše vedú na **desktopové**
stránky (`produkty.html`, `zlavy.html`, `nastavenia.html`), ktoré na 420 px nefungujú.
**Oprava:** dokresliť `m-produkty.html` a `m-nova-zlava.html` (aspoň krokovo), taby smerovať
na mobilné varianty.

### K5 · P2 · „Skúška naprázdno“ nemá výsledok
**Súbor:** `nova-zlava.html`, `m-schvalenie.html`
Tlačidlo existuje, obrazovka s výsledkom skúšky nie. Odpoveď 68 („lokálne všetko +
vzorka na shope“) znamená, že skúška niečo **vráti** — používateľ nevie, čo uvidí ani
či môže pokračovať. Zároveň skúška zapíše 10 produktov, čiže minie 10 zo 200 denných
zápisov, a nikde to nie je vidieť.
**Oprava:** obrazovka/panel „Výsledok skúšky“ + veta o spotrebe rozpočtu pri tlačidle.

---

## B. Rozpory s odpoveďami

### K6 · P1 · Marža sa raz nedá spočítať, inde sa počíta
**Súbor:** `nova-zlava.html`, `zlava-detail.html`, `m-schvalenie.html` vs `nastavenia.html`,
`produkty.html`, `produkt-detail.html`
Nastavenia § Zamknuté funkcie: „Marža a odhad dopadu — **chýba: nákupné ceny**“, v tabuľke
Produktov je stĺpec Marža prázdny, Prehľad hlási „Marža a obrátkovosť zamknuté“.
Napriek tomu nova-zlava aj detail zľavy s istotou tvrdia **„Dopad na maržu ≈ −18 400 €“**
a mobil „≈ −4 900 €“. Odpovede 50, 51, 118 a 65 hovoria jasne: **bez COGS sa nič nehádže**.
**Oprava:** buď dopad na maržu zamknúť rovnakým spôsobom ako ostatné („odomkne sa po
doplnení nákupných cien“), alebo prestať tvrdiť, že nákupné ceny chýbajú.

### K7 · P1 · Pásma nesedia s filtrom ani s pravidlom „najhoršie ležiaky prvé“
**Súbor:** `nova-zlava.html`
Filter na tej istej obrazovke je „0 predaných / 180 dní“ → 11 640 kusov. Pásma pod ním
obsahujú **pásmo C = „1–2 predané za 180 dní“ (1 400 ks)**, čo filtru nevyhovuje.
Zároveň pri strope 8 000 a poradí „najhoršie prvé“ (odpoveď 110) by rozdelenie malo byť
A 6 940 + B 1 060, nie A 3 180 / B 3 420 / C 1 400. Číslo **3 420** je navyše zhodné
s priebehom fronty inej zľavy — vyzerá to ako kopírovanie.
**Oprava:** prepočítať pásma z čísel v Nastaveniach (A 6 940 · B 4 700 · C 7 564) a
nechať do stropu spadnúť pásma podľa priority.

### K8 · P2 · Fronta beží sériovo, hoci odpoveď hovorí o delení rozpočtu
**Súbor:** `zlavy.html`, `prehlad.html`, `m-prehlad.html` vs `nastavenia.html`
Zoznam zliav píše „Zapisovať začnem, keď dobehne Ležiaky striebro — jeseň“ (čistá
sériovosť), Nastavenia § Rozpočet naopak ukazujú spotrebu **rozdelenú medzi zľavy**.
Odpoveď 40: „Súbežné zľavy: **rozpočet sa delí medzi ne**“.
**Oprava:** zjednotiť na delenie (napr. „dnes 140 / 60 zápisov“) a text „začnem, keď
dobehne“ nahradiť podielom.

### K9 · P2 · Appka tvrdí, že vidí cudzie zmeny v shope
**Súbor:** `zlava-detail.html` (Položky: „V shope je 20 % — nezhoda“, „V shope je 10 % — nezhoda“)
Odpoveď 124: cudziu zmenu v admine **appka nevie zistiť a prizná to**. Mockup predstiera
opak a vytvára očakávanie kontroly, ktorú produkt nemá.
**Oprava:** riadky „nezhoda“ odstrániť, alebo prepísať na to, čo appka naozaj vie:
„Naposledy sme zapisovali 15 % dňa 5. 8.“ (odpoveď 4).

### K10 · P2 · Prihlásenie hovorí 127.0.0.1, mobil ale chodí cez sieť
**Súbor:** `prihlasenie.html`, `nastavenia.html § Pripojenie`
Obe miesta uvádzajú `127.0.0.1:3070`, hoci odpoveď 137 ruší „len 127.0.0.1“ a nahrádza to
prístupom z lokálnej siete so zoznamom povolených zariadení (ktorý Nastavenia § Povolené
zariadenia už majú s IP `192.168.1.x`). Vnútorný rozpor v jednom súbore.
**Oprava:** uvádzať adresu v sieti (napr. `192.168.1.14:3070`), 127.0.0.1 nechať pod rozklik.

### K11 · P2 · Tmavá téma je len tlačidlo bez obsahu
**Súbor:** všetky
Odpoveď 78: svetlá predvolená, **tmavá na prepínač**. `_v3.css` má kompletné tmavé tokeny,
ale žiadny mockup ich nerenderuje a prepínač je inertný `<button>`. Do PNG dodávky sa
tmavá téma nedostane, čiže sa neschváli.
**Oprava:** aspoň dva PNG v tmavej (Prehľad, Produkty) cez `<html data-theme="dark">`.

### K12 · P3 · Predvolený rozsah tržieb
**Súbor:** `prehlad.html`
Odpoveď 89: predvolene **dnes + porovnanie s včerajškom**. Dominantou sekcie je 14-dňový
graf, dnes/včera je malá KPI karta vľavo.
**Oprava:** dnes vs včera dať ako prvé číslo sekcie, 14 dní ako kontext grafu.

---

## C. Nekonzistentné dáta medzi obrazovkami

### K13 · P1 · Koľko zostáva vo fronte: 4 480 alebo 4 580?
`zlava-detail.html`: „8 000 celkom · 3 408 zapísaných · **4 580 čaká** · 12 sa nepodarilo“ (sedí).
`nova-zlava.html`: „Pred tebou vo fronte **4 480** Ležiaky striebro — jeseň“ a rozklik
„4 480 + 8 000 = 12 480“. Rozdiel 100 kusov ťahá celý odhad štartu.
**Oprava:** 4 580 všade; prepočítať aj „Zapísané budú ≈ 11. 10.“ (12 580 / 200 ≈ 63 dní od
11. 8. → 12. 10.) a navrhovaný štart.

### K14 · P1 · Nová zľava ignoruje 1 240 kusov, ktoré sú vo fronte pred ňou
**Súbor:** `nova-zlava.html` vs `zlavy.html`
Zoznam zliav má „Náušnice bez pohybu · 1 240 · pripravená“ zaradené pred novou zľavou.
Panel Štart počíta len s Ležiakmi. Správne „pred tebou“ = 4 580 + 1 240 = **5 820**.
**Oprava:** panel Štart musí sčítať celú frontu a vymenovať ju.

### K15 · P1 · Prstene 2024: 35 % alebo 15 %?
`prehlad.html`, `zlavy.html`, `m-prehlad.html`: **35 %**.
`nastavenia.html § Audit`, 5. 8. 09:33: „Zapísaná zľava **15 %** · Prstene 2024 — dopredaj“.
**Oprava:** zjednotiť na 35 %.

### K16 · P2 · Termín zapisovania Náušníc nesedí s frontou
**Súbor:** `m-schvalenie.html`
„Zapisovanie 14. 9. – 26. 9.“, pritom Ležiaky dobehnú **2. 9.** a 1 240 kusov pri 200/deň
zaberie ~7 dní → 3. 9. – 9. 9. Medzi 2. 9. a 14. 9. sa nič nedeje a nikde to nie je vysvetlené.
**Oprava:** prepočítať na 3. 9. – 9. 9., prípadne zobraziť dôvod odkladu.

### K17 · P2 · „11 640 sa 180 dní nepredalo“ vs „19 204 za 30 dní najviac 2 kusy“
**Súbor:** `prehlad.html`, `prehlad-pokoj.html`
19 204 = 11 640 + 7 564, čo sú presne čísla filtra za **180 dní**, nie za 30. Návrh tvrdí
30 dní. Buď je zle text, alebo číslo.
**Oprava:** zjednotiť obdobie (predvolené je 30, odpoveď 53) a čísla prepočítať.

### K18 · P2 · „2 380 produktov je práve zlacnených“ pri jednej bežiacej zľave na 640 kusov
**Súbor:** `prehlad-pokoj.html` (a `zlava-detail.html`, kde „zlacnené 2 380“ vystupuje ako
základ porovnania). V pokojnom stave beží jediná zľava so 640 produktmi.
**Oprava:** dorozprávať, odkiaľ zvyšných 1 740 (staršie zľavy?), alebo číslo zosúladiť.

### K19 · P3 · Produkt Aurora má tri rôzne osudy
`produkt-detail.html`: „bez zľavy“, „V pripravovanej zľave Ležiaky striebro, pásmo A · 30 %“.
`zlava-detail.html`: ten istý produkt je v zozname **zlyhaných** („Shop produkt nenašiel“).
Detail produktu o zlyhaní mlčí, hoci je to presne miesto, kde to používateľ hľadá.
**Oprava:** v detaile produktu ukázať príznak „zápis sa nepodaril“.

### K20 · P3 · Hlavička na `nova-zlava.html` ukazuje frontu bez práve zostavovanej zľavy
Ukazuje `Fronta 3 420/8 000`, hoci na obrazovke pribúda ďalších 8 000. Po zaradení číslo
skočí — chýba náznak „po zaradení 3 420 / 17 240“.

---

## D. Chýbajúce stavy

### K21 · P1 · Žiadne prázdne stavy
Odpoveď 135: onboarding = **len prázdne stavy s odkazmi**. `_v3.css` má hotovú triedu
`.empty`, ktorú **nepoužíva ani jedna stránka**. Chýba: prvé spustenie (žiadny katalóg,
žiadny kľúč), Zľavy bez zliav, Produkty s 0 výsledkami hľadania, Audit bez záznamov.
**Oprava:** aspoň tri prázdne stavy — Prehľad (prvé spustenie), Zľavy, výsledok hľadania.

### K22 · P1 · Vyčerpaný rozpočet sa nikde neukazuje
Odpoveď 101: „**Pokračujem zajtra o 02:00**“ — informácia, nie chyba. `_v3.css` v komentári
tento variant hlavičky predpisuje, ale všetkých 11 stránok má natvrdo `100/200`.
**Oprava:** jedna stránka (Prehľad alebo detail zľavy) vo variante `200/200 · pokračujem o 02:00`.

### K23 · P1 · Zastavená fronta po odstávke PC
Odpoveď 43: po odstávke sa fronta **zastaví a čaká na potvrdenie**. Tento stav neexistuje —
ani v hlavičke, ani na Prehľade, ani v detaile zľavy. Pritom je to najčastejší reálny stav
appky, ktorá beží na kancelárskom počítači.
**Oprava:** varianta Prehľadu „Fronta čaká na potvrdenie“ s jedným tlačidlom „Pokračovať“.

### K24 · P2 · Zľava, ktorá sa nedopísala / hromadné zlyhanie
Existuje len „12 sa nepodarilo“ ako drobný príznak. Chýba stav, keď zlyhá napr. 800 kusov
alebo keď vyprší kľúč uprostred týždňov trvajúceho zápisu (kľúč platí 30 dní, fronta na
12 580 kusov trvá 63 dní — **to sa stane vždy**, odpoveď 98 vs 111).
**Oprava:** obrazovka „Kľúč vyprší 9. 9., fronta dobehne 12. 10.“ s výzvou na obnovu.
Toto je zároveň dizajnová diera, nielen chýbajúci mockup.

### K25 · P2 · Zastavenie fronty nemá potvrdenie
„Zastaviť frontu“ je na štyroch obrazovkách ako obyčajné tlačidlo, hoci ide o
nezvratný zásah do produkcie („Zrušiť sa už nedajú“). Odpoveď 42 zastavenie povoľuje,
ale poistka pri takom kroku chýba, kým na oveľa neškodnejšie zaradenie do fronty sa
píše počet ručne. Nepomer.

---

## E. Štyri zákazy

### K26 · P2 · Zákaz 3 (hierarchia): Prehľad má dve dominanty vedľa seba
**Súbor:** `prehlad.html`
Sekcia „Čaká na vás“ je dvojstĺpec, kde vľavo sú **návrhy** a vpravo **problémy**, obe
rovnakým štýlom `.suggest`, bez nadpisov stĺpcov. Riadok „Marža a obrátkovosť zamknuté“
tak vyzerá ako ponuka na použitie. Oko nevie, čo je akcia a čo hlásenie.
**Oprava:** rozdeliť na „Návrhy“ a „Vyžaduje pozornosť“ s vlastnými nadpismi, alebo
problémy zredukovať na jeden riadok nad sekciou.

### K27 · P2 · Zákaz 3: `zlavy.html` nemá čo ukázať a aj tak má tri sekcie
Stránka končí v 520 px z 1100 px — dve tretiny obrazovky sú prázdne, pričom obsah je
rozsekaný na „Zapisuje sa“ / „Beží a pripravené“ / rozklik „Skončené · 1 zľava“.
Rozklik na jednu položku je réžia bez úžitku.
**Oprava:** „Skončené“ zobraziť rovno (stlmene, odpoveď 90), zvyšný priestor dať tabuľke
so stĺpcami, ktoré teraz nie sú (koľko sa už zapísalo, tržby zlacnených).

### K28 · P2 · Zákaz 1: „Dáta k 10. 8. 03:00“ je na jednej stránke až päťkrát
`zlava-detail.html` opakuje čerstvosť dát v štyroch sekciách + v hlavičke fronty,
`nova-zlava.html` dvakrát. Odpoveď 74 chce **diskrétne pri číslach**, nie refrén.
**Oprava:** raz na stránku, pri prvom bloku čísel.

### K29 · P3 · Zákaz 1: duplicitné označenie stavu
`prehlad.html` a `zlavy.html` majú nadpis sekcie „Zapisuje sa“ a hneď vedľa štítok
„◐ zapisuje sa“. To isté slovo dvakrát na 30 px.

### K30 · P3 · Zákaz 2: „sync“ na povrchu
`nastavenia.html § Pripojenie`: „40 483 produktov · **sync** denne o 03:00“ a
§ Rozpočet: „sync predajov“. Inde sa dôsledne píše „načítať“.
**Oprava:** „načítanie katalógu každý deň o 03:00“.

### K31 · P3 · Zákaz 4: `zlava-detail.html` sa roluje
Pri 1100 px výšky je sekcia Položky odrezaná v polovici a Audit je pod ňou.
Odpoveď 94 pritom hovorí „len súhrn + zlyhané a podozrivé“ — sekcia Výkon výberu
(tri grafy) sa dá zbaliť alebo presunúť, aby sa vošlo to podstatné.

---

## F. Vizuálne a technické chyby

### K32 · P1 · Mobil pretečie a hlavička sa oreže
**Súbor:** `m-prehlad.html`, `m-schvalenie.html`
`body{max-width:420px}` neplatí pre desktopovú hlavičku: 4 taby + merač rozpočtu +
fronta + prepínač témy sa nezmestia, obsah vyteká vpravo („▲ 12 sa nepodari…“, „Všetky →“,
stavové štítky, tlačidlo „Nová zľava“ sú odrezané). Odpoveď 138 žiada **iné rozloženie**,
nie zúžený desktop.
**Oprava:** mobilná hlavička = značka + jedno číslo fronty; taby dole ako lišta;
rozpočet do obsahu, nie do hlavičky.

### K33 · P2 · Zámka `⌧` je nečitateľný štvorček a je všade
**Súbor:** `_v3.css` (`.lockcell::after`, `.fopt.locked::after`, `.sig.lock::before`), prejav
najmä v `produkty.html` a `produkt-detail.html`.
Znak U+2327 väčšina systémových fontov nemá → renderuje sa ako rámček s krížikom, ktorý
vyzerá ako chyba. V tabuľke Produktov je **36 takých značiek na jednu obrazovku**
(dva prázdne stĺpce × 18 riadkov) — čistý šum bez informácie.
**Oprava:** znak nahradiť (napr. jemné „—“ so sivým tooltipom), zamknuté stĺpce v tabuľke
**vôbec nezobrazovať**, kým dáta nie sú; zámku nechať len raz v hlavičke stĺpca alebo
v paneli filtrov.

### K34 · P2 · Dva súbory nemajú `<!doctype>` ani `<head>`/`<body>`
**Súbor:** `produkty.html`, `produkt-detail.html`
Začínajú rovno `<meta charset>`. Prehliadač ich renderuje v **quirks mode**, čo mení
výpočet výšok (`max-height:calc(100vh − 268px)` v `.tbl-scroll`) a pri exporte do PNG
môže dať iný výsledok než ostatných 9 stránok.
**Oprava:** doplniť kostru ako v ostatných súboroch.

### K35 · P2 · Detail produktu: pod panelom je nefiltrovaný a stlmený zoznam
**Súbor:** `produkt-detail.html`
V hľadaní je „Aurora“, ale tabuľka pod panelom ukazuje všetkých 11 640 a hlási
„Zobrazených 50 z 11 640“. Zároveň `.under{opacity:.5}` stlmí celú stránku vrátane
hlavičky s rozpočtom — indikátor rozpočtu a fronty prestane byť čitateľný, hoci ho
zadanie vyžaduje na každej obrazovke.
**Oprava:** buď filtrovaný zoznam (1 výsledok), alebo hľadanie nechať prázdne;
stlmovať len obsah, nie hlavičku.

### K36 · P3 · Lišta výberu prekrýva stránkovanie
**Súbor:** `produkty.html`
`.selbar` sedí tesne pod pätou tabuľky; pri 100 riadkoch na stránku sa tabuľka roluje pod ňu
a stránkovanie ostane schované za lištou.

### K37 · P3 · „Vybrať všetkých 11 640“ vedie nad strop
Strop na jednu zľavu je 10 000 (Nastavenia, odpoveď 48). Ponuka vybrať 11 640 skončí
chybou až o dva kroky ďalej. Lišta by mala hneď povedať „11 640 · do zľavy sa zmestí 10 000“.

### K38 · P3 · Graf tržieb: prerušovaná zlatá čiara trendu je nerozlíšiteľná od čiarkovanej
projekcie „dnes“ v tom istom grafe. Dve rôzne veci, jeden vizuálny jazyk.

---

## Verdikt

**Návrh NIE JE pripravený na odovzdanie.** Kostra, hustota a hierarchia sú dobré —
Prehľad, Produkty aj Nová zľava sú výrazne bližšie k odpovediam než čokoľvek
v `design/mockups/`. Zlyháva ale na troch veciach, ktoré používateľ pomenoval ako
kritérium úspechu:

**Musí padnúť pred odovzdaním (P1):**
1. **K1, K2, K3** — hlavný tok „zlacniť ležiaky“ je preklikom rozbitý na troch miestach.
   Dokým „Nová zľava“ vedie na neexistujúci súbor, nie je čo ukazovať.
2. **K6, K7** — appka tvrdí čísla (marža, pásma), o ktorých inde priznáva, že ich nemá.
   To je presne ten typ chyby, ktorý zabije dôveru pri prvom reálnom použití.
3. **K13, K14, K15** — tri rôzne čísla fronty a dve rôzne percentá tej istej zľavy.
   Pri dodávke ako PNG v ZIPe (odpoveď 157) si to používateľ prečíta vedľa seba.
4. **K21, K22, K23** — chýbajú tri stavy, v ktorých appka strávi väčšinu času:
   prázdny začiatok, vyčerpaný rozpočet, fronta čakajúca po odstávke.
5. **K32** — mobil v tejto podobe nie je návrh, je to orezaný desktop.

**Dizajnová diera, nie len chýbajúci obrázok:** **K24** — kľúč platí 30 dní, fronta na
12 580 produktov beží 63 dní. Rozpor sa musí vyriešiť v návrhu (upozornenie a obnova
kľúča počas behu fronty), nie až v implementácii.

Po odstránení P1 a P2 je návrh obhájiteľný. P3 sa dá dorobiť pri implementácii.
