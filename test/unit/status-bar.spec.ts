/**
 * Aura Zľavy — testy STÁLEHO STAVOVÉHO PRUHU (L1, C1–C3).
 *
 * Pruh pod hlavičkou je jediné miesto, kde používateľ z každej obrazovky vidí,
 * či to ide. Tento súbor stráži tri tvrdenia, na ktorých stojí:
 *
 *  1. **Farba sa volí podľa `resolution`, nie podľa `severity`.** Vyčerpaný
 *     denný rozpočet má závažnosť `blokuje`, ale rieši sa čakaním — pruh preto
 *     musí zostať neutrálny a tab Zľavy sa NESMIE zamknúť. Keby sa farbilo
 *     podľa závažnosti, appka by pri úplne zdravom behu svietila na poplach.
 *  2. **Zámok bez dôvodu neexistuje.** Každý zámok navigácie nesie krátky dôvod
 *     aj celú vetu s ďalším krokom — a odkaz zostáva živý.
 *  3. **Neznáme sa nedopĺňa.** Chýbajúca sekcia payloadu skončí ako POMLČKA
 *     s príznakom `unknown` (kontrakt UI, bod 5), nikdy ako nula alebo pokojný
 *     stav. Nula je tvrdenie, pomlčka je priznaná medzera.
 *  4. **Dátum a čas sú konkrétne.** Kontrakt UI, bod 10: „platí do 14.08.2026",
 *     nie „ešte 48 h"; „Stav k 12:53", nie „pred 3 minútami". Odpočet sa pri
 *     fronte bežiacej týždne nedá s ničím porovnať.
 *
 * Testujú sa výhradne ČISTÉ funkcie z `components/layout/status.ts`; pruh sám
 * je len značkovanie nad nimi.
 */
import { describe, expect, it } from 'vitest';

import {
  budgetChip,
  budgetResetPhrase,
  budgetView,
  catalogChip,
  connectionChip,
  hasBlockers,
  keyChip,
  navLocks,
  resolutionTone,
  statusFreshness,
  writesChip,
  type StatusState,
} from '@/components/layout/status';
import type { BlockerWire, StatusPayload } from '@/lib/status/snapshot';

/* ═════════════════════════════ Vzorky stavu ═══════════════════════════════ */

const NOW = '2026-08-12T10:00:00.000Z';

/** Zdravý stav: kľúč platí, zápisy bežia, katalóg sa dopĺňa. */
function payload(overrides: Partial<StatusPayload> = {}): StatusPayload {
  return {
    now: NOW,
    writes: { enabled: true, locked: false, lockedReason: null, lockedAt: null },
    apiKey: { present: true, expiresAt: '2026-08-14T10:00:00.000Z' },
    writeBudget: { day: '2026-08-12', budget: 200, spent: 12, remaining: 188, exhausted: false },
    scope: { mode: 'pilot', maxProductsSetting: 10, maxProducts: 10, failClosed: false },
    catalog: {
      loadedProducts: 2900,
      shopTotalProducts: 41_082,
      lastFetchedAt: '2026-08-12T09:40:00.000Z',
    },
    catalogReads: null,
    blockers: [],
    summary: {
      blocked: false,
      blockingCount: 0,
      worstBlockerId: null,
      waitUntil: null,
      anyAssumed: false,
    },
    unreadable: [],
    ...overrides,
  };
}

function blocker(overrides: Partial<BlockerWire> = {}): BlockerWire {
  return {
    id: 'key_missing',
    area: 'kluc',
    severity: 'blokuje',
    subject: 'operacia',
    productIds: [],
    what: 'Kľúč na zápis do shopu nie je vložený.',
    nextStep: 'Vložte kľúč v Nastaveniach.',
    path: '/nastavenia',
    resolution: 'sam',
    passableNow: true,
    clearsAt: null,
    assumed: false,
    ...overrides,
  };
}

const ok = (data: StatusPayload): StatusState => ({ kind: 'ok', payload: data });

