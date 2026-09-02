/**
 * Aura Zľavy — SÚVISLOSŤ A VÝŠKA OBRAZOVIEK NASTAVENÍ (UX4, 24. 8. 2026).
 *
 * Tri chyby, ktoré tento súbor drží opravené. Všetky tri majú spoločné to, že
 * ich žiadny existujúci test nevidel: nič sa pri nich nerozbije, nič nevypíše
 * chybu — len sa obrazovka horšie číta.
 *
 *  1. **Prázdny stred v mriežke kľúč–hodnota–vysvetlenie.** Stredný stĺpec
 *     `.kv` bol `1fr`, takže medzi hodnotou („200 na deň") a vysvetlením
 *     („znížiť ho zatiaľ vie len správca appky") ostávalo 693 px prázdna
 *     a oko muselo prejsť pol obrazovky, aby tie dva údaje spojilo.
 *  2. **Diera v karte rozcestníka.** Karta „Čo sa už stalo…" mala medzi
 *     kotvami a stavovým riadkom 45 px prázdna, susedná 8 px — stav sa tlačil
 *     `margin-top:auto` na spodok karty a kratší text si celý rozdiel nechal
 *     ako medzeru uprostred.
 *  3. **Podstránky nad stropom P4.** „Zamknuté funkcie a poistky" merala
 *     1772 px (1,97 obrazovky), „Zápisy a rozpočty" 1401 px (1,56).
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  A. **Meria sa výsledok, nie zdrojový text.** Mriežky sa čítajú ako
 *     deklarácie (rozobraté na stopy, nie hľadané ako reťazec), obsah ako
 *     vykreslené HTML rozdelené na povrch a rozklik. Hľadanie reťazca
 *     v zdroji by prešlo aj vtedy, keby sa pravidlo nepoužilo na nič.
 *
 *     DVA HÁRKY, DVA ČITAČE (V6b): mriežka podstránok žije ďalej v
 *     `SETTINGS_CSS` (minifikovaný šablónový literál, `rule()` nižšie),
 *     mriežka ROZCESTNÍKA sa presunula do `settings-index.module.css`
 *     (D139, D143) a má vlastný čitač `modulRule()`. Kto by kartu meral
 *     v `SETTINGS_CSS`, meral by zmazané pravidlo — preto je oddiel 2
 *     doplnený tvrdením, že tá stará sada tried je naozaj preč.
 *  B. **Skrátenie stránky nesmie zjesť obsah.** Každá veta, ktorá zmizla
 *     z povrchu, sa musí dať nájsť pod rozklikom (P6). Zoznam zamknutých
 *     funkcií pod rozklik NESMIE — je to jediné miesto v celej appke, kde
 *     appka hovorí, čo z eshopu nedostane (kontrakt bod 18).
 *  C. **Skutočnú výšku meria snímkovač** (`npm run snimky`), nie tento súbor:
 *     px sa bez prehliadača spočítať nedajú. Tu sú zamknuté tie rozhodnutia,
 *     ktoré tú výšku spravili — okno histórie a presuny pod rozklik. Keď sa
 *     ktorékoľvek z nich vráti, stránka prerastie strop znova.
 *
 * Vykresľuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna databáza.
 *
 * Vlastník: UX4.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import DiagnosticsSection from '@/components/settings/DiagnosticsSection';
import LockedFeatures, { LOCKED_FEATURES } from '@/components/settings/LockedFeatures';
import ScopeModeForm from '@/components/settings/ScopeModeForm';
import SafeguardsSection from '@/components/settings/SafeguardsSection';
/* Mapovanie CSS modulu rozcestníka: vo vykreslenom markupe sú hašované mená
   tried, takže literál `class="cardTitle"` už nič nenájde (D143). */
import styles from '@/components/settings/settings-index.module.css';
import { SETTINGS_CSS } from '@/components/settings/styles';
import { DIAGNOSTICS_CONTENT_ROWS } from '@/lib/diagnostics/collect';
import type { SettingsView } from '@/components/settings/api';

/** Rozcestník volá `useRouter()` kvôli prekladu starých kotiev. */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

