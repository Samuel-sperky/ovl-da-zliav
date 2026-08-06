'use client';

/**
 * Aura Zľavy — sady produktov pre drawer novej kampane (plán 33 §5 C3;
 * skratky z plánu 32, otázka 12: pomenované sady + „posledná sada").
 *
 * Úložisko je `localStorage` prehliadača — VEDOMÉ rozhodnutie:
 *  - plán 32 §B4 počítal s DB tabuľkou + API (`/api/product-sets`), tie však
 *    nikdy nevznikli a nie sú vo vlastníctve C3 (§5 plánu 33). Sada je čisto
 *    UI pohodlie — jej strata nič nepokazí a nič necitlivé sa neukladá:
 *    len ID produktov, percento a názov sady (žiadny kľúč — I1, žiadne
 *    zákaznícke dáta — I8).
 *  - keď API sád raz vznikne, vymení sa len tento modul (rovnaké rozhranie).
 *
 * Sada NIKDY neobchádza allowlist: drawer prienik s aktuálnym allowlistom
 * robí pri každom použití — ID mimo allowlistu sa ticho vynechajú a UI to
 * povie vetou (fail-closed výber, I2 vynucuje server tak či tak).
 */

export interface ProductSet {
  name: string;
  productIds: number[];
  percent: number | null;
  savedAt: string;
}

const LAST_KEY = 'ovl.campaign.lastSet.v1';
const NAMED_KEY = 'ovl.campaign.namedSets.v1';
export const MAX_NAMED_SETS = 12;

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isValidSet(value: unknown): value is ProductSet {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    Array.isArray(v.productIds) &&
    v.productIds.every((id) => Number.isInteger(id) && (id as number) > 0) &&
    (v.percent === null || (Number.isInteger(v.percent) && (v.percent as number) >= 1)) &&
    typeof v.savedAt === 'string'
  );
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Posledná potvrdená sada (uloží ju drawer po úspešnom zápise). */
export function readLastSet(): ProductSet | null {
  const parsed = safeParse(storage()?.getItem(LAST_KEY) ?? null);
  return isValidSet(parsed) ? parsed : null;
}

export function writeLastSet(set: Omit<ProductSet, 'savedAt' | 'name'>): void {
  const s = storage();
  if (!s) return;
  try {
    const value: ProductSet = { name: 'posledná sada', ...set, savedAt: new Date().toISOString() };
    s.setItem(LAST_KEY, JSON.stringify(value));
  } catch {
    /* plné/zakázané úložisko — sada je pohodlie, nie funkcia */
  }
}

/** Pomenované sady, najnovšia prvá. */
export function readNamedSets(): ProductSet[] {
  const parsed = safeParse(storage()?.getItem(NAMED_KEY) ?? null);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidSet).slice(0, MAX_NAMED_SETS);
}

export function saveNamedSet(set: Omit<ProductSet, 'savedAt'>): ProductSet[] {
  const s = storage();
  const name = set.name.trim().slice(0, 60);
  if (!s || name.length === 0 || set.productIds.length === 0) return readNamedSets();
  const next: ProductSet[] = [
    { ...set, name, savedAt: new Date().toISOString() },
    ...readNamedSets().filter((existing) => existing.name !== name),
  ].slice(0, MAX_NAMED_SETS);
  try {
    s.setItem(NAMED_KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
  return next;
}

export function deleteNamedSet(name: string): ProductSet[] {
  const s = storage();
  const next = readNamedSets().filter((existing) => existing.name !== name);
  if (s) {
    try {
      s.setItem(NAMED_KEY, JSON.stringify(next));
    } catch {
      /* best-effort */
    }
  }
  return next;
}
