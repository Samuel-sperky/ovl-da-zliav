/**
 * Aura Zľavy — SLOVNÍK POVRCHU NA PIATICH OBRAZOVKÁCH (šprint 20, B4).
 *
 * `lib/status/blockers.ts` je jediný zdroj pravdy o tom, čo práve blokuje čo —
 * a jeho vety kreslí Prehľad, Produkty, Zľavy, Nová zľava aj Nastavenia. Jedna
 * veta v tomto module je päť viet na obrazovke. Preto sa jej slovník nemeria
 * grepom, ale prečítaním hotovej vety.
 *
 * PREČO NESTAČÍ `test/unit/datumy-povrch.spec.ts`
 * ----------------------------------------------
 * Ten súbor číta reťazcové LITERÁLY v `src/` a výstup `analyze()` z
 * `lib/ai/rules.ts`. Prekážky nepokrýval ani jedným spôsobom — a práve tam bol
 * 20. 8. 2026 nájdený ISO dátum: `writeBudget.day` prišiel zo snímky až za
 * behu, takže v žiadnom literáli nestál. Na povrchu pritom svietilo
 * „Dnešný rozpočet zápisov je vyčerpaný (UTC deň 2026-08-12) — …". Nespadlo
 * nič; `test/unit/status-blockers.spec.ts` ten tvar dokonca ZAMYKAL
 * (`expect(blocker.what).toContain('2026-08-12')`).
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Meria sa VÝSTUP, nie zdroj.** Sekcia 1 postaví maticu snímok a nechá
 *     modul vyrobiť vety. Grep na zdroj by nevidel nič — ISO tvar do vety
 *     vstupuje ako dáta.
 *  B. **Poistka na poistku: musí niečo vzniknúť.** Keby matica prestala
 *     spúšťať vetvy, zoznam by bol prázdny a všetky zákazy nižšie by svietili
 *     zeleno nad ničím. Sekcia 1 preto najprv dokazuje, že vznikla veta ku
 *     KAŽDÉMU `BlockerId` z `BLOCKER_ORDER`.
 *  C. **Zákaz sa páruje s dôkazom prítomnosti.** „Veta nenesie ISO dátum" sa
 *     dá splniť aj tak, že sa dátum prestane písať úplne. Sekcia 2 preto
 *     zároveň žiada, aby tá istá veta deň MENOVALA — v tvare z kontraktu.
 *  D. **Komentáre sa nemerajú vôbec.** Tento súbor nečíta zdrojové súbory,
 *     takže slovo „kampaň" v hlavičke `rules.ts` (kde je ako zákaz) ani ISO
 *     tvar v tejto hlavičke nikoho nezhodia. To je zámer: pasca predošlého
 *     pokusu bola presne opačná — test čítal zdroj vrátane komentárov a
 *     zakazoval spomenúť zakázané slovo aj v dôvode, prečo je zakázané.
 *
 * ČO TENTO SÚBOR ZÁMERNE NEMERIA
 * ------------------------------
 *  - **Plošné P2 (90 znakov).** Vety s `assumed: true` („Nevieme, koľko
 *     zápisov dnes už odišlo…") majú 107 až 170 znakov a ich skrátenie je
 *     samostatná úloha, nie vedľajší účinok slovníka. Sekcia 5 preto meria
 *     len tie vety, ktorých dĺžka je predmetom rozhodnutia — vrátane JEDINEJ
 *     zapísanej výnimky.
 *  - **Relatívny čas v odhade.** `write_budget_low` hovorí „hotovo bude
 *     približne o 3 dni“. Konkrétny deň by musel spočítať `engine/budget.ts`,
 *     ktorý sa sem importovať nesmie (ťahá `@/db/pool`) — viď bod 6 hlavičky
 *     `blockers.ts`. Zakázať to tu bez opravy by znamenalo červený test.
 *
 * Vlastník: B4, šprint 20 (20. 8. 2026).
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BLOCKER_ORDER,
  PILOT_MAX_PRODUCTS,
  collectOperationBlockers,
  collectProductBlockers,
  type Blocker,
  type BlockerId,
  type StatusSnapshot,
} from '@/lib/status/blockers';

/* ═══════════════════════ 0. Matica snímok a hotové vety ═══════════════════ */

const NOW = new Date('2026-08-12T10:00:00.000Z');
const HOUR = 3_600_000;

/** Deň rozpočtu tak, ako príde zo snímky (prenosový tvar), a tak, ako sa píše. */
const DEN_PRENOSOVY = '2026-08-12';
const DEN_SLOVENSKY = '12. 8. 2026';

