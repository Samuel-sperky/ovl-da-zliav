# Aura Zľavy (ovl-da-zliav) — odpovede na 100 otázok

**Dátum:** 2026-08-05
**Zdroj otázok:** `docs/01-DOTAZNIK-100-OTAZOK.md`
**Stav:** UZAVRETÉ — vstup pre syntetizátor (KONTRAKT + sprint plán)

## Ako čítať tento dokument

Samuel prešiel 16 najzávažnejších otázok naživo; pri zvyšných 84 zadal
„dokonči odpovede za mňa tak, aby to bolo optimálne a bezpečné".
Preto platí:

> **Základné pravidlo: pri každej otázke platí `**Návrh:**` z `01-DOTAZNIK-100-OTAZOK.md`,
> okrem otázok vymenovaných nižšie v sekcii „Odchýlky".**

Návrhy boli písané ako vzájomne konzistentná sada, takže ich hromadné
prijatie nevytvára rozpory. Odchýlky sú dve a obe sú rozobrané vrátane
dôsledkov.

---

## Naživo potvrdené otázky (16)

Všetky potvrdené v znení návrhu, ak nie je uvedené inak.

| Ot. | Téma | Odpoveď |
| --- | ---- | ------- |
| **21** | konflikt scheduler × 48 h TTL | **a)** stav `needs_key` ako fail-closed sieť |
| **22** | eager write s budúcim `from` | **a)** áno, **default ZAPNUTÉ**, keď je kľúč pri vytváraní platný |
| **2** | potvrdenie pred zápisom | **a)** dvojkrok dry-run → „Zapísať do PRODUKCIE" |
| **4** | vypočítaná zľavnená cena | **a)** áno, s upozornením na zaokrúhlenie shopu |
| **11** | zadanie percenta | **a)** celé čísla 1–30 + čipy 5/10/15/20/25/30 |
| **16** | „Zopakovať zlyhané" | **a)** vždy znova cez dry-run potvrdenie |
| **17** | výsledok nočnej kampane | **a)** len v appke (notifikačný panel + dashboard), bez SMTP |
| **18** | audit log v UI | **a)** filtre + detail so snapshotom pred/po |
| **28** | prepis existujúcej zľavy | **a)** povolené s diffom starý→nový; prekryv budúcich kampaní blokovaný |
| **33** | catch-up zmeškaných fire | **b) ODCHÝLKA — nikdy automaticky** |
| **35** | kompenzácia pri čiastočnom zlyhaní | **a)** žiadne vracanie, len dopísanie zlyhaných |
| **38** | doktrína driftu | **b)** priznávať neistotu + **formálny backlog požiadaviek na maintainera** |
| **39** | zmena ceny pred zápisom | **c) ODCHÝLKA — cenu nekontrolovať (nezastavovať zápis)** |
| **53** | overenie kľúča | **b)** sonda `setReduction` s `reduction=0` (nikdy nezapíše, rozlíši 400 vs 401/403) |
| **70** | sudo re-auth pred zápisom | **a)** áno, heslo znova ak posledná autentifikácia > 15 min |
| **79** | runaway strop | **a)** 60 zápisov/h, prekročenie = zámok do manuálneho odomknutia |
| **94** | TLS lokálne | **a)** `tls internal` + návod na trust root certu |

---

## Odchýlky od návrhu (2) a ich dôsledky

### Ot. 33 → **b)** Zmeškané spustenie sa NIKDY nedobehne automaticky

Konzervatívnejšie než návrh (ten pripúšťal auto-dobehnutie do 24 h meškania).

**Dôsledky, ktoré musí implementácia rešpektovať:**

- Každý zmeškaný fire ide do stavu `missed` a čaká na manuálne rozhodnutie —
  neexistuje časové okno, v ktorom by sa spustil sám.
- Stav `missed` musí byť viditeľný na dashboarde rovnako naliehavo ako
  `needs_key` (ot. 1a, 8c), inak kampaň prepadne bez povšimnutia.
- Manuálne spustenie zmeškanej kampane prechádza kontrolou okna z ot. 25a
  (`to` v minulosti → `prepadnutá`; `from` v minulosti → posun na dnes + audit).
- **Toto posilňuje hodnotu eager write (ot. 22a).** Keď sa zľava zapíše hneď
  pri vytváraní s budúcim `from`, žiadny fire sa nekoná a nie je čo zmeškať.
  Eager write je preto odteraz nielen odporúčaný default, ale hlavná cesta;
  odložený zápis je vedomá výnimka.

