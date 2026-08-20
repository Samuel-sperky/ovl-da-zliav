/**
 * Aura Zľavy — testy pravidlového analytika V1 (plán 33 §4, sekcia C3).
 *
 * `analyze()` je čistá deterministická funkcia — testuje sa offline, bez DB,
 * bez siete a bez LLM. Overuje sa aj poctivosť: žiadne zistenie netvrdí nič
 * o stave shopu a zásoba je označená ako variantná.
 */
import { describe, expect, it } from 'vitest';

import {
  addDaysOnly,
  analyze,
  ENDING_SOON_DAYS,
  LOW_STOCK_THRESHOLD,
  STALE_PRODUCT_DAYS,
  variantStockFromRaw,
  type RuleCampaign,
  type RuleSnapshot,
} from '@/lib/ai/rules';

const TODAY = '2026-08-05';

function campaign(overrides: Partial<RuleCampaign>): RuleCampaign {
  return {
    id: 1,
    name: 'Test',
    status: 'done',
    percent: 10,
    dateFrom: '2026-08-01',
    dateTo: '2026-08-20',
    itemsTotal: 2,
    itemsOk: 2,
    productIds: [11, 12],
    ...overrides,
  };
}

function snapshot(overrides: Partial<RuleSnapshot>): RuleSnapshot {
  return {
    today: TODAY,
    keyPresent: true,
    keyExpiresAt: '2026-09-30T12:00:00.000Z',
    campaigns: [],
    allowlist: [],
    variantStock: [],
    ...overrides,
  };
}

describe('analyze — determinizmus a vstupná hygiena', () => {
  it('nezmyselný deň vráti prázdny výsledok (fail-closed)', () => {
    expect(analyze(snapshot({ today: 'zajtra' }))).toEqual([]);
  });

  it('rovnaký vstup dáva rovnaký výstup (žiadna náhodnosť)', () => {
    const s = snapshot({
      campaigns: [campaign({ status: 'partial', itemsOk: 1 })],
      allowlist: [
        { productId: 5, name: 'Prsteň', label: null, hasAttributes: false, lastOwnWrite: null },
      ],
    });
    expect(analyze(s)).toEqual(analyze(s));
  });

  it('zásah (attention) sa radí pred návrh (info)', () => {
    const s = snapshot({
      campaigns: [
        campaign({ id: 1, status: 'partial', itemsOk: 1 }),
        campaign({ id: 2, status: 'done', dateTo: addDaysOnly(TODAY, 2) }),
      ],
    });
    const tones = analyze(s).map((f) => f.tone);
    expect(tones).toEqual([...tones].sort((a, b) => (a === b ? 0 : a === 'attention' ? -1 : 1)));
  });
});

describe('kampane končiace do 7 dní bez nadväznosti', () => {
  it('nahlási aktívnu kampaň končiacu v horizonte a predvyplní nadväznosť', () => {
    const c = campaign({ id: 7, dateTo: addDaysOnly(TODAY, 3) });
    const findings = analyze(snapshot({ campaigns: [c] }));
    const f = findings.find((x) => x.kind === 'ending_soon');
    expect(f).toBeDefined();
    expect(f!.href).toBe('/zlavy/7');
    // Akcia otvára drawer s predvyplnením — dvojkrok (I3) tým nie je dotknutý.
    expect(f!.action?.href).toContain('/zlavy/nova');
    expect(f!.action?.href).toContain('produkty=11%2C12');
    expect(f!.action?.href).toContain(`od=${addDaysOnly(c.dateTo, 1)}`);
  });

  it('mlčí, keď existuje nadväzujúca kampaň na rovnaký produkt', () => {
    const ending = campaign({ id: 1, dateTo: addDaysOnly(TODAY, 3) });
    const followUp = campaign({
      id: 2,
      status: 'scheduled',
      dateFrom: addDaysOnly(TODAY, 4),
      dateTo: addDaysOnly(TODAY, 20),
      productIds: [12],
    });
    const findings = analyze(snapshot({ campaigns: [ending, followUp] }));
    expect(findings.find((x) => x.kind === 'ending_soon')).toBeUndefined();
  });

  it('mlčí o kampani končiacej až za horizontom', () => {
    const c = campaign({ dateTo: addDaysOnly(TODAY, ENDING_SOON_DAYS + 1) });
    expect(analyze(snapshot({ campaigns: [c] })).find((x) => x.kind === 'ending_soon')).toBeUndefined();
  });
});

