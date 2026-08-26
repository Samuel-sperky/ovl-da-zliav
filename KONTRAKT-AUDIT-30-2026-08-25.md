# KONTRAKT — Audit a opravy v šiestich tímoch (25. 8. 2026)

**Stav:** schválený, 20 rozhodnutí zodpovedaných používateľom 25. 8.
**Vetva:** `feat/audit-30` z `d9dc578`, šesť tímových vetiev `feat/audit-30-<tím>`
**Strop:** ~5 M tokenov (sondy 765 k už minuté)
**Nadradené:** `docs/10-KONTRAKT.md` (I1–I14), `docs/50-KONTRAKT-V3.md` (K1–K12),
`design/v3/ARCHITEKTURA.md` (P1–P8). Tento kontrakt ich **nemení**.

---

## 0. Prečo tento beh nie je hľadanie

Tri sondy (765 k tokenov) našli **24 lokalizovaných nálezov**. Tímy ich teda
neobjavujú — **opravujú ich**. Rozhodnutie 18: platíme za hotové zmeny, nie za
druhé objavenie toho istého.

Sondy zároveň našli niečo horšie než chybu v kóde: **chyby v dokumentácii,
ktorou by sa tridsať agentov inštruovalo.** `CLAUDE.md` tvrdí, že na Windowse
padá 9 testov (od `a16e355` nepadá ani jeden), README opisuje testovací scenár,
ktorý sa od `547fe2a` nedá vyvolať, a `docs/20-BACKLOG-SHOP-API.md` žiada od
správcu shopu šesť vecí, ktoré dodal 13. 8. Agent, ktorý tomu uverí, bude
skutočný pád považovať za prostredie. Preto je to úloha tímu **POUŽITEĽNOSŤ**
(rozhodnutie 13), a preto je v každom zadaní výslovné varovanie.

---

## 1. Oprava môjho vlastného tvrdenia

24. 8. som napísal, že mína pri wipe kľúča je zavretá a že „callback dnes nikto
nezapája, takže sa nič nedeje". **Bola to pravda o `client.ts` a nepravda
o appke.** `executor.ts:983` si to rozhodnutie robí sám:

```ts
const keyRejected = error.kind === 'unauthorized' || error.kind === 'forbidden'
// :1014  apiKeyRepo.wipe('http_403')
```

`onKeyRejected` nečíta, takže moja oprava v klientovi ho neochránila. Stráca
presne to rozlíšenie, ktoré `client.ts:1503` úmyselne drží — a keďže ban na IP
platí od 19. 8., **je to aktuálny stav appky**: fronta zastaví, kampaň dostane
„chýba kľúč na zápis", položka povie „Kľúč nemá scope `product:edit`", a kľúč sa
ZMAŽE. Používateľ vloží nový, narazí na to isté 403, kľúč sa zmaže znovu. Ban
nepomenuje nikto.

Mína nebola nastražená na budúcnosť. Bola odpálená a ja som sa pozeral na
nesprávny súbor. Je to nález **X1** a je prvý na zozname.

---

## 2. Rozhodnutia (odpovede na 20 otázok)

| # | Rozhodnutie |
| --- | --- |
| 1 | Šiesty tím = **verifikácia**: päť agentov, ktorí sa snažia VYVRÁTIŤ nálezy a opravy ostatných dvadsiatich piatich |
| 2 | Agenti **nájdu aj opravia** vo vlastnom worktree |
| 3 | Strop **~5 M** tokenov; pri 4 M sa ozvem |
| 4 | Nová vetva `feat/audit-30` z aktuálneho HEAD |
| 5 | **Šesť testovacích DB** (`ovl-test-t1..t6`, porty 3313, 3314, 3315, 3310, 3311, 3312) — jedna na tím |
| 6 | **Jeden worktree na tím**, šesť celkom |
| 7 | Bez otázky sa NESMÚ dotknúť: invariantov I1–I14 a K1–K12, schémy DB a migrácií, cesty API kľúča a redaktora, verejných tvarov odpovedí API |
| 8 | Každá oprava logiky = **test overený mutáciou** (ukázať, že po zvrátení opravy spadne) |
| 9 | UX/UI len v rámci P1–P8 a **existujúcich tokenov** — žiadne nové farby ani veľkosti písma |
| 10 | Texty sa prepisovať smú, **každú zmenu odôvodniť** v commite |
| 11 | `npm run snimky` **povinne pred aj po** každej UI zmene |
| 12 | Nález mimo vlastnej oblasti → **nahlásiť koordinátorovi, neopravovať** |
| 13 | Zastaralé dokumenty = úloha tímu POUŽITEĽNOSŤ |
| 14 | `LockedFeatures`: opraviť dôvod **aj** pripraviť odomknutie filtrov |
| 15 | POUŽITEĽNOSŤ začne **snímkami** a súdi z obrázkov, nie z `.tsx` |
| 16 | Žiadosť o `product:read` = **samostatný dokument** |
| 17 | Strop zdvihnutý na 5 M |
| 18 | Tímy **opravujú nálezy sond**, nehľadajú nové |
| 19 | Automatické potvrdenie D2 v `NewDiscount.tsx:650` je **vedomé zjednodušenie** — ručne písaný počet stačí. Zapísané ako rozhodnutie, nikto to už nehlási |
| 20 | Zakázané zóny: agent smie, **ak sa najprv spýta koordinátora** |

