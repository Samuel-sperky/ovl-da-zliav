# Aura Zľavy V4 — dashboard, KPI produktov a hromadné zľavy: 60 otázok s návrhmi

**Dátum:** 2026-08-28 · **Stav:** čaká na odpovede
**Zadanie Samuela:** prvá strana = dashboard s produktmi a ich predajmi ·
Produkty s individuálnymi KPI · Zľavy s hromadným nastavovaním · referencia
(názov produktu) v tabuľkách vedľa id · technické riešenie kombinovaných dát
z API.

**Inštrukcia:** pri každej otázke je **Návrh**. Potvrď ho („OK"), alebo prepíš
vlastnou voľbou. Odpovedať môžeš priamo do tohto súboru alebo v chate číslami
(„1 OK, 2 b, 3 OK…").

**Čo NIE JE na stole** (invarianty I1–I14, `docs/10-KONTRAKT.md`): dry-run
+ potvrdenie pred každým zápisom (I3), append-only audit (I4), lokálnosť
(I5), denné rozpočty, šifrované kľúče. Hromadné zľavy tieto brány dedia.

**P0 — predpoklad celého sprintu:** predajové dáta stoja na objednávkovom
kľúči a sync je od 9. 8. blokovaný (`forbidden`). Kľúč, ktorý si poslal
v chate, **považuj za uniknutý a vygeneruj nový** — do chatu sa kľúče nedávajú
(I1). Nový vlož cez Nastavenia → Kľúče; appka ho overí sondou. Bez funkčného
kľúča bude dashboard prázdny, nech je akokoľvek pekný.

---

## A. Dashboard — prvá strana (1–12)

### 1. Vzťah k dnešnému Prehľadu?
- a) prepracovať Prehľad — jedna prvá strana, stavové sekcie sa zúžia
- b) nová stránka, Prehľad zostáva samostatne
**Návrh: a)** — dve „prvé strany" si konkurujú a Prehľad už predajovú sekciu má; rozšíri sa, nie zdvojí.

### 2. Na akú otázku má dashboard odpovedať na prvý pohľad?
- a) „čo sa predáva a čo leží" (produkty)
- b) „čo robia moje zľavy" (kampane)
- c) oboje — predaje hore, zľavy pod nimi
**Návrh: c)** — účel appky je „nájdi ležiaka → zľavni ho → pozri, či to pomohlo"; obe polovice tej slučky patria na jednu obrazovku.

### 3. Časové okno predajov na dashboarde?
- a) pevné 30 dní
- b) prepínač 7 / 30 / 90 dní (predvolené 30)
**Návrh: b)** — Produkty už prepínač období (30–360) majú, dashboard drží rovnaký vzor.

### 4. Koľko top/flop produktov v tabuľkách dashboardu?
- a) 10 + odkaz do Produktov
- b) 20
**Návrh: a)** — dashboard je výhľad, nie pracovný stôl; pracuje sa v Produktoch.

### 5. Ukázať vedľa najpredávanejších aj najhoršie ležiaky?
- a) áno, dve tabuľky vedľa seba
- b) nie, ležiaky sú vec Produktov
**Návrh: a)** — ležiaky sú surovina pre zľavy, teda hlavný dôvod appky.

### 6. Stačia kusy, alebo treba aj tržby v €?
- a) kusy stačia (dnešný stav — appka sumy nepozná)
- b) aj € — ak objednávkové API vracia ceny položiek, ukladať a ukazovať tržbu
**Návrh: b)**, ak API sumy dáva (overí sa v prvej fáze); marža a dopad zliav sa bez € nedajú povedať poctivo. Ak API sumy nedáva, platí a) a appka to prizná (I11).

### 7. Hlavný graf: predaje s vyznačenými oknami zliav?
- a) áno — denná krivka kusov s podfarbenými oknami kampaní
- b) nie, len čísla a mini-graf ako dnes
**Návrh: a)** — je to jediný graf, ktorý spája obe polovice slučky z ot. 2.

### 8. Bežiace zľavy na dashboarde?
- a) karta: bežiace + najbližší plánovaný fire + posledný výsledok zápisu
- b) len počet s odkazom
**Návrh: a)** — „čo robia moje zľavy" bez čísel nie je odpoveď.

