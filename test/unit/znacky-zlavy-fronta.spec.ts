/**
 * Aura Zľavy — TRI KANÁLY PRI KAŽDOM VÝSKYTE V TABE ZĽAVY
 * (šprint dokončenia, A2, 20. 8. 2026).
 *
 * Pravidlo appky znie: **stav nikdy nie je len farba — vždy farba + značka +
 * slovo.** Tento test ho meria na VYKRESLENOM výstupe a pri KAŽDOM uzle
 * zvlášť.
 *
 * PREČO PRI KAŽDOM VÝSKYTE, A NIE PRI KAŽDOM SÚBORE
 * -------------------------------------------------
 * `test/unit/ikony.spec.ts` je poistka na prechod z CSS značiek na `<Icon>` a
 * meria s hrubosťou SÚBORU: pýta sa „kreslí tento súbor aspoň jednu značku?".
 * 20. 8. 2026 sa ukázalo, čo tým prepadne — keď sa značka odstráni z JEDNÉHO
 * z dvoch hostiteľov v tom istom súbore, druhý ju má, súbor teda „značku
 * kreslí" a test ostane zelený. Chýbajúci stav pritom na obrazovke vyzerá ako
 * preklep, nie ako chyba: farba aj slovo tam sú a nič nespadne.
 *
 * Preto sa tu nič nehľadá grepom na literál triedy. Grep by o rodine `.sig`
 * nedokázal nič ani teoreticky — triedy skladá `sigClass()`, `toneSigClass()`
 * a mapa `TONE_SIG_CLASS` až za behu (pozri hlavičku `ui/blocker-look.ts`).
 * Komponenty sa vykreslia cez `renderToStaticMarkup`, výsledok sa rozreže na
 * uzly a každý hostiteľ s tónom sa preverí samostatne.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Merať sa musí uzol, nie dokument.** Tvrdenie „v HTML je `<svg>`" je
 *     presne tá hrubosť, ktorá mutáciu pustila. Značka musí byť VNÚTRI toho
 *     istého uzla, ktorý nesie tónovanú triedu.
 *  B. **Počet hostiteľov sa tvrdí dopredu.** Bez toho by prešiel aj hostiteľ,
 *     ktorý zo stránky zmizol úplne — nula uzlov je nula porušení.
 *  C. **Holá `.sig` bez tónu je ZÁMER, nie zabudnuté miesto.**
 *     `campaigns/BlockerList.tsx` ňou dáva závažnosti tvar značky, ale ani
 *     farbu, ani glyf — tie kóduje spôsob riešenia vedľa. Musí mať slovo a
 *     NESMIE mať značku; test tvrdí oboje, aby sa výnimka nedala použiť ako
 *     zadné dvierka.
 *  D. **Dlaždice fronty sa vykresľujú naozaj.** `DiscountDetail` je klientský
 *     komponent, ktorý si čísla ťahá až v efekte, takže sa dal merať len nad
 *     zdrojom. Štyri dlaždice sú preto od 20. 8. 2026 samostatný čistý
 *     `QueueTiles` — rovnako, ako sa 19. 8. oddelila `PerformanceCard` od
 *     `DiscountPerformance`, a z toho istého dôvodu.
 *  E. **Markup a CSS musia hovoriť o tom istom tóne.** Dlaždica `failed` má
 *     ikonu tónu `critical` a v CSS `--st-critical`. Keby sa jedno zmenilo bez
 *     druhého, tvar by hovoril iné než farba — a to je horšie než chýbajúca
 *     značka, lebo to vyzerá hotovo.
 *  F. **Pri nule zostáva TVAR, nie poplach.** Farbu berie značka z tej istej
 *     podmienky ako ľavý prúžok (`data-any='ano'`); bez čísla je tlmená.
 *
 * Vlastník: A2, šprint dokončenia 20. 8. 2026.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  BlockerList,
  BlockerRow,
  BlockerRules,
  StandPanel,
  StandRow,
} from '@/components/campaigns/BlockerList';
import { QueueTiles } from '@/components/campaigns/DiscountDetail';
import { DiscountState } from '@/components/campaigns/DiscountState';
import type { BlockerCard, StandSentence } from '@/components/campaigns/queue-model';
import { BLOCKER_RESOLUTION_CODES, type BlockerResolutionCode } from '@/components/ui/blocker-look';
import type { CampaignSentence, FlagTone, StateTone } from '@/lib/ui/vocabulary';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const DETAIL = read('../../src/components/campaigns/DiscountDetail.tsx');
const CSS = read('../../src/components/campaigns/zlavy.module.css');

/* ═══════════════════ 0. Rozrezanie HTML na uzly ═══════════════════════════ */

