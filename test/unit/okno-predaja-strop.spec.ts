/**
 * Aura Zľavy — STROP OKNA PREDAJA JE ODVODENÝ, NIE NAPÍSANÝ (D149, K9).
 *
 * Čo sa tu bráni
 * --------------
 * `SALES_WINDOW_DAYS` mal do 3. 9. 2026 strop **90**, kým prepínač okna
 * predajnosti ponúkal `[30, 60, 90, 180, 360]`. Appka teda mala filter na
 * obdobia, za ktoré nikdy nemohla stiahnuť ani jeden deň — pasca D125 („filter
 * bez dátového zdroja je sľub, ktorý appka nedodrží"). Zdvihnutie stropu samo
 * o sebe nestačí: kým to isté číslo žije na dvoch miestach, rozíde sa pri prvej
 * zmene (v tomto repe to už raz urobil `MAX_DAILY_WRITE_BUDGET` — `budget.ts`
 * prijal 1000, repozitár tú istú hodnotu odmietol ako „musí byť 1–200").
 *
 * Tento súbor preto dokazuje TROJKU:
 *  A. strop v ENV je 360 a `361` je odmietnuté (K9 prvá polovica),
 *  B. `src/env.ts` to číslo NEOBSAHUJE ako literál — číta sa ako TEXT, lebo
 *     odvodenie sa inak dokázať nedá (K9 druhá polovica, „nikde ručne"),
 *  C. každý ďalší zoznam tých istých okien sa so zdrojom ZHODUJE — a `SOLD_WINDOWS`
 *     vo filtri Produktov ho ODVODZUJE, nemá vlastný literál. Do 3. 9. 2026 to
 *     bola posledná ručná kópia zoznamu v repe (kvôli literálovému typu
 *     `SoldWindow`, ktorý však nesie už `as const` v zdroji). Meria sa to
 *     dvakrát — hodnotami aj ČITANÍM ZDROJA — lebo samotné hodnoty by nestačili:
 *     dve kópie sú v deň vzniku vždy rovnaké a rozídu sa až pri prvej zmene,
 *     a rozchod tu nezastaví kompilátor — zastaví ho tento test.
 *
 * Mutačne overené: zmena stropu na 90 zhodí A, návrat literálu do `env.ts`
 * zhodí B, odobranie 360 z ktoréhokoľvek zoznamu aj návrat literálu do
 * `catalog-filter.ts` zhodí C. Ani jedna z tých mutácií nezhodí celý súbor.
 *
 * Vlastník: V7 (D149, dátová cesta okna 180/360).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseEnv } from '@/env';
import { soldWindowQuery } from '@/app/api/insights/_shared';
import { ALLOWED_SOLD_WINDOWS } from '@/lib/repo/catalog.repo';
import {
  MAX_SALES_WINDOW_DAYS,
  SOLD_WINDOW_CHOICES,
  isSoldWindowDays,
} from '@/lib/sales/windows';
import { LAST_SALE_WINDOWS, SOLD_WINDOWS } from '@/components/products/catalog-filter';

const ENV_SOURCE = readFileSync(
  fileURLToPath(new URL('../../src/env.ts', import.meta.url)),
  'utf8',
);

const CATALOG_FILTER_SOURCE = readFileSync(
  fileURLToPath(new URL('../../src/components/products/catalog-filter.ts', import.meta.url)),
  'utf8',
);

/** Komentáre von — docblocky v tomto repe o starých hodnotách zámerne píšu. */
const bezKomentarov = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1 ');

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    DB_PASSWORD: 'test_app_password',
    DB_MIGRATION_PASSWORD: 'test_mig_password',
    ...overrides,
  };
}

/* ═══════════ A. Strop prijme najdlhšie okno a nič nad ním ═════════════════ */

