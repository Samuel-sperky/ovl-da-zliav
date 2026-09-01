# Žiadosť správcovi shopu — zvýšenie limitov API

**Komu:** delaja@fedorco.sk (správca API shopu `sperky-eshop.sk`)
**Odosiela:** Samuel (marketing@sperky-eshop.sk) — text je pripravený na skopírovanie
**Dátum prípravy:** 1. 9. 2026
**Nadväzuje na:** `docs/63-API-LIMITY-2026-09-01.md` (výpočty a meranie)

> Čísla v tomto texte sú vytiahnuté z merania, nie odhadnuté: kvóta kľúča
> z `GET /api/whoami` (`remaining {per_minute: 19, per_day: 199}`), počet
> produktov z `GET /api/products` (`total: 41 406`). Ak text upravíš, uprav aj
> čísla — nepravdivý údaj v žiadosti je horší než žiadna žiadosť.
>
> `docs/60` (odblokovanie IP) už pravdepodobne netreba posielať: anonymné
> čítania 1. 9. 2026 fungujú. `docs/61` (`product:read`) je bezpredmetná —
> kľúč to oprávnenie má.

---

## Návrh e-mailu

**Predmet:** Zvýšenie limitov API pre náš kľúč (nástroj na zľavy)

Dobrý deň,

používame lokálny nástroj, ktorý nám riadi časovo obmedzené percentuálne zľavy
v našom e-shope cez vaše API. Beží na jednom počítači u nás, nie je verejne
dostupný a mimo `sperky-eshop.sk` nikam nesiaha. Oprávnenia kľúča sú v poriadku
a za odblokovanie našej adresy ďakujeme — čítanie katalógu nám už funguje.

Narazili sme však na limity, ktoré nástroj v praxi znemožňujú použiť na to, na čo
je určený. Prosím o ich zvýšenie.

### Čo potrebujeme

| Vetva | Teraz | Potrebujeme |
|---|---|---|
| Volania s kľúčom (na kľúč) | 20/min · 200/deň | **300/min · 15 000/deň** |
| Anonymné čítanie (na IP) | 30/min · 300/deň | **60/min · 1 000/deň** |

### Prečo práve toľko

**Zápis zliav.** Jedna zľavová akcia u nás zahŕňa až 10 000 produktov a na každý
produkt je potrebné jedno volanie `setReduction`. Pri 200 volaniach za deň
trvá jedna taká akcia **50 dní**, čo z nástroja robí niečo nepoužiteľné —
sezónna zľava musí nabehnúť v jeden deň, nie za dva mesiace.

Minútový strop je pritom rovnako dôležitý ako denný: pri 20/min trvá 10 000
zápisov 8,3 hodiny aj vtedy, keď denná kvóta stačí. Pri 300/min je to ~35 minút.

**Čítanie údajov o produktoch.** Aby nástroj vedel, ktoré produkty sú ležiaky
(a teda ktoré zlacniť), potrebuje z `GET /api/products/getFull` referenciu,
nákupnú cenu, maržu, stav skladu a dátum posledného predaja. Toto volanie
vracia **jeden produkt na jedno volanie**, takže pri 41 406 produktoch
a 160 použiteľných volaniach denne by prvé naplnenie trvalo **276 dní**.

Rozdelenie požadovanej kvóty s kľúčom:

| Položka | Volaní/deň |
|---|---|
| Zápis zľavy na 10 000 produktov v jeden deň | 10 000 |
| Obnova údajov o katalógu (41 406 za mesiac) | 1 400 |
| Objednávky, kontrolné čítania, overenie kľúča | ~600 |
| Rezerva pod stropom (nechceme sa oň obtierať) | zvyšok |

Anonymná kvóta pokrýva zrkadlenie katalógu: 415 strán po 100 produktov. Pri
300/deň to trvá dva dni, pri 1 000/deň sa zrkadlo obnoví denne.

### Lacnejšia alternatíva, ak je 15 000/deň priveľa

Väčšinu tej kvóty spotrebuje `getFull`, a to len preto, že vracia jeden produkt
na volanie. Stačilo by **jedno** z týchto dvoch a naša požiadavka klesne
z 15 000 na **~10 500 volaní denne**:

1. **`getFull` prijme viac `id` naraz** (napríklad 100, ako to už robí zoznam
   `GET /api/products`). Celý katalóg by potom stál 414 volaní namiesto 41 406.
2. **Alebo pridať `reference`, `purchase_price`, `margin`, `qty`
   a `last_time_in_order` do verejného `GET /api/products`.** Ten zoznam už
   čítame na zrkadlenie katalógu, takže by nás to nestálo ani jedno volanie
   s kľúčom navyše.

Skúšali sme `/api/batch`, ale podľa vašej dokumentácie 25 položiek spotrebuje
25 volaní, takže kvótu nešetrí — a `getFull` navyše medzi batchovateľnými
akciami nie je.

Ak je jedna z tých dvoch možností pre vás jednoduchšia než zvyšovanie limitov,
vyhovuje nám to lepšie.

### Čo robíme pre to, aby sme limity nezaťažovali zbytočne

- Držíme sa na 80 % stropu, aby sme sa oň neobtierali.
- Čítania aj zápisy máme oddelené počítadlá a denné rozpočty; pri vyčerpaní sa
  nástroj sám zastaví a pokračuje ďalší deň.
- Rešpektujeme `Retry-After` po 429 a pri zamietnutí sa nepokúšame znova.
- Údaje o produktoch obnovujeme prioritizovane, nie plošne — najprv produkty,
  s ktorými naozaj pracujeme.

Ďakujem za posúdenie a rád doplním, čo bude treba.

S pozdravom
Samuel

---

## Po vybavení

1. Overiť nové limity: `GET /api/whoami` → `remaining` (nie z dokumentácie,
   z odpovede).
2. Upraviť `SHOP_KEYED_LIMIT` a `SHOP_ANON_LIMIT` v
   `src/lib/shop/rate-limits.ts` — a s nimi prehodnotiť `MIN_WRITE_PAUSE_MS`
   (3 000 ms zodpovedá dnešným 20/min; pri 300/min môže klesnúť na ~200 ms,
   ale K2 aj I10 ostávajú v platnosti a zmenu treba doložiť testom).
3. Vložiť **`shop_write` kľúč** (dnes chýba úplne) a dať overiť `orders_read` —
   bez nich nezbehne ani zápis, ani obohacovanie, nech sú limity akékoľvek.
