/**
 * Aura Zľavy — TAB ZĽAVY (V11; kontrakt V3 K3–K8, K10, invarianty I3, I9).
 *
 * Dôkaz, nie report agenta (pasca z CLAUDE.md). Testuje sa to, čo sa dá na
 * tejto obrazovke pokaziť ticho a čo by to stálo produkčný eshop:
 *
 *  A. **Poradie zoznamu** — dominantou je zľava, ktorá sa PRÁVE zapisuje;
 *     hotové padajú dole (architektúra §1 TAB 3).
 *  B. **Pásma vznikajú z merania** (K3) — vedrá predajnosti sedia s tými
 *     v `catalog.repo`, prázdne pásmo nevznikne a hlavičkové percento zľavy
 *     je NAJVYŠŠIE percento pásiem.
 *  C. **Vzorka je rozložená naprieč pásmami**, nie prvých 6 riadkov — inak by
 *     používateľ potvrdzoval niečo iné, než vidí (K4).
 *  D. **I3 na povrchu** — bez ručne vpísaného počtu sa zaradiť nedá a číslo sa
 *     porovnáva ako ČÍSLO, nie ako text.
 *  E. **Odhad dobehnutia** (K5) sa správa presne ako `estimateFinish()` na
 *     serveri a navrhovaný štart má dva dni rezervy.
 *  F. **K8** — dopad na maržu sa nikdy neukáže ako číslo.
 *  G. **K6** — kľúč kratší než fronta je VAROVANIE, nie brzda; a bez rozpočtu
 *     obrazovka nedopočíta dátum (P7).
 *  H. **Staré cesty `/kampane/*` sa nesmú zlomiť** (K9).
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť. Efekty klienta sa pri statickom renderi nespúšťajú, takže test meria
 * značky a texty, nie načítanie dát.
 *
 * Vlastník: V11 (testovú sadu ako celok vlastní V14).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import DiscountPerformance from '@/components/campaigns/DiscountPerformance';
import NewDiscountConfirm from '@/components/campaigns/NewDiscountConfirm';
import NewDiscountStart from '@/components/campaigns/NewDiscountStart';
import {
  DEFAULT_TIER_PERCENT,
  averagePrice,
  buildTiers,
  discountedPriceOf,
  estimateFinishDay,
  headlinePercent,
  orderDiscounts,
  progressPercent,
  proposeStart,
  queueAhead,
  soldBucketOf,
  spreadSample,
  tierRuleSentence,
  typedCountMatches,
  validateTierPercent,
  type SelectableRow,
} from '@/components/campaigns/discounts-model';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

/** Riadky z kanonickej vzorky katalógu (architektúra §3.5), okno 180 dní. */
const ROWS: SelectableRow[] = [
  { productId: 18342, name: 'Strieborné náušnice Lumen', price: '34.90', unitsSold: 0, discountedNow: false },
  { productId: 21170, name: 'Strieborný prsteň Aurora', price: '49.00', unitsSold: 0, discountedNow: false },
  { productId: 15903, name: 'Strieborný prívesok Nova', price: '22.90', unitsSold: 0, discountedNow: false },
  { productId: 9084, name: 'Strieborná retiazka Ancora', price: '27.50', unitsSold: 2, discountedNow: false },
  { productId: 30512, name: 'Zlatý prsteň Solis 585', price: '389.00', unitsSold: 1, discountedNow: false },
  { productId: 11265, name: 'Strieborné náušnice Orbita', price: '24.00', unitsSold: 3, discountedNow: false },
  { productId: 4590, name: 'Strieborný prívesok Anjel', price: '18.90', unitsSold: 11, discountedNow: false },
];

interface Row {
  id: number;
  name: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  itemsOk: number;
  itemsFailed: number;
  itemsPending: number;
  late: boolean;
}

const row = (patch: Partial<Row> & { id: number; status: string }): Row => ({
  name: `Zľava ${patch.id}`,
  dateFrom: '2026-09-04',
  dateTo: '2026-09-18',
  itemsOk: 0,
  itemsFailed: 0,
  itemsPending: 0,
  late: false,
  ...patch,
});

