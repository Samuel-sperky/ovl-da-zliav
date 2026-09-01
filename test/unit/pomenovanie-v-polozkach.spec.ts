/**
 * Aura Zľavy — POMENOVANIE PRODUKTU V POLOŽKÁCH ZĽAVY, VO VÝBERE A V HISTÓRII
 * (D116, K6; D122/D124, kontrakt V5).
 *
 * Do 28. 8. 2026 hovorili obrazovky o produkte číslom `product_id`. Pre appku je
 * to správny identifikátor, pre človeka slepé číslo — v sklade ani v eshope
 * podľa neho produkt nenájde. Odvtedy je na povrchu referencia a názov.
 *
 * ČO SA ZMENILO 1. 9. 2026 (D122)
 * -------------------------------
 * Povrch má DVA tvary a nie sú zameniteľné:
 *
 *  · **veta** `referencia · názov` (`productLabel()`) — tam, kde je na produkt
 *    JEDEN RIADOK TEXTU, teda v Histórii,
 *  · **dva stĺpce** — v TABUĽKÁCH. Referencia má vlastný prvý stĺpec (D122)
 *    a názov vlastný (`productNameCell()`), lebo tabuľka má na priznanie dve
 *    miesta a zliať ich by znamenalo vyhodiť informáciu, na ktorú má miesto.
 *    Meno oboch stĺpcov nesie jednotná sada (`@/lib/ui/product-columns`, D124).
 *
 * ČO SA MERIA A PREČO PRÁVE TO
 * ----------------------------
 *  A. **Položky zľavy** (`ItemsTable`) — vykreslené, nie zo zdroja: dva stĺpce,
 *     `#id` v technickom detaile, chýbajúca referencia ako priznanie.
 *  B. **História** (`AuditTable`) — vykreslená. Riadok histórie je UDALOSŤ, nie
 *     tabuľka produktov, takže tam ostáva veta. Referencia sa k riadku DOPĹŇA
 *     pri zobrazení; audit sa neprepisuje (I4), takže riadok bez doplnenia
 *     musí zostať čitateľný a `product_id` zostáva v technickom detaile.
 *  C. **Vzorka výberu vo formulári novej zľavy** — od 1. 9. 2026 vykreslená.
 *     Dovtedy sa kreslila až z riadkov stiahnutých z katalógu a strážil ju
 *     JEDEN zdrojový test; ako samostatný komponent (`SampleTable`) sa dá
 *     vykresliť s hotovými riadkami, takže sa meria SPRÁVANIE. Zdrojový test
 *     preto zmizol, presne ako sľuboval.
 *  D. **I11** — chýbajúca referencia je „nevieme", nikdy prázdno a nikdy
 *     vymyslený kód.
 *
 * Vlastník: V4 (obrazovka Zľavy); stĺpce V5 (D122, D124).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AuditTable from '@/components/audit/AuditTable';
import { auditProductLabel, parseAuditRow, type AuditRow } from '@/components/audit/api';
import { ItemsTable } from '@/components/campaigns/DiscountDetail';
import { SampleTable } from '@/components/campaigns/NewDiscount';
import { spreadSample, buildTiers, type SelectableRow } from '@/components/campaigns/discounts-model';
import type { DiscountItemView } from '@/components/campaigns/zlavy-api';
import { SOLD_COVERAGE_UNASKED } from '@/components/products/sold-coverage';
import { NEVIEME, productLabel } from '@/lib/ui/product-label';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

function item(over: Partial<DiscountItemView> = {}): DiscountItemView {
  return {
    id: 1,
    productId: 18342,
    position: 1,
    status: 'failed',
    nameAtWrite: 'Náušnice Lumen',
    priceAtPreview: '34.90',
    priceAtWrite: null,
    priceMismatch: false,
    hasAttributes: false,
    attemptCount: 1,
    httpStatus: 500,
    errorCode: 'shop_error',
    errorMessage: null,
    finishedAt: null,
    ...over,
  };
}

function auditRow(over: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 11,
    ts: '2026-08-30T09:00:00.000Z',
    actor: 'user',
    userId: 1,
    eventType: 'write_ok',
    ok: true,
    campaignId: 42,
    campaignItemId: 7,
    productId: 18342,
    operationId: null,
    requestId: null,
    httpStatus: 200,
    message: null,
    ...over,
  };
}

const render = (rows: readonly DiscountItemView[]) =>
  renderToStaticMarkup(createElement(ItemsTable, { rows, fallbackPercent: 25 }));

/* ═════════ A. Položky zľavy ═══════════════════════════════════════════════ */

