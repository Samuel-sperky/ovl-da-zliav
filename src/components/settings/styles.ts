/**
 * Aura Zľavy — geometria stránky Nastavenia (V12; predloha
 * `design/v3/nastavenia.html`).
 *
 * Predloha má tieto pravidlá v lokálnom `<style>` bloku stránky, nie
 * v spoločnom systéme — sú to rozmery jednej obrazovky, nie komponenty.
 * Držíme sa toho aj tu, a to z jedného konkrétneho dôvodu: `globals.css`
 * vlastní iný agent (V2) a výhradné vlastníctvo súborov je jediná vec, ktorá
 * dovoľuje písať obrazovky paralelne. Preto sa tento blok vkladá ako `<style>`
 * priamo do stránky.
 *
 * Nič tu nesmie predefinovať spoločný systém — len dopĺňa mriežky, ktoré
 * existujú výlučne v Nastaveniach. Politika obsahu stránky inline štýly
 * povoľuje (`style-src 'self' 'unsafe-inline'` v `Caddyfile.example`).
 *
 * Farby sa berú VÝHRADNE z premenných systému, takže tmavá téma funguje
 * automaticky a nie je tu ani jedna natvrdo napísaná farba.
 *
 * KTO TENTO BLOK OD V6b JEŠTE VKLÁDÁ
 * ----------------------------------
 * Už len `SettingsSubPage.tsx`. **Rozcestník ho nevkladá** — prešiel na
 * primitíva `PageHeader` + `Panel` a jeho geometria žije v
 * `settings-index.module.css` (D143). Jeho triedy sú odtiaľto ZMAZANÉ v tom
 * istom kroku (D139): `.set-lead`, `.set-cards`, `.set-card`, `.card-lead`,
 * `.card-in`, `.card-state`, `.card-word`. Na ich mieste zostali komentáre
 * s tým, kam sa presunuli — mŕtvy selektor by pri ďalšej oprave vyzeral ako
 * to, čo obrazovku kreslí (K11).
 *
 * `.set-page` a `h1.page` zostávajú ZÁMERNE: kreslí ich ešte podstránka,
 * ktorá na primitíva prechádza samostatne. Kto ju prevedie, zmaže ich s ňou —
 * dovtedy to nie je mŕtve CSS, ale živý rám druhej obrazovky.
 *
 * DRUHÝ ODCHOD: POISTKY A KĽÚČE (V6b, krok 3/3)
 * ---------------------------------------------
 * Na `Panel` prešli štyri sekcie — Kľúče, Zápisy do eshopu, Poistky a Červená
 * zóna — a ich geometria je v `settings-sections.module.css` (D143). Zmazané
 * sú preto triedy, ktoré po prevode nekreslí UŽ NIKTO (D139):
 * `.set-pill-row` (Zápisy), `.danger-zone`, `.dz-row` a `.dz-a` (Červená
 * zóna). K nim tri, ktoré mŕtve boli už predtým a prevod to len odhalil:
 * `.split` a `.anchor-grp` / `.anchor-grp-t` — `class="split"` ani
 * `class="anchor-grp"` nevykresľuje v `.set-page` ani jeden komponent
 * (bočný stĺpec kotiev zanikol s rozcestníkom). Overené grepom nad `src/`.
 *
 * Čo NEODIŠLO a prečo: `.kv`, `.set-form`, `.set-note`, `.set-w`, `.stack`,
 * `.set-jump`, `.locked-list`, `.audit-scroll`, `.tbl*` aj `.sec` kreslia
 * ďalej sekcie, ktoré na primitíva neprešli (Pripojenie, Rozsah, Rozpočty,
 * Obohacovanie, História, Zamknuté funkcie) a formuláre vnútri prevedených
 * sekcií. Mazať ich podľa toho, že „tá sekcia je hotová", by zhaslo vzhľad
 * susednej obrazovky bez toho, aby čokoľvek spadlo.
 *
 * Vlastník: V12 (rozcestník odišiel do modulu: V6b; Poistky a kľúče: V6b).
 */

