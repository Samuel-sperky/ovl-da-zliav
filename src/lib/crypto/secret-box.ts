/**
 * Aura Zľavy — AES-256-GCM secret box pre API kľúč (BUILD-SPEC §7, R2, D63, D64, I1).
 *
 * Formát podľa §7:
 * ```
 * algoritmus : aes-256-gcm
 * key        : master key (32 B) zo súboru — bez KDF, súbor je už náhodný
 * iv         : 12 B crypto.randomBytes, unikátne pre KAŽDÝ zápis
 * aad        : Buffer.from(`ovl_zliav:api_key:v${key_version}`)
 * tag        : 16 B GCM auth tag
 * uloženie   : api_key.ciphertext | api_key.iv | api_key.auth_tag (VARBINARY)
 * ```
 *
 * Invarianty držané tu:
 *  - I1  — plaintext API kľúča existuje VÝHRADNE ako `Buffer`. Nikdy sa nekonvertuje
 *          na `string` (stringy sa v JS nedajú prepísať a zostávajú v heape),
 *          nikdy sa nedostane do `Error.message`, do logu ani do `toJSON()`.
 *  - D64 — žiadna cache dešifrovaného kľúča. `decryptApiKey()` vždy dešifruje
 *          nanovo a volajúci ho drží len v `SecretHandle` do `release()`.
 *  - I14 — chýbajúci/zlý master key = výnimka z `master-key.ts`, nie fallback.
 *
 * Zmena jediného bitu v `ciphertext`, `iv`, `authTag` alebo v AAD (t. j. iná
 * `keyVersion`) spôsobí zlyhanie GCM autentifikácie → `SecretBoxError`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { EncryptedSecret, SecretBox, SecretHandle, SecretRef } from '@/contracts';
import { loadMasterKey, MASTER_KEY_BYTES } from '@/lib/crypto/master-key';

export const SECRET_BOX_ALGORITHM = 'aes-256-gcm';
export const IV_BYTES = 12;
export const AUTH_TAG_BYTES = 16;
export const CURRENT_KEY_VERSION = 1;

/** `api_key.ciphertext` je `VARBINARY(512)`; GCM nemení dĺžku (§3). */
export const MAX_SECRET_BYTES = 512;

/** AAD prefix podľa §7 — verzia sa dopĺňa z `keyVersion`. */
export const AAD_PREFIX = 'ovl_zliav:api_key:v';

export type SecretBoxErrorCode = 'bad_input' | 'auth_failed' | 'released';

/**
 * Chyba crypto vrstvy. `message` NIKDY neobsahuje plaintext ani ciphertext (I1).
 */
export class SecretBoxError extends Error {
  readonly code: SecretBoxErrorCode;

  constructor(code: SecretBoxErrorCode, message: string) {
    super(message);
    this.name = 'SecretBoxError';
    this.code = code;
  }
}

/** AAD pre danú verziu kľúča (§7). Verzia je súčasťou autentifikovaných dát. */
export function aadFor(keyVersion: number = CURRENT_KEY_VERSION): Buffer {
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 255) {
    throw new SecretBoxError('bad_input', `Neplatná keyVersion: ${keyVersion} (očakáva sa 1–255).`);
  }
  return Buffer.from(`${AAD_PREFIX}${keyVersion}`, 'utf8');
}

/** `Buffer.fill(0)` — jediný povolený spôsob zahodenia plaintextu (D64). */
export function wipeBuffer(buf: Buffer): void {
  if (Buffer.isBuffer(buf) && buf.length > 0) buf.fill(0);
}

function resolveMasterKey(explicit?: Buffer): Buffer {
  const key = explicit ?? loadMasterKey();
  if (key.length !== MASTER_KEY_BYTES) {
    throw new SecretBoxError(
      'bad_input',
      `Master key má ${key.length} B, AES-256 potrebuje ${MASTER_KEY_BYTES} B (D61).`,
    );
  }
  return key;
}

export interface SecretBoxOptions {
  /** Výhradne pre testy a pre migračné nástroje; inak sa berie zo súboru (D61). */
  masterKey?: Buffer;
}

export interface EncryptOptions extends SecretBoxOptions {
  keyVersion?: number;
}

/**
 * Zašifruje plaintext API kľúča. Vstupný buffer NEMUTUJE — o jeho vynulovanie
 * sa stará volajúci (repozitár to robí hneď po zašifrovaní, D64).
 */
