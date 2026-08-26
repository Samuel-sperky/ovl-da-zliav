/**
 * Aura Zľavy — NOVÁ ZĽAVA, karta rozhodnutia po oprave D11–D14
 * (kontrakt UX/dizajn 19. 8. 2026; kontrakt UI, body 5, 11, 24; P1; I3).
 *
 * Testuje sa presne to, čo sa na tejto karte dá ticho pokaziť späť:
 *
 *  A. **D11 — pomlčka sa nesmie vrátiť do `.big`.** Toto je celá podstata
 *     defektu: pravidlo „keď appka nevie, je tam pomlčka, nikdy nula" je
 *     správne, ale em pomlčka v 64 px a reze 660 nie je interpunkcia, je to
 *     vyplnený obdĺžnik. Dominanta karty, pred ktorou človek potvrdzuje zápis
 *     do ostrého eshopu, tak vyzerala ako chyba vykreslenia a popisok pod ňou
 *     nemal nad sebou hodnotu. Test stráži oboje: pomlčka ostáva, ale nikdy
 *     nie v triede `big` — a nikdy sama, vždy so slovom.
 *  B. **D12 — poradie krokov.** Skúška naprázdno → ručný počet → zaradenie.
 *     Keby sa poradie otočilo späť, obrazovka by znova stavila najvýraznejší
 *     prvok na najnebezpečnejší krok.
 *  C. **D13 — prekážky sú v karte rozhodnutia**, nie vo vlastnej karte vedľa.
 *  D. **I3 neoslabol.** Obe poistky sú stále na obrazovke a zamknuté tlačidlo
 *     stále hovorí dôvod. Zmena vzhľadu potvrdenia sa nesmie stať zmenou
 *     jeho mechaniky.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť.
 *
 * ČO SA 19. 8. 2026 DOPLNILO A PREČO
 * ----------------------------------
 * Skupina E merala poistku pred zápisom len zvonku a jeden jej prípad merala
 * naprázdno: „samotná čerstvá skúška bez vpísaného počtu nič neodomkne"
 * renderovala kartu s `previewFresh: true`, ale `blockedReason` si nechala
 * neprázdny z `PROPS`. Tlačidlo bolo vypnuté VÝHRADNE kvôli tomu propu, takže
 * o vpísanom počte test nezistil nič — a samotné pravidlo `typed === itemsCount`
 * žilo v `NewDiscount.tsx` bez akéhokoľvek pokrytia. Skupina **F** ho teraz
 * meria priamo nad `queueBlockedReason()`, teda nad tou istou funkciou, ktorú
 * volá obrazovka, a skupina E si výsledok od nej berie namiesto vymysleného
 * propu.
 *
 * Skupina **G** meria P1 v stave, ktorý dominantu prevracal: pri prázdnom
 * zrkadle katalógu je dominanta pomlčka so slovom (26 px), zatiaľ čo ručný
 * počet má 28 px v ráme. Najťažší prvok karty tak bol krok, ktorý sa nedal
 * urobiť.
 *
 * ČO SA 26. 8. 2026 DOPLNILO A PREČO (nález U2)
 * ---------------------------------------------
 * Skupina **H** meria, čo karta vypíše, keď potvrdenie zlyhá. Do 26. 8. sem
 * šla `error.message` z odpovede servera VERBATIM — a najčastejšia chyba tejto
 * obrazovky (platnosť skúšky naprázdno uplynula, kým človek rozhodoval o
 * tisícoch produktov) je na serveri napísaná presne tým slovníkom, ktorý K10
 * a P3 na povrchu zakazujú. Prekladač pre susedný prípad (blokátory) pritom
 * o dva riadky vyššie existoval.
 *
 * Test preto nemeria zdroj servera ani text prekladača, ale VYKRESLENÝ obsah
 * riadku `confirm-error` pri tých kódoch, ktoré server na tejto ceste naozaj
 * vracia. Padne v oboch smeroch: keď sa preklad odstráni, aj keď stratí ďalší
 * krok. Pätnásť minút v tej vete je pripnuté na `PREVIEW_TOKEN_TTL_SECONDS`,
 * aby sa číslo v texte nerozišlo s tým, ktoré token naozaj drží.
 *
 * Vlastník: O2, kontrakt UX/dizajn 19. 8. 2026.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import NewDiscountConfirm from '@/components/campaigns/NewDiscountConfirm';
import { queueBlockedReason, type QueueGateState } from '@/components/campaigns/NewDiscount';
import { buildTiers, type SelectableRow } from '@/components/campaigns/discounts-model';
import { previewBlockerText, type BlockerCard } from '@/components/campaigns/queue-model';
import { PREVIEW_TOKEN_TTL_SECONDS } from '@/lib/crypto/preview-token';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const ROWS: SelectableRow[] = [
  { productId: 18342, name: 'Strieborné náušnice Lumen', price: '34.90', unitsSold: 0, discountedNow: false },
  { productId: 21170, name: 'Strieborný prsteň Aurora', price: '49.00', unitsSold: 0, discountedNow: false },
];

const PROPS = {
  itemsCount: 8000,
  tiers: buildTiers(ROWS, 180),
  averagePrice: 46.2,
  typed: '',
  onTyped: () => {},
  previewFresh: false,
  preview: null,
  previewAt: null,
  busy: 'idle' as const,
  blockedReason: 'Najprv spustite skúšku naprázdno pre tento výber.',
  error: null,
  created: null,
  onPreview: () => {},
  onQueue: () => {},
};

const WRITES_OFF: BlockerCard = {
  id: 'writes_disabled',
  severity: 'blokuje',
  resolution: 'mimo_appky',
  what: 'Zápisy do shopu sú vypnuté — appka teraz nezapíše ani jeden produkt.',
  nextStep: 'Zapnúť ich môže len správca počítača v konfigurácii appky.',
  path: null,
  assumed: false,
  clearsAt: null,
};

const render = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(NewDiscountConfirm, { ...PROPS, ...extra }));

/** Otváracia značka prvku, ktorý nesie dané `data-testid`. */
function openingTagOf(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
}

