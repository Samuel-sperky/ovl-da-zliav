# Kontrakt — dotiahnutie UI (13. 8. 2026)

Zdroj pravidiel: `design/v3/ARCHITEKTURA.md` §0, pravidlá **P1–P8**.
Zdroj možností API: `docs/api/sperky-api-v5.md`.

---

## Prečo tento kontrakt

Šprint priehľadnosti (12. 8.) pridal informácie a tým **porušil vlastné
pravidlá**. Zmerané na snímkach:

| Pravidlo | Hovorí | Skutočnosť |
|---|---|---|
| **P4** | max 1,5 obrazovky pri 1440×900 | Nastavenia **4,7**, Prehľad 1,6 |
| **P5** | max 4 sekcie | Prehľad **5–6**, Nastavenia **12** |
| **P1** | jedna dominanta | na Prehľade nie je jasná |

„Priehľadne" a „v súlade s pravidlami" si teda protirečia. Tento kontrakt to
rozhoduje.

---

## Tvrdosť pravidiel (rozhodnuté)

| | |
|---|---|
| **P3** žiadny žargón | **NEDOTKNUTEĽNÉ** |
| **P7** odhady označené `≈` a tlmene | **NEDOTKNUTEĽNÉ** |
| **P8** appka nehodnotí kauzalitu | **NEDOTKNUTEĽNÉ** |
| **P1** jedna dominanta | smie sa ohnúť, ale zapíše sa dôvod |
| **P4** max 1,5 obrazovky | smie sa ohnúť, ale zapíše sa dôvod |
| **P5** max 4 sekcie | smie sa ohnúť, ale zapíše sa dôvod |
| **P2** žiadne vysvetľujúce odstavce | drží sa |
| **P6** technika pod rozklik | drží sa |

Ohnutie znamená: doplniť riadok do `design/v3/ARCHITEKTURA.md` s číslom
pravidla, obrazovkou a dôvodom. Nie ticho.

---

## Rozhodnutia (30 + 2 otázky, 13. 8.)

### Chróm a stav

1. **Stavový pruh je CHRÓM**, nie sekcia — do P4 ani P5 sa nepočíta. Musí
   ostať jeden riadok.
2. Pruh **vždy** nesie štyri veci: či sú zápisy zapnuté · dokedy platí kľúč ·
   koľko zápisov dnes ostáva · stav katalógu.
3. Keď nič nebráni zápisu, **nekreslí sa sekcia** — len zelená značka v pruhu.
4. **Žiadne automatické obnovovanie.** Čísla sa obnovia na vyžiadanie; vždy je
   vidieť čas poslednej aktualizácie a tlačidlo Obnoviť.
5. Keď appka niečo **nevie**: pomlčka. Dôvod pod rozklik (P6), nie na povrchu.
   **Nikdy nula** — nula je tvrdenie.
6. Prekážky sa zobrazujú **všetky tri úrovne** (blokuje, obmedzuje, informuje).
7. Farbu prekážky volí **spôsob riešenia**, nie závažnosť. Zostáva ako dnes.
8. Znak `≈` a tlmený odtieň patrí na: dobehnutie fronty · dokončenie katalógu ·
   počet produktov vo výbere pri neúplnom katalógu · dopad na maržu.

### Texty

9. **Neosobne, bez oslovenia.** „Zápisy sú vypnuté." Nie „máte", nie „máš".
10. **Vždy konkrétny čas a dátum.** `12:53`, `14. 8. 2026`. Žiadne „pred 3 minútami".
11. **Prázdny stav = jedna veta + jedno tlačidlo.** Žiadne očíslované návody.

### Rozloženie

12. **Šírka:** funguje aj na polovici obrazovky (~720 px). Mobil neriešime.
13. **Nastavenia:** rozcestník so štyrmi kartičkami (každá so svojím stavom),
    klik otvorí podstránku. Prvá podstránka je **„Čo appka vie"**.
14. **Červená zóna** je na vlastnej podstránke a ešte za rozklikom.
15. **Rozpočty** sú v pruhu ako číslo (`21/200 dnes`) a v Nastaveniach celý
    rozpad vrátane toho, či je číslo živé zo `whoami`, alebo zo zálohy.

### Produkty

16. Panel stavu katalógu: **ostávajú štyri dlaždice.** Neúplný katalóg je
    najväčšie riziko tejto obrazovky.
