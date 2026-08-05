# Aura Zľavy (ovl-da-zliav) — finálny dotazník: 100 otázok s návrhmi

**Projekt:** Aura Zľavy — lokálna Docker appka na ovládanie zliav v produkčnom eshope sperky-eshop.sk cez REST API
**Dátum:** 2026-08-05
**Stav:** čaká na odpovede
**Inštrukcia:** Pri každej otázke je pripravený **Návrh** (písmeno + zdôvodnenie). Buď návrh **potvrď** (stačí „OK"), alebo ho **prepíš** vlastnou voľbou/odpoveďou. Návrhy sú vzájomne konzistentné a konzistentné s 10 rozhodnutiami z `docs/00-KONTEXT-10-OTAZOK.md`.

**Otázka č. 1 celého dotazníka je konflikt scheduler × 48 h TTL kľúča** — nachádza sa v oblasti Logika ako otázka 21 (číslovanie zachované kvôli krížovým odkazom kritika), ale odpovedz na ňu ako prvú: návrhy v UX/UI aj API na nej stoja.

---

## Logika — ⚠️ ZAČNI TU: otázka č. 1 celého dotazníka

### 21. ⚠️ Hlavné riešenie konfliktu scheduler × 48 h TTL kľúča? (OTÁZKA Č. 1)
- a) kampaň sa dá vytvoriť vždy; bez platného kľúča v čase fire prejde do „vyžaduje kľúč", nezapíše sa a čaká na obnovenie
- b) tvrdý blok: kampaň so štartom za horizontom platnosti kľúča nejde uložiť
- c) výnimka z TTL: kľúč krytý naplánovanou kampaňou sa wipne až po jej spustení (+1 h)
- d) eager write: zapísať hneď pri vytvorení kampane s budúcim `from` (API budúce okno podporuje) — kľúč po 48 h už netreba

**Návrh:** **a)** — fail-closed záchranná sieť, ktorá nikdy neoslabí 48 h TTL (na rozdiel od c) a nikdy neblokuje plánovanie (na rozdiel od b); eager write d) sa neponúka ako jediné správanie, lebo zapísanú zľavu nejde zrušiť (rozhodnutie 6), ale ponúkne sa ako odporúčaná voľba v ot. 22.

---

## UX/UI

### 1. Čo je hlavná obrazovka po prihlásení?
- a) kombinovaný dashboard: stav kľúča + ohrozené/bežiace kampane + 10 allowlist produktov
- b) prehľad allowlist produktov so stavom podľa lokálnej DB, kampane ako podstránka
- c) zoznam kampaní, produkty ako podstránka

**Návrh:** **a)** — tri veci, ktoré Samuel potrebuje vidieť do 3 sekúnd (TTL kľúča, kampane „vyžaduje kľúč" z ot. 21a, stav 10 produktov), patria na jednu obrazovku.

### 2. Aká forma povinného potvrdenia pred ostrým zápisom?
- a) dvojkrokový flow: dry-run náhľad → samostatné tlačidlo „Zapísať do PRODUKCIE"
- b) modal so súhrnom + checkbox „rozumiem, mením produkčné ceny"
- c) dvojkrok + ručné opísanie počtu menených produktov (napr. „4")
- d) dvojkrok + napísať slovo „ZAPÍSAŤ"

**Návrh:** **a)** — dvojkrok s dry-run napĺňa povinné potvrdenie z rozhodnutia 5; extra trenie c)/d) je pri dennej práci jediného experta kontraproduktívne, ochranu proti „autopilotu" dodá sudo re-auth z ot. 70.

### 3. Čo obsahuje dry-run náhľad?
- a) tabuľka diff per produkt: názov, aktuálna cena, %, okno od–do, posledný vlastný zápis
- b) tabuľka diff + presné JSON payloady, ktoré sa reálne odošlú
- c) len textový súhrn („10 produktov, −15 %, 1.9.–30.9.")

**Návrh:** **a)** — diff tabuľka je to, čo človek reálne kontroluje; presné payloady sa aj tak celé ukladajú do auditu (ot. 50), takže v náhľade by boli len šum.

### 4. Zobrazovať vypočítanú zľavnenú cenu (price × (1 − r/100))?
- a) áno, s upozornením „orientačný výpočet appky; cena z verejného GET, zaokrúhlenie shopu sa môže líšiť"
- b) áno, bez upozornenia — ceny sú to, čo môže bolieť
- c) nie, len percento a dátumy

**Návrh:** **a)** — cena je to, čo rozhoduje, ale API zľavu nevracia a zaokrúhlenie shopu nepoznáme, takže poctivé priznanie neistoty je súčasť doktríny driftu (ot. 38).

### 5. Kde a ako zobrazovať odpočet 48 h TTL kľúča?
- a) trvalý badge v hlavičke na každej stránke + zmena farby pod 6 h
- b) badge v hlavičke + blokujúci banner pod 1 h
- c) len karta na dashboarde

**Návrh:** **a)** — trvalá viditeľnosť bez blokovania práce; blokujúci banner b) by prekážal pri čítacích činnostiach, ktoré po expirácii kľúča legitímne fungujú (GET je verejný).

### 6. Ako vizuálne komunikovať „PRODUKCIA + zápis je nevratný"?
- a) trvalý červený pruh „PRODUKCIA — sperky-eshop.sk" v hlavičke + veta o nevratnosti v každom potvrdení
- b) len v potvrdzovacom modali
- c) červený akcent celej témy + jednorazové poučenie pri prvom zápise

**Návrh:** **a)** — bez stagingu (rozhodnutie 5) musí byť „toto je ostré" viditeľné trvalo, nie až v momente potvrdenia.

### 7. Ako UI komunikuje, že skutočný stav zľavy v shope je neznámy (API ho nevracia)?
- a) badge pri každom produkte: „podľa vlastného zápisu z DD.MM. — shop môže mať iný stav"
- b) jedna trvalá poznámka nad zoznamom produktov
- c) nekomunikovať, stačí história v audit logu

**Návrh:** **a)** — per-produkt badge s dátumom vlastného zápisu je jediné poctivé zobrazenie najväčšej diery kontraktu; konzistentné s doktrínou driftu (ot. 38).

### 8. Ako upozorniť na kampaň naplánovanú za horizont expirácie kľúča?
- a) žltý warning pri vytváraní + trvalý stav „vyžaduje kľúč" v zozname
- b) tvrdý blok — kampaň nejde uložiť, kým nebude kľúč pokrývať štart
- c) warning pri vytváraní + banner na dashboarde so zoznamom všetkých ohrozených kampaní

**Návrh:** **c)** — priamy dôsledok ot. 21a: kampaň sa vytvoriť dá, ale ohrozené kampane musia byť agregované na dashboarde (ot. 1a), nie len roztratené v zozname.

