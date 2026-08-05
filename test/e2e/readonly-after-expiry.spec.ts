/**
 * Aura Zľavy — e2e: read-only režim po expirácii kľúča (A18, R2, D10, D21, D63).
 *
 * Po expirácii TTL (max 48 h) sa kľúč lazy wipne, appka NEBLOKUJE čítanie,
 * ale zapisovacie akcie sú fail-closed a v hlavičke visí výzva na nový kľúč.
 * Nový kľúč režim zruší.
 */
import { addAllowlist, api, expect, login, storeApiKey, test } from './fixtures';

const PRODUCTS = [201, 202] as const;

test.describe('read-only po expirácii kľúča', () => {
  test('expirovaný kľúč: čítanie funguje, zápis nie, výzva na nový kľúč visí', async ({
    page,
    db,
  }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, PRODUCTS);

    // Kľúč platí — výzva nie je.
    await page.goto('/');
    await expect(page.getByTestId('readonly-notice')).toBeHidden();
    await expect(page.getByTestId('key-ttl-badge')).toHaveAttribute('data-state', /ok|warning|critical/);

    /* Posun expirácie do minulosti = to isté, čo urobí čas (R2). */
    await db.expireApiKey();

    await page.goto('/');
    await expect(page.getByTestId('readonly-notice')).toBeVisible();
    await expect(page.getByTestId('readonly-notice')).toContainText('len na čítanie');
    await expect(page.getByTestId('key-ttl-badge')).toHaveAttribute('data-state', 'missing');

    // D63 — expirovaný kľúč sa wipne, v DB po ňom nezostane riadok.
    expect(await db.keyRowCount()).toBe(0);

    /* Čítanie NIE JE zablokované (D10). */
    await page.goto('/produkty');
    await expect(page.getByTestId('allowlist-table')).toBeVisible();
    await page.goto('/audit');
    await expect(page.getByTestId('audit-table')).toBeVisible();
    await page.goto('/kampane');
    await expect(page.getByTestId('campaign-list')).toBeVisible();

    /* Zápis je fail-closed — kampaň sa bez kľúča nezapíše. */
    const res = await api(page, 'POST', '/api/campaigns/preview', {
      productIds: [PRODUCTS[0]],
      percent: 10,
      from: new Date().toISOString().slice(0, 10),
      to: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      kind: 'new',
    });
    const text = await res.text();
    if (res.ok()) expect(text).toMatch(/kľúč|key/i);
    else expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('nový kľúč zruší read-only režim', async ({ page, db }) => {
    await login(page);
    await storeApiKey(page);
    await db.expireApiKey();

    await page.goto('/nastavenia');
    await expect(page.getByTestId('api-key-missing')).toBeVisible();

    await storeApiKey(page);
    await page.goto('/');
    await expect(page.getByTestId('readonly-notice')).toBeHidden();
  });

  test('D21: naplánovaná kampaň bez kľúča neskončí ako `failed`', async ({ page, db }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, [PRODUCTS[0]]);

    const campaignId = await db.seedCampaign({
      name: 'Kampaň čakajúca na kľúč',
      percent: 10,
      from: new Date().toISOString().slice(0, 10),
      to: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
      status: 'needs_key',
      mode: 'scheduled',
      items: [{ productId: PRODUCTS[0], status: 'pending' }],
    });
    await db.expireApiKey();

    await page.goto(`/kampane/${campaignId}`);
    await expect(page.getByTestId('campaign-detail')).toBeVisible();
    await expect(page.getByTestId('campaign-detail')).not.toContainText('zlyhala');
  });
});
