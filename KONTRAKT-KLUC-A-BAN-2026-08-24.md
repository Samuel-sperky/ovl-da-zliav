# KONTRAKT — Nový kľúč, ban na IP a dotiahnutie rozrobeného (24. 8. 2026)

**Stav:** návrh, čaká na schválenie plánu a stropu spendu
**Vetva:** `feat/kluc-a-ban`
**Nadradené dokumenty:** `docs/10-KONTRAKT.md` (invarianty I1–I14),
`docs/50-KONTRAKT-V3.md` (K1–K12). Tento kontrakt ich **nemení** — kde sa ich
dotýka, je to napísané v bode a v sekcii Riziká.

> **PRAVIDLO Z SPRINTU 20 PLATÍ ĎALEJ.** Tvrdenie o stave kódu staršie než
> jeden commit je domnienka, nie fakt. Každý bod si pracovník najprv overí
> v aktuálnom kóde; ak už je hotový, bod sa zruší a dôvod sa zapíše.

> **V REPE PRÁVE TERAZ PRACUJE INÁ SESSION.** Koordinátor Sprintu 20 sa ozval
> 24. 8. počas prípravy tohto kontraktu: má rozbehnutých osem agentov a práve
> zapísal 13 commitov. Podmienky spolupráce sú v sekcii 0 a sú **nadradené
> plánu vĺn** — šprint sa nesmie rozbehnúť, kým sa strom nevyčistí.

---

## 0. Koordinácia s bežiacim Sprintom 20

Nezacommitovaná práca v strome (`src/lib/status/blockers.ts`, `package.json`,
`.gitignore`) **nie je pozostatok** — je to rozrobená práca agentov druhej
session. Preto:

- **Šprint sa nezačne, kým je strom cudzí.** Podmienka štartu: strom je čistý
  alebo cudzia práca je zacommitovaná a druhá session potvrdí, že skončila.
- **Vyhradené súbory, do ktorých tento šprint nesiahne**, kým to druhá session
  nepustí: `src/app/globals.css`, `src/components/campaigns/**`,
  `src/components/products/**`, `src/components/dashboard/**`,
  `src/components/settings/**`, `src/components/ui/Icon.tsx`.
  **Kolízia:** bod A potrebuje `src/components/settings/KeysSection.tsx` a bod
  E4 potrebuje `overview.module.css`. Obe sú vo vyhradenej zóne, takže UI časť
  bodov A a E4 ide **až po** uvolnení, alebo sa z tohto šprintu vypadne.
- **Bod C je ich rozrobená práca, nie naša.** Skrátenie fail-closed viet na 90
  znakov (P2) robia ich agenti a padajúci `status-snapshot.spec.ts` je jeho
  vedľajší účinok. Nahlásené im 24. 8. Ak to zavrú skôr, **bod C sa z rozsahu
  vyhodí** a dôvod sa zapíše.
- **Nikdy `git add -A`.** Commituje sa výhradne menovaný súbor.
- Body B, D, F a E1–E3 s ich zónou nekolidujú a sú spustiteľné aj tak.

---

## 1. Prečo tento šprint

Používateľ dostal 24. 8. nový API kľúč shopu a chcel ho vložiť do appky.
**Vložiť sa nedá** a appka o tom hovorí nepravdu.

Zmerané 24. 8. 2026 15:20 UTC:

```
GET https://sperky-eshop.sk/api/whoami   →  403  {"error":"ip_banned"}
GET https://sperky-eshop.sk/api/products?limit=1  (bez kľúča)  →  403  {"error":"ip_banned"}
```

Ban je **na IP, nie na kľúči** — dostane ho aj volanie bez kľúča na verejný
endpoint. Odpoveď neobsahuje `Retry-After` ani `unlock_in_minutes`, takže to
nie je desaťminútový rate-limit ban, ale administratívne zablokovanie adresy.
Ďalšie sondy sa **neposielajú** — appka sama skúša raz za deň (`stop-policy.ts`).

