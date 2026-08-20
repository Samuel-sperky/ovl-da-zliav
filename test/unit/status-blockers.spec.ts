/**
 * Aura Zľavy — testy jediného zdroja pravdy o tom, ČO PRÁVE BLOKUJE ČO
 * (`src/lib/status/blockers.ts`).
 *
 * Tieto testy nestrážia tvar objektu, strážia TRI veci, na ktorých modul stojí:
 *
 *  1. **Fail-closed.** Chýbajúci alebo neznámy údaj sa MUSÍ vyhodnotiť
 *     prísnejšie, nikdy voľnejšie. Je na to aj plošný test, ktorý postupne
 *     odoberá zo snapshotu jednu vedomosť za druhou a kontroluje, že zoznam
 *     prekážok nikdy nezmäkne.
 *  2. **Vety nesú čísla.** „Limit prekročený" je zase len log. Testy preto
 *     kontrolujú konkrétne čísla vo vetách a plošne zakazujú `undefined`,
 *     `NaN` aj vnútorné kódy na povrchu (K10).
 *  3. **Zrkadlené konštanty sa nerozišli s originálmi.** `blockers.ts` si
 *     zrkadlí päť čísel z modulov, ktoré ťahajú `@/db/pool` (a s ním `mariadb`),
 *     aby zostal použiteľný aj v client komponente. Originály sa importujú TU
 *     a porovnajú — rozídenie hodnôt zhodí test, nie produkciu.
 *
 * Vlastník: S1.
 */
import { describe, expect, it } from 'vitest';

import {
  API_KEY_MAX_TTL_HOURS,
  BLOCKER_ORDER,
  BLOCKER_PATHS,
  CATALOG_PAGE_SIZE,
  FAIL_CLOSED_DAILY_BUDGET,
  HARD_MAX_PRODUCTS,
  KEY_WARNING_HOURS,
  PILOT_MAX_PRODUCTS,
  SEVERITY_ORDER,
  blockingOnly,
  collectOperationBlockers,
  collectProductBlockers,
  firstBlocking,
  sortBlockers,
  summarizeBlockers,
  type Blocker,
  type BlockerId,
  type BlockerSeverity,
  type StatusSnapshot,
} from '@/lib/status/blockers';

import {
  ANON_READS_PER_MINUTE,
  ANON_READS_PER_UTC_DAY,
  nextUtcDayReset,
} from '@/lib/shop/rate-limits';
// Odhad dní má počítať JEDNA funkcia — tá istá, akú používa `syncStatus()`.
import { readDaysNeeded } from '@/lib/shop/read-budget';

/* ─────────────── originály zrkadlených čísel (len pre porovnanie) ───────── */

import { estimateFinish, FAIL_CLOSED_DAILY_BUDGET as ORIGINAL_FAIL_CLOSED_BUDGET } from '@/lib/engine/budget';
import { API_KEY_MAX_TTL_HOURS as ORIGINAL_KEY_TTL } from '@/lib/repo/api-key.repo';
import {
  HARD_MAX_PRODUCTS as ORIGINAL_HARD_MAX,
  PILOT_MAX_PRODUCTS as ORIGINAL_PILOT_MAX,
} from '@/lib/repo/settings.repo';
import { CATALOG_PAGE_SIZE as ORIGINAL_PAGE_SIZE } from '@/lib/shop/catalog-sync';

/* ═══════════════════════════ pomôcky testov ═══════════════════════════════ */

const NOW = new Date('2026-08-12T10:00:00.000Z');
const HOUR = 3_600_000;

/** Snapshot, v ktorom nič nezlyháva — základ, od ktorého sa odchyľuje. */
function healthy(overrides: StatusSnapshot = {}): StatusSnapshot {
  return {
    now: NOW,
    writes: { enabled: true },
    apiKey: { present: true, expiresAt: new Date(NOW.getTime() + 47 * HOUR) },
    writeBudget: { budget: 200, spent: 0, day: '2026-08-12' },
    scope: { mode: 'pilot', maxProducts: PILOT_MAX_PRODUCTS, failClosed: false },
    selection: { selectedCount: 5 },
    ...overrides,
  };
}

const ids = (blockers: readonly Blocker[]): BlockerId[] => blockers.map((b) => b.id);

const byId = (blockers: readonly Blocker[], id: BlockerId): Blocker => {
  const found = blockers.find((b) => b.id === id);
  if (found === undefined) {
    throw new Error(`Prekážka ${id} v zozname nie je. Sú tam: ${ids(blockers).join(', ') || '—'}`);
  }
  return found;
};

const has = (blockers: readonly Blocker[], id: BlockerId): boolean =>
  blockers.some((b) => b.id === id);

/** Najprísnejšia závažnosť v zozname (`informuje` keď nič neprekáža). */
function worstSeverity(blockers: readonly Blocker[]): BlockerSeverity {
  return blockers.reduce<BlockerSeverity>(
    (worst, blocker) =>
      SEVERITY_ORDER[blocker.severity] < SEVERITY_ORDER[worst] ? blocker.severity : worst,
    'informuje',
  );
}

/* ══════════════════ 1. Zrkadlené čísla sedia s originálmi ═════════════════ */

