# Aura Zľavy — REDIZAJN V2 · špecifikácia mockupov

**Autor:** D0 · **Dátum:** 10. 8. 2026 · **Stav:** ZÁVÄZNÉ pre D1–D6

Toto je NÁVRH, nie implementácia. Výstup = statické HTML v `design/mockups/`,
ktoré sa renderujú do PNG. **Nikto nesiaha na `src/**`, `docs/**` ani na testy.**

---

## 0. Ako pracovať

- Jedna stránka = jeden self-contained súbor `design/mockups/<nazov>.html`.
- Žiadny build, žiadne externé závislosti, žiadne fonty z CDN.
- Spoločné štýly **výhradne** cez `<link rel="stylesheet" href="_system.css">`.
  **Nekopíruj CSS do stránky.** Ak ti trieda chýba, napíš to do finálnej odpovede —
  D0 systém dopĺňa, ty nie. Výnimka: pár riadkov `<style>` pre unikátnu geometriu
  jednej stránky (napr. mriežka konkrétneho grafu) je OK, ale nie pre farby.
- Inline SVG grafy sú povolené (statické, bez JS). Farby v SVG ber ako pevné hex
  hodnoty dark palety — mockup sa renderuje v dark režime.
- JavaScript: **žiadny** okrem prípadného 5-riadkového prepínača témy. Mockup má
  vyzerať ako screenshot bežiacej appky, nie ako prototyp.

### Kostra každej stránky appky

```html
<!DOCTYPE html>
<html lang="sk" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard · Aura Zľavy</title>
<link rel="stylesheet" href="_system.css">
</head>
<body>

<!-- POVINNÉ 1: červený pruh PRODUKCIA -->
<div class="topbar-production"><div class="wrap">
  <span><span class="dot"></span>Produkcia — sperky-eshop.sk</span>
  <span class="note">Zápisy sú nevratné. Zľavu nie je možné zrušiť, len nechať expirovať.</span>
</div></div>

<!-- POVINNÉ 2: teal lišta s korunou a 6 tabmi -->
<div class="navbar"><div class="wrap">
  <span class="brand"><span class="crown">♛</span>Aura Zľavy</span>
  <nav class="navtabs">
    <a href="dashboard.html" class="on">Dashboard</a>
    <a href="kampane.html">Kampane<span class="n">4</span></a>
    <a href="produkty.html">Produkty<span class="n">10</span></a>
    <a href="analytika.html">Analytika</a>
    <a href="nastavenia.html">Nastavenia</a>
    <a href="ai-agent.html">AI agent<span class="n">3</span></a>
  </nav>
  <!-- POVINNÉ 3: badge TTL kľúča + rozpočet API -->
  <div class="navmeta">
    <span class="hbadge"><span class="g">⚿</span>Kľúč <b>31 h 12 m</b></span>
    <span class="hbadge"><span class="g">◴</span>API <b>142/200</b></span>
  </div>
</div></div>

<div class="page"><div class="wrap">
  … obsah …
</div></div>

<div class="wrap"><div class="mockfoot">
  <span>♛ Aura Zľavy · redizajn V2 — návrh</span>
  <span>Mockup · 10. 8. 2026</span>
</div></div>
</body>
</html>
```

**Poradie tabov je fixné:** Dashboard · Kampane · Produkty · Analytika · Nastavenia · AI agent.
Aktívny tab má `class="on"`. `login.html` a `onboarding.html` navbar **nemajú**
(používateľ ešte nie je vnútri) — červený pruh PRODUKCIA majú obe.

---

## 1. Dizajnové pravidlá (nepodliehajú diskusii)

### 1.1 Farba nikdy nie je jediný nosič informácie
Každý stav = **farba + GLYF + text**. V dark režime sú `#E5534B` (critical) a
`#D97706` (attention) pod deuteranopiou takmer nerozlíšiteľné — glyf je to, čo
ich odlišuje. Preto `.badge` vždy obsahuje `<span class="g">…</span>` aj slovo.

