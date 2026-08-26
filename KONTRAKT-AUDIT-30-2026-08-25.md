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

## 7. Výsledok

*(Vypĺňa sa po dobehnutí.)*
