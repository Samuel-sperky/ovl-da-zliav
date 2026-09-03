# Kontrakt — Aura Zľavy V6: dokončený dizajn

Vetvy: `feat/v6a-tokeny` → `feat/v6b-obrazovky` → `feat/v6c-brana`
Zadal: Samuel · Rozsah odsúhlasený 2. 9. 2026 (20 otázok, 5 dávok)

> **Hades nebol dostupný** (MCP server `hades` nepripojený, nástroje `mind_*`
> nedostupné), takže kontext o rodine Aura nie je z pamäte, ale **z disku** —
> `C:\Aura\aura-design`, `C:\Aura\aura-roadmap`, `C:\Aura\aura-kpi`. Všetko
> nižšie je čítané, nie zapamätané.

---

## 1. Prečo

V5 zjednotil, čo appka **hovorí**. Nezjednotil, ako **vyzerá**. Dnešný stav
zmeraný, nie odhadnutý:

| Vec | Stav |
|---|---|
| `src/app/globals.css` | **4055 riadkov**, 240 CSS premenných |
| Surový hex | **121** výskytov |
| `rgba()` | 0 (dobre) · `color-mix()` 47 (dobre) |
| Téma | len tmavá; svetlý režim neexistuje |
| UI primitíva | žiadna zdieľaná vrstva — každá obrazovka má vlastné `.ovl-*` triedy |
| Grafy | vlastné SVG, tri kópie pravidla osi, `PriceHistogram` mimo jednotného jazyka |
| Stavy | `ActionFailurePanel` + ad-hoc prázdne stavy |

## 2. Odkiaľ sa berie dizajn — a rozpor v odpovediach, ktorý treba pomenovať

Samuel odpovedal **„vlastný dizajn od nuly"** (dávka 1) a potvrdil to
**„naozaj všetko od nuly"** (dávka 2) — a potom si vyžiadal port **16 primitív,
5 stavových komponentov, `ChartCard`, `useChartTheme`, tokeny grafov aj
Recharts** z `aura-roadmap` (dávka 3).

Doslova čítané je to protiklad. Čítam to takto a **takto to platí, kým Samuel
nepovie inak**:

- **NEVIAZAŤ sa na `aura-design`.** To je zdieľaný sync balík pre päť appiek
  (`manifest.json` + `sync.mjs`, súbory nesú hlavičku *GENERATED FILE — do not
  edit here*). Tento repo sa doň **nepridáva**, bridge `--ovl-*` sa **nerobí**
  a jeho komponenty sa **nepreberajú**. Appka nebude pasívne dediť dizajn.
- **PREVZIAŤ z `aura-roadmap`** — sesterská Next.js appka s vyspelejšou
  vrstvou. Kód sa **skopíruje a vlastní TU**, bez `GENERATED` hlavičiek
  a bez sync-u. Odtiaľ „od nuly": vlastníme výsledok, nededíme ho.
- Breadcrumb sa **napíše tu** (Samuel ho chce, dávka 4), nie prevezme
  z `aura-design`.

Prakticky: `aura-design` sa nedotýkame vôbec, `aura-roadmap` je predloha.

### Čo `aura-roadmap` má (inventúra, čítaná z disku)

`src/components/ui/` — 25 primitív: `Avatar`, `Badge`, `BarList`, `Button`,
`Chip`, `ConfirmDialog`, `DeltaPill`, `Drawer`, `Field`, `Input`, `Modal`,
`PageHeader`, `Pagination`, `Panel`, `Pill`, `ProgressBar`, `Segmented`,
`Select`, `Skeleton`, `Spinner`, `StatCard`, `Table`, `Tabs`, `Toast`,
`Toolbar`.
`src/components/states/` — `EmptyState`, `ErrorState`, `ForbiddenState`,
`LoadingState`, `NoResultsState`.
`src/components/charts/` — `ChartCard`, `useChartTheme`; Recharts `^3.10.1`;
tokeny `--chart-1..8`, výšky `--chart-h`, `--chart-h-sm`; `ChartCard` má
`srSummary` (tabuľka pre čítačku — graf je pre asistenčné technológie
nevidteľný).
`src/app/globals.css.test.ts` — **statický kontraktový test** nad jediným
stylesheetom, s vetou *„toto sú dizajnové pravidlá, ktoré rodina stále ručne
porušuje, takže sú vynútené mechanicky"*.

## 3. Rozhodnutia (odsúhlasené 2. 9. 2026)

