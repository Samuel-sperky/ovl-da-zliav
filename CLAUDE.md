@AGENTS.md

# Aura Zľavy — orientácia

Lokálna appka na časovo obmedzené percentuálne zľavy v eshope Šperky.
**Píše do PRODUKČNÉHO shopu bez stagingu.** Invarianty I1–I14 v
`docs/10-KONTRAKT.md` sú nadradené všetkému ostatnému; keď si nie si istý,
invariant vyhráva.

Beží na `http://127.0.0.1:3070` za Caddy s basic auth (HTTP bez TLS je vedomá
voľba, 6. 8. 2026). Prvý setup: `docs/21-RUNBOOKY.md` → R1, na Windows **R1w**
(tri pasce: konce riadkov, práva tajomstiev v named volume, BOM v `.ps1`).

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

## Príkazy

`npm run typecheck` · `npm run lint` · `npm run test` · `npm run e2e` ·
`npm run check-compose-bind` (invariant I5) · `scripts/backup.sh` ·
`scripts/sync-secrets-volume.ps1` (Windows, po každej rotácii master key).

Na Windows padá **nula** testov. Do 24. 8. 2026 ich padalo päť (`chmod 400` na
NTFS vyjde ako 444) a táto veta hovorila o deviatich — commit `a16e355` to
zavrel tým, že maska zakázaných bitov je odteraz podľa platformy. **Keď ti test
padne, je to SKUTOČNÝ pád, nie prostredie.**

Jedna výnimka a nie je to test: v git worktree padne KAŽDÝ integračný test
route-ov už pri importe, lebo `argon2.glibc.node` je blokovaná Windows
Application Control. V hlavnom strome to funguje. Nie je to pád tvrdenia, je to
pád importu — v súhrne sa to ukáže ako „Failed Suites".
