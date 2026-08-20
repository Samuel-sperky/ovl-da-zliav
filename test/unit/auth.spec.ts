/**
 * Aura Zľavy — testy autentifikačnej vrstvy (A4).
 *
 * Pokrývajú akceptačné kritériá A4:
 *  - heslo pod 12 znakov je odmietnuté a argon2id hash sa verifikuje (D68),
 *  - session exspiruje absolútne po 8 h aj po 30 min nečinnosti a idle sa
 *    obnovuje pri každom požiadaní (D69),
 *  - cookie má všetky tri atribúty `httpOnly` / `Secure` / `SameSite=Strict`
 *    (D69, D72),
 *  - `sudo.ts` vracia „vyžaduje heslo", keď je posledná autentifikácia starším
 *    než 15 minút (D70, I3),
 *  - lockout **prežije restart procesu** (stav výhradne v `login_attempts`,
 *    KONTRAKT O4) a exponenciálne predlžuje blokádu (D71),
 *  - každý pokus — úspešný aj neúspešný — generuje audit event (D71),
 *  - heslo sa NIKDY nedostane do auditu (I1).
 *
 * Bez DB a bez `fetch` (I6): repozitáre bežia proti falošnému `Queryable`,
 * ktorý rozumie SQL-u z `login-attempts.repo.ts` — testuje sa teda aj skutočná
 * SQL cesta, nie len atrapa repozitára.
 *
 * Integračný test lockoutu proti skutočnej MariaDB patrí do `test/integration/**`,
 * ktoré A4 nevlastní (viď finálna odpoveď A4).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { AuditInput, Queryable, SessionClaims, UserRecord } from '@/contracts';
import { createPreviewTokenService } from '@/lib/crypto/preview-token';

import {
  ARGON2_PARAMS,
  MIN_PASSWORD_LENGTH,
  PasswordError,
  checkPasswordPolicy,
  hashPassword,
  isArgon2idHash,
  needsRehash,
  resetDummyHashCache,
  verifyPassword,
  type Argon2Params,
} from '@/lib/auth/password';
import {
  SESSION_COOKIE_NAME,
  SessionError,
  clearedSessionCookie,
  createSessionService,
  readSessionCookie,
  serializeSessionCookie,
} from '@/lib/auth/session';
import {
  SUDO_REQUIRED_CODE,
  SudoRequiredError,
  checkSudo,
  createSudoService,
  requireSudo,
  sudoSecondsLeft,
} from '@/lib/auth/sudo';
import {
  DEFAULT_LOCKOUT_POLICY,
  evaluateLockout,
  lockoutMinutesForLevel,
  type LockoutPolicy,
} from '@/lib/auth/lockout-policy';
import { LockoutError, createLockoutService } from '@/lib/auth/lockout';
import { createLoginService } from '@/lib/auth/login';
import { createLoginAttemptsRepo } from '@/lib/repo/login-attempts.repo';
import { createUsersRepo } from '@/lib/repo/users.repo';

/* ══════════════════════════════ pomôcky ═══════════════════════════════════ */

/** Rýchle argon2id parametre — produkčné (19 MiB, t=2) sú pre testy zbytočne drahé. */
const TEST_PARAMS: Argon2Params = { memoryCost: 2048, timeCost: 1, parallelism: 1 };

const SECRET = Buffer.alloc(32, 0x5a);

/** Posúvateľné hodiny. */
function clock(startIso: string) {
  let current = new Date(startIso).getTime();
  return {
    now: (): Date => new Date(current),
    advanceMinutes(minutes: number): void {
      current += minutes * 60_000;
    },
    advanceSeconds(seconds: number): void {
      current += seconds * 1000;
    },
  };
}

/** Falošný `login_attempts` — „DB", ktorá prežije „restart" repozitára (O4). */
interface StoredAttempt {
  id: number;
  username: string;
  ip: string;
  success: number;
  ts: Date;
}

class FakeAttemptsStore implements Queryable {
  rows: StoredAttempt[] = [];
  private nextId = 1;

  constructor(private readonly now: () => Date) {}

  async query<T = unknown>(sql: string, values?: unknown): Promise<T> {
    const params = (Array.isArray(values) ? values : []) as unknown[];

    if (sql.startsWith('INSERT INTO login_attempts')) {
      this.rows.push({
        id: this.nextId++,
        username: String(params[0] ?? ''),
        ip: String(params[1] ?? ''),
        success: Number(params[2] ?? 0),
        ts: this.now(),
      });
      return { affectedRows: 1 } as T;
    }

    if (sql.includes('FROM login_attempts') && sql.includes('WHERE ip = ?')) {
      return this.select((row) => row.ip === String(params[0]), Number(params[1])) as T;
    }

    if (sql.includes('FROM login_attempts') && sql.includes('WHERE username = ?')) {
      return this.select((row) => row.username === String(params[0]), Number(params[1])) as T;
    }

    if (sql.startsWith('DELETE FROM login_attempts')) {
      const threshold = params[0] as Date;
      const before = this.rows.length;
      this.rows = this.rows.filter((row) => row.ts.getTime() >= threshold.getTime());
      return { affectedRows: before - this.rows.length } as T;
    }

    throw new Error(`FakeAttemptsStore: neočekávaný SQL: ${sql}`);
  }