interface Uzol {
  /** Meno prvku (`span`, `div`, …). */
  readonly tag: string;
  /** Trieda rozdelená na slová. CSS moduly sú tu ako `_queueTile_587bce`. */
  readonly triedy: readonly string[];
  /** Atribúty ako mapa — `data-state`, `data-any`, `data-testid`. */
  readonly atributy: Readonly<Record<string, string>>;
  /** Vnútro uzla ako HTML — teda to, čo v ŇOM naozaj je. */
  readonly vnutro: string;
}

const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

/**
 * Rozreže vykreslený markup na uzly aj s ich vnútrom.
 *
 * Je to zámerne vlastný, hlúpy skener a nie regex nad celým dokumentom:
 * otázka „je značka VNÚTRI tohto uzla" sa regexom nad dokumentom položiť nedá
 * a práve jej hrubšia náhrada („je značka niekde v HTML") mutáciu pustila.
 */
function uzly(html: string): Uzol[] {
  const out: Uzol[] = [];
  const stack: { tag: string; attrs: string; koniecOtvaracieho: number }[] = [];
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(html)) !== null) {
    const cely = m[0];
    const lomka = m[1];
    const tag = m[2]!;
    const attrs = m[3]!;
    const samozatvarajuci = m[4];
    if (lomka === '/') {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i]!.tag !== tag) continue;
        const otvoreny = stack[i]!;
        stack.length = i;
        const atributy: Record<string, string> = {};
        for (const a of otvoreny.attrs.matchAll(/([\w:-]+)="([^"]*)"/g)) atributy[a[1]!] = a[2]!;
        out.push({
          tag,
          triedy: (atributy.class ?? '').split(/\s+/).filter(Boolean),
          atributy,
          vnutro: html.slice(otvoreny.koniecOtvaracieho, m.index),
        });
        break;
      }
      continue;
    }
    if (samozatvarajuci === '/' || VOID.has(tag)) continue;
    stack.push({ tag, attrs, koniecOtvaracieho: m.index + cely.length });
  }
  return out;
}

/** Značka zo sady `ui/Icon.tsx`, vykreslená. */
const IKONA = /<svg[^>]*class="[^"]*\bovl-ic\b/;

