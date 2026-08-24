# Žiadosť správcovi shopu — odblokovanie IP a oprávnenie `order:read`

**Komu:** delaja@fedorco.sk (správca API shopu `sperky-eshop.sk`)
**Odosiela:** Samuel (marketing@sperky-eshop.sk) — text je pripravený na skopírovanie
**Dátum prípravy:** 24. 8. 2026
**Zmerané:** 24. 8. 2026 15:20 UTC, `GET /api/whoami` → `403 {"error":"ip_banned"}`

> Tento súbor je návrh. Čísla v ňom sú vytiahnuté z `sales_sync_state`
> v lokálnej DB appky, nie odhadnuté. Ak text upravíš, uprav aj čísla —
> nepravdivý údaj v žiadosti je horší než žiadna žiadosť.

---

## Návrh e-mailu

**Predmet:** Odblokovanie našej IP + oprávnenie `order:read` pre kľúč (Aura Zľavy)

Dobrý deň,

používame lokálny nástroj, ktorý nám riadi časovo obmedzené zľavy v našom
e-shope cez vaše API. Beží výhradne na jednom počítači u nás, nie je verejne
dostupný a mimo `sperky-eshop.sk` nikam nesiaha.

**Prosím o dve veci:**

1. **Odblokovať našu IP adresu.** Od 19. 8. odpovedá API na každé naše volanie
   `403 {"error":"ip_banned"}` — vrátane volaní bez kľúča na verejné čítacie
   endpointy. Odpoveď nemá `Retry-After` ani `unlock_in_minutes`, takže to
   nevyzerá ako dočasný rate-limit ban, ale ako trvalé zablokovanie adresy.
2. **Doplniť nášmu kľúču oprávnenie na čítanie objednávok** (`orders:read`,
   resp. `order:read` podľa toho, ako to máte pomenované na svojej strane).
   Od 7. 8. nám `/api/order` odpovedá `403 forbidden`, čiže kľúč toto právo
   nemá.

**Načo nám objednávky sú.** Potrebujeme vedieť, ktoré produkty sa predávajú,
aby sme zľavy dávali na to, čo stojí na sklade. Z objednávok si ukladáme
**výhradne súčty po produkte a dni** — počet kusov. Žiadny riadok objednávky,
žiadne meno, adresu, e-mail, krajinu ani zaplatenú sumu. Nástroj to má priamo
zakázané kontrolou schémy databázy, nie len dobrým zvykom.

**Koľko toho reálne voláme.** Za celú dobu behu nástroja to je **585
požiadaviek na `/api/order`**, a to je celé:

| Deň predajov | Požiadaviek | Výsledok |
| --- | --- | --- |
| 5. 8. | 301 | prečítané (298 objednávok) |
| 6. 8. | 270 | prečítané (267 objednávok) |
| 7. 8. – 18. 8. | 1 za deň, 12× | `403 forbidden` |
| 19. 8. a 22. 8. | 1 za deň, 2× | `403 ip_banned` |

Odkedy nám API odpovedá 403, nástroj **neopakuje** — skúsi raz za deň jednou
požiadavkou, či sa stav zmenil, a inak nechá API na pokoji. Ak vám ban
naskočil práve z tých 301 a 270 požiadaviek 5. a 6. 8., je to náš omyl
v nastavení a vieme si ho zúžiť: povedzte nám číslo, ktoré vám vyhovuje, a my
ho do nástroja zapíšeme ako strop.

Prečo je tých požiadaviek na jeden deň predajov toľko: zoznam objednávok
nevracia ich položky, takže produktová predajnosť stojí **jednu požiadavku na
jednu objednávku**. Ak by ste vedeli vystaviť súčty predaja po produkte a dni
jedným volaním (alebo doplniť položky do zoznamu objednávok), spadne nám to
z troch stoviek na jednotky požiadaviek denne. To je pre nás lepšie riešenie
než vyššia kvóta a radi sa o ňom pobavíme.

**Čo o nástroji ešte treba vedieť.** Zľavy zapisujeme cez
`POST /api/products/setReduction` s oprávnením `product:edit`, sekvenčne,
s pauzou 250 ms a v rámci denného rozpočtu 200 zápisov. Nikdy nerozdeľujeme
záťaž medzi viac kľúčov — vieme, že to dokumentácia zakazuje.

Ďakujem,
Samuel

---

## Čo pri odpovedi urobiť v appke

| Odpoveď správcu | Čo urobiť |
| --- | --- |
| IP odblokovaná | Vložiť nový kľúč v **Nastavenia → Na čo je napojená → Kľúče**. Appka ho pri ukladaní overí sama; keď prejde, `verify_status` sa preklopí na `valid`. |
| Doplnené `orders:read` | Čítanie predajov sa rozbehne samo pri najbližšom tiku plánovača. Prvý beh dobehne do stropu `ORDERS_MAX_REQUESTS_PER_RUN` a pokračuje ďalší deň. |
| Chce nižší strop požiadaviek | Zmeniť `ORDERS_MAX_REQUESTS_PER_RUN` a `ORDERS_PAUSE_MS` v `.env`, restart kontejnera. |
| Nabídne súčty predaja jedným volaním | Nová položka do `docs/20-BACKLOG-SHOP-API.md` a samostatný šprint — je to náhrada dnešnej cesty, nie jej doplnok. |
| Ban zostáva | Appka to musí vedieť pomenovať, nie hádať — to je predmet `KONTRAKT-KLUC-A-BAN-2026-08-24.md`, bod A. |
