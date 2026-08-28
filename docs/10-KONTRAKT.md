# Aura Zľavy (ovl-da-zliav) — KONTRAKT

**Verzia:** 1.0 · **Dátum:** 2026-08-05 · **Branch:** `claude/local-eshop-discount-app-qm5fzg`
**Stav:** UZAVRETÉ — jediný zdroj pravdy pre implementáciu

## Ako sa tento dokument používa

Tento dokument je **register všetkých rozhodnutí**. Každý implementačný agent sa
riadi výhradne ním a technickou špecifikáciou `11-BUILD-SPEC.md`. Ak sa
rozhodnutie tu nenachádza, agent ho **nesmie vymyslieť potichu** — buď ho odvodí
z INVARIANTOV (sekcia I) fail-closed smerom, alebo ho zapíše do sekcie
„Otvorené" v `12-SPRINT-PLAN.md` a implementuje najkonzervatívnejší variant.

Značenie:
- **R1–R10** — rámcové rozhodnutia z `00-KONTEXT-10-OTAZOK.md`
- **D1–D100** — rozhodnutia z `01-DOTAZNIK-100-OTAZOK.md` / `02-ODPOVEDI-100-OTAZOK.md`
  (číslo D sa rovná číslu otázky, aby krížové odkazy fungovali)
- **D98–D108 (27.–28. 8. 2026)** — rozhodnutia sprintu „bez prihlásenia" z
  `KONTRAKT-BEZ-LOGINU-2026-08-27.md`; žijú v sekcii **F2**
- **I1–I14** — invarianty (nadradené všetkému ostatnému)
- **B1–B4** — backlog na maintainera shopu

Sloveso **MUSÍ / NESMIE** je normatívne. Kde je uvedený variant (napr. `38b`),
ide o zvolenú možnosť z dotazníka.

> **Kolízia čísel — čítaj pozorne (27. 8. 2026).** Sprint „bez prihlásenia" si
> vzal čísla D98–D108, takže **D98, D99 a D100 existujú v tomto dokumente
> dvakrát**: v sekcii F pôvodné z dotazníka (kontajner hardening / CI / upgrade
> runbook) a v sekcii F2 nové (Caddy `basic_auth` / app session / sudo). Kód
> cituje obe sady — `src/lib/scheduler/pause.ts` píše „upgradom podľa D100"
> (sekcia F), `src/lib/http/define-route.ts` píše „D100 zrušilo sudo"
> (sekcia F2). Čísla sa **neprečíslovávajú**: prepísalo by to desiatky odkazov
> v kóde aj v dokumentoch. Pri odkaze na D98–D100 rozhoduje kontext; keď je
> pochybnosť, uveď k číslu aj dátum.

---

## A. Rámcové rozhodnutia (R1–R10)

| Č. | Rozhodnutie | Ref. |
| --- | --- | --- |
| R1 | Appka MUSÍ držať v DB allowlist maximálne 10 konkrétnych product ID a MUSÍ fail-closed odmietnuť akékoľvek ID mimo allowlistu ešte pred volaním shop API; jedna operácia MUSÍ zapisovať maximálne 10 produktov. | ot. 1 |
| R2 | API kľúč sa MUSÍ zadávať výhradne v UI, ukladať šifrovane (AES-256-GCM) s TTL 48 h a po expirácii automaticky wipovať; kľúč NESMIE byť nikdy v repozitári, v `.env`, v obraze ani v zálohe. | ot. 2 |
| R3 | Appka MUSÍ byť postavená na Node 22 + Next.js 16 (App Router, `output: 'standalone'`) + React 19 + TypeScript + MariaDB 11.4 s numerovanými migráciami a `defineRoute()` pipeline (auth → rateLimit → zod → handler). | ot. 3 |
| R4 | Appka MUSÍ byť dostupná výhradne lokálne — jediný publikovaný port `127.0.0.1:3070` obsluhuje Caddy (security hlavičky); tunel ani verejná expozícia sa NESMIE konfigurovať. Dve veci z pôvodného znenia už neplatia: TLS je od 6. 8. 2026 vedome vypnuté (HTTP na 127.0.0.1) a `basic auth` zrušila **D98 z 27. 8. 2026**. Lokálnosť portu je invariant I5 a tou sa nič nemení. | ot. 4 |
| R5 | Appka MUSÍ považovať `sperky-eshop.sk` za produkčný shop bez stagingu, preto dry-run náhľad a explicitné potvrdenie pred každým zápisom MUSÍ byť povinné a nevypnuteľné; doména sa NESMIE zapisovať do repozitára. | ot. 5 |
| R6 | Appka NESMIE implementovať rušenie zľavy (ani hack s `to` do minulosti) — zľavy len prirodzene expirujú; appka vie zľavu zakladať, prepísať a predĺžiť. | ot. 6 |
| R7 | Appka MUSÍ podporovať manuálne zápisy aj plánované kampane so schedulerom. | ot. 7 |
| R8 | Appka MUSÍ pracovať výhradne so scope `product:edit` a NESMIE pýtať ani použiť `orders:read` (žiadne zákaznícke dáta). | ot. 8 |
| R9 | Appka MUSÍ viesť plný append-only audit každej operácie so snapshotom pred/po a allowlist držať v DB; roly sa neimplementujú. **Prihlásenie zrušili D98–D100 (27. 8. 2026)** — namiesto prihláseného admina je jediný **lokálny actor** (`samuel`, id 1) z `src/lib/auth/local-actor.ts` (D102), ktorým sa pripisuje každý zápis aj každý audit riadok. | ot. 9 |
| R10 | Appka MUSÍ používať port 3070, kontajnery `ovl-zliav-app` + `ovl-zliav-db` + `ovl-zliav-caddy`, DB `ovl_zliav` a zobrazovaný názov „Aura Zľavy". Cookie `ovl_zliav_session` zmizla s app session (**D99, 27. 8. 2026**); názov zostal len v histórii rozhodnutí. | ot. 10 |

---

## B. UX/UI (D1–D20)