### 9. Stav appky (kľúč, prekážky, fronta) na dashboarde?
- a) zúžený stavový pás hore (jeden riadok, rozklik)
- b) ponechať dnešnú plnú sekciu „prečo sa nezapisuje"
**Návrh: a)** — prekážky MUSIA zostať viditeľné (bez kľúča je všetko ostatné dekorácia), ale nemusia zaberať tretinu obrazovky, keď je všetko zelené.

### 10. Obnovovanie dát na dashboarde?
- a) len manuálne tlačidlo (dnešný princíp: appka sama nič neprepisuje)
- b) auto-refresh každých X minút
**Návrh: a)** — držať dnešný princíp; čísla sa nemenia pod rukami.

### 11. Priznané medzery v dátach (nesťahované dni)?
- a) vždy viditeľné priamo v grafe (dnešný vzor „nesťahované dni")
- b) len v technickom detaile
**Návrh: a)** — I11; graf, ktorý medzeru zamlčí, klame trendom.

### 12. Cieľová obrazovka?
- a) desktop-first, mobil bez extra práce
- b) responzívny aj pre tablet/mobil
**Návrh: a)** — jednoužívateľská appka na jednom PC; mobil je práca navyše bez použitia.

## B. Produkty — individuálne KPI (13–24)

### 13. KPI stĺpce v tabuľke Produktov (vyber sadu)?
- a) predané ks 30 d, ks 90 d, obrátkovosť, aktuálna cena, aktívna zľava %, posledný predaj
- b) užšie: ks 30 d, cena, zľava
- c) iná sada — vypíš
**Návrh: a)** — všetko sú to čísla, ktoré po synci máme lokálne; nič nevolá API pri renderi.

### 14. Marža ako číslo na produkte?
- a) áno, ak API dáva nákupnú cenu (`getFull`) — uložiť a počítať
- b) nie, marža zostáva len ako dnešný filter
**Návrh: a)** s výhradou: či API nákupnú cenu vracia, sa overí v prvej fáze; ak nie, b) a appka medzeru prizná.

### 15. Detail produktu?
- a) rozšíriť dnešný bočný panel (ProductDetailPanel)
- b) plná stránka /produkty/[id]
**Návrh: a)** — panel už existuje a nedávno prestal byť overlay; plná stránka je nová navigácia bez novej hodnoty.

### 16. Graf predajov na detaile produktu?
- a) denná krivka 90 dní s oknami zliav toho produktu
- b) len čísla
**Návrh: a)** — per-produkt verzia grafu z ot. 7, rovnaký komponent.

### 17. Uplift zľavy per produkt (pred vs. počas)?
- a) áno — ks/deň pred oknom vs. v okne, s poctivým oknom porovnania
- b) nie
**Návrh: a)** — ale POZOR na zapísanú pascu: tu sa už raz „dve pred-zľavové okná" vydávali za výkon zľavy (commit d00e081). Definícia okien bude v kontrakte explicitná.

### 18. Predvolené zoradenie Produktov?
- a) najhoršie ležiaky prvé (dnešný vzor výberu do zľavy)
- b) najpredávanejšie prvé
**Návrh: a)** — konzistentné s účelom.

### 19. Čerstvosť predajových KPI?
- a) 1× denne v noci + manuálne „Obnoviť"
- b) každé 4 hodiny
**Návrh: a)** — rozpočet 240 čítaní/deň sa delí s katalógom (41 348 produktov); KPI zo včera stačia na rozhodnutie o zľave.

### 20. Filtre v Produktoch — doplniť?
- a) + hľadanie podľa názvu/referencie, + „má aktívnu zľavu", zvyšok nechať
- b) nechať presne dnešné (kategória, kov, typ, marža, obrátkovosť)
**Návrh: a)** — hľadanie podľa referencie je priamo v zadaní.

### 21. CSV export tabuľky produktov s KPI?
- a) áno
- b) nie
**Návrh: b)** — kým ho reálne nepotrebuješ; každá funkcia sa udržiava.

### 22. Úroveň KPI: produkt vs. variant?
- a) produkt (súčet variantov) — zľavy sa píšu na produkt
- b) aj varianty
**Návrh: a)** — API referencie variantov existujú, ale zľava aj rozhodnutie sa robia na produkte.

