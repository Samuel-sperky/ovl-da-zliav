# 31 — UI audit a návrh vizuálneho redizajnu (Aura Zľavy)

**Rola:** UI/vizuálny dizajnér. **Rozsah:** výhradne vizuálna vrstva — tokeny,
typografia, hierarchia, farebná sémantika, tabuľky, formuláre, mobil.
**Nič v tomto dokumente nie je implementované.** Žiadny kód ani CSS nebol
zmenený; dokument je vstup pre rozhodnutia a až potom pre implementačnú úlohu.

**Podklady:** snímky `screenshots/01…13`, `src/app/globals.css` (356 riadkov,
jediný zdroj štýlov), `src/components/layout/**`, `src/components/ui/**`,
`docs/10-KONTRAKT.md` § B (D1–D20) a § H (I1–I14).

**Východiskový stav v jednej vete:** appka je funkčne kompletná a jej *obsahová*
disciplína (priznávanie neistoty, povinné disclaimery, dvojkrok) je nadpriemerná
— ale vizuálne je to nebrandovaný utilitárny HTML dokument s jednou generickou
modrou, jednou svetlou paletou, nulovým štýlovaním formulárových prvkov a
plochou hierarchiou, v ktorej má dokumentačná karta rovnakú váhu ako stav
produkčného kľúča.

**Dobrá správa pre riziko redizajnu:** e2e ani unit testy sa neopierajú o CSS
triedy ani farby — kotvia sa výhradne na `data-testid` a `data-state`
(`test/e2e/readonly-after-expiry.spec.ts:24`). Prepis `globals.css` a
pretriedenie komponentov je preto testovo bezpečné; jediné, čo redizajn ohrozuje,
sú rozhodnutia D4/D5/D6/D7/D13/D14 — tie sú vypísané v poslednej sekcii.

---

## Prehľad zistení podľa priority

| Priorita | Zistenia | Charakter |
| --- | --- | --- |
| **P1** — brand, čitateľnosť, bezpečnosť | V1, V2, V4, V7, V8, V18, V20, V23, V28, V29 | appka vyzerá ako cudzia; farebná sémantika si protirečí; dáta sa lámu; formuláre sú natívne |
| **P2** — hierarchia, hustota, dôveryhodnosť | V3, V5, V6, V9, V11, V12, V13, V15, V16, V17, V19, V21, V22, V25, V26, V30, V31, V32, V35 | nič nevedie oko; opakovanie povinných viet ich devalvuje; drobné vizuálne chyby |
| **P3** — dolaďovanie a mobil | V10, V14, V24, V27, V33, V34, V36, V37, V38, V39 | údržba, mobilná použiteľnosť, konzistencia |

---

## Zistenia

### A. Brand a zjednotenie s rodinou Aura

#### V1 — Appka neobsahuje ani jeden prvok vizuálneho jazyka rodiny

**Dôkaz:** `globals.css:8–30` — celá paleta je `#f6f7f9 / #ffffff / #17181c /
#1f4fd8`. Žiadna teal, žiadna gold, žiadny paper, žiadna koruna, žiadny eyebrow.
Na snímkach 01–13 je hlavička biela s čiernym textom a modrými tlačidlami.

**Dopad:** appka sa nedá vizuálne priradiť k rodine (KPI, Logistika, Roadmap,
Marketing, Tržby, HR). Pri prepínaní medzi appkami stráca používateľ
kontinuitu — a najmä stráca dôveru, že ide o „ten istý“ nástroj s tou istou
disciplínou.