/** Strop P2 — `design/v3/ARCHITEKTURA.md`, riadok P2. */
const P2_LIMIT = 90;

/* ═════════════════════ čítanie deklarácií zo `SETTINGS_CSS` ═══════════════ */

/**
 * Telo pravidla podľa presného selektora.
 *
 * Zámerne sa NEhľadá podreťazec „grid-template-columns:190px…": taký test by
 * prešiel aj nad pravidlom, ktoré je zakomentované alebo prebité neskorším.
 * Berie sa posledný výskyt selektora — v CSS vyhráva posledná deklarácia.
 */
function rule(selector: string): string {
  // Bez media query: tá istá trieda je v nej prepísaná pre úzku obrazovku
  // a `.kv` by sa čítalo ako jednostĺpcové. Mobilné pravidlo má vlastné
  // tvrdenie nižšie.
  const desktop = SETTINGS_CSS.slice(0, SETTINGS_CSS.indexOf('@media'));
  const at = desktop.lastIndexOf(`${selector}{`);
  expect(at, `selektor ${selector} v SETTINGS_CSS nie je`).toBeGreaterThan(-1);
  const from = at + selector.length + 1;
  const to = desktop.indexOf('}', from);
  expect(to, `pravidlo ${selector} nie je uzavreté`).toBeGreaterThan(from);
  return desktop.slice(from, to);
}

/** Hodnota jednej vlastnosti v tele pravidla. */
function prop(selector: string, name: string): string {
  const body = rule(selector);
  const found = body
    .split(';')
    .map((d) => d.trim().replace(/\s*\n\s*/g, ' '))
    .find((d) => d.startsWith(`${name}:`));
  expect(found, `${selector} nemá ${name}`).toBeTypeOf('string');
  return found!.slice(name.length + 1).trim();
}

/**
 * Stopy mriežky. `minmax(0,max-content)` je JEDNA stopa, hoci obsahuje čiarku —
 * delí sa preto podľa medzier mimo zátvoriek.
 */
function tracks(value: string): readonly string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ' ' && depth === 0) {
      if (cur !== '') out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

/* ═════════════════════ vyrezávanie povrchu z markupu ══════════════════════ */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * Značky vnútri vety. Kópia pravidla z `text-zapisy-povrch.spec.ts` — spec
 * súbor sa importovať nedá (spustil by svoje testy druhýkrát), a opísaný
 * zoznam je lacnejší než spoločný modul kvôli siedmim značkám.
 */
const INLINE = /<\/?(?:b|strong|i|em|a|code|small|abbr|u|mark)\b[^>]*>/g;
const DETAILS = /<details\b[\s\S]*?<\/details>/g;

function decode(text: string): string {
  return text.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e);
}

