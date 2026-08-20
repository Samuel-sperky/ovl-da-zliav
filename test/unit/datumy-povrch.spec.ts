/**
 * Aura Zľavy — ISO DÁTUM SA NA POVRCH NEVRÁTI (šprint dokončenia, W2).
 *
 * Do 20. 8. 2026 hlásil analytik vetu „Kampaň „Ležiaky — 10 %" končí o 7 dní
 * (2026-08-26)…". Boli v nej tri porušenia naraz a ani jedno nič nezhodilo:
 * interný názov entity, relatívny čas a ISO dátum. Vyzeralo to ako preklep,
 * a pritom je to celý tvar, v akom appka hovorí o čase.
 *
 * PREČO TENTO SÚBOR EXISTUJE
 * --------------------------
 * `${c.dateTo}` je v TypeScripte `string`. Vypísať ho do vety je legálne,
 * typecheck ani lint o tom nepovedia nič a test, ktorý sa pýta „vzniklo
 * zistenie?", je pritom zelený. Rozdiel medzi `2026-08-26` a `26. 8. 2026`
 * vidí jedine ten, kto tú vetu prečíta — takže ju musí prečítať test.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Meria sa VÝSTUP, nie zdrojový kód.** Sekcia 2 spustí `analyze()`
 *     naprázdno nad snímkou s known ISO dátumami a číta hotové vety. Grep na
 *     `${c.dateTo}` by sa dal obísť premennou a nepovedal by nič o tom, čo
 *     appka naozaj napíše.
 *  B. **Poistka na poistku: musí niečo vzniknúť.** Keby snímka prestala
 *     spúšťať pravidlá, `analyze()` vráti `[]` a všetky tvrdenia o jeho
 *     výstupe by svietili zeleno nad prázdnym poľom. Preto sa najprv dokazuje,
 *     že vetiev je aspoň sedem a že v nich ten ISO dátum vôbec JE ako vstup.
 *     Presne tak vznikol zelený test o troch mŕtvych selektoroch (19. 8. 2026).
 *  C. **Komentáre sa odstrihnú.** Táto hlavička cituje `2026-08-26` zámerne —
 *     je to história, nie znak, ktorý appka nakreslí. Rovnako `lib/ui/format.ts`
 *     aj `lib/ai/rules.ts` majú ISO tvar v doc-bloku ako dôvod, prečo je
 *     zakázaný. Keby sa komentáre merali, test by strážil vlastné hlavičky.
 *  D. **`YYYY-MM-DD` v KÓDE je v poriadku.** Je to prenosový tvar dátumu:
 *     `DAY_RE`, `addDaysOnly()`, parametre URL, kľúče v `Intl`, testovacie
 *     dáta. Zakázaný je len vo VETE — preto sa reťazcové literály najprv
 *     preosejú na tie, ktoré nesú aspoň dve slovenské slová.
 *  E. **Formátovač je JEDEN.** Keď vedľa `formatDateSk` pribudne druhý tvar
 *     dátumu, sekcia 4 spadne. Toto je jediné tvrdenie tohto súboru, ktoré sa
 *     dá splniť aj tak, že sa dátum prestane kresliť úplne — preto sekcia 4
 *     zároveň žiada, aby jediný formátovač niekto naozaj volal.
 *
 * Vlastník: W2, šprint dokončenia 19. 8. 2026.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { analyze, type RuleSnapshot } from '@/lib/ai/rules';
import { formatDateSk, formatDateTimeSk } from '@/lib/ui/format';

/* ═══════════════════════════ 0. Čo je ISO a čo veta ═══════════════════════ */

/** `2026-08-26` — prenosový tvar dátumu. Na povrchu appky nikdy. */
const ISO_DATUM = /\d{4}-\d{2}-\d{2}/;

/** „pred 3 minútami" a spol. — relatívny čas je na povrchu zakázaný. */
const RELATIVNY_CAS = /\bpred\s+\d/;

/**
 * Vyzerá to na vetu pre používateľa? Aspoň dve slová po sebe, z ktorých jedno
 * má slovenskú diakritiku alebo aspoň štyri písmená. Bez tohto sita by test
 * zakázal `YYYY-MM-DD` aj v `DAY_RE`, v parametroch URL a v testovacích dátach
 * — teda tam, kde je ISO tvar správny (bod D hlavičky).
 */
