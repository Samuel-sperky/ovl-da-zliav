/**
 * Aura Zľavy — zod schémy odpovedí shopu (D54, BUILD-SPEC §2/§6).
 *
 * Konvencia z BUILD-SPEC §2: „Neznámy kľúč v odpovedi shopu = `passthrough` OK,
 * chýbajúci/zle typovaný povinný kľúč = `uncertain` (D54)." Preto sú všetky
 * schémy `looseObject` (zod 4 náhrada za `.passthrough()`) — shop smie pridať
 * pole, ale NESMIE odobrať alebo zmeniť typ povinného poľa.
 *
 * Modul zvláda **obe tvarové konvencie** shopu (§6):
 *   1. `{ ok: true, … }` / `{ ok: false, errors: ['invalid_dates', …] }`
 *   2. bare objekt bez `ok` (list endpointy) / `{ error: '…' }` (transportné chyby)
 *   3. `{ ok: false, error: '…' }` (staršie endpointy so singulárnym `error`)
 *
 * HTTP 200 s `ok:false` sa NIKDY nevyhodnocuje ako úspech — o to sa stará
 * `readErrorBody()` + `classifyFailure()` v `errors.ts`.
 *
 * Peniaze a booleany zo shopu prijímame tolerantne (číslo aj číselný string,
 * `true`/`1`/`'1'`), pretože PHP serializuje `DECIMAL` občas ako string. To NIE JE
 * porušenie D54: kľúč musí byť prítomný a musí byť konvertovateľný, inak drift.
 *
 * Vlastník: A3.
 */
import { z } from 'zod';

import type { ProductDetail, ProductListItem } from '@/contracts';

/* ═════════════════════════ 1. Tolerantné primitívy ════════════════════════ */

/** Číslo alebo číselný string (PHP `DECIMAL`) → `number`. */
const numberLike = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'number' ? v : Number(v.trim())))
  .refine((n) => Number.isFinite(n), 'nie je číslo');

/** Celé číslo v rovnakej tolerancii (id, stránkovanie). */
const intLike = numberLike.refine((n) => Number.isInteger(n), 'nie je celé číslo');

/** `true`/`false`, `1`/`0`, `'1'`/`'0'`, `'true'`/`'false'` → `boolean`. */
const boolLike = z
  .union([z.boolean(), z.literal(0), z.literal(1), z.enum(['0', '1', 'true', 'false'])])
  .transform((v) => v === true || v === 1 || v === '1' || v === 'true');

/** Text, ktorý shop smie poslať ako `null` alebo vynechať. */
const optionalText = z.union([z.string(), z.null()]).optional();

/* ═══════════════════════════ 2. Schémy produktov ══════════════════════════ */

/** Položka z `GET /api/products`. */
export const productListItemSchema = z.looseObject({
  id: intLike,
  name: z.string(),
  price: numberLike,
  has_attributes: boolLike,
});

/** Stránkovaná odpoveď zo zdieľaného paginátora shopu. */
export const productListResponseSchema = z.looseObject({
  data: z.array(productListItemSchema),
  page: intLike,
  per_page: intLike,
  total: intLike,
});

export const productAttributeSchema = z.looseObject({
  id_product_attribute: intLike,
  price_impact: numberLike.optional(),
  reference: optionalText,
  ean13: optionalText,
  quantity: intLike.optional(),
  is_default: boolLike.optional(),
  values: z.array(z.string()).optional(),
});

/**
 * `GET /api/products/get?id=` (D48) aj slot dávky (D56).
 *
 * `ok` je nepovinné: v dávke sa vracia „v presnom tvare, aký by endpoint vrátil
 * samostatne", ale staršie/novšie verzie shopu ho pridávajú nekonzistentne.
 * Keď je prítomné, MUSÍ byť `true` — `ok:false` sem nikdy nesmie doraziť,
 * odchytí ho `readErrorBody()` skôr.
 */
export const productDetailSchema = z.looseObject({
  ok: z.literal(true).optional(),
  id: intLike,
  name: z.string(),
  price: numberLike,
  has_attributes: boolLike,
  description: optionalText,
  description_short: optionalText,
  attributes: z.array(productAttributeSchema).optional(),
});

