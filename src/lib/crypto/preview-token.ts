/**
 * Aura Zľavy — preview token (BUILD-SPEC §7 „Preview token", O2, I3, D2, D16, D39c).
 *
 * Preview token je NOSIČ INVARIANTU I3 („žiadny zápis bez potvrdenia"): dry-run
 * vydá podpísaný token nad kanonickou sadou parametrov a ostrý zápis ho vyžaduje.
 * Bez platného tokenu neexistuje cesta kódu, ktorá by zapísala do shopu.
 *
 * ```
 * HS256 JWT (jose), secret zo SESSION_SECRET_FILE, TTL 15 min
 * claims: { jti, sub, kind, productIds, percent, from, to, pricesAtPreview, payloadHash }
 * payloadHash = SHA-256 kanonického JSON { productIds sorted, percent, from, to, kind }
 * ```
 *
 * Odmietnutý MUSÍ byť token, ktorý (§7, I3):
 *  - nemá platný podpis alebo má iný algoritmus než HS256 (`alg: none` a RS→HS
 *    zámena sú vylúčené whitelistom algoritmov v `jwtVerify`),
 *  - je starší než 15 minút (`exp`),
 *  - má `payloadHash`, ktorý nesúhlasí s vlastnými claimami (podvrhnutý hash),
 *  - má `payloadHash`, ktorý nesúhlasí s POŽADOVANOU operáciou (iná sada),
 *  - už raz bol použitý — token je JEDNORAZOVÝ.
 *
 * Ďalšie invarianty držané tu:
 *  - I2 — sada má 1–10 produktov, bez duplikátov; inak sa token ani nevydá.
 *  - I9 — percento je celé číslo 1–30, `to ≥ from`, dátumy sú platné kalendárne
 *         dni `YYYY-MM-DD`. Validuje sa pri vydaní AJ pri overení (fail-closed).
 *  - I1 — token neobsahuje API kľúč ani nič z master key; `pricesAtPreview` sú ceny.
 *
 * POZNÁMKA K JEDNORAZOVOSTI (dorozhodnuté A1): BUILD-SPEC §5 hovorí, že po
 * použití sa `jti` zapíše do `campaigns.confirm_payload_hash`. Tento stĺpec ale
 * podľa migrácie `0004_campaigns.sql` aj podľa `src/contracts.ts` nesie SHA-256
 * potvrdenej sady (`Sha256Hex`), nie `jti`, a nemá UNIQUE index — nedá sa teda
 * použiť ako spoľahlivý replay guard a `campaigns` tabuľku vlastní A8/A9.
 * Preto je tu jednorazovosť za rozhraním `PreviewTokenStore`:
 *   - default = in-process store (stačí pre single-instance appku podľa R4/I5),
 *   - A9/A12 môžu injektovať DB-backed store cez `createPreviewTokenService()`
 *     alebo `setDefaultPreviewTokenStore()` bez zmeny tohto súboru.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { ulid } from 'ulid';
import { z } from 'zod';

import type { CampaignKind, PreviewTokenClaims, PreviewTokenService, Sha256Hex } from '@/contracts';
import { loadSessionSecret } from '@/lib/crypto/master-key';

/** TTL 15 minút — normatívne v §7 aj O2, preto konštanta, nie ENV. */
export const PREVIEW_TOKEN_TTL_SECONDS = 15 * 60;

export const PREVIEW_TOKEN_ALG = 'HS256';
export const PREVIEW_TOKEN_ISSUER = 'ovl-zliav';
export const PREVIEW_TOKEN_AUDIENCE = 'ovl-zliav:preview';

/** Tvrdý strop I2/R1 — nezávislý od ENV, aby sa nedal zvýšiť konfiguráciou. */
export const PREVIEW_MAX_PRODUCTS = 10;
export const PERCENT_MIN = 1;
export const PERCENT_MAX = 30;

/**
 * Runtime zoznam `CampaignKind`. Kanonický runtime enum vlastní A7
 * (`src/lib/domain/status.ts`), ktorý v čase písania A1 neexistuje — `satisfies`
 * zabezpečí, že sa tento zoznam nerozíde s kontraktom.
 */
export const PREVIEW_CAMPAIGN_KINDS = ['new', 'extend', 'overwrite', 'retry'] as const satisfies
  readonly CampaignKind[];

export type PreviewTokenErrorCode =
  | 'bad_input'
  | 'invalid_token'
  | 'expired'
  | 'payload_mismatch'
  | 'replayed';

