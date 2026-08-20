# Kontrakt V3 — od desiatich produktov k fronte

**Nadradenosť.** Tento dokument mení `docs/10-KONTRAKT.md` v bodoch, ktoré sú tu
výslovne vymenované (K1–K12). Všetko ostatné z 10-KONTRAKTU **platí ďalej
nezmenené** — najmä I1 (kľúč nikdy do repa ani do logov), I3 (žiadny zápis bez
potvrdenia), I7 (appka nikdy neruší zľavu), I8' (objednávky len cez
`orders-client.ts`), I10 (sekvenčný zápis), I13 (zápisy len v produkcii so
zapnutým `WRITES_ENABLED`).

Zdroj pravdy pre správanie: `docs/40-ODPOVEDE-V3.md`.
Zdroj pravdy pre vzhľad: `design/v3/ARCHITEKTURA.md` (pravidlá P1–P8).

Pri rozpore vyhráva invariant, nie mockup.

---

## Prečo tento kontrakt vôbec vzniká

Pôvodná appka bola postavená na vete „max 10 produktov, kým nejdeme naostro".
Reálne použitie je 5–10 tisíc produktov na jednu zľavu z katalógu 40 483.
`setReduction` je jeden request na produkt a nedá sa dávkovať; limit je
20/min a **200 zápisov na UTC deň**. Z toho plynie jediná vec, ktorá určuje
celý zvyšok návrhu:

> **Zápis nie je akcia. Zápis je fronta, ktorá beží týždne.**

8 000 produktov pri 200/deň = 40 dní. Preto sa zľava zadáva s **budúcim
dátumom štartu** — fronta stihne zapísať všetko skôr, než okno platnosti
nabehne, a všetkých 8 000 produktov zlacnie naraz.

---

## K1 — Invariant I2 sa mení, nezaniká

Pôvodné I2: „najviac 10 aktívnych produktov v allowliste, vynútené UNIQUE
`slot` 1–10 na úrovni DB." Tento strop bol poistka pre pilot, nie cieľový stav.
Zrušiť ho bez náhrady by znamenalo odstrániť jedinú tvrdú brzdu pred
produkčným eshopom. Preto sa nahrádza **režimom rozsahu**:

| Režim | Strop na jednu zľavu | Allowlist | Prepnutie |
|---|---|---|---|
| `pilot` (**predvolený**) | 10 | vynútený ako doteraz | — |
| `plny` | `max_products_per_campaign` (predvolene 10 000) | nevynucuje sa | vyžaduje **sudo** + zápis do auditu |

Pravidlá, ktoré musia platiť v oboch režimoch:

1. **Fail-closed.** Chýbajúca, nečitateľná alebo neznáma hodnota režimu =
   `pilot`. Nie výnimka, nie predvolený `plny`.
2. **Produkt musí existovať v katalógu.** V režime `plny` nahrádza allowlist
   podmienka „produkt je v `catalog_cache` a nie je `not_found`". Zapísať sa
   nedá do produktu, ktorý appka nikdy nevidela.
3. **Strop je aj v DB**, nielen v kóde — `CHECK` na `campaigns.items_total`.
   Aplikačná validácia sama o sebe nikdy nestačila a nestačí ani teraz.
4. **Prepnutie do `plny` je auditovaná udalosť** `scope_mode_changed` s
   pôvodnou a novou hodnotou. Prepnutie späť do `pilot` sudo nevyžaduje —
   sprísnenie je vždy voľné, uvoľnenie nikdy.

I2 teda znie po novom: **appka nikdy nezapíše do produktu, ktorý nie je v
povolenom rozsahu platného režimu, a rozsah sa nedá rozšíriť bez sudo.**

## K2 — Fronta a denný rozpočet

Nový stav kampane: **`queued`**. Životný cyklus zápisovej kampane je

```
draft → (potvrdenie I3) → queued → running → queued → … → done | partial
                                      ↑         │
                                      └─ rozpočet vyčerpaný, pokračuje zajtra
```

