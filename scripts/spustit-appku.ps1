# Aura Zľavy — start the app and open it, from one click.
#
# Replaces the Tauri desktop shell from KONTRAKT-KLUC-A-BAN-2026-08-24 point F.
# Tauri needed a Rust toolchain, which is not installed here and which Windows
# Application Control has already blocked once (argon2). A shell whose whole job
# is to show http://127.0.0.1:3070 does not justify that, so this does the same
# job with no new dependency.
#
# INVARIANT I5 IS UNTOUCHED. This script publishes no port and starts no server
# of its own -- the only published port stays Caddy's 127.0.0.1:3070, owned by
# docker-compose.yml. The script is a client.
#
# THREE THINGS THAT MUST NOT BREAK, all learned by breaking them on 24. 8. 2026:
#
#  1. **Encoding.** This file MUST stay UTF-8 WITH BOM. Windows PowerShell 5.1
#     reads a BOM-less .ps1 as ANSI, so "pripravená." becomes garbage and the
#     apostrophe in it terminates a string early -- the script then fails to
#     parse, with an error pointing at an innocent line.
#
#  2. **Never redirect a native command's stderr.** `docker ... 2>&1` in
#     PowerShell 5.1 wraps every stderr line in an ErrorRecord, so
#     `docker compose`'s normal progress output becomes a NativeCommandError and
#     kills the script. Compose writes progress to stderr; let it reach the
#     console untouched.
#
#  3. **Only ever compose from the deployed checkout.** Container names in
#     docker-compose.yml are fixed (`ovl-zliav-app`, ...), so `docker compose up`
#     from a second checkout of this repo does NOT start a second app -- it takes
#     the existing containers over and recreates them, with a different compose
#     project name and different bind-mount paths. Doing that from a git worktree
#     tore down the running app and dropped the Caddy container. Nothing was lost
#     (the DB lives in a named volume), but the app went down while somebody was
#     using it. Hence the worktree guard below, which is not paranoia -- it is a
#     transcript.
#
# And it must never hide a failure behind an opened browser window. A blank page
# with no explanation is worse than a message saying what is wrong.

$ErrorActionPreference = 'Stop'

# Repo root is the script's parent -- works from any checkout.
$Root = Split-Path -Parent $PSScriptRoot
$Url = 'http://127.0.0.1:3070'
$HealthUrl = "$Url/api/health"

function Fail($Message, $WhatToDo) {
    Write-Host ''
    Write-Host '  Appka sa nespustila.' -ForegroundColor Red
    Write-Host "  $Message"
    Write-Host ''
    Write-Host "  Co s tym: $WhatToDo"
    Write-Host ''
    Write-Host '  Zavri toto okno klavesom Enter.'
    Read-Host | Out-Null
    exit 1
}

# Any HTTP answer means Caddy is up. 401 is the HEALTHY state here, because
# /api/health sits behind basic auth (R4) -- waiting for 200 would wait forever.
function Test-AppAnswers {
    try {
        Invoke-WebRequest -Uri $HealthUrl -TimeoutSec 3 -UseBasicParsing | Out-Null
        return $true
    } catch {
        return ($null -ne $_.Exception.Response)
    }
}

Write-Host ''
Write-Host '  Aura Zlavy' -ForegroundColor Cyan
Write-Host "  $Root"
Write-Host ''

# 0. Already running? Then touch nothing -- just open it. This is what makes
#    double-clicking the shortcut twice harmless.
if (Test-AppAnswers) {
    Write-Host '  Appka uz bezi.'
    Write-Host "  Otvaram $Url"
    Start-Process $Url
    Start-Sleep -Seconds 1
    exit 0
}

# 1. The worktree guard (point 3 of the header). `.git` is a DIRECTORY in the
#    main checkout and a FILE in a worktree.
$GitPath = Join-Path $Root '.git'
if ((Test-Path $GitPath) -and -not (Test-Path $GitPath -PathType Container)) {
    Fail "Tento skript je v git worktree ($Root), nie v hlavnom checkoute." `
         'Spusti ho z C:\Aura\ovl-da-zliav. Kontejnery maju pevne mena, takze compose z druheho checkoutu tie bezice prevezme a znovu postavi.'
}

# 2. Docker. "docker: command not found" is not an answer a person can act on.
if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail 'Docker na tomto pocitaci nie je nainstalovany (alebo nie je v PATH).' `
         'Nainstaluj Docker Desktop a spusti tento skript znova.'
}

Write-Host '  Kontrolujem Docker...' -NoNewline
docker info | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Fail 'Docker Desktop nebezi.' `
         'Spusti Docker Desktop, pockaj, kym sa rozbehne, a skus to znova.'
}
Write-Host ' bezi.'

# 3. Containers. Compose progress goes to stderr and reaches the console as it
#    is -- see point 2 of the header.
Write-Host '  Spustam appku...'
Push-Location $Root
try {
    docker compose up -d
    $composeCode = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($composeCode -ne 0) {
    Fail 'Kontejnery sa nepodarilo spustit — vypis Dockeru je vyssie.' `
         'Najcastejsia pricina je chybajuci secrets/ alebo .env. Postup je v docs/21-RUNBOOKY.md, bod R1w.'
}

# 4. Readiness.
Write-Host '  Cakam, kym bude appka pripravena...' -NoNewline
$ready = $false
foreach ($attempt in 1..60) {
    if (Test-AppAnswers) { $ready = $true; break }
    Start-Sleep -Seconds 1
    Write-Host '.' -NoNewline
}

if (-not $ready) {
    Write-Host ''
    Fail 'Kontejnery bezia, ale appka na 127.0.0.1:3070 neodpoveda ani po minute.' `
         'Pozri, co hovoria logy: docker compose logs ovl-zliav-app'
}
Write-Host ' pripravena.'

# 5. Open it. Only now -- an empty browser window is not a launch.
Write-Host "  Otvaram $Url"
Start-Process $Url
Start-Sleep -Seconds 2
