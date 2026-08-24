/**
 * Aura Zľavy — NEZNÁMY KÓD STAVU NESMIE ZHODIŤ OBRAZOVKU (B1, vlna 24. 8. 2026).
 *
 * ČO SA STALO
 * -----------
 * `sentenceOf()` v `campaigns/discounts-model.ts` posielalo `row.status` do
 * slovníka cez holé `as CampaignStatusCode`. Keď shop alebo databáza vrátili
 * kód, ktorý appka nepozná (stalo sa s `writing`), reťaz bola:
 *
 *   CAMPAIGN_STATE['writing'] → undefined
 *   STATE_TONES[undefined]    → undefined
 *   STATE_ICON[undefined]     → undefined
 *   ICON_PATHS[undefined].map → TypeError
 *
 * Celá obrazovka Zľavy ostala prázdna, bez akéhokoľvek hlásenia. Prehľad sa
 * proti tomu bránil (`toStatusCode()`), zoznam zliav nie, a `Icon` nemal
 * záložný tvar.
 *
 * ČO TENTO SÚBOR MERIA
 * --------------------
 *
 *  A. Zoznam zliav s neznámym kódom sa VYKRESLÍ. Meria sa vykreslením, nie
 *     hľadaním reťazca v zdroji — reťazec by o páde nepovedal nič.
 *  B. Neznámy kód dostane niektoré zo ŠTYROCH slov povrchu, nie prázdno.
 *  C. `Icon` s neznámym menom nespadne a nakreslí viditeľný náhradný tvar.
 *     Ikona, ktorá potichu zmizne, je tiež porušenie: stav nesie farba +
 *     značka + slovo, takže chýbajúca značka sa musí dať nájsť — preto
 *     `data-icon-unknown`.
 *
 * Vlastník: B1, vlna 24. 8. 2026.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import DiscountState from '@/components/campaigns/DiscountState';
import {
  UNKNOWN_STATUS_FLAG,
  orderDiscounts,
  sentenceOf,
  type DiscountLike,
} from '@/components/campaigns/discounts-model';
import Icon, { ICON_PATHS, type IconName } from '@/components/ui/Icon';
import { SURFACE_STATES } from '@/lib/ui/vocabulary';

const TODAY = '2026-08-24';

/** Kód, ktorý appka nepozná — presne ten, ktorý obrazovku zhodil. */
const NEZNAMY = 'writing';

function row(patch: Partial<DiscountLike> = {}): DiscountLike {
  return {
    id: 1,
    status: 'queued',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-31',
    itemsOk: 3,
    itemsFailed: 0,
    itemsPending: 7,
    late: false,
    ...patch,
  };
}

/**
 * Bunka stavu tak, ako ju kreslí riadok zoznamu (`DiscountsList.PickRow`):
 * model dá vetu, `DiscountState` ju oblečie a `<StateMark>` k nej nakreslí
 * značku. Práve na tejto ceste appka padala.
 */
function renderRiadky(rows: readonly DiscountLike[]): string[] {
  const ordered = orderDiscounts(rows, TODAY);
  const all = [
    ...(ordered.leading === null ? [] : [ordered.leading]),
    ...ordered.active,
    ...ordered.finished,
  ];
  return all.map((r) =>
    renderToStaticMarkup(createElement(DiscountState, { sentence: sentenceOf(r, TODAY) })),
  );
}

const renderZoznam = (rows: readonly DiscountLike[]): string => renderRiadky(rows).join('');

/* ═════════════════ A. Zoznam sa vykreslí aj s neznámym kódom ══════════════ */

describe('zoznam zliav prežije kód stavu, ktorý appka nepozná', () => {
  it('riadok s kódom "writing" sa vykreslí a nezhodí obrazovku', () => {
    const riadky = renderRiadky([
      row({ id: 11, status: 'queued' }),
      row({ id: 12, status: NEZNAMY }),
      row({ id: 13, status: 'done', itemsPending: 0 }),
    ]);
    expect(riadky).toHaveLength(3);
    for (const riadok of riadky) {
      // Každý riadok má slovo AJ značku. Keby značka zmizla, stav by ostal len
      // farba a slovo — to je porušenie, o ktorom sa treba dozvedieť.
      expect(riadok).toContain('<svg');
      expect(SURFACE_STATES.some((s) => riadok.includes(s))).toBe(true);
    }
  });

  it('samotný neznámy riadok sa vykreslí so slovom aj so značkou', () => {
    const html = renderZoznam([row({ id: 12, status: NEZNAMY })]);
    expect(html).toContain('<svg');
    expect(SURFACE_STATES.some((s) => html.includes(s))).toBe(true);
  });

  it('obrazovka to PRIZNÁ — neznámy kód nesie príznak, nie ticho', () => {
    // Znenie sa berie zo zdroja, nie z literálu v teste: mení sa slovo, nie
    // fakt, a test má zamykať fakt.
    const html = renderZoznam([row({ id: 12, status: NEZNAMY })]);
    expect(html).toContain(UNKNOWN_STATUS_FLAG.text);
  });

  it('známy kód príznak nedostane — inak by hlásil chybu pri každej zľave', () => {
    const html = renderZoznam([row({ id: 11, status: 'queued' })]);
    expect(html).not.toContain(UNKNOWN_STATUS_FLAG.text);
  });
});

/* ═══════════════ B. Neznámy kód dostane slovo, nie prázdno ════════════════ */

describe('sentenceOf() nepretypováva bez kontroly', () => {
  it('neznámy kód spadne na najpasívnejšie tvrdenie, nie na undefined', () => {
    const veta = sentenceOf(row({ status: NEZNAMY }), TODAY);
    expect(SURFACE_STATES).toContain(veta.state);
    expect(veta.tone).toBeDefined();
    // Fail-closed ako v Prehľade: `draft` → „pripravená". Appka radšej
    // podcení, čo sa deje, než aby tvrdila, že sa niekde zapisuje.
    expect(veta.state).toBe('pripravená');
    // A nepredstiera ho: veta priznáva, že kód nepoznáme.
    expect(veta.flags).toContain(UNKNOWN_STATUS_FLAG);
    expect(veta.text).toContain(UNKNOWN_STATUS_FLAG.text);
  });

  it('príznak nenesie vnútorný kód — ten na povrch nepatrí (K10)', () => {
    const veta = sentenceOf(row({ status: NEZNAMY }), TODAY);
    expect(veta.text).not.toContain(NEZNAMY);
  });

  it('známe kódy sa nemenia', () => {
    expect(sentenceOf(row({ status: 'queued' }), TODAY).state).toBe('zapisuje sa');
    expect(sentenceOf(row({ status: 'cancelled' }), TODAY).state).toBe('skončila');
  });
});

/* ══════════════════ C. Icon nikdy nespadne a nezmizne ═════════════════════ */

describe('Icon s neznámym menom', () => {
  const neznamaIkona = 'ziadna-taka-ikona' as IconName;

  it('nevyhodí výnimku', () => {
    expect(() => renderToStaticMarkup(createElement(Icon, { name: neznamaIkona }))).not.toThrow();
  });

  it('nakreslí viditeľný tvar, nie prázdne svg', () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: neznamaIkona }));
    expect(html).toContain('<path');
  });

  it('chýbajúcu značku sa dá nájsť — nesie data-icon-unknown', () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: neznamaIkona }));
    expect(html).toContain('data-icon-unknown="ziadna-taka-ikona"');
  });

  it('známa ikona príznak chýbania NENESIE', () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: 'check' }));
    expect(html).not.toContain('data-icon-unknown');
    expect(html).toContain(ICON_PATHS.check[0]);
  });
});
