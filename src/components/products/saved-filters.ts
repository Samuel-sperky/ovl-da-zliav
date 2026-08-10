'use client';

/**
 * Aura Zľavy — uložené filtre tabu Produkty (V10; architektúra §1).
 *
 * „Uložené výbery" sú podľa odpovede 92 uložené **filtre**, nie zoznamy čísel
 * produktov: katalóg sa mení každú noc a zoznam ID by o týždeň ukazoval iné
 * kusy, než si používateľ uložil. Ukladá sa preto query string filtra.
 *
 * Prečo prehliadač a nie databáza: appka pre uložené filtre zatiaľ nemá API
 * (V8 ho nedodával) a vymyslieť si tabuľku by znamenalo siahnuť do cudzieho
 * súboru. Uloženie v prehliadači je poctivé — je to lokálna appka na jednom
 * počítači — a keď server-side úložisko pribudne, mení sa len tento modul.
 *
 * Modul nikdy nespadne: rozbitý alebo cudzí obsah úložiska sa číta ako prázdny
 * zoznam, nie ako výnimka uprostred renderu.
 *
 * Vlastník: V10.
 */

const STORAGE_KEY = 'aura.produkty.filtre.v1';

/** Viac než desať čipov sa nad filtre nezmestí a nikto ich nečíta. */
const MAX_SAVED = 10;

export interface SavedFilter {
  /** Meno, ktoré napísal používateľ. */
  readonly name: string;
  /** Query string filtra bez stránkovania (`catalogFilterKey`). */
  readonly query: string;
}

function isSavedFilter(value: unknown): value is SavedFilter {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === 'string' && typeof row.query === 'string' && row.name.trim() !== '';
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    // Prehliadač so zakázaným úložiskom — appka funguje ďalej, len bez čipov.
    return null;
  }
}

export function readSavedFilters(): SavedFilter[] {
  const store = storage();
  if (store === null) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedFilter).slice(0, MAX_SAVED);
  } catch {
    return [];
  }
}

function write(rows: readonly SavedFilter[]): SavedFilter[] {
  const store = storage();
  const capped = rows.slice(0, MAX_SAVED);
  if (store !== null) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(capped));
    } catch {
      /* plné alebo zakázané úložisko — čipy sa neuložia, obrazovka beží ďalej */
    }
  }
  return capped;
}

/** Uloží filter pod menom; rovnaké meno prepíše, nový ide na začiatok. */
export function saveFilter(name: string, query: string): SavedFilter[] {
  const trimmed = name.trim().slice(0, 40);
  if (trimmed === '') return readSavedFilters();
  const rest = readSavedFilters().filter((row) => row.name !== trimmed);
  return write([{ name: trimmed, query }, ...rest]);
}

export function removeFilter(name: string): SavedFilter[] {
  return write(readSavedFilters().filter((row) => row.name !== name));
}
