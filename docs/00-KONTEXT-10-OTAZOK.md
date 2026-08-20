# OVL-DA-ZLIAV — 10 smerovacích otázok (kontext pred 100-otázkovým dotazníkom)

**Projekt:** lokálna Docker appka na ovládanie zliav v eshope Šperky cez API
**Dátum:** 2026-08-05
**Branch:** `claude/local-eshop-discount-app-yqxkpg`
**Stav:** ZODPOVEDANÉ 2026-08-05 → beží fáza 100 otázok (2 generátori → kritik → dotazník s návrhmi)

---

## Čo už viem z API dokumentácie (docs/api/sperky-api.md)

Zapisujem sem, pretože tri veci priamo obmedzujú, čo appka vôbec môže robiť:

1. **`POST /api/products/setReduction` je jediný write endpoint.** Appka nemôže robiť
   nič iné než nastaviť percentuálnu zľavu s časovým oknom. Žiadne fixné zľavy
   (`reduction_price` sa naopak *maže*), žiadne cenníky, žiadne kupóny.
2. **Zľavu nie je možné zmazať.** `reduction` musí byť `> 0`, takže neexistuje
   „clear" operácia. Jediný spôsob zrušenia je nastaviť `to` do minulosti —
   a to je hack, nie API funkcia. Bez nového endpointu na strane shopu bude
   „zruš zľavu" vždy len „nechaj ju expirovať".
3. **Strop 30 % a okno max 3 mesiace.** Appka to musí validovať sama pred volaním,
   inak dostane `400 invalid_reduction` / `range_too_long`.

Ďalšie fakty do dizajnu:
- `setReduction` **nie je batchable** → 10 produktov = 10 samostatných requestov.
  Rate limit 300/60s to unesie, ale nie je to atomické — pri chybe v 7. requeste
  je 6 produktov už zmenených a treba to riešiť kompenzáciou, nie rollbackom.
- `GET /api/products` a `GET /api/products/get` sú **verejné**, bez auth. Na čítanie
  katalógu teda API kľúč netreba vôbec — kľúč je potrebný výhradne na zápis.
  To je dobrá správa pre bezpečnostný model: čítacia časť appky funguje aj po
  expirácii kľúča.
- `GET /api/products` **nevracia aktuálnu zľavu** produktu (len `id`, `name`,
  `price`, `has_attributes`). `GET /api/products/get` tiež nie. **Appka teda nemá
  ako zistiť, aká zľava je na produkte práve teraz** — vie len to, čo sama zapísala.
  Toto je najväčšia diera v kontrakte a je to kandidát na požiadavku voči shopu.
- `/api/order` (scope `orders:read`) je jediný zdroj dát o predajnosti, ak by mala
  appka radiť *ktoré* produkty zlevniť.

---

## Otázky

### 1. Čo presne znamená „max 10 produktov"?

Toto je najdôležitejšia otázka, určuje celý bezpečnostný model.

- **(a) Allowlist 10 konkrétnych ID + strop na dávku** ← *odporúčam*
  V configu je pevný zoznam max 10 povolených product ID. Appka odmietne akékoľvek
  iné ID ešte pred volaním API (fail-closed) a zároveň jedna operácia zmení max 10
  produktov. Dvojitá poistka: ani chyba v UI, ani preklep v ID nedokáže siahnuť na
  240 produktov v shope.
- **(b) Len allowlist 10 konkrétnych ID** — ostatné produkty sa v UI vôbec nezobrazia;
  zmena testovacej desiatky = zmena configu + restart.
- **(c) Max 10 aktívnych zliav naraz** — appka vidí celý katalóg, odmietne 11. súbežnú
  zľavu. Voľnejšie na testovanie, slabšia ochrana.
- **(d) Max 10 zmien na jeden beh** — limit len na počet volaní v jednej operácii.
  Chráni pred hromadnou nehodou, nie pred zásahom do zlého produktu.

**Odpoveď:** **(a) Allowlist 10 konkrétnych ID + strop na dávku.** Fail-closed, dvojitá poistka.

---

### 2. Ako má appka zaobchádzať s API kľúčom?

Napísal si, že tam nesmie ostať — ideálne rotovať alebo po 48 h vymazať.

- **(a) Zadanie v UI + šifrovaný na disku + 48 h auto-wipe** ← *odporúčam*
  Kľúč nie je nikde v repozitári ani v `.env`. Vložíš ho vo formulári, uloží sa
  zašifrovaný (AES-256-GCM, master key mimo gitu) s TTL 48 h. UI ukazuje odpočet do
  expirácie; po expirácii sa záznam prepíše a appka žiada nový. Prežije restart
  kontajnera, ale nie 48 h.
- **(b) Len v pamäti procesu** — restart = nové zadanie. Najbezpečnejšie voči disku
  a zálohám, ale nekompatibilné s naplánovanými kampaňami.
