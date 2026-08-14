# Kontrakt — zapracovanie API v5 (13. 8. 2026)

Zdroj: `docs/api/sperky-api-v5.md`. Nadväzuje na
`KONTRAKT-DOKONCENIE-2026-08-12.md`, invarianty z `docs/10-KONTRAKT.md`
a `docs/50-KONTRAKT-V3.md` platia ďalej okrem toho, čo je tu výslovne menené.

---

## Prečo

Maintainer shopu dodal **šesť z ôsmich** bodov nášho backlogu naraz:

| Náš bod | Čo prišlo |
|---|---|
| **B1** — najväčšia diera kontraktu | `getFull` → `reduction_percent`, `reduction_from`, `reduction_to` |
| **B2** | `POST /api/products/clearReduction` |
| **B4** | `GET /api/whoami` — scopes **a zostávajúci rozpočet** |
| **B5** | `getFull` → `purchase_price`, `margin`, `margin_percent` |
| **B6** | `getFull` → `qty` |
| **B8** | `getFull` → `categories` + `GET /api/categories` |

Navyše `GET /api/products/search` (filtrovaný, `product:read`),
`GET /api/products/searchIndex` (fuzzy, verejný) a filtre na objednávkach.

Otvorené ostáva **B3** (dávkový `setReduction`) a **B7** (denný zápisový limit).

---

## BLOKUJÚCI PREDPOKLAD: kľúč so scope `product:read`

`getFull`, `search` aj `categories` vyžadujú **`product:read`**. Appka dnes
pozná dva scopes — `product:edit` (zápisový kľúč) a `orders:read` (objednávky).
**`product:read` nemá.**

Bez neho sa dá všetko naprogramovať a otestovať proti mocku, ale **nedá sa to
overiť naostro** a používateľ z toho nič nemá. Je to jednoveta pre maintainera:

> Prosíme kľúč (alebo rozšírenie existujúceho) so scope `product:read`.

Kým nepríde, body A a C nižšie končia „hotové, čaká na kľúč".

---

## Odsúhlasené rozhodnutia (13. 8. 2026)

| # | Rozhodnutie | Dôsledok |
|---|---|---|
| **R1** | `clearReduction` sa zapojí — **s potvrdením a auditom** | **Invariant I7 sa MENÍ.** Doteraz znel „appka NIKDY neruší zľavu v shope". Po novom: appka zľavu zruší LEN na výslovný pokyn človeka, s vlastným potvrdením, zápisom do auditu a odrátaním z denného rozpočtu. Automatické ani hromadné rušenie NEVZNIKÁ. |
| **R2** | Stav zľavy sa bude **overovať a rozdiely hlásiť** | **Invariant I11 sa MENÍ.** Doteraz appka smela tvrdiť len to, čo sama zapísala; 17 miest v UI preto nesie výhradu „podľa vlastných zápisov". Po novom porovnáva svoj záznam so skutočnosťou z `getFull` a rozdiel nahlási. |
| **R3** | Katalóg **zostáva**, hľadanie sa **pridáva** | Zrkadlenie katalógu funguje aj bez shopu a je rýchle. `search`/`searchIndex` pribudne ako doplnok na dohľadanie toho, čo ešte nemáme. |

---

## Rozsah — ČO ÁNO

### A. Overovanie skutočnosti (R2) — najväčší kus

- A1 Čítanie `getFull` a mapovanie nových polí.
- A2 Porovnanie „čo sme zapísali" vs. „čo v shope naozaj je"; rozdiel je
  **nález, nie chyba** — appka ho ukáže a povie, čo s ním.
- A3 Odstránenie výhrady „podľa vlastných zápisov" zo 17 miest tam, kde už
  platí meraný fakt. Tam, kde sa overiť nedá, výhrada ZOSTÁVA.
- A4 Overenie po zápise: po dobehnutí fronty sa vzorka produktov prečíta
  a potvrdí sa, že zľava sedí.

### B. Rušenie zľavy (R1)

- B1 Akcia „Zrušiť zľavu" na detaile — jeden produkt aj celá zľava, vždy
  s potvrdením a auditom, vždy z denného rozpočtu.
- B2 Kompenzácia pri čiastočnom zlyhaní prestáva byť jednosmerná.
- B3 Invariant I7 sa prepíše v `docs/10-KONTRAKT.md` aj v grep teste, ktorý ho
  dnes stráži (`test/unit/no-clear-reduction.spec.ts`) — test sa NEMAŽE, mení sa
  na „rušenie ide výhradne cez jedno miesto a nikdy automaticky".

