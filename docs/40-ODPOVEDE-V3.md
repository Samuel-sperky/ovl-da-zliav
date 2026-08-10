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

---

# Odpovede 53–100

## Zľavy — zoznam a detail (53–56)

- Zoznam: **bežiace a rozpísané hore, hotové dole**
- Stavy pre používateľa: **štyri** — pripravená · zapisuje sa · beží · skončila.
  Zlyhania sú **príznak navyše** („beží · 12 zlyhaných"), nie samostatný stav.
- Detail hore: **priebeh + čo sa nepodarilo**
- Položky: **len súhrn + zlyhané a podozrivé** (nie 8 000 riadkov)

## Kľúče a rozpočet (57–60b, 68–69)

- TTL kľúča: **30 dní** (48 h nesadá na frontu bežiacu týždne)
- **Tri kľúče oddelene:** zápis · objednávky · štatistiky
- Rozpočet: **zápisy majú prednosť**; v hlavičke stále, detail v Nastaveniach
- Vyčerpaný rozpočet: **„Pokračujem zajtra o 02:00"** — informácia, nie chyba
- Ostrý režim (`WRITES_ENABLED`): **zostáva v súbore**, nie prepínač v UI
- Rozpočet na zápisy: **vyžiadať vyšší limit + medzitým viac kľúčov**
  ⚠️ **VÝSLOVNE ako požiadavku maintainerovi, nie svojvoľne.** Dokumentácia
  zakazuje „attempts to bypass rate limits" pod hrozbou trvalého banu; viac
  kľúčov je legitímne LEN s jeho súhlasom.

## Fronta — poradie a štart (60b–63)

- Appka **navrhne rozdelenie podľa priority**, poradie: **najhoršie ležiaky prvé**
- **Zapisuje sa dopredu s budúcim dátumom ŠTARTU** — appka spočíta najskorší
  možný („pri 200/deň to stihnem do 9.9., navrhujem štart 10.9."). Tým všetky
  zľavy nabehnú naraz a poradie zápisu je zákazníkovi neviditeľné.
- Pri sklze: **automaticky posunúť štart** + audit záznam

## Dáta a čakanie na API (64–66, 70, 74, 81)

- Kategórie, kov, COGS, sklad nevariantných: **čakať na API**, nič nehádať
- Medzitým: **predané kusy fungujú** (máme z objednávok), zvyšok **viditeľne
  zamknutý s dôvodom**
- Požiadavka maintainerovi: **zoznam do dokumentácie** (e-mail si napíše sám)
- Čerstvosť dát: **diskrétne pri číslach** („Dáta k 10.8. 03:00")
- Cudzia zmena v admine: **appka to nevie zistiť a prizná to**

## Produkty (71–72, 91–93)

- Hľadanie: **názov, ID a SKU**
- Detail produktu: **áno — história zliav a predajov**
- Uložené výbery: **uložiť FILTER, nie zoznam ID** (prepočíta sa pri použití)
- Opakovanie zľavy: **áno, s novými dátumami** (produkty podľa filtra nanovo)
- Plánovanie: **áno — pripravím a appka to spustí**

## Prístup a prevádzka (73, 76–80, 82–84)

- Onboarding: **len prázdne stavy s odkazmi**, žiadny sprievodca
- **Zápis aj z mobilu** → prístup cez **lokálnu sieť**, poistka = **zoznam
  povolených zariadení** (nahrádza dnešné „len 127.0.0.1")
- Mobil: **iné rozloženie, rovnaké dáta**; z telefónu **všetko** vrátane tvorby
- Prihlásenie: **meno a heslo** ako dnes
- Zálohy: **denne + kópia do OneDrive**
- Diagnostika: **tlačidlo „Stiahnuť diagnostiku"** (bez tajomstiev)
- Chyby: **ľudsky + technický detail na rozklik**

## Čísla a analýza (85–89)

- Graf tržieb: **čiara s trendom**
- Porovnanie výkonu: **všetky tri uhly vedľa seba** (pred zľavou · vlani ·
  zlacnené vs nezlacnené)
- Tvrdenia: **len čísla, žiadne závery** — appka nehodnotí kauzalitu
- Predvolený rozsah: **dnes + porovnanie s včerajškom**
- Odhady: **znak ≈ a iný odtieň**

## Rozsah prerábky (94–100)

- **Prerobiť existujúcu appku** (zachovať audit, bezpečnosť, klienta, testy)
- Prvá vlna: **celé UI naraz**
- Dodávka: **PNG v ZIPe**, potom implementácia
- Kritérium úspechu: **prehľadnosť a jednoduchosť**
- Ustupuje ako prvé: **technické detaily** (kódy, ID, raw odpovede) pod rozklik
- Orchester: **do 12 agentov**

## Čo v návrhu NESMIE byť (100)

1. Priveľa textu a vysvetľovania
2. Technický žargón v UI (`needs_key`, dry-run, allowlist, I3, D28)
3. Slabá hierarchia — všetko rovnako dôležité
4. Priveľa sekcií a skrolovania
