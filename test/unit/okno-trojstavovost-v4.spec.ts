/**
 * Aura Zľavy — OKNO PREHĽADU NESMIE DOSADZOVAŤ NULU (V4, nález 4 z review V4).
 *
 * `src/components/dashboard/window-api.ts` mal do 31. 8. 2026 v jednom súbore
 * dve protichodné pravidlá. `parseRevenueDaily` a `parseTopFlop` boli vzorne
 * fail-closed (nečitateľné pole → `null`), ale `parseWriteActivity` a
 * `parseRevenueRow` dosadzovali `?? 0`. Tá nula nebola kozmetická:
 * `lastWriteResult()` z nej spravila „posledný výsledok zápisu" a karta zliav
 * napísala **„0 sa nepodarilo" o PRODUKČNÝCH ZÁPISOCH** — číslo, ktoré appka
 * nikdy nezmerala.
 *
 * Tento súbor meria PRÁVE TO ZLIATIE, a to na celej ceste
 * `odpoveď → parser → model → karta`:
 *
 *   1. nečitateľné pole je `null`, nie nula,
 *   2. ZMERANÁ nula zostáva nulou (pomlčka nesmie zjesť meranie),
 *   3. karta z `null` napíše priznanie, nie mlčanie (mlčanie sa čítalo ako nula),
 *   4. deň sa smie preskočiť ako „nezapisovalo sa" LEN keď sú všetky štyri
 *      počty zmerané a nulové.
 *
 * Testy sú napísané tak, aby ZČERVENALI PRI VRÁTENÍ `?? 0` — vetvy karty
 * nedostávajú vymyslené vstupy, ale výstup skutočného parsera nad nečitateľnou
 * odpoveďou. Overené mutačne 31. 8. 2026: po dočasnom vrátení `?? 0` do
 * `parseWriteActivity`, `parseRevenueRow`, `lowerBoundDays`, `missing` aj
 * `hasGap` sčervenalo 9 zo 17 tvrdení tohto súboru (zvyšných 8 stráži kartu
 * a model samostatne, tie parser nemutuje).
 *
 * Bez databázy a bez siete — parsery sú čisté funkcie, komponenty sa
 * vykresľujú cez `renderToStaticMarkup`.
 *
 * Vlastník: V4.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import CampaignsSection from '@/components/dashboard/CampaignsSection';
import SalesSection from '@/components/dashboard/SalesSection';
import type { SalesDay, SalesSnapshot } from '@/components/dashboard/api';
import { lastWriteResult } from '@/components/dashboard/overview-model';
import { revenueDays } from '@/components/dashboard/sales-view';
import {
  parseRevenueDaily,
  parseWriteActivity,
} from '@/components/dashboard/window-api';

const TODAY = '2026-08-19';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const NAMERANE: SalesDay[] = [
  { day: '2026-08-05', units: 578 },
  { day: '2026-08-06', units: 495 },
];

function snapshot(): SalesSnapshot {
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
  };
}

/** Odpoveď `/api/insights/activity`, v ktorej sú počty NEČITATEĽNÉ. */
const ACTIVITY_UNREADABLE = {
  days: [{ day: '2026-08-15', ok: 'dvesto', failed: null, uncertain: {}, skipped: -3 }],
};

/** Tá istá odpoveď, ale so ZMERANÝMI číslami (vrátane zmeranej nuly). */
const ACTIVITY_MEASURED = {
  days: [{ day: '2026-08-15', ok: 240, failed: 0, uncertain: 0, skipped: 0 }],
};

/* ════════ 1. Parser: nečitateľné pole je `null`, zmerané zostáva ══════════ */

describe('1. parseWriteActivity nedosadzuje nulu do počtov produkčných zápisov', () => {
  /** JADRO NÁLEZU 4: `?? 0` tu z nevedomosti robil meranie. */
  it('nečitateľné počty sú `null`, nie nula', () => {
    const rows = parseWriteActivity(ACTIVITY_UNREADABLE);
    expect(rows).not.toBeNull();
    const row = rows![0]!;
    expect(row.day).toBe('2026-08-15');
    expect(row.ok).toBeNull();
    expect(row.failed).toBeNull();
    expect(row.uncertain).toBeNull();
    // Záporný počet je nezmysel, teda tiež „nevieme" — nie nula.
    expect(row.skipped).toBeNull();
    for (const value of [row.ok, row.failed, row.uncertain, row.skipped]) {
      expect(value).not.toBe(0);
    }
  });

  it('ZMERANÁ nula zostáva nulou — pomlčka nesmie zjesť meranie', () => {
    const row = parseWriteActivity(ACTIVITY_MEASURED)![0]!;
    expect(row.ok).toBe(240);
    expect(row.failed).toBe(0);
    expect(row.uncertain).toBe(0);
    expect(row.skipped).toBe(0);
  });

  it('nečitateľná odpoveď ako celok je `null`, nie prázdny zoznam dní', () => {
    expect(parseWriteActivity(null)).toBeNull();
    expect(parseWriteActivity({ dni: [] })).toBeNull();
    expect(parseWriteActivity({ days: [] })).toEqual([]);
  });
});