Čo z toho plynie pre cestu kľúča: `PUT /api/key` kľúč najprv overí a bez
overenia neuloží nič ([`src/app/api/key/route.ts:567`](src/app/api/key/route.ts)).
403 sa klasifikuje výhradne podľa stavového kódu
([`src/lib/shop/errors.ts:284`](src/lib/shop/errors.ts)) — telo `ip_banned`
nikto nečíta. Používateľ teda pri vkladaní nového kľúča dostane:

> „Shop tento kľúč zablokoval (403) — kľúč sa NEULOŽIL. Over si u správcu
> shopu, či je kľúč ešte platný.“

To je nepravda. Kľúč môže byť v poriadku; k shopu sa nedostaneme. `ip_banned`
appka rozoznáva **výhradne** na ceste čítania predajov (`sales/stop-policy.ts`,
blocker `sales_reads_ip_banned`); cesta kľúča ani cesta zápisu o ňom nevedia.

### Stav appky pri zadaní (zmerané, nie odhad)

| Čo | Stav |
| --- | --- |
| Kontejnery | `ovl-zliav-app` healthy 8 h, `ovl-zliav-db` healthy, caddy beží, `:3070` → 401 (basic auth, správne) |
| `npm run typecheck` | čistý |
| `npm run test` | **6 padá** / 2834 prechádza / **0 preskočených** (140 súborov) |
| Kľúče v `api_key` | len `orders_read`, `verify_status = unverified`, platí do 6. 9. 2026 |
| Zápisový kľúč | **neexistuje** — fronta zliav dnes nemá čím zapisovať |
| Rozsah | `scope_mode = plny`, `max_products_per_campaign = 10 000`, `daily_write_budget = 200` |
| Zrkadlo katalógu | 41 220 produktov |
| Čítanie predajov | posledné úspešné 6. 8. (270 požiadaviek, 267 objednávok); od 7. 8. `forbidden`, od 19. 8. `ip_banned`; celkom 585 požiadaviek na `/api/order` za celý život appky |

Z tých šiestich padajúcich testov je **päť artefakt Windowsu**: `chmod 400` na
NTFS vyjde ako 444, takže boot assertion na práva k `master.key` padá lokálne,
nie v kontejneri. Šiesty visí na **rozrobenej práci druhej session**
v `src/lib/status/blockers.ts` — veta pri `catalog_incomplete` prišla o odhad
(`test/unit/status-snapshot.spec.ts` čaká „približne 2 dni“, dostane
„Načítaných je 12 000 z 40 483 produktov — 28 483 sa zatiaľ vybrať nedá.“).
Viď sekciu 0.

---

## 2. Cieľ

Po tomto šprinte platí:

1. appka o `ip_banned` hovorí pravdu na každej ceste, kde ho môže dostať, a
   nový kľúč sa dá uložiť aj počas banu — priznaný ako neoverený,
2. testovací balík je zelený aj na Windows hostovi, takže pravidlo „pred každým
   commitom zelený balík“ sa dá dodržať,
3. rozrobené `blockers.ts` je dotiahnuté a otvorené body zo Sprintu 20 sú
   zavreté,
4. appka sa spúšťa z ikony ako desktopová appka, nie z prehliadača.

---

## 3. Rozsah — čo ÁNO

### A. Pravda o `ip_banned` na ceste kľúča a zápisu

- Do klasifikácie chýb shopu pribudne rozlíšenie **`ip_banned` vs. `forbidden`**
  z tela odpovede. Dnes obe skončia ako `forbidden` podľa stavu 403.
  `ip_banned` je stav **nášho prístupu**, nie výrok o kľúči — a tento rozdiel
  musí prežiť až na obrazovku.
