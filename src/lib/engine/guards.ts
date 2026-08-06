/**
 * Aura Zľavy — GUARDY PRED ZÁPISOM (BUILD-SPEC §9, I2, I9, I12, I13, D77, D79).
 *
 * Fail-closed brána, cez ktorú MUSÍ prejsť každá zápisová dávka PRED prvým
 * volaním shopu. Poradie kontrol je normatívne podľa §9:
 *
 *   1. env poistky — `NODE_ENV=production` **a** `WRITES_ENABLED=true` (I13, D77),
 *   2. `settings.writes_locked` (D79 — zamknuté zápisy),
 *   3. runaway strop 60 zápisov/h z `audit_log` (D79, O3) — prekročenie NAVYŠE
 *      zamkne zápisy a zapíše audit `writes_locked`,
 *   4. allowlist — max `MAX_PRODUCTS_PER_OPERATION` (10) produktov a KAŽDÉ ID
 *      v aktívnom allowliste (I2),
 *   5. percento 1–30, platné dátumy, `to ≥ from`, okno ≤ 3 mesiace a `to` nie
 *      v minulosti (I9, I7).
 *
 * Kontrola `from ≥ dnes` tu ZÁMERNE nie je — patrí do vytvárania kampane (D30);
 * pri fire scheduler `from` posúva na dnešok (D25) a dávka, ktorá prekročí
 * polnoc, sa nesmie zabiť v polovici.
 *
 * Env hodnoty sa dajú injektovať (`deps.flags`) — to NIE JE testovací bypass
 * v produkčnom kóde (I13): produkčná cesta číta výhradne `src/env.ts`,
 * injektáž len umožňuje testom overiť správanie oboch strán poistky.
 *
 * Vlastník: A9.
 */
import type {
  AllowlistRepo,
  AuditWriter,
  DateOnly,
  GuardResult,
  SettingsRepo,
} from '@/contracts';

import { env } from '@/env';
import { auditWriter as defaultAuditWriter } from '@/lib/audit/write';
import {
  assertNotMidnightFrozen,
  DEFAULT_MIDNIGHT_FREEZE_SECONDS,
  isDateOnly,
  isWithinMaxWindow,
  isSameOrAfter,
  todayInZone,
  LOGIC_TIME_ZONE,
} from '@/lib/domain/dates';
import { DOMAIN_ERROR_CODES, DomainError } from '@/lib/domain/errors';
import { isValidPercent, PERCENT_INVALID_MESSAGE } from '@/lib/domain/percent';
import { auditRepo as defaultAuditRepo } from '@/lib/repo/audit.repo';
import { allowlistRepo as defaultAllowlistRepo } from '@/lib/repo/allowlist.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';

/* ═══════════════════════════════ kódy ════════════════════════════════════ */

export const GUARD_CODES = {
  writesDisabled: 'writes_disabled',
  writesLocked: 'writes_locked',
  runawayLimit: 'runaway_limit',
  noProducts: 'no_products',
  tooManyProducts: 'too_many_products',
  notInAllowlist: 'not_in_allowlist',
  percentInvalid: 'percent_invalid',
  invalidDates: 'invalid_dates',
  rangeTooLong: 'range_too_long',
  toInPast: 'to_in_past',
  midnightFreeze: 'midnight_freeze',
} as const;

export type GuardCode = (typeof GUARD_CODES)[keyof typeof GUARD_CODES];

const refuse = (code: GuardCode, message: string, detail?: unknown): GuardResult => ({
  ok: false,
  code,
  message,
  ...(detail !== undefined ? { detail } : {}),
});

/* ═══════════════════════════ závislosti ══════════════════════════════════ */

/** Env poistky a stropy — produkčný default číta `src/env.ts`. */
export interface GuardFlags {
  nodeEnv: string;
  writesEnabled: boolean;
  maxProductsPerOperation: number;
  runawayLimitPerHour: number;
  /** D59 — polnočné zamrznutie ±s. Voliteľné kvôli existujúcim fixtures; default 60. */
  midnightFreezeSeconds?: number;
}

export function guardFlagsFromEnv(): GuardFlags {
  return {
    nodeEnv: env.NODE_ENV,
    writesEnabled: env.WRITES_ENABLED,
    maxProductsPerOperation: env.MAX_PRODUCTS_PER_OPERATION,
    runawayLimitPerHour: env.RUNAWAY_LIMIT_PER_HOUR,
    midnightFreezeSeconds: env.MIDNIGHT_FREEZE_SECONDS,
  };
}

