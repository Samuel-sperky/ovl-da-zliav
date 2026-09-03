/**
 * Aura Zľavy — GRAF TROCH KRIVIEK: PRAVDA V TELE DÁT (V7, D156, D157, K5).
 *
 * Graf Prehľadu kreslí denný predaj rozdelený na tri krivky — v zľave · bez
 * zľavy · **nevieme, či bola**. Tretia krivka je odpoveď na to, že appka vie
 * o zľave LEN to, čo sama zapísala: zľava nastavená ručne v administrácii
 * eshopu je pre ňu neviditeľná, takže bez nej by graf tvrdil, čo nevie.
 *
 * PREČO SA TO MERIA NA TELE DÁT A NIE NA PLOCHE (K5)
 * ──────────────────────────────────────────────────
 * Dvakrát, a oba dôvody sú v tomto repe zapísané.
 *
 * Prvý je technický: plocha Rechartsu sa v teste NEKRESLÍ.
 * `ResponsiveContainer` meria rodiča, ten má v serverovom renderi nulové
 * rozmery, a graf vráti prázdny `<div>` — každé tvrdenie o `<circle>`
 * a `<path>` by prešlo aj nad grafom, ktorý medzeru zaslepil nulou.
 *
 * Druhý je skúsenosť. D121 fungoval v klientskom modeli, kým server posielal
 * `unitsSold: 0` namiesto `null`, a `soldBucketOf(0)` dal tisícom produktov
 * legitímne vedro s 30 % zľavou. Nenašlo to 3756 testov, ale preklik: model
 * bol správny a dostal nepravdivý vstup. Preto sa tu meria CELÁ CESTA
 * v štyroch bodoch:
 *
 *   A. **odpoveď servera → parser** (`sales-daily-api.ts`) — vrátane riadkov,
 *      ktoré sa musia ZAHODIŤ, nie dopočítať,
 *   B. **riadky, z ktorých sa kreslia krivky** (`discount-split-view.ts`) proti
 *      RUČNE NAPÍSANEJ tabuľke očakávaní, nie proti druhému výpočtu,
 *   C. **props, ktoré komponent NAOZAJ odovzdá Rechartsu** (`recharts` je
 *      podvrhnutý a zapisuje si, čo dostal) — vrátane `connectNulls`,
 *   D. **bublina a prepis pre čítačku** — tam, kde krivka deň nenesie, musí byť
 *      POMLČKA, nikdy nula.
 *
 * Vlastník: V7, krok 2/4 (graf troch kriviek).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OWN_WRITES_NOTE,
  SPLIT_STATES,
  SPLIT_WORDS,
  UNKNOWN_TIP_NOTE,
  discountKnownFrom,
  discountSplitView,
  splitCellText,
  type DiscountSplitInput,
  type DiscountSplitPoint,
  type SplitState,
} from '@/components/dashboard/discount-split-view';
import { parseSalesDaily } from '@/components/dashboard/sales-daily-api';
import { SALES_TIP_NOTES } from '@/components/dashboard/sales-chart-view';
import { GAP_WORD, chartScaleMax } from '@/components/ui/chart-language';

/* ═══════════════════════ 0. Podvrhnutý Recharts ══════════════════════════ */

/**
 * `vi.hoisted` je povinné, nie ozdoba: `vi.mock` sa vykoná PRED telom súboru,
 * takže obyčajná `const` by v čase volania fabriky ešte neexistovala.
 */
const zaznam = vi.hoisted(() => ({
  volania: [] as Array<{ name: string; props: Record<string, unknown> }>,
}));

vi.mock('recharts', () => {
  const zapis =
    (name: string, kresliDeti: boolean) =>
    (props: Record<string, unknown>): ReactNode => {
      zaznam.volania.push({ name, props });
      if (!kresliDeti) return null;
      return createElement('div', { 'data-recharts': name }, props.children as ReactNode);
    };
  return {
    ResponsiveContainer: zapis('ResponsiveContainer', true),
    LineChart: zapis('LineChart', true),
    CartesianGrid: zapis('CartesianGrid', false),
    XAxis: zapis('XAxis', false),
    YAxis: zapis('YAxis', false),
    Tooltip: zapis('Tooltip', false),
    ReferenceArea: zapis('ReferenceArea', false),
    Line: zapis('Line', false),
  };
});

/* Import až za `vi.mock` — komponent musí vidieť podvrh. */
const { default: DiscountSplitChart, SplitDot, SplitTip, splitColor } = await import(
  '@/components/dashboard/DiscountSplitChart'
);

/* ═══════════════════════════ 1. Prípravok ════════════════════════════════ */

const DNES = '2026-08-23';
const OD = '2026-08-10';

