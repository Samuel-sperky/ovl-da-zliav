/**
 * Aura Zľavy — JEDEN ZOZNAM ZAMKNUTÝCH ROZMEROV (D125, K4; 1. 9. 2026).
 *
 * PREČO TENTO MODUL VZNIKOL
 * -------------------------
 * D125 vyradilo maržu, sklad a celkovo objednané zo zamknutých filtrov: dáta
 * na ne appka po migrácii 0014 (`getFull`) MÁ a obrazovka Produkty podľa nich
 * naozaj filtruje. Sprievodca novej zľavy o tom nevedel a ďalej kreslil zámok
 * s vetou „Čaká na dáta zo shopu" nad maržou aj obrátkovosťou — takže tá istá
 * appka na jednej obrazovke podľa marže filtrovala a na druhej tvrdila, že ju
 * nemá. Overovateľ to našiel ako protirečenie K4.
 *
 * Zoznam preto žije NA JEDNOM MIESTE a odvodzuje sa od typu
 * `LockedCatalogFilter` z repozitára (`lib/repo/catalog.repo.ts`), ktorý je
 * jediným vlastníkom otázky „na čo appka dáta NEMÁ". `Record<LockedCatalogFilter, …>`
 * je tu zámerne: keď z toho typu niekto rozmer pridá alebo odoberie, tento
 * modul PRESTANE SA KOMPILOVAŤ — a nie je to grep, ktorý sa dá obísť.
 *
 * `import type` je erasovaný pri preklade, takže sa `mariadb` do prehliadača
 * nedostane; kód repozitára sa sem neťahá.
 *
 * ČO TENTO MODUL NEROBÍ
 * ---------------------
 * Nerozhoduje, či je rozmer zamknutý — to hovorí repozitár. Iba mu dáva meno
 * v slovenčine a jednu vetu prečo, aby ich obrazovky nemali každá vlastné.
 *
 * Vlastník: V5 (zelená brána).
 */
import type { LockedCatalogFilter } from '@/lib/repo/catalog.repo';

/**
 * Rozmery, na ktoré appka nemá stĺpce v zrkadle katalógu.
 *
 * Poradie je záväzné — je to poradie, v akom sa kreslia zámky, a dve obrazovky
 * s tými istými zámkami v inom poradí sa porovnať nedajú.
 */
export const LOCKED_DIMENSIONS: readonly LockedCatalogFilter[] = [
  'category',
  'metal',
  'jewelryType',
];

/** Meno rozmeru v slovenčine. Úplnosť vynucuje typecheck, nie disciplína. */
export const LOCKED_DIMENSION_LABEL: Readonly<Record<LockedCatalogFilter, string>> = {
  category: 'kategória',
  metal: 'kov',
  jewelryType: 'typ šperku',
};

/**
 * Prečo je rozmer zamknutý — jedna veta pre všetky tri.
 *
 * Je to iná veta než „čaká na dáta zo shopu": shop tie údaje čiastočne dáva,
 * chýbajú STĹPCE v zrkadle katalógu a rozhodnutie, ako ich napĺňať. Sľubovať
 * „príde to zo shopu" by bol sľub, ktorý nikto nedal.
 */
export const LOCKED_DIMENSION_REASON =
  'Appka na tento rozmer nemá dáta v zrkadle katalógu, takže sa podľa neho ' +
  'nedá ani filtrovať, ani deliť. Nie je to prázdny výsledok — je to nevedomosť.';

/** Zamknuté rozmery pomenované, v záväznom poradí. */
export function lockedDimensionLabels(): readonly string[] {
  return LOCKED_DIMENSIONS.map((dimension) => LOCKED_DIMENSION_LABEL[dimension]);
}

/**
 * Kód rozmeru z odpovede servera → meno. `null` = odpoveď menuje rozmer, ktorý
 * tento slovník nepozná.
 *
 * Vymyslené meno sa NEDOSADÍ a surový kód sa na povrch NEVYPÍŠE: `metal` nie je
 * veta pre človeka a „neznámy rozmer" by tvrdil o zámku niečo, čo o ňom appka
 * nevie. Nová položka na serveri sa preto prejaví ako chýbajúci zámok — a to
 * spadne na `Record<LockedCatalogFilter, …>` už pri preklade.
 */
export function lockedDimensionName(dimension: string): string | null {
  return Object.prototype.hasOwnProperty.call(LOCKED_DIMENSION_LABEL, dimension)
    ? LOCKED_DIMENSION_LABEL[dimension as LockedCatalogFilter]
    : null;
}