const MODULE_CSS = read('../../src/components/campaigns/zlavy.module.css');
const GLOBAL_CSS = read('../../src/app/globals.css');

/** Veľkosť písma prvého pravidla daného selektora, v px. */
function fontSizeOf(css: string, selector: string): number {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  const block = css.slice(at, css.indexOf('}', at));
  const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(block);
  expect(size, selector).not.toBeNull();
  return Number(size![1]);
}

/**
 * Poistka pred zápisom tak, ako ju počíta obrazovka. Predvolený stav je ten,
 * v ktorom je všetko hotové — každý test si pokazí práve jednu vec, aby bolo
 * vidieť, ktorá podmienka zámok drží.
 */
const GATE: QueueGateState = {
  itemsCount: 8000,
  writesLocked: false,
  percentError: undefined,
  windowError: null,
  previewFresh: true,
  previewBlockers: 0,
  typed: '8000',
};

const blockedFor = (extra: Partial<QueueGateState> = {}): string | null =>
  queueBlockedReason({ ...GATE, ...extra });

/* ═════════════ A. D11 — dominanta, ktorú appka nevie ═════════════════════ */

describe('A — neznámy počet je pomlčka so slovom, nikdy obdĺžnik (D11)', () => {
  it('pri známom počte je dominanta číslo v `big`', () => {
    const html = render();
    expect(openingTagOf(html, 'confirm-count')).toContain('big');
    expect(html).toContain('produktov dostane zľavu');
  });

  it('pri neznámom počte NIE JE dominanta v `big` — 64 px pomlčka je obdĺžnik', () => {
    const html = render({ itemsCount: 0, countKnown: false });
    expect(openingTagOf(html, 'confirm-count')).not.toContain('big');
  });

  it('pomlčka zostáva a nula sa nedopočíta (kontrakt UI, bod 5)', () => {
    const html = render({ itemsCount: 0, countKnown: false });
    const at = html.indexOf('data-testid="confirm-count"');
    expect(html.slice(at, at + 60)).toContain('—');
    expect(html.slice(at, at + 60)).not.toContain('0');
  });

  it('pomlčka nikdy nestojí sama — má pri sebe slovo', () => {
    const html = render({ itemsCount: 0, countKnown: false });
    expect(html).toContain('zatiaľ nevieme');
  });

  it('popisok nikdy nevisí nad prázdnom — bez hodnoty sa pýta „koľko"', () => {
    const html = render({ itemsCount: 0, countKnown: false });
    expect(html).toContain('koľko produktov dostane zľavu');
  });

  it('v žiadnom stave nie je em pomlčka priamo v prvku s triedou `big`', () => {
    for (const state of [{}, { itemsCount: 0, countKnown: false }, { countKnown: false }]) {
      const html = render(state);
      expect(html).not.toMatch(/class="[^"]*\bbig\b[^"]*"[^>]*>\s*—/);
    }
  });
});