describe('zrkadlené konštanty sa nesmú rozísť s originálmi', () => {
  it('pilotný strop je ten istý ako v settings.repo', () => {
    expect(PILOT_MAX_PRODUCTS).toBe(ORIGINAL_PILOT_MAX);
    expect(PILOT_MAX_PRODUCTS).toBe(10);
  });

  it('tvrdý strop produktov je ten istý ako v settings.repo', () => {
    expect(HARD_MAX_PRODUCTS).toBe(ORIGINAL_HARD_MAX);
    expect(HARD_MAX_PRODUCTS).toBe(10_000);
  });

  it('fail-closed denný rozpočet je ten istý ako v engine/budget', () => {
    expect(FAIL_CLOSED_DAILY_BUDGET).toBe(ORIGINAL_FAIL_CLOSED_BUDGET);
    expect(FAIL_CLOSED_DAILY_BUDGET).toBe(1);
  });

  it('TTL kľúča je to isté ako v api-key.repo (R2)', () => {
    expect(API_KEY_MAX_TTL_HOURS).toBe(ORIGINAL_KEY_TTL);
    expect(API_KEY_MAX_TTL_HOURS).toBe(48);
  });

  it('stránka katalógu je tá istá ako v catalog-sync', () => {
    expect(CATALOG_PAGE_SIZE).toBe(ORIGINAL_PAGE_SIZE);
    expect(CATALOG_PAGE_SIZE).toBe(100);
  });

  it('odhad dobehnutia fronty počíta rovnako ako estimateFinish v engine/budget', () => {
    // 150 vo výbere, 40 sa dnes ešte zmestí, 200 na deň → ešte 1 deň.
    const expected = estimateFinish(150, 200, { remainingToday: 40, now: NOW });
    const blockers = collectOperationBlockers(
      healthy({ writeBudget: { budget: 200, spent: 160 }, selection: { selectedCount: 150 } }),
    );
    expect(expected.days).toBe(1);
    expect(byId(blockers, 'write_budget_low').nextStep).toContain(`${expected.days} deň`);
  });
});

/* ════════════════════ 2. Prázdny snapshot = fail-closed ═══════════════════ */

describe('prázdny snapshot nie je „všetko v poriadku"', () => {
  const blockers = collectOperationBlockers({ now: NOW });

  it('vypnuté zápisy, chýbajúci kľúč aj vyčerpaný rozpočet sa predpokladajú', () => {
    expect(has(blockers, 'writes_disabled')).toBe(true);
    expect(has(blockers, 'key_missing')).toBe(true);
    expect(has(blockers, 'write_budget_exhausted')).toBe(true);
  });

  it('neznámy režim rozsahu znamená pilotný strop 10', () => {
    expect(byId(blockers, 'scope_pilot_cap').what).toContain('10 produktov');
    expect(has(blockers, 'scope_full_cap')).toBe(false);
  });

  it('každá prekážka priznáva, že stojí na domnienke', () => {
    expect(blockers.every((b) => b.assumed)).toBe(true);
  });

  it('bez volania funkcie sa nedá dostať k voľnejšiemu výsledku (default {})', () => {
    expect(ids(collectOperationBlockers()).length).toBeGreaterThan(0);
  });

  it('čítací rozpočet katalógu sa bez opýtania nerieši — zápisu nebráni', () => {
    expect(has(blockers, 'catalog_reads_day_exhausted')).toBe(false);
    expect(has(blockers, 'catalog_reads_minute_exhausted')).toBe(false);
  });
});

describe('zdravý snapshot nič neblokuje', () => {
  const blockers = collectOperationBlockers(healthy());

  it('nič neblokuje a zostane len informácia o strope rozsahu', () => {
    expect(summarizeBlockers(blockers).blocked).toBe(false);
    expect(ids(blockers)).toEqual(['scope_pilot_cap']);
    expect(byId(blockers, 'scope_pilot_cap').severity).toBe('informuje');
  });

  /**
   * ZMENA 20. 8. 2026 (šprint dokončenia, W2, body 5 a 7): informatívna veta
   * nesie už len STROP. Druhé číslo tam bolo tretí raz to isté — na Produktoch
   * ho hovorí lišta výberu, na Prehľade výber neexistuje. Tvrdenie „nesie obe
   * čísla" sa NERUŠÍ, len sa presúva tam, kde platí: na vetu, ktorá BLOKUJE.
   */
  it('informatívna veta o strope nesie strop a NIE počet vybraných', () => {
    const scope = byId(blockers, 'scope_pilot_cap');
    expect(scope.severity).toBe('informuje');
    expect(scope.what).toContain('10 produktov');
    expect(scope.what).not.toContain('vo výbere');
    expect(scope.what).not.toContain('5 produktov');
  });

  it('veta, ktorá BLOKUJE, nesie obe čísla aj zvyšok', () => {
    const over = byId(
      collectOperationBlockers(healthy({ selection: { selectedCount: 150 } })),
      'scope_pilot_cap',
    );
    expect(over.severity).toBe('blokuje');
    expect(over.what).toContain('10 produktov');
    expect(over.what).toContain('150 produktov');
  });
});

/* ═══════════════════════ 3. Zápisy vypnuté (I13, D77) ═════════════════════ */

describe('WRITES_ENABLED — vypnuté zápisy', () => {
  it('vypnuté zápisy blokujú všetko a v appke sa prepnúť nedajú', () => {
    const blocker = byId(
      collectOperationBlockers(healthy({ writes: { enabled: false } })),
      'writes_disabled',
    );
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.resolution).toBe('mimo_appky');
    expect(blocker.path).toBeNull();
    expect(blocker.passableNow).toBe(true);
    expect(blocker.assumed).toBe(false);
  });

  it('neznáma poistka sa berie ako vypnutá a prizná sa to', () => {
    const blocker = byId(
      collectOperationBlockers(healthy({ writes: { enabled: null } })),
      'writes_disabled',
    );
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.assumed).toBe(true);
  });

  it('zapnuté zápisy nevyrobia žiadnu prekážku', () => {
    expect(has(collectOperationBlockers(healthy()), 'writes_disabled')).toBe(false);
  });
});

/* ══════════════════════════ 4. Kľúč (R2, D63, K6) ═════════════════════════ */

