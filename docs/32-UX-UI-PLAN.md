# Aura Zľavy — plán úprav UX/UI (redizajn + grafy + animácie)

**Dátum:** 2026-08-05 · **Vstupy:** `docs/30-UX-AUDIT.md` (U1–U21), `docs/31-UI-AUDIT.md` (V1–V39)
**Stav:** SCHVÁLENÉ — vstup pre implementáciu (4 agenti B1–B4)

Kontrakt `docs/10-KONTRAKT.md` zostáva nadradený. Kde tento plán mení rozhodnutie,
je to výslovne napísané v §7. Invarianty I1–I14 sa nemenia vôbec.

---

## 1. Smer, ktorý zadal Samuel

> „priehľadné, minimalistické a praktické v rodine Aura + grafy a zobrazenia
> na produkty + animácie v rámci možností"

Preklad do pravidiel, ktoré rozhodujú sporné prípady:

1. **Priehľadné** = vrstvené priesvitné plochy (`color-mix` + `backdrop-filter`),
   nie plné boxy s tvrdým borderom. **Výnimka bez diskusie:** pruh PRODUKCIA,
   stavové badge a chybové panely sú vždy plné a nepriesvitné — ich čitateľnosť
   je bezpečnostná funkcia (D6, I11).
2. **Minimalistické** = menej rámov, menej opakovaných viet, viac bieleho miesta,
   jedna dominanta na obrazovku. Nie „menej informácií" — žiadna informácia
   vyžadovaná kontraktom sa nemaže, len prestáva byť zopakovaná 9×.
3. **Praktické** = počet klikov na bežnú úlohu klesá, skratky existujú,
   appka varuje dopredu a nie po zlyhaní.
4. **Rodina Aura** = teal/gold tokeny, Inter, koruna, dark default.
5. **Grafy** len z dát, ktoré appka legitímne má (viď §4 a obmedzenie nižšie).
6. **Animácie** v rámci možností = krátke, funkčné, vždy s `prefers-reduced-motion`.

### Tvrdé obmedzenie pri „zobrazeniach na produkty"

Shop API vracia pri produkte len `id`, `name`, `price`, `has_attributes`
(+ varianty v `/products/get`). **Žiadne obrázky produktov neexistujú** a appka
nemá scope `orders:read`, takže **žiadne dáta o predajnosti** (invariant I8 to
vynucuje testom). Zobrazenia produktov preto stoja výhradne na:
`catalog_cache` (názov, cena), `campaigns` + `campaign_items` (čo appka zapísala),
`audit_log` (kedy, s akým výsledkom). Žiadny agent NESMIE vymyslieť graf, ktorý
by potreboval objednávky, tržby, zásoby alebo obrázky.

---

## 2. Odpovede na 20 otázok

Otázky 1–16 zodpovedal Samuel naživo, 17–20 som dorozhodol v duchu §1
(výslovne označené).