### 9. Kľúč expiruje presne počas otvoreného potvrdzovacieho formulára — čo s tým?
- a) submit zablokovať, dáta formulára zachovať, vyžiadať nový kľúč inline
- b) presmerovať na zadanie kľúča (rozpracované sa stratí)
- c) submit pustiť a nechať zlyhať na 401 s vysvetlením

**Návrh:** **a)** — fail-closed bez straty práce; c) by navyše spustil wipe reakciu na 401 (ot. 51) na vlastnú, ešte platnú konfiguráciu.

### 10. Správanie UI po expirácii kľúča?
- a) read-only: všetko vidno, zapisovacie akcie disabled s tooltipom + nenápadná výzva v hlavičke
- b) blokujúci banner s formulárom na nový kľúč na každej stránke
- c) nič sa nemení, chyba až pri pokuse o zápis

**Návrh:** **a)** — čítacia časť appky funguje aj bez kľúča (verejné GET), takže read-only režim je prirodzený; blokovať celé UI nie je dôvod.

### 11. Ako sa zadáva percento zľavy?
- a) číselné pole (celé čísla 1–30) + prednastavené čipy 5/10/15/20/25/30
- b) len čipy z povolených hodnôt, žiadny voľný vstup
- c) číselné pole s podporou 1 desatinného miesta (12,5 %)
- d) slider 1–30

**Návrh:** **a)** — celé čísla pokrývajú reálne marketingové použitie, čipy zrýchľujú bežné hodnoty a limit 1–30 zrkadlí API constraint (0 < x ≤ 30) lokálne.

### 12. Ako sa zadáva okno od–do?
- a) kalendárové pickery + presety (7/14/30 dní, do konca mesiaca)
- b) len presety, vlastný rozsah schovaný pod „rozšírené"
- c) dva kalendárové pickery bez presetov

**Návrh:** **a)** — presety znižujú chybovosť dátumov, pickery nechávajú plnú voľnosť v medziach 3-mesačnej validácie (ot. 29).

### 13. Explicitný výklad dátumov v UI („platí od 00:00 dňa OD do 23:59 dňa DO, čas shopu")?
- a) áno, text priamo pod dátumovými poľami + formát DD.MM.YYYY všade
- b) len tooltip pri poliach
- c) neuvádzať

**Návrh:** **a)** — API berie holé YYYY-MM-DD a interpretáciu hraníc dňa nedokumentuje, takže UI musí výklad vysloviť nahlas; formát DD.MM.YYYY je konzistentný s Europe/Bratislava (ot. 31).

### 14. Aké stavy kampaní zobrazovať v zozname?
- a) plná sada: naplánovaná / vyžaduje kľúč / beží zápis / aktívna / expirovaná / čiastočná / zlyhala / zmeškaná / zrušená — farebné badge + filter
- b) redukovaná sada: čaká / hotová / zlyhala
- c) plná sada v taboch podľa stavu

**Návrh:** **a)** — sada 1 : 1 zrkadlí stavový stroj jobov (ot. 83a); redukovaná sada by zamlčala presne tie stavy („vyžaduje kľúč", „čiastočná", „zmeškaná"), kvôli ktorým dotazník vznikol.

### 15. Ako zobraziť čiastočné zlyhanie (6/10 OK)?
- a) tabuľka per produkt: ✓/✗, slovenská hláška + raw kód API, tlačidlo „Zopakovať zlyhané"
- b) súhrn „6/10 OK" s rozbaľovacím detailom
- c) súhrn + odkaz do audit logu

**Návrh:** **a)** — setReduction nie je atomický, takže per-produkt výsledok s okamžitou akciou „Zopakovať zlyhané" je jadro celého UX; konzistentné so stratégiou pokračuj-a-reportuj (ot. 34a).

### 16. Vyžaduje „Zopakovať zlyhané" nové potvrdenie?
- a) áno, vždy znova cez dry-run potvrdenie (aj pri identických parametroch)
- b) nie — parametre už boli potvrdené, jeden klik
- c) bez potvrdenia do 15 min od pôvodnej operácie, potom s potvrdením

**Návrh:** **a)** — rozhodnutie 5 robí potvrdenie pred zápisom povinným bez výnimky; navyše medzi pokusmi sa mohla zmeniť cena (re-check z ot. 39 beží aj tu).

### 17. Ako sa Samuel dozvie výsledok kampane odpálenej schedulerom cez noc?
- a) notifikačný panel + záznam na vrchu dashboardu, kým ho neodklikne
- b) len záznam v zozname kampaní a v audite
- c) navyše e-mail (vyžaduje SMTP konfiguráciu — súvisí s ot. 26)

**Návrh:** **a)** — lokálna single-user appka bez SMTP závislosti; neodkliknutý výsledok na vrchu dashboardu (ot. 1a) zaručí, že sa nestratí.

### 18. Audit log v UI?
- a) filtre (produkt, dátum, typ operácie, výsledok) + detail so snapshotom pred/po a raw odpoveďou
- b) filtre + export CSV
- c) len chronologický zoznam s detailom, bez filtrov

**Návrh:** **a)** — detail so snapshotom pred/po je presne to, čo rozhodnutie 9 sľubuje; CSV export sa dá doplniť neskôr, keby bol treba.

### 19. UX predĺženia zľavy?
- a) akcia „Predĺžiť" pri aktívnom zázname: všetko predvyplnené, edituje sa len `to`
- b) bežný formulár s predvyplnením (aj % editovateľné)
- c) samostatný minidialóg len s novým koncovým dátumom

**Návrh:** **a)** — zrkadlí sémantiku predĺženia z ot. 27a (rovnaké `from` a %, nové `to`); zmena % je vedome iná operácia (prepis), nie predĺženie.

### 20. Prázdne stavy pri prvom spustení (žiadny kľúč, žiadna doména)?
- a) onboarding checklist: 1. doména, 2. kľúč, 3. allowlist, 4. testovací dry-run
- b) len kontextové hlášky na prázdnych miestach
- c) jednorazový modálny sprievodca

**Návrh:** **a)** — poradie krokov je zároveň validačná pipeline (doména → canary GET z ot. 55 → kľúč → allowlist) a končí bezpečným dry-runom namiesto ostrého zápisu.

## Logika (pokračovanie)

### 22. Ak 21 ≠ d: má appka aspoň ponúknuť „zapísať hneď s budúcim from", keď je kľúč práve platný?
- a) áno, default zapnuté („odporúčané — štart nezávisí od kľúča v deň D")
- b) áno, default vypnuté (odklad zápisu umožňuje kampaň ešte meniť/zrušiť plán)
- c) nie — jednotné správanie podľa ot. 21

**Návrh:** **a)** — toto je odporúčané rozpustenie TTL konfliktu: keď je kľúč platný pri vytváraní, budúce okno sa zapíše hneď a kampaň na kľúči v deň D vôbec nezávisí; potvrdenie explicitne upozorní, že eager zápis sa už nedá zrušiť (len prepísať), takže vedomé vypnutie voľby zostáva možné.

