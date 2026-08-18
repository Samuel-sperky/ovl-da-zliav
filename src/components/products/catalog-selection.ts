'use client';

/**
 * Aura Zľavy — VÝBER, KTORÝ PREŽIJE PRECHOD MEDZI TABMI (kontrakt UI, bod 17).
 *
 * Čo rieši
 * ────────
 * „Výber sa drží, kým ho človek nezruší." Naklikané riadky sú ale stav Reactu
 * a tab je vlastná stránka — odskok na Prehľad komponent odpojí a s ním zmizne
 * aj výber. Tento modul ho preto odloží do `sessionStorage` a pri návrate ho
 * podá späť.
 *
 * Čo sa v ňom nesmie pokaziť a prečo
 * ──────────────────────────────────
 *  1. **Výber patrí k OTÁZKE, na ktorú bol naklikaný.** Ukladá sa spolu
 *     s kľúčom filtra a vracia sa LEN vtedy, keď na obrazovke platí tá istá
 *     otázka. Inak by sa do zľavy dostali kusy, na ktoré sa už nikto nepozeral
 *     — presne to, čo `CatalogPanel` bráni pri zmene filtra.
 *  2. **Adresa má prednosť pred pamäťou.** Odkaz z Prehľadu vedie na jeden
 *     konkrétny výber; keby ho prebila uložená otázka, odkaz by prestal
 *     fungovať. Uložená otázka sa preto obnoví IBA vtedy, keď adresa žiadnu
 *     nenesie (čiže je predvolená).
 *  3. **Relácia, nie trvalé úložisko.** `sessionStorage` žije, kým žije karta
 *     prehliadača. Týždeň starý výber by ukazoval na katalóg, ktorý sa medzitým
 *     dvakrát presynchronizoval — a to by už nebol ten istý výber.
 *  4. **Radšej nič než polovica.** Keď je uložených čísel neúnosne veľa alebo
 *     je obsah úložiska cudzí či poškodený, modul vráti prázdno. Skrátený
 *     zoznam by bol tichá lož o tom, čo je vybraté.
 *
 * Hromadný výber („vybrať všetkých 11 640") sa NEROZBAĽUJE do zoznamu — ukladá
 * sa ako príznak nad tým istým filtrom, rovnako ako v obrazovke.
 *
 * Modul nikdy nespadne: zakázané úložisko, plná kvóta ani cudzí obsah nesmú
 * zhodiť render.
 *
 * Vlastník: V15 (hľadanie a tabuľka).
 */
import type { CatalogFilterState } from '@/components/products/catalog-filter';
import {
  catalogFilterKey,
  DEFAULT_CATALOG_FILTER,
  parseCatalogFilterQuery,
} from '@/components/products/catalog-filter';

const STORAGE_KEY = 'aura.produkty.vyber.v1';

/**
 * Strop uložených čísel. Ručne sa toľko riadkov naklikať nedá — hromadný výber
 * ide príznakom, nie zoznamom — takže prekročenie znamená poškodený obsah.
 */
const MAX_STORED_IDS = 20_000;

/** Čo o výbere leží v úložisku. `filter` je `catalogFilterKey()`. */
export interface StoredSelection {
  readonly filter: string;
  readonly productIds: readonly number[];
  readonly allMatching: boolean;
}

/** Čo z toho obrazovka dostane pri otvorení. */
export interface RestoredSelection {
  readonly filter: CatalogFilterState;
  readonly productIds: readonly number[];
  readonly allMatching: boolean;
}

function isStoredSelection(value: unknown): value is StoredSelection {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (typeof row.filter !== 'string' || typeof row.allMatching !== 'boolean') return false;
  if (!Array.isArray(row.productIds)) return false;
  if (row.productIds.length > MAX_STORED_IDS) return false;
  return row.productIds.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0);
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    // Prehliadač so zakázaným úložiskom — obrazovka beží ďalej, len bez pamäti.
    return null;
  }
}

export function readSelection(): StoredSelection | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Prázdny výber sa neukladá — zapamätaná nula by len prežila svoju platnosť. */
export function writeSelection(selection: StoredSelection): void {
  const store = storage();
  if (store === null) return;
  if (!selection.allMatching && selection.productIds.length === 0) {
    forgetSelection();
    return;
  }
  if (selection.productIds.length > MAX_STORED_IDS) {
    forgetSelection();
    return;
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    /* plné alebo zakázané úložisko — výber prežije len v tejto obrazovke */
  }
}

export function forgetSelection(): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* zakázané úložisko — nie je čo zabúdať */
  }
}

/**
 * Čo platí pri otvorení obrazovky. Čistá funkcia — úložisko sa jej podáva,
 * aby sa dala overiť bez prehliadača.
 *
 * Tri prípady a každý má iný záver:
 *
 *  · adresa nesie TÚ ISTÚ otázku ako uložený výber → výber sa vráti,
 *  · adresa nenesie žiadnu otázku (je predvolená) → vráti sa aj otázka, aj
 *    výber; bez otázky by výber ukazoval na riadky, ktoré nie sú vidieť,
 *  · adresa nesie INÚ otázku → odkaz vyhráva a výber sa zahodí.
 */
export function restoreSelection(
  initial: CatalogFilterState,
  stored: StoredSelection | null,
): RestoredSelection {
  const empty: RestoredSelection = { filter: initial, productIds: [], allMatching: false };
  if (stored === null) return empty;

  const here = catalogFilterKey(initial);
  if (here === stored.filter) {
    return { filter: initial, productIds: stored.productIds, allMatching: stored.allMatching };
  }

  if (here === catalogFilterKey(DEFAULT_CATALOG_FILTER)) {
    const restored = parseCatalogFilterQuery(stored.filter);
    return {
      // Stránka a poradie do kľúča nepatria, takže sa berú z obrazovky:
      // vracať sa treba k tej istej OTÁZKE, nie k tej istej stránke.
      filter: { ...restored, page: 1, perPage: initial.perPage, sort: initial.sort },
      productIds: stored.productIds,
      allMatching: stored.allMatching,
    };
  }

  return empty;
}
