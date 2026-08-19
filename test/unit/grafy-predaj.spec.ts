/**
 * Aura Zľavy — GRAF PREDAJA HOVORÍ PRAVDU O ČASE (V1).
 *
 * Tento graf visí na prístrojovej doske appky, ktorá zapisuje do PRODUKČNÉHO
 * eshopu. Každý jeho tvar je tvrdenie a každé sa dá pokaziť tak, že to na
 * obrazovke vyzerá presvedčivo. Preto sa merajú tvrdenia, nie pixely:
 *
 *  A. **Poloha bodu nesie kalendárny deň.** Do 19. 8. 2026 niesla PORADIE
 *     v poli, takže 5. a 6. august a potom 19. august vyzerali ako tri
 *     susedné dni. Graf tým tvrdil, že sťahovanie beží denne.
 *
 *  B. **Nesťahovaný deň nedostane nulu ani čiaru.** „Predalo sa 0 kusov"
 *     a „ten deň sme nesťahovali" sú dve rôzne vety.
 *
 *  C. **Dva body nie sú priebeh.** Žiadny trend, žiadna plocha — a obe čísla
 *     napísané priamo, aby graf nepredstieral rad.
 *
 *  D. **Route vracia stiahnuté dni, nie dni s predajom.** Stiahnutý deň bez
 *     predaja je nula (meraný fakt), nestiahnutý deň v odpovedi nie je vôbec.
 *
 *  E. **Sekcia a graf počítajú z toho istého poľa.** Dve čísla o tom istom
 *     z dvoch výpočtov sú horšie než jedno.
 *
 * Bez prehliadača a bez DB: geometria je čistá funkcia, komponenty sa
 * vykresľujú cez `renderToStaticMarkup`, route dostane náhradné závislosti.
 *
 * Vlastník: V1.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ProductSalesDay, SalesSyncDay, SessionClaims } from '@/contracts';
import type { RouteDeps } from '@/lib/http/define-route';

import SalesSection from '@/components/dashboard/SalesSection';
import type { SalesDay, SalesSnapshot } from '@/components/dashboard/api';
import {
  CHART,
  MIN_TREND_POINTS,
  chartGeometry,
  coverageGaps,
  dayNumber,
} from '@/components/dashboard/sales-view';
import { nearestPoint, pointerToViewBoxX, tipLeftPercent } from '@/components/charts/chart-hover';
import { createInsightsSalesDailyGet } from '@/app/api/insights/sales-daily/route';

const TODAY = '2026-08-19';

/* Skutočný obsah tabuliek k 19. 8. 2026: dva dni, potom nič. */
const NAMERANE: SalesDay[] = [
  { day: '2026-08-05', units: 578 },
  { day: '2026-08-06', units: 495 },
];

function snapshot(patch: Partial<SalesSnapshot> = {}): SalesSnapshot {
  return {
    today: TODAY,
    coverage: {
      syncEnabled: true,
      from: '2026-08-05',
      to: '2026-08-06',
      daysCovered: 2,
      lastSyncedAt: '2026-08-07T02:10:00.000Z',
      hasData: true,
    },
    windowUnits: 1073,
    unitsPerDay: null,
    recentUnits: null,
    previousUnits: null,
    days: NAMERANE,
    ...patch,
  };
}

const render = (sales: SalesSnapshot | null): string =>
  renderToStaticMarkup(createElement(SalesSection, { sales }));

/* ═══════════ A. Vodorovná poloha nesie kalendár, nie poradie ══════════════ */