### 23. Scheduler odpáli kampaň a kľúč je expirovaný — životný cyklus?
- a) „vyžaduje kľúč"; po zadaní nového kľúča sa dopáli, ak je stále vo svojom okne
- b) „zlyhala", vždy manuálne znovuspustenie
- c) automatické dopálenie len do X hodín po pláne, potom manuálne

**Návrh:** **a)** — priame pokračovanie ot. 21a; hranicu „stále vo svojom okne" rieši ot. 25, takže časový strop c) je zbytočná duplicitná poistka.

### 24. Po zadaní nového kľúča: čakajúce kampane sa dopália…
- a) automaticky všetky, ktoré sú stále vo svojom okne (s notifikáciou v UI)
- b) až po manuálnom potvrdení per kampaň
- c) automaticky len tie s `from` ≥ dnes; tie „v strede okna" s potvrdením

**Návrh:** **a)** — kampane už prešli povinným potvrdením pri vytvorení a sú v okne, ktoré Samuel schválil; notifikácia (ot. 17a) + audit posun `from` (ot. 25a) pokryjú prehľadnosť bez ďalšieho klikania.

### 25. Kampaň „vyžaduje kľúč", ktorej okno sa medzitým kráti alebo uplynulo?
- a) `to` v minulosti → „prepadnutá" (bez zápisu); `from` v minulosti → pri dopálení posunúť `from` na dnes + audit záznam
- b) akákoľvek zmena okna → manuálne rozhodnutie
- c) dopáliť s pôvodnými dátumami, nech rozhodne API

**Návrh:** **a)** — deterministické pravidlo bez čakania na človeka: prešlé okno sa nikdy nezapisuje, skrátené okno sa poctivo posunie a posun je viditeľný v audite; c) by narazil na `invalid_dates`.

### 26. Kedy pripomínať „vlož kľúč pre kampaň X"?
- a) UI banner 48/24/2 h pred spustením
- b) len pri najbližšom prihlásení
- c) banner + e-mail (ak sa v ot. 17 zvolí SMTP)

**Návrh:** **a)** — konzistentné s ot. 17a (bez SMTP); prvý stupeň 48 h zodpovedá presne TTL kľúča, takže Samuel vie, či nový kľúč vydrží do štartu.

### 27. Sémantika „predĺženia" — aký payload?
- a) rovnaké `from` a %, nové `to` (jeden setReduction); zmena % = nová kampaň/prepis
- b) `from` = dnes, nové `to` (resetuje 3-mesačné okno, samostatný audit záznam)
- c) voľba pri akcii, % možno meniť zároveň

**Návrh:** **a)** — najčistejšia sémantika: predĺženie nemení nič okrem konca, história zostáva jednoznačná; pozor len na 3-mesačný strop od pôvodného `from` (validácia z ot. 29), pri jeho prekročení UI ponúkne prepis podľa b) ako vedomú alternatívu.

### 28. Nová zľava na produkt, kde podľa vlastnej DB už zľava beží alebo je naplánovaná?
- a) povoliť ako explicitné „prepísanie" s diffom starý→nový v potvrdení; prekryv dvoch budúcich kampaní blokovať pri vytváraní
- b) blokovať všetko okrem akcie „predĺžiť"
- c) len warning — posledný zápis vyhráva (tak funguje API)

**Návrh:** **a)** — prepis je jediný spôsob „úpravy" zľavy (clear neexistuje), takže musí byť povolený, ale výhradne s diffom; blokovanie prekryvu budúcich kampaní bráni tichému vzájomnému prepisovaniu plánov.

### 29. Lokálna validácia „max 3 mesiace"?
- a) kalendárne (`from` + 3 mesiace ≥ `to`) + pri serverovom `range_too_long` zrozumiteľná oprava
- b) konzervatívne max 90 dní (nikdy nenarazí na hranu)
- c) nevalidovať, spoľahnúť sa na API

**Návrh:** **a)** — zrkadlí pravidlo API bez umelého ukrajovania (90 dní by zakázalo legitímne 3-mesačné okná); serverový `range_too_long` zostáva ošetrený ako záchranná sieť.

### 30. Hrany `from`: minulosť, dnes, `from` = `to`?
- a) `from` ≥ dnes; `from` = dnes OK; jednodňová zľava OK s potvrdením „naozaj 1 deň?"
- b) `from` ≥ dnes pri manuálnom, ≥ zajtra pri plánovanom; jednodňová bez potvrdenia
- c) pustiť všetko, rozhodne API

**Návrh:** **a)** — `from` v minulosti nemá pri zakladaní zmysel (posun rieši ot. 25a len pri dopálení), jednodňová zľava je legálna, ale dosť nezvyčajná na jedno potvrdenie navyše.

### 31. Časová zóna dátumovej logiky?
- a) Europe/Bratislava všade (UI, scheduler, interpretácia YYYY-MM-DD), časové pečiatky v DB v UTC
- b) Europe/Bratislava všade vrátane DB
- c) UTC interne aj v UI

**Návrh:** **a)** — shop aj Samuel žijú v Bratislave, ale UTC pečiatky v DB sú imúnne voči DST a štandard rodiny; dátumy zliav sú beztak holé YYYY-MM-DD.

### 32. Kedy scheduler zapisuje kampaň s `from` = D?
- a) deň D krátko po polnoci (napr. 00:05 času shopu)
- b) deň D−1 večer — zľava aj tak platí až od `from` (de facto eager write o deň skôr)
- c) konfigurovateľný čas, default D 00:05

**Návrh:** **a)** — pevných 00:05 je najjednoduchšie a bezpečne mimo polnočnej hrany (ot. 59); flexibilitu „skôr" už poskytuje eager write z ot. 22, netreba ďalší konfig.

### 33. Catch-up zmeškaných fire (kontajner bol vypnutý)?
- a) automaticky dobehnúť, ak meškanie < 24 h a okno stále platí; inak „zmeškaná" na manuálne rozhodnutie
- b) nikdy automaticky, vždy manuálne potvrdenie
- c) dobehnúť všetko, kým `to` neprešlo

**Návrh:** **a)** — do 24 h je zámer kampane evidentne stále platný; staršie zmeškania môžu mať zmenený kontext, tak nech rozhodne človek (stav „zmeškaná" existuje v ot. 14a/83a).

### 34. Základná stratégia pri čiastočnom zlyhaní dávky?
- a) pokračovať cez všetky produkty, na konci report OK/zlyhané + manuálny retry
- b) stop pri prvej chybe, zapísané nechať a označiť „čiastočná"
- c) pokračovať + automatický retry zlyhaných 3× s backoffom, až potom report

