# Aura Zľavy (ovl-da-zliav)

Lokálna appka na ovládanie zliav v e-shope so šperkami cez jeho API.
Beží výhradne na `http://127.0.0.1:3070` (Caddy, basic auth; HTTP bez TLS je
vedomá voľba — dôvod je v `Caddyfile.example`) — žiadna verejná expozícia,
žiadny tunel (R4, I5).

> **PRODUKCIA BEZ STAGINGU.** Appka zapisuje priamo do produkčného shopu.
> Každý zápis je dvojkrokový (skúška naprázdno → potvrdenie) a celý sa
> zapisuje do append-only auditu. Invarianty I1–I14 v `docs/10-KONTRAKT.md`
> sú nadradené všetkému ostatnému; kontrakt V3 (`docs/50-KONTRAKT-V3.md`,
> K1–K12) ich v menovaných bodoch mení.

> **ZÁPIS NIE JE AKCIA, ZÁPIS JE FRONTA.** `setReduction` je jeden request na
> produkt, nedá sa dávkovať a shop dovolí 200 zápisov na UTC deň. Zľava na
> 8 000 produktoch teda beží 40 dní a zadáva sa s **budúcim** dátumom štartu,
> aby fronta stihla dobehnúť skôr, než okno platnosti nabehne (K2, K5).

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
- **priznáva, čo nemá**: filtre Kategória, Kov, Typ šperku, Marža a
  Obrátkovosť sú viditeľne zamknuté so štítkom „čaká na dáta zo shopu" —
  nie skryté a nie predstierané (K8, backlog B5/B6/B8).

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
# ... session key, DB heslá, .env, secrets/Caddyfile — viď runbook R1
docker compose up -d --build
curl http://127.0.0.1:3070/api/health        # 200
```

Prvé prihlásenie vedie onboardingom: doména → API kľúč → povolené produkty →
skúška naprázdno (D20). Rozsah začína na `pilot`; prepnutie do `plny` je
samostatné, auditované rozhodnutie v Nastaveniach a žiada sudo (K1).

## Bezpečnostné hranice

| Hranica | Vynútenie |
| --- | --- |
| API kľúč nikdy v repe, logoch, audite, UI ani zálohe (I1) | AES-256-GCM + TTL 48 h + wipe; centrálny redaktor; gitleaks v CI; `backup.sh --ignore-table=ovl_zliav.api_key` |
| Zápis len do produktu v povolenom rozsahu, fail-closed (I2 v tvare K1) | v `pilot` allowlist v DB (UNIQUE slot 1–10), v `plny` podmienka „produkt je v zrkadle katalógu a nie je `not_found`"; neznámy alebo nečitateľný režim = `pilot`; strop drží aj `CHECK` na `campaigns.items_total`; prepnutie do `plny` žiada sudo a zapíše `scope_mode_changed` |
| Objednávky len na súčty predaja, nikdy zákaznícke dáta (I8') | `/api/order` výhradne v `src/lib/shop/orders-client.ts`; povolené presne dva scopes; DDL kontrola zakazuje `order`/`customer`/`country`/`total_paid`; objednávkový kľúč je mimo zápisovej cesty (`src/lib/sales/sync-runner.ts`) — všetko vynucuje `test/unit/no-orders-scope.spec.ts` a `test/integration/orders-key.spec.ts` |
| Žiadny zápis bez dry-run + potvrdenia + sudo okna (I3) | preview token (JWT, 15 min) + server-side kontrola |
| Len `127.0.0.1:3070` (I5) | jediné `ports:` má Caddy; `scripts/check-compose-bind.ts` + `test/unit/compose-bind.spec.ts` v CI; boot assertion `PUBLIC_BIND` |
| Zápis len pri `NODE_ENV=production` **a** `WRITES_ENABLED=true` (I13) | env poistky, inak vynútený dry-run |
| Kontajner hardening (D98) | non-root uid 10050, `read_only`, `tmpfs`, `cap_drop: ALL`, `no-new-privileges` |

## Príkazy

```sh
npm run dev              # vývoj (zápisy vynútene vypnuté, I13)
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
npm run build            # next build (standalone)
npm run test             # vitest (unit + integračné, mock shop)
                         # POZOR: bez bežiacej MariaDB sa 111 testov PRESKOČÍ
                         # a beh je aj tak zelený — trvaj na „0 skipped" (1247)
npm run e2e              # Playwright
npm run migrate          # migrácie (v kontajneri ich spúšťa entrypoint)
npm run check-compose-bind   # kontrola invariantu I5 nad compose
scripts/backup.sh        # denná záloha bez api_key (D76, D90)
scripts/restore-test.sh  # test obnoviteľnosti zálohy
```

## Dokumentácia

Poradie, v akom to čítať, keď si tu prvý raz: `50-KONTRAKT-V3.md` (čo appka
dnes je) → `design/v3/ARCHITEKTURA.md` (ako to vyzerá a prečo) →
`10-KONTRAKT.md` (invarianty, ktoré platia ďalej) → `21-RUNBOOKY.md` (ako to
rozbehnúť).

**Kontrakt a stav**

- `docs/10-KONTRAKT.md` — rozhodnutia R1–R10, D1–D100 a **INVARIANTY I1–I14**
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
