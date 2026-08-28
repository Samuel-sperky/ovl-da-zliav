/**
 * Aura Zľavy — FACTORIES pre testovacie dáta (BUILD-SPEC §12).
 *
 * Čisté buildery doménových záznamov podľa `src/contracts.ts`. Každý builder má
 * rozumné defaulty a prijíma `Partial<…>` override, aby test v tele hovoril len
 * o tom, na čom mu skutočne záleží.
 *
 * Čo tu ZÁMERNE nie je:
 *   - žiadny zápis do DB. Vkladanie riadkov patrí repozitárom (A8) — druhá cesta
 *     k schéme by testy odviedla od produkčného kódu. Buildery vracajú presne
 *     tie tvary, ktoré repozitáre prijímajú (`CreateCampaignInput`) alebo
 *     vracajú (`CampaignRecord`, `AllowlistRecord`, …).
 *   - žiadne tajomstvo, ktoré vyzerá ako reálny kľúč (I1). Kľúče majú tvar
 *     `fake-shop-key-…`.
 *
 * Vlastník: A6.
 */
import { createHash, randomBytes } from 'node:crypto';

import type {
  AllowlistRecord,
  AllowlistShopStatus,
  CampaignItemRecord,
  CampaignKind,
  CampaignMode,
  CampaignRecord,
  CampaignStatus,
  CatalogCacheRecord,
  CreateCampaignInput,
  DateOnly,
  DiscountPercent,
  ItemStatus,
  MoneyString,
  SchedulerStateRecord,
  SecretHandle,
  SecretRef,
  SettingsRecord,
  Sha256Hex,
  Ulid,
  UserRecord,
  UtcDate,
} from '@/contracts';

/* ═══════════════════════════ 1. Deterministické ID a čas ═══════════════════ */

let ulidCounter = 0;

/**
 * Deterministický pseudo-ULID (26 znakov Crockford base32). Nie je monotónny
 * v čase, ale je lexikograficky rastúci v rámci testu, čo je pre asserty
 * poradia (I10) presne to, čo treba.
 */
export function testUlid(seed = ++ulidCounter): Ulid {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const prefix = '01J';
  let rest = '';
  let value = seed;
  for (let i = 0; i < 23; i += 1) {
    rest = alphabet[value % 32] + rest;
    value = Math.floor(value / 32);
  }
  return `${prefix}${rest}`;
}

/** Fixný „teraz" pre testy — 2026-08-05 08:00 UTC (10:00 bratislavského času). */
export const TEST_NOW = new Date('2026-08-05T08:00:00.000Z');

/** `YYYY-MM-DD` z `Date` v UTC. */
export function dateOnly(date: Date): DateOnly {
  return date.toISOString().slice(0, 10);
}

/** Dnešný deň testov (`TEST_NOW`) posunutý o `days`. */
export function testDay(days = 0, base: Date = TEST_NOW): DateOnly {
  const shifted = new Date(base.getTime() + days * 86_400_000);
  return dateOnly(shifted);
}

/** `TEST_NOW` posunuté o minúty — pre `fire_at`, `claimed_at`, TTL, sudo okná. */
export function testTime(minutes = 0, base: Date = TEST_NOW): UtcDate {
  return new Date(base.getTime() + minutes * 60_000);
}