/** Text, ktorý človek prečíta — bez značiek a bez okolitého HTML. */
function text(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** Uzly rodiny `.sig` / `.flag` / `.state`. */
function hostitelia(html: string): Uzol[] {
  return uzly(html).filter((u) =>
    u.triedy.some((t) => t === 'sig' || t === 'flag' || t === 'state'),
  );
}

/**
 * Nesie hostiteľ TÓN?
 *
 * Holá `.sig` (jediná trieda, žiadna ďalšia) je zámerná výnimka — bod C.
 * Všetko ostatné v rodine tón nesie, vrátane `.flag` bez modifikátora
 * (predvolený tón je `attention`) a tried z CSS modulu (`_flagCritical_…`).
 */
function maTon(u: Uzol): boolean {
  return !(u.triedy.length === 1 && u.triedy[0] === 'sig');
}

/**
 * Jadro testu: pri KAŽDOM tónovanom hostiteľovi tri kanály zvlášť.
 *
 * Chyba pomenúva konkrétny uzol, nie súbor — inak by hlásenie nepovedalo o nič
 * viac než to hrubé meranie, ktoré tento test nahrádza.
 */
function overHostitelov(kde: string, html: string, ocakavany: number): void {
  const najdene = hostitelia(html);
  // Bod B — bez tohto by prešiel aj hostiteľ, ktorý zmizol úplne.
  expect(najdene.length, `${kde}: iný počet hostiteľov, než test čaká`).toBe(ocakavany);

  for (const u of najdene) {
    const meno = `${kde} · <${u.tag} class="${u.triedy.join(' ')}">`;
    if (!maTon(u)) {
      // Bod C — holá `.sig` má slovo a značku mať NESMIE.
      expect(text(u.vnutro), `${meno}: výnimka bez slova`).not.toBe('');
      expect(IKONA.test(u.vnutro), `${meno}: holá .sig si značku pribrala`).toBe(false);
      continue;
    }
    expect(IKONA.test(u.vnutro), `${meno}: BEZ ZNAČKY — stav je len farba a slovo`).toBe(true);
    expect(text(u.vnutro), `${meno}: bez slova — značka slovo nenahrádza`).not.toBe('');
  }
}

const render = (el: ReactElement): string => renderToStaticMarkup(el);

/* ═══════════════════ 1. Dlaždice fronty — každá zvlášť ════════════════════ */

/**
 * Štyri dlaždice a tón, ktorým ich kreslí pruh nad nimi.
 *
 * Zoznam je napísaný TU a nie odvodený zo zdroja: keby sa čítal z
 * `DiscountDetail.tsx`, test by potvrdzoval sám seba.
 */
const DLAZDICE = [
  { state: 'ok', tone: 'good', word: 'Zapísané' },
  { state: 'pending', tone: 'progress', word: 'Čaká na zápis' },
  { state: 'failed', tone: 'critical', word: 'Nepodarilo sa' },
  { state: 'uncertain', tone: 'attention', word: 'Nevieme, či sa zapísalo' },
] as const;

/** Čísla, pri ktorých má každá dlaždica čo hlásiť. */
const PLNA = { itemsOk: 12, itemsPending: 3, itemsFailed: 2, itemsUncertain: 1, itemsTotal: 18 };
/** Hotová zľava — tri dlaždice na nule. Značka tam musí byť aj tak. */
const NULOVA = { itemsOk: 18, itemsPending: 0, itemsFailed: 0, itemsUncertain: 0, itemsTotal: 18 };

const tiles = (counts: typeof PLNA): string =>
  render(createElement(QueueTiles, { campaign: counts as never }));

/** Uzol jednej dlaždice — kľúčuje sa `data-state`, teda tým, čo nesie farbu. */
function dlazdica(html: string, state: string): Uzol {
  const najdena = uzly(html).find(
    (u) => u.atributy['data-state'] === state && 'data-any' in u.atributy,
  );
  expect(najdena, `dlaždica ${state} sa nevykreslila`).toBeDefined();
  return najdena!;
}

describe('každá dlaždica fronty nesie farbu, značku aj slovo', () => {
  it('vykreslia sa práve štyri dlaždice — ani jedna sa nezliala', () => {
    const najdene = uzly(tiles(PLNA)).filter((u) => 'data-any' in u.atributy);
    expect(najdene).toHaveLength(4);
  });

  it('KAŽDÁ dlaždica má značku vo svojom uzle, nie niekde v dokumente (bod A)', () => {
    const html = tiles(PLNA);
    for (const d of DLAZDICE) {
      expect(IKONA.test(dlazdica(html, d.state).vnutro), `dlaždica ${d.state} je bez značky`).toBe(
        true,
      );
    }
  });

  it('KAŽDÁ dlaždica má vedľa značky svoje slovo', () => {
    const html = tiles(PLNA);
    for (const d of DLAZDICE) {
      expect(text(dlazdica(html, d.state).vnutro), d.state).toContain(d.word);
    }
  });

  it('KAŽDÁ dlaždica nesie farbu — `data-state` a `data-any` naraz', () => {
    const html = tiles(PLNA);
    for (const d of DLAZDICE) {
      const u = dlazdica(html, d.state);
      expect(u.atributy['data-state']).toBe(d.state);
      expect(u.atributy['data-any']).toBe('ano');
    }
  });

  it('pri nule zostáva značka aj slovo, mizne len farba (bod F)', () => {
    const html = tiles(NULOVA);
    for (const d of DLAZDICE.filter((x) => x.state !== 'ok')) {
      const u = dlazdica(html, d.state);
      expect(u.atributy['data-any'], `${d.state} pri nule farbí`).toBe('nie');
      expect(IKONA.test(u.vnutro), `${d.state} pri nule stratil značku`).toBe(true);
      expect(text(u.vnutro), d.state).toContain(d.word);
    }
  });

  it('značky štyroch dlaždíc sú štyri RÔZNE tvary — nie štyrikrát tá istá', () => {
    const html = tiles(PLNA);
    const tvary = DLAZDICE.map((d) => {
      const svg = /<svg[\s\S]*?<\/svg>/.exec(dlazdica(html, d.state).vnutro);
      expect(svg, `dlaždica ${d.state} nemá svg`).not.toBeNull();
      return [...svg![0].matchAll(/ d="([^"]*)"/g)].map((p) => p[1]).join('|');
    });
    expect(new Set(tvary).size, 'dva stavy kreslia ten istý tvar').toBe(4);
  });

  it('značka je pre čítačku skrytá — slovo pri nej stojí v tom istom uzle', () => {
    const html = tiles(PLNA);
    for (const d of DLAZDICE) {
      const svg = /<svg[^>]*>/.exec(dlazdica(html, d.state).vnutro);
      expect(svg![0], d.state).toContain('aria-hidden');
    }
  });
});

/* ═══════════════════ 2. Markup a CSS o tom istom tóne (bod E) ═════════════ */

describe('farba značky ide s farbou stavu, nie vedľa nej', () => {
  it('každý stav má v CSS farbu značky a je to ten istý tón ako v markupe', () => {
    for (const d of DLAZDICE) {
      const pravidlo = new RegExp(
        `\\.queueTile\\[data-any='ano'\\]\\[data-state='${d.state}'\\] \\.queueGlyph \\{[^}]*color:\\s*var\\(--st-${d.tone}\\)`,
      );
      expect(pravidlo.test(CSS), `${d.state} → --st-${d.tone}`).toBe(true);
    }
  });

  it('tvar značky berie dlaždica z koreňového slovníka, nie z vlastnej mapy', () => {
    for (const d of DLAZDICE) {
      expect(DETAIL, d.state).toContain(`TONE_ICON.${d.tone}`);
    }
    expect(DETAIL).toContain("import { TONE_ICON } from '@/components/ui/ToneBadge';");
    // Druhá tabuľka „stav → ikona" tu vzniknúť nesmie.
    expect(DETAIL).not.toMatch(/Record<[^>]*,\s*IconName>/);
  });

  it('bez čísla nesie značka len tvar — predvolená farba nie je stavová (bod F)', () => {
    const zaklad = /\.queueGlyph \{([^}]*)\}/.exec(CSS);
    expect(zaklad, '.queueGlyph v CSS nie je').not.toBeNull();
    expect(zaklad![1]).toContain('color:');
    expect(zaklad![1]).not.toMatch(/--st-/);
  });

  it('značka nikdy nesiahne po teali, zlatej ani --brand', () => {
    for (const m of CSS.matchAll(/\.queueGlyph[^{]*\{([^}]*)\}/g)) {
      expect(m[1]).not.toMatch(/--accent|--brand|--gold/);
    }
  });

  it('mriežka dlaždice existuje — bez nej by značka stála nad popiskom', () => {
    const tile = /\.queueTile \{([^}]*)\}/.exec(CSS);
    expect(tile).not.toBeNull();
    expect(tile![1]).toContain('grid-template-columns');
  });

  it('značku dlaždice nekreslí CSS — rodina .queue* nemá content:', () => {
    const vinnici = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /\.queue/.test(m[1]!) && /content:/.test(m[2]!))
      .map((m) => m[1]!.trim());
    expect(vinnici).toEqual([]);
  });
});