| # | Téma | Rozhodnutie |
|---|---|---|
| 1 | Téma | **Dark default + „Light pill"**; pruh PRODUKCIA v darku #C62F26 + gold hairline |
| 2 | Hlavička | **Červený pruh navrchu, teal lišta pod ním**, zviazané gold hairline |
| 3 | Fonty | **Inter všade + tabulárne číslice** (`font-variant-numeric: tabular-nums`) |
| 4 | Koruna | **Áno, ♛ v gold pri názve** |
| 5 | Stav „naplánovaná" | **Neutrál** (zelená sa uvolní pre „stalo sa a je to dobre") |
| 6 | `ZÁPISY VYPNUTÉ (dev)` | **Neutrál s prefixom `● dev`** |
| 7 | Badge D7 | **Raz legenda + skrátený badge** `vlastný zápis 05.08.`, plné znenie v `title` + `aria-label` |
| 8 | Disclaimer D4 | **Raz pod hlavičkou tabuľky + `≈` marker** s `title` pri každej vypočítanej cene |
| 9 | Dátumy | **Natívny picker + SK echo** `06.08.2026` vedľa poľa + dĺžka okna v dňoch |
| 10 | Kódy D/I v UI | **Vypustiť z UI**, ponechať v kóde a v KONTRAKTe |
| 11 | Blokovaný prekryv | **Pomenovať konflikt** (ktorá kampaň, ktoré produkty, s odkazom) **+ tlačidlo „vyradiť kolidujúce zo sady"** |
| 12 | Skratky | **Všetky štyri:** duplikovať kampaň · pomenované sady produktov · „posledná sada" · ďalšie dátumové presety |
| 13 | Heslo pri zápise | **Sudo okno 30 min, heslo raz**, odpočet v hlavičke |
| 14 | Dashboard | **Zásah → nepotvrdené → chystá sa → kľúč**; dokumentačná karta pod čiaru |
| 15 | Bez kľúča | **Áno, uložiť ako koncept (`draft`)**, hláška menuje kľúč, nie nedostupný shop |
| 16 | Read-only | **Všetky mutácie vypnuté** s tooltipom; čítanie, audit a „Obnoviť z shopu" fungujú |
| 17 | Posun OD pri dopálení | **Ukázať dôsledok a nechať potvrdiť** — *dorozhodnuté*: skrátenie okna je vecná zmena, appka ju nesmie spraviť ticho (§1.3 praktické, §1.1 priehľadné) |
| 18 | Odobranie z allowlistu | **Inline „Naozaj?"** v riadku — *dorozhodnuté*: heslo je tu prehnané (nič sa nezapisuje do shopu), okamžité mazanie je zbytočne ostré |
| 19 | Mobil | **Read-only na mobile + kartový režim tabuliek** — *dorozhodnuté*: zápis z telefónu nemá zmysel, appka je viazaná na `127.0.0.1` (I5), takže mobil je scenár „pozriem, čo beží" |
| 20 | Šírka obsahu | **1180 px pre široké tabuľky · 1100 px default · 720 px formuláre** — *dorozhodnuté*: dry-run má 7 stĺpcov a dnes sa tlačí do 1065 px |

### Čo sa opravuje bez otázky (dlh oproti kontraktu, nie preferencia)

Toto nie sú voľby — kontrakt ich vyžaduje a implementácia zaostáva:

- **D10** — read-only nevypína ani jednu akciu (`READ_ONLY_TOOLTIP` bez konzumentov)
- **D33b** — „Dopáliť teraz" pri `missed` posiela `from` v minulosti → vždy blokátor,
  potvrdenie sa nevykreslí; cesta, ktorú odchýlka 1 zámerne vytvorila, je slepá
- **D26 / D8** — pripomienky 48/24/2 h sa počítajú, `getActiveReminders()` bez konzumenta
- **D13** — `mm/dd/yyyy` v pickeroch
- **D20** — onboarding sa nedá dokončiť (`markOnboardingDone()` bez volajúceho)
- **D15 / D34** — počítadlá položiek nesedia, retry ticho vynecháva `not_found`
- **D18** — audit stopa kampane je nedosiahnuteľná (chýba `campaign_id` na zápisových eventoch)
- **V20** — `preskočený` sa kreslí v `.ovl-error`, hoci to nie je chyba
- **V35** — `.ovl-num` láme `2 450,00 €` na tri riadky
- **V15** — `.ovl-stack` roztiahne „Zopakovať zlyhané" na 1065 px

---

## 3. Dizajnový systém (B1)

### 3.1 Tokeny

Deklarovať v `:root` (light) a duplicitne pod `@media (prefers-color-scheme: dark)`
**aj** `:root[data-theme="dark"]`, aby prepínač vyhral v oboch smeroch. Default je
dark → `:root` bez `data-theme` sa chová ako dark, `[data-theme="light"]` prepína.

| Rola | Light | Dark |
|---|---|---|
| `--paper` (pozadie appky) | `#f8f4f7` | `#0e1413` |
| `--surface` (plocha karty, priesvitná) | `color-mix(in srgb, #ffffff 72%, transparent)` | `color-mix(in srgb, #16201f 62%, transparent)` |
| `--surface-solid` (badge, chyby, pruh) | `#ffffff` | `#16201f` |
| `--line` | `#E2DAE0` | `#22302e` |
| `--ink` | `#131B1A` | `#eef3f2` |
| `--dim` | `#667574` | `#8A9895` |
| `--brand` (teal) | `#03797E` | `#05BCC4` |
| `--brand-tint` | `#E3F1F1` | `color-mix(in srgb, #05BCC4 14%, transparent)` |
| `--gold` | `#8A6417` | `#D8B878` |

