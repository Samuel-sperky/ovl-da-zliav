/**
 * Aura Zľavy — preview token (BUILD-SPEC §7 „Preview token", O2, I3, D2, D16, D39c).
 *
 * Preview token je NOSIČ INVARIANTU I3 („žiadny zápis bez potvrdenia"): dry-run
 * vydá podpísaný token nad kanonickou sadou parametrov a ostrý zápis ho vyžaduje.
 * Bez platného tokenu neexistuje cesta kódu, ktorá by zapísala do shopu.
 *
 * ```
 * HS256 JWT (jose), secret zo SESSION_SECRET_FILE, TTL 15 min
 * claims: { jti, sub, kind, productIds, percent, percents?, from, to,
 *           pricesAtPreview, payloadHash }
 * payloadHash = SHA-256 STREAMOVANEJ hlavičky + trojíc (K4):
 *     kind:<kind>\n  from:<from>\n  to:<to>\n  count:<n>\n
 *     <product_id>:<percent>:<price_at_preview>\n   … vzostupne podľa product_id
 * ```
 *
 * ZMENA V3 (K4). Do V2 sa hashoval kanonický JSON `{productIds, percent, from,
 * to, kind}` — jeden materializovaný reťazec a JEDNO percento na celú kampaň.
 * Oboje prestalo stačiť:
 *  - K3 dovoľuje pásma, takže percento je vlastnosť POLOŽKY, nie kampane
 *    (`campaigns.percent` je už len „najvyššie percento" do hlavičky),
 *  - K1 dvíha strop na 10 000 položiek, takže sa reťazec nesmie materializovať;
 *    hash sa sype po položkách do `hash.update()` (`streamPayloadHash`).
 *
 * HLAVIČKA `kind/from/to/count` NIE JE v texte K4, ale hashuje sa — vedome:
 * K4 mení LEN to, čo sa hashuje za položky, a výslovne necháva I3 v platnosti.
 * Bez okna a druhu kampane v hashi by token potvrdený na september autorizoval
 * zápis toho istého tovaru na december a `assertConfirmed()` v executore by
 * stratil zmysel (D25 tam porovnáva hash nad `date_from` aj
 * `date_from_original`). `count` je navyše poistka proti tomu, aby sa dala
 * sada oklieštiť bez zmeny hashu. Pri rozpore vyhráva invariant, nie mockup.
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
 *  - I2 → K1 — sada má 1 až `PREVIEW_MAX_PRODUCTS` (10 000) produktov bez
 *         duplikátov; inak sa token ani nevydá. Strop režimu `pilot` (10) sem
 *         nepatrí — ten pozná `checkScope()` v `lib/engine/guards.ts`, lebo
 *         závisí od `scope_mode`, ktorý sa číta fail-closed z DB.
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

import type {
  CampaignKind,
  DateOnly,
  DiscountPercent,
  MoneyString,
  PreviewTokenClaims,
  PreviewTokenService,
  Sha256Hex,
} from '@/contracts';
import { loadSessionSecret } from '@/lib/crypto/master-key';
import { centsToMoney, isMoneyString, moneyToCents } from '@/lib/domain/pricing';

/** TTL 15 minút — normatívne v §7 aj O2, preto konštanta, nie ENV. */
export const PREVIEW_TOKEN_TTL_SECONDS = 15 * 60;

export const PREVIEW_TOKEN_ALG = 'HS256';
export const PREVIEW_TOKEN_ISSUER = 'ovl-zliav';
export const PREVIEW_TOKEN_AUDIENCE = 'ovl-zliav:preview';

/**
 * Tvrdý strop na jednu sadu — nezávislý od ENV, aby sa nedal zvýšiť
 * konfiguráciou. K1 bod 3: rovnaké číslo drží aj DB (`CHECK campaigns.items_total
 * <= 10000`). Strop režimu `pilot` (10) TU NEŽIJE — je to vecou `checkScope()`
 * v `src/lib/engine/guards.ts`, ktorý pozná `scope_mode` a číta ho fail-closed.
 * Token je posledná poistka proti nezmyselne veľkej sade, nie nositeľ režimu.
 */
export const PREVIEW_MAX_PRODUCTS = 10_000;
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

