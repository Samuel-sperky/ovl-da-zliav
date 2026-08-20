/**
 * Aura Zľavy — testy pravidiel kampaní (A7, D25, D27–D30, I9).
 *
 * Akceptačné kritériá A7:
 *  - `from` v minulosti sa odmietne (D30),
 *  - prekryv dvoch BUDÚCICH kampaní na tom istom produkte sa označí (D28),
 *  - jednodňová zľava vyžaduje dodatočné potvrdenie (D30),
 *  - sémantika predĺženia (D27) a prepisu (D28),
 *  - prepočet okna pri dopálení (D25): `to` v minulosti = lapse, `from`
 *    v minulosti = posun na dnes.
 *
 * Fixný „dnešok" sa posiela ako parameter — funkcie sú čisté.
 */
import { describe, expect, it } from 'vitest';

import {
  assertCampaignWindow,
  assertExtension,
  assertNoFutureOverlap,
  assertOverwriteExplicit,
  checkExtension,
  findFutureOverlaps,
  isFutureCampaign,
  productsRequiringOverwrite,
  resolveFireWindow,
  validateCampaignWindow,
  windowsOverlap,
  type ExistingCampaignWindow,
} from '@/lib/domain/campaign-rules';
import { DomainError } from '@/lib/domain/errors';

const TODAY = '2026-08-05';

describe('validateCampaignWindow (I9, D29, D30)', () => {
  it('platné okno prejde bez zistení', () => {
    expect(
      validateCampaignWindow({ from: '2026-08-10', to: '2026-09-10', percent: 15, today: TODAY }),
    ).toEqual([]);
  });

  it('from = dnes je povolené (D30)', () => {
    expect(
      validateCampaignWindow({ from: TODAY, to: '2026-08-20', percent: 10, today: TODAY }),
    ).toEqual([]);
  });

  it('from v minulosti sa odmietne (D30)', () => {
    const issues = validateCampaignWindow({
      from: '2026-08-04',
      to: '2026-08-20',
      percent: 10,
      today: TODAY,
    });
    expect(issues.map((i) => i.code)).toContain('from_in_past');
    expect(() =>
      assertCampaignWindow({ from: '2026-08-04', to: '2026-08-20', percent: 10, today: TODAY }),
    ).toThrow(DomainError);
  });

  it('to < from sa odmietne (I9)', () => {
    const issues = validateCampaignWindow({
      from: '2026-08-20',
      to: '2026-08-10',
      percent: 10,
      today: TODAY,
    });
    expect(issues.map((i) => i.code)).toContain('to_before_from');
  });

  it('okno > 3 kalendárne mesiace sa odmietne (D29)', () => {
    const issues = validateCampaignWindow({
      from: '2026-08-10',
      to: '2026-11-11', // strop je 10.11.
      percent: 10,
      today: TODAY,
    });
    expect(issues.map((i) => i.code)).toContain('range_too_long');
    // presne na strope prejde
    expect(
      validateCampaignWindow({ from: '2026-08-10', to: '2026-11-10', percent: 10, today: TODAY }),
    ).toEqual([]);
  });

  it('jednodňová zľava vyžaduje potvrdenie (D30)', () => {
    const noAck = validateCampaignWindow({
      from: '2026-08-10',
      to: '2026-08-10',
      percent: 10,
      today: TODAY,
    });
    expect(noAck.map((i) => i.code)).toContain('one_day_not_acknowledged');

    expect(
      validateCampaignWindow({
        from: '2026-08-10',
        to: '2026-08-10',
        percent: 10,
        today: TODAY,
        oneDayAcknowledged: true,
      }),
    ).toEqual([]);
  });

  it('neplatné percento a viac zistení naraz', () => {
    const issues = validateCampaignWindow({
      from: '2026-08-01',
      to: '2026-07-01',
      percent: 31,
      today: TODAY,
    });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('percent_invalid');
    expect(codes).toContain('from_in_past');
    expect(codes).toContain('to_before_from');
  });

  it('neplatný formát dátumu zastaví dátumové kontroly', () => {
    const issues = validateCampaignWindow({
      from: 'nie-datum',
      to: '2026-08-10',
      percent: 10,
      today: TODAY,
    });
    expect(issues.map((i) => i.code)).toContain('invalid_date_format');
  });
});