describe('API kľúč — či je vložený a dokedy platí', () => {
  it('chýbajúci kľúč blokuje a vedie do Nastavení', () => {
    const blocker = byId(
      collectOperationBlockers(healthy({ apiKey: { present: false } })),
      'key_missing',
    );
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.path).toBe(BLOCKER_PATHS.settings);
    expect(blocker.resolution).toBe('sam');
    expect(blocker.nextStep).toContain('48 hodín');
  });

  it('neznáma prítomnosť kľúča sa berie ako chýbajúci kľúč', () => {
    const blocker = byId(collectOperationBlockers(healthy({ apiKey: {} })), 'key_missing');
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.assumed).toBe(true);
  });

  it('expirovaný kľúč blokuje a veta povie, ako dávno vypršal', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({ apiKey: { present: true, expiresAt: new Date(NOW.getTime() - 3 * HOUR) } }),
      ),
      'key_expired',
    );
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.what).toContain('pred 3 hodiny');
    expect(blocker.assumed).toBe(false);
  });

  it('vložený kľúč s neznámou platnosťou sa berie ako expirovaný', () => {
    const blocker = byId(
      collectOperationBlockers(healthy({ apiKey: { present: true } })),
      'key_expired',
    );
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.assumed).toBe(true);
  });

  it('krátka platnosť je informácia, kým fronta stíha', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({ apiKey: { present: true, expiresAt: new Date(NOW.getTime() + 6 * HOUR) } }),
      ),
      'key_expires_soon',
    );
    expect(blocker.severity).toBe('informuje');
    expect(blocker.what).toContain('6 hodín');
  });

  it('fronta dlhšia než platnosť kľúča je už obmedzenie (K6)', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          apiKey: { present: true, expiresAt: new Date(NOW.getTime() + 6 * HOUR) },
          writeBudget: { budget: 200, spent: 0 },
          selection: { selectedCount: 1_500 },
        }),
      ),
      'key_expires_soon',
    );
    expect(blocker.severity).toBe('obmedzuje');
    // 1 500 položiek pri 200/deň (200 sa zmestí dnes) = ešte 7 dní.
    expect(blocker.what).toContain('7 dní');
    expect(blocker.what).toContain('1 500 produktov');
  });

  it('dosť dlhá platnosť sa nespomína vôbec', () => {
    const blockers = collectOperationBlockers(
      healthy({
        apiKey: {
          present: true,
          expiresAt: new Date(NOW.getTime() + (KEY_WARNING_HOURS + 1) * HOUR),
        },
      }),
    );
    expect(has(blockers, 'key_expires_soon')).toBe(false);
  });
});

/* ═════════════════ 5. Denný zápisový rozpočet (K2, 200/UTC deň) ═══════════ */

describe('denný rozpočet zápisov', () => {
  it('vyčerpaný rozpočet blokuje a rieši sa výhradne čakaním', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({ writeBudget: { budget: 200, spent: 200, day: '2026-08-12' } }),
      ),
      'write_budget_exhausted',
    );
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.resolution).toBe('cakanie');
    expect(blocker.passableNow).toBe(false);
    expect(blocker.clearsAt?.toISOString()).toBe(nextUtcDayReset(NOW).toISOString());
    expect(blocker.what).toContain('200 z 200');
    expect(blocker.what).toContain('2026-08-12');
  });

  it('neznáma spotreba sa berie ako vyčerpaný rozpočet', () => {
    const blocker = byId(
      collectOperationBlockers(healthy({ writeBudget: { budget: 200 } })),
      'write_budget_exhausted',
    );
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.assumed).toBe(true);
    expect(blocker.what).toContain(`${FAIL_CLOSED_DAILY_BUDGET} zápis na deň`);
  });

  it('výber väčší než dnešný zvyšok len obmedzuje a povie konkrétne čísla', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({ writeBudget: { budget: 200, spent: 160 }, selection: { selectedCount: 150 } }),
      ),
      'write_budget_low',
    );
    expect(blocker.severity).toBe('obmedzuje');
    expect(blocker.what).toContain('40 zápisov');
    expect(blocker.what).toContain('150 produktov');
    expect(blocker.what).toContain('110');
    expect(blocker.resolution).toBe('cakanie');
  });

  it('výber, čo sa dnes zmestí, nevyrobí žiadnu prekážku rozpočtu', () => {
    const blockers = collectOperationBlockers(
      healthy({ writeBudget: { budget: 200, spent: 160 }, selection: { selectedCount: 40 } }),
    );
    expect(has(blockers, 'write_budget_low')).toBe(false);
    expect(has(blockers, 'write_budget_exhausted')).toBe(false);
  });
});

/* ═══════════════════ 6. Režim rozsahu (K1: pilot vs plny) ═════════════════ */