describe('produkty dlho bez vlastnej zľavy', () => {
  it('produkt bez akéhokoľvek zápisu sa hlási poctivo („nič nevie")', () => {
    const findings = analyze(
      snapshot({
        allowlist: [
          { productId: 3, name: null, label: 'náušnice', hasAttributes: false, lastOwnWrite: null },
        ],
      }),
    );
    const f = findings.find((x) => x.kind === 'stale_product');
    expect(f).toBeDefined();
    expect(f!.text).toContain('nič nevie');
  });

  it(`hlási produkt s oknom skončeným pred > ${STALE_PRODUCT_DAYS} dňami, čerstvý nechá tak`, () => {
    const stale = {
      productId: 4,
      name: 'Retiazka',
      label: null,
      hasAttributes: false,
      lastOwnWrite: { percent: 15, from: '2026-06-01', to: addDaysOnly(TODAY, -31) },
    };
    const fresh = {
      productId: 5,
      name: 'Prsteň',
      label: null,
      hasAttributes: false,
      lastOwnWrite: { percent: 10, from: '2026-07-01', to: addDaysOnly(TODAY, -5) },
    };
    const findings = analyze(snapshot({ allowlist: [stale, fresh] }));
    const ids = findings.filter((x) => x.kind === 'stale_product').map((x) => x.id);
    expect(ids).toEqual(['stale_product:4']);
  });
});

describe('čiastočné kampane a zásah (needs_key / missed)', () => {
  it('partial nesie počet nedopísaných produktov a odkaz na detail', () => {
    const f = analyze(
      snapshot({ campaigns: [campaign({ id: 9, status: 'partial', itemsTotal: 5, itemsOk: 3 })] }),
    ).find((x) => x.kind === 'partial_campaign');
    expect(f).toBeDefined();
    expect(f!.text).toContain('2 z 5');
    expect(f!.href).toBe('/zlavy/9');
    expect(f!.tone).toBe('attention');
  });

  it('needs_key a missed majú ROVNAKÝ tón (rovnaká váha)', () => {
    const findings = analyze(
      snapshot({
        campaigns: [
          campaign({ id: 1, status: 'needs_key' }),
          campaign({ id: 2, status: 'missed' }),
        ],
      }),
    ).filter((x) => x.kind === 'needs_intervention');
    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((f) => f.tone))).toEqual(new Set(['attention']));
  });
});

describe('kľúč vs. štart naplánovanej kampane', () => {
  it('hlási expiráciu kľúča pred štartom', () => {
    const f = analyze(
      snapshot({
        keyExpiresAt: '2026-08-10T08:00:00.000Z',
        campaigns: [
          campaign({ id: 3, status: 'scheduled', dateFrom: '2026-08-15', dateTo: '2026-08-30' }),
        ],
      }),
    ).find((x) => x.kind === 'key_before_start');
    expect(f).toBeDefined();
    expect(f!.action?.href).toBe('/nastavenia');
  });

  it('mlčí, keď kľúč vydrží po štart', () => {
    const findings = analyze(
      snapshot({
        keyExpiresAt: '2026-08-20T00:00:00.000Z',
        campaigns: [
          campaign({ id: 3, status: 'scheduled', dateFrom: '2026-08-15', dateTo: '2026-08-30' }),
        ],
      }),
    );
    expect(findings.find((x) => x.kind === 'key_before_start')).toBeUndefined();
  });

  it('chýbajúci kľúč pri naplánovanej kampani sa hlási tiež', () => {
    const f = analyze(
      snapshot({
        keyPresent: false,
        keyExpiresAt: null,
        campaigns: [
          campaign({ id: 4, status: 'scheduled', dateFrom: '2026-08-15', dateTo: '2026-08-30' }),
        ],
      }),
    ).find((x) => x.kind === 'key_before_start');
    expect(f).toBeDefined();
    // „API kľúč" bol žargón (P3); povrch appky hovorí „kľúč na zápis".
    expect(f!.text).toContain('kľúč na zápis nie je uložený');
  });
});