/** Deň okna a to, čo o ňom `sales_sync_state` hovorí. */
const DNI_OKNA: ReadonlyArray<[string, string]> = [
  ['2026-08-10', 'complete'],
  ['2026-08-11', 'complete'],
  ['2026-08-12', 'partial'],
  ['2026-08-13', 'missing'],
  ['2026-08-14', 'complete'],
  ['2026-08-15', 'partial'],
  ['2026-08-16', 'complete'],
  ['2026-08-17', 'complete'],
  ['2026-08-18', 'complete'],
  ['2026-08-19', 'complete'],
  ['2026-08-20', 'complete'],
  ['2026-08-21', 'complete'],
  ['2026-08-22', 'missing'],
  ['2026-08-23', 'complete'],
];

/**
 * Riadky `days` PRESNE tak, ako ich posiela route: deň, ktorý sa nesťahoval,
 * v odpovedi CHÝBA (nedostane nulu), a `partial` deň bez jediného kusu je
 * sťahovanie, ktoré nič neprinieslo.
 */
const RIADKY_DNI: ReadonlyArray<{ day: string; units: number; status: string }> = [
  { day: '2026-08-10', units: 12, status: 'complete' },
  /* MERANÁ NULA: deň sa stiahol a nepredalo sa nič. Fakt o eshope. */
  { day: '2026-08-11', units: 0, status: 'complete' },
  /* `partial` BEZ KUSOV: sťahovanie spadlo skôr, než čokoľvek prinieslo. */
  { day: '2026-08-12', units: 0, status: 'partial' },
  { day: '2026-08-14', units: 7, status: 'complete' },
  /* `partial` S KUSMI: dolná hranica, nikdy súčet. */
  { day: '2026-08-15', units: 9, status: 'partial' },
  { day: '2026-08-16', units: 5, status: 'complete' },
  { day: '2026-08-17', units: 3, status: 'complete' },
  { day: '2026-08-18', units: 8, status: 'complete' },
  { day: '2026-08-19', units: 6, status: 'complete' },
  { day: '2026-08-20', units: 4, status: 'complete' },
  { day: '2026-08-21', units: 2, status: 'complete' },
  { day: DNES, units: 1, status: 'complete' },
];

/**
 * Kampane v okne. Sú tu VŠETKY TRI druhy naschvál:
 *
 *  · `done` 14.–19. 8. — zapísaná zľava, teda dni „v zľave" A hranica poznania,
 *  · `failed` 21.–22. 8. — nezapísala NIČ, takže 21. 8. musí zostať „bez zľavy",
 *  · `cancelled` 11.–12. 8. — to isté pred hranicou: nesmie ju posunúť dozadu.
 */
const KAMPANE = [
  { id: 1, name: 'Zapísaná', percent: 10, dateFrom: '2026-08-14', dateTo: '2026-08-19', fireAt: null, status: 'done' },
  { id: 2, name: 'Zlyhala', percent: 20, dateFrom: '2026-08-21', dateTo: '2026-08-22', fireAt: null, status: 'failed' },
  { id: 3, name: 'Zrušená', percent: 15, dateFrom: '2026-08-11', dateTo: '2026-08-12', fireAt: null, status: 'cancelled' },
];

/** Odpoveď `/api/insights/sales-daily` v tvare, aký route naozaj posiela. */
function odpoved(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    today: DNES,
    window: { days: DNI_OKNA.length, from: OD, to: DNES },
    coverage: { syncEnabled: true, from: OD, to: DNES, daysCovered: 11, hasData: true },
    gaps: {
      windowDays: DNI_OKNA.length,
      from: OD,
      to: DNES,
      days: DNI_OKNA.map(([day, coverage]) => ({ day, coverage })),
      completeDays: 10,
      partialDays: 2,
      pendingDays: 0,
      missingDays: 2,
      unknownDays: 4,
      missing: ['2026-08-12', '2026-08-13', '2026-08-15', '2026-08-22'],
      hasGap: true,
    },
    windowUnits: 41,
    unitsState: 'lower_bound',
    days: RIADKY_DNI,
    ...extra,
  };
}

/** Celá cesta: odpoveď → parser → riadky grafu. Nikdy nie skratkou. */
function pohlad(body: Record<string, unknown> = odpoved()) {
  const daily = parseSalesDaily(body);
  expect(daily, 'odpoveď sa nedala prečítať').not.toBeNull();
  const input: DiscountSplitInput = {
    from: daily!.from,
    to: daily!.to,
    today: daily!.today,
    coverage: daily!.coverage,
    days: daily!.days,
    campaigns: KAMPANE,
  };
  return discountSplitView(input);
}

const bod = (day: string, view = pohlad()): DiscountSplitPoint => {
  const found = view.points.find((row) => row.day === day);
  expect(found, `deň ${day} na osi nie je`).toBeDefined();
  return found!;
};

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const bezKomentarov = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1 ');

/* ═════════════════ A. Parser: čo sa musí ZAHODIŤ ═════════════════════════ */

