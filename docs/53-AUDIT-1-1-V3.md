# Aura Zľavy — audit 1:1 proti návrhu V3

**Dátum:** 2026-08-11 · **Stav appky:** commit `c30134f`
**Meraný proti:** `design/v3/*.html` + `design/v3/ARCHITEKTURA.md` (dodaný zip
`aurazlavynavrhv3.zip` je **byte-identický** s tým, čo je v repe — návrh sa
nezmenil, len sa proti nemu prvý raz meria)

> Overenie V3 (`52-OVERENIE-V3.md`) tvrdí, že brána K12 prešla. **Prešla** — a
> appka aj tak nie je 1:1 s návrhom. Brána kontroluje, že na obrazovke nie je
> žargón (`vocabulary.spec.ts`) a že príkazy prejdú. **Nič v nej nekontroluje,
> že tam JE všetko, čo návrh žiada.** To je diera v definícii hotového, nie
> chyba merania — a tento dokument ju zapĺňa.

---

## Metóda

Z každého mockupu sa vytiahli textové uzly (labely, nadpisy, tlačidlá) a hľadali
sa v `src/**`. Odfiltrované boli **demo dáta**, ktoré v implementácii byť nemajú
a nemajú tam byť: názvy produktov (`Strieborné náušnice Lumen…`), názvy kampaní
(`Ležiaky striebro — jeseň`), kanonické čísla z `ARCHITEKTURA §3` (`3 420 / 8 000`),
konkrétne dátumy a `<title>` stránok.

Šablónované texty boli overené ručne podľa kmeňa, aby sa nehlásili falošne.
**Falošné poplachy takto vylúčené** (v appke sú, len sa skladajú za behu):
`sa nepodarilo`, `Čaká na dáta zo shopu`, `Obrátkovosť`, `Skúška naprázdno`,
`Zrušiť sa nedajú`, `N pásma`.

---

## Verdikt

**Nastavenia sú hotové z polovice, ostatné taby chýbajú v detailoch.**

| Obrazovka | Chýbajúcich labelov | Charakter |
| --- | --- | --- |
| `nastavenia.html` | **70** | chýbajú **4 z 10 kotiev** vrátane celých funkcií |
| `zlava-detail.html` | 18 | akcie a výsek auditu |
| `nova-zlava.html` | 11 | panel výsledku skúšky naprázdno |
| `produkt-detail.html` | 9 | graf predajov po mesiacoch, odkaz do shopu |
| `prehlad.html` | 9 | tlačidlo `Použiť` pri návrhoch |
| `prazdne-stavy.html` | 8 | texty prázdnych stavov |
| `zlavy.html`, `produkty.html`, `prihlasenie.html` | 6 / 9 / 5 | jednotlivé labely |
| `m-*.html` (mobil) | 1–11 | mobilné varianty |

---

## A. Čo chýba ÚPLNE (overené, nie šablóna)

### A.1 Nastavenia — štyri kotvy z desiatich

Mockup má kotvy: `pripojenie · kluce · rozpocet · pravidla · zariadenia ·
zalohy · audit · diagnostika · zamknute · cervena`.
Appka má: `pripojenie · kluce · rozpocet · rozsah · poistky · zamknute ·
historia · odhlasenie · cervena`.

1. **Pravidlá a poistky** (`#pravidla`) — appka má „Poistky" a „Rozsah zliav",
   ale **chýba tabuľka pásiem**: `Pásmo · Podmienka · Produktov dnes · Zľava ·
   Upraviť`, tlačidlo `Pridať pásmo`, a veta „Podľa týchto pásiem appka navrhuje
   percentá pri novej zľave." Toto nie je kozmetika — sprievodca v kroku 2/3 má
   podľa `ARCHITEKTURA §2` **už navrhnuté 3 pásma podľa pravidiel z Nastavení**,
   a tie pravidlá dnes nemajú kde vzniknúť. Chýba aj `Poradie zápisu`
   (najhoršie ležiaky prvé) a `Sklz fronty` (posunúť štart automaticky).
2. **Povolené zariadenia** (`#zariadenia`) — chýba celé. **Viď §B — koliduje s I5.**
3. **Zálohy** (`#zalohy`) — chýba celé: posledná záloha, denný čas, kópia do
   OneDrive, retencia (`30 posledných · 412 MB`), `Obnoviť zo zálohy`,
   `Zálohovať teraz`. Skripty `scripts/backup.sh` a `restore-test.sh` existujú,
   UI nad nimi nie.
4. **Diagnostika** (`#diagnostika`) — chýba celé: `Stiahnuť diagnostiku` +
   rozklik „Čo súbor obsahuje" (verzia, zoznam migrácií a checksumy, stav fronty,
   počty posledných odpovedí shopu, a výslovne `Vynechané: kľúče, heslá, master
   key, obsah objednávok`).