- `PUT /api/key`: pri `ip_banned` sa kľúč **uloží** so `verify_status = unverified`
  a hláška povie pravdu — že sa overiť nedal a prečo. Pri 401 a pri skutočnom
  403 na scope sa nemení nič: kľúč sa neuloží (tam shop naozaj hovorí o kľúči).
- Nový blocker pre stav „náš prístup k shopu je zablokovaný“, ktorý platí pre
  celú appku, nie len pre čítanie predajov. Existujúci `sales_reads_ip_banned`
  zostáva ako podrobnosť tej jednej cesty.
- Zápisy počas neovereného kľúča **stoja**. Fail-closed sa neoslabuje: fronta
  čaká, nič sa nestratí, a dôvod je na obrazovke.
- Veta o neoverenom kľúči v `KeysSection.tsx` musí byť rozoznateľná od
  „kľúč chýba“ aj od „kľúč platí“.

### B. Jeden kľúč s oboma oprávneniami — appka to prizná

- Po `whoami` appka pozná scopes. Keď jeden kľúč pokrýva `product:edit` aj
  `orders:read`, na obrazovke to stojí jednou vetou, namiesto dvoch riadkov,
  ktoré vyzerajú ako dva rôzne kľúče.
- **Dva sloty v DB zostávajú.** Kľúč sa uloží dvakrát, každý slot si drží svoje
  TTL (48 h zápis, 30 dní objednávky) a objednávkový kľúč zostáva mimo zápisovej
  cesty. Inak by sa porušil invariant I8' a TTL by prestalo byť naviazané na
  druh kľúča. Mení sa **výrok appky**, nie jej schéma.
- Onboarding a Nastavenia po vložení prvého kľúča navrhnú vloženie do druhého
  slotu, keď scopes ukážu, že ten istý kľúč naň má právo.

### C. Dotiahnutie rozrobeného `blockers.ts`

- Veta pri `catalog_incomplete` dostane odhad späť. **Rozhodnutie:** hovorí
  **konkrétny deň**, nie „približne 2 dni“ — rovnako ako `write_budget_low` po
  zmene z 24. 8. a rovnako ako dlaždice fronty. Dva rôzne tvary odhadu na tej
  istej obrazovke boli presne to, čo tá zmena riešila.
- `test/unit/status-snapshot.spec.ts` sa upraví na nové tvrdenie a `9`
  susedných tvrdení „jeden odhad, nie dva“ zostane v platnosti.
- Nezacommitovaná práca sa **dokončí, nezahodí** — komentár v `blockers.ts`
  o rozhodnutí z 24. 8. je jej súčasťou a zostáva.

### D. Zelený balík na Windows hostovi

- Kontrola práv na súboroch s tajomstvami dnes na NTFS padá: `chmod 400` vyjde
  ako 444, lebo Node na Windowse právo čítania pre group/other neodoberie.
- **Rozhodnutie:** kontrola zostáva prísna v produkcii a **na `process.platform
  === 'win32'` mimo produkcie** akceptuje 444 s varovaním. Invariant I14 sa
  neoslabuje — v kontejneri (Linux) platí 400 ako doteraz a vynucuje to ten istý
  kód.
- Nová veta v `README.md` → Príkazy: čo presne sa na Windowse toleruje a prečo.

### E. Otvorené body zo Sprintu 20

| # | Čo |
| --- | --- |
| E1 | `queueProgress()` berie nečitateľnú odpoveď rovnako ako prázdne pole — rozlíšiť „nič vo fronte“ od „nevieme“ |
| E2 | Keď `detailsFor()` hodí, `catch` nechá `pending` nedotknuté a nečitateľné zrkadlo vedie k zakladaniu riadkov. **Nový `outcome` a zmena kontraktu odpovede** — vedomé rozhodnutie, preto je v tomto kontrakte, nie v oprave mimochodom |
| E3 | `SalesSyncDay.ordersSeen` sprísniť z voliteľného na povinné |
| E4 | Zosúladiť `overview.module.css` — `.queueOf` je mŕtva |