  private select(predicate: (row: StoredAttempt) => boolean, limit: number): StoredAttempt[] {
    return this.rows
      .filter(predicate)
      .sort((a, b) => b.ts.getTime() - a.ts.getTime() || b.id - a.id)
      .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
  }
}

/** Falošný `users` — rozumie SQL-u z `users.repo.ts`. */
class FakeUsersStore implements Queryable {
  rows: Array<{
    id: number;
    username: string;
    password_hash: string;
    created_at: Date;
    updated_at: Date;
    last_login_at: Date | null;
  }> = [];
  private nextId = 1;
  touchedIds: number[] = [];

  constructor(private readonly now: () => Date) {}

  add(username: string, passwordHash: string): number {
    const id = this.nextId++;
    this.rows.push({
      id,
      username,
      password_hash: passwordHash,
      created_at: this.now(),
      updated_at: this.now(),
      last_login_at: null,
    });
    return id;
  }

  async query<T = unknown>(sql: string, values?: unknown): Promise<T> {
    const params = (Array.isArray(values) ? values : []) as unknown[];

    if (sql.includes('FROM users WHERE username = ?')) {
      return this.rows.filter((row) => row.username === String(params[0])) as T;
    }
    if (sql.includes('FROM users WHERE id = ?')) {
      return this.rows.filter((row) => row.id === Number(params[0])) as T;
    }
    if (sql.startsWith('INSERT INTO users')) {
      const existing = this.rows.find((row) => row.username === String(params[0]));
      if (existing) existing.password_hash = String(params[1]);
      else this.add(String(params[0]), String(params[1]));
      return { affectedRows: 1 } as T;
    }
    if (sql.startsWith('UPDATE users SET last_login_at')) {
      this.touchedIds.push(Number(params[0]));
      const row = this.rows.find((r) => r.id === Number(params[0]));
      if (row) row.last_login_at = this.now();
      return { affectedRows: row ? 1 : 0 } as T;
    }
    if (sql.startsWith('UPDATE users SET password_hash')) {
      const row = this.rows.find((r) => r.id === Number(params[1]));
      if (row) row.password_hash = String(params[0]);
      return { affectedRows: row ? 1 : 0 } as T;
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM users')) {
      return [{ total: this.rows.length }] as T;
    }
    throw new Error(`FakeUsersStore: neočekávaný SQL: ${sql}`);
  }
}

/** Zberač auditu — nahrádza `appendAudit()` z A2. */
function auditCollector() {
  const entries: AuditInput[] = [];
  return {
    entries,
    write: async (input: AuditInput): Promise<void> => {
      entries.push(input);
    },
    types: (): string[] => entries.map((entry) => entry.eventType),
    serialized: (): string => JSON.stringify(entries),
  };
}

/* ══════════════════════════ 1. heslá (D68) ════════════════════════════════ */

