# Aura Zľavy (ovl-da-zliav)

Lokálna appka na ovládanie zliav v e-shope so šperkami cez jeho API.
Beží výhradne na `http://localhost:3070` (Caddy; HTTP bez TLS je vedomá voľba —
dôvod je v `Caddyfile.example`) — žiadna verejná expozícia, žiadny tunel
(R4, I5).

**Appka nemá prihlásenie.** Otvoríš adresu a si vnútri. Basic auth, prihlásenie
do appky aj sudo boli 27. 8. 2026 zrušené (D98–D100): na jednoužívateľskom
lokálnom nástroji to boli tri vrstvy toho istého hesla. Čo appku chráni, na tom
nezáviselo — je to I5 (publikovaný je len `127.0.0.1:3070`) a D72 (origin check
na každej mutácii).

**Čo sa tým stratilo, povedané nahlas:** ktorýkoľvek lokálny proces na tomto PC
vie zapísať zľavy do produkčného eshopu jedným HTTP POST-om. Hlavičku `Origin`
si dosadí ľubovoľne — D72 je obrana proti prehliadačom, nie proti lokálnym
skriptom. Riziko a dôvod, prečo ho Samuel 27. 8. 2026 prijal:
`KONTRAKT-BEZ-LOGINU-2026-08-27.md` §3.

> **PRODUKCIA BEZ STAGINGU.** Appka zapisuje priamo do produkčného shopu.
> Každý zápis je dvojkrokový (skúška naprázdno → potvrdenie) a celý sa
> zapisuje do append-only auditu. Invarianty I1–I14 v `docs/10-KONTRAKT.md`
> sú nadradené všetkému ostatnému; kontrakt V3 (`docs/50-KONTRAKT-V3.md`,
> K1–K12) ich v menovaných bodoch mení.

> **ZÁPIS NIE JE AKCIA, ZÁPIS JE FRONTA.** `setReduction` je jeden request na
> produkt a nedá sa dávkovať. Od 1. 9. 2026 dovolí shop **1000 volaní na UTC
> deň** (predtým 200) a appka si z toho berie 80 %, teda 800 — o zvyšok sa delia
> zápisy a čítania cez jeden kľúč. Zľava na 8 000 produktoch teda ďalej beží
> viac dní a zadáva sa s **budúcim** dátumom štartu, aby fronta stihla dobehnúť
> skôr, než okno platnosti nabehne (K2, K5).

## Čo appka robí

- zakladá, prepisuje a predlžuje percentuálne zľavy (`setReduction`,
  scope výhradne `product:edit`) — v režime `pilot` na 10 povolených
  produktoch, v režime `plny` až na `max_products_per_campaign` (predvolene
  10 000) z katalógu, ktorý si appka zrkadlí (K1, K7),
- jedna zľava môže mať **viac pásiem** s rôznym percentom; percento sa
  rozhodne pri potvrdení, nie pri zápise (K3),
- drží frontu zápisov v rámci denného rozpočtu (predvolene 200/deň); pri
  vyčerpaní ide zľava do stavu „vo fronte" a druhý deň pokračuje presne tam,
  kde skončila — vyčerpaný rozpočet je informácia, nie chyba (K2),