### F. Desktopový obal (Tauri) nad bežiacim Dockerom

- Tauri okno, ktoré zobrazí `http://127.0.0.1:3070`, s ikonou v Starte. Appka
  sa spúšťa kliknutím, nie písaním URL do prehliadača.
- Backend, DB, Caddy a basic auth zostávajú **nedotknuté** v Dockeri.
  Invariant I5 sa nemení: publikovaný port zostáva jediný a jeho vlastníkom
  zostáva Caddy. Tauri je klient, nie server.
- Obal skontroluje pri štarte `GET /api/health` a keď appka nebeží, povie to
  jednou vetou a ponúkne, čo spustiť — nie prázdne biele okno.
- Zdroje v `desktop/`, mimo `src/`. Build nie je súčasťou `npm run build`.

### G. Žiadosť správcovi shopu — HOTOVÉ

`docs/60-ZIADOST-ODBLOKOVANIE-IP-2026-08-24.md` — návrh e-mailu s odblokovaním
IP a doplnením `orders:read`, s reálnymi číslami z `sales_sync_state`.
Odosiela používateľ.

---

## 4. Rozsah — čo NIE

| Čo | Prečo nie |
| --- | --- |
| Celá appka do Tauri bez Dockeru | Prepis distribúcie: Next.js standalone a MariaDB mimo kontejnera (alebo prechod na SQLite), dotyk s I5, I14, D98, `secrets/` a celým runbookom R1. Samostatný šprint. |
| Overenie nového kľúča naživo | Nedá sa, kým platí ban. Šprint pripraví cestu, overenie príde po odblokovaní. |
| Obchádzanie banu (proxy, iná IP, VPN) | Dokumentácia API to zakazuje a hrozí za to trvalý ban. Legitímna cesta je žiadosť. |
| Playwright e2e | `argon2` je blokovaná Windows Application Control, appka lokálne nenaštartuje. Musí to povoliť používateľ — obísť sa to nesmie. |
| Požiadavky B1–B8 na shop | Nie sú na nás. Žijú v `docs/20-BACKLOG-SHOP-API.md`. |
| Zmena schémy `api_key` | Bod B je vedome navrhnutý tak, aby ju nepotreboval. |
| Odomknutie zamknutých filtrov (Kategória, Kov, Typ, Marža, Obrátkovosť) | Čakajú na dáta zo shopu (B5, B6, B8), nie na kód. |

---

## 5. Odsúhlasené rozhodnutia