describe('password.ts — argon2id, min 12 znakov (D68)', () => {
  beforeEach(() => {
    resetDummyHashCache();
  });

  it('odmietne heslo pod 12 znakov a nevynucuje zložitosť', () => {
    expect(checkPasswordPolicy('krátke').ok).toBe(false);
    expect(checkPasswordPolicy('a'.repeat(MIN_PASSWORD_LENGTH - 1)).ok).toBe(false);
    // Presne 12 znakov bez veľkých písmen, číslic a znakov je LEGITÍMNE heslo (D68).
    expect(checkPasswordPolicy('a'.repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
    expect(checkPasswordPolicy('a'.repeat(201)).ok).toBe(false);
    expect(checkPasswordPolicy(12345678901234).ok).toBe(false);
  });

  it('hashPassword() hodí PasswordError pri krátkom hesle', async () => {
    await expect(hashPassword('krátke', TEST_PARAMS)).rejects.toBeInstanceOf(PasswordError);
    await expect(hashPassword('krátke', TEST_PARAMS)).rejects.toMatchObject({ code: 'too_short' });
  });

  it('vytvorí argon2id hash a verifikuje ho', async () => {
    const hash = await hashPassword('spravne-heslo-12', TEST_PARAMS);
    expect(isArgon2idHash(hash)).toBe(true);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('spravne-heslo-12');

    await expect(verifyPassword(hash, 'spravne-heslo-12', TEST_PARAMS)).resolves.toBe(true);
    await expect(verifyPassword(hash, 'nespravne-heslo-1', TEST_PARAMS)).resolves.toBe(false);
  });

  it('fail-closed: neexistujúci user, poškodený hash a heslo mimo politiky sú vždy false', async () => {
    const hash = await hashPassword('spravne-heslo-12', TEST_PARAMS);
    await expect(verifyPassword(null, 'spravne-heslo-12', TEST_PARAMS)).resolves.toBe(false);
    await expect(verifyPassword('', 'spravne-heslo-12', TEST_PARAMS)).resolves.toBe(false);
    await expect(verifyPassword('$2y$10$nieArgon2', 'spravne-heslo-12', TEST_PARAMS)).resolves.toBe(
      false,
    );
    await expect(verifyPassword(hash, 'krátke', TEST_PARAMS)).resolves.toBe(false);
    await expect(verifyPassword(hash, undefined, TEST_PARAMS)).resolves.toBe(false);
  });

  it('needsRehash() označí cudzí a slabší hash', async () => {
    const weak = await hashPassword('spravne-heslo-12', TEST_PARAMS);
    expect(needsRehash(weak, ARGON2_PARAMS)).toBe(true);
    expect(needsRehash(weak, TEST_PARAMS)).toBe(false);
    expect(needsRehash('$2y$10$nieArgon2')).toBe(true);
  });
});

/* ═══════════════════════ 2. session (D69, D72) ════════════════════════════ */

const SESSION_CONFIG = { absoluteHours: 8, idleMinutes: 30, sudoWindowMinutes: 15 };

describe('session.ts — 8 h absolútne + 30 min idle, cookie atribúty (D69, D72)', () => {
  it('cookie má httpOnly, Secure aj SameSite=Strict a správne meno (R10)', async () => {
    const time = clock('2026-08-05T10:00:00.000Z');
    const service = createSessionService({ secret: SECRET, config: SESSION_CONFIG, now: time.now });
    const issued = await service.issue({ userId: 1, username: 'samuel' });

    expect(issued.cookie.name).toBe('ovl_zliav_session');
    expect(SESSION_COOKIE_NAME).toBe('ovl_zliav_session');
    expect(issued.cookie.options.httpOnly).toBe(true);
    expect(issued.cookie.options.secure).toBe(true);
    expect(issued.cookie.options.sameSite).toBe('strict');
    expect(issued.cookie.options.path).toBe('/');
    // Max-Age = idle okno (30 min), nie absolútna platnosť.
    expect(issued.cookie.options.maxAge).toBe(30 * 60);

    const header = serializeSessionCookie(issued.cookie);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Strict');

    const cleared = clearedSessionCookie();
    expect(cleared.value).toBe('');
    expect(cleared.options.maxAge).toBe(0);
  });

  it('vyparsuje token z hlavičky Cookie a inak vracia null', async () => {
    expect(readSessionCookie(null)).toBeNull();
    expect(readSessionCookie('other=1; ovl_zliav_session=abc.def.ghi; x=2')).toBe('abc.def.ghi');
    expect(readSessionCookie('ovl_zliav_session=')).toBeNull();
    expect(readSessionCookie('iny_cookie=hodnota')).toBeNull();
  });

  it('exspiruje po 30 min nečinnosti', async () => {
    const time = clock('2026-08-05T10:00:00.000Z');
    const service = createSessionService({ secret: SECRET, config: SESSION_CONFIG, now: time.now });
    const issued = await service.issue({ userId: 7, username: 'samuel' });

    time.advanceMinutes(29);
    const claims = await service.verify(issued.token);
    expect(claims.sub).toBe(7);
    expect(claims.username).toBe('samuel');

    time.advanceMinutes(2); // 31 min bez aktivity
    await expect(service.verify(issued.token)).rejects.toBeInstanceOf(SessionError);
    await expect(service.verify(issued.token)).rejects.toMatchObject({ code: 'idle_expired' });
  });

  it('idle sa obnovuje pri každom požiadaní, absolútna platnosť 8 h nie', async () => {
    const time = clock('2026-08-05T10:00:00.000Z');
    const service = createSessionService({ secret: SECRET, config: SESSION_CONFIG, now: time.now });
    let current = await service.issue({ userId: 7, username: 'samuel' });
    const absolute = current.claims.absoluteExpiresAt.getTime();

    // 15 „požiadaní" po 25 minútach = 6 h 15 min aktivity — session žije.
    for (let i = 0; i < 15; i += 1) {
      time.advanceMinutes(25);
      const result = await service.verifyAndRefresh(current.token);
      current = result.refreshed;
      // Absolútny konec sa NIKDY neposúva (D69).
      expect(current.claims.absoluteExpiresAt.getTime()).toBe(absolute);
      expect(current.claims.idleExpiresAt.getTime()).toBeLessThanOrEqual(absolute);
    }

    // Posun za 8 h od prihlásenia — ďalšie požiadanie už neprejde.
    time.advanceMinutes(120);
    expect(time.now().getTime()).toBeGreaterThan(absolute);
    await expect(service.verify(current.token)).rejects.toBeInstanceOf(SessionError);
    const error: unknown = await service.verify(current.token).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SessionError);
    expect(['absolute_expired', 'idle_expired']).toContain((error as SessionError).code);
  });

  it('idle okno sa nikdy nenatiahne za absolútny konec', async () => {
    const time = clock('2026-08-05T10:00:00.000Z');
    const service = createSessionService({ secret: SECRET, config: SESSION_CONFIG, now: time.now });
    // Session, ktorej absolútny konec je už len 10 minút daleko (ako po 7 h 50 min
    // aktivity): idle okno sa MUSÍ skrátiť na 10 minút, nie natiahnuť na 30.
    const nearEnd = await service.issue({
      userId: 1,
      username: 'samuel',
      absoluteExpiresAt: new Date(time.now().getTime() + 10 * 60_000),
    });
    expect(nearEnd.claims.idleExpiresAt.getTime()).toBe(
      nearEnd.claims.absoluteExpiresAt.getTime(),
    );
    expect(nearEnd.cookie.options.maxAge).toBe(10 * 60);

    // A ani refresh tesne pred koncom ho nepredĺži.
    time.advanceMinutes(9);
    const refreshed = await service.refresh(await service.verify(nearEnd.token));
    expect(refreshed.claims.absoluteExpiresAt.getTime()).toBe(
      nearEnd.claims.absoluteExpiresAt.getTime(),
    );
    expect(refreshed.cookie.options.maxAge).toBe(60);
  });

  it('odmietne pozmenený token, cudzí secret aj preview token (O2)', async () => {
    const time = clock('2026-08-05T10:00:00.000Z');
    const service = createSessionService({ secret: SECRET, config: SESSION_CONFIG, now: time.now });
    const issued = await service.issue({ userId: 1, username: 'samuel' });

    await expect(service.verify(`${issued.token}x`)).rejects.toMatchObject({ code: 'invalid' });
    await expect(service.verify(null)).rejects.toMatchObject({ code: 'missing' });
    await expect(service.verify('')).rejects.toMatchObject({ code: 'missing' });

    const foreign = createSessionService({
      secret: Buffer.alloc(32, 0x01),
      config: SESSION_CONFIG,
      now: time.now,
    });
    await expect(service.verify((await foreign.issue({ userId: 1, username: 'samuel' })).token))
      .rejects.toMatchObject({ code: 'invalid' });

    // Preview token je podpísaný TÝM ISTÝM secretom (§7) — ako session ho
    // odmietne odlišné `aud` (`ovl-zliav:preview` vs `ovl-zliav:session`).
    const preview = createPreviewTokenService({ secret: SECRET, now: time.now });
    const { token: previewToken } = await preview.issue({
      sub: 1,
      kind: 'new',
      productIds: [1, 2],
      percent: 10,
      from: '2026-08-06',
      to: '2026-08-20',
      pricesAtPreview: { '1': '19.99', '2': '29.99' },
    });
    await expect(service.verify(previewToken)).rejects.toMatchObject({ code: 'invalid' });
  });
});

/* ═══════════════════════════ 3. sudo (D70, I3) ════════════════════════════ */

describe('sudo.ts — 15 min okno, fail-closed (D70, I3)', () => {
  const time = clock('2026-08-05T10:00:00.000Z');

  const claimsWith = (sudoUntil: Date | null, absolutePlusHours = 8): SessionClaims => ({
    sub: 1,
    username: 'samuel',
    absoluteExpiresAt: new Date(time.now().getTime() + absolutePlusHours * 3_600_000),
    idleExpiresAt: new Date(time.now().getTime() + 30 * 60_000),
    sudoUntil,
  });

  it('vyžaduje heslo, keď je posledná autentifikácia starším než 15 minút', async () => {
    const t = clock('2026-08-05T10:00:00.000Z');
    const service = createSessionService({ secret: SECRET, config: SESSION_CONFIG, now: t.now });
    const issued = await service.issue({ userId: 1, username: 'samuel' });

    // Hneď po prihlásení je sudo okno otvorené (D70).
    expect(checkSudo(issued.claims, t.now(), 15).valid).toBe(true);
    expect(sudoSecondsLeft(issued.claims, t.now(), 15)).toBe(15 * 60);

    t.advanceMinutes(14);
    const stillValid = await service.verifyAndRefresh(issued.token);
    expect(checkSudo(stillValid.claims, t.now(), 15).valid).toBe(true);

    // 16 minút od poslednej autentifikácie → „vyžaduje heslo".
    t.advanceMinutes(2);
    const afterWindow = await service.verifyAndRefresh(stillValid.refreshed.token);
    expect(checkSudo(afterWindow.claims, t.now(), 15).valid).toBe(false);
    expect(afterWindow.claims.sudoUntil).toBeNull();
    expect(sudoSecondsLeft(afterWindow.claims, t.now(), 15)).toBe(0);
    expect(() => requireSudo(afterWindow.claims, t.now(), 15)).toThrow(SudoRequiredError);
    try {
      requireSudo(afterWindow.claims, t.now(), 15);
    } catch (error) {
      expect((error as SudoRequiredError).code).toBe(SUDO_REQUIRED_CODE);
    }
  });

  it('pri pochybnosti vždy „nie": bez session, bez okna, s prehnaným oknom', () => {
    expect(checkSudo(null, time.now(), 15)).toEqual({ valid: false, sudoUntil: null });
    expect(checkSudo(undefined, time.now(), 15).valid).toBe(false);
    expect(checkSudo(claimsWith(null), time.now(), 15).valid).toBe(false);
    // uplynulé okno
    expect(
      checkSudo(claimsWith(new Date(time.now().getTime() - 1000)), time.now(), 15).valid,
    ).toBe(false);
    // okno dlhšie než 15 min = pozmenený/chybný token
    expect(
      checkSudo(claimsWith(new Date(time.now().getTime() + 60 * 60_000)), time.now(), 15).valid,
    ).toBe(false);
    // okno za absolútnym koncom session
    const claims = claimsWith(new Date(time.now().getTime() + 10 * 60_000), 0.05);
    expect(checkSudo(claims, time.now(), 15).valid).toBe(false);
    // neplatný Date
    expect(checkSudo(claimsWith(new Date('x')), time.now(), 15).valid).toBe(false);
  });

  it('grantSudo() overí heslo, otvorí nové okno a zapíše audit sudo_ok/sudo_fail', async () => {
    const t = clock('2026-08-05T10:00:00.000Z');
    const audit = auditCollector();
    const usersStore = new FakeUsersStore(t.now);
    const hash = await hashPassword('spravne-heslo-12', TEST_PARAMS);
    const userId = usersStore.add('samuel', hash);

    const attempts = new FakeAttemptsStore(t.now);
    const attemptsRepo = createLoginAttemptsRepo({ defaultConn: attempts, now: t.now });
    const lockout = createLockoutService({
      repo: attemptsRepo,
      audit: audit.write,
      policy: DEFAULT_LOCKOUT_POLICY,
    });
    const sessionService = createSessionService({
      secret: SECRET,
      config: SESSION_CONFIG,
      now: t.now,
    });
    const sudo = createSudoService({
      users: createUsersRepo({ defaultConn: usersStore }),
      lockout,
      session: sessionService,
      verify: (h, p) => verifyPassword(h, p, TEST_PARAMS),
      now: t.now,
      windowMinutes: 15,
    });

    const issued = await sessionService.issue({ userId, username: 'samuel' });
    t.advanceMinutes(30); // sudo okno dávno zatvorené

    const bad = await sudo.grant({
      claims: { ...issued.claims, sudoUntil: null },
      password: 'zle-heslo-1234',
      ip: '127.0.0.1',
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('invalid_password');
    expect(audit.types()).toContain('sudo_fail');

    const good = await sudo.grant({
      claims: { ...issued.claims, sudoUntil: null },
      password: 'spravne-heslo-12',
      ip: '127.0.0.1',
    });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(checkSudo(good.session.claims, t.now(), 15).valid).toBe(true);
      expect(good.sudoUntil.getTime()).toBe(t.now().getTime() + 15 * 60_000);
      // Absolútny konec session sa sudo potvrdením NEPREDLŽUJE (D69).
      expect(good.session.claims.absoluteExpiresAt.getTime()).toBe(
        issued.claims.absoluteExpiresAt.getTime(),
      );
    }
    expect(audit.types()).toContain('sudo_ok');
    // I1 — heslo sa do auditu nikdy nedostane.
    expect(audit.serialized()).not.toContain('spravne-heslo-12');
    expect(audit.serialized()).not.toContain('zle-heslo-1234');
  });
});

/* ═══════════════════ 4. lockout (D71, O4) — politika ══════════════════════ */

describe('lockout-policy.ts — 5 pokusov / 15 min + exponenciálne (D71)', () => {
  const policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY;
  const base = new Date('2026-08-05T10:00:00.000Z');
  const fails = (count: number, everyMinutes = 1) =>
    Array.from({ length: count }, (_, index) => ({
      success: false,
      ts: new Date(base.getTime() - index * everyMinutes * 60_000),
    }));

  it('pod hranicou nezamkne, na hranici zamkne na 15 minút', () => {
    const four = evaluateLockout(fails(4), base, policy);
    expect(four.locked).toBe(false);
    expect(four.failedAttempts).toBe(4);
    expect(four.remainingAttempts).toBe(1);

    const five = evaluateLockout(fails(5), base, policy);
    expect(five.locked).toBe(true);
    expect(five.level).toBe(1);
    expect(five.until?.getTime()).toBe(base.getTime() + 15 * 60_000);
    expect(five.retryAfterSeconds).toBe(15 * 60);
  });

  it('blokáda po 15 minútach uplynie', () => {
    const later = new Date(base.getTime() + 16 * 60_000);
    const state = evaluateLockout(fails(5), later, policy);
    expect(state.locked).toBe(false);
    expect(state.until).toBeNull();
    expect(state.failedAttempts).toBe(5);
  });

  it('exponenciálne predlžuje: 15 → 30 → 60 → 120 min, so stropom', () => {
    expect(lockoutMinutesForLevel(1, policy)).toBe(15);
    expect(lockoutMinutesForLevel(2, policy)).toBe(30);
    expect(lockoutMinutesForLevel(3, policy)).toBe(60);
    expect(lockoutMinutesForLevel(4, policy)).toBe(120);
    expect(lockoutMinutesForLevel(30, policy)).toBe(policy.maxLockMinutes);

    expect(evaluateLockout(fails(10), base, policy).until?.getTime()).toBe(
      base.getTime() + 30 * 60_000,
    );
    expect(evaluateLockout(fails(15), base, policy).until?.getTime()).toBe(
      base.getTime() + 60 * 60_000,
    );
  });

  it('úspešné prihlásenie vynuluje sériu a decay zabudne staré neúspechy', () => {
    const withSuccess = [
      ...fails(3),
      { success: true, ts: new Date(base.getTime() - 10 * 60_000) },
      ...fails(9, 1).map((row) => ({ ...row, ts: new Date(row.ts.getTime() - 60 * 60_000) })),
    ];
    const state = evaluateLockout(withSuccess, base, policy);
    expect(state.failedAttempts).toBe(3);
    expect(state.locked).toBe(false);

    const old = Array.from({ length: 8 }, () => ({
      success: false,
      ts: new Date(base.getTime() - 48 * 3_600_000),
    }));
    expect(evaluateLockout(old, base, policy).failedAttempts).toBe(0);
  });
});

/* ═══════════ 5. lockout — stav v DB, prežije restart (O4, D71) ════════════ */

describe('lockout.ts + login-attempts.repo.ts — stav v DB prežije restart (O4)', () => {
  it('5 zlyhaní → 6. pokus zamietnutý, a to aj po „reštarte" modulu', async () => {
    const t = clock('2026-08-05T10:00:00.000Z');
    const store = new FakeAttemptsStore(t.now);
    const audit = auditCollector();

    const service = createLockoutService({
      repo: createLoginAttemptsRepo({ defaultConn: store, now: t.now }),
      audit: audit.write,
      policy: DEFAULT_LOCKOUT_POLICY,
    });

    for (let i = 0; i < 5; i += 1) {
      await service.assertAllowed({ username: 'samuel', ip: '10.0.0.9' });
      await service.recordFailure({ username: 'samuel', ip: '10.0.0.9' });
      t.advanceSeconds(5);
    }
    expect(store.rows).toHaveLength(5);

    // 6. pokus v tom istom procese.
    await expect(
      service.assertAllowed({ username: 'samuel', ip: '10.0.0.9' }),
    ).rejects.toBeInstanceOf(LockoutError);

    // „Restart": nové instancie repozitára aj služby, ŽIADNY stav v pamäti (O4).
    const afterRestart = createLockoutService({
      repo: createLoginAttemptsRepo({ defaultConn: store, now: t.now }),
      audit: audit.write,
      policy: DEFAULT_LOCKOUT_POLICY,
    });
    const error: unknown = await afterRestart
      .assertAllowed({ username: 'samuel', ip: '10.0.0.9' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LockoutError);
    expect((error as LockoutError).code).toBe('too_many_attempts');
    expect((error as LockoutError).retryAfterSeconds).toBeGreaterThan(0);

    // Po uplynutí blokády sa dá skúsiť znova…
    t.advanceMinutes(16);
    await expect(
      afterRestart.assertAllowed({ username: 'samuel', ip: '10.0.0.9' }),
    ).resolves.toMatchObject({ locked: false });

    // …ale jediný ďalší neúspech zamkne znova (séria sa nevynulovala).
    await afterRestart.recordFailure({ username: 'samuel', ip: '10.0.0.9' });
    await expect(
      afterRestart.assertAllowed({ username: 'samuel', ip: '10.0.0.9' }),
    ).rejects.toBeInstanceOf(LockoutError);

    // Iná IP blokovaná nie je (D71 je per IP), lebo meno má vlastnú sériu → tá je
    // prísnejšia a blokuje aj tam. Overíme, že fail-closed smer platí.
    await expect(
      afterRestart.assertAllowed({ username: 'niekto-iny', ip: '10.0.0.10' }),
    ).resolves.toMatchObject({ locked: false });
  });

  it('každý pokus je v audite: login_fail, lockout aj login_ok (D71)', async () => {
    const t = clock('2026-08-05T10:00:00.000Z');
    const store = new FakeAttemptsStore(t.now);
    const audit = auditCollector();
    const service = createLockoutService({
      repo: createLoginAttemptsRepo({ defaultConn: store, now: t.now }),
      audit: audit.write,
      policy: DEFAULT_LOCKOUT_POLICY,
    });

    for (let i = 0; i < 5; i += 1) {
      await service.recordFailure({ username: 'samuel', ip: '10.0.0.9' });
      t.advanceSeconds(1);
    }
    expect(audit.types().filter((type) => type === 'login_fail')).toHaveLength(5);
    // 5. neúspech aktivoval blokádu → samostatný event.
    expect(audit.types().filter((type) => type === 'lockout')).toHaveLength(1);

    // Odmietnutý pokus počas blokády je tiež v audite.
    await service.assertAllowed({ username: 'samuel', ip: '10.0.0.9' }).catch(() => undefined);
    expect(audit.types().filter((type) => type === 'lockout')).toHaveLength(2);

    t.advanceMinutes(16);
    await service.recordSuccess({ username: 'samuel', ip: '10.0.0.9', userId: 1 });
    expect(audit.types()).toContain('login_ok');
    // Úspech vynuluje sériu.
    await expect(
      service.assertAllowed({ username: 'samuel', ip: '10.0.0.9' }),
    ).resolves.toMatchObject({ failedAttempts: 0, locked: false });
  });

  it('fail-closed: keď sa stav lockoutu nedá zistiť, pokus sa odmietne', async () => {
    const audit = auditCollector();
    const service = createLockoutService({
      repo: {
        record: async () => undefined,
        evaluate: async () => {
          throw new Error('DB je mimo');
        },
        getState: async () => {
          throw new Error('DB je mimo');
        },
      },
      audit: audit.write,
      policy: DEFAULT_LOCKOUT_POLICY,
    });

    await expect(
      service.assertAllowed({ username: 'samuel', ip: '10.0.0.9' }),
    ).rejects.toBeInstanceOf(LockoutError);
  });
});

/* ══════════════════ 6. login (D68–D71) — celý tok ═════════════════════════ */

describe('login.ts — poradie lockout → heslo → audit → session', () => {
  let t: ReturnType<typeof clock>;
  let attempts: FakeAttemptsStore;
  let usersStore: FakeUsersStore;
  let audit: ReturnType<typeof auditCollector>;
  let userId: number;

  const build = () => {
    const sessionService = createSessionService({
      secret: SECRET,
      config: SESSION_CONFIG,
      now: t.now,
    });
    const lockout = createLockoutService({
      repo: createLoginAttemptsRepo({ defaultConn: attempts, now: t.now }),
      audit: audit.write,
      policy: DEFAULT_LOCKOUT_POLICY,
    });
    const users = createUsersRepo({ defaultConn: usersStore });
    return {
      sessionService,
      service: createLoginService({
        users,
        lockout,
        session: sessionService,
        verify: (h, p) => verifyPassword(h, p, TEST_PARAMS),
        audit: audit.write,
      }),
    };
  };

  beforeEach(async () => {
    t = clock('2026-08-05T10:00:00.000Z');
    attempts = new FakeAttemptsStore(t.now);
    usersStore = new FakeUsersStore(t.now);
    audit = auditCollector();
    userId = usersStore.add('samuel', await hashPassword('spravne-heslo-12', TEST_PARAMS));
  });

  it('úspešné prihlásenie vydá session s otvoreným sudo oknom a zapíše audit', async () => {
    const { service } = build();
    const result = await service.login({
      username: 'samuel',
      password: 'spravne-heslo-12',
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user).toEqual({ id: userId, username: 'samuel' });
    expect(result.session.cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(result.session.cookie.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });
    // Prihlásenie JE autentifikácia → sudo okno je otvorené (D70).
    expect(checkSudo(result.claims, t.now(), 15).valid).toBe(true);
    expect(result.claims.absoluteExpiresAt.getTime()).toBe(t.now().getTime() + 8 * 3_600_000);
    expect(result.claims.idleExpiresAt.getTime()).toBe(t.now().getTime() + 30 * 60_000);

    expect(audit.types()).toContain('login_ok');
    expect(usersStore.touchedIds).toContain(userId);
    expect(attempts.rows.at(-1)?.success).toBe(1);
    // I1 — heslo nikde v audite.
    expect(audit.serialized()).not.toContain('spravne-heslo-12');
  });

  it('zlé heslo a neznáme meno majú rovnakú hlášku (bez enumerácie) a sú v audite', async () => {
    const { service } = build();

    const wrongPassword = await service.login({
      username: 'samuel',
      password: 'zle-heslo-1234',
      ip: '127.0.0.1',
    });
    const unknownUser = await service.login({
      username: 'niekto-iny',
      password: 'spravne-heslo-12',
      ip: '127.0.0.1',
    });

    expect(wrongPassword.ok).toBe(false);
    expect(unknownUser.ok).toBe(false);
    if (wrongPassword.ok || unknownUser.ok) return;
    expect(wrongPassword.code).toBe('invalid_credentials');
    expect(unknownUser.code).toBe('invalid_credentials');
    expect(wrongPassword.message).toBe(unknownUser.message);

    expect(audit.types().filter((type) => type === 'login_fail')).toHaveLength(2);
    expect(audit.serialized()).not.toContain('zle-heslo-1234');
    expect(audit.serialized()).not.toContain('spravne-heslo-12');
  });

  it('heslo pod 12 znakov je odmietnuté a berie sa ako neúspešný pokus (D68, D71)', async () => {
    const { service } = build();
    const result = await service.login({
      username: 'samuel',
      password: 'krátke',
      ip: '127.0.0.1',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_credentials');
    expect(attempts.rows).toHaveLength(1);
    expect(attempts.rows[0].success).toBe(0);
    expect(audit.types()).toContain('login_fail');
  });

  it('po 5 zlyhaniach vráti locked_out s Retry-After a nepustí ani správne heslo', async () => {
    const { service } = build();
    for (let i = 0; i < 5; i += 1) {
      await service.login({ username: 'samuel', password: 'zle-heslo-1234', ip: '127.0.0.1' });
      t.advanceSeconds(2);
    }

    const blocked = await service.login({
      username: 'samuel',
      password: 'spravne-heslo-12',
      ip: '127.0.0.1',
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe('locked_out');
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(audit.types()).toContain('lockout');

    // Blokáda prežije „restart" — nová instancia služby nad tou istou „DB" (O4).
    const restarted = build().service;
    const stillBlocked = await restarted.login({
      username: 'samuel',
      password: 'spravne-heslo-12',
      ip: '127.0.0.1',
    });
    expect(stillBlocked.ok).toBe(false);
    if (!stillBlocked.ok) expect(stillBlocked.code).toBe('locked_out');

    // Po uplynutí blokády správne heslo prejde.
    t.advanceMinutes(16);
    const after = await restarted.login({
      username: 'samuel',
      password: 'spravne-heslo-12',
      ip: '127.0.0.1',
    });
    expect(after.ok).toBe(true);
  });

  it('logout zapíše audit a vráti cookie, ktorá session ruší', async () => {
    const { service, sessionService } = build();
    const issued = await sessionService.issue({ userId, username: 'samuel' });
    const { cookie } = await service.logout({ claims: issued.claims, ip: '127.0.0.1' });

    expect(cookie.value).toBe('');
    expect(cookie.options.maxAge).toBe(0);
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.secure).toBe(true);
    expect(cookie.options.sameSite).toBe('strict');
    expect(audit.types()).toContain('logout');
  });
});

/* ═══════════════════════ 7. users.repo (D68, I1) ══════════════════════════ */

describe('users.repo.ts — mapovanie a ochrana hashu (D68, I1)', () => {
  it('načíta usera podľa mena aj ID a odmietne iný než argon2id hash', async () => {
    const t = clock('2026-08-05T10:00:00.000Z');
    const store = new FakeUsersStore(t.now);
    const repo = createUsersRepo({ defaultConn: store });
    const hash = await hashPassword('spravne-heslo-12', TEST_PARAMS);

    const created = await repo.upsertAdmin('samuel', hash);
    expect(created.username).toBe('samuel');
    expect(created.passwordHash).toBe(hash);
    expect(created.lastLoginAt).toBeNull();

    const byName = (await repo.getByUsername('samuel')) as UserRecord;
    expect(byName.id).toBe(created.id);
    expect((await repo.getById(created.id))?.username).toBe('samuel');
    expect(await repo.getByUsername('neexistuje')).toBeNull();
    expect(await repo.getByUsername('x'.repeat(65))).toBeNull();
    expect(await repo.getById(0)).toBeNull();
    expect(await repo.countUsers()).toBe(1);

    await expect(repo.upsertAdmin('samuel', '$2y$10$bcrypt')).rejects.toThrow(/argon2id/);
    await expect(repo.upsertAdmin('ab', hash)).rejects.toThrow(/znakov/);
  });
});