| Č. | Rozhodnutie | Ref. |
| --- | --- | --- |
| D1 | Hlavná obrazovka po otvorení appky (prihlásenie zrušila **D99, 27. 8. 2026**) MUSÍ byť kombinovaný dashboard so stavom kľúča, ohrozenými/bežiacimi/zmeškanými kampaňami a stavom 10 allowlist produktov. | 1a |
| D2 | Ostrý zápis MUSÍ prebehnúť dvojkrokovo: dry-run náhľad → samostatné tlačidlo „Zapísať do PRODUKCIE"; jednokrokový zápis NESMIE existovať v žiadnej ceste UI. | 2a |
| D3 | Dry-run náhľad MUSÍ zobraziť diff tabuľku per produkt: názov, aktuálna cena, percento, okno od–do a posledný vlastný zápis; raw JSON payloady sa do náhľadu NESMÚ vykresľovať (idú do auditu). | 3a |
| D4 | UI MUSÍ zobraziť vypočítanú zľavnenú cenu `price × (1 − r/100)` vždy s upozornením „orientačný výpočet appky; zaokrúhlenie shopu sa môže líšiť". | 4a |
| D5 | Odpočet TTL kľúča MUSÍ byť trvalý badge v hlavičke na každej stránke a pod 6 h MUSÍ zmeniť farbu na výstražnú. | 5a |
| D6 | V hlavičke MUSÍ byť trvalý červený pruh „PRODUKCIA — sperky-eshop.sk" a každé potvrdenie MUSÍ obsahovať vetu o nevratnosti zápisu. | 6a |
| D7 | Pri každom produkte MUSÍ byť badge „podľa vlastného zápisu z DD.MM. — shop môže mať iný stav"; UI NESMIE tvrdiť, že pozná skutočný stav zľavy v shope. | 7a |
| D8 | Kampaň naplánovaná za horizont platnosti kľúča MUSÍ dostať žltý warning pri vytváraní a všetky ohrozené kampane MUSIA byť agregované v banneri na dashboarde. | 8c |
| D9 | Ak kľúč expiruje počas otvoreného potvrdzovacieho formulára, submit MUSÍ byť zablokovaný, dáta formulára zachované a nový kľúč vyžiadaný inline; formulár sa NESMIE zahodiť ani poslať „nech zlyhá na 401". | 9a |
| D10 | Po expirácii kľúča MUSÍ UI prejsť do read-only režimu (všetko vidno, zapisovacie akcie disabled s tooltipom + nenápadná výzva v hlavičke); UI sa NESMIE zablokovať celé. | 10a |
| D11 | Percento sa MUSÍ zadávať ako celé číslo 1–30 v číselnom poli s čipmi 5/10/15/20/25/30; desatinné hodnoty NESMÚ byť prijaté. | 11a |
| D12 | Okno od–do sa MUSÍ zadávať kalendárovými pickermi s presetmi 7/14/30 dní a „do konca mesiaca". | 12a |
| D13 | Pod dátumovými poľami MUSÍ byť explicitný výklad „platí od 00:00 dňa OD do 23:59 dňa DO, čas shopu" a všetky dátumy sa MUSIA zobrazovať vo formáte DD.MM.YYYY. | 13a |
| D14 | Zoznam kampaní MUSÍ zobrazovať plnú sadu stavov (naplánovaná / vyžaduje kľúč / beží zápis / aktívna / expirovaná / prepadnutá / čiastočná / zlyhala / zmeškaná / zrušená) ako farebné badge s filtrom. | 14a |
| D15 | Čiastočné zlyhanie MUSÍ byť zobrazené ako tabuľka per produkt (✓/✗, slovenská hláška + raw kód API) s tlačidlom „Zopakovať zlyhané". | 15a |
| D16 | Akcia „Zopakovať zlyhané" MUSÍ vždy znova prejsť dry-run potvrdením, aj pri identických parametroch. | 16a |
| D17 | Výsledok kampane odpálenej schedulerom MUSÍ byť v notifikačnom paneli a na vrchu dashboardu, kým ho Samuel neodklikne; SMTP/e-mail sa NESMIE implementovať. | 17a |
| D18 | Audit log v UI MUSÍ mať filtre (produkt, dátum, typ operácie, výsledok) a detail so snapshotom pred/po a raw odpoveďou. | 18a |
| D19 | Akcia „Predĺžiť" MUSÍ mať všetko predvyplnené a editovateľné výhradne pole `to`. | 19a |
| D20 | Prvé spustenie MUSÍ viesť onboarding checklistom v poradí: 1. doména → 2. kľúč → 3. allowlist → 4. testovací dry-run; onboarding NESMIE končiť ostrým zápisom. | 20a |

---

## C. Logika (D21–D40)

| Č. | Rozhodnutie | Ref. |
| --- | --- | --- |
| D21 | Kampaň MUSÍ byť vytvoriteľná vždy; ak v čase spustenia nie je platný kľúč, kampaň MUSÍ prejsť do stavu `needs_key`, NESMIE nič zapísať a MUSÍ čakať na nový kľúč. TTL kľúča sa kvôli kampani NESMIE predĺžiť. | 21a |
| D22 | Ak je kľúč pri vytváraní kampane platný, appka MUSÍ ponúknuť „zapísať hneď s budúcim `from`" s **defaultne zapnutou** voľbou a v potvrdení MUSÍ upozorniť, že eager zápis sa už nedá zrušiť (len prepísať). | 22a |
| D23 | Kampaň odpálená schedulerom pri expirovanom kľúči MUSÍ ísť do `needs_key` a po zadaní nového kľúča sa MUSÍ dopáliť, ak je stále vo svojom okne. | 23a |
| D24 | Po zadaní nového kľúča MUSIA byť automaticky dopálené všetky čakajúce kampane, ktoré sú stále vo svojom okne, s notifikáciou v UI. | 24a |
| D25 | Pri dopálení kampane MUSÍ platiť: `to` v minulosti → stav `prepadnutá` bez zápisu; `from` v minulosti → `from` sa posunie na dnes a posun sa MUSÍ zapísať do auditu. | 25a |
| D26 | UI MUSÍ pripomínať „vlož kľúč pre kampaň X" bannerom 48 h, 24 h a 2 h pred plánovaným spustením. | 26a |
| D27 | Predĺženie MUSÍ poslať jeden `setReduction` s rovnakým `from` a rovnakým percentom a novým `to`; zmena percenta NESMIE byť súčasťou predĺženia (je to prepis). Pri prekročení 3-mesačného stropu od pôvodného `from` MUSÍ UI ponúknuť prepis s novým `from` ako vedomú alternatívu. | 27a |
| D28 | Nová zľava na produkt, kde podľa vlastnej DB zľava beží alebo je naplánovaná, MUSÍ byť povolená výhradne ako explicitné „prepísanie" s diffom starý→nový v potvrdení; prekryv dvoch **budúcich** kampaní na tom istom produkte MUSÍ byť blokovaný pri vytváraní. | 28a |
| D29 | Appka MUSÍ kalendárne validovať `from + 3 mesiace ≥ to` lokálne a serverový `range_too_long` MUSÍ preložiť na zrozumiteľnú opravu; umelý strop 90 dní sa NESMIE zavádzať. | 29a |
| D30 | Pri zakladaní MUSÍ platiť `from ≥ dnes`; `from = dnes` je povolené; jednodňová zľava (`from = to`) je povolená len s dodatočným potvrdením „naozaj 1 deň?". | 30a |
| D31 | Všetka dátumová logika (UI, scheduler, interpretácia `YYYY-MM-DD`) MUSÍ bežať v Europe/Bratislava; časové pečiatky v DB MUSIA byť v UTC. | 31a |
| D32 | Scheduler MUSÍ zapisovať kampaň s `from = D` v deň D o 00:05 času shopu. | 32a |
| D33 | **ODCHÝLKA (33b):** Zmeškaný fire sa NESMIE nikdy dobehnúť automaticky — MUSÍ ísť do stavu `missed` a čakať na manuálne rozhodnutie; žiadne časové okno auto-dobehnutia NESMIE existovať. | 33b |
| D34 | Pri čiastočnom zlyhaní dávky MUSÍ operácia pokračovať cez všetky produkty a na konci vydať report OK/zlyhané s manuálnym retry; NESMIE sa zastaviť pri prvej chybe. | 34a |
| D35 | Appka NESMIE ponúkať vracanie už zapísaných produktov (clear neexistuje) — jediná dopredná cesta je dopísanie zlyhaných a UI to MUSÍ povedať bez okolkov. | 35a |
| D36 | Retry kampane MUSÍ byť idempotentný: produkty s potvrdeným OK zápisom identických parametrov sa MUSIA preskočiť s poznámkou v audite. | 36a |
| D37 | Zápisové operácie MUSIA byť serializované globálnym mutexom — druhá súbežná operácia (manuálna alebo schedulerová) sa MUSÍ odmietnuť s hláškou. | 37a |
| D38 | DB MUSÍ byť interpretovaná ako „posledný **vlastný** zápis", UI to MUSÍ priznávať všade, MUSÍ existovať akcia „označiť stav produktu ako neznámy" a projekt MUSÍ viesť formálny backlog požiadaviek na maintainera shopu (sekcia G). | 38b |
| D39 | **ODCHÝLKA (39c):** Zmena ceny medzi dry-run a zápisom NESMIE zápis zastaviť ani vyžadovať nové potvrdenie (appka zapisuje percento, nie cenu). **Protiváha je povinná:** povinný pre-write `GET /products/get` zostáva v platnosti a rozdiel ceny sa MUSÍ zapísať do auditu ako `price_at_preview` vs `price_at_write`; pri nezhode MUSÍ audit detail zobraziť príznak, že rozhodnutie padlo nad inou cenou. | 39c |
| D40 | Odobranie produktu z allowlistu MUSÍ byť blokované, kým na ňom existujú naplánované/čakajúce kampane; aktívna zľava v shope dobehne (zrušiť sa nedá). | 40a |