/** Texty blokových uzlov POVRCHU — bez obsahu rozkliku a bez vnútra ikon. */
function surfaceBlocks(markup: string): readonly string[] {
  return markup
    .replace(DETAILS, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/g, ' ')
    .replace(INLINE, '')
    .split(/<[^>]+>/)
    .map((s) => decode(s).replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/** Text VNÚTRI rozklikov. */
function detailsText(markup: string): string {
  return (markup.match(DETAILS) ?? [])
    .join(' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/g, ' ')
    .split(/<[^>]+>/)
    .map((s) => decode(s).replace(/\s+/g, ' ').trim())
    .join(' ');
}

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const SETTINGS: SettingsView = {
  shopDomain: 'https://ukazka-sperky.sk',
  domainConfirmedAt: '2026-08-10T09:12:00.000Z',
  eagerWriteDefault: true,
  writesLocked: false,
  writesLockedReason: null,
  onboardingDoneAt: null,
  scopeMode: 'plny',
  maxProducts: 150,
  maxProductsPerCampaign: 150,
  pilotMaxProducts: 10,
  scopeFailClosed: false,
  dailyWriteBudget: 200,
};

const noop = () => undefined;

const LOCKED = renderToStaticMarkup(createElement(LockedFeatures));
const DIAG = renderToStaticMarkup(createElement(DiagnosticsSection));
const SCOPE = renderToStaticMarkup(
  createElement(ScopeModeForm, { settings: SETTINGS, onChanged: noop }),
);
const SAFEGUARDS = renderToStaticMarkup(
  createElement(SafeguardsSection, { settings: SETTINGS, onChanged: noop }),
);

/* ══════════ 1. Mriežka kľúč–hodnota–vysvetlenie nemá prázdny stred ════════ */

describe('Riadky stropov: vysvetlenie stojí pri hodnote, nie pol obrazovky ďalej', () => {
  const KV = tracks(prop('.set-page .kv', 'grid-template-columns'));

  it('mriežka má tri stopy — popis, hodnota, vysvetlenie', () => {
    // Poistka na poistku: keby sa rozobratie stôp rozbilo a vrátilo prázdno,
    // tvrdenia nižšie by svietili nad ničím.
    expect(KV, `stopy: ${KV.join(' | ')}`).toHaveLength(3);
  });

  it('hodnotová stopa je „max-content", nie „1fr"', () => {
    /*
     * Toto je celá oprava. `1fr` roztiahne hodnotu na 672 px, hodnota sa
     * vykreslí pri jej ľavom okraji a vysvetlenie odletí až za ňu — vznikne
     * diera, ktorú žiadny test na obsah nevidí, lebo je prázdna.
     */
    expect(KV[1], `hodnotová stopa je „${KV[1]}"`).toContain('max-content');
    expect(KV[1]).not.toContain('fr');
  });

  it('voľné miesto dostane až stopa s vysvetlením', () => {
    expect(KV[2], `stopa vysvetlenia je „${KV[2]}"`).toContain('1fr');
  });

  it('popisy zostávajú v pevnom stĺpci, aby stáli pod sebou', () => {
    expect(KV[0]).toMatch(/^\d+px$/);
  });

  it('na úzkej obrazovke sa mriežka aj tak skladá pod seba', () => {
    const mobile = SETTINGS_CSS.slice(SETTINGS_CSS.indexOf('@media (max-width:760px)'));
    expect(mobile).toContain('.set-page .kv{grid-template-columns:1fr');
  });
});

/* ══════════ 2. Karta rozcestníka nemá dieru medzi kotvami a stavom ════════ */

/**
 * Geometria rozcestníka. Od V6b je v CSS MODULE vedľa komponentu (D143), nie
 * v šablónovom literáli `SETTINGS_CSS` — pravidlá sú tam formátované, takže
 * `rule()` vyššie (šitý na minifikovaný literál) na ne nesedí.
 */
const INDEX_CSS = readFileSync(
  fileURLToPath(
    new URL('../../src/components/settings/settings-index.module.css', import.meta.url),
  ),
  'utf8',
);

/**
 * Telo pravidla modulu podľa PRESNÉHO selektora. Bez komentárov (tento hárok
 * v nich cituje vlastné triedy) a bez media query (`.cards` je v nej prepísaná
 * pre úzku obrazovku a čítalo by sa ako jednostĺpcové).
 */
function modulRule(selector: string): string {
  const bezKomentarov = INDEX_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const desktop = bezKomentarov.slice(0, bezKomentarov.indexOf('@media'));
  const at = desktop.lastIndexOf(`${selector} {`);
  expect(at, `selektor ${selector} v settings-index.module.css nie je`).toBeGreaterThan(-1);
  const from = desktop.indexOf('{', at) + 1;
  const to = desktop.indexOf('}', from);
  expect(to, `pravidlo ${selector} nie je uzavreté`).toBeGreaterThan(from);
  return desktop.slice(from, to).replace(/\s+/g, ' ').trim();
}

/**
 * Geometria POISTIEK A KĽÚČOV. Vlastný modul (D143), preto vlastný čítač —
 * `modulRule()` vyššie je zamknutý na hárok rozcestníka a druhý parameter by
 * z neho urobil funkciu, ktorá vyzerá ako jedna vec a je dve.
 */
const SECTIONS_CSS = readFileSync(
  fileURLToPath(
    new URL('../../src/components/settings/settings-sections.module.css', import.meta.url),
  ),
  'utf8',
);

/** Telo pravidla v hárku sekcií podľa PRESNÉHO selektora. */
function sekciaRule(selector: string): string {
  const bezKomentarov = SECTIONS_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const desktop = bezKomentarov.slice(0, bezKomentarov.indexOf('@media'));
  const at = desktop.lastIndexOf(`${selector} {`);
  expect(at, `selektor ${selector} v settings-sections.module.css nie je`).toBeGreaterThan(-1);
  const from = desktop.indexOf('{', at) + 1;
  const to = desktop.indexOf('}', from);
  expect(to, `pravidlo ${selector} nie je uzavreté`).toBeGreaterThan(from);
  return desktop.slice(from, to).replace(/\s+/g, ' ').trim();
}

describe('Prevedené sekcie Nastavení: odstup a kotva prežili prevod na Panel', () => {
  it('kotva má odstup pod prilepenou hlavičkou — inak nadpis skončí za ňou', () => {
    /*
     * `SETTINGS_CSS` to dával pravidlom `.set-page .sec[id]` a panel `.sec`
     * NIE JE. Keby sa `scroll-margin-top` nepresunul, klik na `#kluce`,
     * `#zapisy`, `#poistky` alebo `#cervena` by skončil s nadpisom sekcie
     * schovaným za hlavičkou — a vedie na ne šesť odkazov z celej appky.
     */
    expect(sekciaRule('.section')).toMatch(/scroll-margin-top: 72px/);
  });

  it('odstup medzi sekciami nesie panel sám, lebo `.sec + .sec` o ňom nevie', () => {
    expect(sekciaRule('.section')).toMatch(/margin-top: 10px/);
  });

  it('výnimku z odstupu má PRVÝ PRVOK OBALU, nie prvý `div` medzi susedmi', () => {
    /*
     * Toto je celá oprava, ktorú prevod odhalil. `:first-of-type` vyberá
     * prvého svojho druhu medzi susedmi — a panel je `<div>`, kým neprevedené
     * sekcie sú `<section>`. Kľúče (prvý `<div>` na podstránke „Na čo je
     * napojená") tak prišli o odstup a prilepili sa na Pripojenie nad sebou,
     * hoci prvé na stránke neboli; to isté hrozilo Zápisom a Poistkám. Pokazí
     * sa to ticho: je to prázdne miesto, ktoré žiadny test na obsah nevidí.
     */
    const css = SECTIONS_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(css).toMatch(/\.section:first-child\s*\{/);
    expect(css, '`:first-of-type` je späť — panel nie je `<section>`').not.toMatch(
      /\.section:first-of-type\s*\{/,
    );
  });

  it('červená plocha si mení len rám a farbu nadpisu, nie celú plochu', () => {
    /*
     * Plochu (pozadie, rádius, tieň) vlastní `Panel`. Druhá definícia vedľa
     * prvej by sa po prvej úprave rozišla a Červená zóna by prestala vyzerať
     * ako zvyšok appky — červený rám je jediný rozdiel, ktorý má byť vidieť.
     */
    const danger = sekciaRule('.danger');
    expect(danger).toContain('border-color: var(--st-critical)');
    expect(danger).not.toContain('background');
    expect(danger).not.toContain('box-shadow');
    /*
     * Nadpis nesie `--st-critical-ink`, nie `--st-critical`: ten má na svetlej
     * téme 4,31 : 1, teda pod hranicou WCAG 1.4.3. Zamietol ho
     * `dizajn-kontrast.spec.ts`, keď pravidlo prišlo zo šablónového literálu
     * do modulu — v literáli ho strážca kontrastu nevidel (D144).
     */
    expect(sekciaRule('.danger h2')).toContain('color: var(--st-critical-ink)');
  });
});

describe('Karty rozcestníka: stav sa netlačí na spodok karty', () => {
  it('karta zdieľa riadky mriežky, takže pásma začínajú v jednej línii', () => {
    const card = modulRule('.card');
    expect(card).toContain('grid-template-rows: subgrid');
    expect(card).toMatch(/grid-row: span \d+/);
    /*
     * `subgrid` zdieľa riadky RODIČA — keby ich mriežka kariet nevlastnila,
     * nemá karta čo zdieľať a deklarácia je ozdoba.
     */
    expect(modulRule('.cards')).toContain('grid-auto-rows: auto');
  });

  it('stav už nie je tlačený nadol — `margin-top: auto` je preč', () => {
    /*
     * `margin-top:auto` v stĺpcovom flexe zožral celý rozdiel výšok kariet
     * a položil ho MEDZI kotvy a čiaru nad stavom. Cieľ (stavy v jednej
     * línii) sa tým aj tak nedosiahol: spodkom zarovnané bloky s rôznym
     * počtom riadkov začínajú každý inde.
     */
    expect(modulRule('.state')).not.toContain('margin-top: auto');
  });

  it('stará globálna sada tried karty je zo `SETTINGS_CSS` ZMAZANÁ (D139, K11)', () => {
    /*
     * Toto je celá cena za presun. Keby staré pravidlá v `SETTINGS_CSS`
     * zostali, mala by appka dve sady tried pre tú istú kartu — a mŕtvy
     * selektor pri ďalšej oprave vyzerá presne ako to, čo obrazovku kreslí.
     * Komentáre sa odstrihnú zámerne: autor v nich SMIE napísať, kam sa
     * trieda presunula, a test mu to nesmie zakázať.
     */
    const css = SETTINGS_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const dead of [
      '.set-lead',
      '.set-cards',
      '.set-card',
      '.card-lead',
      '.card-in',
      '.card-state',
      '.card-word',
      /*
       * Pridané v kroku 3/3 (Poistky a kľúče). Prvé štyri odišli s prevodom
       * sekcií na `Panel` do `settings-sections.module.css`; `.split`
       * a `.anchor-grp*` boli mŕtve už predtým — `class="split"` ani
       * `class="anchor-grp"` nekreslí v `.set-page` ani jeden komponent,
       * takže sa strážila mriežka, ktorú nikto nevidel.
       */
      '.set-pill-row',
      '.danger-zone',
      '.dz-row',
      '.dz-a',
      '.split',
      '.anchor-grp',
      '.anchor-grp-t',
    ]) {
      expect(css, `mŕtvy selektor ${dead} v SETTINGS_CSS`).not.toMatch(
        new RegExp(`\\${dead}(?![\\w-])`),
      );
    }
    // Poistka proti príliš tolerantnému hľadaniu: `.set-page` tam BYŤ MÁ —
    // kreslí ju ešte podstránka a jej zmazanie je krok 2/3, nie tento.
    expect(css).toMatch(/\.set-page(?![\w-])/);
    /*
     * Druhá poistka na to isté: `.dz-link` a `.dz-open` sa menujú takmer ako
     * zmazané `.dz-row`/`.dz-a`, ale ŽIVÉ SÚ — kreslí ich `SettingsSubPage`
     * (odkaz do Červenej zóny a rozklik pred ňou). Mazanie „podľa predpony
     * dz-" by ich zobralo so sebou a nespadlo by pri tom nič.
     */
    expect(css).toMatch(/\.dz-link(?![\w-])/);
    expect(css).toMatch(/\.dz-open(?![\w-])/);
  });

  it('rozpätie karty sedí na počet pásiem, ktoré karta naozaj kreslí', async () => {
    /*
     * `grid-row: span 4` a štyri deti karty sú jedna vec zapísaná dvakrát.
     * Keby niekto na kartu pridal piate pásmo, subgrid by ho vytlačil mimo
     * zdieľaných riadkov a karta by sa rozišla so susedou. Preto sa počet
     * pásiem MERIA na vykreslenej karte, nie predpokladá.
     */
    const { SettingsIndex } = await import('@/components/settings/SettingsIndex');
    const markup = renderToStaticMarkup(createElement(SettingsIndex));
    const span = Number(/grid-row: span (\d+)/.exec(modulRule('.card'))![1]);

    /*
     * Karta sa adresuje `data-testid`-om, nie triedou. `(?!state-)` je tu
     * podstatné: stavový riadok každej karty nesie `settings-card-state-…`
     * a bez toho vylúčenia by test našiel osem kariet a bol by zelený.
     */
    const karty = [...markup.matchAll(/data-testid="settings-card-(?!state-)([a-z-]+)"/g)];
    expect(karty).toHaveLength(4);

    /*
     * 2. 9. 2026 — ČO SA ZMENILO A PREČO: pásma sa hľadali reťazcami
     * `class="cardTitle"` a spol. Rozcestník medzitým prešiel na CSS modul
     * (D143), takže vo vykreslenom markupe stoja HAŠOVANÉ mená
     * (`_cardTitle_0a1a5b`) a všetky štyri reťazce zmizli — test hlásil
     * „karta nemá všetky pásma: " s prázdnym zoznamom, teda pád na presunutej
     * veci, nie na chýbajúcom pásme. Mená sa preto berú z MAPOVANIA modulu
     * (`styles`), nie z literálu, a hľadajú sa ako TRIEDA v atribúte — karta
     * skladá `class` z dvoch tried (`_panel_… _card_…`), takže presná zhoda
     * celého atribútu by bola druhá pasca toho istého druhu.
     */
    const maTriedu = (body: string, trieda: string): boolean =>
      [...body.matchAll(/class="([^"]*)"/g)].some((m) => m[1]!.split(/\s+/).includes(trieda));

    for (const [i, m] of karty.entries()) {
      const from = m.index;
      const to = i + 1 < karty.length ? karty[i + 1]!.index : markup.length;
      const body = markup.slice(from, to);
      const pasma = [styles.cardTitle, styles.lead, styles.sections, styles.state];
      /* Poistka: keby modul niektorý názov stratil, `undefined` by z filtra
         vypadol a test by bol zelený nad neexistujúcim pásmom. */
      for (const trieda of pasma) expect(typeof trieda, 'pásmo bez triedy v module').toBe('string');
      const slots = pasma.filter((trieda) => maTriedu(body, trieda));
      expect(slots, `karta ${m[1]} nemá všetky pásma: ${slots.join(', ')}`).toHaveLength(span);
    }
  });
});

/* ══════════ 3. Stránka sa skrátila, obsah zostal ══════════════════════════ */

describe('Zamknuté funkcie zostali celé na POVRCHU (kontrakt bod 18)', () => {
  const povrch = surfaceBlocks(LOCKED);

  it('všetky zamknuté funkcie aj s tým, čo im chýba, sú bez kliknutia vidieť', () => {
    /* Dva, nie štyri: D125 (1. 9. 2026) vyradilo maržu a sklad — dáta na ne
       appka po migrácii 0014 MÁ a Produkty podľa nich filtrujú. Dôvod je
       v `LockedFeatures.tsx`. */
    expect(LOCKED_FEATURES).toHaveLength(2);
    const text = povrch.join(' ');
    for (const row of LOCKED_FEATURES) {
      expect(text, `funkcia „${row.feature}" nie je na povrchu`).toContain(row.feature);
      expect(text, `chýbajúci údaj „${row.missing}" nie je na povrchu`).toContain(
        `chýba ${row.missing}`,
      );
    }
  });

  it('sekcia nemá ani jeden rozklik — tento zoznam sa schovať nesmie', () => {
    expect(LOCKED).not.toContain('<details');
  });

  it('veta o predaných kusoch zostala pod zoznamom', () => {
    expect(povrch.join(' ')).toContain('Predané kusy fungujú vždy');
  });

  it('P2 — na povrchu nie je blok nad 90 znakov', () => {
    const dlhe = povrch.filter((b) => b.length > P2_LIMIT);
    expect(dlhe, dlhe.map((b) => `${b.length}: ${b}`).join('\n')).toEqual([]);
  });
});

describe('Diagnostika: rozpis pod rozklikom, sľub o kľúčoch na povrchu', () => {
  it('sľub, ktorý musí človek vidieť PRED odoslaním, zostal na povrchu', () => {
    expect(surfaceBlocks(DIAG).join(' ')).toContain('Bez kľúčov a hesiel');
  });

  it('celý rozpis obsahu je pod rozklikom — a je tam celý', () => {
    const pod = detailsText(DIAG);
    expect(DIAGNOSTICS_CONTENT_ROWS.length).toBeGreaterThan(3);
    for (const row of DIAGNOSTICS_CONTENT_ROWS) {
      expect(pod, `riadok „${row.label}" sa stratil`).toContain(row.label);
      expect(pod, `detail „${row.detail}" sa stratil`).toContain(row.detail);
    }
  });

  it('rozpis NIE JE zároveň na povrchu — inak sa nič neušetrilo', () => {
    const povrch = surfaceBlocks(DIAG).join(' ');
    for (const row of DIAGNOSTICS_CONTENT_ROWS) {
      expect(povrch, `„${row.detail}" je späť na povrchu`).not.toContain(row.detail);
    }
  });
});

describe('Rozsah zliav: dva dôsledky sa presunuli pod rozklik, nezmizli', () => {
  const povrch = surfaceBlocks(SCOPE).join(' ');
  const pod = detailsText(SCOPE);

  it('čo zmena rozsahu NEurobí, sa dá nájsť pod rozklikom', () => {
    expect(pod).toContain('nezapíše ani nezruší nič');
    expect(povrch).not.toContain('nezapíše ani nezruší nič');
  });

  it('osud už zapísaných zliav pri sprísnení je pod rozklikom', () => {
    expect(pod).toContain('zostanú v eshope a dobehnú');
    expect(povrch).not.toContain('zostanú v eshope a dobehnú');
  });

  it('na povrchu zostalo pri TLAČIDLE to podstatné — že potvrdenie netreba', () => {
    /*
     * Sprísnenie bez potvrdenia je celá asymetria poistky. Presun dôvodu pod
     * rozklik ju nesmie schovať; na povrchu ostáva v tom istom tvare, aký
     * má opačný prechod („vyžaduje potvrdenie"). Do 27. 8. 2026 tu stálo
     * „heslo" — D105 ho vymenilo, asymetriu nie.
     *
     * Meria sa VÝREZ pri tlačidle, nie celá obrazovka: tá istá dvojica slov
     * stojí aj v bunke tabuľky oboch rozsahov, takže tvrdenie nad celým
     * povrchom by prežilo aj zmazanie popisky od tlačidla.
     */
    const at = SCOPE.indexOf('data-testid="scope-to-pilot"');
    expect(at, 'vetva sprísnenia sa nevykreslila').toBeGreaterThan(-1);
    const vyrez = surfaceBlocks(SCOPE.slice(at)).join(' ');
    expect(vyrez).toContain('Vrátiť pilotný rozsah');
    expect(vyrez).toContain('potvrdenie netreba');
  });
});

/* ══════════ Rozhodnutia, ktoré držia stránku pod stropom P4 ═══════════════ */

describe('P4 — čo drží podstránku „Čo sa už stalo…" pod 1,5 obrazovky', () => {
  /*
   * Skutočnú výšku meria `npm run snimky` v prehliadači. Tu sú zamknuté tie
   * rozhodnutia, bez ktorých sa 1333 px vráti na 1772 px.
   */
  it('okno histórie je výrez, nie celá tabuľka', () => {
    const max = prop('.set-page .audit-scroll', 'max-height');
    const px = Number(/^(\d+)px$/.exec(max)?.[1] ?? NaN);
    expect(px, `max-height okna histórie je „${max}"`).toBeLessThanOrEqual(220);
    // Nulové okno by nebola úspora, ale zmiznutá história.
    expect(px).toBeGreaterThan(120);
  });

  it('filtre histórie majú popisku vedľa poľa, nie nad ním', () => {
    expect(prop('.set-page #historia form.row .field', 'flex-direction')).toBe('row');
  });

  it('poistky stoja v mriežke, nie v rámovanej tabuľke', () => {
    expect(SAFEGUARDS).toContain('class="kv"');
    expect(SAFEGUARDS).not.toContain('tbl-frame');
  });
});
