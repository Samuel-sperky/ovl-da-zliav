# Aura Zľavy — RUNBOOKY (A14)

Prevádzkové postupy pre lokálne nasadenie. Vzťahujú sa na `docker-compose.yml`
v koreni repa a rozhodnutia D61, D62, D67, D76, D88–D100 (dotazníkové) a
D98–D105 z 27. 8. 2026 (sprint „bez prihlásenia"; čísla kolidujú, viď úvod
`docs/10-KONTRAKT.md`).

**Appka nemá prihlásenie** (D98–D100, 27. 8. 2026). Žiadny krok nižšie nepýta
heslo do appky, negeneruje bcrypt hash pre Caddy a neseeduje admina — tie kroky
tu stáli do 27. 8. 2026 a sú zrušené, nie presunuté.

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

2. **Vygeneruj master key a podpisový („session") key (D61, O2):**

   `secrets/session.key` sa menuje po session, ktorá už neexistuje (D99), ale
   **potrebný je ďalej**: podpisuje PREVIEW TOKEN (O2), teda tú mašinériu, ktorá
   po zrušení sudo drží I3. Nevynechaj ho a nemaž ho.
   ```sh
   npm ci
   npm run gen-master-key            # zapíše secrets/master.key
   # podpisový key — 64 náhodných hex znakov:
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
   nechaj na `false`, kým nie je nastavená doména, kľúč a rozsah (I13). Doména
   shopu do `.env` NEPATRÍ — zadáva sa v UI (R5, D80).
   `SESSION_ABSOLUTE_HOURS`, `SESSION_IDLE_MINUTES`, `SUDO_WINDOW_MINUTES`,
   `LOGIN_MAX_ATTEMPTS` a `LOGIN_WINDOW_MINUTES` appka od 27. 8. 2026 **nečíta**
   (D99, D100) — keď ich v `.env` nájdeš, nič nerozbijú, len sú mŕtve.

5. **Priprav Caddy (D94):**
   ```sh
   cp Caddyfile.example secrets/Caddyfile
   chmod 600 secrets/Caddyfile
   ```
   Je to **doslovná kópia** — nič sa v nej nedopĺňa a nič sa nepýta.
   `basic_auth` zrušila D98 (27. 8. 2026, ruší D97) a s ňou padol aj
   `secrets/basicauth.hash`; `Caddyfile.example` ani `scripts/setup-local.{sh,ps1}`
   ten blok už nevyrábajú. Ak máš `secrets/Caddyfile` z inštalácie pred
   27. 8. 2026, blok `basic_auth` v ňom **zmaž ručne** — súbor je mimo gitu (I1),
   takže ho žiadna zmena v repe neprepíše, a dialóg pred appkou už nemá čo chrániť.

6. **Spusti stack:**
   ```sh
   docker compose up -d --build
   ```
   Entrypoint appky počká na DB a spustí migrácie migračným userom; ak
   migrácie zlyhajú, appka sa NESPUSTÍ (D88, I14) — pozri
   `docker compose logs ovl-zliav-app`.

7. **Vytvor DB userov a granty** — vykoná migrácia `0008_grants.sql`
   automaticky. Skontroluj, že app user nemá `UPDATE`/`DELETE` na `audit_log` (I4).

8. **Seed admina sa už nerobí.** Krok „spusti `scripts/seed-admin.ts`" tu stál
   do 27. 8. 2026; D99 heslá zmazalo a skript s nimi. Riadok lokálneho actora
   v tabuľke `users` **nevytvára žiadna migrácia** — `db/` na to nemá ani jeden
   `INSERT INTO users`. Vyrobí ho až appka sama pri prvom zápise, funkciou
   `resolveLocalActor()` v `src/lib/auth/local-actor.ts` (D102). Nič nezadávaš,
   ale vedz, čo tam nájdeš:
   - **existujúca inštalácia** (bežala ešte s prihlásením) má v `users` riadok
     `samuel` s `id 1` — appka si dohľadá riadok s najnižším `id` a nikdy ho
     neprepíše, takže audit má kontinuitu (D101);
   - **čerstvá inštalácia** má tabuľku prázdnu a appka si vyrobí riadok
     s neutrálnym menom `local` (konštanta `FRESH_INSTALL_USERNAME`), nie
     `samuel` — jednoužívateľský nástroj si nemá vymýšľať meno človeka.

9. **Smoke test:**
   ```sh
   curl http://localhost:3070/api/health        # 200, bez akéhokoľvek dialógu (D98)
   curl http://127.0.0.1:3000                   # MUSÍ zlyhať — app port nie je publikovaný (I5)
   ```

10. **Trust root certu** (nižšie R2) a nastav appku: otvor `http://localhost:3070`
    (žiadne prihlásenie, D98–D100) a prejdi prázdnymi stavmi na Prehľade v
    poradí doména → API kľúč → povolené produkty → testovací dry-run.
    Sprievodca podľa D20 v architektúre V3 neexistuje.

11. **Nastav denné zálohy** (host cron, D90):
    ```
    15 3 * * * /cesta/k/repu/scripts/backup.sh >> /var/log/ovl-zliav-backup.log 2>&1
    ```

---

## R1w. Prvý setup na Windows (Docker Desktop)

Overené 6. 8. 2026 na Windows 11 + Docker Desktop 29.6, celý stack nabootoval.
Postup je rovnaký ako R1, ale Windows má tri pasce, ktoré R1 nepokrýva.

1. **Konce riadkov.** Pri `core.autocrlf=true` dostanú shell skripty CRLF a
   kontajner padne na `exec /app/scripts/entrypoint.sh: no such file or
   directory` — shebang s `\r` nie je platná cesta. To isté platí pre
   `scripts/db-init/`, ktoré sa mountuje do MariaDB. Rieši to `.gitattributes`
   (`*.sh text eol=lf`); v už pokazenom klone stačí:
   ```sh
   git add --renormalize . && git checkout -- .
   ```

2. **Práva tajomstiev.** Boot assertion (D61, I14) vyžaduje na `master.key`
   práva 400. Docker Desktop u bind mountov unixové práva neprenáša a hlási
   777, takže appka v `NODE_ENV=production` odmietne nabootovať s
   `boot_assertions_failed`. Invariant sa **neoslabuje** — tajomstvá sa načítajú
   z named volume na linuxovom FS, kde práva 400 reálne platia:
   ```powershell
   cp docker-compose.override.windows.example.yml docker-compose.override.yml
   .\scripts\sync-secrets-volume.ps1        # naplní volume, chmod 400, chown 10050
   ```
   V `.env` musia `MASTER_KEY_FILE`, `SESSION_SECRET_FILE`, `DB_PASSWORD_FILE`
   a `DB_MIGRATION_PASSWORD_FILE` ukazovať do `/run/keys/` (nie `/run/secrets/`)
   — compose zoznamy `volumes:` zlučuje pridávaním, takže bind mounty z
   `docker-compose.yml` sa nedajú odstrániť a mount na to isté miesto by 777
   práva vrátil späť. **Po každej rotácii kľúča spusti skript znova.**

3. **PowerShell 5.1 a diakritika.** `powershell.exe` číta skripty bez BOM ako
   ANSI a parsovanie sa na diakritike rozsype. `.ps1` v repe preto majú UTF-8
   BOM (drží to `.gitattributes`). Ak si skript upravíš iným editorom, ulož ho
   s BOM, alebo použi `pwsh` (PowerShell 7).

4. **Migračný DB user.** Init skript beží len na PRÁZDNOM volume. Ak si stack
   skúšal s pokazenými koncami riadkov, urob raz `docker compose down -v` —
   dovtedy migrácie aj tak nikdy neprebehli, takže o nič neprídeš.

5. Krok „seed admina spúšťaj v normálnom termináli, maskovanie hesla potrebuje
   TTY" tu stál do 27. 8. 2026. Padol s heslami (D99) — na Windows teda o jednu
   pascu menej.

Smoke test na Windows (HTTP bez TLS, odchýlka od D94 z 6. 8. 2026):
```powershell
curl.exe http://localhost:3070/api/health                              # 200, {"db":true}
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3070/api/health  # 200 — appka nemá prihlásenie (D98–D100)
```
Do 27. 8. 2026 tu druhý riadok očakával `401` bez basic auth. Ak `401` vidíš
dnes, v `secrets/Caddyfile` ti zostal blok `basic_auth` — viď R1 krok 5.

---

## R1s. Zapnutie predajnosti (kľúč `orders:read`)

Predajnosť je samostatná schopnosť: appka číta objednávky shopu, aby vedela,
koľko KUSOV ktorého produktu sa predalo. Kontrakt:
`KONTRAKT-PREDAJNOST-2026-08-06.md`.

1. **Vyžiadaj si od maintainera shopu kľúč so scope `orders:read`.** Zápisový
   kľúč (`product:edit`) na to nestačí a naopak — sú to dva rôzne kľúče a
   appka ich drží oddelene (`api_key.kind`).
2. V **Nastaveniach** appky vlož kľúč do formulára „kľúč na čítanie predajov".
   Heslo si nevyžiada — sudo okno tu stálo do 27. 8. 2026 a zrušila ho D100.
   Bránou zostáva to, čo ňou naozaj bolo: appka kľúč **overí proti shopu ešte
   pred uložením** — keď shop čítanie objednávok odmietne (403), kľúč sa NEULOŽÍ
   a dozvieš sa to.
3. Platnosť je **30 dní** (`ORDERS_KEY_TTL_DAYS`), nie 48 hodín ako pri
   zápisovom kľúči. Je to vedomá odchýlka (rozhodnutie P2): kľúč je len na
   čítanie a objednávkové endpointy nevracajú žiadne osobné údaje — len id,
   dátum, sumu, menu, položky a krajinu. Po expirácii sa kľúč zmaže sám a
   synchronizácia sa tichým spôsobom zastaví (v logu `sales_sync_skipped`
   s dôvodom `no_orders_key`).
4. Synchronizácia sa spustí **sama** pri najbližšom ticku schedulera a potom
   najskôr o 20 hodín. Nie je viazaná na nočnú hodinu zámerne — appka beží na
   pracovnom počítači, ktorý v noci býva vypnutý.
5. Sleduj prvý beh: `docker compose logs -f ovl-zliav-app` a hľadaj
   `sales_sync_done`. Prvý beh stiahne okno `SALES_WINDOW_DAYS` (default 3 dni)
   a trvá jednotky minút.

**Prečo je okno len 3 dni.** Zoznam objednávok nevracia položky, takže na
predaje jedného produktu treba **jeden request na jednu objednávku**. Zmerané
6. 8. 2026: 3 dni = 978 objednávok, celý shop 1 765 576. Deväťdesiat dní by
bolo ~29 000 requestov proti produkčnému eshopu. Shop navyše dovoluje
**300 requestov / 60 s na kľúč**, preto je medzi requestami pauza
`ORDERS_PAUSE_MS` (default 250 ms, minimum 250 ms — 240 requestov/min je pod
limitom aj pri nulovej latencii) a strop
`ORDERS_MAX_REQUESTS_PER_RUN` (default 1500) na jeden beh.

Okno sa dá rozšíriť (`SALES_WINDOW_DAYS`), ale rob to po malých krokoch a
sleduj `sales_sync_state`. Dôsledok krátkeho okna, ktorý appka priznáva aj v
UI: produkt, ktorý sa predáva raz za týždeň, vyzerá na začiatku ako
nepredávaný. História sa dopĺňa každým behom, takže pokrytie časom rastie samo.

**Čo predajnosť NIE JE.** Nie je to obrátkovosť — na tú treba COGS a zásobu
nevariantných produktov a shop API ani jedno neposkytuje (požiadavky sú v
`docs/20-BACKLOG-SHOP-API.md`). A nie je to obrat: `total_paid` patrí celej
objednávke, nie položke, takže peniaze na produkt priradiť NEMOŽNO. Appka
preto meria výhradne kusy.

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
5. **Smoke test:** `curl http://localhost:3070/api/health` → 200 a
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

1. **V UI:** Nastavenia → Panic button → opíš presnú frázu `KLUC UNIKOL`.
   Heslo sa tu zadávalo do 27. 8. 2026 (D99); potvrdenie akcie NEZMIZLO — fráza
   sa musí prepísať ručne, takže nevratné dopálenie kľúča nejde jedným klikom.
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
| „ZÁPISY ZAMKNUTÉ" | runaway strop 60 zápisov/h (D79) — odomknúť v Nastaveniach zaškrtnutím výslovného potvrdenia (heslo tam stálo do 27. 8. 2026, D99); predtým zisti z auditu, ČO tie zápisy generovalo |
| appka pýta heslo alebo basic auth dialóg | nemá čo — prihlásenie zrušili D98–D100 (27. 8. 2026). Skontroluj `secrets/Caddyfile` na zabudnutý blok `basic_auth` (R1 krok 5) |