### 23. Stránkovanie tabuľky?
- a) po 100
- b) po 50
**Návrh: a)** — dnešný katalóg číta po 100, tabuľka nech drží krok.

### 24. Zvýrazniť „mŕtve" produkty (0 predajov za 180 d)?
- a) áno, značka „bez predaja" = kandidát na zľavu
- b) nie
**Návrh: a)** — s poctivou podmienkou: značka len ak máme stiahnuté dni, ktoré to dokazujú (I11).

## C. Zľavy — hromadné nastavovanie (25–36)

### 25. Čo znamená „hromadne" nad rámec dnešného toku (filter → pásma → kampaň)?
- a) dnešný tok stačí, len sa doladí (predvýber z Produktov, viditeľnosť)
- b) viac kampaní naraz (napr. per kategória) v jednom kroku
- c) uložené presety (ot. 28) + predvýber; jedna kampaň na jeden beh
**Návrh: c)** — b) znásobuje riziko zápisu a I3 potvrdenie by sa muselo robiť N×; preset šetrí čas bez oslabenia brán.

### 26. Pásma (rôzne % podľa pravidiel) zostávajú?
- a) áno, dnešný model
- b) zjednodušiť na jedno % pre celý výber
**Návrh: a)** — pásma sú hotové a testované; zjednodušenie je strata funkcie, nie zjednodušenie práce.

### 27. Výber produktov checkboxami v tabuľke Produktov → „pridať do zľavy"?
- a) áno — ručný výber sa spojí s filtrom
- b) nie, výber len filtrom ako dnes
**Návrh: a)** — „hromadne" v praxi znamená aj „týchto 15 konkrétnych".

### 28. Pomenované presety zľavy (filter + pásma + trvanie)?
- a) áno — uložiť, spustiť na klik; dry-run a potvrdenie VŽDY nanovo
- b) nie
**Návrh: a)** — opakovaná mesačná rutina; brány I3 nedotknuté.

### 29. „Zopakovať zľavu" z minulej kampane (prefill formulára)?
- a) áno
- b) nie
**Návrh: a)** — lacné (prefill, žiadna nová cesta zápisu).

### 30. Predvolené trvanie zľavy?
- a) 14 dní (dnešné)
- b) iné — napíš
**Návrh: a)**.

### 31. Produkt s už bežiacou zľavou v hromadnom výbere?
- a) vylúčiť z výberu a ukázať koľko a prečo (dry-run to vyčísli)
- b) zablokovať celú kampaň
**Návrh: a)** — dnešné správanie výberu; blokovať celok pre 3 kolízie z 500 je trest bez viny.

### 32. Výber väčší než strop kampane (10 000 v plnom rozsahu)?
- a) orezať + povedať koľko ostalo (dnešný ScopeRelease vzor)
- b) automaticky rozdeliť na viac kampaní s N potvrdeniami
**Návrh: a)** — automatické delenie je N zápisov z jedného kliku; proti duchu I3.

### 33. Potvrdenie: dvojkrok (skúška naprázdno → opísať počet) zostáva pre hromadné zľavy NEDOTKNUTÝ?
- a) áno (jediná správna odpoveď — I3 po D100 je posledná brána pred produkciou)
**Návrh: a)** — otázka je tu preto, aby to kontrakt niesol čierne na bielom.

### 34. Odhad dopadu v dry-rune: priemerná hĺbka zľavy + (ak máme €) dopad na tržbu/maržu?
- a) áno
- b) nie, dnešné čísla stačia
**Návrh: a)** — dry-run je presne miesto, kde sa má rozhodovať.

### 35. Kalendár/timeline okien zliav na stránke Zľavy?
- a) áno — vizuálne pásy kampaní v čase (insights/timeline už existuje)
- b) nie
**Návrh: a)** — dáta aj endpoint existujú, chýba len obrazovka.

### 36. Oznámenie po dobehnutí hromadného zápisu?
- a) stačí dnešok: výsledok v appke + audit
- b) niečo navyše (napíš čo)
**Návrh: a)** — lokálna jednoužívateľská appka; ďalší kanál = ďalšia údržba.