describe('režim rozsahu — pilot stropuje na 10, plny na uložený strop', () => {
  it('pilotný strop pri prekročení blokuje a prepnutie chce heslo', () => {
    const blocker = byId(
      collectOperationBlockers(healthy({ selection: { selectedCount: 150 } })),
      'scope_pilot_cap',
    );
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.resolution).toBe('sudo');
    expect(blocker.path).toBe(BLOCKER_PATHS.settings);
    expect(blocker.what).toContain('najviac 10 produktov');
    expect(blocker.what).toContain('vo výbere je 150 produktov');
    expect(blocker.what).toContain('zvyšných 140 sa nezapíše');
  });

  it('plný režim má vlastný strop a mení sa bez hesla', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          scope: { mode: 'plny', maxProducts: 500, failClosed: false },
          selection: { selectedCount: 800 },
        }),
      ),
      'scope_full_cap',
    );
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.resolution).toBe('sam');
    expect(blocker.what).toContain('najviac 500 produktov');
    expect(blocker.nextStep).toContain('strop zvýšte');
  });

  it('na tvrdom strope 10 000 už rada „zvýšte strop" neplatí', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          scope: { mode: 'plny', maxProducts: HARD_MAX_PRODUCTS, failClosed: false },
          selection: { selectedCount: 12_000 },
        }),
      ),
      'scope_full_cap',
    );
    expect(blocker.nextStep).toContain('Rozdeľte');
    expect(blocker.nextStep).not.toContain('zvýšte');
  });

  it('strop nad tvrdý strop sa zastropuje ako v guards.resolveScope', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          scope: { mode: 'plny', maxProducts: 99_999, failClosed: false },
          selection: { selectedCount: 12_000 },
        }),
      ),
      'scope_full_cap',
    );
    expect(blocker.what).toContain('10 000 produktov');
  });

  it('fail-closed rozsah prebije aj uložený „plny" a spadne späť na 10', () => {
    // Presne stav z `settingsRepo.readScope()` po nečitateľnej DB: hodnoty
    // vyzerajú ako `plny`, ale `failClosed` hovorí, že sa neprečítali.
    const blockers = collectOperationBlockers(
      healthy({
        scope: { mode: 'plny', maxProducts: HARD_MAX_PRODUCTS, failClosed: true },
        selection: { selectedCount: 150 },
      }),
    );
    expect(has(blockers, 'scope_full_cap')).toBe(false);
    expect(byId(blockers, 'scope_pilot_cap').severity).toBe('blokuje');
    expect(byId(blockers, 'scope_unknown').assumed).toBe(true);
    expect(byId(blockers, 'scope_unknown').severity).toBe('obmedzuje');
  });

  it('neznámy strop v plnom režime spadne na pilotných 10 a prizná sa', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({ scope: { mode: 'plny' }, selection: { selectedCount: 3 } }),
      ),
      'scope_full_cap',
    );
    expect(blocker.what).toContain('najviac 10 produktov');
    expect(blocker.assumed).toBe(true);
  });

  it('neznámy počet vybraných produktov nevyrobí falošné číslo', () => {
    const blocker = byId(
      collectOperationBlockers(healthy({ selection: {} })),
      'scope_pilot_cap',
    );
    expect(blocker.severity).toBe('informuje');
    expect(blocker.assumed).toBe(true);
    // Od 20. 8. 2026 veta o výbere nehovorí — na Prehľade výber neexistuje.
    // Záruka je tým silnejšia, nie slabšia: nesmie tam byť ŽIADNE druhé číslo,
    // ani nula, ani priznanie neznáma, ktoré by výber vôbec pripomenulo.
    expect(blocker.what).toBe('Na jednu zľavu prejde najviac 10 produktov.');
    expect(blocker.what).not.toContain('vo výbere');
  });

  /**
   * Dopočet zo zoznamu ID sa už z vety prečítať nedá (nesie len strop), takže
   * sa meria tam, kde ten počet stále rozhoduje: na ZÁVAŽNOSTI. Tri produkty
   * sú pod stropom desiatich (`informuje`), pätnásť nad ním (`blokuje`) — a to
   * sa dá odvodiť jedine z dopočítaného počtu.
   */
  it('počet sa dopočíta zo zoznamu ID, keď chýba', () => {
    const pod = byId(
      collectOperationBlockers(healthy({ selection: { productIds: [1, 2, 3] } })),
      'scope_pilot_cap',
    );
    expect(pod.severity).toBe('informuje');

    const nad = byId(
      collectOperationBlockers(
        healthy({ selection: { productIds: Array.from({ length: 15 }, (_, i) => i + 1) } }),
      ),
      'scope_pilot_cap',
    );
    expect(nad.severity).toBe('blokuje');
    expect(nad.what).toContain('15 produktov');
  });
});

/* ═════════════════ 7. Katalóg (K1 bod 2 a K7 — koľko z koľkých) ═══════════ */