**Pravidlo, ktoré NESMIE porušiť žiadny agent:** `--brand` (teal) a `--gold` sa
**nikdy** nepoužijú ako stavová farba ani ako plocha stavového badge. Gold je
výhradne koruna, hairline a eyebrow text. Dôvod je meraný: teal `#03797E`
a stavová zelená sú v 12 px badge nerozlíšiteľné.

### 3.2 Stavová paleta — overená validátorom

Päť tónov, každý s ikonou a textom (viď 3.3):

| Rola | Light | Dark | Použitie |
|---|---|---|---|
| `--st-critical` | `#C62F26` | `#E5534B` | zlyhala, kľúč chýba, panic |
| `--st-attention` | `#D97706` | `#B58900` | vyžaduje kľúč, zmeškaná, čiastočná |
| `--st-progress` | `#4A3AA7` | `#8B80E8` | beží zápis |
| `--st-good` | `#2E7D32` | `#3FA045` | zapísaná, aktívna, OK |
| `--st-idle` | `#667574` | `#8A9895` | naplánovaná, preskočený, dev režim |

Overené `scripts/validate_palette.js` proti `--paper` oboch režimov:
light prejde všetky kontroly (najhoršia susedná normal ΔE 15,4 / deutan 12,5);
dark prejde pásmo svetlosti, chromu, normal ΔE 16,3 a kontrast, **ale susedná
dvojica critical↔attention má pod deuteranopiou ΔE 4,0**.

### 3.3 Preto: stav nie je nikdy len farba

Z merania vyššie vyplýva tvrdé pravidlo. Každý stav nesie **farbu + glyf + text**:

| Stav | Glyf | Text |
|---|---|---|
| zapísaná / OK | `✓` | zapísaná |
| beží zápis | `◐` | beží zápis |
| naplánovaná | `○` | naplánovaná |
| vyžaduje kľúč | `⚿` | vyžaduje kľúč |
| zmeškaná | `⏱` | zmeškaná |
| čiastočná | `◧` | čiastočná |
| zlyhala | `✕` | zlyhala |
| prepadnutá | `⊘` | prepadnutá |
| zrušená | `–` | zrušená |
| preskočený | `⤼` | preskočený |

V grafoch to isté platí tvarom alebo šrafovaním, nikdy len výplňou.

### 3.4 Animácie

Rozpočet: krátke a funkčné. Všetko v jednom bloku
`@media (prefers-reduced-motion: reduce) { … }` na `animation: none` /
`transition: none`.

| Kde | Čo | Trvanie |
|---|---|---|
| vstup obrazovky | fade + 4px posun nahor | 180 ms `ease-out` |
| karty dashboardu | staggered fade, 40 ms krok, max 6 kariet | 160 ms |
| badge zmena stavu | crossfade farby a glyfu | 200 ms |
| TTL odpočet | plynulý oblúk (nie skok po sekundách) | – |
| skeleton | shimmer 1,2 s (nie pulz) | 1200 ms |
| rozbalenie „Technický detail" | výška `grid-template-rows` | 160 ms |
| tlačidlo → dry-run | inline spinner v tlačidle | – |
| výsledok zápisu | toast zdola, drží kým sa neodklikne | 220 ms vstup |
| grafy | bary/spany narastú z baseline pri prvom zobrazení | 320 ms `ease-out`, raz |
| hover na mark | 2 px surface ring, bez posunu | 120 ms |

Zakázané: parallax, dlhé sekvencie, animovaný pruh PRODUKCIA, blikanie
stavových badge, animácie na potvrdzovacom tlačidle zápisu.

---

## 4. Grafy a zobrazenia produktov (B2)

