/**
 * Aura Zľavy — master key a súborové tajomstvá (BUILD-SPEC §7, D61, D62, I1, I14).
 *
 * Zodpovednosť tohto modulu:
 *  - prečítať master key zo súboru, ktorého cesta je v `MASTER_KEY_FILE`,
 *  - overiť DĹŽKU (32 B) aj PRÁVA (`mode & 0o077 === 0`),
 *  - fail-fast, keď je čokoľvek z toho nesplnené (I14) — appka NESMIE bežať
 *    v režime, v ktorom by nedokázala bezpečne šifrovať API kľúč,
 *  - to isté pre session secret (`SESSION_SECRET_FILE`), z ktorého je podpisovaný
 *    preview token (§7, O2).
 *
 * Invarianty držané tu:
 *  - I1  — obsah súboru sa NIKDY nedostane do hlásenia, logu ani výnimky.
 *          Chybové správy obsahujú výhradne CESTU a dôvod, nikdy bajty.
 *  - I14 — `loadMasterKey()` hodí `SecretFileError`; volajúci (boot, repozitár)
 *          ju neprehlta.
 *  - D62 — rotácia master key sa tu nerieši: nový master key znamená, že
 *          existujúci `api_key` záznam sa nedá dešifrovať a musí sa wipnúť.
 *
 * Master key sa podľa §7 („pri boote sa načíta raz do `Buffer`") drží v pamäti
 * memoizovaný. To NIE JE v rozpore s D64 — D64 zakazuje cache **dešifrovaného
 * API kľúča**, nie symetrického master key, bez ktorého by sa nedalo šifrovať.
 *
 * POZOR: vrátený `Buffer` je zdieľaná memoizovaná instancia. Nikto ho NESMIE
 * mutovať ani naň volať `wipeBuffer()`.
 */
import { readFileSync, statSync } from 'node:fs';

import type { MasterKeyCheck } from '@/contracts';
import { env } from '@/env';

/** AES-256 → presne 32 B (§7). */
export const MASTER_KEY_BYTES = 32;

/** HS256 podpis preview tokenu — minimálne 32 B entropie (§7, O2). */
export const MIN_SESSION_SECRET_BYTES = 32;

/** Práva, ktoré sa od súboru s tajomstvom očakávajú (D61). */
export const EXPECTED_SECRET_FILE_MODE = 0o400;

export type SecretFileProblemCode =
  | 'unreadable'
  | 'not_a_file'
  | 'bad_encoding'
  | 'bad_length'
  | 'bad_permissions'
  | 'stat_failed';

/**
 * Fail-fast chyba (I14). `message` obsahuje cestu a dôvod — NIKDY obsah súboru.
 */
export class SecretFileError extends Error {
  readonly path: string;
  readonly problems: string[];
  readonly codes: SecretFileProblemCode[];

  constructor(path: string, problems: string[], codes: SecretFileProblemCode[]) {
    super(
      `Tajomstvo v súbore ${path} sa nedá použiť (${problems.length} ${
        problems.length === 1 ? 'problém' : 'problémov'
      }):\n  - ${problems.join('\n  - ')}`,
    );
    this.name = 'SecretFileError';
    this.path = path;
    this.problems = problems;
    this.codes = codes;
  }
}

/** Rozšírený výsledok kontroly — nadstavba kontraktového `MasterKeyCheck`. */
export interface SecretFileCheck extends MasterKeyCheck {
  /** Kódy problémov v rovnakom poradí ako `problems`. */
  codes: SecretFileProblemCode[];
  /** Neblokujúce zistenia (napr. voľné práva mimo produkcie). */
  warnings: string[];
  /** Dekódovaná dĺžka v bajtoch; `null` keď sa nedala určiť. */
  bytes: number | null;
  /** Oktálové práva súboru (`mode & 0o777`); `null` keď `stat` zlyhal. */
  mode: number | null;
}

export interface SecretFileOptions {
  /** Presná požadovaná dĺžka v bajtoch (master key: 32). */
  exactBytes?: number;
  /** Minimálna dĺžka v bajtoch (session secret: 32). */
  minBytes?: number;
  /**
   * `true` → voľné práva sú CHYBA (produkcia, D61).
   * `false` → voľné práva sú len varovanie (vývoj na bind-mounte / Windows).
   * Default kopíruje rozhodnutie A0 v `instrumentation-node.ts`: strict = produkcia.
   */
  strictPermissions?: boolean;
}

/* ────────────────────────────── dekódovanie ────────────────────────────── */

/**
 * Hex (64 znakov) alebo base64 — presne to, čo píše §7. Vracia `null`, keď
 * obsah nie je ani jedno.
 */
export function decodeSecretMaterial(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed, 'hex');
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed, 'base64');
    // Base64 round-trip: keď sa reťazec po dekódovaní a zakódovaní nezhoduje,
    // nešlo o base64 (napr. náhodné slovo bez paddingu).
    if (decoded.length > 0 && decoded.toString('base64').replace(/=+$/, '') === trimmed.replace(/=+$/, '')) {
      return decoded;
    }
  }
  return null;
}

/* ─────────────────────────────── kontrola ──────────────────────────────── */

function isProduction(): boolean {
  // `env` je lazy proxy; keď ENV nesedí, nech to zhodí volajúci boot, nie my.
  try {
    return env.NODE_ENV === 'production';
  } catch {
    return true; // fail-closed: bez známeho NODE_ENV sa chováme ako v produkcii
  }
}

/**
 * Overí súbor s tajomstvom bez toho, aby jeho obsah kdekoľvek vystavila (I1).
 * Nič nehodí — vracia štruktúru, aby ju vedel použiť aj boot, aj testy.
 */
