/**
 * Aura Zľavy — e2e: audit filter + detail s príznakom nezhody cien (A18, D18, D39c, I4).
 *
 * Audit je append-only: v UI neexistuje žiadna akcia, ktorá by záznam zmenila
 * alebo zmazala (I4). Filtre sú povinná sada podľa D18 (produkt, dátum, typ,
 * výsledok) a detail musí vedieť ukázať príznak „rozhodoval si nad inou cenou".
 *
 * ZMENA V3 (K9, K10): audit už nie je samostatný tab — skladá sa do Nastavení
 * ako „História a technický detail" a `/audit` je presmerovanie (staré odkazy
 * sa nesmú zlomiť, preto sa sem chodí ďalej cez `/audit`). Hlavne sa ale zmenil
 * POVRCH: vnútorné kódy udalostí (`write_ok`, `write_failed`, `key_stored`)
 * sú v tabuľke ZAKÁZANÉ a patria pod rozklik „Technický detail". Tvrdenia sa
 * preto prepisujú z kódov na vety — a pribúda tvrdenie, že kód na povrchu
 * naozaj NIE JE.
 */
import { api, expect, login, test } from './fixtures';

const PRODUCT_OK = 201;
const PRODUCT_MISMATCH = 202;

/** Vety, ktoré appka v histórii vypisuje — na povrchu sa filtruje podľa nich. */
const MSG_OK = 'prvý produkt zlacnel';
const MSG_MISMATCH = 'cena sa medzitým zmenila';
const MSG_FAILED = 'eshop odpovedal chybou servera';

test.describe('audit', () => {
  test('filter podľa produktu, typu a výsledku + detail s nezhodou cien', async ({ page, db }) => {
    await db.seedAllowlist([PRODUCT_OK, PRODUCT_MISMATCH]);
    const campaignId = await db.seedCampaign({
      name: 'Kampaň pre audit',
      percent: 10,
      from: new Date().toISOString().slice(0, 10),
      to: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      status: 'partial',
      items: [
        { productId: PRODUCT_OK, status: 'ok' },
        {
          productId: PRODUCT_MISMATCH,
          status: 'ok',
          priceAtPreview: 19.99,
          priceAtWrite: 24.99,
          priceMismatch: true,
        },
      ],
    });

    await db.seedAuditRow({
      eventType: 'write_ok',
      ok: true,
      productId: PRODUCT_OK,
      campaignId,
      httpStatus: 200,
      message: MSG_OK,
    });
    const mismatchAuditId = await db.seedAuditRow({
      eventType: 'write_ok',
      ok: true,
      productId: PRODUCT_MISMATCH,
      campaignId,
      httpStatus: 200,
      message: MSG_MISMATCH,
      priceMismatch: true,
    });
    await db.seedAuditRow({
      eventType: 'write_failed',
      ok: false,
      productId: PRODUCT_MISMATCH,
      campaignId,
      httpStatus: 500,
      message: MSG_FAILED,
    });

    await login(page);
    await page.goto('/audit');
    await expect(page.getByTestId('audit-filters')).toBeVisible();
    await expect(page.getByTestId('audit-table')).toContainText(MSG_OK);
    await expect(page.getByTestId('audit-table')).toContainText(MSG_FAILED);

    /* K10 — vnútorný kód udalosti sa na povrchu NEVYSKYTUJE. */
    await expect(page.getByTestId('audit-table')).not.toContainText('write_ok');
    await expect(page.getByTestId('audit-table')).not.toContainText('write_failed');
    /* Neúspech je veta, nie HTTP kód. */
    await expect(page.getByTestId('audit-table')).toContainText('nepodarilo sa');

    /* Filter podľa produktu — záznamy iného produktu zmiznú.
     * K10: čísla produktov a zliav sú pod rozklikom „Hľadať podľa čísla",
     * nie v hlavnom riadku filtrov. Test ho preto musí otvoriť. */
    await page.getByText('Hľadať podľa čísla').click();
    await page.getByTestId('audit-filter-product').fill(String(PRODUCT_OK));
    await expect(page.getByTestId('audit-table')).toContainText(MSG_OK);
    await expect(page.getByTestId('audit-table')).not.toContainText(MSG_FAILED);

    /* Filter podľa výsledku — len neúspešné. */
    await page.getByTestId('audit-filter-reset').click();
    await page.getByTestId('audit-filter-ok').selectOption('false');
    await expect(page.getByTestId('audit-table')).toContainText(MSG_FAILED);
    await expect(page.getByTestId('audit-table')).not.toContainText(MSG_OK);

    /* Filter podľa typu operácie. Hodnota `<option>` je vnútorný kód — to je
     * v poriadku, K10 zakazuje kód v TEXTE, ktorý používateľ číta. */
    await page.getByTestId('audit-filter-reset').click();
    await page.getByTestId('audit-filter-event').selectOption('write_ok');
    await expect(page.getByTestId('audit-table')).not.toContainText(MSG_FAILED);

    /* Detail — D39c príznak „rozhodoval si nad inou cenou". */
    await page.getByTestId(`audit-detail-${mismatchAuditId}`).click();
    const drawer = page.getByTestId('audit-detail-drawer');
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId('audit-price-mismatch')).toBeVisible();
    await expect(page.getByTestId('audit-price-mismatch')).toContainText('nad inou cenou');
    /* K10 — vnútorný kód udalosti smie byť LEN pod rozklikom „Technický detail". */
    await drawer.getByText('Technický detail').click();
    await expect(drawer).toContainText('write_ok');
    await page.getByTestId('audit-detail-close').click();
    await expect(drawer).toBeHidden();
  });

  test('I4: audit sa z UI nedá upraviť ani zmazať', async ({ page, db }) => {
    await db.seedAuditRow({
      eventType: 'login_ok',
      ok: true,
      message: 'prihlásenie',
    });

    await login(page);
    await page.goto('/audit');
    await expect(page.getByTestId('audit-table')).toBeVisible();
    await expect(page.getByRole('button', { name: /Zmazať záznam|Upraviť záznam|Vymazať audit/ })).toHaveCount(0);

    // Ani API nemá mutačnú cestu — DELETE na audit záznam neexistuje.
    const res = await api(page, 'DELETE', '/api/audit/1');
    expect([404, 405]).toContain(res.status());
  });

  test('dátumový filter zúži výsledok na zvolený deň', async ({ page, db }) => {
    await db.seedAuditRow({ eventType: 'key_stored', ok: true, message: 'kľúč na zápis uložený' });

    await login(page);
    await page.goto('/audit');
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    await page.getByTestId('audit-filter-from').fill(today);
    await page.getByTestId('audit-filter-to').fill(today);
    await expect(page.getByTestId('audit-table')).toContainText('kľúč na zápis uložený');

    // Okno bez záznamov (zajtra) → prázdna tabuľka.
    await page.getByTestId('audit-filter-from').fill(tomorrow);
    await page.getByTestId('audit-filter-to').fill(tomorrow);
    await expect(page.getByTestId('audit-table')).toContainText('Zatiaľ nič');
  });
});