/** Vyčerpaný denný rozpočet tak, ako ho posiela server: blokuje, ale sa čaká. */
const BUDGET_EXHAUSTED = blocker({
  id: 'write_budget_exhausted',
  area: 'rozpocet',
  severity: 'blokuje',
  what: 'Dnešný rozpočet zápisov je vyčerpaný — minutých je 200 z 200.',
  nextStep: 'Netreba robiť nič — pokračuje to samo.',
  path: null,
  resolution: 'cakanie',
  passableNow: false,
  clearsAt: '2026-08-13T00:00:00.000Z',
});

/* ═════════════ 1. Farba podľa spôsobu riešenia, nie podľa závažnosti ══════ */

describe('resolutionTone — čakanie nie je poplach', () => {
  it('čakanie a veci mimo appky sú neutrálne', () => {
    expect(resolutionTone('cakanie')).toBe('idle');
    expect(resolutionTone('mimo_appky')).toBe('idle');
  });

  it('to, s čím používateľ TERAZ môže niečo urobiť, je jantárové', () => {
    expect(resolutionTone('sam')).toBe('attention');
    expect(resolutionTone('sudo')).toBe('attention');
  });

  it('z prekážky nikdy nevznikne červená — tá je pre zastavený zápis', () => {
    const tones = (['sam', 'sudo', 'cakanie', 'mimo_appky'] as const).map(resolutionTone);
    expect(tones).not.toContain('critical');
  });
});

describe('vyčerpaný rozpočet je informácia, nie chyba (K2)', () => {
  const state = ok(payload({ blockers: [BUDGET_EXHAUSTED] }));

  it('merací prúžok ukáže čísla a čas obnovy, nie poplach', () => {
    const view = budgetView(state.payload);
    if (view.kind !== 'meter') throw new Error('rozpočet má čísla, má sa kresliť prúžkom');
    expect(view.spent).toBe(12);
    expect(view.limit).toBe(200);
    expect(view.resetsAt).not.toBeNull();
    // Fráza je hotová aj s predložkou, `BudgetMeter` ju len prilepí za text.
    expect(view.resetsAt?.startsWith('o ')).toBe(true);
    expect(view.title).toContain('rozpočet');
  });

  it('čas obnovy sa NEPOČÍTA v prehliadači — berie sa z prekážky', () => {
    expect(budgetResetPhrase(payload())).toBeNull();
    expect(budgetResetPhrase(payload({ blockers: [BUDGET_EXHAUSTED] }))).not.toBeNull();
  });

  it('tab Zľavy sa kvôli rozpočtu NEZAMYKÁ — zľava sa založí a dopíše zajtra', () => {
    expect(navLocks(state)).toEqual([]);
  });
});

/* ════════════════════════ 2. Spojenie so shopom ═══════════════════════════ */

describe('connectionChip — appka netvrdí, čo nezmerala', () => {
  it('kým sa stav načítava, nič sa netvrdí', () => {
    const chip = connectionChip({ kind: 'loading', payload: null });
    expect(chip.tone).toBe('idle');
    expect(chip.label.length).toBeGreaterThan(0);
  });

  it('neprihlásený NIE JE porucha appky', () => {
    const chip = connectionChip({ kind: 'unauthenticated', payload: null });
    expect(chip.tone).toBe('idle');
    expect(chip.title.toLowerCase()).toContain('porucha');
    expect(chip.label.toLowerCase()).not.toContain('nedostup');
  });

  it('appka bez odpovede je jediné červené spojenie', () => {
    expect(connectionChip({ kind: 'unreachable', payload: null }).tone).toBe('critical');
  });

  it('čerstvé čítanie katalógu je dôkaz, že shop odpovedá', () => {
    const chip = connectionChip(ok(payload()));
    expect(chip.tone).toBe('good');
    expect(chip.title).toContain('12.08.2026');
  });

  it('staré čítanie sa neháda na „pripojené“ — prizná, že sa shop dlho neozval', () => {
    const state = ok(
      payload({
        catalog: {
          loadedProducts: 2900,
          shopTotalProducts: 41_082,
          lastFetchedAt: '2026-08-01T09:40:00.000Z',
        },
      }),
    );
    expect(connectionChip(state).tone).toBe('idle');
  });

  it('bez jediného čítania sa o spojení netvrdí nič', () => {
    const state = ok(
      payload({
        catalog: { loadedProducts: 0, shopTotalProducts: null, lastFetchedAt: null },
      }),
    );
    expect(connectionChip(state).tone).toBe('idle');
  });
});

