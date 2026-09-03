/**
 * Aura Zľavy — OKNÁ ZLIAV V ČASE (`/api/insights/timeline`).
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
 *  E. **Prekryv má TRI stavy, nie dva** (V6b). Do prevodu na tabuľku bol
 *     príznak, alebo nič — a „nič" znamenalo aj „je to čisté", aj „nevieme,
 *     ktoré produkty tá druhá zľava má". Druhá možnosť bola TICHÁ; teraz je to
 *     pomlčka s dôvodom v `title` (I11).
 *
 * Renderuje sa `renderToStaticMarkup` — bez prehliadača, bez DB, bez siete.
 * Preto má `TimelineTable` vlastný export: rozklik si dáta ťahá v efekte a ten
 * sa pri serverovom vykreslení nespustí, takže tvrdenia o riadkoch, orezaných
 * hranách a prekryve by inak merali stav „Načítavam…".
 *
 * Vlastník: V4, prevedené vo V6b (oblasť Zľavy, krok 3).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TimelineTable } from '@/components/campaigns/DiscountTimeline';
import {
  axisDays,
  bandOf,
  orderTimeline,
  overlappingCampaignIds,
  parseTimeline,
  parseTimelineCampaign,
  todayPct,
  unprovableOverlapIds,
  windowsOverlap,
  type TimelineCampaign,
  type TimelineView,
} from '@/components/campaigns/timeline-model';
/* Pomlčka sa v tvrdeniach NEPÍŠE ručne: `NEVIEME` je jediné miesto, kde je
   znak definovaný, a mutácia jeho hodnoty má zčervenať tam, nie tu. */
import { NEVIEME } from '@/lib/ui/product-label';

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

/* ═════════ E. Vykreslená tabuľka osi ══════════════════════════════════════ */

