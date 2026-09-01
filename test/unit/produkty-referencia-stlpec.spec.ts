/**
 * Aura Zľavy — REFERENCIA JE SAMOSTATNÝ PRVÝ STĹPEC (D122, 1. 9. 2026; K1).
 *
 * ČO TENTO SÚBOR STRÁŽI
 * ─────────────────────
 * Do 1. 9. 2026 bola referencia zlepená s názvom („— · Náramok z chirurgickej
 * ocele…"). Podľa referencie sa pritom kus hľadá v sklade aj v administrácii
 * eshopu, kým názvy sa opakujú — preto dostala vlastný PRVÝ stĺpec. Tento
 * súbor drží štyri veci, na ktorých sa to dá potichu pokaziť:
 *
 *  1. **Poradie stĺpcov.** Prvý je REFERENCIA, druhý NÁZOV. Keby sa prehodili,
 *     zmizne dôvod, prečo sa vôbec rozdeľovali.
 *  2. **Chýbajúca referencia je PRIZNANIE, nie prázdno (I11).** Pomlčka nesie
 *     dôvod a rozlišuje „produkt nie je obohatený" od „appka sa pýtala a shop
 *     o poli nič nevie" a od „KPI riadku sa ešte nenačítali". Vymyslené číslo
 *     (napríklad `product_id` namiesto referencie) tu nesmie byť ani raz.
 *  3. **Referencia sa NESKRACUJE.** Je to identifikátor; orezaný identifikátor
 *     je iný identifikátor. Bunka teda nemá ani výpustku, ani `overflow`.
 *  4. **`productLabel()` v tabuľke NIE JE, v audite ÁNO.** Modul
 *     `lib/ui/product-label.ts` zostáva pre miesta, kde je na produkt jeden
 *     riadok textu; tabuľka má stĺpce a skladať v nej „ref · názov" by tú
 *     opravu vrátilo späť.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť.
 *
 * Vlastník: V5, vlna REFERENCIA-STĹPEC.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CatalogTable from '@/components/products/CatalogTable';
import type {
  CatalogRowView,
  KpiValueView,
  ProductKpiPageView,
  ProductKpiRowView,
} from '@/components/products/catalog-api';
import { KPI_DASH } from '@/components/products/sold-coverage';
import { NEVIEME, productLabel, productNameCell } from '@/lib/ui/product-label';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const TABULKA = read('../../src/components/products/CatalogTable.tsx');
const AUDIT = read('../../src/components/audit/api.ts');

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const ROW: CatalogRowView = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen, kubický zirkón',
  price: '34.90',
  hasAttributes: false,
  shopStatus: 'ok',
  unitsSold: null,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-10T01:00:00.000Z',
  origin: 'mirror',
};

const OKNO = (windowDays: number) => ({
  windowDays,
  completeDays: 0,
  unknownDays: windowDays,
  units: { value: null, gap: 'days_missing' } as KpiValueView<number>,
  lowerBound: false,
});

/** Riadok, o ktorom appka nevie nič — `getFull` sa naň nikdy nepýtalo. */
function neobohateny(): ProductKpiRowView {
  const gap = { value: null, gap: 'not_enriched' } as const;
  return {
    productId: ROW.productId,
    missing: false,
    reference: gap,
    supplier: gap,
    priceWithVat: gap,
    margin: gap,
    marginPercent: gap,
    discount: {
      state: 'unknown',
      activePercent: { value: null, gap: 'not_enriched' },
      from: null,
      to: null,
      measuredAt: null,
    },
    stock: gap,
    soldTotal: gap,
    lastSaleAt: gap,
    daysSinceLastSale: gap,
    soldPerStock: gap,
    units30: OKNO(30),
    units90: OKNO(90),
    noSale: { mark: false, proof: null },
    enrichedAt: null,
  };
}

function obohateny(reference: KpiValueView<string>): ProductKpiRowView {
  return {
    ...neobohateny(),
    reference,
    stock: { value: 8, gap: null },
    enrichedAt: '2026-08-30T02:00:00.000Z',
  };
}

const stranka = (row: ProductKpiRowView): ProductKpiPageView => ({
  today: '2026-09-01',
  shortWindowDays: 30,
  longWindowDays: 90,
  byId: new Map([[row.productId, row]]),
});

const render = (kpi: ProductKpiPageView | null, row: CatalogRowView = ROW): string =>
  renderToStaticMarkup(
    createElement(CatalogTable, {
      rows: [row],
      kpi,
      soldWindowDays: 30,
      total: 1,
      page: 1,
      perPage: 100 as const,
      loading: false,
      selected: new Set<number>(),
      allMatchingSelected: false,
      onToggleRow: () => {},
      onTogglePage: () => {},
      onOpenDetail: () => {},
      onPage: () => {},
      onPerPage: () => {},
    }),
  );