describe('katalóg — v plnom režime je podmienkou zápisu', () => {
  const full = { mode: 'plny', maxProducts: HARD_MAX_PRODUCTS, failClosed: false } as const;

  it('neoverený katalóg v plnom režime blokuje (fail-closed)', () => {
    const blocker = byId(
      collectOperationBlockers(healthy({ scope: full, selection: { selectedCount: 12 } })),
      'catalog_unknown',
    );
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.assumed).toBe(true);
    expect(blocker.path).toBe(BLOCKER_PATHS.products);
  });

  it('v pilotnom režime katalóg o zápise nerozhoduje', () => {
    const blockers = collectOperationBlockers(healthy({ selection: { selectedCount: 5 } }));
    expect(has(blockers, 'catalog_unknown')).toBe(false);
    expect(has(blockers, 'catalog_product_missing')).toBe(false);
  });

  it('overený katalóg bez chýbajúcich produktov je ticho', () => {
    const blockers = collectOperationBlockers(
      healthy({
        scope: full,
        selection: { selectedCount: 12 },
        catalog: { missingProductIds: [] },
      }),
    );
    expect(has(blockers, 'catalog_unknown')).toBe(false);
    expect(has(blockers, 'catalog_product_missing')).toBe(false);
  });

  it('chýbajúce produkty sú prekážkou konkrétnych produktov, nie operácie', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          scope: full,
          selection: { selectedCount: 12 },
          catalog: { missingProductIds: [101, 102, 103] },
        }),
      ),
      'catalog_product_missing',
    );
    expect(blocker.severity).toBe('blokuje');
    expect(blocker.subject).toBe('produkt');
    expect(blocker.productIds).toEqual([101, 102, 103]);
    expect(blocker.what).toContain('3 produkty');
    expect(blocker.what).toContain('101, 102, 103');
    expect(blocker.what).toContain('12 produktov vo výbere');
  });

  it('dlhý zoznam chýbajúcich ID sa oreže na vzorku', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          scope: full,
          selection: { selectedCount: 50 },
          catalog: { missingProductIds: [1, 2, 3, 4, 5, 6, 7, 8] },
        }),
      ),
      'catalog_product_missing',
    );
    expect(blocker.what).toContain('1, 2, 3, 4, 5 a ďalších 3');
    expect(blocker.productIds).toHaveLength(8);
  });

  it('prázdny katalóg v plnom režime blokuje, v pilotnom len informuje', () => {
    const inFull = byId(
      collectOperationBlockers(
        healthy({ scope: full, catalog: { loadedProducts: 0, missingProductIds: [] } }),
      ),
      'catalog_incomplete',
    );
    const inPilot = byId(
      collectOperationBlockers(healthy({ catalog: { loadedProducts: 0 } })),
      'catalog_incomplete',
    );
    expect(inFull.severity).toBe('blokuje');
    expect(inPilot.severity).toBe('informuje');
  });

  it('rozčítaný katalóg povie koľko z koľkých a odhad podľa limitov čítania', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          scope: full,
          catalog: {
            loadedProducts: 12_000,
            shopTotalProducts: 40_483,
            missingProductIds: [],
          },
        }),
      ),
      'catalog_incomplete',
    );
    // 28 483 chýbajúcich po 100 na stránku = 285 stránok. Koľko je to DNÍ,
    // počíta `readDaysNeeded` — tá istá funkcia ako v `syncStatus()`, nie druhá
    // formula. Bez známeho zvyšku dnešného rozpočtu je fail-closed vstup
    // „dnes už nič", teda 285 / 240 = 2 ďalšie dni.
    const expectedDays = readDaysNeeded(Math.ceil(28_483 / CATALOG_PAGE_SIZE), 0);
    expect(expectedDays).toBe(2);
    expect(blocker.severity).toBe('obmedzuje');
    expect(blocker.what).toContain('12 000 z 40 483 produktov');
    expect(blocker.what).toContain('28 483 zatiaľ chýba');
    expect(blocker.what).toContain(`približne ${expectedDays} dni`);
    expect(blocker.resolution).toBe('cakanie');
    expect(blocker.passableNow).toBe(false);
  });

  /**
   * JEDEN ODHAD, NIE DVA.
   *
   * Prekážka a `catalogRepo.syncStatus()` sa kreslia do TOHO ISTÉHO panelu a
   * pritom počítali dvoma formulami: prekážka cez `anonReadDaysNeeded(pages)`
   * (dnešný zvyšok rozpočtu ignorovala a dnešok počítala ako celý deň),
   * `syncStatus()` cez `readDaysNeeded(pages, remaining, limit)`. Čísla sa
   * líšili o deň a používateľ ich videl vedľa seba.
   */
  it('odhad počíta s dnešným zvyškom rozpočtu čítaní, rovnako ako syncStatus', () => {
    // 285 chýbajúcich stránok a dnes je celý rozpočet (240) voľný: dnes 240,
    // zajtra zvyšok — teda ešte JEDEN ďalší UTC deň, nie dva.
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          scope: full,
          catalog: {
            loadedProducts: 12_000,
            shopTotalProducts: 40_483,
            missingProductIds: [],
          },
          catalogReads: { usedThisUtcDay: 0, usedThisMinute: 0 },
        }),
      ),
      'catalog_incomplete',
    );

    const pages = Math.ceil(28_483 / CATALOG_PAGE_SIZE);
    expect(readDaysNeeded(pages, ANON_READS_PER_UTC_DAY)).toBe(1);
    expect(blocker.what).toContain('približne 1 deň');
    expect(blocker.what).not.toContain('2 dni');
  });

  it('keď server odhad už spočítal, prekážka použije JEHO číslo', () => {
    // `syncStatus()` pozná pokrok prechodu (`last_page`), prekážka len počty
    // riadkov. Keď teda odhad prišiel v snapshote, druhý sa nedopočítava — inak
    // by v jednom paneli stáli dve čísla o tej istej veci.
    const finish = new Date('2026-08-18T00:00:00.000Z');
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          scope: full,
          catalog: {
            loadedProducts: 12_000,
            shopTotalProducts: 40_483,
            missingProductIds: [],
            estimatedDaysLeft: 6,
            estimatedFinishAt: finish,
          },
          catalogReads: { usedThisUtcDay: 0, usedThisMinute: 0 },
        }),
      ),
      'catalog_incomplete',
    );

    expect(blocker.what).toContain('približne 6 dní');
    expect(blocker.clearsAt?.toISOString()).toBe(finish.toISOString());
  });

  /**
   * Bod 3 hlavičky modulu: kto tvrdí, že sa čaká, musí povedať aj NA ČO.
   * `catalog_incomplete` to porušovala — čakala s `clearsAt: null`.
   */
  it('čakanie na dočítanie katalógu povie, dokedy', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          scope: full,
          catalog: {
            loadedProducts: 12_000,
            shopTotalProducts: 40_483,
            missingProductIds: [],
          },
          catalogReads: { usedThisUtcDay: 0, usedThisMinute: 0 },
        }),
      ),
      'catalog_incomplete',
    );

    expect(blocker.resolution).toBe('cakanie');
    expect(blocker.passableNow).toBe(false);
    expect(blocker.clearsAt).not.toBeNull();
    // Ten istý deň, o akom hovorí veta: 285 stránok, dnes celý rozpočet → zajtra.
    expect(blocker.clearsAt?.toISOString()).toBe(nextUtcDayReset(NOW).toISOString());
  });

  it('dočítaný katalóg mlčí', () => {
    const blockers = collectOperationBlockers(
      healthy({
        scope: full,
        catalog: {
          loadedProducts: 40_483,
          shopTotalProducts: 40_483,
          missingProductIds: [],
        },
      }),
    );
    expect(has(blockers, 'catalog_incomplete')).toBe(false);
  });
});

