/**
 * Aura Zľavy — heslá admina (BUILD-SPEC §1, D68, I1).
 *
 * Rozhodnutia, ktoré tento modul drží:
 *  - **argon2id** (`argon2.argon2id`) — iný typ sa nepoužije nikde v appke.
 *  - **min 12 znakov, ŽIADNE zložitostné pravidlá** (D68). Modul teda kontroluje
 *    výhradne dĺžku; veľké písmená, číslice ani znaky nikdy nevynucuje.
 *  - **I1** — plaintext hesla neopustí tento modul: nikdy sa neloguje, nevracia
 *    v chybe a nevkladá do hlášky. Chyby hovoria len o dĺžke, nie o obsahu.
 *  - **Fail-closed** — `verifyPassword()` nikdy nehodí výnimku a pri akejkoľvek
 *    pochybnosti (poškodený hash, chyba knižnice) vracia `false`.
 *  - **Bez enumerácie userov** — `verifyPassword(null, …)` spáli rovnaký čas ako
 *    overenie skutočného hesla (`DUMMY_HASH`), takže z dĺžky odpovede sa nedá
 *    zistiť, či prihlasovacie meno existuje.
 *
 * Parametre argon2id: presné čísla „podľa sperky-ai" (D68) v tomto repozitári
 * nemáme — SPRINT-PLAN §3 bod 1 preto určuje OWASP odporúčanie
 * `m=19456 KiB, t=2, p=1`. Rovnaké hodnoty používa `scripts/seed-admin.ts`
 * (A0), takže hash zo seedu sa overí týmto modulom bez rehashu.
 *
 * Vlastník: A4.
 */
import argon2 from 'argon2';

/** D68 — minimálna dĺžka hesla. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Strop dĺžky. Zod schéma route `/api/auth/login` má `string(12..200)` (§5),
 * takže dlhší vstup je odmietnutý ešte pred hashovaním (obrana proti DoS
 * hashovaním megabajtových vstupov).
 */
export const MAX_PASSWORD_LENGTH = 200;

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * Produkčné parametre (SPRINT-PLAN §3 bod 1 — OWASP). Zladenie s hodnotami zo
 * sperky-ai je otvorený bod pre A19; zmena tu je jediné potrebné miesto, staré
 * hashe sa dajú rozpoznať cez `needsRehash()`.
 */
export const ARGON2_PARAMS: Argon2Params = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export type PasswordErrorCode = 'too_short' | 'too_long' | 'not_a_string';

/**
 * Chyba politiky hesla. `message` NIKDY neobsahuje heslo ani jeho časť (I1).
 */
export class PasswordError extends Error {
  readonly code: PasswordErrorCode;

  constructor(code: PasswordErrorCode, message: string) {
    super(message);
    this.name = 'PasswordError';
    this.code = code;
  }
}

/* ─────────────────────────────── politika ──────────────────────────────── */

export type PasswordPolicyResult = { ok: true } | { ok: false; code: PasswordErrorCode; message: string };

/**
 * Skontroluje výhradne dĺžku (D68). Nič neloguje a nič nevracia z obsahu hesla.
 */
export function checkPasswordPolicy(plain: unknown): PasswordPolicyResult {
  if (typeof plain !== 'string') {
    return { ok: false, code: 'not_a_string', message: 'Heslo musí byť text.' };
  }
  // Znaky, nie bajty: „12 znakov" je pre používateľa počet znakov, ktoré napíše.
  const length = [...plain].length;
  if (length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      code: 'too_short',
      message: `Heslo musí mať aspoň ${MIN_PASSWORD_LENGTH} znakov (D68).`,
    };
  }
  if (length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      code: 'too_long',
      message: `Heslo môže mať najviac ${MAX_PASSWORD_LENGTH} znakov.`,
    };
  }
  return { ok: true };
}