function jeVeta(text: string): boolean {
  return /[A-Za-zÀ-ž]{4,}\s+[A-Za-zÀ-ž]{2,}/.test(text);
}

/** Odstrihne `/* … *\/` a `// …` — história v hlavičkách nie je povrch (bod C). */
function bezKomentarov(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

interface Zdroj {
  cesta: string;
  telo: string;
}

/** Všetky zdroje pod `src/` — bez komentárov, teda len to, čo appka kreslí. */
function zdroje(): Zdroj[] {
  const koren = fileURLToPath(new URL('../../src', import.meta.url));
  const out: Zdroj[] = [];
  const chod = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) chod(p);
      else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
        out.push({ cesta: p.replace(/\\/g, '/'), telo: readFileSync(p, 'utf8') });
      }
    }
  };
  chod(koren);
  return out;
}

const ZDROJE = zdroje();

/**
 * Reťazcové a šablónové literály zo zdroja, ktoré vyzerajú ako veta.
 *
 * Šablóna sa berie celá vrátane `${…}` — dosadené číslo alebo meno produktu
 * ISO dátum nevyrobí, ale `${c.dateTo}` áno a v šablóne ho treba vidieť.
 */
function vety(telo: string): string[] {
  const povrch = bezKomentarov(telo);
  const out: string[] = [];
  for (const re of [/'((?:[^'\\\n]|\\.)*)'/g, /"((?:[^"\\\n]|\\.)*)"/g, /`((?:[^`\\]|\\.)*)`/g]) {
    for (const m of povrch.matchAll(re)) {
      const text = m[1]!;
      if (jeVeta(text)) out.push(text);
    }
  }
  return out;
}

/* ═════════════ 1. Poistka na poistku: meria sa vôbec niečo? (bod B) ════════ */

describe('o čom tento test tvrdí, to niekto naozaj kreslí', () => {
  it('zdrojov je dosť a vety sa z nich naozaj vytiahnu', () => {
    expect(ZDROJE.length).toBeGreaterThan(100);
    const spolu = ZDROJE.reduce((n, z) => n + vety(z.telo).length, 0);
    expect(spolu, 'sito na vety nenašlo nič — tvrdenia nižšie nemerajú nič').toBeGreaterThan(
      500,
    );
  });

  it('sito na vety pustí vetu a zadrží prenosový tvar (bod D)', () => {
    expect(jeVeta('Zľava končí 26. 8. 2026.')).toBe(true);
    expect(jeVeta('^\\d{4}-\\d{2}-\\d{2}$')).toBe(false);
    expect(jeVeta('2026-08-26')).toBe(false);
  });

  it('komentáre sa strihajú, inak by test strážil vlastné hlavičky (bod C)', () => {
    const format = ZDROJE.find((z) => z.cesta.endsWith('lib/ui/format.ts'));
    expect(format, 'lib/ui/format.ts sa nenašiel').toBeDefined();
    // V hlavičke `format.ts` ISO tvar JE — ako dôvod, prečo je zakázaný.
    expect(ISO_DATUM.test(format!.telo)).toBe(true);
    expect(ISO_DATUM.test(bezKomentarov(format!.telo).replace(/\\d\{[24]\}/g, ''))).toBe(false);
  });
});

/* ═══════════ 2. Analytik: meria sa VÝSTUP, nie zdroj (body A a B) ══════════ */