/** Obsah bunky daného stĺpca. `null` = stĺpec sa v tabuľke vôbec nekreslí. */
function bunka(html: string, id: 'reference' | 'name'): string | null {
  const found = new RegExp(`<td[^>]*data-col="${id}"[^>]*>([\\s\\S]*?)</td>`).exec(html);
  return found === null ? null : found[1]!;
}

describe('A. položka zľavy má referenciu a názov v DVOCH stĺpcoch (D122)', () => {
  it('s referenciou je na povrchu kód aj názov — každý vo svojej bunke', () => {
    const html = render([item({ reference: 'NAU-0031' })]);
    expect(bunka(html, 'reference')).toContain('NAU-0031');
    expect(bunka(html, 'name')).toContain('Náušnice Lumen');
    /* Veta „kód · názov" do tabuľky nepatrí: pomlčka pred názvom je najhoršie
       z oboch — miesto zaberie a nič nepovie (D122). */
    expect(html).not.toContain('NAU-0031 · Náušnice Lumen');
  });

  it('`#id` zostáva dosiahnuteľné, ale v technickom detaile (`title`)', () => {
    const html = render([item({ reference: 'NAU-0031' })]);
    expect(html).toContain('title="#18342"');
    // Číslo produktu sa NEVYPISUJE ako text bunky.
    expect(html).not.toContain('>#18342<');
  });

  it('bez referencie zostáva názov a bunka kódu PRIZNÁ medzeru (I11)', () => {
    const html = render([item()]);
    expect(bunka(html, 'name')).toContain('Náušnice Lumen');
    // Appka kód NEVYMÝŠĽA.
    expect(html).not.toContain('NAU-');
    // Prázdna bunka by znamenala „produkt kód nemá"; je tam pomlčka a dôvod.
    const kod = bunka(html, 'reference');
    expect(kod).toContain(NEVIEME);
    expect(kod).toContain('lvl-3');
    // A rozhodne nie predpona pred názvom.
    expect(html).not.toContain(`${NEVIEME} · Náušnice Lumen`);
  });

  it('bez referencie a bez názvu ostáva jediná identifikácia, ktorú appka má', () => {
    const html = render([item({ nameAtWrite: null })]);
    expect(bunka(html, 'name')).toContain('#18342');
  });
});

/* ═════════ B. História ════════════════════════════════════════════════════ */