export function checkSecretFile(path: string, options: SecretFileOptions = {}): SecretFileCheck {
  const strict = options.strictPermissions ?? isProduction();
  const problems: string[] = [];
  const codes: SecretFileProblemCode[] = [];
  const warnings: string[] = [];
  let bytes: number | null = null;
  let mode: number | null = null;

  const fail = (code: SecretFileProblemCode, message: string): void => {
    codes.push(code);
    problems.push(message);
  };

  /* práva a typ súboru (D61) */
  try {
    const stat = statSync(path);
    mode = stat.mode & 0o777;
    if (!stat.isFile()) {
      fail('not_a_file', `${path} nie je obyčajný súbor.`);
    }
    if ((mode & 0o077) !== 0) {
      const message =
        `${path} má práva ${mode.toString(8)} — group ani other nesmie mať prístup ` +
        `(očakáva sa ${EXPECTED_SECRET_FILE_MODE.toString(8)}, D61).`;
      if (strict) fail('bad_permissions', message);
      else warnings.push(message);
    }
  } catch {
    fail('stat_failed', `Nedajú sa zistiť práva súboru ${path}.`);
  }

  /* obsah — čítame len preto, aby sme zmerali dĺžku (I1) */
  let material: Buffer | null = null;
  try {
    material = decodeSecretMaterial(readFileSync(path, 'utf8'));
  } catch {
    fail('unreadable', `Súbor ${path} sa nedá prečítať (D61, I14).`);
  }

  if (material === null) {
    if (!codes.includes('unreadable')) {
      fail('bad_encoding', `${path} nie je 64 hex znakov ani base64 (D61).`);
    }
  } else {
    bytes = material.length;
    if (options.exactBytes !== undefined && bytes !== options.exactBytes) {
      fail('bad_length', `${path} má ${bytes} B, očakáva sa presne ${options.exactBytes} B (D61).`);
    }
    if (options.minBytes !== undefined && bytes < options.minBytes) {
      fail('bad_length', `${path} má ${bytes} B, očakáva sa aspoň ${options.minBytes} B (§7).`);
    }
    // Materiál tu nepotrebujeme — zahodíme ho vynulovaný.
    material.fill(0);
  }

  return { ok: problems.length === 0, path, problems, codes, warnings, bytes, mode };
}

/** Kontrola master key súboru — tvar podľa kontraktu `MasterKeyCheck`. */
export function checkMasterKeyFile(
  path: string = env.MASTER_KEY_FILE,
  options: Omit<SecretFileOptions, 'exactBytes' | 'minBytes'> = {},
): SecretFileCheck {
  return checkSecretFile(path, { ...options, exactBytes: MASTER_KEY_BYTES });
}

/** Kontrola session secret súboru (podpis preview tokenu, O2). */
export function checkSessionSecretFile(
  path: string = env.SESSION_SECRET_FILE,
  options: Omit<SecretFileOptions, 'exactBytes' | 'minBytes'> = {},
): SecretFileCheck {
  return checkSecretFile(path, { ...options, minBytes: MIN_SESSION_SECRET_BYTES });
}

/* ─────────────────────────────── načítanie ─────────────────────────────── */

const cache = new Map<string, Buffer>();

function loadChecked(path: string, options: SecretFileOptions, cacheKey: string): Buffer {
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const check = checkSecretFile(path, options);
  if (!check.ok) throw new SecretFileError(path, check.problems, check.codes);
  for (const warning of check.warnings) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'secret_file_permissions',
        detail: warning,
        ts: new Date().toISOString(),
      }),
    );
  }

  // Druhé čítanie je zámerné: `checkSecretFile()` svoj buffer vynuluje, aby
  // materiál neexistoval na dvoch miestach naraz.
  const material = decodeSecretMaterial(readFileSync(path, 'utf8'));
  if (material === null) {
    throw new SecretFileError(path, [`${path} sa medzi kontrolou a čítaním zmenil.`], [
      'bad_encoding',
    ]);
  }
  cache.set(cacheKey, material);
  return material;
}

/**
 * Master key (32 B) pre AES-256-GCM. Memoizované — súbor sa číta raz (§7).
 * Hodí `SecretFileError` (I14). Vrátený buffer NEMUTUJ.
 */
export function loadMasterKey(
  path: string = env.MASTER_KEY_FILE,
  options: Omit<SecretFileOptions, 'exactBytes' | 'minBytes'> = {},
): Buffer {
  return loadChecked(path, { ...options, exactBytes: MASTER_KEY_BYTES }, `master:${path}`);
}

/**
 * Session secret pre HS256 podpis preview tokenu (O2). Memoizované.
 * Vrátený buffer NEMUTUJ.
 */
export function loadSessionSecret(
  path: string = env.SESSION_SECRET_FILE,
  options: Omit<SecretFileOptions, 'exactBytes' | 'minBytes'> = {},
): Buffer {
  return loadChecked(path, { ...options, minBytes: MIN_SESSION_SECRET_BYTES }, `session:${path}`);
}

/** Je master key vôbec použiteľný? Pre `/api/health` a onboarding (bez detailov). */
export function masterKeyAvailable(path: string = env.MASTER_KEY_FILE): boolean {
  try {
    return loadMasterKey(path).length === MASTER_KEY_BYTES;
  } catch {
    return false;
  }
}

/** Výhradne pre testy a pre `SIGTERM` — zabudne memoizované tajomstvá. */
export function resetSecretCache(): void {
  for (const buffer of cache.values()) buffer.fill(0);
  cache.clear();
}