describe('vety pravidlového analytika nenesú ISO dátum ani „kampaň"', () => {
  const DEN = '2026-08-19';

  /**
   * Snímka, v ktorej je ISO dátum na KAŽDOM vstupe, ktorý sa dostane do vety.
   * Keby niektoré pravidlo prestalo dátum formátovať, vyjde z neho `2026-…`.
   */
  const SNIMKA: RuleSnapshot = {
    today: DEN,
    keyPresent: true,
    keyExpiresAt: '2026-08-21T10:00:00.000Z',
    campaigns: [
      // ending_soon — beží a končí do 7 dní, nič po nej nenadväzuje
      {
        id: 1,
        name: 'Ležiaky',
        status: 'running',
        percent: 10,
        dateFrom: '2026-08-01',
        dateTo: '2026-08-26',
        itemsTotal: 4,
        itemsOk: 4,
        productIds: [11],
      },
      // partial_campaign
      {
        id: 2,
        name: 'Náušnice',
        status: 'partial',
        percent: 15,
        dateFrom: '2026-08-02',
        dateTo: '2026-08-30',
        itemsTotal: 10,
        itemsOk: 6,
        productIds: [12],
      },
      // needs_intervention (needs_key aj missed)
      {
        id: 3,
        name: 'Retiazky',
        status: 'needs_key',
        percent: 20,
        dateFrom: '2026-08-03',
        dateTo: '2026-08-31',
        itemsTotal: 3,
        itemsOk: 0,
        productIds: [13],
      },
      {
        id: 4,
        name: 'Prívesky',
        status: 'missed',
        percent: 25,
        dateFrom: '2026-08-04',
        dateTo: '2026-09-01',
        itemsTotal: 3,
        itemsOk: 0,
        productIds: [14],
      },
      // key_before_start — kľúč vyprší pred štartom naplánovanej zľavy
      {
        id: 5,
        name: 'Prstene',
        status: 'scheduled',
        percent: 30,
        dateFrom: '2026-09-15',
        dateTo: '2026-09-30',
        itemsTotal: 2,
        itemsOk: 0,
        productIds: [15],
      },
    ],
    allowlist: [
      // stale_product — posledné vlastné okno skončilo dávno
      {
        productId: 21,
        name: 'Šperk A',
        label: null,
        hasAttributes: false,
        lastOwnWrite: { percent: 10, from: '2026-01-01', to: '2026-01-31' },
      },
    ],
    variantStock: [
      // low_variant_stock — `fetchedAt` je ISO okamih
      { productId: 31, name: 'Šperk B', quantities: [1, 2], fetchedAt: '2026-08-18T04:00:00.000Z' },
    ],
    sales: {
      // no_units_sold aj sales_declining — obdobie je v ISO
      from: '2026-08-05',
      to: '2026-08-06',
      daysCovered: 2,
      lastSyncedAt: '2026-08-06T23:00:00.000Z',
      products: [
        {
          productId: 41,
          name: 'Šperk C',
          label: null,
          unitsSold: 0,
          unitsPerDay: 0,
          lastSaleDay: null,
          daysSinceLastSale: null,
          recentUnits: null,
          previousUnits: null,
        },
        {
          productId: 42,
          name: 'Šperk D',
          label: null,
          unitsSold: 5,
          unitsPerDay: 2.5,
          lastSaleDay: '2026-08-06',
          daysSinceLastSale: 0,
          recentUnits: 1,
          previousUnits: 4,
        },
      ],
    },
  };

  const ZISTENIA = analyze(SNIMKA);
  const POVRCH = ZISTENIA.flatMap((f) => [f.text, f.action?.label ?? '']);

  it('snímka naozaj spustila pravidlá a dátum sa do vety dostal (bod B)', () => {
    // Bez tohto by všetky tvrdenia nižšie svietili zeleno nad prázdnym poľom.
    expect(ZISTENIA.length).toBeGreaterThan(6);
    const druhy = new Set(ZISTENIA.map((f) => f.kind));
    for (const druh of [
      'ending_soon',
      'stale_product',
      'partial_campaign',
      'needs_intervention',
      'key_before_start',
      'low_variant_stock',
      'no_units_sold',
      'sales_declining',
    ]) {
      expect(druhy.has(druh as never), `pravidlo ${druh} sa nespustilo`).toBe(true);
    }
    // A dôkaz, že dátum vo vetách vôbec JE — inak by test o ISO nemeral nič.
    expect(POVRCH.some((t) => /\d{1,2}\. \d{1,2}\. \d{4}/.test(t))).toBe(true);
  });

  it('ani jedna veta nenesie ISO dátum', () => {
    const vinnici = POVRCH.filter((t) => ISO_DATUM.test(t));
    expect(vinnici, 'ISO dátum sa vrátil na povrch').toEqual([]);
  });

  it('ani jedna veta nenesie relatívny čas', () => {
    expect(POVRCH.filter((t) => RELATIVNY_CAS.test(t))).toEqual([]);
    expect(POVRCH.filter((t) => /\bo \d+ (deň|dni|dní)\b/.test(t))).toEqual([]);
  });

  it('ani jedna veta nehovorí „kampaň" — slovník povrchu má „zľava"', () => {
    const vinnici = POVRCH.filter((t) => /kampa[ňnň]/i.test(t));
    expect(vinnici, 'interný názov entity sa dostal na povrch (P3)').toEqual([]);
  });

  it('veta o končiacej zľave má tvar z kontraktu', () => {
    const f = ZISTENIA.find((x) => x.kind === 'ending_soon');
    expect(f).toBeDefined();
    expect(f!.text).toContain('končí 26. 8. 2026');
    expect(f!.text).toContain('Nenadväzuje žiadna ďalšia zľava');
  });
});