| # | Rozhodnutie | Dôvod |
|---|---|---|
| **D129** | Dizajn sa **portuje z `aura-roadmap`** a vlastní sa tu. `aura-design` sa nepoužije, bridge sa nerobí, sync sa nezavádza. | Rozklad rozporu v §2. Vlastníme výsledok; zmena v rodine nás neprepíše a naša zmena nerozbije rodinu. |
| **D130** | **Nová token vrstva** na začiatku `globals.css`: paleta → témy → tokeny grafov. Všetkých **121 hexov** sa prevedie na tokeny alebo `color-mix()`. Existujúce `.ovl-*` triedy sa naň len prepoja — vzhľad sa nemení, mení sa, odkiaľ berie farby. | Voľba Samuela. Prepísanie 4055 riadkov naslepo by zahodilo stovky rozhodnutí z piatich sprintov. |
| **D131** | **Tmavá aj svetlá téma, tmavá predvolená.** Každý token má hodnotu pre obe. | Voľba Samuela. Pri prevode 121 hexov je to jediný lacný moment; neskôr sa paleta prekopáva znova. |
| **D132** | **Prísny strážny test** nad `globals.css` (vzor `aura-roadmap`): žiadny surový hex mimo bloku tokenov · žiadne `rgba()` · žiadne `!important` · tóny len `color-mix()` · každý token definovaný pre obe témy. | Voľba Samuela. Repo má zapísané: *„čo test vyňal z kontroly, nestráži NIKTO"* — bez testu sa 121 hexov vráti. |
| **D133** | Portujú sa **štyri skupiny primitív** (16 komponentov): `StatCard`+`DeltaPill`+`BarList` · `Table`+`Pagination`+`Toolbar` · `Panel`+`PageHeader`+`Tabs`+`Segmented` · `Badge`+`Chip`+`Pill`+`ProgressBar`. | Voľba Samuela — všetky štyri. Pokrývajú KPI karty, tabuľky, rámec stránky aj tri kanály stavu. |
| **D134** | Portuje sa **všetkých päť stavových komponentov**. | Voľba Samuela. Táto appka má tretiu možnosť pri KAŽDOM čísle („nevieme"), takže jednotný spôsob, ako ju vykresliť, je tu cennejší než inde. |
| **D135** | **Grafy: `ChartCard` + `useChartTheme` + `--chart-1..8` + Recharts `^3.10.1`.** `PriceHistogram` a tri kópie pravidla osi sa zlúčia do jedného jazyka. | Voľba Samuela. Medzery sú v Rechartse prirodzené — `null` v riadku pretne líniu sám, takže I11 to neohrozí. Získame legendu, tooltip, responzivitu a `srSummary` hotové. |
| **D136** | **Prehľad:** riadok `StatCard` s `DeltaPill` hore, hlavný graf pod nimi, top/flop ako `BarList`. | Voľba Samuela. Číslo najprv, priebeh druhý. |
| **D137** | **Tabuľka Produktov: kompaktná** (~36 px riadok), **prilepená hlavička**, **prilepené prvé dva stĺpce** (referencia, názov). | Voľba Samuela. Pri 12 stĺpcoch a 41 348 riadkoch je to jediný spôsob, ako sa v tabuľke neztratiť. |
| **D138** | **Navigácia zostáva štvorpoložková**, pribudne **breadcrumb** pre pod-stránky Nastavení (napíše sa tu). | Voľba Samuela. Štyri položky sú správny počet; „← Nastavenia" povie, že cesta von existuje, ale nie kde si. |
| **D139** | **Primitíva vyhrávajú, `.ovl-*` odchádza s obrazovkou.** Každá prekopaná obrazovka prejde na primitíva a jej staré triedy sa ZMAŽÚ v tom istom kroku. | Voľba Samuela. „Migrujeme postupne" znamená dve sady natrvalo; strážny test vie overiť, že mŕtve CSV nezostalo. |
| **D140** | **Tri sprinty za sebou**, nie jeden beh: V6a tokeny a primitíva → V6b obrazovky → V6c verifikácia a brána. | Voľba Samuela. Limit session už dnes dvakrát zhodil celý beh; pri 40 agentoch naraz je to najpravdepodobnejší koniec. |
| **D141** | **Dôkaz dizajnu je Samuelov preklik.** Agenti dokazujú testami a statickým renderom; na konci dostane zoznam obrazoviek na preklik. | Voľba Samuela. Screenshoty vyžadujú zobrazený panel prehliadača a to sa dnes podarilo raz z troch pokusov — nebudem tvrdiť, že vyzerá dobre niečo, čo som nevidel. |

## 3b. Revízia po čítaní disku (2. 9. 2026, pred spustením V6a)

Kontrakt vyššie hovorí „portovať 16 primitív". Čítanie repa to musí opraviť,
lebo `src/components/ui/` **už existuje** a má 19 súborov:

```
ActionFailure  BudgetMeter  Button  Charts  Countdown  Drawer  EmptyState
ErrorMessage   Icon  LockBadge  Note  RunbookPanel  StatTile  StatusMark
StatusPill     ToneBadge  blocker-look  chart-language  primitives.module.css
```

Slepý port by teda vedľa `StatTile.tsx` postavil `StatCard.tsx`. Presne to
zakazuje docblock v `primitives.module.css`, ktorý si tento repo napísal sám:
*„druhá, takmer rovnaká sada tried by sa o mesiac rozišla s prvou"*.

| # | Rozhodnutie | Dôvod |
|---|---|---|
| **D142** | **Portuje sa TVAR a PRAVIDLO, nie súbor.** Kde miestny komponent existuje, `aura-roadmap` ho **rozšíri**, nevytvorí dvojníka. Deväť zlúčení: `StatTile`←StatCard · `StatusPill`←Pill · `ToneBadge`←Badge · `BudgetMeter`←ProgressBar · `Charts`+`chart-language`←ChartCard+useChartTheme · `ActionFailure`←ErrorState · `Button` · `Drawer` · `EmptyState`. **Štrnásť naozaj nových:** DeltaPill, BarList, Table, Pagination, Toolbar, Panel, PageHeader, Tabs, Segmented, Chip, LoadingState, NoResultsState, ForbiddenState, Breadcrumb. | Zlúčenie je práca, dvojník je dlh. Miestne komponenty nesú pravidlá tejto appky (tri kanály, priznania) a tie sa portom stratiť nesmú. |
| **D143** | **`aura-roadmap` nemá Tailwind** — primitíva stoja na semantických triedach v jednom 605-riadkovom `globals.css`. Tu ide vzhľad primitív do **CSS modulov vedľa komponentu** (`src/components/ui/*.module.css`), nie do `globals.css`. | Konvencia tohto repa už je taká (`primitives.module.css`, `zlavy.module.css`, `charts.module.css`) a je lepšia: triedy sú lokálne, takže sa nedá omylom prepísať cudzia obrazovka. Navyše dovoľuje agentom pracovať paralelne bez zápasu o jeden súbor. |
| **D144** | **Strážny test (D132) číta `globals.css` AJ všetky `*.module.css`.** | Následok D143: keby čítal len `globals.css`, hex by sa presunul do modulov a test by zostal zelený. To je presne pasca „čo test vyňal z kontroly, nestráži NIKTO". |
| **D145** | **`:root` nesie TMAVÉ tokeny, `:root[data-theme="light"]` ich prepisuje** — obrátene než `aura-roadmap`. | D131 hovorí, že tmavá je predvolená. Keby `:root` niesol svetlé, každý načítaný dokument by blikol svetlou, kým sa atribút nenastaví. |
| **D146** | **Žiadny `lucide-react`.** Ikonové propy portovaných komponentov berú `ReactNode`, nie `LucideIcon`; ikony dodá miestny `Icon.tsx`. | Nová závislosť len pre typ propu sa nevyplatí, keď repo má vlastný ikonový modul. |
| **D147** | **`rgba()` je povolená VÝHRADNE v bloku tokenov** (`--overlay`, `--shadow-*`), inde nikdy. Tónovanie iba `color-mix()`. | Repo má dnes 0 `rgba()` a 47 `color-mix()`. Presne to pravidlo má `aura-roadmap` a je vynútené testom — tu smie byť ešte prísnejšie, lebo sa nezačína z dlhu. |

Počet agentov V6a sa **nemení** (12): zlúčenia sú menej písania, ale viac
čítania, takže rozpočet je ten istý.

## 4. Čo je NEDOTKNUTEĽNÉ

Samuel označil štyri veci a **redizajn ich smie spraviť krajšími, nie
tichšími**:

1. **Priznania „nevieme"** — pomlčky, `≥` dolné hranice, vety o nesťahovaných
   dňoch. Jadro I11; celá appka na tom stojí.
2. **Dry-run a potvrdenie** (I3). Smie byť krajšie, nie kratšie ani menej
   výrazné.
3. **Pravidlo troch kanálov** — stav nesie farba + značka + slovo, nikdy len
   farba.
4. **Slovenské UI texty.** Portované komponenty prídu s anglickými textami
   a treba ich preložiť; názvy symbolov zostávajú anglické.

## 5. Rozsah NIE

- Informačná architektúra (čo na ktorej stránke patrí, koľko stránok má appka).
- `aura-design` ako sync target · bridge `--ovl-*` · piata oblasť „Analýza“ ·
  ikonový rail namiesto textovej navigácie · prepínač hustoty tabuľky.
- Mobil a tablet · CSV export · drill-down a pivot (zostávajú z V5 v „NIE").

## 6. Riziká

- **R1 — Recharts je nová závislosť.** Zabehnutá a udržiavaná, takže sa pridáva
  bez ďalšieho schvaľovania (globálne pravidlo), ale `npm audit` je povinný
  a kritické zraniteľnosti sa opravia v rámci behu.
- **R2 — `.ovl-*` sa maže po obrazovkách.** Ak sa trieda používa na dvoch
  obrazovkách a zmaže sa s prvou, druhá sa rozsype. Strážny test na mŕtve aj
  chýbajúce triedy je preto súčasťou D132, nie príloha.
- **R3 — svetlá téma nemá dnes ani jeden test.** Kým sa nepridá, môže byť
  „hotová" a nečitateľná. Kontrast je kritérium (K7), nie dojem.
- **R4 — appka je dnes bez dát.** `shop_write` kľúč chýba, KPI sú pomlčky.
  Nový dizajn sa preto MUSÍ navrhovať pre prázdny stav ako pre bežný, nie ako
  pre výnimku — inak bude vyzerať dobre len na snímkach.
- **R5 — 40 agentov v troch behoch je 6–8 M tokenov** (odvodené z merania:
  150–200 k na agenta v tomto repe). Je to najdrahší sprint doteraz.

## 7. Akceptačné kritériá

| # | Kritérium | Ako sa dokazuje |
|---|---|---|
| K1 | Token vrstva existuje; **0 surových hexov** mimo bloku tokenov | strážny test D132 |
| K2 | ~~Každý token má hodnotu pre tmavú aj svetlú tému~~ → **každý token, ktorý sa rozkladá na LITERÁLNU farbu, existuje v oboch témach; odvodený (`var()`, `color-mix()`) sa duplikovať NESMIE a téma-invariantný je vymenovaný** | strážny test |
| K3 | Strážny test zakazuje `rgba()`, `!important` a surový hex — a je mutačne overený | mutácia musí zčervenať |
| K4 | 16 primitív a 5 stavov existuje, má slovenské texty a **použité sú** (nie len portované) | grep volajúcich + testy |
| K5 | Jeden jazyk grafov: `ChartCard` nad všetkými, `PriceHistogram` v ňom, pravidlo osi na JEDNOM mieste | grep + test |
| K6 | Graf kreslí medzeru pri nesťahovanom dni (nie nulu) a má `srSummary` | test troch stavov |
| K7 | Kontrast textu ≥ 4,5:1 v OBOCH témach na každom tokene páru text/pozadie | vypočítaný test, nie oko |
| K8 | Tabuľka: prilepená hlavička, prilepené prvé dva stĺpce, ~36 px riadok | test + preklik |
| K9 | Breadcrumb na pod-stránkach Nastavení | test + preklik |
| K10 | **Štyri nedotknuteľné veci (§4) prežili** — priznania, dry-run, tri kanály, slovenčina | mutačne overené testy |
| K11 | Po každej prekopanej obrazovke NEZOSTALO mŕtve `.ovl-*` CSS | strážny test |
| K12 | Celý balík zelený, žiadny nový `.skip`, beh v izolácii | výstup v reporte |
| K13 | `npm audit` bez kritických | výstup |
| K14 | Samuel preklikol a potvrdil | jeho slovo, nie moje |

## 8. Plán 40 agentov v troch behoch

Effort je stupňovaný zámerne: **`low`** na mechanický port a preklad textov,
**default** na logiku a obrazovky, **`high`** len tam, kde inteligencia
rozhoduje — návrh token vrstvy, adversariálna verifikácia, brána a review.

### V6a — tokeny a primitíva (12 agentov, ~1,5–2 M)

| # | Agent | Effort |
|---|---|---|
| 1 | Token vrstva: paleta, dve témy, tokeny grafov (D130, D131) | **high** |
| 2 | Prevod 121 hexov na tokeny | default |
| 3 | Strážny test `globals.css` (D132) + mutačné overenie | **high** |
| 4 | Kontrastný test oboch tém (K7) | default |
| 5 | Port `StatCard`+`DeltaPill`+`BarList` | default |
| 6 | Port `Table`+`Pagination`+`Toolbar` | default |
| 7 | Port `Panel`+`PageHeader`+`Tabs`+`Segmented` | default |
| 8 | Port `Badge`+`Chip`+`Pill`+`ProgressBar` | default |
| 9 | Port 5 stavových komponentov (D134) | default |
| 10 | `ChartCard`+`useChartTheme`+Recharts+`npm audit` (D135) | default |
| 11 | Breadcrumb (D138) — píše sa tu | **low** |
| 12 | Preklad všetkých portovaných textov do slovenčiny (§4) | **low** |

*Brána V6a: typecheck, lint, celý balík, strážny test zelený. Commit.*

### V6b — obrazovky (16 agentov, ~2,5–3,5 M)

| # | Agent | Effort |
|---|---|---|
| 13–15 | Prehľad: KPI riadok · hlavný graf · top/flop `BarList` (D136) | default ×3 |
| 16–18 | Produkty: tabuľka (D137) · filtre · detail panel | default ×3 |
| 19–21 | Zľavy: zoznam · detail so zoznamom produktov · timeline | default ×3 |
| 22–23 | Nová zľava: sprievodca · dry-run a potvrdenie (§4 bod 2) | default ×2 |
| 24–26 | Nastavenia: rozcestník + breadcrumb · pod-stránky · Poistky | default ×3 |
| 27 | Zlúčenie troch kópií pravidla osi + `PriceHistogram` (K5) | default |
| 28 | Mazanie mŕtveho `.ovl-*` po obrazovkách (D139, K11) | **low** |

*Brána V6b: typecheck, lint, celý balík. Commit.*

### V6c — verifikácia, brána, review (12 agentov, ~2–2,5 M)

| # | Agent | Effort |
|---|---|---|
| 29 | Verif: **nedotknuteľné §4** — prežili priznania, dry-run, tri kanály? | **high** |
| 30 | Verif: I11 cez celú cestu v novom dizajne | **high** |
| 31 | Verif: I3 — dry-run a potvrdenie nedotknuté | **high** |
| 32 | Verif: kvalita testov (mock bez exportu, fixture, grep-testy) | **high** |
| 33 | Verif: wiring — sú primitíva naozaj použité, alebo len portované? | **high** |
| 34 | Verif: prístupnosť — kontrast, tri kanály, `srSummary`, klávesnica | default |
| 35 | Verif: mŕtve CSS a nepoužité primitíva | **low** |
| 36 | Verif: pravdivosť textov po redizajne | **low** |
| 37 | Zelená brána + mutačné overenie K3 a K10 | **high** |
| 38 | Review + security | **high** |
| 39 | `CLAUDE.md` + README | **low** |
| 40 | Kontrakt §9 Výsledok + zoznam obrazoviek na preklik (D141) | **low** |

**Súčet: 40 agentov · 6–8 M tokenov · 9 `high`, 6 `low`, 25 default.**

## 9. Výsledok

### V6a — tokeny a primitíva (2. 9. 2026, 12/12 agentov, 2,84 M tokenov)

**Zmerané, nie prevzaté z reportu:** `npm run typecheck` a `npm run lint`
čisté, **223 súborov / 4613 testov zelených v izolácii** (pred sprintom
212/4106, teda **+11 súborov a +507 tvrdení**). Žiadny iný vitest nebežal,
takže beh je dôkaz.

| K | Stav | Ako som to overil SÁM |
|---|---|---|
| K1 | **áno** | vlastný parser: **0 surových hexov** mimo `:root` blokov, **0 `rgba()`** mimo tokenov |
| K2 | **áno, po oprave kritéria** | pozri nižšie — kritérium bolo hrubšie než implementácia |
| K3 | **áno** | **vlastná mutácia**, nezávislá od agentovej: hex v `ui/kpi.module.css` → padne pravidlo 1; `!important` → padne pravidlo 3. Vždy **1 z 26**, nie plošne. To potvrdzuje D144 — test naozaj číta moduly, nie len `globals.css` |
| K5 | ~~čiastočne~~ **toto tvrdenie bolo NEPRAVDIVÉ** | `ChartCard` + `useChartTheme` stáli, ale „tri kópie pravidla osi zlúčené" som prevzal z reportu agenta a **neoveril**. Zlúčená nebola ani jedna: na `8f5200b` mali `sales-view.ts` aj `price-bins.ts` rebrík `[1, 2, 5, 10]` stále u seba. Zmerané v V6b. |
| K7 | **áno** | 2034 párov v tmavej, 1999 v svetlej; najhoršie **4,89 : 1** (tmavá) a **4,79 : 1** (svetlá); tri tokeny opravené, nie test |
| K13 | **áno** | `recharts ^3.10.1` pridaný, `lucide-react` NIE (D146) |

**K2 bolo napísané príliš nahrubo a implementácia je lepšia než kritérium.**
Zo 151 tokenov v tmavej je 64 prepísaných vo svetlej a 87 nie — ale rozbor
ukázal, že to je správne: **31 je odvodených** cez `var()` (tému dedia samy,
duplikát by bol chyba), **48 sú rozmery, časy a písma** (téma-invariantné
z povahy) a **8 literálnych farieb** je zámerne téma-invariantných —
`--gold-fill`, `--gold-line`, `--brand-fill`, `--brand-fill-hover`,
`--on-gold`, `--on-brand-fill` a dva čierne operandy tónovania. Presne tú
istú výnimku má `aura-roadmap` napísanú v komentári. Kritérium je preto
prepísané, nie odškrtnuté.

**Čo agenti pridali nad kontrakt a je to správne:** `UnmeasuredState.tsx`
ako **šiesty** stavový komponent. D134 hovoril o piatich, ale táto appka má
tretiu možnosť pri každom čísle a rozdiel medzi „nič tu nie je" a „nemerali
sme to" si vlastný stav zaslúži. Ponechané.

**Chyba, ktorú našlo overenie drôtovania, nie testy:** `layout.tsx` mal
docblock „Téma: SVETLÁ je predvolená", pravdivý pred obrátením tém a prežil
ho — kým `theme.ts` aj `globals.css` hovoria tmavá. Tá istá trieda chyby ako
UTC docblock v `src/db/pool.ts`. Opravené ručne. `theme.ts` si pritom sám
všimol pascu, ktorú kontrakt nepomenoval: po obrátení tém znamená *zmazanie*
atribútu „vždy tmavá", takže bootstrap musí `light` stampovať výslovne, inak
človek so svetlým OS dostane tmavú appku bez toho, aby si o ňu povedal.

### V6b — obrazovky (2. 9. 2026, 5 behov, 27 agentov, 4,10 M tokenov)

**Zmerané:** `npm run typecheck`, `npm run lint`, `npm run check-compose-bind`
čisté, **235 súborov / 4865 testov zelených v izolácii** (pred V6b 224/4640).

Beh sa **trikrát rozpadol na session limite** (1,89 M tokenov bez výsledku).
Rozpracovaná práca sa vždy zachránila zo stromu, nie zahodila — raz ako
zámerne červený záchytný commit (`ba8333b`).

| K | Stav | Ako som to overil SÁM |
|---|---|---|
| K4 | **áno** | primitíva sú POUŽITÉ, nie len portované; drôtovanie `KpiRow` overené mutáciou (odpojenie vykreslenia pri ponechanom importe zhodí 6 tvrdení) |
| K5 | **áno** | tri kópie → **jedno telo**; vlastná mutácia: štvrtá kópia rebríka zhodí presne 1 z 35 |
| K6 | **áno** | nesťahovaný deň = medzera, nameraná nula = nula |
| K8 | **áno** | tabuľka kompaktná, prilepená hlavička, prilepené prvé dva stĺpce |
| K9 | **áno** | breadcrumb + test, že KAŽDÝ odkaz rozcestníka vedie na existujúcu routu |
| K10 | **áno** | štyri brány `confirmed: true` nedotknuté — ani jeden z tých route súborov nie je v diffe |
| K11 | **áno** | 21 mŕtvych tried: 19 zmazaných, 2 opravené |
| K12 | **áno** | 235/235 · 4865/4865 v izolácii, žiadny nový `.skip` |

**Najdôležitejší nález sprintu a bola to MOJA chyba.** Záchytný commit
`ba8333b` prepol `NewDiscount.tsx` na `new-discount.module.css` a nechal
v JSX staré mená: **11 z 15 kľúčov v module nebolo**, takže sprievodca bol
v prehliadači jeden stĺpec neoštýlovaného textu (`class="undefined"`). To je
celé „neviem vytvoriť zľavu". **Overil som ten commit typecheckom, lintom aj
celým balíkom a ohlásil všetky tri čisté — ani jedno to nemalo ako zachytiť**,
lebo vitest rieši `.module.css` Proxy-om, ktorý na každý kľúč vráti hash.
Pasca je v `CLAUDE.md`; strážca `css-moduly-strazca.spec.ts` teraz kryje
**všetkých 17 modulov v oboch smeroch** (44 tvrdení) a je mutačne overený na
dvoch rôznych moduloch (2 z 44, nie plošne). Tá istá príčina zhodila aj pole
na meno presetu — `.presetInput` namiesto `:global(.inp)`.

**Druhá vec, ktorú som prevzal a neoveril:** K5 vyššie. Report V6a tvrdil
zlúčenie troch kópií osi; nebolo. Staré tvrdenie navyše **porovnávalo klon
s klonom**, takže rovnaký preklep v oboch by prešiel. Nahradené ručnou
tabuľkou 25 očakávaní + statickou závorou — a tá tabuľka hneď odhalila, čo
tri klony spolu tajili: `chartScaleMax(0.4)` je **0,5**, nie 1.

**Rozhodnutia, ktoré agenti urobili správne a proti pohodlnému riešeniu:**
časová os Zliav zostala **tabuľkou** (okno platnosti nemeria veličinu, ale
interval — Gantt by bola štvrtá forma v šatách druhej); histogram sa stal
**stĺpcom** bez rozšírenia `CHART_KINDS` (nakrájané pásma sú položky, takže
je to porovnanie); a stav v **bunkách** tabuliek sa na `ToneBadge` zámerne
NEPREVIEDOL, lebo by to bol druhý vykresľovač stavu na jednej obrazovke.

**Otvorené do V6c:** K7 v novom rozvrhu (kontrast bol meraný na V6a
tokenoch), K14 (preklik), mutačné overenie K3 a K10, a `shop_write` kľúč
stále chýba (P0).

<!-- V6a otvorene body -->
**Otvorené do V6b:** obrazovky ešte primitíva nepoužívajú (K4 je „existujú",
nie „sú použité"), `.ovl-*` sa zatiaľ nemazalo (K11), a K8/K9/K12/K14
čakajú na V6b a preklik.

### V6c — verifikácia, brána, dokumentácia (3. 9. 2026, 12 agentov)

Základ behu: `3469b41` — **235 súborov / 4865 testov zelených v izolácii**,
`typecheck`, `lint`, `check-compose-bind` čisté. Brána V6c uzavrela commit
`178261d`.

Kritériá K1–K14 po poriadku. Kde je stav „áno", je napísané ČÍM sa dokázal;
kde nie, je napísané NESPLNENÉ a prečo — kritérium sa neprepisuje, aby vyšlo.

| K | Stav | Čím sa to dokázalo |
|---|---|---|
| K1 | **áno** | `dizajn-tokeny-strazca.spec.ts`: 0 surových hexov a 0 `rgba()` mimo blokov so značkou `@tokens:*`. Tokenový blok nie je „hocijaký `:root`" — súbor ich má šesť a aliasová vrstva `--ovl-*: var(…)` medzi ne nepatrí, inak by sa hex smel schovať o 400 riadkov nižšie. |
| K2 | **áno, s prepísaným kritériom** | Pôvodné znenie („každý token v oboch témach") bolo hrubšie než implementácia a je preškrtnuté v §7. Duplikuje sa len token, ktorý sa rozkladá na LITERÁLNU farbu; 31 odvodených cez `var()` tému dedí samo, 48 sú rozmery/časy/písma a 8 literálnych je zámerne téma-invariantných. |
| K3 | **áno, mutačne** | Brána spustila **päť vlastných mutácií** nezávislých od agentových: hex do `globals.css` mimo tokenového bloku, hex do `ui/kpi.module.css`, `rgba()` do modulu, `!important`, a token bez svetlého páru. Každá zhodila **presne 1 z 28** tvrdení — teda konkrétne pravidlo, nie plošne súbor. To potvrdzuje D144: test naozaj číta moduly, nie len `globals.css`. |
| K4 | **áno** | Primitíva sú POUŽITÉ, nie len portované — `Overview.tsx`, `CatalogPanel/Table/Filters.tsx`, `DiscountsList.tsx`, `NewDiscount.tsx` a `SettingsIndex/SubPage.tsx` importujú z barrelu `@/components/ui`. Drôtovanie `KpiRow` overené mutáciou (odpojenie vykreslenia pri ponechanom importe zhodí 6 tvrdení) — test teda stráži DRÔT, nie import. |
| K5 | **áno** (v V6a bolo toto tvrdenie NEPRAVDIVÉ, pozri vyššie) | Tri kópie rebríka `[1, 2, 5, 10]` → **jedno telo** `chartScaleMax()`; `niceCeiling()` a `niceCount()` sú zmazané a na ich mieste stojí komentár, čo tam bolo. Hodnoty sú pribité na vlastnú tabuľku 25 očakávaní (nie na druhú implementáciu) a štvrtú kópiu zastaví statická závora — mutácia: štvrtá kópia zhodí presne 1 z 35. |
| K6 | **áno** | Nesťahovaný deň = medzera, nameraná nula = nula. Rozšírené 3. 9. 2026 na **štyri stavy dňa** (`trzba-styri-stavy-dna.spec.ts`): hodnota · nameraná nula `0.00` · dolná hranica `≥` · medzera. Route posielala `dayStates`, `emptyDays` aj `measuredZeroDays` už predtým — klient ich zahadzoval, čo bol I11 naopak (appka mala priznanie a nevyslovila ho). `srSummary` je na `ChartCard`. |
| K7 | **ČIASTOČNE — a širšie zapísané, než čo sa meria** | `dizajn-kontrast.spec.ts` prechádza SÚBORY sám (`globals.css` + každý `*.module.css` chôdzou po `src/`), takže moduly z V6b meria bez dopisovania zoznamu, a od 3. 9. 2026 číta aj `fill:`/`stroke:`, takže popisky osi grafu už merané SÚ. Merané v oboch témach, najhoršie `4,89 : 1` (tmavá) a `4,79 : 1` (svetlá); tri tokeny sa opravili, test nie. **ALE PLOCHY sú ručný zoznam** (`plochy()`): menuje štyri (`--paper`, `--surface-raised`, `--sel`, `--surface-solid`) plus počítané závoje, kým štýly používajú **33 rôznych pozaďových tokenov** — verifikátor prístupnosti ich našiel 26 (tmavá) / 27 (svetlá) a **sedem z nich nesie text a merané nie je**. Text na tých siedmich plochách nestráži NIKTO okrem Samuelovho prekliku (K14). Pôvodné znenie tohto riadku hovorilo „páry si NEVYMÝŠĽA" — pravdivé o súboroch, nepravdivé o plochách. |
| K8 | **áno** | Tabuľka kompaktná (~36 px riadok), prilepená hlavička, prilepené prvé dva stĺpce. Preklik zostáva na Samuelovi (K14). |
| K9 | **áno** | Breadcrumb na piatich pod-stránkach Nastavení + test, že KAŽDÝ odkaz rozcestníka vedie na existujúcu routu. Ten test má dôvod: mesiac sa v rozcestníku ponúkal odkaz do prázdna po zmazanom `SignOut.tsx`. |
| K10 | **áno, mutačne** | Štyri brány `confirmed: true` nedotknuté — ani jeden z tých route súborov nie je v diffe V6. Brána V6c pridala **vlastné mutácie na všetky štyri nedotknuteľné veci** (§4): priznania, dry-run, tri kanály, slovenčina. |
| K11 | **áno** | 21 mŕtvych `.ovl-*` tried: 19 zmazaných, 2 opravené. Nový strážca `css-moduly-strazca.spec.ts` kryje **všetkých 17 CSS modulov v OBOCH smeroch** (použitý kľúč musí mať pravidlo; deklarovaná trieda musí mať volajúceho), 44 tvrdení, mutačne overený na dvoch rôznych moduloch (2 z 44, nie plošne). |
| K12 | **áno — ale dokázala to brána, nie ja** | 235/235 súborov a 4865/4865 tvrdení zelených v izolácii je zmerané na `3469b41`; brána V6c to zopakovala nad `178261d` a pridala +63 tvrdení. Ja (agent 40) mám plošný beh zakázaný, takže to číslo **preberám z brány a hovorím to nahlas** — presne ten druh prevzatia, ktorý v tomto sprinte už raz vyrobil nepravdivé tvrdenie (K5 v V6a). Žiadny nový `.skip`, `.todo` ani `.only`. |
| K13 | **áno** | `recharts ^3.10.1` pridaný, `npm audit` bez kritických, `lucide-react` NIE (D146). |
| K14 | **NESPLNENÉ — čaká na Samuela** | Toto kritérium agent splniť NEVIE a nemá sa ako preškrtnúť. Zoznam obrazoviek na preklik je v §10 (D141). **Svetlú tému doteraz nikto nevidel okom** — má zmeraný kontrast, nie odklikanie. |

**Nález, ktorý hlásim ako nález, nie ako chybu:** `test/unit/product-label.spec.ts`
a `zlavy-timeline.spec.ts` porovnávajú pomlčku „nevieme" **klón s klónom**
(`toBe(NEVIEME)`), takže samotný ZNAK nestrážia — zmerané mutáciou
(`NEVIEME = '?'` ich oba nechá zelené). Chybou to nie je: literálnu pomlčku
pripína `prehlad-v4.spec.ts` a `trzba-styri-stavy-dna.spec.ts`. Slovník teda
strážený JE, len nie v tých dvoch súboroch. Nechané tak zámerne — prepisovať
cudzie zelené testy nad rámec zadania je rozbitý rozsah.

## 10. Čo preklikať (D141)

Appka beží na `http://localhost:3070` — **`localhost`, nie `127.0.0.1`**
(HSTS, dôvod je v README). Prihlásenie neexistuje: otvoríš adresu a si vnútri.

**Najprv prečítaj toto, inak budeš hlásiť ako chyby veci, ktoré chybami
nie sú.** Appka je dnes **bez `shop_write` kľúča** a **IP je zabanovaná
shopom**. Priamy dôsledok na KAŽDEJ obrazovke:

- **KPI a stĺpce z obohateného katalógu sú POMLČKY** (cena, marža, sklad,
  predané). Pomlčka je odpoveď „nevieme", nie prázdne miesto a nie nula.
- **Obohacovanie sa nespustí.** Otvorenie strany Produktov nič nedotiahne;
  dávka sa zastaví s dôvodom (`no_key`, `ip_banned`) a nemá to byť ticho.
- **Účinnosť zliav je podmienená** — bez histórie objednávok dostane
  priznanie namiesto čísla (I11).
- **Grafy budú mať šrafované plochy a medzery.** Šrafovanie znamená vo
  všetkých formách to isté: „toto sme nemerali".

Toto nie je chyba dizajnu — je to dizajn navrhnutý pre prázdny stav (riziko R4).
Chyba je, keď appka na prázdne miesto napíše **nulu**, **odhad** alebo
**nič** namiesto pomlčky a vety.

**Prepínač témy** je okrúhle tlačidlo **úplne vpravo v hlavičke**, na každej
obrazovke. V tmavej téme ponúka slnko, v svetlej mesiac. **Svetlá téma nebola
NIKDY videná okom** — má vypočítaný kontrast (najhorší pár 4,79 : 1), nie
preklik. Prejdi prosím všetkých päť obrazoviek dvakrát, raz v každej téme;
prvý pohľad na svetlú tému bude Tvoj.

---

### 1. Prehľad — `http://localhost:3070/`

**Čo tam má byť:** riadok KPI kariet hore (`StatTile` s `DeltaPill` — číslo,
pod ním zmena), pod nimi hlavný graf tržby s prepínačom okna, a top/flop
produkty ako vodorovné pásy (`BarList`). Ďalej stavový pás, bežiace zľavy
a poistky.

**Čo je NOVÉ oproti stavu pred V6:** poradie „číslo najprv, priebeh druhý"
(D136) — KPI riadok je hore, nie pod grafom. Graf je Recharts pod `ChartCard`:
má legendu, tooltip pri prejazde myšou a responzivitu, ktoré vlastné SVG
nemalo. Top/flop sú pásy, nie tabuľka. A **deň tržby má štyri stavy** —
prečítaný deň bez objednávky ukáže `0.00` a nameranú nulu, kým nesťahovaný
deň ukáže medzeru; do 3. 9. 2026 oba mizli rovnako.

**Čo NEUVIDÍŠ a prečo:** väčšina KPI bude pomlčka (chýba kľúč), tržba bude
mať dva prečítané dni zo 180 a zvyšok medzeru, a top/flop môžu byť takmer
prázdne — predaje za okno appka vo väčšine prípadov nepozná (D121). Číslo
s nepokrytým oknom nesie `≥` — je to dolná hranica, nie fakt.

### 2. Produkty — `http://localhost:3070/produkty`

**Čo tam má byť:** kompaktná tabuľka (riadok ~36 px), **hlavička zostane
prilepená pri rolovaní** a **prvé dva stĺpce (referencia, názov) pri rolovaní
doprava**. Nad tabuľkou lišta s hľadaním a filtrami ako naklikané čipy;
zamknuté filtre (kategória, kov, typ šperku) sú **viditeľne zamknuté**, nie
skryté. Klik do riadku otvorí bočný panel s detailom produktu.

**Čo je NOVÉ:** prilepená hlavička a dva prilepené stĺpce (D137) — pri 12
stĺpcoch a 41 348 riadkoch je to celý rozdiel medzi použiteľnou a
nepoužiteľnou tabuľkou. Tabuľka je primitívum `Table` + `Pagination`, nie
vlastné `.ovl-*` triedy, takže vyzerá rovnako ako tabuľky na iných
obrazovkách.

**Čo NEUVIDÍŠ a prečo:** cena, marža, sklad a predané budú **pomlčky** — bez
`shop_write` kľúča neexistuje `product:read`, z ktorého `getFull` ide.
Otvorenie strany nespustí obohatenie. Veta pod tabuľkou má POVEDAŤ ČÍSLOM,
prečo tie riadky majú pomlčky; keby mlčala alebo tam bola nula, to je chyba.

### 3. Zľavy — `http://localhost:3070/zlavy`

**Čo tam má byť:** zoznam zliav so stavom (pripravená / beží / skončila).
Stav nesie **farbu + značku + slovo**, nikdy len farbu. Rozkliknutie zľavy
(`/zlavy/<id>`) dá detail so zoznamom produktov v nej a s časovou osou.

**Čo je NOVÉ:** jednotný rámec stránky (`PageHeader`, `Panel`, `Toolbar`) a
tabuľka z tej istej sady stĺpcov ako Produkty. **Časová os zostala TABUĽKOU
zámerne** — okno platnosti nemeria veličinu, ale interval, a Gantt by bol
štvrtá forma grafu v šatách druhej. Ak Ti tam graf chýba, je to rozhodnutie,
nie zabudnutie.

**Čo NEUVIDÍŠ a prečo:** účinnosť zľavy bude priznanie namiesto čísla — bez
histórie objednávok ju nie je z čoho počítať, a `orders_read` kľúč je
neoverený.

### 4. Nová zľava — `http://localhost:3070/zlavy/nova`

**Čo tam má byť:** sprievodca po krokoch — výber produktov, pásma s
percentami, trvanie — a na konci **skúška naprázdno a potvrdenie**. Dva kroky,
výrazne, nie jedno tlačidlo.

**Čo je NOVÉ:** táto obrazovka bola 2. 9. 2026 v prehliadači **jeden stĺpec
neoštýlovaného textu** — prepnutý import CSS modulu nechal v JSX staré mená a
11 z 15 kľúčov v module neexistovalo (`class="undefined"`). Typecheck, lint
ani 4651 testov to nemali ako zachytiť. **Toto je obrazovka, ktorú prosím
preklikni najpozornejšie** — a to isté platí pre pole na meno presetu, ktoré
malo tú istú príčinu. Ak vidíš niekde stĺpec surového textu, je to presne ten
jav a chcem to vedieť.

**Čo NEUVIDÍŠ a prečo:** výber produktov bude pracovať s pomlčkami namiesto
marže a predajnosti, takže pásma podľa predajnosti budú takmer prázdne —
produkt s neznámym predajom sa do pásma **nezaradí vôbec** (D121,
fail-closed). Prázdne pásmo je správna odpoveď, nie chyba. Skúška naprázdno
prebehne, zápis do shopu bez kľúča neprejde.

### 5. Nastavenia — `http://localhost:3070/nastavenia`

**Čo tam má byť:** rozcestník s kartami a päť pod-stránok:
`/nastavenia/napojenie` (na čo je appka napojená) · `/nastavenia/co-smie` ·
`/nastavenia/co-vie` · `/nastavenia/historia` · `/nastavenia/cervena-zona`
(poistky a panic button). Na KAŽDEJ pod-stránke je vľavo hore **breadcrumb
„← Nastavenia"**.

**Čo je NOVÉ:** breadcrumb (D138) — pred V6 z pod-stránky nebolo vidieť, že
cesta von existuje. Test navyše overuje, že každý odkaz rozcestníka vedie na
existujúcu routu; mesiac tu bol odkaz do prázdna.

**Čo NEUVIDÍŠ a prečo:** stav kľúča bude `present: false` a stav napojenia
povie, že shop odmieta volania (`ip_banned`). Obe sú pravdivé hlásenia stavu,
nie chyby obrazovky. **V červenej zóne nič nepotvrdzuj len tak** — sú tam
uvoľňujúce akcie za `confirmed: true` a panic button.

---

**Ako to hlásiť, aby to bolo použiteľné:** adresa · téma (tmavá/svetlá) · čo
si videl · čo si čakal. Zvlášť ma zaujíma každé miesto, kde appka namiesto
pomlčky napíše **nulu** alebo **nič** — to je jediná trieda chyby, ktorú tento
sprint vedel vyrobiť potichu.
