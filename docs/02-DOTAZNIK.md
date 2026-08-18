# OVL-DA-ZLIAV — Finálny dotazník pre zadávateľa

**Dátum:** 2026-08-18
**Podklad:** zlúčený master zoznam (61 otázok) + `docs/01-ROZHODNUTIA.md` + aktuálny API kontrakt `docs/api/sperky-api.md` (602 riadkov, kompletný a autoritatívny).
**Rozsah:** 60 návrhových otázok v 5 oblastiach + sekcia „Už rozhodnuté / určené kontraktom".

---

## Ako odpovedať

Každá otázka má **navrhovaný default** (riadok **Návrh:**). **Ak s defaultom súhlasíte, nemusíte nič písať.** Stačí, keď napíšete **len čísla otázok, ktoré chcete zmeniť**, a k nim vašu voľbu (napr. „Q5 → alt b", „Q11 → from = zajtra"). Všetko ostatné berieme ako odsúhlasené a ideme podľa neho implementovať.

**Prosím doplňte aj tieto 4 otvorené vstupy z `01-ROZHODNUTIA.md`** (bez nich vieme začať, ale nie dokončiť pripojenie na shop):

1. **Doména eshopu** — testovacia a/alebo produkčná (base URL; produkčná je `https://sperky-eshop.sk`).
2. **Stav kľúča `product:edit`** — máte ho / treba vyžiadať od maintainera / je len testovací?
3. **DB: SQLite vs. MariaDB** — potvrdiť predbežnú voľbu SQLite, alebo si želáte MariaDB (pridá kontajner `ovl-zliav-db`)?
4. **Zobrazovaný názov appky** — `OVL-DA-ZLIAV`, „Aura Zľavy" alebo iný?

**Legenda:** *Prečo* = načo sa pýtame; **Návrh** = default; *Alt* = alternatívy; **⚠ Over** = rizikový bod, ktorý treba potvrdiť s maintainerom API.

**Poznámka ku kontraktu:** Skoršia obava, že API dokument „mlčí o jadre" (clearReduction, getFull, whoami, search, searchIndex, categories), je **vyriešená** — aktuálny kontrakt všetky tieto endpointy plne špecifikuje (verb, telo, scope, tvar odpovede aj `409`). Zostáva jediný nedopovedaný bod, viď **⚠ Over v Q18**.

---

## 1) UX/UI

### 1. Domovská obrazovka (čo operátor vidí ako prvé)
*Prečo:* Prvý pohľad rozhoduje, či operátor za 5 sekúnd vie „čo beží, čo expiruje a čo horí".
**Návrh:** Dashboard s tromi pásmi — Aktívne zľavy · Expirujúce dnes/zajtra · Naplánované (armované) kampane — plus stavový prúžok kľúča (vek, expiry) a zostatku rate-limitu z `whoami`.
*Alt:* a) rovno vyhľadávanie produktov; b) prázdny stav s jedným CTA „Nová kampaň"; c) kombinovaný feed poslednej aktivity + audit.

### 2. Vyhľadávanie a výber produktov
*Prečo:* Nájdenie správneho produktu je najčastejší úkon aj najčastejší zdroj omylu (zámena podobných šperkov).
**Návrh:** Univerzálne fuzzy pole nad `products/searchIndex` (Meili, verejné, okamžité výsledky) + filtračný panel nad `products/search` (kategória, cena, `onlyDiscounted`, sort); čisté číslo rozpoznať ako `id` cez `products/get`; obe vyhľadávania vracajú len `id`, detail dotiahnuť cez `getFull`; možnosť CSV importu `id`. Endpoint `products` (index) len na jednoduché stránkovanie.
*Alt:* a) dva oddelené režimy (presné `id` vs. fuzzy názov); b) len manuálny multiselect + uložené filtre; c) len presné `id` / CSV (najbezpečnejšie, najpomalšie).

### 3. Zobrazenie stavu zľavy, marže a ceny — vrátane formátovania €/DPH
*Prečo:* Operátor musí na prvý pohľad odlíšiť stav aj vidieť, či akcia nejde do straty — a formát peňazí musí byť slovenský.
**Návrh:** Farebný stavový štítok (žiadna/aktívna/naplánovaná/expirovaná) + `reduction_percent` + okno `reduction_from–reduction_to` z `getFull`; `sell_price_with_vat` pred/po a `margin_percent` po zľave s farebnými prahmi podľa konfigurovateľného minima marže. Formát: `19,99 €` (desatinná čiarka, medzera, € za sumou), ceny označené „s DPH" (`sell_price_with_vat`), voliteľne aj bez DPH; percentá `-15 %`.
*Alt:* a) len text bez farby; b) absolútna marža v € aj %; c) detail pod rozklikom. Formát: a) bodka (nevhodné pre SK); b) € pred sumou.

### 4. Dry-run náhľad ako diff tabuľka „pred → po"
*Prečo:* Dry-run je povinný default, takže jeho čitateľnosť určuje, či operátor zachytí omyl pred zápisom do produkcie.
**Návrh:** Tabuľka na produkt: `stará zľava → nová zľava`, okno `from–to`, `sell_price_with_vat` pred/po, `margin_percent` po zľave + farebné varovania (nízka marža, prepis existujúcej zľavy, riziko flash sale, produkt neaktívny). Súhrn hore (počet položiek, koľko pod prahom marže, koľko konfliktov). Tlačidlo reálneho zápisu až pod tabuľkou. Cena „po" v dry-rune je odhad (`price × (1 − %/100)`); skutočnú potvrdí `getFull` po zápise (zaokrúhľovanie je na strane shopu).
*Alt:* a) diff karta na produkt; b) diff v samostatnom kroku wizardu; c) exportovateľný náhľad (CSV/PDF) na odsúhlasenie.

### 5. Trecia plocha pri reálnom zápise
*Prečo:* Jediné potvrdenie na produkčnom shope je posledná poistka pred plošnou zmenou cien.
**Návrh:** Dvojkrok — tlačidlo sa zmení z „Zobraziť náhľad" na červené „Zapísať naostro (N produktov)"; nad konfigurovateľný strop (napr. > 50) vyžadovať prepísanie počtu N alebo kontrolného slova a zobraziť počítadlo.
*Alt:* a) vždy len jeden klik v modáli; b) vždy kontrolný text; c) opätovné zadanie hesla operátora nad X produktov.

### 6. Zber produktov do dávky (košík zmien) + jednotné vs. per-riadok %
*Prečo:* Spôsob zberu a to, či % platí jednotne alebo per-produkt, určuje rýchlosť aj chybovosť dennej práce.
**Návrh:** Checkboxy vo výsledkoch → perzistentný „košík zmien"; jedno % + okno na celú dávku ako default, s možnosťou override na jednotlivom riadku (override vizuálne odlíšiť). Odtiaľ jeden dry-run + jedno potvrdenie.
*Alt:* a) nalepenie/CSV import zoznamu `id`; b) len jednotné %; c) výber celej kategórie naraz s vylúčeniami.