---

## D. API klient a integrácia so shopom (D41–D60)

| Č. | Rozhodnutie | Ref. |
| --- | --- | --- |
| D41 | Taxonómia chýb MUSÍ byť na jednom mieste v module api-clienta: retryable = 429 (podľa `Retry-After`), 500, sieťová chyba, timeout; terminal = 400, 401, 403, 404. Taxonómia NESMIE byť konfigurovateľná z DB. | 41a |
| D42 | Pri 429 MUSÍ klient čakať `Retry-After` so stropom 90 s, skúsiť maximálne 3× a potom zlyhať s reportom. | 42a |
| D43 | Pri 500 alebo sieťovej chybe pri zápise MUSÍ klient skúsiť maximálne 3× s backoffom 2/4/8 s, opierajúc sa o idempotenciu identického `setReduction`. | 43b |
| D44 | HTTP timeout MUSÍ byť 10 s pre čítanie a 30 s pre zápis. | 44b |
| D45 | Ak odpoveď na zápis nepríde (timeout po odoslaní), stav MUSÍ byť `uncertain` a klient MUSÍ poslať identický `setReduction` ešte raz a stav vyriešiť podľa druhej odpovede. | 45a |
| D46 | Zápisy v dávke MUSIA ísť prísne sekvenčne v deterministickom poradí s pauzou ~250 ms; paralelizácia NESMIE byť použitá. | 46a |
| D47 | Chybové kódy API MUSIA byť mapované na slovenskú vetu s odporúčaním a raw kód MUSÍ byť dostupný v rozbaľovacom detaile; neznámy kód sa MUSÍ zobraziť surovo, NESMIE sa maskovať. | 47a |
| D48 | Tesne pred každým zápisom MUSÍ appka zavolať `GET /api/products/get` (name, price, has_attributes), pripojiť posledný vlastný zápis z DB a flag „reduction neoveriteľná cez API"; tento GET je povinný aj po odchýlke D39. | 48a |
| D49 | Ak pre-write GET vráti `not found`, MUSÍ sa zablokovať zápis len tohto produktu, produkt sa v allowlistě označí „nenájdený v shope" a operácia MUSÍ pokračovať s ostatnými. | 49a |
| D50 | Po zápise MUSÍ appka uložiť celý odoslaný payload, celú raw odpoveď, HTTP status a timestamp; API kľúč sa do auditu NESMIE dostať nikdy v žiadnej forme. | 50a |
| D51 | Odpoveď 401 MUSÍ spustiť okamžitý wipe kľúča, zastavenie operácie a vyžiadanie nového kľúča v UI; mŕtvy kľúč NESMIE zostať na disku. | 51a |
| D52 | Odpoveď 403 MUSÍ mať rovnaký účinok ako 401, s hláškou „kľúč nemá `product:edit`". | 52a |
| D53 | Nový kľúč MUSÍ byť overený sondou `POST /api/products/setReduction` s `reduction=0` (nikdy nič nezapíše): 400 = kľúč platný, 401/403 = kľúč nepoužiteľný; sonda MUSÍ byť v kóde zdokumentovaná ako vedomý trik. | 53b |
| D54 | Ak príde HTTP 200 s tvarom, ktorý neprejde zod validáciou, zápis MUSÍ dostať stav `uncertain` a appka MUSÍ eskalovať „API sa zmenilo"; NESMIE to považovať za úspech. | 54a |
| D55 | Pri uložení domény a pred každým fire MUSÍ prebehnúť canary `GET /api/products?per_page=1` (200 + očakávaný tvar) a v UI MUSÍ byť tlačidlo „Otestovať spojenie"; periodický polling sa NESMIE zavádzať. | 55a |
| D56 | Detaily allowlist produktov sa MUSIA čítať jedným `POST /api/batch` (max 25 položiek) s fallbackom na jednotlivé GETy pri zlyhaní. | 56a |
| D57 | Cache `name`/`price` sa MUSÍ obnoviť pri otvorení zápisového formulára a manuálnym tlačidlom „obnoviť"; background polling katalógu NESMIE existovať. | 57a |
| D58 | Každý request voči shopu MUSÍ nesť `User-Agent: aura-zlavy/<verzia>` a hierarchické korelačné ID (`operation_id` per dávka, `request_id` per volanie), oboje uložené v audite. | 58a |
| D59 | Dátumy sa MUSIA prepočítať v momente fire a zápisové okno MUSÍ byť „zamrznuté" ±60 s okolo polnoci; automatická oprava potvrdených dátumov po `invalid_dates` NESMIE prebehnúť. | 59a |
| D60 | Pri produkte s `has_attributes = true` MUSÍ dry-run upozorniť: „produkt má varianty; % zľavu na ne uplatní logika shopu, appka výsledné ceny variantov negarantuje". | 60a |

