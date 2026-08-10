# Aura Zľavy V3 — odpovede na 100 otázok (priebežné)

**Dátum:** 2026-08-10 · **Stav:** zbieranie odpovedí (1–52 hotové)

Tento dokument je jediný zdroj pravdy pre redizajn V3. Nahrádza predchádzajúce
návrhy tam, kde si protirečia — V3 ruší predpoklad „max 10 produktov“, na ktorom
stála celá pôvodná architektúra.

## Zásadný obrat (otázky 7, 9, 10)

Appka NIE JE nástroj na 10 produktov. Spravuje **celý katalóg 40 483 produktov**
a zľavu nastavuje na **5–10 tisíc naraz**.

**Dôsledok, ktorý určuje všetko ostatné:** `setReduction` je 1 request na produkt,
nedá sa dávkovať, limit je 20/min + **200/UTC deň**. 10 000 produktov = 50 dní.
Preto zápis rieši **fronta + cron**: zapisuje sa postupne v rámci denného
rozpočtu, používateľ vidí priebeh živo. Vyšší limit od maintainera je
**blokujúca požiadavka**.

## Terminológia (1–4)

| Namiesto | Používa sa |
|---|---|
| kampaň | **zľava** |
| allowlist | **povolené produkty** |
| dry-run | **skúška naprázdno** |
| „podľa vlastného zápisu“ | **„Naposledy sme zapisovali 15 % dňa 5.8.“** |

## Práca používateľa (5–8, 25)

- Otvára appku a chce **všetko naraz v jednom prehľade**
- Nastavuje zľavy **niekoľkokrát do týždňa**
- Zlacňuje **to, čo sa nepredáva** (obrátkovosť)
- Prvý klik: **Prehľad → „Nová zľava“**

## Fronta a rozpočet (13–15, 23, 24, 45, 46)

- Zapisuje sa **pôvodný dátum OD** (všetky produkty majú rovnaké okno)
- Priebeh: **pruh + číslo + odhad dokončenia**
- Súbežné zľavy: **rozpočet sa delí medzi ne**
- Zlyhania: **automaticky opakovať, na konci report**
- Zastavenie: **zastaviť frontu, zapísané dobehnú** (zrušiť sa nedá)
- Po odstávke PC: **fronta sa zastaví a čaká na potvrdenie**
- Rozpočet: **zápisy majú prednosť** pred syncom

## Výber produktov (11, 16–20, 34–36, 49–52)

- Poistka: **strop na jednu zľavu + potvrdenie** (nie strop 10)
- Filtre: obrátkovosť/ležiaky · kategória/kov/typ · cena a marža · sklad a história zliav
- Chýbajúce dáta (kategória, kov, COGS, sklad nevariantných): **vyžiadať od maintainera**
- Obrátkovosť **čaká na COGS** — bez neho sa funkcia neodomkne
- Ležiak = **obrátkovosť pod prahom** (nie len 0 predajov)
- Obdobia: **prepínač 30/60/90/180/360**, predvolené 30
- Appka **navrhuje percento podľa pravidiel**, pravidlá sú **v Nastaveniach**
- **Pásma** — jedna zľava môže mať rôzne % pre rôzne skupiny
- Produkty už v zľave: **vylúčiť len ak majú rovnaké alebo vyššie %**
- Katalóg: **vlastná kópia obnovovaná syncom** (raz denne)
- Tabuľka: **stránkovanie po 50–100**, stĺpce: kategória/kov · predané ks + sklad · cena + marža · aktuálna zľava
- Veľký výber: **lišta dole s počtom a akciami**

## Potvrdenie a skúška (22, 37–40)

- Kontrola pred zápisom: **súhrn po pásmach + vzorka**
- Potvrdenie: **napísať počet ručne**
- Najväčším písmom: **počet produktov**
- Odhad dopadu na maržu: **áno, jasne označený ako odhad**
- Skúška naprázdno: **lokálne všetko + vzorka na shope**

## Štruktúra a vizuál (26–33, 41–44)

- **4 taby:** Prehľad · Produkty · Zľavy · Nastavenia
- AI agent **rozpustený** — návrhy tam, kde patria
- Tržby a výkon: **v Prehľade aj v detaile zľavy**
- Audit: **v detaile zľavy + celý v Nastaveniach**
- Nastavenia: **jedna stránka s kotvami**
- Hustota: **husté** — viac čísel na obrazovku
- Farby: **teal + zlatá (rodina Aura)**
- Téma: **svetlá predvolená**
- Prvé číslo v Prehľade: **priebeh bežiacej fronty**
- Pokojný stav: **„Všetko beží“ + tržby a návrhy**
- Upozornenia mimo appky: **žiadne**
- Tón textov: **vecný a krátky**