### 1.2 Teal a gold NIE SÚ stavové farby
`--teal #05bcc4` / `--deep #03797e` sú brand a navigácia. `--gold #d8b878` je
akcent (koruna, eyebrow, watermark). V 12 px badge je teal `#03797E` a stavová
zelená `#2E7D32` nerozlíšiteľná — preto stav používa **výhradne** stavovú paletu:

| Stav | dark | light | Význam |
| --- | --- | --- | --- |
| critical | `#E5534B` | `#C62F26` | zlyhalo, treba zásah teraz |
| attention | `#D97706` | `#B58900` | riziko, čaká na človeka |
| progress | `#8B80E8` | `#4A3AA7` | práve prebieha |
| good | `#3FA045` | `#2E7D32` | hotovo, v poriadku |
| idle | `#8A9895` | `#667574` | neutrálne, nič sa nedeje |

Tokeny: `--st-critical`, `--st-attention`, `--st-progress`, `--st-good`, `--st-idle`.
`.tag.tt` (teal) sa smie použiť len ako **informačný** štítok, nikdy ako stav.

### 1.3 Glyfy stavov kampane — kanonické, neodchyľuj sa

| Glyf | Stav | Trieda badge | Farba |
| --- | --- | --- | --- |
| `✓` | zapísaná / hotovo (`done`) | `badge s-done` | good |
| `◐` | beží zápis (`running`) | `badge s-running` | progress |
| `○` | naplánovaná (`scheduled`) | `badge s-scheduled` | idle |
| `⚿` | vyžaduje kľúč (`needs_key`) | `badge s-needskey` | attention |
| `⏱` | zmeškaná (`missed`) | `badge s-missed` | attention |
| `◧` | čiastočná (`partial`) | `badge s-partial` | attention |
| `✕` | zlyhala (`failed`) | `badge s-failed` | critical |
| `⊘` | prepadnutá (`lapsed`) | `badge s-lapsed` | idle |
| `⊗` | zrušená (`cancelled`) | `badge s-cancelled` | idle |

Príklad: `<span class="badge s-running"><span class="g">◐</span>beží zápis</span>`

### 1.4 Typografia
Base 14 px, rozsah 13–15 px. Nadpisy sekcií 18 px, KPI hodnoty 21 px, hlavičky
tabuliek 9,5 px uppercase s letter-spacingom. Všetky čísla `tabular-nums`
(body to má globálne). Hustota vysoká — riadok tabuľky 9 px vertikálneho paddingu.

### 1.5 Formáty
- Dátum vždy `DD.MM.YYYY`, rozsah `05.08.2026 – 19.08.2026` (pomlčka s medzerami).
- Peniaze `1 284,50 €` (medzera ako oddeľovač tisícov, čiarka desatinná).
- Percentá celé čísla `15 %` (s medzerou). Marža `31,4 %`.
- Čas `14:20`. TTL kľúča `31 h 12 m`.

### 1.6 Invarianty, ktoré musí návrh vidieť (docs/10-KONTRAKT.md §H)
- **I3** — dry-run potvrdenie **nesmie zmiznúť**. Na `kampan-nova.html` je
  dry-run živý náhľad na tej istej ploche a tlačidlo „Zapísať do PRODUKCIE" je
  neaktívne, kým náhľad nie je potvrdený zaškrtnutím. Nikdy jedno-klikový zápis.
- **I2** — allowlist max 10 produktov, všade `n/10`.
- **I7** — nikde slovo „zrušiť zľavu". Zľava len expiruje. Rušiť sa dá **kampaň**.
- **I11** — pri každom stave zľavy `<span class="claim">podľa vlastného zápisu z 05.08.</span>`.
- **I1** — API kľúč sa nikde nezobrazuje, ani skrátený. Len TTL a stav.
- **I13** — v pätičke nastavení stav `WRITES_ENABLED`.
- **I8″ (rozšírenie)** — appka po novom používa **tri oddelené kľúče**:
  `product:edit` (zápis zliav), `orders:read` (predajnosť), `order:stats`
  (agregované tržby a marža, **bez zákazníckych dát**). `order:stats` sa dá
  vypnúť nezávisle od ostatných. Návrh to musí ukázať ako tri samostatné riadky
  v nastaveniach s vlastným prepínačom a vlastným TTL.