describe('B. História pomenuje produkt JOIN-om, audit sa neprepisuje (I4)', () => {
  const renderAudit = (rows: readonly AuditRow[]) =>
    renderToStaticMarkup(createElement(AuditTable, { rows, onSelect: () => {} }));

  it('doplnená referencia a názov stoja pri riadku', () => {
    const html = renderAudit([auditRow({ reference: 'NAU-0031', productName: 'Náušnice Lumen' })]);
    expect(html).toContain('data-testid="audit-product-11"');
    expect(html).toContain('NAU-0031 · Náušnice Lumen');
  });

  it('doplnenie len s názvom prizná, že kód zatiaľ nevieme (D118, I11)', () => {
    const html = renderAudit([auditRow({ productName: 'Náušnice Lumen' })]);
    expect(html).toContain('Náušnice Lumen');
    expect(html).toContain('kód produktu zatiaľ nevieme');
  });

  it('bez doplnenia riadok o produkte MLČÍ — číslo patrí do technického detailu', () => {
    const html = renderAudit([auditRow()]);
    expect(html).not.toContain('data-testid="audit-product-11"');
    expect(html).not.toContain('18342');
    // Riadok histórie sa tým NESTRÁCA: čas aj udalosť sú čitateľné.
    expect(html).toContain('data-testid="audit-detail-11"');
  });

  it('riadok, ktorý nie je o produkte, pomenovanie nedostane', () => {
    expect(auditProductLabel(auditRow({ productId: null }))).toBeNull();
    expect(auditProductLabel(auditRow())).toBeNull();
    expect(auditProductLabel(auditRow({ reference: 'NAU-0031' }))?.text).toBe('NAU-0031');
  });

  it('doplnenie sa číta tolerantne — pod oboma menami, aké server posiela', () => {
    const a = parseAuditRow({ id: 1, ts: 'x', productId: 5, reference: 'A-1', productName: 'Meno' });
    const b = parseAuditRow({ id: 1, ts: 'x', productId: 5, productReference: 'A-1', name: 'Meno' });
    expect(a?.reference).toBe('A-1');
    expect(b?.reference).toBe('A-1');
    expect(a?.productName).toBe('Meno');
    expect(b?.productName).toBe('Meno');
    // Bez doplnenia je to `null` = „nevieme", nie prázdny reťazec.
    expect(parseAuditRow({ id: 1, ts: 'x', productId: 5 })?.reference).toBeNull();
  });

  it('História zostáva len na čítanie (I4) — klient nemá mutáciu', () => {
    const code = read('../../src/components/audit/api.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const forbidden of ['postJson', 'delJson', "method: 'POST'", "method: 'DELETE'"]) {
      expect(code, `audit/api.ts obsahuje ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ═════════ C. Výber vo formulári novej zľavy ══════════════════════════════ */

describe('C. vzorka výberu má tie isté dva stĺpce ako položky zľavy (D124)', () => {
  const ROWS: SelectableRow[] = [
    { productId: 18342, name: 'Náušnice Lumen', reference: 'NAU-0031', price: '34.90', unitsSold: 0, discountedNow: false },
    { productId: 21170, name: 'Prsteň Aurora', price: '49.00', unitsSold: 1, discountedNow: false },
  ];

  /**
   * Vzorka sa od 1. 9. 2026 dá vykresliť: `SampleTable` je samostatný komponent
   * práve preto, aby sa nemerala v zdroji. Pásma sa počítajú tou istou funkciou
   * ako v sprievodcovi, takže riadky prejdú rovnakým rozdelením.
   */
  const vzorka = (rows: readonly SelectableRow[]) => {
    const tiers = buildTiers(rows, 180).tiers;
    const sample = spreadSample(rows, tiers, 6);
    const tierOfProduct = new Map<number, (typeof tiers)[number]>();
    for (const tier of tiers) for (const id of tier.productIds) tierOfProduct.set(id, tier);
    return renderToStaticMarkup(
      createElement(SampleTable, {
        sample,
        total: rows.length,
        soldWindowDays: 180,
        coverage: SOLD_COVERAGE_UNASKED,
        tierOfProduct,
      }),
    );
  };

  it('riadok s referenciou má kód vo VLASTNOM stĺpci, nie pred názvom', () => {
    const html = vzorka([ROWS[0]!]);
    expect(bunka(html, 'reference')).toContain('NAU-0031');
    expect(bunka(html, 'name')).toContain('Náušnice Lumen');
    expect(html).not.toContain('NAU-0031 · Náušnice Lumen');
  });

  it('riadok bez referencie prizná medzeru — appka kód NEVYMÝŠĽA (I11, D118)', () => {
    /* `SelectableRow.reference` je voliteľné pole: `/api/catalog/search` ho
       zatiaľ nemusí posielať pri každom riadku a chýbajúca hodnota je
       „nevieme" (produkt nie je obohatený), nie „produkt kód nemá". */
    const html = vzorka([ROWS[1]!]);
    const kod = bunka(html, 'reference');
    expect(kod).toContain(NEVIEME);
    expect(kod).toContain('lvl-3');
    expect(html).not.toContain('NAU-');
    expect(bunka(html, 'name')).toContain('Prsteň Aurora');
  });

  it('vzorka a položky zľavy volajú tie isté stĺpce rovnako', () => {
    /* Keby si každá tabuľka meno stĺpca písala sama, práve tu by sa rozišli. */
    const zVzorky = /<th[^>]*data-col="reference"[^>]*>([^<]*)</.exec(vzorka(ROWS));
    const zPoloziek = /<th[^>]*data-col="reference"[^>]*>([^<]*)</.exec(render([item()]));
    expect(zVzorky).not.toBeNull();
    expect(zPoloziek).not.toBeNull();
    expect(zVzorky![1]).toBe(zPoloziek![1]);
  });

  it('veta „kód · názov" zostáva pre HISTÓRIU, nie pre tabuľky (D122)', () => {
    /* Modul `productLabel()` sa neruší — mení sa len to, kde patrí. */
    expect(productLabel({ productId: 18342, reference: 'NAU-0031', name: 'Náušnice Lumen' }).text)
      .toBe('NAU-0031 · Náušnice Lumen');
    expect(productLabel({ productId: 1, reference: null, name: null }).reference).toBe(NEVIEME);
  });
});