Postup podľa skillu `dataviz`: forma → farba podľa úlohy → validácia → marky →
hover → prístupnosť. Každý graf je inline SVG, bez závislostí, light aj dark,
`prefers-reduced-motion` rešpektované, a **každý má tabuľkovú alternatívu**
(`<details><summary>Zobraziť ako tabuľku</summary>`).

### G1 — Časová os okien kampaní (dashboard + `/kampane`)
- **Forma:** horizontálne spany na 3-mesačnej osi (rozsah, nie magnitúda).
- **Farba:** stavová paleta + glyf na začiatku spanu (3.3). Dnes = 1 px teal
  vertikála (brand ako orientácia, nie ako stav).
- **Marky:** výška spanu 10 px, rádius 4 px na oboch koncoch, 2 px medzera medzi
  susednými spanmi, prekryv označený 2 px surface ringom.
- **Hover:** tooltip s názvom, percentom, oknom a počtom produktov.
- **Prečo:** dnes sa prekryv okien dá zistiť len čítaním dátumov v tabuľke.

### G2 — Hĺbka zľavy na allowliste (`/produkty`)
- **Forma:** horizontálny bar chart, jeden riadok na produkt, hodnota = %.
- **Farba:** **sekvenčná teal** (magnitúda, nie stav) — light `#E3F1F1`→`#03797E`,
  dark `#12312F`→`#05BCC4`, monotónna svetlosť. Toto je jediné miesto, kde je
  teal správne, lebo nekóduje stav.
- **Marky:** bar 8 px, 4 px rádius na dátovom konci, priamy label `−15 %` na
  konci baru; os 0–30 % (strop API) so značkou pri 30.
- **Prázdny stav:** produkt bez vlastného zápisu má prázdnu dráhu + `bez zápisu`.

### G3 — História vlastných zápisov na produkt (detail produktu)
- **Forma:** malý časový bodový graf — kedy appka na produkt zapísala a s akým %.
- **Farba:** stavová (OK / zlyhalo) + tvar (kruh / krížik), nikdy len farba.
- **Marky:** ≥8 px markery, 2 px surface ring pri prekryve v čase.
- **Prečo:** odpovedá na „prečo je tento produkt v akcii", čo dnes vyžaduje
  filtrovanie auditu.

### G4 — Aktivita zápisov v čase (`/audit`)
- **Forma:** stĺpce po dňoch, dve série — OK a zlyhané.
- **Farba:** `--st-good` a `--st-critical` (stavové, s legendou aj glyfmi).
- **Pravidlo:** **jedna os.** Žiadna druhá y-škála, žiadny pomer úspešnosti ako
  druhá séria — ak treba, je to samostatný graf.
- **Marky:** 2 px medzera medzi segmentmi, priame labely len na dnešnom stĺpci.

### G5 — Rozpad položiek kampane (detail kampane)
- **Forma:** jeden segmentovaný bar (`2 ok · 1 zlyhané · 1 nenájdený · 1 preskočený`),
  **nie donut**. Pod ním počítadlá ako text.
- **Farba:** stavová, 2 px surface medzera medzi segmentmi, glyf v legende.
- **Prečo:** rieši U6 — dnešné počítadlá nesedia a nepokrývajú všetky stavy.

### G6 — TTL kľúča ako oblúk (hlavička/dashboard)
- **Forma:** nie graf, ale **hero číslo + oblúk** — jedna hodnota si nezaslúži
  chart. `47 h 59 min` veľkým, oblúk 48 h okolo, farba prechádza
  `--st-good → --st-attention` (≤6 h) → `--st-critical` (≤1 h).

**Zakázané formy:** dual-axis (dve y-škály), donut na viac než 2 kategórie,
rainbow ramp, číslo na každom bode, graf bez tabuľkovej alternatívy.

### Zobrazenia produktov (nie grafy)
- Karta produktu: názov, `#id`, cena tabulárne, `≈` zľavnená cena keď má vlastný
  zápis, skrátený badge vlastného zápisu (7), mini bar z G2, varianty ako `⚙ varianty`.
- Bez obrázkov — API ich nemá. Miesto obrázka nesie **iniciálový monogram**
  v `--brand-tint` (minimalistické, žiadny placeholder-šum).

