/**
 * Aura Zľavy — DETAIL PRODUKTU A FILTRE V PREHLIADAČI
 * (KONTRAKT-PRODUKTY-2026-08-13 A2 a A3, akceptačné kritériá 2–5).
 *
 * Dve veci sa dajú overiť len naostro, so skutočnou databázou a skutočným
 * prehliadačom:
 *
 *  1. **Panel vypíše to, čo appka o KONKRÉTNOM kuse naozaj vie.** Unit test
 *     kreslí panel nad vymysleným riadkom; tu prídu údaje celou cestou —
 *     zrkadlo katalógu → API → tabuľka → panel — a s nimi aj vlastné zápisy
 *     zľavy, ktoré panel načítava až po otvorení. Práve tá druhá požiadavka je
 *     to, čo sa staticky overiť nedá: „Zľava teraz" a „Naposledy zlacnené"
 *     stoja na odpovedi servera, nie na props.
 *  2. **Produkt, ktorý eshop už nevracia, sa dá NÁJSŤ.** Predvolene sa
 *     neponúka (fail-closed — zľava by na neho aj tak nešla), takže bez tohto
 *     filtra ho z obrazovky nedostane nikto. A práve takýto kus treba
 *     z rozpísaného výberu odobrať.
 *
 * Čo tento test NEROBÍ: nespúšťa dohľadanie v eshope (platené volanie) a nič
 * nezapisuje do shopu. Zľava v zázname je nasadená priamo do databázy.
 *
 * Vlastník: P2/P3 kontraktu produktov.
 */
import { expect, test } from './fixtures';

/** Kus, ktorý eshop pozná a ktorý sme už raz zlacnili. */
const KNOWN = { id: 911, name: 'Strieborný náramok Lumen 19 cm', price: 44.9 };

/** Kus, ktorý eshop pri poslednom načítaní nenašiel. */
const MISSING = { id: 912, name: 'Zlatá brošňa Aria, starý model', price: 210.0 };

const SHOP_TOTAL = 41_082;