/** `POST /api/products/setReduction` — úspech (D50). */
export const setReductionSuccessSchema = z.looseObject({
  ok: z.literal(true),
  id: intLike,
});

/** `POST /api/batch` — obálka; jednotlivé sloty sa validujú samostatne. */
export const batchResponseSchema = z.looseObject({
  ok: z.literal(true),
  results: z.array(z.unknown()),
});

export type ParsedProductListResponse = z.infer<typeof productListResponseSchema>;
export type ParsedProductDetail = z.infer<typeof productDetailSchema>;
export type ParsedProductListItem = z.infer<typeof productListItemSchema>;

/* ══════════════════════════ 3. Prevod na kontrakty ════════════════════════ */

export function toProductListItem(parsed: ParsedProductListItem): ProductListItem {
  return {
    id: parsed.id,
    name: parsed.name,
    price: parsed.price,
    has_attributes: parsed.has_attributes,
  };
}

export function toProductDetail(parsed: ParsedProductDetail): ProductDetail {
  const detail: ProductDetail = {
    id: parsed.id,
    name: parsed.name,
    price: parsed.price,
    has_attributes: parsed.has_attributes,
  };
  if (parsed.description !== undefined) detail.description = parsed.description;
  if (parsed.description_short !== undefined) detail.description_short = parsed.description_short;
  if (parsed.attributes !== undefined) {
    detail.attributes = parsed.attributes.map((a) => ({
      id_product_attribute: a.id_product_attribute,
      ...(a.price_impact !== undefined ? { price_impact: a.price_impact } : {}),
      ...(a.reference !== undefined ? { reference: a.reference } : {}),
      ...(a.ean13 !== undefined ? { ean13: a.ean13 } : {}),
      ...(a.quantity !== undefined ? { quantity: a.quantity } : {}),
      ...(a.is_default !== undefined ? { is_default: a.is_default } : {}),
      ...(a.values !== undefined ? { values: a.values } : {}),
    }));
  }
  return detail;
}

/* ═══════════════════════ 4. Validácia s hlásením driftu ═══════════════════ */

export type ParseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; issues: string[] };

/**
 * Validácia odpovede. Zlyhanie NIE JE chyba volajúceho — je to `schema_drift`
 * (D54), teda „stav neistý". Vracia zoznam problémov pre audit; hodnoty polí sa
 * do problémov nedávajú (mohli by obsahovať čokoľvek, I1) — len cesty a dôvody.
 */
export function parseShopPayload<T>(schema: z.ZodType<T>, value: unknown): ParseOutcome<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.code}`;
  });
  return { ok: false, issues };
}

/* ═════════════════════ 5. Normalizácia chybových tvarov ═══════════════════ */

export interface ShopErrorBody {
  /** Telo obsahuje `ok:false` — nikdy sa nepovažuje za úspech (§6). */
  okFalse: boolean;
  /** Telo obsahuje `ok:true`. */
  okTrue: boolean;
  /** Surové kódy zo shopu v poradí, v akom ich poslal (`errors[]` alebo `error`). */
  codes: string[];
}

function stringCodes(value: unknown): string[] {
  if (typeof value === 'string' && value.trim().length > 0) return [value.trim()];
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
  }
  return [];
}

/**
 * Prečíta chybové kódy z ĽUBOVOĽNEJ z troch konvencií shopu (§6):
 * `{ok:false,errors:[…]}`, `{ok:false,error:'…'}`, `{error:'…'}`.
 * Zvláda aj `errors` ako jediný string (obranne — dokumentácia to nesľubuje).
 */
export function readErrorBody(body: unknown): ShopErrorBody {
  if (typeof body !== 'object' || body === null) {
    return { okFalse: false, okTrue: false, codes: [] };
  }
  const obj = body as Record<string, unknown>;
  const codes = [...stringCodes(obj.errors), ...stringCodes(obj.error)];
  return {
    okFalse: obj.ok === false,
    okTrue: obj.ok === true,
    codes,
  };
}

/**
 * True, keď telo hlási neúspech aj pri HTTP 200 (§6: „HTTP 200 s `ok:false`
 * sa NIKDY nepovažuje za úspech").
 */
export function bodySignalsFailure(body: unknown): boolean {
  const read = readErrorBody(body);
  return read.okFalse || (!read.okTrue && read.codes.length > 0);
}
