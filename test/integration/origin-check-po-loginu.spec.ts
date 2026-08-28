/**
 * Aura Zľavy — PO ZRUŠENÍ PRIHLÁSENIA JE ORIGIN CHECK POSLEDNÁ OBRANA.
 *
 * ČO TENTO SÚBOR EXISTUJE ZATVORIŤ
 * --------------------------------
 * 27. 8. 2026 sa z appky vymazalo prihlásenie: Caddy basic auth (D98), session
 * a heslá (D99), sudo (D100). Rozbor v KONTRAKT-BEZ-LOGINU-2026-08-27.md §2
 * tvrdí, že sa tým NEOTVORILA CSRF diera, pretože obranu drží D72 — origin
 * check v `defineRoute()`, ktorý beží nezávisle od auth vrstvy.
 *
 * To tvrdenie musí byť MERANÉ, nie odôvodnené. Kým existovala session cookie,
 * mala appka dve nezávislé prekážky pred cudzím zápisom; teraz má jednu. Keby
 * niekto origin check oslabil (pridal allowlist z ENV, porovnával len doménu
 * bez portu, alebo ho posunul až za handler), appka by o tom nepovedala nič —
 * a stránka otvorená v tom istom prehliadači by vedela zapísať do produkčného
 * eshopu.
 *
 * PREČO NAD SKUTOČNOU RÚTOU. `define-route.spec.ts` má tabuľku `metóda ×
 * origin` nad syntetickým handlerom, ktorý vracia `{hello}`. Tá dokazuje
 * pipeline. Tu sa berie `POST /api/settings/unlock-writes` — reálna mutácia,
 * ktorá povoľuje zápisy do ostrého eshopu — a meria sa NIE stavový kód, ale
 * ŽE SA NIČ NEZMENILO. Stavový kód môže byť správny aj vtedy, keď sa zápis
 * medzitým stal.
 *
 * Súčasne tu stojí druhá polovica I3 po zrušení sudo (D100): odomknutie ďalej
 * NEIDE bez výslovného potvrdenia.
 */
import { describe, expect, it } from 'vitest';

import type { AuditInput } from '@/contracts';

import { createUnlockWritesRoute } from '@/app/api/settings/unlock-writes/route';
import { createMemorySettingsRepo } from '@/lib/engine/testing';

import { APP_ORIGIN, actorRouteDeps, makeRequest } from './routes-harness';

const PATH = '/api/settings/unlock-writes';

interface World {
  route: ReturnType<typeof createUnlockWritesRoute>;
  /** `true` = zámok ešte drží, čiže sa NIČ neodomklo. */
  stillLocked: () => Promise<boolean>;
  audit: AuditInput[];
}

function world(): World {
  const memory = createMemorySettingsRepo({ writesLocked: true, writesLockedReason: 'runaway' });
  const audit: AuditInput[] = [];
  return {
    route: createUnlockWritesRoute({
      settings: { get: memory.get, unlockWrites: memory.unlockWrites },
      audit: async (input) => {
        audit.push(input);
      },
      writesEnabled: () => true,
      routeDeps: actorRouteDeps(),
    }),
    stillLocked: async () => (await memory.get()).writesLocked === true,
    audit,
  };
}

async function bodyOf(response: Response): Promise<{ ok: boolean; error?: { code: string } }> {
  return (await response.json()) as { ok: boolean; error?: { code: string } };
}

