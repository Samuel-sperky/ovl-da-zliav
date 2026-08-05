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

**Formulácia pre maintainera (kópia do e-mailu):** appka Aura Zľavy je lokálny
nástroj, ktorý používa výhradne `POST /api/products/setReduction` (scope
`product:edit`) a verejné čítacie endpointy, na maximálne 10 vopred povolených
produktoch. Štyri požiadavky vyššie sú v poradí dôležitosti B1 → B4; B1 je
jediná, ktorá dnes chýba natoľko, že si appka musí o stave shopu robiť vlastnú
(nepotvrditeľnú) evidenciu.