describe('os x je kalendár, nie poradie v poli', () => {
  it('deň vzdialený dva týždne nesedí vedľa susedného dňa', () => {
    const g = chartGeometry([...NAMERANE, { day: TODAY, units: 12 }], '2026-08-31');
    expect(g).not.toBeNull();
    const [prvy, druhy, treti] = g!.hover;

    // 5. a 6. august sú od seba jeden zo štrnástich dní osi.
    expect(prvy!.x).toBe(CHART.left);
    expect(treti!.x).toBe(CHART.right);
    const krokPrvy = druhy!.x - prvy!.x;
    const krokDruhy = treti!.x - druhy!.x;
    expect(krokDruhy / krokPrvy).toBeGreaterThan(10);
  });

  it('spojité dni majú rovnaké rozostupy ako predtým', () => {
    // Poistka proti tomu, aby oprava rozbila bežný prípad.
    const dni = ['2026-08-04', '2026-08-05', '2026-08-06'].map((day) => ({ day, units: 10 }));
    const g = chartGeometry(dni, TODAY)!;
    const kroky = g.hover.slice(1).map((point, index) => point.x - g.hover[index]!.x);
    expect(Math.abs(kroky[0]! - kroky[1]!)).toBeLessThan(0.2);
  });

  it('nečitateľný deň prepne celý rad na rovnomerné rozostupy', () => {
    // Miešať kalendárnu a poradovú mierku v jednom ráme by nikto nezistil.
    const g = chartGeometry([{ day: 'nezmysel', units: 4 }, ...NAMERANE], TODAY)!;
    expect(g.gaps).toEqual([]);
    expect(g.hover[0]!.x).toBe(CHART.left);
    expect(g.hover[2]!.x).toBe(CHART.right);
  });

  it('deň sa prečíta na poradové číslo, nezmysel na null', () => {
    expect(dayNumber('2026-08-06')! - dayNumber('2026-08-05')!).toBe(1);
    expect(dayNumber('2026-08-19')! - dayNumber('2026-08-06')!).toBe(13);
    expect(dayNumber('19.8.2026')).toBeNull();
    expect(dayNumber('')).toBeNull();
  });
});

/* ═══════════════ B. Diera je diera, nikdy nula a nikdy čiara ══════════════ */

describe('nesťahovaný deň nedostane nulu ani spojnicu', () => {
  const sDierou: SalesDay[] = [...NAMERANE, { day: TODAY, units: 40 }];

  it('diera sa nájde aj s presným počtom chýbajúcich dní', () => {
    expect(coverageGaps(sDierou)).toEqual([
      { afterDay: '2026-08-06', beforeDay: TODAY, missingDays: 12 },
    ]);
  });

  it('graf nedopĺňa ani jeden bod navyše', () => {
    const g = chartGeometry(sDierou, '2026-08-31')!;
    // Toľko bodov, koľko meraní. Žiadna nula za chýbajúci deň.
    expect(g.hover).toHaveLength(3);
    expect(g.hover.map((p) => p.units)).toEqual([578, 495, 40]);
  });

  it('spojnica sa na diere pretrhne', () => {
    const g = chartGeometry(sDierou, '2026-08-31')!;
    expect(g.gaps).toHaveLength(1);
    // Jediný súvislý úsek je 5.–6. 8.; osamelý 19. 8. sa nespája s ničím.
    expect(g.segments).toHaveLength(1);
    expect(g.segments[0]!.split(' ')).toHaveLength(2);
  });

  it('plocha sa cez dieru nerozlieva', () => {
    const g = chartGeometry(sDierou, '2026-08-31')!;
    // Jedna podcesta = jeden súvislý úsek.
    expect(g.areaPath.match(/M/g) ?? []).toHaveLength(1);
  });

  it('sekcia dieru pomenuje pod grafom', () => {
    const html = render(snapshot({ days: sDierou, today: '2026-08-31' }));
    expect(html).toContain('data-testid="sales-gap-note"');
    expect(html).toContain('tie dni sa nesťahovali');
    expect(html).toContain('nesťahované');
  });
});

/* ══════════════════════ C. Dva body nie sú priebeh ════════════════════════ */