### 7. Živý priebeh dávky a núdzový stop
*Prečo:* N produktov = N requestov v čase (`setReduction` nie je batchable); operátor musí vidieť postup a vedieť okamžite zastaviť rozbehnutú chybu.
**Návrh:** Livewire komponent s pollingom: počítadlá (hotové/čakajúce/zlyhané/preskočené), stav na položku, prebiehajúce retry, odhad zostávajúceho času z rate budgetu; tlačidlo „Zastaviť" zastaví frontu po dokončení aktuálnej položky a už zapísané ponúkne kompenzovať (viď Q23).
*Alt:* a) len súhrnný progress bar + súhrn na konci; b) SSE/websocket namiesto pollingu; c) tvrdý kill hneď.

### 8. Stavový widget API kľúča + proaktívne bannery
*Prečo:* Kľúč expiruje (rotácia 48 h) a zľavy expirujú v okne — bez viditeľného varovania operátor premešká oboje.
**Návrh:** Widget: dátum nastavenia kľúča, banner na rotáciu (výrazný pri < 24 h), `scopes` + `expires_at` + zostatok `remaining.per_minute`/`per_day` z `whoami`, maskovaný kľúč (posledné 4 znaky). Perzistentné bannery: zľavy expirujúce dnes/zajtra, zlyhané/pozastavené kampane, nízky zostatok rate-limitu.
*Alt:* a) len banner po 48 h; b) detail v Nastaveniach; c) aj e-mail/desktop notifikácia.

### 9. Prázdne a chybové stavy + SK mapovanie chýb
*Prečo:* Surové API kódy (`range_too_long`, `blocked_by_flash_sale`, `forbidden`, `rate_limited`, `invalid_reduction`) sú pre prevádzkara nezrozumiteľné a určujú ďalší krok.
**Návrh:** Centrálny prekladač kód → slovenská veta + odporúčaná akcia (napr. `blocked_by_flash_sale`/`409` → „Na produkte beží flash sale (TurboSaleUltimate) — preskočené, skús neskôr"; `range_too_long` → „Okno je dlhšie ako 3 mesiace — skráť `to`"). Zoskupenie chýb podľa typu; prívetivé prázdne stavy s návodom. Ten istý prekladač používajú UI aj notifikácie/audit.
*Alt:* a) surový kód + generický text; b) SK text + rozklik technického detailu pre podporu; c) len logovať kódy, UI hlási neutrálne.

### 10. Rýchle akcie priamo z riadku
*Prečo:* Najčastejšie operácie (zrušiť, predĺžiť, zopakovať) by nemali vyžadovať preklikanie cez detail.
**Návrh:** Kontextové akcie na riadku: „Zrušiť zľavu" (`clearReduction`), „Predĺžiť `to`", „Zopakovať s novým oknom" — každá cez štandardný dry-run + potvrdenie.
*Alt:* a) všetko len cez detail produktu; b) skratky len pre čítacie akcie; c) konfigurovateľné, ktoré skratky sú zapnuté.

### 11. Formát dátumu, picker okna a predvyplnené hodnoty
*Prečo:* `from`/`to` sú len dátumy (`YYYY-MM-DD`) — nejednoznačný formát alebo zlý default posunie akciu o deň alebo mimo povolených 3 mesiacov.
**Návrh:** Zobrazenie `DD.MM.YYYY`, kalendárový picker s tvrdým limitom rozsahu (blokuje > 3 mesiace), viditeľné TZ Europe/Bratislava; predvyplniť `from` = dnes, `to` = dnes + 14 dní, `%` prázdne (núti vedomú voľbu).
*Alt:* a) ISO `YYYY-MM-DD` aj v UI; b) rýchle presety („7 dní", „do konca mesiaca", „Vianoce"); c) `from` = zajtra alebo zapamätať posledné hodnoty.

### 12. Jazyk UI, zobrazovaný názov a i18n
*Prečo:* Operátor je slovenský prevádzkar a zobrazovaný názov je otvorený bod, ktorý treba zafixovať pred brandingom.
**Návrh:** Kompletne slovenské UI vrátane preložených chýb (interné logy môžu ostať EN). Zobrazovaný názov = **doplniť** (viď „Ako odpovedať", bod 4). Aj pri SK-only v1 držať všetky reťazce v Laravel `lang/` súboroch (nie natvrdo v Blade), jeden zdroj SK textov zdieľaný UI aj chybovým prekladačom (Q9), pripravené na budúce EN.
*Alt:* a) SK + EN prepínač; b) SK s EN fallbackom pre neznáme stavy; c) dvojjazyčné popisy pri kritických akciách.

### 13. Cieľová platforma (desktop/mobil) a prístupnosť
*Prečo:* 8-stĺpcový dry-run sa na mobile nepotvrdzuje a stav/marža sa nesmú niesť len farbou.
**Návrh:** Desktop-first (notebook operátora); responzívne tak, aby sa na mobile dalo aspoň pozerať a zrušiť zľavu, nie zakladať veľké dávky. WCAG 2.1 AA — kontrast, plná klávesnica, viditeľný focus, stav aj ikonou/textom, nielen farbou.
*Alt:* a) plne responzívne vrátane zakladania na mobile; b) desktop only (mobil blokovaný); c) prístupnosť len základná / naopak AAA pre kritické akcie.

### 14. Prehliadač auditu a snapshotov
*Prečo:* Plný audit má hodnotu len ak sa dá pohodlne prehľadať „kto, kedy, čo a s akým výsledkom".
**Návrh:** Prehľadávateľná tabuľka operácií s filtrom (dátum, produkt, aktér, dry-run/reálne, výsledok) a detailom položky: snapshot pred/po (`getFull`), zaslané parametre, uložená (redigovaná) odpoveď API, diff kľúčových polí.
*Alt:* a) len read-only log bez detailu; b) len export do CSV/JSON (viď Q60); c) prehliadač + export.

### 15. Onboarding pri prvom spustení
*Prečo:* Bez sprievodcu operátor nevie, kde zadať kľúč a doménu, a appka môže bežať v poloslepom stave — pritom mení produkčné ceny.
**Návrh:** Sprievodca: (1) zadať/potvrdiť doménu shopu, (2) vložiť API kľúč (do `.env` cez chránený formulár, nie do DB), (3) `whoami` ping — zobraziť `scopes`/`expires_at`/`remaining` a blokovať ďalej, kým nie je „pripojené", (4) nastaviť heslo operátora, (5) potvrdiť TZ. Bez úspešného pingu je zápis zablokovaný.
*Alt:* a) žiadny sprievodca — kľúč len ručne do `.env`; b) sprievodca len prvýkrát; c) sprievodca + „testovacie pripojenie" v Nastaveniach.

---

## 2) Logika a kampane

### 16. Definícia a dátový model kampane (vrátane opakovania/klonovania)
*Prečo:* Od jednotky plánovania sa odvíja celý dátový model, scheduler aj UI.
**Návrh:** Kampaň = názov + množina produktov (statický zoznam `id` **alebo** uložený filter) + `reduction` + spoločné okno `from–to` + stav (`koncept/armovaná/beží/hotová/zrušená`). Pri dynamickej množine sa produkty rozvinú a **zmrazia** pri armovaní. Bez automatického opakovania v v1 — namiesto toho „Klonovať kampaň" s novým oknom.
*Alt:* a) len statické zoznamy `id`; b) len dynamické filtre vyhodnotené v čase behu; c) cron-like opakovanie / uložené šablóny.

