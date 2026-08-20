# Aura Zľavy (ovl-da-zliav)

Lokálna appka na ovládanie zliav v e-shope so šperkami cez jeho API.
Beží výhradne na `https://localhost:3050` (Caddy, TLS internal, basic auth) —
žiadna verejná expozícia, žiadny tunel (R4, I5).

> **PRODUKCIA BEZ STAGINGU.** Appka zapisuje priamo do produkčného shopu.
> Každý zápis je dvojkrokový (dry-run → potvrdenie), maximálne 10 produktov,
> plný append-only audit. Invarianty I1–I14 v `docs/10-KONTRAKT.md` sú
> nadradené všetkému ostatnému.

## Čo appka robí

- zakladá, prepisuje a predlžuje percentuálne zľavy (`setReduction`,
  scope výhradne `product:edit`) na max 10 allowlist produktoch,
- plánuje kampane so schedulerom (fire o 00:05 času shopu),
- vedie append-only audit každej operácie so snapshotom pred/po,
- **nikdy neruší zľavu v shope** (API to neumožňuje; zľavy len expirujú, R6/I7),
- **číta predaje** (scope `orders:read`, druhý kľúč) a ukazuje predajnosť
  allowlist produktov: kusy za obdobie, kusy/deň, dni od posledného predaja.
  Z objednávok si ukladá VÝHRADNE súčty po produkte a dni — žiadny riadok
  objednávky, žiadna krajina, žiadne zákaznícke údaje (I8').
  Nie je to obrátkovosť ani obrat, dôvody sú v `docs/21-RUNBOOKY.md` → R1s.

## Stack

Node 22 · Next.js 16 (App Router, standalone) · React 19 · TypeScript ·
MariaDB 11.4 · Caddy 2 · Docker Compose. Testy: vitest + Playwright, výhradne
proti lokálnemu mock shopu (I6).

## Rýchly štart

Kompletný postup: **`docs/21-RUNBOOKY.md` → R1. Prvý setup.** Skrátene:

```sh
mkdir -p secrets backups && chmod 700 secrets backups
npm ci
npm run gen-master-key                       # secrets/master.key (D61)
# ... session key, DB heslá, .env, secrets/Caddyfile — viď runbook R1
docker compose up -d --build
curl -k https://localhost:3050/api/health    # 200
```

Prvé prihlásenie vedie onboardingom: doména → API kľúč → allowlist →
testovací dry-run (D20).

## Bezpečnostné hranice

| Hranica | Vynútenie |
| --- | --- |
| API kľúč nikdy v repe, logoch, audite, UI ani zálohe (I1) | AES-256-GCM + TTL 48 h + wipe; centrálny redaktor; gitleaks v CI; `backup.sh --ignore-table=ovl_zliav.api_key` |
| Max 10 produktov, fail-closed (I2) | allowlist v DB (UNIQUE slot 1–10) + guardy pred volaním API |
| Objednávky len na súčty predaja, nikdy zákaznícke dáta (I8') | `/api/order` výhradne v `src/lib/shop/orders-client.ts`; povolené presne dva scopes; DDL kontrola zakazuje `order`/`customer`/`country`/`total_paid`; objednávkový kľúč je mimo zápisovej cesty (`src/lib/sales/sync-runner.ts`) — všetko vynucuje `test/unit/no-orders-scope.spec.ts` a `test/integration/orders-key.spec.ts` |
| Žiadny zápis bez dry-run + potvrdenia + sudo okna (I3) | preview token (JWT, 15 min) + server-side kontrola |
| Len `127.0.0.1:3050` (I5) | jediné `ports:` má Caddy; `scripts/check-compose-bind.ts` + `test/unit/compose-bind.spec.ts` v CI; boot assertion `PUBLIC_BIND` |
| Zápis len pri `NODE_ENV=production` **a** `WRITES_ENABLED=true` (I13) | env poistky, inak vynútený dry-run |
| Kontajner hardening (D98) | non-root uid 10050, `read_only`, `tmpfs`, `cap_drop: ALL`, `no-new-privileges` |

## Príkazy

```sh
npm run dev              # vývoj (zápisy vynútene vypnuté, I13)
npm run typecheck        # tsc --noEmit
npm run test             # vitest (unit + integračné, mock shop)
npm run e2e              # Playwright
npm run migrate          # migrácie (v kontajneri ich spúšťa entrypoint)
npm run check-compose-bind   # kontrola invariantu I5 nad compose
scripts/backup.sh        # denná záloha bez api_key (D76, D90)
scripts/restore-test.sh  # test obnoviteľnosti zálohy
```

## Dokumentácia

- `docs/10-KONTRAKT.md` — rozhodnutia R1–R10, D1–D100 a **INVARIANTY I1–I14**
- `docs/11-BUILD-SPEC.md` — technická špecifikácia (schéma, API, scheduler, infra)
- `docs/12-SPRINT-PLAN.md` — plán agentov a vlastníctvo súborov
- `docs/20-BACKLOG-SHOP-API.md` — požiadavky na maintainera shopu (B1–B4)
- `docs/21-RUNBOOKY.md` — prvý setup, trust certu, upgrade, restore test, panic button, rotácia master key
- `docs/api/sperky-api.md` — API dokumentácia shopu

## Prevádzka v skratke

- **Zálohy:** denný `mysqldump` bez `api_key`, rotácia 14 dní (`scripts/backup.sh`).
- **Upgrade:** záloha → stop app → build → up (migrácie fail-fast) → smoke test
  (`docs/21-RUNBOOKY.md` R3).
- **Kľúč unikol:** panic button v Nastaveniach + runbook R5.
- **Logy:** JSON na stdout, `docker compose logs ovl-zliav-app`; audit je v DB
  a nikdy sa nemaže (I4).
