/**
 * Aura Zľavy — INVARIANTNÉ TESTY ENV SCHÉMY (A17; I2, I5, I6, I13, I14, R2).
 *
 * Testuje sa SKUTOČNÁ zod schéma z `src/env.ts` (`parseEnv` je čistá funkcia,
 * takže nič sa nemockuje a nič sa neopravuje „vedľa"). Každý test tu je
 * poistkou proti tomu, aby sa strop invariantu dal zvýšiť konfiguráciou.
 *
 * Vlastník: A17.
 */
import { describe, expect, it } from 'vitest';

import { parseEnv, writesAllowedByEnv, type Env } from '@/env';

/** Minimálne platné ENV mimo produkcie (heslá stačia v plain podobe, D89). */
function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    DB_PASSWORD: 'test_app_password',
    DB_MIGRATION_PASSWORD: 'test_mig_password',
    ...overrides,
  };
}

function problemsFor(overrides: Record<string, string | undefined>): string[] {
  const result = parseEnv(baseEnv(overrides));
  return result.ok ? [] : result.problems;
}

function envOrThrow(overrides: Record<string, string | undefined> = {}): Env {
  const result = parseEnv(baseEnv(overrides));
  if (!result.ok) throw new Error(`ENV malo byť platné, ale: ${result.problems.join('; ')}`);
  return result.env;
}

describe('ENV schéma — baseline', () => {
  it('minimálna testovacia konfigurácia je platná a má invariantné defaulty', () => {
    const env = envOrThrow();
    expect(env.PUBLIC_BIND).toBe('127.0.0.1'); // I5
    expect(env.MAX_PRODUCTS_PER_OPERATION).toBeLessThanOrEqual(10); // I2
    expect(env.ALLOWLIST_MAX).toBeLessThanOrEqual(10); // I2
    expect(env.API_KEY_TTL_HOURS).toBeLessThanOrEqual(48); // R2
    expect(env.WRITES_ENABLED).toBe(false); // I13 — fail-closed default
    expect(env.RUNAWAY_LIMIT_PER_HOUR).toBe(60); // I12, D79
  });

  it('doména shopu NIE JE položkou ENV (R5, D80) — žije v settings', () => {
    const env = envOrThrow() as unknown as Record<string, unknown>;
    for (const key of Object.keys(env)) {
      expect(key).not.toMatch(/SHOP_DOMAIN|SHOP_BASE_URL$/);
    }
  });
});

describe('I2 — stropy 10 produktov sa nedajú zvýšiť konfiguráciou', () => {
  it('MAX_PRODUCTS_PER_OPERATION=11 je odmietnuté', () => {
    const problems = problemsFor({ MAX_PRODUCTS_PER_OPERATION: '11' });
    expect(problems.some((p) => p.startsWith('MAX_PRODUCTS_PER_OPERATION'))).toBe(true);
  });

  it('ALLOWLIST_MAX=11 je odmietnuté', () => {
    const problems = problemsFor({ ALLOWLIST_MAX: '11' });
    expect(problems.some((p) => p.startsWith('ALLOWLIST_MAX'))).toBe(true);
  });

  it('10 je stále povolené — strop je horná hranica, nie zákaz', () => {
    const env = envOrThrow({ MAX_PRODUCTS_PER_OPERATION: '10', ALLOWLIST_MAX: '10' });
    expect(env.MAX_PRODUCTS_PER_OPERATION).toBe(10);
    expect(env.ALLOWLIST_MAX).toBe(10);
  });

  it('0 ani negatívne hodnoty neprejdú (fail-closed na oboch koncoch)', () => {
    expect(problemsFor({ ALLOWLIST_MAX: '0' }).length).toBeGreaterThan(0);
    expect(problemsFor({ MAX_PRODUCTS_PER_OPERATION: '-1' }).length).toBeGreaterThan(0);
  });
});

describe('R2 — TTL kľúča má strop 48 h', () => {
  it('API_KEY_TTL_HOURS=72 je odmietnuté', () => {
    const problems = problemsFor({ API_KEY_TTL_HOURS: '72' });
    expect(problems.some((p) => p.startsWith('API_KEY_TTL_HOURS'))).toBe(true);
  });

  it('48 h je maximum, ktoré prejde', () => {
    expect(envOrThrow({ API_KEY_TTL_HOURS: '48' }).API_KEY_TTL_HOURS).toBe(48);
    expect(problemsFor({ API_KEY_TTL_HOURS: '49' }).length).toBeGreaterThan(0);
  });
});

describe('I5 — PUBLIC_BIND musí byť presne 127.0.0.1', () => {
  it.each(['0.0.0.0', '::', 'localhost', '192.168.1.10', '127.0.0.2'])(
    'PUBLIC_BIND=%s je odmietnuté',
    (value) => {
      const problems = problemsFor({ PUBLIC_BIND: value });
      expect(problems.some((p) => p.startsWith('PUBLIC_BIND'))).toBe(true);
    },
  );

  it('127.0.0.1 prejde', () => {
    expect(envOrThrow({ PUBLIC_BIND: '127.0.0.1' }).PUBLIC_BIND).toBe('127.0.0.1');
  });
});