17. **Výber sa drží,** kým ho človek nezruší. Prežije prechod medzi tabmi.
18. **Zamknuté filtre ostávajú vidieť, vypnuté, so zámkom.** Vysvetlenie
    zostáva na jednom mieste (`LockedFeatures.tsx`) — NEROZŠIROVAŤ.
19. Predvolené triedenie: **najdrahšie prvé.**
20. **Kód produktu (`reference`) sa doťahuje LEN pre vybrané produkty** cez
    `getFull`. Nikdy pre celý katalóg — to je 41 082 volaní.

### Zľavy

21. V zozname je dominanta **percento zľavy.**
22. Detail: **ostávajú všetky štyri dlaždice** fronty. „Nevieme, či sa
    zapísalo" je vlastný stav (D45) a zliatie so „nepodarilo sa" by bolo
    klamstvo.
23. Akcia **„Zrušiť zľavu"** je na detaile, s potvrdením. Bez hesla, nie
    v červenej zóne.
24. **„Nová zľava" ostáva JEDNA obrazovka** — len sa zhustí, aby sa zmestila
    do 1,5 obrazovky. Rozhodnutie proti sprievodcovi platí ďalej.

### Hľadanie (podľa `docs/api/sperky-api-v5.md`)

25. Hľadanie sa stavia na tom, čo API naozaj dáva:

| Endpoint | Kľúč | Čo dá |
|---|---|---|
| `GET /api/products/searchIndex` | **nie** | fuzzy hľadanie (preklepy, poradie slov) v názve, popise, **kóde** aj kategóriách. Vracia **len ID**. |
| `GET /api/products/get` | **nie** | názov, cena, popis, varianty — na dotiahnutie neznámych ID |
| `GET /api/products/search` | `product:read` | presné filtre: cena, kategórie, výrobcovia, dodávatelia, príznaky, `onlyDiscounted`, triedenie. Vracia **len ID**. |
| `GET /api/categories` | `product:read` | strom kategórií |
| `GET /api/products/getFull` | `product:read` | + `reference`, `ean13`, nákupná cena, marža, `qty`, `categories`, **skutočná zľava** |

26. **`searchIndex` a `get` sú verejné, takže hľadanie cez celý katalóg
    funguje DNES, bez nového kľúča.** To je najdôležitejšie zistenie: zrkadlo
    katalógu má 2 900 zo 41 082 riadkov, ale hľadať sa dá vo všetkých.
27. Presné filtre podľa kategórie a `onlyDiscounted` čakajú na `product:read`.
    Do tej doby sú **vidieť a vypnuté so zámkom** (bod 18).
28. Oba hľadacie endpointy **nie sú batchable** — po získaní ID sa detaily
    doťahujú jednotlivo, čo míňa rozpočet. Preto sa doťahuje len to, čo treba.

### Postup

29. Poradie prác: **Produkty → Nová zľava → Detail zľavy → Prehľad →
    Nastavenia.** Podľa cesty jednej zľavy.
30. Snímky obrazoviek **až na konci, všetky naraz.**

---

## Čo NIE

- Mobil.
- Automatické obnovovanie čísel.
- Rozšírenie vysvetlení o chýbajúcich dátach mimo `LockedFeatures.tsx`.
- Prestavba „Novej zľavy" na sprievodcu.
- Doťahovanie `getFull` pre celý katalóg.
- Zmena témy, palety a hornej navigácie.

---

## Akceptačné kritériá

1. Každá obrazovka sa zmestí do 1,5 obrazovky pri 1440×900 — alebo má
   v `ARCHITEKTURA.md` zapísanú výnimku s dôvodom.
2. Každá obrazovka má najviac 4 sekcie — alebo zapísanú výnimku.
3. Každá obrazovka má jednu dominantu — alebo zapísanú výnimku.
4. P3, P7, P8 platia bez výnimky. Žiadny žargón na povrchu, každý odhad
   označený, žiadna veta o kauzalite.
5. Použiteľné na 720 px šírky.
6. Hľadanie nájde produkt, ktorý NIE JE v zrkadle katalógu — vrátane hľadania
   podľa kódu — a povie, odkiaľ výsledok je.
7. Nikde sa neobnovuje nič samo; všade je čas poslednej aktualizácie.
8. Typecheck, lint, celý balík, e2e a build zelené.
9. Snímky všetkých obrazoviek v `screenshots/`.

---

## Výsledok

*(dopĺňa sa po dokončení)*