### 17. Armovanie a re-validácia pred behom (drift)
*Prečo:* Medzi armovaním a časom behu sa môže zmeniť cena, marža, nabehnúť flash sale alebo sa deaktivovať produkt — scheduler pritom zapisuje bez človeka pri klávesnici.
**Návrh:** Pri armovaní uložiť potvrdený dry-run snapshot. Scheduler tesne pred zápisom re-validuje cez `getFull` (marža pod prah, prebiehajúca flash sale, `active=false`); ak je drift nad toleranciu, **rizikové položky pozastaví a notifikuje**, zvyšok zapíše. Armovanie = explicitné potvrdenie = to, čo scheduler považuje za súhlas.
*Alt:* a) zapísať presne odsúhlasené bez re-validácie; b) pri akejkoľvek odchýlke zastaviť celú kampaň; c) scheduler len pripraví a čaká na ranné potvrdenie; d) tolerancia driftu konfigurovateľná.

### 18. Konflikt s existujúcou zľavou a prepis
*Prečo:* Operátor často zlevňuje produkt, ktorý už v akcii je; `setReduction` navyše nastavuje absolútne hodnoty, takže nové % ticho prepíše existujúcu zľavu.
**Návrh:** Pred zápisom načítať `getFull`; ak beží percentuálna zľava (`reduction_percent` nie je `null`), v dry-rune ukázať `staré → nové` a ponúknuť: Prepísať / Predĺžiť okno / Preskočiť, default = **Preskočiť** (fail-safe). Prepis cudzej zľavy vyžaduje explicitné potvrdenie a zapíše sa do auditu.
**⚠ Over (rizikový bod A — mazanie fixnej cenovej akcie):** Master zoznam predpokladal, že `setReduction` **ticho maže fixnú `reduction_price`**. **Aktuálny kontrakt tento predpoklad NEPOTVRDZUJE:** nespomína žiadne pole `reduction_price` a `getFull` vracia len **percentuálnu** zľavu (`reduction_percent/from/to`). To znamená dve veci: (1) nevieme z kontraktu potvrdiť, či fixná cenová akcia vôbec existuje a či ju `setReduction` prepíše/zmaže; (2) **ak existuje, appka ju cez `getFull` ani neuvidí**, takže by ju v dry-rune nevedela zvýrazniť. **Potvrdiť s maintainerom** (delaja@fedorco.sk): existuje fixná `reduction_price`? Prepisuje ju `setReduction`? Ak áno, ako ju prečítať pred zápisom, aby dry-run vedel varovať pred nečakanou stratou pre shop?
*Alt:* a) vždy prepísať (posledný vyhráva); b) blokovať prepis cudzej zľavy úplne; c) prepis len ak je nové % výhodnejšie pre zákazníka.

### 19. Prekrývajúce sa kampane na tom istom produkte
*Prečo:* Dve armované kampane na jeden produkt sa na strane shopu ticho prepíšu (posledný zápis vyhráva), keďže `setReduction` nastavuje absolútne hodnoty.
**Návrh:** Appka **deteguje prekryv okna už pri armovaní** a **blokuje** ho s jasným varovaním („posledný zápis vyhráva") a ponukou riešenia (zlúčiť / upraviť okno / zrušiť jednu), nie ticho povolí.
*Alt:* a) last-write-wins len s upozornením; b) ticho povoliť a len zalogovať; c) prioritizácia kampaní (vyššia priorita vyhráva).

### 20. Prebiehajúca flash sale (`409 blocked_by_flash_sale`, TurboSaleUltimate)
*Prečo:* `409` v strede dávky nesmie zhodiť celú kampaň ani zacykliť retry pod rate-limitom.
**Návrh:** Položku **preskočiť**, označiť `skipped_flash_sale` („odložené — beží flash sale"), pokračovať v dávke a vypísať v súhrne; voliteľný auto-retry po skončení okna flash sale (alebo po N minútach) + notifikácia.
*Alt:* a) tvrdo zlyhať a nahlásiť; b) okamžitý obmedzený retry (3× s backoffom); c) periodicky re-skúšať do konca okna / nechať na manuál.

### 21. Hromadné zrušenie zliav (`clearReduction`) ako plnohodnotná operácia
*Prečo:* Zrušenie je reálna operácia meniaca ceny — potrebuje rovnakú ochranu ako zakladanie.
**Návrh:** `clearReduction` (`POST id`, scope `product:edit`) má vlastný dávkový tok s dry-runom („čo sa zruší"), rovnakým potvrdením, throttlingom a auditom ako `setReduction`; akcia „Zrušiť všetky aktívne z tejto kampane" jedným tokom. Pozor: `clearReduction` má rovnaké obmedzenie flash sale (môže vrátiť `409 blocked_by_flash_sale`) — ošetriť ako v Q20.
*Alt:* a) rušenie len po jednom produkte; b) rušenie len ako súčasť kampane; c) rušenie s voľbou „hneď" vs. „naplánovať na dátum".

### 22. Úprava/skrátenie už bežiacej zľavy
*Prečo:* Prevádzkar často potrebuje akciu skrátiť alebo prehĺbiť za behu, nielen zrušiť a zakladať nanovo.
**Návrh:** Povoliť edit ako nový `setReduction` (prepis) s náhľadom rozdielu: „skrátiť" = posun `to`, „prehĺbiť" = zmena `%` (opäť s kontrolou marže). Zohľadniť konflikt/prepis podľa Q18.
*Alt:* a) len zrušiť + založiť nanovo; b) zákaz editu bežiacej zľavy (len naplánovanej); c) edit len smerom výhodnejším pre zákazníka.

### 23. Kompenzácia pri čiastočnom zlyhaní dávky (nie rollback)
*Prečo:* Zápis nie je atomický — pri chybe v strede je časť produktov už zmenená a rollback neexistuje; pôvodný stav treba brať zo snapshotu pred zápisom.
**Návrh:** Appka drží stav každej položky; po zlyhaní ponúkne dve cesty (voľba operátora, obe auditované): „Dokončiť zvyšné" **alebo** „Vrátiť už zapísané cez `clearReduction`" (kompenzácia do pôvodného stavu zo snapshotu). Obe s náhľadom.
*Alt:* a) len nahlásiť stav a nechať na operátora; b) automatická kompenzácia po prvom zlyhaní bez pýtania; c) automaticky dokončiť zvyšné, kompenzáciu ponúknuť ručne.