/** Jedna trojica do hashu (K4). `priceAtPreview = null` = cena nebola známa. */
export interface PayloadHashItem {
  productId: number;
  /** Percento POLOŽKY, nie kampane — pásma (K3). */
  percent: DiscountPercent;
  priceAtPreview: MoneyString | null;
}

/** Kanonický (položkový) tvar vstupu do hashu — presne to, čo sa streamuje. */
export interface ItemisedPayloadHashInput {
  kind: CampaignKind;
  from: DateOnly;
  to: DateOnly;
  items: readonly PayloadHashItem[];
}

/**
 * Rovnomerný tvar: jedno percento na celú sadu (kampaň bez pásiem) alebo pásma
 * rozpísané v `percents`. Existuje preto, aby volajúci (route, executor, testy)
 * nemuseli skladať položky ručne — normalizuje sa na `ItemisedPayloadHashInput`.
 */
export interface UniformPayloadHashInput {
  kind: CampaignKind;
  productIds: readonly number[];
  /** Hlavičkové percento kampane = NAJVYŠŠIE percento pásiem (K3). */
  percent: DiscountPercent;
  from: DateOnly;
  to: DateOnly;
  /** `price_at_preview` per produkt (D39c). Chýbajúca cena = `null`. */
  pricesAtPreview?: Readonly<Record<string, MoneyString>> | undefined;
  /** Percento per produkt (K3). Keď chýba, platí `percent` pre celú sadu. */
  percents?: Readonly<Record<string, DiscountPercent>> | undefined;
}

export type PayloadHashInput = ItemisedPayloadHashInput | UniformPayloadHashInput;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function fail(message: string): never {
  throw new PreviewTokenError('bad_input', message);
}

function isItemised(input: PayloadHashInput): input is ItemisedPayloadHashInput {
  return Array.isArray((input as ItemisedPayloadHashInput).items);
}

/**
 * Cena do hashu MUSÍ mať jeden tvar, inak by `19.9` z jedného zdroja a `19.90`
 * z DB dali dva rôzne hashe a zápis by sa odmietol bez vysvetlenia. Prechod cez
 * centy je zároveň kontrola, že to vôbec je peňažná hodnota.
 */
function canonicalPrice(value: MoneyString | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (!isMoneyString(value)) fail(`Cena "${String(value)}" nie je peňažná hodnota (D39c).`);
  try {
    return centsToMoney(moneyToCents(value));
  } catch {
    return fail(`Cena "${String(value)}" sa nedá kanonizovať (D39c).`);
  }
}

/**
 * Zjednotí oba tvary vstupu na zoznam trojíc ZORADENÝ vzostupne podľa
 * `product_id` (K4) a cestou overí sadu (I9, K1, K3). Fail-closed: pri
 * pochybnosti sa token NEVYDÁ a zápis tak nemá čím prejsť.
 */
export function normalizePayloadHashInput(input: PayloadHashInput): ItemisedPayloadHashInput {
  if (!PREVIEW_CAMPAIGN_KINDS.includes(input.kind)) fail(`Neznámy kind kampane: ${input.kind}.`);

  const raw: PayloadHashItem[] = [];
  if (isItemised(input)) {
    if (!Array.isArray(input.items)) fail('Sada musí byť pole položiek.');
    for (const item of input.items) {
      raw.push({
        productId: item.productId,
        percent: item.percent,
        priceAtPreview: item.priceAtPreview,
      });
    }
  } else {
    if (!Array.isArray(input.productIds)) fail('Sada musí byť pole product ID.');
    const prices = input.pricesAtPreview ?? {};
    const percents = input.percents ?? {};
    for (const productId of input.productIds) {
      const key = String(productId);
      raw.push({
        productId,
        percent: percents[key] ?? input.percent,
        priceAtPreview: prices[key] ?? null,
      });
    }
    if (!Number.isInteger(input.percent) || input.percent < PERCENT_MIN || input.percent > PERCENT_MAX) {
      fail(`Percento musí byť celé číslo ${PERCENT_MIN}–${PERCENT_MAX} (I9, D11).`);
    }
  }

  if (raw.length === 0) fail('Sada musí obsahovať aspoň jeden produkt.');
  if (raw.length > PREVIEW_MAX_PRODUCTS) {
    fail(`Sada má ${raw.length} produktov, strop je ${PREVIEW_MAX_PRODUCTS} (K1 bod 3).`);
  }

  const seen = new Set<number>();
  for (const item of raw) {
    if (!Number.isInteger(item.productId) || item.productId <= 0) {
      fail(`Neplatné product ID: ${String(item.productId)}.`);
    }
    if (seen.has(item.productId)) {
      fail('Sada obsahuje duplicitné product ID — sada musí byť množina.');
    }
    seen.add(item.productId);
    if (
      !Number.isInteger(item.percent) ||
      item.percent < PERCENT_MIN ||
      item.percent > PERCENT_MAX
    ) {
      fail(
        `Produkt ${item.productId} má percento mimo ${PERCENT_MIN}–${PERCENT_MAX} (I9, D11, K3).`,
      );
    }
  }

  if (!isRealDateOnly(input.from)) fail(`Dátum "from" nie je platný YYYY-MM-DD: ${input.from}.`);
  if (!isRealDateOnly(input.to)) fail(`Dátum "to" nie je platný YYYY-MM-DD: ${input.to}.`);
  if (input.to < input.from) fail(`Okno je obrátené: to (${input.to}) < from (${input.from}) — I9.`);

  raw.sort((a, b) => a.productId - b.productId);
  return { kind: input.kind, from: input.from, to: input.to, items: raw };
}

