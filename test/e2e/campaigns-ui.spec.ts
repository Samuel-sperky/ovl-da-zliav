/**
 * Aura Zľavy — e2e: drawer novej kampane a zoznam kampaní (opravy F2).
 *
 * Stráži nálezy bug huntu:
 *  - U1: zavretie drawera mimo fázy výsledku resetuje preview/fázu/chybu
 *    (draft výberu zostáva) — drawer nezamrzne v kroku 2 so spáleným tokenom,
 *  - U2: po úspešnom vytvorení kampane sa zoznam refetchne bez reloadu,
 *  - U3: derivované filtre (aktívna/expirovaná) skryjú stránkovanie a povedia,
 *    že filter platí len na načítané kampane,
 *  - U4: druhé `?nova=1` v tom istom mounte sa spracuje (spotreba podľa hodnoty),
 *  - U6: zlyhanie fetchu allowlistu má vlastný error stav + retry,
 *  - U7: drawer má focus trap a vracia fokus na vyvolávajúci element,
 *  - U8: Escape zavrie len sudo dialóg, nie celý drawer,
 *  - U9: stará odpoveď zoznamu neprepíše novšiu (race pri prepínaní strán/filtrov),
 *  - inline „Naozaj?" pri zrušení kampane v detaile,
 *  - `?podla=` so zlyhaným detailom otvorí drawer s vysvetlením.
 *
 * INVARIANT I6: všetko beží proti mocku na 127.0.0.1 (harness serve.ts).
 */
import { addAllowlist, expect, login, storeApiKey, test } from './fixtures';

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
  opts: {
    productIds: readonly number[];
    percent: 5 | 10 | 15 | 20 | 25 | 30;
    from: string;
    to: string;
  },
): Promise<void> {
  await expect(page.getByTestId('wizard-step1')).toBeVisible();
  for (const id of opts.productIds) await page.getByTestId(`product-${id}`).check();
  await page.getByTestId(`percent-chip-${opts.percent}`).click();
  await page.getByTestId('date-from').fill(opts.from);
  await page.getByTestId('date-to').fill(opts.to);
  await page.getByRole('button', { name: /Pokračovať na dry-run/ }).click();
}