### Ot. 39 → **c)** Zmena ceny medzi dry-run a zápisom zápis NEZASTAVÍ

Voľnejšie než návrh (ten zastavoval zápis pri zmene ceny nad 5 %).

**Dôsledky a bezpečnostná protiváha:**

- Appka zapisuje **percento, nie cenu**, takže percento potvrdené v dry-run
  zostáva platné aj pri zmenenej cene. Rozhodnutie je vecne obhájiteľné.
- Riziko: potvrdil si „−15 % z 19,99 € = 16,99 €", medzitým sa cena zmenila
  na 29,99 € a zapíše sa „−15 % z 29,99 € = 25,49 €". Percento je správne,
  výsledná cena nie je tá, ktorú si videl.
- **Povinný pre-write `GET /products/get` z ot. 48a zostáva v platnosti** —
  potrebujeme ho pre snapshot. Nezaniká, len už nemá blokujúci efekt.
- **Protiváha (prevzatá z ot. 39b):** rozdiel ceny medzi dry-run a zápisom sa
  **povinne zapíše do auditu** ako `price_at_preview` vs `price_at_write`.
  V audit detaile (ot. 18a) sa pri nezhode zobrazí príznak, aby sa spätne dalo
  zistiť, že si rozhodoval nad inou cenou. Nič sa neblokuje, nič sa nezamlčí.

---

## Zvyšných 84 otázok

Platí `**Návrh:**` z `docs/01-DOTAZNIK-100-OTAZOK.md` bez zmeny. Pre orientáciu
syntetizátora tu sú zosumarizované nosné rozhodnutia, ktoré z tých návrhov
vyplývajú:

**UX/UI** — dashboard = stav kľúča + ohrozené kampane + 10 allowlist produktov (1a);
dry-run ukazuje diff tabuľku per produkt (3a); TTL badge v hlavičke s farebnou
zmenou pod 6 h (5a); trvalý červený pruh „PRODUKCIA — sperky-eshop.sk" (6a);
per-produkt badge „podľa vlastného zápisu z DD.MM." (7a); ohrozené kampane
agregované na dashboarde (8c); expirácia kľúča počas otvoreného formulára
neničí rozpracované dáta (9a); po expirácii read-only režim, nie blokáda (10a);
kalendárové pickery + presety (12a); explicitný výklad hraníc dňa v UI (13a);
plná sada stavov kampaní s filtrom (14a); čiastočné zlyhanie ako tabuľka per
produkt s „Zopakovať zlyhané" (15a); „Predĺžiť" edituje len `to` (19a);
onboarding checklist doména → kľúč → allowlist → dry-run (20a).

**Logika** — dopálenie po zadaní nového kľúča automaticky pre kampane stále
v okne (23a, 24a); pravidlá skráteného/prešlého okna (25a); pripomienky
48/24/2 h pred spustením (26a); predĺženie = rovnaké `from` a %, nové `to` (27a);
kalendárna validácia 3 mesiacov (29a); `from` ≥ dnes, jednodňová zľava
s potvrdením (30a); Europe/Bratislava v logike, UTC pečiatky v DB (31a);
scheduler zapisuje o 00:05 (32a); pri čiastočnom zlyhaní pokračovať cez všetky
produkty a reportovať (34a); idempotentný retry preskočí potvrdené OK (36a);
globálny mutex na zápisové operácie (37a); odobranie z allowlistu blokované,
kým existujú plány (40a).

**API** — centrálna taxonómia chýb v api-clientovi (41a); 429 = čakať
Retry-After, strop 90 s, max 3 pokusy (42a); 500/sieť = 3 pokusy 2/4/8 s, opreté
o idempotenciu identického payloadu (43b); timeouty 10 s čítanie / 30 s zápis (44b);
timeout po odoslaní → poslať identický payload znova a rozhodnúť podľa druhej
odpovede (45a); sekvenčne s pauzou 250 ms (46a); mapa kódov na slovenské hlášky
+ raw kód (47a); povinný pre-write GET pre snapshot (48a); `not found` blokuje
len daný produkt (49a); po zápise uložiť celý payload + raw odpoveď + status,
**nikdy kľúč** (50a); 401 aj 403 = okamžitý wipe kľúča (51a, 52a); nečakaný tvar
odpovede pri HTTP 200 = „stav neistý" + eskalácia (54a); canary GET pri uložení
configu a pred každým fire (55a); batch na čítanie 10 detailov s fallbackom (56a);
cache katalógu sa obnovuje pri otvorení formulára (57a); User-Agent
`aura-zlavy/<verzia>` + hierarchické korelačné ID (58a); polnočná hrana riešená
prepočtom pri fire + zamrznutie ±60 s (59a); pri `has_attributes` upozorniť, že
ceny variantov appka negarantuje (60a).