/** SHA-256 hex — `confirm_payload_hash` a `payloadHash` preview tokenu (I3, O2). */
export function sha256Hex(input: string | object): Sha256Hex {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Peniaze ako string z DB drivera (`DECIMAL(10,2)`) — nikdy float. */
export function money(value: number): MoneyString {
  return value.toFixed(2);
}

/* ═══════════════════════════ 2. Tajomstvá (I1) ═════════════════════════════ */

/** Falošný kľúč shopu. NIE je to tvar reálneho poskytovateľa (I1). */
export function fakeApiKey(suffix = '0001'): string {
  return `fake-shop-key-${suffix}`;
}

/**
 * `SecretRef` nad plaintextom v pamäti — pre testy klienta a engine bez DB.
 * `release()` buffer prepíše nulami presne ako produkčný `secret-box` (D64).
 */
export function fakeSecretRef(plaintext: string = fakeApiKey()): SecretRef {
  return async (): Promise<SecretHandle> => {
    const buffer = Buffer.from(plaintext, 'utf8');
    return {
      value: buffer,
      release() {
        buffer.fill(0);
      },
    };
  };
}

/** Náhodný 32 B master key — len do `tmp` súborov v testoch, nikdy do repa. */
export function fakeMasterKey(): Buffer {
  return randomBytes(32);
}

/* ═══════════════════════════ 3. Allowlist (I2) ═════════════════════════════ */

export function makeAllowlistRecord(overrides: Partial<AllowlistRecord> = {}): AllowlistRecord {
  const productId = overrides.productId ?? 201;
  return {
    id: overrides.id ?? productId,
    productId,
    slot: overrides.slot ?? 1,
    label: overrides.label ?? `Šperk ${productId}`,
    shopStatus: overrides.shopStatus ?? ('ok' satisfies AllowlistShopStatus),
    statusNote: overrides.statusNote ?? null,
    addedAt: overrides.addedAt ?? testTime(-60),
    removedAt: overrides.removedAt ?? null,
  };
}

/**
 * `count` aktívnych záznamov v slotoch 1…count. `count > 10` je zámerne
 * povolené len preto, aby test vedel vyrobiť NEplatný vstup a overiť, že ho
 * appka odmietne (I2) — DB taký stav nikdy nepripustí.
 */
export function makeAllowlist(count = 10, startProductId = 201): AllowlistRecord[] {
  return Array.from({ length: count }, (_, i) =>
    makeAllowlistRecord({
      id: i + 1,
      productId: startProductId + i,
      slot: i + 1,
    }),
  );
}

/** Odobraný záznam: `slot = null`, `removed_at` vyplnené (I2). */
export function makeRemovedAllowlistRecord(
  overrides: Partial<AllowlistRecord> = {},
): AllowlistRecord {
  return makeAllowlistRecord({ slot: null, removedAt: testTime(-30), ...overrides });
}

/* ═══════════════════════════ 4. Kampane (I3, §4) ═══════════════════════════ */

export interface CampaignFactoryOptions extends Partial<CampaignRecord> {
  /** Produkty kampane — určujú `items_total` aj `makeCampaignItems()`. */
  productIds?: number[];
}

/** Kanonická sada parametrov, z ktorej sa počíta `confirm_payload_hash` (I3). */
export function confirmPayload(input: {
  productIds: number[];
  percent: DiscountPercent;
  dateFrom: DateOnly;
  dateTo: DateOnly;
}): string {
  return JSON.stringify({
    productIds: [...input.productIds].sort((a, b) => a - b),
    percent: input.percent,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
  });
}

/**
 * Kampaň v stave `draft` (bez potvrdenia). Pre stavy, ktoré už zapisujú, použi
 * `makeConfirmedCampaign()` — bez `confirmed_at` + `confirm_payload_hash` je
 * prechod do `running` zakázaný (I3).
 */
export function makeCampaign(options: CampaignFactoryOptions = {}): CampaignRecord {
  const productIds = options.productIds ?? [201, 202, 203];
  const percent = options.percent ?? 15;
  const dateFrom = options.dateFrom ?? testDay(1);
  const dateTo = options.dateTo ?? testDay(10);
  const status: CampaignStatus = options.status ?? 'draft';

  return {
    id: options.id ?? 1,
    operationId: options.operationId ?? testUlid(),
    name: options.name ?? 'Letná akcia',
    kind: options.kind ?? ('new' satisfies CampaignKind),
    parentCampaignId: options.parentCampaignId ?? null,
    percent,
    dateFrom,
    dateTo,
    dateFromOriginal: options.dateFromOriginal ?? null,
    mode: options.mode ?? ('eager' satisfies CampaignMode),
    status,
    statusReason: options.statusReason ?? null,
    fireAt: options.fireAt ?? null,
    scheduledAt: options.scheduledAt ?? null,
    needsKeySince: options.needsKeySince ?? null,
    claimedAt: options.claimedAt ?? null,
    startedAt: options.startedAt ?? null,
    finishedAt: options.finishedAt ?? null,
    itemsTotal: options.itemsTotal ?? productIds.length,
    itemsOk: options.itemsOk ?? 0,
    itemsFailed: options.itemsFailed ?? 0,
    itemsUncertain: options.itemsUncertain ?? 0,
    confirmedAt: options.confirmedAt ?? null,
    confirmPayloadHash: options.confirmPayloadHash ?? null,
    sudoAt: options.sudoAt ?? null,
    resultAckAt: options.resultAckAt ?? null,
    createdBy: options.createdBy ?? 1,
    createdAt: options.createdAt ?? testTime(-10),
    updatedAt: options.updatedAt ?? testTime(-10),
  };
}

/**
 * Kampaň, ktorá SMIE zapisovať: má `confirmed_at` a `confirm_payload_hash` nad
 * vlastnou sadou parametrov (I3).
 *
 * `sudo_at` je ZÁMERNE `null` — presne to od 27. 8. 2026 zapisuje produkčná
 * cesta (`_shared.ts`), odkedy D100 zrušilo sudo. Keby tu factory dosadila
 * čas, testy by bežali na kampani, aká v DB nikdy nevznikne, a zakryli by
 * chybu typu „niekto vrátil kontrolu `sudo_at` do `assertConfirmed()`" —
 * appka by prestala zapisovať a testy by o tom mlčali. Práve to sa 27. 8.
 * stalo a zachytil to `no-write-without-confirm.spec.ts`.
 */
export function makeConfirmedCampaign(options: CampaignFactoryOptions = {}): CampaignRecord {
  const base = makeCampaign(options);
  const productIds = options.productIds ?? [201, 202, 203];
  return {
    ...base,
    status: options.status ?? 'scheduled',
    confirmedAt: options.confirmedAt ?? testTime(-2),
    confirmPayloadHash:
      options.confirmPayloadHash ??
      sha256Hex(
        confirmPayload({
          productIds,
          percent: base.percent,
          dateFrom: base.dateFrom,
          dateTo: base.dateTo,
        }),
      ),
    sudoAt: options.sudoAt ?? null,
    scheduledAt: options.scheduledAt ?? testTime(-2),
  };
}

/** Vstup pre `CampaignsRepo.create()` — presne tvar z kontraktov. */
export function makeCreateCampaignInput(
  overrides: Partial<CreateCampaignInput> & { productIds?: number[] } = {},
): CreateCampaignInput {
  const productIds = overrides.productIds ?? [201, 202, 203];
  const percent = overrides.percent ?? 15;
  const dateFrom = overrides.dateFrom ?? testDay(1);
  const dateTo = overrides.dateTo ?? testDay(10);
  return {
    operationId: overrides.operationId ?? testUlid(),
    name: overrides.name ?? 'Letná akcia',
    kind: overrides.kind ?? 'new',
    parentCampaignId: overrides.parentCampaignId ?? null,
    percent,
    dateFrom,
    dateTo,
    mode: overrides.mode ?? 'eager',
    status: overrides.status ?? 'scheduled',
    fireAt: overrides.fireAt ?? null,
    scheduledAt: overrides.scheduledAt ?? testTime(0),
    confirmedAt: overrides.confirmedAt ?? testTime(-1),
    confirmPayloadHash:
      overrides.confirmPayloadHash ??
      sha256Hex(confirmPayload({ productIds, percent, dateFrom, dateTo })),
    sudoAt: overrides.sudoAt ?? testTime(-1),
    createdBy: overrides.createdBy ?? 1,
  };
}

/* ═══════════════════════════ 5. Položky kampane (I10) ══════════════════════ */

export function makeCampaignItem(overrides: Partial<CampaignItemRecord> = {}): CampaignItemRecord {
  const productId = overrides.productId ?? 201;
  return {
    id: overrides.id ?? productId,
    campaignId: overrides.campaignId ?? 1,
    productId,
    position: overrides.position ?? 1,
    status: overrides.status ?? ('pending' satisfies ItemStatus),
    attemptCount: overrides.attemptCount ?? 0,
    nameAtWrite: overrides.nameAtWrite ?? `Šperk ${productId}`,
    priceAtPreview: overrides.priceAtPreview ?? money(19.99),
    priceAtWrite: overrides.priceAtWrite ?? null,
    priceMismatch: overrides.priceMismatch ?? false,
    hasAttributes: overrides.hasAttributes ?? false,
    // Kým nebude backlog B1, je stav zľavy v shope neoveriteľný (D48, I11).
    reductionUnverifiable: overrides.reductionUnverifiable ?? true,
    requestId: overrides.requestId ?? null,
    httpStatus: overrides.httpStatus ?? null,
    errorCode: overrides.errorCode ?? null,
    errorMessage: overrides.errorMessage ?? null,
    sentPayload: overrides.sentPayload ?? null,
    rawResponse: overrides.rawResponse ?? null,
    startedAt: overrides.startedAt ?? null,
    finishedAt: overrides.finishedAt ?? null,
  };
}

/**
 * Položky v deterministickom poradí (`position` 1…n podľa vzostupného
 * `product_id`) — presne to poradie, v akom sa smie zapisovať (I10).
 */
export function makeCampaignItems(
  productIds: number[] = [201, 202, 203],
  overrides: Partial<CampaignItemRecord> = {},
): CampaignItemRecord[] {
  return [...productIds]
    .sort((a, b) => a - b)
    .map((productId, index) =>
      makeCampaignItem({
        id: index + 1,
        productId,
        position: index + 1,
        ...overrides,
      }),
    );
}

/* ═══════════════════════════ 6. Ostatné záznamy ════════════════════════════ */

export function makeSettings(overrides: Partial<SettingsRecord> = {}): SettingsRecord {
  return {
    id: 1,
    // Doména mocku sa do settings NEUKLADÁ z repa — testy ju dostanú z helpera
    // `startMockShopWithOverride()`. Default je `null` = neonboardované.
    shopDomain: overrides.shopDomain ?? null,
    shopDomainConfirmedAt: overrides.shopDomainConfirmedAt ?? null,
    eagerWriteDefault: overrides.eagerWriteDefault ?? true,
    writesLocked: overrides.writesLocked ?? false,
    writesLockedReason: overrides.writesLockedReason ?? null,
    writesLockedAt: overrides.writesLockedAt ?? null,
    onboardingDoneAt: overrides.onboardingDoneAt ?? null,
    updatedAt: overrides.updatedAt ?? testTime(-120),
  };
}

export function makeSchedulerState(
  overrides: Partial<SchedulerStateRecord> = {},
): SchedulerStateRecord {
  return {
    id: 1,
    lastTickAt: overrides.lastTickAt ?? testTime(-1),
    lastTickDurationMs: overrides.lastTickDurationMs ?? 12,
    tickCount: overrides.tickCount ?? 1,
    lastError: overrides.lastError ?? null,
    updatedAt: overrides.updatedAt ?? testTime(-1),
  };
}

export function makeCatalogCache(overrides: Partial<CatalogCacheRecord> = {}): CatalogCacheRecord {
  const productId = overrides.productId ?? 201;
  return {
    productId,
    name: overrides.name ?? `Šperk ${productId}`,
    price: overrides.price ?? money(19.99),
    hasAttributes: overrides.hasAttributes ?? false,
    source: overrides.source ?? 'get',
    fetchedAt: overrides.fetchedAt ?? testTime(-5),
    raw: overrides.raw ?? { id: productId, name: `Šperk ${productId}`, price: 19.99 },
  };
}

export function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: overrides.id ?? 1,
    username: overrides.username ?? 'samuel',
    // Nie je to reálny hash — testy, ktoré overujú prihlásenie, si ho vyrobia
    // cez `src/lib/auth/password.ts` (A4).
    passwordHash: overrides.passwordHash ?? '$argon2id$fake$test-only',
    createdAt: overrides.createdAt ?? testTime(-1440),
    updatedAt: overrides.updatedAt ?? testTime(-1440),
    lastLoginAt: overrides.lastLoginAt ?? null,
  };
}