### 24. Odporúčania „čo zlevniť" a pravidlová selekcia (`orders:read` + `getFull`)
*Prečo:* `orders:read` bol schválený práve preto, aby appka radila — bez toho je scope zbytočné GDPR riziko; odporúčanie však nesmie obísť dry-run.
**Návrh:** Voliteľný „návrhový" pohľad — rebríček kandidátov (ležiaky: vysoký `qty`, nízke `qty_in_orders`, staré `last_time_in_order`, so zdravou maržou z `getFull`) na úrovni agregovaných metrík na produkt; možnosť pravidiel (`margin_percent ≥ X` a `qty > 0` a `last_time_in_order` do N dní). Z pohľadu sa dá založiť kampaň — **vždy cez dry-run**; rozhoduje operátor.
*Alt:* a) bez odporúčaní v v1; b) aj opačný smer „nezlevňuj" pre bestsellery s tenkou maržou; c) skórovací model (predajnosť × marža) s váhami; d) odporúčania počítať offline raz denne.

### 25. Ochrana marže — min-margin guard
*Prečo:* `reduction` do 30 % môže pri niektorých produktoch stlačiť maржu pod nulu — bez poistky appka aktívne spôsobí stratovú kampaň.
**Návrh:** Konfigurovateľný minimálny `margin_percent` po zľave; dry-run počíta post-zľavovú maржu z `getFull` a položky pod prahom **tvrdo blokne** — prejsť sa dá len explicitným override s uvedením dôvodu (uloží sa do auditu).
*Alt:* a) len vizuálne varovanie; b) tvrdý blok bez override; c) dvojúrovňové prahy (varovanie / blok) alebo prah na kategóriu/dodávateľa.

### 26. Špeciálne produkty: varianty, neaktívne, vypredané
*Prečo:* `setReduction` je na produkt (nie na variant) a zľava na skrytý/vypredaný produkt je zbytočná a mätúca v audite.
**Návrh:** Jasne komunikovať „% platí na celý produkt vrátane všetkých variantov" (varianty s `price_impact` len informatívne v náhľade). Neaktívne (`active=false`) štandardne vylúčiť z dávky, `qty=0` zahrnúť len s varovaním; oboje s výrazným štítkom, operátor môže vedome zahrnúť.
*Alt:* a) blokovať produkty s variantmi úplne; b) vypredané povoliť, neaktívne tvrdo blokovať; c) ukázať maржu najlacnejšieho aj najdrahšieho variantu.

### 27. Časové pásmo a interpretácia okna
*Prečo:* `from`/`to` sú len dátumy — ak sa appka a shop nezhodnú na pásme, hranice okna aj detekcia „prebiehajúcej" zľavy sa posunú o hodiny.
**Návrh:** Fixovať pásmo shopu (`Europe/Bratislava`); interpretovať „platí od 00:00 dňa `from` do 23:59 dňa `to`", explicitne to napísať pri okne; „dnes" pri validácii počítať v pásme shopu; interne ukladať v UTC a konvertovať na zobrazenie.
*Alt:* a) pásmo servera appky; b) zobraziť oba časy (lokál aj shop); c) konfigurovateľné pásmo s explicitným defaultom.

### 28. Ukončenie kampane — `reduction_to` vs. `clearReduction`
*Prečo:* Okno `from–to` expiruje samo na strane shopu, takže aktívne rušenie na konci môže byť zbytočné volanie (míňa rate budget) — alebo naopak nutné pri rezíduách.
**Návrh:** Prirodzený koniec = spoľahnúť sa na `reduction_to` (žiadny zápis). `clearReduction` plánovať len na **predčasné** zrušenie, alebo keď overovací sweep cez `getFull` po expirácii ukáže reziduálnu zľavu.
*Alt:* a) vždy explicitne `clearReduction` na konci; b) overovací sweep po expirácii a rušiť len rezíduá.

### 29. Pre-flight validácia, normalizácia % a okno dlhšie ako 3 mesiace
*Prečo:* Lokálna validácia ušetrí zbytočné requesty (rate budget) a zabráni polovičným dávkam padajúcim na `invalid_reduction`/`range_too_long`.
**Návrh:** Pred akýmkoľvek volaním tvrdo validovať: `0 < reduction ≤ 30` (krok 0,5 %, nulu/prázdne odmietnuť — pre nulu použiť `clearReduction`), `to ≥ from`, okno ≤ 3 mesiace, formát `YYYY-MM-DD`; nevalidnú položku vôbec neposielať. Rovnaká validácia v UI **aj** server-side. Okno > 3 mesiace odmietnuť s jasnou hláškou.
*Alt:* krok %: a) len celé čísla; b) 2 desatinné miesta; c) presety (10/15/20/25/30). Okno > 3 mes.: a) automaticky rozdeliť na reťazené okná; b) navrhnúť najbližšie platné `to`.

### 30. Deterministické poradie zápisov v dávke
*Prečo:* Keďže dávka nie je atomická, poradie určuje, ktoré produkty zostanú zmenené pri zlyhaní v strede — musí byť predvídateľné a auditovateľné.
**Návrh:** Fixné poradie (podľa `id` vzostupne), priebeh sa priebežne perzistuje, aby sa pri prerušení dalo presne povedať, čo je hotové.
*Alt:* a) najhodnotnejšie/najpredávanejšie prvé; b) náhodné so seedom pre reprodukovateľnosť.

---

## 3) API a integrácia

> **⚠ Over (rizikový bod B) — VYRIEŠENÉ.** Aktuálny kontrakt `clearReduction`, `getFull` aj `whoami` **plne špecifikuje**: verb (`POST`/`GET`), telo (`id` form-encoded pri write), scope (`product:edit` / `product:read` / hocijaký platný kľúč pre `whoami`), tvar odpovede (`{"result":{"ok":true,"id":...}}`) aj `409 blocked_by_flash_sale`. **Netreba samostatné potvrdenie s maintainerom** pre tieto tri endpointy — jediný nedopovedaný bod je fixná `reduction_price` v Q18. (Pôvodná otázka Q38 „potvrdenie nešpecifikovaných kontraktov" preto vypadla — kontrakt je kompletný.)

### 31. `whoami` — štartovacia validácia, scope/expiry a fail-closed
*Prečo:* Kontrola scope, expiry a dostupnosti pred zápisom zabráni polovičnej dávke a záhadným `403`.
**Návrh:** Base URL + kľúč v `.env`; pri štarte `whoami` (dostupnosť, `scopes`, `expires_at`, `remaining`) a jasný stav „pripojené/chyba" — bez validného pingu je zápis zablokovaný. Volať aj pred každou dávkou; blokovať, ak chýba `product:edit`/`product:read`/`orders:read`, alebo ak `expires_at` padne pred koncom plánovaného okna. `403 forbidden` počas behu = **fail-closed** (zastaviť, upozorniť), nikdy neretryovať donekonečna. Pozn.: `expires_at` môže byť `null` (kľúč bez expiry) — vtedy sa 48 h pripomienka riadi lokálnym `key_set_at`.
*Alt:* a) validovať až pri prvej akcii; b) cachovať `whoami` na X minút; c) base URL editovateľná v UI s prepínačom test/produkcia; d) degradovať funkcie podľa dostupných scopes.