/** Fail-closed chyba. Route ju mapuje na 4xx (I3) — nikdy sa neprehlta. */
export class PreviewTokenError extends Error {
  readonly code: PreviewTokenErrorCode;

  constructor(code: PreviewTokenErrorCode, message: string) {
    super(message);
    this.name = 'PreviewTokenError';
    this.code = code;
  }
}

/* ─────────────────────────── kanonický payloadHash ─────────────────────── */

export type PayloadHashInput = Pick<
  PreviewTokenClaims,
  'kind' | 'productIds' | 'percent' | 'from' | 'to'
>;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Overí sadu parametrov ešte pred podpisom (I2, I9). Fail-closed: pri pochybnosti
 * sa token NEVYDÁ a zápis tak nemá čím prejsť.
 */
export function assertPayloadInput(input: PayloadHashInput): void {
  const fail = (message: string): never => {
    throw new PreviewTokenError('bad_input', message);
  };

  if (!PREVIEW_CAMPAIGN_KINDS.includes(input.kind)) fail(`Neznámy kind kampane: ${input.kind}.`);

  if (!Array.isArray(input.productIds) || input.productIds.length === 0) {
    fail('Sada musí obsahovať aspoň jeden produkt.');
  }
  if (input.productIds.length > PREVIEW_MAX_PRODUCTS) {
    fail(
      `Sada má ${input.productIds.length} produktov, strop je ${PREVIEW_MAX_PRODUCTS} (I2, R1).`,
    );
  }
  for (const id of input.productIds) {
    if (!Number.isInteger(id) || id <= 0) fail(`Neplatné product ID: ${String(id)}.`);
  }
  if (new Set(input.productIds).size !== input.productIds.length) {
    fail('Sada obsahuje duplicitné product ID — sada musí byť množina (I2).');
  }

  if (!Number.isInteger(input.percent) || input.percent < PERCENT_MIN || input.percent > PERCENT_MAX) {
    fail(`Percento musí byť celé číslo ${PERCENT_MIN}–${PERCENT_MAX} (I9, D11).`);
  }

  if (!isRealDateOnly(input.from)) fail(`Dátum "from" nie je platný YYYY-MM-DD: ${input.from}.`);
  if (!isRealDateOnly(input.to)) fail(`Dátum "to" nie je platný YYYY-MM-DD: ${input.to}.`);
  if (input.to < input.from) fail(`Okno je obrátené: to (${input.to}) < from (${input.from}) — I9.`);
}

/**
 * SHA-256 kanonického JSON `{ productIds sorted, percent, from, to, kind }` (§7).
 * Kanonizácia = kľúče v pevnom (abecednom) poradí + `productIds` vzostupne.
 */
