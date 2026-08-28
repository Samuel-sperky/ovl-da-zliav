# Aura Zľavy — jednorazová lokálna príprava pre Windows (docs/13-OVERENIE.md §E).
#
# Vytvorí secrets/, vygeneruje master key, session key a DB heslá, pripraví .env
# pre Docker a skopíruje Caddyfile.
#
# ŽIADNE HESLO SI TENTO SKRIPT NEPÝTA (27. 8. 2026, D98–D100). Do 27. 8. 2026
# tu bol krok 5, ktorý si vyžiadal heslo pre Caddy basic auth a vyrobil z neho
# bcrypt hash — tá vrstva je zrušená, nie presunutá. Master key, session key
# a DB heslá sú INÉ tajomstvá a generujú sa ďalej.
#
# BEZPEČNOSŤ: všetko vyrobené žije v `secrets/` a `.env` — oboje je v .gitignore.
# Skript je idempotentný: existujúce tajomstvá NEPREPISUJE (prepis master key by
# znamenal stratu prístupu k uloženému API kľúču shopu).
#
# Použitie (PowerShell v priečinku projektu):
#   .\scripts\setup-local.ps1

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Krok($t) { Write-Host "`n$t" -ForegroundColor White }
function Info($t) { Write-Host "  $t" }
function Hex32 { node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" }

Krok '1/6  Priečinky'
New-Item -ItemType Directory -Force -Path secrets, backups | Out-Null
Info 'secrets/ a backups/ pripravené'

Krok '2/6  Master key a session key'
if (Test-Path secrets/master.key) {
  Info 'secrets/master.key už existuje — NEPREPISUJEM (prepis = strata uloženého API kľúča)'
} else {
  [IO.File]::WriteAllText("$PWD/secrets/master.key", (Hex32))
  Info 'secrets/master.key vygenerovaný (32 B hex)'
}
if (Test-Path secrets/session.key) {
  Info 'secrets/session.key už existuje — NEPREPISUJEM'
} else {
  [IO.File]::WriteAllText("$PWD/secrets/session.key", (Hex32))
  Info 'secrets/session.key vygenerovaný'
}

Krok '3/6  Heslá databázy'
foreach ($f in 'db_root_password', 'db_app_password', 'db_mig_password') {
  if (Test-Path "secrets/$f") {
    Info "secrets/$f už existuje — NEPREPISUJEM"
  } else {
    $v = node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))"
    [IO.File]::WriteAllText("$PWD/secrets/$f", $v)
    Info "secrets/$f vygenerované"
  }
}

Krok '3b/6  Práva pre kontajnery'
# POZOR: Docker Desktop na Windows unixové práva bind mountov neprenáša a
# kontajneru hlási 777. Boot assertion (D61, I14) taký master key ODMIETNE a
# appka v NODE_ENV=production nenabootuje. Invariant sa neoslabuje — tajomstvá
# pre appku žijú v named volume, kde práva 400 reálne platia (runbook R1w).
Info 'Windows: tajomstvá appky idú do named volume — spusti .\scripts\sync-secrets-volume.ps1'
Info 'a používaj docker-compose.override.windows.example.yml (viď docs/21-RUNBOOKY.md R1w)'

Krok '4/6  .env pre Docker'
if (Test-Path .env) {
  Info '.env už existuje — NEPREPISUJEM (skontroluj ho ručne)'
} else {
  # Docker: appka beží v kontajneri, DB je na compose sieti pod menom služby.
  # WRITES_ENABLED zostáva false — zapneš ho vedome až po otestovaní dry-runu.
  # Cesty *_FILE ukazujú do /run/keys — tam appka vidí named volume so správnymi
  # právami 400 (krok 3b, runbook R1w), nie bind mount hlásiaci 777.
  (Get-Content .env.example) `
    -replace '^NODE_ENV=.*', 'NODE_ENV=production' `
    -replace '^DB_HOST=.*', 'DB_HOST=ovl-zliav-db' `
    -replace '^PORT=.*', 'PORT=3000' `
    -replace '^MASTER_KEY_FILE=.*', 'MASTER_KEY_FILE=/run/keys/master.key' `
    -replace '^SESSION_SECRET_FILE=.*', 'SESSION_SECRET_FILE=/run/keys/session.key' `
    -replace '^DB_PASSWORD_FILE=.*', 'DB_PASSWORD_FILE=/run/keys/db_app_password' `
    -replace '^DB_MIGRATION_PASSWORD_FILE=.*', 'DB_MIGRATION_PASSWORD_FILE=/run/keys/db_mig_password' |
    Set-Content .env -Encoding UTF8
  Info '.env vytvorený (NODE_ENV=production, DB_HOST=ovl-zliav-db, WRITES_ENABLED=false)'
  Info 'tajomstvá appky sa čítajú z /run/keys (named volume, R1w)'
}

Krok '5/6  Caddyfile'
if (Test-Path secrets/Caddyfile) {
  Info 'secrets/Caddyfile už existuje — NEPREPISUJEM'
} else {
  # Doslovná kópia example-u: od 27. 8. 2026 (D98) v ňom nie je blok basic_auth,
  # takže sa nič nedopĺňa a nič sa nepýta. Docker tu už netreba — bcrypt hash
  # sa negeneruje.
  Copy-Item Caddyfile.example secrets/Caddyfile
  Info 'secrets/Caddyfile vytvorený (bez basic auth — D98)'
}

Krok '6/6  Kontrola, že do gitu nič neuniklo'
$unik = git status --porcelain --untracked-files=all 2>$null |
  Where-Object { $_ -match 'secrets/' -or $_ -match '^\?\? \.env$' }
if ($unik) {
  Write-Host '  VAROVANIE: git vidí tieto súbory — NESMÚ sa commitnúť:' -ForegroundColor Red
  $unik | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  exit 1
}
Info 'git nevidí ani secrets/, ani .env — v poriadku'

Write-Host @'

Príprava hotová. Ďalej:

  0. cp docker-compose.override.windows.example.yml docker-compose.override.yml
     .\scripts\sync-secrets-volume.ps1
     (bez tohto appka nenabootuje — bind mount na Windows hlási práva 777 a
      boot assertion D61 taký master key odmietne; runbook R1w)
  1. docker compose up -d --build
     (ak si stack skúšal už PRED opravou migračného usera, raz spusti
      `docker compose down -v` — init skript DB beží len na prázdnom volume;
      dáta neprídu nazmar, migrácie dovtedy nikdy neprebehli)
  2. Otvor http://localhost:3070  (funguje aj http://127.0.0.1:3070)
     Appka sa otvorí HNEĎ — žiadny dialóg, žiadne prihlásenie (D98-D100,
     27. 8. 2026). Seed admina sa už nerobí, riadok actora si appka dohľadá
     alebo vyrobí sama.
     (HTTP bez TLS je vedomá voľba — appka žije len na 127.0.0.1 a to je
      po zrušení prihlásenia jej jediná ochrana pred sieťou, invariant I5)
  3. V appke prejdi onboarding: doména shopu -> API kľúč -> allowlist (max 10 ID).

ZÁPISY SÚ ZATIAĽ VYPNUTÉ (WRITES_ENABLED=false v .env) — appka fyzicky nemôže
zmeniť cenu v shope. Preklikaj si dry-run naprázdno; zápisy zapni až vtedy, keď
si istý, a to zmenou WRITES_ENABLED=true + docker compose up -d.
'@