test.describe('produkty — detail kusu a filtre nad tým, čo máme', () => {
  test('panel vypíše všetko, čo o kuse vieme, a zľavu priznáva ako vlastný zápis', async ({
    page,
    db,
  }) => {
    await db.query(
      'INSERT INTO catalog_cache (product_id, name, price, has_attributes, shop_status, source, ' +
        'fetched_at) VALUES (?, ?, ?, 1, ?, ?, UTC_TIMESTAMP(3)) ' +
        'ON DUPLICATE KEY UPDATE name = VALUES(name), price = VALUES(price), ' +
        'has_attributes = VALUES(has_attributes), shop_status = VALUES(shop_status), ' +
        'fetched_at = UTC_TIMESTAMP(3)',
      [KNOWN.id, KNOWN.name, KNOWN.price, 'ok', 'list'],
    );

    /* Vlastný zápis zľavy, ktorý PRÁVE platí. Panel z neho musí vyrobiť
       percento aj okno — a obe označiť za náš záznam, nie za stav eshopu. */
    const campaignId = await db.seedCampaign({
      name: 'Letné zľavy',
      percent: 15,
      from: '2026-08-01',
      to: '2026-08-31',
      status: 'done',
      items: [{ productId: KNOWN.id, status: 'ok' }],
    });
    expect(campaignId).toBeGreaterThan(0);

    try {
      await page.goto('/produkty');
      await expect(page.getByTestId('catalog-table')).toBeVisible();

      await page.getByTestId(`open-detail-${KNOWN.id}`).click();
      const panel = page.getByTestId('product-detail');
      await expect(panel).toBeVisible();

      /* 1. Údaje zo zrkadla — aj s časom načítania práve tohto riadku. */
      await expect(panel).toContainText(KNOWN.name);
      await expect(panel).toContainText('44,90 €');
      await expect(panel).toContainText('má varianty');
      await expect(panel).toContainText('eshop ho pozná');
      await expect(panel).toContainText('z načítaného katalógu');
      await expect(panel.getByTestId('detail-row-fetched-at')).toContainText('Načítané');

      /* 2. Zľava je VLASTNÝ ZÁPIS — nadpis skupiny aj značka v hlavičke. */
      await expect(panel.getByTestId('detail-own-write')).toContainText('vlastného zápisu');
      await expect(panel).toContainText('Zľavy podľa vlastných zápisov');
      await expect(panel.getByTestId('detail-discount-now')).toContainText('15 %', {
        timeout: 15_000,
      });
      await expect(panel).toContainText('1. 8. 2026');
      await expect(panel).toContainText('Appka vidí len to, čo sama zapísala');

      /* 3. Zamknuté údaje sú VIDIEŤ, prázdne, so zámkom — nie vynechané. */
      const locked = panel.getByTestId('detail-locked');
      for (const label of [
        'EAN produktu',
        'Cena s DPH',
        'Kategórie',
        'Zapnutý v eshope',
        'Pridané do eshopu',
      ]) {
        await expect(locked).toContainText(label);
      }
      await expect(locked.locator('.lockcell')).toHaveCount(5);
      /*
       * A skupina povie, KEDY sa merala (31. 8. 2026). Kým sa nedoťahovala,
       * je to priznanie, nie dátum — nikdy „asi teraz".
       */
      await expect(panel.getByTestId('detail-keyed-measured')).toContainText('eshopu');

      /* 4. Okno predajnosti je voliteľné priamo v paneli. */
      await panel.getByTestId('detail-window-360').click();
      await expect(panel).toContainText('predaných za posledných 360 dní');

      /* 5. Číslo produktu zostáva pod rozklikom (P6), nie na povrchu. */
      await expect(panel.locator('details.tech')).toContainText(String(KNOWN.id));
    } finally {
      await db.query('DELETE FROM catalog_cache WHERE product_id = ?', [KNOWN.id]);
    }
  });

  test('kus, ktorý eshop už nevracia, sa dá vyfiltrovať a inak ho nevidno', async ({
    page,
    db,
  }) => {
    for (const [product, status] of [
      [KNOWN, 'ok'],
      [MISSING, 'not_found'],
    ] as const) {
      await db.query(
        'INSERT INTO catalog_cache (product_id, name, price, has_attributes, shop_status, ' +
          'source, fetched_at) VALUES (?, ?, ?, 0, ?, ?, UTC_TIMESTAMP(3)) ' +
          'ON DUPLICATE KEY UPDATE name = VALUES(name), price = VALUES(price), ' +
          'shop_status = VALUES(shop_status), fetched_at = UTC_TIMESTAMP(3)',
        [product.id, product.name, product.price, status, 'list'],
      );
    }
    await db.query(
      'UPDATE catalog_sync_state SET per_page = 100, last_page = 1, shop_total = ?, ' +
        'rows_written = 2, completed = 0, started_at = UTC_TIMESTAMP(3), ' +
        'last_read_at = UTC_TIMESTAMP(3), finished_at = NULL, paused_until = NULL, ' +
        'pause_reason = NULL, last_error = NULL WHERE id = 1',
      [SHOP_TOTAL],
    );

    try {
      await page.goto('/produkty');
      await expect(page.getByTestId('catalog-table')).toBeVisible();

      /* 1. Predvolene sa nenájdený kus NEPONÚKA — zľava by na neho nešla. */
      await expect(page.getByTestId('catalog-filters')).toContainText('Stav v eshope');
      await expect(page.getByTestId(`open-detail-${KNOWN.id}`)).toBeVisible();
      await expect(page.getByTestId(`open-detail-${MISSING.id}`)).toBeHidden();

      /* 2. „Aj tie, ktoré už nevracia" ho pridá k ostatným. */
      await page.getByTestId('filter-presence-withMissing').check();
      await expect(page.getByTestId(`open-detail-${MISSING.id}`)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId(`open-detail-${KNOWN.id}`)).toBeVisible();

      /* 3. „Len tie, ktoré už nevracia" nechá v tabuľke výhradne jeho. */
      await page.getByTestId('filter-presence-onlyMissing').check();
      await expect(page.getByTestId(`open-detail-${KNOWN.id}`)).toBeHidden({ timeout: 15_000 });
      await expect(page.getByTestId(`open-detail-${MISSING.id}`)).toBeVisible();

      /* 4. Pri kuse je napísané, čo mu je — a panel to zopakuje vetou. */
      await page.getByTestId(`open-detail-${MISSING.id}`).click();
      const panel = page.getByTestId('product-detail');
      await expect(panel).toContainText('eshop ho nenašiel');
      await expect(panel.getByTestId('product-reason-shop_not_found')).toBeVisible();

      /* 5. Zľavy sú aj tu priznané ako vlastné zápisy, nie ako stav eshopu. */
      await expect(panel).toContainText('Zľavy podľa vlastných zápisov');
    } finally {
      await db.query('DELETE FROM catalog_cache WHERE product_id IN (?, ?)', [
        KNOWN.id,
        MISSING.id,
      ]);
    }
  });
});
