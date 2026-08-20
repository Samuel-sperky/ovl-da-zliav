# Šprint — dokončenie vlny ikon, textu a grafov (19. 8. 2026)

Koordinuje **jeden koordinátor agent**, pracujú **traja pracovníci**.
Tento súbor je zadanie. Nič v ňom sa nemá znovu auditovať — audity už bežali
a ich výsledky sú tu zapísané.

Nadväzuje na `KONTRAKT-UX-DIZAJN-2026-08-19.md`. Vetva: `feat/dokoncenie-prva-zlava`.

---

## Stav, z ktorého sa vychádza (zmerané, neprepočítavať)

| | |
|---|---|
| Testy | 2 479 prejde; padá 5 v `crypto.spec.ts` a `boot-assertions.spec.ts` |
| Prečo tie padajú | `chmod 400` sa na Windows nedá nastaviť, súbor ostane 444. **Prostredie, nie regresia.** Neopravovať. |
| Lint, typecheck, produkčný build | čisté |
| Emoji v appke | **0**, strážené `test/unit/ikony.spec.ts` |
| Katalóg | 41 220 produktov, zrkadlo úplné od 19. 8. 00:13 |
| Dáta o predaji | **len 2 dni** (5. a 6. 8.), synchronizácia stojí od 7. 8. |
| Commity vlny | 10 |

Hotové a **nedotýkať sa toho**: paleta (0 kolízií pri farbosleposti), písmo
(`@fontsource-variable/inter`), jeden slovník stavov (`ui/blocker-look.ts`),
hľadanie na viac slov, `Icon.tsx`, tri roly popiskov na živých selektoroch.

---

## Prečo tento šprint existuje

Tri veci ostali rozrobené a každá má konkrétny dôvod, prečo je nedokončená:

1. **Rodina `.sig` stále kreslí značky cez CSS `::before`** na 27 miestach v 12
   súboroch. Kvôli tomu musela vzniknúť CSS maska pre zámok — a tým je cesta
   ikony v repe **dvakrát**, čo je jediná taká duplicita.
2. **Textu je na obrazovkách o ~22 % viac**, než treba. Audit zmeral každé
   miesto; zoznam je nižšie.
3. **Graf rozdelenia cien je hotový, otestovaný, a nič ho nekreslí** — chýba mu
   dotaz, ktorý ceny nabinuje.

---

## Pravidlá, ktoré platia pre všetkých (porušenie = práca sa vracia)

- **P3** žiadny žargón na povrchu · **P7** každý odhad označený `≈` a tlmene ·
  **P8** appka nikdy netvrdí kauzalitu. Nedotknuteľné.
- **Keď appka nevie: pomlčka, NIKDY nula.** Nula je tvrdenie.
- **Stav nikdy nie je len farba** — vždy farba + značka + slovo. Zmerané: pod
  deuteranopiou nesie rozdiel len jas, takže slovo je jediný spoľahlivý kanál.
- **Žiadne emoji.** Nikde. Používateľ to výslovne zakázal.
- Teal (`--accent`), `--brand` ani zlatá NIKDY nekódujú stav.
- **P2** max 90 znakov na povrchu mimo rozkliku · **P4** obrazovka do 1,5
  obrazovky pri 1440×900 · **P5** max 4 sekcie. Ohnutie sa zapisuje do
  `design/v3/ARCHITEKTURA.md` s dôvodom a s cenou, pri ktorej výnimka padá.
- Texty neosobne, bez oslovenia. Vždy konkrétny čas a dátum (`14. 8. 2026`,
  `12:53`), nikdy „pred 3 minútami" ani ISO.
- Slovník appky hovorí **„zľava"**, nikdy „kampaň" — to je interný názov entity.
- Appka NESMIE zobraziť nič, čo API nedáva: tržby v eurách, marža objednávky,
  náklady, storná, dobropisy, kupóny, dobierky, registrácie.
- **INVARIANT I3** — žiadny zápis bez potvrdenia. `preview_token`,
  `assertConfirmed` ani to, čo sa hashuje, sa nesmie zmeniť.
- **I6** žiadna sieť · **I5** jediný publikovaný port · **I8'** `/api/order`
  volá výhradne `src/lib/shop/orders-client.ts` · `setReduction` výhradne
  `src/lib/engine/executor.ts`.
