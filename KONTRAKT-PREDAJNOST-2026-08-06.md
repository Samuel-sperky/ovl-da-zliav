# KONTRAKT — Predajnosť produktov z objednávok (2026-08-06)

Rozšírenie appky Aura Zľavy o čítanie objednávok shopu (`orders:read`) s cieľom
navrhovať zľavy podľa toho, čo sa reálne predáva. Mení rozhodnutie 8 a invariant
I8 — preto samostatný kontrakt, ktorý je pre túto zmenu nadradený.

Zadal: Samuel (pokyn CTO použiť existujúci `orders:read` kľúč).
Stav: **čaká na schválenie plánu a odhadu.** Nič sa nestavia pred schválením.

---

## 1. Cieľ

Appka bude vedieť pre produkty v allowliste povedať, **koľko kusov sa predalo,
ako rýchlo sa predávajú a kedy sa naposledy predal** — a z toho navrhovať
kampane na to, čo sa nehýbe. Návrh zostáva návrhom: agent nikdy nezapisuje sám,
každý zápis ďalej prechádza dry-run náhľadom a potvrdením (I3 nedotknuté).

## 2. Čo sa NEDÁ a preto nie je cieľom

Pôvodná obrátkovosť `(Ø zásoba × počet dní) / COGS` sa **naďalej vypočítať nedá.**
`orders:read` dopĺňa len jeden z troch chýbajúcich vstupov:

| Vstup | Stav |
| --- | --- |
| Predaje | **rieši táto zmena** |
| COGS | shop API neposkytuje vôbec — backlog na maintainera (B-COGS) |
| Zásoba nevariantných produktov | API vracia množstvá len pri variantoch — backlog (B-STOCK) |

Karta **Obrátkovosť zostáva zamknutá** a bude ďalej priznávať, čo chýba. Nová
karta sa menuje **Predajnosť** a nikdy sa netvári, že je to obrátkovosť.
Dopočítavanie COGS z predajnej ceny je ZAKÁZANÉ (I11 — appka nepredstiera dáta).

## 3. Rozsah

### ÁNO
- Nový klient shopu pre `GET /api/order` a `GET /api/order/get` — v JEDINOM
  module, ktorý má na to povolenie.
- Synchronizácia predajov: **3 dni** pri prvom behu (P3 — okno skrátené z 90
  z bezpečnosti), potom priebežné dopĺňanie.
- Nová tabuľka so **súčtami po produktoch a dňoch** — `(id_produktu, deň, kusy)`.
- Druhý API kľúč (`orders:read`) s vlastnou platnosťou 30 dní, šifrovaný rovnako
  ako shop kľúč, vkladaný v UI, mazateľný panic buttonom.
- Karta Predajnosť + pravidlá AI agenta nad reálnymi predajmi.
- Prepis invariantu I8 na I8' vrátane testu, ktorý ho vynucuje.
- Bezpečnostná prehliadka (mení sa práca s kľúčmi a pridáva sa odchádzajúca
  komunikácia) — povinná časť kvalitnej brány.

### NIE
- Žiadne ukladanie riadkov objednávok, id objednávok ani krajiny.
- Žiadne zákaznícke údaje — nikdy, v žiadnej podobe.
- Žiadna zmena poistiek zápisu (I3, I13), stropu 10 produktov (I2) ani
  runaway limitu.
- Žiadny nový publikovaný port (I5) a žiadny tunel.
- Žiadne prepočty peňazí na produkt: `total_paid` je za celú objednávku, nie za
  položku, takže obrat na produkt sa NEDÁ priradiť. Merajú sa len KUSY.

## 4. Odsúhlasené rozhodnutia