- **Denný rozpočet** je `daily_write_budget`, predvolene 200, konfigurovateľný
  nadol (nikdy nahor bez zmeny v nastaveniach + audit). Počíta sa výhradne z
  auditu: počet `write_attempt` za aktuálny **UTC deň**. Jediný zdroj pravdy,
  žiadny paralelný počítadlový stĺpec, ktorý by sa mohol rozísť.
- **Minútový strop** 20/min sa dodržiava pauzou **≥ 3 s** medzi položkami
  (nahrádza doterajších 250 ms z D46). I10 tým nie je dotknuté — stále je to
  striktne sekvenčné.
- Pri vyčerpaní rozpočtu kampaň prejde do `queued`, **nie** do `failed` a
  **nie** do `partial`. Vyčerpaný rozpočet je informácia, nie chyba
  (odpoveď 59) — aj v UI má neutrálnu farbu.
- **Runaway strop** (D79, I12) zostáva a je nadradený rozpočtu. Je to iná vec:
  rozpočet je plánovaná rýchlosť, runaway je poistka proti splašeniu.
  Jeho hodnota sa zvyšuje zo 60/h na `daily_write_budget` + 20 % rezerva,
  lebo pri 200/deň by pôvodných 60/h zamklo zápisy pri normálnej prevádzke.

## K3 — Pásma (rôzne % v jednej zľave)

Jedna zľava môže mať viac pásiem s rôznym percentom (odpoveď 55). Napr.
„0 predaných za 360 dní → 30 %", „0 predaných za 180 dní → 20 %".

- Nová tabuľka `campaign_tiers`: `campaign_id`, `ord`, `label`, `percent`,
  `rule` (JSON, len na zobrazenie a zopakovanie filtra — **nie** na
  vyhodnocovanie pri zápise).
- `campaign_items` dostáva stĺpec `percent` — **rozhodnutý pri potvrdení**,
  nie pri zápise. Executor pásma nikdy nevyhodnocuje; berie hotové číslo z
  položky. Zabraňuje to tomu, aby sa produkt medzi potvrdením a zápisom
  presunul do iného pásma a používateľ potvrdil niečo iné, než sa zapíše.
- `campaigns.percent` zostáva a znamená **najvyššie percento zľavy** —
  je to hlavička pre zoznamy. `CHECK (percent BETWEEN 1 AND 30)` platí
  na `campaigns.percent` aj na `campaign_tiers.percent` aj na
  `campaign_items.percent`. I9 sa tým nezoslabuje, ale utrojnásobuje.

## K4 — I3 pri desaťtisícoch položiek

Potvrdzovací token zostáva jednorazový HS256 JWT s TTL 15 minút. Mení sa len
to, čo sa hashuje:

```
payload_hash = SHA256( pre každý produkt vzostupne podľa product_id:
                       "<product_id>:<percent>:<price_at_preview>\n" )
```

Hash sa počíta priebežne (streamovo), nie cez materializovaný reťazec —
10 000 položiek sa nesmie zliať do jedného obrieho stringu v pamäti.
Executor prepočíta hash zo **skutočných položiek v DB** a musí sa zhodovať.
Nezhoda = žiadny zápis. To je I3 a nemení sa.

## K5 — Budúci štart a čo keď fronta nestihne

Používateľ zadá okno platnosti (`date_from` … `date_to`), appka navrhne
`date_from` tak, aby fronta stihla dobehnúť + 2 dni rezerva.

Ak fronta napriek tomu do `date_from` nedobehne:

- zvyšné produkty sa **aj tak zapíšu** s **pôvodným, nezmeneným oknom**
  (appka okno nikdy sama neposúva a zľavu nikdy neskracuje — I7),
- kampaň dostane príznak `late` a v UI je viditeľné, koľko produktov nabehlo
  neskoro. Nie je to chyba zápisu, je to fakt o čase.

Appka **nikdy** kvôli meškaniu nezmení `date_to`. Skrátenie okna je tvar
rušenia zľavy, a to I7 zakazuje.

## K6 — Kľúč na zápis vs. dĺžka fronty

Kľúč `shop_write` má TTL 48 h (nastavením až 30 dní), fronta beží aj 40 dní.
Je to reálna diera a rieši sa priznaním, nie tichom:

- Pri zaradení do fronty appka porovná expiráciu kľúča s odhadom dobehnutia a
  ak je kľúč kratší, **zobrazí varovanie a ponúkne obnovu kľúča**. Zaradiť
  frontu to nebráni.
- Keď kľúč vyprší uprostred fronty, platí doterajšie správanie (D51/D52):
  kampaň ide do `needs_key`, zvyšok položiek zostáva `pending`, žiadny zápis
  sa nestratí. Po vložení nového kľúča fronta pokračuje tam, kde skončila.
- Deň pred expiráciou kľúča pri bežiacej fronte sa vytvorí pripomienka.

## K7 — Katalóg

`catalog_cache` prestáva byť cache desiatich produktov a stáva sa zrkadlom
katalógu (40 483 riadkov):

- plná synchronizácia stránkovane cez zoznamový endpoint, manuálne aj raz
  denne cronom, mimo špičky,
- synchronizácia **nekonzumuje zápisový rozpočet** — je to čítanie,
- `fetched_at` na riadok; UI ukazuje `Dáta k …` (P7: je to meraný fakt,
  nie odhad, takže bez `≈`).

## K8 — Čo appka nemá a musí to priznať

Shop API dnes nevracia kategóriu, kov, typ šperku, nákupnú cenu ani sklad
nevariantných produktov. Z toho plynie:

- Filtre **Kategória, Kov, Typ šperku, Marža, Obrátkovosť** sú v UI
  **viditeľné a zamknuté**, so štítkom „čaká na dáta zo shopu". Nesmú byť
  skryté ani predstierané.
- Nikde sa nesmie objaviť dopad na maržu ako číslo. Ani odhadom.
- Zoznam toho, čo treba od správcu API, žije v `docs/20-BACKLOG-SHOP-API.md`.

## K9 — Navigácia: štyri taby, nič viac

`Prehľad · Produkty · Zľavy · Nastavenia`. Doterajšie samostatné taby sa
skladajú dovnútra:

| Bolo | Je |
|---|---|
| `/analytika` | Prehľad (tržby) + Zľavy (výkon zľavy) |
| `/ai-agent` | Prehľad → riadky „Návrhy" |
| `/audit` | Nastavenia → „História a technický detail" |
| `/kampane` | `/zlavy` |

Staré cesty ostávajú ako presmerovania — odkazy v poznámkach a v histórii
prehliadača sa nesmú zlomiť.

## K10 — Slovník na povrchu

Zakázané v UI (P3): `needs_key`, dry-run, allowlist, `setReduction`, HTTP
kódy, názvy tabuliek, kódy invariantov, ID produktov v hlavných stĺpcoch.
Povolené v rozkliku „Technický detail".

| Vnútri | Na povrchu |
|---|---|
| campaign | zľava |
| allowlist | povolené produkty |
| dry-run | skúška naprázdno |
| needs_key | chýba kľúč na zápis |
| eager/scheduled | zapisuje sa hneď / zapisuje sa dopredu |
| item failed | nepodarilo sa |

## K11 — Čo sa NESMIE stať pri tejto prestavbe

1. Žiadna už aplikovaná migrácia sa needituje. Len nové, numerované.
2. `setReduction` volá aj naďalej **výhradne** `src/lib/engine/executor.ts`.
3. Žiadny `Promise.all` nad zápismi. Nikdy.
4. Žiaden test sa nesmie „opraviť" oslabením tvrdenia. Keď test padne preto,
   že sa zmenil kontrakt, prepíše sa tvrdenie na nový kontrakt — a v commite
   je vidieť prečo.
5. Zápisy zostávajú vypnuté (`WRITES_ENABLED=false`), kým Samuel nepovie inak.

## K12 — Definícia hotového

Prestavba je hotová, keď súčasne platí:

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` prejdú,
- `npm run check-compose-bind` prejde (I5),
- grep testy invariantov (I1, I8', `setReduction`) prejdú,
- e2e prejde cesta: prihlásenie → Prehľad → filter produktov → nová zľava
  s dvoma pásmami → potvrdenie → zaradenie do fronty → fronta beží,
- v UI sa nevyskytne žiadny výraz zo zoznamu K10,
- pravidlá P1–P8 platia na všetkých štyroch taboch.
