/**
 * Aura Zľavy — repozitár singleton tabuľky `settings` (BUILD-SPEC §3, D79, D80;
 * KONTRAKT V3: K1, K2).
 *
 * Tabuľka má PRESNE jeden riadok (`id = 1`, CHECK `ck_settings_singleton`).
 * Tento repozitár NIKDY nevytvorí druhý riadok — všetky zápisy sú
 * `UPDATE … WHERE id = 1` a jediný `INSERT` je `INSERT IGNORE (id) VALUES (1)`
 * ako obnova po prípadnom TRUNCATE (idempotentný, druhý riadok nevznikne).
 *
 * Invarianty držané tu:
 *  - **I4** — žiadny prístup k `audit_log`; event `writes_locked`/`writes_unlocked`
 *    ani `scope_mode_changed` nezapisuje repozitár, ale volajúci (A2).
 *  - **I12** — `lockWrites()` je fail-closed runaway zámok (D79); odomknutie je
 *    výhradne explicitné `unlockWrites()`.
 *  - **K1 bod 1 (fail-closed rozsah)** — `readScope()` vracia `pilot`, keď je
 *    hodnota chýbajúca, nečitateľná alebo neznáma. Nie výnimka, nie `plny`.
 *    Preto `readScope()` NIKDY nehádže: aj pád DB je „neviem", a „neviem"
 *    znamená najprísnejší režim. `get()` naopak hádže ďalej — je to bežné
 *    čítanie nastavení a tichý default by tam bol klamstvo.
 *
 * Čo sa tu NESMIE pokaziť: `scopeChangeRequiresSudo()` je jediné miesto, kde je
 * napísaná asymetria K1 bodu 4 („sprísnenie je vždy voľné, uvoľnenie nikdy").
 * Route ju vynucuje, obrazovka ju ohlasuje dopredu — ale rozhodnutie musí
 * pochádzať z jednej funkcie, inak sa raz rozídu a heslo si vypýta niečo iné,
 * než čo obrazovka sľúbila.
 *
 * Vlastník: V4.
 */
import type { Queryable, SettingsRecord, SettingsRepo, UtcDate } from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ────────────────────────── režim rozsahu (K1) ─────────────────────────── */

/** Hodnoty ENUM `settings.scope_mode` z migrácie `0010_fronta_a_pasma.sql`. */
export type ScopeMode = 'pilot' | 'plny';

/** Strop jednej zľavy v režime `pilot` — pôvodné I2 (K1, tabuľka režimov). */
export const PILOT_MAX_PRODUCTS = 10;

/** Tvrdý DB strop (`ck_settings_max_products`, `ck_campaigns_items_total`). */
export const HARD_MAX_PRODUCTS = 10_000;

/** Denný strop shopu, nie náš (`ck_settings_daily_budget`). */
export const MAX_DAILY_WRITE_BUDGET = 200;

/** Nastavenia rozsahu a rýchlosti fronty (K1, K2). */
export interface ScopeSettings {
  mode: ScopeMode;
  /** Strop uložený v nastaveniach; v režime `pilot` sa NEPOUŽÍVA. */
  maxProductsPerCampaign: number;
  dailyWriteBudget: number;
  /**
   * `true` = hodnoty nepochádzajú z DB, ale z fail-closed defaultu (K1 bod 1).
   * UI to má priznať, nie tváriť sa, že nastavenia prečítalo.
   */
  failClosed: boolean;
}

/**
 * Fail-closed default (K1 bod 1). `pilot` + strop 10 je najprísnejší možný
 * stav. `dailyWriteBudget` je pri neznalosti 1: fronta sa tým nezastaví
 * (pokračuje ďalší deň), ale ani sa nerozbehne na plné obrátky nad DB,
 * o ktorej práve nič nevieme.
 */
export const FAIL_CLOSED_SCOPE: ScopeSettings = {
  mode: 'pilot',
  maxProductsPerCampaign: PILOT_MAX_PRODUCTS,
  dailyWriteBudget: 1,
  failClosed: true,
};

const isScopeMode = (value: unknown): value is ScopeMode =>
  value === 'pilot' || value === 'plny';

/**
 * Efektívny strop jednej zľavy (K1, tabuľka režimov): v `pilot` vždy 10,
 * v `plny` uložená hodnota zastropovaná tvrdým DB stropom.
 */
