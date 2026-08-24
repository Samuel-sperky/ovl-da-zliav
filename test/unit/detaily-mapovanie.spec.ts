/**
 * Aura Zľavy — ZHODA WIRE TYPU S REPOZITÁROM.
 *
 * `extras-api.ts` prekladá odpoveď `/api/catalog/details` na to, čo kreslí
 * detail produktu. Trasa vracia `CatalogDetailRow` z repozitára doslova, takže
 * jej `full` je `CatalogFullDetail` — ale komponenty z `@/lib/repo/`
 * neimportujú, tak si `extras-api.ts` drží vlastné zrkadlo `WireFull`.
 *
 * DVE ZRKADLÁ SA RAZ ROZÍDU, AK ICH NIČ NEDRŽÍ. Presne to sa už stalo: `full`
 * bol `Record<string, unknown>` a čítalo sa z neho voľnými reťazcami, takže
 * kompilátor nemal čo skontrolovať a osem čítaní bolo zlých — `wholesalePrice`
 * namiesto `purchasePrice`, `priceWithTax` namiesto `sellPriceWithVat`,
 * `addedAt` namiesto `dateAdd`, `lastOrderedAt` namiesto `lastTimeInOrder`,
 * `orderedTotal` namiesto `qtyInOrders`, kategórie čítané ako reťazce namiesto
 * ID, a `description` so `shortDescription` z bloku, ktorý ich nikdy neniesol.
 *
 * Bez oprávnenia `product:read` je `full` vždy `null`, takže na obrazovke to
 * nebolo vidieť ani sekundu — a v deň, keď kľúč pribudne, by appka o ôsmich
 * existujúcich hodnotách tvrdila „nemá". To je horšie než mlčať.
 *
 * Tento súbor je preto z väčšiny typová kontrola, nie behový test. Keď sa
 * `CatalogFullDetail` zmení a `WireFull` nie, padne `npx tsc`, nie až oko.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CatalogFullDetail } from '@/lib/repo/catalog.repo';

/**
 * Zrkadlo z `extras-api.ts`. Prepísané, nie importované — tam je zámerne
 * neexportované, aby ho nikto nepoužil ako verejný typ. Že sa táto kópia
 * zhoduje so zdrojom, drží test „zrkadlo sedí so súborom" nižšie.
 */
interface WireFull {
  readonly purchasePrice: number | null;
  readonly margin: number | null;
  readonly marginPercent: number | null;
  readonly sellPrice: number | null;
  readonly sellPriceWithVat: number | null;
  readonly active: boolean | null;
  readonly dateAdd: string | null;
  readonly lastTimeInOrder: string | null;
  readonly qtyInOrders: number | null;
  readonly supplier: string | null;
  readonly categories: readonly number[] | null;
}

/** Chyba prekladu, ak `A` a `B` nie sú ten istý typ. */
type Rovnake<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : never;

/*
 * TOTO JE TO TVRDENIE. Keď sa typy rozídu, `npx tsc` padne na tomto riadku
 * a povie meno súboru — behový test by to nechytil, lebo typy v behu nie sú.
 */
const ZHODA: Rovnake<WireFull, CatalogFullDetail> = true;

const PREKLAD = resolve(process.cwd(), 'src/components/products/extras-api.ts');
const TENTO = resolve(process.cwd(), 'test/unit/detaily-mapovanie.spec.ts');

/** Polia bloku `interface WireFull` z ľubovoľného zdroja, zoradené. */
function poliaZrkadla(zdroj: string): readonly string[] {
  const zaciatok = zdroj.indexOf('interface WireFull {');
  expect(zaciatok, 'blok `interface WireFull` sa nenašiel').toBeGreaterThanOrEqual(0);

  const telo = zdroj.slice(zaciatok);
  const koniec = telo.indexOf('\n}');
  expect(koniec, 'blok `interface WireFull` sa nikde nekončí').toBeGreaterThan(0);

  return telo
    .slice(0, koniec)
    .split('\n')
    .map((riadok) => riadok.trim())
    .filter((riadok) => riadok.startsWith('readonly '))
    .map((riadok) => riadok.replace(/;$/, ''))
    .sort();
}

describe('preklad detailu produktu sedí s tým, čo posiela repozitár', () => {
  it('WireFull a CatalogFullDetail sú ten istý typ', () => {
    expect(ZHODA).toBe(true);
  });

  it('zrkadlo v tomto teste sedí so zrkadlom v extras-api.ts', () => {
    /*
     * Bez tohto by test strážil zhodu dvoch typov, z ktorých jeden appka
     * nepoužíva: niekto opraví `extras-api.ts`, na kópiu tu zabudne, a test
     * naďalej hlási zelenú o niečom, čo už nie je pravda.
     */
    const tu = poliaZrkadla(readFileSync(TENTO, 'utf8'));
    expect(tu.length, 'zrkadlo je prázdne — nič sa nenašlo').toBeGreaterThan(0);
    expect(poliaZrkadla(readFileSync(PREKLAD, 'utf8'))).toEqual(tu);
  });

  it('preklad nečíta z bloku spoza kľúča nič, čo v ňom nie je', () => {
    /*
     * `text()`, `num()` aj `money()` berú `keyof WireFull`, takže zlé meno je
     * dnes chyba prekladu. Toto stráži práve to zúženie — keby sa kľúč vrátil
     * na voľný `string`, kompilátor by zase mlčal a chyba by sa vrátila celá.
     */
    const zdroj = readFileSync(PREKLAD, 'utf8');
    for (const meno of ['text', 'num', 'money']) {
      expect(zdroj, `${meno}() nečíta cez keyof WireFull`).toContain(
        `const ${meno} = (key: keyof WireFull)`,
      );
    }
    expect(zdroj, 'niekde sa ešte indexuje voľným reťazcom').not.toContain('(key: string)');
  });

  it('polia, ktoré repozitár nenesie, sú priznane null a nečítajú sa', () => {
    /*
     * Popis a skutočná zľava v eshope v `CatalogFullDetail` nie sú. Čítať ich
     * odtiaľ znamená vždy `null`, len to nie je vidieť. Priznané `null` sa dá
     * prečítať a opraviť; tiché `text('description')` nie.
     */
    const zdroj = readFileSync(PREKLAD, 'utf8');
    for (const pole of ['description', 'shortDescription', 'shopDiscountPercent']) {
      expect(zdroj, `${pole} sa ešte číta z bloku spoza kľúča`).not.toContain(`'${pole}'`);
    }
  });
});
