/**
 * Aura Zľavy — OKNÁ ZLIAV V ČASE (graf G1; `/api/insights/timeline`).
 *
 * `/api/insights/timeline` bol hotový od šprintu B2 a nečítala ho ŽIADNA
 * obrazovka. Tento test drží to, čo pri kreslení pásov ide pokaziť najskôr:
 *
 *  A. **Inkluzívna aritmetika.** Zľava od 1. do 1. je jeden deň, nie nula —
 *     inak by jednodňová zľava na osi zmizla.
 *  B. **Orezaná hrana sa PRIZNÁVA.** Route vracia aj kampaň, ktorá do okna len
 *     zasahuje (zámerne), takže pás musí povedať „pokračujem mimo osi". Bez
 *     toho by zľava bežiaca od minulého mesiaca vyzerala, že začala na kraji.
 *  C. **Prekryv v čase NIE JE prekryv na produkte.** Blokujúci je len druhý
 *     (D28) a odlíšiť ich vedia jedine `productIds`. Kampaň bez známych
 *     produktov sa neoznačí — „nevieme" nie je „prekrýva sa" (I11).
 *  D. **Prázdna os a neprečítaná os sú dve rôzne vety.** Prázdna hovorí, že
 *     v období nebola ani jedna zľava; nečitateľná odpoveď je `null`, teda
 *     chyba, nie prázdno.
 *
 * Renderuje sa `renderToStaticMarkup` — bez prehliadača, bez DB, bez siete.
 * Preto má `TimelineBands` vlastný export: panel si dáta ťahá v efekte a ten sa
 * pri serverovom vykreslení nespustí, takže tvrdenia o pásoch by inak merali
 * stav „Načítavam…".
 *
 * Vlastník: V4 (obrazovka Zľavy).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TimelineBands } from '@/components/campaigns/DiscountTimeline';
import {
  axisDays,
  bandOf,
  orderTimeline,
  overlappingCampaignIds,
  parseTimeline,
  parseTimelineCampaign,
  todayPct,
  windowsOverlap,
  type TimelineCampaign,
  type TimelineView,
} from '@/components/campaigns/timeline-model';

/** Os desiatich dní — na nej sú percentá kontrolovateľné z hlavy. */
const RANGE = { from: '2026-08-01', to: '2026-08-10', today: '2026-08-06' };

function campaign(over: Partial<TimelineCampaign> = {}): TimelineCampaign {
  return {
    id: 1,
    name: 'Zľava do 25 %',
    status: 'active',
    percent: 25,
    dateFrom: '2026-08-01',
    dateTo: '2026-08-05',
    productIds: [18342],
    ...over,
  };
}

/* ═════════ A. Aritmetika osi ══════════════════════════════════════════════ */

describe('A. pás sedí na osi a jeden deň je jeden deň', () => {
  it('os je inkluzívna: 1.–10. augusta je desať dní', () => {
    expect(axisDays(RANGE)).toBe(10);
    expect(axisDays({ from: '2026-08-01', to: '2026-08-01' })).toBe(1);
  });

  it('jednodňová zľava má šírku jedného dňa, nie nulu', () => {
    const band = bandOf(campaign({ dateFrom: '2026-08-01', dateTo: '2026-08-01' }), RANGE);
    expect(band).toEqual({ leftPct: 0, widthPct: 10, clippedStart: false, clippedEnd: false });
  });

  it('pás v druhej polovici osi začína na polovici', () => {
    const band = bandOf(campaign({ dateFrom: '2026-08-06', dateTo: '2026-08-10' }), RANGE);
    expect(band).toEqual({ leftPct: 50, widthPct: 50, clippedStart: false, clippedEnd: false });
  });

  it('dnešok má na osi svoje miesto; mimo osi ho appka nekreslí', () => {
    expect(todayPct(RANGE)).toBe(50);
    expect(todayPct({ ...RANGE, today: '2026-09-01' })).toBeNull();
    expect(todayPct({ ...RANGE, today: 'zajtra' })).toBeNull();
  });

  it('poradie pásov je stabilné — podľa začiatku, konca a `id`', () => {
    const ordered = orderTimeline([
      campaign({ id: 3, dateFrom: '2026-08-04' }),
      campaign({ id: 2, dateFrom: '2026-08-01', dateTo: '2026-08-09' }),
      campaign({ id: 1, dateFrom: '2026-08-01', dateTo: '2026-08-05' }),
    ]);
    expect(ordered.map((row) => row.id)).toEqual([1, 2, 3]);
  });
});

/* ═════════ B. Orezané hrany ═══════════════════════════════════════════════ */

describe('B. kampaň, ktorá do okna len zasahuje, to POVIE', () => {
  it('začiatok pred osou je orezaný a prizná sa', () => {
    const band = bandOf(campaign({ dateFrom: '2026-07-20', dateTo: '2026-08-03' }), RANGE);
    expect(band).toEqual({ leftPct: 0, widthPct: 30, clippedStart: true, clippedEnd: false });
  });

  it('koniec za osou je orezaný a prizná sa', () => {
    const band = bandOf(campaign({ dateFrom: '2026-08-09', dateTo: '2026-09-15' }), RANGE);
    expect(band).toEqual({ leftPct: 80, widthPct: 20, clippedStart: false, clippedEnd: true });
  });

  it('kampaň úplne mimo osi pás nedostane', () => {
    expect(bandOf(campaign({ dateFrom: '2026-06-01', dateTo: '2026-06-30' }), RANGE)).toBeNull();
    expect(bandOf(campaign({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }), RANGE)).toBeNull();
  });
});

/* ═════════ C. Prekryv na tom istom produkte (D28) ═════════════════════════ */