### 1.7 Rozpočet API (nové, podľa `docs/api/sperky-api-v4.md`)
Reálny limit je **20 req/min a 200 req/UTC deň na kľúč** — nie 300/min.
Appka vedie vlastný rozpočet nad audit logom. UI ukazuje **zostávajúci denný
rozpočet** (`142/200`), pauza medzi zápismi **3 s** (nie 250 ms), canary request
len tesne pred zápisom, sonda platnosti kľúča **len na vyžiadanie tlačidlom**.
Batch **nešetrí** rozpočet — 25 položiek = 25 hitov; nikde to netvrď opačne.

---

## 2. KANONICKÉ DÁTA — všetci používajú presne toto

Dnešný dátum vo všetkých mockupoch: **10.08.2026, 14:20**.
Shop: `sperky-eshop.sk` · 40 483 produktov v katalógu · allowlist 10 ID.

### 2.1 Allowlist — 10 produktov (slot, id, názov, cena)

| Slot | ID | Názov | Cena | Aktuálna zľava (vlastný zápis) |
| --- | --- | --- | --- | --- |
| 1 | 10241 | Náhrdelník Aura Luna, striebro 925 | 89,00 € | 15 % · do 19.08. |
| 2 | 10388 | Náušnice Aura Solis, zlato 585 | 214,00 € | 15 % · do 19.08. |
| 3 | 10455 | Prsteň Aura Nova, zirkón | 129,00 € | 15 % · do 19.08. |
| 4 | 10502 | Náramok Aura Tide, chirurgická oceľ | 46,50 € | 15 % · do 19.08. |
| 5 | 10617 | Prívesok Aura Aster, perleť | 62,00 € | — bez zľavy 41 dní |
| 6 | 10744 | Set Aura Vesper, striebro 925 | 168,00 € | 10 % · do 24.08. |
| 7 | 10809 | Náhrdelník Aura Mira, zlato 585 | 349,00 € | — bez zľavy 12 dní |
| 8 | 10923 | Náušnice Aura Petra, riečna perla | 74,50 € | 10 % · do 24.08. |
| 9 | 11056 | Prsteň Aura Cielo, topás | 156,00 € | — bez zľavy 63 dní |
| 10 | 11134 | Náramok Aura Rosa, ružové zlato | 98,00 € | ⊘ prepadla 02.08. |

Zľavnená cena = `cena × (1 − r/100)`, vždy s poznámkou
„orientačný výpočet appky; zaokrúhlenie shopu sa môže líšiť" (D4).
Napr. 89,00 € −15 % = **75,65 €**; 214,00 € −15 % = **181,90 €**;
129,00 € −15 % = **109,65 €**; 46,50 € −15 % = **39,53 €**;
168,00 € −10 % = **151,20 €**; 74,50 € −10 % = **67,05 €**.

### 2.2 Kampane — 6 kanonických záznamov

| # | Názov | Sada | % | Okno | Stav | Poznámka |
| --- | --- | --- | --- | --- | --- | --- |
| K-118 | Letný výpredaj — striebro | 4 produkty (10241, 10388, 10455, 10502) | 15 % | 05.08.2026 – 19.08.2026 | ✓ zapísaná (aktívna) | zapísaná 05.08. o 09:12, 4/4 OK |
| K-121 | Perlová kolekcia | 2 produkty (10744, 10923) | 10 % | 10.08.2026 – 24.08.2026 | ◐ beží zápis | 1 z 2 hotových, pauza 3 s |
| K-124 | Zlato — víkendová akcia | 2 produkty (10809, 10388) | 20 % | 15.08.2026 – 17.08.2026 | ○ naplánovaná | fire 15.08. o 06:00 |
| K-126 | September — nová sezóna | 5 produktov | 12 % | 01.09.2026 – 14.09.2026 | ⚿ vyžaduje kľúč | fire je za horizontom TTL (48 h) |
| K-115 | Prsteňový týždeň | 3 produkty | 20 % | 27.07.2026 – 02.08.2026 | ⊘ prepadnutá | okno uplynulo |
| K-112 | Júlová dobierka | 2 produkty | 25 % | 20.07.2026 – 27.07.2026 | ◧ čiastočná | 1 z 2 zapísaný, druhý `429 rate_limited` |