describe('A. odpoveď servera sa nečíta voľnejšie, než je napísaná', () => {
  it('platná odpoveď dá okno, dni aj pokrytie na KAŽDÝ deň', () => {
    const daily = parseSalesDaily(odpoved());
    expect(daily?.from).toBe(OD);
    expect(daily?.to).toBe(DNES);
    expect(daily?.windowDays).toBe(14);
    expect(daily?.coverage).toHaveLength(14);
    expect(daily?.days).toHaveLength(RIADKY_DNI.length);
    expect(daily?.unknownDays).toBe(4);
  });

  it('odpoveď bez `gaps` je `null`, nie polovičný pohľad', () => {
    /*
     * Bez pokrytia po dňoch graf nevie, KDE má nakresliť dieru — vedel by len,
     * že niekde je. Os by sa stiahla na dni, ktoré niečo priniesli, a výpadok
     * sťahovania by z obrazovky zmizol.
     */
    const body = odpoved();
    delete body.gaps;
    expect(parseSalesDaily(body)).toBeNull();
  });

  it('deň bez `status` sa ZAHODÍ — stav sa nedopĺňa', () => {
    /*
     * Náhradná hodnota mierila v tomto repe už raz nesprávnym smerom
     * (`?? 'complete'`) a robila z „nevieme" meranie. Riadok, ktorý nehovorí,
     * či je deň dočítaný, nie je ani meranie, ani dolná hranica.
     */
    const daily = parseSalesDaily(
      odpoved({ days: [{ day: '2026-08-10', units: 12 }, ...RIADKY_DNI.slice(1)] }),
    );
    expect(daily?.days.some((row) => row.day === '2026-08-10')).toBe(false);
    expect(daily?.days).toHaveLength(RIADKY_DNI.length - 1);
  });

  it('kusy ako TEXT nie sú meranie', () => {
    const daily = parseSalesDaily(
      odpoved({ days: [{ day: '2026-08-10', units: '12', status: 'complete' }] }),
    );
    expect(daily?.days).toEqual([]);
  });

  it('neznámy kód pokrytia sa ZAHODÍ, nedopočíta sa naň deň', () => {
    const daily = parseSalesDaily(
      odpoved({
        gaps: {
          ...(odpoved().gaps as Record<string, unknown>),
          days: [{ day: '2026-08-10', coverage: 'vymyslene' }],
        },
      }),
    );
    expect(daily?.coverage).toEqual([]);
  });
});

/* ═══════ B. Telo dát: tri krivky proti tabuľke očakávaní ══════════════════ */

/**
 * RUČNE NAPÍSANÁ tabuľka očakávaní — nie druhý výpočet.
 *
 * Repo má zapísané, prečo to takto: testy pravidla osi porovnávali klon
 * s klonom, takže rovnaký preklep v oboch by prešiel (K5, V6b). Tu je preto
 * každý deň napísaný rukou: `state` `null` znamená MEDZERA (žiadna krivka),
 * `units` `null` znamená „nevieme", a `0` znamená nameranú nulu.
 */
const OCAKAVANIA: ReadonlyArray<{
  day: string;
  state: SplitState | null;
  units: number | null;
  lowerBound?: boolean;
}> = [
  { day: '2026-08-10', state: 'unknown', units: 12 },
  { day: '2026-08-11', state: 'unknown', units: 0 },
  { day: '2026-08-12', state: null, units: null },
  { day: '2026-08-13', state: null, units: null },
  { day: '2026-08-14', state: 'discounted', units: 7 },
  { day: '2026-08-15', state: 'discounted', units: 9, lowerBound: true },
  { day: '2026-08-16', state: 'discounted', units: 5 },
  { day: '2026-08-17', state: 'discounted', units: 3 },
  { day: '2026-08-18', state: 'discounted', units: 8 },
  { day: '2026-08-19', state: 'discounted', units: 6 },
  { day: '2026-08-20', state: 'plain', units: 4 },
  { day: '2026-08-21', state: 'plain', units: 2 },
  { day: '2026-08-22', state: null, units: null },
  { day: DNES, state: 'plain', units: 1 },
];

