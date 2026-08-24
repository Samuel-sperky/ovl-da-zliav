/**
 * Aura Zľavy — TRETÍ KANÁL V TABE ZĽAVY (šprint dokončenia, A2, 20. 8. 2026).
 *
 * Pravidlo appky znie: **stav nikdy nie je len farba — vždy farba + značka +
 * slovo.** V tabe Zľavy sa to dá ticho porušiť na dvoch miestach a ani jedno
 * nič nezhodí:
 *
 *  1. **Dlaždice fronty** („Zapísané / Čaká na zápis / Nepodarilo sa /
 *     Nevieme, či sa zapísalo") niesli do 20. 8. 2026 len farbu a slovo.
 *     Značku stratili vtedy, keď sa stará mapa glyfov po prechode na ikony
 *     vyprázdnila namiesto toho, aby ju niekto nahradil — na obrazovke z toho
 *     ostala medzera navyše, teda niečo, čo vyzerá ako preklep, nie ako chyba.
 *     `StatTile` (`ui/StatTile.tsx`) berie popisok ako REŤAZEC, takže značka
 *     doň vložiť nejde a stojí vedľa nej ako súrodenec v mriežke
 *     `.queueTile`. Tento test drží obe polovice pohromade: ikonu v markupe
 *     aj miesto pre ňu v CSS.
 *  2. **Riadok stavu a riadok prekážky** (`DiscountState`, `BlockerRow`,
 *     `StandRow`) kreslia značku cez obaly z `ui/StatusMark.tsx` a cez
 *     `<Icon>`. Keby značka z markupu vypadla, trieda by ostala, farba by
 *     ostala, slovo by ostalo — a pod deuteranopiou by stav zmizol.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Nemeria sa literál triedy, ale VYKRESLENÝ výstup.** Kde sa dá, tvrdí
 *     sa nad `renderToStaticMarkup`: hľadá sa `<svg class="ovl-ic"`, teda to,
 *     čo naozaj vznikne. Grep na literál by o rodine `.sig` nedokázal nič —
 *     triedy skladá `sigClass()`, `toneSigClass()` a `TONE_SIG_CLASS` až za
 *     behu (pozri hlavičku `ui/blocker-look.ts`).
 *  B. **Dlaždice sa vykresliť nedajú** — `DiscountDetail` je klientský
 *     komponent, ktorý si čísla ťahá až v efekte. Merajú sa preto nad
 *     zdrojom, presne ako v `zlava-detail-priebeh.spec.ts`, ale REZOM NA
 *     JEDNU DLAŽDICU: tvrdenie „v súbore je niekde `<Icon`" by prešlo aj
 *     vtedy, keby tri zo štyroch dlaždíc značku stratili.
 *  C. **Markup a CSS musia hovoriť o tom istom tóne.** Dlaždica `failed` má
 *     v markupe `TONE_ICON.critical` a v CSS `--st-critical`. Keby sa jedno
 *     zmenilo bez druhého, tvar by hovoril iné než farba — a to je horšie než
 *     chýbajúca značka, lebo to vyzerá hotovo.
 *  D. **Pri nule zostáva TVAR, nie poplach.** Farbu berie značka z tej istej
 *     podmienky ako ľavý prúžok (`data-any='ano'`); bez čísla je tlmená.
 *     Preto sa tu tvrdí aj to, že predvolená farba `.queueGlyph` NIE JE
 *     stavový token.
 *  E. **Teal, zlatá ani `--brand` nekódujú stav** — ani v značke.
 *
 * Vlastník: A2, šprint dokončenia 20. 8. 2026.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BlockerRow, StandRow } from '@/components/campaigns/BlockerList';
import { DiscountState } from '@/components/campaigns/DiscountState';
import type { BlockerCard, StandSentence } from '@/components/campaigns/queue-model';
import type { CampaignSentence } from '@/lib/ui/vocabulary';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const DETAIL = read('../../src/components/campaigns/DiscountDetail.tsx');
const CSS = read('../../src/components/campaigns/zlavy.module.css');

/** Značka vykreslená ako ikona zo sady `ui/Icon.tsx`. */
const IKONA = /<svg[^>]*class="ovl-ic/;