function healthy(overrides: StatusSnapshot = {}): StatusSnapshot {
  return {
    now: NOW,
    writes: { enabled: true },
    apiKey: { present: true, expiresAt: new Date(NOW.getTime() + 47 * HOUR) },
    writeBudget: { budget: 200, spent: 0, day: DEN_PRENOSOVY },
    scope: { mode: 'pilot', maxProducts: PILOT_MAX_PRODUCTS, failClosed: false },
    selection: { selectedCount: 5 },
    catalog: { loadedProducts: 2900, shopTotalProducts: 41_082, missingProductIds: [] },
    ...overrides,
  };
}

/**
 * Každý riadok je jedna vetva modulu. Cieľ nie je pokryť kombinácie, ale
 * dostať na povrch KAŽDÉ `BlockerId` — to overuje sekcia 1.
 */
const SNIMKY: readonly StatusSnapshot[] = [
  {},
  healthy(),
  healthy({ writes: { enabled: false } }),
  healthy({ writes: {} }),
  healthy({ apiKey: { present: false } }),
  healthy({ apiKey: {} }),
  healthy({ apiKey: { present: true, expiresAt: new Date(NOW.getTime() - HOUR) } }),
  healthy({ apiKey: { present: true, expiresAt: new Date(NOW.getTime() + 3 * HOUR) } }),
  healthy({ writeBudget: { budget: 200, spent: 200, day: DEN_PRENOSOVY } }),
  healthy({ writeBudget: { budget: 200, spent: 160, day: DEN_PRENOSOVY }, selection: { selectedCount: 150 } }),
  healthy({ writeBudget: {} }),
  healthy({ selection: { selectedCount: 150 } }),
  healthy({ selection: {} }),
  healthy({ scope: {} }),
  healthy({
    scope: { mode: 'plny', maxProducts: 500, failClosed: false },
    selection: { selectedCount: 800 },
  }),
  healthy({
    scope: { mode: 'plny', maxProducts: 10_000, failClosed: false },
    selection: { selectedCount: 12_000 },
  }),
  healthy({
    scope: { mode: 'plny', maxProducts: 500, failClosed: false },
    catalog: { loadedProducts: 2900, shopTotalProducts: 41_082, missingProductIds: [7, 8] },
  }),
  healthy({ scope: { mode: 'plny', maxProducts: 500, failClosed: false }, catalog: {} }),
  healthy({ catalogReads: { usedThisMinute: 24, usedThisUtcDay: 240 } }),
  healthy({ catalogReads: {} }),
  // Odmietnuté čítanie objednávok. `salesSync: {}` je zámerne tiež v matici:
  // sekcia bez druhu prekážky NESMIE vyrobiť vetu, inak by appka poslala
  // človeka prestavovať kľúč, ktorý je v poriadku.
  healthy({ salesSync: { block: 'permission', since: new Date(NOW.getTime() - 48 * HOUR) } }),
  healthy({
    salesSync: {
      block: 'ip_ban',
      since: new Date(NOW.getTime() - 48 * HOUR),
      probeAt: new Date(NOW.getTime() + 6 * HOUR),
    },
  }),
  healthy({ salesSync: {} }),
];

/** Všetky rôzne vety, ktoré modul nad maticou vyrobí. */
const VETY: readonly Blocker[] = (() => {
  const seen = new Map<string, Blocker>();
  for (const snimka of SNIMKY) {
    for (const b of collectOperationBlockers(snimka)) seen.set(`${b.id}|${b.what}|${b.nextStep}`, b);
    for (const b of collectProductBlockers(7, snimka)) {
      seen.set(`${b.id}|${b.what}|${b.nextStep}`, b);
    }
  }
  return [...seen.values()];
})();

/** Obe vety prekážky ako jeden reťazec — presne to, čo používateľ prečíta. */
const povrch = (b: Blocker): string => `${b.what} ${b.nextStep}`;

const jedina = (id: BlockerId, filter: (b: Blocker) => boolean = () => true): Blocker => {
  const found = VETY.filter((b) => b.id === id && filter(b));
  if (found.length !== 1) {
    throw new Error(`Očakával som práve jednu vetu ${id}, mám ${found.length}.`);
  }
  return found[0]!;
};

const znakov = (text: string): number => [...text].length;

/* ═══════════════ 1. Poistka na poistku — vety naozaj vznikli ══════════════ */