describe('A — SALES_WINDOW_DAYS prijme celé najdlhšie okno (D149)', () => {
  it('360 je platná hodnota', () => {
    const result = parseEnv(baseEnv({ SALES_WINDOW_DAYS: '360' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.SALES_WINDOW_DAYS).toBe(360);
  });

  it('361 je odmietnuté — strop je strop, nie odporúčanie', () => {
    const result = parseEnv(baseEnv({ SALES_WINDOW_DAYS: '361' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((p) => p.startsWith('SALES_WINDOW_DAYS'))).toBe(true);
    }
  });

  it('default zostáva 3 dni — zdvihnutý strop nie je zapnuté sťahovanie', () => {
    const result = parseEnv(baseEnv());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.SALES_WINDOW_DAYS).toBe(3);
  });

  it('strop sa rovná najdlhšiemu oknu, ktoré appka ponúka', () => {
    expect(MAX_SALES_WINDOW_DAYS).toBe(Math.max(...SOLD_WINDOW_CHOICES));
    const result = parseEnv(baseEnv({ SALES_WINDOW_DAYS: String(MAX_SALES_WINDOW_DAYS) }));
    expect(result.ok).toBe(true);
  });
});

/* ═══════════ B. V `env.ts` to číslo nie je napísané ═══════════════════════ */

describe('B — strop nie je v env.ts literál (K9: „nikde nie je napísané ručne")', () => {
  it('riadok SALES_WINDOW_DAYS berie strop z MAX_SALES_WINDOW_DAYS', () => {
    const line = ENV_SOURCE.split('\n').find((row) => row.includes('SALES_WINDOW_DAYS:'));
    expect(line).toBeDefined();
    expect(line).toContain('max: MAX_SALES_WINDOW_DAYS');
    // Ani stará, ani nová hodnota sa v tom riadku nesmie vyskytnúť ako číslo.
    expect(line).not.toMatch(/max:\s*\d/);
  });

  it('modul so zdrojom je LIST — inak by import v env.ts vyrobil cyklus', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/lib/sales/windows.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});

/* ═══════════ C. Zoznamy tých istých okien sa nesmú rozísť ════════════════ */

describe('C — jeden zdroj okien predajnosti', () => {
  it('zrkadlo katalógu triedi presne tie okná, ktoré sú v zdroji', () => {
    expect([...ALLOWED_SOLD_WINDOWS]).toEqual([...SOLD_WINDOW_CHOICES]);
  });

  it('prepínač v UI ponúka presne tie okná, ktoré vie appka naplniť', () => {
    expect([...SOLD_WINDOWS]).toEqual([...SOLD_WINDOW_CHOICES]);
    for (const days of SOLD_WINDOWS) {
      expect(days).toBeLessThanOrEqual(MAX_SALES_WINDOW_DAYS);
    }
  });

  it('vo filtri Produktov nestojí literál zoznamu — inak sú to dve kópie', () => {
    /*
     * Zhoda hodnôt vyššie nestačí: dve ručné kópie sú v deň vzniku vždy rovnaké.
     * Rozchod nastane až pri prvej zmene, takže sa musí brániť SAMA MOŽNOSŤ
     * druhej kópie — rovnako, ako to robí bod B pre `env.ts`.
     */
    const kod = bezKomentarov(CATALOG_FILTER_SOURCE);
    expect(kod).toContain("from '@/lib/sales/windows'");
    expect(kod).toContain('SOLD_WINDOW_CHOICES');
    // Ani zoznam v hranatých zátvorkách…
    expect(/\[\s*30\s*,\s*60\s*,/.test(kod), 'zoznam okien je tu prepísaný ručne').toBe(false);
    // …ani okno, ktoré do modulu nemá iný dôvod prísť než ten zoznam. (30, 90,
    // 180 a 360 tu stáť smú: predvolené okno filtra a `LAST_SALE_WINDOWS`.)
    expect(/\b60\b/.test(kod), 'okno 60 je v module napísané ručne').toBe(false);
    // A rozpoznávač je ten istý, nie druhé `includes()` o tom istom zozname.
    expect(kod).toContain('isSoldWindowDays');
  });

  it('„posledný predaj starší než" nesľubuje viac, než sa dá stiahnuť', () => {
    for (const days of LAST_SALE_WINDOWS) {
      expect(days).toBeLessThanOrEqual(MAX_SALES_WINDOW_DAYS);
    }
  });

  it('rozpoznávač okna je fail-closed', () => {
    expect(isSoldWindowDays(360)).toBe(true);
    expect(isSoldWindowDays(180)).toBe(true);
    expect(isSoldWindowDays(45)).toBe(false);
    expect(isSoldWindowDays(361)).toBe(false);
  });
});

/* ═══════════ D. Čítacia route to okno naozaj prijme ══════════════════════ */

describe('D — `?long=` prijme 180 a 360, nič medzi tým', () => {
  it('180 a 360 prejdú', () => {
    expect(soldWindowQuery.parse('180')).toBe(180);
    expect(soldWindowQuery.parse('360')).toBe(360);
  });

  it('45 dní je chyba, nie tichý fallback na 90', () => {
    expect(soldWindowQuery.safeParse('45').success).toBe(false);
  });

  it('bez parametra je `undefined` — route si doplní svoje predvolené okno', () => {
    expect(soldWindowQuery.parse(undefined)).toBeUndefined();
  });
});