---

## 3. Pridelenie: 5 tímov × 5 nálezov

Zakázaná zóna je označená **[Z]** — taký nález sa nesmie opraviť skôr, než
agent opíše návrh koordinátorovi a dostane odpoveď (rozhodnutie 20).

### Tím LOGIKA — správnosť zápisovej cesty (worktree `a30-logika`, DB :3311)

| # | Nález |
| --- | --- |
| **L1** [Z] | **Predĺženie zľavy s pásmami prepíše všetko najvyšším percentom.** `extend/preview/route.ts:175`, `extend/route.ts:85`, `_shared.ts:612`. `percents` sa nepodáva, fallback dá hlavičkové percento; pri pásmach 30/20/10 idú do produkčného shopu všetky za 30 %. Hash tokenu sedí, takže I3 to pustí. D27 to zakazuje doslova, I7 znamená, že cesta späť nie je. Test žiadny. |
| **L2** | **`retry-failed` robí to isté.** `retry-failed/route.ts:343` nepodáva `percents`. Porovnaj `campaigns/route.ts:294`, ktorý ich podáva — tá asymetria JE tá chyba. |
| **L3** | **`reconcile` označí nikdy neposlané položky za „nevieme".** `reconcile.ts:37,56`. Po reštarte (normálna cesta upgradu, D100) sa 7 800 `pending` položiek zmení na `uncertain` a 40-dňová fronta sa zavrie ako `partial`. Porušuje K6 („žiadny zápis sa nestratí") a I11. **`test/integration/reconcile.spec.ts:42,68` toto správanie TVRDÍ ako správne** — bol napísaný pred K2 a dnes zamykáva defekt. |
| **L4** | **Manuálny `execute` zmeškanej kampane nemôže uspieť a najprv poškodí stav.** `execute/route.ts:80` overí token len nad hlavičkou, prepíše `confirm_payload_hash` a claimne kampaň na `running`; executor potom prepočíta hash z riadkov → nesúlad → 409. Kampaň už nie je v `findQueued` ani `findMissed`. D33b robí z tejto cesty jedinú pre zmeškanú kampaň. |
| **L5** | **Zlyhávajúca kampaň sa opakuje každých 60 s naveky.** `queue.ts:339` — `catch`, log, `continue`; žiadne počítadlo, žiadny backoff, žiadna zmena stavu. Tá istá rodina ako 403 opakované dvanásť dní; `sales/stop-policy.ts` na to má pravidlo, zápisová fronta nie. |

### Tím BACKEND — rozpočty, výkon, integrita (worktree `a30-backend`, DB :3315)