export const SETTINGS_CSS = `
.set-page h1.page{font-size:15px;font-weight:640;margin-bottom:4px}
/* Trieda .set-lead (veta pod nadpisom ROZCESTNÍKA) tu stála do V6b. Rozcestník
   prešiel na PageHeader + Panel a jeho vetu kreslí prop "description" tej
   hlavičky (vzhľad v ui/frame.module.css, D143) — a POZOR, tento reťazec je
   šablónový literál, spätné apostrofy sa doň nedajú. Tu po nej nesmie zostať ani
   riadok — mŕtvy selektor by pri ďalšej oprave vyzeral ako to, čo obrazovku
   kreslí (D139, K11). Podstránky vetu nekreslia vôbec (viď SettingsSubPage). */
/* Rytmus podstránky. 14 px bolo VIAC než 12 px spoločného systému — pri
   piatich sekciách na jednej stránke to je 60 px odstupov navyše proti
   zvyšku appky. 10 px drží sekcie oddelené a stránku pod stropom P4. */
.set-page .sec + .sec{margin-top:10px}
.set-page .sec[id]{scroll-margin-top:72px}
/* Nadpis skupiny sekcií. Nie je to karta — je to popiska nad kartami, preto
   nemá rám ani pozadie; jediné, čo robí, je oddelenie otázok od seba.
   Farba je var(--ink), nie var(--dim). Pod týmto nadpisom stojí popisok sekcie
   (.sec-h h2 v globals.css, D2) a ten má var(--ink2) — s var(--dim) bol
   NADRADENÝ popisok tlmenejší než podradený a hierarchia sa čítala opačne.
   Tri roly popiskov idú od najsilnejšej: var(--ink), var(--ink2), var(--dim).
   Ticho sa tu pokazí presne toto: obe farby sú sivé, rozdiel je len v jase,
   takže zámena nič nezhodí a nikto si ju nevšimne inak než porovnaním. */
.set-page .set-grp{font-size:11px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink);margin:14px 0 6px}
.set-page .set-grp:first-of-type{margin-top:12px}
/* Triedy .anchor-grp a .anchor-grp-t (skupiny kotiev v bočnom stĺpci) tu stáli
   do V6b. Bočný stĺpec zanikol už s rozcestníkom na podstránky a od vtedy ich
   nekreslil ani jeden komponent — grep nad src/ nenašiel ani jedno použitie.
   Mŕtve boli teda skôr, prevod ich len odhalil (D139, K11). */
/* Odkaz „prejsť tam" v bunke tabuľky — text, nie tlačidlo: v hustej tabuľke
   by päť tlačidiel pod sebou prekričalo samotné vety. */
.set-page .set-jump{font-size:12px;color:var(--accent);text-decoration:none;
  border-bottom:1px solid transparent}
.set-page .set-jump:hover{border-bottom-color:currentColor}
/* Dva rozpočtové prúžky vedľa seba. Zápisy a čítania sú oddelené kvóty a
   obrazovka to má ukázať aj rozložením, nie len textom. */
.set-page .set-meters{display:grid;grid-template-columns:1fr 1fr;gap:14px 20px;
  margin:10px 0 12px;align-items:start}
/* Trieda .set-pill-row (pilulka spojenia a veta k nej) tu stála do V6b. Sekcia
   Zápisy do eshopu prešla na Panel a riadok kreslí .pillRow
   v settings-sections.module.css (D143). Tu po nej nesmie zostať ani riadok —
   mŕtvy selektor by pri ďalšej oprave vyzeral ako to, čo obrazovku kreslí
   (D139, K11). */
/* Hlavička sekcie sa na úzkej obrazovke zalomí a dlhý popis tlačidla s ňou —
   inak by jediné dlhé tlačidlo vytlačilo celú stránku doboku. */
.set-page .sec-h{flex-wrap:wrap}
.set-page .sec-h .ovl-btn{white-space:normal;text-align:left;max-width:100%}
/* Popis — hodnota — vysvetlenie: tri stĺpce jedného riadku.
   PREČO HODNOTA NEDOSTÁVA „1fr" (oprava 24. 8. 2026)
   Stredný stĺpec bol „1fr" a tretí „auto". Hodnota tak stála pri ľavom okraji
   672 px širokej bunky a vysvetlenie až za ňou, pri pravom kraji stránky:
   medzi „200 na deň" a „znížiť ho zatiaľ vie len správca appky" ostávalo
   693 px prázdna. Oko muselo prejsť pol obrazovky, aby tie dva údaje spojilo,
   a pri troch riadkoch pod sebou sa strácalo, ktoré vysvetlenie patrí ku
   ktorému číslu.
   Teraz je hodnotový stĺpec „max-content" — široký presne na najdlhšiu
   hodnotu, takže hodnoty stále stoja pod sebou v jednej línii — a „1fr"
   dostal až stĺpec s vysvetlením, ktoré sa tým prisunie tesne za hodnotu.
   Ticho sa tu pokazí presne toto: keby sa stredný stĺpec vrátil na „1fr",
   diera je späť a nespadne pri tom nič — je to iba prázdne miesto, ktoré
   žiadny test na obsah nevidí. Stráži to „nastavenia-suvislost.spec.ts". */
.set-page .kv{display:grid;
  grid-template-columns:190px minmax(0,max-content) minmax(0,1fr);
  gap:6px 14px;align-items:center;font-size:13px}
.set-page .kv .k{color:var(--dim);font-size:12px}
.set-page .kv .v{color:var(--ink);font-weight:600;min-width:0;overflow-wrap:anywhere}
/* Zamknuté funkcie: funkcia a to, čo jej chýba, na jednom riadku.
   Bola to rámovaná tabuľka s hlavičkou „Funkcia / Chýba" — 192 px na štyri
   dvojice slov. Hlavičku nesie teraz samotný riadok („chýba …"), takže sa
   nestratilo nič, len rám a jeden riadok verzálok. Ostáva to na tejto
   obrazovke a na povrchu: je to JEDINÉ miesto v appke, kde appka hovorí, čo
   z eshopu nedostane, a pod rozklik nesmie (kontrakt bod 18). */
.set-page .locked-list{display:grid;
  grid-template-columns:minmax(0,max-content) minmax(0,1fr);
  gap:4px 14px;align-items:baseline;font-size:13px}
.set-page .locked-list .lf-f{color:var(--ink);font-weight:600}
.set-page .locked-list .lf-m{color:var(--dim);font-size:12px}
.set-page table.tbl.plain td{white-space:normal}
.set-page table.tbl td.act{text-align:right;white-space:nowrap}
/* Trieda .split (obsah a úzky bočný panel vedľa seba) tu stála do V6b a
   nekreslila nič: class="split" nemá v .set-page ani jeden komponent, jediný
   podobný názov v appke je .catalog-split na Produktoch a ten má vlastné
   pravidlo. Bola mŕtva, nie budúca (D139, K11). */
.set-page .stack{display:flex;flex-direction:column;gap:8px}
/* Triedy .danger-zone, .dz-row a .dz-a tu stáli do V6b. Červená zóna prešla na
   Panel a jej červený rám, riadky aj odsadenie rozkliku žijú v
   settings-sections.module.css (.danger, .dangerRow, .dangerAct, D143). Tu po
   nich nesmie zostať ani riadok — mŕtvy selektor by pri ďalšej oprave vyzeral
   ako to, čo obrazovku kreslí (D139, K11). POZOR: .dz-link a .dz-open ZOSTÁVAJÚ,
   kreslí ich SettingsSubPage (odkaz do zóny a rozklik pred ňou). */
/* Okno histórie. 340 px bolo pri piatich sekciách na jednej podstránke
   nesplatiteľné: „Čo sa už stalo a ako appku zastaviť" merala 1772 px, teda
   1,97 obrazovky proti stropu P4 (1,5). História má 21 strán a vlastné
   stránkovanie, takže okno je aj tak výrez — kratší výrez neuberá ani jeden
   záznam, len skráti skrolovaciu plochu. Zmenšenie stropu P4 nepokrylo samo;
   ide ruka v ruke s presunom technických tabuliek pod rozklik (P6). */
.set-page .audit-scroll{max-height:190px}
/* Filtre histórie: popiska vedľa poľa, nie nad ním. Štyri polia s popiskou
   nad sebou merali 89 px — na obrazovke, ktorá má päť sekcií a strop 1,5
   obrazovky, je to celý jeden záznam histórie navyše. Platí len tu; formuláre
   inde v Nastaveniach (doména, kľúč) si popisky nad poľom nechávajú,
   lebo tam sa vypĺňa, kým tu sa len prepína. */
.set-page #historia form.row .field{display:flex;flex-direction:row;
  align-items:center;gap:8px;margin-bottom:0}
.set-page #historia form.row .field>.lb{margin:0;white-space:nowrap}
.set-page #historia form.row{gap:8px}
.set-page #historia .tbl-frame.gap-t{margin-top:8px}
.set-page .set-form{display:flex;flex-direction:column;gap:6px;margin-top:8px;
  border-top:1px solid var(--line);padding-top:8px}
.set-page .set-form .row{flex-wrap:wrap}
.set-page .set-note{font-size:12px;color:var(--dim);line-height:1.5}
.set-page .set-note b{color:var(--ink2);font-weight:600}
.set-page .inp{max-width:100%}
.set-page .set-w{max-width:320px}
/* Bočný panel je úzky — mriežka kľúč/hodnota v ňom potrebuje menej miesta. */
.set-page .ovl-drawer .kv{grid-template-columns:110px 1fr auto;gap:4px 10px}
.set-page .ovl-drawer pre.mono{white-space:pre-wrap;overflow-wrap:anywhere}

/* ─────────────────── Rozcestník: štyri karty (bod 13) ──────────────────── */
/* Triedy .set-cards, .set-card, .card-lead, .card-in, .card-state a .card-word
   tu stáli do V6b. Rozcestník prešiel na primitíva PageHeader + Panel a jeho
   mriežka, karta aj stavový riadok žijú v settings-index.module.css (D143) —
   vrátane pásiem „subgrid", ktoré držia štyri stavy v jednej línii, a
   vysvetlenia, prečo to nie je „margin-top:auto". Tu po nich nesmie zostať ani
   riadok: mŕtvy selektor by pri ďalšej oprave vyzeral ako to, čo obrazovku
   kreslí (D139, K11). Mriežku a pásma stráži „nastavenia-suvislost.spec.ts",
   ktorý ich odteraz čita z modulu, nie z tohto reťazca. */

/* ─────────────────── Podstránka: návrat a hlavička ─────────────────────── */
/* Trieda .sub-back (odkaz „← Nastavenia") tu stála do V6. Nahradila ju
   omrvinková cesta a jej vzhľad žije v ui/breadcrumb.module.css (D143), takže
   tu po nej nesmie zostať ani riadok — mŕtvy selektor by pri ďalšej oprave
   vyzeral ako to, čo obrazovku kreslí (D139, K11).
   POZOR: tento reťazec je šablónový literál, spätné apostrofy sa doň nedajú. */
/* Odkaz do červenej zóny stojí sám na spodku brzdovej podstránky — nie je to
   karta a nesmie tak ani vyzerať. */
.set-page .dz-link{margin-top:12px;font-size:12px;color:var(--dim)}
.set-page .dz-link a{color:var(--st-critical);text-decoration:none;
  border-bottom:1px solid transparent}
.set-page .dz-link a:hover{border-bottom-color:currentColor}
/* Rozklik pred červenou zónou (bod 14). Zatvorený je to jeden riadok. */
.set-page .dz-open>summary{cursor:pointer;font-size:12.5px;font-weight:600;
  color:var(--st-critical);padding:4px 0}
.set-page .dz-open[open]>summary{margin-bottom:10px}

@media (max-width:760px){
  /* .split a .dz-a tu stáli do V6b — prvá bola mŕtva, druhá odišla do
     settings-sections.module.css, kde má vlastné mobilné pravidlo (D139). */
  .set-page .set-meters{grid-template-columns:1fr}
  .set-page .kv{grid-template-columns:1fr;gap:2px}
  .set-page .kv .k{margin-top:8px}
  .set-page .set-w{max-width:100%}
}
`;

export default SETTINGS_CSS;