describe('B. každý deň okna má jeden stav a jednu krivku', () => {
  it('os má riadok na KAŽDÝ deň okna, aj na nesťahovaný', () => {
    // 14 dní okna, 12 riadkov v odpovedi — a napriek tomu 14 bodov osi.
    expect(pohlad().points.map((point) => point.day)).toEqual(
      OCAKAVANIA.map((row) => row.day),
    );
  });

  it('deň po dni sedí s tabuľkou očakávaní', () => {
    const view = pohlad();
    for (const ocakavane of OCAKAVANIA) {
      const point = bod(ocakavane.day, view);
      expect(point.state, ocakavane.day).toBe(ocakavane.state);
      expect(point.units, ocakavane.day).toBe(ocakavane.units);
      expect(point.lowerBound, ocakavane.day).toBe(ocakavane.lowerBound === true);
    }
  });

  it('hodnotu nesie PRÁVE JEDNA krivka — ostatné majú `null`, nikdy nulu', () => {
    /*
     * Keby hraničný deň dostal hodnotu do dvoch kriviek (aby sa čiary
     * „spojili"), bublina by ten istý predaj vypísala dvakrát a súčet kriviek
     * by bol vyšší než predaj.
     */
    for (const point of pohlad().points) {
      const nesu = SPLIT_STATES.filter((state) => point[state] !== null);
      expect(nesu.length, point.day).toBe(point.state === null ? 0 : 1);
      if (point.state !== null) expect(nesu[0]).toBe(point.state);
      for (const state of SPLIT_STATES) {
        if (state === point.state) continue;
        // Nula by znamenala „v takom stave sa nepredalo nič" — nikto to nemeral.
        expect(point[state], `${point.day}/${state}`).toBeNull();
      }
    }
  });

  it('NAMERANÁ NULA sa kreslí ako NULA, nie ako medzera', () => {
    const point = bod('2026-08-11');
    expect(point.units).toBe(0);
    expect(point.unknown).toBe(0);
    expect(point.state).toBe('unknown');
  });

  it('`partial` deň BEZ KUSOV je medzera, nie nula', () => {
    /*
     * Toto je presne to zliatie, ktoré zakazuje I11: „predalo sa 0 kusov" je
     * tvrdenie o eshope, „sťahovanie spadlo" je tvrdenie o appke.
     */
    const point = bod('2026-08-12');
    expect(point.units).toBeNull();
    expect(point.state).toBeNull();
    expect([point.discounted, point.plain, point.unknown]).toEqual([null, null, null]);
  });

  it('deň, ktorý odpoveď vôbec neposlala, je medzera na správnom mieste', () => {
    const point = bod('2026-08-13');
    expect(point.units).toBeNull();
    expect(point.state).toBeNull();
  });

  it('neúplný deň je DOLNÁ HRANICA a nesie ju krivka svojho stavu', () => {
    const point = bod('2026-08-15');
    expect(point.lowerBound).toBe(true);
    expect(point.discounted).toBe(9);
    expect(splitCellText(point.discounted, point.lowerBound)).toBe('≥ 9');
  });

  it('dnešok je označený — deň ešte beží', () => {
    expect(bod(DNES).isToday).toBe(true);
    expect(pohlad().points.filter((point) => point.isToday)).toHaveLength(1);
  });

  it('horná hranica osi je pravidlo z jazyka grafov, základňa nula', () => {
    // Najväčší meraný deň je 12 → 20. Tá istá funkcia ako v každom inom grafe.
    expect(pohlad().scaleMax).toBe(chartScaleMax(12));
    expect(pohlad().scaleMax).toBe(20);
  });

  it('pásma bez merania sú súvislé úseky, nie zoznam dní', () => {
    const view = pohlad();
    expect(view.gaps.map((gap) => [gap.fromDay, gap.toDay, gap.days])).toEqual([
      ['2026-08-12', '2026-08-13', 2],
      ['2026-08-22', '2026-08-22', 1],
    ]);
    // Krátky pás slovo neunesie — z textu by bola kaša. Vetu nesie pätička.
    expect(view.gaps.map((gap) => gap.label)).toEqual([null, null]);
  });

  it('dlhší pás už slovo unesie, a je to TO ISTÉ slovo ako v tabuľke', () => {
    const view = pohlad(
      odpoved({
        days: RIADKY_DNI.filter((row) => row.day < '2026-08-14' || row.day > '2026-08-18'),
        gaps: {
          ...(odpoved().gaps as Record<string, unknown>),
          days: DNI_OKNA.map(([day, coverage]) => ({
            day,
            coverage: day >= '2026-08-14' && day <= '2026-08-18' ? 'missing' : coverage,
          })),
        },
      }),
    );
    const dlhy = view.gaps.find((gap) => gap.days >= 3);
    expect(dlhy?.fromDay).toBe('2026-08-12');
    expect(dlhy?.label).toBe(GAP_WORD);
  });

  it('počty dní podľa krivky sedia so stavmi bodov', () => {
    const view = pohlad();
    expect(view.counts).toEqual({ discounted: 6, plain: 3, unknown: 2, gap: 3 });
    expect(view.measuredDays).toBe(11);
  });
});

/* ═══════ C. Hranica poznania: odkedy appka o zľavách vie ══════════════════ */