| # | Nález |
| --- | --- |
| **B1** | **`extend/preview` číta shop bez rezervácie rozpočtu — to je mechanizmus, ktorým sme si privolali IP ban.** `extend/preview/route.ts:95,107`. `preview.ts:720` sa proti tomu spevnil, súrodenec nie: 8 000 produktov ≈ 320 dávok proti stropu 240/deň, a počítadlo o nich nevie. Plus N+1 `lastOwnWrite` v cykle. `catalog/refresh/route.ts:62` má tú istú dieru. Route nemá `rateLimit`. |
| **B2** | **Executor ťahá celú sadu položiek pri každom prechode fronty.** `executor.ts:434` `listByCampaign` so `sent_payload` aj `raw_response`; `campaign-items.repo.ts:281` `nextPending()` bol napísaný presne na toto a **nemá produkčného volajúceho**. Na 30. deň 10 000-položkovej fronty je to 10 000 riadkov s celou históriou, aby sa zapísalo 200. |
| **B3** | **`insertConfirmedCampaign` nie je v transakcii.** `_shared.ts:585` — štyri zápisy za sebou; pád v 7. z 20 dávok nechá kampaň živú vo fronte s neúplnou sadou. Plus `campaigns.create` nikdy nenastaví `items_total`, takže `CHECK (items_total <= 10000)` — ktorý K1 nominuje ako DB backstop — sa pri inserte nevyhodnotí vôbec. |
| **B4** | **Nečitateľné počítadlo auditu sa vyhodnotí ako 0**, čo je povoľujúca odpoveď. `audit.repo.ts:212`, `budget.ts:201`. Runaway zámok (D79/I12) aj denný rozpočet (K2) prejdú. `budget.ts` má v hlavičke napísané, že je to fail-closed. |
| **B5** | **Štvrtý komentár menujúci neexistujúci test** — `catalog.repo.ts:894` → `detaily-katalog.spec.ts`. Plus `syncCountersFromItems` bez volajúceho a s inou definíciou počítadiel než `finishCampaign`, a `queue.ts:230` prezentuje `LIMIT 20` ako počet (`queueWaiting`). |

### Tím UX — čo appka tvrdí a nezmerala (worktree `a30-ux`, DB :3313)

| # | Nález |
| --- | --- |
| **X1** [Z] | **Ban na IP sa hlási ako chýbajúci kľúč a appka pri tom zmaže funkčný kľúč.** `executor.ts:983,1014`. Viď sekcia 1. Zakázaná zóna (cesta kľúča) — návrh najprv koordinátorovi. |
| **X2** | **Na čítacej strane ban nemá slová vôbec** a ponúknutý ďalší krok nemôže nikdy vyjsť. `live-status-model.ts:124` („Shop naposledy neodpovedal" — shop odpovedal, odmietol), `catalog-status.ts:401,705` („Skúste to o chvíľu znova"). `catalogReadBlockers()` (`blockers.ts:1178`) nemá vetvu pre ban, hoci objednávková cesta má hotové vety v `stop-policy.ts:143`. `status-api.ts:292` sploští `lastError` na boolean, takže obrazovka odmietnutie od mlčania rozlíšiť NEVIE. |
| **X3** | **Hlavička hovorí „Fronta prázdna", keď nevie.** `HeaderStatus.tsx:44`, `layout/queue.ts:70`. `null` z nečitateľnej odpovede vykreslí to isté slovo ako skutočne prázdna fronta — na každej obrazovke. Vzor opravy je tri súbory vedľa (`StatusSection.tsx:360`, „stav fronty nevieme"). |
| **X4** | **„Všetko v poriadku", kým tisíce položiek stoja.** `overview-model.ts:141`, `overview-verdict.ts:298`. `mode: 'calm'` ignoruje `queue.pending`; kampaň v `needs_key` (čo je dnes vďaka X1 očakávaný stav) má pending položky bez `current`, verdikt prepadne do „Nič nezastavuje ani nebrzdí zápis". `overviewVerdict` nečíta `heartbeat` vôbec. |
| **X5** | **Dominantné číslo na Prehľade je označené ako niečo iné.** `StatusSection.tsx:242` — `caption="zapísaných položiek"`, ale `done = total − pending` je SPRACOVANÝCH, vrátane `failed`, `uncertain`, `skipped`. ARCHITEKTURA §3.2 to hovorí výslovne a `queue-model.ts:37` to isté číslo označuje správne. |

### Tím UI — povrch, texty, súdržnosť (worktree `a30-ui`, DB :3314)

