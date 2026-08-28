/**
 * Aura Zľavy — OBNOVA CELÉHO KATALÓGU V PREHLIADAČI
 * (nález review z 12. 8., KONTRAKT-DOKONCENIE-2026-08-12: A5, C5).
 *
 * Po každom dokončenom prechode začína nový (obnovovací) od stránky 0.
 * `pagesDone`/`pagesLeft` pritom patria AKTUÁLNEMU prechodu, kdežto
 * `loadedProducts` je `COUNT(*)` za celý katalóg — a karta v Produktoch z toho
 * poskladala „0 chýba" vedľa „stránok ostáva, ešte 2 dni", zatiaľ čo Prehľad
 * o tom istom stave hlásil „načítaný celý".
 *
 * Tento test ten stav postaví v DB (inak sa naň dá naraziť až po dvojdňovom
 * behu) a pozrie sa na obe obrazovky. Čísla strážia unit testy
 * (`catalog-status.spec.ts`, `produkty-katalog.spec.ts`); tu ide o to, že to
 * používateľ naozaj takto uvidí — a že je z toho snímka do reportu.
 *
 * Vlastník: V10.
 */
import { expect, test } from './fixtures';

test.describe('katalóg — obnova nad celým katalógom', () => {
  test('karta ani Prehľad netvrdia, že chýbajú stránky', async ({ page, db }) => {
    /* 1. Katalóg, ktorý appka MÁ celý. Rozhoduje `COUNT(*)` proti `shop_total`,
     *    nie absolútne číslo — 41 082 riadkov by test predĺžilo o minúty a na
     *    vetu o obnove nemajú vplyv. */
    for (const productId of [901, 902, 903]) {
      await db.query(
        'INSERT INTO catalog_cache (product_id, name, price, has_attributes, source, fetched_at) ' +
          'VALUES (?, ?, ?, 0, ?, UTC_TIMESTAMP(3)) ' +
          'ON DUPLICATE KEY UPDATE fetched_at = UTC_TIMESTAMP(3)',
        [productId, `Šperk ${productId}`, 19.99, 'list'],
      );
    }
    const counted = await db.query<{ total: number }>(
      'SELECT COUNT(*) AS total FROM catalog_cache',
    );
    const loaded = Number(counted[0]?.total ?? 0);
    expect(loaded).toBe(3);

    /* 2. Pokrok presne po `startFresh` v `syncCatalog()`: nový prechod stojí na
     *    stránke 0, `completed = 0`, ale `shop_total` ostáva známy. */
    await db.query(
      'UPDATE catalog_sync_state SET per_page = 100, last_page = 0, shop_total = ?, ' +
        'rows_written = ?, completed = 0, started_at = UTC_TIMESTAMP(3), ' +
        'last_read_at = UTC_TIMESTAMP(3), finished_at = NULL, paused_until = NULL, ' +
        'pause_reason = NULL, last_error = NULL WHERE id = 1',
      [loaded, loaded],
    );

    try {
      /* 3. Produkty — karta stavu katalógu. */
      await page.goto('/produkty');
      await expect(page.getByTestId('catalog-status')).toBeVisible();

      // Stav jednou vetou: katalóg JE celý, len sa obnovuje.
      await expect(page.getByTestId('catalog-state')).toContainText('celý');

      // „Chýba" je nula a NEVYSVETĽUJE sa stránkami, ktoré nechýbajú.
      const missing = page.getByTestId('catalog-tile-missing');
      await expect(missing).toContainText('obnovuje');
      await expect(missing).not.toContainText('stránok');

      // A žiadne „ešte 2 dni" nad katalógom, ktorý appka má na disku.
      const finish = page.getByTestId('catalog-tile-finish');
      await expect(finish).toContainText('hotovo');
      await expect(finish).not.toContainText('dni');

      await page.screenshot({ path: 'screenshots/katalog-obnova-produkty.png', fullPage: true });

      /* 4. Prehľad — kontrola katalógu hovorí to isté. */
      await page.goto('/');
      const checks = page.getByTestId('overview-checks');
      await expect(checks).toBeVisible();
      await expect(checks).toContainText('načítaný celý');
      await expect(checks).toContainText('obnovuje');

      await page.screenshot({ path: 'screenshots/katalog-obnova-prehlad.png', fullPage: true });
    } finally {
      // `catalog_sync_state` je singleton a `db.reset()` ho nečistí — stav by
      // inak pretiekol do ďalších scenárov.
      await db.query(
        'UPDATE catalog_sync_state SET per_page = 100, last_page = 0, shop_total = NULL, ' +
          'rows_written = 0, completed = 0, started_at = NULL, last_read_at = NULL, ' +
          'finished_at = NULL, paused_until = NULL, pause_reason = NULL, last_error = NULL ' +
          'WHERE id = 1',
      );
    }
  });
});