/* ══════════════════ A. Poradie zoznamu (architektúra §1) ══════════════════ */

describe('A — zoznam zliav vedie tá, ktorá sa práve zapisuje', () => {
  const today = '2026-08-10';

  it('dominantou je fronta, ktorá ešte má čo zapisovať', () => {
    const rows = [
      row({ id: 1, status: 'done', dateFrom: '2026-08-01', dateTo: '2026-08-31', itemsOk: 640 }),
      row({ id: 2, status: 'queued', itemsOk: 3408, itemsFailed: 12, itemsPending: 4580 }),
      row({ id: 3, status: 'scheduled', itemsPending: 1240 }),
      row({ id: 4, status: 'done', dateFrom: '2026-06-15', dateTo: '2026-07-15', itemsOk: 2100 }),
    ];
    const ordered = orderDiscounts(rows, today);

    expect(ordered.leading?.id).toBe(2);
    // Bežiaca (id 1) je pred pripravenou (id 3); skončená (id 4) je dole.
    expect(ordered.active.map((r) => r.id)).toEqual([1, 3]);
    expect(ordered.finished.map((r) => r.id)).toEqual([4]);
  });

  it('fronta bez čakajúcich položiek dominantou nie je', () => {
    const ordered = orderDiscounts([row({ id: 9, status: 'queued', itemsPending: 0 })], today);
    expect(ordered.leading).toBeNull();
    expect(ordered.active.map((r) => r.id)).toEqual([9]);
  });

  it('zlyhané položky sú príznak, nie stav — zľava stále zapisuje', () => {
    const ordered = orderDiscounts(
      [row({ id: 5, status: 'queued', itemsOk: 100, itemsFailed: 12, itemsPending: 50 })],
      today,
    );
    expect(ordered.leading?.id).toBe(5);
  });

  it('pred novou zľavou stojí vo fronte len to, čo sa ešte zapisuje', () => {
    const ahead = queueAhead(
      [
        row({ id: 1, name: 'Ležiaky striebro', status: 'queued', itemsPending: 4580 }),
        row({ id: 2, name: 'Náušnice', status: 'scheduled', itemsPending: 1240 }),
        row({ id: 3, name: 'Hotová', status: 'done', dateFrom: '2026-06-01', dateTo: '2026-07-01' }),
      ],
      today,
    );
    expect(ahead.pending).toBe(5820);
    expect(ahead.names.map((n) => n.name)).toEqual(['Ležiaky striebro', 'Náušnice']);
  });

  it('pruh nikdy nepretečie a nikdy nedelí nulou', () => {
    expect(progressPercent(3420, 8000)).toBeCloseTo(42.75, 2);
    expect(progressPercent(10, 0)).toBe(0);
    expect(progressPercent(20, 10)).toBe(100);
  });
});

/* ═══════════════════ B + C. Pásma a vzorka (K3, K4) ══════════════════════ */

