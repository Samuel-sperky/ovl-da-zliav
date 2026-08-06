/**
 * Aura Zľavy — ENV schéma (BUILD-SPEC §11, D93, I14).
 *
 * Fail-fast pri boote s vymenovaním VŠETKÝCH chýb naraz. Tento modul je jediné
 * miesto, kde sa `process.env` číta; ostatné moduly používajú `env`.
 *
 * Invarianty držané tu:
 *  - I2  — `MAX_PRODUCTS_PER_OPERATION` a `ALLOWLIST_MAX` majú tvrdý strop 10.
 *  - I5  — `PUBLIC_BIND` musí byť presne `127.0.0.1`.
 *  - I6  — `SHOP_BASE_URL_OVERRIDE` je v produkcii zakázaný.
 *  - I13 — `WRITES_ENABLED` je samostatná poistka vedľa `NODE_ENV`.
 *  - I14 — zlý/chýbajúci ENV znamená ukončenie procesu (robí `instrumentation.ts`).
 *  - R2  — `API_KEY_TTL_HOURS` má strop 48.
 *
 * Doména shopu tu ÚMYSELNE nie je — žije v `settings.shop_domain` (R5, D80).
 */
import { z } from 'zod';

import { APP_VERSION } from '@/version';

/* ────────────────────────────── pomocné typy ───────────────────────────── */

const boolFromString = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true');

const intFromString = (opts: { min: number; max?: number; default?: number }) => {
  let schema = z.coerce.number().int().min(opts.min);
  if (opts.max !== undefined) schema = schema.max(opts.max);
  return opts.default === undefined ? schema : schema.default(opts.default);
};

const nonEmpty = (max = 255) => z.string().min(1).max(max);

/* ──────────────────────────────── schéma ───────────────────────────────── */