/* ═══════════════════════════ 3. Kľúč a zápisy ═════════════════════════════ */

describe('keyChip — dokedy kľúč platí, konkrétnym dátumom', () => {
  it('platný kľúč ukáže DÁTUM, nie odpočet (bod 10)', () => {
    const chip = keyChip(payload());
    expect(chip.tone).toBe('good');
    expect(chip.label).toBe('Kľúč do 14.08.2026');
    // Odpočet by sa pri fronte bežiacej týždne nedal s ničím porovnať.
    expect(chip.label).not.toMatch(/\bh\b|\bmin\b/);
  });

  it('vypršaný kľúč to povie rovno, a stále jantárovo — nič sa nestratilo', () => {
    const chip = keyChip(payload({ apiKey: { present: true, expiresAt: '2026-08-01T00:00:00.000Z' } }));
    expect(chip.tone).toBe('attention');
    expect(chip.label).toBe('Kľúč vypršal');
    expect(chip.title).toContain('01.08.2026');
  });

  it('chýbajúci kľúč je jantárový a vysvetlenie berie z prekážky', () => {
    const chip = keyChip(payload({ apiKey: { present: false, expiresAt: null }, blockers: [blocker()] }));
    expect(chip.tone).toBe('attention');
    expect(chip.title).toContain('Vložte kľúč v Nastaveniach.');
  });

  it('neznáma odpoveď servera skončí POMLČKOU s rozklikom, nie pokojom', () => {
    const chip = keyChip(payload({ apiKey: { present: null, expiresAt: null } }));
    expect(chip.tone).toBe('attention');
    expect(chip.label).toContain('—');
    expect(chip.unknown).toBe(true);
  });

  it('rozbitý čas platnosti nevyrobí „NaN“', () => {
    const chip = keyChip(payload({ apiKey: { present: true, expiresAt: 'toto nie je čas' } }));
    expect(chip.label).not.toContain('NaN');
    expect(chip.unknown).toBe(true);
  });
});

describe('writesChip — najbezpečnejší stav appky nie je chyba', () => {
  it('vypnutý ostrý zápis je neutrálny, nie červený', () => {
    const chip = writesChip(
      payload({ writes: { enabled: false, locked: false, lockedReason: null, lockedAt: null } }),
    );
    expect(chip.tone).toBe('idle');
    expect(chip.label).toBe('Ostrý zápis vypnutý');
  });

  it('zapnutý ostrý zápis to povie nahlas', () => {
    expect(writesChip(payload()).tone).toBe('good');
  });

  it('zastavený zápis je jediná červená v pruhu', () => {
    const chip = writesChip(
      payload({
        writes: {
          enabled: true,
          locked: true,
          lockedReason: 'Zapisovalo sa rýchlejšie, než je bezpečné.',
          lockedAt: NOW,
        },
      }),
    );
    expect(chip.tone).toBe('critical');
    expect(chip.title).toContain('Zapisovalo sa rýchlejšie');
  });

  it('zámok poistky má prednosť pred vypnutými zápismi', () => {
    const chip = writesChip(
      payload({ writes: { enabled: false, locked: true, lockedReason: null, lockedAt: NOW } }),
    );
    expect(chip.tone).toBe('critical');
  });
});

/* ═══════════════════════════════ 4. Katalóg ═══════════════════════════════ */

describe('catalogChip — kde je katalóg a či sa oň treba starať', () => {
  it('neúplný katalóg je neutrálny — synchronizácia beží sama', () => {
    const chip = catalogChip(payload({ blockers: [blocker({ id: 'catalog_incomplete', area: 'katalog', severity: 'obmedzuje', resolution: 'cakanie', passableNow: false })] }));
    expect(chip.tone).toBe('idle');
    expect(chip.label).toContain('2 900');
    expect(chip.label).toContain('41 082');
  });

  it('prázdny katalóg je výzva — sám sa nenaplní', () => {
    const chip = catalogChip(
      payload({ catalog: { loadedProducts: 0, shopTotalProducts: 41_082, lastFetchedAt: null } }),
    );
    expect(chip.tone).toBe('attention');
  });

  it('úplný katalóg to povie jedným slovom', () => {
    const chip = catalogChip(
      payload({
        catalog: { loadedProducts: 41_082, shopTotalProducts: 41_082, lastFetchedAt: NOW },
      }),
    );
    expect(chip.tone).toBe('good');
    expect(chip.title).toContain('41 082');
  });

  it('neprečítaná sekcia sa prizná POMLČKOU, nedopĺňa sa nulou', () => {
    const chip = catalogChip(payload({ catalog: null }));
    expect(chip.label).toBe('Katalóg —');
    expect(chip.unknown).toBe(true);
    expect(chip.label).not.toContain('0');
  });
});