**Návrh:** **a)** — produkty sú na sebe nezávislé, tak nech jedna chyba nezhodí zvyšok; automatické opakovania na úrovni requestu už rieši taxonómia chýb (ot. 41–43), ďalšia vrstva v c) by ich duplikovala.

### 35. „Kompenzácia" už zapísaných produktov pri čiastočnom zlyhaní?
- a) žiadne vracanie (clear neexistuje) — ponúkať len dopísanie zlyhaných a jasne to komunikovať
- b) manuálna akcia „prepísať posledným vlastným stavom zo snapshotu" per produkt (len ak predtým existovala vlastná zľava)
- c) automaticky prepísať už zapísané späť podľa snapshotu

**Návrh:** **a)** — rozhodnutie 6 hovorí jasne: rollback neexistuje, tak sa netvárme, že áno; jediná dopredná cesta je dopísať zlyhané a UI to musí povedať bez okolkov.

### 36. Idempotentný retry kampane?
- a) preskočiť produkty s potvrdeným OK zápisom identických parametrov + poznámka v audite
- b) poslať všetko znova (rovnaký setReduction je neškodný)
- c) a) + checkbox „vynútiť prepis všetkých"

**Návrh:** **a)** — šetrí rate limit a audit zostáva čitateľný (každý reálny zápis = jeden záznam); vynútený prepis c) nemá use-case, ktorý by nepokryl bežný prepis z ot. 28a.

### 37. Súbežné zápisové operácie (manuálna + scheduler naraz)?
- a) globálny mutex — druhá operácia sa odmietne/čaká s hláškou
- b) povoliť, ak sa nedotýkajú rovnakého produktu
- c) bez obmedzenia

**Návrh:** **a)** — pri max 10 zápisoch s 250 ms pauzou (ot. 46a) trvá operácia sekundy, takže globálny mutex nič nestojí a odstraňuje celú triedu súbehov naraz.

### 38. Doktrína driftu (niekto zmení zľavu v admine shopu mimo appky)?
- a) DB = „posledný vlastný zápis", UI to všade priznáva + tlačidlo „označiť stav produktu ako neznámy"
- b) a) + formálny backlog požiadaviek na maintainera (GET nech vracia reduction; clearReduction)
- c) DB sa tvári ako pravda, nekonzistencie ignorovať

**Návrh:** **b)** — správanie a) je jediné poctivé pri API, ktoré zľavu nevracia, a formálny backlog na maintainera je lacný spôsob, ako najväčšiu dieru kontraktu raz naozaj zavrieť (kontext ju už označil za kandidáta).

### 39. Cena produktu sa zmenila medzi dry-run a ostrým zápisom (re-GET tesne pred zápisom)?
- a) pri zmene ceny nad prah (napr. 5 %) zápis produktu zastaviť a vyžiadať nové potvrdenie
- b) len zalogovať rozdiel do snapshotu a pokračovať
- c) cenu pred zápisom nekontrolovať

**Návrh:** **a)** — potvrdenie platilo pre inú cenu, takže nad prahom už nie je informované; re-GET je beztak povinný kvôli snapshotu (ot. 48a), kontrola je zadarmo.

### 40. Odobratie produktu z allowlistu, keď má naplánovanú/aktívnu kampaň?
- a) blokovať, kým sa plánované nezrušia; aktívna zľava dobehne
- b) povoliť — naplánované sa automaticky zrušia s audit záznamom
- c) povoliť — kampane ostanú a zlyhajú na fail-closed kontrole pri fire

**Návrh:** **a)** — explicitné poradie krokov bez skrytých vedľajších účinkov: najprv vedome zrušiť plány, potom odobrať produkt; aktívna zľava sa aj tak zrušiť nedá (rozhodnutie 6), tak dobehne.

## API

### 41. Taxonómia chýb pre retry — kde a aká?
- a) centrálny modul api-clienta: retryable = 429 (Retry-After), 500, network/timeout; terminal = 400/401/403/404
- b) retryable len 429, všetko ostatné finálne
- c) taxonómia v DB, meniteľná bez deployu

**Návrh:** **a)** — jedno miesto pravdy v kóde, pokryté testami; DB-konfigurovateľná taxonómia c) je over-engineering pre appku s jedným write endpointom.

### 42. Retry pri 429?
- a) čakať Retry-After (strop 90 s), max 3 pokusy, potom zlyhanie s reportom
- b) čakať Retry-After bez stropu, max 1 opakovanie
- c) žiadny auto-retry, len manuálny

**Návrh:** **a)** — dokumentácia API explicitne káže 429 retryovať; strop 90 s bráni nekonečnému visu a 3 pokusy bohato stačia pri okne 300/60 s.

### 43. Retry pri 500/sieťovej chybe pri zápise?
- a) žiadny automatický (nevieme, či sa zapísalo) — len manuálny
- b) max 3 pokusy s backoffom 2/4/8 s (setReduction je na rovnaké hodnoty idempotentný)
- c) auto-retry len pri chybe pred odoslaním (connect fail), nikdy po ňom

**Návrh:** **b)** — identický setReduction je idempotentný (druhý zápis tých istých hodnôt nič nepokazí), takže auto-retry je bezpečný a ušetrí nočné zásahy pri schedulerom odpálených kampaniach; konzistentné s ot. 45a.

### 44. HTTP timeouty na shop API?
- a) 10 s jednotne
- b) 10 s čítanie / 30 s zápis
- c) 30 s jednotne

**Návrh:** **b)** — čítanie má byť svižné kvôli UI, zápisu dáme rezervu, aby sme zbytočne nevyrábali stavy „timeout po odoslaní" z ot. 45.

### 45. Odpoveď na zápis neprišla (timeout po odoslaní) — čo so stavom?
- a) „stav neistý": automaticky poslať identický setReduction ešte raz a stav vyriešiť podľa druhej odpovede
- b) „stav neistý": len manuálne rozhodnutie
- c) považovať za zlyhané a normálne retryovať

**Návrh:** **a)** — vďaka idempotencii identického payloadu druhá odpoveď stav definitívne rozrieši (OK = zapísané, chyba = nezapísané); manuálne b) by zbytočne budilo Samuela pri nočných kampaniach.

### 46. Poradie a tempo 10 zápisov v dávke?
- a) prísne sekvenčne s pauzou ~250 ms (deterministické poradie, ľahký audit)
- b) sekvenčne bez pauzy (hlboko pod 300/60 s)
- c) paralelne max 3 naraz

**Návrh:** **a)** — determinizmus a čitateľný audit sú cennejšie než pár ušetrených sekúnd; 10 zápisov + pauzy = ~3 s, rate limit sa ani nezahreje.

### 47. Mapovanie chybových kódov API na UI hlášky?
- a) mapa kód → slovenská veta s odporúčaním + raw kód v rozbaľovacom detaile; neznáme kódy surovo
- b) len slovenské vety
- c) len raw kódy (technický nástroj)