describe('origin check drží aj bez prihlásenia (D72, D98–D100)', () => {
  it('cudzí Origin: 403, zámok DRŽÍ a audit je prázdny', async () => {
    const w = world();
    const response = await w.route(
      makeRequest('POST', PATH, { confirmed: true }, { origin: 'https://zlodej.example' }),
    );

    expect(response.status).toBe(403);
    expect((await bodyOf(response)).error?.code).toBe('origin_mismatch');
    // TOTO je to podstatné tvrdenie — nie stavový kód, ale že sa nič nestalo.
    expect(await w.stillLocked()).toBe(true);
    expect(w.audit).toHaveLength(0);
  });

  it('chýbajúci Origin: 403, zámok DRŽÍ a audit je prázdny', async () => {
    const w = world();
    const response = await w.route(makeRequest('POST', PATH, { confirmed: true }, { origin: null }));

    expect(response.status).toBe(403);
    expect((await bodyOf(response)).error?.code).toBe('origin_missing');
    expect(await w.stillLocked()).toBe(true);
    expect(w.audit).toHaveLength(0);
  });

  /*
   * ZAZNAMENANÁ HRANICA, NIE POŽADOVANÉ SPRÁVANIE.
   *
   * `checkOrigin()` porovnáva HOST (vrátane portu), nie celý origin — schéma
   * sa do porovnania nedostane. `http://app.local` a `https://app.local` teda
   * prejdú ako to isté. Test to fixuje, aby sa vedelo, že to tak JE; nie preto,
   * že by to tak malo byť.
   *
   * Prečo sa to 27. 8. 2026 nezmenilo spolu so zrušením prihlásenia: porovnanie
   * schémy by muselo brať `X-Forwarded-Proto` od Caddy (appka vnútri vidí
   * http:// bez ohľadu na to, čím prišiel prehliadač). To je zmena
   * bezpečnostného správania závislá od konfigurácie proxy a patrí jej vlastné
   * rozhodnutie, nie prílepok k šprintu o loginu.
   *
   * Prečo to zatiaľ nie je zneužiteľné: útočník by musel obsluhovať TLS na
   * `localhost:3070`, a na tom porte počúva výhradne náš Caddy po http (I5).
   */
  it('rovnaký host, iná schéma PREJDE — porovnáva sa host, nie celý origin', async () => {
    const w = world();
    const sameHostOtherScheme = APP_ORIGIN.replace('https://', 'http://');
    const response = await w.route(
      makeRequest('POST', PATH, { confirmed: true }, { origin: sameHostOtherScheme }),
    );

    expect(response.status).toBe(200);
    expect(await w.stillLocked()).toBe(false);
  });

  it('vlastný Origin prejde a zámok sa otvorí', async () => {
    const w = world();
    const response = await w.route(makeRequest('POST', PATH, { confirmed: true }));

    expect(response.status).toBe(200);
    expect(await w.stillLocked()).toBe(false);
    expect(w.audit).toHaveLength(1);
    expect(w.audit[0]!.eventType).toBe('writes_unlocked');
  });
});

describe('I3 po zrušení sudo: odomknutie chce POTVRDENIE, nie heslo (D100)', () => {
  it('bez `confirmed` je to 400 a zámok DRŽÍ', async () => {
    const w = world();
    const response = await w.route(makeRequest('POST', PATH, {}));

    expect(response.status).toBe(400);
    expect(await w.stillLocked()).toBe(true);
    expect(w.audit).toHaveLength(0);
  });

  /*
   * `confirmed: false` je nebezpečnejší prípad než chýbajúce pole: takto by
   * vyzeralo telo z formulára s nezaškrtnutým políčkom. Schéma je
   * `z.literal(true)` práve preto, aby `false` skončilo 400 a nie odomknutím.
   */
  it('`confirmed: false` je 400 a zámok DRŽÍ', async () => {
    const w = world();
    const response = await w.route(makeRequest('POST', PATH, { confirmed: false }));

    expect(response.status).toBe(400);
    expect(await w.stillLocked()).toBe(true);
    expect(w.audit).toHaveLength(0);
  });

  /*
   * Heslo z tela sa IGNORUJE, nie akceptuje. Keby ho niekto poslal (starý
   * klient, uložený request), nesmie to byť náhrada za `confirmed`.
   */
  it('heslo v tele NEZASTUPUJE potvrdenie — 400 a zámok DRŽÍ', async () => {
    const w = world();
    const response = await w.route(
      makeRequest('POST', PATH, { password: 'akekolvek-heslo-z-minulosti' }),
    );

    expect(response.status).toBe(400);
    expect(await w.stillLocked()).toBe(true);
    expect(w.audit).toHaveLength(0);
  });
});
