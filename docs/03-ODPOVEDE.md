# OVL-DA-ZLIAV — Odpovede zadávateľa na dotazník

**Dátum:** 2026-08-18 · **Podklad:** `docs/02-DOTAZNIK.md`
Zodpovedané interaktívne (16 rozhodujúcich otázok naprieč 4 kolami). Zvyšné otázky = navrhnuté defaulty z `02-DOTAZNIK.md`.

## Otvorené vstupy
- **DB:** **MariaDB** (kontajner `ovl-zliav-db`; SQLite lock problém odpadá).
- **Kľúč `product:edit`:** **zadávateľ ho má** — vloží sa cez formulár do `.env`.
- **Cieľ zápisu:** **len produkčný `https://sperky-eshop.sk`** — žiadny staging → dry-run default + potvrdenie sú jediná ochrana.
- **Zobrazovaný názov appky:** **„Aura Zľavy"** (repo ostáva `ovl-da-zliav`).

## Rozhodujúce odpovede
- **Q18 (fixné akcie):** na eshope sú **len percentuálne zľavy** → `setReduction` neprepisuje cudziu cenovú akciu; rizikový bod A **vyriešený**.
- **Q25 (marža):** **tvrdo blokovať** položky pod min. maржou po zľave (**default 15 %**); prejsť len explicitným override s dôvodom → audit.
- **Q19 (prekryv kampaní):** **blokovať pri armovaní** (nie tiché prepísanie).
- **Q45 (poistky produkcie):** **všetky tri** — denný strop zápisov + globálny kill-switch (read-only) + núdzové zrušenie všetkých appkou nasadených zliav.
- **Q17 (drift v scheduleri):** **re-validovať cez `getFull` tesne pred zápisom**, rizikové položky pozastaviť + notifikovať, zvyšok zapísať.
- **Q5 (potvrdenie zápisu):** **dvojkrok** + nad konfigurovateľný počet (default **50**) prepísať počet N alebo kontrolné slovo.
- **Q42/Q43 (GDPR):** ukladať len **agregáty na produkt**; audit natrvalo bez PII; **agregáty/snapshoty TTL ~90 dní** s auto-mazaním; export pred čistkou.
- **Q24 (odporúčania):** **áno v v1** — návrhový pohľad „čo zlevniť" (ležiaky, len agregáty, vždy cez dry-run).
- **Q1 (úvodná obrazovka):** **dashboard** s 3 pásmami (aktívne / expirujúce / naplánované) + stavový prúžok kľúča a rate-limitu.
- **Q13 (platforma):** **plne responzívne vrátane mobilu**; prístupnosť **WCAG 2.1 AA**.
- **Q6 (% v dávke):** **jedno % + okno na celú dávku, s override na jednotlivom riadku** (override vizuálne odlíšený).
- **Q11 (dátumy):** predvyplniť **from = dnes, to = dnes + 14 dní, % prázdne**; rýchle presety (7 dní / do konca mesiaca / Vianoce); zobrazenie `DD.MM.YYYY`, TZ `Europe/Bratislava`.

## Zvyšné otázky
Všetky ostatné otázky z `02-DOTAZNIK.md` sa berú podľa navrhnutého **defaultu** (riadok **Návrh:**), pokým zadávateľ nepovie inak.