---

## 5. Rozdelenie práce — 4 agenti

Vlastníctvo súborov je **exkluzívne**. Do cudzieho súboru nesmie agent zapísať
ani jeden znak. Kde potrebuje niečo cudzie, naprogramuje proti dohodnutému
rozhraniu z §6 a nahlási to.

### B1 — Dizajnový systém, téma, animácie
**Vlastní:** `src/app/globals.css` · `src/components/ui/**` ·
`src/components/layout/**` · `src/app/layout.tsx`
**Robí:** tokeny 3.1 (light+dark, priesvitné plochy) · Inter + tabulárne číslice ·
koruna ♛ v gold · pruh PRODUKCIA + teal lišta + gold hairline (2) · prepínač témy
s `localStorage` a dark defaultom (1) · stavový systém 3.2/3.3 v `StatusBadge`
(vrátane `naplánovaná → idle` (5) a `dev → idle` (6)) · `WriteModeBadge` (6) ·
skrátený `SelfWriteBadge` s plným znením v `title`/`aria-label` (7) ·
`PriceHint` s `≈` markerom (8) · štýly formulárov a vstupov (V28) ·
`disabledReason` ako viditeľný text + tooltip (U17) · read-only tooltipy na
`Button` (16) · animácie 3.4 · šírky 1180/1100/720 (20) · mobil: kartový režim
tabuliek + sticky prvý stĺpec (19), TTL badge sa skrývať NESMIE (D5) ·
oprava `.ovl-num` nowrap (V35), `.ovl-stack` align (V15), inverzia `h1`/`h2` (V13)
**Nesmie:** meniť logiku, routy, doménové súbory. Sudo okno 30 min je B3.

### B2 — Grafy a zobrazenia produktov
**Vlastní:** `src/components/charts/**` (nové) · `src/components/products/**` ·
`src/app/api/insights/**` (nové) · `src/lib/repo/insights.repo.ts` (nové) ·
`test/unit/charts.spec.ts`, `test/integration/routes-insights.spec.ts`
**Robí:** G1–G6 podľa §4 · read-only endpointy pre dáta grafov (`session` auth,
žiadne mutácie) · karty produktov s monogramom · tabuľkové alternatívy ·
prázdne stavy · `prefers-reduced-motion`
**Musí:** používať tokeny a stavové triedy od B1 podľa §6, nie vlastné hexy.
**Nesmie:** vymyslieť graf potrebujúci objednávky, tržby, zásoby či obrázky (I8).

### B3 — Korektnosť tokov a dlh oproti kontraktu
**Vlastní:** `src/lib/engine/preview.ts` · `src/lib/scheduler/reminders.ts` ·
`src/app/api/campaigns/**` · `src/app/api/notifications/**` ·
`src/app/api/key/**` · `src/lib/auth/sudo.ts` · `src/components/campaigns/**` ·
`test/integration/{ux-readonly,ux-missed-fire,ux-overlap}.spec.ts`
**Robí:** read-only vypne všetky mutácie (16, D10) · oprava „Dopáliť teraz"
(`kind: c.kind`, `from: max(dateFrom, dnes)`) + potvrdenie skráteného okna (17, D33b) ·
blokátor prekryvu s menom kampane, produktmi a tlačidlom „vyradiť kolidujúce" (11) ·
pripomienky 48/24/2 h do `/api/notifications` (D26) · sudo okno 30 min, heslo raz,
`sudoSecondsLeft()` do odpovede (13) · SK echo dátumov + dĺžka okna (9, D13) ·
počítadlá položiek + veta o `not_found` pod retry (D15/D34) · `campaign_id` na
zápisových eventoch (D18) · `preskočený` nie ako chyba (V20) · vlastný blokátor
„chýba API kľúč" namiesto `shop_unreachable` (15) · koncept bez kľúča (15) ·
vypustiť D/I kódy z UI stringov vo vlastných súboroch (10)
**Nesmie:** meniť CSS, tokeny, `src/components/ui/**`.