describe('dve merania sa kreslia ako dve merania', () => {
  it('žiadny trend a žiadna plocha', () => {
    const g = chartGeometry(NAMERANE, TODAY)!;
    expect(g.mode).toBe('pair');
    expect(g.trendLine).toBeNull();
    expect(g.areaPath).toBe('');
  });

  it('trend sa objaví až od štyroch uzavretých dní', () => {
    const dni = (n: number): SalesDay[] =>
      Array.from({ length: n }, (_, i) => ({ day: `2026-08-0${i + 1}`, units: 10 + i }));

    expect(chartGeometry(dni(MIN_TREND_POINTS - 1), TODAY)!.trendLine).toBeNull();
    expect(chartGeometry(dni(MIN_TREND_POINTS), TODAY)!.trendLine).not.toBeNull();
  });

  it('obe hodnoty stoja priamo pri bodoch, pri dlhšom rade nie', () => {
    const html = render(snapshot());
    expect(html).toContain('data-mode="pair"');
    expect(html).toContain('578');
    expect(html).toContain('495');
    expect(html).not.toContain('line trend');

    const dlhy = Array.from({ length: 7 }, (_, i) => ({
      day: `2026-08-0${i + 1}`,
      units: 10 + i,
    }));
    const html2 = render(snapshot({ days: dlhy, today: '2026-08-20' }));
    expect(html2).toContain('data-mode="line"');
    expect(html2).toContain('line trend');
  });
});

/* ═════════════════ D. Route: stiahnutý deň verzus deň s predajom ══════════ */

const NOW = new Date('2026-08-19T09:00:00.000Z');

function sessionDeps(): RouteDeps {
  const claims: SessionClaims = {
    sub: 7,
    username: 'admin',
    absoluteExpiresAt: new Date(NOW.getTime() + 8 * 3_600_000),
    idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
    sudoUntil: null,
  };
  return {
    now: () => NOW,
    newRequestId: () => '01J000000000000000GRAFY01',
    verifySession: async () => ({
      claims,
      refreshed: {
        token: 'refreshed',
        claims,
        cookie: {
          name: 'ovl_zliav_session' as const,
          value: 'refreshed',
          options: {
            httpOnly: true as const,
            secure: true as const,
            sameSite: 'strict' as const,
            path: '/',
            maxAge: 1800,
          },
        },
      },
    }),
  };
}

function syncDay(saleDay: string, status: SalesSyncDay['status']): SalesSyncDay {
  return { saleDay, status, finishedAt: '2026-08-07T02:10:00.000Z', updatedAt: null };
}