**Návrh:** **a)** — slovenská veta pre rýchle rozhodnutie, raw kód pre debugging a komunikáciu s maintainerom; neznáme kódy sa nesmú maskovať.

### 48. Snapshot PRED zápisom — odkiaľ?
- a) povinný GET /products/get tesne pred zápisom (name, price, has_attributes) + posledný vlastný zápis zľavy z DB + flag „reduction neoveriteľná cez API"
- b) len posledný vlastný zápis z DB, GET nevolať
- c) GET len ak je cache staršia než 1 h

**Návrh:** **a)** — GET je verejný a zadarmo (rate-limitovo lacný), dáva čerstvú cenu pre re-check z ot. 39 aj poctivý snapshot; flag priznáva, že zľavu overiť nevieme.

### 49. GET pred zápisom vráti `not found`?
- a) zápis tohto produktu zablokovať, v allowlistě označiť „nenájdený v shope", pokračovať s ostatnými
- b) zastaviť celú operáciu
- c) skúsiť zápis aj tak

**Návrh:** **a)** — fail-closed pre daný produkt, ale nezávislosť produktov (ot. 34a) platí aj tu; zmiznutý produkt je stav allowlistu, nie dôvod zhodiť kampaň.

### 50. Snapshot PO zápise — čo uložiť (API zľavu nevracia)?
- a) celý odoslaný payload + celá raw odpoveď + HTTP status + timestamp (API kľúč nikdy)
- b) len `ok` a `id`
- c) a) + kontrolný GET (zľavu neukáže, ale potvrdí existenciu a cenu)

**Návrh:** **a)** — plný payload a raw odpoveď sú jediný dôkaz toho, čo sa reálne stalo; kontrolný GET v c) nepridá nič, čo pre-write GET (ot. 48a) už nezachytil.

### 51. Reakcia na 401 unauthorized?
- a) okamžitý wipe kľúča + stop operácie + UI vyžiada nový kľúč
- b) 1 retry (mohol byť prechodný stav), potom wipe
- c) kľúč nechať, len označiť neplatný a zablokovať zápisy

**Návrh:** **a)** — 401 znamená, že kľúč je mŕtvy; držať mŕtvy kľúč na disku nemá hodnotu a fail-closed reakcia je v duchu celého bezpečnostného modelu.

### 52. Reakcia na 403 forbidden (kľúč stratil scope)?
- a) rovnako ako 401 + hláška „kľúč nemá product:edit"
- b) kľúč nechať, len alert (môže byť chyba na strane shopu)
- c) wipe až po 2. výskyte

**Návrh:** **a)** — kľúč bez `product:edit` je pre appku nepoužiteľný rovnako ako neplatný; rozdielna hláška povie Samuelovi, čo presne pýtať od maintainera.

### 53. Overenie kľúča hneď po zadaní, keď jediný write je produkčný?
- a) neoverovať zápisom; stav „neoverený", potvrdí sa prvým reálnym zápisom
- b) sonda: setReduction so zámerne neplatnými dátami (reduction=0) — 400 = kľúč OK, 401/403 = kľúč zlý; zdokumentovaný ako vedomý trik
- c) vyžiadať od maintainera whoami/health endpoint

**Návrh:** **b)** — `reduction=0` nikdy nič nezapíše (validácia ho odmietne), ale odpoveď 400 vs. 401/403 spoľahlivo rozlíši platný kľúč od zlého; kampane závislé od kľúča (ot. 21a/24a) si neistotu „neoverený" nemôžu dovoliť.

### 54. Zod validácia tvaru odpovede — nečakaný tvar pri HTTP 200?
- a) zápis označiť „stav neistý" + eskalovať „API sa zmenilo"
- b) považovať za úspech + warning „schema drift" v audite
- c) ignorovať, stačí HTTP status

**Návrh:** **a)** — zmenený tvar odpovede znamená, že už nerozumieme kontraktu; tváriť sa, že je všetko OK, je presne to, čo si produkčný shop nemôže dovoliť.

### 55. Overenie domény a dostupnosti API?
- a) canary GET /api/products?per_page=1 (200 + očakávaný tvar) pri uložení configu a pred každým fire; + tlačidlo „Otestovať spojenie"
- b) len on-demand tlačidlo
- c) a) + periodicky každých 5 min so stavom v UI

**Návrh:** **a)** — canary pred každým fire zachytí výpadok skôr, než sa dávka rozbehne do polovice; trvalý 5-minútový polling c) nič nerozhoduje a len robí šum v logoch shopu.

### 56. Batch na čítanie detailov allowlistu (products/get je batchable, max 25)?
- a) áno — 1 batch pre 10 produktov, fallback na jednotlivé GETy pri zlyhaní
- b) nie — jednotlivé GETy (jednoduchší kód, rovnaký rate-limit náklad)
- c) batch len pri operáciách nad 3 produkty

**Návrh:** **a)** — jeden HTTP round-trip namiesto desiatich zrýchli otvorenie formulára aj dashboardu; fallback drží funkčnosť, aj keby batch endpoint zmenil správanie.

### 57. Frekvencia obnovy cache name/price z verejného GET?
- a) pri otvorení zápisového formulára + manuálne tlačidlo „obnoviť"
- b) hodinový job na pozadí + manuálne tlačidlo
- c) len manuálne

**Návrh:** **a)** — čerstvosť treba presne vtedy, keď sa rozhoduje o zápise (a tesne pred zápisom ju aj tak vynúti ot. 48a); background polling b) je zbytočná záťaž shopu.

### 58. Identifikácia requestov voči shopu?
- a) User-Agent `aura-zlavy/<verzia>` + hierarchické korelačné ID (operation_id per dávka, request_id per volanie), oboje v audite
- b) len User-Agent
- c) nič, default

**Návrh:** **a)** — pri incidente na strane shopu vie maintainer okamžite spárovať svoje logy s naším auditom až na úroveň konkrétneho requestu.

### 59. Polnočná hrana (`from` = dnes odoslané 23:59:5x, server ho spracuje po polnoci)?
- a) dátumy prepočítať v momente fire + zápisové okno „zamrznuté" ±60 s okolo polnoci
- b) pri `invalid_dates` automaticky opraviť `from` na aktuálny deň a poslať max 1× znova
- c) oboje: manuálne operácie počkajú, scheduler má aj korekciu

**Návrh:** **a)** — prepočet pri fire + krátke zamrznutie hranu úplne eliminuje a scheduler beží o 00:05 (ot. 32a), takže sa k nej ani nepriblíži; automatická oprava dátumov b) by menila potvrdené hodnoty bez človeka.

