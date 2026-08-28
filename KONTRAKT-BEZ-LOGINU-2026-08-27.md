# Kontrakt — Aura Zľavy bez prihlásenia (27. 8. 2026)

Vetva: `feat/bez-loginu` · Zadal: Samuel · Rozsah odsúhlasený 27. 8. 2026

## 1. Prečo

Appka je jednoužívateľský lokálny nástroj na jednom PC. Prihlásenie do nej bolo
**trojvrstvové** a všetky tri vrstvy chceli to isté heslo:

1. Caddy `basic_auth` (D97) — prehliadačový dialóg pred appkou.
2. App session (D69) — `/login`, meno + heslo (min. 12 znakov), 42 rút `auth: 'session'`.
3. sudo (D70) — to isté heslo **znova** pred ostrým zápisom, 8 rút `auth: 'sudo'`.

Samuel 27. 8. 2026: *„celý ten login je zlý a len mi sťažuje cestu k používaniu,
je to len lokálna aplikácia tu na PC."* Rozhodnutie je jeho a je informované —
dôsledky nižšie mu boli povedané pred schválením, vrátane nevratnosti.

## 2. Čo prihlásenie NECHRÁNILO (a preto sa jeho zrušením nič nestráca)

Overené čítaním kódu, nie predpokladom:

- **I5** — publikovaný je len `127.0.0.1:3070` (Caddy). Zo siete sa k appke
  nedostane nikto, nech je login akýkoľvek. Toto zostáva nedotknuté.
- **D72 origin check** (`checkOrigin()` v `define-route.ts`) — každá mutácia
  potrebuje hlavičku `Origin`, ktorá sa presne rovná hostu požiadavky. Beží
  **nezávisle od auth vrstvy**, takže cudzia webstránka do appky nezapíše ani
  bez prihlásenia. Toto zostáva nedotknuté a je to strážené novým testom (§6).

## 3. Čo sa zrušením prihlásenia STRÁCA (povedané nahlas)

**Ktorýkoľvek lokálny proces na tomto PC bude vedieť zapísať zľavy do
produkčného eshopu jedným HTTP POST-om.** Hlavičku `Origin` si vie dosadiť
ľubovoľne — D72 je obrana proti prehliadačom, nie proti lokálnym skriptom. Dnes
mu v tom bráni session cookie, ktorú nemá.

Miera rizika: kto vie čítať tento disk, dostane sa aj k `MASTER_KEY_FILE`
a k šifrovanému API kľúču, takže sa nemení „nedobytné → dobytné", ale
„musí ukradnúť tajomstvo zo disku → stačí mu jeden request".

Samuel toto riziko prijal 27. 8. 2026.

### 3b. Doplnenie 28. 8. 2026 — riziko bolo širšie, než tu stálo

Overenie sprintu našlo, že **veta „musí ukradnúť tajomstvo zo disku → stačí mu
jeden request" nebola pravdivá.** Štyri akcie mali okrem sudo aj **heslo v tele
požiadavky** a to heslo bolo ich JEDINÁ brána:

| Akcia | Čo tým lokálny proces získal |
|---|---|
| `PUT /api/settings/domain` | prepíše adresu shopu → zápisová cesta pošle **dešifrovaný produkčný API kľúč** v `X-Api-Key` na jeho host. Kľúč sa dá vyniesť **bez akéhokoľvek prístupu k `secrets/`.** Canary to nezastaví: je `phase: 'read'` bez kľúča, cudzí host si ju uspokojí sám. |
| `DELETE /api/key` | zmaže oba kľúče a zruší všetky čakajúce kampane |
| `POST /api/settings/unlock-writes` | odomkne runaway zámok |
| `POST /api/settings/scope-mode` | `pilot → plný` zdvihne strop z 10 na 10 000 produktov na jednu zľavu |

I3 sa týka zápisu zliav, takže formálne porušený nebol — a práve preto to
prekĺzlo: invariant o týchto štyroch cestách mlčí. **D106 brány obnovilo** ako
zaškrtávacie potvrdenie a sú strážené mutačne overenými testami (§7).

Poučenie do budúcna: keď sa ruší autentifikácia, treba prejsť KAŽDÚ mutáciu
a spísať, čo ju drží po zrušení — nie iba tie, ktoré menuje invariant.

## 4. Rozhodnutia

