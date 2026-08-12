/**
 * Aura Zľavy — GUARDY PRED ZÁPISOM (BUILD-SPEC §9, I2, I7, I9, I12, I13, D77,
 * D79; KONTRAKT V3: K1, K2).
 *
 * Fail-closed brána, cez ktorú MUSÍ prejsť každá zápisová dávka PRED prvým
 * volaním shopu. Poradie kontrol je normatívne podľa §9:
 *
 *   1. env poistky — `NODE_ENV=production` **a** `WRITES_ENABLED=true` (I13, D77),
 *   2. `settings.writes_locked` (D79 — zamknuté zápisy),
 *   3. runaway strop z `audit_log` (D79, O3) — prekročenie NAVYŠE zamkne zápisy
 *      a zapíše audit `writes_locked`,
 *   4. **rozsah** (`checkScope`, K1) — v režime `pilot` allowlist a strop 10,
 *      v režime `plny` prítomnosť v katalógu a strop `max_products_per_campaign`,
 *   5. percento 1–30, platné dátumy, `to ≥ from`, okno ≤ 3 mesiace a `to` nie
 *      v minulosti (I9, I7).
 *
 * Čo sa mení s KONTRAKTOM V3:
 *  - **K1** — `checkAllowlist` sa volá `checkScope`. I2 nezaniká, mení sa:
 *    „appka nikdy nezapíše do produktu, ktorý nie je v povolenom rozsahu
 *    platného režimu, a rozsah sa nedá rozšíriť bez sudo". Fail-closed pri
 *    výnimke repozitára ZOSTÁVA — pri pochybnosti sa nezapisuje.
 *  - **K2** — runaway strop je `daily_write_budget` + 20 %, nie fixných 60/h.
 *    Pri 200 zápisoch na deň by 60/h zamklo zápisy počas normálnej prevádzky.
 *    Podlaha 60/h zostáva (`MIN_RUNAWAY_LIMIT_PER_HOUR`), aby rozpočet
 *    nastavený nadol nezamkol zápisy pri prvom manuálnom retry.
 *  - **K2** — nový kód `budget_exhausted` (`checkDailyBudget`). ZÁMERNE NIE JE
 *    súčasťou `runPreWriteGuards()`: vyčerpaný rozpočet nie je odmietnutie
 *    zápisu, je to informácia, že sa pokračuje zajtra (odpoveď 59). Kampaň
 *    kvôli nemu ide do `queued`, nie do `failed` — a to rozhoduje executor,
 *    nie táto brána.
 *
 * Kontrola `from ≥ dnes` tu ZÁMERNE nie je — patrí do vytvárania kampane (D30);
 * pri fire scheduler `from` posúva na dnešok (D25) a dávka, ktorá prekročí
 * polnoc, sa nesmie zabiť v polovici.
 *
 * Env hodnoty sa dajú injektovať (`deps.flags`) — to NIE JE testovací bypass
 * v produkčnom kóde (I13): produkčná cesta číta výhradne `src/env.ts`,
 * injektáž len umožňuje testom overiť správanie oboch strán poistky.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Brána rozhoduje, `blockers.ts` pomenúva.** Odmietnutia pre strop
 *     rozsahu a pre env poistku nesú v `detail.blockers` vety z
 *     `lib/status/blockers.ts`. Vety sa sem NEKOPÍRUJÚ a rozhodnutie sa
 *     NEPRESÚVA tam — druhá kópia ktorejkoľvek strany znamená, že sa raz
 *     rozídu a obrazovka bude tvrdiť niečo iné, než čo brána urobí.
 *  2. **Do `detail` idú len prekážky tej oblasti, ktorú brána naozaj overila.**
 *     `collectOperationBlockers()` chýbajúce sekcie dopĺňa fail-closed, takže
 *     nezúžený zoznam by tvrdil aj o kľúči a rozpočte, ktoré tu nikto nečítal.
 *  3. **Zúženie výberu nie je jediná odpoveď.** Strop je prepínač (K1) — detail
 *     preto vždy nesie aj to, že sa dá zdvihnúť, a že to chce heslo.
 *
 * Vlastník: A9 / V5.
 */
import type {
  AllowlistRepo,
  AuditWriter,
  DateOnly,
  GuardResult,
  Queryable,
  SettingsRepo,
} from '@/contracts';