| # | Rozhodnutie | Zdroj |
| --- | --- | --- |
| P1 | Karta = **Predajnosť** (kusy za obdobie, kusy/deň, dni od posledného predaja). Obrátkovosť zostáva zamknutá. | Samuel 6.8.2026 |
| P2 | Kľúč `orders:read` má **vlastnú platnosť 30 dní** — odchýlka od 48 h (R2/D69), odôvodnená tým, že je len na čítanie a nevidí osobné údaje. Panic button ho maže kedykoľvek. | Samuel 6.8.2026 |
| P3 | Sťahovanie: **3 dni pri prvom behu**, potom nočné dopĺňanie. Okno skrátené z 90 na 3 dni **vedome, z bezpečnosti** — jeden request na jednu objednávku znamená, že 90 dní by bolo desiatky tisíc requestov proti produkčnému eshopu. Cena za bezpečnosť je krátke okno: produkt, ktorý sa predáva raz za týždeň, bude na začiatku vyzerať ako nepredávaný. Okno sa dá neskôr rozšíriť zmenou konfigurácie, história sa dopĺňa nočne sama. | Samuel 6.8.2026 |
| P4 | Ukladajú sa **len súčty po produktoch a dňoch**. Žiadny riadok objednávky. | Samuel 6.8.2026 |
| P5 | Druhý kľúč žije v **existujúcej tabuľke `api_key` s novým stĺpcom `kind`** (`shop_write` / `orders_read`), nie v novej tabuľke — jedna cesta pre šifrovanie, TTL, audit a wipe znamená, že panic button a zákaz logovania platia na oba kľúče automaticky, bez druhej neotestovanej cesty. Reverzibilné, rozhodol Claude. | predvolené |
| P6 | Synchronizácia je **fail-soft**: keď narazí na strop requestov alebo `rate_limited`, uloží dosiahnutý pokrok, ohlási to a pokračuje ďalší beh. Nikdy neblokuje zľavy ani scheduler kampaní. | predvolené |
| P7 | Deň v minulosti sa po dokončení považuje za uzavretý (`date_add` je čas vzniku, objednávky sa do minulosti nedopĺňajú). Dnešný a včerajší deň sa prepočítavajú znova, upsert je idempotentný. | predvolené |

## 5. Invariant I8 → I8'

**Pôvodné I8:** appka nesmie volať žiadny endpoint pod `/api/order` a nesmie
ukladať nič zo zákazníckych dát. Scope výhradne `product:edit`.

**Nové I8':**
1. Appka smie volať **výhradne** `GET /api/order` a `GET /api/order/get`, a to
   **iba z jediného modulu** `src/lib/shop/orders-client.ts`. Odkiaľkoľvek inde
   je referencia na objednávkový endpoint chyba. Objednávkový REPOZITÁR
   (`ordersKeyRepo`) smú vysloviť tri menované moduly: `api-key.repo.ts`,
   `/api/key/route.ts` a `src/lib/sales/sync-runner.ts` — ten tretí existuje
   práve preto, aby kľúč nemusel byť v `scheduler/boot.ts` (bod 4).
2. Povolené scopes sú **presne dva**: `product:edit` (zápis zliav) a
   `orders:read` (čítanie predajov). Žiadny iný.
3. Do databázy sa **nikdy** nedostane riadok objednávky, id objednávky, krajina
   ani akýkoľvek zákaznícky údaj. DDL kontrola na `order`, `customer`, `email`,
   `phone`, `address`, `iban`, `payment` a spol. zostáva **v plnej sile** —
   nová tabuľka sa menuje po produktoch, nie po objednávkach.
4. Objednávkový kľúč nikdy neopustí appku smerom k zápisu: `setReduction` volá
   ďalej výhradne `src/lib/engine/executor.ts` a výhradne kľúčom `shop_write`.

Test `test/unit/no-orders-scope.spec.ts` sa prepíše tak, aby vynucoval I8'
namiesto I8 — teda povolí `orders:read` a jediný whitelistovaný modul, a všetko
ostatné zakáže ďalej. Uvoľnenie je úzke a menované, nie plošné.

## 6. Akceptačné kritériá

1. `npm run typecheck`, `npm run lint` a `npm run test` sú zelené (okrem **9**
   známych Windows-only zlyhaní v 4 súboroch, ktoré rieši samostatná úloha).
2. Test I8' padne, keď sa objednávkový endpoint zavolá mimo whitelistovaného
   modulu, keď sa pridá tretí scope, alebo keď sa do schémy dostane zákaznícky
   stĺpec. Dokázané zámerne pokazeným pokusom, nie tvrdením.
3. **Panic button maže OBA kľúče** — dokázané testom.
4. `scripts/backup.sh` neexportuje ani jeden kľúč (rozšírené `--ignore-table`) —
   dokázané kontrolou dumpu.
5. Ani jeden kľúč sa neobjaví v logu, audite, UI, chybovej hláške ani v zálohe (I1).
6. Synchronizácia dodrží strop requestov na beh, prežije `rate_limited` a pri
   prerušení pokračuje tam, kde skončila — dokázané testom proti mock shopu (I6).
