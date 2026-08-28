@AGENTS.md

# Aura Zľavy — orientácia

Lokálna appka na časovo obmedzené percentuálne zľavy v eshope Šperky.
**Píše do PRODUKČNÉHO shopu bez stagingu.** Invarianty I1–I14 v
`docs/10-KONTRAKT.md` sú nadradené všetkému ostatnému; keď si nie si istý,
invariant vyhráva.

Beží na `http://localhost:3070` za Caddy (HTTP bez TLS je vedomá voľba,
6. 8. 2026; v prehliadači používaj `localhost`, nie `127.0.0.1` — dôvod je HSTS,
viď README). Prvý setup: `docs/21-RUNBOOKY.md` → R1, na Windows **R1w**
(tri pasce: konce riadkov, práva tajomstiev v named volume, BOM v `.ps1`).

**Prihlásenie neexistuje** (D98–D100, 27. 8. 2026): Caddy `basic_auth`, app
session aj sudo sú zrušené a zmazané z kódu. Nehľadaj `/login`, `auth: 'session'`
ani sudo okno — a nepridávaj ich späť. Invariant I3 preto po D100 znie **„žiadny
zápis bez dry-runu + potvrdenia"**; dry-run ani potvrdenie sa oslabiť NESMÚ (to
je jediné, čo pred produkčným eshopom zostalo). Čísla D98–D100 sú v
`docs/10-KONTRAKT.md` obsadené dvakrát — pozri kolíziu v jeho úvode.

**Potvrdenie NIE JE prihlásenie a neruš ho** (D106, 28. 8. 2026): štyri
uvoľňujúce mutácie majú bránu vo forme `confirmed: true` —
`PUT /api/settings/domain`, `POST /api/settings/scope-mode` (len pri UVOĽNENÍ),
`POST /api/settings/unlock-writes` a literál `KLUC UNIKOL` v `DELETE /api/key`.
Sprísnenie rozsahu je zámerne VOĽNÉ; tú asymetriu nezarovnávaj. Vzniklo to
preto, že heslo v tele bolo pri týchto akciách jediná brána a jeho zmazaním sa
z nich stal jeden tichý POST — pri doméne dokonca cesta k **vyneseniu
produkčného API kľúča bez prístupu k `secrets/`** (canary číta bez kľúča, takže
cudzí host si ju uspokojí sám). Rozbor: `KONTRAKT-BEZ-LOGINU-2026-08-27.md` §3b.

## Kde čo žije

- `src/lib/shop/client.ts` — klient shopu pre katalóg a `setReduction`.
  `setReduction` volá VÝHRADNE `src/lib/engine/executor.ts` (test to grepuje).