---

## E. Bezpečnosť (D61–D80)

| Č. | Rozhodnutie | Ref. |
| --- | --- | --- |
| D61 | Master key pre AES-256-GCM MUSÍ byť súbor bind-mountnutý read-only s `chmod 400` a vlastníkom non-root uid appky; cesta k nemu ide cez env. Master key NESMIE byť v env premennej ani v obraze. | 61a |
| D62 | Rotácia master key sa NESMIE riešiť tooling-om: nový master key = wipe záznamu + nové zadanie API kľúča v UI. | 62a |
| D63 | TTL kľúča MUSÍ byť kontrolované pri každom prístupe **aj** minútovým tickom schedulera; wipe MUSÍ prepísať ciphertext náhodnými dátami, potom riadok zmazať a zapísať audit event `key_wiped`. | 63a |
| D64 | Plaintext API kľúč sa MUSÍ dešifrovať len na moment odoslania requestu a hneď po ňom MUSÍ byť referencia zahodená a buffer prepísaný (`Buffer.fill(0)`); kľúč NESMIE byť cachovaný v pamäti. | 64a |
| D65 | UI NESMIE nikdy zobraziť API kľúč — len posledné 4 znaky, čas uloženia a odpočet. | 65a |
| D66 | MUSÍ existovať centrálny redaktor (maskovanie `Authorization`, `X-Api-Key` a denylist polí) **a** test, ktorý zlyhá, ak sa kľúč objaví v serializovaných logoch alebo audite. | 66a |
| D67 | Panic button „kľúč unikol" MUSÍ okamžite wipnuť kľúč, zrušiť všetky čakajúce kampane, zapísať audit event a zobraziť runbook „kontaktuj maintainera na revokáciu"; po incidente NESMIE nič bežať automaticky. | 67a |
| D68 | **ZRUŠENÉ 27. 8. 2026 (D99).** Appka nemá heslá; s nimi zmizla aj závislosť `argon2` (D104). Pôvodné znenie: „Admin heslo MUSÍ mať minimálne 12 znakov a hashovať sa argon2id s parametrami zo sperky-ai; zložitostné pravidlá sa NESMÚ vynucovať." | 68a |
| D69 | **ZRUŠENÉ 27. 8. 2026 (D99).** App session je zmazaná z kódu, nie vypnutá prepínačom; kto zapísal, hovorí lokálny actor (D102). Pôvodné znenie: „Session (jose JWT v cookie `ovl_zliav_session`) MUSÍ mať 8 h absolútnu platnosť a 30 min idle timeout; cookie MUSÍ byť `httpOnly`, `Secure`, `SameSite=Strict`." | 69a |
| D70 | **ZRUŠENÉ 27. 8. 2026 (D100).** Sudo neexistuje a **invariant I3 sa tým zmenil** na „žiadny zápis bez dry-runu + potvrdenia"; dry-run a potvrdenie zostávajú nedotknuté. Pôvodné znenie: „Pred ostrým zápisom MUSÍ appka vyžiadať heslo znova („sudo mode"), ak je od poslednej autentifikácie viac než 15 minút." | 70a |
| D71 | **ZRUŠENÉ 27. 8. 2026 (D99).** Login neexistuje, takže ani lockout; tabuľka `login_attempts` zostáva v schéme prázdna (D101 — žiadna migrácia). Pôvodné znenie: „Login MUSÍ byť chránený rate limitom 5 pokusov / 15 min per IP s exponenciálnym lockoutom a každý pokus MUSÍ byť v audite; CAPTCHA sa NESMIE implementovať." | 71a |
| D72 | CSRF obrana MUSÍ byť `SameSite=Strict` cookie **a** Origin check v pipeline na všetkých mutáciách; double-submit token sa NESMIE pridávať. | 72a |
| D73 | 2FA/TOTP sa NESMIE implementovať. | 73a |
| D74 | Audit log MUSÍ byť append-only vynútené na úrovni DB: aplikačný DB user NESMIE mať `UPDATE` ani `DELETE` grant na `audit_log`. | 74a |
| D75 | Audit log sa NESMIE nikdy mazať ani rotovať. | 75a |
| D76 | Tabuľka s API kľúčom MUSÍ byť vylúčená zo záloh DB. | 76a |
| D77 | Ostrý zápis MUSÍ byť povolený len ak `NODE_ENV=production` **A** `WRITES_ENABLED=true`; v dev prostredí MUSÍ byť vynútený dry-run. | 77a |
| D78 | Pri štarte MUSÍ prebehnúť assertion, že appka je dostupná výhradne z `127.0.0.1` (publikovaný bind + neexistencia iných publikovaných portov), inak proces MUSÍ skončiť; MUSÍ existovať CI test, ktorý to overí nad compose konfiguráciou. Middleware filter na zdrojovú IP sa NESMIE použiť (za Caddy je nespoľahlivý). | 78a |
| D79 | MUSÍ existovať tvrdý strop 60 zápisov / hodinu vyhodnocovaný z DB; prekročenie MUSÍ zamknúť zápisy do manuálneho odomknutia a zapísať audit event. **Od 27. 8. 2026 (D99)** odomknutie nežiada heslo, ale výslovné `confirmed: true` z Nastavení (`POST /api/settings/unlock-writes`) — potvrdenie akcie NEZMIZLO, len prestalo byť heslom. | 79a |
| D80 | Doména shopu MUSÍ byť výhradne `https` a jedna, potvrdená pri prvom nastavení; pred uložením MUSÍ prejsť canary podľa D55 (fail-closed). DNS-resolve blokovanie privátnych rozsahov sa neimplementuje. **Od 27. 8. 2026 (D99, D100)** jej zmena nežiada heslo ani sudo — appka žiadne nemá. **Od 28. 8. 2026 (D106)** ale žiada výslovné `confirmed: true` zo zaškrtávacieho poľa: na uloženú adresu ide zápisová cesta s dešifrovaným API kľúčom v hlavičke, takže bez akejkoľvek brány by kľúč vynieslo jedno POST. Bránami sú teda potvrdenie, canary (fail-closed) a audit `domain_changed`. | 80a |