/* ═════════════ B. D12 — poradie a váha krokov ═══════════════════════════ */

describe('B — kroky idú v poradí, v akom sa robia (D12)', () => {
  it('skúška naprázdno stojí PRED ručným počtom a ten PRED zaradením', () => {
    const html = render();
    const dry = html.indexOf('data-testid="dry-run"');
    const typed = html.indexOf('data-testid="confirm-count-input"');
    const queue = html.indexOf('data-testid="queue-discount"');
    expect(dry).toBeGreaterThan(-1);
    expect(dry).toBeLessThan(typed);
    expect(typed).toBeLessThan(queue);
  });

  it('pole na počet už nie je zdieľané `inp big` — má vlastný, ťažší stupeň', () => {
    const html = render();
    expect(openingTagOf(html, 'confirm-count-input')).not.toMatch(/class="inp big/);
  });

  it('CSS drží ručný počet väčší než text tlačidla, ale menší než dominanta', () => {
    const gatePx = fontSizeOf(MODULE_CSS, '.gate :global(.inp).gateInput');
    expect(gatePx).toBeGreaterThanOrEqual(24);

    /*
     * Druhá polovica merania, ktorá tu do 19. 8. 2026 chýbala. „Väčší než text
     * tlačidla" sa dá splniť aj tak, že pole prerastie dominantu — a presne to
     * sa stalo pri neznámom počte. Dominanta karty pri známom počte je
     * `.lvl-1 .big` z `globals.css`; poistka nesmie byť ťažšia než ona.
     */
    expect(gatePx).toBeLessThan(fontSizeOf(GLOBAL_CSS, '.lvl-1 .big'));
  });

  it('tlačidlá už nestoja vedľa seba — zaradenie je samo v riadku akcií', () => {
    const html = render();
    const acts = html.indexOf('data-testid="queue-discount"');
    const after = html.slice(acts);
    // Za tlačidlom zaradenia už žiadne ďalšie tlačidlo v tom istom riadku nie je.
    expect(after.indexOf('data-testid="dry-run"')).toBe(-1);
  });
});

/* ═════════════ C. D13 — prekážky pri rozhodnutí, nie vedľa neho ═════════ */

describe('C — prekážky sú v karte rozhodnutia (D13)', () => {
  it('bez prekážok sa nekreslí nič', () => {
    expect(render()).not.toContain('data-testid="confirm-obstacles"');
  });

  it('s prekážkou sa kreslí V TEJ ISTEJ karte, nad krokmi', () => {
    const html = render({ obstacles: [WRITES_OFF] });
    const card = html.indexOf('data-testid="new-discount-confirm"');
    const obstacles = html.indexOf('data-testid="confirm-obstacles"');
    const dry = html.indexOf('data-testid="dry-run"');
    expect(card).toBeGreaterThan(-1);
    expect(obstacles).toBeGreaterThan(card);
    expect(obstacles).toBeLessThan(dry);
    expect(html).toContain('Zápisy do shopu sú vypnuté');
  });

  it('obrazovka už nemá vlastnú kartu prekážok vedľa rozhodnutia', () => {
    const source = read('../../src/components/campaigns/NewDiscount.tsx');
    expect(source).not.toContain('new-discount-blockers');
    expect(source).not.toContain('Čo teraz stojí v ceste');
  });
});

/* ═════════════ D. D14 — prázdny stav nezaberá pol stĺpca ════════════════ */

describe('D — prázdny katalóg: jedna veta a jedno tlačidlo (D14, bod 11)', () => {
  const source = read('../../src/components/campaigns/NewDiscount.tsx');

  it('sekcia pásiem sa pri prázdnom výbere nekreslí vôbec', () => {
    expect(source).toContain('{emptySelection ? null : (');
    expect(source).toContain('data-testid="new-discount-tiers"');
  });

  it('prázdny stav je riadok v sekcii výberu, nie vycentrovaná karta', () => {
    expect(source).toContain('data-testid="new-discount-empty"');
    expect(source).not.toContain('EmptyState');
  });
});

/* ═════════════ E. I3 — potvrdzovacia cesta neoslabla ════════════════════ */

describe('E — obe poistky I3 sú stále na obrazovke', () => {
  it('skúška naprázdno aj ručný počet existujú a nič ich nenahradilo', () => {
    const html = render();
    expect(html).toContain('data-testid="dry-run"');
    expect(html).toContain('data-testid="confirm-count-input"');
    expect(html).toContain('Napíšte počet produktov');
    expect(html).toContain('Skúška nič nezapíše');
  });

  it('kým je dôvod zámku, tlačidlo je vypnuté a dôvod je vidieť', () => {
    const html = render();
    const tag = openingTagOf(html, 'queue-discount');
    expect(tag).toContain('disabled');
    expect(html).toContain('Najprv spustite skúšku naprázdno');
  });

  it('bez dôvodu zámku je tlačidlo živé — rozhoduje výhradne `blockedReason`', () => {
    const html = render({ typed: '8000', previewFresh: true, blockedReason: null });
    expect(openingTagOf(html, 'queue-discount')).not.toContain('disabled');
  });

  /*
   * Tento prípad sa do 19. 8. 2026 meral naprázdno: karta sa renderovala
   * s `previewFresh: true`, ale `blockedReason` si nechala neprázdny
   * z `PROPS`, takže vypnuté tlačidlo nedokazovalo nič o vpísanom počte.
   * Dôvod si teraz berieme z tej istej funkcie, ktorú volá obrazovka.
   */
  it('samotná čerstvá skúška bez vpísaného počtu nič neodomkne', () => {
    const reason = blockedFor({ previewFresh: true, typed: '' });
    expect(reason).not.toBeNull();
    const html = render({ previewFresh: true, typed: '', blockedReason: reason });
    expect(openingTagOf(html, 'queue-discount')).toContain('disabled');
    expect(html).toContain(reason!);
  });

  it('a keď počet sedí, odomkne sa — cez tú istú funkciu, nie cez vymyslený prop', () => {
    const reason = blockedFor({ previewFresh: true, typed: '8000' });
    expect(reason).toBeNull();
    const html = render({ previewFresh: true, typed: '8000', blockedReason: reason });
    expect(openingTagOf(html, 'queue-discount')).not.toContain('disabled');
    expect(html).not.toContain('data-testid="queue-blocked-reason"');
  });
});

/* ═════════════ F. I3 — samotná poistka, nie jej odraz v HTML ════════════ */

describe('F — ručne vpísaný počet je posledná brzda pred zápisom (I3)', () => {
  it('so všetkým hotovým je zaradenie povolené', () => {
    expect(blockedFor()).toBeNull();
  });

  it('prázdne pole zamkne aj po čerstvej skúške a povie, čo napísať', () => {
    expect(blockedFor({ typed: '' })).toBe('Do poľa napíšte 8 000.');
  });

  it('iné číslo než výber zamkne — v oboch smeroch a aj o jednotku', () => {
    for (const typed of ['800', '80000', '7999', '8001', '0', '-8000', '8e3', 'osemtisíc']) {
      expect(blockedFor({ typed }), typed).not.toBeNull();
    }
  });

  it('to isté číslo napísané inak odomkne — medzery a nuly navyše sa tolerujú', () => {
    for (const typed of ['8000', '8 000', ' 8000 ', '08000']) {
      expect(blockedFor({ typed }), typed).toBeNull();
    }
  });

  it('zastaraná skúška zamkne aj správne vpísaný počet', () => {
    expect(blockedFor({ previewFresh: false })).toBe(
      'Najprv spustite skúšku naprázdno pre tento výber.',
    );
  });

  it('prekážka nájdená skúškou zamkne aj správne vpísaný počet', () => {
    expect(blockedFor({ previewBlockers: 1 })).toBe(
      'Skúška našla prekážku — kým trvá, zaradiť sa nedá.',
    );
  });

  it('zamknuté zápisy prebijú aj hotovú skúšku aj správny počet', () => {
    const reason = blockedFor({ writesLocked: true });
    expect(reason).not.toBeNull();
    expect(reason).not.toBe('Do poľa napíšte 8 000.');
  });

  it('chyba percenta a chyba okna sú vlastné dôvody, nie „napíšte počet"', () => {
    expect(blockedFor({ percentError: 'Percento musí byť od 1 do 90.' })).toBe(
      'Percento musí byť od 1 do 90.',
    );
    expect(blockedFor({ windowError: 'Zľava môže trvať najviac tri mesiace.' })).toBe(
      'Zľava môže trvať najviac tri mesiace.',
    );
  });

  it('poradie dôvodov je poradie závažnosti — bez produktov sa o skúške nehovorí', () => {
    expect(blockedFor({ itemsCount: 0, previewFresh: false, typed: '' })).toBe(
      'Vyberte aspoň jeden produkt.',
    );
  });

  it('prázdny výber neodomkne ani prázdne pole — nula nie je „sedí to"', () => {
    expect(blockedFor({ itemsCount: 0, typed: '0' })).not.toBeNull();
  });
});

/* ═════════════ G. P1 — dominanta sa neprevracia (19. 8. 2026) ═══════════ */

describe('G — pri neznámom počte zostáva dominanta dominantou (P1)', () => {
  it('pomlčka so slovom je menšia než ručný počet — číslami sa to vyriešiť nedá', () => {
    /*
     * Meranie, ktoré defekt odhalilo: `.unknown` má 26 px, `.gateInput` 28 px.
     * Zväčšiť pomlčku znamená vrátiť D11, zľahčiť pole znamená vrátiť D12 —
     * preto sa v tomto stave nekreslí pole, nie preto, že by sa čísla zmenili.
     * Keby raz `.unknown` `.gateInput` prerástla, tento test spadne a je to
     * signál prehodnotiť riešenie, nie ho ticho obísť.
     */
    expect(fontSizeOf(MODULE_CSS, '.unknown')).toBeLessThan(
      fontSizeOf(MODULE_CSS, '.gate :global(.inp).gateInput'),
    );
  });

  it('preto pri prázdnom výbere nestojí na karte pole, ale zamknutý riadok', () => {
    const html = render({ itemsCount: 0, countKnown: false });
    expect(html).not.toContain('data-testid="confirm-count-input"');
    expect(html).toContain('data-testid="confirm-count-locked"');
  });

  it('krok nezmizol — povie svoj názov aj dôvod, prečo je zamknutý', () => {
    const html = render({ itemsCount: 0, countKnown: false });
    expect(html).toContain('Napíšte počet produktov');
    expect(html).toContain('odomkne sa, keď bude vo výbere aspoň jeden produkt');
  });

  it('zámok nie je len farba — je to veta, a zaradenie je vypnuté dôvodom', () => {
    const html = render({
      itemsCount: 0,
      countKnown: false,
      blockedReason: blockedFor({ itemsCount: 0, previewFresh: false, typed: '' }),
    });
    expect(openingTagOf(html, 'queue-discount')).toContain('disabled');
    expect(html).toContain('Vyberte aspoň jeden produkt.');
  });

  it('hneď ako je čo potvrdzovať, pole má späť plnú váhu z D12', () => {
    const html = render({ itemsCount: 1, countKnown: true });
    expect(html).toContain('data-testid="confirm-count-input"');
    expect(html).not.toContain('data-testid="confirm-count-locked"');
    expect(openingTagOf(html, 'confirm-count-input')).toContain('gateInput');
  });
});

/* ═════ H. U2 — chyba potvrdenia sa prekladá, nevykresľuje sa verbatim ════ */

/**
 * Presné vety, ktoré na tejto ceste vracia server (`lib/crypto/preview-token.ts`
 * a `app/api/campaigns/_shared.ts`). Sú tu VERBATIM zámerne: test nemeria, čo
 * je v zdroji servera napísané, ale čo z toho príde na obrazovku, keď to server
 * pošle. Keby sa serverová veta zmenila, tento test nepadne — a nemá, lebo
 * pravidlo je „obrazovka vetu servera neopakuje", nie „server hovorí toto".
 */
const SERVER_MESSAGES: Readonly<Record<string, string>> = {
  preview_token_expired: 'Preview token expiroval (TTL 15 min) — spusti dry-run znova (I3).',
  preview_token_invalid: 'Preview token je neplatný alebo pozmenený — zápis sa odmieta (I3).',
  preview_token_used:
    'Preview token už bol použitý — každý zápis potrebuje vlastný dry-run (I3, D16).',
};

/** Čo K10/P3 na povrchu zakazuje a čo práve tieto vety niesli. */
const ZAKAZANE = ['dry-run', 'dry run', 'preview token', 'ttl', '(i3', 'payloadhash', 'jwt'];

/** Text vnútri prvku s daným `data-testid` — bez značiek. */
function textOf(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at, testId).toBeGreaterThan(-1);
  const open = html.indexOf('>', at) + 1;
  return html.slice(open, html.indexOf('<', open));
}

