/**
 * Aura Zľavy — e2e: čiastočné zlyhanie a „Zopakovať zlyhané" (A18, D15, D16, D36).
 *
 * Kampaň v stave `partial` (2 OK, 1 zlyhaná položka) je nasedená priamo v DB —
 * ostrý zápis, ktorým by vznikla, je v e2e vynútene odmietnutý (I13/I6, viď
 * `write-flow.spec.ts`), a stav `partial` je vstup, nie predmet tohto testu.
 *
 * Predmetom je invariant I3 v jeho najzradnejšej podobe: opakovanie zlyhaných
 * položiek MUSÍ prejsť NOVÝM dry-runom a novým potvrdením, aj keď sú parametre
 * identické (D16). Skratka neexistuje.
 */
import { expect, login, storeApiKey, test } from './fixtures';
import { E2E_CONFIG } from './config';

const OK_PRODUCTS = [201, 202] as const;
const FAILED_PRODUCT = 203;

function dateOnly(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

test.describe('čiastočné zlyhanie', () => {
  test('detail kampane ukáže 2 OK a 1 zlyhanú položku', async ({ page, db }) => {
    await login(page);
    await storeApiKey(page);
    await db.seedAllowlist([...OK_PRODUCTS, FAILED_PRODUCT]);

    const campaignId = await db.seedCampaign({
      name: 'Jesenná zľava',
      percent: 20,
      from: dateOnly(0),
      to: dateOnly(7),
      status: 'partial',
      items: [
        { productId: OK_PRODUCTS[0], status: 'ok' },
        { productId: OK_PRODUCTS[1], status: 'ok' },
        { productId: FAILED_PRODUCT, status: 'failed' },
      ],
    });

    await page.goto(`/kampane/${campaignId}`);
    await expect(page.getByTestId('campaign-detail')).toBeVisible();
    await expect(page.getByTestId('campaign-detail')).toContainText('2 ok');
    await expect(page.getByTestId('campaign-detail')).toContainText('1 zlyhané');
    // I11 — stav sa nikdy neprezentuje ako pravda o shope.
    await expect(page.getByTestId('campaign-detail')).toContainText('posledného VLASTNÉHO zápisu');
    await expect(page.getByTestId('retry-failed')).toBeVisible();
    await expect(page.getByRole('button', { name: /Zopakovať zlyhané \(1\)/ })).toBeVisible();
  });

  test('D16: „Zopakovať zlyhané" ide vždy cez nový dry-run a nové potvrdenie', async ({
    page,
    db,
    control,
  }) => {
    await login(page);
    await storeApiKey(page);
    await db.seedAllowlist([...OK_PRODUCTS, FAILED_PRODUCT]);

    const campaignId = await db.seedCampaign({
      name: 'Jesenná zľava',
      percent: 20,
      from: dateOnly(0),
      to: dateOnly(7),
      status: 'partial',
      items: [
        { productId: OK_PRODUCTS[0], status: 'ok' },
        { productId: OK_PRODUCTS[1], status: 'ok' },
        { productId: FAILED_PRODUCT, status: 'failed' },
      ],
    });

    await page.clock.install();
    await page.goto(`/kampane/${campaignId}`);
    const before = await control.state();

    await page.getByRole('button', { name: /Zopakovať zlyhané/ }).click();

    /* Dry-run opakovania — obsahuje VÝHRADNE zlyhaný produkt. */
    const retry = page.getByTestId('retry-failed');
    await expect(retry.getByTestId('dry-run-table')).toBeVisible();
    await expect(retry.getByTestId('dry-run-table')).toContainText(String(FAILED_PRODUCT));
    await expect(retry.getByTestId('dry-run-table')).not.toContainText(String(OK_PRODUCTS[0]));

    /* Nové potvrdenie je povinné — názov je zamknutý (D36). */
    await expect(retry.getByTestId('confirm-panel')).toBeVisible();
    await expect(retry.getByTestId('campaign-name')).toBeDisabled();

    // Dry-run sám nezapisuje.
    const afterPreview = await control.state();
    expect(afterPreview.writeCount).toBe(before.writeCount);

    /* Potvrdenie po vypršaní sudo okna → heslo znova (D70). */
    await page.clock.fastForward('20:00');
    await retry.getByTestId('write-to-production').click();
    const sudoDialog = page.getByRole('dialog', { name: 'Overenie heslom' });
    if (await sudoDialog.isVisible()) {
      await sudoDialog.getByPlaceholder('Heslo').fill(E2E_CONFIG.adminPassword);
      await sudoDialog.getByRole('button', { name: 'Potvrdiť' }).click();
    }

    /* Vyústenie: nová retry kampaň, alebo fail-closed odmietnutie zápisu (I13). */
    const refused = page.getByText(/Ostrý zápis je vypnutý|WRITES_ENABLED/);
    await expect(page.getByTestId('campaign-detail').or(refused).first()).toBeVisible();

    if (await refused.isVisible()) {
      const afterConfirm = await control.state();
      expect(afterConfirm.writeCount).toBe(before.writeCount);
      // Žiadna nová kampaň nesmie zostať „rozbehnutá" po odmietnutom zápise.
      const running = await db.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM campaigns WHERE status = 'running'",
      );
      expect(Number(running[0].n)).toBe(0);
    }
  });

  test('I7: v UI neexistuje akcia, ktorá by zľavu v shope rušila', async ({ page, db }) => {
    await login(page);
    await storeApiKey(page);
    await db.seedAllowlist([...OK_PRODUCTS]);

    const campaignId = await db.seedCampaign({
      name: 'Bežiaca zľava',
      percent: 10,
      from: dateOnly(0),
      to: dateOnly(3),
      status: 'done',
      items: [{ productId: OK_PRODUCTS[0], status: 'ok' }],
    });

    await page.goto(`/kampane/${campaignId}`);
    await expect(page.getByTestId('campaign-detail')).toBeVisible();
    // „Zrušiť" existuje výhradne pre PLÁN v našej DB, nikdy pre zľavu v shope.
    await expect(page.getByRole('button', { name: /Zrušiť zľavu|Vymazať zľavu/ })).toHaveCount(0);
    await expect(page.getByTestId('campaign-detail')).toContainText('nedá zrušiť, len prepísať');
  });
});