/* ═══════════════════ 3. Riadok stavu — stav AJ každý príznak ══════════════ */

const STAVY: readonly { state: string; tone: StateTone }[] = [
  { state: 'pripravená', tone: 'idle' },
  { state: 'zapisuje sa', tone: 'progress' },
  { state: 'beží', tone: 'live' },
  { state: 'skončila', tone: 'done' },
];

const PRIZNAKY: readonly FlagTone[] = ['good', 'neutral', 'attention', 'critical'];

function sentenceOf(state: string, tone: StateTone, flags: readonly FlagTone[]): CampaignSentence {
  return {
    state: state as CampaignSentence['state'],
    tone,
    flags: flags.map((t) => ({ text: `príznak ${t}`, tone: t })),
    text: state,
  };
}

describe('riadok stavu zľavy — každý uzol zvlášť', () => {
  it('stav aj príznak majú značku pri KAŽDEJ kombinácii tónov', () => {
    for (const s of STAVY) {
      for (const flag of PRIZNAKY) {
        const html = render(
          createElement(DiscountState, { sentence: sentenceOf(s.state, s.tone, [flag]) }),
        );
        // Dvaja hostitelia: stav a jeden príznak. Presne toto je miesto, kde
        // meranie s hrubosťou súboru pustí značku odstránenú pri jednom z nich.
        overHostitelov(`stav ${s.state} · príznak ${flag}`, html, 2);
      }
    }
  });

  it('pri troch príznakoch naraz má značku každý z nich, nie len prvý', () => {
    const html = render(
      createElement(DiscountState, {
        sentence: sentenceOf('beží', 'live', ['attention', 'critical', 'neutral']),
      }),
    );
    overHostitelov('stav s tromi príznakmi', html, 4);
  });

  it('príznak nikdy nestojí namiesto stavu — slovo stavu zostáva', () => {
    const html = render(
      createElement(DiscountState, { sentence: sentenceOf('beží', 'live', ['critical']) }),
    );
    expect(text(html)).toContain('beží');
  });
});