### C. Odomknutie zamknutých funkcií (B5, B6, B8)

- C1 `purchase_price`, `margin`, `margin_percent` → marža a odhad dopadu.
- C2 `qty` → sklad aj pre nevariantné produkty.
- C3 `categories` + `GET /api/categories` → filtre podľa kategórie.
- C4 `LockedFeatures.tsx` sa zmenší o to, čo prestalo byť zamknuté.

### D. Kľúč a limity (B4)

- D1 `whoami` nahradí sondu na `setReduction`. **Toto je tá 22. požiadavka,
  ktorú maintainer videl v štatistike.**
- D2 Skutočné limity sa budú čítať z `whoami.remaining` namiesto natvrdo
  zapísaných čísel. Dokumentácia v5 už sekciu o limitoch nemá, takže naše
  20/200 a 30/300 sú odteraz bez zdroja.
- D3 Podpora scope `product:read` v správe kľúčov.

### E. Hľadanie (R3)

- E1 `searchIndex` (verejný, fuzzy) na dohľadanie produktu, ktorý ešte nie je
  v zrkadle katalógu.
- E2 `search` (s kľúčom) na filtrovanie podľa kategórie a ceny.

### F. Nové chyby

- F1 `blocked_by_flash_sale` (409) — vlastné pomenovanie a slovenská veta.
  Dnes spadne do generickej „neplatná požiadavka". TurboSaleUltimate vlastní
  polia zľavy, kým beží, takže je to **dočasná** prekážka, nie chyba údajov.
- F2 `range_too_long`, `invalid_reduction`, `invalid_dates` — pomenovať.

---

## Rozsah — ČO NIE

- **Dávkový `setReduction`** (B3) — API to stále nepovoľuje.
- **Automatické rušenie zľiav.** R1 je výslovne len ručná akcia.
- **Nahradenie katalógu hľadaním** — zamietnuté v R3.
- **Zákaznícke údaje.** `order/get` teraz vracia `country`, `country_iso`,
  `total_paid` a `currency`. Invariant I8' platí ĎALEJ: do appky sa dostane
  výhradne id, deň a kusy po produkte. Nové polia sa NEUKLADAJÚ.
- **Historické mesiace predajnosti** — samostatná téma.

---

## Akceptačné kritériá

1. Appka pozná scope `product:read` a vie povedať, či ho kľúč má.
2. `whoami` nahradil sondu; v štatistike shopu už `setReduction` nevolá nič
   iné než skutočné zápisy.
3. Limity sa čítajú z `whoami.remaining`; natvrdo zapísané čísla sú len
   záloha pre prípad, že sa `whoami` nedá prečítať.
4. Pri produkte je vidieť **skutočnú** zľavu zo shopu aj to, čo o nej appka
   sama vie — a keď sa rozchádzajú, povie to.
5. Zľava sa dá zrušiť z obrazovky, s potvrdením, a je to v audite.
6. Marža, sklad a kategórie sú odomknuté; `LockedFeatures` obsahuje len to,
   čo je naozaj ešte zamknuté.
7. `blocked_by_flash_sale` má vlastnú vetu, ktorá hovorí, že ide o dočasný
   stav a kedy skúsiť znova.
8. Invarianty I1, I3, I8', I10, I13 doložené testami. I7 a I11 v novom znení,
   vrátane prepísaných grep testov.
9. Typecheck, lint, celý balík, e2e a produkčný build zelené.

---

## Riziká

| # | Riziko | Ako s ním narábam |
|---|---|---|
| **RZ1** | Bez kľúča `product:read` sa polovica šprintu nedá overiť naostro. | Píše sa proti mocku podľa v5 dokumentácie; ostré overenie čaká na kľúč. Povie sa to nahlas v reporte. |
| **RZ2** | Zmena I7 a I11 sú **zmeny invariantov**, nie funkcií. | Oba sa prepíšu v kontrakte aj v grep testoch, ktoré ich strážia. Testy sa nemažú, menia sa. |
| **RZ3** | `getFull` je volanie NA PRODUKT. Overovať 41 tisíc produktov sa nedá. | Overuje sa vzorka a to, čo appka sama zapísala — nie celý katalóg. |
| **RZ4** | Flash sale môže zápis odmietnuť kedykoľvek. | F1 to pomenuje; položka skončí ako zlyhaná s vysvetlením, nie ako neistá. |

---

## Výsledok

*(dopĺňa sa po dokončení)*
