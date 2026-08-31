/**
 * Aura Zľavy — CUDZÍ ORIGIN NESMIE POHNÚŤ ZÁMKOM (D72, mutačné doloženie K7).
 *
 * ČO TENTO SÚBOR EXISTUJE ZATVORIŤ
 * --------------------------------
 * `origin-check-po-loginu.spec.ts` má pri cudzom aj chýbajúcom `Origin` tri
 * tvrdenia v tomto poradí: stavový kód, kód chyby, a až potom to podstatné —
 * `stillLocked() === true` a prázdny audit. Poradie nie je kozmetika: keď sa
 * 31. 8. 2026 mutačne odstránilo volanie `checkOrigin()` z `defineRoute()`,
 * oba testy sčervenali na PRVOM tvrdení (`expected 200 to be 403`) a k
 * tvrdeniu o zámku sa beh vôbec nedostal. Zelená brána teda o zámku nepovedala
 * nič — hoci práve on je to, čo D72 chráni: stavový kód môže byť správny aj
 * vtedy, keď sa zápis medzitým stal (a naopak, 403 sa dá vyrobiť aj bez toho,
 * aby brána naozaj stála pred mutáciou).
 *
 * Tento súbor meria VÝHRADNE ten posledný krok, a to ako PRVÉ tvrdenie:
 *
 *   1. po cudzom `Origin` zámok DRŽÍ a audit je prázdny,
 *   2. po chýbajúcom `Origin` zámok DRŽÍ a audit je prázdny,
 *   3. kontrola samotného meradla: pri VLASTNOM origine sa zámok naozaj
 *      otvorí — inak by prvé dve tvrdenia prešli aj vtedy, keby route
 *      neodomykala vôbec nikdy.
 *
 * Stavový kód sa tu netvrdí zámerne. Jeho kontrolu má
 * `origin-check-po-loginu.spec.ts` (a `define-route.spec.ts` celú tabuľku
 * `metóda × origin`); keby tu stál znova, sčervenal by prvý a zakryl by presne
 * to jedno tvrdenie, pre ktoré tento súbor vznikol.
 *
 * Doložené mutačne 31. 8. 2026: po odstránení volania `checkOrigin()` zo
 * `src/lib/http/define-route.ts` červenajú tvrdenia 1 a 2 na zámku a na audite.
 *
 * Bez databázy a bez siete — settings repo je v pamäti, shop sa nevolá.
 *
 * Vlastník: V4 (mutačné overenie K7).
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

describe('D72 — po cudzom origine sa zámok zápisov NEPOHOL', () => {
  it('cudzí Origin: zámok DRŽÍ a audit je prázdny (bez tvrdenia o stave)', async () => {
    const w = world();
    await w.route(
      makeRequest('POST', PATH, { confirmed: true }, { origin: 'https://zlodej.example' }),
    );

    // Prvé tvrdenie súboru je to jediné, o ktoré tu ide.
    expect(await w.stillLocked()).toBe(true);
    expect(w.audit).toHaveLength(0);
  });

  it('chýbajúci Origin: zámok DRŽÍ a audit je prázdny (bez tvrdenia o stave)', async () => {
    const w = world();
    await w.route(makeRequest('POST', PATH, { confirmed: true }, { origin: null }));

    expect(await w.stillLocked()).toBe(true);
    expect(w.audit).toHaveLength(0);
  });

  it('meradlo funguje: pri vlastnom origine sa zámok naozaj OTVORÍ', async () => {
    const w = world();
    await w.route(makeRequest('POST', PATH, { confirmed: true }, { origin: APP_ORIGIN }));

    // Bez tohto tvrdenia by prvé dva testy prešli aj nad route, ktorá
    // neodomyká nikdy — a nemerali by teda bránu, ale mŕtvy kód.
    expect(await w.stillLocked()).toBe(false);
    expect(w.audit).toHaveLength(1);
  });
});
