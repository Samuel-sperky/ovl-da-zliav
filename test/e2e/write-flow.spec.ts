/**
 * Aura Zľavy — e2e: I3 a D30 cez skutočný HTTP stack (A18, D2, D30, I3, I13).
 *
 * ZMENA V3 (V11): štvorkrokový sprievodca `/kampane/nova` (`wizard-step1`,
 * `percent-chip-*`) zanikol. Nová zľava je jedna obrazovka `/zlavy/nova`
 * a jej preklikanie — vrátane povinnej skúšky naprázdno a ručne vpísaného
 * počtu — dokazuje `fronta-v3.spec.ts` (cesta z K12).
 *
 * Tomuto súboru zostáva to, čo sa cez UI ukázať NEDÁ, lebo obrazovka to ani
 * neponúkne: čo urobí SERVER, keď potvrdenie chýba alebo je neúplné. Sú to
 * tvrdenia o invariantoch, nie o rozložení tlačidiel, a preto sa robia
 * priamo na API — cez tú istú appku, tie isté guardy a ten istý mock shop.
 *
 *  1. **I3** — `POST /api/campaigns` bez preview tokenu je 4xx a na shop
 *     neodíde ani jeden zápis.
 *  2. **I3** — token je jednorazový: druhé použitie toho istého tokenu je 409
 *     a opäť bez jediného zápisu.
 *  3. **D30** — jednodňová zľava (`from = to`) bez potvrdenia „naozaj 1 deň?"
 *     je 4xx a token sa pri tom NESPÁLI (chýbajúce potvrdenie nie je dôvod
 *     nútiť používateľa opakovať skúšku).
 *
 * POZOR — I13/I6: e2e appka beží mimo `NODE_ENV=production` (v produkcii je
 * `SHOP_BASE_URL_OVERRIDE` zakázaný a e2e by muselo volať reálny shop, čo I6
 * nedovoľuje). Ostrý zápis je preto vynútene odmietnutý; testy nižšie o zápise
 * nič netvrdia — tvrdia, že sa NEDEJE.
 */
import { addAllowlist, api, expect, storeApiKey, test } from './fixtures';

const PRODUCT = 201;

/** `YYYY-MM-DD` v posune dní od dneška (rovnaká konvencia ako UI). */
function dateOnly(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Dry-run nad jedným produktom → jednorazový podpísaný token (O2, I3). */
async function previewToken(
  page: import('@playwright/test').Page,
  window: { from: string; to: string },
): Promise<string> {
  const res = await api(page, 'POST', '/api/campaigns/preview', {
    productIds: [PRODUCT],
    percent: 10,
    from: window.from,
    to: window.to,
    kind: 'new',
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { data: { previewToken: string; blockers: unknown[] } };
  expect(body.data.blockers, JSON.stringify(body.data.blockers)).toEqual([]);
  expect(body.data.previewToken).not.toBe('');
  return body.data.previewToken;
}

test.describe('zápisový flow', () => {
  test('I3: bez potvrdenia sa na shop nepošle žiadny zápis', async ({ page, control }) => {
    await storeApiKey(page);
    await addAllowlist(page, [PRODUCT]);
    const before = await control.state();

    /* 1. Úplne bez tokenu. */
    const noToken = await api(page, 'POST', '/api/campaigns', {
      name: 'Bez potvrdenia',
      mode: 'eager',
      acknowledgements: { irreversible: true },
    });
    expect(noToken.status()).toBeGreaterThanOrEqual(400);
    expect(noToken.status()).toBeLessThan(500);

    /* 2. S podvrhnutým tokenom. */
    const fakeToken = await api(page, 'POST', '/api/campaigns', {
      previewToken: 'nie.je.token',
      name: 'Podvrhnuté potvrdenie',
      mode: 'eager',
      acknowledgements: { irreversible: true },
    });
    expect(fakeToken.status()).toBeGreaterThanOrEqual(400);
    expect(fakeToken.status()).toBeLessThan(500);

    /* 3. Ani jeden pokus sa nesmel dotknúť shopu. */
    expect((await control.state()).writeCount).toBe(before.writeCount);
  });

  test('I3: preview token je jednorazový — druhé použitie je 409', async ({ page, control }) => {
    await storeApiKey(page);
    await addAllowlist(page, [PRODUCT]);
    const before = await control.state();

    const token = await previewToken(page, { from: dateOnly(2), to: dateOnly(9) });
    const first = await api(page, 'POST', '/api/campaigns', {
      previewToken: token,
      name: 'Prvé použitie',
      // `scheduled` — appka má len naplánovať; ostrý zápis je v e2e vypnutý (I13).
      mode: 'scheduled',
      acknowledgements: { irreversible: true },
    });
    expect(first.status(), await first.text()).toBe(200);

    const replay = await api(page, 'POST', '/api/campaigns', {
      previewToken: token,
      name: 'Druhé použitie toho istého potvrdenia',
      mode: 'scheduled',
      acknowledgements: { irreversible: true },
    });
    expect(replay.status()).toBe(409);

    // Naplánovanie nie je zápis — na shop stále neodišlo nič.
    expect((await control.state()).writeCount).toBe(before.writeCount);
  });

  test('D30: jednodňová zľava sa nepotvrdí bez explicitného „naozaj 1 deň"', async ({
    page,
    control,
  }) => {
    await storeApiKey(page);
    await addAllowlist(page, [PRODUCT]);
    const before = await control.state();

    const day = dateOnly(3);
    const token = await previewToken(page, { from: day, to: day });

    const withoutAck = await api(page, 'POST', '/api/campaigns', {
      previewToken: token,
      name: 'Jednodňová bez potvrdenia',
      mode: 'scheduled',
      acknowledgements: { irreversible: true },
    });
    expect(withoutAck.status()).toBe(400);
    expect(await withoutAck.text()).toContain('one_day_not_acknowledged');

    /* D30 — chýbajúce potvrdenie NESMIE spáliť token: ten istý token
     * s doplneným „naozaj 1 deň?" musí prejsť. */
    const withAck = await api(page, 'POST', '/api/campaigns', {
      previewToken: token,
      name: 'Jednodňová s potvrdením',
      mode: 'scheduled',
      acknowledgements: { irreversible: true, oneDay: true },
    });
    expect(withAck.status(), await withAck.text()).toBe(200);

    expect((await control.state()).writeCount).toBe(before.writeCount);
  });
});
