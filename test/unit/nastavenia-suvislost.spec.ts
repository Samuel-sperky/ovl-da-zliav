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
 *     deklarácie zo `SETTINGS_CSS` (rozobraté na stopy, nie hľadané ako
 *     reťazec), obsah ako vykreslené HTML rozdelené na povrch a rozklik.
 *     Hľadanie reťazca v zdroji by prešlo aj vtedy, keby sa pravidlo
 *     nepoužilo na nič.
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
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import DiagnosticsSection from '@/components/settings/DiagnosticsSection';
import LockedFeatures, { LOCKED_FEATURES } from '@/components/settings/LockedFeatures';
import ScopeModeForm from '@/components/settings/ScopeModeForm';
import SafeguardsSection from '@/components/settings/SafeguardsSection';
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

describe('Karty rozcestníka: stav sa netlačí na spodok karty', () => {
  it('karta zdieľa riadky mriežky, takže pásma začínajú v jednej línii', () => {
    const card = rule('.set-page .set-card');
    expect(card).toContain('grid-template-rows:subgrid');
    expect(card).toMatch(/grid-row:span \d+/);
  });

  it('stav už nie je tlačený nadol — `margin-top:auto` je preč', () => {
    /*
     * `margin-top:auto` v stĺpcovom flexe zožral celý rozdiel výšok kariet
     * a položil ho MEDZI kotvy a čiaru nad stavom. Cieľ (stavy v jednej
     * línii) sa tým aj tak nedosiahol: spodkom zarovnané bloky s rôznym
     * počtom riadkov začínajú každý inde.
     */
    expect(rule('.set-page .set-card .card-state')).not.toContain('margin-top:auto');
  });

  it('rozpätie karty sedí na počet pásiem, ktoré karta naozaj kreslí', async () => {
    /*
     * `grid-row:span 4` a štyri deti karty sú jedna vec zapísaná dvakrát.
     * Keby niekto na kartu pridal piate pásmo, subgrid by ho vytlačil mimo
     * zdieľaných riadkov a karta by sa rozišla so susedou. Preto sa počet
     * pásiem MERIA na vykreslenej karte, nie predpokladá.
     */
    const { SettingsIndex } = await import('@/components/settings/SettingsIndex');
    const markup = renderToStaticMarkup(createElement(SettingsIndex));
    const cards = markup.split('class="set-card"').slice(1);
    expect(cards).toHaveLength(4);

    const span = Number(/grid-row:span (\d+)/.exec(rule('.set-page .set-card'))![1]);
    for (const card of cards) {
      const body = card.slice(0, card.indexOf('</a>'));
      const slots = ['<h2', 'class="card-lead"', 'class="card-in"', 'class="card-state"'].filter(
        (slot) => body.includes(slot),
      );
      expect(slots, `karta nemá všetky pásma: ${slots.join(', ')}`).toHaveLength(span);
    }
  });
});

/* ══════════ 3. Stránka sa skrátila, obsah zostal ══════════════════════════ */

describe('Zamknuté funkcie zostali celé na POVRCHU (kontrakt bod 18)', () => {
  const povrch = surfaceBlocks(LOCKED);

  it('všetky štyri funkcie aj s tým, čo im chýba, sú bez kliknutia vidieť', () => {
    expect(LOCKED_FEATURES).toHaveLength(4);
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

  it('na povrchu zostalo pri TLAČIDLE to podstatné — že heslo netreba', () => {
    /*
     * Sprísnenie bez hesla je celá asymetria poistky. Presun dôvodu pod
     * rozklik ju nesmie schovať; na povrchu ostáva v tom istom tvare, aký
     * má opačný prechod („vyžaduje heslo").
     *
     * Meria sa VÝREZ pri tlačidle, nie celá obrazovka: tá istá dvojica slov
     * stojí aj v bunke tabuľky oboch rozsahov, takže tvrdenie nad celým
     * povrchom by prežilo aj zmazanie popisky od tlačidla.
     */
    const at = SCOPE.indexOf('data-testid="scope-to-pilot"');
    expect(at, 'vetva sprísnenia sa nevykreslila').toBeGreaterThan(-1);
    const vyrez = surfaceBlocks(SCOPE.slice(at)).join(' ');
    expect(vyrez).toContain('Vrátiť pilotný rozsah');
    expect(vyrez).toContain('heslo netreba');
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