async function callDaily(
  sync: readonly SalesSyncDay[],
  rows: readonly ProductSalesDay[],
): Promise<{ days: Array<{ day: string; units: number }> }> {
  const handler = createInsightsSalesDailyGet(
    {
      now: () => NOW,
      timeZone: 'Europe/Bratislava',
      syncEnabled: true,
      windowDays: 30,
      salesInsights: {
        syncDays: async () => [...sync],
        dailyUnits: async () => [...rows],
      },
      insightsRepo: {
        discountDepth: async () =>
          [1, 2].map((productId) => ({
            productId,
            slot: productId,
            label: null,
            name: null,
            price: null,
            hasAttributes: false,
            shopStatus: 'ok',
            lastOwnWrite: null,
          })),
      },
    },
    sessionDeps(),
  );
  const response = await handler(
    new Request('https://zlavy.local/api/insights/sales-daily', {
      headers: { cookie: 'ovl_zliav_session=x' },
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { data?: unknown };
  return (body.data ?? body) as { days: Array<{ day: string; units: number }> };
}

describe('GET /api/insights/sales-daily — čo je nula a čo je medzera', () => {
  it('stiahnutý deň bez predaja je nula, nestiahnutý deň v odpovedi nie je', async () => {
    const body = await callDaily(
      [
        syncDay('2026-08-05', 'complete'),
        syncDay('2026-08-06', 'complete'),
        syncDay('2026-08-07', 'pending'),
      ],
      [{ productId: 1, saleDay: '2026-08-05', unitsSold: 578 }],
    );

    expect(body.days).toEqual([
      { day: '2026-08-05', units: 578 },
      { day: '2026-08-06', units: 0 },
    ]);
  });

  it('kusy viacerých produktov sa za deň sčítajú', async () => {
    const body = await callDaily(
      [syncDay('2026-08-05', 'complete')],
      [
        { productId: 1, saleDay: '2026-08-05', unitsSold: 300 },
        { productId: 2, saleDay: '2026-08-05', unitsSold: 278 },
      ],
    );
    expect(body.days).toEqual([{ day: '2026-08-05', units: 578 }]);
  });

  it('bez jediného stiahnutého dňa je rad prázdny, nie plný núl', async () => {
    const body = await callDaily([syncDay('2026-08-05', 'pending')], []);
    expect(body.days).toEqual([]);
  });
});

/* ════════════ E. Sekcia, tabuľka a prázdne stavy ══════════════════════════ */

describe('sekcia okolo grafu', () => {
  it('ku grafu patrí dátová tabuľka s tými istými číslami', () => {
    const html = render(snapshot());
    expect(html).toContain('Dátová tabuľka grafu');
    expect(html).toContain('data-testid="sales-chart-table"');
    // Tabuľka aj graf prepisujú tie isté merania.
    expect(html.match(/578/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('tabuľka priznáva dieru vlastným riadkom', () => {
    const html = render(snapshot({ days: [...NAMERANE, { day: TODAY, units: 40 }] }));
    expect(html).toContain('nesťahované,');
  });

  it('nikde sa neobjaví euro, ktoré appka nepozná', () => {
    expect(render(snapshot())).not.toContain('€');
  });

  it('popis nad grafom hovorí rozsah, nie „celý eshop"', () => {
    // Rad kusov bez uvedeného rozsahu vyzerá ako obrat celého eshopu.
    expect(render(snapshot())).toContain('povolené produkty');
  });

  it('bez dát je jedna veta a jedno tlačidlo, nie prázdny rám grafu', () => {
    const html = render(snapshot({ coverage: { ...snapshot().coverage, hasData: false } }));
    expect(html).not.toContain('<svg');
    expect(html).toContain('Otvoriť Nastavenia');
  });

  it('jediný deň sa nekreslí vôbec', () => {
    expect(chartGeometry([{ day: '2026-08-05', units: 578 }], TODAY)).toBeNull();
  });
});

/* ══════════════════════ F. Vrstva myši ════════════════════════════════════ */

describe('nitkový kríž hľadá bod v mierke rámu, nie v pixeloch', () => {
  it('prepočet berie NAMERANÚ šírku rámu', () => {
    // Pri pevnej šírke by bublina na inom rozlíšení ukázala susedný deň.
    expect(pointerToViewBoxX(300, { left: 100, width: 440 }, CHART.width)).toBe(400);
    expect(pointerToViewBoxX(300, { left: 100, width: 220 }, CHART.width)).toBe(800);
  });

  it('nulová šírka nevyrobí bod, ale null', () => {
    expect(pointerToViewBoxX(300, { left: 0, width: 0 }, CHART.width)).toBeNull();
  });

  it('najbližší bod je naozaj najbližší', () => {
    const body = [{ x: 30 }, { x: 445 }, { x: 860 }];
    expect(nearestPoint(body, 0)).toEqual({ x: 30 });
    expect(nearestPoint(body, 500)).toEqual({ x: 445 });
    expect(nearestPoint(body, 10_000)).toEqual({ x: 860 });
    expect(nearestPoint([], 5)).toBeNull();
  });

  it('bublina nikdy neujde mimo rámu', () => {
    expect(tipLeftPercent(-50, CHART.width)).toBe(0);
    expect(tipLeftPercent(CHART.width * 2, CHART.width)).toBe(100);
  });
});