/* ═══════════ 4b. Rozpočet v pruhu je LEN číslo (kontrakt, bod 15) ═════════ */

describe('budgetChip — v pruhu číslo, rozpad v Nastaveniach', () => {
  it('bežný stav je jedno číslo a neutrálny tón', () => {
    const chip = budgetChip(payload());
    expect(chip.label).toBe('Zápisy 12/200 dnes');
    expect(chip.tone).toBe('idle');
  });

  it('vyčerpaný rozpočet nie je poplach — pribudne čas, nie červená', () => {
    const chip = budgetChip(
      payload({
        writeBudget: { day: '2026-08-12', budget: 200, spent: 200, remaining: 0, exhausted: true },
        blockers: [BUDGET_EXHAUSTED],
      }),
    );
    expect(chip.tone).toBe('idle');
    expect(chip.label).toContain('200/200');
    expect(chip.label).toContain('ďalšie o ');
    // Neosobne, bez oslovenia aj bez „pokračujem" (bod 9).
    expect(chip.label.toLowerCase()).not.toContain('pokračujem');
  });

  it('neznámy rozpočet je pomlčka, NIKDY 0/200', () => {
    const chip = budgetChip(payload({ writeBudget: null }));
    expect(chip.label).toBe('Zápisy dnes —');
    expect(chip.unknown).toBe(true);
    expect(chip.label).not.toContain('0');
  });
});

/* ═════ 4c. Čas poslednej aktualizácie a „nekreslí sa sekcia" (body 3, 4) ══ */

describe('statusFreshness — vidieť, ku ktorému okamihu čísla platia', () => {
  it('bez známeho stavu je pomlčka, nie vymyslený čas', () => {
    const fresh = statusFreshness({ kind: 'unreachable', payload: null });
    expect(fresh.label).toBe('—');
    expect(fresh.unknown).toBe(true);
  });

  it('čas berie zo servera a hovorí, že sa neprepisuje sám', () => {
    const fresh = statusFreshness(ok(payload()));
    expect(fresh.unknown).toBe(false);
    expect(fresh.label).toMatch(/\d{2}:\d{2}/);
    expect(fresh.title).toContain('Obnoviť');
    // Bod 10: konkrétny čas, žiadne „pred 3 minútami".
    expect(fresh.label).not.toContain('pred ');
  });

  it('rozbitý čas servera nevyrobí „Invalid Date“', () => {
    const fresh = statusFreshness(ok(payload({ now: 'toto nie je čas' })));
    expect(fresh.label).toBe('—');
  });
});

describe('hasBlockers — keď nič neprekáža, obrazovka sekciu nekreslí (bod 3)', () => {
  it('zdravá appka nemá čo kresliť', () => {
    expect(hasBlockers(ok(payload()))).toBe(false);
  });

  it('prekážka ktorejkoľvek úrovne sekciu zapne', () => {
    expect(hasBlockers(ok(payload({ blockers: [blocker({ severity: 'informuje' })] })))).toBe(true);
  });

  it('kým stav nepoznáme, netvrdí sa ani prekážka, ani pokoj', () => {
    expect(hasBlockers({ kind: 'loading', payload: null })).toBe(false);
  });
});

/* ══════════════════════════ 5. Zámky v navigácii ══════════════════════════ */