Aktívne zľavy dnes: **6 / 10** produktov. Vyžaduje zásah: **2** (K-126 ⚿, K-112 ◧).

### 2.3 Sady produktov (uložené výbery)
`Striebro 925` (4) · `Zlato 585` (2) · `Perly a perleť` (3) · `Celý allowlist` (10).

### 2.4 Tržby a marža (scope `order:stats`, agregované, bez zákazníckych dát)

**Dnes 10.08.2026 (k 14:20):**
- tržby s DPH **2 418,60 €** · bez DPH 2 015,50 €
- objednávky **34**
- marža **31,4 %** (order_income 2 015,50 € − expenses 1 382,60 €)
- dobierka **612,40 €** / 9 ks
- storno 1 · neprevzaté 0
- nízkomaržové objednávky (`lowProfit`, marža ≤ 30 %): **7**

**Posledných 14 dní — denné tržby s DPH (pre grafy, 28.07 → 10.08):**
`1 842 · 2 106 · 1 674 · 1 958 · 2 240 · 1 512 · 1 388 · 2 610 · 2 884 · 2 951 · 3 102 · 2 776 · 2 690 · 2 419`

Prvých 7 hodnôt = **mimo kampane**, posledných 7 = **počas kampane K-118**.

**Sekcia „Výkon zliav" (analytika):**
| Metrika | Počas kampaní (03.08–10.08) | Mimo kampaní (27.07–02.08) | Rozdiel |
| --- | --- | --- | --- |
| Priemerné denné tržby | 2 776,00 € | 1 817,14 € | **+52,8 %** |
| Priemerná marža | 29,8 % | 34,1 % | **−4,3 b. b.** |
| Objednávky / deň | 38,4 | 26,1 | **+47,1 %** |
| Podiel dobierok | 26,4 % | 21,8 % | **+4,6 b. b.** |
| Nízkomaržové obj. / deň | 6,3 | 2,9 | **+3,4** |

Záver, ktorý sa opakuje na analytike aj u AI agenta:
**„Kampane zdvihli tržby o polovicu, ale marža klesla o 4,3 b. b. — 20 % zľava na
zlate (K-124) by maržu stlačila pod 25 %."**

### 2.5 Predajnosť (scope `orders:read`, existujúca funkcia)
Posledný sync **10.08.2026 06:00**, spracované 978 objednávok za 3 dni,
ďalší sync **11.08.2026 02:00**. Top predajca za 30 dní: 10241 (142 ks),
potom 10502 (118 ks), 10923 (96 ks), 10388 (74 ks), 10744 (61 ks).

### 2.6 Kľúče (tri, oddelené)

| Kľúč | Scope | Stav | TTL | Rozpočet dnes |
| --- | --- | --- | --- | --- |
| Zápisový | `product:edit` | aktívny | **31 h 12 m** (do 11.08. 21:32) | 142 / 200 zostáva |
| Predajnosť | `orders:read` | aktívny | 19 h 04 m | 168 / 200 zostáva |
| Štatistiky | `order:stats` | aktívny, **vypnuteľný** | 43 h 51 m | 186 / 200 zostáva |

Badge v hlavičke ukazuje **zápisový kľúč** (`⚿ Kľúč 31 h 12 m`) a **jeho** rozpočet
(`◴ API 142/200`). Pod 6 h TTL sa badge prepne na `.hbadge.warn`, pod 1 h na `.crit`.
Minútový rozpočet: 20/min, dnes využité maximum 9/min.

