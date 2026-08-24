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
 * ČO SA 24. 8. 2026 ZAVRELO (a čo tu preto pribudlo)
 * --------------------------------------------------
 * Dve veci, ktoré tento súbor pôvodne zámerne NEMERAL, sú vyriešené — a preto
 * ich teraz meria. Zákaz bez opravy by bol červený test; zákaz PO oprave je to,
 * čo opravu drží:
 *
 *  - **Fail-closed vety a P2 (90 znakov).** Vety s `assumed: true` mali 91 až
 *     166 znakov. Skrátili sa vypustením domnienky („kým to nevieme, appka
 *     počíta s tým, že…"), nie dôsledku — že veta stojí na domnienke, kreslí
 *     UI z `assumed` samo. Sekcia 6 to teraz meria PLOŠNE nad celou triedou,
 *     nie po jednej vete: nová fail-closed vetva sa tým nedá pridať dlhá.
 *  - **Relatívny čas v odhade fronty.** `write_budget_low` hovoril „hotovo
 *     bude približne o 3 dni". Deň sa počíta čistou funkciou `finishDay()`
 *     v `blockers.ts` (`engine/budget.ts` sa sem importovať nesmie — ťahá
 *     `@/db/pool`), zhodu s `estimateFinish().date` stráži
 *     `test/unit/status-blockers.spec.ts`. Sekcia 7 zakazuje návrat.
 *  - **Jediná zapísaná výnimka z P2 (`writes_disabled`, 96 znakov).** Stála na
 *     predpoklade, že sa veta „skracuje jedine odtrhnutím poslednej časti" —
 *     teda toho, PREČO existuje. Predpoklad padol na vlastnom fail-closed
 *     dvojčati: to povie ten istý dôvod tvarom „bez ohľadu na výber" v 87
 *     znakoch, meraná veta v 69. Sekcia 5 preto už nezamyká 96 znakov ani
 *     koncovku, ale dĺžku pod P2 a prítomnosť dôvodu.
 *  - **P2 nad MERANÝMI vetami — a tým plošne nad všetkými.** Do 24. 8. 2026
 *     tu stálo, že vety bez domnienky sú mimo meranej triedy, a šesť z nich
 *     bolo nad limitom (`key_expires_soon` 148, `write_budget_exhausted` 118,
 *     `write_budget_low` 118, `scope_full_cap` 107, `catalog_reads_minute_`
 *     `exhausted` 99, `scope_pilot_cap` 98). Skrátili sa tým istým postupom
 *     ako fail-closed vety — vypustením MECHANIKY, nie dôsledku a nie čísel
 *     (bod 7 hlavičky `blockers.ts`): „pri 200 zápisoch na deň", „ktoré shop
 *     pustí za jeden UTC deň", „ktoré si appka dovolí", druhé „produktov"
 *     a prívlastok „zvyšných". Sekcia 8 to preto meria PLOŠNE nad CELÝM
 *     zoznamom viet — už nie nad podtriedou. Sekcia 6 zostáva, ako bola:
 *     domnienky majú vlastné tvrdenia o tom, čo sa v nich skrátiť NESMIE,
 *     a plošný zákaz nad všetkým ich neruší, len ich obklopuje. Cena je
 *     zapísaná v tom, že P2 už nemá v `design/v3/ARCHITEKTURA.md` ani jeden
 *     ŽIVÝ riadok ohnutia — a sekcia 8 to drží tvrdením, nie dôverou.
 *
 * ČO TENTO SÚBOR STÁLE ZÁMERNE NEMERIA
 * ------------------------------------
 *  - **Vety, ktoré modul nevyrobí.** Meria sa výstup, takže vetva, ktorú
 *     matica nespustí, tu neexistuje. Proti tomu stojí sekcia 1 (veta ku
 *     každému `BlockerId`) a menné poistky v sekciách 6 a 8 — nie grep.
 *  - **Relatívny čas v odhade KATALÓGU.** `catalog_incomplete` hovorí
 *     „približne za 2 dni". Dátum tam k dispozícii je (`clearsAt`), ale
 *     prepnutie by prepísalo tvrdenia, ktoré držia „jeden odhad, nie dva".
 *
 * Vlastník: B4, šprint 20 (20. 8. 2026); rozšírené 24. 8. 2026.
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
  // Vložený kľúč s NEZNÁMOU platnosťou. Matica túto vetvu nepokrývala, takže
  // jej fail-closed veta (91 znakov) sa v žiadnom meraní neobjavila — a sekcia
  // 6 by o nej mlčala. Fail-closed vetva, ktorú nikto nevykreslí, je slepé
  // miesto presne toho druhu, aký tento súbor vznikol odstrániť.
  healthy({ apiKey: { present: true } }),
  healthy({ apiKey: { present: true, expiresAt: new Date(NOW.getTime() - HOUR) } }),
  healthy({ apiKey: { present: true, expiresAt: new Date(NOW.getTime() + 3 * HOUR) } }),
  healthy({ writeBudget: { budget: 200, spent: 200, day: DEN_PRENOSOVY } }),
  healthy({ writeBudget: { budget: 200, spent: 160, day: DEN_PRENOSOVY }, selection: { selectedCount: 150 } }),
  healthy({ writeBudget: {} }),
  // Najširšie čísla, aké modul vie vyrobiť: fail-closed rozpočet 1 zápis na
  // deň nad 12 000 produktmi dáva „11 999 dní" v `key_expires_soon` a rok 2059
  // v odhade fronty. Bez tohto riadku by plošné P2 v sekcii 8 merilo len
  // pekné čísla — a prvá ostrá inštalácia s vypnutým auditom by ho prekročila.
  healthy({
    writeBudget: { budget: 1, spent: 0, day: DEN_PRENOSOVY },
    scope: { mode: 'plny', maxProducts: 10_000, failClosed: false },
    selection: { selectedCount: 12_000 },
  }),
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

  it('veta o nedočítaných nastaveniach už nehovorí ani „režim", ani „pilot"', () => {
    // `ScopeMode` je vnútorný kód (P3). Z informatívnej vety o strope ho
    // odstránila vlna 2, v tejto vete prežil do 24. 8. 2026. Strop sám je
    // zrozumiteľný bez pomenovania režimu.
    const veta = jedina('scope_unknown');
    expect(povrch(veta)).not.toMatch(/reži?m/i);
    expect(povrch(veta)).not.toMatch(/pilot/i);
    // A dôvod, prečo veta existuje, sa skrátením nestratil: platí najprísnejší
    // strop a je konkrétny.
    expect(veta.what).toContain('nepodarilo prečítať');
    expect(veta.what).toContain(`${PILOT_MAX_PRODUCTS} produktov`);
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

/* ═════════ 5. Dĺžka tam, kde je predmetom rozhodnutia (P2, bez výnimky) ═══ */

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

describe('veta o vypnutých zápisoch drží P2 bez výnimky', () => {
  // Do 24. 8. 2026 tu stálo `toBe(96)` a k tomu výnimka z P2 zapísaná
  // 20. 8. 2026. Tá stála na predpoklade, že sa veta „skracuje jedine
  // odtrhnutím poslednej časti" — teda toho, PREČO veta existuje. Predpoklad
  // padol: fail-closed dvojča tej istej prekážky povie ten istý dôvod tvarom
  // „bez ohľadu na výber" v 87 znakoch, a meraná veta v 69. Výnimka je preto
  // zrušená a testy nižšie zamykajú OBE veci naraz — dĺžku aj dôvod.
  const veta = () => jedina('writes_disabled', (b) => !b.assumed).what;

  it('veta sa zmestí do 90 znakov', () => {
    expect(znakov(veta())).toBeLessThanOrEqual(P2_LIMIT);
  });

  it('dôvod, prečo veta existuje, sa skrátením nestratil', () => {
    // Bez tejto časti prečíta používateľ „nezapíše nič" ako dôsledok svojho
    // VÝBERU, zúži ho a stlačí Zaradiť znova. Vypnuté zápisy pritom nie sú
    // vlastnosť výberu, ale konfigurácie počítača (I13).
    expect(veta()).toContain('bez ohľadu na výber');
    // A zároveň naďalej menuje samotný fakt, nie len jeho dôsledok.
    expect(veta()).toContain('Zápisy do shopu sú vypnuté');
  });

  it('ani jedna vetva prekážky nie je nad limitom — výnimka nemá čo kryť', () => {
    // Zákaz sa páruje s dôkazom prítomnosti (bod C v hlavičke): keby sa vetvy
    // prestali kresliť, zoznam by bol prázdny a limit by svietil nad ničím.
    const vetvy = VETY.filter((b) => b.id === 'writes_disabled');
    expect(vetvy.length).toBeGreaterThanOrEqual(2);
    const dlhe = vetvy.filter((b) => znakov(b.what) > P2_LIMIT).map((b) => b.what);
    expect(dlhe).toEqual([]);
  });

  it('výnimka v ARCHITEKTURA.md je preškrtnutá, nie živá', () => {
    // Riadok tam zostáva ako záznam. Keby sa vrátil ako povolenie, tento test
    // to zachytí skôr, než sa oň niekto oprie.
    const doc = readFileSync(
      new URL('../../design/v3/ARCHITEKTURA.md', import.meta.url),
      'utf8',
    );
    const riadok = doc
      .split('\n')
      .find((r) => r.includes('writes_disabled') && r.includes('**P2**'));
    expect(riadok, 'v ARCHITEKTURA.md chýba záznam o P2 pre writes_disabled').toBeTruthy();
    expect(riadok).toContain('ZRUŠENÁ');
    expect(riadok).toContain('~~**P2**~~');
  });
});


/* ══════ 6. Fail-closed veta sa zmestí do P2 — PLOŠNE, nie po jednej ═══════ */

describe('vety, ktoré stoja na domnienke, sa zmestia do 90 znakov', () => {
  const domnienky = (): readonly Blocker[] => VETY.filter((b) => b.assumed);

  it('domnienok je aspoň päť — plošný zákaz nižšie má čo merať (bod B)', () => {
    // Bez tejto poistky by stačilo prestať vyrábať fail-closed vetvy a plošný
    // zákaz by svietil zeleno nad prázdnym zoznamom.
    expect(domnienky().length).toBeGreaterThanOrEqual(5);
  });

  it('každá fail-closed vetva vznikla aspoň raz — sedem rôznych prekážok', () => {
    // Menovite, aby sa nedalo „splniť" limit tým, že sa vetva prestane kresliť.
    const ids = new Set(domnienky().map((b) => b.id));
    for (const id of [
      'writes_disabled',
      'key_missing',
      'key_expired',
      'write_budget_exhausted',
      'scope_unknown',
      'catalog_unknown',
      'catalog_reads_day_exhausted',
      'catalog_reads_minute_exhausted',
    ] as const) {
      expect(ids.has(id), `fail-closed vetva ${id} sa nevykreslila`).toBe(true);
    }
  });

  it('ani jedna z obidvoch viet nepresahuje 90 znakov', () => {
    // TOTO je to tvrdenie, ktoré 24. 8. 2026 zavrelo. Je plošné zámerne: nová
    // fail-closed vetva sa tým nedá pridať dlhá, a stará sa nedá predĺžiť.
    const hriesnici = domnienky().flatMap((b) => [
      ...(znakov(b.what) > P2_LIMIT ? [`${b.id} what=${znakov(b.what)}: ${b.what}`] : []),
      ...(znakov(b.nextStep) > P2_LIMIT
        ? [`${b.id} nextStep=${znakov(b.nextStep)}: ${b.nextStep}`]
        : []),
    ]);
    expect(hriesnici).toEqual([]);
  });

  it('skrátenie zobralo domnienku, NIE dôsledok (bod C)', () => {
    // Zákaz dĺžky sa dá splniť aj odtrhnutím toho, čo veta hlási. Každá
    // fail-closed veta preto musí povedať OBE veci: že sa nevie, a čo z toho
    // plynie. Bez druhej polovice je to hlásenie o sebe samej.
    for (const b of domnienky()) {
      const cely = povrch(b);
      expect(/nevie|nedá sa overiť|nepodarilo/i.test(cely), `${b.id} nepriznáva neistotu`).toBe(
        true,
      );
      expect(cely.length, `${b.id} nemá čo hlásiť`).toBeGreaterThan(30);
    }
  });

  it('vypnuté zápisy si aj po skrátení držia dôvod, prečo veta existuje', () => {
    // Fail-closed dvojča vety, ktorá má zapísanú výnimku z P2. Tá výnimka stojí
    // na tom, že veta MUSÍ povedať „nie je to o tvojom výbere" — inak
    // používateľ zúži výber a stlačí Zaradiť znova. Skrátená veta to hovorí
    // v 88 znakoch a výnimku si preto nevypýtala.
    const veta = jedina('writes_disabled', (b) => b.assumed);
    expect(veta.what).toContain('bez ohľadu na výber');
    expect(znakov(veta.what)).toBeLessThanOrEqual(P2_LIMIT);
  });

  it('blokujúca fail-closed veta o rozpočte stále nesie číslo', () => {
    // Bod 1 hlavičky `blockers.ts`: veta, ktorá blokuje, nesmie byť „limit
    // prekročený". V tejto vetve je jediné pravdivé číslo fail-closed strop —
    // keby vypadlo pri skracovaní, veta je zase len log.
    const veta = jedina('write_budget_exhausted', (b) => b.assumed);
    expect(veta.what).toMatch(/\d/);
    expect(veta.what).toContain('zápis na deň');
  });
});

/* ═══════ 7. Odhad dobehnutia fronty menuje DEŇ, nie „o toľko dní" ═════════ */

describe('fronta hovorí konkrétny deň, nie relatívny čas', () => {
  const odhad = () => jedina('write_budget_low', (b) => b.what.includes('150'));

  it('ďalší krok menuje dátum v tvare, v akom appka dátumy píše', () => {
    // Appka inde (dlaždice fronty, `estimate.date`) hovorí konkrétny deň. Dve
    // odpovede na tú istú otázku vedľa seba na tej istej obrazovke boli dôvod,
    // prečo sa to 24. 8. 2026 zjednotilo.
    expect(odhad().nextStep).toMatch(/\d{1,2}\. \d{1,2}\. \d{4}/);
  });

  it('relatívny čas sa do odhadu fronty nevráti', () => {
    // Bez koncového `\b`: JS `\b` je ASCII, takže po „deň"/„dní" hranicu slova
    // NEVIDÍ a zákaz by nikdy nič nenašiel. Overené mutáciou — po vrátení
    // relatívneho času musí tento test spadnúť.
    expect(odhad().nextStep).not.toMatch(/\bo \d+ (deň|dni|dní)/);
  });

  it('a odhad zostal označený ako odhad (P7), nie vydaný za meraný fakt', () => {
    // Dátum bez „približne" je sľub. Appka ho nedáva — nepočíta so zlyhaniami
    // ani s vypnutým počítačom.
    expect(odhad().nextStep).toContain('približne');
  });
});

/* ══════ 8. P2 platí na KAŽDÚ vetu prekážky, nie len na domnienku ══════════ */

describe('P2 nad celým zoznamom viet — už bez triedy, ktorá je vyňatá', () => {
  const merane = (): readonly Blocker[] => VETY.filter((b) => !b.assumed);

  it('meraných viet je aspoň desať — plošný zákaz nižšie má čo merať (bod B)', () => {
    // Sekcia 6 má tú istú poistku nad domnienkami. Tu ide o druhú polovicu
    // zoznamu: keby prestali vznikať MERANÉ vety, plošný zákaz by svietil
    // zeleno nad samými domnienkami a o skrátenie z 24. 8. 2026 by nešlo.
    expect(merane().length).toBeGreaterThanOrEqual(10);
  });

  it('každá skrátená prekážka vznikla aspoň raz — menovite, nie počtom', () => {
    // Šesť prekážok, ktorých MERANÁ veta bola 24. 8. 2026 nad limitom. Keby
    // sa niektorá prestala kresliť, limit by nad ňou mlčal.
    const ids = new Set(merane().map((b) => b.id));
    for (const id of [
      'key_expires_soon',
      'write_budget_exhausted',
      'write_budget_low',
      'scope_pilot_cap',
      'scope_full_cap',
      'catalog_reads_minute_exhausted',
    ] as const) {
      expect(ids.has(id), `meraná vetva ${id} sa nevykreslila`).toBe(true);
    }
  });

  it('ani jedna veta prekážky nepresahuje 90 znakov — what ani nextStep', () => {
    // TOTO je tvrdenie, ktoré 24. 8. 2026 zavrelo poslednú výnimku. Je plošné
    // nad CELÝM zoznamom: nová vetva sa nedá pridať dlhá a stará sa nedá
    // predĺžiť ani vtedy, keď na domnienke nestojí.
    const hriesnici = VETY.flatMap((b) => [
      ...(znakov(b.what) > P2_LIMIT ? [`${b.id} what=${znakov(b.what)}: ${b.what}`] : []),
      ...(znakov(b.nextStep) > P2_LIMIT
        ? [`${b.id} nextStep=${znakov(b.nextStep)}: ${b.nextStep}`]
        : []),
    ]);
    expect(hriesnici).toEqual([]);
  });

  it('P2 už nemá v zápisníku ohnutí ani jeden ŽIVÝ riadok', () => {
    // Cena plošného limitu: kým existovala výnimka, „všetky vety do 90" bola
    // lož s hviezdičkou. Riadok o `writes_disabled` je preškrtnutý (sekcia 5);
    // toto je to isté povedané plošne — akékoľvek NOVÉ ohnutie P2 tu spadne
    // skôr, než sa oň niekto oprie.
    const doc = readFileSync(new URL('../../design/v3/ARCHITEKTURA.md', import.meta.url), 'utf8');
    const zive = doc
      .split('\n')
      .filter((r) => r.startsWith('|') && r.includes('**P2**') && !r.includes('~~**P2**~~'));
    expect(zive, 'v zápisníku ohnutí je živý riadok pre P2').toEqual([]);
  });

  it('skrátenie nezobralo čísla: blokujúca veta o strope nesie strop, výber aj zvyšok', () => {
    // Bod 1 hlavičky `blockers.ts` žiada od BLOKUJÚCEJ vety OBE čísla a uvádza
    // presne tento tvar ako vzor. Skrátenie zobralo jednotku pri druhom čísle
    // a prívlastok „zvyšných", nie čísla samotné.
    const nad = jedina('scope_pilot_cap', (b) => b.severity === 'blokuje');
    expect(nad.what).toBe('Na jednu zľavu prejde najviac 10 produktov, vo výbere je 150 — 140 sa nezapíše.');
  });

  it('veta o čítaniach katalógu drží NÁŠ strop aj strop shopu vedľa seba', () => {
    // `engine/budget.ts` to žiada oboma smermi: kto vidí len jedno číslo,
    // prestane rozumieť tomu, ktoré z nich môže zmeniť sám. Skrátenie zobralo
    // „ktoré si appka dovolí", nie druhé číslo.
    const veta = jedina('catalog_reads_minute_exhausted', (b) => !b.assumed);
    expect(veta.what).toContain('24 z 24');
    expect(veta.what).toContain('shop pustí 30');
  });

  it('vyčerpaný rozpočet zápisov drží minuté aj strop, nie „limit prekročený"', () => {
    const veta = jedina('write_budget_exhausted', (b) => !b.assumed);
    expect(veta.what).toContain('200 z 200');
    // A deň zostal — v tvare, v akom appka dátumy píše (sekcia 2).
    expect(veta.what).toContain(DEN_SLOVENSKY);
  });

  it('veta o zvyšku rozpočtu drží všetky tri čísla, aj keď je najkratšia', () => {
    // Koľko sa dnes zmestí, koľko je vo výbere, koľko počká. Bez tretieho
    // čísla si používateľ musí odčítať sám — a to je presne to, čo z vety
    // robí zase len log.
    const veta = jedina('write_budget_low', (b) => b.what.includes('150'));
    expect(veta.what).toContain('150 produktov');
    expect(veta.what).toContain('40');
    expect(veta.what).toContain('110');
  });

  it('odhad, že fronta prežije kľúč, drží hodiny kľúča aj dni fronty', () => {
    // Dve čísla, ktoré sa navzájom porovnávajú — na nich celá veta stojí.
    // Vypadol počet čakajúcich produktov a rýchlosť zápisu: fronta stojí
    // v hlavičke každej stránky a dni sa z rýchlosti počítajú.
    const vety = VETY.filter((b) => b.id === 'key_expires_soon' && b.severity === 'obmedzuje');
    expect(vety.length).toBeGreaterThanOrEqual(1);
    for (const b of vety) {
      expect(b.what, `${b.id} nemá hodiny kľúča`).toMatch(/\d+ (hodinu|hodiny|hodín)/);
      expect(b.what, `${b.id} nemá dni fronty`).toMatch(/\d[\d\s\u00a0]* (deň|dni|dní)/);
      expect(b.what, `${b.id} nehovorí dôsledok`).toContain('zastaví');
    }
  });

  it('dôsledok prežil skrátenie v každej vete, ktorá niečo zastavuje', () => {
    // Zákaz dĺžky sa dá splniť aj odtrhnutím toho, čo veta hlási — sekcia 6
    // to drží nad domnienkami, toto nad zvyškom. Veta, ktorá blokuje alebo
    // obmedzuje, musí povedať, ČO z toho plynie, nie len ČO sa stalo.
    for (const b of merane().filter((x) => x.severity !== 'informuje')) {
      expect(znakov(povrch(b)), `${b.id} nemá čo hlásiť`).toBeGreaterThan(40);
      expect(
        // Slovník dôsledkov je zoznam zámerne: nová preháška musí povedať buď
        // ČO appka neurobí, alebo NA ČO sa čaká (`resolution: 'cakanie'` — tam
        // to nesie ďalší krok, „rozpočet sa obnoví o polnoci UTC"). Kto prišije
        // vetu bez jedného aj druhého, doplňa slovo TU — a tým sa nad tým zastaví.
        /nezap|nečíta|nepoužije|nepočíta|nedop|počká|zastaví|nevidí|nedá|pokračuje|obnoví|vyprš/i.test(
          povrch(b),
        ),
        `${b.id} nepovie dôsledok`,
      ).toBe(true);
    }
  });
});