export const envSchema = z
  .object({
    // Runtime a poistky zápisu (D77, I13)
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    WRITES_ENABLED: boolFromString(false),
    PUBLIC_BIND: z
      .literal('127.0.0.1', 'PUBLIC_BIND musí byť presne "127.0.0.1" (I5, D78)')
      .default('127.0.0.1'),
    PORT: intFromString({ min: 1, max: 65535, default: 3000 }),
    APP_VERSION: nonEmpty(64).default(APP_VERSION),

    // Databáza (D89)
    DB_HOST: nonEmpty(191).default('127.0.0.1'),
    DB_PORT: intFromString({ min: 1, max: 65535, default: 3306 }),
    DB_NAME: nonEmpty(64).default('ovl_zliav'),
    DB_USER: nonEmpty(64).default('ovl_zliav_app'),
    DB_PASSWORD_FILE: nonEmpty(512).optional(),
    DB_PASSWORD: z.string().max(512).optional(),
    DB_MIGRATION_USER: nonEmpty(64).default('ovl_zliav_mig'),
    DB_MIGRATION_PASSWORD_FILE: nonEmpty(512).optional(),
    DB_MIGRATION_PASSWORD: z.string().max(512).optional(),
    DB_CONNECTION_LIMIT: intFromString({ min: 1, max: 50, default: 8 }),
    DB_CONNECT_RETRIES: intFromString({ min: 0, max: 60, default: 10 }),
    DB_CONNECT_RETRY_DELAY_MS: intFromString({ min: 100, max: 30_000, default: 2000 }),

    // Tajomstvá zo súborov (D61, D69, O2)
    MASTER_KEY_FILE: nonEmpty(512).default('/run/secrets/master.key'),
    SESSION_SECRET_FILE: nonEmpty(512).default('/run/secrets/session.key'),

    // Kľúč shopu, session, sudo, lockout (R2, D69–D71)
    API_KEY_TTL_HOURS: intFromString({ min: 1, max: 48, default: 48 }),
    SESSION_ABSOLUTE_HOURS: intFromString({ min: 1, max: 24, default: 8 }),
    SESSION_IDLE_MINUTES: intFromString({ min: 1, max: 480, default: 30 }),
    SUDO_WINDOW_MINUTES: intFromString({ min: 1, max: 60, default: 15 }),
    LOGIN_MAX_ATTEMPTS: intFromString({ min: 1, max: 20, default: 5 }),
    LOGIN_WINDOW_MINUTES: intFromString({ min: 1, max: 1440, default: 15 }),

    // Scheduler (D32, D82, D87)
    SCHEDULER_ENABLED: boolFromString(true),
    SCHEDULER_TICK_MS: intFromString({ min: 1000, max: 3_600_000, default: 60_000 }),
    SCHEDULER_FIRE_TIME: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'SCHEDULER_FIRE_TIME musí byť vo formáte HH:mm')
      .default('00:05'),
    LOGIC_TIMEZONE: nonEmpty(64).default('Europe/Bratislava'),

    // Shop API klient (D42–D46)
    SHOP_TIMEOUT_READ_MS: intFromString({ min: 1000, max: 120_000, default: 10_000 }),
    SHOP_TIMEOUT_WRITE_MS: intFromString({ min: 1000, max: 120_000, default: 30_000 }),
    SHOP_WRITE_PAUSE_MS: intFromString({ min: 0, max: 10_000, default: 250 }),
    SHOP_RETRY_MAX: intFromString({ min: 1, max: 10, default: 3 }),
    SHOP_RETRY_AFTER_CAP_S: intFromString({ min: 1, max: 600, default: 90 }),

    // Predajnosť z objednávok (KONTRAKT-PREDAJNOST-2026-08-06, P2, P3, P6)
    // Kľúč na objednávky je len na čítanie a nevidí osobné údaje, preto má
    // vlastnú, dlhšiu platnosť než 48 h zápisového kľúča (P2, odchýlka od R2).
    ORDERS_KEY_TTL_DAYS: intFromString({ min: 1, max: 90, default: 30 }),
    SALES_SYNC_ENABLED: boolFromString(true),
    // P3: okno 3 dni. Zmerané 6.8.2026 — 3 dni = 978 objednávok, a keďže
    // zoznam objednávok nevracia položky, je to 1 request na 1 objednávku.
    // Rozširovať opatrne: 90 dní by bolo ~29 000 requestov na produkčný shop.
    SALES_WINDOW_DAYS: intFromString({ min: 1, max: 90, default: 3 }),
    // Strop na JEDEN beh synchronizácie. Po jeho dosiahnutí sa beh korektne
    // ukončí, uloží pokrok a pokračuje nabudúce (P6 — fail-soft).
    ORDERS_MAX_REQUESTS_PER_RUN: intFromString({ min: 10, max: 20_000, default: 1500 }),
    // Shop dovoluje 300 requestov / 60 s NA KĽÚČ (docs/api/sperky-api.md
    // §Rate limiting). Pri pauze 250 ms a latencii ~150 ms sme na ~150/min,
    // teda na polovici budgetu. Spodná hranica 100 ms je tu zámerne: s nulovou
    // pauzou by sa dal limit prekročiť aj bez zmeny kódu.
    ORDERS_PAUSE_MS: intFromString({ min: 100, max: 10_000, default: 250 }),

    // Stropy (I2, D79, D59)
    MAX_PRODUCTS_PER_OPERATION: intFromString({ min: 1, max: 10, default: 10 }),
    ALLOWLIST_MAX: intFromString({ min: 1, max: 10, default: 10 }),
    RUNAWAY_LIMIT_PER_HOUR: intFromString({ min: 1, max: 1000, default: 60 }),
    MIDNIGHT_FREEZE_SECONDS: intFromString({ min: 0, max: 600, default: 60 }),

    // Logovanie (D92)
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    // Testy (I6)
    SHOP_BASE_URL_OVERRIDE: z.string().url().optional(),
  })
  .superRefine((v, ctx) => {
    const isProd = v.NODE_ENV === 'production';

    // I6 — mock override nesmie existovať v produkcii.
    if (isProd && v.SHOP_BASE_URL_OVERRIDE) {
      ctx.addIssue({
        code: 'custom',
        path: ['SHOP_BASE_URL_OVERRIDE'],
        message:
          'SHOP_BASE_URL_OVERRIDE je povolený výhradne mimo produkcie (I6) — v produkcii ho odstráň.',
      });
    }

    // D89 — DB heslá: v produkcii výhradne zo súboru, inak aspoň jeden zdroj.
    const pwPairs: Array<[fileKey: keyof typeof v, plainKey: keyof typeof v]> = [
      ['DB_PASSWORD_FILE', 'DB_PASSWORD'],
      ['DB_MIGRATION_PASSWORD_FILE', 'DB_MIGRATION_PASSWORD'],
    ];
    for (const [fileKey, plainKey] of pwPairs) {
      const file = v[fileKey];
      const plain = v[plainKey];
      if (isProd) {
        if (!file) {
          ctx.addIssue({
            code: 'custom',
            path: [fileKey],
            message: `${fileKey} je v produkcii povinný (heslo sa číta zo súboru, nie z env) — D89.`,
          });
        }
        if (plain) {
          ctx.addIssue({
            code: 'custom',
            path: [plainKey],
            message: `${plainKey} je v produkcii zakázaný — použi ${fileKey} (D89, I1).`,
          });
        }
      } else if (!file && !plain) {
        ctx.addIssue({
          code: 'custom',
          path: [fileKey],
          message: `Chýba ${fileKey} alebo ${plainKey} (mimo produkcie stačí jedno z nich).`,
        });
      }
    }

    // I13 — `WRITES_ENABLED=true` mimo produkcie NIE JE chyba konfigurácie
    // (potrebujú to testy), ale zápis aj tak neprejde: druhú polovicu poistky
    // vyhodnocuje `writesAllowedByEnv()` a `lib/engine/guards.ts`.
  });