export interface GuardsDeps {
  settingsRepo?: Pick<SettingsRepo, 'get' | 'lockWrites'>;
  allowlistRepo?: Pick<AllowlistRepo, 'areAllActive'>;
  auditRepo?: { countWritesInLastHour(): Promise<number> };
  audit?: AuditWriter;
  flags?: GuardFlags | (() => GuardFlags);
  now?: () => Date;
  timeZone?: string;
}

export interface WriteBatchParams {
  productIds: readonly number[];
  percent: number;
  from: DateOnly;
  to: DateOnly;
}

interface ResolvedDeps {
  settingsRepo: Pick<SettingsRepo, 'get' | 'lockWrites'>;
  allowlistRepo: Pick<AllowlistRepo, 'areAllActive'>;
  auditRepo: { countWritesInLastHour(): Promise<number> };
  audit: AuditWriter;
  flags: () => GuardFlags;
  now: () => Date;
  timeZone: string;
}

function resolve(deps: GuardsDeps): ResolvedDeps {
  const flags = deps.flags;
  return {
    settingsRepo: deps.settingsRepo ?? defaultSettingsRepo,
    allowlistRepo: deps.allowlistRepo ?? defaultAllowlistRepo,
    auditRepo: deps.auditRepo ?? defaultAuditRepo,
    audit: deps.audit ?? defaultAuditWriter,
    flags: typeof flags === 'function' ? flags : flags !== undefined ? () => flags : guardFlagsFromEnv,
    now: deps.now ?? (() => new Date()),
    timeZone: deps.timeZone ?? LOGIC_TIME_ZONE,
  };
}

/* ═══════════════════ jednotlivé guardy (aj samostatne) ════════════════════ */

/** I13/D77 — dve env poistky. Bez nich je vynútený dry-run. */
export function checkWritesEnabled(flags: GuardFlags): GuardResult {
  if (flags.nodeEnv === 'production' && flags.writesEnabled === true) return { ok: true };
  return refuse(
    GUARD_CODES.writesDisabled,
    'Ostrý zápis je vypnutý — vyžaduje NODE_ENV=production a WRITES_ENABLED=true (I13). Prebehol by len dry-run.',
    { nodeEnv: flags.nodeEnv, writesEnabled: flags.writesEnabled },
  );
}

/** D79 — manuálny zámok zápisov v `settings`. */
export async function checkWritesNotLocked(deps: GuardsDeps = {}): Promise<GuardResult> {
  const d = resolve(deps);
  const settings = await d.settingsRepo.get();
  if (!settings.writesLocked) return { ok: true };
  return refuse(
    GUARD_CODES.writesLocked,
    `Zápisy sú zamknuté${settings.writesLockedReason ? ` (dôvod: ${settings.writesLockedReason})` : ''} — odomknúť ich možno len manuálne heslom (D79).`,
    { reason: settings.writesLockedReason },
  );
}

/**
 * D79/I12 — runaway strop. Pri dosiahnutí stropu zápisy ZAMKNE (fail-closed)
 * a zapíše audit `writes_locked`. Počíta sa z append-only `audit_log` (O3),
 * takže sa počítadlo nedá obísť ani vynulovať.
 */
export async function checkRunawayAndMaybeLock(deps: GuardsDeps = {}): Promise<GuardResult> {
  const d = resolve(deps);
  const limit = d.flags().runawayLimitPerHour;
  const count = await d.auditRepo.countWritesInLastHour();
  if (count < limit) return { ok: true };

  const reason = `runaway: ${count} zápisov za poslednú hodinu (strop ${limit}/h, D79)`;
  await d.settingsRepo.lockWrites(reason);
  await d.audit.appendAudit({
    actor: 'system',
    eventType: 'writes_locked',
    ok: false,
    message: reason,
  });
  return refuse(
    GUARD_CODES.runawayLimit,
    `Prekročený strop ${limit} zápisov za hodinu — zápisy sú zamknuté do manuálneho odomknutia (D79, I12).`,
    { count, limit },
  );
}