describe('B — pásma vznikajú z merania, nie z domnienky', () => {
  it('vedrá predajnosti sedia s hranicami v katalógu', () => {
    expect(soldBucketOf(0)).toBe('none');
    expect(soldBucketOf(2)).toBe('low');
    expect(soldBucketOf(3)).toBe('mid');
    expect(soldBucketOf(9)).toBe('mid');
    expect(soldBucketOf(10)).toBe('high');
  });

  it('pravidlo pásma je veta, ktorú si používateľ overí v Produktoch', () => {
    expect(tierRuleSentence('none', 180)).toBe('0 predaných za 180 dní');
    expect(tierRuleSentence('low', 360)).toBe('1–2 predané za 360 dní');
  });

  it('prázdne pásmo nevznikne a pásma sú v poradí od najhoršieho ležiaka', () => {
    const tiers = buildTiers(ROWS, 180);
    expect(tiers.map((t) => t.bucket)).toEqual(['none', 'low', 'mid', 'high']);
    expect(tiers.map((t) => t.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(tiers.map((t) => t.productIds.length)).toEqual([3, 2, 1, 1]);
    expect(tiers[0]!.percent).toBe(DEFAULT_TIER_PERCENT.none);

    // Sada bez predajov má jediné pásmo — nie štyri, z toho tri prázdne.
    const single = buildTiers(ROWS.filter((r) => r.unitsSold === 0), 180);
    expect(single).toHaveLength(1);
    expect(single[0]!.productIds).toHaveLength(3);
  });

  it('hlavička zľavy nesie NAJVYŠŠIE percento pásiem (K3)', () => {
    const tiers = buildTiers(ROWS, 180, { none: 30, low: 20, mid: 15, high: 10 });
    expect(headlinePercent(tiers)).toBe(30);
  });

  it('percento pásma je celé číslo 1–30 (I9, D11)', () => {
    expect(validateTierPercent(30)).toBeNull();
    expect(validateTierPercent(0)).not.toBeNull();
    expect(validateTierPercent(31)).not.toBeNull();
    expect(validateTierPercent(12.5)).not.toBeNull();
    expect(validateTierPercent(Number.NaN)).not.toBeNull();
  });

  it('cena po zľave je orientačný prepočet, chýbajúca cena zostáva chýbajúca', () => {
    expect(discountedPriceOf('34.90', 30)).toBeCloseTo(24.43, 2);
    expect(discountedPriceOf(null, 30)).toBeNull();
    expect(averagePrice([{ ...ROWS[0]!, price: null }])).toBeNull();
  });
});

describe('C — vzorka je rozložená naprieč pásmami, nie prvých 6', () => {
  it('každé pásmo dostane riadok skôr, než ktorékoľvek dostane druhý', () => {
    const tiers = buildTiers(ROWS, 180);
    const sample = spreadSample(ROWS, tiers, 6);
    const byId = new Map(ROWS.map((r) => [r.productId, r]));

    const buckets = sample.map((r) => soldBucketOf(byId.get(r.productId)!.unitsSold));
    // Prvé štyri riadky sú po jednom zo štyroch pásiem.
    expect(new Set(buckets.slice(0, 4)).size).toBe(4);
    expect(sample).toHaveLength(6);
    expect(new Set(sample.map((r) => r.productId)).size).toBe(6);
  });

  it('bez výberu nie je vzorka — nedopĺňa sa ničím', () => {
    expect(spreadSample([], [], 6)).toEqual([]);
  });
});

/* ═════════════════════════ D. I3 na povrchu ══════════════════════════════ */

describe('D — bez ručne vpísaného počtu sa zľava nezaradí', () => {
  it('porovnáva sa číslo, nie text', () => {
    expect(typedCountMatches('8000', 8000)).toBe(true);
    expect(typedCountMatches('8 000', 8000)).toBe(true);
    expect(typedCountMatches(' 8000 ', 8000)).toBe(true);
    expect(typedCountMatches('08000', 8000)).toBe(true);
  });

  it('blízke, prázdne ani nečíselné odpovede neprejdú', () => {
    expect(typedCountMatches('800', 8000)).toBe(false);
    expect(typedCountMatches('80000', 8000)).toBe(false);
    expect(typedCountMatches('', 8000)).toBe(false);
    expect(typedCountMatches('   ', 8000)).toBe(false);
    expect(typedCountMatches('8000x', 8000)).toBe(false);
    expect(typedCountMatches('všetky', 8000)).toBe(false);
  });
});

/* ═══════════════════ E. Odhad dobehnutia a štart (K5) ════════════════════ */

describe('E — odhad dobehnutia sa správa ako server, štart má rezervu', () => {
  const now = new Date('2026-08-10T11:40:00.000Z');

  it('čo sa zmestí do dnešného zvyšku, dobehne dnes', () => {
    const estimate = estimateFinishDay(80, 200, { remainingToday: 100, now });
    expect(estimate.days).toBe(0);
    expect(estimate.date).toBe('2026-08-10');
  });

  it('8 000 položiek pri 200/deň je 40 dní, nie 40 hodín', () => {
    const estimate = estimateFinishDay(8000, 200, { remainingToday: 0, now });
    expect(estimate.days).toBe(40);
    expect(estimate.date).toBe('2026-09-19');
  });

  it('prázdna fronta dobehla dnes a nič sa nedopočítava', () => {
    expect(estimateFinishDay(0, 200, { now }).days).toBe(0);
  });

  it('navrhovaný štart je dobehnutie + 2 dni a nikdy nie v minulosti', () => {
    expect(proposeStart('2026-09-02', { now })).toBe('2026-09-04');
    expect(proposeStart('2026-07-01', { now })).toBe('2026-08-10');
  });
});

/* ═════════════════ F + G. Potvrdenie a panel štartu ══════════════════════ */

const CONFIRM_PROPS = {
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

describe('F — potvrdenie: dominanta, zámok marže a poistka I3', () => {
  it('dominantou je počet produktov, nie tlačidlo', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountConfirm, CONFIRM_PROPS));
    expect(html).toContain('8 000');
    expect(html).toContain('produktov dostane zľavu');
  });

  it('K8 — dopad na maržu nie je číslo, je to veta o tom, čo chýba', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountConfirm, CONFIRM_PROPS));
    expect(html).toContain('Dopad na maržu');
    // ZMENA 20. 8. 2026 (šprint dokončenia, bod 19 — návrat ku kontraktu):
    // riadok priznáva, že je zamknutý, a NIČ nevysvetľuje. Rozširovať
    // vysvetlenia o chýbajúcich dátach mimo `LockedFeatures.tsx` je zakázané,
    // inak tá istá výhrada žije v appke na piatich miestach a rozídu sa.
    expect(html).toContain('<span class="lockline">zamknuté</span>');
    expect(html).not.toContain('nákupných cien');

    // Blok marže končí svojím `</div>`; ďalej už je pole na vpísanie počtu.
    const start = html.indexOf('Dopad na maržu');
    const block = html.slice(start, html.indexOf('</div>', start));
    // Ani cifra, ani euro — odhad marže bez nákupných cien je vymyslený.
    expect(block).not.toMatch(/\d/);
    expect(block).not.toContain('€');
  });

  it('kým nie je skúška a vpísaný počet, zaradiť do fronty sa nedá', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountConfirm, CONFIRM_PROPS));
    const button = html.slice(html.indexOf('Zaradiť do fronty') - 260, html.indexOf('Zaradiť do fronty'));
    expect(button).toContain('disabled');
    expect(html).toContain('Najprv spustite skúšku naprázdno');
  });

  it('keď je všetko splnené, tlačidlo je živé', () => {
    const html = renderToStaticMarkup(
      createElement(NewDiscountConfirm, { ...CONFIRM_PROPS, typed: '8000', previewFresh: true, blockedReason: null }),
    );
    const button = html.slice(html.indexOf('Zaradiť do fronty') - 260, html.indexOf('Zaradiť do fronty'));
    expect(button).not.toContain('disabled');
  });

  it('skúška naprázdno sa nevydáva za zápis vzorky do shopu', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountConfirm, CONFIRM_PROPS));
    expect(html).toContain('Skúška nič nezapíše');
  });
});