## D. Referencia v tabuľkách (37–42)

### 37. Kde všade zobrazovať referenciu?
- a) všade, kde je dnes product_id: Produkty, detail, výber zľavy, položky kampane, audit
- b) len v Produktoch
**Návrh: a)** — id bez referencie je pre človeka slepé číslo; keď, tak všade.

### 38. Formát bunky produktu?
- a) `referencia · názov` viditeľné, product_id v technickom detaile/title
- b) referencia ako samostatný stĺpec vedľa id
**Návrh: a)** — id potrebuje appka, nie oko; referencia a názov sú to, čo poznáš zo skladu.

### 39. Zdroj referencie — katalóg ju dnes NEUKLADÁ?
- a) nový stĺpec `reference` v `catalog_cache` (aditívna migrácia) + sync ju začne ukladať
- b) čítať z uloženého `raw` JSON bez migrácie
- c) doťahovať z API pri zobrazení
**Návrh: a)** — čistá aditívna migrácia (číslovaná, so zálohou), sync to pole už dostáva. b) je krehké (raw je redigovaný), c) míňa rozpočet na render.

### 40. Hľadanie podľa referencie?
- a) áno, lokálne nad novým stĺpcom (bez API volaní)
- b) nie
**Návrh: a)** — nadväzuje na ot. 20.

### 41. Referencia pri historických záznamoch (audit, staré kampane)?
- a) doplniť JOIN-om z katalógu pri zobrazení; audit sa spätne NEPREPISUJE
- b) spätne dopísať do starých riadkov
**Návrh: a)** — audit je append-only (I4); b) je prepisovanie histórie.

### 42. Produkt bez referencie v shope?
- a) ukázať pomlčku + product_id (appka prizná, čo nevie — I11)
- b) skryť pole
**Návrh: a)**.

## E. Kombinované dáta z API — technika (43–54)

### 43. Architektúra kombinovania?
- a) sync do lokálnych tabuliek → obrazovky čítajú výhradne lokálnu DB (dnešný vzor katalógu a predajov)
- b) live volania na shop API pri renderi obrazoviek
**Návrh: a)** — rozpočet 240 čítaní/deň by live render zjedol za hodinu; a latencia. Toto je odpoveď na „technické riešenie kombinovaných dát": JOIN v lokálnej MariaDB, nie v prehliadači.

### 44. Backfill objednávkovej histórie (dnes 2 dni)?
- a) 180 dní — pokrýva okná obrátkovosti (30–180) aj uplift
- b) 90 dní
- c) 365 dní
**Návrh: a)** — 365 je dvojnásobný rozpočet za dáta, ktoré žiadna obrazovka nečíta.

### 45. Tempo backfillu?
- a) po častiach, niekoľko dní, s rešpektom k dennému rozpočtu (katalóg má prednosť)
- b) jednorazovo, na pár dní pozastaviť čítanie katalógu
**Návrh: a)** — pomalšie, ale nič nezastaví; presne takto už funguje katalóg (pokračovanie prechodu).

### 46. Granularita uložených predajov?
- a) denné agregáty per produkt (ks/deň) — dnešný vzor
- b) riadok per položka objednávky
**Návrh: a)** — každé KPI z ot. 13–17 sa spočíta z denných agregátov; b) je 100× viac riadkov bez novej odpovede.

### 47. Ukladať aj tržbu v € (ak ju API dáva)?
- a) áno — stĺpec v denných agregátoch
- b) nie
**Návrh: a)** — viazané na ot. 6; jeden stĺpec navyše pri synci, žiadne volanie navyše.

### 48. Nákupná cena do katalógu (pre maržu)?
- a) áno, ak ju `getFull` vracia — stĺpec v `catalog_cache`, plní ho existujúci sync
- b) nie
**Návrh: a)** — viazané na ot. 14; overí sa sondou v prvej fáze a kontrakt ponesie výsledok.

### 49. Frekvencia priebežného syncu predajov (po backfille)?
- a) 1× denne v noci + manuálne tlačidlo
- b) častejšie
**Návrh: a)** — konzistentné s ot. 19.