/** Bunka referencie aj s obalom `<td>` — testy merajú TELO, nie model. */
function bunkaReferencie(html: string): string {
  const zaciatok = html.indexOf('<td class="num" data-l="Referencia"');
  expect(zaciatok, 'stĺpec Referencia v riadku chýba').toBeGreaterThan(-1);
  const koniec = html.indexOf('</td>', zaciatok);
  return html.slice(zaciatok, koniec + 5);
}

/** Celé tlačidlo názvu aj so štýlom — teda to, čo je NAOZAJ v stĺpci Názov. */
function bunkaNazvu(html: string): string {
  const kotva = html.indexOf(`data-testid="open-detail-${ROW.productId}"`);
  expect(kotva, 'tlačidlo názvu v riadku chýba').toBeGreaterThan(-1);
  const zaciatok = html.lastIndexOf('<button', kotva);
  const koniec = html.indexOf('</button>', kotva);
  return html.slice(zaciatok, koniec);
}

/**
 * Zdroj bez komentárov. Tvrdenie „modul toto nepoužíva" musí merať KÓD —
 * inak ho zhodí veta v docblocku, ktorá práve vysvetľuje, prečo sa to
 * nepoužíva.
 */
const bezKomentarov = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ═════════════ 1. Poradie stĺpcov: referencia PRVÁ ═══════════════════════ */

describe('V5 — referencia je samostatný prvý stĺpec (D122)', () => {
  it('hlavička má REFERENCIU pred NÁZVOM, nie ako jeho predponu', () => {
    const html = render(stranka(obohateny({ value: 'NAU-1042', gap: null })));
    const hlavicka = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));

    expect(hlavicka).toContain('Referencia');
    expect(hlavicka.indexOf('Referencia')).toBeLessThan(hlavicka.indexOf('Názov'));
  });

  it('prvý stĺpec riadku (hneď za zaškrtávacím políčkom) nesie referenciu, nie názov', () => {
    const html = render(stranka(obohateny({ value: 'NAU-1042', gap: null })));
    const riadok = html.slice(html.indexOf('<tbody>'));

    // Poradie buniek v TELE odpovede, nie v modeli: `data-l` je menovka bunky
    // v kartovom rozložení a je to jediné miesto, kde je poradie vidieť.
    expect(riadok.indexOf('data-l="Referencia"')).toBeLessThan(riadok.indexOf('data-l="Produkt"'));
    expect(bunkaReferencie(html)).toContain('NAU-1042');
  });

  it('názov už NEMÁ referenciu ani pomlčku pred sebou', () => {
    const html = render(stranka(obohateny({ value: 'NAU-1042', gap: null })));
    const nazov = bunkaNazvu(html);

    expect(nazov).toContain(ROW.name);
    // Toto je celá oprava D122: „NAU-1042 · Náramok" v jednej bunke už nie je.
    expect(nazov).not.toContain('NAU-1042');
    expect(nazov).not.toContain(KPI_DASH);
    expect(html).not.toContain(`NAU-1042 · ${ROW.name}`);
  });

  it('`title` názvu ďalej nesie technické `#id` — identifikátor nezmizol', () => {
    const html = render(stranka(obohateny({ value: 'NAU-1042', gap: null })));

    expect(html).toContain(`title="${ROW.name} · #${ROW.productId}"`);
    // `#id` je v `title`, nie ako stĺpec (P3).
    expect(html).not.toContain(`>${ROW.productId}<`);
  });
});

/* ═════════════ 2. Chýbajúca referencia: pomlčka a PRIZNANIE (I11) ════════ */