### B4 — Dashboard, skratky, onboarding
**Vlastní:** `src/app/page.tsx` · `src/components/dashboard/**` ·
`src/components/product-sets/**` (nové) · `src/app/api/product-sets/**` (nové) ·
`src/lib/repo/product-sets.repo.ts` (nové) · `db/migrations/0009_product_sets.sql` (nové) ·
`src/app/kampane/page.tsx` · `src/app/produkty/page.tsx` · `src/app/audit/page.tsx` ·
`src/app/nastavenia/page.tsx` · `src/app/onboarding/**` ·
`test/integration/routes-product-sets.spec.ts`
**Robí:** poradie dashboardu zásah → nepotvrdené → chystá sa → kľúč, dokumentačná
karta pod čiaru (14) · `needs_key` a `missed` musia mať ROVNAKÚ vizuálnu váhu
(D8/D33b — žiadne delenie bannera) · „+ Nová kampaň" na dashboard · pomenované
sady produktov (tabuľka + API + picker) a „posledná sada" (12) · duplikovanie
kampane (12) · dátumové presety `od zajtra`/`1 mesiac`/`3 mesiace` ako rozšírenie
D12 (12) · inline „Naozaj?" pri odobraní z allowlistu (18) · dokončenie
onboardingu (`markOnboardingDone()`, D20) · zasadenie grafov od B2 do stránok
**Nesmie:** meniť `src/components/campaigns/**` (to je B3) ani CSS (B1).

### Vlny
1. **B1 sám** — tokeny a primitívy, na ktorých ostatní stavia.
2. **B2 · B3 · B4 paralelne.**

---

## 6. Rozhranie medzi agentmi (dohodnuté dopredu)

B1 vytvorí a ostatní používajú **bez toho, aby ich menili**:

```
CSS triedy:  .ovl-card .ovl-card--quiet .ovl-panel .ovl-note
             .ovl-badge .ovl-badge--{critical,attention,progress,good,idle}
             .ovl-num (tabulárne, nowrap) .ovl-mono
             .ovl-grid .ovl-w-wide .ovl-w-default .ovl-w-form
             .ovl-anim-in .ovl-stagger .ovl-shimmer
CSS tokeny:  --paper --surface --surface-solid --line --ink --dim
             --brand --brand-tint --gold
             --st-critical --st-attention --st-progress --st-good --st-idle
             --seq-teal-1 … --seq-teal-5   (sekvenčná rampa pre G2)
Komponenty:  <StatusBadge kind="…" />  <PriceHint …/>  <SelfWriteBadge …/>
             <Button disabledReason="…" />  <Table …/>  <Sparkline …/>? nie — grafy sú B2
```

B4 vytvorí a **B3 importuje**: `<ProductSetPicker onPick={(ids) => …} />`
z `src/components/product-sets/`. Kým neexistuje, B3 programuje proti tomuto
rozhraniu a nahlási to.

B2 vytvorí a **B4 zasadí do stránok**: `<CampaignTimeline/>` (G1),
`<DiscountDepth/>` (G2), `<AuditActivity/>` (G4) z `src/components/charts/`.

---

## 7. Zmeny rozhodnutí (jediné povolené)

| Rozhodnutie | Bolo | Je | Prečo |
|---|---|---|---|
| **D12** | presety 7/14/30 dní + do konca mesiaca | **rozšírené** o `od zajtra`, `1 mesiac`, `3 mesiace` | pôvodné zostávajú, len sa pridávajú |
| **D14** | „farebné badge" pre stavy | **naplánovaná = neutrál** | zelená označovala tri rôzne veci |
| **D70** | re-auth ak posledná autentifikácia > 15 min | **sudo okno 30 min, heslo raz** | to isté heslo sa zadávalo 2× na jeden zápis |

**Nemenia sa:** D4 a D7 (znenie zostáva na obrazovke aj v prístupnostnom strome,
len prestáva byť 7–9× zopakované), D6 (pruh zostáva trvalý a plný), D28
(prekryv zostáva blokovaný, mení sa len čitateľnosť a cesta von), D10, D13, D26,
D33b (tie sa naopak konečne doručia), a **žiadny invariant I1–I14**.