export function encryptApiKey(plain: Buffer, options: EncryptOptions = {}): EncryptedSecret {
  if (!Buffer.isBuffer(plain) || plain.length === 0) {
    throw new SecretBoxError('bad_input', 'Plaintext API kľúča musí byť neprázdny Buffer.');
  }
  if (plain.length > MAX_SECRET_BYTES) {
    throw new SecretBoxError(
      'bad_input',
      `Plaintext má ${plain.length} B, strop je ${MAX_SECRET_BYTES} B (VARBINARY(512), §3).`,
    );
  }

  const keyVersion = options.keyVersion ?? CURRENT_KEY_VERSION;
  const masterKey = resolveMasterKey(options.masterKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(SECRET_BOX_ALGORITHM, masterKey, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(aadFor(keyVersion));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { ciphertext, iv, authTag, keyVersion };
}

function assertRecord(record: EncryptedSecret): void {
  if (!Buffer.isBuffer(record?.ciphertext) || record.ciphertext.length === 0) {
    throw new SecretBoxError('bad_input', 'Záznam api_key nemá platný ciphertext.');
  }
  if (record.ciphertext.length > MAX_SECRET_BYTES) {
    throw new SecretBoxError('bad_input', 'Ciphertext je dlhší než VARBINARY(512).');
  }
  if (!Buffer.isBuffer(record.iv) || record.iv.length !== IV_BYTES) {
    throw new SecretBoxError('bad_input', `IV musí mať ${IV_BYTES} B (§7).`);
  }
  if (!Buffer.isBuffer(record.authTag) || record.authTag.length !== AUTH_TAG_BYTES) {
    throw new SecretBoxError('bad_input', `Auth tag musí mať ${AUTH_TAG_BYTES} B (§7).`);
  }
}

/**
 * Dešifruje záznam. Volá sa VÝHRADNE z implementácie `SecretRef` (kontrakt §3),
 * teda z `api-key.repo.ts` — nikde inde v appke.
 *
 * Pri akejkoľvek manipulácii s ciphertextom, IV, tagom alebo verziou kľúča
 * (AAD) hodí `SecretBoxError('auth_failed')`. Detail z OpenSSL sa zámerne
 * neprenáša — nesmie z neho vzniknúť orákulum ani únik (I1).
 */
export function decryptApiKey(record: EncryptedSecret, options: SecretBoxOptions = {}): Buffer {
  assertRecord(record);
  const masterKey = resolveMasterKey(options.masterKey);
  const decipher = createDecipheriv(SECRET_BOX_ALGORITHM, masterKey, record.iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAAD(aadFor(record.keyVersion ?? CURRENT_KEY_VERSION));
  decipher.setAuthTag(record.authTag);
  try {
    return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]);
  } catch {
    throw new SecretBoxError(
      'auth_failed',
      'Dešifrovanie API kľúča zlyhalo — nesúhlasí autentifikačný tag. ' +
        'Záznam bol pozmenený alebo sa zmenil master key (D62): kľúč treba wipnúť ' +
        'a zadať znova v UI.',
    );
  }
}

/* ────────────────────────────── SecretHandle ───────────────────────────── */

/**
 * Držiteľ plaintextu (kontrakt `SecretHandle`). Po `release()` je buffer
 * prepísaný nulami (D64, I1) a `released` je `true`. Opakovaný `release()` je
 * bezpečný. Buffer po uvoľnení zostáva prístupný — zámerne, aby akceptačný test
 * A1 vedel overiť, že je vynulovaný.
 */
export interface ManagedSecretHandle extends SecretHandle {
  readonly released: boolean;
}

export function createSecretHandle(plain: Buffer): ManagedSecretHandle {
  if (!Buffer.isBuffer(plain)) {
    throw new SecretBoxError('bad_input', 'SecretHandle potrebuje Buffer.');
  }
  let released = false;
  return {
    get value(): Buffer {
      return plain;
    },
    get released(): boolean {
      return released;
    },
    release(): void {
      if (released) return;
      released = true;
      wipeBuffer(plain);
    },
    // Poistka proti I1: ani `JSON.stringify`, ani template string, ani
    // `console.log` nesmú z handle dostať bajty kľúča.
    toJSON(): Record<string, unknown> {
      return { secret: '[REDACTED]', bytes: plain.length, released };
    },
    toString(): string {
      return '[SecretHandle REDACTED]';
    },
  } as ManagedSecretHandle;
}

/**
 * Zloží `SecretRef` z callbacku, ktorý dodá aktuálny šifrovaný záznam.
 * Dešifruje sa až v momente volania (D64) — žiadna cache.
 */
export function createSecretRef(
  loadRecord: () => Promise<EncryptedSecret>,
  options: SecretBoxOptions = {},
): SecretRef {
  return async () => {
    const record = await loadRecord();
    return createSecretHandle(decryptApiKey(record, options));
  };
}

/**
 * Bezpečné použitie tajomstva: `release()` prebehne aj pri výnimke.
 * Toto je odporúčaná cesta pre shop klienta (§6, D64).
 */
export async function withSecret<T>(
  ref: SecretRef,
  fn: (secret: Buffer) => Promise<T>,
): Promise<T> {
  const handle = await ref();
  try {
    return await fn(handle.value);
  } finally {
    handle.release();
  }
}

/** Kontraktový objekt `SecretBox` — pre injektovanie do iných modulov. */
export const secretBox: SecretBox = {
  encryptApiKey: (plain: Buffer) => encryptApiKey(plain),
  decryptApiKey: (record: EncryptedSecret) => decryptApiKey(record),
  wipeBuffer,
};