describe('C. blokujúci je prekryv NA PRODUKTE, nie prekryv v čase (D28)', () => {
  it('dve zľavy nad tým istým produktom sú označené obe', () => {
    const hit = overlappingCampaignIds([
      campaign({ id: 1, dateFrom: '2026-08-01', dateTo: '2026-08-05', productIds: [1, 2] }),
      campaign({ id: 2, dateFrom: '2026-08-04', dateTo: '2026-08-08', productIds: [2, 3] }),
    ]);
    expect([...hit].sort()).toEqual([1, 2]);
  });

  it('prekryv len v čase, nad inými produktmi, sa NEOZNAČÍ', () => {
    const hit = overlappingCampaignIds([
      campaign({ id: 1, dateFrom: '2026-08-01', dateTo: '2026-08-05', productIds: [1] }),
      campaign({ id: 2, dateFrom: '2026-08-04', dateTo: '2026-08-08', productIds: [9] }),
    ]);
    expect(hit.size).toBe(0);
  });

  it('ten istý produkt v NEPREKRÝVAJÚCICH oknách sa neoznačí', () => {
    const hit = overlappingCampaignIds([
      campaign({ id: 1, dateFrom: '2026-08-01', dateTo: '2026-08-03', productIds: [7] }),
      campaign({ id: 2, dateFrom: '2026-08-04', dateTo: '2026-08-08', productIds: [7] }),
    ]);
    expect(hit.size).toBe(0);
    expect(windowsOverlap({ dateFrom: '2026-08-01', dateTo: '2026-08-03' }, { dateFrom: '2026-08-03', dateTo: '2026-08-04' })).toBe(true);
  });

  it('kampaň bez známych produktov sa neoznačí — „nevieme" nie je poplach (I11)', () => {
    const hit = overlappingCampaignIds([
      campaign({ id: 1, dateFrom: '2026-08-01', dateTo: '2026-08-05', productIds: [] }),
      campaign({ id: 2, dateFrom: '2026-08-04', dateTo: '2026-08-08', productIds: [] }),
    ]);
    expect(hit.size).toBe(0);
  });
});

/* ═════════ D. Čítanie odpovede ════════════════════════════════════════════ */

describe('D. odpoveď servera sa ČÍTA, nie pretypúva', () => {
  it('bez `from`/`to` os neexistuje — nedopočítava sa z kampaní', () => {
    expect(parseTimeline({ campaigns: [] })).toBeNull();
    expect(parseTimeline({ from: '2026-08-10', to: '2026-08-01', campaigns: [] })).toBeNull();
    expect(parseTimeline(null)).toBeNull();
  });

  it('prázdna os je platná odpoveď: „ani jedna zľava"', () => {
    const view = parseTimeline({ from: '2026-08-01', to: '2026-08-10', today: '2026-08-06', windowDays: null, campaigns: [] });
    expect(view).not.toBeNull();
    expect(view!.campaigns).toEqual([]);
    expect(view!.windowDays).toBeNull();
  });

  it('riadok bez dátumov sa zahodí, zvyšok osi zostáva čitateľný', () => {
    const view = parseTimeline({
      from: '2026-08-01',
      to: '2026-08-10',
      today: '2026-08-06',
      campaigns: [
        { id: 1, name: 'A', dateFrom: '2026-08-01', dateTo: '2026-08-05', percent: 25, status: 'active', productIds: [1] },
        { id: 2, name: 'B', dateFrom: null, dateTo: '2026-08-05' },
        { id: 3, name: 'C', dateFrom: '2026-08-09', dateTo: '2026-08-02' },
      ],
    });
    expect(view!.campaigns.map((row) => row.id)).toEqual([1]);
    expect(parseTimelineCampaign({ id: 5 })).toBeNull();
  });
});

/* ═════════ E. Vykreslené pásy ═════════════════════════════════════════════ */

describe('E. panel kreslí pásy, hrany a prekryv', () => {
  const view: TimelineView = {
    from: '2026-08-01',
    to: '2026-08-10',
    today: '2026-08-06',
    windowDays: null,
    campaigns: [
      campaign({ id: 1, name: 'Ležiaky jeseň', dateFrom: '2026-07-20', dateTo: '2026-08-03', productIds: [18342] }),
      campaign({ id: 2, name: 'Náušnice', dateFrom: '2026-08-02', dateTo: '2026-09-20', productIds: [18342] }),
    ],
  };
  const html = renderToStaticMarkup(createElement(TimelineBands, { view }));

  it('pás nesie polohu aj šírku v percentách osi', () => {
    expect(html).toContain('data-testid="timeline-band-1"');
    expect(html).toContain('left:0%;width:30%');
    expect(html).toContain('left:10%;width:90%');
  });

  it('orezaná hrana je vidieť aj v značke, aj slovom', () => {
    expect(html).toContain('data-clip-start="true"');
    expect(html).toContain('začala pred osou');
    expect(html).toContain('data-clip-end="true"');
    expect(html).toContain('končí za osou');
  });

  it('prekryv na tom istom produkte je označený pri OBOCH zľavách (D28)', () => {
    expect(html).toContain('data-testid="timeline-clash-1"');
    expect(html).toContain('data-testid="timeline-clash-2"');
    expect(html).toContain('prekrýva sa na tom istom produkte');
  });

  it('každý pás vedie do detailu svojej zľavy', () => {
    expect(html).toContain('href="/zlavy/1"');
    expect(html).toContain('href="/zlavy/2"');
  });

  it('prázdna os hovorí vetu, nie prázdny rám', () => {
    const empty = renderToStaticMarkup(
      createElement(TimelineBands, { view: { ...view, campaigns: [] } }),
    );
    expect(empty).toContain('data-testid="timeline-empty"');
    expect(empty).toContain('appka nemá ani jednu zľavu');
  });
});