### 32. Rate-limiting: throttling a budget (per-minute aj per-day)
*Prečo:* Limit je zdieľaný manuálom aj schedulerom — bez rezervy by dávka vyhladovala čítania aj `whoami` a spôsobila `rate_limited`.
**Návrh:** Centrálny token-bucket (Laravel `RateLimiter`) so stropom s rezervou, zdieľaný manuál + scheduler, jeden queue worker; pri vyčerpaní job `release()` s oneskorením; rešpektovať `Retry-After` a exponenciálny backoff na `429/rate_limited`. **Budget čítať priamo z `whoami.remaining` (`per_minute` aj `per_day`)**, nie z natvrdo zadaného čísla — kontrakt konkrétny strop (napr. „300/60 s") neuvádza a `whoami` dáva živý zostatok vrátane **denného kvóta** (`per_day` môže byť `null` = bez dennej kvóty). „Rozpočet" viditeľne ukázať v UI.
*Alt:* a) fixný predpoklad limitu s reaktívnym backoffom; b) fixné oneskorenie medzi requestami (napr. 250 ms); c) adaptívne tempo podľa priebežného `whoami`; d) rezervovať budget zvlášť pre scheduler vs. manuál.

### 33. Zdroj pravdy o zľave a cache katalógu
*Prečo:* Appka aj shop môžu mať odlišný stav a vyhľadávanie nesmie míňať rate-limit na každý klik — ale ani ukázať zastaraný stav pri zápise.
**Návrh:** `getFull` je **zdroj pravdy** pre náhľad aj tesne pred zápisom; lokálna DB je len cache + audit, nikdy autorita. Krátky cache (~5 min) na `products/search`/`searchIndex`; stav zľavy z `getFull` sa **nikdy** necachuje cez moment zápisu; manuálne „Obnoviť".
*Alt:* a) bez cache (vždy živé); b) dlhší cache katalógu (~1 h) s invalidáciou po zápise; c) hybrid — DB pre zoznam, `getFull` len pri zápise.

### 34. Snímanie snapshotov pred/po a využitie `/api/batch`
*Prečo:* Audit vyžaduje snapshot pred aj po pri každej položke; treba vedieť, ktoré čítania sa dajú zoskupiť do batchu.
**Návrh:** `products/search` a `searchIndex` **nie sú batchable** (vrátia len `id`); pre hromadné „pred" čítania detailov použiť `getFull` — kontrakt uvádza „batch getFull calls for the ids you actually want", takže `getFull` **je** batchovateľný cez `/api/batch` (opravené oproti staršiemu predpokladu, že getFull nie je batchable). Zápisy (`setReduction`/`clearReduction`) idú jednotlivo, rate-cost 1:1. Rate-cost čítať/riadiť z `whoami.remaining` (Q32), nezávisle od toho, či batch šetrí volania.
*Alt:* a) sekvenčné `getFull` na všetko (jednoduché); b) „pred" z posledného `getFull` v cache, „po" vždy živé; c) fallback na verejné `products/get` (menej polí, bez marže), ak `getFull` nie je dostupné.
*Pozn.:* kontrakt nešpecifikuje maximálny počet položiek na jedno `/api/batch` volanie — pri implementácii držať konzervatívnu dávku a v prípade `batch_not_allowed`/`403` degradovať na sekvenčné čítanie.

### 35. HTTP klient, timeouty a retry politika
*Prečo:* Beh proti produkcii cez pomalé sekvenčné zápisy si vyžaduje jasné timeouty a rozlíšenie retryovateľných chýb.
**Návrh:** Laravel HTTP client (Guzzle): connect-timeout ~5 s, request-timeout ~15 s; retry len na `429 rate_limited` (podľa `Retry-After`) a `5xx request_failed` s exponenciálnym backoffom a max pokusmi; `4xx` okrem `429` (`400 invalid_input`, `403 forbidden`, `404`, `409 blocked_by_flash_sale`) **neretryovať**.
*Alt:* a) bez auto-retry; b) agresívnejší retry aj na sieťové chyby; c) circuit-breaker po sérii `5xx`.

### 36. Idempotencia a read-after-write overenie zápisu
*Prečo:* Appka nesmie tvrdiť „hotovo" len na základe `ok:true`; queue môže job zopakovať a pri timeoute po odoslaní nevieme, či zápis prešiel.
**Návrh:** Po každom reálnom zápise `getFull` a overiť, že `reduction_percent/from/to` sedia so zaslaným; nezhodu označiť ako drift. Položka nesie `operation_id` a stavový automat (viď Q48); job pred zápisom preskočí už `sent/verified` položku; pri **nejednoznačnom** zlyhaní najprv `getFull` a retry len ak sa zápis reálne neprejavil. Dedup podľa (`id`,`from`,`to`,`reduction`).
*Alt:* a) overovať len vzorku; b) overenie odložiť na reconciliation sweep (Q52); c) `WithoutOverlapping` + `uniqueId` na jobe; d) označiť „neisté" a nechať na reconciliation.

### 37. Normalizácia odpovedí a defenzívne parsovanie
*Prečo:* API mieša tvary — úspech je zabalený v `{"result":{...}}`, ale niektoré chyby prídu bez obalu (`{"error":"forbidden"}`, `setReduction` vracia `{"ok":false,"errors":[...]}`) a `order/get` vracia `HTTP 200` + `ok:false` + singulárny `error`.
**Návrh:** Jediný normalizér mapujúci všetky tvary na kanonický `{success, data, errorCodes[]}`: **rozbaliť `result` obal, ak je prítomný**, inak čítať top-level; zjednotiť singulárny `error` aj `errors[]`; ošetriť `200 + ok:false`. Tolerantné parsovanie (ignorovať neznáme polia, validovať povinné), logovať neznáme error kódy, health check cez `whoami` pri štarte.
*Alt:* a) ošetrovať tvar per endpoint bez spoločnej vrstvy; b) striktná schéma so zamknutou verziou; c) normalizér + verzionovaný klient s prepínačom kontraktu.

---

## 4) Bezpečnosť a GDPR

### 38. Lokálna autentifikácia (login bez Caddy)
*Prečo:* Aj na `127.0.0.1:3050` môže mať k PC prístup viac ľudí; nechránený nástroj mení produkčné ceny jedným klikom.
**Návrh:** Vlastný lokálny login (Laravel auth, jeden účet, hash hesla v `.env`) + auto-zámok po nečinnosti; prístup k reálnym zápisom až po prihlásení; žiadna registrácia ani reset cez e-mail.
*Alt:* a) bez loginu (dôvera v OS/PC); b) viac účtov s heslami; c) login + druhý faktor (TOTP) pre zápis.

### 39. Ochrana lokálneho HTTP endpointu (CSRF, Host/Origin, session, DNS-rebinding)
*Prečo:* Bez reverse proxy môže ľubovoľná webstránka v prehliadači posielať POST na `127.0.0.1:3050` (DNS-rebinding/CSRF) a spustiť zápis; beh na plain `http` mení pravidlá pre cookie.
**Návrh:** Middleware validujúci `Host` (len `127.0.0.1`/`localhost:3050`) a `Origin`/`Referer` pri stavových požiadavkách (cudzie odmietnuť); `VerifyCsrfToken` na všetkých write routách; cookie `ovl_zliav_session` `HttpOnly` + `SameSite=Strict`, krátka životnosť + re-auth pred reálnym zápisom. `Secure` flag **nezapínať** (plain `http://127.0.0.1` by cookie nepustil) — kompenzovať Host/Origin kontrolou.
*Alt:* a) len Laravel CSRF bez Host/Origin kontroly; b) viazať na Unix socket; c) HTTPS lokálne so self-signed certom a `Secure=true`; d) allowlist konkrétnych Originov.