---

## F. Backend, prevádzka a Caddy (D81–D100)

| Č. | Rozhodnutie | Ref. |
| --- | --- | --- |
| D81 | DB schéma MUSÍ obsahovať tabuľky `campaigns`, `campaign_items`, `products_allowlist`, `catalog_cache`, `audit_log`, `api_key`, `settings`, `users` (+ technicky nevyhnutné `_migrations`, `login_attempts`, `scheduler_state` — viď `11-BUILD-SPEC.md` §3). **Od 27. 8. 2026 (D101)** schéma zostáva presne takáto aj po zrušení prihlásenia: `users` drží jediný riadok lokálneho actora (FK z `campaigns.created_by` a `audit_log.user_id` je `ON DELETE RESTRICT`) a do `login_attempts` už nikto nezapisuje. | 81a |
| D82 | Scheduler MUSÍ byť in-process tick (60 s) vnútri Next.js standalone procesu so stavom v DB; samostatný worker kontajner ani host cron sa NESMIE zavádzať. | 82a |
| D83 | Kampane MUSIA prechádzať stavovým strojom `scheduled → needs_key → running → done \| partial \| failed \| missed \| cancelled` (+ `lapsed` = prepadnutá podľa D25) a každý prechod MUSÍ mať timestamp a dôvod. | 83a |
| D84 | Proti dvojitému fire MUSÍ appka použiť atomický claim `UPDATE campaigns SET status='running' WHERE id=? AND status IN ('scheduled','needs_key')` a pokračovať len ak `affectedRows = 1`. | 84a |
| D85 | Pri `SIGTERM` počas dávky MUSÍ appka dobehnúť aktuálny produkt, zvyšok označiť `interrupted` („prerušené — manuálny retry") a compose MUSÍ mať `stop_grace_period: 30s`. | 85a |
| D86 | Po havárii MUSÍ reconciliácia pri štarte porovnať joby v stave `running` per produkt s audit záznamami: potvrdené OK nechať, ostatné označiť `uncertain` na manuálne rozhodnutie; automatický re-run NESMIE prebehnúť. | 86a |
| D87 | Každý tick MUSÍ zapísať heartbeat do DB; UI MUSÍ zobraziť badge „scheduler beží / naposledy pred X min" a `/api/health` MUSÍ heartbeat reportovať. | 87a |
| D88 | Migrácie MUSIA bežať automaticky pri štarte kontajnera pod advisory lockom s fail-fast správaním (štart bez úspešnej migrácie NESMIE prebehnúť); rollback je vždy manuálny. | 88a |
| D89 | DB heslo MUSÍ byť náhodne vygenerované pri prvom setupe a uložené v env súbore mimo gitu; aplikačný user NESMIE mať DDL práva ani `UPDATE`/`DELETE` na `audit_log`; migrácie MUSÍ spúšťať oddelený migračný user. | 89a |
| D90 | MUSÍ existovať denný `mysqldump` bez tabuľky `api_key` s rotáciou 14 dní a zdokumentovaným restore testom. | 90a |
| D91 | Compose MUSÍ mať healthcheck DB (`mariadb-admin ping`) a appky (`/api/health` agregujúci DB + stav kľúča + heartbeat schedulera) s `depends_on: condition: service_healthy` a retry pripájania v appke. | 91a |
| D92 | Prevádzkové logy MUSIA byť štruktúrovaný JSON na stdout s docker logging driverom (`max-size`/`max-file`); audit MUSÍ byť v DB a NESMIE sa tlačiť do logov. | 92a |
| D93 | Všetky ENV premenné MUSIA prejsť zod schémou pri boote s fail-fast a vymenovaním chýbajúcich/zlých hodnôt. | 93a |
| D94 | Caddy MUSÍ používať `tls internal` (lokálna CA) a repo MUSÍ obsahovať návod na trust root certifikátu v OS. | 94a |
| D95 | Caddy MUSÍ posielať `Content-Security-Policy` (`default-src 'self'`, zladené s Next.js), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` a HSTS (len s TLS); COOP/COEP sa nepridáva. | 95a |
| D96 | Publikovaný MUSÍ byť výhradne jediný port `127.0.0.1:3070` obsluhovaný Caddy; `ovl-zliav-app` a `ovl-zliav-db` NESMÚ publikovať žiadny port. | 96a |
| D97 | **ZRUŠENÉ 27. 8. 2026 (D98 zo sekcie F2).** `basic_auth` je zo `secrets/Caddyfile` odstránené a aplikačný login zmazaný (D99). Pôvodné znenie: „Caddy basic auth **aj** aplikačný login MUSIA byť aktívne súčasne; bcrypt hash MUSÍ byť v súbore mimo gitu a v repe MUSÍ byť len `Caddyfile.example`." Pravidlo „reálny Caddyfile žije mimo gitu" platí ďalej (I1). | 97a |
| D98 | Kontajner appky MUSÍ bežať ako non-root s `read_only: true` rootfs, `tmpfs: /tmp`, `cap_drop: [ALL]` a `security_opt: no-new-privileges:true`; vlastný seccomp profil sa nepridáva. | 98a |
| D99 | CI MUSÍ na push spustiť lint + typecheck + vitest + build a na PR Playwright; testy MUSIA bežať výhradne proti mock shop serveru a `npm audit` + `gitleaks` MUSIA blokovať pri high/critical. | 99a |
| D100 | Upgrade MUSÍ prebiehať podľa runbooku: záloha DB → build → `compose up` → migrácie fail-fast → smoke test `/api/health`; zápisy MUSIA byť blokované počas migrácie. | 100a |

> **Pozor na čísla.** D98, D99 a D100 v tejto tabuľke sú tie **dotazníkové**
> (hardening, CI, upgrade). Rovnaké čísla si 27. 8. 2026 vzal aj sprint „bez
> prihlásenia" — tie sú v sekcii F2 nižšie. Viď kolíziu opísanú v „Ako sa tento
> dokument používa".

---

## F2. Sprint „bez prihlásenia" (D98–D108, 27.–28. 8. 2026)

Zdroj: `KONTRAKT-BEZ-LOGINU-2026-08-27.md` (dôvod, čo prihlásenie nechránilo,
prijaté riziko a akceptačné kritériá K1–K8). Appka je jednoužívateľský lokálny
nástroj na jednom PC a mala **tri vrstvy toho istého hesla**; Samuel ich
27. 8. 2026 informovane zrušil. Čísla kolidujú s dotazníkovými D98–D100 vyššie —
viď poznámku v úvode dokumentu.

| Č. | Rozhodnutie | Dôvod |
| --- | --- | --- |
| D98 | Caddy `basic_auth` sa zo `secrets/Caddyfile` odstraňuje. **D97 sa ruší.** | Čistý duplikát pred appkou, ktorá mala vlastnú bránu. Nechránil nič, čo nechráni I5. |
| D99 | App session, `/login`, heslá a lockout sa **mažú z kódu**, nie vypínajú prepínačom. **D68, D69, D71 sa rušia.** | Voľba Samuela z dvoch ponúknutých variantov; prepínač v `.env` bol odmietnutý. |
| D100 | sudo sa ruší. **D70 sa ruší. Invariant I3 sa mení** z „žiadny zápis bez dry-runu + potvrdenia + sudo" na **„žiadny zápis bez dry-runu + potvrdenia"**. | Voľba Samuela. Dry-run a potvrdenie v UI zostávajú a sú strážené testom. |
| D101 | Tabuľka `users` a jeden riadok v nej (`samuel`, id 1) **zostávajú**. DB sa nemení vôbec, žiadna migrácia. | `campaigns.created_by` a `audit_log.user_id` majú FK na `users(id)` `ON DELETE RESTRICT`. Bez `users` by sa nedala zapísať kampaň ani audit riadok. Žiadna migrácia = žiadne riziko na dátach. |
| D102 | Každý zápis a každý audit riadok sa pripisuje **lokálnemu actorovi** (`samuel`, id 1) z `src/lib/auth/local-actor.ts`. | Audit trail nesmie stratiť zmysel len preto, že zmizlo prihlásenie (I11 — „nevieme" je horšie než odpoveď). |
| D103 | `ctx.claims` v `defineRoute()` sa mení na `ctx.actor` (`{ id, username }`). Vlastnosť `auth:` z `RouteDefinition` **zmizne**. | 53 rút ju deklarovalo. Odstránenie z typu spôsobí TS chybu na každom zabudnutom mieste — typecheck je dôkaz úplnosti, nie niečia pamäť. |
| D104 | Závislosť `argon2` sa odstraňuje z `package.json`. | Bez hesiel ju nič nepotrebuje. Vedľajší efekt: v git worktree padali VŠETKY route integračné testy na importe `argon2.glibc.node` (blokuje ho Windows Application Control) — táto trieda bolesti zmizla. |
| D105 | Slovník prekážok (`src/lib/status/blockers.ts`) a UI texty prestávajú sľubovať heslo: prekážka `sudo` sa mení na `potvrdenie`. | Po D99/D100 žiadne heslo neexistuje a zámok, ktorý sa nemá čím otvoriť, je klamstvo v UI. Dôsledok D100. |
| **D106** | **Uvoľňujúce mutácie v Nastaveniach dostávajú späť bránu — nie heslom, ale zaškrtávacím potvrdením.** `PUT /api/settings/domain` a `POST /api/settings/scope-mode` (len pri UVOĽNENÍ) žiadajú `confirmed: true`; `POST /api/settings/unlock-writes` ho už má z D99 a `DELETE /api/key` má vypísaný literál `KLUC UNIKOL`. Sprísnenie rozsahu zostáva VOĽNÉ. | Overenie sprintu ukázalo, že §3 kontraktu popisoval riziko UŽŠIE, než aké bolo: heslo v tele bolo pri týchto akciách JEDINÁ brána a jeho zmazaním sa z nich stal jeden tichý POST. Najdrahšia z nich je doména — kto ju prepíše, tomu zápisová cesta pošle **dešifrovaný produkčný API kľúč** v `X-Api-Key`, teda BEZ prístupu k `secrets/`; canary to nezastaví, číta bez kľúča. Samuel to rozhodol 28. 8. 2026 z troch ponúknutých variantov. Nie je to návrat prihlásenia (D99 platí): nič sa nepamätá a nič sa nezadáva, len raz zaškrtne. |
| **D107** | Mŕtve prihlasovacie tajomstvá sa z disku **mažú**: `secrets/basic-auth.txt`, `secrets/app-admin.txt`, `secrets/Caddyfile.bak-2026-08-27`. | Po D98/D99 už nič nechránia. §3 obhajuje prijaté riziko vetou „kto vie čítať tento disk" — heslo, ktoré používateľ môže mať aj inde, tam nemá ležať bez dôvodu. Netrackované (I1), takže v gite sa nič nemení. Samuel potvrdil 28. 8. 2026. |
| **D108** | Schedulerový fire dosadí do `audit_log.user_id` hodnotu `campaigns.created_by`, keď `opts.userId` nie je. Stĺpec `actor` (`scheduler`/`user`) zostáva nedotknutý. | D102 hovorí „každý audit riadok", ale scheduler `userId` neposiela (dávku nespustil človek), takže riadky dokladujúce DÁVKOVÝ zápis do produkcie mali `user_id = NULL` — teda „nevieme, kto to autorizoval" (I11). `created_by` drží actora, ktorý kampaň vytvoril a POTVRDIL. Dva stĺpce, dve otázky: `actor` = kto spustil, `user_id` = kto autorizoval. |

**Čo sa zrušením prihlásenia stratilo** (povedané nahlas, kontrakt §3):
ktorýkoľvek lokálny proces na tomto PC vie zapísať zľavy do produkčného eshopu
jedným HTTP POST-om — hlavičku `Origin` si dosadí ľubovoľne, D72 je obrana proti
prehliadačom, nie proti lokálnym skriptom. Nedotknuté zostávajú I5 (publikovaný
je len `127.0.0.1:3070`) a D72 origin check na každej mutácii. Samuel toto riziko
prijal 27. 8. 2026.

**Doplnenie 28. 8. 2026 — riziko bolo širšie, než §3 napísalo.** Overenie sprintu
našlo, že heslo v tele požiadavky bolo pri štyroch akciách JEDINÁ brána, a s ním
padli všetky: zmena domény shopu, panic wipe kľúča, odomknutie runaway zámku
a uvoľnenie rozsahu z 10 na 10 000 produktov. Zmena domény bola pritom cesta
k **vyneseniu produkčného API kľúča bez prístupu k disku** — teda presne to, čo
§3 vylučovala vetou „musí ukradnúť tajomstvo zo disku". **D106 tie brány
obnovilo** ako zaškrtávacie potvrdenie. Poučenie: keď sa ruší autentifikácia,
treba prejsť KAŽDÚ mutáciu a spísať, čo ju drží po zrušení — nie iba tú, ktorú
invariant menuje (I3 hovorí o zápise zliav a o týchto štyroch mlčí).

---

## G. Obe odchýlky od návrhu — explicitne

### Odchýlka 1 — ot. 33: `b)` namiesto `a)`

**Znenie:** Zmeškané spustenie kampane sa **NIKDY** nedobehne automaticky.
(Návrh pripúšťal auto-dobehnutie pri meškaní < 24 h — to sa **neimplementuje**.)

Implementačné dôsledky, ktoré NESMIE žiadny agent obísť:

1. Každý zmeškaný fire MUSÍ skončiť v stave `missed`. V kóde NESMIE existovať
   žiadna konštanta typu `CATCHUP_WINDOW_HOURS` ani žiadna cesta, ktorá by
   `missed` prevedla do `running` bez explicitnej akcie používateľa.
2. Stav `missed` MUSÍ byť na dashboarde rovnako naliehavý ako `needs_key`
   (D1, D8) — rovnaká vizuálna váha, rovnaký agregovaný banner.
3. Manuálne spustenie zmeškanej kampane MUSÍ prejsť kontrolou okna podľa D25
   (`to` v minulosti → `lapsed`; `from` v minulosti → posun na dnes + audit)
   **a** povinným dry-run potvrdením podľa D2/D16.
4. Eager write (D22) sa týmto stáva **hlavnou cestou**, nie odporúčaným
   doplnkom: keď je kľúč pri vytváraní platný, appka zapíše budúce okno hneď,
   žiadny fire sa nekoná a nie je čo zmeškať. Odložený zápis je vedomá výnimka
   a UI ho MUSÍ takto pomenovať.

### Odchýlka 2 — ot. 39: `c)` namiesto `a)`

**Znenie:** Zmena ceny produktu medzi dry-run a ostrým zápisom zápis
**NEZASTAVÍ** a nevyžiada nové potvrdenie. (Návrh zastavoval pri zmene > 5 %.)

Odôvodnenie: appka zapisuje **percento, nie cenu**, takže percento potvrdené
v dry-run zostáva platné aj pri zmenenej cene.

Uznané riziko: potvrdil si „−15 % z 19,99 € = 16,99 €", medzitým sa cena zmenila
na 29,99 € a zapíše sa „−15 % z 29,99 € = 25,49 €". Percento je správne,
výsledná cena nie je tá, ktorú si videl.

**Povinná protiváha (prevzatá z 39b) — bez nej odchýlka neplatí:**

1. Povinný pre-write `GET /api/products/get` podľa D48 **zostáva v platnosti**;
   len stráca blokujúci efekt. Agent ho NESMIE odstrániť ako „už nepotrebný".
2. Do `campaign_items` MUSIA byť zapísané **oba** údaje: `price_at_preview`
   (cena zobrazená v dry-run) a `price_at_write` (cena z pre-write GET).
3. Ak sa líšia, záznam MUSÍ nesť príznak nezhody a audit detail v UI (D18) ho
   MUSÍ zobraziť s vysvetlením „rozhodoval si nad inou cenou".
4. Príznak nezhody sa NESMIE potichu zahodiť ani agregovať do „OK" stavu.

---

## H. INVARIANTY — žiadny agent ich NESMIE porušiť

Invarianty sú nadradené všetkému ostatnému v tomto dokumente aj v build spec.
Ak ich implementácia nedokáže splniť, úloha sa NEDOKONČÍ a nahlási sa konflikt.

| Č. | Invariant |
| --- | --- |
| **I1** | **API kľúč nikdy v repe, logoch, audite ani v UI.** Kľúč NESMIE byť v žiadnom trackovanom súbore, v `.env.example`, v obraze, v `docker inspect`, v stdout logu, v `audit_log`, v HTTP odpovedi appky ani v error stacktrace. Redaktor je centrálny a test, ktorý ho overuje, MUSÍ existovať a byť blokujúci. (R2, D50, D65, D66) |
| **I2** | **Max 10 produktov, fail-closed.** Allowlist má maximálne 10 aktívnych záznamov (vynútené aj na úrovni DB), jedna operácia zapíše maximálne 10 produktov a akékoľvek product ID mimo aktívneho allowlistu MUSÍ byť odmietnuté **pred** volaním shop API. Pri pochybnosti sa NESMIE zapísať. (R1) |
| **I3** | **Žiadny zápis bez potvrdenia.** Každý ostrý zápis MUSÍ mať v DB doložený predchádzajúci dry-run tej istej sady parametrov a potvrdenie používateľa. Neexistuje cesta kódu, ktorá zapíše do shopu bez týchto dvoch vecí. Výnimka je jedine schedulerový fire kampane, ktorá potvrdením prešla pri vytvorení. **Znenie zmenila D100 (27. 8. 2026)**: dovtedy invariant žiadal aj „platné sudo okno (D70)". Sudo zmizlo — dry-run a potvrdenie NIE a oslabiť sa nesmú. (R5, D2, D16, D100) |
| **I4** | **Audit je append-only.** Aplikačný kód NESMIE obsahovať `UPDATE`/`DELETE` nad `audit_log` a DB user na to NESMIE mať grant. Audit sa nemaže nikdy. (D74, D75) |
| **I5** | **Bind len na 127.0.0.1.** Jediný publikovaný port je `127.0.0.1:3070` (Caddy). `ovl-zliav-app` a `ovl-zliav-db` NESMÚ mať `ports:`. Startup assertion + CI kontrola compose konfigurácie sú povinné. (R4, D78, D96) |
| **I6** | **Testy len proti mocku.** Žiadny test (unit, integračný, e2e) NESMIE poslať request na reálnu doménu shopu. Test setup MUSÍ globálne zablokovať `fetch` na iný host než lokálny mock a pokus o reálny host MUSÍ test zhodiť. (D99, R5) |
| **I7** | **Žiadne rušenie zľavy.** V kóde NESMIE existovať cesta, ktorá pošle `setReduction` s `to` v minulosti za účelom zrušenia, ani žiadna funkcia pojmenovaná ako `clear`/`cancel` zľavy v shope. Rušiť sa dá len **kampaň v našej DB**, nie zľava v shope. (R6) |
| **I8** | **Len scope `product:edit`.** Appka NESMIE volať žiadny endpoint pod `/api/order` ani ukladať čokoľvek zo zákazníckych dát. (R8) |
| **I9** | **Lokálna validácia pred API.** Percento (celé číslo 1–30), `to ≥ from`, `from ≥ dnes` a okno ≤ 3 mesiace MUSIA byť validované lokálne pred odoslaním; spoliehať sa na 400 zo shopu je porušenie. (D11, D29, D30) |
| **I10** | **Sekvenčný determinizmus zápisu.** Zápisy idú jeden po druhom v deterministickom poradí s pauzou 250 ms; `Promise.all` nad zápisovými volaniami je zakázané. (D46) |
| **I11** | **Nikdy netvrdiť, že poznáme stav zľavy v shope.** Každé zobrazenie stavu zľavy MUSÍ byť označené ako „posledný vlastný zápis"; appka NESMIE prezentovať vlastnú DB ako pravdu o shope. (D7, D38) |
| **I12** | **Globálny mutex a runaway strop.** Žiadne dve zápisové operácie nesmú bežať súbežne a prekročenie 60 zápisov/h MUSÍ zamknúť zápisy fail-closed. (D37, D79) |
| **I13** | **Dve env poistky pre ostrý zápis.** Zápis prebehne len pri `NODE_ENV=production` **a** `WRITES_ENABLED=true`; inak je vynútený dry-run. Poistka NESMIE byť obídená testovacím flagom v produkčnom kóde. (D77) |
| **I14** | **Fail-fast pri boote.** Zlý/chýbajúci ENV, neúspešná migrácia, nedostupný master key alebo nesplnená bind assertion MUSIA proces ukončiť; appka NESMIE bežať v degradovanom režime, v ktorom by mohla zapisovať. (D88, D93, D78, D61) |

---

## I. BACKLOG NA MAINTAINERA SHOPU (D38b)

Formálny zoznam požiadaviek, ktoré zavrú diery v kontrakte API. Appka MUSÍ
fungovať aj bez nich (dnešný stav), ale MUSÍ byť napísaná tak, aby ich prijatie
znamenalo lokálnu zmenu v jednom module (api-client), nie prepis logiky.
Tento zoznam MUSÍ byť v repe ako `docs/20-BACKLOG-SHOP-API.md` (vytvára úloha
A14) a MUSÍ byť odoslaný maintainerovi.

| Č. | Požiadavka | Prečo | Čo sa v appke zmení, keď to bude |
| --- | --- | --- | --- |
| **B1** | `GET /api/products` aj `GET /api/products/get` nech vracajú aktuálnu zľavu (`reduction_percent`, `reduction_from`, `reduction_to`, prípadne `reduction_price`). | Dnes appka nedokáže zistiť skutočný stav zľavy — vie len to, čo sama zapísala (D7, D38, I11). Toto je najväčšia diera kontraktu. | Zmizne flag „reduction neoveriteľná cez API", badge „podľa vlastného zápisu" sa nahradí skutočným stavom a pribudne detekcia driftu proti admin shopu. |
| **B2** | Nový endpoint `POST /api/products/clearReduction` (scope `product:edit`), ktorý zľavu vyčistí, nie len nechá expirovať. | `reduction` musí byť `> 0`, takže dnes neexistuje „clear" operácia; zrušenie zľavy sa nedá urobiť inak než hackom s `to` do minulosti, ktorý sme zakázali (R6, I7). | Pribudne akcia „Zrušiť zľavu" s vlastným potvrdením a kompenzácia pri čiastočnom zlyhaní (D35) prestane byť jednosmerná. |
| **B3** | `POST /api/products/setReduction` nech je **batchable** (opt-in pre `/api/batch`). | Dnes 10 produktov = 10 samostatných requestov, operácia nie je atomická a pri chybe v 7. requeste je 6 produktov už zmenených (D34, D35). | Dávka pôjde ako 1 batch volanie; sekvenčný režim s pauzou 250 ms zostane ako fallback (D46). |
| **B4** | Endpoint `GET /api/whoami` alebo `GET /api/health` vracajúci identitu kľúča a jeho scopes. | Dnes sa platnosť kľúča overuje sondou `setReduction` s `reduction=0` — funguje, ale je to vedomý trik na produkčnom write endpointe (D53). | Sonda sa nahradí čistým `whoami` volaním; overenie kľúča prestane siahať na write endpoint a bude vedieť aj to, ktoré scopes kľúč má. |

**Formulácia pre maintainera (kópia do e-mailu):** appka Aura Zľavy je lokálny
nástroj, ktorý používa výhradne `POST /api/products/setReduction` (scope
`product:edit`) a verejné čítacie endpointy, na maximálne 10 vopred povolených
produktoch. Štyri požiadavky vyššie sú v poradí dôležitosti B1 → B4; B1 je
jediná, ktorá dnes chýba natoľko, že si appka musí o stave shopu robiť vlastnú
(nepotvrditeľnú) evidenciu.

---

## J. Otvorené body, ktoré dotazník nepokrýval

Dorozhodnuté syntetizátorom fail-closed smerom; ak sa Samuel rozhodne inak, mení
sa len uvedené miesto v `11-BUILD-SPEC.md`.

| Č. | Bod | Rozhodnutie |
| --- | --- | --- |
| O1 | Vzťah „kampaň" ↔ „job" (D14 vs D83 majú rôzne sady stavov) | Kampaň **je** job; v DB je jeden `status` s lifecycle hodnotami (`draft`, `scheduled`, `needs_key`, `running`, `done`, `partial`, `failed`, `missed`, `cancelled`, `lapsed`) a UI stavy „aktívna"/„expirovaná" sa **derivujú** z `status='done'` a dátumov okna. |
| O2 | Prenos potvrdenej dry-run sady do zápisu | Podpísaný `preview_token` (JWT, TTL 15 min) obsahujúci hash sady parametrov a `price_at_preview` per produkt; zápis bez platného tokenu sa odmietne (podpora I3). |
| O3 | Kde žije heartbeat, write-lock a runaway počítadlo | Tabuľka `scheduler_state` (heartbeat, tick metriky) a `settings` (write lock); runaway počet sa počíta dotazom nad `audit_log` (append-only, teda neobíditeľné). |
| O4 | Brute-force lockout musí prežiť restart | Tabuľka `login_attempts`; in-memory riešenie je zakázané. **Bezpredmetné od 27. 8. 2026 (D99):** login neexistuje, takže ani lockout — tabuľka v schéme zostáva prázdna (D101, žiadna migrácia). |
| O5 | „Bind 127.0.0.1" vs. dosiahnuteľnosť z Caddy kontajnera | V kontajneri appka počúva na `0.0.0.0` **internej compose siete** a nepublikuje port; localhost-only garanciu dáva publikovaný mapping Caddy `127.0.0.1:3070` + CI kontrola, že `ovl-zliav-app`/`ovl-zliav-db` nemajú `ports:`. Startup assertion kontroluje deklarovaný `PUBLIC_BIND` a odmietne štart, ak nie je `127.0.0.1`. |
| O6 | Notifikačný panel (D17) bez ďalšej tabuľky | Stĺpec `result_ack_at` na `campaigns`; „neodkliknuté" = `status IN (done, partial, failed, missed, lapsed) AND result_ack_at IS NULL`. |
| O7 | Kto vlastní `package.json` | Úloha A0 vytvorí `package.json` s **kompletnou** sadou závislostí pre celý projekt; žiadna ďalšia úloha ho NESMIE upravovať (viď `12-SPRINT-PLAN.md`). |