- vedie append-only audit každej operácie so snapshotom pred/po,
- **nikdy neruší zľavu v shope** (API to neumožňuje; zľavy len expirujú, R6/I7),
- **číta predaje** (scope `orders:read`, druhý kľúč) a ukazuje predajnosť
  produktov: kusy za obdobie, kusy/deň, dni od posledného predaja.
  Z objednávok si ukladá VÝHRADNE súčty po produkte a dni — žiadny riadok
  objednávky, žiadna krajina, žiadne zákaznícke údaje (I8').
  Sú to **kusy, nikdy tržby** — cenu, za ktorú sa produkt naozaj predal, shop
  nevracia, a dopočítať ju z cenníka by bol výmysel (K8). Nie je to ani
  obrátkovosť ani obrat, dôvody sú v `docs/21-RUNBOOKY.md` → R1s,
- **priznáva, čo nemá**: filtre Kategória, Kov a Typ šperku sú viditeľne
  zamknuté — nie skryté a nie predstierané (K8, backlog B5/B6/B8). Marža
  a sklad zamknuté už nie sú: dáta na ne appka má z obohateného katalógu
  a naozaj podľa nich filtruje (D125).

## Čo pridala V4 (28.–31. 8. 2026)

- **Prehľad ukazuje predaje**: prepínač okna, denná tržba **eshopu** (súčet
  `total_paid`, tabuľka `shop_revenue_daily`), top/flop produkty a stavový pás.
  Tržba je len eshopová — per produkt sú to výhradne kusy, pretože ceny položiek
  objednávky API nevracia (D117). Rozdeliť `total_paid` medzi položky by bolo
  vymyslené číslo, a preto to appka nerobí.
- **KPI produktov** z obohateného katalógu (`getFull`, jeden request na produkt):
  referencia, cena, marža € aj %, sklad, celkovo predané, posledný predaj,
  dodávateľ, kategórie. Marža sa **nepočíta** — shop ju dáva hotovú.
  Obohacovanie je prioritizované a na dopyt (`src/lib/engine/catalog-enrich.ts`,
  D118): otvorený produkt sa dotiahne hneď, na pozadí ide dávka
  v poradí povolený zoznam → produkty v kampaniach → zvyšok (denný cieľ dávky
  sa odvodzuje z kvóty; po jej zdvihnutí je 600 — viď V5 nižšie).
- **Presety zliav** (D112): pomenovaný filter + pásma + trvanie, spustenie na
  klik — ale **vždy** nanovo cez skúšku naprázdno a potvrdenie. Preset nie je
  výnimka z I3.
- **„ref · názov" namiesto `product_id`** tam, kde sa produkt pomenúva
  (`src/lib/ui/product-label.ts`, D116). Chýbajúca referencia je pomlčka.
- **Detail produktu** (bočný panel s krivkou 90 d a oknami zliav), **timeline
  bežiacich a naplánovaných zliav** a **hľadanie podľa referencie**, nie len
  podľa názvu.
- **Rezerva zápisov proti vyhladovaniu čítaniami**: čítania sa z denného
  rozpočtu odpočítavajú len nad rezervou (`WRITE_QUOTA_RESERVE`, odvodená ako
  denný strop mínus strop čítacej dráhy), takže obohacovanie ani sondy nevedia
  appke zobrať schopnosť zapísať zľavu.

## Čo pridala V5 (1. 9. 2026)

Kontrakt: `KONTRAKT-V5-2026-09-01.md` (D122–D128, kritériá K1–K12).

- **Zdvihnutá kvóta kľúča.** Správca shopu zdvihol limit z `20/min · 200/deň`
  na **`150/min · 1000/deň`** (`docs/64-ZIADOST-LIMITY-2026-09-01.md`; appka to
  hlási na `GET /api/queue` ako `shopPerUtcDay: 1000`, `shopPerMinute: 150`).
  Appka si berie 80 %, teda 120/min a 800/deň. Denný strop v databáze posunula
  migrácia `0017_zdvihnuty_strop_zapisov.sql`.
- **Obohacuje sa strana, na ktorú sa pozeráš** (D123): otvorenie strany
  Produktov pošle jej riadky (do 100) na obohatenie — pri novej kvóte je to
  ~50 s — a tabuľka sa doplní bez prelistovania. **Strop je povedaný číslom:**
  denný cieľ je 600 obohatení, teda ~6 strán po 100; kto preklikne desiatu,
  dostane pomlčky a pod tabuľkou vetu, koľko z cieľa zostáva a prečo. Je to
  aritmetika kvóty, nie chyba.
- **Referencia je samostatný prvý stĺpec** každej tabuľky produktov (D122),
  nie pomlčka pred názvom. Chýbajúca referencia zostáva pomlčkou.
- **Jednotná sada stĺpcov** pre všetky tabuľky produktov (D124,
  `src/lib/ui/product-columns.ts`): referencia · názov · cena · zľava v shope ·
  predané za okno · predané/sklad · marža · sklad. Kde sa stĺpec nehodí,
  **vynechá sa** — nikdy sa nepremenuje ani nenaplní inou veličinou.
- **Filtre podľa toho, čo appka naozaj má** (D125): marža a sklad sa odomkli,
  kategória, kov a typ šperku zostávajú zamknuté. Zoznam zamknutých rozmerov
  je na jednom mieste a je odvodený od repozitára, takže obrazovky si už
  nemôžu protirečiť.
- **Jeden jazyk grafov** (D126, `src/components/ui/chart-language.ts`): čiara =
  vývoj v čase, stĺpec = porovnanie medzi položkami, koláč = rozdelenie
  katalógu alebo výberu. Jedna os, jedna paleta, jeden spôsob, ako sa kreslí
  „toto sme nemerali" — koláč sa nakreslí aj vtedy, keď je celý katalóg
  v diele „nevieme".
- **Zľavy sa dajú rozkliknúť** (D127): zoznam produktov v zľave, história
  „ktorý produkt bol v ktorých zľavách" a naopak, a vytvorenie zľavy priamo
  odtiaľ. **Dry-run a potvrdenie sú nedotknuté** — nová cesta ide cez tú istú
  bránu (I3).

### Čo appka NEVIE — povedané nahlas

- **API shopu je zabanované na našej IP.** Vracia `{"error":"ip_banned"}` na
  všetko, aj na verejné čítanie katalógu bez kľúča (zmerané 28. 8. 2026, predtým
  24. 8. — `docs/60`). Kým to trvá: **obohacovanie stojí** (dávka sa zastaví
  s dôvodom `ip_banned` a žiadny produkt neoznačí ako obohatený) a **KPI
  neobohatených produktov sú prázdne — pomlčka**, nie nula a nie odhad.
  Odblokovanie je akcia mimo appky (`docs/60` → správca shopu).
- **Bez zapísaného `shop_write` kľúča appka NEZAPÍŠE zľavu a ani neobohacuje.**
  Dnes kľúč chýba (`present: false`). `product:read`, z ktorého sa berie
  `getFull`, ide práve z tohto kľúča — takže kým ho Samuel nevloží,
  **tabuľky Produktov zostanú prázdne** (samé pomlčky) bez ohľadu na to, ako
  dobre je UX navrhnuté, a obohatenie strany (D123) sa ani nespustí. Nie je to
  chyba obrazovky; obrazovka to povie.
- **`orders_read` kľúč je NEOVERENÝ a koľko objednávok denne eshop má, sa
  nezmeralo** (bráni tomu ban IP). Priamy dôsledok, povedaný nahlas:
  **obrátkovosť za okno sa vypočítať nedá** — `qty_in_orders` z `getFull` je
  CELKOVÉ objednané množstvo, nie za 30 dní, a stĺpec to musí priznať, nie sa
  tváriť ako trend; **porovnanie účinnosti zliav sa spočítať nedá** — bez
  histórie objednávok nemá z čoho počítať a dostane priznanie namiesto čísla
  (I11). Rozsah okna histórie sa vedome NEROZHODOL (D128): najprv meranie,
  potom plán.
- **Celý katalóg sa obohatiť nedá.** Aj po zdvihnutí kvóty (1000/deň, appka
  berie 800) je katalóg 41 348 produktov → plošné `getFull` je **~69 dní**
  (predtým ~276). Batch to nerieši: 25 položiek = 25 hitov a `getFull` medzi
  batchovateľnými akciami nie je.
- **Predajové okná 30/90 d ukazujú len dni, ktoré sú naozaj stiahnuté** a
  medzeru priznávajú (D119). Číslo bez plného pokrytia je dolná hranica, nie
  fakt; kde chýba všetko, je pomlčka.
- **Predaje za okno appka vo väčšine prípadov nepozná.** Objednávky sú stiahnuté
  za 2 dni z 180, takže „0 predaných" sa NESMIE čítať ako fakt — appka takému
  produktu dá pomlčku a do pásiem zľavy ho **nezaradí vôbec** (D121, fail-closed:
  radšej nič než 30 % z nemeraného predpokladu).
- **Denný graf tržby ešte nekreslí stav „deň prečítaný, nepredalo sa nič".**
  Tabuľka `shop_revenue_read_state` (migrácia 0016) ten stav drží a
  `/api/insights/revenue-daily` ho posiela ako `dayStates`, ale obrazovka číta
  len počet chýbajúcich dní — taký deň teda z grafu zmizne bez bodu aj bez
  značky. Smer je bezpečný (appka netvrdí nič navyše), dokresliť ho je
  otvorené rozhodnutie o vzhľade.
- Zoznam vedome vynechaných vecí (mobil, notifikácie, CSV export, druhý
  používateľ…) je v `KONTRAKT-V4-2026-08-28.md` §3 a pre V5
  v `KONTRAKT-V5-2026-09-01.md` §4 — tam pribudol **drill-down** (klik do grafu
  prefiltruje tabuľku) a pivot/vlastné metriky, prvý kandidát na V6.

## Stack

Node 22 · Next.js 16 (App Router, standalone) · React 19 · TypeScript ·
MariaDB 11.4 · Caddy 2 · Docker Compose. Testy: vitest + Playwright, výhradne
proti lokálnemu mock shopu (I6).

Štyri taby: **Prehľad · Produkty · Zľavy · Nastavenia** (K9). Staré cesty
`/kampane`, `/analytika`, `/ai-agent`, `/audit` zostávajú ako presmerovania.

## Rýchly štart

Kompletný postup: **`docs/21-RUNBOOKY.md` → R1. Prvý setup.** Skrátene:

```sh
mkdir -p secrets backups && chmod 700 secrets backups
npm ci
npm run gen-master-key                       # secrets/master.key (D61)
# ... session key (podpisuje preview token), DB heslá, .env, secrets/Caddyfile — viď runbook R1
docker compose up -d --build
curl http://localhost:3070/api/health              # 200, bez hesla (D98 z 27. 8. 2026)
```

Onboarding ako sprievodca (D20) v architektúre V3 **neexistuje** — zrušila ho
a nahradila prázdnymi stavmi s odkazmi (`design/v3/ARCHITEKTURA.md`, a hovorí to
o sebe aj `src/app/onboarding/page.tsx`). Prvé otvorenie teda vedie na Prehľad,
ktorý prázdnymi stavmi ukáže, čo chýba: doména, API kľúč, povolené produkty.
Rozsah začína na `pilot`; prepnutie do `plny` je samostatné, auditované
rozhodnutie v Nastaveniach (K1). Heslo si nevyžiada — sudo zrušila D100
(27. 8. 2026); do auditu sa ďalej zapisuje, či šlo o uvoľnenie alebo sprísnenie
rozsahu (`looseningScope`).

> **V prehliadači používaj `localhost`, nie `127.0.0.1`.** Caddy poslúcha na
> oboch menách, ale na `127.0.0.1` si prehliadač mohol pripnúť HSTS od úplne inej
> lokálnej služby — HSTS platí na CELÝ HOST bez ohľadu na port, takže Chrome
> potom prepíše `http://127.0.0.1:3070` na `https://`, kde na tomto porte nikto
> neposlúcha, a zostane prázdna stránka bez chybovej hlášky. Zmerané 27. 8. 2026:
> `127.0.0.1` sa v Chrome nepotvrdilo vôbec, `localhost` áno.
>
> Pripnutie sa zruší v `chrome://net-internals/#hsts` → *Delete domain security
> policies* → `127.0.0.1`. Naša Caddy konfigurácia HSTS neposiela (vedome, D95).

## Bezpečnostné hranice

| Hranica | Vynútenie |
| --- | --- |
| API kľúč nikdy v repe, logoch, audite, UI ani zálohe (I1) | AES-256-GCM + TTL 48 h + wipe; centrálny redaktor; gitleaks v CI; `backup.sh --ignore-table=ovl_zliav.api_key` |
| Zápis len do produktu v povolenom rozsahu, fail-closed (I2 v tvare K1) | v `pilot` allowlist v DB (UNIQUE slot 1–10), v `plny` podmienka „produkt je v zrkadle katalógu a nie je `not_found`"; neznámy alebo nečitateľný režim = `pilot`; strop drží aj `CHECK` na `campaigns.items_total`; prepnutie do `plny` zapíše `scope_mode_changed` s príznakom uvoľnenia (sudo pred ním zrušila D100, 27. 8. 2026) |
| Objednávky len na súčty predaja, nikdy zákaznícke dáta (I8') | `/api/order` výhradne v `src/lib/shop/orders-client.ts`; povolené presne dva scopes; DDL kontrola zakazuje `order`/`customer`/`country`/`total_paid`; objednávkový kľúč je mimo zápisovej cesty (`src/lib/sales/sync-runner.ts`) — všetko vynucuje `test/unit/no-orders-scope.spec.ts` a `test/integration/orders-key.spec.ts` |
| Žiadny zápis bez dry-run + potvrdenia (I3, znenie zmenila D100 z 27. 8. 2026) | preview token (JWT, 15 min) + server-side kontrola |
| **Žiadna autentifikácia** (D98–D100, 27. 8. 2026) | nič — a je to vedomé. Ktorýkoľvek lokálny proces na tomto PC zapíše zľavu jedným POST-om; ostáva len I5 (bind na `127.0.0.1`) a origin check D72 proti prehliadačom |
| Len `127.0.0.1:3070` (I5) | jediné `ports:` má Caddy; `scripts/check-compose-bind.ts` + `test/unit/compose-bind.spec.ts` v CI; boot assertion `PUBLIC_BIND` |
| Zápis len pri `NODE_ENV=production` **a** `WRITES_ENABLED=true` (I13) | env poistky, inak vynútený dry-run |
| Kontajner hardening (D98 — to dotazníkové; číslo si 27. 8. 2026 vzal aj sprint bez prihlásenia) | non-root uid 10050, `read_only`, `tmpfs`, `cap_drop: ALL`, `no-new-privileges` |

## Príkazy

```sh
npm run dev              # vývoj (zápisy vynútene vypnuté, I13)
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
npm run build            # next build (standalone)
npm run test             # vitest (unit + integračné, mock shop). Počet testov tu
                         # zámerne nie je — starnul rýchlejšie než README; aktuálny
                         # je vo výstupe behu.
                         # Bez bežiacej MariaDB `pretest` skončí s 1 a k vitestu
                         # sa vôbec nedostane (`scripts/require-test-db.ts`).
                         # Ticho preskočiť 15 integračných súborov sa teda už
                         # nedá — do 25. 8. 2026 to šlo a beh bol aj tak zelený.
npm run test:unit        # bez databázy, poctivo — nič v test/unit ju nepotrebuje
npm run e2e              # Playwright
npm run migrate          # migrácie (v kontajneri ich spúšťa entrypoint)
npm run check-compose-bind   # kontrola invariantu I5 nad compose
scripts/backup.sh        # denná záloha bez api_key (D76, D90)
scripts/restore-test.sh  # test obnoviteľnosti zálohy
```

## Spustenie z ikony (Windows)

```powershell
scripts\vytvorit-zastupcu.ps1   # raz: zástupca „Aura Zľavy" v Starte
scripts\spustit-appku.cmd       # zdvihne kontejnery, počká a otvorí :3070
```

Zástupca nič neinštaluje — je to jeden `.lnk` v Starte aktuálneho používateľa a
jeho zmazaním sa všetko vráti. Keď appka už beží, spúšťač sa kontejnerov
**nedotkne** a len otvorí prehliadač, takže dvojklik navyše nič nepokazí.

Oba skripty **odmietnu bežať z git worktree**: kontejnery majú v compose pevné
mená, takže `docker compose up` z druhého checkoutu tie bežiace prevezme a
znovu postaví (24. 8. 2026 tým spadol Caddy; dáta prežili, appka bežala ďalej
až po `docker compose up -d` z hlavného checkoutu). Spúšťaj ich z
`C:\Aura\ovl-da-zliav`.

> Prečo nie Tauri: desktopový obal by potreboval Rust toolchain, ktorý na tomto
> počítači nie je a ktorému Windows Application Control už raz zablokovala
> binárku (`argon2` — tú appka od 27. 8. 2026 už nemá, D104). Na okno, ktorého celá práca je zobraziť `:3070`, to nestojí
> za novú závislosť — rozhodnutie R-4 v `KONTRAKT-KLUC-A-BAN-2026-08-24.md`.

**Pozor na kódovanie:** `.ps1` v tomto repe musí zostať UTF-8 **s BOM** a CRLF
(vynucuje `.gitattributes`). Windows PowerShell 5.1 číta súbor bez BOM ako ANSI
a na diakritike sa rozsype parsovanie — chyba potom ukazuje na nevinný riadok.

## Dokumentácia

Poradie, v akom to čítať, keď si tu prvý raz: `50-KONTRAKT-V3.md` (čo appka
dnes je) → `design/v3/ARCHITEKTURA.md` (ako to vyzerá a prečo) →
`10-KONTRAKT.md` (invarianty, ktoré platia ďalej) → `21-RUNBOOKY.md` (ako to
rozbehnúť).

**Kontrakt a stav**

- `docs/10-KONTRAKT.md` — rozhodnutia R1–R10, D1–D100, D98–D105 z 27. 8. 2026
  (čísla D98–D100 sú obsadené dvakrát, kolízia je opísaná v úvode dokumentu)
  a **INVARIANTY I1–I14**
- `KONTRAKT-V5-2026-09-01.md` — **kontrakt V5** (D122–D128, kritériá K1–K12):
  zdvihnutá kvóta a čo umožnila, obohatenie strany, jednotné stĺpce, filtre
  podľa dostupných dát, jeden jazyk grafov, rozkliknuteľné Zľavy. §5 hovorí
  nahlas, čo chýba (`shop_write` kľúč, neoverený `orders_read`)
- `docs/64-ZIADOST-LIMITY-2026-09-01.md` — žiadosť o zdvihnutie limitov
  a `docs/63-API-LIMITY-2026-09-01.md` — zmerané limity kľúča
- `KONTRAKT-V4-2026-08-28.md` — **kontrakt V4** (D108–D120, akceptačné kritériá
  K1–K11, po revízii D121): predaje na Prehľade, KPI produktov, presety. §2b je
  revízia po sonde API — zmerané fakty o kvóte, bane a o tom, čo API nevracia,
  a doplnenie z 31. 8. 2026 o tom, čo preklik našel nad nasadeným buildom
- `docs/50-KONTRAKT-V3.md` — **kontrakt V3 (K1–K12)**: fronta, denný rozpočet,
  režim rozsahu, pásma. Mení `10-KONTRAKT.md` v menovaných bodoch
- `docs/40-ODPOVEDE-V3.md` — 100 odpovedí, zdroj pravdy pre správanie V3
- `docs/11-BUILD-SPEC.md` — technická špecifikácia (schéma, API, scheduler, infra)
- `docs/20-BACKLOG-SHOP-API.md` — požiadavky na správcu shopu (B1–B8; **B7**
  je po prestavbe najdôležitejšia)

**Plány a overenia** (protokoly, nie marketing — čo neprešlo, je v nich napísané)

- `docs/51-SPRINT-V3.md` — sprint prestavby na frontu (V1–V14)
- `docs/52-OVERENIE-V3.md` — **overenie V3** a čo z neho zostalo na Samuela
- `docs/13-OVERENIE.md` — overenie pôvodnej appky (A19)
- `docs/12-SPRINT-PLAN.md` — plán agentov a vlastníctvo súborov
- `docs/30-UX-AUDIT.md`, `31-UI-AUDIT.md`, `32-UX-UI-PLAN.md`,
  `33-KISS-DIZAJN.md`, `34-KISS-OVERENIE.md` — cesta k dizajnu pred V3
- `design/v3/ARCHITEKTURA.md` — architektúra UI V3 a pravidlá P1–P8;
  mockupy sú `design/v3/*.html`
- `KONTRAKT-UX-DIZAJN-2026-08-19.md` — dokončenie UX a dizajnu šiestich
  obrazoviek: neutrálna paleta so **zmeranými** kontrastmi a odstupmi pri
  farbosleposti, tri roly popiskov, hustota proti reálnym 41 220 produktom.
  Paletu stráži `test/unit/paleta.spec.ts` (číta tokeny priamo z
  `globals.css`), písmo `test/unit/typografia.spec.ts`.

**Prevádzka a API shopu**

- `docs/21-RUNBOOKY.md` — prvý setup (R1, na Windows R1w), upgrade, restore
  test, panic button, rotácia master key
- `docs/api/sperky-api-v4.md` — aktuálna API dokumentácia shopu
- `docs/api/sperky-api.md` — pôvodná verzia (ponechaná pre históriu rozhodnutí)

## Prevádzka v skratke

- **Zálohy:** denný `mysqldump` bez `api_key`, rotácia 14 dní (`scripts/backup.sh`).
- **Upgrade:** záloha → stop app → build → up (migrácie fail-fast) → smoke test
  (`docs/21-RUNBOOKY.md` R3).
- **Kľúč unikol:** panic button v Nastaveniach + runbook R5.
- **Logy:** JSON na stdout, `docker compose logs ovl-zliav-app`; audit je v DB
  a nikdy sa nemaže (I4).