/** Spätne kompatibilné meno — validácia je vedľajší efekt normalizácie. */
export function assertPayloadInput(input: PayloadHashInput): void {
  normalizePayloadHashInput(input);
}

/**
 * JEDINÝ zdroj kanonického bajtového toku, z ktorého vzniká `payloadHash` (K4).
 * Sype po kúskoch — hlavička sú štyri krátke riadky, potom jedna trojica na
 * položku. Pri 10 000 položkách sa NIKDY nepostaví jeden obrí reťazec; to je
 * celý dôvod, prečo je táto funkcia oddelená a exportovaná (dá sa to odmerať).
 */
export function streamPayloadHash(input: PayloadHashInput, sink: (chunk: string) => void): void {
  const canonical = normalizePayloadHashInput(input);
  sink(`kind:${canonical.kind}\n`);
  sink(`from:${canonical.from}\n`);
  sink(`to:${canonical.to}\n`);
  sink(`count:${canonical.items.length}\n`);
  for (const item of canonical.items) {
    sink(`${item.productId}:${item.percent}:${canonicalPrice(item.priceAtPreview)}\n`);
  }
}

/** SHA-256 nad tokom z `streamPayloadHash` (K4). */
export function computePayloadHash(input: PayloadHashInput): Sha256Hex {
  const hash = createHash('sha256');
  streamPayloadHash(input, (chunk) => {
    hash.update(chunk, 'utf8');
  });
  return hash.digest('hex');
}

/**
 * Prevedie riadky `campaign_items` na trojice do hashu. Executor MUSÍ počítať
 * hash presne z týchto stĺpcov (`product_id`, `percent`, `price_at_preview`) —
 * inak sa rozíde s tým, čo podpísal dry-run, a I3 by padlo na „confirmation
 * mismatch" pri každom zápise.
 */