### 60. Produkty s `has_attributes` (variantné price_impact)?
- a) v dry-run upozorniť: „produkt má varianty; % zľavu na ne uplatní logika shopu, appka výsledné ceny variantov negarantuje"
- b) neupozorňovať, správať sa rovnako
- c) upozorniť + zobraziť zoznam variantov z GET v detaile

**Návrh:** **a)** — poctivé priznanie hranice zodpovednosti v momente rozhodovania; plný zoznam variantov c) je pekný, ale nemení rozhodnutie a nafukuje dry-run.

## Bezpečnosť

### 61. Kde presne žije master key pre AES-256-GCM?
- a) súbor bind-mount read-only (chmod 400, vlastník non-root uid appky), cesta v env
- b) docker compose secret
- c) env premenná v .env na hoste mimo gitu

**Návrh:** **a)** — súbor mimo gitu s explicitnými právami je transparentný a nezávisí od compose-secret sémantiky (ktorá je mimo Swarm aj tak len bind-mount); env premenná c) presakuje do `docker inspect` a child procesov.

### 62. Rotácia master key?
- a) neriešiť procesne: nový master key = wipe + nové zadanie API kľúča (dáta žijú max 48 h)
- b) CLI príkaz na re-encrypt záznamu
- c) generovať pri prvom štarte, rotácia = zmazať a začať odznova

**Návrh:** **a)** — jediný šifrovaný záznam žije max 48 h, takže rotácia = nové zadanie kľúča; re-encrypt tooling b) je kód navyše bez úžitku.

### 63. Mechanika 48 h wipe?
- a) TTL kontrola pri každom prístupe + minútový tick schedulera; wipe = prepis ciphertextu náhodnými dátami + DELETE + audit „key_wiped"
- b) len lazy kontrola pri prístupe
- c) crypto-erase: zmazať per-key DEK, ciphertext nechať

**Návrh:** **a)** — dvojitá kontrola (lazy + tick) zaručí, že expirovaný kľúč nezostane na disku ani keď sa appky nikto nedotkne; audit záznam robí wipe overiteľným.

### 64. Dešifrovaný API kľúč v pamäti procesu?
- a) dešifrovať len na moment odoslania requestu, referenciu zahodiť + Buffer.fill(0)
- b) dešifrovať raz a cachovať do expirácie
- c) in-memory cache s vlastným TTL 15 min

**Návrh:** **a)** — pri max desiatkach requestov na operáciu je cena dešifrovania nulová a plaintext kľúč nikdy neleží v pamäti dlhšie než jeden request.

### 65. Zobrazenie kľúča v UI po uložení?
- a) nikdy — len posledné 4 znaky + čas uloženia + odpočet
- b) celý po re-autentifikácii heslom
- c) len stav „uložený/absentuje"

**Návrh:** **a)** — kľúč má Samuel u seba (zadal ho), appka ho nemá dôvod nikdy vracať; posledné 4 znaky stačia na rozlíšenie, ktorý kľúč je vložený.

### 66. Garancia, že kľúč neskončí v logoch/audite?
- a) centrálny redaktor (maskovanie Authorization/X-Api-Key + denylist polí) + test, ktorý zlyhá pri výskyte kľúča v serializovaných logoch/audite
- b) redaktor bez testu
- c) len disciplína v kóde a code review

**Návrh:** **a)** — audit ukladá celé raw odpovede a payloady (ot. 50a), takže redaktor musí byť centrálny a test je jediná garancia, že ho nikto neobíde omylom.

### 67. Panic button „kľúč unikol"?
- a) okamžitý wipe + zrušenie čakajúcich kampaní + audit záznam + zobrazený runbook „kontaktuj maintainera na revokáciu"
- b) len wipe kľúča
- c) wipe + kampane nechať v stave „vyžaduje kľúč"

**Návrh:** **a)** — po bezpečnostnom incidente nesmie nič bežať automaticky; kampane sa dajú po revokácii a novom kľúči vedome založiť znova, runbook pripomenie, že skutočná revokácia je na strane shopu.

### 68. Politika admin hesla?
- a) min 12 znakov, argon2id s parametrami podľa sperky-ai, bez zložitostných pravidiel
- b) passphrase min 4 slová
- c) min 16 znakov + offline kontrola proti uniknutým heslám

**Návrh:** **a)** — moderná politika (dĺžka > zložitosť) s overeným hashovaním z rodiny; c) je pre lokálnu appku za Caddy basic auth zbytočná ceremónia.

### 69. Životnosť session (jose JWT, cookie `ovl_zliav_session`)?
- a) 8 h absolútna + 30 min idle timeout; httpOnly + Secure + SameSite=Strict
- b) 24 h absolútna bez idle
- c) 1 h + refresh token

**Návrh:** **a)** — pokryje pracovný deň, idle timeout chráni zabudnutý prehliadač a Strict cookie je základ CSRF obrany (ot. 72).

### 70. Re-auth pred ostrým zápisom („sudo mode")?
- a) áno — heslo znova, ak posledná autentifikácia > 15 min
- b) nie, dry-run potvrdenie stačí
- c) len pri operáciách nad 3 produkty

**Návrh:** **a)** — lacná poistka proti odomknutému počítaču aj proti „klikaciemu autopilotu"; dopĺňa dvojkrok z ot. 2a namiesto ceremónie s opisovaním slov.

### 71. Brute-force ochrana loginu?
- a) rate limit 5 pokusov/15 min per IP + exponenciálny lockout + audit každého pokusu
- b) len rate limit z defineRoute pipeline
- c) a) + CAPTCHA po 3 zlyhaniach

**Návrh:** **a)** — lockout a audit sú lacné a užitočné aj na localhoste (napr. iný proces na stroji); CAPTCHA na 127.0.0.1 je absurdná.

### 72. CSRF stratégia?
- a) SameSite=Strict + Origin check v pipeline na mutáciách
- b) a) + double-submit CSRF token
- c) len SameSite=Strict (jediný lokálny origin)

**Návrh:** **a)** — dve nezávislé vrstvy stačia pre single-origin lokálnu appku; double-submit token b) by pri Strict cookie + Origin checku už nič nepridal.

### 73. 2FA (TOTP) pre jediného používateľa?
- a) nie — 127.0.0.1 + Caddy basic auth + heslo stačí
- b) voliteľne zapnuteľné
- c) povinné — appka mení produkčné ceny

**Návrh:** **a)** — útočník by už musel byť na Samuelovom stroji, kde by TOTP aj tak obišiel; tri existujúce vrstvy (bind na localhost, basic auth, app login) sú primerané.

### 74. Integrita audit logu?
- a) append-only: DB user bez UPDATE/DELETE grantov na tabuľku
- b) a) + hash chain (každý záznam nesie hash predchádzajúceho)
- c) bežná tabuľka, integrita sa nerieši

**Návrh:** **a)** — DB granty vynútia append-only na úrovni, ktorú aplikačný bug neobíde; hash chain b) chráni pred admin-level útočníkom, ktorý je mimo threat modelu single-user lokálnej appky.