- `src/lib/shop/orders-client.ts` — JEDINÝ modul, ktorý smie volať `/api/order`
  (invariant I8'). Obsahuje aj sondu objednávkového kľúča.
- `src/lib/engine/sales-sync.ts` + `src/lib/repo/sales.repo.ts` — synchronizácia
  predajov a jej zápisová strana. `src/lib/sales/insights.ts` je čítacia strana.
- `src/lib/sales/sync-runner.ts` — spúšťač synchronizácie. Existuje preto, aby
  objednávkový kľúč nebol v `scheduler/boot.ts`: zápisová cesta o ňom nesmie
  vedieť (I8' bod 4).
- `src/lib/auth/local-actor.ts` — jediné miesto, ktoré vie, KTO zapisuje. Appka
  nemá prihlásenie, ale DB to vyžaduje (FK `campaigns.created_by` a
  `audit_log.user_id` na `users(id)`, `ON DELETE RESTRICT`), takže každý zápis aj
  audit riadok sa pripisuje lokálnemu actorovi `samuel` (id 1) — D102,
  27. 8. 2026. Tabuľka `users` a jej jediný riadok zostávajú, schéma sa nemenila
  (D101, žiadna migrácia).
- `src/lib/http/define-route.ts` — routy majú `ctx.actor` (`{ id, username }`),
  nie `ctx.claims`, a vlastnosť `auth:` v `RouteDefinition` **neexistuje**
  (D103, 27. 8. 2026). Keď ju niekde uvidíš, je to zabudnuté miesto — typecheck
  ho ukáže.
- Repozitáre sú v `src/lib/repo/`, nie v `src/lib/db/`. Raw parametrizované SQL,
  žiadne ORM. Migrácie sú numerované a checksumované — už aplikovanú migráciu
  NIKDY needituj, pridaj novú.
- Dva kľúče shopu žijú v jednej tabuľke `api_key` rozlíšené stĺpcom `kind`
  (`shop_write` 48 h / `orders_read` 30 dní). Jedna cesta pre šifrovanie, TTL,
  audit a wipe, takže panic button a zákaz logovania platia na oba automaticky.

## Pasce, ktoré tu už raz prežili do produkcie

- **Agentov report nie je dôkaz.** Integračné testy s fake závislosťou
  zamaskovali, že produkčný wiring vôbec nefunguje (scheduler nikdy nezapisoval).
  Vždy over aspoň jednu cestu s PRODUKČNÝM adaptérom.
- **Turbopack** už zahodil null-guard (`if (!row)` vyhodnotil ako compile-time
  falsy) — porovnávaj explicitne (`row === null`).
- **Next.js `instrumentation`** sa kompiluje do vlastného module grafu, takže
  singleton z bootu NIE JE ten istý objekt, aký vidí route handler. Registruj
  veci v module, ktorý ich naozaj používa.
- **MariaDB a dátumové sentinely**: `new Date(8.64e15)` sa skráti s warningom a
  porovnanie potom vracia vždy `false`. Nepoužívaj ich.
- **Eager `env.*` na module scope** láme `next build` (route factory sa volá pri
  kompilácii). Čítaj ENV vo funkcii.
- Deň počítaj cez `Intl.DateTimeFormat` s `timeZone`, nikdy v UTC — testy inak
  flakujú len medzi 22:00 a 24:00 UTC.
- `git worktree` vnútri repa (`.claude/worktrees`) by lint zosnímkoval; je to
  v `eslint.config.mjs` ignorované, po zlúčení worktree odstráň.
- **Jedna testovacia MariaDB pre celý repo.** Keď proti nej pustia vitest dva
  procesy naraz (dva agenti, dve sessions), `truncateAll()` sa pobijú a balík
  padá so signatúrou `SqlError 1062 Duplicate entry '1' for key 'PRIMARY' —
  INSERT INTO settings (id) VALUES (1)`. Nie je to race v kóde a nie je to pád
  tvrdenia. **Žiadny report z `npm test` nie je dôkaz, ak súčasne beží iný
  vitest** — over `ps | grep vitest` a beh zopakuj v izolácii.
- **Čo test vyňal z kontroly, nestráži NIKTO.** `nastavenia-v12.spec.ts` si
  kotvu `odhlasenie` vyňal zo zoznamu identifikátorov s tým, že „kryje ju e2e";
  e2e ju nekryla, a keď D99 zmazalo `SignOut.tsx`, rozcestník Nastavení mesiac
  ponúkal odkaz do prázdna. Našiel to preklik v prehliadači. Keď v teste píšeš
  výnimku, napíš k nej aj to, kto tú vec stráži namiesto neho.

## Príkazy

`npm run typecheck` · `npm run lint` · `npm run test` · `npm run e2e` ·
`npm run check-compose-bind` (invariant I5) · `scripts/backup.sh` ·
`scripts/sync-secrets-volume.ps1` (Windows, po každej rotácii master key).

Na Windows padá **nula** testov. Do 24. 8. 2026 ich padalo päť (`chmod 400` na
NTFS vyjde ako 444) a táto veta hovorila o deviatich — commit `a16e355` to
zavrel tým, že maska zakázaných bitov je odteraz podľa platformy. **Keď ti test
padne, je to SKUTOČNÝ pád, nie prostredie.**

Do 27. 8. 2026 tu bola jedna výnimka: v git worktree padol KAŽDÝ integračný test
route-ov už pri importe, lebo `argon2.glibc.node` blokuje Windows Application
Control. **D104 argon2 odstránilo** (`grep argon2 package.json` je prázdny),
takže táto trieda bolesti zmizla a „padá to len vo worktree" už nie je alibi.
