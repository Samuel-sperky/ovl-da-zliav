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
- Synchronizácia predajov: 90 dní pri prvom behu, potom nočné dopĺňanie.
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
   je referencia na objednávkový endpoint chyba.
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

1. `npm run typecheck`, `npm run lint` a `npm run test` sú zelené (okrem 10
   známych Windows-only zlyhaní, ktoré rieši samostatná úloha).
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
| R-2 | `rate_limited` nemá v dokumentácii `Retry-After` ani limit. | Konzervatívny throttle + exponenciálny backoff + strop na beh. Radšej pomalšie než zabanovaný kľúč. |
| R-3 | ~~Pole `total` možno nerešpektuje filtre.~~ **OVERENÉ 6.8.2026:** rešpektuje (978 vs 1 765 576). | Riziko je uzavreté. |
| R-4 | 30-dňová platnosť kľúča je odchýlka od zásady „kľúče expirujú do 48 h". | Zapísané ako P2. Kľúč je read-only, bez osobných údajov, mazateľný panic buttonom; TTL je v UI viditeľné. |
| R-5 | Zmena schémy `api_key` sa dotýka existujúcej cesty pre shop kľúč. | mysqldump do `backups/` PRED migráciou (posledné 3 zálohy). Testy existujúcej cesty musia zostať zelené bez úprav. |
| R-6 | Objednávky idú do appky zo siete — nová odchádzajúca komunikácia. | Povinná bezpečnostná prehliadka v kvalitnej bráne. |

## 8. Výsledok

*(dopĺňa sa po dokončení šprintu)*