- **(c) `.env` + pripomienka na rotáciu** — appka kľúč sama nemaže. Presne to, čo si
  v AuraAI označil ako nedoriešené (bcrypt hash v git-trackovanom Caddyfile).
- **(d) Docker secret (file mount, nie env) + nočný TTL job** — po 48 h appka spadne
  do read-only režimu. Rotácia je manuálna operácia na hoste.

**Odpoveď:** **(a) Zadanie v UI + šifrovaný na disku (AES-256-GCM) + 48 h auto-wipe.** Master key mimo gitu, UI s odpočtom.

---

### 3. Aký stack?

V Hades máš zapísané pravidlo „nové appky stavaj na VETVE B", ale toto je malý
interný nástroj.

- **(a) Vetva B — Node 22 + Next.js 16 standalone + React 19 + TS + MariaDB 11.4** ← *odporúčam*
  Fork infra zo sperky-ai: numerované migrácie, `defineRoute()` pipeline
  auth→rateLimit→zod→handler, argon2id + jose JWT, vitest + Playwright, non-root
  kontajner. Appka mení ceny naostro a drží API kľúč — audit log a testy tu nie sú luxus.
- **(b) Vetva A — Node 20 + Express 4 + vanilla SPA + MariaDB** — postaví sa o polovicu
  rýchlejšie, ale podľa tvojho vlastného auditu má vetva A 0 testov, bez CSRF,
  bez rate-limitu a fallback heslá v kóde.
- **(c) Minimal — jeden kontajner, Node + SQLite** — najrýchlejší štart, ale vypadáva
  z rodiny (iný backup mechanizmus, iné migrácie) a horšie sa z toho rastie.

**Odpoveď:** **(a) Vetva B** — Node 22 + Next.js 16 standalone + React 19 + TS + MariaDB 11.4, fork infra zo sperky-ai.

---

### 4. Ako bude appka dostupná? (načo tam bude Caddy)

- **(a) Lokálne only, Caddy ako TLS + basic auth + hlavičky, žiadny tunel** ← *odporúčam*
  Port publikovaný len na `127.0.0.1`. Appka, ktorá mení ceny v produkčnom eshope,
  nemá dôvod byť na internete. Caddy je tam preto, aby bola cesta k expozícii
  pripravená, nie otvorená.
- **(b) Lokálne + vypnutý compose profil `tunnel` s cloudflared** — zapneš príkazom keď
  treba. Pozor na pascu z AuraAI: `trusted_proxies static private_ranges` v globálnom
  bloku Caddyfile, inak sa https schéma stratí v Caddy a appka pošle mixed content.
- **(c) Za aura-gateway (forward_auth na hub)** — bez vlastného loginu, subdoména.
  Zapadá do plánu Aura Suite F2–F6, ale viaže projekt na hotovosť gateway.
- **(d) Čisto lokálne, bez Caddy** — zahodí to bod „Caddy" zo zadania.

**Odpoveď:** **(a) Lokálne only** — port len na 127.0.0.1, Caddy ako TLS + basic auth + hlavičky, žiadny tunel.

---

### 5. Máš už API kľúč so scope `product:edit`? A na akej doméne testujeme?

Dokumentácia hovorí „keys are issued out-of-band — contact the shop maintainer".

- Doména shopu (`https://<shop-domain>`): ______________________
- Kľúč `product:edit`: **(a)** už ho mám · **(b)** treba vyžiadať · **(c)** mám len testovací
- Existuje **staging/test eshop**, kde sa dá zľava nasadiť naprázdno, alebo ide hneď
  o produkčný shop s reálnymi zákazníkmi? ← toto rozhoduje, či bude dry-run režim
  povinný default alebo len voliteľný prepínač.

**Odpoveď:** **(a) Kľúč `product:edit` už mám. Ide o PRODUKČNÝ shop** (staging nie je) → dry-run/potvrdenie pred zápisom je povinný default. Doména sa nezapisuje do repa — zadá sa v UI/configu.

---

### 6. Ako riešiť „zruš zľavu", keď to API nepodporuje?

- **(a) Appka nastaví `to` na včerajší dátum** ← *odporúčam ako dočasné riešenie*
  Funguje s dnešným API, zľava prestane platiť. Nevýhoda: v shope zostane
  `reduction_percent` zapísaná s expirovaným oknom, nie vyčistená.
- **(b) Vyžiadať od maintainera shopu nový endpoint** `clearReduction` — čisté riešenie,
  ale blokuje funkciu na cudzej strane.
- **(c) Zrušenie neriešime vôbec** — zľavy len prirodzene expirujú, appka vie len
  zakladať a predlžovať.

A doplňujúca: **má appka vedieť zľavu skrátiť/upraviť** po nasadení, alebo je zápis
jednorazový?

**Odpoveď:** **(c) Zrušenie neriešime** — zľavy len prirodzene expirujú; appka vie zakladať a predlžovať. (Hack s `to` do minulosti sa neimplementuje.)

---

### 7. Manuálne ovládanie, alebo aj plánovanie kampaní?