/* ═════ 2. Model: preskočiť deň smie LEN zmeraná nula vo všetkých štyroch ══ */

describe('2. lastWriteResult nevyrába z nečitateľného dňa „nezapisovalo sa"', () => {
  it('deň so zmeranými nulami sa preskočí (pôvodné pravidlo platí)', () => {
    expect(
      lastWriteResult([{ day: TODAY, ok: 0, failed: 0, uncertain: 0, skipped: 0 }]),
    ).toBeNull();
  });

  it('deň s NEČITATEĽNÝM počtom sa nepreskočí a `null` prežije do karty', () => {
    const found = lastWriteResult(parseWriteActivity(ACTIVITY_UNREADABLE)!);
    expect(found).not.toBeNull();
    expect(found!.day).toBe('2026-08-15');
    expect(found!.ok).toBeNull();
    expect(found!.failed).toBeNull();
  });

  /**
   * Jedno zmerané číslo a jedno neprečítané v tom istom dni je najnepríjemnejší
   * vstup: karta musí povedať OBOJE — koľko sa zlacnilo aj to, že o zlyhaniach
   * nevie.
   */
  it('zmiešaný deň nesie hodnotu aj medzeru súčasne', () => {
    const found = lastWriteResult([
      { day: '2026-08-15', ok: 240, failed: null, uncertain: 0, skipped: 3 },
    ]);
    expect(found!.ok).toBe(240);
    expect(found!.failed).toBeNull();
    expect(found!.uncertain).toBe(0);
    expect(found!.skipped).toBe(3);
  });
});

/* ═══════════ 3. Karta: „0 neúspešných" len zo zmeranej nuly ═══════════════ */

describe('3. karta zliav prizná, čo o poslednom zápise nevie', () => {
  const card = (lastWrite: ReturnType<typeof lastWriteResult>): string =>
    renderToStaticMarkup(
      createElement(CampaignsSection, {
        campaigns: [],
        insights: [],
        lastWrite,
      }),
    );

  /**
   * MLČANIE SA ČÍTA AKO NULA. Karta údaj vynecháva pri nule — takže pri
   * neprečítanom počte ho vynechať NESMIE, inak povie „nič sa nepokazilo".
   */
  it('neprečítaný počet zlyhaní sa PÍŠE, nie vynecháva', () => {
    const html = card(
      lastWriteResult([{ day: '2026-08-15', ok: 240, failed: null, uncertain: 0, skipped: 0 }]),
    );
    expect(html).toContain('240 zlacnených');
    expect(html).toContain('nevieme, koľko sa nepodarilo');
    expect(html).not.toContain('0 sa nepodarilo');
  });

  it('ZMERANÁ nula zlyhaní priznanie NEVYPISUJE — bolo by to klamstvo naopak', () => {
    const html = card(
      lastWriteResult([{ day: '2026-08-15', ok: 240, failed: 0, uncertain: 0, skipped: 0 }]),
    );
    expect(html).toContain('240 zlacnených');
    expect(html).not.toContain('nevieme, koľko sa nepodarilo');
    expect(html).not.toContain('0 sa nepodarilo');
  });

  /** Celý deň nečitateľný → karta netvrdí ani to, že sa v ten deň zapisovalo. */
  it('celý nečitateľný deň karta prizná v hlavičke riadku', () => {
    const html = card(lastWriteResult(parseWriteActivity(ACTIVITY_UNREADABLE)!));
    expect(html).toContain('sa nepodarilo prečítať');
    expect(html).toContain('—');
    expect(html).not.toContain('0 zlacnených');
    expect(html).not.toContain('0 sa nepodarilo');
  });

  it('žiadny zápis v prečítaných dňoch je iná veta než nečitateľný deň', () => {
    const html = card(null);
    expect(html).toContain('v prečítaných dňoch ani jeden');
    expect(html).not.toContain('0 zlacnených');
  });
});