7. Karta Predajnosť zobrazí pre allowlist produkty kusy, kusy/deň a dni od
   posledného predaja. Obrátkovosť zostáva zamknutá s pravdivým dôvodom.
8. V DB neexistuje žiadny riadok objednávky ani zákaznícky stĺpec (kontrola
   schémy aj obsahu).
9. Zápisy do shopu sa nezmenili: dry-run → potvrdenie → sudo okno platí ďalej.
10. Overené naživo v prehliadači po prihlásení (preklik + screenshot v reporte).

## 7. Riziká

| # | Riziko | Ako sa rieši |
| --- | --- | --- |
| R-1 | ~~Objem objednávok nie je zmeraný.~~ **ZMERANÉ 6.8.2026:** okno 3 dní = **978 objednávok**, teda ~988 requestov na prvý beh (978 detailov + 10 strán zoznamu). Shop má celkovo 1 765 576 objednávok, denný prírastok je ~326, takže nočné dopĺňanie je ~330 requestov. Pre porovnanie: pôvodných 90 dní by bolo ~29 000 requestov. | Riziko je uzavreté. Strop na beh je `ORDERS_MAX_REQUESTS_PER_RUN=1500` (pokrýva prvý beh aj rezervu), throttle 250 ms medzi requestami → prvý beh trvá ~4 minúty. |
| R-2 | ~~`rate_limited` nemá v dokumentácii `Retry-After` ani limit.~~ **NEPRAVDA, opravené pri review:** `docs/api/sperky-api.md` §Rate limiting dokumentuje oboje — **300 requestov / 60 s NA KĽÚČ** a `Retry-After` v sekundách. (Chýbalo to len v md súbore, ktorý dodal Samuel.) | Klient čaká dlhšiu z dvoch hodnôt (hlavička vs. vlastný backoff 5/20/60 s), strop 120 s. `ORDERS_PAUSE_MS` má **spodnú hranicu 250 ms** (~240/min): pri 100 ms by sekvenčný beh v najhoršom prípade dal 600/min, teda dvojnásobok limitu — limit sa tak nedá prekročiť ani konfiguráciou. |
| R-3 | ~~Pole `total` možno nerešpektuje filtre.~~ **OVERENÉ 6.8.2026:** rešpektuje (978 vs 1 765 576). | Riziko je uzavreté. |
| R-4 | 30-dňová platnosť kľúča je odchýlka od zásady „kľúče expirujú do 48 h". | Zapísané ako P2. Kľúč je read-only, bez osobných údajov, mazateľný panic buttonom; TTL je v UI viditeľné. |
| R-5 | Zmena schémy `api_key` sa dotýka existujúcej cesty pre shop kľúč. | mysqldump do `backups/` PRED migráciou (posledné 3 zálohy). Testy existujúcej cesty musia zostať zelené bez úprav. |
| R-6 | Objednávky idú do appky zo siete — nová odchádzajúca komunikácia. | Povinná bezpečnostná prehliadka v kvalitnej bráne. |

## 8. Výsledok (6. 8. 2026)

**Postavené a overené.** Branch `claude/local-eshop-discount-app-qm5fzg`.
Stav: `npm run typecheck` a `npm run lint` čisté, **866 testov prešlo** (pred
šprintom 625), 9 známych Windows-only zlyhaní v 4 súboroch nedotknutých.
Stack prestavený, `boot_ok`, migrácia 0009 aplikovaná.

Postup: 3 agenti paralelne v izolovaných worktree (klient objednávok + sync /
druhý kľúč / karta a pravidlá), integrácia hlavným agentom, potom nezávislý
review na plnom modeli s povinnou bezpečnostnou prehliadkou.

**Čo review našiel — a bez čoho by to nesmelo ísť do produkcie:**

1. **BLOKUJÚCE: neúplný beh mazal už uložený deň.** Zápis dňa je absolútny
   prepis; keď prvý list-request skončil na `rate_limited`, `units` zostala
   prázdna a `replaceDayUnits(day, [])` zmazal kusy, ktoré už boli uložené.
   Poistka kryla len dni v stave `complete`, nie `partial`. Appka by tak bola
   tichým generátorom nepravdivých núl.
2. **Tichá strata objednávok pri stránkovaní**: koniec stránkovania sa počítal
   z PÝTANÉHO `per_page`, nie z toho, ktoré vrátil shop — deň sa uzavrel ako
   `complete` s chýbajúcimi objednávkami.