describe('C. tretia krivka drží dni, o ktorých appka nemá záznam', () => {
  it('hranica je prvý deň ZAPÍSANEJ zľavy, nie prvá kampaň v tabuľke', () => {
    expect(discountKnownFrom(KAMPANE)).toBe('2026-08-14');
    expect(pohlad().knownFrom).toBe('2026-08-14');
  });

  it('kampaň, ktorá NIČ nezapísala, dni „v zľave" nerobí', () => {
    /*
     * 21. 8. kryje `failed` kampaň. Keby ju graf bral za zľavu, tvrdil by
     * o produkčnom eshope niečo, čo sa nikdy nestalo — okno bez zápisu nie je
     * tvrdenie o eshope.
     */
    expect(bod('2026-08-21').state).toBe('plain');
    expect(bod('2026-08-21').discounted).toBeNull();
    // A `cancelled` kampaň 11.–12. 8. nesmie posunúť hranicu dozadu.
    expect(bod('2026-08-11').state).toBe('unknown');
  });

  it('dni PRED hranicou nesie krivka „nevieme", aj keď sú zmerané', () => {
    for (const day of ['2026-08-10', '2026-08-11']) {
      expect(bod(day).state, day).toBe('unknown');
    }
    for (const day of ['2026-08-14', '2026-08-19']) {
      expect(bod(day).state, day).toBe('discounted');
    }
  });

  it('bez jediného zápisu je CELÉ okno „nevieme, či bola"', () => {
    /*
     * Dnešný stav appky: bez `shop_write` kľúča a so zabanovanou IP (R4). Graf
     * v tej chvíli nesmie tvrdiť „bez zľavy" — a musí to povedať vetou.
     */
    const daily = parseSalesDaily(odpoved())!;
    const view = discountSplitView({
      from: daily.from,
      to: daily.to,
      today: daily.today,
      coverage: daily.coverage,
      days: daily.days,
      campaigns: [],
    });
    expect(view.knownFrom).toBeNull();
    expect(view.counts.discounted).toBe(0);
    expect(view.counts.plain).toBe(0);
    expect(view.counts.unknown).toBe(11);
    expect(view.notes.join(' ')).toContain('ani jeden zapísaný deň zľavy');
    expect(view.notes.join(' ')).toContain(SPLIT_WORDS.unknown);
  });

  it('zľava, ktorá začala PRED oknom, kryje dni okna od jeho prvého dňa', () => {
    /*
     * Route vracia kampaň, ktorá do okna len zasahuje, CELÚ — orezanie je práca
     * grafu. Bez orezania by dlhé okno prepadlo poistkou na 400 dní a deň so
     * zľavou by spadol do „bez zľavy".
     */
    const daily = parseSalesDaily(odpoved())!;
    const view = discountSplitView({
      from: daily.from,
      to: daily.to,
      today: daily.today,
      coverage: daily.coverage,
      days: daily.days,
      campaigns: [
        { dateFrom: '2025-01-01', dateTo: '2026-08-11', status: 'done' },
      ],
    });
    expect(view.knownFrom).toBe('2025-01-01');
    expect(bod('2026-08-10', view).state).toBe('discounted');
    expect(bod('2026-08-11', view).state).toBe('discounted');
    expect(bod(DNES, view).state).toBe('plain');
  });

  it('prevrátené a nečitateľné okno hranicu NEVYROBÍ', () => {
    expect(
      discountKnownFrom([{ dateFrom: '2026-08-20', dateTo: '2026-08-10', status: 'done' }]),
    ).toBeNull();
    expect(
      discountKnownFrom([{ dateFrom: 'nezmysel', dateTo: '2026-08-10', status: 'done' }]),
    ).toBeNull();
    // Chýbajúci stav = nedokázaný zápis. Fail-closed.
    expect(
      discountKnownFrom([{ dateFrom: '2026-08-01', dateTo: '2026-08-10', status: null }]),
    ).toBeNull();
  });

  it('pätička POVIE, že zľava je podľa vlastných zápisov — vždy', () => {
    /*
     * Bez tejto vety by krivka „bez zľavy" vyzerala ako tvrdenie o eshope.
     * Preto je posledná poznámka POVINNÁ, nie podmienená.
     */
    expect(pohlad().notes).toContain(OWN_WRITES_NOTE);
    expect(OWN_WRITES_NOTE).toContain('ručne v administrácii');
  });

  it('veta o nesťahovaných dňoch nesie ČÍSLO a slovo o medzere', () => {
    const note = pohlad().notes.find((text) => text.includes(GAP_WORD));
    expect(note).toBeDefined();
    expect(note).toContain('3 dni');
    expect(note).toContain('medzera');
  });
});

/* ═════════ D. Bublina a prepis: pomlčka namiesto nuly ════════════════════ */