/** I2 — max 10 produktov a všetky v AKTÍVNOM allowliste, inak fail-closed. */
export async function checkAllowlist(
  productIds: readonly number[],
  deps: GuardsDeps = {},
): Promise<GuardResult> {
  const d = resolve(deps);
  const max = d.flags().maxProductsPerOperation;

  const unique = [...new Set(productIds)];
  if (unique.length === 0 || unique.length !== productIds.length) {
    return refuse(GUARD_CODES.noProducts, 'Dávka musí obsahovať 1–10 unikátnych produktov (I2).');
  }
  if (unique.some((id) => !Number.isInteger(id) || id <= 0)) {
    return refuse(GUARD_CODES.notInAllowlist, 'Dávka obsahuje neplatné ID produktu (I2).');
  }
  if (unique.length > max) {
    return refuse(
      GUARD_CODES.tooManyProducts,
      `Jedna operácia smie zapísať najviac ${max} produktov (I2).`,
      { count: unique.length, max },
    );
  }

  let allActive = false;
  try {
    allActive = await d.allowlistRepo.areAllActive(unique);
  } catch {
    allActive = false; // pri pochybnosti sa NESMIE zapísať (I2)
  }
  if (!allActive) {
    return refuse(
      GUARD_CODES.notInAllowlist,
      'Aspoň jeden produkt nie je v aktívnom allowliste — zápis sa odmieta pred volaním shopu (I2).',
      { productIds: unique },
    );
  }
  return { ok: true };
}

/** I9 + I7 — lokálna validácia parametrov zápisu, nikdy „nech rozhodne shop". */
export function checkWriteWindow(
  params: Pick<WriteBatchParams, 'percent' | 'from' | 'to'>,
  deps: GuardsDeps = {},
): GuardResult {
  const d = resolve(deps);

  if (!isValidPercent(params.percent)) {
    return refuse(GUARD_CODES.percentInvalid, PERCENT_INVALID_MESSAGE, { percent: params.percent });
  }
  if (!isDateOnly(params.from) || !isDateOnly(params.to)) {
    return refuse(GUARD_CODES.invalidDates, 'Dátumy okna nie sú platné kalendárne dni YYYY-MM-DD (I9).');
  }
  if (params.to < params.from) {
    return refuse(GUARD_CODES.invalidDates, 'Koniec zľavy je pred jej začiatkom (I9).', params);
  }
  if (!isWithinMaxWindow(params.from, params.to)) {
    return refuse(
      GUARD_CODES.rangeTooLong,
      'Okno zľavy je dlhšie než 3 kalendárne mesiace (D29, I9).',
      params,
    );
  }
  // I7 — `to` v minulosti je tvar zakázaného „zrušenia zľavy".
  const today = todayInZone(d.now(), d.timeZone);
  if (!isSameOrAfter(params.to, today)) {
    return refuse(
      GUARD_CODES.toInPast,
      'Koniec zľavy je v minulosti — taký zápis je zakázaný (I7).',
      { to: params.to, today },
    );
  }
  return { ok: true };
}

/* ═══════════════════════ kompletná brána (§9) ═════════════════════════════ */

/**
 * Všetky guardy v normatívnom poradí §9. Prvé porušenie vracia fail-closed
 * `GuardResult` — volajúci NESMIE poslať na shop nič.
 */
export async function runPreWriteGuards(
  params: WriteBatchParams,
  deps: GuardsDeps = {},
): Promise<GuardResult> {
  const d = resolve(deps);

  const envCheck = checkWritesEnabled(d.flags());
  if (!envCheck.ok) return envCheck;

  const lockCheck = await checkWritesNotLocked(deps);
  if (!lockCheck.ok) return lockCheck;

  const runawayCheck = await checkRunawayAndMaybeLock(deps);
  if (!runawayCheck.ok) return runawayCheck;

  const allowlistCheck = await checkAllowlist(params.productIds, deps);
  if (!allowlistCheck.ok) return allowlistCheck;

  // D59 — polnočné zamrznutie ±freeze s: na hrane dňa sa dátumy neprepočítavajú
  // a zápis sa odmieta fail-closed. MUSÍ bežať PRED `checkWriteWindow`, ktorý
  // počíta „dnes" — presne ten prepočet je na hrane dňa zakázaný. Scheduler má
  // rovnakú kontrolu v `due.ts`; tu chráni manuálne zápisy (eager/execute/retry).
  const freezeSeconds = d.flags().midnightFreezeSeconds ?? DEFAULT_MIDNIGHT_FREEZE_SECONDS;
  try {
    assertNotMidnightFrozen(d.now(), freezeSeconds, d.timeZone);
  } catch (err) {
    if (err instanceof DomainError && err.code === DOMAIN_ERROR_CODES.midnightFreeze) {
      return refuse(GUARD_CODES.midnightFreeze, err.message, { freezeSeconds });
    }
    throw err;
  }

  return checkWriteWindow(params, deps);
}