describe('matica snímok naozaj vyrobila vety (bod B)', () => {
  it('vznikla veta ku každému BlockerId, nie len k pár vetvám', () => {
    const vzniklo = new Set(VETY.map((b) => b.id));
    const chyba = BLOCKER_ORDER.filter((id) => !vzniklo.has(id));
    expect(chyba).toEqual([]);
  });

  it('vetiev je aspoň dvadsať — zákazy nižšie majú čo merať', () => {
    expect(VETY.length).toBeGreaterThanOrEqual(20);
  });

  it('prenosový tvar dátumu do modulu naozaj VSTUPUJE (inak sa nedá pokaziť)', () => {
    // Bez tohto tvrdenia by sekcia 2 bola zelená aj vtedy, keby snímka deň
    // vôbec neniesla — a nemerala by nič.
    expect(SNIMKY.some((s) => s.writeBudget?.day === DEN_PRENOSOVY)).toBe(true);
  });
});

/* ════════════════════ 2. ISO dátum sa na povrch nevráti ═══════════════════ */

const ISO_DATUM = /\d{4}-\d{2}-\d{2}/;

describe('žiadna veta prekážky nenesie ISO dátum', () => {
  it('ani jedna z obidvoch viet nemá tvar YYYY-MM-DD', () => {
    const hriesnici = VETY.filter((b) => ISO_DATUM.test(povrch(b))).map(
      (b) => `${b.id}: ${povrch(b)}`,
    );
    expect(hriesnici).toEqual([]);
  });

  it('deň sa z vety NESTRATIL, len sa píše po slovensky (bod C)', () => {
    const vycerpany = jedina('write_budget_exhausted', (b) => !b.assumed);
    expect(vycerpany.what).toContain(DEN_SLOVENSKY);
    expect(vycerpany.what).not.toContain(DEN_PRENOSOVY);
  });

  it('ten istý deň má rovnaký tvar aj vo vete o zvyšku rozpočtu', () => {
    expect(jedina('write_budget_low', (b) => b.what.includes('150')).what).toContain(
      DEN_SLOVENSKY,
    );
  });
});

/* ═══════════ 3. Slovník: „zľava", nikdy „kampaň", nikdy vnútorný kód ══════ */

describe('vety hovoria jazykom povrchu, nie jazykom kódu', () => {
  it('ani jedna veta nehovorí „kampaň" — slovník appky má „zľava"', () => {
    const hriesnici = VETY.filter((b) => /kampa[ňn]/i.test(povrch(b))).map((b) => b.id);
    expect(hriesnici).toEqual([]);
  });

  it('ani jedna veta nenesie vnútorný kód režimu, závažnosti či riešenia', () => {
    // Slovné hranice: „pilotnom režime" je slovenské slovo a je v poriadku,
    // holé `pilot` / `plny` je hodnota `ScopeMode` a na povrchu nemá čo robiť.
    const kody: ReadonlyArray<readonly [string, RegExp]> = [
      ['pilot', /\bpilot\b/],
      ['plny', /\bplny\b/],
      ['sudo', /\bsudo\b/],
      ['cakanie', /\bcakanie\b/],
      ['mimo_appky', /mimo_appky/],
      ['scope_', /scope_/],
      ['write_budget_', /write_budget_/],
      ['catalog_reads_', /catalog_reads_/],
      ['assumed', /\bassumed\b/],
    ];
    const hriesnici: string[] = [];
    for (const b of VETY) {
      for (const [nazov, kod] of kody) {
        if (kod.test(povrch(b))) hriesnici.push(`${b.id} nesie „${nazov}": ${povrch(b)}`);
      }
    }
    expect(hriesnici).toEqual([]);
  });

  it('ani jedna veta nepíše relatívny čas typu „pred 3 minútami"', () => {
    const hriesnici = VETY.filter((b) => /\bpred\s+\d/.test(povrch(b))).map((b) => b.id);
    expect(hriesnici).toEqual([]);
  });
});

/* ═════════════ 4. Čo povedal zámok, veta druhýkrát nehovorí ═══════════════ */

describe('zámok a veta si neskáču do reči', () => {
  it('pilotný strop sa rieši zámkom — `sudo`, nie vetou o hesle', () => {
    const nad = jedina('scope_pilot_cap', (b) => b.severity === 'blokuje');
    expect(nad.resolution).toBe('sudo');
    // `ui/blocker-look.ts` kreslí vedľa tejto vety ikonu zámku a slovo
    // „rieši sa v appke, vypýta si heslo". Druhýkrát to veta nehovorí.
    expect(nad.nextStep).not.toContain('heslo');
    expect(nad.nextStep).toBe('Zúžte výber na 10 produktov, alebo prepnite rozsah v Nastaveniach.');
  });

  it('žiadna veta so zámkom heslo neopakuje', () => {
    const hriesnici = VETY.filter((b) => b.resolution === 'sudo' && /heslo/i.test(povrch(b))).map(
      (b) => b.id,
    );
    expect(hriesnici).toEqual([]);
  });

  it('vypnuté zápisy sú mimo appky a veta ukazuje na správcu, nie na obrazovku', () => {
    const veta = jedina('writes_disabled', (b) => !b.assumed);
    expect(veta.resolution).toBe('mimo_appky');
    expect(veta.nextStep).toBe('Zapnúť ich môže len správca počítača v konfigurácii appky.');
  });
});

