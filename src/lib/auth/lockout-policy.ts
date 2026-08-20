/**
 * Aura Zľavy — politika brute-force lockoutu, ČISTÁ funkcia (D71, KONTRAKT O4).
 *
 * Prečo samostatný súbor: politiku potrebuje aj služba `lib/auth/lockout.ts`,
 * aj repozitár `lib/repo/login-attempts.repo.ts` (jeho `getState()` vracia podľa
 * kontraktu už vyhodnotený `LockoutState`). Keby politika žila v službe, vznikol
 * by cyklický import služba ↔ repozitár. Tento modul preto nemá ŽIADNU
 * závislosť na DB, ENV ani logu — je to len matematika nad zoznamom pokusov.
 *
 * Pravidlá (D71 + SPRINT-PLAN A4):
 *  1. Rozhoduje sa výhradne z riadkov `login_attempts` — stav teda **prežije
 *     restart procesu** (O4: in-memory riešenie je zakázané).
 *  2. Počítajú sa **neúspešné pokusy od posledného úspechu** (úspešné
 *     prihlásenie sériu vždy vynuluje).
 *  3. Po `maxAttempts` (5) neúspechoch nasleduje blokáda `windowMinutes` (15)
 *     od POSLEDNÉHO neúspechu.
 *  4. **Exponenciálne predĺženie:** každých ďalších `maxAttempts` neúspechov
 *     zdvojnásobí blokádu — 15 → 30 → 60 → 120 … so stropom `maxLockMinutes`.
 *  5. **Decay:** neúspechy staršie než `decayMinutes` (24 h) sa do série
 *     nepočítajú, aby jediný zabudnutý preklep pred týždňom nedržal úroveň
 *     eskalácie navždy.
 *
 * Vedomá odchýlka smerom k fail-closed: „5 pokusov / 15 min" sa tu vyhodnocuje
 * ako „5 neúspechov v sérii" bez ohľadu na to, či padli za 15 minút alebo za
 * 5 hodín. Prísnejšie je pri jedinom adminovi (R9) bezpečné a pomalý brute-force
 * sa nedá schovať pod hranicu okna.
 */

/** Jeden riadok `login_attempts` v tvare, ktorý politika potrebuje. */
export interface AttemptRow {
  success: boolean;
  ts: Date;
}

export interface LockoutPolicy {
  /** D71 — 5 pokusov. */
  maxAttempts: number;
  /** D71 — základná blokáda 15 min; zároveň jednotka exponenciálneho rastu. */
  windowMinutes: number;
  /** Strop jednej blokády. */
  maxLockMinutes: number;
  /** Po akom čase sa séria neúspechov zabudne. */
  decayMinutes: number;
}

/** Default politika (ENV prepis rieši `lib/auth/lockout.ts`). */
export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  maxAttempts: 5,
  windowMinutes: 15,
  maxLockMinutes: 24 * 60,
  decayMinutes: 24 * 60,
};

const MINUTE_MS = 60_000;

/**
 * Dĺžka blokády pre danú úroveň eskalácie (1 = prvá blokáda).
 * `15 · 2^(level−1)`, zastropované na `maxLockMinutes`.
 */
export function lockoutMinutesForLevel(level: number, policy: LockoutPolicy): number {
  if (level <= 0) return 0;
  // Bez `Math.pow` v exponente nad 30 — inak `Infinity` a NaN pri aritmetike.
  const exponent = Math.min(level - 1, 30);
  const raw = policy.windowMinutes * 2 ** exponent;
  return Math.min(raw, policy.maxLockMinutes);
}

export interface LockoutEvaluation {
  locked: boolean;
  /** Kedy blokáda skončí; `null` keď netrvá. */
  until: Date | null;
  /** Počet neúspechov v aktuálnej sérii (po decay a po poslednom úspechu). */
  failedAttempts: number;
  retryAfterSeconds: number;
  /** Úroveň eskalácie: 0 = žiadna blokáda, 1 = 15 min, 2 = 30 min … */
  level: number;
  /** Koľko neúspechov ešte zostáva do blokády (0 keď už je zamknuté). */
  remainingAttempts: number;
}

/**
 * Vyhodnotí stav lockoutu. `attempts` môžu prísť v ľubovoľnom poradí —
 * funkcia si ich zoradí sama (novšie prvé).
 */
export function evaluateLockout(
  attempts: readonly AttemptRow[],
  now: Date = new Date(),
  policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
): LockoutEvaluation {
  const nowMs = now.getTime();
  const decayFrom = nowMs - policy.decayMinutes * MINUTE_MS;

  const sorted = [...attempts]
    .filter((row) => row.ts instanceof Date && !Number.isNaN(row.ts.getTime()))
    // Budúce pečiatky (rozladené hodiny DB) neignorujeme — sú prísnejšie.
    .sort((a, b) => b.ts.getTime() - a.ts.getTime());

  const streak: AttemptRow[] = [];
  for (const row of sorted) {
    if (row.success) break; // úspech vynuluje sériu (pravidlo 2)
    if (row.ts.getTime() < decayFrom) break; // decay (pravidlo 5)
    streak.push(row);
  }

  const failedAttempts = streak.length;
  const level = Math.floor(failedAttempts / policy.maxAttempts);

  if (level < 1) {
    return {
      locked: false,
      until: null,
      failedAttempts,
      retryAfterSeconds: 0,
      level: 0,
      remainingAttempts: policy.maxAttempts - failedAttempts,
    };
  }

  const lastFailureMs = streak[0].ts.getTime();
  const until = new Date(lastFailureMs + lockoutMinutesForLevel(level, policy) * MINUTE_MS);
  const locked = until.getTime() > nowMs;

  return {
    locked,
    until: locked ? until : null,
    failedAttempts,
    retryAfterSeconds: locked ? Math.max(1, Math.ceil((until.getTime() - nowMs) / 1000)) : 0,
    level,
    // Kým blokáda trvá, žiadny pokus „nezostáva". Po jej uplynutí stačí JEDINÝ
    // ďalší neúspech na novú blokádu (séria sa nevynuluje sama) — fail-closed.
    remainingAttempts: locked ? 0 : 1,
  };
}