describe('prekryv budúcich kampaní (D28)', () => {
  const existing: ExistingCampaignWindow[] = [
    { campaignId: 1, productId: 100, dateFrom: '2026-08-10', dateTo: '2026-08-20', status: 'scheduled' },
    { campaignId: 2, productId: 200, dateFrom: '2026-09-01', dateTo: '2026-09-10', status: 'needs_key' },
    { campaignId: 3, productId: 300, dateFrom: '2026-07-01', dateTo: '2026-07-10', status: 'scheduled' }, // okno už skončilo
    { campaignId: 4, productId: 400, dateFrom: '2026-08-10', dateTo: '2026-08-20', status: 'done' }, // nie plánovaná
  ];

  it('windowsOverlap: uzavreté okná, dotyk hrán je prekryv', () => {
    expect(windowsOverlap('2026-08-01', '2026-08-10', '2026-08-10', '2026-08-20')).toBe(true);
    expect(windowsOverlap('2026-08-01', '2026-08-09', '2026-08-10', '2026-08-20')).toBe(false);
  });

  it('isFutureCampaign: plánovaný stav + živé okno', () => {
    expect(isFutureCampaign(existing[0] as ExistingCampaignWindow, TODAY)).toBe(true);
    expect(isFutureCampaign(existing[2] as ExistingCampaignWindow, TODAY)).toBe(false); // okno preč
    expect(isFutureCampaign(existing[3] as ExistingCampaignWindow, TODAY)).toBe(false); // done
  });

  it('označí prekryv dvoch budúcich kampaní na tom istom produkte', () => {
    const overlaps = findFutureOverlaps([100, 999], '2026-08-15', '2026-08-25', existing, TODAY);
    expect(overlaps.map((c) => c.campaignId)).toEqual([1]);
    expect(() =>
      assertNoFutureOverlap([100], '2026-08-15', '2026-08-25', existing, TODAY),
    ).toThrow(DomainError);
  });

  it('neprekrývajúce sa okno ani cudzí produkt neblokujú', () => {
    expect(findFutureOverlaps([100], '2026-08-21', '2026-08-30', existing, TODAY)).toEqual([]);
    expect(findFutureOverlaps([500], '2026-08-15', '2026-08-25', existing, TODAY)).toEqual([]);
    expect(() =>
      assertNoFutureOverlap([500], '2026-08-15', '2026-08-25', existing, TODAY),
    ).not.toThrow();
  });

  it('kampaň done ani so skončeným oknom nie je „budúca"', () => {
    expect(findFutureOverlaps([300, 400], '2026-07-01', '2026-08-20', existing, TODAY)).toEqual([]);
  });
});

describe('explicitný prepis (D28)', () => {
  const ownWrites = [
    { productId: 100, from: '2026-08-01', to: '2026-08-10' }, // beží dnes
    { productId: 200, from: '2026-09-01', to: '2026-09-10' }, // naplánovaná
    { productId: 300, from: '2026-07-01', to: '2026-07-10' }, // skončila
  ];

  it('productsRequiringOverwrite: bežiace aj naplánované, nie skončené', () => {
    expect(productsRequiringOverwrite([100, 200, 300, 999], ownWrites, TODAY)).toEqual([100, 200]);
  });

  it('kind=new na konfliktný produkt hodí overwrite_required', () => {
    expect(() => assertOverwriteExplicit('new', [100], ownWrites, TODAY)).toThrow(DomainError);
    try {
      assertOverwriteExplicit('new', [100], ownWrites, TODAY);
    } catch (err) {
      expect((err as DomainError).code).toBe('overwrite_required');
    }
  });

  it('kind=overwrite prejde; nekonfliktné produkty prejdú aj ako new', () => {
    expect(() => assertOverwriteExplicit('overwrite', [100], ownWrites, TODAY)).not.toThrow();
    expect(() => assertOverwriteExplicit('new', [300, 999], ownWrites, TODAY)).not.toThrow();
  });
});

describe('sémantika predĺženia (D27)', () => {
  const base = { originalFrom: '2026-08-01', originalPercent: 15, currentTo: '2026-09-01' };

  it('platné predĺženie drží from aj percento a mení len to', () => {
    const res = checkExtension({ ...base, newTo: '2026-10-01' });
    expect(res).toEqual({ ok: true, from: '2026-08-01', percent: 15, to: '2026-10-01' });
    expect(assertExtension({ ...base, newTo: '2026-10-01' })).toEqual({
      from: '2026-08-01',
      percent: 15,
      to: '2026-10-01',
    });
  });

  it('nové to musí byť ZA doterajším (rovnaké aj skoršie sa odmietne)', () => {
    for (const newTo of ['2026-09-01', '2026-08-15']) {
      const res = checkExtension({ ...base, newTo });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.offerOverwrite).toBe(false);
    }
  });

  it('nad strop 3 mesiacov od PÔVODNÉHO from ponúkne prepis (D27)', () => {
    const res = checkExtension({ ...base, newTo: '2026-11-02' }); // strop je 1.11.
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('range_too_long');
      expect(res.offerOverwrite).toBe(true);
    }
    // presne na strope prejde
    expect(checkExtension({ ...base, newTo: '2026-11-01' }).ok).toBe(true);
    expect(() => assertExtension({ ...base, newTo: '2026-11-02' })).toThrow(DomainError);
  });
});

describe('prepočet okna pri dopálení (D25)', () => {
  it('to v minulosti → lapse, žiadny zápis', () => {
    const res = resolveFireWindow('2026-07-01', '2026-08-04', TODAY);
    expect(res.action).toBe('lapse');
  });

  it('to = dnes NIE JE prepadnuté', () => {
    const res = resolveFireWindow('2026-08-01', TODAY, TODAY);
    expect(res.action).toBe('shift_from');
  });

  it('from v minulosti → posun na dnes s uchovaním pôvodného from', () => {
    const res = resolveFireWindow('2026-08-01', '2026-08-20', TODAY);
    expect(res).toEqual({
      action: 'shift_from',
      from: TODAY,
      originalFrom: '2026-08-01',
      to: '2026-08-20',
    });
  });

  it('okno v poriadku → proceed s pôvodnými dátumami', () => {
    expect(resolveFireWindow(TODAY, '2026-08-20', TODAY)).toEqual({
      action: 'proceed',
      from: TODAY,
      to: '2026-08-20',
    });
    expect(resolveFireWindow('2026-08-10', '2026-08-20', TODAY)).toEqual({
      action: 'proceed',
      from: '2026-08-10',
      to: '2026-08-20',
    });
  });
});