test.describe('drawer novej kampane — zavretie, fokus, sudo', () => {
  test('U1: Escape v kroku 2 zavrie drawer; ďalšie otvorenie začína krokom 1 s draftom', async ({
    page,
  }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, PRODUCTS);

    await page.goto('/kampane');
    await page.getByTestId('new-campaign-link').click();
    await fillStep1(page, { productIds: [201], percent: 10, from: dateOnly(1), to: dateOnly(8) });
    await expect(page.getByTestId('wizard-step2')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('new-campaign-drawer')).toBeHidden();

    // Nové otvorenie: krok 1 (preview/fáza sa resetli), draft výberu zostal.
    await page.getByTestId('new-campaign-link').click();
    await expect(page.getByTestId('new-campaign-drawer')).toBeVisible();
    await expect(page.getByTestId('wizard-step1')).toBeVisible();
    await expect(page.getByTestId('wizard-step2')).toBeHidden();
    await expect(page.getByTestId('product-201')).toBeChecked();
  });

  test('U7: fokus je uväznený v paneli a po zavretí sa vráti na vyvolávajúci element', async ({
    page,
  }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, [201]);

    await page.goto('/kampane');
    await page.getByTestId('new-campaign-link').click();
    await expect(page.getByTestId('new-campaign-drawer')).toBeVisible();

    // Shift+Tab z panelu NESMIE ujsť za drawer — fokus zostáva v paneli.
    await page.keyboard.press('Shift+Tab');
    const insideAfterShiftTab = await page.evaluate(
      () => document.activeElement?.closest('[data-testid="new-campaign-drawer"]') != null,
    );
    expect(insideAfterShiftTab, 'Shift+Tab má cykliť v paneli drawera').toBe(true);

    // Aj obyčajný Tab niekoľkokrát — stále v paneli.
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('Tab');
    const insideAfterTabs = await page.evaluate(
      () => document.activeElement?.closest('[data-testid="new-campaign-drawer"]') != null,
    );
    expect(insideAfterTabs, 'Tab má cykliť v paneli drawera').toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('new-campaign-drawer')).toBeHidden();
    await expect(page.getByTestId('new-campaign-link')).toBeFocused();
  });

  test('U8: Escape zavrie len sudo dialóg — drawer s potvrdením zostáva', async ({ page }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, [201]);

    await page.clock.install();
    await page.goto('/kampane');
    await page.getByTestId('new-campaign-link').click();
    await fillStep1(page, { productIds: [201], percent: 10, from: dateOnly(1), to: dateOnly(8) });
    await expect(page.getByTestId('confirm-panel')).toBeVisible();

    // Sudo okno klientsky vyprší → potvrdenie si vypýta heslo (D70).
    await page.clock.fastForward('20:00');
    await page.getByTestId('write-to-production').click();
    const sudoDialog = page.getByRole('dialog', { name: 'Overenie heslom' });
    await expect(sudoDialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sudoDialog).toBeHidden();
    // Drawer aj potvrdzovací panel ŽIJÚ ďalej — Escape nezahodil rozrobený zápis.
    await expect(page.getByTestId('new-campaign-drawer')).toBeVisible();
    await expect(page.getByTestId('confirm-panel')).toBeVisible();
  });

  test('U6: zlyhanie fetchu allowlistu ukáže chybu s retry, nie prázdny allowlist', async ({
    page,
  }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, [201]);

    // Až PO naplnení allowlistu: GET /api/allowlist začne zlyhávať.
    await page.route('**/api/allowlist', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: { code: 'server_error', message: 'kaput' } }),
      });
    });

    await page.goto('/kampane');
    await page.getByTestId('new-campaign-link').click();
    await expect(page.getByTestId('allowlist-error')).toBeVisible();
    // Nesmie sa tváriť ako prázdny allowlist.
    await expect(page.getByText('Allowlist je prázdny')).toBeHidden();

    await page.unroute('**/api/allowlist');
    await page.getByTestId('allowlist-retry').click();
    await expect(page.getByTestId('product-201')).toBeVisible();
  });

  test('U2: po vytvorení (scheduled) kampane sa zoznam refetchne bez reloadu', async ({
    page,
  }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, [201]);

    await page.goto('/kampane');
    await expect(page.getByText('Zatiaľ žiadne kampane')).toBeVisible();

    await page.getByTestId('new-campaign-link').click();
    await fillStep1(page, { productIds: [201], percent: 15, from: dateOnly(2), to: dateOnly(9) });
    await expect(page.getByTestId('confirm-panel')).toBeVisible();

    // `scheduled` režim — kampaň vznikne v DB bez zápisu do shopu (D32, I13).
    await page.getByTestId('eager-toggle').getByRole('checkbox').uncheck();
    await page.getByTestId('write-to-production').click();
    await expect(page.getByTestId('wizard-result')).toBeVisible();

    await page.getByTestId('wizard-result').getByRole('button', { name: 'Zavrieť' }).click();
    await expect(page.getByTestId('new-campaign-drawer')).toBeHidden();

    // Zoznam sa refetchol sám — nová kampaň je vidieť bez reloadu stránky.
    await expect(page.getByTestId('campaign-list').getByText('Zľava −15')).toBeVisible();
  });

  test('U4: druhé ?nova=1 v tom istom mounte otvorí drawer s NOVÝM prefillom', async ({
    page,
  }) => {
    await login(page);
    await storeApiKey(page);
    await addAllowlist(page, PRODUCTS);

    await page.goto('/kampane?nova=1&produkty=201');
    await expect(page.getByTestId('new-campaign-drawer')).toBeVisible();
    await expect(page.getByTestId('product-201')).toBeChecked();
    // Query sa po spotrebovaní uprace z URL.
    await expect(page).toHaveURL(/\/kampane$/);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('new-campaign-drawer')).toBeHidden();

    // Klientska navigácia v TOM ISTOM mounte (ako akcia AI agenta).
    const pushed = await page.evaluate(() => {
      const nextRouter = (
        window as unknown as { next?: { router?: { push?: (href: string) => void } } }
      ).next?.router;
      if (typeof nextRouter?.push !== 'function') return false;
      nextRouter.push('/kampane?nova=1&produkty=202');
      return true;
    });
    test.skip(!pushed, 'window.next.router nie je v tomto builde Next.js dostupný');

    await expect(page.getByTestId('new-campaign-drawer')).toBeVisible();
    await expect(page.getByTestId('product-202')).toBeChecked();
    await expect(page.getByTestId('product-201')).not.toBeChecked();
  });

  test('?podla= so zlyhaným detailom: drawer sa otvorí s vysvetlením, nie potichu prázdny', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/kampane?nova=1&podla=987654');
    await expect(page.getByTestId('new-campaign-drawer')).toBeVisible();
    await expect(page.getByTestId('prefill-notice')).toContainText('nepodarilo');
  });
});