describe('V5 — chýbajúca referencia sa prizná, nikdy nevymyslí', () => {
  it('neobohatený produkt má pomlčku a dôvod „nie je obohatený"', () => {
    const bunka = bunkaReferencie(render(stranka(neobohateny())));

    expect(bunka).toContain(KPI_DASH);
    expect(bunka).toContain('data-unknown="true"');
    expect(bunka).toContain('Produkt ešte nie je obohatený');
    // NESMIE tvrdiť, že referenciu nemá SHOP — appka sa naň nikdy nepýtala.
    expect(bunka).toContain('Nie je to nula ani prázdna hodnota v shope');
    // A nikdy nesmie dosadiť `product_id` ako náhradu za referenciu: v bunke
    // je vypísaná POMLČKA, nie číslo (`data-testid` id nesie a nesie ho ďalej).
    expect(bunka).toContain(`>${KPI_DASH}</span>`);
    expect(bunka).not.toContain(`>${ROW.productId}<`);
  });

  it('„pýtali sme sa a shop nič nevie" je INÁ veta než „nie je obohatený"', () => {
    const bunka = bunkaReferencie(
      render(stranka(obohateny({ value: null, gap: 'shop_has_none' }))),
    );

    expect(bunka).toContain(KPI_DASH);
    expect(bunka).toContain('shop k tomuto poľu o produkte nič nevedie');
    expect(bunka).not.toContain('nie je obohatený');
  });

  it('kým odpoveď KPI neprišla, bunka priznáva TRETÍ stav, nie neobohatenie', () => {
    const bunka = bunkaReferencie(render(null));

    expect(bunka).toContain(KPI_DASH);
    expect(bunka).toContain('data-unknown="true"');
    expect(bunka).toContain('ešte nenačítali');
    expect(bunka).not.toContain('nie je obohatený');
  });

  it('nekonzistentná odpoveď (hodnota AJ dôvod) je pomlčka, nie referencia', () => {
    // Referencia z medzery by bola identifikátor, ktorý shop nepotvrdil —
    // a podľa neho by človek v sklade hľadal iný kus.
    const bunka = bunkaReferencie(
      render(stranka(obohateny({ value: 'NAU-1042', gap: 'not_enriched' }))),
    );

    expect(bunka).toContain(KPI_DASH);
    expect(bunka).not.toContain('NAU-1042');
  });
});

/* ═════════════ 3. Identifikátor sa NESKRACUJE ════════════════════════════ */

describe('V5 — referencia sa neskracuje ani o znak', () => {
  it('aj referencia na plnú dĺžku stĺpca (`VARCHAR(64)`) vyjde celá', () => {
    const dlha = `REF-${'X'.repeat(60)}`;
    expect(dlha).toHaveLength(64);

    const bunka = bunkaReferencie(render(stranka(obohateny({ value: dlha, gap: null }))));
    expect(bunka).toContain(dlha);
    expect(bunka).not.toContain('…');
  });

  it('bunka referencie nemá výpustku ani orezanie — na rozdiel od názvu', () => {
    const html = render(stranka(obohateny({ value: 'NAU-1042', gap: null })));

    expect(bunkaReferencie(html)).not.toContain('text-overflow');
    expect(bunkaReferencie(html)).not.toContain('overflow');
    // Trieda `name` je tá, ktorá v `globals.css` výpustku má; referencia ju
    // preto nesmie nosiť.
    expect(bunkaReferencie(html)).not.toContain('class="name"');
    // Názov naopak výpustku MÁ — jeho chvost sa dá dočítať v `title`.
    expect(bunkaNazvu(html)).toContain('text-overflow:ellipsis');
  });
});

/* ═════════════ 4. `productLabel()` — v tabuľke nie, v audite áno ═════════ */

describe('V5 — veta a stĺpce sú dva rôzne tvary (D122)', () => {
  it('tabuľka `productLabel()` NEPOUŽÍVA', () => {
    expect(bezKomentarov(TABULKA)).not.toContain('productLabel');
    expect(bezKomentarov(TABULKA)).toContain('productNameCell');
  });

  it('audit `productLabel()` používa ďalej — tam je na produkt jeden riadok', () => {
    expect(bezKomentarov(AUDIT)).toContain("from '@/lib/ui/product-label'");
    expect(bezKomentarov(AUDIT)).toContain('productLabel(');
  });

  it('`productLabel()` zostal celý — vetu „ref · názov" ďalej skladá', () => {
    const label = productLabel({ productId: 30582, reference: 'C16.19', name: 'Náramok' });
    expect(label.text).toBe('C16.19 · Náramok');
    expect(productLabel({ productId: 30582, reference: null, name: 'Náramok' }).reference).toBe(
      NEVIEME,
    );
  });

  it('bunka názvu je len názov; bez neho zostane `#id`, a je to priznané', () => {
    expect(productNameCell({ productId: 9, name: 'Náramok' })).toEqual({
      text: 'Náramok',
      unknown: false,
      technical: '#9',
    });
    expect(productNameCell({ productId: 9, name: '   ' })).toEqual({
      text: '#9',
      unknown: true,
      technical: '#9',
    });
  });

  it('riadok bez názvu ukáže `#id` stlmene, nie prázdnu bunku', () => {
    const html = render(stranka(obohateny({ value: 'NAU-1042', gap: null })), {
      ...ROW,
      name: null,
    });
    const nazov = bunkaNazvu(html);

    expect(nazov).toContain(`#${ROW.productId}`);
    expect(nazov).toContain('lvl-3');
  });
});