**Bezpečnosť** — master key ako read-only bind-mount súbor chmod 400 (61a);
rotácia master key = wipe + nové zadanie (62a); wipe = prepis ciphertextu
náhodnými dátami + DELETE + audit `key_wiped`, kontrola lazy aj minútovým
tickom (63a); plaintext kľúč žije len na moment requestu, potom `Buffer.fill(0)`
(64a); v UI nikdy nezobraziť kľúč, len posledné 4 znaky (65a); centrálny redaktor
+ **test, ktorý zlyhá pri výskyte kľúča v logoch/audite** (66a); panic button
„kľúč unikol" = wipe + zrušenie čakajúcich kampaní + runbook (67a); heslo min 12
znakov, argon2id (68a); session 8 h absolútna + 30 min idle, httpOnly/Secure/
SameSite=Strict (69a); brute-force 5 pokusov/15 min + exponenciálny lockout (71a);
CSRF = SameSite=Strict + Origin check (72a); bez 2FA (73a); audit append-only cez
DB granty (74a); audit nemazať nikdy (75a); tabuľku kľúča vylúčiť zo záloh (76a);
zápisy len pri `NODE_ENV=production` **A** `WRITES_ENABLED=true`, dev = vynútený
dry-run (77a); startup assertion na bind 127.0.0.1 (78a); doména len https,
zmena vyžaduje heslo (80a).

**Backend + Caddy** — tabuľky `campaigns`, `campaign_items`, `products_allowlist`,
`catalog_cache`, `audit_log`, `api_key`, `settings`, `users` (81a); in-process
scheduler s 60 s tickom, stav v DB (82a); stavový stroj
`scheduled → needs_key → running → done | partial | failed | missed | cancelled`
(83a); atomický claim proti dvojitému fire (84a); graceful shutdown dobehne
aktuálny produkt, `stop_grace_period` 30 s (85a); reconciliácia po havárii podľa
audit záznamov (86a); heartbeat schedulera v DB + badge v UI + `/api/health` (87a);
migrácie automaticky pri štarte s advisory lockom, fail-fast (88a); oddelený
migračný DB user, app user bez DDL a bez UPDATE/DELETE na `audit_log` (89a);
denný mysqldump bez tabuľky kľúča, rotácia 14 dní + restore test (90a);
healthchecky + `depends_on: service_healthy` (91a); štruktúrovaný JSON na stdout,
audit v DB (92a); zod validácia ENV, fail-fast (93a); security hlavičky vrátane
CSP zladenej s Next.js (95a); jediný publikovaný port `127.0.0.1:3050` = Caddy,
app aj DB len na internej sieti (96a); Caddy basic auth **aj** aplikačný login,
bcrypt hash v súbore mimo gitu + `Caddyfile.example` v repe (97a); non-root +
read-only rootfs + tmpfs /tmp + cap_drop ALL + no-new-privileges (98a); CI =
lint + typecheck + vitest + build, Playwright na PR, testy výhradne proti mocku,
**gitleaks blokujúci** (99a); upgrade runbook so zálohou a smoke testom (100a).

---

## Nezmenené rámce z 10 smerovacích otázok

Pre istotu zopakované, lebo implementácia sa o ne opiera:

1. Allowlist max 10 product ID + strop max 10 zmien na operáciu, fail-closed.
2. API kľúč: zadanie v UI, AES-256-GCM, auto-wipe po 48 h, nikdy v repe.
3. Node 22 + Next.js 16 standalone + React 19 + TypeScript + MariaDB 11.4.
4. Lokálne only 127.0.0.1, Caddy = TLS + basic auth + hlavičky, žiadny tunel.
5. Produkčný shop bez stagingu → dry-run/potvrdenie povinné.
6. Zrušenie zľavy sa nerieši, zľavy expirujú.
7. Manuálne + scheduler kampaní.
8. Len scope `product:edit`.
9. Plný audit + snapshoty + allowlist v DB, single-user.
10. Port 3050, `ovl-zliav-app` + `ovl-zliav-db`, DB `ovl_zliav`, UI „Aura Zľavy".
