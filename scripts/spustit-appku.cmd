@echo off
rem Aura Zľavy — double-clickable wrapper for spustit-appku.ps1.
rem
rem A .ps1 does not run on double-click (Windows opens it in an editor), so the
rem Start-menu shortcut points here. -ExecutionPolicy Bypass applies to this one
rem process only; it changes nothing on the machine.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0spustit-appku.ps1"
