/**
 * Aura Zľavy — ZAMKNUTÉ ROZMERY SÚ NA JEDNOM MIESTE (D125, K4; 1. 9. 2026).
 *
 * PREČO TENTO SÚBOR VZNIKOL
 * ─────────────────────────
 * D125 vyradilo maržu, sklad a celkovo objednané zo zamknutých filtrov —
 * obrazovka Produkty podľa nich naozaj filtruje (`CatalogFilters.tsx`,
 * `catalog.repo.ts`). Sprievodca novej zľavy o tom nevedel a ďalej kreslil
 * zámky nad `marža` a `obrátkovosť` s vetou „Čaká na dáta zo shopu". Overovateľ
 * to našiel ako protirečenie: Samuel si na Produktoch vyfiltruje „marža < 20 %",
 * klikne „Vytvoriť zľavu" a tá istá appka mu povie, že na maržu dáta nemá.
 *
 * ČO SA TU MERIA
 * ──────────────
 *  A. Zoznam zamknutých rozmerov je ÚPLNÝ a má práve tie tri, ktoré nemajú
 *     stĺpce v zrkadle (typ `LockedCatalogFilter`).
 *  B. Sprievodca kreslí PRÁVE ich — a marža ani obrátkovosť medzi nimi nie sú.
 *  C. Filter, ktorý Produkty NAOZAJ aplikujú, sa nesmie objaviť ako zámok.
 *     Meria sa to proti `describeCatalogFilter()`, teda proti tomu, čo appka
 *     o svojich vlastných filtroch hovorí — nie proti literálu v teste.
 *
 * Vlastník: V5 (zelená brána).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import NewDiscount, { type NewDiscountInitial } from '@/components/campaigns/NewDiscount';
import styles from '@/components/campaigns/new-discount.module.css';
import { DEFAULT_CATALOG_FILTER } from '@/components/products/catalog-filter';
import { describeCatalogFilter } from '@/components/products/catalog-filter';
import {
  LOCKED_DIMENSIONS,
  LOCKED_DIMENSION_LABEL,
  LOCKED_DIMENSION_REASON,
  lockedDimensionLabels,
} from '@/lib/ui/locked-dimensions';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Zdroj bez komentárov — veta o starom literáli nie je starý literál. */
const bezKomentarov = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const INITIAL: NewDiscountInitial = {
  productIds: null,
  filter: DEFAULT_CATALOG_FILTER,
  expectedTotal: null,
  window: null,
};

const sprievodca = (): string =>
  renderToStaticMarkup(createElement(NewDiscount, { initial: INITIAL }));

/* ═════════ A. Zoznam je úplný a je jeden ══════════════════════════════════ */

describe('A. zamknuté rozmery majú jeden zoznam', () => {
  it('zoznam pokrýva každý rozmer, ktorý má meno — a nič navyše', () => {
    /* `Record<LockedCatalogFilter, string>` vynúti úplnosť už pri preklade;
       toto je druhá závora na to isté, aby zoznam nezaostal za slovníkom. */
    expect([...LOCKED_DIMENSIONS].sort()).toEqual(Object.keys(LOCKED_DIMENSION_LABEL).sort());
    expect(LOCKED_DIMENSIONS).toHaveLength(3);
  });

  it('mená sú tri a marža ani obrátkovosť medzi nimi NIE SÚ', () => {
    const labels = lockedDimensionLabels();
    expect(labels).toEqual(['kategória', 'kov', 'typ šperku']);
    expect(labels.join(' ')).not.toMatch(/marž|obrátkovosť|sklad|objednan/i);
  });

  it('dôvod NESĽUBUJE, že to príde zo shopu', () => {
    /* Stará veta znela „Čaká na dáta zo shopu" — to je sľub, ktorý nikto nedal:
       chýbajú STĹPCE v zrkadle a rozhodnutie, ako ich napĺňať. */
    expect(LOCKED_DIMENSION_REASON).toContain('zrkadle katalógu');
    expect(LOCKED_DIMENSION_REASON).not.toContain('Čaká na dáta zo shopu');
  });
});

/* ═════════ B. Sprievodca kreslí presne ten zoznam ═════════════════════════ */

