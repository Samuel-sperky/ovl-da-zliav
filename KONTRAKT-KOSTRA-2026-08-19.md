# Kontrakt — nová kostra appky (19. 8. 2026, večer)

Používateľ odmietol doterajší vzhľad: *„nie je to dobré, potrebujem to nanovo
prekopať na základe nejakej šablóny štruktúry, nech je to aplikácia, ktorá je
vizuálne plnohodnotná, táto má šum."*

Toto **prevracia rozhodnutie R4** z `KONTRAKT-UX-DIZAJN-2026-08-19.md`
(„horná navigácia zostáva"). Je to vedomý pokyn používateľa, nie nedopatrenie.

---

## Zmeraný zdroj šumu

Nie sparse obsah, ale chýbajúca štruktúra. Zo snímok z 12:43:

| # | Čo | Dôsledok |
|---|---|---|
| 1 | **Žiadna mriežka** — každá karta je 100 % šírky, naskladané pod sebou | nič sa nezarovnáva naprieč kartami, oko nemá kam ísť |
| 2 | **Päť verzálkových nadpisov na jednej obrazovke**, všetky 11 px | všetko rovnako dôležité, teda nič |
| 3 | **Tri vodorovné pásy chrómu** pred obsahom (`ProductionBar` → `AppHeader` → stavový pruh) ≈ 140 px | appka začína pod prehybom |
| 4 | **Vysvetľujúce vety vo veľkosti dát** | próza súperí s číslami |
| 5 | **Prehľad vedie vetou, nie číslami** — „Zápis stojí" je 48 px text | biznisová appka tam má mať údaje |

---

## Rozhodnutia (19. 8. 2026, večer)

| # | Otázka | Rozhodnutie |
|---|---|---|
| **K1** | Kostra | **Pracovný nástroj: ľavý panel + majster/detail.** Ľavý sidebar s navigáciou, obsah rozdelený na zoznam a detail. Vzor: Linear, Stripe, admin nástroje. Dashboard NIE JE hlavná obrazovka — je jedna z nich. |
| **K2** | Chýbajúce čísla | **Zamknuté veci na jedno miesto.** Obrazovky ukazujú len to, čo appka vie. Všetko zamknuté sa presťahuje do jednej sekcie v Nastaveniach („čo appka zatiaľ nevidí a prečo"). Informácia sa nestratí, obrazovky sa vyčistia. |

K2 mení `LockedFeatures.tsx` z „nerozširovať" na **jediné miesto, kam sa
zamknuté sťahuje** — dnes uniklo na štyri ďalšie miesta.

---

## Kostra — čo presne

```
┌──────────┬────────────────────────────────────────────┐
│ SIDEBAR  │ TOPBAR: stav appky v JEDNOM riadku         │
│ 240 px   ├────────────────────────────────────────────┤
│          │                                            │
│ logo     │  obsah — mriežka 12 stĺpcov                │
│          │                                            │
│ Prehľad  │  majster/detail tam, kde to dáva zmysel:   │
│ Produkty │  Produkty (tabuľka | panel kusu)           │
│ Zľavy    │  Zľavy (zoznam | detail)                   │
│ Nastav.  │                                            │
│          │                                            │
│ ──────   │                                            │
│ kľúč     │                                            │
│ rozpočet │                                            │
└──────────┴────────────────────────────────────────────┘
```

- **Chróm z troch pásov na jeden.** Produkčné varovanie sa presúva do topbaru
  ako trvalý červený štítok, nie ako celý pás. Kľúč a rozpočet idú do päty
  sidebaru — sú to trvalé fakty, nie správy.
- **Sidebar 240 px, neskladá sa na ikonky.** Štyri položky nepotrebujú
  zbaľovanie a ikonky bez slov by porušili pravidlo appky.
- **Mriežka 12 stĺpcov** s jedným rozostupovým rytmom. Karty sa zarovnávajú.
- **Pod 1100 px** sa sidebar mení na horný riadok — appka má fungovať na
  720 px (P4 zostáva).

## Čo sa NEMENÍ

Pravidlá P1–P8, invariant I3 (žiadny zápis bez potvrdenia), I5, I6, I8'.
Zmeraná paleta, `Icon.tsx`, jeden slovník stavov, písmo, hľadanie na viac slov.
Appka NESMIE zobraziť nič, čo API nedáva. Žiadne emoji. Žiadna nová závislosť.

---

## Postup

1. **Kostra — jeden autor (hlavný agent).** Sidebar, topbar, mriežka, rozostupy.
   Ukáže sa na snímke, než sa pustia agenti na obrazovky. Dva smery sa už raz
   zaplatili nadarmo; tretí sa neukáže až na konci.
2. **Obrazovky — agenti** až po schválení kostry.

---

## Výsledok

*(dopĺňa sa)*
