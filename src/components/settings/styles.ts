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
 * Vlastník: V12.
 */

export const SETTINGS_CSS = `
.set-page h1.page{font-size:15px;font-weight:640;margin-bottom:4px}
.set-page .set-lead{font-size:12.5px;color:var(--dim);line-height:1.55;
  margin-bottom:12px;max-width:70ch}
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
.set-page .anchor-grp{display:flex;flex-direction:column;gap:1px}
.set-page .anchor-grp + .anchor-grp{margin-top:8px}
.set-page .anchor-grp-t{font-size:10.5px;font-weight:700;letter-spacing:.07em;
  text-transform:uppercase;color:var(--dim);padding:4px 10px 2px}
/* Odkaz „prejsť tam" v bunke tabuľky — text, nie tlačidlo: v hustej tabuľke
   by päť tlačidiel pod sebou prekričalo samotné vety. */
.set-page .set-jump{font-size:12px;color:var(--accent);text-decoration:none;
  border-bottom:1px solid transparent}
.set-page .set-jump:hover{border-bottom-color:currentColor}
/* Dva rozpočtové prúžky vedľa seba. Zápisy a čítania sú oddelené kvóty a
   obrazovka to má ukázať aj rozložením, nie len textom. */
.set-page .set-meters{display:grid;grid-template-columns:1fr 1fr;gap:14px 20px;
  margin:10px 0 12px;align-items:start}
.set-page .set-pill-row{display:flex;gap:14px;align-items:flex-start;
  flex-wrap:wrap;margin-bottom:10px}
.set-page .set-pill-row .set-note{flex:1 1 320px;margin:0}
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
.set-page .split{display:grid;grid-template-columns:1fr 300px;gap:16px;
  align-items:start}
.set-page .stack{display:flex;flex-direction:column;gap:8px}
.set-page .danger-zone{border-color:var(--st-critical)}
.set-page .danger-zone .sec-h h2{color:var(--st-critical)}
.set-page .dz-row{display:flex;align-items:center;gap:12px;padding:8px 0;
  border-top:1px solid var(--line);font-size:13px;color:var(--ink2);
  flex-wrap:wrap}
.set-page .dz-row:first-of-type{border-top:0}
.set-page .dz-row .dz-a{margin-left:auto}
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
/* Dve v rade pri plnej šírke, jedna pod druhou na polovici obrazovky. Karta je
   celá klikateľná — nie odkaz v rohu, ktorý sa musí trafiť. */
/* Karta má štyri pásma pod sebou: nadpis, veta, kotvy, stav. Mriežka kariet
   ich zdieľa cez „subgrid", takže rovnaké pásmo má vo VŠETKÝCH kartách
   rovnakú výšku a všetky štyri stavy začínajú v jednej línii.
   PREČO NIE „margin-top:auto" (oprava 24. 8. 2026)
   Predtým bola karta stĺpcový flex a stav sa tlačil na spodok. Karty v jednom
   riadku mriežky sú rovnako vysoké, takže tá s kratším textom si celý rozdiel
   nechala ako prázdno MEDZI kotvami a čiarou nad stavom — na karte „Čo sa už
   stalo…" to bolo 45 px proti 8 px na susednej. A cieľ sa aj tak nedosiahol:
   spodkom zarovnaný stav s rôznym počtom riadkov (veta + slovo verzus len
   veta) začínal v každej karte inde. Subgrid zarovnáva ZAČIATKY pásiem, takže
   prázdno padne pod stav, kam nikoho neruší.
   Keby prehliadač „subgrid" nepoznal, deklarácia prepadne a karta zostane
   obyčajnou štvorriadkovou mriežkou — stavy nebudú v línii, ale diera
   nevznikne. Stráži to „nastavenia-suvislost.spec.ts". */
.set-page .set-cards{display:grid;grid-template-columns:1fr 1fr;
  grid-auto-rows:auto;gap:12px;margin-top:14px}
.set-page .set-card{display:grid;grid-template-rows:subgrid;grid-row:span 4;
  row-gap:8px;align-content:start;
  background:var(--paper2);border:1px solid var(--line);border-radius:var(--r);
  padding:14px 16px;box-shadow:var(--shadow);text-decoration:none;color:inherit;
  transition:border-color .12s ease,transform .12s ease}
.set-page .set-card:hover{border-color:var(--accent);transform:translateY(-1px)}
.set-page .set-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.set-page .set-card h2{font-size:13.5px;font-weight:640;color:var(--ink);
  letter-spacing:0;text-transform:none;line-height:1.35}
.set-page .set-card .card-lead{font-size:12px;color:var(--dim);line-height:1.5}
/* Stav karty. Začína vo všetkých kartách v jednej línii (pásmo subgridu
   vyššie), aby sa štyri stavy dali prečítať jedným pohybom oka, nie štyrmi. */
.set-page .set-card .card-state{align-self:start;padding-top:8px;
  border-top:1px solid var(--line);display:flex;flex-direction:column;gap:3px;
  width:100%}
.set-page .set-card .card-state .sig{align-items:flex-start;line-height:1.45;
  text-align:left}
.set-page .set-card .card-word{font-size:11px;color:var(--dim);
  padding-left:15px}
.set-page .set-card .card-in{font-size:11px;color:var(--dim);
  display:flex;flex-wrap:wrap;gap:4px 8px}

/* ─────────────────── Podstránka: návrat a hlavička ─────────────────────── */
.set-page .sub-back{font-size:12px;color:var(--dim);text-decoration:none;
  display:inline-block;margin-bottom:8px}
.set-page .sub-back:hover{color:var(--accent)}
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
  .set-page .split{grid-template-columns:1fr}
  .set-page .set-meters{grid-template-columns:1fr}
  .set-page .set-cards{grid-template-columns:1fr}
  .set-page .kv{grid-template-columns:1fr;gap:2px}
  .set-page .kv .k{margin-top:8px}
  .set-page .dz-row .dz-a{margin-left:0}
  .set-page .set-w{max-width:100%}
}
`;

export default SETTINGS_CSS;