### 40. Roly (kto smie zapisovať vs. len pozerať)
*Prečo:* Ak k appke pristúpi kolega, oddelenie „pozerať" od „meniť ceny" znižuje riziko omylu aj zneužitia.
**Návrh:** v1 jeden operátor s plnými právami, ale dátový model a UI pripravené na rolu „read-only" (audit + monitor bez zápisu).
*Alt:* a) hneď dve roly (operátor/pozorovateľ); b) žiadne roly; c) roly + per-akcia oprávnenia.

### 41. Zaobchádzanie s API kľúčom a redakcia uložených odpovedí
*Prečo:* Kľúč je najcitlivejší artefakt; jeho únik do logu, UI, gitu alebo uloženej odpovede = plná kontrola nad cenami a zákazníckymi dátami.
**Návrh:** Kľúč len v `.env` (`chmod 600`, mimo gitu), v UI maskovaný (posledné 4 znaky), **nikdy nelogovať**, nevypisovať do auditu; `key_set_at` v DB (nie kľúč) na výpočet 48 h pripomienky. Pred uložením requestu/odpovede odstrániť auth hlavičky (`X-Api-Key`, `Authorization`) a akékoľvek zákaznícke polia — ukladať len to, čo treba na audit zmeny ceny.
*Alt:* a) šifrovaný v DB namiesto `.env`; b) OS keychain/secret manager; c) logovať len zahashovaný fingerprint kľúča; d) ukladať len stavové kódy + hash tela odpovede.

### 42. GDPR — minimalizácia dát z objednávok a obmedzenie účelu
*Prečo:* Kľúč `orders:read` vidí zákaznícke dáta (`country`/`country_iso`, `total_paid`, položky); ich zbytočné ukladanie je hlavné GDPR riziko projektu.
**Návrh:** Ukladať **len agregáty na produkt** potrebné pre odporúčania (predané ks, `last_time_in_order`, rýchlosť predaja, `qty_in_orders`); NEUKLADAŤ `total_paid` na úrovni objednávky, `country`/`country_iso` viazané na osobu ani identifikátory objednávok s PII; surové riadky po agregácii zahodiť. Žiadne UI na prezeranie jednotlivých objednávok — len agregované pohľady; volania `order/*` viazané výhradne na funkciu odporúčaní.
*Alt:* a) neukladať nič, počítať za behu; b) agregáty + pseudonymizované `id` objednávky bez PII; c) surové objednávky s krátkou retenciou (7–30 dní); d) detail objednávky len za audit-logom prístupu.

### 43. GDPR — retencia
*Prečo:* Audit musí byť trvalý, ale dáta odvodené z objednávok majú mať krátku životnosť (princíp obmedzenia uloženia).
**Návrh:** Audit zmien cien natrvalo (bez PII); objednávkové/predajné agregáty a snapshoty s rolujúcou TTL ~90 dní, potom automaticky mazať; export a čistka na jedno kliknutie (viď Q60).
*Alt:* a) všetko natrvalo; b) 30 dní pre agregáty; c) konfigurovateľná retencia zvlášť pre audit a zvlášť pre objednávkové dáta.

### 44. Expiry kľúča vs. naplánované kampane
*Prečo:* Rotácia po 48 h je daná, ale kľúč môže vypršať uprostred armovanej kampane a zápisy ticho zlyhajú na `403`.
**Návrh:** `whoami.expires_at` sleduje expiry; banner pri < 24 h; pri armovaní porovnať `expires_at` s časom behu a **blokovať/varovať** armovanie kampaní, ktoré by bežali po expiry; po expiry prejsť do read-only režimu (verejné katalógové čítanie funguje ďalej). Ak je `expires_at = null`, riadiť sa 48 h pripomienkou z `key_set_at`.
*Alt:* a) tvrdý stop celej appky po expiry; b) len upozorniť a nechať zlyhať na API; c) automaticky pozastaviť dotknuté kampane a preplánovať po rotácii.

### 45. Kill-switch a poistky proti nechcenému zásahu do produkcie
*Prečo:* Scheduler zapisuje reálne ceny bez človeka pri obrazovke — okrem potvrdenia treba globálnu „stopku", ktorá zastaví aj rozbehnutú lavínu chýb.
**Návrh:** Viditeľný indikátor „PRODUKCIA"; globálny **kill-switch / maintenance flag** blokujúci všetky reálne zápisy (manuál aj scheduler); scheduler beží len ak je kampaň armovaná, kľúč platný a kill-switch vypnutý; konfigurovateľný **denný strop** počtu zapísaných produktov (zladiť aj s `whoami.remaining.per_day`, Q32).
*Alt:* a) len potvrdenie pri dávke bez denného stropu; b) kill-switch + „chladiaca doba" medzi veľkými dávkami; c) strop naviazaný na % katalógu; d) núdzové zrušenie všetkých aktívnych zliav jedným tlačidlom.

---

## 5) Backend (Laravel, DB, scheduler, audit)

### 46. Dátový model appky
*Prečo:* Správna schéma je základ pre idempotenciu, kompenzáciu aj audit; dodatočné prerábanie je drahé.
**Návrh:** Tabuľky: `settings`, `products_cache`, `campaigns`, `operations` (dávka), `operation_items` (položka + stav), `audit_log` (append-only), `snapshots` (pred/po `getFull`), `api_responses` (redigované). Cudzie kľúče + `operation_id` naprieč (kampaň → operácia → položka → audit → snapshot).
*Alt:* a) minimal (`audit_log` + `campaigns` + `settings`); b) zlúčiť snapshoty do `operation_items`; c) event-sourcing / jedna univerzálna event tabuľka.

### 47. Queue driver a serializácia zápisov
*Prečo:* Zápisy musia ísť sekvenčne pod jedným rate budgetom; paralelní workeri by rate-limit rozbili.
**Návrh:** `database` queue driver nad SQLite (žiadna extra služba), **jeden** worker (`queue:work`), joby s `WithoutOverlapping`, aby sa zápisy serializovali a rešpektovali tempo.
*Alt:* a) Redis queue (robustnejšie, ďalšia služba); b) `sync` (obchádza throttle — nevhodné); c) `database` + oddelené fronty pre zápisy a čítania.

### 48. Stavový automat položky dávky
*Prečo:* Presné stavy sú predpokladom idempotencie, kompenzácie aj čitateľného priebehu v UI.
**Návrh:** Stavy: `pending → dry_run_ok → awaiting_confirm → queued → sent → verified` a vetvy `failed`, `compensated`, `skipped_flash_sale`, `skipped_low_margin`, `uncertain` (nejednoznačné zlyhanie); prechody logované do auditu.
*Alt:* a) hrubšie stavy (pending/done/failed); b) bez samostatného „uncertain".