/* ═══════════════════ 4. Prekážky — každý spôsob riešenia ══════════════════ */

function cardOf(resolution: BlockerResolutionCode, severity: BlockerCard['severity']): BlockerCard {
  return {
    id: `blocker-${resolution}`,
    severity,
    resolution,
    what: 'Zápisy do eshopu sú vypnuté.',
    nextStep: 'Zapnúť sa dajú v Nastaveniach.',
    path: null,
    assumed: false,
    clearsAt: null,
  };
}

const STAND: StandSentence = {
  what: 'Fronta je pozastavená po odstávke počítača.',
  nextStep: 'Rozbehne sa po potvrdení.',
  tone: 'progress',
  path: null,
};

describe('riadok prekážky — každý spôsob riešenia a každá závažnosť', () => {
  it('KAŽDÝ riadok má značku, slovo o závažnosti aj slovo o riešení', () => {
    for (const resolution of BLOCKER_RESOLUTION_CODES) {
      for (const severity of ['blokuje', 'obmedzuje', 'informuje'] as const) {
        const html = render(createElement(BlockerRow, { card: cardOf(resolution, severity) }));
        // Jediný hostiteľ rodiny je holá `.sig` závažnosti (bod C) — a práve
        // preto sa značka riadku hľadá zvlášť, nie cez `overHostitelov`.
        overHostitelov(`prekážka ${resolution}/${severity}`, html, 1);
        expect(IKONA.test(html), `${resolution}: riadok bez značky`).toBe(true);
        expect(text(html), `${resolution}: bez slova o závažnosti`).not.toBe('');
      }
    }
  });

  it('štyri spôsoby riešenia nekreslia štyrikrát ten istý tvar', () => {
    const tvary = BLOCKER_RESOLUTION_CODES.map((r) => {
      const html = render(createElement(BlockerRow, { card: cardOf(r, 'blokuje') }));
      const svg = /<svg[\s\S]*?<\/svg>/.exec(html);
      expect(svg, r).not.toBeNull();
      return [...svg![0].matchAll(/ d="([^"]*)"/g)].map((p) => p[1]).join('|');
    });
    // `sam` a `sudo` majú ROVNAKÝ tón, takže ikona je jediné, čo ich odlíši.
    expect(new Set(tvary).size, 'sam a sudo splynuli').toBeGreaterThan(2);
  });

  it('riadok o stojacej fronte značku tiež má — nie je to výnimka', () => {
    const html = render(createElement(StandRow, { stand: STAND }));
    expect(IKONA.test(html)).toBe(true);
    expect(text(html)).toContain('Fronta je pozastavená po odstávke počítača.');
  });

  it('v jednom ráme majú značku VŠETKY riadky, nie len prvý', () => {
    const cards = BLOCKER_RESOLUTION_CODES.map((r) => cardOf(r, 'blokuje'));
    const html = render(createElement(StandPanel, { stand: STAND, cards }));
    const riadky = uzly(html).filter((u) => 'data-blocker' in u.atributy);
    expect(riadky).toHaveLength(4);
    for (const u of riadky) {
      expect(IKONA.test(u.vnutro), `${u.atributy['data-blocker']}: bez značky v ráme`).toBe(true);
    }
    overHostitelov('rám dôvodov', html, 4);
  });

  it('zoznam prekážok drží to isté aj bez stojacej fronty', () => {
    const cards = BLOCKER_RESOLUTION_CODES.map((r) => cardOf(r, 'obmedzuje'));
    const html = render(createElement(BlockerList, { cards, title: 'Čo teraz platí' }));
    const riadky = uzly(html).filter((u) => 'data-blocker' in u.atributy);
    expect(riadky).toHaveLength(4);
    for (const u of riadky) expect(IKONA.test(u.vnutro), u.atributy['data-blocker']).toBe(true);
  });

  it('tiché pravidlá pod rozklikom nesú slovo — značku tam nikto nesľúbil', () => {
    const html = render(createElement(BlockerRules, { cards: [cardOf('cakanie', 'informuje')] }));
    expect(text(html)).toContain('Zápisy do eshopu sú vypnuté.');
    // Nie sú to stavy, takže rodina `.sig` sa tam objaviť nemá.
    expect(hostitelia(html)).toHaveLength(0);
  });
});

