# Žiadosť správcovi shopu — oprávnenie `product:read`

**Komu:** delaja@fedorco.sk (správca API shopu `sperky-eshop.sk`)
**Odosiela:** Samuel (marketing@sperky-eshop.sk) — text je pripravený na skopírovanie
**Dátum prípravy:** 25. 8. 2026
**Samostatne od:** `docs/60-ZIADOST-ODBLOKOVANIE-IP-2026-08-24.md` (ban na IP)

> **Toto je iná žiadosť než odblokovanie adresy.** Ban treba zrušiť, aby appka
> vôbec dosiahla na API; `product:read` treba doplniť, aby videla polia, ktoré
> API už vracia. Prvé bez druhého nechá päť filtrov zamknutých, druhé bez
> prvého nechá appku bez pripojenia. Dôvod, prečo sú to dva dokumenty, je
> jednoduchý: ban je nedorozumenie a `product:read` je požiadavka.

---

## Prečo to vôbec žiadame

Zistilo sa to 25. 8. pri audite a je to pre nás nepríjemné: **appka roky
obviňovala eshop z toho, že tie dáta nevracia — a on ich vracia od 13. 8. 2026.**

Na obrazovke *Nastavenia → Čo appka nevie* stálo, že „eshop nevracia kategóriu,
kov, typ šperku, nákupné ceny ani sklad nevariantných produktov", a bolo tam
tlačidlo, ktorým sa dala tá veta skopírovať a poslať vám. Podľa
`KONTRAKT-API-V5-2026-08-13.md` ste pritom presne tie polia dodali v `getFull`.
Skutočná prekážka je na našej strane: **náš kľúč nemá oprávnenie `product:read`.**

Ak vám niekto z nás niekedy poslal tú starú vetu, bola nepravdivá a bolo to
naším nedopatrením. Text v appke sa opravuje.

---

## Návrh e-mailu

**Predmet:** Doplnenie oprávnenia `product:read` k nášmu API kľúču

Dobrý deň,

potreboval by som k nášmu API kľúču doplniť oprávnenie **`product:read`**.

**Na čo nám je.** Zľavy dnes vyberáme takmer naslepo — vidíme len názov, cenu a
zásobu variantných produktov. S `product:read` by `GET /api/products/get`
(resp. `getFull`) vrátil kategóriu, kov, typ šperku, nákupnú cenu a zásobu aj
nevariantných produktov. To sú presne tie údaje, bez ktorých sa nedá povedať
„zlacni strieborné náušnice, ktoré ležia" — a dnes to musíme skladať ručne.

**Čo s tým appka spraví.** Odomkne päť filtrov, ktoré má dnes viditeľne
zamknuté s vysvetlením, že tie dáta nemáme: Kategória, Kov, Typ šperku, Marža
a Obrátkovosť. Nič viac. Marža a obrátkovosť sa počítajú u nás, z nákupnej ceny
a zásoby; nepotrebujeme na to žiadny nový endpoint.

**Koľko čítaní to znamená.** Nezvýši to náš objem — je to to isté volanie
`products/get`, ktoré už robíme, len s viac poliami v odpovedi. Katalóg
(41 220 produktov) čítame dávkovo po 25 kusov s pauzou medzi dávkami a v rámci
denného stropu; detaily doťahujeme len pre produkty, na ktoré sa používateľ
naozaj pozrie. Ak vám aj tak vyhovuje nejaký strop, povedzte číslo a zapíšeme
ho do nastavení ako tvrdý limit.

**Čo si z toho ukladáme.** Kategóriu, kov, typ, nákupnú cenu a zásobu k produktu
— nič, čo by sa týkalo zákazníkov. Nákupná cena sa nikde nezobrazuje ako číslo
pre zákazníka; slúži výhradne na to, aby appka vedela povedať, či sa zľava na
tom produkte ešte oplatí.

**Poznámka na okraj.** Naša IP je od 19. 8. blokovaná (`403 ip_banned`), takže
kým to platí, oprávnenie neotestujeme. Píšem to skôr, aby ste vedeli, že sa
ozveme dvakrát, než ako urgenciu — odblokovanie riešim samostatne.

Ďakujem,
Samuel

---

## Čo pri odpovedi urobiť v appke

| Odpoveď správcu | Čo urobiť |
| --- | --- |
| `product:read` doplnené | Vložiť kľúč znova (Nastavenia → Na čo je napojená). `whoami` scope prizná a `scopeReport()` prepne `productRead` z „nevieme" na „má". |
| Chce strop na čítania | Zapísať do `.env` ako `MAX_...` a doplniť do `docs/10-KONTRAKT.md` ako rozhodnutie. |
| Odmietne | Zámok filtrov zostáva — ale dôvod v `LockedFeatures.tsx` musí povedať, že o oprávnenie sme požiadali a nedostali ho. To je iná veta než dnešná. |
| Neodpovie | Appka sa chová rovnako ako dnes. Zámok je fail-closed a priznaný, takže sa nič nerozbije. |

---

## Súvisiace

- `docs/60-ZIADOST-ODBLOKOVANIE-IP-2026-08-24.md` — ban na IP, druhá žiadosť
- `docs/20-BACKLOG-SHOP-API.md` — **pozor, je zastaralý**: žiada B1, B2, B4, B5,
  B6 a B8, ktoré správca dodal 13. 8. 2026. Prepisuje sa.
- `KONTRAKT-API-V5-2026-08-13.md` — čo prišlo 13. 8. Sekcia „Výsledok" je
  prázdna, takže ho treba čítať ako návrh, nie ako opis kódu.
- `KONTRAKT-AUDIT-30-2026-08-25.md` nález **P3** — oprava textu v appke