import { env } from '@/env';
import { auditWriter as defaultAuditWriter } from '@/lib/audit/write';
import {
  createBudget,
  resolveDailyBudget,
  runawayLimitFor,
  type BudgetStatus,
  type DailyBudgetSource,
  type WriteAttemptCounter,
} from '@/lib/engine/budget';
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
import { catalogRepo as defaultCatalogRepo } from '@/lib/repo/catalog.repo';
import {
  HARD_MAX_PRODUCTS,
  PILOT_MAX_PRODUCTS,
  settingsRepo as defaultSettingsRepo,
  type ScopeMode,
} from '@/lib/repo/settings.repo';
import { collectOperationBlockers, type Blocker } from '@/lib/status/blockers';

/* ═══════════════════════════════ kódy ════════════════════════════════════ */

export const GUARD_CODES = {
  writesDisabled: 'writes_disabled',
  writesLocked: 'writes_locked',
  runawayLimit: 'runaway_limit',
  /** K2 — denný rozpočet je vyčerpaný. Informácia, nie chyba (odpoveď 59). */
  budgetExhausted: 'budget_exhausted',
  noProducts: 'no_products',
  tooManyProducts: 'too_many_products',
  /** Režim `pilot` (K1) — produkt nie je v aktívnom allowliste. */
  notInAllowlist: 'not_in_allowlist',
  /** Režim `plny` (K1 bod 2) — produkt appka v katalógu nevidí. */
  notInCatalog: 'not_in_catalog',
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
  /** Strop jednej operácie v režime `pilot` (I2, tvrdý strop 10 v `env.ts`). */
  maxProductsPerOperation: number;
  /**
   * Podlaha runaway stropu (D79). Skutočný strop je
   * `max(this, daily_write_budget + 20 %)` — K2.
   */
  runawayLimitPerHour: number;
  /** D59 — polnočné zamrznutie ±s. Voliteľné kvôli existujúcim fixtures; default 60. */
  midnightFreezeSeconds?: number;
  /**
   * K2 — tvrdý override denného rozpočtu. Produkčne sa NEPOUŽÍVA (rozpočet
   * žije v `settings.daily_write_budget`); slúži testom a volajúcim, ktorí už
   * hodnotu z nastavení načítali a nechcú druhý SELECT.
   */
  dailyWriteBudget?: number;
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

/**
 * Nastavenia, ktoré guardy potrebujú. `readScope()` je voliteľné — má ho
 * `settings.repo` po V3 (K1 bod 1), staršie fakes nie. Bez neho sa režim číta
 * z `get()` a čokoľvek neznáme je `pilot`.
 */
export type ScopeSettingsSource = Pick<SettingsRepo, 'get' | 'lockWrites'> & DailyBudgetSource;

/**
 * Katalóg pre režim `plny` (K1 bod 2). Tvar je ZÁMERNE minimálny a `readonly`,
 * aby guardy nezáviseli na plnom `CatalogRepoExt`.
 */
export interface CatalogScopeSource {
  getMany(
    productIds: number[],
    conn?: Queryable,
  ): Promise<ReadonlyMap<number, { shopStatus?: string | null }>>;
}

export interface GuardsDeps {
  settingsRepo?: ScopeSettingsSource;
  allowlistRepo?: Pick<AllowlistRepo, 'areAllActive'>;
  /** K1 bod 2 — zdroj pravdy o rozsahu v režime `plny`. */
  catalogRepo?: CatalogScopeSource;
  auditRepo?: { countWritesInLastHour(): Promise<number> };
  /** K2 — počítadlo `write_attempt` za UTC deň; default `SELECT` nad auditom. */
  writeAttemptCounter?: WriteAttemptCounter;
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
  settingsRepo: ScopeSettingsSource;
  allowlistRepo: Pick<AllowlistRepo, 'areAllActive'>;
  catalogRepo: CatalogScopeSource | null;
  auditRepo: { countWritesInLastHour(): Promise<number> };
  writeAttemptCounter: WriteAttemptCounter | undefined;
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
    catalogRepo: deps.catalogRepo ?? defaultCatalogRepo,
    auditRepo: deps.auditRepo ?? defaultAuditRepo,
    writeAttemptCounter: deps.writeAttemptCounter,
    audit: deps.audit ?? defaultAuditWriter,
    flags: typeof flags === 'function' ? flags : flags !== undefined ? () => flags : guardFlagsFromEnv,
    now: deps.now ?? (() => new Date()),
    timeZone: deps.timeZone ?? LOGIC_TIME_ZONE,
  };
}

