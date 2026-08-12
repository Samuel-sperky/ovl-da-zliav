/**
 * Aura Zľavy — BEZPEČNÉ ČÍTANIE JSON PRE PREHĽAD (V9).
 *
 * Prehľad je prístrojová doska nad šiestimi čistoČÍTACÍMI endpointmi a ani
 * jeden z nich nesmie obrazovke dovoliť tvrdiť číslo, ktoré neprečítala. Tieto
 * helpery pôvodne žili ako privátne funkcie v `api.ts`; odkedy ich potrebuje aj
 * `status-api.ts` (živý stav a prekážky), majú jedno miesto — druhá kópia tých
 * istých piatich funkcií by sa o mesiac rozišla s prvou a jedna z obrazoviek by
 * začala čítať voľnejšie než druhá.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Čo sa nedá prečítať, je `null` — nikdy nula, nikdy dopočítaný odhad.**
 *    Appka zapisuje do produkčného eshopu; číslo, ktoré si obrazovka vymyslí,
 *    je horšie než priznaná medzera (P7).
 * 2. **Porovnáva sa explicitne.** Turbopack tu už raz zahodil `if (!row)` ako
 *    compile-time falsy a obrazovka potom kreslila nuly. Preto všade
 *    `value === null`, `typeof … !== 'number'` a podobne.
 * 3. **Žiadne vety, žiadne formátovanie.** Tento modul len čita typy. Slovenské
 *    vety skladá `lib/ui/vocabulary.ts` a `lib/status/blockers.ts`.
 *
 * Modul je čistý — žiadny React, žiadny `fetch`, žiadne `use client`.
 *
 * Vlastník: V9.
 */

/** Objekt prečítaný z JSON, ktorého kľúče ešte nikto neoveril. */
export type JsonRecord = Record<string, unknown>;

/** Objekt, alebo `null` pri čomkoľvek inom (vrátane polí a `undefined`). */
export function asRecord(value: unknown): JsonRecord | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

/** Konečné číslo, inak `null`. `NaN` a `Infinity` sú „neviem", nie hodnota. */
export function readNumber(source: JsonRecord, key: string): number | null {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/** Celé nezáporné číslo, inak `null`. Záporný počet položiek je nezmysel. */
export function readCount(source: JsonRecord, key: string): number | null {
  const value = readNumber(source, key);
  if (value === null || value < 0) return null;
  return Math.trunc(value);
}

/** Neprázdny reťazec, inak `null`. Prázdny reťazec nie je hodnota. */
export function readText(source: JsonRecord, key: string): string | null {
  const value = source[key];
  if (typeof value !== 'string' || value === '') return null;
  return value;
}

/** `true` len pri skutočnom `true`. Všetko ostatné je `false`. */
export function readFlag(source: JsonRecord, key: string): boolean {
  return source[key] === true;
}

/**
 * `true`/`false`, alebo `null` pri čomkoľvek inom.
 *
 * Rozdiel proti `readFlag` je celý zmysel tejto funkcie: pri poistkách zápisu
 * („sú zápisy zapnuté?") sa „nevieme" NESMIE zliať s „nie". Prvé znamená, že
 * appka o sebe niečo nevie a má to priznať; druhé je overený fakt.
 */
export function readTriState(source: JsonRecord, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

/**
 * Hodnota z uzavretého zoznamu kódov, inak `null`.
 *
 * Neznámy kód sa NEPREPOSIELA ďalej: obrazovka by ho buď vykreslila surový
 * (K10 to zakazuje), alebo by naň nenašla vetu. `null` znamená „appka tento
 * kód nepozná" a volajúci sa s tým musí vyrovnať vedome.
 */
export function readCode<T extends string>(
  source: JsonRecord,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = source[key];
  if (typeof value !== 'string') return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