const errorTextFor = (code: string): string =>
  textOf(render({ error: { code, message: SERVER_MESSAGES[code] ?? 'x' } }), 'confirm-error');

describe('H — chyba pri potvrdení nejde na povrch jazykom servera (K10, P3)', () => {
  for (const code of Object.keys(SERVER_MESSAGES)) {
    it(`\`${code}\` — na karte nezostane ani jedno zakázané slovo`, () => {
      const shown = errorTextFor(code);
      for (const slovo of ZAKAZANE) {
        expect(shown.toLowerCase(), `žargón „${slovo}" na povrchu: „${shown}"`).not.toContain(
          slovo,
        );
      }
    });

    it(`\`${code}\` — obrazovka vetu servera neopakuje, ale povie ďalší krok`, () => {
      const shown = errorTextFor(code);
      expect(shown).not.toBe(SERVER_MESSAGES[code]);
      // Ďalší krok je vždy ten istý a appka pre neho má svoje slovo (K10).
      expect(shown.toLowerCase()).toContain('naprázdno');
    });

    it(`\`${code}\` — veta sa zmestí do 90 znakov (P2)`, () => {
      expect(errorTextFor(code).length, errorTextFor(code)).toBeLessThanOrEqual(90);
    });
  }

  it('pätnásť minút v tej vete je TTL tokenu, nie číslo z hlavy', () => {
    expect(errorTextFor('preview_token_expired')).toContain(
      `${PREVIEW_TOKEN_TTL_SECONDS / 60} minút`,
    );
  });

  it('neznámy kód si necháva vetu servera — hotovú slovenskú vetu appka neprepíše', () => {
    const message = 'Adresa eshopu nie je nastavená.';
    const shown = textOf(render({ error: { code: 'shop_not_configured', message } }), 'confirm-error');
    expect(shown).toBe(message);
  });

  it('kód brány ide slovníkom brány, nie správou servera', () => {
    const shown = textOf(
      render({ error: { code: 'budget_exhausted', message: 'daily write cap reached' } }),
      'confirm-error',
    );
    expect(shown).toBe(previewBlockerText('budget_exhausted', 'nepoužité'));
    expect(shown).not.toContain('cap');
  });

  it('bez chyby sa riadok nekreslí vôbec', () => {
    expect(render()).not.toContain('data-testid="confirm-error"');
  });
});
