/**
 * Aura Zľavy — SNÍMKY OBRAZOVIEK pre report zo šprintu
 * (KONTRAKT-DOKONCENIE-2026-08-12, akceptačné kritérium 8).
 *
 * Nie je to test správania — nič netvrdí o logike a nič nesmie zlyhať na
 * obsahu. Je to dôkaz, že obrazovky po prestavbe priehľadnosti naozaj vykreslia
 * to, čo o nich hovorí report, a že sa na to dá pozrieť bez toho, aby si človek
 * vyplnil basic auth pred Caddym (to sa z agenta spraviť nedá — preto sa jazdí
 * cez e2e harness, ktorý servuje appku priamo).
 *
 * Snímky idú do `screenshots/`.
 *
 * Vlastník: A18.
 */
import { expect, login, storeApiKey, test } from './fixtures';

test.describe('snímky obrazoviek', () => {
  test('štyri taby po prestavbe priehľadnosti', async ({ page }) => {
    await login(page);
    await storeApiKey(page);

    /* 1. Prehľad — živý stav, dôvody, poučný prázdny stav. */
    await page.goto('/');
    await expect(page.getByTestId('overview')).toBeVisible();
    await expect(page.getByTestId('overview-live-status')).toBeVisible();
    await page.screenshot({ path: 'screenshots/v13-prehlad.png', fullPage: true });

    /* 2. Produkty — stav katalógu a strop výberu. */
    await page.goto('/produkty');
    await expect(page.getByTestId('catalog-table')).toBeVisible();
    await page.screenshot({ path: 'screenshots/v13-produkty.png', fullPage: true });

    /* 3. Zľavy — zoznam a jeho prázdny stav. */
    await page.goto('/zlavy');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/v13-zlavy.png', fullPage: true });

    /* 4. Nová zľava — jedna obrazovka, štyri sekcie. */
    await page.goto('/zlavy/nova');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/v13-nova-zlava.png', fullPage: true });

    /* 5. Nastavenia — režim rozsahu navrchu, rozpočty, brzdy. */
    await page.goto('/nastavenia');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/v13-nastavenia.png', fullPage: true });
  });
});