/* ═════════════════════════ režim rozsahu (K1) ═════════════════════════════ */

/** Rozsah, v ktorom sa dávka smie pohybovať. */
export interface ResolvedScope {
  mode: ScopeMode;
  /** Efektívny strop na jednu operáciu (pilot 10, plny `max_products_per_campaign`). */
  maxProducts: number;
  /** `true` = hodnoty nepochádzajú z DB, ale z fail-closed defaultu (K1 bod 1). */
  failClosed: boolean;
}

const isScopeMode = (value: unknown): value is ScopeMode => value === 'pilot' || value === 'plny';

const fieldOf = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/**
 * Strop na čítanie režimu z DB. Bez neho „neviem" nefunguje: zaseknutá DB
 * nevyhodí výnimku, len nikdy neodpovie, a `await` by čakal donekonečna.
 */
const SCOPE_READ_TIMEOUT_MS = 2_000;

/**
 * K1 bod 1 — FAIL-CLOSED čítanie režimu. Chýbajúca, nečitateľná, ZASEKNUTÁ aj
 * neznáma hodnota znamená `pilot`. Nikdy výnimka, nikdy `plny`.
 *
 * Časový strop tu nie je kozmetika. Bez neho stačilo, aby DB neodpovedala, a
 * `buildPreview()` visel — teda nie fail-closed, ale fail-nikdy. Zaseknutie sa
 * musí správať rovnako ako chyba: „neviem" → `pilot`.
 */