**Riešenie:** dvojvrstvová sada tokenov (viď sekcia *Navrhovaná sada tokenov*):
`--aura-*` = nemenné primitívy rodiny, `--ovl-*` = sémantické tokeny appky,
ktoré na ne mapujú. Existujúce názvy `--ovl-*` zostanú **beze zmeny**, takže
komponenty netreba prepisovať — mení sa len ich hodnota.
Konkrétne minimum pre „patrí do rodiny“:
plná teal lišta hlavičky `background: var(--aura-teal-700)` (#03797E) s bielym
wordmarkom, `♛` v `--aura-gold-500` (#D8B878), 1px gold hairline
`border-bottom: 1px solid var(--aura-gold-600)` (#C9A869) pod lištou, nadpisy
kariet ako gold eyebrow, Inter.

#### V2 — Primárna farba `#1f4fd8` je v rodine cudzia a nesie ju každá akcia

**Dôkaz:** `globals.css:15` `--ovl-accent: #1f4fd8`; `.ovl-btn--primary` na
snímkach 01 („Prihlásiť sa“), 02 („Uložiť doménu“, „Uložiť kľúč“), 04 („+ Nová
kampaň“, aktívny filter „všetky“), 06/07 („Pokračovať na dry-run“, aktívny čip
„15 %“), 09 („Pridať produkt“), 11 („Uložiť doménu“, „Rotovať kľúč“).

**Dopad:** modrá je v tejto appke jediná chromatická plocha okrem stavových
farieb, takže nesie 100 % „akčnosti“ — a pritom nekomunikuje nič o brande.
Zároveň je vizuálne blízka odkazovej modrej, ktorú appka nepoužíva (`a { color:
inherit }`), takže sa naopak modrým pôsobia veci, ktoré odkazmi nie sú.

**Riešenie:** `--ovl-accent: var(--aura-teal-700)` (#03797E, kontrast na bielej
5,27:1 — vyhovuje AA aj pre normálny text), hover `--aura-teal-900` (#025C60),
`--ovl-accent-fg: #ffffff`. V darku výplň zostáva #03797E, ale **text a odkazy**
prechádzajú na `--aura-teal-400` (#05BCC4) — #03797E má na `#0E1413` kontrast
len 3,53:1 (nevyhovuje pre bežný text, len pre veľký text a okraje komponentov).

#### V3 — Žiadny fontový projekt: `system-ui`, nikde tabulárne číslice na úrovni tela

**Dôkaz:** `globals.css:26` `--ovl-font: system-ui, …`. Tabulárne číslice sú
zapnuté len na dvoch miestach (`.ovl-num`, `.ovl-product-price`) — teda ceny na
dashboardových kartách áno, ale dátumy v stĺpci „Okno“, časy v audite a percentá
v texte nie.

**Dopad:** appka vyzerá ako nestylovaný dokument (na Linuxe dokonca DejaVu
Sans — presne to je na snímkach); čísla v tabuľkách sa nezarovnávajú
opticky, čo je pri cenách a dátumoch najhoršie možné miesto.

**Riešenie:** Inter ako `--ovl-font`, `--ovl-mono` pre kódy a ID.
Fonty **self-hostovať** ako `public/fonts/Inter-{400,600,700}.woff2` +
`@font-face` v `globals.css`. Dôvody: (a) `package.json` sa podľa O7 nesmie
meniť — `next/font` novú závislosť nepridáva, ale `next/font/google` ťahá súbory
zo siete v build stage, čo je pri lokálnej appke bezdôvodná závislosť;
(b) `public/` sa už do image kopíruje (`Dockerfile:35`).
**Povinné:** subset `latin-ext`, inak sa rozbijú `ľ ť ž ô č š ý á í é ú ä ó ŕ`.
Na body: `font-feature-settings: 'cv05' 1;` (l s chvostíkom, lepšie odlíšenie od
1/I) a `font-variant-numeric: lining-nums`. Na všetky číselné/dátumové/peňažné
buňky `tabular-nums` (viď V23, V24).

#### V4 — Brandové akcenty kolidujú so stavovými farbami (najzávažnejšia farebná chyba)

**Dôkaz — merateľne:**
- `--aura-teal-700` #03797E má relatívnu luminanciu **0,149**, hue **182°**.
- `--ovl-ok` #1a7f37 má luminanciu **0,157**, hue **145°**.
  Rozdiel luminancie 0,008 a 37° hue → v 12px pill badge s tintom sú tieto dve
  farby pre oko **tá istá tmavá zeleno-modrá**. Snímka 04 by po nasadení teal
  hlavičky obsahovala teal lištu a hneď pod ňou zelené badge „naplánovaná“ /
  „aktívna“, ktoré vyzerajú ako jej odvodenina.
- `--aura-gold-tint` #FBF4E6 vs `--ovl-warning-bg` #fff3d6 — dva takmer
  identické krémové odtiene. Gold panel rodiny by bol nerozlíšiteľný od
  výstražného panela (`.ovl-card--warning`, snímky 03, 08, 09, 12).
- `--aura-gold-500` #D8B878 má na bielej kontrast **1,90:1** — ako text v light
  mode je nepoužiteľná.

**Dopad:** priamo porušuje pravidlo rodiny „brandové akcenty musia byť oddelené
od stavových farieb“. V appke, kde farba badge rozhoduje o tom, či treba zasiahnuť
do produkčného eshopu, je toto bezpečnostný problém, nie estetický.

**Riešenie — tri tvrdé pravidlá + posun dvoch stavových hue:**
1. **Teal sa nikdy nepoužije ako tint badge.** Teal existuje len ako (a) plná
   výplň štruktúry (lišta hlavičky, primárne tlačidlo), (b) fokusový prsteň,
   (c) tint *výberu* (`--ovl-accent-tint` #E3F1F1 pre `:checked` riadok a aktívny
   čip). Nikdy ako nositeľ stavu kampane.
2. **Gold sa nikdy nepoužije ako plocha panelu ani ako text v light mode.**
   Gold existuje len ako (a) hairline 1px, (b) eyebrow text — v light mode
   `--aura-gold-800` #8A6417 (kontrast 5,36:1), v dark mode #D8B878 (9,80:1),
   (c) symbol `♛`.
3. **Stavová paleta sa odsúva od brandu:**
   - `ok` #1a7f37 → **#2E7D32** (hue 123°, teda 59° od teal; kontrast na bielej
     4,99:1). Navyše: zelená sa **nikdy** nepoužije ako plná výplň, len ako tint.
   - `warning` #9a6700 / #fff3d6 → **#B45309** (hue 26°, jednoznačne oranžová,
     kontrast 5,02:1) s tintom **#FDF1E3**. Tým sa oddelí od gold #FBF4E6.
   - `danger` #B3261E zostáva — je to farba pruhu PRODUKCIA (D6) a musí byť
     unikátna.

#### V5 — Hlavička nemá mriežku ani pevnú výšku; stavové badge padajú na druhý riadok

**Dôkaz:** `globals.css:78–107` — `.ovl-header-inner { display:flex;
flex-wrap:wrap }` + `.ovl-header-badges { margin-left:auto }`. Na **všetkých**
desktopových snímkach (03–12) je výsledok rovnaký: riadok 1 = wordmark + nav,
riadok 2 = tri badge zarovnané doprava, s prázdnym pásom cca 700px vľavo.

**Dopad:** hlavička je vysoká 76px z ktorých polovicu tvorí prázdno; „PRODUKCIA“
pruh + prázdny pás + tri farebné badge = chaotický vstup do každej stránky.
Badge, ktoré sú podľa D5 povinne trvalé, vyzerajú ako odpadnutý zbytok.

**Riešenie:** `display: grid; grid-template-columns: auto 1fr auto;
align-items: center; min-height: 56px; column-gap: var(--ovl-s4)` — wordmark |
nav | badge slot. Badge slot `display:flex; gap:.5rem; flex-wrap:nowrap`.
Pri `< 900px` sa nav presúva do vodorovného scroll pásu (V36), badge slot si
drží TTL badge a ostatné dva sa skladajú do rozbaľovacieho `<details>` (pozor
na D5 — viď *Koliduje*).

#### V6 — Wordmark nie je logo

**Dôkaz:** `globals.css:88` `.ovl-brand { font-weight:800; font-size:1.05rem }`,
`layout.tsx:32` `<span className="ovl-brand">{APP_DISPLAY_NAME}</span>`.
Na snímkach je „Aura Zľavy“ vizuálne rovnaký objekt ako navigačná položka
„Dashboard“ — rovnaká farba, takmer rovnaká veľkosť, rovnaká váha.

**Riešenie:** `.ovl-brand` → `font-family: var(--ovl-font-display)`
(Playfair Display 1.125rem/600, `letter-spacing: 0`), farba `#ffffff` na teal
lište, pred textom `<span className="ovl-crown" aria-hidden>♛</span>` v
`--aura-gold-500`, veľkosť 0.9em, `margin-right:.4em`, za wordmarkom
vertikálny gold hairline `border-left: 1px solid color-mix(in oklab,
var(--aura-gold-500) 45%, transparent)` oddeľujúci nav.
`♛` musí mať `aria-hidden="true"` — čítačka nemá hlásiť „biela dáma“.

---

### B. Dark mode

#### V7 — Dark mode neexistuje ani ako možnosť

**Dôkaz:** `globals.css:9` `color-scheme: light;` — hard-coded, jedna paleta,
žiadny `@media (prefers-color-scheme: dark)`, žiadny `[data-theme]`.

**Dopad:** rodina má dark ako **default** — appka je teda jediná svetlá vec v
inak tmavej sade.

**Riešenie:** `color-scheme: light dark` + trojstupňová kaskáda, aby prepínač
vyhral v oboch smeroch:
```
:root { /* light tokeny */ }
@media (prefers-color-scheme: dark) { :root { /* dark tokeny */ } }
:root[data-theme="dark"]  { /* dark tokeny */ }
:root[data-theme="light"] { /* light tokeny */ }
```
Dark tokeny sa vypíšu raz do `@custom-selector`-like zoskupenia (v praxi
duplikát bloku alebo `:where(...)`). Prepínač = „Light pill“ rodiny:
`.ovl-theme-pill` v badge slote hlavičky, `aria-pressed`, hodnota v
`localStorage`, aplikovaná inline skriptom v `<head>` pred hydratáciou
(inak blikne svetlá farba). Bez novej závislosti — 6 riadkov skriptu.

#### V8 — Červený pruh PRODUKCIA (D6) v darku stráca poplašnú funkciu

**Dôkaz + prečo:** na svetlom pozadí (#f6f7f9) je pás #B3261E najtmavšia a
najsaturovanejšia plocha na obrazovke — presne to z neho robí alarm (snímky
01–12). Na `--aura-paper-dark` #0E1413 je #B3261E naopak **tmavšia** ako telo
stránky nebude, ale jeho saturačný odstup od okolia klesne z „unikátna
saturovaná plocha“ na „ďalšia tmavá plocha“. Zároveň biely text na #B3261E má
kontrast 5,6:1 — čitateľnosť je v poriadku, problém je *výraznosť*.

**Dopad:** D6 je jedno z najdôležitejších rozhodnutí (nevratné zápisy do ostrého
eshopu). Ak dark mode oslabí pruh, redizajn zhorší bezpečnosť.

**Riešenie:** v dark mode pruh **nezosvetľovať do pastelu, ale zvýšiť
luminanciu podkladu a pridať tvarový kanál:**
- `--ovl-production-bg: #C62F26` (dark) vs `#B3261E` (light),
- `--ovl-production-fg: #FFF4F2`,
- `border-bottom: 1px solid var(--aura-gold-600)` — gold hairline pruh zároveň
  zaväzuje do rodiny a opticky ho „vyzdvihne“ nad tmavé telo,
- `box-shadow: 0 1px 0 0 rgb(0 0 0 / .5), 0 6px 18px -8px #C62F26` — jemný
  červený rozptyl len v darku,
- `letter-spacing: .06em`, doména v `--ovl-mono` na `rgb(255 255 255 / .16)`
  chipe (už existuje, `globals.css:66–71` — zachovať).
Text pruhu sa **nemení** (`PRODUKCIA — <doména> · každý zápis ide do ostrého
shopu`, `ProductionBar.tsx:33`).

#### V9 — Stavové tinty sú fixné svetlé hexy — v darku by svietili

**Dôkaz:** `globals.css:18–24` — `#fdecea`, `#fff3d6`, `#e6f4ea`, `#eceef2`.
Tieto hodnoty majú luminanciu 0,85–0,93; na `#141C1B` by badge boli
najsvetlejšie objekty na stránke a prekričali by aj červený pruh.

**Riešenie:** tinty prestať zadávať ako hexy a počítať ich z tónu voči
aktuálnemu povrchu — jedno pravidlo pre obe témy:
```
--st-x-tint: color-mix(in oklab, var(--st-x) 12%, var(--ovl-surface));
--st-x-edge: color-mix(in oklab, var(--st-x) 42%, var(--ovl-surface));
```
`color-mix` je v jedinom cielenom prehliadači (appka beží lokálne) bezpečný;
ak je požadovaný fallback, stačí `@supports not (color: color-mix(in oklab, red,
red))` s pôvodnými hexmi pre light.

#### V10 — `--ovl-shadow` je jediný nástroj elevácie a v darku nefunguje

**Dôkaz:** `globals.css:29` — dva čierne stupne s alfou 0,06/0,08. Na tmavom
povrchu je čierny shadow neviditeľný, takže karty by v darku splynuli s pozadím
(kartu drží len `1px solid var(--ovl-border)`, čo pri `--aura-line-dark` #22302E
na `#0E1413` dáva kontrast okraja len ~1,4:1).

**Riešenie:** elevácia sa v darku robí **plochou, nie tieňom**:
`--ovl-surface` #141C1B (o stupeň svetlejšie než `--ovl-bg` #0E1413),
`--ovl-surface-2` #1A2422 pre `thead`, zebru a hover;
`--ovl-shadow: none` v darku; `--ovl-border` #263533 a `--ovl-border-strong`
#31423F pre okraje, ktoré musia byť viditeľné (karty stavu, tabuľkové hlavičky).

---

### C. Hierarchia a hustota

#### V11 — Dashboard je plochý: šesť kariet s identickou vizuálnou váhou

**Dôkaz:** snímka 03. `AlertsBanner` (2px červený), `UnackedResults`
(`ovl-card--warning`), `KeyCard`, „Čo tento dashboard vie a nevie“, „Posledné
kampane“, „Allowlist produktov“ — všetky majú `padding: 1rem`, `border: 1px`,
rovnaký `--ovl-shadow`, rovnaký `h2` **1rem/700** (`globals.css:169–181`).
Jediná odlišnosť je farba okraja. Chýba akýkoľvek číselný prehľad: nikde nie je
„1 aktívna kampaň“, „3 nepotvrdené“, „9/10 slotov“ ako **číslo** — všetko sa
musí prečítať z viet a tabuliek.

**Dopad:** oko nemá kam pristáť. Pri otvorení dashboardu trvá cca 3–4 sekundy
zistiť, či je niečo v poriadku — pritom presne na to táto obrazovka je (D1).

**Riešenie — tri tiery s odlišnou *formou*, nie len farbou:**

- **Tier 0 — Vyžaduje zásah.** `AlertsBanner` zostáva najsilnejší objekt:
  `background: var(--st-critical-tint)`, `border: 1px solid
  var(--st-critical-edge)`, `border-left: 4px solid var(--st-critical)`,
  nadpis 1.0625rem/700 v `--st-critical`, položky ako riadky s `Otvoriť →`.
  **Poznámka:** `needs_key` a `missed` musia zostať v jednom banneri s rovnakou
  váhou — D8/D33b, viď *Koliduje*.
- **Tier 1 — Stavový pás (nové).** Namiesto dvoch veľkých kariet v prvom riadku:
  `.ovl-statstrip` — `display: grid; grid-auto-flow: column; border: 1px solid
  var(--ovl-border); border-radius: var(--ovl-radius); background:
  var(--ovl-surface)`, štyri dlaždice oddelené 1px hairlinami, každá:
  eyebrow (11px, uppercase, `--ovl-eyebrow`) + hodnota **1.75rem/650 tabular**
  + jednoriadkový popis 0.8125rem muted.
  Obsah: `KĽÚČ 47 h 59 min` (farba podľa TTL, D5) · `AKTÍVNE KAMPANE 1` ·
  `NEPOTVRDENÉ 3` · `ALLOWLIST 9/10`.
  Toto je jediné miesto, kde sa v appke použije veľké číslo — preto bude
  automaticky dominovať.
- **Tier 2 — Zoznamy.** „Posledné kampane“ a „Allowlist“: `--ovl-shadow: none`,
  `border: 1px solid var(--ovl-border)`, `h2` prekonvertovaný na **eyebrow**
  (0.6875rem, uppercase, `letter-spacing:.08em`, `--ovl-eyebrow` gold) — tým
  prestanú súťažiť s Tier 0/1 a zároveň to je presne konvencia rodiny.

Vertikálny rytmus: medzi tiermi `1.75rem`, medzi kartami v tieri `0.875rem`
(dnes je všade `1rem`, `Dashboard.tsx:83`).

#### V12 — Dokumentačná karta má váhu stavovej karty a sedí v prvom riadku

**Dôkaz:** snímka 03/12 — „Čo tento dashboard vie a nevie“ vedľa „API kľúč“,
`Dashboard.tsx:88–97`, `data-testid="dashboard-honesty"`. Je to trvalý
vysvetľujúci text (4 riadky), ktorý sa nikdy nemení a po druhom prečítaní nemá
informačnú hodnotu — ale zaberá 50 % najcennejšieho riadku obrazovky.

**Riešenie:** presunúť **pod** stavový pás ako zbalené
`<details class="ovl-explainer">` s `<summary>` v gold eyebrow tvare
`♛ AKO TENTO DASHBOARD ČÍTAŤ`, defaultne zatvorené, bez okraja, len
`border-top: 1px solid var(--ovl-border)`. Text sa **neskracuje** — je to
nosič I11 a musí zostať dostupný jedným klikom.

#### V13 — Inverzia typografickej hierarchie: `h2` je väčší ako `h1`

**Dôkaz:** `h1` má vždy inline `fontSize: '1.3rem'` = 19,5px
(`page.tsx:23`, `kampane/page.tsx:19`, `audit/page.tsx:20`,
`nastavenia/page.tsx:20`, `produkty/page.tsx:21`, `onboarding/page.tsx:154`,
`login/page.tsx:106`, `CampaignDetail.tsx:138`).
`.ovl-card h2` má `1rem` (`globals.css:176–179`), **ale `h2` mimo karty nemá
žiadne pravidlo** → dostane default prehliadača `1.5em` = **22,5px**.
Vidno to priamo: snímka 08 — „Krok 2 — dry-run náhľad“ je väčší než „Nová
kampaň“; snímka 05 — „Položky“ a „Audit stopa“ sú väčšie než názov kampane.

**Riešenie:** typografická škála v tokenoch + tri triedy namiesto inline štýlov:
`.ovl-page-title` (h1, 1.5rem/700, `letter-spacing:-.01em`, `margin:0 0 1.25rem`),
`.ovl-section-title` (h2 mimo karty, 1.125rem/650, `margin:1.5rem 0 .625rem`),
`.ovl-card h2` → eyebrow (0.6875rem uppercase gold).
`h1,h2,h3,h4 { font-size: inherit; font-weight: inherit; margin: 0 }` ako
reset v `globals.css`, aby default prehliadača už nikdy neprebil dizajn.

#### V14 — 89 inline `style={{}}` v 51 komponentoch nahrádza chýbajúce utility

**Dôkaz:** `grep -c "style={{" src/**/*.tsx` → **89**. Sedemkrát duplikovaný
`fontSize:'1.3rem'`; opakované `style={{ gap: '1rem' }}` / `'0.5rem'` /
`'1.25rem'` na `.ovl-stack` a `.ovl-row`; `minHeight` skeletonov;
`style={{ margin: 0 }}` na každom `<dd>` v `CampaignDetail.tsx:146–168`;
`gridTemplateColumns:'auto 1fr'` ručne v definičnom liste.

**Dopad:** akákoľvek zmena rytmu alebo škály sa musí robiť na 89 miestach.
Redizajn bez tohto kroku bude po týždni zase nekonzistentný.

**Riešenie:** priestorová škála v tokenoch (`--ovl-s1`…`--ovl-s6`) + modifikátory
`.ovl-stack--tight/--loose`, `.ovl-row--tight`, `.ovl-dl` (definičný list ako
grid `max-content 1fr` s `column-gap: var(--ovl-s5)`, `<dd>{margin:0}` v CSS),
`.ovl-skeleton--card/--row`. Cieľ: `style={{}}` len tam, kde je hodnota
dynamická (žiadna taká dnes nie je).

#### V15 — `.ovl-stack` roztiahne tlačidlá na plnú šírku (skutočná vizuálna chyba)

**Dôkaz:** `globals.css:269` `.ovl-stack { display:flex; flex-direction:column;
gap:.4rem }` — bez `align-items`, teda default `stretch`.
Následky na snímkach: **snímka 05** — „Zopakovať zlyhané (2)“ je modré tlačidlo
široké celých 1065px (`RetryFailedButton` je jediné dieťa `.ovl-stack`);
**snímka 09** — „Obnoviť z shopu“ je ~630px široký rám (`RefreshButton` vracia
`.ovl-stack`, ktorý je v `.ovl-spread`).

**Dopad:** dve najväčšie tlačidlá v celej appke sú veľké **omylom** — a jedno
z nich („Zopakovať zlyhané“) spúšťa cestu k produkčnému zápisu. Nezamýšľaná
vizuálna váha na nebezpečnej akcii.

**Riešenie:** `.ovl-stack { align-items: flex-start }` + `.ovl-stack--fill`
pre prípady, kde je stretch žiadaný, a `.ovl-btn { align-self: start;
flex: 0 0 auto }`. Šírka tlačidiel potom zodpovedá ich obsahu.

#### V16 — Mriežka allowlistu je zubatá, riadky sa naťahujú podľa najvyššej karty

**Dôkaz:** snímka 12 — karta „Šperk 1“ obsahuje `VariantWarning` (4 riadky
textu) a naťahuje celý prvý riadok mriežky na ~250px; ostatné štyri karty majú
100px obsahu a 150px prázdna. Snímka 03 to isté v miernejšej forme.
Príčina: `.ovl-allowlist-grid` (`globals.css:190–194`) bez `grid-auto-rows`
a `.ovl-variant-warning` je viacriadkový blok vnútri karty.

**Riešenie:** `grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
grid-auto-rows: 1fr; gap: .625rem` + `.ovl-product-card { min-height: 7rem;
justify-content: flex-start }`.
`VariantWarning` v kartovom kontexte skrátiť na `.ovl-variant-chip` —
18×18px gold-outline `⚠` s `title` a `aria-label` nesúcimi plnú vetu
(vizuálna forma sa mení, text ostáva prístupný). V tabuľkách môže zostať
plná vetu.

#### V17 — Povinné vety sa opakujú tak často, že prestali byť varovaním

**Dôkaz — počty na jednej obrazovke:**
- **Snímka 03/12:** „bez vlastného zápisu — shop môže mať iný stav“ **9×** pod
  sebou (`AllowlistGrid.tsx` → `SelfWriteBadge` na každej karte).
- **Snímka 08:** „(orientačný výpočet appky; zaokrúhlenie shopu sa môže líšiť)“
  **3×** v stĺpci ceny + **3×** parafrázované v stĺpci „Upozornenia“
  („Orientačná cena vypočítaná appkou… cez API sa overiť nedá“) + **1×** v
  poznámke pod tabuľkou = **7 výskytov tej istej myšlienky**; plus stĺpec
  „Posledný vlastný zápis“ nesie ďalšie 3× dashed „bez vlastného zápisu…“.
- **Snímka 06/07:** rovnaká dashed veta **9×** v zozname produktov.
- **Snímka 09:** „žiadny“ + dashed veta v tej istej buňke = duplikát v duplikáte.

**Dopad:** paradoxne to oslabuje presne to, čo D4/D7/I11 chránia. Text, ktorý je
na obrazovke sedemkrát, oko preskočí; text, ktorý je raz a je vizuálne
odlíšený, si prečíta.

**Riešenie (vyžaduje rozhodnutie — viď *Koliduje*, body K1/K2):**
zachovať povinnú informáciu na každej položke, ale rozdeliť ju na
**vizuálny marker + jedno plné znenie na obrazovku**:
- na položkách `.ovl-selfwrite` skrátiť na `vlastný zápis: —` /
  `vlastný zápis 05.08.`, plná veta v `title` **a** `aria-label`;
- plné znenie raz ako `.ovl-legend` pod nadpisom sekcie
  (`border-left: 2px solid var(--ovl-border); padding-left:.6rem`);
- pri cenách za hodnotu `≈` marker (`.ovl-approx`, `cursor:help`,
  `title` = presné znenie D4) + plné znenie raz nad tabuľkou.

#### Ostatné hustotné pozorovania (zahrnuté v riešeniach vyššie)

- `.ovl-main { padding: 1.25rem 1rem 4rem }` — 4rem spodného prázdna pri
  krátkych stránkach (01, 04) vytvára pocit nedokončenej stránky; `2.5rem` stačí.
- `ReadOnlyNotice` je vnorený do `.ovl-main` s vlastným `style={{ padding }}`
  (`layout.tsx:39`) → 1100px široký pás odsadený od hlavičky, vizuálne visí
  v ničom (snímky 01, 02, 12). Má byť **full-bleed** hneď pod hlavičkou ako
  súčasť chrome (pozor na D10 „nenápadná“ — viď *Koliduje* K6).

---

### D. Stavové badge a farebný systém

#### V18 — Farebná logika stavov nemapuje význam; „naplánovaná“ je zelená ako „zapísaná“

**Dôkaz:** `StatusBadge.tsx:11–38` + snímky 04, 05.

| stav | dnes | problém |
| --- | --- | --- |
| `scheduled` naplánovaná | **ok / zelená** | nič sa ešte nestalo — je to čistá informácia, nie úspech |
| `done` zapísaná | ok / zelená | skutočný úspech |
| `aktivna` (derivovaná) | ok / zelená | prebiehajúci stav |
| `needs_key` vyžaduje kľúč | danger / červená | **treba zasiahnuť teraz** |
| `missed` zmeškaná | danger / červená | **treba zasiahnuť teraz** |
| `failed` zlyhala | danger / červená | stalo sa v minulosti, možno už irelevantné |
| `not_found`, `blocked` | danger / červená | rôzne príčiny, rovnaká farba |
| `partial` čiastočná | warning / žltá | treba dokončiť |
| `running` beží zápis | warning / žltá | **nie je to problém, je to priebeh** |
| `cancelled`, `lapsed`, `draft` | neutral | správne |
| `expirovana` | outline | správne |

Tri semanticky odlišné veci nesú zelenú; štyri odlišné veci nesú červenú;
„beží zápis“ nesie tú istú žltú ako „čiastočná“.
Na snímke 04 je to viditeľné okamžite: päť riadkov, tri farby, a z farby sa
**nedá** povedať, ktorý riadok vyžaduje akciu.

**Riešenie — päťtónová sémantická mapa, kde tón = *čo mám robiť*, nie *aký je
to typ udalosti*, plus tvarový kanál pre farbosleposť:**

| tón | token | význam | tvar | stavy |
| --- | --- | --- | --- | --- |
| **critical** | `--st-critical` #B3261E / dark #F08B82 | vyžaduje zásah **teraz** | plná bodka `●` + 3px ľavý pruh | `needs_key`, `missed`, `ZÁPISY ZAMKNUTÉ`, scheduler stale, kľúč chýba/expiroval |
| **attention** | `--st-attention` #B45309 / dark #F0A95C | nedokončené / neisté, rozhodni | trojuholník `▲` | `partial`, `failed`, `uncertain`, `interrupted`, `not_found`, `blocked`, price mismatch, TTL ≤ 6 h |
| **progress** | `--st-progress` #5B4BC4 / dark #ADA0F5 | práve prebieha | 2px animovaný pruh | `running` |
| **good** | `--st-good` #2E7D32 / dark #63C98A | potvrdený vlastný zápis | `✓` | `done`, item `ok`, `verifyStatus=valid` |
| **idle** | `--ovl-muted` na `--ovl-surface-2` | čistá informácia, nič nerob | prázdny krúžok `○` | `scheduled`, `draft`, `cancelled`, `lapsed`, `expirovana`, `pending`, `skipped` |

Kľúčové posuny: **`scheduled` → idle** (najväčšia zmena; naplánovaná kampaň sa
prestane vydávať za úspech), **`failed` → attention** (aby červená znamenala
výhradne „teraz“), **`running` → progress**.
Badge dostane variant `.ovl-badge--critical` s `border-left-width: 3px` — tá istá
farba, ale iná silueta než ostatné, takže „vyžaduje zásah“ je rozpoznateľné
periférnym videním aj v čiernobielej.

#### V19 — `running` ako warning znemožňuje odlíšiť „beží“ od „dopadlo zle“

**Dôkaz:** `StatusBadge.tsx:15` `running: { tone: 'warning' }` vs `:17`
`partial: { tone: 'warning' }`. Na filtroch (snímka 04) sú „beží zápis“ a
„čiastočná“ vedľa seba nerozlíšiteľné.

**Riešenie:** `--st-progress` (indigo #5B4BC4 — hue, ktorá v palete rodiny ani
v stavovej palete nemá dvojníka) + `.ovl-badge--progress::after` 2px pás s
`@keyframes ovl-progress` (`background-size: 200% 100%`, 1,2 s linear infinite).
Pohyb je najlepší signál „prebieha“ a v tejto appke sa nikde inde nepoužíva.

#### V20 — Jeden stav, dva protichodné signály: `preskočený` má neutrálny badge a červený panel

**Dôkaz:** snímka 05, posledný riadok — badge „preskočený“ je **outline
(neutrálny)**, ale v stĺpci Detail je **červený panel** „Položka bola preskočená
(zápis sa zastavil skôr).“
Príčina: `ItemsTable.tsx:88–94` posiela **všetko okrem `ok` a `pending`** do
`<ErrorMessage>`, ktorý má vždy `.ovl-error` (`ErrorMessage.tsx:20`,
`globals.css:275–282`). Rovnako `not_found` („Produkt sa v shope nenašiel“) a
`interrupted` dostanú identický červený rám ako skutočné odmietnutie shopom.

**Dopad:** snímka 05 je stena troch červených panelov, z ktorých len jeden
(`zlyhal`, rate limit) je skutočná chyba. Používateľ, ktorý sa naučí, že
červený panel často nič neznamená, ho prestane čítať.

**Riešenie:** triáda `.ovl-note`:
```
.ovl-note            /* idle: surface-2, muted text, 1px border */
.ovl-note--attention /* attention tint + edge + ▲ */
.ovl-note--critical  /* = dnešný .ovl-error, + ● */
```
`ErrorMessage` dostane prop `tone?: 'info' | 'attention' | 'critical'`
(default `critical`, takže existujúce volania sa nezmenia) a `ItemsTable`
mapuje: `skipped`/`pending` → `info`, `uncertain`/`interrupted` → `attention`,
`failed`/`not_found`/`blocked` → `critical`. Text hlášok sa nemení.

#### V21 — Zelený badge „nájdený“ 9× je farebný šum bez informácie

**Dôkaz:** snímka 09, stĺpec „STAV V SHOPE“ — deväť identických zelených
badge „nájdený“. `AllowlistTable.tsx:23–27` mapuje `ok → null`, takže badge
kreslí niečo iné (`AllowlistTable` ďalej v súbore) — hodnota `ok` sa aj tak
vizualizuje.

**Dopad:** stĺpec zelene, ktorá súťaží so skutočnými stavmi (`v shope
nenájdený`, `stav neznámy`) a s badge kampaní.

**Riešenie:** použiť konvenciu, ktorú appka **už má** — `WriteModeBadge`
nevykreslí nič, keď je všetko v poriadku (`WriteModeBadge.tsx:35`).
Pri `shopStatus === 'ok'` nevykresliť badge, len `—` v muted; badge len pre
`not_found` (critical) a `unknown` (attention). Ušetrí to celý farebný stĺpec.

#### V22 — Sémantická inverzia: bezpečný stav je namaľovaný ako výstraha; nekonzistentné veľké písmená

**Dôkaz:** snímky 01–12, tretí badge v hlavičke — `ZÁPISY VYPNUTÉ (dev)` je
`warning` (žltá, uppercase, `WriteModeBadge.tsx:31`). Pritom to znamená
„do produkcie sa **nedá** nič zapísať“ — teda najbezpečnejší možný stav,
umiestnený 40px pod pruhom, ktorý kričí „každý zápis ide do ostrého shopu“.
Tie dve vety si na tej istej obrazovke protirečia.
Ďalej: audit (snímka 10) má výsledky `OK` (uppercase) a `chyba` (lowercase) —
`AuditTable.tsx:36–44`. Kampane majú všetky labely lowercase
(`StatusBadge.tsx`), ale `ZÁPISY VYPNUTÉ` a `OK` sú uppercase.

**Riešenie:**
- `ZÁPISY VYPNUTÉ (dev)` → tón `idle` s `--ovl-accent` textom a `● dev` prefixom,
  alebo vlastný neutrálny „mode“ tón (rozhodnutie R6). Text ponechať —
  je to informácia, ktorú D77 vyžaduje mať viditeľnú, nie výstraha.
- `ZÁPISY ZAMKNUTÉ` (runaway zámok) zostáva `critical` — to naozaj vyžaduje zásah.
- Casing: **všetky badge labely lowercase**, `text-transform` sa nepoužije;
  `OK` → `úspešné`, `chyba` → `chyba` (audit filter už používa
  „úspešné/neúspešné“ — `AuditFilters.tsx` — takže tabuľka bude s filtrom
  konzistentná). Uppercase sa v appke rezervuje **výhradne** pre eyebrow nadpisy
  a pruh PRODUKCIA.

---

### E. Tabuľky a dátové zobrazenia

#### V23 — Peňažné a percentuálne hodnoty sa lámu na viac riadkov

**Dôkaz:** `globals.css:262` `.ovl-num { text-align:right;
font-variant-numeric: tabular-nums }` — **bez `white-space: nowrap`**.
`formatEur` vkladá do tisícov medzeru (`format.ts` — `int.replace(/\B(?=(\d{3})+(?!\d))/g,' ')`),
ktorá je bežná medzera, teda **zlomový bod**.
Následky: **snímka 09** — cena `2 450,00 €` je zlomená na tri riadky
(`2` / `450,00` / `€`) a riadok tabuľky narastie o 40px;
**snímky 04, 08, 13** — `−12 %` zlomené na `−12` / `%`.

**Riešenie (dvojité, aby to nezávisel od CSS jedného miesta):**
1. `.ovl-num, .ovl-money, .ovl-pct { white-space: nowrap;
   font-variant-numeric: tabular-nums lining-nums; }`
2. `formatEur` a `formatPercentSk` používať **U+00A0** (nezlomiteľná medzera)
   namiesto obyčajnej — `2 450,00 €`, `−15 %`. To je zároveň
   správna slovenská typografia (medzera pred `%` a pred menou je nezlomiteľná).

#### V24 — Dátumy nie sú v numerickom režime: proporcionálne číslice, dvojité roky, lámanie

**Dôkaz:** stĺpec „Okno“ v `CampaignList.tsx` a `CampaignsMini.tsx` nemá
`numeric: true`, takže nedostane `.ovl-num` ani `tabular-nums`. Na snímke 04 sa
`03.08.2026 – 19.08.2026` v piatich riadkoch opticky nezarovná; na snímke 08 sa
zlomí na dva riadky; na snímke 13 je odseknuté (`03.08.2`).
V audite (snímka 10) sa `05.08.2026 22:11` láme na dva riadky v každom z 8
riadkov, hoci stĺpec má miesto.

**Riešenie:**
- nová trieda `.ovl-date { font-variant-numeric: tabular-nums; white-space:
  nowrap }` a `.ovl-daterange { white-space: nowrap; min-width: 17ch }`
  — aplikovať v `Table` cez novú vlastnosť stĺpca `kind: 'date' | 'num' |
  'text'` (čistejšie než dnešný boolean `numeric`),
- v audite `ČAS` rozdeliť na dva vizuálne riadky **zámerne**:
  `05.08.2026` v `--ovl-fg` a `22:11` pod ním v `--ovl-muted` 0.75rem — dnes je
  to nechcený wrap, po zmene je to čitateľná dvojúrovňová hodnota,
- **rok v rozsahu neskracovať** (D13 — viď *Koliduje* K3).

#### V25 — Tabuľková hlavička nemá plochu, nie je sticky a niektoré hlavičky sú širšie než dáta

**Dôkaz:** `globals.css:255–260` — `thead th` má len malé uppercase písmo a muted
farbu, žiadne pozadie, žiadny `position: sticky`.
Snímka 04: hlavička `POLOŽKY (OK/ZLYHANÉ/SPOLU)` je 224px široká pre hodnoty
typu `0/0/1` (24px) — hlavička definuje šírku stĺpca a je pravozarovnaná, takže
text hlavičky je od svojich čísel vzdialený ~200px.
Snímka 09 (1800px vysoká tabuľka) aj snímka 10: pri scrollovaní hlavička odíde.

**Riešenie:**
- `thead th { background: var(--ovl-surface-2); position: sticky; top: 0;
  z-index: 1; border-bottom: 1px solid var(--ovl-border-strong);
  font-size: .6875rem; letter-spacing: .06em }`
  (pri sticky pozor: `.ovl-table-wrap` nesmie mať `overflow: hidden`),
- dlhé hlavičky rozdeliť na dva riadky triedou `.ovl-th-sub`:
  `Položky` + pod tým `ok / zlyh. / spolu` v 0.625rem muted → šírka stĺpca
  spadne z 224px na ~90px,
- riadkové hairliny zjemniť na `color-mix(in oklab, var(--ovl-border) 55%,
  transparent)` a hover ponechať (`--ovl-surface-2`) — dnes je hover
  `--ovl-bg`, čo je na svetlom pozadí takmer neviditeľné.

#### V26 — Dry-run tabuľka má 7 stĺpcov, z toho 2 s identickou hodnotou vo všetkých riadkoch

**Dôkaz:** `DryRunTable.tsx:28–100` — stĺpce `Zľava` a `Okno` sa renderujú
funkciami **bez parametra riadku** (`render: () => formatPercentSk(percent)`,
`render: () => \`${from} – ${to}\``), teda sú pre všetky riadky rovnaké.
Snímka 08: 7 stĺpcov na 1065px → `ZĽAVA` zlomená na `−15`/`%`, `OKNO` na dva
riadky, riadky vysoké 130–170px.

**Riešenie:**
- `Zľava` a `Okno` **von z tabuľky** do súhrnného riadku nad ňou:
  `.ovl-preview-summary` — `−15 % · 06.08.2026 – 05.09.2026 · 3 produkty`,
  hodnoty 1.0625rem/650 tabular, oddelené `·` v `--ovl-muted`.
  Zostane 5 stĺpcov: Produkt | Aktuálna cena | Orientačná cena po zľave |
  Posledný vlastný zápis | Upozornenia.
- Stĺpec „Posledný vlastný zápis“ pri absencii zápisu nekresliť dashed box, len
  `—` v muted (dnes 3-riadkový dashed rám v každom riadku bez informácie).
- Disclaimer D4 zo každej buňky na `≈` marker + jedno plné znenie (V17, K2).
- `.ovl-main--wide { max-width: 1180px }` pre dry-run, kampane a audit;
  formuláre a nastavenia zostanú na 1100px, login/onboarding na 720px.

#### V27 — Audit: 8 stĺpcov, tlačidlo v každom riadku, žiadna zebra, klikateľnosť len v komentári

**Dôkaz:** snímka 10; `AuditTable.tsx` — deväť `Button` „Zobraziť“ v poslednom
stĺpci; komentár v hlavičke súboru tvrdí „Klik na riadok otvorí detail drawer“,
ale `<tr>` nemá `onClick` ani `cursor: pointer`.

**Riešenie:** `Zobraziť` → `.ovl-btn--ghost` (bez okraja, `--ovl-accent` text,
podčiarknutie pri hoveri) alebo `›` ikonu 24×24; `<tr>` dostane
`cursor: pointer` a hover na celý riadok (vizuálne prepojenie s reálnym
chovaním, ktoré treba doplniť aj funkčne); zebra
`tbody tr:nth-child(even) { background: color-mix(in oklab,
var(--ovl-surface-2) 55%, var(--ovl-surface)) }`.
`eventType` v `<code>` je správne — mono na strojové kódy je dobrá existujúca
konvencia, len jej treba dať `--ovl-mono` s `font-size: .8125rem` a
`background: var(--ovl-surface-2)` chip.

---

### F. Formuláre

#### V28 — Formulárové prvky nie sú štýlované vôbec (najviditeľnejší „utilitárny“ znak)

**Dôkaz:** v `globals.css` existuje **jediné** pravidlo pre input —
`.ovl-sudo-dialog input[type='password']` (`:331–338`). Všetko ostatné je
natívne: snímka 01 (login), 02 (doména, kľúč), 06/07 (percento, dátumy,
checkboxy), 08b (názov kampane, checkbox), 09 (ID produktu, popis), 10 (6
filtrov vrátane dvoch `<select>`), 11 (doména, heslo, kľúč).
Šírky sú náhodné: `style={{ width: '6rem' }}` na percente
(`PercentInput.tsx:47`), 185px / 250px / 346px / 490px inde; na snímke 08b sa
predvyplnený názov `Zľava −20 % (06.08.2026 – 05…` **vizuálne odsekáva**, lebo
input je ~180px.

**Dopad:** appka vyzerá ako HTML formulár z roku 2003 a súčasne sa v nej
potvrdzujú nevratné zápisy do ostrého eshopu. Rozpor medzi vážnosťou operácie a
vizuálnou dôveryhodnosťou je tu najväčší.

**Riešenie — jedno CSS pravidlo pokryje celú appku bez zásahu do komponentov:**
```
:where(input:not([type='checkbox']):not([type='radio']), select, textarea) {
  font: inherit;
  min-height: 2.25rem;                /* 36px */
  padding: .45rem .6rem;
  border: 1px solid var(--ovl-border);
  border-radius: var(--ovl-radius-sm); /* 6px */
  background: var(--ovl-surface);
  color: var(--ovl-fg);
  color-scheme: inherit;
}
:where(input, select, textarea):focus-visible {
  outline: 2px solid color-mix(in oklab, var(--ovl-accent) 60%, transparent);
  outline-offset: 1px;
  border-color: var(--ovl-accent);
}
:where(input, select, textarea):disabled {
  background: var(--ovl-surface-2); color: var(--ovl-muted); cursor: not-allowed;
}
input[type='checkbox'], input[type='radio'] {
  accent-color: var(--ovl-accent); width: 1rem; height: 1rem;
}
input::placeholder { color: var(--ovl-muted); opacity: 1; }
```
Plus tri šírkové triedy namiesto inline hodnôt: `.ovl-input--xs` (5rem, percento),
`.ovl-input--sm` (12rem, ID), `.ovl-input--md` (22rem, doména/názov),
`.ovl-input--full` (100 %). Názov kampane v `ConfirmPanel` → `--ovl-input--full`
(dnes sa odsekáva).

#### V29 — Dátumové polia zobrazujú `mm/dd/yyyy` — priamy rozpor s D13

**Dôkaz:** snímka 06 (`08/05/2026` a prázdne `mm/dd/yyyy`), snímka 07
(`08/06/2026`, `09/05/2026`), snímka 10 (oba filtre `mm/dd/yyyy`).
`DateRangePicker.tsx:52` a `AuditFilters.tsx` používajú `<input type="date">`.
D13 vyžaduje: *„všetky dátumy sa MUSIA zobrazovať vo formáte DD.MM.YYYY“*.

**Dôležité:** formát natívneho `type="date"` určuje **jazyk prehliadača/OS** a
**nedá sa zmeniť ani CSS, ani atribútom, ani `lang="sk"` na `<html>`** (Chromium
ho berie z jazykových preferencií prehliadača, nie z dokumentu). Toto teda nie
je CSS problém a nedá sa vyriešiť v rámci redizajnu bez rozhodnutia — tri
možnosti sú v sekcii *Vyžaduje rozhodnutie* (R7).

**Odporúčanie na teraz (najmenej práce, splní D13 pre *zobrazenie*):**
ponechať natívny picker a doplniť vedľa/pod pole zrkadlený **SK echo** text:
`.ovl-date-echo` — `06.08.2026` v 0.8125rem `--ovl-fg` `tabular-nums`,
generovaný existujúcim `formatDateSk()`. Používateľ tak vždy vidí SK tvar a
picker zostane natívny (klávesnica, kalendár, `min`/`max` validácia).

#### V30 — Čipy, filtre a akcie sú ten istý vizuálny objekt

**Dôkaz:** všetky tri používajú `ovl-btn ovl-btn--small` a aktívny stav
`ovl-btn--primary`:
- 13 stavových filtrov (`CampaignFilters.tsx:56`) — snímka 04,
- 6 percentuálnych čipov (`PercentInput.tsx:64`) — snímka 06/07,
- 4 dátumové presety (`DateRangePicker.tsx:72`) — snímka 06/07.
Na snímke 07 je „15 %“ solid modrý presne ako tlačidlo „Pokračovať na dry-run“.

**Dopad:** používateľ nevie odlíšiť „vyberám hodnotu“ od „vykonávam akciu“ —
v appke so zápisom do produkcie je to nežiaduce. Zároveň 13 modrých/bielych
pilulek v dvoch radoch (snímka 04) tvorí vizuálny blok, ktorý súťaží s hlavičkou
tabuľky.

**Riešenie:** vlastný primitív `.ovl-chip`, tvarovo odlíšený od `.ovl-btn`:
```
.ovl-chip { height: 1.75rem; padding: 0 .7rem; border-radius: 999px;
  font-size: .8125rem; font-weight: 550; border: 1px solid var(--ovl-border);
  background: transparent; color: var(--ovl-muted); }
.ovl-chip[aria-pressed='true'] { background: var(--ovl-accent-tint);
  border-color: var(--ovl-accent); color: var(--ovl-accent);
  font-weight: 650; }
```
`.ovl-btn` zostane 36px vysoké s `--ovl-radius` 10px → **pilulka = voľba,
zaoblený obdĺžnik = akcia**. Aktívny čip je teal tint, nie solid — solid výplň
sa v appke rezervuje pre akcie.
Filtre navyše dostanú `role="group"` a počítadlo `Filtre · 13`, dátumové presety
viditeľne ukážu výsledok (`7 dní → 12.08.`) — hodnotu už majú v `title`
(`DateRangePicker.tsx:76`), stačí ju zviditeľniť.

#### V31 — `<a class="ovl-btn">` je podčiarknuté (chýba `text-decoration: none`)

**Dôkaz:** `globals.css:145–158` — `.ovl-btn` nedefinuje `text-decoration`;
`a { color: inherit }` (`:44`) rieši len farbu.
Vidno: snímka 04 „**+ Nová kampaň**“ podčiarknuté, snímka 06/07 „**Zrušiť**“
podčiarknuté; to isté sa stane „Otvoriť detail kampane“ / „Späť na zoznam“
(`NewCampaignWizard.tsx:151–156`).

**Riešenie:** `.ovl-btn { text-decoration: none; }` + `a.ovl-btn[aria-disabled]`
štýl (dnes odkaz nemá disabled stav vôbec, hoci `Button` má).
Jednoriadková oprava, viditeľná na štyroch obrazovkách.

#### V32 — Výber produktov nemá vizuálnu odozvu okrem 13px checkboxu

**Dôkaz:** snímky 06 a 07 sú takmer identické — jediný rozdiel sú tri malé
modré checkboxy. `NewCampaignWizard.tsx:230–255` renderuje `<label>` s
`ovl-row ovl-small`, bez akéhokoľvek `checked` štýlu.

**Dopad:** v kroku, kde sa rozhoduje, na **ktoré produkty** pôjde nevratná
zľava, nie je výber vizuálne potvrdený.

**Riešenie (CSS-only, bez JS):**
```
.ovl-pick { display:flex; gap:.6rem; align-items:center;
  padding:.45rem .6rem; border:1px solid transparent;
  border-radius: var(--ovl-radius-sm); }
.ovl-pick:hover { background: var(--ovl-surface-2); }
.ovl-pick:has(input:checked) { background: var(--ovl-accent-tint);
  border-color: color-mix(in oklab, var(--ovl-accent) 35%, transparent); }
.ovl-pick:has(input:checked) .ovl-product-name { font-weight: 650; }
```
+ počítadlo v nadpise karty: `Produkty · vybrané 3 z 9 (max 10)` — dnes sa počet
vybraných nezobrazuje nikde až do potvrdzovacieho panelu.

#### V33 — Checkbox D28 „Vedome prepisujem…“ vyzerá ako 11. produkt

**Dôkaz:** snímka 06/07, posledný riadok karty „1. Produkty“ —
`NewCampaignWizard.tsx:264–274`. Vizuálne je to rovnaký `<label>` s checkboxom
ako produkty nad ním.

**Riešenie:** vyňať z karty produktov do samostatného riadku
`.ovl-consent` nad CTA: `border-top: 1px solid var(--ovl-border);
padding-top: .75rem`, checkbox 1rem, text 0.8125rem, a keď je splnená podmienka
prepisu, nahradí sa `.ovl-note--attention` hláškou (dnes sa to už tak deje
logicky, ale obe varianty vyzerajú ako produkt).

#### V34 — Sprievodca nemá krokový indikátor ani súhrn pred dry-runom

**Dôkaz:** karty sú číslované `1. Produkty`, `2. Percento`, `3. Okno platnosti`
(snímka 06), ale sú viditeľné **naraz** — číslovanie predstiera kroky, ktoré
neexistujú. Skutočné kroky sú dva (draft → dry-run → potvrdenie, `Phase` v
`NewCampaignWizard.tsx:37`) a nie sú nikde znázornené. Pred kliknutím na
„Pokračovať na dry-run“ nie je nikde súhrn „čo sa stane“.

**Riešenie:**
- `.ovl-steprail` nad obsahom: `Nastavenie › Dry-run › Zápis do PRODUKCIE`,
  aktívny krok `--ovl-accent` + 2px gold spodná linka, budúce kroky muted,
  posledný krok v `--st-critical` (aby bolo od začiatku vidno, kam tok vedie),
- čísla z nadpisov kariet odstrániť (zostane `PRODUKTY`, `PERCENTO`, `OKNO
  PLATNOSTI` ako eyebrow),
- `.ovl-actionbar` prilepený naspodku pri `≥ 900px`
  (`position: sticky; bottom: 0; background: var(--ovl-surface);
  border-top: 1px solid var(--ovl-border-strong)`) so súhrnom
  `3 produkty · −15 % · 06.08.2026 – 05.09.2026` a primárnym CTA.
  Ušetrí scrollovanie a dá odpoveď na „čo presne potvrdzujem“.

#### V35 — Produkty: dve stackované tlačidlá na riadok, jedno z nich 9× solid červené

**Dôkaz:** snímka 09 — v každom z 9 riadkov sú dve tlačidlá **pod sebou**,
druhé je `variant="danger"` (solid #b3261e, biely text), labely sa lámu
(`Označiť stav ako` / `neznámy`, `Odobrať z` / `allowlistu`). Riadok je ~117px
vysoký, tabuľka ~1300px, celá stránka 1800px.

**Dopad:** stĺpec deviatich plných červených plôch je najsilnejšia vec na
obrazovke — silnejšia než pruh PRODUKCIA. Deštruktívna farba stráca význam
opakovaním (rovnaký mechanizmus ako V17, len farebný).

**Riešenie:**
- nový variant `.ovl-btn--danger-quiet`: `background: transparent;
  color: var(--st-critical); border-color: color-mix(in oklab,
  var(--st-critical) 35%, transparent)`; solid `--danger` sa rezervuje pre
  **potvrdzovacie** tlačidlá (`Zapísať do PRODUKCIE`, `Kľúč unikol — otvoriť
  panic button`, `Zrušiť kampaň`),
- labely skrátiť s plným znením v `title`: `Stav = neznámy`, `Odobrať`,
- stĺpec `Akcie`: `width: 1%; white-space: nowrap` a tlačidlá do `.ovl-row`
  (vodorovne) — výška riadku spadne z ~117px na ~52px, stránka z 1800px
  na cca 900px,
- zrušiť zelené „nájdený“ badge (V21) — spolu s tým sa tabuľka zúži o stĺpec.

---

### G. Mobil (snímka 13, 420×674)

#### V36 — Chrome zaberá 250 z 674px (37 % výšky) pred prvým dátom

**Dôkaz:** snímka 13 — pruh PRODUKCIA na **dva riadky** (48px), wordmark (36px),
nav zlomená do **dvoch radov** pilulek (76px), tri badge do **dvoch radov**
(64px), read-only pás (44px) = 268px. Prvý riadok tabuľky začína na ~600px.

**Riešenie:**
- pruh PRODUKCIA: pri `< 560px` skrátiť na `PRODUKCIA · <doména>` (vetu
  „každý zápis ide do ostrého shopu“ ponechať v `title`/`aria-label`) — **alebo**
  ponechať dva riadky, ale so `font-size: .8125rem` a `line-height: 1.25`
  (rozhodnutie R8; D6 nešpecifikuje dĺžku vety, ale skrátenie je zmena obsahu,
  preto to patrí medzi rozhodnutia),
- nav → `overflow-x: auto; scroll-snap-type: x proximity;
  scrollbar-width: none` s aktívnou položkou scrollnutou do view + fade maska
  vpravo; jeden rad namiesto dvoch (–40px),
- badge slot: `KeyTtlBadge` **musí zostať viditeľný vždy** (D5), scheduler a
  write-mode sa skladajú do `<details class="ovl-status-more">` s `● 2` (–32px),
- read-only pás: `min-height: 2rem`, `font-size: .8125rem` (–12px).
Výsledok cca 120px chrome namiesto 268px.

#### V37 — Trinásť filtrov = päť riadkov pilulek

**Dôkaz:** snímka 13 — filtre zaberajú od 375px do 515px, teda 140px, a hneď
pod nimi je ďalšie tlačidlo „+ Nová kampaň“.

**Riešenie:** pri `< 720px` filtre do vodorovného scroll pásu (jeden rad, snap),
pri `< 480px` do `<details class="ovl-filterbar"><summary>Filtre · všetky`
s počtom aktívnych. `+ Nová kampaň` prilepiť ako `.ovl-fab-row` pod filtre v
plnej šírke — jediné miesto v appke, kde je full-width tlačidlo správne.

#### V38 — Tabuľka scrolluje, ale odsekáva dáta bez afordancie a bez ukotveného stĺpca

**Dôkaz:** snímka 13 — hodnoty `03.08.2` / `19.08.2` sú odseknuté priamo na
hrane viewportu, nič nenaznačuje, že sa dá scrollovať; pri scrolle sa stratí
názov kampane (prvý stĺpec).

**Riešenie (dve alternatívy, rozhodnutie R9):**
- **(a)** `.ovl-table-wrap` dostane `mask-image: linear-gradient(to right,
  #000 calc(100% - 24px), transparent)` ako scroll fade + prvý stĺpec
  `position: sticky; left: 0; background: var(--ovl-surface)` s hairlinou
  vpravo — 12 riadkov CSS, žiadna zmena komponentov.
- **(b)** `.ovl-table--cards` pri `< 720px`: `thead {display:none}`,
  `tr` → karta, `td::before { content: attr(data-label) }` v eyebrow tvare.
  Vyžaduje, aby `Table.tsx` emitoval `data-label` z hlavičky stĺpca (~3 riadky).
Odporúčam **(a)** pre `Audit` (8 stĺpcov, prehľadové čítanie) a **(b)** pre
`Kampane` (5 riadkov, rozhodovacie čítanie).

#### V39 — Odkazy v tabuľke sú podčiarknuté a lámu sa na tri riadky

**Dôkaz:** snímka 13 — `Wolfrám −12 % (zmeškaná) #88` na tri riadky s
podčiarknutím pod každým z nich; percentá zlomené na `−12` / `%`.

**Riešenie:** `.ovl-table a { text-decoration-thickness: 1px;
text-underline-offset: 2px; text-decoration-color: color-mix(in oklab,
currentColor 40%, transparent) }` (podčiarknutie zostáva — je to odkaz —
ale prestane dominovať), `#88` do `--ovl-muted` `tabular-nums` na samostatnom
riadku pod názvom, `overflow-wrap: anywhere` len na názve, nie na čísle.

---

## Poznámka k snímkam

Čierny kruh s „N“ v ľavej časti snímok 01–13 je **dev overlay Next.js**
(`devIndicators`), nie prvok dizajnu. Na snímke 13 prekrýva obsah tabuľky.
Pre ďalšie vizuálne review ho treba vypnúť, inak sa bude opakovane hlásiť
ako chyba layoutu.

---

## Navrhovaná sada tokenov

Dvojvrstvový model: **`--aura-*`** sú nemenné primitívy rodiny (kopírovateľné
medzi appkami bez zmeny), **`--ovl-*`** sú sémantické tokeny tejto appky.
Názvy všetkých existujúcich `--ovl-*` tokenov sú **zachované**, takže
`globals.css` sa mení, ale komponenty nie.

### 1. Vrstva rodiny (nezávislá od témy)

```css
:root {
  /* teal */
  --aura-teal-900: #025C60;
  --aura-teal-700: #03797E;   /* výplň hlavičky, primárna akcia */
  --aura-teal-500: #05A3AA;
  --aura-teal-400: #05BCC4;   /* text a odkazy v dark mode */
  --aura-teal-tint: #E3F1F1;

  /* gold */
  --aura-gold-500: #D8B878;   /* hairline, ♛, eyebrow v darku */
  --aura-gold-600: #C9A869;
  --aura-gold-800: #8A6417;   /* eyebrow v lighte (kontrast 5,36:1) */
  --aura-gold-tint: #FBF4E6;

  /* papier a linky */
  --aura-paper-dark: #0E1413;
  --aura-paper-light: #F8F4F7;
  --aura-line-dark: #22302E;
  --aura-line-light: #E2DAE0;
  --aura-ink: #131B1A;
  --aura-dim: #667574;
}
```

### 2. Sémantická vrstva — LIGHT

```css
:root {
  color-scheme: light dark;

  --ovl-bg:            var(--aura-paper-light);   /* #F8F4F7 */
  --ovl-surface:       #FFFFFF;
  --ovl-surface-2:     #F1ECF1;                   /* thead, zebra, hover */
  --ovl-fg:            var(--aura-ink);           /* #131B1A */
  --ovl-muted:         #5A6B6A;                   /* 4,9:1 na bielej */
  --ovl-border:        var(--aura-line-light);    /* #E2DAE0 */
  --ovl-border-strong: #C9BDC8;

  --ovl-accent:        var(--aura-teal-700);      /* #03797E, 5,27:1 */
  --ovl-accent-hover:  var(--aura-teal-900);
  --ovl-accent-fg:     #FFFFFF;
  --ovl-accent-tint:   var(--aura-teal-tint);     /* výber, aktívny čip */
  --ovl-eyebrow:       var(--aura-gold-800);      /* #8A6417 */
  --ovl-hairline-gold: var(--aura-gold-600);

  /* pruh PRODUKCIA (D6) — samostatné tokeny, nie stavové */
  --ovl-production-bg: #B3261E;
  --ovl-production-fg: #FFFFFF;

  /* stavová paleta (D5, D14) — hue zámerne mimo teal aj gold */
  --st-critical:  #B3261E;   /* vyžaduje zásah teraz */
  --st-attention: #B45309;   /* nedokončené / neisté (hue 26°, nie gold) */
  --st-progress:  #5B4BC4;   /* práve prebieha */
  --st-good:      #2E7D32;   /* potvrdený vlastný zápis (hue 123°, nie teal) */
  --st-idle:      var(--ovl-muted);

  --ovl-shadow: 0 1px 2px rgb(19 27 26 / .05), 0 1px 3px rgb(19 27 26 / .07);
}
```

### 3. Sémantická vrstva — DARK (default rodiny)

Blok sa vypíše dvakrát — raz pre `@media (prefers-color-scheme: dark)`, raz pre
`:root[data-theme="dark"]`, aby prepínač vyhral v oboch smeroch.

```css
@media (prefers-color-scheme: dark) { :root { /* … obsah nižšie … */ } }
:root[data-theme="dark"]  { /* … obsah nižšie … */ }
:root[data-theme="light"] { /* … obsah bloku LIGHT … */ }
```

```css
  --ovl-bg:            var(--aura-paper-dark);    /* #0E1413 */
  --ovl-surface:       #141C1B;                   /* +1 stupeň elevácie */
  --ovl-surface-2:     #1A2422;
  --ovl-fg:            #E7EFED;
  --ovl-muted:         #93A5A3;                   /* 6,1:1 na surface */
  --ovl-border:        #263533;
  --ovl-border-strong: #31423F;

  --ovl-accent:        var(--aura-teal-400);      /* #05BCC4 text, 8,0:1 */
  --ovl-accent-fill:   var(--aura-teal-700);      /* výplň zostáva #03797E */
  --ovl-accent-hover:  #2ED0D6;
  --ovl-accent-fg:     #04211F;
  --ovl-accent-tint:   color-mix(in oklab, var(--aura-teal-400) 14%, var(--ovl-surface));
  --ovl-eyebrow:       var(--aura-gold-500);      /* #D8B878, 9,8:1 */
  --ovl-hairline-gold: var(--aura-gold-600);

  --ovl-production-bg: #C62F26;                   /* +luminancia, viď V8 */
  --ovl-production-fg: #FFF4F2;

  --st-critical:  #F08B82;
  --st-attention: #F0A95C;
  --st-progress:  #ADA0F5;
  --st-good:      #63C98A;
  --st-idle:      var(--ovl-muted);

  --ovl-shadow: none;   /* elevácia sa robí plochou, nie tieňom (V10) */
```

### 4. Derivované tinty a okraje (jedno pravidlo pre obe témy)

```css
:root {
  --st-critical-tint:  color-mix(in oklab, var(--st-critical) 12%, var(--ovl-surface));
  --st-critical-edge:  color-mix(in oklab, var(--st-critical) 42%, var(--ovl-surface));
  --st-attention-tint: color-mix(in oklab, var(--st-attention) 12%, var(--ovl-surface));
  --st-attention-edge: color-mix(in oklab, var(--st-attention) 42%, var(--ovl-surface));
  --st-progress-tint:  color-mix(in oklab, var(--st-progress) 12%, var(--ovl-surface));
  --st-progress-edge:  color-mix(in oklab, var(--st-progress) 42%, var(--ovl-surface));
  --st-good-tint:      color-mix(in oklab, var(--st-good) 12%, var(--ovl-surface));
  --st-good-edge:      color-mix(in oklab, var(--st-good) 42%, var(--ovl-surface));
}
```

### 5. Typografia, priestor, tvar

```css
:root {
  --ovl-font:         'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --ovl-font-display: 'Playfair Display', Georgia, 'Times New Roman', serif;
  --ovl-mono:         ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  --ovl-fs-eyebrow: .6875rem;   /* 11px, uppercase, ls .08em, --ovl-eyebrow */
  --ovl-fs-micro:   .75rem;     /* 12px */
  --ovl-fs-small:   .8125rem;   /* 13px */
  --ovl-fs-table:   .875rem;    /* 14px */
  --ovl-fs-body:    .9375rem;   /* 15px — nemení sa */
  --ovl-fs-h2:      1.125rem;   /* 18px sekčný nadpis mimo karty */
  --ovl-fs-h1:      1.5rem;     /* 24px — dnes 19,5px (V13) */
  --ovl-fs-stat:    1.75rem;    /* 28px — jediné veľké číslo (stat strip) */

  --ovl-lh-tight: 1.25;
  --ovl-lh-body:  1.5;
  --ovl-lh-table: 1.4;

  --ovl-s1: .25rem; --ovl-s2: .375rem; --ovl-s3: .625rem;
  --ovl-s4: .875rem; --ovl-s5: 1.25rem; --ovl-s6: 1.75rem;

  --ovl-radius:      10px;   /* dnes 8px */
  --ovl-radius-sm:   6px;
  --ovl-radius-pill: 999px;

  --ovl-max:      1100px;   /* formuláre, nastavenia */
  --ovl-max-wide: 1180px;   /* kampane, dry-run, audit */
  --ovl-max-auth: 720px;    /* login, onboarding */

  --ovl-header-h: 56px;
}
```

### 6. Mapovanie stavov na tóny (jedna tabuľka pravdy pre `StatusBadge`)

| tón | badge trieda | stavy kampane | stavy položky | ostatné |
| --- | --- | --- | --- | --- |
| critical | `.ovl-badge--critical` (+3px ľavý pruh, `●`) | `needs_key`, `missed` | — | kľúč chýba/expiroval, TTL ≤ 1 h, scheduler stale, `ZÁPISY ZAMKNUTÉ`, `shopStatus=not_found` |
| attention | `.ovl-badge--attention` (`▲`) | `partial`, `failed` | `failed`, `uncertain`, `interrupted`, `not_found`, `blocked` | TTL ≤ 6 h, price mismatch, varianty, read-only režim, `shopStatus=unknown` |
| progress | `.ovl-badge--progress` (animovaný pás) | `running` | — | — |
| good | `.ovl-badge--good` (`✓`) | `done`, derivovaná `aktivna` | `ok` | `verifyStatus=valid`, TTL > 6 h |
| idle | `.ovl-badge--idle` (`○`) | `scheduled`, `draft`, `cancelled`, `lapsed`, derivovaná `expirovana` | `pending`, `skipped` | `shopStatus=ok` (nekresliť badge vôbec), `ZÁPISY VYPNUTÉ (dev)` |

Staré názvy `--ok/--warning/--danger/--neutral/--outline` ponechať ako aliasy,
aby sa nemuselo prepisovať 40 miest naraz:
`.ovl-badge--ok{@apply good}`-ekvivalent = duplikované deklarácie v CSS.

---

## Rýchle výhry

Zoradené podľa pomeru efekt / práca. **Body 1–9 sú výhradne CSS v
`globals.css`** — žiadny `.tsx` súbor sa nemení, žiadny test sa nedotkne.

| # | Zmena | Rieši | Rozsah |
| --- | --- | --- | --- |
| 1 | `.ovl-btn { text-decoration: none }` | podčiarknuté „+ Nová kampaň“, „Zrušiť“, „Otvoriť detail“ (04, 06, 07) | 1 riadok |
| 2 | `:where(input, select, textarea)` base + `accent-color` + `:focus-visible` prsteň | celá appka prestane vyzerať natívne (01, 02, 06–11) | ~20 riadkov |
| 3 | `.ovl-num, .ovl-money, .ovl-pct { white-space: nowrap }` | `2 450,00 €` na 3 riadky (09), `−12 %` na 2 (04, 13) | 1 riadok |
| 4 | `.ovl-stack { align-items: flex-start }` + `.ovl-btn { align-self: start }` | 1065px „Zopakovať zlyhané“ (05), 630px „Obnoviť z shopu“ (09) | 2 riadky |
| 5 | `.ovl-header-inner` → `grid: auto 1fr auto`, `min-height: 56px` | badge padajúce na druhý riadok (všetky snímky) | 4 riadky |
| 6 | `h1..h4 { font-size: inherit; font-weight: inherit; margin: 0 }` + `.ovl-page-title` / `.ovl-section-title` | `h2` väčší než `h1` (05, 08) | 8 riadkov |
| 7 | `.ovl-allowlist-grid { grid-auto-rows: 1fr }` + `.ovl-product-card { min-height: 7rem }` | zubatá mriežka (03, 12) | 2 riadky |
| 8 | `thead th { background: var(--ovl-surface-2); position: sticky; top: 0 }` | hlavička odchádza pri scrolle (09, 10) | 3 riadky |
| 9 | `.ovl-pick:has(input:checked)` teal tint | nulová odozva výberu produktov (07) | 5 riadkov |
| 10 | Token bloky (sekcia vyššie) + teal lišta + `♛` + gold eyebrow | V1, V2, V4, V6, V7 — appka vstúpi do rodiny | ~120 riadkov CSS + 2 riadky v `layout.tsx` |
| 11 | `--st-*` paleta a `StatusBadge` mapovanie (tabuľka vyššie) | V18, V19, V22 — farba začne znamenať „čo mám robiť“ | ~40 riadkov CSS + 1 tabuľka v `StatusBadge.tsx` |
| 12 | `ErrorMessage` prop `tone` + mapovanie v `ItemsTable` | V20 — `preskočený` prestane byť červený | ~15 riadkov |
| 13 | Self-hostované Inter (`public/fonts/*.woff2`, subset `latin-ext`) + `@font-face` | V3 — bez zmeny `package.json` (O7) | 3 súbory + 12 riadkov CSS |

Odhad: body 1–9 sú jedno sedenie a už samé odstránia väčšinu dojmu
„nedokončené“. Body 10–13 sú vlastný redizajn.

---

## Vyžaduje rozhodnutie používateľa

### R1 — Dark mode ako default?

Rodina má dark default, ale táto appka má poplašný červený pruh a stavové badge,
ktorých výraznosť je bezpečnostná funkcia (V8).

- **(a) Dark default + „Light pill“** — plná konzistencia s rodinou. Pruh
  PRODUKCIA v darku podľa V8 (#C62F26 + gold hairline + červený rozptyl).
- **(b) Light default v tejto jednej appke, dark dostupný** — argument:
  saturovaná červená na svetlom pozadí je najsilnejší možný alarm; appka je
  jediná v rodine, ktorá zapisuje do produkcie.
- **(c) Bez defaultu — riadiť sa `prefers-color-scheme`**, prepínač len
  ako override.
- **(d) Dark default, ale pruh PRODUKCIA vždy v light-mode saturácii**
  (jediný prvok, ktorý tému ignoruje).

*Moje odporúčanie:* (a) s riešením z V8. Ak je pochybnosť o výraznosti pruhu,
(d) je bezpečný kompromis.

### R2 — Poradie a podoba pruhu PRODUKCIA vs. teal lišta rodiny

- **(a) Červený pruh navrchu, teal lišta pod ním** (dnešné poradie) — alarm má
  absolútnu prioritu, brand je druhý.
- **(b) Teal lišta navrchu, červený pruh hneď pod ňou** — silnejšia príslušnosť
  k rodine, pruh je stále trvalo viditeľný nad obsahom.
- **(c) Jedna teal lišta so 6px červeným ľavým okrajom a červeným chipom
  domény** — najelegantnejšie, ale **oslabuje D6** (viď K7).
- **(d) Červený pruh + trvalý 3px červený rám celého viewportu, keď
  `writesEnabled=true`** — najsilnejší signál „ostrý režim“, novinka nad D6.

*Moje odporúčanie:* (a). Rodinu zabezpečí teal lišta hneď pod pruhom + gold
hairline, ktorý oba pásy zviaže.

### R3 — Ako často zobrazovať plné znenie D7 („podľa vlastného zápisu…“)

Dnes 9× na dashboarde, 9× vo formulári, 3× v dry-run tabuľke (V17).

- **(a) Nechať plné znenie všade** (status quo) — maximálna doslovná zhoda s D7,
  najhoršia čitateľnosť.
- **(b) Plné znenie raz ako legenda sekcie + na položkách skrátený badge
  `vlastný zápis 05.08.` s plným znením v `title` a `aria-label`.**
- **(c) Na položkách len ikona/marker + plné znenie v tooltipe, legenda raz.**
- **(d) Hybrid: plné znenie v tabuľkách (kde je miesto), skrátené v kartách a
  formulároch.**

*Moje odporúčanie:* (b). Plné znenie zostane na obrazovke aj v prístupnostnom
strome, len prestane byť 9× zopakované. **Vyžaduje potvrdenie, že to nie je
porušenie D7** (viď K1).

### R4 — Ako často zobrazovať disclaimer D4 („orientačný výpočet appky…“)

Dnes 7 výskytov tej istej myšlienky na jednej dry-run obrazovke (V17).

- **(a) V každej buňke** (status quo).
- **(b) Raz plné znenie pod hlavičkou tabuľky + `≈` marker s `title` pri každej
  vypočítanej hodnote.**
- **(c) V každej buňke, ale len ako `≈` s `title`, plné znenie raz pod
  tabuľkou.**
- **(d) V každej buňke pri jednorazových zobrazeniach (detail, potvrdenie),
  raz pri tabuľkách s 3+ riadkami.**

*Moje odporúčanie:* (b). **Vyžaduje potvrdenie voči formulácii D4 „vždy“**
(viď K2).

### R5 — Zelená pre `scheduled` (naplánovaná)

- **(a) `scheduled` → idle (neutrál)** — farba sa uvolní pre veci, ktoré
  niečo znamenajú. *Odporúčam.*
- **(b) `scheduled` → progress (indigo)** — „je to v pohybe, len ešte nezačalo“.
- **(c) Ponechať good/zelenú** — najmenšia zmena, ale zostáva zámena
  s „zapísaná“.
- **(d) Zelená + prázdny krúžok `○` namiesto `✓`** — farba rovnaká, tvar iný.

### R6 — Ako maľovať `ZÁPISY VYPNUTÉ (dev)`

Dnes žltý warning, hoci ide o najbezpečnejší stav (V22).

- **(a) idle/neutrál s prefixom `● dev`** — prestane súťažiť s pruhom.
- **(b) Vlastný „mode“ tón v teal** (je to informácia o režime appky, nie stav
  dát) — ale kolíduje s pravidlom „teal nikdy nie je stav“.
- **(c) Ponechať warning** — argument: chce sa vedieť, že appka *nie je* v
  ostrom režime, aby sa človek nespoliehal na test.
- **(d) idle badge + jednorazová `.ovl-note` na dashboarde
  „appka je v dev režime, nič sa nezapíše“.**

### R7 — Dátumové polia `mm/dd/yyyy` (rozpor s D13, V29)

- **(a) Natívny picker + SK echo `06.08.2026` vedľa poľa** — malá práca,
  splní D13 pre zobrazenie, zachová natívny kalendár. *Odporúčam ako prvý krok.*
- **(b) Vlastné SK pole:** textový input s maskou `DD.MM.YYYY` +
  `<input type="date">` ako skrytá vrstva pre picker. Plná kontrola, viac práce,
  vlastná validácia.
- **(c) Tri oddelené polia D / M / R** — bez pickeru, ale bez akejkoľvek
  nejednoznačnosti.
- **(d) Ponechať a spoľahnúť sa na jazyk prehliadača `sk-SK`** — najkrehkejšie;
  na inom počítači je appka opäť v `mm/dd/yyyy`.

### R8 — Text pruhu PRODUKCIA na mobile

Dnes sa láme na dva riadky a zaberá 48px zo 674px (V36).

- **(a) Skrátiť pri `< 560px` na `PRODUKCIA · <doména>`**, plná veta v
  `aria-label`/`title`.
- **(b) Ponechať plnú vetu, zmenšiť na 13px / `line-height: 1.25`** (dva
  riadky, ale nižšie).
- **(c) Ponechať bez zmeny** — D6 nadovšetko.
- **(d) Plná veta v jednom riadku s `overflow: hidden; text-overflow: ellipsis`**
  — neodporúčam, skrátila by sa práve doména.

### R9 — Tabuľky na mobile

- **(a) Sticky prvý stĺpec + scroll fade maska** (CSS-only, zachová tabuľkový
  charakter).
- **(b) Kartový režim `.ovl-table--cards` s `data-label`** (najlepšia
  čitateľnosť, vyžaduje ~3 riadky v `Table.tsx`).
- **(c) Priorita stĺpcov — pri `< 720px` skryť `Režim` a `Položky`**
  s možnosťou rozbaliť riadok.
- **(d) Kombinácia: (b) pre Kampane, (a) pre Audit.** *Odporúčam.*

### R10 — Fonty

- **(a) Inter na všetko** (vrátane wordmarku) — najčistejšie pre dátový nástroj.
- **(b) Inter + Playfair Display len na wordmark a `h1`** — prítomnosť rodiny
  bez dopadu na čitateľnosť dát. *Odporúčam.*
- **(c) Geist + Playfair** ako v sesterských appkách — vyžaduje overiť, či Geist
  má kompletné `latin-ext` diakritiky pre `ľ ť ŕ`.
- **(d) Ponechať `system-ui`** a brand riešiť len farbou.

Poznámka ku všetkým variantám: subset **`latin-ext` je povinný** a fonty
odporúčam **self-hostovať** v `public/fonts/` (O7 zakazuje meniť
`package.json`; `next/font/google` navyše ťahá súbory zo siete pri builde).

### R11 — Symbol koruny `♛`

- **(a) Pred wordmarkom v gold** (`♛ Aura Zľavy`) — konzistentné s rodinou.
  *Odporúčam.*
- **(b) Ako samostatný znak vľavo, oddelený gold hairlinou** od wordmarku.
- **(c) Vynechať** — argument: ľavý horný kút už patrí červenému pruhu a
  ozdoba by v produkčnom nástroji pôsobila nemiestne.
- **(d) `♛` len v `<title>` prehliadača a favicone**, nie v UI.

### R12 — Šírka obsahu

- **(a) 1100px všade** (status quo) — dry-run so 7 stĺpcami zostane stlačený.
- **(b) 1180px pre dátové stránky, 1100px pre formuláre, 720px pre
  login/onboarding.** *Odporúčam.*
- **(c) Tekutá šírka do 1440px pre audit** — najviac dát naraz, ale dlhé riadky
  sa horšie čítajú.
- **(d) 1100px + zúženie dry-run tabuľky podľa V26** (bez zmeny šírky).

---

## Koliduje s existujúcim rozhodnutím

Nič z tohto nie je návrh na zmenu rozhodnutia — je to zoznam miest, kde
vizuálne zlepšenie **nemôže** pokračovať bez výslovného „áno“.

### K1 — D7 vs. skrátenie badge vlastného zápisu (R3)

**D7 znie:** *„Pri každom produkte MUSÍ byť badge »podľa vlastného zápisu z
DD.MM. — shop môže mať iný stav«“*, potvrdené aj I11.
Návrh V17/R3(b) ponecháva badge na každom produkte, ale jeho **viditeľný text**
skracuje na `vlastný zápis 05.08.` a plnú vetu nesie `title` + `aria-label`
+ jedna legenda na sekciu.
**Otázka:** je „badge s plným znením v tooltipe a legendou nad sekciou“ splnením
D7, alebo D7 vyžaduje plné znenie ako viditeľný text pri každej položke?
Bez rozhodnutia zostáva variant (a) — plné znenie všade.

### K2 — D4 vs. jedno znenie disclaimeru na tabuľku (R4)

**D4 znie:** *„UI MUSÍ zobraziť vypočítanú zľavnenú cenu … **vždy** s
upozornením »orientačný výpočet appky; zaokrúhlenie shopu sa môže líšiť«“*.
`PriceHint.tsx` to má dokonca zabetónované v komentári: *„Upozornenie sa NESMIE
vynechať — je súčasťou komponentu, nie voľba.“*
Návrh V26/R4(b) drží znenie raz na obrazovku a pri hodnotách používa `≈` marker
s `title`.
**Otázka:** platí „vždy“ na *každý výskyt hodnoty*, alebo na *každú obrazovku,
kde sa hodnota zobrazí*? Bez rozhodnutia zostáva stav quo (7 výskytov na
dry-run obrazovke).

### K3 — D13 vs. dátumové polia a vs. skracovanie roku

Dva samostatné body:
1. **Dnešný stav už D13 porušuje** — `<input type="date">` renderuje
   `mm/dd/yyyy` (snímky 06, 07, 10). Nie je to regresia redizajnu, ale existujúci
   rozpor, ktorý redizajn zviditeľňuje. Riešenie je R7 a **treba ho rozhodnúť
   bez ohľadu na zvyšok vizuálu.**
2. Zvažoval som skrátiť rozsahy na `03.08. – 19.08.2026` (rok raz), čo by
   ušetrilo 8ch v každom tabuľkovom riadku. **Zamietam to** ako rozpor s D13
   („všetky dátumy vo formáte DD.MM.YYYY“). Namiesto toho `nowrap` +
   `min-width: 17ch` (V24). Ak by bola úspora šírky priorita, potrebuje to
   výslovnú výnimku z D13.

### K4 — D14 „farebné badge“ vs. neutrálne informačné stavy (R5)

**D14 znie:** *„Zoznam kampaní MUSÍ zobrazovať plnú sadu stavov … ako **farebné
badge** s filtrom.“*
V18 navrhuje presunúť `scheduled`, `draft`, `cancelled`, `lapsed`, `expirovana`
do tónu **idle** (šedá na `--ovl-surface-2`) — šedá sa dá vykladať ako „nie
farebné“.
**Otázka:** je požiadavka „farebné badge“ splnená tým, že badge existuje ako
vizuálne odlíšený objekt a farbu nesú stavy, ktoré niečo vyžadujú? Alternatíva
R5(d) drží zelenú a rozlišuje tvarom — zachová doslovnosť D14, ale ponechá
zámenu „naplánovaná = úspech“.

### K5 — D8 / D33b: `needs_key` a `missed` musia mať rovnakú vizuálnu váhu

**Explicitne v `globals.css:215` aj v `AlertsBanner.tsx`:** *„ROVNAKÁ vizuálna
váha … žiadna hierarchia medzi nimi“*.
**Dôsledok pre redizajn:** akékoľvek „zlepšenie“ typu rozdeliť banner na dve
karty, zoradiť podľa naliehavosti, dať `missed` inú farbu alebo `needs_key`
väčší nadpis **je porušenie**. V11/Tier 0 to rešpektuje — jeden banner, jeden
zoznam, jeden tón, jedno počítadlo `(2)`.
Zaznamenávam to ako obmedzenie, nie ako otvorenú otázku.

### K6 — D10 „nenápadná výzva v hlavičke“ vs. full-bleed read-only pás

**D10 znie:** *„… zapisovacie akcie disabled s tooltipom + **nenápadná** výzva
v hlavičke“*.
V17/„Ostatné hustotné pozorovania“ navrhuje pás vytiahnuť z `.ovl-main` na plnú
šírku pod hlavičku, aby prestal „visieť v ničom“ (snímky 01, 02, 12). To ho robí
**nápadnejším**.
**Otázka:** je full-bleed 32px pás v tóne attention ešte „nenápadná výzva“, alebo
má zostať 1100px široký a odsadený? Kompromis: full-bleed, ale bez tintu — len
`border-top: 2px solid var(--st-attention)` a text v `--ovl-muted`.

### K7 — D6 „trvalý červený pruh“ vs. varianty R2(c)/R8

- **R2(c)** (jedna teal lišta s červeným okrajom a chipom) mení „pruh“ na
  „akcent“ — to je podľa mňa **porušenie D6** a uvádzam ho len pre úplnosť.
- **R8(a)** (skrátenie textu na mobile) nemení existenciu pruhu, ale mení jeho
  **text**. D6 predpisuje znenie „PRODUKCIA — sperky-eshop.sk“ a „každé
  potvrdenie MUSÍ obsahovať vetu o nevratnosti“ — veta o nevratnosti je teda
  viazaná na *potvrdenia*, nie na pruh, takže skrátenie pruhu na mobile pôsobí
  prípustne. **Chcem to potvrdené.**
- **Dark mode** (R1): každé zosvetlenie/odsaturovanie pruhu je zásah do funkcie
  D6. Návrh vo V8 luminanciu naopak zvyšuje.

### K8 — D5 „trvalý badge TTL v hlavičke na každej stránke“ vs. skladanie badge na mobile

**D5 znie:** *„Odpočet TTL kľúča MUSÍ byť trvalý badge v hlavičke na **každej**
stránke a pod 6 h MUSÍ zmeniť farbu na výstražnú.“*
V36 navrhuje na mobile poskladať stavové badge do `<details>`, aby chrome
neujedol 37 % výšky. **TTL badge sa skrývať nesmie** — návrh preto skladá len
`SchedulerBadge` a `WriteModeBadge`. Zaznamenávam ako obmedzenie.
Druhá časť D5 („pod 6 h výstražná farba“) je splnená mapovaním
TTL ≤ 6 h → `attention`, TTL ≤ 1 h → `critical` (`KeyTtlBadge.tsx:50` už tieto
tri stupne má).

### K9 — I11 vs. čisto farebné odlíšenie „vlastný zápis“ od „stav shopu“

`.ovl-selfwrite` dnes nesie **tri** nefarebné signály: prerušovaný okraj,
kurzívu a menšie písmo (`globals.css:131–141`). Presne to robí rozdiel
„naša evidencia“ vs. „tvrdenie o shope“ rozpoznateľným aj bez farby a
`docs/13-OVERENIE.md:448` to výslovne chváli.
**Obmedzenie pre redizajn:** akékoľvek zjednotenie badge do jedného vzhľadu
musí prerušovaný okraj **a** kurzívu ponechať. Skrátenie textu (R3) je iná vec
než zjednotenie formy — formu neodporúčam meniť vôbec.

### K10 — O7: `package.json` sa nesmie meniť

Bráni to `next-themes`, `tailwind`, `@fontsource/*` aj akejkoľvek CSS knižnici.
Celý návrh je preto postavený na: čistom CSS v jedinom `globals.css`,
`color-mix()`, `:has()`, `@media (prefers-color-scheme)`, `localStorage` a
self-hostovaných `.woff2` v `public/fonts/`. Žiadna nová závislosť.
Zaznamenávam ako obmedzenie — ak by sa niekedy uvažovalo o Tailwinde, je to
zmena O7, nie dizajnové rozhodnutie.