export function computePayloadHash(input: PayloadHashInput): Sha256Hex {
  assertPayloadInput(input);
  const canonical = JSON.stringify({
    from: input.from,
    kind: input.kind,
    percent: input.percent,
    productIds: [...input.productIds].sort((a, b) => a - b),
    to: input.to,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/* ─────────────────────────── jednorazovosť (I3) ─────────────────────────── */

export interface PreviewTokenStore {
  /**
   * Označí `jti` za použitý. `true` = prvé použitie, `false` = REPLAY.
   * Implementácia MUSÍ byť atomická (check-and-set), inak I3 tečie.
   */
  consume(jti: string, expiresAt: Date): Promise<boolean>;
}

export interface MemoryPreviewTokenStore extends PreviewTokenStore {
  size(): number;
  clear(): void;
}

/**
 * In-process store. Postačuje, pretože appka beží ako jedna instancia na
 * `127.0.0.1` (R4, I5) a token žije 15 minút. Po restarte sú všetky tokeny
 * neplatné — to je fail-closed smer (užívateľ zopakuje dry-run, D16).
 */
export function createMemoryPreviewTokenStore(
  now: () => Date = () => new Date(),
): MemoryPreviewTokenStore {
  const used = new Map<string, number>();

  const prune = (): void => {
    const nowMs = now().getTime();
    for (const [jti, expiresAtMs] of used) {
      if (expiresAtMs <= nowMs) used.delete(jti);
    }
  };

  return {
    async consume(jti: string, expiresAt: Date): Promise<boolean> {
      prune();
      if (used.has(jti)) return false;
      used.set(jti, expiresAt.getTime());
      return true;
    },
    size(): number {
      prune();
      return used.size;
    },
    clear(): void {
      used.clear();
    },
  };
}

/* ───────────────────────────── claims validácia ─────────────────────────── */

const dateOnlySchema = z.string().refine(isRealDateOnly, 'Očakáva sa platný dátum YYYY-MM-DD.');

const claimsSchema = z.object({
  jti: z.string().min(1).max(64),
  sub: z.coerce.number().int().positive(),
  kind: z.enum(PREVIEW_CAMPAIGN_KINDS),
  productIds: z.array(z.number().int().positive()).min(1).max(PREVIEW_MAX_PRODUCTS),
  percent: z.number().int().min(PERCENT_MIN).max(PERCENT_MAX),
  from: dateOnlySchema,
  to: dateOnlySchema,
  pricesAtPreview: z.record(z.string(), z.string()),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
});

/* ──────────────────────────────── služba ───────────────────────────────── */

export interface PreviewTokenServiceOptions {
  /** Podpisový materiál. Default = `SESSION_SECRET_FILE` (§7). */
  secret?: Buffer | (() => Buffer);
  /** Replay guard. Default = in-process store. */
  store?: PreviewTokenStore;
  /** Default 900 s (15 min). Strop je pevný — dlhšie TTL sa odmietne. */
  ttlSeconds?: number;
  /** Injektovateľný čas pre testy. */
  now?: () => Date;
}

export interface PreviewTokenServiceInstance extends PreviewTokenService {
  readonly store: PreviewTokenStore;
  readonly ttlSeconds: number;
}

export function createPreviewTokenService(
  options: PreviewTokenServiceOptions = {},
): PreviewTokenServiceInstance {
  const now = options.now ?? (() => new Date());
  const ttlSeconds = Math.min(options.ttlSeconds ?? PREVIEW_TOKEN_TTL_SECONDS, PREVIEW_TOKEN_TTL_SECONDS);
  const store = options.store ?? createMemoryPreviewTokenStore(now);

  const secretOf = (): Uint8Array => {
    const raw = typeof options.secret === 'function' ? options.secret() : options.secret;
    const material = raw ?? loadSessionSecret();
    // Kópia: jose si referenciu drží počas podpisu a session secret nikto
    // nesmie omylom prepísať.
    return Uint8Array.from(material);
  };

  const service: PreviewTokenServiceInstance = {
    store,
    ttlSeconds,

    computePayloadHash,

    async issue(claims) {
      assertPayloadInput(claims);
      if (!Number.isInteger(claims.sub) || claims.sub <= 0) {
        throw new PreviewTokenError('bad_input', 'Preview token potrebuje ID prihláseného usera.');
      }

      const prices = claims.pricesAtPreview ?? {};
      const allowed = new Set(claims.productIds.map((id) => String(id)));
      for (const key of Object.keys(prices)) {
        if (!allowed.has(key)) {
          throw new PreviewTokenError(
            'bad_input',
            `pricesAtPreview obsahuje produkt ${key}, ktorý v sade nie je (D39c).`,
          );
        }
      }

      const payloadHash = computePayloadHash(claims);
      const jti = ulid();
      const issuedAtSec = Math.floor(now().getTime() / 1000);

      const token = await new SignJWT({
        kind: claims.kind,
        productIds: [...claims.productIds].sort((a, b) => a - b),
        percent: claims.percent,
        from: claims.from,
        to: claims.to,
        pricesAtPreview: prices,
        payloadHash,
      })
        .setProtectedHeader({ alg: PREVIEW_TOKEN_ALG, typ: 'JWT' })
        .setIssuer(PREVIEW_TOKEN_ISSUER)
        .setAudience(PREVIEW_TOKEN_AUDIENCE)
        .setSubject(String(claims.sub))
        .setJti(jti)
        .setIssuedAt(issuedAtSec)
        .setNotBefore(issuedAtSec)
        .setExpirationTime(issuedAtSec + ttlSeconds)
        .sign(secretOf());

      return { token, jti, payloadHash };
    },

    async verify(token, expected) {
      if (typeof token !== 'string' || token.length === 0) {
        throw new PreviewTokenError('invalid_token', 'Chýba preview token — zápis sa odmieta (I3).');
      }
      // Očakávanú sadu validujeme prvú: nezmyselnú operáciu odmietneme aj vtedy,
      // keby bol token náhodou platný (fail-closed, I2/I9).
      const expectedHash = computePayloadHash(expected);

      let payload: JWTPayload;
      try {
        const result = await jwtVerify(token, secretOf(), {
          algorithms: [PREVIEW_TOKEN_ALG],
          issuer: PREVIEW_TOKEN_ISSUER,
          audience: PREVIEW_TOKEN_AUDIENCE,
          clockTolerance: 0,
          currentDate: now(),
        });
        payload = result.payload;
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === 'ERR_JWT_EXPIRED') {
          throw new PreviewTokenError(
            'expired',
            `Preview token expiroval (TTL ${Math.round(ttlSeconds / 60)} min) — spusti dry-run znova (I3).`,
          );
        }
        throw new PreviewTokenError(
          'invalid_token',
          'Preview token je neplatný alebo pozmenený — zápis sa odmieta (I3).',
        );
      }

      const parsed = claimsSchema.safeParse(payload);
      if (!parsed.success) {
        throw new PreviewTokenError(
          'invalid_token',
          'Preview token nemá očakávanú štruktúru claims — zápis sa odmieta (I3).',
        );
      }
      const claims: PreviewTokenClaims = parsed.data;

      // TTL nesmie byť natiahnuté nad 15 min ani vlastným podpisom.
      const iat = typeof payload.iat === 'number' ? payload.iat : null;
      const exp = typeof payload.exp === 'number' ? payload.exp : null;
      if (exp === null || iat === null || exp - iat > ttlSeconds) {
        throw new PreviewTokenError(
          'invalid_token',
          `Preview token má neplatnú životnosť — povolené je maximálne ${ttlSeconds} s (§7).`,
        );
      }

      // 1) hash musí sedeť s vlastnými claimami (podvrhnutý payloadHash),
      const selfHash = computePayloadHash(claims);
      if (!hashesEqual(selfHash, claims.payloadHash)) {
        throw new PreviewTokenError(
          'payload_mismatch',
          'payloadHash v tokene nesúhlasí s jeho vlastnými parametrami — zápis sa odmieta (I3).',
        );
      }
      // 2) a zároveň s požadovanou operáciou (iná sada než potvrdená).
      if (!hashesEqual(expectedHash, claims.payloadHash)) {
        throw new PreviewTokenError(
          'payload_mismatch',
          'Potvrdená sada z dry-runu sa nezhoduje s požadovaným zápisom — ' +
            'zopakuj dry-run pre nové parametre (I3, D16).',
        );
      }
      // 3) ceny musia patriť sade (D39c).
      const allowed = new Set(claims.productIds.map((id) => String(id)));
      for (const key of Object.keys(claims.pricesAtPreview)) {
        if (!allowed.has(key)) {
          throw new PreviewTokenError(
            'payload_mismatch',
            'pricesAtPreview v tokene obsahuje produkt mimo potvrdenej sady (D39c).',
          );
        }
      }

      // 4) jednorazovosť — až po všetkých kontrolách, aby neúspešný pokus
      //    nespálil token platnej sady.
      const first = await store.consume(claims.jti, new Date(exp * 1000));
      if (!first) {
        throw new PreviewTokenError(
          'replayed',
          'Preview token už bol použitý — každý zápis potrebuje vlastný dry-run (I3, D16).',
        );
      }

      return claims;
    },
  };

  return service;
}

/* ───────────────────────────── default instancia ───────────────────────── */

let defaultStore: PreviewTokenStore | null = null;
let defaultService: PreviewTokenServiceInstance | null = null;

/**
 * Umožní A9/A12 nahradiť in-process replay guard trvalým (DB) bez zmeny tohto
 * súboru. Volá sa raz pri boote, PRED prvým vydaním tokenu.
 */
export function setDefaultPreviewTokenStore(store: PreviewTokenStore | null): void {
  defaultStore = store;
  defaultService = null;
}

function getDefaultService(): PreviewTokenServiceInstance {
  if (!defaultService) {
    defaultService = createPreviewTokenService(defaultStore ? { store: defaultStore } : {});
  }
  return defaultService;
}

/**
 * Singleton pre route-y a engine. Session secret sa číta lazy pri prvom použití,
 * takže samotný import nikdy nezhodí build ani statickú analýzu Next.js.
 */
export const previewTokenService: PreviewTokenService = {
  issue: (claims) => getDefaultService().issue(claims),
  verify: (token, expected) => getDefaultService().verify(token, expected),
  computePayloadHash,
};

/** Výhradne pre testy — zabudne default instanciu aj jej store. */
export function resetDefaultPreviewTokenService(): void {
  defaultStore = null;
  defaultService = null;
}
