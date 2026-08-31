/**
 * Aura Zľavy — OKNÁ, KTORÉ REBRÍČEK ZVLÁDNE V SQL (V4, drobnosť z 31. 8. 2026).
 *
 * `MIRROR_SORTABLE_WINDOWS` v `api/insights/top-products` bolo ručnou kópiou
 * podmnožiny `ALLOWED_SOLD_WINDOWS` z `catalog.repo.ts`. Dva zoznamy o tej istej
 * veci sa pri prvej zmene ticho rozídu a rebríček by potom pýtal od zrkadla
 * triedenie podľa okna, ktoré zrkadlo zahodí na `DEFAULT_SOLD_WINDOW_DAYS` (180
 * dní) — teda poradie za úplne iné obdobie, než hlása nadpis obrazovky.
 *
 * Tento súbor stráži, že zoznam je DOPOČÍTANÝ prienik a nie kópia.
 */
import { describe, expect, it } from 'vitest';

import { WINDOW_DAYS_ALLOWED } from '@/app/api/insights/_shared';
import { MIRROR_SORTABLE_WINDOWS } from '@/app/api/insights/top-products/route';
import { ALLOWED_SOLD_WINDOWS } from '@/lib/repo/catalog.repo';

describe('MIRROR_SORTABLE_WINDOWS — jediný zdroj pravdy', () => {
  it('je presne prienik okien Prehľadu a okien, ktoré zrkadlo vie triediť', () => {
    const intersection = WINDOW_DAYS_ALLOWED.filter((days) => ALLOWED_SOLD_WINDOWS.includes(days));
    expect([...MIRROR_SORTABLE_WINDOWS]).toEqual([...intersection]);
  });

  it('každé okno v ňom zrkadlo naozaj pozná (inak by triedilo za 180 dní)', () => {
    for (const days of MIRROR_SORTABLE_WINDOWS) {
      expect(ALLOWED_SOLD_WINDOWS).toContain(days);
    }
  });

  it('dnes to je [30, 90] a 7 dní tam nie je — preto cesta B ešte žije', () => {
    expect([...MIRROR_SORTABLE_WINDOWS]).toEqual([30, 90]);
    expect(MIRROR_SORTABLE_WINDOWS).not.toContain(7);
    expect(ALLOWED_SOLD_WINDOWS).not.toContain(7);
  });
});