/* ══════ 4. Tržba: počet objednávok, dolná hranica a chýbajúce dni ═════════ */

describe('4. tržbové polia okna dosadenú nulu tiež nemajú', () => {
  const body = (patch: Record<string, unknown> = {}) => ({
    today: TODAY,
    window: { days: 1, from: TODAY, to: TODAY },
    scope: 'eshop',
    series: [
      {
        currency: 'EUR',
        days: [{ day: TODAY, totalPaidSum: '88.00', ordersCount: 'dve', dayComplete: false }],
        sum: '88.00',
        sumState: 'lower_bound',
        lowerBoundDays: 'jeden',
      },
    ],
    missing: [],
    hasGap: true,
    ...patch,
  });

  it('nečitateľný počet objednávok je `null` a taký prejde aj do riadku dňa', () => {
    const parsed = parseRevenueDaily(body())!;
    const row = parsed.series[0]!.days[0]!;
    expect(row.ordersCount).toBeNull();
    expect(row.ordersCount).not.toBe(0);
    expect(revenueDays([TODAY], parsed.series[0]!.days)[0]!.ordersCount).toBeNull();
  });

  it('nečitateľné `lowerBoundDays` je `null` — nula by tvrdila „okno je celé"', () => {
    const parsed = parseRevenueDaily(body())!;
    expect(parsed.series[0]!.lowerBoundDays).toBeNull();
    expect(parsed.series[0]!.sumState).toBe('lower_bound');
  });

  it('odpoveď bez zoznamu chýbajúcich dní je `null`, nie „nechýba nič"', () => {
    expect(parseRevenueDaily(body({ missing: 'sedem' }))!.missingDays).toBeNull();
    expect(parseRevenueDaily(body({ missing: [TODAY] }))!.missingDays).toBe(1);
    // Zmeraná nula zostáva nulou.
    expect(parseRevenueDaily(body())!.missingDays).toBe(0);
  });

  it('nečitateľný príznak medzery je `null`, nie „medzera nie je"', () => {
    expect(parseRevenueDaily(body({ hasGap: 'ano' }))!.hasGap).toBeNull();
    expect(parseRevenueDaily(body({ hasGap: false }))!.hasGap).toBe(false);
  });

  it('sekcia predajov medzeru pri `null` PRIZNÁ, nie zamlčí', () => {
    const parsed = parseRevenueDaily(body({ missing: 'sedem' }))!;
    const html = renderToStaticMarkup(
      createElement(SalesSection, { sales: snapshot(), revenue: parsed }),
    );
    expect(html).toContain('data-mode="unknown"');
    expect(html).toContain('nevieme');
    expect(html).toContain('nie je to nula');
  });

  it('pri zmeranej nule chýbajúcich dní sekcia nepíše nič', () => {
    const parsed = parseRevenueDaily(body())!;
    const html = renderToStaticMarkup(
      createElement(SalesSection, { sales: snapshot(), revenue: parsed }),
    );
    expect(html).not.toContain('data-testid="revenue-gap"');
  });
});

/* ═════════════ 5. Jeden súbor = JEDNO pravidlo, natrvalo ══════════════════ */

/**
 * Toto tvrdenie je zámerne o ZDROJI, nie o hodnote.
 *
 * Nález 4 vznikol tým, že v jednom súbore žili dve protichodné pravidlá a nič
 * to nedržalo. Testy vyššie chránia dnešné polia; tento test chráni pravidlo aj
 * pre pole, ktoré niekto pridá zajtra — a nikto naň test nenapíše.
 */
describe('5. window-api.ts nedosadzuje nulu ani v novom kóde', () => {
  it('v kóde parserov nie je ani jedno `?? 0` / `|| 0`', () => {
    const source = read('../../src/components/dashboard/window-api.ts')
      // Komentáre sa odstrihnú, inak by test meral PRÓZU: hlavička o `?? 0`
      // píše práve preto, že sa doň nesmie vrátiť.
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    expect(source).not.toMatch(/\?\?\s*0\b/);
    expect(source).not.toMatch(/\|\|\s*0\b/);
    // Ternár do nuly je ten istý trik inou syntaxou (`… : 0`).
    expect(source).not.toMatch(/:\s*0[,;\s)]/);
  });
});