- Žiadna nová závislosť. Žiadna migrácia DB.
- Kód anglicky, UI texty a komentáre slovensky. Výdatná hlavička súboru s tým,
  čo sa v ňom smie ticho pokaziť.

---

## Rozpočet a tvrdé stropy

- **Traja pracovníci, ani jeden štvrtý.** Koordinátor nesmie spustiť ďalšieho
  agenta na „ešte jednu vec".
- **Žiadne nové audity, prieskumy ani porovnávania knižníc.** Všetko potrebné
  je v tomto súbore.
- Pracovník, ktorý na tú istú chybu spadne **trikrát**, prestane a nahlási to.
- Nikto nespúšťa `npm test`, `npx playwright test` ani `npm run build` —
  zdieľa sa jedna testovacia MariaDB a rozbili by si beh navzájom. Celý balík
  spustí koordinátor **raz na konci**.
- Overovanie pracovníka: `npx tsc --noEmit --incremental false`, vlastné spec
  súbory jednotlivo, a **povinne** `npx vitest run test/unit/paleta.spec.ts
  test/unit/typografia.spec.ts test/unit/ikony.spec.ts`.
- Necommituje nikto okrem koordinátora.

---

## W1 — značky z CSS do komponentu

**Cieľ.** Rodina `.sig` (a `.state`, `.flag`) prestane kresliť značky cez
`::before` a začne kresliť `<Icon>`. Tým padne aj CSS maska zámku a cesta ikony
bude v repe raz.

**Kde to je.** `sigClass` / `toneSigClass` a literály `'sig ok'`, `'sig bad'`,
`'sig idle'`, `'sig lock'`, `'sig progress'`, `'flag'`, `'flag neutral'` —
27 výskytov v: `campaigns/BlockerList.tsx`, `campaigns/DiscountDetail.tsx`,
`dashboard/BlockersSection.tsx`, `dashboard/CampaignsSection.tsx`,
`dashboard/StatusSection.tsx`, `dashboard/live-status-model.ts`,
`settings/ApiKeyForm.tsx`, `settings/DomainForm.tsx`, `settings/OrdersKeyForm.tsx`,
`settings/ScopeModeForm.tsx`, `settings/UnlockWritesForm.tsx`,
`ui/blocker-look.ts`.

CSS pravidlá na zrušenie: `globals.css` riadky s `content:` pre `.state.*`
(`○ ◆ ● ·`), `.flag::before` (`▲`), `.flag.neutral::before` (`·`), `.sig.*`
(`✓ ▲ ✕ ◆ ○`) a **celá maska `.sig.lock::before`**.

**Čo NECHAŤ tak.** `▸`/`▾` v `<details>` (natívna sémantika `open` funguje),
`✓`/`–` v natívnom checkboxe, `·` ako oddeľovač, `×` v „3×" (je to krát, nie
ikona), `≈` a `—` (typografické znaky — ikona „minus" by z „nevieme" spravila
nulu).

**Prístupnosť.** Ikona je predvolene `aria-hidden="true"` a slovo je v tom istom
DOM uzle. `role="img"` s slovenským `aria-label` len tam, kde je ikona jediným
nositeľom významu. V tlačidle bez viditeľného textu nesie meno `aria-label`
tlačidla, nikdy oboje. Na `<th>` triedenia doplniť `aria-sort`.

**Vlastní:** `src/components/ui/**`, `src/app/globals.css`,
`campaigns/zlavy.module.css`, `dashboard/overview.module.css`, a **markup**
dvanástich súborov vyššie. **Nesmie meniť slovenské texty** — tie patria W2.

**Hotové, keď:** `test/unit/ikony.spec.ts` prejde a spadne pri mutácii (vráť
jeden glyf a ukáž to), cesta ikony zámku je v repe **raz**, a `grep` na
`content: '` v `globals.css` nenájde ani jednu stavovú značku.

---

## W2 — text: o ~22 % menej, bez straty pravdivosti

Audit zmeral, koľko textu je na povrchu a čo sa dá odstrániť. **Poradie podľa
toho, koľko ubudne** — rob zhora.