export function effectiveMaxProducts(scope: ScopeSettings): number {
  if (scope.mode !== 'plny') return PILOT_MAX_PRODUCTS;
  const value = Math.trunc(scope.maxProductsPerCampaign);
  if (!Number.isFinite(value) || value < 1) return PILOT_MAX_PRODUCTS;
  return Math.min(HARD_MAX_PRODUCTS, value);
}

/* ──────────────── asymetria uvoľnenia a sprísnenia (K1 bod 4) ───────────── */

/** Zámer zmeny rozsahu — čo chce volajúci nastaviť. */
export interface ScopeChangeIntent {
  mode: ScopeMode;
  /** Nový strop pre `plny`. `undefined` = uložená hodnota ostáva. */
  maxProductsPerCampaign?: number | undefined;
}

/**
 * K1 bod 4 — „sprísnenie je vždy voľné, uvoľnenie nikdy."
 *
 * Vracia `true`, keď zmena rozsah UVOĽŇUJE, a teda si musí vypýtať heslo
 * (sudo). Uvoľnením sú DVE veci, nie jedna:
 *
 *  1. **`pilot → plny`** — aj pri rovnakom čísle stropu. V `plny` sa prestáva
 *     vynucovať allowlist a nastupuje katalóg (K1 bod 2), takže sa mení to,
 *     KTORÉ produkty prejdú, nie len koľko ich prejde.
 *  2. **zvýšenie efektívneho stropu** — vrátane `plny → plny` z 8 000 na
 *     10 000. Bez tejto vetvy by sa dal strop zdvihnúť bez hesla a z vety
 *     „rozsah sa nedá rozšíriť bez sudo" (I2 po K1) by ostala polovica.
 *
 * Opačný smer (`plny → pilot`, zníženie stropu, rovnaký stav) heslo NIKDY
 * nepýta — v núdzi sa appka musí dať pribrzdiť aj bez neho. Preto sa tu
 * porovnávajú EFEKTÍVNE stropy: uložený `max_products_per_campaign` sa
 * v `pilot` nepoužíva a jeho zmena tam nie je uvoľnením ničoho.
 *
 * Fail-closed: `before` z nečitateľnej DB je `pilot` (`FAIL_CLOSED_SCOPE`),
 * takže prechod z „neviem" do `plny` je uvoľnenie a heslo si vypýta.
 */
export function scopeChangeRequiresSudo(
  before: ScopeSettings,
  intent: ScopeChangeIntent,
): boolean {
  const releasingMode = intent.mode === 'plny' && before.mode !== 'plny';
  const after: ScopeSettings = {
    ...before,
    mode: intent.mode,
    maxProductsPerCampaign: intent.maxProductsPerCampaign ?? before.maxProductsPerCampaign,
  };
  const raisingCap = effectiveMaxProducts(after) > effectiveMaxProducts(before);
  return releasingMode || raisingCap;
}

/* ─────────────────────────────────── SQL ───────────────────────────────── */

const COLUMNS =
  'id, shop_domain, shop_domain_confirmed_at, eager_write_default, scope_mode, ' +
  'max_products_per_campaign, daily_write_budget, writes_locked, ' +
  'writes_locked_reason, writes_locked_at, onboarding_done_at, updated_at';

const SQL_GET = `SELECT ${COLUMNS} FROM settings WHERE id = 1 LIMIT 1`;
/** Idempotentná obnova singletonu — NIKDY nevytvorí druhý riadok. */
const SQL_ENSURE = 'INSERT IGNORE INTO settings (id) VALUES (1)';
const SQL_SET_DOMAIN =
  'UPDATE settings SET shop_domain = ?, shop_domain_confirmed_at = ? WHERE id = 1';
const SQL_SET_EAGER = 'UPDATE settings SET eager_write_default = ? WHERE id = 1';

/** K1 bod 4: prepnutie režimu je auditovaná udalosť — audit píše volajúci. */
const SQL_SET_SCOPE_MODE = 'UPDATE settings SET scope_mode = ? WHERE id = 1';
const SQL_SET_MAX_PRODUCTS = 'UPDATE settings SET max_products_per_campaign = ? WHERE id = 1';
const SQL_SET_DAILY_BUDGET = 'UPDATE settings SET daily_write_budget = ? WHERE id = 1';
const SQL_LOCK =
  'UPDATE settings SET writes_locked = 1, writes_locked_reason = ?, ' +
  'writes_locked_at = UTC_TIMESTAMP(3) WHERE id = 1';