describe('E. tabuľka osi kreslí polohu, hrany a tri stavy prekryvu', () => {
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
  const html = renderToStaticMarkup(createElement(TimelineTable, { view }));

  it('pás nesie polohu aj šírku v percentách osi', () => {
    /* Poloha v čase je to jediné, čo tabuľka sama povedať nevie, takže pás
       prevod na `ui/Table` PREŽIL — len sa presunul do bunky „Na osi". */
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

  it('každý riadok vedie do detailu svojej zľavy', () => {
    expect(html).toContain('href="/zlavy/1"');
    expect(html).toContain('href="/zlavy/2"');
  });

  it('rozsah osi a dnešok stoja nad tabuľkou, nie len v `caption`', () => {
    /* Bez rozsahu sa percentá pásov nedajú na nič prepočítať — a `caption`
       vidí len čítačka. */
    expect(html).toContain('data-testid="timeline-axis"');
    expect(html).toContain('1. 8. 2026 – 10. 8. 2026');
    expect(html).toContain('dnes je 6. 8. 2026');
  });

  it('dnešok mimo osi sa NEZAMLČÍ — povie sa vetou', () => {
    const mimo = renderToStaticMarkup(
      createElement(TimelineTable, { view: { ...view, today: '2026-12-24' } }),
    );
    expect(mimo).toContain('dnešný deň na tejto osi neleží');
  });

  it('meno stĺpca je to isté ako v tabuľke zoznamu zliav', () => {
    /* Dve tabuľky toho istého tabu, ktoré ten istý fakt menujú inak, sa čítajú
       ako dve appky. `Okno platnosti` má rovnaké meno v `discountColumns()`. */
    for (const meno of ['Zľava', 'Názov', 'Okno platnosti', 'Prekryv na produkte']) {
      expect(html).toContain(meno);
    }
  });

  it('prekryv, o ktorom sa nevie, je POMLČKA — nie mlčanie a nie „čisté"', () => {
    /*
     * TICHÝ STAV, KTORÝ TU BOL DO V6b. Pás bez príznaku vyzeral rovnako pri
     * zľave, o ktorej appka vie, že sa nekríži, aj pri zľave, ktorej sused
     * nemá načítané produkty. Bunka to teraz rozlišuje (I11).
     */
    const nevieme = renderToStaticMarkup(
      createElement(TimelineTable, {
        view: {
          ...view,
          campaigns: [
            campaign({ id: 1, dateFrom: '2026-08-01', dateTo: '2026-08-05', productIds: [18342] }),
            campaign({ id: 2, dateFrom: '2026-08-04', dateTo: '2026-08-08', productIds: [] }),
          ],
        },
      }),
    );
    expect(nevieme).toContain('data-testid="timeline-unknown-1"');
    expect(nevieme).toContain('data-testid="timeline-unknown-2"');
    /* Priznanie musí byť aj v STROJI, nielen v texte: `ui/Table` značí bunku
       `data-value="unknown"` a dopĺňa slovo pre čítačku. */
    expect(nevieme).toContain('data-value="unknown"');
    expect(nevieme).toContain('nevieme');
    expect(nevieme).not.toContain('neprekrýva sa');
    /*
     * A TERAZ SAMOTNÝ ZNAK V BUNKE (K10, verifikácia V6c, mutácia M26).
     * Tvrdenia vyššie merali len STROJOVÉ priznanie (`data-value` a slovo pre
     * čítačku), takže `{NEVIEME}` → `{'0'}` v tejto bunke prešlo zelené: appka
     * by očiam ukázala nulu prekryvov, ktorú nikdy nezmerala, a pritom by sa
     * čítačke stále priznávala. Priznanie musí byť VO VŠETKÝCH TROCH kanáloch.
     */
    expect(nevieme).toContain(`data-testid="timeline-unknown-1">${NEVIEME}</span>`);
    expect(nevieme).toContain(`data-testid="timeline-unknown-2">${NEVIEME}</span>`);
    expect(nevieme).not.toMatch(/data-testid="timeline-unknown-1">[^<]*\d/);
  });

  it('bez suseda v čase je „neprekrýva sa" MERANÝ fakt, aj bez známych produktov', () => {
    const cisto = renderToStaticMarkup(
      createElement(TimelineTable, {
        view: {
          ...view,
          campaigns: [
            campaign({ id: 1, dateFrom: '2026-08-01', dateTo: '2026-08-02', productIds: [] }),
            campaign({ id: 2, dateFrom: '2026-08-07', dateTo: '2026-08-09', productIds: [] }),
          ],
        },
      }),
    );
    expect(cisto).toContain('neprekrýva sa');
    expect(cisto).not.toContain('data-testid="timeline-unknown-1"');
  });

  it('model: nedokázateľný prekryv nesú OBE strany dvojice', () => {
    const hit = unprovableOverlapIds([
      campaign({ id: 1, dateFrom: '2026-08-01', dateTo: '2026-08-05', productIds: [18342] }),
      campaign({ id: 2, dateFrom: '2026-08-04', dateTo: '2026-08-08', productIds: [] }),
    ]);
    expect([...hit].sort()).toEqual([1, 2]);
    /* Dve zľavy, ktoré sa v čase nestretnú, sa na tom istom kuse zraziť
       nemôžu — ani keď o produktoch nevieme nič. */
    expect(
      unprovableOverlapIds([
        campaign({ id: 1, dateFrom: '2026-08-01', dateTo: '2026-08-02', productIds: [] }),
        campaign({ id: 2, dateFrom: '2026-08-07', dateTo: '2026-08-09', productIds: [] }),
      ]).size,
    ).toBe(0);
  });

  it('zľava, ktorá na os nezasahuje, sa už nezahodí — povie to bunka', () => {
    /* Do V6b sa taký riadok len nenakreslil (`band === null`) a zľava zo
       zoznamu tichlo zmizla. Rozpor medzi odpoveďou a osou je priznanie. */
    const mimoOs = renderToStaticMarkup(
      createElement(TimelineTable, {
        view: {
          ...view,
          campaigns: [campaign({ id: 9, dateFrom: '2026-06-01', dateTo: '2026-06-30', productIds: [1] })],
        },
      }),
    );
    expect(mimoOs).toContain('data-testid="timeline-row-9"');
    expect(mimoOs).toContain('data-value="unknown"');
    /*
     * A ZNAK V BUNKE „Na osi" (K10, mutácia M27). Bez tohto tvrdenia prešlo
     * `content: NEVIEME` → `'0 %'` zelené — bunka by tvrdila NULOVÚ zľavu na
     * osi, teda číslo namiesto priznania, a `data-value="unknown"` by to
     * naďalej nazývalo pomlčkou. Riadok má jedinú neznámu bunku (v čase sa
     * s ničím nekríži), takže sa tu meria práve tá.
     */
    expect(mimoOs).toContain(`data-value="unknown">${NEVIEME}<`);
    expect(mimoOs).not.toMatch(/data-value="unknown">[^<]*\d/);
  });

  it('prázdna os hovorí vetu, nie prázdny rám', () => {
    const empty = renderToStaticMarkup(
      createElement(TimelineTable, { view: { ...view, campaigns: [] } }),
    );
    expect(empty).toContain('data-testid="timeline-empty"');
    expect(empty).toContain('appka nemá ani jednu zľavu');
  });
});