| # | Čo | Kde | Ubudne |
|---|---|---|---|
| 1 | Štyri odstavce pod rozklik (P6): sú to dôvody a technika | `settings/WritesSection.tsx:212–218`, `settings/BudgetSection.tsx:101–106, 125–129, 148–152` | **~137 slov** |
| 2 | Zmazať `lead` z podstránky — používateľ ju práve prečítal na karte, na ktorú klikol, a `h1` ju opakuje tretí raz | `settings/SettingsSubPage.tsx:151` | **~56 slov** |
| 3 | Zmazať jantárovú `Note` — tri veľké čísla pod ňou sú tá istá veta | `campaigns/ScopeRelease.tsx:59–64` | **~20 slov** |
| 4 | Tretí riadok dlaždice sa nekreslí, keď je hodnota 0 alebo „hotovo" (vzor už existuje: `products/CatalogTiles.tsx:70–75`) | `campaigns/DiscountDetail.tsx:467, 481, 497, 513` | ~16 slov |
| 5 | Vetva `selected === null`: na Prehľade neexistuje výber, tak o ňom nehovor | `lib/status/blockers.ts:722, 724` | ~26 slov |
| 6 | Skrátiť na dve vety pod 90 znakov | `settings/ScopeModeForm.tsx:100–105` | ~21 slov |
| 7 | „Zamknuté — Na jednu zľavu prejde najviac 10 produktov." | `BlockerNotes` na Produktoch | ~19 slov |
| 8 | „Štyri otázky, štyri stránky. Nič sa tu nezapisuje do eshopu." | `settings/SettingsIndex.tsx:97–100` | ~17 slov |
| 9 | Hlavička POLOŽKY → len „21 položiek". **Dnes tam sú štyri dlaždice napísané slovami** — D15 sa len presunul o sekciu nižšie | `campaigns/DiscountDetail.tsx:672–675` | ~8 slov |
| 10 | „Zapnúť ich môže len správca počítača v konfigurácii appky." — druhá polovica je dôsledok prvej | `lib/status/blockers.ts:485` | ~5 slov **× 5 obrazoviek** |
| 11 | „Tržby — shop ich cez API nevracia." / „Rovnaké obdobie vlani — dáta zatiaľ tak ďaleko nesiahajú." | `campaigns/DiscountPerformance.tsx:130–140` | ~13 slov |
| 12 | „Rozpočet sa delí medzi všetky zľavy vo fronte." (prvá veta je meter vedľa, slovami) | `campaigns/DiscountDetail.tsx:573–577` | ~6 slov |
| 13 | Nechať prvú vetu, druhú hovorí pätka na každej obrazovke | `campaigns/DiscountDetail.tsx:731–733` | ~10 slov |
| 14 | Zmazať „Voľných zápisov dnes 200" — je to stavový pruh druhýkrát | `dashboard/StatusSection.tsx:258–263` | 4 slová |
| 15 | Zmazať „appka si vypýta ďalšiu stránku pri najbližšom kole" | `products/catalog-status.ts:458` | 8 slov |
| 16 | Zmazať „Appka vidí len to, čo sama zapísala." — nadpis skupiny to hovorí | `products/CatalogFilters.tsx:360` | 7 slov |
| 17 | Zmazať „z 41 220 načítaných", keď sa rovná číslu vedľa | `products/CatalogPanel.tsx:615` | 3 slová |
| 18 | „00:00 – 23:59, čas shopu." (zachovať, že koniec je vrátane) | `campaigns/NewDiscount.tsx:994` | 7 slov |
| 19 | „Dopad na maržu — zamknuté". **Návrat ku kontraktu**: rozširovať vysvetlenia o chýbajúcich dátach mimo `LockedFeatures.tsx` je zakázané | `campaigns/NewDiscountConfirm.tsx:218` | 4 slová |

**Slovník, dátumy a čas** — v tej istej dávke:

- `src/lib/ai/rules.ts:243` (a 297, 314–315, 343) má **tri porušenia v jednej
  vete**: interný pojem „Kampaň", ISO dátum `2026-08-26` a relatívny čas
  „o 7 dní". Má znieť: `„Ležiaky — 10 %" končí 26. 8. Nenadväzuje žiadna ďalšia zľava.`
- **Dva formátovače dátumu** vedľa seba: `lib/ui/vocabulary.ts:100–105`
  `dayMonthSk` → `14. 8.` a `lib/ui/format.ts:9–20` `formatDateSk` → `14.08.2026`.
  Kontrakt UI bod 10 predpisuje `14. 8. 2026`. Zjednotiť na jeden.
- **Riadok „Dáta k" má tri tvary** (`products/CatalogPanel.tsx:127–143`,
  `campaigns/NewDiscount.tsx:869–872`, `campaigns/DiscountDetail.tsx:598–599`,
  `dashboard/SalesSection.tsx:154–157`) a podľa `ARCHITEKTURA.md` §0 má byť na
  troch miestach, nie štyroch. Zjednotiť tvar, na Novej zľave zrušiť.
- **Prázdne stavy sú v troch tvaroch.** `ui/EmptyState.tsx:19–22` hlása, že
  `description` je POVINNÝ, kontrakt UI bod 11 hlása „jedna veta + jedno
  tlačidlo". Rozhodni v prospech kontraktu a zjednoť; `products/catalog-status.ts:621`
  má dnes **234 znakov v `<p>`** prázdneho stavu.
- **`set-grp`** (nadpis skupiny, `settings/styles.ts:31–33`) je tlmenejší
  (`--dim`) než `.sec-h h2` pod ním (`--ink2`) — nadradený popisok je slabší než
  podradený.

**ČO NECHAŤ — a prečo** (zmazanie = appka prestane byť pravdivá):

| Text | Prečo |
|---|---|
| „Zápisy do shopu sú vypnuté — appka teraz nezapíše ani jeden produkt, **nech je vo výbere čokoľvek**." | Bez poslednej časti používateľ zúži výber a stlačí Zaradiť znova. 96 znakov je 6 nad limitom — nechať a zapísať výnimku. |
| „Skúška nič nezapíše — prepočíta výber a ukáže, čo by sa stalo." | Inak je to tlačidlo neznámeho účinku nad ostrým eshopom (I3). |
| „Najprv spustite skúšku naprázdno pre tento výber." | Je to dôvod vypnutého tlačidla. |
| „Orientačný prepočet, zaokrúhlenie shopu sa môže líšiť" | Bez nej sa stĺpec NOVÁ CENA stane tvrdením o cene v eshope (P7, K8). |
| „Zmena rozsahu nezapíše ani nezruší nič." | Prepínač chránený heslom vedľa 41 220 produktov by inak vyzeral, že niečo zapíše. |
| Štyri dlaždice fronty vrátane „Nevieme, či sa zapísalo" | Kontrakt UI bod 22. Zliatie s „Nepodarilo sa" by bolo klamstvo. |
| Štyri dlaždice katalógu vrátane dvoch pomlčiek | Bod 16. Z chýbajúcej dlaždice sa nedá zistiť, že tá otázka existuje. |
| Skupina „ZATIAĽ NEDOSTUPNÉ" so 7 sivými riadkami | Bod 18. Skryté filtre = používateľ nevie, že tá schopnosť existuje. |
| Slovo pri každej značke | „Stav nikdy nie je len farba". **Nikdy nenahrádzať ikonou bez slova.** |

**Nesťahovať pod 90 znakov:** `lib/shop/messages.sk.ts`,
`lib/domain/campaign-rules.ts`, `lib/domain/status.ts`. Sú to hlášky odmietnutých
zápisov do ostrého eshopu; P2 mieri na vysvetľujúce odstavce, nie na vetu, ktorá
povie, prečo sa produkt nezlacnil.

**Vlastní:** slovenské texty v `lib/status/blockers.ts`, `lib/ui/vocabulary.ts`,
`lib/ui/format.ts`, `lib/ai/rules.ts`, `components/settings/**`,
`components/ui/EmptyState.tsx`, a textové reťazce v súboroch z tabuľky.
**Nesmie meniť markup ani triedy** — tie patria W1.

**Hotové, keď:** každé prekročenie 90 znakov z tabuľky je vyriešené alebo má
zapísanú výnimku, existuje **jeden** formátovač dátumu, `rules.ts` neobsahuje
ISO dátum ani „kampaň", a nový test stráži, že sa ISO dátum na povrch nevráti.

---

## W3 — graf rozdelenia cien

**Cieľ.** Zapojiť hotový a otestovaný `charts/PriceHistogram.tsx`, ktorý dnes
nič nekreslí. Odpovedá na otázku: *„dáva výber ležiakov na zľavu zmysel, alebo
sú v tom cenovom pásme skoro všetky produkty?"*

**Chýba:**
1. Agregačný dotaz nad `catalog_cache` (`price`, DECIMAL(10,2), rozsah
   0,00–1 758,46 €, priemer 43,23 €) v `lib/repo/catalog.repo.ts` — pozri, ako
   je napísaný existujúci `counts()`. Žiadna migrácia.
2. Miesto na Produktoch. **MUSÍ ísť pod rozklik** (`<details>`), inak pribudne
   piata sekcia a padne P5; technika pod rozklikom je P6.

**Pravidlá grafu:** farby výhradne zo sekvenčnej rampy `--seq-teal-1..5`
(monotónna vo svetlosti), **nikdy** zo stavovej škály `--st-*`. Žiadna druhá os
y. Text nosí textové tokeny (`--ink/--ink2/--dim`), nie farbu série. Ku grafu
patrí dátová tabuľka — vzor je `charts/ChartTable.tsx`, už sa používa pri grafe
predaja. Graf musí priznať, že zrkadlo nemusí byť úplné (`catalog.complete`).

**Vlastní:** `lib/repo/catalog.repo.ts`, `components/charts/**`,
`app/api/catalog/**`, `products/CatalogPanel.tsx`.

**Hotové, keď:** graf sa kreslí, `test/unit/grafy-ceny.spec.ts` a
`grafy-paleta.spec.ts` prejdú, a z hlavičky `PriceHistogram.tsx` je odstránený
blok „TENTO GRAF ZATIAĽ ŽIADNA OBRAZOVKA NEKRESLÍ".

---

## Poradie a konflikty

```
W1 (značky)  ─┐
              ├─ paralelne, disjunktné súbory
W3 (graf)    ─┘
                    ↓  W1 skončí
              W2 (text) — beží NAD usadeným markupom
                    ↓
              koordinátor: integrácia
```

**W2 beží až po W1.** Oba by inak siahli na tie isté súbory — W1 na markup,
W2 na texty v ňom — a prepisovali by si prácu. `CatalogPanel.tsx` je v zozname
W3 aj W2: patrí **W3**, a W2 mu svoju zmenu (bod 17) pošle ako požiadavku.

Pracovník, ktorý potrebuje zmenu v cudzom súbore, ju **NEROBÍ** — napíše ju do
záverečnej správy ako presný návrh pre koordinátora.

---

## Čo robí koordinátor na konci

1. Prečíta si diffy, nie len hlásenia. Pri poslednej vlne to odhalilo, že sa
   opravoval mŕtvy kód a že testy merali „Načítavam…" namiesto dát.
2. Vybaví požiadavky na cudzie súbory z troch správ.
3. `npm test` · `npx eslint .` · `npx tsc --noEmit` · `npm run build` — **raz**.
   Päť zlyhaní v `crypto` a `boot-assertions` je prostredie, nie regresia.
4. `npx playwright test test/e2e/snimky.spec.ts` — snímky proti reálnym
   41 220 produktom.
5. Doplní `design/v3/ARCHITEKTURA.md` (nové výnimky s cenou, pri ktorej padnú),
   sekciu **Výsledok** v `KONTRAKT-UX-DIZAJN-2026-08-19.md` a `README.md`.
6. Commituje po logických celkoch, správy anglicky. Push **nikdy** na main.

---

## Čo do tohto šprintu NEPATRÍ

- Synchronizácia predaja, ktorá stojí od 7. 8. — má vlastnú úlohu.
- Ľavý sidebar (kontrakt ho zamietol), mobil, automatické obnovovanie čísel.
- Akýkoľvek nový vyhľadávací engine — rozhodnuté a zdôvodnené v hlavičke
  `catalog.repo.ts`.
- Nová knižnica ikon — rozhodnuté v hlavičke `Icon.tsx`.
- Zapnutie ostrých zápisov. `WRITES_ENABLED` zostáva `false`.

---

## Výsledok

*(dopĺňa koordinátor)*
