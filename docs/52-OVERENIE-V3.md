# Aura Zľavy — PROTOKOL OVERENIA V3 (prestavba na frontu)

**Úloha:** V14 (fáza 4 sprintu `docs/51-SPRINT-V3.md`) · **Dátum:** 2026-08-11
**Overovaný stav:** commit `1f30117` („sekcia Výkon výberu"), teda V1–V13 hotové
vrátane šiestich opráv z 10.–11. 8.
**Kontrakt:** `docs/50-KONTRAKT-V3.md` (K1–K12) · **Nadradené invarianty:**
`docs/10-KONTRAKT.md`

> Protokol, nie marketing. Čo neprešlo alebo sa overiť nedalo, je napísané tak,
> ako to je. Verdikt je v §6.

---

## VERDIKT NA ZAČIATOK

**Brána K12 prešla celá — v tomto prostredí, so troma výhradami z §4.**

Všetkých sedem automatizovaných krokov z K12 („definícia hotového") je zelených
vrátane e2e cesty `prihlásenie → Prehľad → filter → dve pásma → potvrdenie →
fronta` a integračného dôkazu K1–K5 nad **produkčným** wiringom
(`scheduler/boot.ts`, produkčné repozitáre, reálny mock shop) — nie nad fake
závislosťou. Pasca z `CLAUDE.md` („agentov report nie je dôkaz") je tým
adresovaná menovite: zápisová cesta fronty má pokrytie na živom module, nie na
dvojníkovi.

**V tejto session sa nezmenil ani jeden riadok kódu.** Brána prešla na commite
`1f30117` taká, aká je. Opravy, ktoré si V3 vyžiadala, urobila predošlá session
(`3f15568`…`1f30117`); tu sa už len overovalo.

Nezmenené zostáva to najdôležitejšie: **`WRITES_ENABLED=false`** (K11 bod 5).
Appka do ostrého eshopu nikdy nezapísala a v tomto stave ani nemôže.

---

## 0. Prostredie overenia

| Vec | Hodnota |
| --- | --- |
| Node | v22.22.2 |
| Next.js | 16.3.0 (Turbopack) |
| MariaDB (lokálna, pre integračné testy) | **10.11.14** — nie 11.4, viď §4.2 |
| Playwright | 1.62.1, Chromium rev. **1194** z `/opt/pw-browsers` |
| Docker CLI | prítomný, **daemon nedostupný** |
| gitleaks | **binárka chýba** — nahradené ručným grepom (§3.4) |

DB schémy: `ovl_zliav_test` (vitest), `ovl_zliav_e2e` (e2e harness).

Fallback na Chromium z `playwright.config.ts` (`findChromium()`, hľadá najvyššiu
revíziu v `PLAYWRIGHT_BROWSERS_PATH` nezávisle od tej, ktorú `@playwright/test`
očakáva) **funguje**: e2e sa spustili bez jedinej premennej v prostredí.
Presne to, načo bol napísaný — 16 zlyhaní z prvého overenia (`13-OVERENIE.md`
§D.2) sa nezopakovalo.

---

## 1. Výsledky brány K12

| # | Krok z K12 | Príkaz | Výsledok |
| --- | --- | --- | --- |
| 1 | typecheck | `npm run typecheck` | ✅ exit 0, bez chyby |
| 2 | lint | `npm run lint` | ✅ exit 0, bez chyby |
| 3 | testy | `npm run test` | ✅ **72 súborov / 1247 testov**, 0 zlyhaných, **0 preskočených** |
| 4 | build | `npm run build` | ✅ exit 0, `output: 'standalone'` |
| 5 | bind (I5) | `npm run check-compose-bind` | ✅ „jediný publikovaný port je 127.0.0.1:3070:3070 na ovl-zliav-caddy" |
| 6 | grep testy invariantov | v sade č. 3 | ✅ I1 `redact`/`redaction`, I7 `no-clear-reduction`, I8' `no-orders-scope`, I5 `compose-bind`, K10 `vocabulary` |
| 7 | e2e cesta | `npm run e2e` | ✅ **18/18** za 1,3 min |

Nad rámec K12:

| Krok | Výsledok |
| --- | --- |
| `npm audit --audit-level=high` | ✅ `found 0 vulnerabilities` |
| migrácie na **čistej** DB | ✅ 12/12 aplikovaných (`0001`…`0012`), tri tolerované `1227` pri `FLUSH PRIVILEGES` |
| ručný sken tajomstiev v repe (I1) | ✅ nič — viď §3.4 |

### 1.1 Pasca: zelené bez DB nie je dôkaz

Prvý beh `npm run test` prebehol **bez** MariaDB a vyzeral takto:

```
Test Files  65 passed | 7 skipped (72)
     Tests  1136 passed | 111 skipped (1247)
```

Exit kód **0**. Zelené. A pritom sa preskočilo práve tých **111 testov, ktoré
stoja na DB** — medzi nimi `kontrakt-v3-dokaz` (jediný dôkaz K1–K5 nad
produkčným wiringom), `migrations-v3`, `repo-fronta`, `rozpocet-audit`,
`scheduler-queue`, `executor`, `redaction`, `audit-append-only`.
`describe.skipIf(!available)` je správna konštrukcia — bez DB nemá integračný
test čo tvrdiť — ale znamená, že *„testy prešli"* bez uvedeného počtu je o V3
bezcenná veta.

**Pravidlo pre ďalšie overenia:** k výsledku vždy uveď počet a trvaj na
`0 skipped`. 1247 = s DB, 1136 = bez DB, a rozdiel je celý kontrakt V3.

---

## 2. Čo dokazuje čo

Mapovanie kontraktu na dôkaz. Nie zoznam testov — zoznam tvrdení, ktoré padnú,
keď sa kontrakt poruší.

| Bod | Dôkaz | Čo konkrétne drží |
| --- | --- | --- |
| **K1** rozsah | `kontrakt-v3-dokaz` §K1, `routes-v8`, `guards` | `scope_mode` je ENUM (neznámu hodnotu **DB** neprijme), `CHECK` odmietne `items_total` 10 001, `CHECK` odmietne percento 31 aj 0; prepnutie do `plny` žiada sudo a zapíše `scope_mode_changed` |
| **K2** rozpočet a fronta | `kontrakt-v3-dokaz` §K2, `fronta-rozpocet`, `rozpocet-audit`, `budget` | prvý deň zapíše presne rozpočet a kampaň skončí ako **`queued`** (nie `failed`); druhý a tretí deň pokračuje **presne tam**, kde skončila; spotreba sa počíta výhradne z auditu |
| **K3** pásma | `kontrakt-v3-dokaz` §K3 | do shopu ide percento **položky**, nie hlavičkové percento zľavy |
| **K4** potvrdenie pri 10 k | `kontrakt-v3-dokaz` §K4, `preview-token`, `preview-sample` | hash sa prepočíta z riadkov `campaign_items`; **podvrhnutá cena v DB zastaví zápis PRED prvým requestom** na shop |
| **K5** meškanie | `kontrakt-v3-dokaz` §K5 | `late` cez produkčný `scheduler/boot.ts`, `markLate` je jednorazový, **okno zľavy sa počas celej fronty nezmení** (I7) |
| **K6** kľúč vs. fronta | `kontrakt-v3-kluc`, `ttl-wipe`, `readonly-after-expiry` (e2e) | po expirácii kľúča ide kampaň do „chýba kľúč", zvyšok položiek zostáva `pending`, žiadny zápis sa nestratí |
| **K7** katalóg | `catalog-sync`, `repo-fronta` | stránkovaná synchronizácia, `fetched_at` na riadok, **nekonzumuje** zápisový rozpočet |
| **K8** čo appka nemá | `produkty-v10`, `zlavy-v11`, `sales-insights` | zamknuté filtre povedia dôvod; v sekcii Výkon výberu sa neobjaví znak eura ani veta o príčine |
| **K9** štyri taby | `nastavenia-v12`, `prehlad`, Nav aliasy | `/analytika`, `/ai-agent`, `/audit`, `/kampane` žijú ako presmerovania — build ich stále vypisuje, čo je zámer, nie zvyšok |
| **K10** slovník | `vocabulary` (skener nad `src/app/**`, `src/components/**`) | žargón v JSX texte zhodí test; skener má aj dva sanity testy, že naozaj číta obrazovky a **nechytá** kód |
| **K11** čo sa nesmie stať | `migrations-v3`, `no-clear-reduction`, `sequential-writes`, `redaction` | migrácie sa needitujú (checksum), `setReduction` volá výhradne `executor.ts`, žiadny `Promise.all` nad zápismi, kľúč nikde v logu |
| **K12** hotové | §1 tohto protokolu | celá brána |

E2E `fronta-v3.spec.ts` (cesta z K12) je v tom zámerne **skromný**: dokazuje, že
sa cesta dá preklikať a že zľava skončí vo **fronte** — nie zapísaná. Že fronta
naozaj zapíše, dokazuje `kontrakt-v3-dokaz` nad produkčným wiringom. Toto
rozdelenie je správne a je v hlavičke testu vysvetlené: e2e beží mimo
`NODE_ENV=production` a s `WRITES_ENABLED=false`, takže ostrý zápis je tam
fail-closed odmietnutý.

---

## 3. Ako sa prostredie overenia postavilo

Zapisujem preto, že kontejner je efemérny a bez tohto postupu bude ďalší človek
(alebo ďalšia session) polhodinu hádať, prečo integračné testy „prejdú"
preskočené. Nie je to runbook pre appku — na to je `docs/21-RUNBOOKY.md` R1/R1w.

```sh
# 1) MariaDB (v uzavretom prostredí najprv `apt-get update`, inak 404 na .deb)
apt-get update && apt-get install -y --no-install-recommends mariadb-server
mariadbd --user=mysql --bind-address=127.0.0.1 --datadir=/var/lib/mysql &

# 2) schémy a používatelia — heslá sú testové defaulty z test/setup.ts
CREATE DATABASE ovl_zliav_test; CREATE DATABASE ovl_zliav_e2e;
CREATE USER 'ovl_zliav_app'@'%' IDENTIFIED BY 'test_app_password';
CREATE USER 'ovl_zliav_mig'@'%' IDENTIFIED BY 'test_mig_password';
GRANT ALL ON ovl_zliav_test.* TO 'ovl_zliav_mig'@'%' WITH GRANT OPTION;  # + e2e
GRANT ALL ON ovl_zliav_test.* TO 'ovl_zliav_app'@'%';                    # + e2e
# `WITH GRANT OPTION` je nutné: 0008/0012 odoberajú app userovi práva na audit (I4)

# 3) testové kľúče (32 B hex, chmod 400) — secrets/ je v .gitignore (I1)
secrets/test-master.key, secrets/test-session.key

# 4) migrácie na testovú schému
DB_NAME=ovl_zliav_test DB_MIGRATION_PASSWORD=test_mig_password npm run migrate
```

Tri veci, ktoré neboli zjavné:

1. **`apt-get install` bez `update` padne** na 404 pri závislostiach — index
   v obraze je starší než archív.
2. **Migračný user musí mať `WITH GRANT OPTION`**, nielen `ALL` — migrácie 0008
   a 0012 samé odoberajú práva aplikačnému userovi (I4, append-only audit).
   Bez toho padnú na „access denied" a appka fail-fast skončí.
3. **`secrets/test-*.key` musia existovať pred prvým testom.** `test/setup.ts`
   ich len ukazuje cestou, negeneruje ich.

### 3.4 Ručný sken tajomstiev (náhrada gitleaks)

`git grep` nad trackovanými súbormi mimo `test/`, `docs/`, `design/` na tvary
`api_key|password|secret|token` s literálom ≥ 16 znakov: **žiadny zásah**.
`git ls-files` na `secrets/`, `*.key`, `.env`: **žiadny trackovaný súbor**.
Nie je to ekvivalent gitleaks (ten pozerá aj históriu) — v CI zostáva blokujúci
krok v kontejneri.

---

## 4. Čo NIE JE overené a prečo

### 4.1 Docker build a beh stacku — nespustiteľné

Daemon v prostredí nie je. `docker compose build` / `up -d` teda neprebehli ani
teraz, rovnako ako pri prvom overení. **Musí prejsť Samuel u seba**, na Windows
podľa R1w (tri pasce: konce riadkov, práva tajomstiev v named volume, BOM v
`.ps1`).

### 4.2 MariaDB 11.4 — testované na 10.11.14

Integračné testy bežali na 10.11.14 z ubuntu archívu; produkcia aj CI majú
11.4. Použité konštrukcie (`CHECK`, `RANDOM_BYTES()`, `GET_LOCK`, granty,
`datetime(3)`, `ENUM`) na 10.11 fungujú, ale **schéma V3 — vrátane nových
migrácií 0010–0012 — nikdy nebežala na 11.4.** Výhrada z `13-OVERENIE.md` §D.6
tým **stále platí** a V3 ju rozšírila o tri migrácie.

### 4.3 Preklik človekom v prehliadači

E2E kliká, ale za Caddy s basic auth sa agent nedostane a **vzhľad nikto
neposúdil okom**. Pravidlá P1–P8 na štyroch taboch má pokryté `vocabulary`
skener a testy obrazoviek — to je kontrola textu a štruktúry, nie kontrola
dojmu. Či Prehľad naozaj vyzerá ako `design/v3/prehlad.html` v svetlej aj
tmavej téme, musí povedať človek.

### 4.4 Ostrý zápis do eshopu

Nikdy sa nestal a v tomto stave sa stať nemôže: `WRITES_ENABLED=false` (I13,
K11 bod 5). Prvý ostrý zápis je vedomé rozhodnutie, nie vedľajší efekt
nasadenia — a podľa K1 sa robí v režime `pilot` (10 produktov), nie v `plny`.

---

## 5. Čo z V3 nezmizlo z obzoru

Nie sú to chyby, sú to otvorené veci, ktoré si prestavba priniesla:

- **B7 v `docs/20-BACKLOG-SHOP-API.md`** je stále to najdôležitejšie číslo
  projektu: pri 200 zápisoch/deň trvá zľava na 8 000 produktoch **40 dní**, teda
  dlhšie, než platí kľúč. Fronta je na to pripravená (pokračuje, nič nestratí),
  ale bez vyššej kvóty na **jednom** kľúči je 8 000 produktov mesiac a pol.
  Rozdeľovanie záťaže medzi viac kľúčov API zakazuje.
- **B8** (kategória, kov, typ šperku) drží päť filtrov zamknutých (K8).
- Výkon výberu ukazuje **kusy, nikdy tržby** — cenu, za ktorú sa produkt naozaj
  predal, shop nevracia. Dva z troch panelov sú preto viditeľne zamknuté.

---

## 6. VERDIKT

**V3 je hotová v zmysle K12 a pripravená na Samuelov Docker beh.**

Zelené je všetko, čo sa v tomto prostredí zmerať dá: 1247 testov proti reálnej
MariaDB, 18 e2e scenárov, produkčný build, bind na localhost, 12 migrácií na
čistej DB, 0 zraniteľností. Kontrakt K1–K12 má dôkaz bod po bode a K1–K5 ho má
nad produkčným wiringom, nie nad mockom vlastnej implementácie.

Výhrady sú tri a všetky sú konkrétne, nie „treba ešte otestovať":

1. **Docker** — build a beh stacku neoverené, chýba daemon (§4.1).
2. **MariaDB 11.4** — schéma V3 overená len na 10.11.14 (§4.2).
3. **Oko** — vzhľad štyroch tabov v prehliadači neposúdil človek (§4.3).

Zápisy zostávajú vypnuté. Odomknúť ich je samostatné rozhodnutie a patrí k nemu
`pilot`, nie `plny`.