### 2.7 Audit — posledné položky (pre analytiku a detail kampane)
| Čas | Operácia | Produkt | Výsledok |
| --- | --- | --- | --- |
| 10.08. 14:18 | setReduction 10 % | 10744 Set Aura Vesper | ✓ ok (312 ms) |
| 10.08. 14:18 | dry-run K-121 | 2 produkty | ✓ token vydaný |
| 10.08. 09:00 | order-stats/sales | — | ✓ ok |
| 06.08. 11:42 | setReduction 25 % | 10617 Prívesok Aura Aster | ✕ 429 rate_limited (odomknutie o 10 min) |
| 05.08. 09:12 | setReduction 15 % ×4 | K-118 | ✓ 4/4 ok |

### 2.8 Prevádzka
Beží na `127.0.0.1:3070` · kontajnery `ovl-zliav-app` + `ovl-zliav-db` + `ovl-zliav-caddy`
· `WRITES_ENABLED=true` · `NODE_ENV=production` · admin `Samuel`
· runaway strop 60 zápisov/h, dnes 6.

---

## 3. Rozpis stránok

### D1 — `dashboard.html`
1. **KPI strip** `.kpistrip` so 7 kartami v jednom pruhu, presne v tomto poradí:
   1. Tržby dnes — `2 418,60 €` · sub „34 objednávok · k 14:20"
   2. Marža dnes — `31,4 %` · sub „−2,7 b. b. vs 7-dňový priemer" (attention)
   3. Objednávky — `34` · sub „+8 vs včera o tomto čase"
   4. Aktívne zľavy — `6/10` (`.t`) · sub „podľa vlastného zápisu"
   5. Vyžaduje zásah — `2` (crit) · sub „K-126 ⚿ · K-112 ◧"
   6. Rozpočet API — `142/200` · sub „zostáva dnes · 20/min"
   7. TTL kľúča — `31 h` · sub „do 11.08. 21:32"
2. **Banner ohrozených kampaní** `.note.attention` — agregovaný (D8):
   „2 kampane vyžadujú zásah" + odkazy.
3. **Sekcia 01 · Kampane dnes** — časová os `.tline` alebo kompaktná `.tw` tabuľka
   s 3 riadkami (K-121 ◐, K-124 ○, K-118 ✓).
4. **Sekcia 02 · Allowlist v skratke** — `.brow` bar-rows: 10 produktov,
   lišta = zostávajúce dni zľavy, hodnota = `15 %` / `bez zľavy`.
5. **Sekcia 03 · Rozpočet a kľúče** — 3 riadky `.brow` s `.meter` (denný rozpočet
   troch kľúčov) + poznámka o pauze 3 s a canary.
6. Vpravo hore `.pactions`: `+ Nová kampaň` (`.btn.primary`).

### D2 — `kampane.html`, `kampan-nova.html`, `kampan-detail.html`

**`kampane.html`**
- `.chips` filter stavov (Všetky · ✓ zapísané · ◐ beží · ○ naplánované · ⚿ vyžaduje kľúč · ◧ čiastočné · ✕ zlyhalo · ⊘ prepadnuté).
- `.tw` tabuľka všetkých 6 kampaní: Kód · Názov · Sada (n produktov) · % · Okno · Stav (`.badge`) · Posledný zápis · akcia „Detail".
- Prázdny stav `.empty` ukáž ako malú ukážku pod tabuľkou **nie** — namiesto toho
  ho použije D5 na `ai-agent.html`. Tu nie.

**`kampan-nova.html` — JEDNA obrazovka, `.split-58`**
- **Ľavý stĺpec — výber:**
  - Sada: `.chips` (Striebro 925 · Zlato 585 · Perly a perleť · Celý allowlist · Vlastný výber)
  - Produkty: `.tw` so `.chk` checkboxmi, 10 riadkov, zaškrtnuté 4 (K-118 sada). Hlavička „vybraných 4 / max 10" (I2).
  - Percento: `.input.w-pct` s hodnotou `15` + `.chips` presetmi 5/10/15/20/25/30. Hint „celé číslo 1–30, strop shopu je 30 %".
  - Dátumy: dve `.input.w-date` (`05.08.2026`, `19.08.2026`) + presety 7/14/30 dní a „do konca mesiaca". Hint (D13): „platí od 00:00 dňa OD do 23:59 dňa DO, čas shopu".
  - Názov kampane: `.input` = `Letný výpredaj — striebro`.
