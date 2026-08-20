/**
 * Aura Zľavy — hierarchická korelácia volaní (D58, BUILD-SPEC §2/§6).
 *
 * D58: „Každý request voči shopu MUSÍ nesť `User-Agent: aura-zlavy/<verzia>`
 * a hierarchické korelačné ID (`operation_id` per dávka, `request_id` per
 * volanie), oboje uložené v audite."
 *
 * Hierarchia:
 *   `operation_id` — vzniká RAZ per operácia/kampaň (dávka až 10 produktov),
 *   `request_id`   — vzniká per HTTP volanie, teda aj per retry pokus.
 *
 * Obe sú ULID (26 znakov, `CHAR(26)` v DB, §2) a generujú sa **monotónne**:
 * dve ID vytvorené v tej istej milisekunde sú lexikograficky usporiadané, takže
 * poradie zápisov v dávke je z auditu čitateľné aj bez timestampov (I10).
 *
 * Vlastník: A3.
 */
import { isValid, monotonicFactory, ulid } from 'ulid';

import type { LogFields, ShopCtx, Ulid } from '@/contracts';

import { APP_SLUG, APP_VERSION } from '@/version';

/** Dĺžka ULID podľa §2 (`CHAR(26)`). */
export const ULID_LENGTH = 26;

/** Monotónny generátor — zachováva poradie v rámci jednej milisekundy. */
const nextUlid = monotonicFactory();

/** Nové `operation_id` pre celú operáciu/kampaň (D58). */
export function newOperationId(): Ulid {
  return nextUlid();
}

/** Nové `request_id` pre jedno HTTP volanie (D58). */
export function newRequestId(): Ulid {
  return nextUlid();
}

/** Nemonotónny ULID — pre prípady, kde poradie nehrá rolu (testy, fixtures). */
export function randomUlid(): Ulid {
  return ulid();
}

/** Overenie tvaru (26 znakov Crockford base32). */
export function isUlid(value: unknown): value is Ulid {
  return typeof value === 'string' && value.length === ULID_LENGTH && isValid(value);
}

/** Nový korelačný kontext operácie. `requestId` sa dopĺňa až per volanie. */
export function newOperationContext(): ShopCtx {
  return { operationId: newOperationId() };
}

/**
 * Kontext jedného volania: zdedí `operationId` a garantuje `requestId`.
 * Ak volajúci `requestId` predpísal, použije sa jeho (napr. pre reconcile
 * dohľadateľnosť); inak vznikne nové.
 */
export function requestContext(ctx: ShopCtx): { operationId: Ulid; requestId: Ulid } {
  return {
    operationId: ctx.operationId,
    requestId: isUlid(ctx.requestId) ? ctx.requestId : newRequestId(),
  };
}

/**
 * `request_id` pre ĎALŠÍ pokus toho istého logického volania (retry).
 * D58 hovorí „`request_id` per volanie", takže každý retry pokus má vlastné.
 */
export function nextAttemptRequestId(): Ulid {
  return newRequestId();
}

/** Hlavičky korelácie a identity, ktoré nesie KAŽDÉ volanie (§6, D58). */
export function baseHeaders(requestId: Ulid, version: string = APP_VERSION): Record<string, string> {
  return {
    'User-Agent': `${APP_SLUG}/${version}`,
    Accept: 'application/json',
    'X-Request-Id': requestId,
  };
}

/** Polia korelácie do štruktúrovaného logu (D92). */
export function correlationLogFields(ctx: ShopCtx, requestId?: Ulid): LogFields {
  const fields: LogFields = { operationId: ctx.operationId };
  const id = requestId ?? ctx.requestId;
  if (id !== undefined) fields.requestId = id;
  return fields;
}
