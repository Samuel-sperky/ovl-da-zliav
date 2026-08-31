/**
 * Aura Zľavy — „REFERENCIA · NÁZOV" V POLOŽKÁCH ZĽAVY, VO VÝBERE A V HISTÓRII
 * (D116, K6; KONTRAKT-V4-2026-08-28).
 *
 * Do 28. 8. 2026 hovorili obrazovky o produkte číslom `product_id`. Pre appku je
 * to správny identifikátor, pre človeka slepé číslo — v sklade ani v eshope
 * podľa neho produkt nenájde. `productLabel()` (`src/lib/ui/product-label.ts`)
 * je jediné miesto, ktoré pomenovanie skladá; tento test drží, že ho tri
 * obrazovky NAOZAJ používajú a že sa pri chýbajúcej referencii nerozídu.
 *
 * ČO SA MERIA A PREČO PRÁVE TO
 * ----------------------------
 *  A. **Položky zľavy** (`ItemsTable`) — vykreslené, nie zo zdroja.
 *  B. **História** (`AuditTable`) — vykreslená. Referencia sa k riadku DOPĹŇA
 *     pri zobrazení; audit sa neprepisuje (I4), takže riadok bez doplnenia
 *     musí zostať čitateľný a `product_id` zostáva v technickom detaile.
 *  C. **Výber vo formulári novej zľavy** — vzorku appka kreslí až z riadkov,
 *     ktoré prišli z katalógu, takže `renderToStaticMarkup` ju nezastihne.
 *     Meria sa preto pomenovanie nad tou istou funkciou a k tomu JEDEN
 *     zdrojový test na tú konkrétnu bunku. Kto tam vráti `row.name`, padne
 *     tu — a keď sa vzorka raz dá vykresliť bez siete, tento zdrojový test
 *     má zmiznúť v prospech vykresleného.
 *  D. **I11** — chýbajúca referencia je „nevieme", nikdy prázdno a nikdy
 *     vymyslený kód.
 *
 * Vlastník: V4 (obrazovka Zľavy).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AuditTable from '@/components/audit/AuditTable';
import { auditProductLabel, parseAuditRow, type AuditRow } from '@/components/audit/api';
import { ItemsTable } from '@/components/campaigns/DiscountDetail';
import { spreadSample, buildTiers, type SelectableRow } from '@/components/campaigns/discounts-model';
import type { DiscountItemView } from '@/components/campaigns/zlavy-api';
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

describe('A. položka zľavy sa pomenúva „referencia · názov" (D116)', () => {
  it('s referenciou je na povrchu kód aj názov', () => {
    const html = render([item({ reference: 'NAU-0031' })]);
    expect(html).toContain('NAU-0031 · Náušnice Lumen');
  });

  it('`#id` zostáva dosiahnuteľné, ale v technickom detaile (`title`)', () => {
    const html = render([item({ reference: 'NAU-0031' })]);
    expect(html).toContain('title="#18342"');
    // Číslo produktu sa NEVYPISUJE ako text bunky.
    expect(html).not.toContain('>#18342<');
  });

  it('bez referencie zostáva názov — appka kód NEVYMÝŠĽA (I11)', () => {
    const html = render([item()]);
    expect(html).toContain('Náušnice Lumen');
    expect(html).not.toContain('NAU-');
    // Prázdny reťazec ani pomlčka pred názvom: „nevieme" nie je „ · názov".
    expect(html).not.toContain(`${NEVIEME} · Náušnice Lumen`);
  });

  it('bez referencie a bez názvu ostáva jediná identifikácia, ktorú appka má', () => {
    const html = render([item({ nameAtWrite: null })]);
    expect(html).toContain('#18342');
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

describe('C. vzorka výberu pomenúva produkt tou istou funkciou', () => {
  const ROWS: SelectableRow[] = [
    { productId: 18342, name: 'Náušnice Lumen', reference: 'NAU-0031', price: '34.90', unitsSold: 0, discountedNow: false },
    { productId: 21170, name: 'Prsteň Aurora', price: '49.00', unitsSold: 1, discountedNow: false },
  ];

  it('riadok s referenciou dá „kód · názov", riadok bez nej len názov', () => {
    const sample = spreadSample(ROWS, buildTiers(ROWS, 180).tiers, 6);
    const labels = sample.map((row) =>
      productLabel({ productId: row.productId, reference: row.reference ?? null, name: row.name }),
    );
    const byId = new Map(labels.map((label) => [label.technical, label]));
    expect(byId.get('#18342')!.text).toBe('NAU-0031 · Náušnice Lumen');
    expect(byId.get('#18342')!.referenceUnknown).toBe(false);
    expect(byId.get('#21170')!.text).toBe('Prsteň Aurora');
    expect(byId.get('#21170')!.referenceUnknown).toBe(true);
  });

  it('bunka vzorky kreslí pomenovanie, nie surový názov', () => {
    /*
     * ZDROJOVÝ test, a je to výnimka s menom: vzorku appka skladá až z riadkov
     * stiahnutých z katalógu, takže `renderToStaticMarkup` ju zastihne v stave
     * „Načítavam výber…". Kým to tak je, túto jednu bunku nestráži nikto iný —
     * e2e preklik ide cez zoznam zliav, nie cez vzorku. Keď sa vzorka bude dať
     * vykresliť bez siete, tento test má zmiznúť v prospech vykresleného.
     */
    const src = read('../../src/components/campaigns/NewDiscount.tsx');
    expect(src).toContain("import { productLabel } from '@/lib/ui/product-label';");
    expect(src).toContain('{label.text}');
    expect(src).not.toContain("<td className=\"name\">{row.name ?? 'bez názvu'}</td>");
  });

  it('referencia sa nesie z odpovede katalógu, keď ju odpoveď má', () => {
    /* `SelectableRow.reference` je voliteľné pole: `/api/catalog/search` ho
       zatiaľ nemusí posielať pri každom riadku a chýbajúca hodnota je
       „nevieme" (D118), nie „produkt kód nemá". */
    const withRef: SelectableRow = { ...ROWS[0]!, reference: 'NAU-0031' };
    expect(productLabel({ productId: withRef.productId, reference: withRef.reference ?? null, name: withRef.name }).reference).toBe('NAU-0031');
    expect(productLabel({ productId: 1, reference: null, name: null }).reference).toBe(NEVIEME);
  });
});