describe('D. kde krivka deň nenesie, je POMLČKA — nikdy nula (D157)', () => {
  const bublina = (day: string, view = pohlad()): string =>
    renderToStaticMarkup(
      createElement(SplitTip, { active: true, label: day, points: view.points }),
    );

  it('bublina ukáže VŠETKY TRI krivky naraz, aby sa dali porovnať', () => {
    const html = bublina('2026-08-14');
    for (const state of SPLIT_STATES) expect(html).toContain(SPLIT_WORDS[state]);
  });

  it('deň v zľave: číslo v jednej krivke, pomlčka v dvoch, nikde nula', () => {
    const html = bublina('2026-08-14');
    expect(html).toContain('>7<');
    expect((html.match(/—/g) ?? []).length).toBe(2);
    expect(html).not.toContain('>0<');
  });

  it('nesťahovaný deň: tri pomlčky a VETA, nie mlčanie', () => {
    const html = bublina('2026-08-12');
    expect((html.match(/—/g) ?? []).length).toBe(3);
    expect(html).toContain(SALES_TIP_NOTES.unmeasured);
    expect(html).not.toContain('>0<');
  });

  it('deň, o ktorého zľave nevieme, to povie SLOVOM', () => {
    const html = bublina('2026-08-10');
    expect(html).toContain('>12<');
    expect(html).toContain(UNKNOWN_TIP_NOTE);
  });

  it('nameraná nula sa v bubline píše ako nula', () => {
    const html = bublina('2026-08-11');
    expect(html).toContain('>0<');
    // A dve zvyšné krivky majú aj tak pomlčku.
    expect((html.match(/—/g) ?? []).length).toBe(2);
  });

  it('neúplný deň nesie `≥`, nie číslo bez priznania', () => {
    const html = bublina('2026-08-15');
    expect(html).toContain('≥ 9');
    expect(html).toContain(SALES_TIP_NOTES.estimate);
  });

  it('prepis pre čítačku má TIE ISTÉ čísla vrátane pomlčiek', () => {
    const view = pohlad();
    const riadok = (day: string) => view.summaryRows.find((row) => row.day === day);
    expect(riadok('2026-08-14')?.cells).toEqual(['7', '—', '—']);
    expect(riadok('2026-08-12')?.cells).toEqual(['—', '—', '—']);
    expect(riadok('2026-08-12')?.note).toBe(SALES_TIP_NOTES.unmeasured);
    expect(riadok('2026-08-11')?.cells).toEqual(['—', '—', '0']);
    expect(riadok('2026-08-15')?.cells).toEqual(['≥ 9', '—', '—']);
    // Riadok má KAŽDÝ deň osi — vynechaný deň by tabuľku spravila
    // dôveryhodnejšou než graf, ktorý dieru poctivo kreslí.
    expect(view.summaryRows).toHaveLength(14);
  });
});

/* ═══════ E. Props, ktoré komponent naozaj odovzdá Rechartsu ══════════════ */

