# Aura Zľavy — naplnenie named volume `ovl-zliav-secrets` (Windows / Docker Desktop).
#
# DÔVOD: boot assertion (D61, I14) vyžaduje na súboroch s tajomstvami práva 400.
# Docker Desktop na Windows u bind mountov unixové práva neprenáša a hlási 777,
# takže appka v NODE_ENV=production odmietne nabootovať. Namiesto oslabenia
# invariantu žijú tajomstvá v named volume na linuxovom FS, kde práva 400 reálne
# platia. Volume mountuje `docker-compose.override.yml` na /run/keys.
#
# Spusti po prvom setupe a VŽDY po rotácii master key alebo DB hesiel:
#   .\scripts\sync-secrets-volume.ps1
# potom: docker compose up -d
#
# Skript tajomstvá len kopíruje z `secrets/` do volume — nič nevypisuje.

[CmdletBinding()]
param([string]$Volume = 'ovl-zliav-secrets')

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$subory = @('master.key', 'session.key', 'db_app_password', 'db_mig_password')
foreach ($f in $subory) {
  if (-not (Test-Path "secrets\$f")) {
    throw "Chýba secrets\$f — spusti najprv .\scripts\setup-local.ps1"
  }
}

docker volume create $Volume | Out-Null

# uid/gid 10050 = non-root user appky (D98); 400 = len čítanie vlastníkom (D61).
$prikaz = 'set -e; for f in ' + ($subory -join ' ') +
  '; do cp /src/$f /dst/$f; done; chown 10050:10050 /dst/*; chmod 400 /dst/*; ls -ln /dst'

docker run --rm -v "${Volume}:/dst" -v "${PWD}\secrets:/src:ro" alpine:3 sh -c $prikaz
if ($LASTEXITCODE -ne 0) { throw 'Kopírovanie do volume zlyhalo.' }

Write-Host "`nVolume '$Volume' naplnený (práva 400, vlastník 10050). Ďalej: docker compose up -d"