- **(a) Len manuálne** — vyberieš produkty, percento, dátumy, klikneš, appka zapíše.
  Najmenej dielov, žiadny scheduler, žiadny beh na pozadí.
- **(b) Manuálne + plánované kampane so schedulerom** — appka drží plán a zapisuje ho
  v určený čas. Pozor: toto je v priamom rozpore s možnosťou #2b (kľúč len v pamäti) —
  scheduler potrebuje kľúč aj po restarte.
- **(c) Manuálne + šablóny** — pripravené sady (napr. „Vianoce -20 %, 1.12.–31.12.")
  na jedno kliknutie, ale spúšťa ich vždy človek. ← *odporúčam ako kompromis*

**Odpoveď:** **(b) Manuálne + plánované kampane so schedulerom.** ⚠️ Napätie s odpoveďou 2 (48 h TTL kľúča) — rieši sa v 100-otázkovom dotazníku.

---

### 8. Má appka pýtať aj scope `orders:read`?

- **(a) Nie, len `product:edit`** ← *odporúčam*
  Least privilege. Objednávky obsahujú zákaznícke dáta a appka na zmenu zliav ich
  nepotrebuje. Zároveň to znamená, že appka nedokáže radiť „čo sa predáva".
- **(b) Áno** — appka bude vedieť ukázať predajnosť produktu za obdobie a navrhovať,
  čo zlevniť. Znamená to však, že lokálna appka drží kľúč s prístupom k zákazníckym
  dátam, a spadá to pod GDPR úvahy (čo sa loguje, ako dlho).
- **(c) Áno, ale ako druhý oddelený kľúč**, ktorý sa dá vypnúť nezávisle.

**Odpoveď:** **(a) Nie, len `product:edit`.** Least privilege, bez zákazníckych dát.

---

### 9. Čo si má appka pamätať? (a teda aký audit)

- **(a) Plný audit log každej zmeny + snapshot pred/po + allowlist v DB** ← *odporúčam*
  Kto, kedy, ktorý produkt, z čoho na čo, aká odpoveď prišla z API. Pri appke, ktorá
  mení ceny naostro, je toto jediný spôsob ako po týždni zistiť, prečo je produkt v akcii.
- **(b) Len log posledných N operácií** — ľahšie, ale bez histórie.
- **(c) Nič, appka je bezstavová** — konzistentné s „kľúč len v pamäti", ale znamená to,
  že appka nevie ani to, ktoré zľavy sama nasadila (a API to nevracia — viď diera vyššie).

Doplňujúca: **kto sa do appky prihlasuje** — len ty, alebo aj niekto z tímu?
Ak aj niekto ďalší, treba roly (kto smie zapisovať vs. len pozerať).

**Odpoveď:** **(a) Plný audit log + snapshot pred/po + allowlist v DB.** Prihlasuje sa **len Samuel** — jeden admin účet, bez rolí.

---

### 10. Umiestnenie, port, názvy kontajnerov

Podľa rodinnej konvencie a obsadených portov (3000 sperky-ai, 3010 northstar,
3011 ads-hierarchy, 3030 aura-kpi, 3040 aura-roadmap, 3060 plánované tržby):

- **(a) `C:\Aura\ovl-da-zliav`, port 3050, kontajnery `ovl-zliav-app` + `ovl-zliav-db`,
  DB `ovl_zliav`, cookie `ovl_zliav_session`** ← *odporúčam*
- **(b) iné umiestnenie / port:** ______________________

Pozor na pascu z Hades: **service name v compose musí byť unikátny** (nie `app`),
inak koliduje network alias s iným stackom a Caddy začne servírovať cudziu appku.

A ešte: **má názov appky zostať `ovl-da-zliav`**, alebo to premenovať na rodinné
(napr. `aura-zlavy`)? Repo názov je daný, ide o zobrazovaný názov v UI.

**Odpoveď:** **(a)** `C:\\Aura\\ovl-da-zliav`, port **3050**, kontajnery `ovl-zliav-app` + `ovl-zliav-db`, DB `ovl_zliav`, cookie `ovl_zliav_session`. Zobrazovaný názov v UI: **Aura Zľavy**.

---

## Čo sa stane po odpovediach

1. **2 agenti** paralelne vygenerujú 100 otázok v 5 oblastiach
   (UX/UI · Logika · API · Bezpečnosť · Backend+Caddy) — každý zo svojho pohľadu.
2. **1 agent kritik** prejde oba návrhy: vyhodí duplikáty, označí otázky, ktoré sú
   už zodpovedané tu alebo v API dokumentácii, a doplní čo obom ušlo.
3. **1 agent** pripraví finálny dotazník s **navrhnutou odpoveďou pri každej otázke**,
   aby si len potvrdzoval alebo prepisoval.
4. Odpovieš → **agent syntetizátor** napíše KONTRAKT + sprint plán.
5. **Implementácia, max 20 agentov** podľa sprint plánu.