### 49. Konkurencia a odolnosť DB (SQLite/MariaDB)
*Prečo:* SQLite pri súbežnom zápise (web + worker + scheduler) ľahko hodí „database is locked", čo počas dávky znamená stratené zápisy; voľba DB je zatiaľ len predbežná.
**Návrh:** Pri SQLite zapnúť WAL mód, `busy_timeout` (~5000 ms), serializovať zápisy jedným workerom, čítania súbežne. **Potvrdiť SQLite vs. MariaDB** (viď „Ako odpovedať", bod 3) — pri MariaDB odpadá lock problém, ale pribúda kontajner `ovl-zliav-db`.
*Alt:* a) prejsť na MariaDB pri raste súbežnosti; b) samostatný SQLite súbor pre queue vs. dáta; c) `PRAGMA synchronous=NORMAL` pre výkon.

### 50. Audit log — štruktúra, obsah a nemennosť (tamper-evidencia)
*Prečo:* Audit má po týždňoch vysvetliť „prečo je tento produkt v akcii" a mať hodnotu dôkazu — musí byť úplný, s aktérom a kontextom, a nefalšovateľný z appky.
**Návrh:** Append-only tabuľka, jeden riadok = jedna operácia; obsah: aktér (účet), zdroj (manuál/scheduler), časová pečiatka (UTC + pásmo shopu), dry-run vs. reálne, akcia, `id`, `operation_id`, pred/po snapshot, zaslané parametre (bez kľúča), uložená (redigovaná) odpoveď, výsledok, prípadný override marže + dôvod. Žiadne `UPDATE`/`DELETE` z appky + **hash-reťaz** (každý záznam nesie hash predchádzajúceho).
*Alt:* a) append-only bez hash-reťaze; b) paralelný append-only súbor (JSON lines); c) podpis záznamov kľúčom appky / periodický hash-reťazený export.

### 51. Snapshot pred/po a jeho väzba na operáciu
*Prečo:* Snapshot je dôkaz skutočného stavu v shope pred a po zásahu; musí byť jednoznačne spárovaný so zápisom.
**Návrh:** `getFull` JSON tesne pred a tesne po zápise, naviazaný na `operation_item`; ukladať relevantné telo (`reduction_percent/from/to`, `margin`, `margin_percent`, `sell_price_with_vat`, `active`, `qty`) + vypočítaný diff kľúčových polí.
*Alt:* a) len „pred" + overenie „po" (bez plného „po"); b) ukladať len diff, nie plné JSON; c) „pred" z cache, „po" živé.

### 52. Reconciliation job (detekcia driftu)
*Prečo:* Ceny sa môžu zmeniť aj mimo appky (admin shopu, expirácia, flash sale) — bez pravidelnej kontroly appka verí neaktuálnemu stavu.
**Návrh:** Naplánovaný sweep, ktorý pre aktívne/nedávne položky porovná posledný známy stav s `getFull` a označí drift na vyriešenie (dopĺňa read-after-write z Q36).
*Alt:* a) reconciliation len on-demand z UI; b) len pre aktuálne bežiace kampane; c) žiadny sweep, spoliehať sa len na read-after-write.

### 53. Beh schedulera a workera lokálne + premeškané okná + heartbeat
*Prečo:* Lokálna appka nemá garantovaný 24/7 beh — kampaň na 06:00 sa nespustí, ak je PC vypnuté; a bez heartbeatu operátor nevie, či procesy bežia.
**Návrh:** `schedule:work` + `queue:work` ako **supervidované procesy** (supervisor/systemd alebo entrypoint kontajnera `ovl-zliav-app`, viď Q54). Pri štarte kontrola **premeškaných okien**: armovanú, ale nespustenú kampaň ponúknuť dobehnúť alebo zrušiť, **nikdy nezapísať ticho spätne**. Heartbeat panel v UI: posledný tik schedulera, či worker žije, posledný úspešný `whoami`, posledná reconciliation — varovať pri zastaranom stave. Zdokumentovať, že stroj musí bežať v čase kampane.
*Alt:* a) predpokladať 24/7; b) OS scheduler (systemd timer/Windows Task Scheduler) na prebudenie; c) systémový cron volajúci `schedule:run` každú minútu; d) `queue:listen` namiesto `work`.

### 54. Balenie a spustenie appky — Docker/compose, entrypoint, `.env.example`
*Prečo:* Rozhodnutia hovoria „bez Caddy, port 3050, kontajner `ovl-zliav-app`", ale treba doriešiť, ako sa appka reálne nainštaluje a naštartuje ako celok (web + queue + scheduler) jedným krokom.
**Návrh:** `docker-compose.yml` s `ovl-zliav-app` (+ voliteľne `ovl-zliav-db` pri MariaDB); jeden **entrypoint** pod ľahkým supervízorom (s6/supervisord) spúšťajúci web (php-fpm/`artisan serve` na porte **3050**), `queue:work` a `schedule:work`; `.env.example` so všetkými kľúčmi (base URL, API kľúč placeholder, TZ, hash hesla, stropy); `docker compose up` ako jednorazové spustenie; migrácie + WAL init pri štarte.
*Alt:* a) bare-metal + systemd unit súbory; b) Laravel Sail; c) Procfile/foreman (`web`, `worker`, `scheduler`) bez kontajnera.

### 55. Kde žije konfigurácia (`.env` vs. DB `settings`)
*Prečo:* Miešanie tajomstiev a prevádzkových parametrov sťažuje bezpečnú zmenu stropov bez zásahu do súborov a reštartu.
**Návrh:** Tajomstvá a prostredie v `.env` (API kľúč, base URL, TZ, hash hesla); prevádzkové parametre v DB `settings` editovateľné v UI (strop dávky, denný strop, min. marža, rate rezerva, TTL retencie, SMTP pre Q59) s rozumnými defaultmi a `.env` fallbackom; zmeny nastavení **auditované**.
*Alt:* a) všetko v `.env` (zmena = reštart); b) všetko v DB okrem kľúča; c) profily nastavení (test vs. produkcia).

### 56. Migrácie a verziovanie schémy (najmä audit/snapshot)
*Prečo:* Zmeny schémy nesmú ohroziť existujúci audit ani históriu kampaní — audit je dôkazný materiál.
**Návrh:** Štandardné Laravel migrácie; auditné/snapshot tabuľky meniť **len aditívne** (žiadne deštruktívne zmeny), migrovať vždy so zálohou (Q57); verziovať formát snapshotu/auditu (stĺpec `schema_version`), aby staré záznamy zostali čitateľné.
*Alt:* a) povoliť deštruktívne migrácie mimo auditu; b) verziovať schému snapshotov v samostatnej tabuľke; c) len aditívne bez explicitného verziovania.