export function payloadHashItemsFromRows(
  rows: ReadonlyArray<{
    productId: number;
    percent: DiscountPercent;
    priceAtPreview: MoneyString | null;
  }>,
): PayloadHashItem[] {
  return rows.map((row) => ({
    productId: row.productId,
    percent: row.percent,
    priceAtPreview: row.priceAtPreview,
  }));
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
  /** Pásma (K3) — percento per produkt. Chýba pri kampani s jedným percentom. */
  percents: z.record(z.string(), z.number().int().min(PERCENT_MIN).max(PERCENT_MAX)).optional(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * Claims rozšírené o pásma (K3). `PreviewTokenClaims` v `src/contracts.ts` vlastní
 * iný agent, preto rozšírenie žije tu; je priraditeľné na kontraktový typ, takže
 * route ani executor nič nestrácajú.
 */
export interface PreviewTokenClaimsEx extends PreviewTokenClaims {
  percents?: Record<string, DiscountPercent>;
}

/** Sada, na ktorú sa token overuje. `percents` je voliteľné (K3). */
export type ExpectedPayload = Pick<
  PreviewTokenClaims,
  'kind' | 'productIds' | 'percent' | 'from' | 'to'
> & { percents?: Readonly<Record<string, DiscountPercent>> | undefined };

/** Vstup `issue()` — claims bez `jti`/`payloadHash`, plus pásma (K3). */
export type IssuePayload = Omit<PreviewTokenClaims, 'jti' | 'payloadHash'> & {
  percents?: Readonly<Record<string, DiscountPercent>> | undefined;
};

/**
 * Rozhranie služby po V3. Je podtypom `PreviewTokenService` z kontraktu (všetky
 * pridané polia sú voliteľné), takže volajúci, ktorí o pásmach nevedia, fungujú
 * nezmenene.
 */
export interface PreviewTokenServiceV3 extends PreviewTokenService {
  issue(claims: IssuePayload): Promise<{ token: string; jti: string; payloadHash: Sha256Hex }>;
  verify(token: string, expected: ExpectedPayload): Promise<PreviewTokenClaimsEx>;
  computePayloadHash(input: PayloadHashInput): Sha256Hex;
}

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

export interface PreviewTokenServiceInstance extends PreviewTokenServiceV3 {
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

      const percents = claims.percents;
      if (percents !== undefined) {
        for (const key of Object.keys(percents)) {
          if (!allowed.has(key)) {
            throw new PreviewTokenError(
              'bad_input',
              `percents obsahuje produkt ${key}, ktorý v sade nie je (K3).`,
            );
          }
        }
        // K3 — `campaigns.percent` je hlavička a znamená NAJVYŠŠIE percento
        // pásiem. Keby to neplatilo, zoznamy kampaní by klamali o rozsahu zľavy.
        const highest = Math.max(...claims.productIds.map((id) => percents[String(id)] ?? claims.percent));
        if (highest !== claims.percent) {
          throw new PreviewTokenError(
            'bad_input',
            `Hlavičkové percento kampane (${claims.percent}) nie je najvyššie percento pásiem (${highest}) — K3.`,
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
        ...(percents !== undefined ? { percents } : {}),
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
      // keby bol token náhodou platný (fail-closed, K1/I9).
      const wanted = expected;
      assertPayloadInput({
        kind: wanted.kind,
        productIds: wanted.productIds,
        percent: wanted.percent,
        from: wanted.from,
        to: wanted.to,
        percents: wanted.percents,
      });

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
      const claims: PreviewTokenClaimsEx = parsed.data;

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
      const selfHash = computePayloadHash({
        kind: claims.kind,
        productIds: claims.productIds,
        percent: claims.percent,
        from: claims.from,
        to: claims.to,
        pricesAtPreview: claims.pricesAtPreview,
        percents: claims.percents,
      });
      if (!hashesEqual(selfHash, claims.payloadHash)) {
        throw new PreviewTokenError(
          'payload_mismatch',
          'payloadHash v tokene nesúhlasí s jeho vlastnými parametrami — zápis sa odmieta (I3).',
        );
      }
      // 2) a zároveň s požadovanou operáciou (iná sada než potvrdená).
      //    Ceny (D39c) a percentá pásiem (K3) NIE SÚ súčasťou požiadavky — tá
      //    nesie len kind/productIds/percent/from/to. Do očakávaného hashu sa
      //    preto berú z tokenu, ktorého pravosť práve dokázal krok 1; hlavičkové
      //    percento sa navyše porovná priamo, aby ho nešlo prekryť pásmami.
      if (wanted.percent !== claims.percent) {
        throw new PreviewTokenError(
          'payload_mismatch',
          'Percento v požiadavke sa nezhoduje s potvrdeným dry-runom (I3, D16).',
        );
      }
      const expectedHash = computePayloadHash({
        kind: wanted.kind,
        productIds: wanted.productIds,
        percent: wanted.percent,
        from: wanted.from,
        to: wanted.to,
        pricesAtPreview: claims.pricesAtPreview,
        percents: wanted.percents ?? claims.percents,
      });
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
export const previewTokenService: PreviewTokenServiceV3 = {
  issue: (claims) => getDefaultService().issue(claims),
  verify: (token, expected) => getDefaultService().verify(token, expected),
  computePayloadHash,
};

/** Výhradne pre testy — zabudne default instanciu aj jej store. */
export function resetDefaultPreviewTokenService(): void {
  defaultStore = null;
  defaultService = null;
}