| # | Rozhodnutie | Dôvod |
|---|---|---|
| **D98** | Caddy `basic_auth` sa z `secrets/Caddyfile` odstraňuje. **D97 sa ruší.** | Čistý duplikát pred appkou, ktorá mala vlastnú bránu. Nechránil nič, čo nechráni I5. |
| **D99** | App session, `/login`, heslá a lockout sa **mažú z kódu**, nie vypínajú prepínačom. D68, D69, D71 sa rušia. | Voľba Samuela z dvoch ponúknutých variantov. Prepínač v `.env` bol odmietnutý. |
| **D100** | sudo sa ruší. **D70 sa ruší. Invariant I3 sa mení** z „žiadny zápis bez dry-runu + potvrdenia + sudo" na **„žiadny zápis bez dry-runu + potvrdenia"**. | Voľba Samuela. Dry-run a potvrdenie v UI zostávajú a sú strážené testom. |
| **D101** | Tabuľka `users` a jeden riadok v nej (`samuel`, id 1) **zostávajú**. DB sa nemení vôbec. | `campaigns.created_by` a `audit_log.user_id` majú FK na `users(id)` `ON DELETE RESTRICT`. Bez `users` by sa nedala zapísať kampaň ani audit riadok. Žiadna migrácia = žiadne riziko na dátach. |
| **D102** | Každý zápis a každý audit riadok sa pripisuje **lokálnemu actorovi** (`samuel`, id 1) z nového `src/lib/auth/local-actor.ts`. | Audit trail nesmie stratiť zmysel len preto, že zmizlo prihlásenie (I11 — „nevieme" je horšie než odpoveď). |
| **D103** | `ctx.claims` v `defineRoute()` sa mení na `ctx.actor` (`{ id, username }`). Vlastnosť `auth:` z `RouteDefinition` **zmizne**. | 53 rút ju deklarovalo. Odstránenie z typu spôsobí TS chybu na každom mieste, ktoré sa zabudne — typecheck je dôkaz úplnosti, nie moja pamäť. |
| **D104** | Závislosť `argon2` sa odstraňuje z `package.json`. | Bez hesiel ju nič nepotrebuje. Vedľajší efekt: v git worktree padali VŠETKY route integračné testy na importe `argon2.glibc.node` (blokuje ho Windows Application Control) — táto trieda bolesti zmizne. |
| **D105** | Slovník prekážok (`src/lib/status/blockers.ts`) a UI texty prestávajú sľubovať heslo: prekážka `sudo` sa mení na `potvrdenie`. | Po D99/D100 žiadne heslo neexistuje a zámok, ktorý sa nemá čím otvoriť, je klamstvo v UI. Dôsledok D100. |
| **D106** | **Uvoľňujúce mutácie v Nastaveniach dostávajú bránu späť — zaškrtávacím potvrdením, nie heslom.** `PUT /api/settings/domain` a `POST /api/settings/scope-mode` (len pri UVOĽNENÍ) žiadajú `confirmed: true`; `unlock-writes` ho má z D99, `DELETE /api/key` má literál `KLUC UNIKOL`. Sprísnenie rozsahu zostáva voľné. | §3 popisovalo riziko užšie, než aké bolo — viď §3 doplnenie. Voľba Samuela 28. 8. 2026 z troch variantov. Nie je to návrat prihlásenia (D99 platí): nič sa nepamätá, nič nezadáva, len raz zaškrtne. |
| **D107** | Mŕtve prihlasovacie tajomstvá sa mažú z disku: `secrets/basic-auth.txt`, `secrets/app-admin.txt`, `secrets/Caddyfile.bak-2026-08-27`. | Po D98/D99 nechránia nič. §3 obhajuje riziko vetou „kto vie čítať tento disk" — heslo tam nemá ležať bez dôvodu. Netrackované (I1). Potvrdil Samuel 28. 8. 2026. |

## 5. Čo sa maže (zoznam je normatívny)

Súbory: `src/middleware.ts` · `src/app/login/` · `src/app/api/auth/{login,logout,sudo,bootstrap}/` ·
`src/lib/auth/{login,password,session,sudo,lockout,lockout-policy}.ts` ·
`src/lib/repo/login-attempts.repo.ts` · `src/components/ui/SudoPrompt.tsx` ·
`src/components/settings/SignOut.tsx` · `src/lib/ui/first-run.ts`

Zostáva a mení sa: `src/lib/repo/users.repo.ts` (len dohľadanie lokálneho actora) ·
`src/app/api/auth/session/route.ts` → hlási lokálneho actora bez expirácií a bez sudo.

## 6. Akceptačné kritériá

| # | Kritérium | Ako sa dokazuje |
|---|---|---|
| K1 | `http://localhost:3070/` vráti appku bez akéhokoľvek dialógu | curl 200 + preklik v prehliadači so screenshotom |
| K2 | Žiadna cesta v appke nevedie na `/login` a `/login` neexistuje | `grep` + 404 |
| K3 | Zápis do produkcie ide bez hesla, ale **NEIDE bez dry-runu a potvrdenia** | test `no-write-without-confirm.spec.ts` musí zostať zelený; mutačne overený |
| K4 | **Origin check ďalej odmietne mutáciu s cudzím `Origin`** | nový test; mutačne overený (odstránenie `checkOrigin` ho musí zčervenať) |
| K5 | Kampaň aj audit riadok sa zapíšu s `user_id = 1` | integračný test nad DB |
| K6 | `argon2` nie je v `package.json` ani v `src/` | `grep` |
| K7 | Celý balík testov zelený, žiadny `.skip` pridaný kvôli tomuto sprintu | `npm test` výstup v reporte |
| K8 | DB schéma nezmenená | `git diff db/` je prázdny |

## 7. Výsledok (28. 8. 2026)

### Stav brány kvality

`npm run typecheck` 0 chýb · `npm run lint` 0 chýb · `npm test` **163/163 súborov,
3147/3147 testov** zelených · `npm run check-compose-bind` OK (I5) ·
`npm run test:build` 9/9 · `docker compose build` prechádza a appka je nasadená.

Balík bol počas sprintu opakovane hlásený ako flaky. **Nie je.** Pády mali vždy
signatúru `SqlError 1062 Duplicate entry '1' for key 'PRIMARY' — INSERT INTO
settings (id) VALUES (1)`, teda kolíziu s cudzím `truncateAll()`: proti jednej
testovacej MariaDB bežalo viac agentov naraz. V izolovanom behu je balík zelený
stabilne. **Žiadny report z `npm test` v tomto strome nie je dôkaz, ak súčasne
beží iný vitest.**

### Akceptačné kritériá

| # | Verdikt | Dôkaz |
|---|---|---|
| K1 | **splnené** | `curl -i http://localhost:3070/` → `200`, bez hlavičky `WWW-Authenticate`. Preklik: appka sa otvorí priamo na Prehľade, žiadny dialóg ani obrazovka prihlásenia. **Screenshoty NEEXISTUJÚ** — panel prehliadača nebol zobrazený (`Screenshot timed out: the Browser pane is not displayed`), dôkazom sú HTTP hlavičky a textové výpisy obrazoviek. |
| K2 | **splnené** | `/login` → `404`, rovnako `/api/auth/{login,logout,session,sudo,bootstrap}`. `grep -rn "/login" src/` vracia len dva historické komentáre. `src/app/login/` ani `src/middleware.ts` neexistujú. |
| K3 | **splnené, mutačne overené** | `no-write-without-confirm.spec.ts` zelený. Dve nezávislé mutácie produkčného kódu ho zčervenali: neutralizované `assertConfirmed()` (5 pádov) a obídené `previewTokens.verify()` (6 pádov). Test teda drží OBE nohy I3. |
| K4 | **splnené, mutačne overené** | `origin-check-po-loginu.spec.ts` zelený; odstránenie `checkOrigin()` z `define-route.ts` zčervenalo práve tie dva testy, ktoré merajú, že sa zámok NEOTVORIL. |
| K5 | **splnené** (dodatočne) | Prvá verzia sprintu K5 **nesplnila**: všetky tvrdenia `userId: 1` boli kruhové — harness si actora podstrčil a test overil hodnotu, ktorú si sám dal. Navyše `ExecuteOptions.userId` bolo deklarované a **nikde nečítané**, takže audit riadky `write_ok`/`write_failed` mali `user_id = NULL` práve tam, kde dokladujú zápis do produkcie. Zavreté novým `test/integration/lokalny-actor-zapisova-cesta.spec.ts` (7 testov nad skutočnou MariaDB, produkčný `resolveLocalActor()` bez stubu) — dokazuje SELECT-om, že `campaigns.created_by = 1` a `audit_log.user_id = 1` na KAŽDOM riadku. Mutačne overené. |
| K6 | **splnené** | `grep -rn argon2 package.json src/` → v `package.json` nič, v `src/` len komentáre. Zmizol aj posledný živý výskyt `$argon2id$` (mŕtve `upsertAdmin()`). `package-lock.json` pregenerovaný. |
| K7 | **splnené** | 3147/3147 zelených, exit 0. `git diff` neobsahuje ani jeden pridaný `.skip`/`.todo`/`.only`; 18 existujúcich `describe.skipIf(!available)` je brána dostupnosti DB z pred sprintu, ktorá bez `ALLOW_SKIP_DB_TESTS=1` hádže, nie preskakuje. |
| K8 | **splnené** | `git status --porcelain -uall db/` aj `git diff db/` prázdne. Migrácie `0001`–`0013` nedotknuté, žiadna nová. D101 dodržané. |

### Odchýlky od §5 (normatívny zoznam)

1. `src/app/api/auth/session/route.ts` §5 radil do „zostáva a mení sa" — je
   **zmazaný**. V `src/` nemá konzumenta, runtime sa nerozbil.
2. `src/lib/ui/first-run.ts` §5 radil do „maže" — bol **premenovaný** na
   `src/lib/ui/action-failure.ts` so zúženým obsahom a novým testom.

### Čo sprint našiel nad rámec zadania

- **D106** — štyri mutácie stratili spolu s heslom svoju jedinú bránu, vrátane
  cesty k vyneseniu produkčného API kľúča (§3b). Brány obnovené a strážené.
- **D107** — mŕtve prihlasovacie tajomstvá zmazané z disku.
- **Dockerfile bol rozbitý** a appka sa v strome vôbec nedala zbuildiť:
  `COPY node_modules/{argon2,@phc,node-gyp-build,node-addon-api}` po D104 padal
  na `failed to compute cache key`. Kým to platilo, K1 ani K2 sa nedali dokázať.
- **`Caddyfile.example` a `scripts/setup-local.{ps1,sh}`** basic auth ďalej
  VYRÁBALI, takže D98 platilo len pre existujúcu inštaláciu, nie pre čerstvý
  setup. Opravené vrátane runbooku R1/R1w.
- **`npm run e2e` a `npm run test:build`** sa po sprinte ani nenačítali
  (prihlasovanie na zmazané `/login`, import odstráneného `argon2`). Opravené.
- **Runbook R1 krok 8 bol nepravdivý** — tvrdil, že riadok lokálneho actora
  vytvorí migrácia. `grep -riE 'insert into users' db/` je prázdny; na čerstvej
  inštalácii ho vyrobí `resolveLocalActor()` a pomenuje `local`, nie `samuel`.
- **Čítacia cesta sa stala zápisovou.** `resolveActor()` bežal pred handlerom
  na KAŽDEJ route, takže `GET /api/health` pri nedostupnej DB vracal 500 —
  hoci sám sľuboval, že to nikdy neurobí — a na čerstvej inštalácii `INSERT`-oval
  do `users`. Actor je odteraz eager len na mutácii, na čítaní lazy.
- **Mŕtvy odkaz „Odhlásenie"** na rozcestníku Nastavení. Našiel ho preklik
  v prehliadači, nie test: `nastavenia-v12.spec.ts` si tú kotvu z kontroly
  identifikátorov výslovne vyňal s tým, že „kryje ju e2e" — a e2e ju nekryla.
  Výnimka je zrušená.

### Otvorené (vedome, mimo rozsahu tohto sprintu)

1. **`rateLimit` sa vyhodnocuje PRED `checkOrigin`.** Cudzia stránka, ktorej
   mutáciu origin check odmietne, stihne spotrebovať bucket — 7 cross-origin
   POST-ov na `/api/queue/resume` (limit 6/min) zablokuje legitímne obnovenie
   fronty na minútu. Neopravené zámerne: poradie vrstiev je normatívne v
   BUILD-SPEC §5 a zmena by sa dotkla bezpečnostnej semantiky všetkých rút.
   Lacnejšia varianta: bucket nespotrebovať, keď origin check odmietne.
2. **10 predexistujúcich pádov v `test/e2e`**, ktoré s prihlásením nesúvisia —
   zastarané očakávania voči rozdeleniu Nastavení na podstránky (commit
   `8eeb8eb`, 19. 8. 2026) a dátumovo závislé tvrdenia.
3. **Audit riadky zo schedulera majú `user_id = NULL`** (`actor: 'scheduler'`).
   Je to pravdivé tvrdenie — dávku nespustil človek — ale formulácia D102
   („každý audit riadok") sa dá čítať aj inak. Patrí to kontraktu, nie úsudku.
4. **Dva staré `git worktree`** v `.claude/worktrees/` so zastaralými kópiami
   `docs/` a `README`; každý grep naprieč repom vracia staré fakty dvakrát.