/* ═════════ 5. Dĺžka tam, kde je predmetom rozhodnutia (P2 + výnimka) ══════ */

const P2_LIMIT = 90;

describe('P2 na vetách, o ktorých šprint 20 rozhodol', () => {
  it('bez výberu sa o výbere nehovorí a veta sa zmestí do 90 znakov', () => {
    // Na Prehľade výber neexistuje. Veta preto nesie len samotný strop — a je
    // to TÁ ISTÁ veta ako pri výbere pod stropom, preto ju `VETY` majú raz.
    const bezVyberu = jedina('scope_pilot_cap', (b) => b.severity === 'informuje');
    expect(bezVyberu.what).toBe('Na jednu zľavu prejde najviac 10 produktov.');
    expect(bezVyberu.what).not.toContain('výbere');
    expect(bezVyberu.nextStep).not.toContain('výbere');
    expect(znakov(bezVyberu.what)).toBeLessThanOrEqual(P2_LIMIT);
    expect(znakov(bezVyberu.nextStep)).toBeLessThanOrEqual(P2_LIMIT);
  });

  it('rada pri prekročenom pilotnom strope sa zmestí do 90 znakov', () => {
    const nad = jedina('scope_pilot_cap', (b) => b.severity === 'blokuje');
    expect(znakov(nad.nextStep)).toBeLessThanOrEqual(P2_LIMIT);
  });

  it('rada pri vypnutých zápisoch sa zmestí do 90 znakov', () => {
    expect(znakov(jedina('writes_disabled', (b) => !b.assumed).nextStep)).toBeLessThanOrEqual(
      P2_LIMIT,
    );
  });
});

describe('jediná zapísaná výnimka z P2 drží svoju cenu', () => {
  const veta = () => jedina('writes_disabled', (b) => !b.assumed).what;

  it('veta o vypnutých zápisoch má 96 znakov — 6 nad limitom, ani o znak viac', () => {
    // Cena výnimky zapísanej v `design/v3/ARCHITEKTURA.md`: platí pre TÚTO
    // jednu vetu a pri 96 znakoch. Keby narástla, výnimka padá a veta ide pod
    // rozklik — tento test je to, čo ju k pádu prinúti.
    expect(znakov(veta())).toBe(96);
    expect(znakov(veta())).toBeGreaterThan(P2_LIMIT);
  });

  it('skracovať sa dá jedine odtrhnutím dôvodu, prečo veta existuje', () => {
    // Bez tejto časti používateľ prečíta „nezapíše ani jeden produkt" ako
    // dôsledok svojho VÝBERU, zúži ho a stlačí Zaradiť znova.
    expect(veta().endsWith('nech je vo výbere čokoľvek.')).toBe(true);
  });

  it('výnimka je naozaj zapísaná v ARCHITEKTURA.md aj s cenou', () => {
    const doc = readFileSync(
      new URL('../../design/v3/ARCHITEKTURA.md', import.meta.url),
      'utf8',
    );
    const riadok = doc
      .split('\n')
      .find((r) => r.includes('writes_disabled') && r.includes('**P2**'));
    expect(riadok, 'v ARCHITEKTURA.md chýba riadok o výnimke P2 pre writes_disabled').toBeTruthy();
    expect(riadok).toContain('96');
    expect(riadok).toContain('nech je vo výbere čokoľvek');
  });

  it('druhá veta si to isté ohnutie nevypýtala — výnimka je stále JEDNA', () => {
    // Cena výnimky hovorí aj toto: keby ju chcela druhá veta, výnimka padá.
    // Vety s `assumed: true` sa nerátajú — tie sú samostatná, otvorená úloha
    // (viď „ČO TENTO SÚBOR ZÁMERNE NEMERIA").
    const dlhe = VETY.filter(
      (b) => !b.assumed && b.id === 'writes_disabled' && znakov(b.what) > P2_LIMIT,
    );
    expect(dlhe.map((b) => b.id)).toEqual(['writes_disabled']);
  });
});
