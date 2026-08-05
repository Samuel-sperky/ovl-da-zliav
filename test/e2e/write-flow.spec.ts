/**
 * Aura Zľavy — e2e: celý zápisový flow (A18, D2, D22, D30, D70, I3, I13).
 *
 * Overuje POVINNÝ dvojkrok (dry-run → samostatné potvrdenie), sudo re-auth po
 * vypršaní 15-minútového okna a fail-closed odmietnutie zápisu bez potvrdenia.
 *
 * POZOR — I13/I6: e2e appka beží mimo `NODE_ENV=production` (v produkcii je
 * `SHOP_BASE_URL_OVERRIDE` zakázaný a e2e by muselo volať reálny shop, čo I6
 * nedovoľuje). Ostrý zápis je preto vynútene odmietnutý; test akceptuje OBE
 * korektné vyústenia — vytvorenú kampaň alebo hlášku „ostrý zápis je vypnutý" —
 * a v druhom prípade DODATOČNE overí, že mock nedostal ani jeden zápis.
 */
import { addAllowlist, api, expect, login, storeApiKey, test } from './fixtures';
import { E2E_CONFIG } from './config';

const PRODUCTS = [201, 202] as const;

/** `YYYY-MM-DD` v posune dní od dneška (rovnaká konvencia ako UI). */
function dateOnly(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Krok 1 sprievodcu: produkty, percento, okno → „Pokračovať na dry-run". */
async function fillStep1(
  page: import('@playwright/test').Page,
  opts: { productIds: readonly number[]; percent: 5 | 10 | 15 | 20 | 25 | 30; from: string; to: string },
): Promise<void> {
  await expect(page.getByTestId('wizard-step1')).toBeVisible();
  for (const id of opts.productIds) await page.getByTestId(`product-${id}`).check();
  await page.getByTestId(`percent-chip-${opts.percent}`).click();
  await page.getByTestId('date-from').fill(opts.from);
  await page.getByTestId('date-to').fill(opts.to);
  await page.getByRole('button', { name: /Pokračovať na dry-run/ }).click();
}

test.describe('zápisový flow', () => {
  test('dvojkrok + sudo re-auth: bez potvrdenia sa na shop nepošle žiadny zápis', async ({
    page,
    control,
  }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, PRODUCTS);

    // Hodiny v prehliadači riadime sami — sudo okno (D70) vypršiava klientsky.
    await page.clock.install();
    await page.goto('/kampane/nova');

    await fillStep1(page, {
      productIds: PRODUCTS,
      percent: 10,
      from: dateOnly(1),
      to: dateOnly(8),
    });

    /* Krok 2 — dry-run náhľad a POTOM samostatné potvrdenie (D2, I3). */
    await expect(page.getByTestId('wizard-step2')).toBeVisible();
    await expect(page.getByTestId('dry-run-table')).toBeVisible();
    await expect(page.getByTestId('confirm-panel')).toBeVisible();
    await expect(page.getByTestId('irreversible-note')).toContainText('nedá zrušiť, len prepísať');

    // Do tejto chvíle NESMIE existovať žiadny zápis nad rámec sondy kľúča.
    const beforeConfirm = await control.state();

    /* D70 — po 20 minútach nečinnosti si potvrdenie vyžiada heslo znova. */
    await page.clock.fastForward('20:00');
    await page.getByTestId('write-to-production').click();

    const sudoDialog = page.getByRole('dialog', { name: 'Overenie heslom' });
    await expect(sudoDialog).toBeVisible();
    await sudoDialog.getByPlaceholder('Heslo').fill(E2E_CONFIG.adminPassword);
    await sudoDialog.getByRole('button', { name: 'Potvrdiť' }).click();
    await expect(sudoDialog).toBeHidden();

    /* Vyústenie: kampaň vytvorená, alebo fail-closed odmietnutie zápisu (I13). */
    const created = page.getByTestId('wizard-result');
    const refused = page.getByText(/Ostrý zápis je vypnutý|WRITES_ENABLED/);
    await expect(created.or(refused).first()).toBeVisible();

    if (await refused.isVisible()) {
      const afterConfirm = await control.state();
      expect(afterConfirm.writeCount).toBe(beforeConfirm.writeCount);
    } else {
      await expect(created).toContainText('Kampaň');
    }

    // I1 — v žiadnom vyústení sa kľúč neobjaví v HTML.
    expect(await page.content()).not.toContain('fake-shop-key');
  });

  test('D30: jednodňová zľava sa nepotvrdí bez explicitného „naozaj 1 deň"', async ({ page }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, [PRODUCTS[0]]);

    await page.goto('/kampane/nova');
    const day = dateOnly(2);
    await fillStep1(page, { productIds: [PRODUCTS[0]], percent: 15, from: day, to: day });

    await expect(page.getByTestId('confirm-panel')).toBeVisible();
    await expect(page.getByTestId('one-day-ack')).toBeVisible();
    await expect(page.getByTestId('write-to-production')).toBeDisabled();

    await page.getByTestId('one-day-ack').getByRole('checkbox').check();
    await expect(page.getByTestId('write-to-production')).toBeEnabled();
  });

  test('I3: POST /api/campaigns bez preview tokenu neposlal na shop nič', async ({
    page,
    control,
  }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, [PRODUCTS[0]]);
    const before = await control.state();

    const res = await api(page, 'POST', '/api/campaigns', {
      previewToken: 'nie-je-podpisany-token',
      name: 'Pokus bez dry-runu',
      mode: 'eager',
      acknowledgements: { irreversible: true },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);

    const after = await control.state();
    expect(after.writeCount).toBe(before.writeCount);
  });

  test('I2: produkt mimo allowlistu sa odmietne pred volaním shopu', async ({ page, control }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, [PRODUCTS[0]]);
    const before = await control.state();

    const res = await api(page, 'POST', '/api/campaigns/preview', {
      productIds: [PRODUCTS[0], 999_999],
      percent: 10,
      from: dateOnly(1),
      to: dateOnly(3),
      kind: 'new',
    });
    const body = await res.text();
    // Buď 4xx, alebo preview s blokátorom — v oboch prípadoch žiadny zápis.
    if (res.ok()) expect(body).toMatch(/blocker|allowlist/i);
    else expect(res.status()).toBeGreaterThanOrEqual(400);

    const after = await control.state();
    expect(after.writeCount).toBe(before.writeCount);
  });
});