const START_PROPS = {
  itemsCount: 8000,
  perDay: 200,
  aheadPending: 5820,
  aheadNames: [{ name: 'Ležiaky striebro', pending: 4580 }],
  finishDay: '2026-10-18',
  proposedStart: '2026-10-20',
  from: '2026-10-20',
  onUseProposal: () => {},
  keyExpiresAt: '2026-09-09T10:00:00.000Z',
  keyPresent: true,
};

describe('G — štart: varovanie o kľúči nebráni zaradeniu, odhad sa nevymýšľa', () => {
  it('K6 — kratší kľúč než fronta je varovanie s ponukou obnovy', () => {
    const html = renderToStaticMarkup(createElement(NewDiscountStart, START_PROPS));
    expect(html).toContain('Kľúč na zápis platí do');
    expect(html).toContain('Obnoviť kľúč');
    // Je to príznak, nie blokátor: panel neponúka žiadne „nedá sa".
    expect(html).not.toContain('nedá');
  });

  it('kľúč platný dlhšie než fronta žiadne varovanie nerobí', () => {
    const html = renderToStaticMarkup(
      createElement(NewDiscountStart, { ...START_PROPS, keyExpiresAt: '2026-12-01T10:00:00.000Z' }),
    );
    expect(html).not.toContain('Obnoviť kľúč');
  });

  it('P7 — bez denného rozpočtu sa dátum nedopočíta', () => {
    const html = renderToStaticMarkup(
      createElement(NewDiscountStart, { ...START_PROPS, perDay: null, finishDay: null, proposedStart: null }),
    );
    expect(html).toContain('nevieme');
    expect(html).not.toContain('2026-10-18');
  });
});

