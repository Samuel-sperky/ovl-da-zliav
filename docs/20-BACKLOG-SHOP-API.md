# Aura Zľavy — BACKLOG NA MAINTAINERA SHOPU (D38b)

Formálny zoznam požiadaviek, ktoré zavrú diery v kontrakte API. Appka MUSÍ
fungovať aj bez nich (dnešný stav), ale MUSÍ byť napísaná tak, aby ich prijatie
znamenalo lokálnu zmenu v jednom module (api-client), nie prepis logiky.
Tento zoznam MUSÍ byť odoslaný maintainerovi shopu.

| Č. | Požiadavka | Prečo | Čo sa v appke zmení, keď to bude |
| --- | --- | --- | --- |
| **B1** | `GET /api/products` aj `GET /api/products/get` nech vracajú aktuálnu zľavu (`reduction_percent`, `reduction_from`, `reduction_to`, prípadne `reduction_price`). | Dnes appka nedokáže zistiť skutočný stav zľavy — vie len to, čo sama zapísala (D7, D38, I11). Toto je najväčšia diera kontraktu. | Zmizne flag „reduction neoveriteľná cez API", badge „podľa vlastného zápisu" sa nahradí skutočným stavom a pribudne detekcia driftu proti admin shopu. |
| **B2** | Nový endpoint `POST /api/products/clearReduction` (scope `product:edit`), ktorý zľavu vyčistí, nie len nechá expirovať. | `reduction` musí byť `> 0`, takže dnes neexistuje „clear" operácia; zrušenie zľavy sa nedá urobiť inak než hackom s `to` do minulosti, ktorý sme zakázali (R6, I7). | Pribudne akcia „Zrušiť zľavu" s vlastným potvrdením a kompenzácia pri čiastočnom zlyhaní (D35) prestane byť jednosmerná. |
| **B3** | `POST /api/products/setReduction` nech je **batchable** (opt-in pre `/api/batch`). | Dnes 10 produktov = 10 samostatných requestov, operácia nie je atomická a pri chybe v 7. requeste je 6 produktov už zmenených (D34, D35). | Dávka pôjde ako 1 batch volanie; sekvenčný režim s pauzou 250 ms zostane ako fallback (D46). |
| **B4** | Endpoint `GET /api/whoami` alebo `GET /api/health` vracajúci identitu kľúča a jeho scopes. | Dnes sa platnosť kľúča overuje sondou `setReduction` s `reduction=0` — funguje, ale je to vedomý trik na produkčnom write endpointe (D53). | Sonda sa nahradí čistým `whoami` volaním; overenie kľúča prestane siahať na write endpoint a bude vedieť aj to, ktoré scopes kľúč má. |
| **B5** | `GET /api/products/get` nech vracia **nákupnú cenu / COGS** produktu (napr. `wholesale_price` alebo `cost_price`), aspoň pre kľúč so scope `product:edit`. | Samuel chce, aby appka navrhovala kampane podľa obrátkovosti `(Ø zásoba × počet dní) / COGS`. COGS API neposkytuje vôbec, takže sa vzorec dnes nedá vyhodnotiť ani odhadnúť (plán 33 §4, karta „Obrátkovosť" je preto zamknutá). | Odomkne sa polovica výpočtu obrátkovosti; appka bude vedieť ukázať aj maržu pri navrhovanej zľave namiesto len percenta. |
| **B6** | `GET /api/products` aj `/get` nech vracajú **skladovú zásobu aj pre nevariantné produkty** (dnes je `quantity` len v poli `attributes`). | Produkt bez variantov nemá v odpovedi žiadnu zásobu, takže analytik vidí len časť katalógu a nevie odlíšiť „nepredáva sa" od „nie je na sklade". | Druhá polovica obrátkovosti; zároveň zmizne dnešné obmedzenie zistenia „nízka zásoba" na variantné produkty. |

| **B7** | **Zvýšiť denný limit zápisov nad 200/UTC deň** pre náš kľúč `product:edit` — ideálne na 2 000/deň, aj za cenu prísnejšieho minútového stropu. | Toto je po prestavbe na frontu (kontrakt V3) NAJDÔLEŽITEJŠIA požiadavka. Jedna zľava ide na 5–10 tisíc produktov, `setReduction` sa nedá dávkovať a limit je 200/deň — 8 000 produktov teda trvá **40 dní**. Kľúč pritom platí najviac 30 dní, takže fronta dnes nedobehne skôr, než vyprší kľúč, a musí sa uprostred obnovovať. | Fronta zbehne za dni namiesto týždňov, zmizne varovanie „kľúč vyprší skôr, než fronta dobehne" (K6) a odpadne obnovovanie kľúča uprostred behu. |
| **B8** | `GET /api/products` nech vracia **kategóriu, kov a typ šperku** (alebo aspoň stabilné ID kategórie). | Používateľ chce zlacňovať po kategóriách („všetky strieborné náušnice"). Dnes tie údaje API nevracia vôbec, takže filtre Kategória / Kov / Typ sú v appke viditeľne **zamknuté** (K8) — appka priznáva, že dáta nemá, namiesto aby ich predstierala. | Odomknú sa tri filtre v tabe Produkty a pásma zľavy sa budú dať stavať podľa kategórie, nie len podľa predajnosti. |

**Formulácia pre maintainera (kópia do e-mailu):** appka Aura Zľavy je lokálny
nástroj, ktorý používa výhradne `POST /api/products/setReduction` (scope
`product:edit`) a verejné čítacie endpointy. Po prestavbe na frontu pracuje
s katalógom v tisícoch produktov, zapisuje postupne v rámci denného limitu a
zľavu spúšťa k budúcemu dátumu, aby všetko nabehlo naraz. Požiadavky sú
v poradí dôležitosti **B7 → B1 → B5, B6, B8 → B2, B3, B4**.

Rozdelenie podľa toho, čo blokujú:

- **B1 blokuje správnosť.** Bez nej si appka musí o stave shopu viesť vlastnú
  evidenciu, ktorú nemá ako overiť — a keď niekto zmení zľavu v admine, appka
  o tom nikdy nezistí. Toto je jediná požiadavka, ktorá stojí za samostatný
  e-mail, aj keby na ostatné nebol čas.
- **B2–B4 blokujú eleganciu.** Appka bez nich funguje, len s obchádzkami:
  zľava sa nedá zrušiť (len nechať expirovať), desať produktov ide desiatimi
  requestami a platnosť kľúča sa overuje sondou na produkčnom write endpointe.
- **B7 blokuje použiteľnosť.** Toto je po prestavbe najpálčivejšie: pri 200
  zápisoch na deň trvá jedna zľava nad 8 000 produktmi 40 dní, čo je dlhšie,
  než platí zápisový kľúč. Appka si s tým poradí (fronta sa preruší a po
  vložení nového kľúča pokračuje, nič sa nestratí), ale je to obchádzka
  problému, nie jeho riešenie. **Legitímna cesta je vyššia kvóta na JEDNOM
  kľúči** — nie viac kľúčov naraz. Dokumentácia API rozdeľovanie záťaže medzi
  kľúče výslovne zakazuje ako obchádzanie limitu a hrozí zaň trvalý ban.
- **B8 blokuje spôsob práce.** Bez kategórií sa dá filtrovať len podľa
  predajnosti, ceny a skladu.
- **B5–B6 blokujú novú funkciu.** Bez nich sa obrátkovosť nedá vypočítať, takže
  karta „Obrátkovosť" v appke zostáva zamknutá. Tretí chýbajúci vstup —
  predajnosť — nie je na maintainerovi: vyžaduje scope `orders:read`, ktorý
  appka zámerne nemá (rozhodnutie R8, vynucované testom). Ak sa má obrátkovosť
  počítať, musí to Samuel najprv vedome povoliť.