### 50. Nový objednávkový kľúč — scopes a postup?
- a) vygeneruješ nový kľúč (starý z chatu = uniknutý) so scopes na čítanie objednávok + produktov, vložíš cez UI, appka overí sondou; až potom sa spustí backfill
- b) iný postup — napíš
**Návrh: a)** — a ak sonda znova vráti `forbidden`, ide žiadosť IT (vzor `docs/60/61-ZIADOST-*`), nie obchádzka.

### 51. Kde žije čítacia logika KPI?
- a) rozšíriť existujúce: `src/lib/sales/insights.ts` + endpointy `src/app/api/insights/*`
- b) nová samostatná vrstva
**Návrh: a)** — čítacia strana predajov už existuje a je oddelená od zápisovej (I8').

### 52. Výpočet KPI?
- a) SQL v repozitároch (raw parametrizované SQL — vzor celého repa)
- b) v aplikačnej vrstve nad surovými riadkami
**Návrh: a)**.

### 53. Predpočítavať KPI (materializácia) alebo počítať pri dotaze?
- a) počítať pri dotaze s indexami; materializovať až keď meranie ukáže, že je to pomalé
- b) rovno predpočítaná KPI tabuľka pri každom synci
**Návrh: a)** — 41 k produktov × denné agregáty MariaDB s indexom zvládne; optimalizovať sa má na základe merania, nie strachu.

### 54. Zlyhanie syncu na dashboarde?
- a) viditeľné: „dáta k <dátum> · sync blokovaný: <dôvod>" (dnešný vzor)
- b) ticho, dáta proste starnú
**Návrh: a)** — I11; presne táto situácia (forbidden od 9. 8.) je dnes realita.

## F. Rozsah, poradie, riziká (55–60)

### 55. Poradie dodania?
- a) 1. referencia + katalóg → 2. kľúč + backfill predajov → 3. dashboard → 4. KPI produktov → 5. hromadné zľavy
- b) iné — napíš
**Návrh: a)** — dáta pred obrazovkami; obrazovka bez dát je atrapa a nedá sa overiť preklikom.

### 56. Čo v tomto sprinte vedome NIE JE?
- a) mobil, e-mail/push notifikácie, KPI variantov, automatické delenie kampaní, druhý používateľ
- b) uprav zoznam
**Návrh: a)** — čokoľvek z toho sa dá otvoriť ako ďalší sprint.

### 57. Vizuálny jazyk?
- a) držať dnešný KISS dizajn (`docs/33-KISS-DIZAJN.md`) — nové obrazovky z existujúcich komponentov
- b) nový dizajn
**Návrh: a)** — appka má konzistentný a otestovaný vizuál; nový dizajn je samostatný projekt.

### 58. Veľkosť a strop sprintu?
- a) rozdeliť na 2 sprinty: V4a dáta (ref., kľúč, backfill, KPI čítanie) → V4b obrazovky (dashboard, Produkty, Zľavy); každý ~M–L, schválenie zvlášť
- b) jeden veľký sprint L s jedným stropom
**Návrh: a)** — V4a sa dá dokázať testami nad DB bez jediného pixelu; V4b sa potom overuje preklikom nad skutočnými dátami. Menšie riziko, čistejšie kontrakty.

### 59. Dôkaz UI (screenshoty)?
- a) preklik + screenshoty s tvojou účasťou (panel prehliadača musí byť zobrazený — bez teba screenshoty nevzniknú, ako v minulom sprinte)
- b) stačí textový preklik
**Návrh: a)** — CLAUDE.md screenshot vyžaduje a minulý sprint ukázal, že bez zobrazeného panelu sa nedá urobiť.

### 60. Názvoslovie prvej strany?
- a) zostáva „Prehľad" (slovenské UI texty), obsah sa mení podľa A.
- b) premenovať na „Dashboard"
**Návrh: a)** — UI texty tohto projektu sú slovenské; „dashboard" je slovo z porady, nie z obrazovky.

---

**Po odpovediach:** kontrakt `KONTRAKT-V4-*.md` (cieľ, rozsah ÁNO/NIE,
rozhodnutia, akceptačné kritériá, riziká) + plán vĺn agentov s odhadom spendu
→ tvoje schválenie → autonómny beh.