/* ═════════════════ H. Staré cesty sa nesmú zlomiť (K9) ═══════════════════ */

class Redirected extends Error {
  constructor(readonly target: string) {
    super(`redirect:${target}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (target: string): never => {
    throw new Redirected(target);
  },
  notFound: (): never => {
    throw new Redirected('__not_found__');
  },
}));

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Redirected) return error.target;
    throw error;
  }
  throw new Error('presmerovanie sa nespustilo');
}

describe('H — /kampane/* vedie na /zlavy/*', () => {
  it('zoznam kampaní vedie na zoznam zliav', async () => {
    const page = (await import('@/app/kampane/page')).default;
    expect(await redirectOf(() => page({ searchParams: Promise.resolve({}) }))).toBe('/zlavy');
  });

  it('starý drawer novej kampane vedie na sprievodcu aj s výberom', async () => {
    const page = (await import('@/app/kampane/page')).default;
    const target = await redirectOf(() =>
      page({ searchParams: Promise.resolve({ nova: '1', produkty: '18342,21170' }) }),
    );
    expect(target).toBe('/zlavy/nova?produkty=18342%2C21170');
  });

  it('stará stránka novej kampane vedie na sprievodcu', async () => {
    const page = (await import('@/app/kampane/nova/page')).default;
    expect(await redirectOf(() => page({ searchParams: Promise.resolve({}) }))).toBe('/zlavy/nova');
  });

  it('detail kampane vedie na tú istú zľavu, nezmysel na zoznam', async () => {
    const page = (await import('@/app/kampane/[id]/page')).default;
    expect(await redirectOf(() => page({ params: Promise.resolve({ id: '42' }) }))).toBe('/zlavy/42');
    expect(await redirectOf(() => page({ params: Promise.resolve({ id: 'nieco' }) }))).toBe('/zlavy');
  });
});

/* ═════════ Výkon výberu — appka nesmie predstierať tržby (K8, P8) ═════════ */

describe('Výkon výberu v detaile zľavy', () => {
  /*
   * Mockup `design/v3/zlava-detail.html` v tejto sekcii ukazuje tržby v
   * eurách a porovnanie s vlaňajškom. Appka ani jedno nemá: zo shopu chodia
   * iba počty kusov a synchronizácia predajov rok dozadu nesiaha. Panely sú
   * preto zamknuté a povedia prečo.
   *
   * Test existuje kvôli jedinej vete, ktorú by niekto raz mohol chcieť
   * „dopočítať": kusy krát dnešná cenníková cena. To nie je tržba.
   */
  it('nezobrazuje eurá — v sekcii nie je znak meny ani slovo tržba ako číslo', () => {
    const markup = renderToStaticMarkup(createElement(DiscountPerformance, { id: 7 }));
    // Pred načítaním dát je panel v stave „Načítavam…"; znak € tam nesmie byť
    // ani vtedy, ani v zamknutých paneloch.
    expect(markup).not.toContain('€');
  });

  it('zamknuté panely povedia dôvod, nie sú skryté (K8)', () => {
    const markup = renderToStaticMarkup(createElement(DiscountPerformance, { id: 7 }));
    expect(markup).toContain('Tržby');
    // D18 (19. 8. 2026): „Vlani rovnaké obdobie" bola príslovka nalepená na
    // podstatné meno v nominatíve. Po slovensky je poradie opačné.
    expect(markup).toContain('Rovnaké obdobie vlani');
    expect(markup).toContain('data-testid="performance-locked"');
  });

  it('nevyslovuje záver o príčine (P8)', () => {
    const markup = renderToStaticMarkup(createElement(DiscountPerformance, { id: 7 }));
    for (const veta of ['priniesla', 'vďaka zľave', 'spôsobil', 'nárast o']) {
      expect(markup).not.toContain(veta);
    }
  });
});
