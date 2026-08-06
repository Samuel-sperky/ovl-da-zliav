# Aura Zľavy — RUNBOOKY (A14)

Prevádzkové postupy pre lokálne nasadenie. Vzťahujú sa na `docker-compose.yml`
v koreni repa a rozhodnutia D61, D62, D67, D76, D88–D100.

**Zásada I1:** žiadny krok v týchto runbookoch nikdy nevkladá tajomstvo do
repa. Všetky tajomstvá žijú v `secrets/` (je v `.gitignore`) alebo v `.env`
(tiež mimo gitu).

---

## R1. Prvý setup

Predpoklady: Docker + Docker Compose v2, Node 22 (na generovanie kľúčov).

1. **Klonuj repo a priprav priečinky:**
   ```sh
   mkdir -p secrets backups
   chmod 700 secrets backups
   ```

2. **Vygeneruj master key a session key (D61):**
   ```sh
   npm ci
   npm run gen-master-key            # zapíše secrets/master.key
   # session key — 64 náhodných hex znakov:
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))" > secrets/session.key
   chmod 400 secrets/master.key secrets/session.key
   # vlastníkom musí byť uid 10050 (non-root user appky v kontajneri):
   sudo chown 10050:10050 secrets/master.key secrets/session.key
   ```

3. **Vygeneruj DB heslá (D89) — náhodné, nikam ich neopisuj:**
   ```sh
   for f in db_root_password db_app_password db_mig_password; do
     node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))" > "secrets/$f"
     chmod 600 "secrets/$f"
   done
   ```

4. **Priprav `.env`** podľa `.env.example` (skopíruj a vyplň). `WRITES_ENABLED`
   nechaj na `false`, kým neprebehne celý onboarding (I13). Doména shopu do
   `.env` NEPATRÍ — zadáva sa v UI (R5, D80).

5. **Priprav Caddy (D94, D97):**
   ```sh
   cp Caddyfile.example secrets/Caddyfile
   docker run --rm caddy:2-alpine caddy hash-password --plaintext 'TVOJE-BASICAUTH-HESLO' > secrets/basicauth.hash
   chmod 600 secrets/Caddyfile secrets/basicauth.hash
   ```
   V `secrets/Caddyfile` nastav, aby sa hash načítal (env `OVL_ZLIAV_BASICAUTH_HASH`
   naplň z `/etc/caddy/basicauth.hash`, alebo hash vlož priamo do
   `secrets/Caddyfile` — ten je mimo gitu, takže je to povolené).

6. **Spusti stack:**
   ```sh
   docker compose up -d --build
   ```
   Entrypoint appky počká na DB a spustí migrácie migračným userom; ak
   migrácie zlyhajú, appka sa NESPUSTÍ (D88, I14) — pozri
   `docker compose logs ovl-zliav-app`.

7. **Vytvor DB userov a granty** — vykoná migrácia `0008_grants.sql`
   automaticky. Skontroluj, že app user nemá `UPDATE`/`DELETE` na `audit_log` (I4).

8. **Seed admina:**
   ```sh
   docker compose exec ovl-zliav-app node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /app/scripts/seed-admin.ts
   ```

9. **Smoke test:**
   ```sh
   curl -k https://localhost:3070/api/health    # očakávaj 200 (po basic auth)
   curl http://127.0.0.1:3000                   # MUSÍ zlyhať — app port nie je publikovaný (I5)
   ```

10. **Trust root certu** (nižšie R2), prihlás sa a prejdi onboardingom:
    doména → API kľúč → allowlist → testovací dry-run (D20).

11. **Nastav denné zálohy** (host cron, D90):
    ```
    15 3 * * * /cesta/k/repu/scripts/backup.sh >> /var/log/ovl-zliav-backup.log 2>&1
    ```

---

## R2. Trust root certifikátu Caddy (D94)

Caddy používa `tls internal` — vlastnú lokálnu CA. Aby prehliadač neprotestoval:

1. Vyexportuj root cert:
   ```sh
   docker compose cp ovl-zliav-caddy:/data/caddy/pki/authorities/local/root.crt .
   ```
2. **Windows:** dvojklik na `root.crt` → Install Certificate → Local Machine →
   „Place all certificates in the following store" → **Trusted Root
   Certification Authorities** → Finish. Reštartuj prehliadač.
3. **Linux:** `sudo cp root.crt /usr/local/share/ca-certificates/ovl-zliav-root.crt && sudo update-ca-certificates`.
4. Súbor `root.crt` po importe zmaž z pracovného adresára (je v `.gitignore`
   cez `*.crt`, ale poriadok je poriadok).

---

## R3. Upgrade (D100)

Zápisy MUSIA byť počas migrácie blokované — postup drž presne v tomto poradí:

1. **Záloha DB:** `scripts/backup.sh` (bez `api_key`, D76).
2. **Zastav appku** (Caddy a DB môžu bežať): `docker compose stop ovl-zliav-app`
   — tým sú zápisy fyzicky blokované.
3. **Stiahni novú verziu kódu** (git pull / checkout tagu).
4. **Build + up:**
   ```sh
   docker compose build ovl-zliav-app
   docker compose up -d ovl-zliav-app
   ```
   Entrypoint spustí migrácie fail-fast (D88); ak zlyhajú, appka nenabehne —
   NEOPAKUJ up naslepo, pozri logy a rieš manuálne (rollback je vždy manuálny).
5. **Smoke test:** `curl -k https://localhost:3070/api/health` → 200 a
   `scheduler.heartbeat` čerstvý.
6. Pri zlyhaní: obnov zálohu (R4) a vráť sa na predchádzajúci git tag.

---

## R4. Restore test zálohy (D90)

Spúšťaj aspoň raz mesačne:

```sh
scripts/restore-test.sh                 # najnovšia záloha
scripts/restore-test.sh backups/ovl_zliav-YYYYMMDD-HHMMSS.sql.gz
```

Skript: (1) overí, že záloha NEOBSAHUJE tabuľku `api_key` (D76, I1),
(2) obnoví dump do dočasnej DB `ovl_zliav_restore_test`, (3) vypíše počet
riadkov `audit_log`, (4) dočasnú DB zmaže. Nenulový exit = záloha je zlá —
rieš OKAMŽITE, nemáš funkčnú zálohu.

**Ostrá obnova** (havária): `docker compose stop ovl-zliav-app` → obnov dump do
`ovl_zliav` rovnakým postupom bez kroku 4 → `docker compose up -d`. Tabuľku
`api_key` vytvoria migrácie nanovo prázdnu — API kľúč treba zadať v UI znova
(zámerne, R2/D76).

---

## R5. Panic button — „KĽÚČ UNIKOL" (D67)

Ak existuje čo i len podozrenie, že shop API kľúč unikol:

1. **V UI:** Nastavenia → Panic button → zadaj heslo a opíš `KLUC UNIKOL`.
   Appka okamžite: wipne kľúč (prepis ciphertextu + zmazanie, D63), zruší
   všetky čakajúce kampane a zapíše audit event. Po incidente nič nebeží
   automaticky.
2. **Ak UI nie je dostupné:** `docker compose stop ovl-zliav-app` — kľúč má
   TTL max 48 h a bez appky sa nedá použiť; potom rieš krok 1 po nábehu.
3. **Kontaktuj maintainera shopu** a požiadaj o REVOKÁCIU kľúča na strane
   shopu — appka kľúč revokovať nevie, vie ho len zabudnúť.
4. Skontroluj audit log (posledné zápisy, filtre podľa dátumu) a admin shopu,
   či medzitým neprebehli neočakávané zmeny zliav.
5. Po revokácii vygeneruj v shope nový kľúč (scope výhradne `product:edit`, R8)
   a zadaj ho v UI. Skontroluj kampane v stave `needs_key`.

---

## R6. Rotácia master key (D62)

Tooling na rotáciu zámerne neexistuje — postup je „zahoď a zadaj znova":

1. V UI over, že nebeží žiadny zápis; ideálne po expirácii/wipe API kľúča.
2. `docker compose stop ovl-zliav-app`.
3. Vygeneruj nový key: `npm run gen-master-key` (prepíše `secrets/master.key`;
   starý sa tým zahodí — šifrovaný API kľúč v DB sa stane nedešifrovateľným,
   čo je v poriadku).
4. `chmod 400 secrets/master.key && sudo chown 10050:10050 secrets/master.key`.
5. `docker compose up -d ovl-zliav-app` — appka pri prvom prístupe ku kľúču
   zistí nedešifrovateľný záznam, wipne ho a vyžiada nový API kľúč v UI.
6. Zadaj API kľúč v UI znova. Skontroluj kampane v stave `needs_key`.

---

## R7. Diagnostika

| Symptóm | Kde pozrieť |
| --- | --- |
| appka nenabieha | `docker compose logs ovl-zliav-app` — boot assertions vypíšu presnú príčinu (env, master key, migrácie, PUBLIC_BIND) a proces skončí (I14) |
| 502 z Caddy | `docker compose ps` — healthcheck appky; Caddy štartuje až po healthy app |
| „scheduler naposledy pred X min" červené | `docker compose restart ovl-zliav-app`; heartbeat je v DB (`scheduler_state`) |
| „ZÁPISY ZAMKNUTÉ" | runaway strop 60 zápisov/h (D79) — odomknúť heslom v Nastaveniach, predtým zisti z auditu, ČO tie zápisy generovalo |
| zabudnuté admin heslo | `docker compose exec ovl-zliav-app node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /app/scripts/seed-admin.ts` (reset) |