const SQL_UNLOCK =
  'UPDATE settings SET writes_locked = 0, writes_locked_reason = NULL, ' +
  'writes_locked_at = NULL WHERE id = 1';
const SQL_ONBOARDING = 'UPDATE settings SET onboarding_done_at = UTC_TIMESTAMP(3) WHERE id = 1';

/* ──────────────────────────────── mapovanie ────────────────────────────── */

interface SettingsRow {
  id: number;
  shop_domain: string | null;
  shop_domain_confirmed_at: Date | string | null;
  eager_write_default: number | boolean;
  scope_mode: string | null;
  max_products_per_campaign: number | string | null;
  daily_write_budget: number | string | null;
  writes_locked: number | boolean;
  writes_locked_reason: string | null;
  writes_locked_at: Date | string | null;
  onboarding_done_at: Date | string | null;
  updated_at: Date | string;
}

/** Záznam nastavení rozšírený o polia V3 (K1, K2). */
export interface SettingsRecordV3 extends SettingsRecord {
  /** Fail-closed: čokoľvek mimo `pilot`/`plny` sa číta ako `pilot` (K1 bod 1). */
  scopeMode: ScopeMode;
  maxProductsPerCampaign: number;
  dailyWriteBudget: number;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const toDateOrNull = (value: Date | string | null): Date | null =>
  value == null ? null : toDate(value);

/** Celé číslo v rozsahu, inak `fallback` — nikdy `NaN`, nikdy mimo CHECKu. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const truncated = Math.trunc(parsed);
  if (truncated < min || truncated > max) return fallback;
  return truncated;
}

function mapRow(row: SettingsRow): SettingsRecordV3 {
  return {
    id: 1,
    shopDomain: row.shop_domain,
    shopDomainConfirmedAt: toDateOrNull(row.shop_domain_confirmed_at),
    eagerWriteDefault: Boolean(row.eager_write_default),
    // K1 bod 1: neznáma hodnota režimu = `pilot`. Platí to aj tu, nielen v
    // `readScope()` — inak by stačilo prečítať settings „tou druhou cestou".
    scopeMode: isScopeMode(row.scope_mode) ? row.scope_mode : 'pilot',
    maxProductsPerCampaign: clampInt(
      row.max_products_per_campaign,
      1,
      HARD_MAX_PRODUCTS,
      PILOT_MAX_PRODUCTS,
    ),
    dailyWriteBudget: clampInt(row.daily_write_budget, 1, MAX_DAILY_WRITE_BUDGET, 1),
    writesLocked: Boolean(row.writes_locked),
    writesLockedReason: row.writes_locked_reason,
    writesLockedAt: toDateOrNull(row.writes_locked_at),
    onboardingDoneAt: toDateOrNull(row.onboarding_done_at),
    updatedAt: toDate(row.updated_at),
  };
}

/* ──────────────────────────────── factory ──────────────────────────────── */

export interface SettingsRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

/** Rozhranie po KONTRAKTE V3 — pridané polia sú nadmnožina kontraktu. */
export interface SettingsRepoExt extends SettingsRepo {
  get(conn?: Queryable): Promise<SettingsRecordV3>;
  /**
   * K1 bod 1 — FAIL-CLOSED čítanie rozsahu. Nikdy nehádže: chýbajúci riadok,
   * nečitateľná DB aj neznáma hodnota končia ako `pilot`.
   */
  readScope(conn?: Queryable): Promise<ScopeSettings>;
  /** K1 bod 4: prepnutie režimu. Sudo a audit vynucuje volajúci (route). */
  setScopeMode(mode: ScopeMode, conn?: Queryable): Promise<void>;
  setMaxProductsPerCampaign(value: number, conn?: Queryable): Promise<void>;
  setDailyWriteBudget(value: number, conn?: Queryable): Promise<void>;
}

export function createSettingsRepo(deps: SettingsRepoDeps = {}): SettingsRepoExt {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const repo: SettingsRepoExt = {
    async get(conn?: Queryable): Promise<SettingsRecordV3> {
      let rows = await run<SettingsRow[]>(conn, SQL_GET, []);
      if (!Array.isArray(rows) || rows.length === 0) {
        // Riadok vytvára migrácia 0001; toto je len obnova po TRUNCATE v testoch.
        await run(conn, SQL_ENSURE, []);
        rows = await run<SettingsRow[]>(conn, SQL_GET, []);
      }
      const row = Array.isArray(rows) ? rows[0] : undefined;
      // Turbopack tu už raz zahodil `if (!row)` ako compile-time falsy.
      if (row === undefined) throw new Error('Singleton riadok settings (id=1) sa nedá načítať.');
      return mapRow(row);
    },

    /**
     * FAIL-CLOSED čítanie rozsahu (K1 bod 1).
     *
     * Tri cesty vedú k `pilot`: (1) riadok neexistuje, (2) `SELECT` zlyhal,
     * (3) hodnota v stĺpci nie je ani `pilot`, ani `plny`. Rozšíriť rozsah sa
     * nedá omylom ani výpadkom — len vedomým zápisom cez `setScopeMode()`.
     */
    async readScope(conn?: Queryable): Promise<ScopeSettings> {
      try {
        const rows = await run<SettingsRow[]>(conn, SQL_GET, []);
        const row = Array.isArray(rows) ? rows[0] : undefined;
        if (row === undefined) return { ...FAIL_CLOSED_SCOPE };
        if (!isScopeMode(row.scope_mode)) return { ...FAIL_CLOSED_SCOPE };
        const record = mapRow(row);
        return {
          mode: record.scopeMode,
          maxProductsPerCampaign: record.maxProductsPerCampaign,
          dailyWriteBudget: record.dailyWriteBudget,
          failClosed: false,
        };
      } catch {
        // Nečitateľná DB je „neviem" a „neviem" je `pilot`. Chyba sa
        // nepreposiela ďalej — volajúci má fungovať prísne, nie spadnúť.
        return { ...FAIL_CLOSED_SCOPE };
      }
    },

    /**
     * K1 bod 4: sprísnenie (`plny` → `pilot`) je vždy voľné, uvoľnenie
     * (`pilot` → `plny`) vyžaduje sudo + audit — oboje vynucuje route, nie
     * repozitár. Tu sa kontroluje len to, že hodnota je z ENUMu.
     */
    async setScopeMode(mode: ScopeMode, conn?: Queryable): Promise<void> {
      if (!isScopeMode(mode)) {
        throw new Error(`Neznámy režim rozsahu: ${String(mode)}. Povolené: pilot, plny.`);
      }
      await run(conn, SQL_SET_SCOPE_MODE, [mode]);
    },

    async setMaxProductsPerCampaign(value: number, conn?: Queryable): Promise<void> {
      const parsed = Math.trunc(Number(value));
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > HARD_MAX_PRODUCTS) {
        throw new Error(
          `Strop produktov na zľavu musí byť 1–${HARD_MAX_PRODUCTS}, dostal som ${String(value)}.`,
        );
      }
      await run(conn, SQL_SET_MAX_PRODUCTS, [parsed]);
    },

    /**
     * K2: rozpočet je konfigurovateľný NADOL. Hornú hranicu drží aj DB
     * (`ck_settings_daily_budget`) — 200/deň je strop shopu, nie náš.
     */
    async setDailyWriteBudget(value: number, conn?: Queryable): Promise<void> {
      const parsed = Math.trunc(Number(value));
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_DAILY_WRITE_BUDGET) {
        throw new Error(
          `Denný rozpočet zápisov musí byť 1–${MAX_DAILY_WRITE_BUDGET}, dostal som ${String(value)}.`,
        );
      }
      await run(conn, SQL_SET_DAILY_BUDGET, [parsed]);
    },

    async setShopDomain(
      domain: string,
      confirmedAt: UtcDate | null,
      conn?: Queryable,
    ): Promise<void> {
      // Normalizáciu a validáciu domény vlastní A7 — tu len zápis.
      await run(conn, SQL_SET_DOMAIN, [domain, confirmedAt]);
    },

    async setEagerWriteDefault(enabled: boolean, conn?: Queryable): Promise<void> {
      await run(conn, SQL_SET_EAGER, [enabled ? 1 : 0]);
    },

    async lockWrites(reason: string, conn?: Queryable): Promise<void> {
      // Fail-closed (D79, I12): dôvod sa oreže na dĺžku stĺpca, zámok padne vždy.
      await run(conn, SQL_LOCK, [reason.slice(0, 191)]);
    },

    async unlockWrites(conn?: Queryable): Promise<void> {
      await run(conn, SQL_UNLOCK, []);
    },

    async markOnboardingDone(conn?: Queryable): Promise<void> {
      await run(conn, SQL_ONBOARDING, []);
    },
  };

  return repo;
}

/** Singleton pre route-y, engine a scheduler. */
export const settingsRepo: SettingsRepoExt = createSettingsRepo();