/* ═══════════ 8. Čítací rozpočet katalógu (30/min, 300/UTC deň) ════════════ */

describe('čítací rozpočet katalógu', () => {
  it('bez opýtania sa nerieši (sekcia v snapshote chýba)', () => {
    const blockers = collectOperationBlockers(healthy());
    expect(has(blockers, 'catalog_reads_day_exhausted')).toBe(false);
    expect(has(blockers, 'catalog_reads_minute_exhausted')).toBe(false);
  });

  it('vyčerpaný denný rozpočet čítaní čaká na polnoc UTC', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          catalogReads: { usedThisUtcDay: ANON_READS_PER_UTC_DAY, usedThisMinute: 0 },
        }),
      ),
      'catalog_reads_day_exhausted',
    );
    expect(blocker.severity).toBe('obmedzuje');
    expect(blocker.resolution).toBe('cakanie');
    expect(blocker.clearsAt?.toISOString()).toBe(nextUtcDayReset(NOW).toISOString());
    expect(blocker.what).toContain(`${ANON_READS_PER_UTC_DAY} z ${ANON_READS_PER_UTC_DAY}`);
    // Limit shopu je 300; naše 240 je rezerva — veta musí ukázať obe čísla.
    expect(blocker.what).toContain('300');
  });

  it('vyčerpaný minútový strop čaká najviac minútu', () => {
    const blocker = byId(
      collectOperationBlockers(
        healthy({
          catalogReads: { usedThisUtcDay: 0, usedThisMinute: ANON_READS_PER_MINUTE },
        }),
      ),
      'catalog_reads_minute_exhausted',
    );
    expect(blocker.clearsAt?.getTime()).toBe(NOW.getTime() + 60_000);
    expect(blocker.what).toContain(`${ANON_READS_PER_MINUTE}`);
    expect(blocker.what).toContain('30');
  });

  it('neznáma spotreba čítaní sa berie ako vyčerpaná', () => {
    const blockers = collectOperationBlockers(healthy({ catalogReads: {} }));
    expect(byId(blockers, 'catalog_reads_day_exhausted').assumed).toBe(true);
    expect(byId(blockers, 'catalog_reads_minute_exhausted').assumed).toBe(true);
  });

  it('čítania NIKDY neblokujú zápis — majú vlastnú kvótu bez kľúča', () => {
    const blockers = collectOperationBlockers(healthy({ catalogReads: {} }));
    const reads = blockers.filter((b) => b.area === 'citanie');
    expect(reads.length).toBe(2);
    expect(reads.every((b) => b.severity === 'obmedzuje')).toBe(true);
    expect(summarizeBlockers(blockers).blocked).toBe(false);
  });

  it('rozpočet pod stropom mlčí', () => {
    const blockers = collectOperationBlockers(
      healthy({ catalogReads: { usedThisUtcDay: 10, usedThisMinute: 1 } }),
    );
    expect(has(blockers, 'catalog_reads_day_exhausted')).toBe(false);
    expect(has(blockers, 'catalog_reads_minute_exhausted')).toBe(false);
  });
});

/* ══════════════════ 9. Kombinácie a poradie podľa závažnosti ══════════════ */

/** Snapshot, v ktorom je zle úplne všetko naraz. */
const everythingWrong: StatusSnapshot = {
  now: NOW,
  writes: { enabled: false },
  apiKey: { present: false },
  writeBudget: { budget: 200, spent: 200, day: '2026-08-12' },
  scope: { mode: 'plny', maxProducts: 500, failClosed: false },
  selection: { selectedCount: 800 },
  catalog: {
    loadedProducts: 12_000,
    shopTotalProducts: 40_483,
    missingProductIds: [101, 102],
  },
  catalogReads: { usedThisUtcDay: ANON_READS_PER_UTC_DAY, usedThisMinute: ANON_READS_PER_MINUTE },
};

