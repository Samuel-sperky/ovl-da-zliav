/**
 * Aura Zľavy — `GET /api/auth/bootstrap` na skutočnom route handleri.
 *
 * Route existuje kvôli jedinému stavu: po čerstvej inštalácii je `users=0`
 * a `/login` musí povedať, že sa prihlásiť NEDÁ a čo treba spustiť. Keďže
 * v tom stave neexistuje session, route je `auth: 'none'` — a preto sa tu
 * overuje zvonku, že neprezradí NIČ nad rámec jedného booleanu (I1).
 */
import { describe, expect, it } from 'vitest';

import { createBootstrapRoute } from '@/app/api/auth/bootstrap/route';
import { resetRateLimiter } from '@/lib/http/define-route';

import { makeRequest, parse } from './routes-harness';

/** Návnada: repo, ktoré by prezradilo údaje účtu, keby ho route čítal. */
const HOSTILE_USERNAME = 'samuel-fake-admin';
const HOSTILE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZS1zYWx0$ZmFrZS1oYXNo';

function route(count: number | (() => Promise<number>)) {
  resetRateLimiter();
  return createBootstrapRoute({
    users: {
      countUsers: typeof count === 'function' ? count : async () => count,
      // Zámerne navyše — route sa k tomu nesmie dostať.
      ...({ getByUsername: async () => ({ username: HOSTILE_USERNAME, passwordHash: HOSTILE_HASH }) } as object),
    },
  });
}

const call = async (handler: ReturnType<typeof createBootstrapRoute>) =>
  parse(await handler(makeRequest('GET', '/api/auth/bootstrap')));

describe('GET /api/auth/bootstrap', () => {
  it('users=0 → needsAdmin:true (prvý beh, treba spustiť seed-admin)', async () => {
    const res = await call(route(0));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual({ needsAdmin: true });
  });

  it('users=1 → needsAdmin:false (bežný prihlasovací formulár)', async () => {
    const res = await call(route(1));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ needsAdmin: false });
  });

  it('funguje bez session — inak by ho prvý beh vôbec nedosiahol', async () => {
    // `createBootstrapRoute()` bez `routeDeps` = žiadny session stub; keby bol
    // route `auth:'session'`, skončil by na 401 a `/login` by nič nezistil.
    const res = await call(route(0));
    expect(res.status).toBe(200);
  });

  it('DB dole → fail-closed needsAdmin:false, nikdy 500', async () => {
    const res = await call(
      route(async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:3306 (test_app_password)');
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ needsAdmin: false });
  });

  it('odpoveď neobsahuje NIČ o účtoch — len jediný boolean (I1)', async () => {
    for (const count of [0, 3]) {
      const res = await call(route(count));
      expect(Object.keys(res.body.data as object)).toEqual(['needsAdmin']);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(HOSTILE_USERNAME);
      expect(raw).not.toContain('argon2');
      expect(raw.toLowerCase()).not.toContain('password');
      expect(raw.toLowerCase()).not.toContain('username');
      // Ani počet účtov sa nevracia — príznak áno, číslo nie.
      expect(raw).not.toContain('count');
      expect(raw).not.toContain('"3"');
    }
  });
});
