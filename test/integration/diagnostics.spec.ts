/**
 * Aura Zľavy — diagnostika (návrh V3 #diagnostika, odpoveď 83; INVARIANT I1).
 *
 * Súbor diagnostiky odchádza z počítača — je to presne ten druh cesty, ktorou
 * tajomstvá unikajú. Tento test je tretia poistka z troch (whitelist →
 * `redact()` → test) a testuje dve veci, ktoré sa nesmú pokaziť:
 *
 *  1. **Tvar je pripnutý.** Kľúče výstupu musia byť PRESNE
 *     `DIAGNOSTICS_FIELDS`. Kto pridá pole, musí sa priznať aj v teste — nedá
 *     sa to prejsť tichým commitom, čo je celý zmysel tejto kontroly.
 *  2. **Otrávený zdroj neprejde.** Kľúč vo VOĽNOM TEXTE zachytí `redact()`;
 *     dlhý neprehľadný blok obmedzí strop `MAX_FREE_TEXT`. Test netvrdí, že
 *     redakcia pozná každé tajomstvo — pre polia z dôveryhodného zdroja
 *     (`SELECT VERSION()`) je zárukou whitelist a ten strop, nie redakcia.
 *
 * Plus vlastnosť, na ktorej stojí použiteľnosť: diagnostika musí vzniknúť aj
 * vtedy, keď je polovica appky mimo. Nástroj na riešenie poruchy, ktorý pri
 * poruche spadne, je na nič.
 */
import { describe, expect, it } from 'vitest';

import {
  collectDiagnostics,
  diagnosticsFileName,
  DIAGNOSTICS_FIELDS,
  MAX_FREE_TEXT,
  VYNECHANE,
  type DiagnosticsDeps,
} from '@/lib/diagnostics/collect';

const NOW = new Date('2026-08-11T09:40:00.000Z');

function deps(overrides: Partial<DiagnosticsDeps> = {}): DiagnosticsDeps {
  return {
    now: () => NOW,
    nodeVersion: 'v22.14.0',
    dbVersion: async () => '11.4.5-MariaDB',
    migrations: async () => ({
      pocet: 12,
      rozsah: '0001–0012',
      checksumyOk: true,
      nesuhlasia: [],
    }),
    queue: async () => ({
      bezi: true,
      spracovane: 3420,
      zlyhane: 12,
      poslednyTick: '2026-08-11T09:00:00.000Z',
      pocetTikov: 812,
      poslednaChyba: null,
    }),
    writeOutcomes: async () => ({
      write_ok: 3408,
      write_failed: 12,
      write_skipped: 40,
      write_uncertain: 0,
    }),
    ...overrides,
  };
}

describe('diagnostika — tvar súboru', () => {
  it('má presne polia z DIAGNOSTICS_FIELDS a ani jedno navyše', async () => {
    const file = await collectDiagnostics(deps());
    expect(Object.keys(file).sort()).toEqual([...DIAGNOSTICS_FIELDS].sort());
  });

  it('nesie čísla zo zdrojov a vymenúva, čo je vynechané', async () => {
    const file = await collectDiagnostics(deps());
    expect(file.migracie.rozsah).toBe('0001–0012');
    expect(file.migracie.checksumyOk).toBe(true);
    expect(file.fronta?.spracovane).toBe(3420);
    expect(file.vysledkyZapisu.write_ok).toBe(3408);
    expect(file.vynechane).toEqual(VYNECHANE);
    // „bez tiel odpovedí" musí byť v súbore napísané, nie len v komentári.
    expect(file.vysledkyZapisu.poznamka).toContain('bez tiel odpovedí');
  });

  it('deň v názve súboru počíta v Bratislave, nie v UTC', () => {
    // 22:30 UTC je v Bratislave už 12. 8. — v UTC by názov nesol 11. 8.
    const lateEvening = new Date('2026-08-11T22:30:00.000Z');
    expect(diagnosticsFileName(lateEvening)).toBe('aura-zlavy-diagnostika-2026-08-12.json');
    expect(diagnosticsFileName(NOW)).toBe('aura-zlavy-diagnostika-2026-08-11.json');
  });
});

describe('diagnostika — I1, tajomstvá', () => {
  // Atrapa ZÁMERNE nemá tvar kľúča žiadneho reálneho poskytovateľa:
  // predtým tu bol reťazec tvaru Stripe kľúča a ochrana GitHubu push
  // odmietla. Na redakciu stačí, že je to dlhý token vo voľnom texte.
  const SECRET = 'ATRAPA-NIE-JE-KLUC-0123456789abcdef0123456789';

  it('kľúč z otrávenej chybovej hlášky sa do súboru nedostane', async () => {
    const file = await collectDiagnostics(
      deps({
        queue: async () => ({
          bezi: false,
          spracovane: null,
          zlyhane: null,
          poslednyTick: null,
          pocetTikov: 0,
          poslednaChyba: `shop odmietol kľúč Authorization: Bearer ${SECRET}`,
        }),
      }),
    );
    expect(JSON.stringify(file)).not.toContain(SECRET);
  });

  it('voľný text má strop na dĺžku — dlhý blok neodíde celý', async () => {
    // Čo `redact()` nedokáže, obmedzuje strop: pole s dôveryhodným zdrojom
    // (`SELECT VERSION()`) môže odniesť najviac `MAX_FREE_TEXT` znakov.
    const blob = `${'x'.repeat(400)}${SECRET}`;
    const file = await collectDiagnostics(deps({ dbVersion: async () => blob }));

    expect(file.verzia.databaza).toHaveLength(MAX_FREE_TEXT + 1); // +1 = „…"
    expect(JSON.stringify(file)).not.toContain(SECRET);
  });

  it('bežná verzia databázy sa neskracuje', async () => {
    const file = await collectDiagnostics(deps({ dbVersion: async () => '11.4.5-MariaDB' }));
    expect(file.verzia.databaza).toBe('11.4.5-MariaDB');
  });
});

describe('diagnostika — vzniká aj pri poruche', () => {
  it('padnutý zdroj neposkodí súbor, chýbajúce sa prizná', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('databáza neodpovedá');
    };
    const file = await collectDiagnostics(
      deps({ dbVersion: boom, migrations: boom, queue: boom, writeOutcomes: boom }),
    );

    expect(Object.keys(file).sort()).toEqual([...DIAGNOSTICS_FIELDS].sort());
    // Neznáme sa nedopĺňa domnelou hodnotou a checksumy sú fail-closed.
    expect(file.verzia.databaza).toBeNull();
    expect(file.fronta).toBeNull();
    expect(file.migracie.checksumyOk).toBe(false);
    expect(file.migracie.nesuhlasia.join(' ')).toContain('nepodarilo prečítať');
  });
});