describe('B. výber do zľavy kreslí zámky z toho istého zoznamu', () => {
  const html = sprievodca();

  /*
   * KOTVY PRESMEROVANÉ 2. 9. 2026 (V6b). Zámok sprievodcu kreslila globálna
   * trieda `chip lock` a dôvod nesol `title=`. Po prevode obrazovky na
   * primitíva (D139, D143) ho kreslí `styles.lockChip` z vlastného CSS modulu
   * sprievodcu a DÔVOD sa presunul z `title` do viditeľnej vety (`LockBadge`,
   * `data-testid="locked-dimensions"`) — tooltip sa na dotykovom zariadení
   * prečítať nedá a priznanie „nevieme" sa schovať nesmie (I11).
   *
   * MERIA SA TO ISTÉ, len na novom mieste: že každý zamknutý rozmer má na
   * obrazovke zámok, a že dôvod je na obrazovke tiež. Trieda sa berie
   * z modulu, nie z literálu, takže sa s implementáciou nemá ako rozísť —
   * a `chip lock` sa už NESLEDUJE zámerne: mŕtvy selektor je zelený test.
   * Že tá trieda v module naozaj existuje, stráži
   * `test/unit/nova-zlava-selektory.spec.ts` skupina A.
   */
  const lockChip = (styles as Record<string, string>)['lockChip'] as string;

  it('každý zamknutý rozmer je v sprievodcovi vidieť ako zámok', () => {
    expect(lockChip, 'trieda zámku sa z modulu neprečítala').toBeTruthy();
    for (const label of lockedDimensionLabels()) {
      const at = html.indexOf(`${label}</span>`);
      expect(at, `zámok „${label}" v sprievodcovi chýba`).toBeGreaterThan(-1);
      // Rez od otvorenia hostiteľského `<span>`: trieda aj ikona zámku musia
      // byť V ŇOM (tri kanály — okraj, ikona, meno rozmeru).
      const od = html.lastIndexOf(`class="${lockChip}"`, at);
      expect(od, `„${label}" nie je v hostiteľovi so triedou zámku`).toBeGreaterThan(-1);
      expect(html.slice(od, at), `„${label}" je zámok bez značky`).toContain('<svg');
    }
  });

  it('dôvod zámku je VETA na obrazovke, nie tooltip', () => {
    expect(html).toContain('data-testid="locked-dimensions"');
    expect(html).toContain(LOCKED_DIMENSION_REASON);
    // A nie je to `title=` — to bola pôvodná, na dotyku nečitateľná podoba.
    expect(html).not.toContain(`title="${LOCKED_DIMENSION_REASON}"`);
  });

  it('marža ani obrátkovosť už NIE SÚ zamknuté — Produkty podľa nich filtrujú', () => {
    /*
     * Meria sa OBSAH riadku zámkov, nie neprítomnosť starého literálu:
     * `not.toContain` nad reťazcom, ktorý sa už vykresliť nemôže, je presne
     * ten mŕtvy selektor, čo v Produktoch prežil mesiac ako zelený test.
     */
    const od = html.indexOf(`class="${lockChip}"`);
    expect(od, 'riadok zámkov sa nevykreslil').toBeGreaterThan(-1);
    const riadok = html.slice(od, html.indexOf('data-testid="locked-dimensions"', od));
    for (const zrusene of ['marža', 'obrátkovosť', 'sklad', 'objednan']) {
      expect(riadok, `„${zrusene}" sa už nesmie kresliť ako zámok`).not.toContain(zrusene);
    }
    // A stará veta o čakaní na shop zmizla úplne.
    expect(html).not.toContain('Čaká na dáta zo shopu');
  });

  it('sprievodca si zoznam nedrží vo vlastnej kópii', () => {
    const src = bezKomentarov('../../src/components/campaigns/NewDiscount.tsx');
    expect(src).toContain('lockedDimensionLabels()');
    expect(src).not.toMatch(/lockedChips\s*=\s*\[/);
  });
});

/* ═════════ C. Zámok a funkčný filter sa nesmú prekryť ════════════════════ */

describe('C. čo Produkty naozaj filtrujú, nesmie byť zamknuté', () => {
  it('žiadny zámok nepomenúva rozmer, na ktorý má appka funkčný filter', () => {
    /*
     * `describeCatalogFilter()` je to, čo appka o SVOJICH filtroch hovorí —
     * jedna veta na jednu aktívnu podmienku. Keby sa niektorý zámok volal tak
     * ako niektorá z tých viet, appka by tvrdila dve opačné veci naraz.
     */
    const chips = describeCatalogFilter({
      ...DEFAULT_CATALOG_FILTER,
      marginPercentFrom: '30',
      stock: 'in',
      orderedTotalFrom: '5',
      lastSaleOlderDays: 180,
      priceFrom: '10',
    });
    expect(chips.length).toBeGreaterThan(0);
    for (const zamok of lockedDimensionLabels()) {
      /* Meno rozmeru ako CELÉ SLOVO — „kov" je podreťazcom slova „celkovo"
         a podreťazcová zhoda by z tohto testu spravila náhodu. */
      const slovo = new RegExp(`(^|[^\\p{L}])${zamok}([^\\p{L}]|$)`, 'iu');
      for (const chip of chips) {
        expect(slovo.test(chip), `„${zamok}" je zamknuté aj filtrovateľné: ${chip}`).toBe(false);
      }
    }
  });
});
