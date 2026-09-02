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
| K2 | Každý token má hodnotu pre tmavú aj svetlú tému | strážny test |
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

_(dopĺňa sa počas sprintov)_