describe('nízka zásoba variantov — len variantné produkty, poctivo', () => {
  it('hlási varianty pod prahom a text priznáva pôvod údaja', () => {
    const f = analyze(
      snapshot({
        variantStock: [
          {
            productId: 8,
            name: 'Náramok',
            quantities: [10, LOW_STOCK_THRESHOLD, 0],
            fetchedAt: '2026-08-04T10:00:00.000Z',
          },
        ],
      }),
    ).find((x) => x.kind === 'low_variant_stock');
    expect(f).toBeDefined();
    expect(f!.text).toContain('len pre variantné produkty');
    expect(f!.text).toContain('2 varianty');
  });

  it('mlčí, keď sú všetky varianty nad prahom', () => {
    const findings = analyze(
      snapshot({
        variantStock: [{ productId: 8, name: null, quantities: [9, 12], fetchedAt: null }],
      }),
    );
    expect(findings.find((x) => x.kind === 'low_variant_stock')).toBeUndefined();
  });
});

describe('variantStockFromRaw — fail-closed parsovanie cache', () => {
  it('vytiahne množstvá z uloženého detailu produktu', () => {
    const stock = variantStockFromRaw(
      8,
      'Náramok',
      {
        id: 8,
        attributes: [{ id_product_attribute: 1, quantity: 2 }, { id_product_attribute: 2, quantity: '5' }],
      },
      null,
    );
    expect(stock).toEqual({ productId: 8, name: 'Náramok', quantities: [2, 5], fetchedAt: null });
  });

  it('nečitateľný tvar znamená ŽIADNE zistenie, nie vymyslené číslo', () => {
    expect(variantStockFromRaw(8, null, null, null)).toBeNull();
    expect(variantStockFromRaw(8, null, 'rozbité', null)).toBeNull();
    expect(variantStockFromRaw(8, null, { attributes: 'nie pole' }, null)).toBeNull();
    expect(variantStockFromRaw(8, null, { attributes: [{ quantity: 'veľa' }] }, null)).toBeNull();
  });
});


describe('key_before_start — porovnávajú sa OKAMIHY, nie UTC dni (E10)', () => {
  it('kľúč platný cez fire_at nehlási nič, aj keď UTC deň expirácie je pred date_from', () => {
    // Expirácia 2026-08-09T23:30Z = 10. 8. 01:30 bratislavského času; fire_at
    // kampane z 10. 8. je 9. 8. 22:05Z — kľúč fire prežije. Porovnanie UTC
    // slice(0,10) ('2026-08-09' < '2026-08-10') by tu vyrobilo falošný poplach.
    const findings = analyze(
      snapshot({
        keyExpiresAt: '2026-08-09T23:30:00.000Z',
        campaigns: [
          campaign({ id: 9, status: 'scheduled', dateFrom: '2026-08-10', dateTo: '2026-08-25' }),
        ],
      }),
    );
    expect(findings.find((x) => x.kind === 'key_before_start')).toBeUndefined();
  });

  it('kľúč expirujúci pred fire_at sa hlási aj tesne okolo polnoci', () => {
    // Expirácia 2026-08-09T22:00Z je PRED fire_at 2026-08-09T22:05Z (10. 8.
    // 00:05 lokálne) — zápis by skončil v needs_key, nález je oprávnený.
    const f = analyze(
      snapshot({
        keyExpiresAt: '2026-08-09T22:00:00.000Z',
        campaigns: [
          campaign({ id: 10, status: 'scheduled', dateFrom: '2026-08-10', dateTo: '2026-08-25' }),
        ],
      }),
    ).find((x) => x.kind === 'key_before_start');
    expect(f).toBeDefined();
  });
});