test.describe('zoznam kampaní — derivované filtre a race', () => {
  test('U3: derivovaný filter skryje stránkovanie a prizná rozsah filtra', async ({
    page,
    db,
  }) => {
    // 22 zapísaných (done) kampaní s oknom v minulosti → derivovane „expirovaná".
    for (let i = 1; i <= 22; i += 1) {
      await db.seedCampaign({
        name: `Stará kampaň ${i}`,
        percent: 10,
        from: dateOnly(-40),
        to: dateOnly(-10),
        status: 'done',
        items: [{ productId: 201, status: 'ok' }],
      });
    }
    await login(page);
    await page.goto('/kampane');
    await expect(page.getByRole('button', { name: 'Ďalšia →' })).toBeVisible();

    await page.getByTestId('campaign-filters').locator('select').selectOption('expirovana');
    await expect(page.getByTestId('derived-filter-note')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ďalšia →' })).toBeHidden();
    await expect(page.getByText(/strana \d+ \/ \d+/)).toBeHidden();
  });

  test('U9: stará (pomalšia) odpoveď neprepíše novší filter/stranu', async ({ page, db }) => {
    for (let i = 1; i <= 25; i += 1) {
      await db.seedCampaign({
        name: `Zrušená kampaň ${i}`,
        percent: 10,
        from: dateOnly(5),
        to: dateOnly(15),
        status: 'cancelled',
        items: [{ productId: 201, status: 'ok' }],
      });
    }
    await login(page);

    // Odpoveď pre `page=2` sa umelo zdrží — dorazí AŽ PO novšej požiadavke.
    await page.route('**/api/campaigns?*', async (route) => {
      const requestedPage = new URL(route.request().url()).searchParams.get('page');
      if (requestedPage === '2') await new Promise((r) => setTimeout(r, 1500));
      await route.fallback();
    });

    await page.goto('/kampane');
    await expect(page.getByText(/strana 1 \/ 2/)).toBeVisible();

    await page.getByRole('button', { name: 'Ďalšia →' }).click();
    // Kým sa strana 2 „vlečie", používateľ prepne filter → nová požiadavka.
    await page.getByTestId('campaign-filters').locator('select').selectOption('cancelled');
    await expect(page.getByText(/strana 1 \/ 2/)).toBeVisible();

    // Po dobehnutí PomalEJ odpovede strany 2 musí zostať novší výsledok.
    await page.waitForTimeout(2000);
    await expect(page.getByText(/strana 1 \/ 2/)).toBeVisible();
  });
});

test.describe('detail kampane — zrušenie', () => {
  test('zrušenie kampane vyžaduje inline „Naozaj?", jeden klik nestačí', async ({ page, db }) => {
    const campaignId = await db.seedCampaign({
      name: 'Naplánovaná na zrušenie',
      percent: 10,
      from: dateOnly(5),
      to: dateOnly(15),
      status: 'scheduled',
      mode: 'scheduled',
      items: [{ productId: 201, status: 'pending' }],
    });
    await login(page);
    await page.goto(`/kampane/${campaignId}`);

    await page.getByRole('button', { name: /Zrušiť kampaň/ }).click();
    // Prvý klik NIČ neruší — objaví sa inline potvrdenie.
    await expect(page.getByText('Naozaj zrušiť?')).toBeVisible();
    let [row] = await db.query<{ status: string }>('SELECT status FROM campaigns WHERE id = ?', [
      campaignId,
    ]);
    expect(row.status).toBe('scheduled');

    // „Nie" potvrdenie zatvorí a stav sa nemení.
    await page.getByRole('button', { name: 'Nie', exact: true }).click();
    await expect(page.getByText('Naozaj zrušiť?')).toBeHidden();
    [row] = await db.query<{ status: string }>('SELECT status FROM campaigns WHERE id = ?', [
      campaignId,
    ]);
    expect(row.status).toBe('scheduled');

    // Až „Áno, zrušiť" kampaň zruší.
    await page.getByRole('button', { name: /Zrušiť kampaň/ }).click();
    await page.getByTestId('cancel-campaign-confirm').click();
    await expect
      .poll(async () => {
        const [after] = await db.query<{ status: string }>(
          'SELECT status FROM campaigns WHERE id = ?',
          [campaignId],
        );
        return after.status;
      })
      .toBe('cancelled');
  });
});
