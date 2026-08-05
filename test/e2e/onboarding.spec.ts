/**
 * Aura Zľavy — e2e: onboarding od nuly po testovací dry-run (A18, D20, D55).
 *
 * Onboarding sa NIKDY nekončí ostrým zápisom (D20, I3): posledný krok je
 * dry-run a tento test to overuje aj na strane mocku — počet zápisových
 * požiadaviek sa počas 4. kroku NESMIE zmeniť.
 */
import { addAllowlist, api, expect, login, test, VALID_API_KEY } from './fixtures';
import { E2E_CONFIG } from './config';

const FIRST_PRODUCT = 201;

test.describe('onboarding', () => {
  test.beforeEach(async ({ db }) => {
    // Onboarding začína od nuly — doména ešte nie je potvrdená.
    await db.query(
      'UPDATE settings SET shop_domain = NULL, shop_domain_confirmed_at = NULL WHERE id = 1',
    );
  });

  test('4 kroky v pevnom poradí: kroky sa odomykajú postupne', async ({ page }) => {
    await login(page);
    await page.goto('/onboarding');
    await expect(page.getByTestId('onboarding')).toBeVisible();

    // Krok 1 čaká, kroky 2–4 sú zamknuté, kým doména nie je potvrdená.
    await expect(page.getByTestId('step-1-state')).toHaveText('čaká');
    await expect(page.getByTestId('step-2-state')).toHaveText('zamknuté');
    await expect(page.getByTestId('step-3-state')).toHaveText('zamknuté');
    await expect(page.getByTestId('step-4-state')).toHaveText('zamknuté');
    await expect(page.getByTestId('onboarding-step-2')).toContainText('Najprv potvrď doménu');
  });

  test('D55: doména sa bez úspešného canary čítania NEULOŽÍ', async ({ page, db }) => {
    await login(page);
    await page.goto('/onboarding');

    // Doména musí byť https (D80) a canary GET ide proti KANDIDÁTSKEJ doméne,
    // nie cez mock override — na `.invalid` host sa spojenie nedá vytvoriť (I6),
    // takže canary zlyhá a doména sa fail-closed neuloží.
    await page.getByTestId('domain-input').fill(E2E_CONFIG.shopDomain);
    await page.getByTestId('domain-password').fill(E2E_CONFIG.adminPassword);
    await page.getByTestId('domain-save').click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('domain-canary')).toBeHidden();
    const rows = await db.query<{ shop_domain: string | null }>(
      'SELECT shop_domain FROM settings WHERE id = 1',
    );
    expect(rows[0].shop_domain).toBeNull();
  });

  test('kľúč → allowlist → testovací dry-run bez jediného ostrého zápisu', async ({
    page,
    db,
    control,
  }) => {
    // Doména je potvrdená (jej vlastný canary má vlastný test vyššie).
    await db.query(
      'UPDATE settings SET shop_domain = ?, shop_domain_confirmed_at = UTC_TIMESTAMP(3) WHERE id = 1',
      [E2E_CONFIG.shopDomain],
    );

    await login(page);
    await page.goto('/onboarding');
    await expect(page.getByTestId('step-1-state')).toHaveText('hotové');

    /* Krok 2 — kľúč (syntetický `fake-shop-key-…`, I1). Appka ho overí sondou
     * proti mocku; do UI sa vracia výhradne `last4` (D65, I1). */
    await page.getByTestId('api-key-input').fill(VALID_API_KEY);
    await page.getByTestId('api-key-save').click();
    await expect(page.getByTestId('api-key-stored')).toBeVisible();
    await expect(page.getByTestId('api-key-stored')).not.toContainText(VALID_API_KEY);
    await expect(page.getByTestId('step-2-state')).toHaveText('hotové');

    /* Krok 3 — allowlist (max 10, I2). */
    await page.getByTestId('add-product-id').fill(String(FIRST_PRODUCT));
    await page.getByTestId('add-product-submit').click();
    await expect(page.getByTestId('allowlist-table')).toContainText(String(FIRST_PRODUCT));
    await expect(page.getByTestId('step-3-state')).toHaveText('hotové');

    /* Krok 4 — testovací dry-run. Do shopu sa NESMIE zapísať nič (D20, I3). */
    const before = await control.state();
    await page.getByTestId(`onboarding-product-${FIRST_PRODUCT}`).check();
    await page.getByTestId('percent-chip-10').click();
    await page.getByTestId('onboarding-dry-run').click();

    await expect(page.getByTestId('onboarding-dry-run-result')).toBeVisible();
    await expect(page.getByTestId('onboarding-done')).toBeVisible();
    await expect(page.getByTestId('dry-run-table')).toBeVisible();
    await expect(page.getByTestId('step-4-state')).toHaveText('hotové');

    const after = await control.state();
    expect(after.writeCount).toBe(before.writeCount);

    // I1 — kľúč sa nikde v UI nezobrazí, ani v celom HTML stránky.
    expect(await page.content()).not.toContain(VALID_API_KEY);
  });

  test('I2: 11. produkt sa do allowlistu nedostane', async ({ page }) => {
    await login(page);
    // 10 produktov cez API (mock katalóg má 201–210).
    await addAllowlist(page, [201, 202, 203, 204, 205, 206, 207, 208, 209, 210]);

    await page.goto('/produkty');
    await expect(page.getByTestId('allowlist-table')).toBeVisible();
    await expect(page.getByTestId('allowlist-full-notice')).toBeVisible();

    const res = await api(page, 'POST', '/api/allowlist', { productId: 123 });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