### 75. Retencia audit logu?
- a) nemazať nikdy — objemy sú malé, história je celá hodnota
- b) 24 mesiacov v DB, staršie do archívneho dumpu
- c) 12 mesiacov, potom mazať

**Návrh:** **a)** — pri max 10 produktoch a jednotkách kampaní mesačne je ročný objem v kilobajtoch; audit je jediná pamäť appky (API stav nevracia), mazať ju by bolo proti zmyslu rozhodnutia 9.

### 76. DB zálohy vs šifrovaný API kľúč?
- a) tabuľku kľúča zo záloh vylúčiť (48 h efemérny, obnova zbytočná)
- b) zálohovať aj ju (ciphertext bez master key je neužitočný)
- c) a) + celé zálohy šifrovať master keyom

**Návrh:** **a)** — záloha efemérneho kľúča nemá obnovovaciu hodnotu a jej vylúčenie garantuje, že wipe (ot. 63a) nezanechá kópie ciphertextu v dumpe.

### 77. Poistka proti ostrému zápisu z dev prostredia?
- a) zápisy len ak NODE_ENV=production A explicitný flag WRITES_ENABLED=true; dev = vynútený dry-run
- b) dev používa výhradne mock server, reálna doména sa nedá nakonfigurovať
- c) oboje

**Návrh:** **a)** — dvojitá env poistka s vynúteným dry-run je jednoduchá a nechá dev legitímne čítať verejné GET z reálneho shopu; testy aj tak bežia výhradne proti mocku (ot. 99a).

### 78. Runtime kontrola, že appka nie je dostupná z LAN?
- a) startup assertion (bind 127.0.0.1, inak exit) + integračný test v CI
- b) len konfigurácia v compose
- c) a) + middleware odmietne requesty s non-local zdrojovou IP

**Návrh:** **a)** — assertion + test chránia pred preklepom v compose; middleware c) je za Caddy nespoľahlivý (zdrojová IP je IP kontajnera Caddy, nie klienta).

### 79. Poistka proti „runaway" zápisom (bug schedulera / kompromitovaná session)?
- a) tvrdý strop v DB (napr. 60 zápisov/h); prekročenie = zámok zápisov do manuálneho odomknutia + audit
- b) mäkší strop (200/deň), len alert bez zámku
- c) žiadny globálny strop — 10/operáciu stačí

**Návrh:** **a)** — posledná fail-closed obrana pre prípad, že zlyhajú všetky ostatné (bug v tick slučke, ukradnutá session); 60/h je 6× normálny strop operácie, legitímne použitie ho nikdy netrafí.

### 80. SSRF / validácia konfigurovateľnej domény shopu?
- a) len https + jedna doména potvrdená pri onboardingu; zmena vyžaduje heslo
- b) a) + blokovať privátne IP rozsahy pri resolve
- c) doména natvrdo v env, v UI needitovateľná

**Návrh:** **a)** — doménu zadáva jediný admin sám sebe pri onboardingu (ot. 20a) a canary GET ju overí (ot. 55a); DNS-resolve kontroly b) riešia multi-tenant hrozbu, ktorú táto appka nemá.

## Backend + Caddy

### 81. Hlavné tabuľky DB?
- a) `campaigns` + `campaign_items` (per-produkt stav) + `products_allowlist` + `catalog_cache` + `audit_log` + `api_key` + `settings` + `users`
- b) ploché `reductions` (produkt+okno) + `audit_log` + `api_key` + `users`; kampaň len ako group_id stĺpec
- c) a) bez `catalog_cache` — katalógové dáta čítať vždy live

**Návrh:** **a)** — per-produkt `campaign_items` je nosič stavov ✓/✗/neistý (ot. 15a, 34a, 86a) a `catalog_cache` podopiera dashboard bez zbytočných GETov (ot. 57a).

### 82. Implementácia schedulera?
- a) in-process tick (60 s) v Next.js standalone, stav v jobs tabuľke v DB
- b) samostatný worker kontajner zdieľajúci DB
- c) host cron volajúci interný endpoint

**Návrh:** **a)** — jeden proces = žiadna koordinácia medzi kontajnermi; stav v DB prežije restart a minútový tick zároveň obsluhuje TTL wipe (ot. 63a) aj heartbeat (ot. 87a).

### 83. Stavový stroj jobov?
- a) scheduled → needs_key → running → done | partial | failed | missed | cancelled; každý prechod s timestampom a dôvodom
- b) scheduled → running → done | failed
- c) bez stavového stroja, len flag executed

**Návrh:** **a)** — stavy `needs_key`, `partial` a `missed` sú priamym dôsledkom rozhodnutí v ot. 21a, 34a a 33a; timestamp + dôvod pri prechode je audit zadarmo.

### 84. Zámok proti dvojitému fire kampane?
- a) atomický claim: `UPDATE … SET status='running' WHERE status='scheduled'`
- b) MariaDB GET_LOCK advisory lock na celý tick
- c) in-memory flag (jediný proces stačí)

**Návrh:** **a)** — atomický claim je korektný aj pri omylom spustenej druhej inštancii a stojí jeden riadok SQL; in-memory flag c) by pri súbehu s manuálnou operáciou (ot. 37a) nestačil.

### 85. Graceful shutdown (SIGTERM) počas zápisu dávky?
- a) dobehnúť aktuálny produkt, zvyšok označiť „prerušené — manuálny retry"; stop_grace_period 30 s v compose
- b) skončiť hneď, riešiť reconciliáciou pri štarte
- c) blokovať shutdown do konca celej operácie

**Návrh:** **a)** — dokončiť rozbehnutý request eliminuje stav „neisté" pre aktuálny produkt a 30 s grace na to bohato stačí; zvyšok dávky čisto prevezme retry flow (ot. 15a/36a).

### 86. Reconciliácia po havárii/reštarte?
- a) joby v „running" bez ukončenia: per produkt porovnať s audit záznamami — potvrdené OK nechať, ostatné „stav neistý" na manuálne rozhodnutie
- b) všetky „running" označiť failed
- c) „running" automaticky spustiť odznova (idempotencia to unesie)

**Návrh:** **a)** — audit záznam per request (ot. 50a) presne rozlíši zapísané od nezapísaného; automatický re-run c) po havárii je zbytočné riziko, keď o pár produktoch nič nevieme.

### 87. Monitoring živosti schedulera?
- a) heartbeat riadok v DB pri každom ticku + UI badge „scheduler beží / naposledy pred X min" + report v health endpointe
- b) len log riadok pri ticku
- c) žiadny — zlyhanie sa prejaví zmeškanou kampaňou

**Návrh:** **a)** — mŕtvy scheduler znamená nespustené kampane aj nefunkčný TTL wipe, takže si zaslúži viditeľný badge aj miesto v /api/health (ot. 91a).