- **Pravý stĺpec — ŽIVÝ DRY-RUN NÁHĽAD** (`.card`, hlavička „Dry-run náhľad · prepočítaný 14:20"):
  - `.tw` diff tabuľka per produkt: Produkt · Aktuálna cena · Zľava · **Nová cena** · Okno · Posledný vlastný zápis. 4 riadky.
  - Poznámka `.note.info`: „orientačný výpočet appky; zaokrúhlenie shopu sa môže líšiť".
  - Riadok nákladov: „4 zápisy · 4 z 142 zostávajúcich requestov · odhad 12 s (pauza 3 s)".
  - `.note.attention` ak dátum presahuje TTL kľúča (tu **neplatí**, okno je v poriadku — namiesto toho daj `.note.good` „okno sa zmestí do platnosti kľúča").
- **Dolná lišta cez celú šírku** (`.card` s `.cfoot`):
  - `.chk` **„Rozumiem, že zápis je nevratný a zľavu nie je možné zrušiť, len nechať expirovať."** — zaškrtnutý.
  - `.btn.lg.danger` **„Zapísať do PRODUKCIE"** + vedľa `.btn.ghost` „Uložiť ako naplánovanú".
  - Pod tlačidlom `.tiny.muted`: „Dry-run token platný 15 min · vydaný 14:20 · sada 4 produkty".
  - **Dry-run potvrdenie nesmie zmiznúť (I3)** — je to tá istá plocha, nie krok.

**`kampan-detail.html`** — kampaň **K-118**
- Hlavička s `.badge.s-done` + kód, okno, sada.
- Sekcia 01 · Produkty kampane — `.tw` 4 riadky: produkt, pôvodná cena, %, nová cena, čas zápisu, výsledok (✓ ok + trvanie).
- Sekcia 02 · Priebeh — `.tline` (dry-run 09:10 → potvrdenie 09:11 → 4 zápisy 09:12–09:12:09 → hotovo).
- Sekcia 03 · Audit — `.tw` z bodu 2.7 (filtrované na K-118).
- Sekcia 04 · Vplyv (ak je zapnutý `order:stats`) — 2 KPI: „tržby počas kampane 2 776 €/deň" vs „pred kampaňou 1 817 €/deň", marža −4,3 b. b.
- Akcie: `.btn.ghost` „Predĺžiť okno", `.btn.ghost` „Prepísať percento", `.btn.danger.off` „Zrušiť kampaň" (disabled s vysvetlením, že zľava v shope zostane do expirácie — I7).

### D3 — `produkty.html`
- KPI strip (5): produkty v allowliste `10/10` · so zľavou `6` · bez zľavy `3` · prepadnuté `1` · najdlhšie bez zľavy `63 dní`.
- `.tw` hlavná tabuľka 10 riadkov: Slot · ID · Názov · Cena · Zľava (`.badge`) · Nová cena · Okno · Posledný vlastný zápis (`.claim`) · Predaj 30 dní (ks) · akcia.
- Sekcia „Predajnosť 30 dní" — `.brow` top 5 z bodu 2.5, s poznámkou o poslednom syncu.
- Sekcia „Allowlist" — poznámka `.note.info`, že zmena allowlistu je v Nastaveniach a strop 10 je vynútený schémou (I2).

### D4 — `analytika.html`
- Sekcia **01 · Tržby a marža** (scope `order:stats`) — KPI strip (6): tržby dnes,
  tržby 14 dní `31 233 €`, marža dnes 31,4 %, objednávky 34, dobierka 612,40 €/9 ks,
  nízkomaržové 7.
- Inline SVG stĺpcový graf 14 dní (dáta z 2.4), prvých 7 stĺpcov `--st-idle`,
  posledných 7 `--teal`, legenda „mimo kampane / počas kampane K-118".
- Sekcia **02 · Výkon zliav** — tabuľka z 2.4 (počas vs mimo) + `.note.attention`
  so záverom o marži.
- Sekcia **03 · Nízkomaržové objednávky** (`order-stats/lowProfit`) — `.tw` 7 riadkov:
  ID objednávky, bez DPH, s DPH, marža %. Použi: 48219 / 40,10 / 48,50 / 22,4 %;
  48227 / 61,20 / 74,05 / 25,1 %; 48231 / 33,90 / 41,00 / 18,7 %;
  48240 / 89,40 / 108,17 / 28,9 %; 48246 / 27,50 / 33,28 / 15,2 %;
  48251 / 54,80 / 66,31 / 29,6 %; 48258 / 72,10 / 87,24 / 26,8 %.
  `.note.info`: „agregované a per-objednávkové sumy bez zákazníckych dát —
  scope `order:stats` ich nevracia."
- Sekcia **04 · Audit** — `.tw` z bodu 2.7 + `.chips` filter typu operácie.
- Sekcia **05 · Rozpočet API** — denný priebeh spotreby (`.brow` po hodinách alebo
  malý SVG), poznámka o limite 20/min a 200/deň a o tom, že batch nešetrí.

### D5 — `nastavenia.html`, `ai-agent.html`, `login.html`, `onboarding.html`

**`nastavenia.html`**
- Sekcia 01 · **Kľúče (3)** — pre každý `.card` riadok: názov, scope (`code`),
  stav `.badge`, TTL s `.meter`, denný rozpočet s `.meter`, `.sw` prepínač
  (pri `order:stats` zapnutý a **vypnuteľný nezávisle**), `.btn.sm` „Overiť kľúč
  (sonda, 1 request)" a „Nahradiť". **Kľúč sa nikde nezobrazuje (I1).**
- Sekcia 02 · Allowlist — 10 riadkov s ID a názvom, `.btn.sm` nahradiť slot,
  poznámka o strope 10.
- Sekcia 03 · Zápisy a bezpečnosť — `WRITES_ENABLED=true`, `NODE_ENV=production`,
  runaway strop 60/h (dnes 6), pauza medzi zápismi 3 s, globálny mutex.
- Sekcia 04 · Vzhľad — `.seg` Dark / Light.
- Sekcia 05 · Prevádzka — port, kontajnery, verzia, čas syncu predajnosti.

**`ai-agent.html`** — deterministický pravidlový analytik, **nikdy nezapisuje sám**
- `.note.info` hore: „AI agent len navrhuje. Každý návrh prejde dry-runom a
  potvrdením ako každý iný zápis (I3)."
- 3 zistenia ako `.fcard` s watermarkom:
  1. `⚿` **K-126 narazí na expirovaný kľúč** — fire 01.09., TTL kľúča 48 h. Návrh: presunúť fire alebo pripraviť rotáciu. (attention)
  2. `📉` **Marža počas kampaní klesá o 4,3 b. b.** — a 7 objednávok dnes má maržu ≤ 30 %. Návrh: neísť s 20 % na zlate (K-124), skúsiť 12 %. Zdroj `order-stats/lowProfit`. (critical)
  3. `○` **3 produkty bez zľavy > 30 dní** — 11056 (63 dní), 10617 (41 dní), 10809 (12 dní — pod prahom, len info). Návrh: zaradiť 11056 do septembrovej kampane. (idle)
- Pod tým `.empty` ukážka „Žiadne ďalšie zistenia — posledná analýza 10.08. 14:15".
- Každé zistenie má `.btnrow`: „Vytvoriť kampaň z návrhu" (`.btn`) + „Odložiť" (`.btn.ghost`).

**`login.html`** — bez navbaru, s červeným pruhom. Vycentrovaná `.card` max 380 px:
koruna ♛, „Aura Zľavy", polia Meno / Heslo, `.btn.primary.block` „Prihlásiť sa",
`.tiny.muted` „Lokálny prístup 127.0.0.1:3070 · za Caddy basic auth · jediný admin".

**`onboarding.html`** — bez navbaru, s červeným pruhom. 4 kroky ako `.clist`
alebo číslované `.card`: 1) doména shopu (predvyplnené `sperky-eshop.sk`),
2) tri API kľúče (product:edit povinný, orders:read a order:stats voliteľné —
každý s vlastným poľom a poznámkou, že sa uloží šifrovane s TTL 48 h),
3) allowlist 10 product ID (mriežka 10 polí, predvyplnené ID z 2.1),
4) dry-run test (`.btn` „Spustiť dry-run bez zápisu" + `.note.good` výsledok
„4/4 produkty overené, žiadny zápis"). Dole `.btn.primary` „Dokončiť a zapnúť zápisy".

### D6 — light varianty
**Neduplikuj súbory.** Light sa vyrobí zmenou jediného atribútu:
`<html lang="sk" data-theme="light">` a opätovným renderom tej istej stránky.
- Renderuj light aspoň pre: `dashboard.html`, `kampan-nova.html`, `analytika.html`.
- Výstupné PNG pomenuj `<stranka>-light.png`.
- Ak D6 nájde v light režime nečitateľné miesto (typicky inline SVG s natvrdo
  zapísanou dark farbou), **nahlási to**, needituje paletu. Riešenie patrí D0.

---

## 4. Kontrolný zoznam pred odovzdaním stránky

- [ ] `<html lang="sk" data-theme="dark">` a `<link rel="stylesheet" href="_system.css">`
- [ ] Červený pruh PRODUKCIA · teal navbar s ♛ a 6 tabmi · badge TTL + rozpočet API
- [ ] Aktívny tab má `class="on"`, počty v taboch sedia (Kampane 4, Produkty 10, AI agent 3)
- [ ] Žiadny stav nie je len farbou — všade farba + glyf + text
- [ ] Teal/gold nie sú použité ako stavová farba
- [ ] Dáta sedia s kapitolou 2 (sumy, dátumy, názvy, ID)
- [ ] Dátumy `DD.MM.YYYY`, peniaze `1 284,50 €`, percentá `15 %`
- [ ] Nikde „zrušiť zľavu"; pri stave zľavy je `.claim`
- [ ] Žiadny API kľúč, ani skrátený
- [ ] Žiadny externý zdroj, žiadny build, CSS neskopírovaný do stránky

---

## 5. Otvorené / dorozhodnuté D0

1. **Rozpor I8 vs `order:stats`.** Kontrakt I8 hovorí „len `product:edit`, žiadny
   endpoint pod `/api/order`". Používateľ zapojenie `order:stats` výslovne
   rozhodol. `/api/order-stats` je iný controller než `/api/order` a nevracia
   zákaznícke dáta, takže duch I8 (žiadne zákaznícke dáta) zostáva zachovaný —
   ale **litera I8 sa musí prepísať v kontrakte**, kým sa toto implementuje.
   Návrh to označuje ako **I8″** a v mockupoch to zobrazuje ako tri oddelené,
   nezávisle vypínateľné kľúče. `docs/10-KONTRAKT.md` D0 neupravuje.
2. **Pauza medzi zápismi 3 s** namiesto 250 ms z I10 — priamy dôsledok limitu
   20/min. I10 (sekvenčný determinizmus, žiadny `Promise.all`) zostáva.
3. **Zrušená kampaň (`cancelled`)** dostala glyf `⊗` — v zadaní chýbal, ale stav
   je v D14 kontraktu.
4. Badge v hlavičke ukazuje **zápisový** kľúč, nie tri naraz — tri sú v Nastaveniach.
5. 7. KPI karta (TTL) je v stripe zámerne posledná, aby sa strip dal na užších
   šírkach zalomiť na 4+3 bez straty dôležitejších čísel.
