# Odkiaľ idú volania na API — rozbor (12. 8. 2026)

**Pre:** Delaja
**Podnet:** štatistika endpointov, 742 volaní / 40 rôznych ciest, okno ~7 dní,
a poznámka „furt skúša kopec random endpointov".

Krátka odpoveď: **z tohto počítača ide štyri z tých ciest a všetky sú
legitímne.** Zvyšok, hlavne `v1/*` a `auth/*`, nevolá ani jedna appka, ktorú tu
máme — a čísla naznačujú, že to nie je aplikácia, ale skener.

---

## 1. Čo z tohto počítača na shop naozaj chodí

Prehľadal som všetky projekty v `C:\Aura`. Shop API volajú **dve appky**, každá
s vlastným kľúčom:

| Appka | Kľúč (scope) | Volá |
|---|---|---|
| **Ovládač zliav** (`ovl-da-zliav`) | `product:edit` + `orders:read` | `/api/products`, `/api/products/get`, `/api/products/setReduction`, `/api/batch`, `/api/order`, `/api/order/get` |
| **Aura AI** (`aura-ai`) | `orders:read` | `/api/products`, `/api/products/get`, `/api/order`, `/api/order/get` |

Ovládač zliav má tých šesť ciest **vynútených testami**, ktoré skenujú zdrojový
kód — nie je to dohoda, je to podmienka, bez ktorej neprejde build:

```
src/lib/shop/client.ts         SHOP_PATHS  = products, products/get,
                                             products/setReduction, batch
src/lib/shop/orders-client.ts  ORDERS_PATHS = order, order/get
```

**Vylúčené appky:** `aura-hub` a `aura-logistika` majú `sperky-eshop.sk`
v konfigurácii len ako **e-mailovú adresu správcu** (`ADMIN_EMAIL`). Shop API
nevolajú vôbec; ich vlastné `/api/auth/*` sú ich interné endpointy, nie tvoje.

**n8n na tomto počítači nebeží** — ani v kontejneri, ani nativne.

---

## 2. Ktoré riadky štatistiky sú naše

| Endpoint | Počet | Naše? | Vysvetlenie |
|---|---|---|---|
| `products - setReduction` | 22 | **áno, celé** | 21 zápisov jednej zľavy dnes 12:51:47–12:53:08 **+ 1 sonda platnosti kľúča**. Doložené v našom audit logu. |
| `products - index` | 96 | **áno, delené** | stránkované čítanie katalógu (100 produktov/stránka). Delíme sa o to s Aura AI. |
| `products - get` | 21 | **áno, delené** | detail produktu pred zápisom |
| `order - index` | 10 | **áno, delené** | denné súčty predaja |
| `auth - index / session / callback` | 115 + 115 + 115 | nie | nevolá žiadna naša appka |
| `v1 - auto_login` | 61 | nie | — |
| `products - search` | 33 | nie | tento endpoint nepoužívame |
| `graphql - index` | 27 | nie | — |
| `config - index` | 14 | nie | — |
| `settings - index` | 12 | nie | — |
| `user - index`, `login - index` | 7 + 7 | nie | — |
| `v1 - workflows / executions / secrets / credentials` | 7 každý | nie | — |

Tá **22. sonda** je mimochodom vec, ktorú chceme zrušiť: platnosť kľúča dnes
overujeme volaním na `setReduction`, pretože API nemá čítací endpoint na
overenie kľúča. Je to vedomý trik na zápisovom endpointe. Stačí `whoami` alebo
`health` s identitou kľúča a zmizne úplne (bod **B4** nášho backlogu).

---

## 3. Prečo si myslíme, že tie ostatné nie sú aplikácia

Pozri sa na čísla, nie na názvy:

```
auth - index       115  ┐
auth - session     115  ├─ tri nesúvisiace cesty, IDENTICKY 115
auth - callback    115  ┘

user - index         7  ┐
login - index        7  │
v1 - workflows       7  ├─ šesť nesúvisiacich ciest, IDENTICKY 7
v1 - executions      7  │
v1 - secrets         7  │
v1 - credentials     7  ┘
```

Aplikácia nevyrobí rovnaký počet na nesúvisiacich endpointoch — má rôzne
funkcie, ktoré sa volajú rôzne často. **Skener áno**: prejde pevný zoznam ciest,
každú raz, a zopakuje to sedemkrát.

A tá štvorica `v1/workflows` + `v1/executions` + `v1/credentials` + `v1/secrets`
je učebnicová sada, ktorou boti hľadajú **odhalenú n8n instanciu**. To isté
platí pre `graphql`, `config` a `settings` — bežné cieľe automatizovaného
skenovania. Sú to verejné cesty na verejnom eshope, takže ich trafí ktokoľvek
z internetu a zaloguje sa to, aj keď dostane 401 alebo 404.

---

## 4. Ako to potvrdiť alebo vyvrátiť jedným dotazom

Zoskup tie riadky podľa **zdrojovej IP**, **user agenta** a **HTTP kódu**:

- Naše volania: **jedna IP**, náš user agent, kód **200**.
- Skenovanie: veľa IP adries, skenerové user agenty, kódy **401 / 403 / 404**.

Ak sa to potvrdí, nie je to chyba integrácie, ale bežný internetový šum — a
otázka pre teba je len, či to chceš filtrovať na úrovni WAF alebo rate limitu
pre neautentifikované volania.

---

## 5. Mimochodom, jedna vec na našej strane

Ovládač zliav číta katalóg **bez kľúča**, takže spadá pod anonymnú politiku
(30/min, 300/UTC deň), ktorá sa počíta **na zdrojovú IP**. Delí sa teda o ňu so
všetkým ostatným, čo z tohto počítača na shop ide — vrátane Aura AI. Katalóg má
41 082 produktov, čo je 411 stránok, takže sa do jedného dňa nezmestí.

Ak by čítanie katalógu dostalo **vlastný čítací kľúč**, prestalo by súťažiť
s ostatnou prevádzkou z tej istej IP. Podrobnosti a zvyšok požiadaviek sú
v `docs/53-ZIADOST-O-KLUCE.md` a `docs/54-PRE-IT-2026-08-12.md`.