### 88. Spúšťanie migrácií DB?
- a) automaticky pri štarte kontajnera s advisory lockom, fail-fast; rollback vždy manuálne
- b) manuálny príkaz (docker exec)
- c) samostatný init kontajner v compose

**Návrh:** **a)** — vzor zo sperky-ai: štart bez úspešnej migrácie neprebehne (fail-fast = fail-closed) a advisory lock kryje aj náhodný dvojitý štart.

### 89. DB používateľ a credentials?
- a) náhodné heslo pri prvom setupe v env súbore mimo gitu; app user bez DDL a bez UPDATE/DELETE na audit_log (ot. 74); migrácie beží oddelený user
- b) app user s plnými právami na ovl_zliav (jednoduchšie migrácie), root zakázaný
- c) ako a), ale bez oddeleného migračného usera

**Návrh:** **a)** — oddelený migračný user je jediný spôsob, ako môže mať app user naozaj odobraté DDL aj UPDATE/DELETE na audit_log (ot. 74a); entrypoint spustí migrácie migračným userom a appku app userom.

### 90. Zálohovanie MariaDB?
- a) denný mysqldump (bez tabuľky kľúča — ot. 76), rotácia 14 dní + zdokumentovaný restore test
- b) sidecar kontajner s plánovaným dumpom do named volume
- c) žiadne automatické zálohy — ale stratil by sa audit log

**Návrh:** **a)** — audit log je jediná pamäť appky, takže zálohy sú povinné; dump bez tabuľky kľúča je konzistentný s ot. 76a a restore test robí zo zálohy skutočnú zálohu.

### 91. Healthchecky a poradie štartu v compose?
- a) db: mariadb-admin ping; app: /api/health (DB + stav kľúča + heartbeat schedulera); depends_on condition: service_healthy + retry pripájania v appke
- b) len db healthcheck + depends_on
- c) žiadne, restart policy stačí

**Návrh:** **a)** — /api/health agregujúci DB, kľúč a heartbeat je zároveň smoke test pre upgrade runbook (ot. 100a) a jediné miesto pravdy o zdraví appky.

### 92. Logovanie aplikácie?
- a) štruktúrovaný JSON na stdout + docker logging driver max-size/max-file; audit v DB, nie v logoch
- b) JSON na stdout + rotovaný súbor vo volume
- c) plain text na stdout

**Návrh:** **a)** — 12-factor štandard rodiny; ostrá deľba „audit = DB, prevádzkové logy = stdout" bráni tomu, aby sa citlivé snapshoty tlačili do docker logov (spolu s redaktorom z ot. 66a).

### 93. Validácia ENV pri boote?
- a) zod schéma na všetky premenné, fail-fast s vymenovaním chýbajúcich/zlých
- b) validovať len kritické (master key path, DB URL)
- c) defaulty + warningy, nespadnúť

**Návrh:** **a)** — appka, ktorá mení produkčné ceny, nesmie bežať s tichým zlým configom; fail-fast s konkrétnym zoznamom chýb je konzistentné s ot. 88a a 78a.

### 94. TLS v Caddy pre localhost?
- a) `tls internal` (lokálna CA Caddy) + návod na trust root certu v OS
- b) mkcert certifikát bind-mountnutý do Caddy
- c) bez TLS (http na 127.0.0.1), TLS blok pripravený zakomentovaný

**Návrh:** **a)** — nulová externá závislosť, cert si Caddy spravuje sám; TLS je nutné aj lokálne kvôli Secure cookie (ot. 69a) a HSTS (ot. 95a).

### 95. Security hlavičky v Caddy?
- a) CSP default-src 'self' (zladené s Next.js), X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy; HSTS len s TLS
- b) a) + Permissions-Policy a COOP/COEP
- c) všetko okrem CSP — CSP nechať na Next.js

**Návrh:** **a)** — pokrýva reálne hrozby (XSS, clickjacking, MIME sniffing) bez toho, aby COOP/COEP rozbilo Next.js dev ergonomiku; CSP musí byť zladené s Next.js inline skriptami už v návrhu.

### 96. Topológia portov?
- a) jediný publikovaný port 127.0.0.1:3050 = Caddy; app aj DB len na internej compose sieti
- b) app priamo na 127.0.0.1:3050, Caddy na 3443 ako voliteľná vrstva
- c) Caddy 3050 (http) aj 3443 (https), app nepublikovaná

**Návrh:** **a)** — jeden vstupný bod = celá obrana (TLS, basic auth, hlavičky) sa nedá obísť; presne napĺňa rozhodnutia 4 a 10 (port 3050, len 127.0.0.1).

### 97. Caddy basic auth × aplikačný login?
- a) obe vrstvy vždy (defense in depth); bcrypt hash v súbore mimo gitu, Caddyfile.example v repe
- b) len app login; basic auth blok pripravený zakomentovaný pre budúcu expozíciu
- c) obe, hash interpolovaný z env placeholderu (poučenie z AuraAI)

**Návrh:** **a)** — dve nezávislé vrstvy podľa rozhodnutia 4; hash v súbore mimo gitu + example v repe rieši presne AuraAI chybu (hash v git-trackovanom Caddyfile) bez krehkej env interpolácie.

### 98. Hardening app kontajnera?
- a) non-root + read-only rootfs + tmpfs /tmp + cap_drop ALL + no-new-privileges
- b) len non-root (vzor sperky-ai)
- c) a) + explicitný seccomp profil

**Návrh:** **a)** — Next.js standalone s read-only rootfs bez problémov beží a každá položka je jeden riadok v compose; vlastný seccomp profil c) je údržbová záťaž bez merateľného zisku nad defaultom.

### 99. CI a testovacia stratégia?
- a) lint + typecheck + vitest + build na push, Playwright na PR; testy výhradne proti mock shop API (reálna doména sa v testoch nedá použiť); npm audit + gitleaks blokujúce na high/critical
- b) to isté bez security skenov
- c) bez CI, len pre-commit hook

**Návrh:** **a)** — mock-only testy sú pri produkčnom shope bez stagingu nevyhnutnosť, nie voľba; gitleaks navyše stráži hlavné tabu projektu — kľúč nikdy v repe (rozhodnutie 2).

### 100. Postup upgradu appky (nová verzia obrazu)?
- a) runbook: záloha DB → build → compose up → migrácie fail-fast → smoke test /api/health; zápisy blokované počas migrácie
- b) `compose up -d --build` bez ceremónie
- c) blue-green s druhým kontajnerom

**Návrh:** **a)** — päťkrokový runbook nadväzuje na už navrhnuté diely (zálohy 90a, migrácie 88a, health 91a) a blokovanie zápisov počas migrácie chráni rozbehnuté kampane; blue-green c) je pre lokálnu single-user appku zbytočný.