describe('kombinácie — všetko naraz', () => {
  const blockers = collectOperationBlockers(everythingWrong);

  it('nájde všetky prekážky naraz, nielen prvú', () => {
    expect(ids(blockers)).toEqual([
      'writes_disabled',
      'key_missing',
      'write_budget_exhausted',
      'scope_full_cap',
      'catalog_product_missing',
      'catalog_incomplete',
      'catalog_reads_day_exhausted',
      'catalog_reads_minute_exhausted',
    ]);
  });

  it('poradie je najprv podľa závažnosti', () => {
    const ranks = blockers.map((b) => SEVERITY_ORDER[b.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('v rámci rovnakej závažnosti platí kanonické poradie', () => {
    for (const severity of ['blokuje', 'obmedzuje', 'informuje'] as const) {
      const positions = blockers
        .filter((b) => b.severity === severity)
        .map((b) => BLOCKER_ORDER.indexOf(b.id));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it('prvá blokujúca prekážka je vypnutý zápis, nie náhodná', () => {
    expect(firstBlocking(blockers)?.id).toBe('writes_disabled');
    // blokujú: vypnuté zápisy, chýbajúci kľúč, vyčerpaný rozpočet, prekročený
    // strop rozsahu a produkty mimo katalógu.
    expect(blockingOnly(blockers).length).toBe(5);
  });

  it('zhrnutie ukáže najbližší čas, keď sa niečo pohne samo', () => {
    const summary = summarizeBlockers(blockers);
    expect(summary.blocked).toBe(true);
    // Minútový strop sa uvoľní skôr než polnoc UTC.
    expect(summary.waitUntil?.getTime()).toBe(NOW.getTime() + 60_000);
  });

  it('sortBlockers nemení vstupné pole', () => {
    const input = [...blockers].reverse();
    const copy = [...input];
    sortBlockers(input);
    expect(input).toEqual(copy);
  });

  it('zoznam prekážok neobsahuje duplicitné ID', () => {
    expect(new Set(ids(blockers)).size).toBe(blockers.length);
  });
});

/* ══════════════════════ 10. Jeden produkt vs celá operácia ════════════════ */

describe('prečo neprejde PRÁVE TENTO produkt', () => {
  const full = { mode: 'plny', maxProducts: HARD_MAX_PRODUCTS, failClosed: false } as const;
  const snapshot = healthy({
    scope: full,
    selection: { selectedCount: 500 },
    catalog: { missingProductIds: [101, 102], loadedProducts: 40_483, shopTotalProducts: 40_483 },
  });

  it('chýbajúci produkt sa ukáže len tomu produktu, ktorého sa týka', () => {
    const blocked = collectProductBlockers(101, snapshot);
    const fine = collectProductBlockers(999, snapshot);
    expect(byId(blocked, 'catalog_product_missing').productIds).toEqual([101]);
    expect(has(fine, 'catalog_product_missing')).toBe(false);
  });

  it('prekážky celej operácie platia aj pre jeden produkt', () => {
    const blockers = collectProductBlockers(101, {
      ...snapshot,
      writes: { enabled: false },
    });
    expect(has(blockers, 'writes_disabled')).toBe(true);
  });

  it('strop rozsahu sa pri jednom produkte počíta voči jednotke', () => {
    const operation = collectOperationBlockers(healthy({ selection: { selectedCount: 150 } }));
    const single = collectProductBlockers(7, healthy({ selection: { selectedCount: 150 } }));
    expect(byId(operation, 'scope_pilot_cap').severity).toBe('blokuje');
    expect(byId(single, 'scope_pilot_cap').severity).toBe('informuje');
    // Veta pri jednom produkte nesie len strop (od 20. 8. 2026); že sa počítalo
    // voči JEDNOTKE a nie voči výberu 150, dokazuje závažnosť `informuje`.
    expect(byId(single, 'scope_pilot_cap').what).not.toContain('150');
  });

  it('bez katalógovej sekcie zostáva fail-closed aj pre jeden produkt', () => {
    const blockers = collectProductBlockers(101, healthy({ scope: full }));
    expect(byId(blockers, 'catalog_unknown').severity).toBe('blokuje');
  });
});

/* ════════════════ 11. Plošné invarianty naprieč kombináciami ══════════════ */

/** Snapshoty, cez ktoré prechádzajú všetky plošné kontroly. */
const ALL_SNAPSHOTS: readonly StatusSnapshot[] = [
  {},
  { now: NOW },
  healthy(),
  everythingWrong,
  healthy({ writes: { enabled: false }, apiKey: {} }),
  healthy({ selection: { selectedCount: 150 } }),
  healthy({ selection: { selectedCount: 1 } }),
  healthy({ selection: { selectedCount: 2 } }),
  healthy({ selection: { selectedCount: 0 } }),
  healthy({ scope: { mode: 'plny', maxProducts: 500, failClosed: false } }),
  healthy({ scope: { mode: 'plny' }, catalog: { missingProductIds: [1] } }),
  healthy({ catalogReads: {} }),
  healthy({ catalog: { loadedProducts: 0 } }),
  // Rozčítaný katalóg — jediný stav, v ktorom `catalog_incomplete` čaká. Bez
  // neho plošné invarianty tú prekážku v jej čakajúcej podobe nikdy nevidia.
  healthy({
    scope: { mode: 'plny', maxProducts: 500, failClosed: false },
    catalog: { loadedProducts: 12_000, shopTotalProducts: 40_483, missingProductIds: [] },
  }),
  healthy({
    scope: { mode: 'plny', maxProducts: 500, failClosed: false },
    catalog: { loadedProducts: 12_000, shopTotalProducts: 40_483, missingProductIds: [] },
    catalogReads: { usedThisUtcDay: 0, usedThisMinute: 0 },
  }),
  healthy({ writeBudget: {} }),
  healthy({ apiKey: { present: true, expiresAt: new Date(NOW.getTime() - HOUR) } }),
];

const EVERY_BLOCKER: readonly Blocker[] = ALL_SNAPSHOTS.flatMap((snapshot) => [
  ...collectOperationBlockers(snapshot),
  ...collectProductBlockers(101, snapshot),
]);

describe('plošné invarianty každej prekážky', () => {
  it('čakanie a prekonateľnosť si neprotirečia', () => {
    for (const blocker of EVERY_BLOCKER) {
      expect(blocker.resolution === 'cakanie').toBe(blocker.passableNow === false);
    }
  });

  /**
   * Bod 3 hlavičky modulu — a obe strany, nie len jedna. Pôvodne sa tu overovalo
   * iba to, že kto nesie `clearsAt`, ten naozaj čaká; smer „kto čaká, povie na
   * čo" chýbal a `catalog_incomplete` sa doňho zmestila s `clearsAt: null`.
   * Prekážka, ktorá tvrdí „počkaj si" a nepovie dokedy, je pre používateľa
   * mŕtvy bod — presne to, čo tento modul vznikol odstrániť.
   */
  it('kto čaká, povie na čo — a kto nesie čas, ten naozaj čaká', () => {
    for (const blocker of EVERY_BLOCKER) {
      if (blocker.resolution === 'cakanie') {
        expect(blocker.clearsAt, `prekážka ${blocker.id} čaká bez času`).not.toBeNull();
      }
      if (blocker.clearsAt !== null) {
        expect(blocker.passableNow).toBe(false);
        expect(blocker.clearsAt.getTime()).toBeGreaterThan(NOW.getTime());
      }
    }
  });

  it('cesta v appke chýba len tam, kde sa to v appke vyriešiť nedá', () => {
    for (const blocker of EVERY_BLOCKER) {
      if (blocker.resolution === 'sam' || blocker.resolution === 'sudo') {
        expect(blocker.path).not.toBeNull();
      }
      if (blocker.path !== null) {
        expect(Object.values(BLOCKER_PATHS)).toContain(blocker.path);
      }
    }
  });

  it('prekážka operácie nikdy nenesie ID produktov a naopak', () => {
    for (const blocker of EVERY_BLOCKER) {
      if (blocker.subject === 'operacia') expect(blocker.productIds).toEqual([]);
      else expect(blocker.productIds.length).toBeGreaterThan(0);
    }
  });

  it('každé ID je v kanonickom poradí', () => {
    for (const blocker of EVERY_BLOCKER) {
      expect(BLOCKER_ORDER).toContain(blocker.id);
    }
  });

  it('obe vety existujú a končia bodkou', () => {
    for (const blocker of EVERY_BLOCKER) {
      expect(blocker.what.length).toBeGreaterThan(10);
      expect(blocker.nextStep.length).toBeGreaterThan(10);
      expect(blocker.what.trim().endsWith('.')).toBe(true);
      expect(blocker.nextStep.trim().endsWith('.')).toBe(true);
    }
  });

  it('do viet sa nesmie prepísať žiadna technická haraburda (K10)', () => {
    const forbidden = [
      'undefined',
      'NaN',
      'null',
      'writes_disabled',
      'not_in_catalog',
      'WRITES_ENABLED',
      'allowlist',
      'dry-run',
      'setReduction',
      'catalog_cache',
      'audit_log',
    ];
    for (const blocker of EVERY_BLOCKER) {
      for (const word of forbidden) {
        expect(`${blocker.what} ${blocker.nextStep}`).not.toContain(word);
      }
    }
  });
});

/* ═════════════ 12. Fail-closed: neznáme nikdy nesmie byť voľnejšie ════════ */

describe('fail-closed — odobratie vedomosti nikdy zoznam nezmäkčí', () => {
  /** Dvojice „viem" → „neviem" nad tým istým základom. */
  const cases: ReadonlyArray<{ name: string; known: StatusSnapshot; unknown: StatusSnapshot }> = [
    {
      name: 'poistka zápisov',
      known: healthy(),
      unknown: healthy({ writes: {} }),
    },
    {
      name: 'prítomnosť kľúča',
      known: healthy(),
      unknown: healthy({ apiKey: {} }),
    },
    {
      name: 'platnosť kľúča',
      known: healthy(),
      unknown: healthy({ apiKey: { present: true } }),
    },
    {
      name: 'spotreba rozpočtu',
      known: healthy(),
      unknown: healthy({ writeBudget: { budget: 200 } }),
    },
    {
      name: 'výška rozpočtu',
      known: healthy(),
      unknown: healthy({ writeBudget: { spent: 0 } }),
    },
    {
      name: 'režim rozsahu',
      known: healthy({
        scope: { mode: 'plny', maxProducts: HARD_MAX_PRODUCTS, failClosed: false },
        selection: { selectedCount: 150 },
        catalog: { missingProductIds: [] },
      }),
      unknown: healthy({
        scope: {},
        selection: { selectedCount: 150 },
        catalog: { missingProductIds: [] },
      }),
    },
    {
      name: 'overenie katalógu',
      known: healthy({
        scope: { mode: 'plny', maxProducts: HARD_MAX_PRODUCTS, failClosed: false },
        catalog: { missingProductIds: [] },
      }),
      unknown: healthy({
        scope: { mode: 'plny', maxProducts: HARD_MAX_PRODUCTS, failClosed: false },
        catalog: {},
      }),
    },
    {
      name: 'spotreba čítaní katalógu',
      known: healthy({ catalogReads: { usedThisUtcDay: 0, usedThisMinute: 0 } }),
      unknown: healthy({ catalogReads: {} }),
    },
  ];

  for (const { name, known, unknown } of cases) {
    it(`„neviem" pri ${name} je aspoň také prísne ako známy dobrý stav`, () => {
      const knownWorst = SEVERITY_ORDER[worstSeverity(collectOperationBlockers(known))];
      const unknownWorst = SEVERITY_ORDER[worstSeverity(collectOperationBlockers(unknown))];
      expect(unknownWorst).toBeLessThanOrEqual(knownWorst);
    });

    it(`„neviem" pri ${name} sa prizná príznakom assumed`, () => {
      const knownIds = new Set(ids(collectOperationBlockers(known)));
      const added = collectOperationBlockers(unknown).filter((b) => !knownIds.has(b.id));
      // Nová prekážka smie pribudnúť len ako priznaná domnienka; keď nepribudla
      // žiadna, prísnejšou sa stala niektorá z už existujúcich (kryje to test vyššie).
      expect(added.every((b) => b.assumed)).toBe(true);
    });
  }

  it('neplatný čas expirácie sa berie ako neznámy, nie ako platný kľúč', () => {
    const blockers = collectOperationBlockers(
      healthy({ apiKey: { present: true, expiresAt: new Date('nezmysel') } }),
    );
    expect(byId(blockers, 'key_expired').assumed).toBe(true);
  });

  it('záporné a nezmyselné počty sa berú ako neznáme, nie ako nula', () => {
    const blockers = collectOperationBlockers(
      healthy({ writeBudget: { budget: 200, spent: -5 }, selection: { selectedCount: -1 } }),
    );
    expect(byId(blockers, 'write_budget_exhausted').assumed).toBe(true);
  });
});