export type Env = z.infer<typeof envSchema>;

/* ─────────────────────────────── parsovanie ────────────────────────────── */

export class EnvError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `Neplatná konfigurácia ENV (${problems.length} ${
        problems.length === 1 ? 'chyba' : 'chýb'
      }):\n  - ${problems.join('\n  - ')}`,
    );
    this.name = 'EnvError';
    this.problems = problems;
  }
}

export type ParseEnvResult =
  | { ok: true; env: Env }
  | { ok: false; problems: string[] };

/**
 * Čistá funkcia — bez side-effectov, bez čítania `process.env`.
 * Používajú ju testy invariantov (A17) aj `loadEnv()`.
 */
export function parseEnv(raw: Record<string, string | undefined>): ParseEnvResult {
  const result = envSchema.safeParse(raw);
  if (result.success) return { ok: true, env: result.data };

  const problems = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  return { ok: false, problems };
}

let cached: Env | null = null;

/** Memoizované načítanie. Hodí `EnvError` so zoznamom všetkých chýb (D93). */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  if (cached) return cached;
  const parsed = parseEnv(source);
  if (!parsed.ok) throw new EnvError(parsed.problems);
  cached = parsed.env;
  return cached;
}

/** Výhradne pre testy — zabudne memoizovanú hodnotu. */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * Lazy prístup k ENV. Parsovanie sa spustí až pri prvom čítaní vlastnosti, takže
 * samotný `import` nikdy nezhodí build ani statickú analýzu Next.js.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string | symbol) {
    return loadEnv()[prop as keyof Env];
  },
  has(_target, prop) {
    return prop in loadEnv();
  },
  ownKeys() {
    return Reflect.ownKeys(loadEnv());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(loadEnv(), prop);
  },
});

/** True keď je ostrý zápis vôbec prípustný (I13, D77). Neposudzuje `writes_locked`. */
export function writesAllowedByEnv(e: Env = loadEnv()): boolean {
  return e.NODE_ENV === 'production' && e.WRITES_ENABLED === true;
}
