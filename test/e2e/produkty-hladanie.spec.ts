/**
 * Aura Zľavy — HĽADANIE, POČET ZHÔD A VÝBER V PREHLIADAČI
 * (KONTRAKT-PRODUKTY-2026-08-13 A1, akceptačné kritériá 6–7;
 *  KONTRAKT-UI-2026-08-13 body 8, 17, 19, 25–28).
 *
 * Tri veci sa dajú overiť len naostro, v skutočnom prehliadači:
 *
 *  1. **Výber prežije prechod medzi tabmi** (bod 17). Tab je vlastná stránka —
 *     komponent sa odpojí a s ním by zmizol aj výber. Unit test to nedokáže:
 *     musí prebehnúť skutočná navigácia tam aj späť.
 *  2. **Dohľadanie v eshope sa ponúka aj nad NEPRÁZDNYM výsledkom** (bod 26).
 *     Zrkadlo má zlomok katalógu, takže tri nájdené riadky nie sú dôkaz, že
 *     v eshope nie je tridsať ďalších.
 *  3. **Počet zhôd je pri neúplnom zrkadle označený `≈`** (bod 8, P7). Je to
 *     dolná hranica, nie fakt.
 *
 * Test NEKLIKÁ na „Dohľadať v eshope" — to je platené volanie do eshopu
 * a scenár o jeho výsledku patrí k mocku hľadania (`hladanie-produktov.spec.ts`).
 * Tu sa overuje, že ponuka existuje a je dosiahnuteľná.
 *
 * Vlastník: V15 (hľadanie a tabuľka).
 */
import { expect, login, test } from './fixtures';

/** Zrkadlo je zámerne NEÚPLNÉ — presne to spúšťa značku `≈`. */
const MIRROR = [
  { id: 901, name: 'Strieborná retiazka Lumen 45 cm', price: 34.9 },
  { id: 902, name: 'Zlatý prsteň Lumen s briliantom', price: 129.0 },
  { id: 903, name: 'Strieborné náušnice Aria', price: 19.5 },
] as const;

const SHOP_TOTAL = 41_082;

test.describe('produkty — hľadanie, počet zhôd a výber', () => {
  test('výber prežije prechod na iný tab, ponuka dohľadania nezmizne', async ({ page, db }) => {
    for (const product of MIRROR) {
      await db.query(
        'INSERT INTO catalog_cache (product_id, name, price, has_attributes, source, fetched_at) ' +
          'VALUES (?, ?, ?, 0, ?, UTC_TIMESTAMP(3)) ' +
          'ON DUPLICATE KEY UPDATE name = VALUES(name), price = VALUES(price), ' +
          'fetched_at = UTC_TIMESTAMP(3)',
        [product.id, product.name, product.price, 'list'],
      );
    }

    /* Katalóg, ktorý appka MÁ len z časti: `shop_total` je celý eshop,
       `rows_written` tri riadky. Bez toho by bol počet zhôd meraný fakt. */
    await db.query(
      'UPDATE catalog_sync_state SET per_page = 100, last_page = 1, shop_total = ?, ' +
        'rows_written = ?, completed = 0, started_at = UTC_TIMESTAMP(3), ' +
        'last_read_at = UTC_TIMESTAMP(3), finished_at = NULL, paused_until = NULL, ' +
        'pause_reason = NULL, last_error = NULL WHERE id = 1',
      [SHOP_TOTAL, MIRROR.length],
    );

    try {
      await login(page);

      await page.goto('/produkty');
      await expect(page.getByTestId('catalog-table')).toBeVisible();

      /* 1. Počet zhôd je dolná hranica — `≈`, nie presné číslo (bod 8, P7). */
      await expect(page.getByTestId('catalog-matching')).toContainText('≈');

      /* 2. Predvolené poradie je najdrahšie prvé (bod 19) — prvý dátový riadok
            patrí najdrahšiemu kusu zrkadla. */
      const firstRow = page.locator('table.tbl tbody tr').first();
      await expect(firstRow).toContainText('Zlatý prsteň Lumen');

      /* 3. Bez textu v hľadaní sa dohľadanie neponúka — nie je čo hľadať. */
      await expect(page.getByTestId('catalog-lookup')).toBeHidden();

      /* 4. S textom, ktorý NIEČO našiel, ponuka BYŤ MUSÍ (bod 26). */
      await page.getByTestId('catalog-search').fill('Lumen');
      await expect(page.locator('table.tbl tbody tr')).toHaveCount(2, { timeout: 15_000 });
      await expect(page.getByTestId('catalog-lookup')).toBeEnabled({ timeout: 15_000 });

      /* 5. Výber dvoch kusov a odskok na iný tab. */
      await page.getByTestId('select-page').check();
      await expect(page.getByTestId('selection-bar')).toBeVisible();

      await page.goto('/');
      await expect(page.getByTestId('overview')).toBeVisible();

      /* 6. Späť v Produktoch — výber aj otázka sú tam, kde ich človek nechal
            (bod 17). Nikto ho medzitým nezrušil, takže sa nesmel stratiť. */
      await page.goto('/produkty');
      await expect(page.getByTestId('catalog-table')).toBeVisible();
      await expect(page.getByTestId('catalog-search')).toHaveValue('Lumen');
      await expect(page.getByTestId('selection-bar')).toBeVisible({ timeout: 15_000 });

      /* 7. A keď ho človek zruší, zmizne — aj po ďalšom prechode. */
      await page.getByTestId('clear-selection').click();
      await expect(page.getByTestId('selection-bar')).toBeHidden();

      await page.goto('/');
      await page.goto('/produkty');
      await expect(page.getByTestId('catalog-table')).toBeVisible();
      await expect(page.getByTestId('selection-bar')).toBeHidden({ timeout: 15_000 });
    } finally {
      // `catalog_sync_state` je singleton a `db.reset()` ho nečistí.
      await db.query(
        'UPDATE catalog_sync_state SET per_page = 100, last_page = 0, shop_total = NULL, ' +
          'rows_written = 0, completed = 0, started_at = NULL, last_read_at = NULL, ' +
          'finished_at = NULL, paused_until = NULL, pause_reason = NULL, last_error = NULL ' +
          'WHERE id = 1',
      );
    }
  });
});