/** Len to, čo človek na obrazovke prečíta — bez značiek, tried a štýlov. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

/* ═══════════ 1. Dlaždice fronty — každá zvlášť, nie súbor ako celok ═══════ */

/**
 * Štyri dlaždice a tón, ktorým ich kreslí pruh nad nimi.
 *
 * Zoznam je zámerne napísaný TU a nie odvodený zo zdroja: keby sa čítal z
 * `DiscountDetail.tsx`, test by potvrdzoval sám seba a zmiznutá dlaždica by
 * ním prešla zeleno.
 */
const DLAZDICE = [
  { state: 'ok', tone: 'good', word: 'Zapísané' },
  { state: 'pending', tone: 'progress', word: 'Čaká na zápis' },
  { state: 'failed', tone: 'critical', word: 'Nepodarilo sa' },
  { state: 'uncertain', tone: 'attention', word: 'Nevieme, či sa zapísalo' },
] as const;

/**
 * Rez na JEDNU dlaždicu — od jej `data-state` po koniec jej `<StatTile …/>`.
 *
 * Bez rezu by tvrdenie „je tam `<Icon`" platilo aj vtedy, keby značku mala
 * jediná dlaždica zo štyroch.
 */
function rezDlazdice(state: string): string {
  const zaciatok = DETAIL.indexOf(`data-state="${state}" data-any=`);
  const zaciatok2 = zaciatok === -1 ? DETAIL.indexOf(`data-state="${state}"\n`) : zaciatok;
  expect(zaciatok2, `dlaždica ${state} sa v zdroji nenašla`).toBeGreaterThan(-1);
  const koniec = DETAIL.indexOf('testId="tile-', zaciatok2);
  expect(koniec, `dlaždica ${state} nemá testId`).toBeGreaterThan(zaciatok2);
  return DETAIL.slice(zaciatok2, koniec);
}

describe('dlaždice fronty nesú farbu, značku aj slovo', () => {
  it('všetky štyri dlaždice v zdroji vôbec sú', () => {
    // Poistka na samotný rez: keby sa markup prepísal a `rezDlazdice()`
    // prestalo nachádzať čokoľvek, tvrdenia nižšie by nemali čo merať.
    for (const d of DLAZDICE) {
      expect(rezDlazdice(d.state).length, d.state).toBeGreaterThan(40);
    }
  });

  it('každá dlaždica kreslí značku ešte pred svojím StatTile', () => {
    for (const d of DLAZDICE) {
      const rez = rezDlazdice(d.state);
      expect(rez, `dlaždica ${d.state} je bez značky — stav je len farba a slovo`).toContain(
        '<Icon',
      );
      expect(rez.indexOf('<Icon')).toBeLessThan(rez.indexOf('<StatTile'));
      expect(rez, `značka dlaždice ${d.state} nemá triedu`).toContain('styles.queueGlyph');
    }
  });

  it('tvar značky berie dlaždica z koreňového slovníka, nie z vlastnej mapy', () => {
    for (const d of DLAZDICE) {
      expect(rezDlazdice(d.state), d.state).toContain(`TONE_ICON.${d.tone}`);
    }
    // Nová tabuľka „stav fronty → ikona" tu vzniknúť nesmie — bola by druhým
    // slovníkom značiek vedľa `TONE_ICON` (`ui/ToneBadge.tsx`).
    expect(DETAIL).toContain("import { TONE_ICON } from '@/components/ui/ToneBadge';");
    expect(DETAIL).not.toMatch(/Record<[^>]*,\s*IconName>/);
  });

  it('slovo pri každej dlaždici zostáva — značka ho nenahrádza', () => {
    for (const d of DLAZDICE) {
      expect(DETAIL, d.word).toContain(d.word);
    }
  });

  it('značku dlaždice nekreslí CSS — rodina .queue* nemá content:', () => {
    const vinnici = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /\.queue/.test(m[1]!) && /content:/.test(m[2]!))
      .map((m) => m[1]!.trim());
    expect(vinnici).toEqual([]);
  });
});

/* ═══════════ 2. Markup a CSS hovoria o tom istom tóne (bod C) ═════════════ */