/** Rovnaká kontrola, ale hodí `PasswordError` (pre zápisové cesty). */
export function assertPasswordPolicy(plain: unknown): asserts plain is string {
  const result = checkPasswordPolicy(plain);
  if (!result.ok) throw new PasswordError(result.code, result.message);
}

/* ─────────────────────────────── hashovanie ─────────────────────────────── */

/**
 * Vyrobí argon2id hash. Odmietne heslo, ktoré neprejde politikou (D68).
 *
 * `params` existuje pre testy a pre budúce zladenie parametrov — typ hashu je
 * vždy `argon2id` a nedá sa prepnúť.
 */
export async function hashPassword(
  plain: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<string> {
  assertPasswordPolicy(plain);
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
  });
}

/**
 * Hash, ktorý sa overuje, keď user neexistuje — aby neúspešné prihlásenie
 * s neznámym menom trvalo rovnako dlho ako s existujúcim (obrana proti
 * enumerácii mien). Vyrobí sa lazy raz za proces z náhodného hesla.
 */
let dummyHash: Promise<string> | null = null;

function getDummyHash(params: Argon2Params): Promise<string> {
  if (!dummyHash) {
    // Náhodné heslo — nikto ho nepozná, takže sa naň nedá „prihlásiť".
    const filler = `dummy:${Math.random().toString(36).slice(2)}:${Date.now()}:aura-zlavy`;
    dummyHash = hashPassword(filler.padEnd(MIN_PASSWORD_LENGTH, 'x'), params);
  }
  return dummyHash;
}

/**
 * Overí heslo proti hashu. NIKDY nehodí výnimku a NIKDY nevracia `true` pri
 * pochybnosti (fail-closed).
 *
 * @param hash uložený `users.password_hash`; `null`/`undefined` = user neexistuje
 *             (aj tak sa spáli čas na dummy overení)
 */
export async function verifyPassword(
  hash: string | null | undefined,
  plain: unknown,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<boolean> {
  const policy = checkPasswordPolicy(plain);

  // Aj pri neexistujúcom userovi a pri príliš krátkom hesle spálime rovnaký čas.
  const target = typeof hash === 'string' && hash.length > 0 ? hash : await getDummyHash(params);
  const candidate = policy.ok ? (plain as string) : 'nezmyselné-heslo-mimo-politiky';

  let matches = false;
  try {
    matches = await argon2.verify(target, candidate);
  } catch {
    // Poškodený hash, iný algoritmus, chyba knižnice — vždy „neprihlásený".
    matches = false;
  }

  // Heslo mimo politiky sa NIKDY nepovažuje za správne, aj keby hash sedel
  // (napr. keby v DB zostal hash zo starých pravidiel) — D68 fail-closed.
  if (!policy.ok) return false;
  if (typeof hash !== 'string' || hash.length === 0) return false;
  return matches;
}

/**
 * Má sa hash prehashovať aktuálnymi parametrami? Volajúci to smie ignorovať —
 * rehash sa dá spraviť len pri prihlásení, keď je plaintext k dispozícii.
 */
export function needsRehash(hash: string, params: Argon2Params = ARGON2_PARAMS): boolean {
  // `argon2.needsRehash()` porovnáva len cost parametre — typ algoritmu si preto
  // kontrolujeme sami (iný než argon2id sa vždy prehashuje, D68).
  if (!isArgon2idHash(hash)) return true;
  try {
    return argon2.needsRehash(hash, {
      memoryCost: params.memoryCost,
      timeCost: params.timeCost,
      parallelism: params.parallelism,
    });
  } catch {
    // Nerozpoznaný hash: prehashovať áno, ale nikdy nie „je v poriadku".
    return true;
  }
}

/** Je to vôbec argon2id hash? Sanity kontrola pre seed a testy. */
export function isArgon2idHash(hash: unknown): boolean {
  return typeof hash === 'string' && hash.startsWith('$argon2id$');
}

/** Výhradne pre testy — zabudne memoizovaný dummy hash. */
export function resetDummyHashCache(): void {
  dummyHash = null;
}