describe('I6 — mock override je mimo produkcie povinne lokálny a v produkcii zakázaný', () => {
  it('SHOP_BASE_URL_OVERRIDE v produkcii je odmietnutý', () => {
    const problems = problemsFor({
      NODE_ENV: 'production',
      DB_PASSWORD: undefined,
      DB_MIGRATION_PASSWORD: undefined,
      DB_PASSWORD_FILE: '/run/secrets/db.pw',
      DB_MIGRATION_PASSWORD_FILE: '/run/secrets/db-mig.pw',
      SHOP_BASE_URL_OVERRIDE: 'http://127.0.0.1:9999',
    });
    expect(problems.some((p) => p.startsWith('SHOP_BASE_URL_OVERRIDE'))).toBe(true);
  });

  it('mimo produkcie je override povolený (mock shop na 127.0.0.1)', () => {
    const env = envOrThrow({ SHOP_BASE_URL_OVERRIDE: 'http://127.0.0.1:41234' });
    expect(new URL(env.SHOP_BASE_URL_OVERRIDE ?? '').hostname).toBe('127.0.0.1');
  });
});

describe('D89 / I1 — heslá v produkcii výhradne zo súboru', () => {
  const prodBase = {
    NODE_ENV: 'production',
    DB_PASSWORD: undefined,
    DB_MIGRATION_PASSWORD: undefined,
  } as const;

  it('produkcia bez *_PASSWORD_FILE zlyhá', () => {
    const problems = problemsFor({ ...prodBase });
    expect(problems.some((p) => p.startsWith('DB_PASSWORD_FILE'))).toBe(true);
    expect(problems.some((p) => p.startsWith('DB_MIGRATION_PASSWORD_FILE'))).toBe(true);
  });

  it('produkcia s plain heslom v env zlyhá (kľúče a heslá nikdy v env, I1)', () => {
    const problems = problemsFor({
      ...prodBase,
      DB_PASSWORD: 'plain-in-env',
      DB_PASSWORD_FILE: '/run/secrets/db.pw',
      DB_MIGRATION_PASSWORD_FILE: '/run/secrets/db-mig.pw',
    });
    expect(problems.some((p) => p.startsWith('DB_PASSWORD'))).toBe(true);
  });

  it('mimo produkcie musí byť aspoň jeden zdroj hesla', () => {
    const problems = problemsFor({ DB_PASSWORD: undefined, DB_MIGRATION_PASSWORD: undefined });
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('I14 — chybný ENV sa hlási naraz a so všetkými problémami', () => {
  it('viac chýb naraz => viac problémov (D93)', () => {
    const problems = problemsFor({
      PUBLIC_BIND: '0.0.0.0',
      ALLOWLIST_MAX: '11',
      API_KEY_TTL_HOURS: '72',
      SCHEDULER_FIRE_TIME: '25:99',
    });
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });

  it('problémy nikdy neobsahujú hodnotu hesla (I1)', () => {
    const problems = problemsFor({
      DB_PASSWORD: 'fake-shop-key-9ZQ1',
      ALLOWLIST_MAX: '11',
    });
    expect(problems.join('\n')).not.toContain('fake-shop-key-9ZQ1');
  });
});

describe('I13 — dve nezávislé poistky ostrého zápisu', () => {
  it('zápis je povolený výhradne pri production + WRITES_ENABLED=true', () => {
    const combos: Array<[nodeEnv: string, writes: string, expected: boolean]> = [
      ['test', 'false', false],
      ['test', 'true', false],
      ['development', 'true', false],
      ['production', 'false', false],
      ['production', 'true', true],
    ];
    for (const [nodeEnv, writes, expected] of combos) {
      const env = envOrThrow(
        nodeEnv === 'production'
          ? {
              NODE_ENV: nodeEnv,
              WRITES_ENABLED: writes,
              DB_PASSWORD: undefined,
              DB_MIGRATION_PASSWORD: undefined,
              DB_PASSWORD_FILE: '/run/secrets/db.pw',
              DB_MIGRATION_PASSWORD_FILE: '/run/secrets/db-mig.pw',
            }
          : { NODE_ENV: nodeEnv, WRITES_ENABLED: writes },
      );
      expect(writesAllowedByEnv(env), `${nodeEnv}/${writes}`).toBe(expected);
    }
  });
});

describe('R-2 — tempo čítania objednávok nesmie prekročiť limit shopu (300 req / 60 s na kľúč)', () => {
  /**
   * `ORDERS_PAUSE_MS` je jediná poistka tempa: synchronizácia posiela requesty
   * striktne sekvenčne s touto pauzou. Najhorší prípad (nulová latencia shopu)
   * je teda `60_000 / pauseMs` requestov za minútu — a ten MUSÍ zostať pod
   * dokumentovaným limitom shopu, inak si appka vyrobí `rate_limited` sama
   * (a v horšom prípade zabanovaný kľúč, čo je presne riziko R-2).
   */
  const SHOP_REQUESTS_PER_MINUTE = 300;

  it('najnižšia povolená pauza drží tempo pod limitom shopu aj pri nulovej latencii', () => {
    const env = envOrThrow({ ORDERS_PAUSE_MS: '250' });
    expect(60_000 / env.ORDERS_PAUSE_MS).toBeLessThan(SHOP_REQUESTS_PER_MINUTE);
  });

  it('pauza, pri ktorej by sa limit shopu prekročil, sa nedá nakonfigurovať', () => {
    const tooFast = Math.ceil(60_000 / SHOP_REQUESTS_PER_MINUTE) - 1; // 199 ms
    expect(problemsFor({ ORDERS_PAUSE_MS: String(tooFast) }).join('\n')).toContain(
      'ORDERS_PAUSE_MS',
    );
    expect(problemsFor({ ORDERS_PAUSE_MS: '100' }).join('\n')).toContain('ORDERS_PAUSE_MS');
  });
});
