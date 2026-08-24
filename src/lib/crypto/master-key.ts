/**
 * Aura Zľavy — master key a súborové tajomstvá (BUILD-SPEC §7, D61, D62, I1, I14).
 *
 * Zodpovednosť tohto modulu:
 *  - prečítať master key zo súboru, ktorého cesta je v `MASTER_KEY_FILE`,
 *  - overiť DĹŽKU (32 B) aj PRÁVA (`mode & forbiddenModeBits() === 0`; na
 *    POSIXe je maska 0o077, na Windowse 0o022 — dôvod je pri tej funkcii),
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

/** Práva, ktoré sa od súboru s tajomstvom očakávajú na POSIXe (D61). */
export const EXPECTED_SECRET_FILE_MODE = 0o400;

/**
 * Práva, ktoré `stat` ohlási pre read-only súbor na Windowse. `chmod 400` tam
 * 0o400 NEVYROBÍ — Node vie na NTFS prepnúť jedine atribút read-only a ten sa
 * hlási ako 0o444.
 */
export const EXPECTED_SECRET_FILE_MODE_WIN32 = 0o444;

/* ─────────────────── práva podľa platformy (D61, I14, R-6) ───────────────── */

/**
 * ČO SA TU MERÍ A ČO SA MERAŤ NEDÁ
 * --------------------------------
 * D61 chce od súboru s tajomstvom práva 400: nikto okrem vlastníka ho nesmie
 * ani prečítať. Na POSIXe je to merateľné a appka to vynucuje — v produkcii
 * beží v linuxovom kontejneri, takže tam invariant I14 platí bez zľavy a
 * `mode & 0o077` musí byť nula.
 *
 * Na Windowse je `stat().mode` **fikcia**. NTFS prístup neriadi unixovými
 * bitmi, ale ACL, ktoré `stat` nevidí vôbec; Node z toho modelu vie prepnúť
 * jedine atribút read-only. `chmodSync(path, 0o400)` tam preto vyrobí súbor,
 * ktorý sa hlási ako 0o444, a `chmod 0o644` sa hlási ako 0o666. Trvať na
 * `mode & 0o077 === 0` znamená na Windowse trvať na stave, ktorý sa nastaviť
 * NEDÁ — kontrola nepadá na zlých právach, ale na tom, že ich nevie zmerať.
 *
 * Preto sa maska rozhoduje podľa PLATFORMY, nie podľa `strictPermissions`:
 *  - POSIX → 0o077, žiadny prístup pre group/other,
 *  - win32 → 0o022, group/other nesmie súbor prepísať; bity čítania sa
 *            netestujú, lebo ich `chmod` na NTFS nevypne.
 *
 * ČO SA TÝM SMIE TICHO POKAZIŤ. Na Windowse appka o utajení súboru nevie nič —
 * a keby mlčala, tvrdila by „práva sú v poriadku" tam, kde ich nezmerala.
 * Preto sa na win32 pri otvorených bitoch čítania pripíše varovanie VŽDY, aj
 * keď kontrola prešla. Nie je to kozmetika: je to jediné miesto, kde je vidieť,
 * že invariant I14 tu drží operačný systém, nie appka.
 *
 * Rozhodnutie sa dá otestovať na OBOCH platformách bez ohľadu na to, kde test
 * beží — je to čistá funkcia z názvu platformy. Nad reálnym súborom sa testuje
 * len tá vetva, na ktorej test práve stojí, lebo práva súboru si platformu
 * vybrať nedajú.
 */
export const FORBIDDEN_MODE_BITS_POSIX = 0o077;
export const FORBIDDEN_MODE_BITS_WIN32 = 0o022;

/** Bity, ktoré na súbore s tajomstvom nesmú byť — podľa platformy. */
export function forbiddenModeBits(platform: string = process.platform): number {
  return platform === 'win32' ? FORBIDDEN_MODE_BITS_WIN32 : FORBIDDEN_MODE_BITS_POSIX;
}

/** Práva, ktoré sa od súboru s tajomstvom na danej platforme očakávajú. */
export function expectedSecretFileMode(platform: string = process.platform): number {
  return platform === 'win32' ? EXPECTED_SECRET_FILE_MODE_WIN32 : EXPECTED_SECRET_FILE_MODE;
}

/** Vie sa na tejto platforme overiť, že tajomstvo nikto iný neprečíta? */
export function permissionsAreVerifiable(platform: string = process.platform): boolean {
  return platform !== 'win32';
}

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
  /**
   * Platforma, podľa ktorej sa vyberá maska zakázaných bitov. Default je
   * `process.platform`; prepína sa VÝHRADNE v testoch, aby sa dala prejsť aj
   * vetva, na ktorej test práve nestojí.
   */
  platform?: string;
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
  const platform = options.platform ?? process.platform;
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
    if ((mode & forbiddenModeBits(platform)) !== 0) {
      const message =
        `${path} má práva ${mode.toString(8)} — group ani other nesmie mať ` +
        `${platform === 'win32' ? 'právo zápisu' : 'prístup'} ` +
        `(očakáva sa ${expectedSecretFileMode(platform).toString(8)}, D61).`;
      if (strict) fail('bad_permissions', message);
      else warnings.push(message);
    }
    /* Priznanie, nie kozmetika: na win32 sa utajenie súboru zmerať nedá, takže
     * mlčať by znamenalo tvrdiť „práva sú v poriadku". Viď komentár pri
     * `forbiddenModeBits()`. */
    if (!permissionsAreVerifiable(platform) && (mode & 0o077) !== 0) {
      warnings.push(
        `${path} má práva ${mode.toString(8)}. Na Windowse sa práva ` +
          `${EXPECTED_SECRET_FILE_MODE.toString(8)} nastaviť nedajú — NTFS ich riadi cez ACL, ` +
          'ktoré `stat` nevidí. Appka tu overuje len to, že súbor nikto iný neprepíše; ' +
          'že ho nikto iný neprečíta, drží operačný systém, nie appka (D61, I14).',
      );
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