describe('farba značky ide s farbou stavu, nie vedľa nej', () => {
  it('každý stav má farbu značky a je to ten istý tón ako v markupe', () => {
    for (const d of DLAZDICE) {
      const pravidlo = new RegExp(
        `\\.queueTile\\[data-any='ano'\\]\\[data-state='${d.state}'\\] \\.queueGlyph \\{[^}]*color:\\s*var\\(--st-${d.tone}\\)`,
      );
      expect(pravidlo.test(CSS), `${d.state} → --st-${d.tone}`).toBe(true);
    }
  });

  it('bez čísla nesie značka len tvar — predvolená farba nie je stavová (bod D)', () => {
    const zaklad = /\.queueGlyph \{([^}]*)\}/.exec(CSS);
    expect(zaklad, '.queueGlyph v CSS nie je').not.toBeNull();
    expect(zaklad![1]).toContain('color:');
    expect(zaklad![1]).not.toMatch(/--st-/);
  });

  it('značka nikdy nesiahne po teali, zlatej ani --brand (bod E)', () => {
    for (const m of CSS.matchAll(/\.queueGlyph[^{]*\{([^}]*)\}/g)) {
      expect(m[1]).not.toMatch(/--accent|--brand|--gold/);
    }
  });

  it('mriežka dlaždice existuje — bez nej by značka stála nad popiskom', () => {
    const tile = /\.queueTile \{([^}]*)\}/.exec(CSS);
    expect(tile).not.toBeNull();
    expect(tile![1]).toContain('grid-template-columns');
  });
});

/* ═══════════ 3. Vykreslený stav a prekážka majú značku naozaj ════════════ */

const SENTENCE: CampaignSentence = {
  state: 'beží',
  tone: 'live',
  flags: [{ text: 'nepodarilo sa zapísať 3 položky', tone: 'attention' }],
  text: 'beží · nepodarilo sa zapísať 3 položky',
};

const CARD: BlockerCard = {
  id: 'writes_disabled',
  severity: 'blokuje',
  resolution: 'mimo_appky',
  what: 'Zápisy do eshopu sú vypnuté.',
  nextStep: 'Zapnúť sa dajú mimo appky.',
  path: null,
  assumed: false,
  clearsAt: null,
};

const STAND: StandSentence = {
  what: 'Fronta je pozastavená po odstávke počítača.',
  nextStep: 'Rozbehne sa po potvrdení.',
  tone: 'progress',
  path: null,
};

describe('riadok stavu a riadok prekážky kreslia značku, nie len farbu', () => {
  it('stav zľavy aj jeho príznak majú vedľa slova ikonu', () => {
    const html = renderToStaticMarkup(createElement(DiscountState, { sentence: SENTENCE }));
    // Dve značky: jedna pri stave, jedna pri príznaku. Príznak nikdy nestojí
    // namiesto stavu — zľava so zlyhanými položkami stále beží.
    expect([...html.matchAll(/<svg[^>]*class="ovl-ic/g)]).toHaveLength(2);
    const text = textOf(html);
    expect(text).toContain('beží');
    expect(text).toContain('nepodarilo sa zapísať 3 položky');
  });

  it('riadok prekážky má ikonu, slovo o závažnosti aj slovo o riešení', () => {
    const html = renderToStaticMarkup(createElement(BlockerRow, { card: CARD }));
    expect(IKONA.test(html)).toBe(true);
    const text = textOf(html);
    expect(text).toContain('zastavuje zápis');
    expect(text).toContain('rieši sa mimo appky');
  });

  it('riadok o stojacej fronte značku tiež má — nie je to výnimka', () => {
    const html = renderToStaticMarkup(createElement(StandRow, { stand: STAND }));
    expect(IKONA.test(html)).toBe(true);
    expect(textOf(html)).toContain('Fronta je pozastavená po odstávke počítača.');
  });

  it('značka je pre čítačku skrytá — slovo pri nej stojí v tom istom uzle', () => {
    const html = renderToStaticMarkup(createElement(BlockerRow, { card: CARD }));
    const svg = /<svg[^>]*class="ovl-ic[^>]*>/.exec(html);
    expect(svg).not.toBeNull();
    expect(svg![0]).toContain('aria-hidden');
  });
});