| # | Nález |
| --- | --- |
| **U1** | **Dva rôzne dátumy dokončenia tej istej fronty, sekundy po sebe** — a neskorší je nesprávny. `NewDiscount.tsx:496` počíta s frontou pred sebou, `campaigns/route.ts:326` len s vlastnými položkami. Karta úspechu vypíše ten optimistickejší ako `Hotové <dátum>`. `keyExpiresBeforeFinish` z neho vychádza, takže varovanie K6 sa môže tichó preskočiť. |
| **U2** | **Najpravdepodobnejšia chyba pri potvrdení je napísaná zakázaným slovníkom.** `preview-token.ts:534` → „Preview token expiroval (TTL 15 min) — spusti dry-run znova (I3)." Ide to na obrazovku verbatim (`api.ts:252` → `NewDiscountConfirm.tsx:331`). K10/P3 zakazuje „dry-run" na povrchu a appka to inde prekladá („skúška naprázdno"). 15 minút pri rozhodnutí o 8 000 produktoch znamená, že to je bežný stav. Prekladač existuje (`queue-model.ts:302`) a nie je použitý. |
| **U3** | **Nastavenie „Predvolený čas zápisu" nerobí nič.** `EagerWriteToggle.tsx:49` ukazuje a ukladá hodnotu, ktorú nečíta nikto — `mode: 'eager'` je natvrdo v `NewDiscount.tsx:642`, `extend/route.ts:89`, `retry-failed/route.ts:347`. |
| **U4** | **Appka tvrdí, že zľavy neruší, a ponúka tlačidlo Zrušiť.** `catalog-status.ts:552` vs `DiscountDetail.tsx:313` (disclosure so zakázaným finálnym tlačidlom, `END_IN_SHOP_READY = false`). README:31 aj I7 hovoria nikdy; `DiscountDetail.tsx:283` tvrdí, že I7 sa zmenil. Priznať nezapojenú akciu je správne — dve obrazovky si protirečiť o tom, či tá schopnosť existuje, nie. |
| **U5** | **„Výkon výberu" porovnáva dve okná, ktoré obe predchádzajú zľavu.** `performance/route.ts:65`. `recent` je vždy posledných N dní do dneška, bez ohľadu na `dateFrom` — a normálny stav zľavy v detaile je `zapisuje sa`, kedy ani jedno okno zľavu nepokrýva. Chýba veta „zľava sa ešte nezačala, výkon neexistuje". |

### Tím POUŽITEĽNOSŤ — prvý pohľad na appku vôbec (worktree `a30-pouzitelnost`, DB :3310)

Sonda zistila, že **použiteľnosť je najtenšie pokrytá oblasť** a že sa na tie
štyri taby nikdy nikto nepozeral: grep na `accessibility`, `WCAG`, `klávesnic`,
`čítačk` dá 0 zásahov v 46 KB UX auditu a 2 v 74 KB UI auditu, a kritérium
„preklik v prehliadači" je v kontraktoch odznova a nebolo splnené ani raz.

| # | Nález / úloha |
| --- | --- |
| **P1** | **Odfotiť všetky obrazovky snímkovačom a súdiť z OBRÁZKOV, nie z `.tsx`** (rozhodnutie 15). Prvá vizuálna kontrola v histórii projektu. Zapísať aj to, čo snímkovač sám nekreslí správne. |
| **P2** | **„Predané 180 d: 0" nad tromi dňami meraných dát — a to číslo vyberá produkty.** `CatalogTable.tsx:388`, `catalog/search/route.ts:679` (`?? 0`). `SALES_WINDOW_DAYS` je 3 (`env.ts:100`). Prehľad aj karta výkonu pokrytie priznávajú (`SalesSection.tsx:221`), Produkty a sprievodca nie — a pravidlo pásma „0 predaných za 360 dní → 30 %" na tom čísle stojí. |
| **P3** | **`LockedFeatures.tsx` obviňuje eshop z dát, ktoré už vracia** — a klipboardové tlačidlo posiela ten nepravdivý text dodávateľovi. Podľa `KONTRAKT-API-V5` prišli 13. 8.; chýba nám scope `product:read`. Rozhodnutie 14: **opraviť dôvod aj pripraviť odomknutie filtrov.** |
| **P4** | **Zastaralé dokumenty** (rozhodnutie 13): `CLAUDE.md` (9 padajúcich testov — nepadá ani jeden), README (D20 onboarding, ktorý V3 zrušil; „111 preskočí, trvaj na 0 skipped (1247)" — dnes 3113 a preskočiť sa nedá), `docs/20-BACKLOG-SHOP-API.md` (žiada šesť dodaných vecí), `docs/58-CO-VIEME-TAHAT-Z-API.md` („MÁME" o kľúčoch, ktoré nemáme). |
| **P5** | **Klávesnica, focus, čítačka obrazovky** — nula pokrytia v celom repe. Prejsť hlavné cesty tabulátorom nad snímkami a markupom a nájsť, čo sa nedá obslúžiť bez myši. |

### Tím VERIFIKÁCIA — päť agentov proti dvadsiatim piatim (worktree `a30-verifikacia`, DB :3312)

Nehľadajú nové nálezy. **Snažia sa vyvrátiť** hotovú prácu ostatných tímov:
každý verifikátor si vezme jeden tím, prečíta jeho diff a testy a hľadá
(a) opravu, ktorá nerieši opísaný problém, (b) test, ktorý prejde aj po zvrátení
opravy, (c) tvrdenie v commite, ktoré kód nepodporuje, (d) komentár menujúci
neexistujúci test, (e) regresiu inde. Verdikt na nález: `potvrdene` /
`neuplne` / `vyvratene`, vždy s tým, čo presne prečítali.

Piaty verifikátor kontroluje **mňa**: prejde tento kontrakt proti výsledku a
hľadá, čo som pridelil nesprávne, na čo som zabudol, a ktoré moje tvrdenie
v tomto dokumente nesedí.

---

## 4. Čo NIE

| Čo | Prečo |
| --- | --- |
| Automatické potvrdenie D2 v `NewDiscount.tsx:650` | Rozhodnutie 19 — vedomé zjednodušenie, ručne písaný počet stačí. **Nikto to už nehlási.** |
| Zamknuté filtre ako „chýbajúca funkcia" | K8 — zamknuté a priznané je správne. Opravuje sa DÔVOD, nie zámok. |
| Nové farby, tokeny, veľkosti písma | Rozhodnutie 9. Paleta má zmerané kontrasty pri farbosleposti a stráži ju test. |
| Obchádzanie IP banu | Dokumentácia API to zakazuje pod hrozbou trvalého banu. |
| Čokoľvek proti ostrému shopu | Ban platí. Všetko proti mock shopu (I6). |
| Migrácie a zmeny schémy | Rozhodnutie 7. Nevratné, vyžaduje zálohu. |
| Rediscovery | Zoznam „už opravené / vedomé / známe a otvorené" je v každom zadaní. Nález z toho zoznamu = premarnený agent. |

---

## 5. Akceptačné kritériá

1. Každý pridelený nález je buď **opravený**, alebo má napísané, prečo nie.
2. Každá oprava logiky má test a **mutačný dôkaz** (po zvrátení opravy spadne).
3. Každá tímová vetva: `typecheck` čistý, `lint` čistý, testy dotknutých súborov
   zelené. **Celý balík púšťam ja** pri každom zlúčení, sériovo.
4. Po zlúčení všetkých šiestich: **0 padá, 0 preskočených**.
5. Každá UI zmena má snímku pred aj po (rozhodnutie 11).
6. Žiadna zmena v zakázanej zóne bez zapísaného súhlasu koordinátora.
7. Verifikačný tím prešiel všetkých päť tímov; nálezy s verdiktom `vyvratene`
   sú vrátené alebo prepracované.
8. Žiadne tvrdenie v commite, ktoré kód nepodporuje. Toto kritérium existuje,
   pretože ho 25. 8. porušil koordinátor sám.

---

## 6. Riziká

| Riziko | Čo s ním |
| --- | --- |
| **Päť agentov v jednom worktree.** Dvaja môžu chytiť ten istý súbor. | Každý agent má v zadaní menované SVOJE súbory. V tíme bežia agenti **sériovo**, nie paralelne — paralelné sú tímy. Šesť DB je presne na to. |
| **L1/L2 píšu do produkčného shopu nesprávne percentá.** Oprava sa nedá overiť naživo. | Ban platí, takže všetko proti mock shopu. Mutačný test je jediný dôkaz, ktorý máme. |
| **X1 je v zakázanej zóne a zároveň najvážnejší nález.** | Agent opíše návrh, ja rozhodnem. Ak sa nedohodneme, opravím to sám sekvenčne. |
| **Reconcile test tvrdí defekt ako správne správanie** (L3). | Zmena existujúceho tvrdenia sa musí odôvodniť proti K2 a K6, nie len prepísať. |
| **Verifikátori majú sklon potvrdzovať.** | Majú výslovne za úlohu vyvracať a hlásiť aj „táto oprava nerieši, čo tvrdí". Piaty ide proti kontraktu a proti mne. |
| **Zastaralá dokumentácia klame agentov** (P4). | Varovanie je v KAŽDOM zadaní, nie len v tíme, ktorý to opravuje. |

---

## 7. Výsledok (25. 8. 2026)

**Beh dobehol čiastočne. Z 31 agentov skončilo 20, jedenásť padlo na limite
používania.** Balík je zelený, ale kontrakt splnený nie je — a nižšie je
napísané presne čo.

```
npm run typecheck   čistý
npm run lint        čistý
npm run test        3216 prešlo / 0 padlo / 0 preskočených  (161 súborov)
```

Pred behom: 3113 v 153 súboroch. Pribudlo osem súborov a 103 testov.

### Spend

| | Tokeny |
| --- | --- |
| Tri sondy | 765 k |
| 20 dokončených agentov | 4,0 M |
| Koordinácia, zlúčenia, dve opravy zo zakázaných zón | zvyšok |
| **Strop** | **~5 M — vyčerpaný** |

Preto sa jedenásť padnutých agentov **nespúšťalo znovu**. Bolo by to nad strop
a bez tvojho slova to nerobím.

### Čo sa zlúčilo

Päť tímových vetiev, 20 commitov. Konflikt bol jeden (`_shared.ts`, aditívny —
backend pridal rezerváciu čítacieho rozpočtu, UI pomôcku pre odhad fronty;
patria tam obe).

| Tím | Zavreté |
| --- | --- |
| **logika** | L2 (percentá pásiem pri oprave zlyhaných), L3 (reconcile nechá neposlané položky `pending`), L4 (manuálny execute overí proti riadkom skôr, než siahne na stav), L5 (kampaň, ktorá padá každý tik, sa prestane opakovať) |
| **backend** | B1 (rezervácia čítacieho rozpočtu na dvoch routách, ktoré ju obchádzali — mechanizmus IP banu), B2 (executor už neťahá dva blob stĺpce), B3 (potvrdená zľava sa vkladá v jednej transakcii), B4 (nečitateľné počítadlo auditu = „nevieme", nie nula) |
| **ux** | X2 (ban má na čítacej strane slová), X3 (hlavička prestala tvrdiť prázdnu frontu, keď nevie), X4 (Prehľad prestal hlásiť „všetko v poriadku" nad stojacou frontou), X5 (dominantné číslo sa menuje „spracovaných", nie „zapísaných") |
| **ui** | U1 (odhad dobehnutia z celej fronty, nie z jednej kampane), U2 (chyby potvrdenia sa prekladajú, kým dorazia na obrazovku), U3 (prepínač, ktorý nič neriadil, je odstránený), U4 (prestala sa ponúkať akcia, ktorú invariant zakazuje) |
| **použiteľnosť** | P1 (**prvé snímky obrazoviek v histórii projektu** — a našlo sa päť, ktoré snímkovač nekreslil, plus tichá 404 vo fixtúrach a `globals.css` sa nahrával po komponentoch), P2 (pokrytie predajnosti sa priznáva tam, kde sa vyberajú produkty) |

### Dve opravy zo zakázaných zón — moje, nie agentov

| # | Commit | Čo |
| --- | --- | --- |
| **L1** | `b2b9ec4` | Predĺženie zľavy s pásmami písalo do PRODUKČNÉHO shopu všetko najvyšším percentom. Hash to nezachytil, lebo náhľad aj potvrdenie sa mýlili zhodne. Obe polovice teraz nesú mapu percent a potvrdenie si ju odvodí z DB, nie z tokenu. |
| **X1** | `fdba422` | Appka mazala funkčný kľúč, keď shop odmietol našu ADRESU — a od 19. 8. to bol jej reálny stav. Ban má odteraz vlastnú vetvu: kľúč sa nedotkne, dôvod je `shop_ip_banned`. |

Obe overené mutáciou. Agent pri L1 doložil defekt behom proti mock shopu ešte
pred opravou — vrátane toho, čo naozaj dorazilo do shopu.

### Čo kontrakt NESPLNIL

1. **Verifikácia neprebehla vôbec.** Všetkých päť verifikátorov aj šiesty, ktorý
   mal kontrolovať mňa a tento kontrakt, padli na limite. **Akceptačné
   kritérium 7 nie je splnené** a žiadny nález nemá nezávislý verdikt. Po
   skúsenosti z 25. 8., keď review našiel päť dier a dve moje nepravdivé
   tvrdenia, je to najväčšia chýbajúca vec tohto behu.
2. **Päť nálezov nezavreli agenti, ktorí na ne padli:** B5 (štvrtý komentár
   menujúci neexistujúci test, mŕtve `syncCountersFromItems`, orezané
   `queueWaiting`), U5 (Výkon výberu porovnáva okná pred zľavou), P3
   (`LockedFeatures` obviňuje eshop z dát, ktoré vracia), P4 (zastaralé
   `CLAUDE.md`, README, backlog), P5 (klávesnica a čítačka obrazovky).
3. **P3 zostal rozrobený v DVOCH worktree** (`a30-backend` a `a30-pouzitelnost`),
   s odlišnými diffami — jeden z nich v zóne, ktorá mu nepatrí. **Nezlúčil som
   ani jeden.** Práca je tam a je nezacommitovaná; treba sa rozhodnúť, ktorá
   verzia je základ.
4. **Snímkovanie pred/po (rozhodnutie 11)** sa stihlo len ako „po" — tím
   použiteľnosti najprv musel snímkovač opraviť, aby vôbec kreslil.

### Čo sa pri behu ukázalo o prostredí

- **Moja infraštruktúra bola overená nedostatočne.** Otestoval som worktree na
  `repo.spec.ts`, ktorý `argon2` neimportuje. V skutočnosti **každý integračný
  test route-ov vo worktree padne už pri importe** — `argon2.glibc.node` je
  blokovaný Windows Application Control. Agenti si to museli obísť
  `vi.mock('argon2')`. V hlavnom strome to funguje, takže plný balík (ktorý
  púšťam ja) tým zasiahnutý nie je.
- **Kontrakt najprv nebol vo worktree.** Commitol som ho do hlavnej vetvy, kým
  `feat/audit-30` ukazoval pred ním — zlúčenie do worktree bolo prázdne a agenti
  mali v zadaní čítať súbor, ktorý u nich nebol. Zachytené minútu po spustení.
- Porty 3307–3309 boli obsadené (Hades, auraai), testovacie DB idú na
  3310–3315.

### Otvorené

- Verifikačný priechod (kritérium 7).
- Päť nezavretých nálezov a rozrobený P3.
- Zlúčenie `feat/audit-30` do `feat/dokoncenie-prva-zlava` — nerobil som ho,
  je to tvoje rozhodnutie.
- Šesť worktree a šesť DB kontejnerov beží; po zlúčení sa dajú zrušiť.
- Rozhodnutie 19 (automatické potvrdenie D2) je zapísané ako vedomé; komentár
  priamo v `NewDiscount.tsx` som nepísal, ten súbor mal tím UI.


---

## 8. Dobehnutie a verifikácia (26. 8. 2026)

```
npm run typecheck   čistý
npm run lint        čistý
npm run test        3266 prešlo / 0 padlo / 0 preskočených  (165 súborov)
```

Pred behom 3113 v 153 súboroch; teraz o 153 testov a 12 súborov viac.

### Päť nálezov, ktorých agenti padli na limite — zavreté

| # | Commit | Čo |
| --- | --- | --- |
| **P4** | `92830a8` | Štyri dokumenty prestali brífovať čitateľa nepravdou: `CLAUDE.md` (deväť padajúcich testov — nepadá ani jeden), README (D20 onboarding, ktorý V3 zrušil; „0 skipped (1247)" pri 3266 testoch), backlog (žiadal šesť dodaných vecí) a `58-CO-VIEME` („MÁME" o kľúčoch, ktoré nemáme) |
| **B5** | `d6c52b6` | Napísaný strážny test, ktorý `catalog.repo.ts` o sebe tvrdil; priznaná divergencia mŕtveho `syncCountersFromItems`; orezané `queueWaiting` |
| **P3** | `7aab41f` | Appka prestala obviňovať eshop z dát, ktoré dodáva od 13. 8.; `product:read` v troch stavoch a klipboard žiada oprávnenie, nie vysvetlenie |
| **U5** | `d00e081` | „Výkon výberu" prestal vydávať dve okná pred zľavou za jej výkon |
| **P5** | `9c9d3f6` | Klávesnica, focus a čítačka — 31 testov, 21 z 21 mutácií zachytených, **prvý spec v projekte s DOM-om** |

### Verifikácia — a čo našla na mne

Tri verifikátori nad tromi oblasťami: **16 potvrdených, 7 neúplných, 2 vyvrátené.**
Oba vyvrátené boli skutočné a oba som zavrel:

| # | Commit | Čo bolo vyvrátené |
| --- | --- | --- |
| **L2** | `62721c3` | Prvá oprava brala percentá pásiem z tokenu, ale `buildPreview` ich doň vloží len pri neprázdnych `tiers` a obrazovka opravy žiadne neposielala — čítalo sa pole, ktoré tam nikdy nebolo. **Nález bol zavretý na papieri a otvorený v shope.** Percentá teraz dopĺňa server z riadkov rodiča. A tímový test prechádzal aj s vypnutou opravou, lebo si token vyrábal sám — teraz ide skutočným náhľadom. |
| **B5b** | `99c02cb` | Môj vlastný commit tvrdil, že číslo „priznáva strop". Nepriznávalo: `tick.ts` ho ďalej posielal ako `queueWaiting` a doc riadok hovoril „koľko čakalo". Lož bola v mene, tak je opravené meno — `queueTaken` s `queueWaitingCapped` vedľa. |

A jedno **neúplné**, ktoré bolo vážnejšie než vyvrátené:

| **X1** | `0794c3b` | Moja vetva pre ban bola v REÁLNOM stave nedosiahnuteľná. Skutočný ban platí aj na čítanie, takže padne povinný pre-write GET — a tá vetva robila `continue`. Appka by proti zabanovanej adrese poslala jeden GET na KAŽDÚ položku, teda 8 000 odsúdených requestov na 8 000-produktovej kampani, čo ban zhoršuje. Prvá taká odpoveď teraz zastaví celú dávku. |

### Tri moje tvrdenia, ktoré verifikácia vyvrátila

1. **`fdba422`:** „With the address blocked since 19 Aug that was not a latent
   risk, it was the app's behaviour." **Nepravda.** Pri plnom bane beh zomrel na
   pre-write GET a k wipe sa nedostal — kľúč sa teda nemazal. Nebezpečenstvo bolo
   skutočné, ale podmienené odmietnutím len na zápise. Napísal som meranie,
   ktoré som neurobil.
2. **`d6c52b6`:** „the number admits when it is a ceiling" — nepriznávalo,
   pole nemalo čitateľa. Opravené.
3. **Pri L2 som si sám vyvrátil tretie:** pridal som test na podvrhnutý token
   v domnení, že drží podanie mapy do `verify()`. Nedrží — podvrh zachytí
   `assertConfirmed()` prepočtom hashu z riadkov DB, a tá kontrola tam bola dávno.
   Podanie mapy je obrana do hĺbky, nie tá záruka. Zapísané v teste.

### Čo pritom vyšlo najavo

- **`verify()` má fail-open predvoľbu.** `percents: wanted.percents ?? claims.percents`
  (`preview-token.ts:612`) znamená, že volajúci, ktorý mapu nepodá, uverí tokenu.
  Cesta vytvorenia zľavy ten fallback používa legitímne, takže sa zaplátať naplocho
  nedá — ale je to fail-open v bezpečnostnej pomôcke a je to zapísané tam, kde to
  niekto stretne.
- **Fabrikovaný token v teste nemeria appku, meria test.** Stalo sa to pri L2
  a je to ten istý rod chyby ako test nad zdrojovým textom.
- **`tick.ts` mi vypadol zo stagingu**, hoci ho commit správa menovala (`99c02cb`
  to dopĺňa). Druhýkrát za dva dni.

### Čo zostáva otvorené

- **Sedem neúplných verdiktov** okrem X1: X2 (ban na čítacej strane zmeraný len
  čiastočne), U5 (serverová polovica bez testu; `parsePerformance` číta chýbajúce
  `started` ako „beží"), P3, P4, L3, B1. Sú to zúženia, nie diery — každý má
  v verdikte napísané, čo presne nie je kryté.
- **P5 flagol tri veci, ktoré vedome neopravil:** Enter sa v Nastaveniach chová
  dvakrát inak (zápisové cesty, je to rozhodnutie o chovaní), stránkovač je
  `<a href="#">` namiesto `<button>` (výmena je vizuálna zmena), a pod 640 px
  DOM poradie nesleduje obrazovku (mobil je mimo deklarovaného cieľa).
- **Nič nebolo overené v prehliadači ani proti ostrému shopu.** `argon2` je
  blokovaná, ban platí. Snímkovač je odteraz jediná cesta, ako obrazovky vidieť —
  a P5 ho pritom musel najprv opraviť, lebo päť obrazoviek nekreslil.
- **P5 pribral `jsdom`** ako devDependency; bez DOM-u sa focus ani Escape
  otestovať nedajú. `npm audit` hlási jednu high (`nanoid`), ktorá je
  pre-existujúca a tranzitívna.