| # | Rozhodnutie | Kto |
| --- | --- | --- |
| R-1 | Kľúč sa pri `ip_banned` uloží ako `unverified`. Pri 401 a pri 403 na scope sa neuloží nič. | používateľ, 24. 8. |
| R-2 | Appka prizná, že jeden kľúč pokrýva oba účely. Dva sloty v DB zostávajú, mení sa výrok, nie schéma (I8' nedotknutý). | používateľ, 24. 8. + návrh Claude |
| R-3 | Žiadosť správcovi shopu je `.md` v repe, odosiela ju používateľ sám. | používateľ, 24. 8. |
| R-4 | Tauri je len desktopový obal nad bežiacim Dockerom. | používateľ, 24. 8. |
| R-5 | Odhad pri `catalog_incomplete` hovorí konkrétny deň, nie počet dní. | predvolené, dá sa zmeniť |
| R-6 | Kontrola práv toleruje 444 na `win32` mimo produkcie; v kontejneri platí 400. | predvolené, dá sa zmeniť |
| R-7 | Ďalšie sondy proti shopu sa počas banu neposielajú. Appka si vystačí s jednou požiadavkou denne. | Claude, 24. 8. |

---

## 6. Akceptačné kritériá

Šprint je hotový, keď platí **všetko**:

1. `npm run typecheck` čistý, `npm run lint` čistý.
2. `npm run test` **zelený na Windows hostovi**, `0 failed` a **`0 skipped`**.
   Preskočený test sa počíta ako padajúci.
3. Test dokazuje, že 403 s telom `ip_banned` a 403 bez neho vedú na **dve rôzne
   hlášky**, a to nad **správaním**, nie nad zdrojovým textom. Test, ktorý hľadá
   reťazec v kóde, sa nepočíta — to je poučenie zo Sprintu 20.
4. Test dokazuje, že pri `ip_banned` sa kľúč uloží ako `unverified`, a že pri
   401 aj pri 403 na scope sa neuloží nič.
5. Test dokazuje, že počas neovereného kľúča fronta nezapisuje.
6. Žiadna hláška o `ip_banned` neobviňuje kľúč.
7. `test/unit/status-snapshot.spec.ts` prechádza a veta pri `catalog_incomplete`
   obsahuje konkrétny deň.
8. E1–E4 zavreté, každé s testom nad správaním.
9. Tauri obal sa spustí, zobrazí appku, a pri zastavenom Dockeri povie prečo.
   Screenshot oboch stavov v reporte.
10. Preklik v prehliadači: Nastavenia → Kľúče v troch stavoch (kľúč chýba /
    uložený neoverený / uložený a platný). Screenshoty v reporte. Stav „platný“
    sa dá ukázať len proti mock shopu — ostrý shop je zabanovaný.
11. Review agent (`effort: high`) prešiel celý diff proti tomuto kontraktu.
    Keďže sa šprint dotýka cesty API kľúča, review **povinne obsahuje security
    prehliadku**: kľúč sa nesmie dostať do logu, auditu, hlášky ani do UI (I1).
12. `README.md`, `CLAUDE.md` a sekcia „Výsledok“ v tomto kontrakte aktualizované.

---

## 7. Otvorené riziká

| Riziko | Čo s ním |
| --- | --- |
| **Ban nemusí padnúť.** Celý bod A je príprava na stav, ktorý nevieme odskúšať proti ostrému shopu. | Testy idú proti mock shopu (I6), ktorý `ip_banned` bude vedieť vrátiť. Overenie naživo je až po odblokovaní a je mimo tohto šprintu. |
| **Tauri potrebuje Rust toolchain.** `argon2` už je na tomto PC blokovaná Windows Application Control; niet dôvodu myslieť si, že `rustc` alebo `cargo` prejdú. | Toto sa overuje **ako prvé, v nulovej vlne**. Keď toolchain neprejde, bod F sa zastaví, ostatné body bežia ďalej a v reporte je napísané, čo treba povoliť. Obchádzať App Control sa nesmie. |
| **Uloženie neovereného kľúča je oslabenie fail-closed.** Dnes appka neuloží nič, po zmene uloží kľúč, ktorý nikto neoveril. | Výnimka je úzka (výhradne `ip_banned`), zápisy počas nej stoja a stav je priznaný na obrazovke. Keby sa `ip_banned` niekedy začalo vracať aj pri neplatnom kľúči, appka by ho uložila — preto to musí strážiť test nad správaním, nie dôvera v shop. |
| **Bod E2 mení kontrakt odpovede** (`detailsFor()` a nový `outcome`). | Vedomá zmena, preto je v kontrakte. Kompatibilitu s klientom v `src/components` overí test; nevratné to nie je. |
| **Zmena kontroly práv sa môže rozísť s kontejnerom.** Výnimka pre `win32` je vetva, ktorá v CI (Linux) nikdy nebeží. | Testuje sa **oboje** — vetva pre `win32` aj pre Linux, s vynúteným `process.platform`. |
| **`whoami` volanie počas banu skončí 403.** Bod B stojí na scopes, ktoré appka počas banu nedostane. | `scopes: null` už dnes znamená „nevieme“ a appka to priznáva. Bod B smie hovoriť len vtedy, keď scopes naozaj pozná — mlčanie je správna odpoveď, domnienka nie. |

---

## 8. Plán vĺn a odhad spendu

**Veľkosť: M** — odhad **250–400k tokenov**, 6 pracovníkov v 4 vlnách, ~2–3 h.

| Vlna | Čo | Kto | Model / effort |
| --- | --- | --- | --- |
| **−1** | **Brána:** strom je čistý / druhá session skončila (sekcia 0). Kým nie, šprint nezačína. | main loop | — |
| **0** | Overiť Rust toolchain (`rustc`, `cargo`, `npm create tauri-app`). Overiť, že každý bod A–F je v aktuálnom kóde ešte otvorený. | 1 pracovník | haiku / low |
| **1** | Rozhranie: rozlíšenie `ip_banned` v `shop/errors.ts` + `client.ts`, tvar nového blockera. Ostatné vlny na tomto stoja, preto ide samo a prvé. | 1 pracovník | default |
| **2** | Paralelne: **(a)** cesta kľúča + `unverified` + UI (bod A, B) · **(b)** `blockers.ts` + snapshot test (C) · **(c)** práva na Windowse (D) · **(d)** E1–E4 · **(e)** Tauri obal (F), len ak vlna 0 prešla | 5 pracovníkov | (a)(b)(d) default · (c) haiku/low · (e) default |
| **3** | Integrácia, celý balík zelený, preklik + screenshoty, review celého diffu proti kontraktu vrátane security prehliadky | 1 pracovník | default + review na `high` |

Commit po každom hotovom a otestovanom celku, pred každým commitom zelený celý
balík. Push výhradne na `feat/kluc-a-ban`.

**Čo šprint nezmení:** schému DB (žiadna migrácia, žiadna záloha nie je
potrebná), publikovaný port, invarianty I1–I14, kontrakt V3 K1–K12.

---

## 9. Výsledok (24. 8. 2026)

Beh prebehol v samostatnom worktree `C:\Aura\_worktrees\kluc-a-ban` na vetve
`feat/kluc-a-ban` (odbočená z `4b76729`), lebo v `C:\Aura\ovl-da-zliav` súbežne
pracovalo pätnásť zapisovateľov druhej session. Do spoločného stromu sa nesiahlo
ani raz. Vetva je pushnutá; **nezlučovala sa** — koordinátor Sprintu 20 si
zlúčenie vezme, keď sa mu strom ustáli.

### Hotové

| Bod | Commit | Čo |
| --- | --- | --- |
| — | `adf1807` | Kontrakt a žiadosť správcovi shopu |
| **D** | `a16e355` | Práva tajomstiev sa merajú podľa platformy → **balík je zelený na Windowse** |
| **A** (server) | `ec152db` | `ip_banned` sa odlíšil od `forbidden`; kľúč sa pri bane uloží ako neoverený a veta hovorí pravdu; zavretá mína pri wipe kľúča |
| **E2, E3** | `e5b55a1` | Nečitateľné zrkadlo už nezakladá riadky (`mirror_unreadable`); `ordersSeen` je povinné |
| **E1** | `f3fb2df` | Nečitateľný zoznam zliav prestal znamenať „žiadne zľavy" |
| **B** (server) | `85aab53` | Jeden kľúč v oboch slotoch sa prizná z `last4`, bez dotyku I8'; GET dostal `verifyNote` |
| **F** | `e2ba5ce` | Spustenie z ikony skriptom namiesto Tauri (rozhodnutie R-4 upravené 25. 8.) |

Testy: **2843 prešlo, 0 padlo, 0 preskočených** na Windows hostovi. `typecheck`
aj `lint` čisté. Každý nový test bol overený mutáciou — po odstránení opravy
spadne.

### Čo sa našlo nad zadanie

1. **Nastražená mína pri wipe kľúča.** `writeFailure` hlásil 401 aj 403 cez
   `onKeyRejected`, čo je wipe kľúča (D51/D52). Callback dnes nikto nezapája, ale
   `ip_banned` je tiež 403 — v deň dopojenia by ban zmazal dobrý kľúč práve
   v stave, keď sa nový overiť nedá, lebo overenie ide cez tú istú zabanovanú IP.
2. **Pravidlo o právach tajomstiev malo dve kópie** (`lib/crypto/master-key.ts`
   a boot assertion v `instrumentation-node.ts`). Zjednotené.
3. **`keyRowState()` sa na `verifyStatus` nepozerá vôbec**, hoci ho z API
   dostáva. Neoverený kľúč — a taký je dnes ten objednávkový v DB — sa na
   obrazovke hlási ako **„vložený a platný"**. Appka tvrdí platnosť, ktorú
   nikdy nezmerala. NEOPRAVENÉ, viď nižšie.
4. **Spúšťač zhodil bežiacu appku.** `docker compose up` z git worktree
   neštartuje druhú appku — kontejnery majú pevné mená, takže tie bežiace
   prevezme a znovu postaví pod iným compose projektom. 24. 8. tým vypadol
   Caddy. Dáta prežili (žijú v named volume) a `docker compose up -d`
   z hlavného checkoutu všetko vrátilo. Oba skripty to odteraz odmietnu.
5. **`.cmd` nemalo v `.gitattributes` pravidlo pre koncovky riadkov**, hoci
   `.ps1` ho má aj s vysvetlením. Doplnené.
6. **Zdieľaná testovacia DB robí súbežné behy nespoľahlivými.** Obe sessions
   testujú proti tej istej `ovl-zliav-test-db`, takže súbežný beh zhodil
   `executor.spec.ts` dvakrát na `not_in_catalog`. Samostatne prejde. Nie je to
   chyba kódu, je to zdieľaný stav — a kritérium „0 padlo" sa preto nedá merať,
   kým testuje niekto iný.

### Neuzavreté a prečo

| Bod | Stav |
| --- | --- |
| **A** (UI) | `src/components/settings/KeysSection.tsx` drží agent UX4 druhej session (potvrdené 24. 8.). Chýba tam vykreslenie `verifyNote` **a oprava `keyRowState()`**, ktorá je vážnejšia než pôvodné zadanie: bez nej obrazovka o neoverenom kľúči tvrdí, že je platný. Pravdivá veta je zatiaľ len v odpovedi API. |
| **B** (UI) | Serverová polovica je hotová (`85aab53`) — `looksLikeSameKey` a `sameKeyNote` sú v odpovedi. Vykreslenie čaká na uvolnenie `KeysSection.tsx`, spolu s bodom A. |
| **E4** | `overview.module.css` drží agent UX5 druhej session. |
| **F** | **Hotové inak, než hovoril kontrakt.** Rust na tomto PC nie je a rozhodnutie R-4 sa 25. 8. zmenilo: namiesto Tauri je to `.cmd` + `.ps1` + zástupca v Starte. Tauri zostáva ako možnosť, keď bude `cargo` k dispozícii. |
| **C** | **Vyhodené z rozsahu** — druhá session ho zavrela commitmi `2e96b54` a `3833c14`. |

### Čo sa nezmenilo

Schéma DB (žiadna migrácia, žiadna záloha nebola potrebná), publikovaný port,
invarianty I1–I14, kontrakt V3 K1–K12. `KeyProbeResult` a `DetailFillOutcome`
dostali po jednom novom členovi — kto nad nimi má vyčerpávajúci `switch`, musí
ho doplniť.

### Ostro neoverené

Nič z bodu A ani B sa nedalo overiť proti ostrému shopu: platí ban. Testy idú proti
mock shopu (I6). Preklik v prehliadači sa nerobil — UI polovica je odložená a
`argon2` je blokovaná Windows Application Control, takže appka mimo kontejnera
lokálne nenaštartuje. Akceptačné kritériá 9, 10 a 12 teda splnené nie sú;
kritérium 11 (review) nebolo súčasťou tohto behu.
