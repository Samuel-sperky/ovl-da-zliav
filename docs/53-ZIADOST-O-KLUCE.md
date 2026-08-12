# Žiadosť o API kľúče s vyšším rozpočtom

**Pre:** správcu API shopu sperky-eshop.sk (Delaja)
**Od:** Aura Zľavy (ovládač zliav), 12. 8. 2026
**Prečo teraz:** appka je hotová a vie zapisovať, ale pri dnešnej politike kľúča
trvá jedna reálna zľava dlhšie, než platí kľúč, ktorým sa má zapísať.

---

## Čo dnes platí

Z `docs/api/sperky-api-v4.md`, sekcia „Rate limiting":

> **With a valid API key:** the database policy attached to that key (default
> staff policy: 20/minute and 200/UTC day), budgeted independently per key.
> **Without one:** 30/minute and 300/UTC day, budgeted per source IP.

Appka teda beží na **predvolenej staff politike**. Admin obrazovka správy kľúčov
(nasadená 8. 8.) má polia *Requests/minute*, *Requests/day*, *Expiration* a
scope prepínače, takže vyššia politika je nastavenie kľúča — nie zmena v shope
ani v ovládači.

---

## Aritmetika, ktorá z toho plynie

`POST /api/products/setReduction` je **jeden request na jeden produkt** a
**nie je batchable** — v `/api/batch` sú opted-in iba `products/get` a
`order/get`, a dávka aj tak rozpočet nešetrí („25 items still spend 25 hits").

| Veľkosť zľavy | Pri 200 zápisoch / UTC deň |
|---|---|
| 150 produktov | necelý deň |
| 1 000 produktov | 5 dní |
| 5 000 produktov | **25 dní** |
| 8 000 produktov | **40 dní** |

Reálne použitie je 5–10 tisíc produktov na jednu zľavu. Kľúč má životnosť
48 hodín, takže **fronta prežije kľúč mnohonásobne** — zľava sa nedá dokončiť
jedným kľúčom a musí sa počas behu opakovane obnovovať.

Čítanie katalógu má rovnaký problém z druhej strany: 41 082 produktov po 100 na
stránku je **411 stránok**, čítame bez kľúča, a anonymný strop je 300 volaní na
UTC deň. Celý katalóg sa teda nedá načítať za jeden deň — a keďže rozpočet je
na IP, delíme sa oň so všetkým ostatným, čo z toho počítača na shop chodí.

---

## O čo konkrétne žiadame

### 1. Zápisový kľúč — scope `product:edit`

| Parameter | Dnes | Žiadame | Prečo |
|---|---|---|---|
| Requests/day | 200 | **6 000** | 5 000-produktová zľava dobehne za jeden deň, nie za 25 |
| Requests/minute | 20 | **60** | 5 000 zápisov pri 60/min = ~1,5 h; pri 20/min = 4,2 h |
| Expiration | — | **aspoň 7 dní** | fronta musí prežiť víkend bez zásahu človeka |

Ovládač drží medzi zápismi vlastnú pauzu a nikdy nezapisuje paralelne
(invariant I10), takže nastavené tempo aj reálne dodrží.

### 2. Čítací kľúč — scope na čítanie produktov

| Parameter | Žiadame | Prečo |
|---|---|---|
| Requests/day | **1 000** | 411 stránok katalógu naraz, s rezervou na opakovania |
| Requests/minute | 30 | katalóg sa načíta za ~15 minút namiesto dvoch dní |

Dnes sa katalóg číta anonymne. Keby čítanie dostalo vlastný kľúč, prestane sa
rozpočet deliť s ostatnou prevádzkou z tej istej IP a hlavne prestane byť
dvojdňové.

### 3. Otázka, nie požiadavka

Dá sa `products/setReduction` opt-in-núť do `/api/batch`? Rozpočet by to podľa
dokumentácie neušetrilo, ale ušetrilo by to réžiu spojení a hlavne by to spravilo
zápis dávky **atomickejším** — dnes pri chybe v siedmom z desiatich requestov
zostane šesť produktov zmenených a treba kompenzáciu, nie rollback.
(Toto je bod B3 v `docs/20-BACKLOG-SHOP-API.md`.)

---

## Čo NEžiadame

- **Rozloženie záťaže medzi viac kľúčov.** Dokumentácia to zakazuje a ovládač to
  nerobí ani nebude.
- **Obídenie limitov.** Ovládač limity rešpektuje aj vtedy, keď ho to spomalí —
  konštanty sú v `src/lib/shop/rate-limits.ts` a držia 20 % rezervu pod stropom.

---

## Čo sa stane, kým to nemáme

Ovládač funguje, ale zmysluplne len v malom: prvá reálna zľava je **do 150
produktov**, čo sa zmestí do jedného dňa pri dnešnej politike. Väčšie zľavy majú
čas dokončenia v týždňoch, čo je neprevádzkovateľné.
