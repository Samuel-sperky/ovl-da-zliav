# Aura Zľavy — put a Start-menu shortcut on this machine. Run once.
#
# The shortcut points at spustit-appku.cmd, so the app starts from the Start
# menu like any other program. Nothing is installed and nothing is registered
# system-wide -- it is one .lnk in the current user's Start menu, and deleting
# it undoes everything this script does.
#
# The icon is a stock Windows one: the project has no .ico yet. Drop one into
# public/ and point $IconPath at it when it exists.

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Target = Join-Path $PSScriptRoot 'spustit-appku.cmd'
$IconPath = "$env:SystemRoot\System32\shell32.dll,43"   # stock "tag / label" icon

if (-not (Test-Path $Target)) {
    Write-Host "  Nenasiel som $Target — spusti skript z prieinka scripts/ v repe." -ForegroundColor Red
    exit 1
}

# The same worktree guard as spustit-appku.ps1, and for a sharper reason: a
# shortcut is PERSISTENT. Pointing it at a worktree would leave a Start-menu
# entry that refuses to start the app long after the worktree is deleted --
# and a shortcut to a path that no longer exists is the worst kind of broken.
# `.git` is a directory in the main checkout and a file in a worktree.
$GitPath = Join-Path $Root '.git'
if ((Test-Path $GitPath) -and -not (Test-Path $GitPath -PathType Container)) {
    Write-Host ''
    Write-Host "  Toto je git worktree ($Root), nie hlavny checkout." -ForegroundColor Red
    Write-Host '  Zastupcu vytvor z C:\Aura\ovl-da-zliav — inak by ukazoval na priecinok,'
    Write-Host '  ktory po zmazani worktree zmizne.'
    Write-Host ''
    exit 1
}

$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$Link = Join-Path $StartMenu 'Aura Zľavy.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($Link)
$shortcut.TargetPath = $Target
$shortcut.WorkingDirectory = $Root
$shortcut.IconLocation = $IconPath
$shortcut.Description = 'Zľavy v e-shope — spustí appku a otvorí ju v prehliadači'
$shortcut.WindowStyle = 7          # start minimized; the window is only for messages
$shortcut.Save()

Write-Host ''
Write-Host '  Hotovo.' -ForegroundColor Green
Write-Host "  Zástupca: $Link"
Write-Host '  Nájdeš ho v Starte pod „Aura Zľavy". Prvé spustenie môže chvíľu trvať,'
Write-Host '  kým Docker zdvihne kontejnery.'
Write-Host ''
Write-Host '  Zmazaním toho jedného súboru sa zástupca odinštaluje — nič iné sa nikam nezapísalo.'
Write-Host ''
