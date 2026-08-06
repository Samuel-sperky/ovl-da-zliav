# Aura Zľavy — jednorazová lokálna príprava pre Windows (docs/13-OVERENIE.md §E).
#
# Vytvorí secrets/, vygeneruje master key, session key a DB heslá, pripraví .env
# pre Docker a Caddyfile s bcrypt hashom basic auth.
#
# BEZPEČNOSŤ: všetko vyrobené žije v `secrets/` a `.env` — oboje je v .gitignore.
# Skript je idempotentný: existujúce tajomstvá NEPREPISUJE (prepis master key by
# znamenal stratu prístupu k uloženému API kľúču shopu).
#
# Použitie (PowerShell v priečinku projektu):
#   .\scripts\setup-local.ps1
#   .\scripts\setup-local.ps1 -BasicAuthHeslo 'moje-heslo'

[CmdletBinding()]
param([string]$BasicAuthHeslo = '')

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

Krok '4/6  .env pre Docker'
if (Test-Path .env) {
  Info '.env už existuje — NEPREPISUJEM (skontroluj ho ručne)'
} else {
  # Docker: appka beží v kontajneri, DB je na compose sieti pod menom služby.
  # WRITES_ENABLED zostáva false — zapneš ho vedome až po otestovaní dry-runu.
  (Get-Content .env.example) `
    -replace '^NODE_ENV=.*', 'NODE_ENV=production' `
    -replace '^DB_HOST=.*', 'DB_HOST=ovl-zliav-db' `
    -replace '^PORT=.*', 'PORT=3000' |
    Set-Content .env -Encoding UTF8
  Info '.env vytvorený (NODE_ENV=production, DB_HOST=ovl-zliav-db, WRITES_ENABLED=false)'
}

Krok '5/6  Caddyfile s basic auth'
if (Test-Path secrets/Caddyfile) {
  Info 'secrets/Caddyfile už existuje — NEPREPISUJEM'
} else {
  if (-not $BasicAuthHeslo) {
    $sec = Read-Host -AsSecureString '  Zadaj heslo pre Caddy basic auth (prvá vrstva pred appkou)'
    $BasicAuthHeslo = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
  if (-not $BasicAuthHeslo) { throw 'Heslo je prázdne.' }
  # Caddy basic_auth berie výhradne bcrypt; ten vie vyrobiť sám Caddy v kontajneri.
  # Preto tu treba BEŽIACI docker daemon, nielen nainštalovanú binárku.
  $dockerOk = $false
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker info *> $null; $dockerOk = ($LASTEXITCODE -eq 0)
  }
  if (-not $dockerOk) {
    throw @'
Docker nebeží — bez neho neviem vygenerovať bcrypt hash pre basic auth.

Buď spusti Docker Desktop a pusti skript znova, alebo si hash vyrob inde:
    docker run --rm caddy:2-alpine caddy hash-password --plaintext 'TVOJE-HESLO'
potom skopíruj Caddyfile.example do secrets/Caddyfile a nahraď v ňom
reťazec NAHRAD-BCRYPT-HASHOM tým hashom.
'@
  }
  $hash = (docker run --rm caddy:2-alpine caddy hash-password --plaintext $BasicAuthHeslo).Trim()
  # Caddy vracia bcrypt v tvare $2a$14$... — čokoľvek iné je chyba, nie hash.
  if (-not $hash -or -not $hash.StartsWith('$2')) {
    throw "Caddy nevrátil bcrypt hash (dostal som: '$hash')."
  }
  # Hash ide priamo do Caddyfile — Caddy nevie načítať súbor do placeholdera.
  (Get-Content Caddyfile.example -Raw).Replace('NAHRAD-BCRYPT-HASHOM', $hash) |
    Set-Content secrets/Caddyfile -Encoding UTF8 -NoNewline
  $BasicAuthHeslo = $null
  Info 'secrets/Caddyfile vytvorený s bcrypt hashom (užívateľ: samuel)'
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

  1. docker compose up -d --build
  2. docker compose exec ovl-zliav-app node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/seed-admin.ts
     (interaktívne si vypýta meno a heslo do appky — heslo min. 12 znakov)
  3. Otvor https://127.0.0.1:3050
     - najprv basic auth (užívateľ "samuel" + heslo z kroku 5)
     - potom login do appky (účet z bodu 2)
  4. Prehliadač bude varovať pred certifikátom — Caddy si robí vlastnú lokálnu CA.
     Buď varovanie preklikni, alebo root cert pridaj medzi dôveryhodné:
       docker compose cp ovl-zliav-caddy:/data/caddy/pki/authorities/local/root.crt .
     a nainštaluj root.crt do "Trusted Root Certification Authorities".
  5. V appke prejdi onboarding: doména shopu -> API kľúč -> allowlist (max 10 ID).

ZÁPISY SÚ ZATIAĽ VYPNUTÉ (WRITES_ENABLED=false v .env) — appka fyzicky nemôže
zmeniť cenu v shope. Preklikaj si dry-run naprázdno; zápisy zapni až vtedy, keď
si istý, a to zmenou WRITES_ENABLED=true + docker compose up -d.
'@