`audit` → appka to má ako `historia` („História a technický detail"). **To je
správne**, K9 to tak výslovne žiada; nie je to medzera.

### A.2 Akcie a prvky mimo Nastavení

| Chýba | Kde | Čo na tom záleží |
| --- | --- | --- |
| `Použiť` | Prehľad, riadky návrhov | `ARCHITEKTURA` TAB 1 §2 to žiada menovite — bez neho je návrh oznámenie, nie prvý klik do práce |
| `Opakovať`, `Kopírovať s novými dátumami` | detail zľavy | jediná cesta, ako zľavu zopakovať |
| `Audit — posledných 6 záznamov` + `Celý audit v Nastaveniach` | detail zľavy, rozklik | výsek auditu v detaile (odpoveď 31) |
| `Zlacnené vs nezlacnené` | detail zľavy, Výkon | **tretí uhol** z odpovede 86; appka má dnes dva |
| `Stiahnuť celý zoznam` | detail zľavy, Položky | tabuľka je zámerne skrátená na ~20 riadkov, export je náhrada |
| `Predaje po mesiacoch` (mini-graf 12 mesiacov) | detail produktu | `ARCHITEKTURA` TAB 2 |
| `Otvoriť v shope`, `Posledný zápis` | detail produktu | — |
| `Nič sa nenašlo`, `Zatiaľ nemáme katalóg`, `Zrušiť hľadanie` | prázdne stavy | onboarding = **len** prázdne stavy (odpoveď 73), takže sú to jediné dvere |
| `Iná vzorka`, `Zapísaná vzorka`, `Vzorka po skúške`, `vrátená na pôvodné ceny` | sprievodca 3/3 | panel výsledku skúšky naprázdno |

---

## B. Jeden konflikt, ktorý sa nedá vyriešiť dizajnom

**Povolené zariadenia vs. invariant I5.**

- Návrh (`nastavenia.html`, odpoveď 77): *„Prístup len z domácej siete.
  Zariadenie mimo zoznamu sa nedostane dnu."* Zoznam zariadení **nahrádza
  dnešné „len 127.0.0.1"**, zápis má ísť aj z mobilu.
- Invariant I5 (`docs/10-KONTRAKT.md`): jediný publikovaný port je
  `127.0.0.1:3070`. Vynucuje ho `scripts/check-compose-bind.ts`, unit test
  `compose-bind.spec.ts` a boot assertion `PUBLIC_BIND` — teda tri nezávislé
  poistky, zámerne.
- Kontrakt V3 (K1–K12) túto zmenu **nikde nepovoľuje**.

Postaviť to 1:1 znamená vystaviť appku, ktorá zapisuje ceny do produkčného
eshopu, do lokálnej siete — a obísť tri poistky, ktoré tomu bránia. `CLAUDE.md`
na to má pravidlo: *„keď si nie si istý, invariant vyhráva"*. **Preto to
nestavám bez rozhodnutia.** Sú tri čisté cesty:

1. **Nechať I5** a sekciu postaviť ako **zamknutú funkciu** so dôvodom (rovnako
   ako zamknuté filtre v Produktoch). Návrh sa tým neplní 1:1, ale appka
   nepovie nepravdu.
2. **Nový bod kontraktu (K13)**, ktorý expozíciu do LAN výslovne povolí a
   pripíše k nej poistky (allowlist zariadení v DB, schvaľovanie z už povoleného
   zariadenia, audit každého prihlásenia, `read-only` prístup ako predvolený).
   Potom sa mení `docker-compose.yml`, Caddy a všetky tri poistky I5 naraz.
3. **Odložiť** a nechať mobil na neskôr.

Sekundárne, menšie: **kópia do OneDrive** (`#zalohy`) je hostiteľská vec —
kontajner do OneDrive nedosiahne. Buď to robí skript na Windows a UI len číta
čas poslednej kópie, alebo je ten riadok zamknutý.

---

## C. Poradie, v akom to dobehnúť

Bez konfliktných vecí, od najväčšej hodnoty:

1. **Pravidlá pre percento** — funkčný dlh, nie kozmetika: sprievodca sa na tie
   pásma odvoláva. Nová tabuľka + API + použitie v kroku 2/3.
2. **Diagnostika** — plne špecifikovaná, žiadny konflikt, jedno tlačidlo a jedna
   cesta. Pozor: obsah je vymenovaný vrátane toho, čo v ňom **nesmie** byť (I1).
3. **Detail zľavy** — akcie (`Opakovať`, `Kopírovať s novými dátumami`,
   `Stiahnuť celý zoznam`), výsek auditu, tretí uhol výkonu.
4. **Detail produktu** — graf predajov po mesiacoch, `Otvoriť v shope`.
5. **Prehľad** — `Použiť` pri návrhoch.
6. **Prázdne stavy** — texty.
7. **Sprievodca 3/3** — panel výsledku skúšky naprázdno.
8. **Zálohy** — UI nad existujúcimi skriptmi (OneDrive podľa rozhodnutia z §B).
9. **Povolené zariadenia** — až po rozhodnutí z §B.

## D. Čo z toho vyplýva pre bránu K12

K12 treba doplniť o krok, ktorý dnes chýba: **skener v opačnom smere.**
`vocabulary.spec.ts` kontroluje, že na obrazovke nie je nič zakázané. Potrebný je
druhý test, ktorý z mockupov vytiahne povinné labely (s vylúčením demo dát) a
padne, keď na obrazovke **nie sú**. Inak sa „1:1" bude aj ďalej overovať okom,
teda nikdy.