async function resolveScope(d: ResolvedDeps): Promise<ResolvedScope> {
  const pilot = (): ResolvedScope => ({
    mode: 'pilot',
    maxProducts: Math.max(1, Math.min(PILOT_MAX_PRODUCTS, d.flags().maxProductsPerOperation)),
    failClosed: true,
  });

  const repo = d.settingsRepo;
  const read = typeof repo.readScope === 'function' ? repo.readScope.bind(repo) : repo.get.bind(repo);

  const TIMED_OUT = Symbol('scope_read_timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;

  let raw: unknown;
  try {
    raw = await Promise.race([
      read(),
      new Promise<typeof TIMED_OUT>((resolveRace) => {
        timer = setTimeout(() => resolveRace(TIMED_OUT), SCOPE_READ_TIMEOUT_MS);
        // Časovač nesmie držať proces nažive — scheduler aj testy sa inak
        // nedočkajú ukončenia.
        timer.unref?.();
      }),
    ]);
  } catch {
    return pilot(); // nečitateľná DB je „neviem" a „neviem" je `pilot`
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  if (raw === TIMED_OUT) return pilot(); // zaseknutá DB je tiež „neviem"

  const mode = fieldOf(raw, 'mode') ?? fieldOf(raw, 'scopeMode');
  /**
   * `settings.repo.readScope()` sám priznáva, že odpovedal fail-closed
   * defaultom (`ScopeSettings.failClosed`). Bez tohto riadku sa priznanie
   * stratilo: repozitár povedal „neviem, beriem `pilot`", guardy z toho urobili
   * `pilot` a `failClosed: false`, teda „viem, že je pilot". Rozhodnutie by bolo
   * rovnaké, ale appka by o ňom klamala — a `blockers.ts` stavia práve na tomto
   * príznaku (`assumed`), keď má priznať, že veta stojí na domnienke.
   */
  const declaredFailClosed = fieldOf(raw, 'failClosed') === true;
  if (!isScopeMode(mode) || mode === 'pilot') {
    return { ...pilot(), failClosed: !isScopeMode(mode) || declaredFailClosed };
  }

  const rawMax = fieldOf(raw, 'maxProductsPerCampaign');
  const parsed = typeof rawMax === 'number' ? rawMax : Number(rawMax);
  const maxProducts =
    Number.isFinite(parsed) && Math.trunc(parsed) >= 1
      ? Math.min(HARD_MAX_PRODUCTS, Math.trunc(parsed))
      : PILOT_MAX_PRODUCTS;

  return { mode: 'plny', maxProducts, failClosed: declaredFailClosed };
}

/** Verejná (nehádžuca) podoba pre volajúcich, ktorí chcú rozsah zobraziť. */
export async function readScopeForWrite(deps: GuardsDeps = {}): Promise<ResolvedScope> {
  return resolveScope(resolve(deps));
}

/* ═════════ strojovo spracovateľný dôvod odmietnutia (blockers.ts) ═════════ */

/**
 * Prečo brána odmietla, v tvare, z ktorého sa dá postaviť PONUKA — nie holý
 * text.
 *
 * Doteraz odmietnutie pre strop rozsahu nieslo vetu „Jedna operácia smie
 * v režime „pilot" zapísať najviac 10 produktov" a nič viac. Obrazovka z toho
 * vedela postaviť len oznam. Aby vedela ponúknuť „prepnúť do plného rozsahu",
 * musí dostať fakty: KTORÝ režim platí, AKÝ je efektívny a tvrdý strop a či
 * prepnutie chce heslo. Vety k tomu NEPÍŠEME znova — berú sa z jediného zdroja
 * pravdy `lib/status/blockers.ts`, ktorý ich už raz zložil pre celú appku.
 *
 * `blockers` je preto zúžený výsledok `collectOperationBlockers()`. Zúženie na
 * jednu OBLASŤ je zámerné: brána vie povedať pravdu o rozsahu a o env poistke,
 * ale o kľúči, rozpočte ani katalógu tu nič nečítala — a `blockers.ts` by pri
 * chýbajúcich sekciách fail-closed dopísal prekážky, ktoré by tvrdili viac,
 * než čo brána naozaj overila.
 */
export interface ScopeRefusalDetail {
  /** Koľko unikátnych produktov operácia chcela zapísať. */
  count: number;
  /** Efektívny strop, o ktorý sa operácia zastavila. */
  max: number;
  mode: ScopeMode;
  /** `true` = režim sa nepodarilo prečítať a platí fail-closed `pilot`. */
  failClosed: boolean;
  /** Strop pilotného režimu (10) — pevný bod, o ktorý sa dá porovnávať. */
  pilotMaxProducts: number;
  /** Tvrdý strop DB (10 000) — vyššie sa nedá ísť ani v plnom režime. */
  hardMaxProducts: number;
  /** `true` = zdvihnúť strop sa dá len s heslom (K1 bod 4). Nikdy nie `false`. */
  requiresSudoToRelease: boolean;
  /** Prekážky oblasti `rozsah` presne tak, ako ich pomenúva `blockers.ts`. */
  blockers: readonly Blocker[];
}

/**
 * Prekážky JEDNEJ oblasti nad snapshotom, ktorý volajúci naozaj prečítal.
 * Ostatné oblasti sa zahadzujú — viď komentár pri `ScopeRefusalDetail`.
 */
function blockersOfArea(
  snapshot: Parameters<typeof collectOperationBlockers>[0],
  area: Blocker['area'],
): readonly Blocker[] {
  return collectOperationBlockers(snapshot).filter((blocker) => blocker.area === area);
}

/** Prekážky rozsahu pre daný výber. `null` = koľko ich je, volajúci nevie. */
export function scopeBlockers(
  scope: ResolvedScope,
  selectedCount: number | null,
): readonly Blocker[] {
  return blockersOfArea(
    {
      scope: { mode: scope.mode, maxProducts: scope.maxProducts, failClosed: scope.failClosed },
      ...(selectedCount === null ? {} : { selection: { selectedCount } }),
    },
    'rozsah',
  );
}

/** Prekážky env poistky zápisu (I13) — prázdne pole, keď sú zápisy povolené. */
export function writesBlockers(enabled: boolean): readonly Blocker[] {
  return blockersOfArea({ writes: { enabled } }, 'zapisy');
}

/** Celý obraz rozsahu k jednému odmietnutiu. */
function scopeRefusalDetail(scope: ResolvedScope, count: number): ScopeRefusalDetail {
  return {
    count,
    max: scope.maxProducts,
    mode: scope.mode,
    failClosed: scope.failClosed,
    pilotMaxProducts: PILOT_MAX_PRODUCTS,
    hardMaxProducts: HARD_MAX_PRODUCTS,
    // Obe cesty k vyššiemu stropu si pýtajú heslo (K1 bod 4,
    // `scopeChangeRequiresSudo()`): z `pilot` prepnutie do `plny`, v `plny`
    // zdvihnutie `max_products_per_campaign`. Konštanta je preto pravda, nie
    // zjednodušenie — a `false` by tu bol sľub, ktorý route nedodrží.
    requiresSudoToRelease: true,
    blockers: scopeBlockers(scope, count),
  };
}

/* ═══════════════════ jednotlivé guardy (aj samostatne) ════════════════════ */

/**
 * I13/D77 — dve env poistky. Bez nich je vynútený dry-run.
 *
 * Odmietnutie nesie aj strojový dôvod z `blockers.ts`: vypnuté zápisy sú
 * VEDOMÉ nastavenie a jediná pravdivá odpoveď na „ako to zapnem" je „mimo
 * appky, v jej konfigurácii" (`resolution: 'mimo_appky'`, `path: null`).
 * Bez toho vyzeral tento stav ako tichý neúspech, ktorý sa dá niekde odkliknúť.
 */
export function checkWritesEnabled(flags: GuardFlags): GuardResult {
  if (flags.nodeEnv === 'production' && flags.writesEnabled === true) return { ok: true };
  return refuse(
    GUARD_CODES.writesDisabled,
    'Ostrý zápis je vypnutý — vyžaduje NODE_ENV=production a WRITES_ENABLED=true (I13). Prebehol by len dry-run.',
    {
      nodeEnv: flags.nodeEnv,
      writesEnabled: flags.writesEnabled,
      blockers: writesBlockers(false),
    },
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
 * K2 — efektívny runaway strop: `max(podlaha z env, daily_write_budget + 20 %)`.
 *
 * Rozpočet je PLÁNOVANÁ rýchlosť, runaway je poistka proti splašeniu. Sú to
 * dve rôzne veci, ale runaway nesmie byť nižší než plán — inak by sa appka
 * zamkla presne vtedy, keď robí to, čo má.
 */
export async function effectiveRunawayLimit(deps: GuardsDeps = {}): Promise<number> {
  const d = resolve(deps);
  const budget = await resolveDailyBudget(d.settingsRepo, d.flags().dailyWriteBudget);
  return runawayLimitFor(budget, d.flags().runawayLimitPerHour);
}

/**
 * D79/I12 — runaway strop. Pri dosiahnutí stropu zápisy ZAMKNE (fail-closed)
 * a zapíše audit `writes_locked`. Počíta sa z append-only `audit_log` (O3),
 * takže sa počítadlo nedá obísť ani vynulovať.
 */
export async function checkRunawayAndMaybeLock(deps: GuardsDeps = {}): Promise<GuardResult> {
  const d = resolve(deps);
  const limit = await effectiveRunawayLimit(deps);
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

/**
 * K2 — denný rozpočet. Spotreba sa počíta VÝHRADNE z auditu (`write_attempt`
 * za UTC deň), nikdy z počítadlového stĺpca.
 *
 * ZÁMERNE nie je v `runPreWriteGuards()`: vyčerpaný rozpočet nie je odmietnutie
 * zápisu, je to informácia, že sa pokračuje zajtra. Volajúci (executor) z toho
 * robí `queued`, nie `failed`.
 *
 * Chyba pri čítaní rozpočtu (nedostupná DB) sa NEPREHLTNE — je to fail-closed
 * situácia „neviem, koľko som už minul" a rozhodnutie patrí volajúcemu.
 */
export async function checkDailyBudget(
  deps: GuardsDeps = {},
): Promise<GuardResult & { status?: BudgetStatus }> {
  const d = resolve(deps);
  const override = d.flags().dailyWriteBudget;
  const budget = createBudget({
    ...(d.writeAttemptCounter !== undefined ? { counter: d.writeAttemptCounter } : {}),
    ...(override !== undefined ? { dailyBudget: override } : {}),
    settingsRepo: d.settingsRepo,
    now: d.now,
  });

  const status = await budget.remainingToday();
  if (!status.exhausted) return { ok: true, status };
  return {
    ...refuse(
      GUARD_CODES.budgetExhausted,
      `Denný rozpočet ${status.budget} zápisov je na dnes (UTC ${status.day}) vyčerpaný — fronta pokračuje zajtra (K2).`,
      status,
    ),
    status,
  };
}

/**
 * K1 — rozsah dávky. Nahrádza pôvodný `checkAllowlist` (I2), ktorý bol
 * postavený na vete „max 10 produktov, kým nejdeme naostro".
 *
 *  - `pilot` (predvolený): strop 10 a KAŽDÉ ID v aktívnom allowliste — presne
 *    ako doteraz,
 *  - `plny`: strop `max_products_per_campaign` a KAŽDÉ ID v `catalog_cache`,
 *    ktoré nie je `not_found`. Zapísať sa nedá do produktu, ktorý appka nikdy
 *    nevidela (K1 bod 2).
 *
 * Fail-closed pri výnimke repozitára ZOSTÁVA v oboch režimoch: pri pochybnosti
 * sa NESMIE zapísať.
 */
export async function checkScope(
  productIds: readonly number[],
  deps: GuardsDeps = {},
): Promise<GuardResult> {
  const d = resolve(deps);
  const scope = await resolveScope(d);
  const max = scope.maxProducts;

  const unique = [...new Set(productIds)];
  if (unique.length === 0 || unique.length !== productIds.length) {
    return refuse(
      GUARD_CODES.noProducts,
      `Dávka musí obsahovať 1–${max} unikátnych produktov (I2, K1).`,
      { count: productIds.length, max },
    );
  }
  if (unique.some((id) => !Number.isInteger(id) || id <= 0)) {
    return refuse(GUARD_CODES.notInAllowlist, 'Dávka obsahuje neplatné ID produktu (I2).');
  }
  if (unique.length > max) {
    // B1 — TOTO je moment, v ktorom appka doteraz mlčky odmietla a používateľ
    // sa nedozvedel, že strop je len prepínač. Detail nesie celý obraz rozsahu
    // aj vety z `blockers.ts`, aby obrazovka vedela ponúknuť prepnutie do
    // plného rozsahu namiesto slepej uličky.
    return refuse(
      GUARD_CODES.tooManyProducts,
      `Jedna operácia smie v režime „${scope.mode}" zapísať najviac ${max} produktov (I2, K1).`,
      scopeRefusalDetail(scope, unique.length),
    );
  }

  if (scope.mode === 'plny') return checkCatalogScope(unique, d);

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

/**
 * Pôvodný názov guardu rozsahu.
 *
 * @deprecated Prechodný most pre `lib/engine/preview.ts` (V6) a
 * `app/api/campaigns/[id]/extend/preview/route.ts` (V8), ktoré ho ešte volajú.
 * Po ich prepnutí na `checkScope()` sa má zmazať — nový kód ho NESMIE používať.
 */
export const checkAllowlist = checkScope;

/**
 * K1 bod 2 — rozsah v režime `plny`: produkt musí byť v `catalog_cache` a
 * nesmie byť `not_found`.
 *
 * Číta sa po dávkach po 500 ID a mapa sa medzi dávkami zahadzuje: 10 000
 * riadkov katalógu naraz v pamäti je presne to, čomu sa K2 vyhýba.
 * Chýbajúci katalógový repozitár aj výnimka = fail-closed odmietnutie.
 */
const CATALOG_CHUNK = 500;

async function checkCatalogScope(
  productIds: number[],
  d: ResolvedDeps,
): Promise<GuardResult> {
  const repo = d.catalogRepo;
  if (repo === null) {
    return refuse(
      GUARD_CODES.notInCatalog,
      'Katalóg nie je k dispozícii, rozsah sa nedá overiť — zápis sa odmieta (K1 bod 2, fail-closed).',
    );
  }

  const missing: number[] = [];
  try {
    for (let start = 0; start < productIds.length; start += CATALOG_CHUNK) {
      const chunk = productIds.slice(start, start + CATALOG_CHUNK);
      const found = await repo.getMany(chunk);
      for (const id of chunk) {
        const row = found.get(id);
        // Turbopack tu už raz zahodil `if (!row)` ako compile-time falsy.
        if (row === undefined || row.shopStatus === 'not_found') missing.push(id);
        if (missing.length >= 20) break; // do detailu stačí vzorka
      }
      if (missing.length >= 20) break;
    }
  } catch {
    return refuse(
      GUARD_CODES.notInCatalog,
      'Katalóg sa nepodarilo prečítať — zápis sa odmieta pred volaním shopu (K1 bod 2, fail-closed).',
    );
  }

  if (missing.length > 0) {
    return refuse(
      GUARD_CODES.notInCatalog,
      'Aspoň jeden produkt nie je v katalógu appky (alebo ho shop nenašiel) — zápis sa odmieta pred volaním shopu (K1 bod 2).',
      { productIds: missing },
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
 *
 * `checkDailyBudget()` tu ZÁMERNE nie je (K2) — viď hlavičku súboru.
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

  const scopeCheck = await checkScope(params.productIds, deps);
  if (!scopeCheck.ok) return scopeCheck;

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