3. **Po vložení kľúča sa sync nerozbehol 20 hodín**: tick bez kľúča si nasadil
   plný odstup. Teraz je pre stav „bez kľúča" vlastný 5-minútový interval.
   Overené naživo v Dockeri (16:55 → 17:01).
4. **Limit shopu sa dal prekročiť konfiguráciou**: `ORDERS_PAUSE_MS` mal
   minimum 100 ms = 600 req/min pri sekvenčnom behu, teda dvojnásobok
   dokumentovaných 300/60 s. Spodná hranica zvýšená na 250 ms.
5. **Invariant I8' sa dal oklamať dvoma cestami**, obe predvedené pred opravou:
   cesta zlepená z častí (`'/api' + '/order'`) prešla riadkovým skenom, a
   migrácia so stĺpcami `order_country`, `buyer_email` prešla DDL kontrolou,
   pretože `_` je slovný znak a `\b` nikdy nesedelo. Oboje zaplátané.
6. Karta tvrdila „história sa dopĺňa nočne", pričom beh je intervalový.

**Overené proti skutočnému shopu** (nie z dokumentácie): obal `result`,
polia zoznamu, rešpektovaný `per_page`, detail s `products[]` (`id`, `qty`),
`date_add` v tvare `YYYY-MM-DD HH:MM:SS`. Okno 3 dní = 978 objednávok,
shop celkovo 1 765 576.

**Bezpečnosť** (overené v kóde a v reálnom dumpe, nie z komentárov): kľúč ide
výhradne do hlavičky, nikdy do URL, logu, `last_error`, auditu ani odpovede;
`GET /api/key` má bajt na bajt rovnaký tvar ako pred šprintom; panic button
maže oba kľúče jedným SQL a píše audit za každý; záloha vylučuje celú tabuľku
`api_key`, v dumpe nie je ani `CREATE TABLE`, ani jeden `INSERT`; `setReduction`
má ďalej jediného volajúceho a berie výhradne zápisový kľúč.

### Odchýlky od kontraktu (schválené pri integrácii)

| # | Odchýlka | Dôvod |
| --- | --- | --- |
| O1 | Sync beží na **20-hodinovom intervale**, nie „nočne" (a 5 min, keď chýba kľúč). | Appka beží na pracovnom počítači, ktorý je v noci vypnutý — nočné okno by znamenalo, že sync neprebehne nikdy. |
| O2 | Sonda kľúča sa registruje na **module scope** `/api/key/route.ts`. | `instrumentation` má vlastný module graf a side-effect import je kandidát na odstránenie bundlerom; oboje tento projekt už spálilo. |
| O3 | Whitelist `ordersKeyRepo` má **3 moduly** namiesto 2. | `sync-runner.ts` existuje práve preto, aby kľúč nebol v zápisovej ceste. |

### Zostáva pre Samuela

1. Vložiť kľúč `orders:read` v Nastaveniach (postup: `docs/21-RUNBOOKY.md` R1s).
   Kľúč, ktorý bol počas šprintu použitý na meranie, **treba rotovať** — bol
   v plaintexte v Downloads a v prepise konverzácie.
2. Nastaviť doménu shopu a naplniť allowlist (10 product ID).
3. Akceptačné kritérium 10 (preklik v prehliadači + screenshot) **nie je
   splnené**: basic auth sa z agenta vyplniť nedá. Overené je HTTP a
   vyrenderované HTML (`/ai-agent` obsahuje kartu Predajnosť aj zamknutú
   Obrátkovosť, `/api/sales` hlási `hasData:false`).

### Otvorené body (flagnuté ako samostatné úlohy, nie súčasť tohto šprintu)

- **Redaktor, vrstva 3 nie je zapojená** (pre-existujúce): `setActiveSecretForScan`
  nemá v `src/` volajúceho, takže substring scan na skutočný kľúč je vypnutý.
- `product_sales_daily` ukladá kusy pre **všetky** produkty z objednávok, nie
  len pre allowlist — rastie celým katalógom × dni.
- `api_key.id` je `TINYINT UNSIGNED AUTO_INCREMENT` a `store()` maže + vkladá,
  takže 255 vložení bez restartu vyčerpá rozsah (po restarte sa počítadlo hojí).
- `insights.ts` počíta deň cez `toISOString()`, `sales.repo.ts` cez lokálne
  zložky. Zhodné len preto, že kontejner beží v UTC — nastavenie `TZ` na
  Europe/Bratislava by posunulo dni v `/api/sales`.