describe('E. čo dostane Recharts (plocha sa v teste nekreslí)', () => {
  beforeEach(() => {
    zaznam.volania.length = 0;
  });

  const kresli = (props: Record<string, unknown> = {}): string => {
    const daily = parseSalesDaily(odpoved());
    return renderToStaticMarkup(
      createElement(DiscountSplitChart, {
        daily,
        campaigns: KAMPANE,
        windowDays: 30,
        ...props,
      }),
    );
  };

  const volania = (name: string) => zaznam.volania.filter((call) => call.name === name);

  it('krivky sú TRI a v poradí jazyka modelu', () => {
    kresli();
    expect(volania('Line').map((call) => call.props.dataKey)).toEqual([...SPLIT_STATES]);
  });

  it('KAŽDÁ krivka má `connectNulls: false` — inak medzera zmizne', () => {
    /*
     * `true` by natiahlo čiaru cez nesťahované dni AJ cez dni, ktoré patria
     * inej krivke, a z priznania „toto sme nemerali" by spravilo tvrdenie
     * „šlo to takto".
     */
    kresli();
    for (const call of volania('Line')) {
      expect(call.props.connectNulls, String(call.props.dataKey)).toBe(false);
    }
  });

  it('dáta kriviek sú riadky modelu, nie dopočítané pole', () => {
    kresli();
    const data = volania('LineChart')[0]?.props.data as DiscountSplitPoint[];
    expect(data.map((row) => row.day)).toEqual(OCAKAVANIA.map((row) => row.day));
    expect(data.map((row) => row.units)).toEqual(OCAKAVANIA.map((row) => row.units));
  });

  it('mriežka je LEN vodorovná a základňa osi je nula (D157)', () => {
    kresli();
    expect(volania('CartesianGrid')[0]?.props.vertical).toBe(false);
    expect(volania('YAxis')[0]?.props.domain).toEqual([0, 20]);
    expect(volania('YAxis')[0]?.props.allowDecimals).toBe(false);
  });

  it('kľúčom osi je ISO deň, nie popis — popis kreslí `tickFormatter`', () => {
    kresli();
    const xAxis = volania('XAxis')[0]?.props;
    expect(xAxis?.dataKey).toBe('day');
    expect(typeof xAxis?.tickFormatter).toBe('function');
    const format = xAxis?.tickFormatter as (day: string) => string;
    // Nezlomiteľná medzera: `Text` Rechartsu láme popisky po slovách.
    expect(format('2026-08-07')).toBe('7. 8.');
  });

  it('nesťahované pásma dostanú ŠRAFOVANÉ pozadie — druhý kanál k medzere', () => {
    kresli();
    const areas = volania('ReferenceArea');
    expect(areas).toHaveLength(2);
    expect(areas[0]?.props.x1).toBe('2026-08-12');
    expect(areas[0]?.props.x2).toBe('2026-08-13');
    expect(String(areas[0]?.props.fill)).toMatch(/^url\(#/);
  });

  it('bublina dostane VLASTNÉ riadky, nie `payload` Rechartsu', () => {
    kresli();
    const content = volania('Tooltip')[0]?.props.content as {
      props: { points: DiscountSplitPoint[] };
    };
    expect(content.props.points).toHaveLength(14);
  });

  it('legenda nesie tri krivky slovom a bodkovanú marku pre „nevieme"', () => {
    const html = kresli();
    for (const state of SPLIT_STATES) expect(html).toContain(SPLIT_WORDS[state]);
    // Značka „nesťahované" je v legende LEN keď je čo priznať — teraz je.
    expect(html).toContain(GAP_WORD);
    // Bodkovaná marka = namerané hodnoty s neznámym zaradením (D156).
    expect(html).toContain('stroke-dasharray="0.1 4"');
    expect(html).toContain('stroke-linecap="round"');
  });

  it('bez odpovede sa NEPOČÍTA nič — kostra, chyba, a nikdy nuly', () => {
    zaznam.volania.length = 0;
    const kostra = renderToStaticMarkup(
      createElement(DiscountSplitChart, { daily: undefined, windowDays: 30 }),
    );
    expect(kostra).toContain('data-mode="loading"');
    expect(volania('Line')).toHaveLength(0);

    zaznam.volania.length = 0;
    const chyba = renderToStaticMarkup(
      createElement(DiscountSplitChart, { daily: null, windowDays: 30 }),
    );
    expect(chyba).toContain('data-mode="error"');
    expect(volania('Line')).toHaveLength(0);
  });

  it('okno bez jediného stiahnutého dňa je NEMERANÉ, nie prázdne', () => {
    /*
     * „Za obdobie nemáme ani jeden bod" je tvrdenie o predaji; toto je
     * tvrdenie o appke (piaty stav `ChartCard`, I11).
     */
    zaznam.volania.length = 0;
    const html = kresli({
      daily: parseSalesDaily(
        odpoved({
          days: [],
          gaps: {
            ...(odpoved().gaps as Record<string, unknown>),
            days: DNI_OKNA.map(([day]) => ({ day, coverage: 'missing' })),
          },
        }),
      ),
    });
    expect(html).toContain('data-mode="unmeasured"');
    expect(volania('Line')).toHaveLength(0);
  });

  it('prepínač okna grafu ide do HLAVIČKY karty (D155, druhý z dvoch)', () => {
    const html = kresli({ switcher: createElement('div', { 'data-testid': 'prepinac' }) });
    expect(html).toContain('data-testid="prepinac"');
  });
});

/* ═════════ F. Značka bodu: medzera bod nedostane ═════════════════════════ */

describe('F. bod sa nekreslí nad hodnotou, ktorú krivka nenesie', () => {
  const znacka = (state: SplitState, day: string): string =>
    renderToStaticMarkup(
      createElement(SplitDot, {
        cx: 10,
        cy: 20,
        payload: bod(day),
        state,
        color: 'var(--chart-1)',
      }),
    );

  it('nad medzerou nie je bod — kruh na nule by z nej spravil hodnotu', () => {
    for (const state of SPLIT_STATES) expect(znacka(state, '2026-08-12')).toBe('');
  });

  it('krivka, ktorej deň nepatrí, bod nedostane', () => {
    // 14. 8. je „v zľave", takže ostatné dve krivky nad ním nekreslia nič.
    expect(znacka('discounted', '2026-08-14')).not.toBe('');
    expect(znacka('plain', '2026-08-14')).toBe('');
    expect(znacka('unknown', '2026-08-14')).toBe('');
  });

  it('tri krivky majú tri TVARY, nie tri odtiene toho istého tvaru', () => {
    const vZlave = znacka('discounted', '2026-08-14');
    const bezZlavy = znacka('plain', '2026-08-20');
    const nevieme = znacka('unknown', '2026-08-10');
    expect(vZlave).toContain('<circle');
    expect(bezZlavy).toContain('<rect');
    expect(nevieme).toContain('<circle');
    // „Nevieme" má prázdny stred, „v zľave" plný — inak by ich delila len farba.
    expect(new Set([vZlave, bezZlavy, nevieme]).size).toBe(3);
    expect(nevieme).not.toBe(vZlave);
  });

  it('farby kriviek sú kroky palety, nikdy napísaná farba', () => {
    const theme = { series: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'], accent: 'var(--accent)' };
    expect(splitColor(theme as never, 'discounted')).toBe('var(--chart-1)');
    expect(splitColor(theme as never, 'plain')).toBe('var(--chart-2)');
    expect(splitColor(theme as never, 'unknown')).toBe('var(--chart-3)');
    // Prázdna paleta padne na akcent, nie na `undefined` v atribúte.
    expect(splitColor({ series: [], accent: 'var(--accent)' } as never, 'plain')).toBe(
      'var(--accent)',
    );
  });
});

/* ═════════ G. Statické závory: kde sa pravda dá stratiť tichom ═══════════ */

describe('G. závory nad zdrojom — tri veci, ktoré test nad DOM-om neuvidí', () => {
  const MODEL = read('src/components/dashboard/discount-split-view.ts');
  const GRAF = read('src/components/dashboard/DiscountSplitChart.tsx');
  const API = read('src/components/dashboard/sales-daily-api.ts');
  const MODUL = read('src/components/dashboard/discount-split.module.css');

  it('model nikde nedopĺňa nulu za „nevieme"', () => {
    const kod = bezKomentarov(MODEL);
    expect(/\?\?\s*0\b/.test(kod), 'model dopĺňa nulu za chýbajúcu hodnotu').toBe(false);
    expect(/\|\|\s*0\b/.test(kod), 'model dopĺňa nulu za chýbajúcu hodnotu').toBe(false);
  });

  it('`connectNulls` sa neposiela ručne, ale zo spoločného jazyka grafov', () => {
    /*
     * Ručne napísaná hodnota by sa dala prepnúť v jednom rade z troch a graf by
     * vyzeral takmer rovnako. `GAP_SERIES_PROPS` je jedno miesto pre celú appku.
     */
    const kod = bezKomentarov(GRAF);
    expect(kod).toContain('GAP_SERIES_PROPS');
    expect(kod).not.toContain('connectNulls');
  });

  it('graf si nepočíta vlastnú hornú hranicu osi (K5, štvrtá kópia)', () => {
    const kod = bezKomentarov(GRAF) + bezKomentarov(MODEL);
    expect(kod).toContain('chartScaleMax');
    expect(/Math\.(ceil|pow)\s*\(/.test(kod), 'tu vzniká druhé telo pravidla osi').toBe(false);
    expect(/niceCeiling|niceCount/.test(kod)).toBe(false);
  });

  it('ani jedna farba nie je napísaná ručne (D147)', () => {
    for (const [nazov, zdroj] of [
      ['model', MODEL],
      ['graf', GRAF],
      ['api', API],
      ['modul', MODUL],
    ] as const) {
      const kod = zdroj.replace(/\/\*[\s\S]*?\*\//g, ' ');
      expect(kod.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], nazov).toEqual([]);
      expect(/rgba?\(/.test(kod), `${nazov} tónuje mimo tokenov`).toBe(false);
      expect(/!important/.test(kod), `${nazov} má !important`).toBe(false);
      // Zlatá je značková farba a stavová škála je meraný STAV — ani jedno
      // nesmie kódovať rad grafu (`grafy-paleta.spec.ts` to isté meria inde).
      expect(/var\(\s*--gold/.test(kod), nazov).toBe(false);
      expect(/var\(\s*--st-/.test(kod), nazov).toBe(false);
    }
  });

  it('tabuľkový prepis nekreslí Prehľad, ale vrstva grafov', () => {
    /*
     * Architektúra §1: „tabuľka produktov — Prehľad NIKDY". Prepis grafu
     * tabuľkou produktov nie je, ale hranica sa nekreslí výnimkami: tabuľka
     * žije v `charts/` a Prehľad si ju len pýta.
     */
    expect(bezKomentarov(GRAF)).not.toContain('<table');
    expect(bezKomentarov(GRAF)).toContain('ChartSeriesSummaryTable');
  });

  it('krivka „nevieme" je BODKOVANÁ, nie prerušovaná (trend) ani šrafovaná', () => {
    const kod = bezKomentarov(GRAF);
    expect(kod).toContain('dotted: true');
    expect(kod).not.toContain('dashed');
    expect(MODUL).toContain('stroke-dasharray: 0.1 5');
  });

  it('slová kriviek sú z D156 a nezmäkli', () => {
    expect(SPLIT_WORDS.discounted).toBe('v zľave');
    expect(SPLIT_WORDS.plain).toBe('bez zľavy');
    expect(SPLIT_WORDS.unknown).toBe('nevieme, či bola');
  });
});