/* ═════════════ 3. Zdroje: žiadna veta v repe nenesie ISO dátum ═════════════ */

describe('žiadny vykresľovaný text v src/ nenesie ISO dátum', () => {
  it('ani jeden reťazec, ktorý vyzerá ako veta, nemá tvar YYYY-MM-DD', () => {
    const vinnici: string[] = [];
    for (const z of ZDROJE) {
      for (const veta of vety(z.telo)) {
        if (ISO_DATUM.test(veta)) vinnici.push(`${z.cesta}: ${veta.slice(0, 120)}`);
      }
    }
    expect(vinnici, 'ISO dátum vo vete pre používateľa').toEqual([]);
  });

  it('ani jedna veta nepíše „pred N" — čas je vždy konkrétny', () => {
    const vinnici: string[] = [];
    for (const z of ZDROJE) {
      // `formatAgoSk` je pomenovaná výnimka: patrí do technického rozkliku
      // a jeho vlastný doc-blok to hovorí (`lib/ui/format.ts`).
      if (z.cesta.endsWith('lib/ui/format.ts')) continue;
      for (const veta of vety(z.telo)) {
        if (RELATIVNY_CAS.test(veta)) vinnici.push(`${z.cesta}: ${veta.slice(0, 120)}`);
      }
    }
    expect(vinnici, 'relatívny čas na povrchu (kontrakt UI bod 10)').toEqual([]);
  });
});

/* ═══════════════ 4. Formátovač dátumu je v UI jeden (bod E) ════════════════ */

describe('dátum má v UI jeden tvar a jeden formátovač', () => {
  it('jediný formátovač dáva tvar z kontraktu UI bod 10', () => {
    expect(formatDateSk('2026-08-14')).toBe('14. 8. 2026');
    expect(formatDateSk('2026-12-31')).toBe('31. 12. 2026');
    expect(formatDateTimeSk('2026-08-14T00:00:00')).toBe('14. 8. 2026 00:00');
  });

  it('neznámy dátum je pomlčka, nikdy nula ani dnešok', () => {
    expect(formatDateSk(null)).toBe('—');
    expect(formatDateSk('')).toBe('—');
    expect(formatDateSk('toto nie je dátum')).toBe('—');
  });

  it('v lib/ui/ nie je druhý formátovač dátumu', () => {
    const ui = ZDROJE.filter((z) => z.cesta.includes('/lib/ui/'));
    expect(ui.length).toBeGreaterThan(1);
    // Vlastnú aritmetiku nad `YYYY-MM-DD` smie robiť jediné miesto: `formatDateSk`
    // v `lib/ui/format.ts`. Každý ďalší `slice()` nad dňom a mesiacom je druhý
    // tvar toho istého dňa — tak vznikli `dayMonthSk` a `formatDayMonthSk`.
    const vinnici = ui
      .filter((z) => !z.cesta.endsWith('lib/ui/format.ts'))
      .filter((z) => /\.slice\(\s*[58]\s*,\s*(?:7|10)\s*\)/.test(bezKomentarov(z.telo)))
      .map((z) => z.cesta);
    expect(vinnici, 'druhý formátovač dátumu vedľa formatDateSk').toEqual([]);
  });

  it('jediný formátovač niekto naozaj volá (inak tvrdenia vyššie nemerajú nič)', () => {
    const volania = ZDROJE.filter(
      (z) => !z.cesta.endsWith('lib/ui/format.ts') && /\bformatDateSk\(/.test(z.telo),
    );
    expect(volania.length).toBeGreaterThan(5);
  });
});