describe('navLocks — zámok bez dôvodu neexistuje', () => {
  it('zdravá appka nezamyká nič', () => {
    expect(navLocks(ok(payload()))).toEqual([]);
  });

  it('chýbajúci kľúč zamkne Zľavy a povie prečo', () => {
    const locks = navLocks(ok(payload({ blockers: [blocker()] })));
    expect(locks).toHaveLength(1);
    expect(locks[0]?.href).toBe('/zlavy');
    expect(locks[0]?.reason).toContain('chýba kľúč');
    // Celá veta aj s ďalším krokom — zámok musí byť dočítateľný.
    expect(locks[0]?.title).toContain('Vložte kľúč v Nastaveniach.');
  });

  it('vypnuté zápisy zamknú Zľavy vlastným dôvodom', () => {
    const locks = navLocks(
      ok(
        payload({
          writes: { enabled: false, locked: false, lockedReason: null, lockedAt: null },
          blockers: [
            blocker({
              id: 'writes_disabled',
              area: 'zapisy',
              what: 'Zápisy do shopu sú vypnuté.',
              nextStep: 'Zapnúť ich môže len správca počítača.',
              path: null,
              resolution: 'mimo_appky',
            }),
          ],
        }),
      ),
    );
    expect(locks[0]?.reason).toContain('ostrý zápis');
    expect(locks[0]?.title).toContain('správca počítača');
  });

  it('zastavené zápisy majú vlastný dôvod aj bez prekážky v zozname', () => {
    const locks = navLocks(
      ok(payload({ writes: { enabled: true, locked: true, lockedReason: null, lockedAt: NOW } })),
    );
    expect(locks).toHaveLength(1);
    expect(locks[0]?.reason).toContain('poistka');
  });

  it('kým stav nepoznáme, nezamyká sa nič — appka netvrdí zámok bez dôvodu', () => {
    expect(navLocks({ kind: 'loading', payload: null })).toEqual([]);
    expect(navLocks({ kind: 'unauthenticated', payload: null })).toEqual([]);
    expect(navLocks({ kind: 'unreachable', payload: null })).toEqual([]);
  });
});

/* ════════════════════ 6. Stav nikdy nie je len farba ══════════════════════ */

describe('každá menovka nesie text aj celú vetu, nielen tón', () => {
  const states: readonly StatusState[] = [
    ok(payload()),
    ok(
      payload({
        writes: { enabled: false, locked: false, lockedReason: null, lockedAt: null },
        apiKey: { present: false, expiresAt: null },
        writeBudget: null,
        catalog: null,
        blockers: [blocker()],
      }),
    ),
  ];

  for (const [index, state] of states.entries()) {
    it(`vzorka ${index + 1} — menovky majú slovo aj vetu`, () => {
      const chips = [
        connectionChip(state),
        keyChip(state.payload),
        writesChip(state.payload),
        budgetChip(state.payload),
        catalogChip(state.payload),
      ];
      for (const chip of chips) {
        expect(chip.label.trim().length, chip.label).toBeGreaterThan(0);
        // Veta, nie kód: aspoň dve slová a bodka na konci.
        expect(chip.title.trim().split(/\s+/).length, chip.title).toBeGreaterThan(2);
        expect(chip.title).not.toContain('_');
      }
    });
  }

  /**
   * Štyri veci v pruhu majú byť čitateľné na polovici obrazovky (bod 12
   * kontraktu: ~720 px). Menovka je štítok, nie veta — dlhá menovka pruh
   * roztlačí a jeden riadok padne.
   */
  it('menovka je krátka — pruh musí ostať jeden riadok aj na 720 px', () => {
    const chips = [
      keyChip(payload()),
      writesChip(payload()),
      budgetChip(payload()),
      catalogChip(payload()),
    ];
    for (const chip of chips) {
      expect(chip.label.length, chip.label).toBeLessThanOrEqual(26);
    }
  });

  it('žiadna menovka nenahradí neznámu hodnotu nulou (bod 5)', () => {
    const blind = payload({ writeBudget: null, catalog: null, apiKey: { present: null, expiresAt: null } });
    const chips = [keyChip(blind), budgetChip(blind), catalogChip(blind)];
    for (const chip of chips) {
      expect(chip.unknown, chip.label).toBe(true);
      expect(chip.label, chip.label).toContain('—');
      expect(chip.label, chip.label).not.toMatch(/\d/);
    }
  });
});
