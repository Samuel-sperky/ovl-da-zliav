# OVL-DA-ZLIAV

Lokálna Docker appka na ovládanie zliav v eshope Šperky cez API.

**Stav:** fáza kontextu — čaká na odpovede na `docs/00-KONTEXT-10-OTAZOK.md`.

## Dokumentácia

- `docs/00-KONTEXT-10-OTAZOK.md` — 10 smerovacích otázok pred 100-otázkovým dotazníkom
- `docs/api/sperky-api.md` — API dokumentácia eshopu (dodaná zadávateľom)

## Bezpečnostné hranice (zadanie)

- appka smie pracovať s **max 10 produktmi**
- **API kľúč nesmie zostať v repozitári** — rotácia, resp. zmazanie po 48 h
- lokálne nasadenie, Caddy pred appkou