/* ═══════════════════ 5. Uzly, ktoré sa vykresliť nedajú ═══════════════════ */

/**
 * Riadok problémovej položky (`<span className={`sig ${itemSig}`}>`) žije v
 * tabuľke vnútri `DiscountDetail`, teda za načítaním. Meria sa preto nad
 * zdrojom — ale POD UZOL, nie pod súbor: rez ide od `className=` po najbližší
 * `</span>` a značka musí byť v ňom.
 */
describe('hostitelia, ktorých test vykresliť nevie, sa merajú po výskytoch', () => {
  const ZDROJ = DETAIL.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

  it('každý výskyt rodiny .sig v zdroji detailu má značku vo svojom uzle', () => {
    const vyskyty = [...ZDROJ.matchAll(/className=(?:\{`|")(?:sig|flag|state)[ `]/g)];
    expect(vyskyty.length, 'v detaile nie je ani jeden hostiteľ — rez sa rozbil').toBeGreaterThan(
      0,
    );
    for (const v of vyskyty) {
      const rez = ZDROJ.slice(v.index, ZDROJ.indexOf('</span>', v.index));
      expect(
        /<(?:SigMark|ToneSigMark|FlagMark|StateMark|Icon)\b/.test(rez),
        `hostiteľ na pozícii ${v.index} je bez značky`,
      ).toBe(true);
    }
  });
});