### 57. Zálohovanie a obnova DB
*Prečo:* Audit a snapshoty sú nenahraditeľný dôkaz o zásahoch do produkčných cien — ich strata je neprijateľná.
**Návrh:** Denný `VACUUM INTO`/file-copy snapshot SQLite + záloha pri štarte a pred každou migráciou; zálohy mimo repozitára, retencia N dní; overená obnova.
*Alt:* a) len ad-hoc manuálny export do JSON/CSV; b) kontinuálny WAL archiving; c) sync do šifrovaného externého úložiska.

### 58. Testovacia stratégia (dry-run vs. reálny beh)
*Prečo:* Nesprávny zásah do produkcie je nezvratný voči zákazníkom — testy musia pokryť edge-cases bez volania živého shopu.
**Návrh:** Kontraktné/feature testy proti **mockovanému** API klientovi (fake HTTP handler pokrývajúci všetky tvary a kódy: `result` obal, `409 blocked_by_flash_sale`, `429 rate_limited`, `200+ok:false`, `range_too_long`, čiastočné zlyhanie, drift, gate dry-run vs. reálny zápis); dry-run testovateľný bez siete; **žiadne reálne volania v CI**; reálny beh len manuálne proti testovacej doméne pred produkciou.
*Alt:* a) integračné testy proti testovaciemu shopu; b) „shadow" režim (reálne čítania, zápisy simulované); c) feature flag oddeľujúci test vs. produkčný cieľ; d) minimálne happy-path + dôraz na manuál.

### 59. Chybové stavy, logovanie a upozornenia schedulera
*Prečo:* Zlyhania schedulera bez človeka pri obrazovke musia niekam „zvoniť", inak sa kampaň pokazí ticho.
**Návrh:** Štruktúrované logovanie (Laravel log, bez PII a bez kľúča), UI panel chýb na operáciu, e-mailové zhrnutie výsledku plánovaného behu a alert pri zlyhaní (vyžaduje SMTP konfiguráciu — v `settings`, Q55).
*Alt:* a) len UI, žiadne e-maily; b) log do súboru + rotácia; c) integrácia s externým alertingom.

### 60. Export auditu a snapshotov (CSV/JSON)
*Prečo:* Audit je jadro hodnoty projektu — treba doklad pre účtovníctvo/reklamácie a export pred GDPR čistkou (Q43).
**Návrh:** Export auditu + snapshotov na požiadanie do CSV **aj** JSON, s filtrom (dátum, produkt, aktér, dry-run/reálne); zvolené stĺpce (kto/kedy/akcia/`id`/pred/po/výsledok), **bez PII**; automatický export pred spustením GDPR čistky agregátov.
*Alt:* a) len CSV; b) len JSON (bohatšie snapshoty); c) plánovaný periodický export do súboru; d) hash-reťazený export pre dôkaznú hodnotu.

---

## Už rozhodnuté / určené kontraktom

*(Nie sú predmetom potvrdzovania — sú fixné. Uvádzame ich, aby bol kontext úplný.)*

**Z `01-ROZHODNUTIA.md`:**
1. **Stack = Laravel (PHP 8.4) + Blade/Livewire.**
2. **DB = SQLite predbežne** (MariaDB len na vyžiadanie; finálne potvrdenie ostáva v Q49).
3. **Lokálny beh na `127.0.0.1`, bez Caddy.**
4. **Port `3050`, kontajner `ovl-zliav-app` (+ `ovl-zliav-db` pri MariaDB), cookie `ovl_zliav_session`.**
5. **API kľúč v `.env` + evidencia „kľúč nastavený dňa X" + UI pripomienka rotácie po 48 h; appka kľúč sama nemaže** (maskovanie/redakcia = Q41).
6. **Ovládanie = manuál + Laravel scheduler + queue.**
7. **`orders:read` = ÁNO** (appka radí, čo zlevniť); GDPR pravidlá = Q42/Q43.
8. **Plný audit log + snapshot pred/po cez `getFull` + uložená odpoveď API** (štruktúra = Q50/Q51).
9. **Bezpečnostný model = konfigurovateľný strop na dávku** (nie pevný allowlist „max 10").
10. **Dry-run je povinný default; reálny zápis až po explicitnom potvrdení; armovanie = potvrdenie vopred.**
11. **`clearReduction` je reálny endpoint** (netreba hack s `to` do minulosti); presný kontrakt je v API doc (viď nižšie, bod 25).
12. **Cieľ = produkčný shop; doména a stav kľúča `product:edit` čakajú na doplnenie** (viď „Ako odpovedať", body 1–2).

**Určené API kontraktom (`sperky-api.md`):**
13. **`reduction` musí byť `0`–`30`** (percento, nie zlomok); krok/normalizácia = Q29.
14. **Okno `to ≥ from` a `from–to` ≤ 3 mesiace**; čo robiť s dlhším = Q29.
15. **`setReduction`/`clearReduction` sú jednotlivé POST zápisy** → N produktov = N requestov 1:1 (nie sú batchable).
16. **`products/search` a `products/searchIndex` NIE sú batchable** (vrátia len `id`); `getFull` sa **dá** batchovať cez `/api/batch` (kontrakt: „batch getFull calls") — presný max. počet položiek doc neuvádza (Q34).
17. **Rate-limit: presný strop kontrakt neuvádza; živý zostatok dáva `whoami.remaining` (`per_minute` aj `per_day`)**; `429 rate_limited` s `Retry-After` je retryovateľný, nehardfailovať (stratégia = Q32).
18. **Tvary odpovedí: úspech zabalený v `{"result":{...}}`; niektoré chyby bez obalu (`{"error":...}`, `setReduction`/`clearReduction` → `{"ok":false,"errors":[...]}`); `order/get` → `HTTP 200` + `ok:false` + singulárny `error`** (normalizér = Q37).
19. **Transport/aplikačné kódy:** `400 invalid_input`/`invalid_dates`/`invalid_reduction`/`range_too_long`, `403 forbidden`/`batch_not_allowed`, `404`, `405 method_not_allowed`, `409 blocked_by_flash_sale`, `429 rate_limited`, `500 request_failed` (SK preklad = Q9).
20. **Scopes:** `product:edit` pre `setReduction`/`clearReduction`; `product:read` pre `getFull`/`search`/`categories`; `orders:read` pre `/api/order/*`; `whoami` = hocijaký platný kľúč; verejné bez auth: `products`, `products/get`, `products/searchIndex`.
21. **Paginácia `page`/`per_page` (default 50, max 100), tvar `{data,page,per_page,total}` (total = celý výsledok).**
22. **Autentifikácia: `X-Api-Key` alebo `Authorization: Bearer`; kľúč vydáva maintainer out-of-band** (Tools → API keys, zobrazený raz).
23. **`409 blocked_by_flash_sale` (TurboSaleUltimate) platí pre `setReduction` aj `clearReduction`** (handling = Q20/Q21).
24. **Dávka nie je atomická → kompenzácia, nie rollback** (ako = Q23).
25. **`clearReduction`, `getFull`, `whoami`, `search`, `searchIndex`, `categories` sú v kontrakte plne špecifikované** (verb, telo, scope, tvar, `409`) — pôvodná „diera v API doc" je vyriešená; jediný nedopovedaný bod = fixná `reduction_price` (⚠ Over v Q18).
