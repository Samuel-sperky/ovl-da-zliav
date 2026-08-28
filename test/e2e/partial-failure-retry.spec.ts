/**
 * Aura Zľavy — e2e: čiastočné zlyhanie a opakovanie zlyhaných (A18, D15, D16, D36).
 *
 * Zľava, v ktorej sa časť produktov nepodarilo zapísať, je nasedená priamo v DB —
 * ostrý zápis, ktorým by vznikla, je v e2e vynútene odmietnutý (I13/I6, viď
 * hlavičku `fronta-v3.spec.ts`), a stav `partial` je vstup, nie predmet testu.
 *
 * Predmetom je invariant I3 v jeho najzradnejšej podobe: opakovanie zlyhaných
 * položiek MUSÍ prejsť NOVÝM dry-runom a novým potvrdením, aj keď sú parametre
 * identické (D16). Skratka neexistuje.
 *
 * ZMENA V3 (K9, K10, V11): detail zľavy sa prekreslil — `campaign-detail` je
 * `discount-detail`, `/kampane/[id]` je presmerovanie na `/zlavy/[id]` a na
 * povrchu už nie sú vnútorné kódy („1 zlyhané" → „1 sa nepodarilo").
 * Sprievodca opakovania zlyhaných položiek na obrazovke NIE JE: zoznam toho,
 * čo sa nepodarilo, je pod rozklikom a opakovanie ide cez novú zľavu.
 * Tvrdenie o D16 sa preto presúva na server — a je tam prísnejšie: cesta
 * `POST /api/campaigns/[id]/retry-failed` bez čerstvého jednorazového tokenu
 * MUSÍ skončiť 4xx a na shop nesmie odísť ani jeden zápis.
 */
import { api, expect, storeApiKey, test } from './fixtures';

const OK_PRODUCTS = [201, 202] as const;
const FAILED_PRODUCT = 203;

function dateOnly(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

test.describe('čiastočné zlyhanie', () => {
  test('detail zľavy ukáže, koľko prešlo a koľko sa nepodarilo', async ({ page, db }) => {
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

    // K9 — stará cesta sa nesmie zlomiť, vedie na novú.
    await page.goto(`/kampane/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/zlavy/${campaignId}$`));

    const detail = page.getByTestId('discount-detail');
    await expect(detail).toBeVisible();
    /*
     * Koľko prešlo a koľko nie, hovoria DVE dlaždice v „Priebehu" — nie jedna
     * veta. Tvrdenie preto stojí na nich a je prísnejšie než pôvodné hľadanie
     * podreťazca „sa nepodarilo" v celej sekcii: kontroluje aj ČÍSLA (2 a 1),
     * teda to, kvôli čomu sa na detail ide. Znenie dlaždice je „Nepodarilo sa"
     * (K10 — vnútorné „1 zlyhané" je preč); podreťazec s malým začiatočným
     * písmenom sa v sekcii od prekreslenia dlaždíc nevyskytuje.
     */
    const progress = page.getByTestId('detail-progress');
    await expect(progress.getByTestId('tile-ok')).toContainText('Zapísané');
    await expect(progress.getByTestId('tile-ok')).toContainText('2');
    await expect(progress.getByTestId('tile-failed')).toContainText('Nepodarilo sa');
    await expect(progress.getByTestId('tile-failed')).toContainText('1');
    // K10 — na povrchu nie je ani jeden vnútorný kód stavu položky.
    await expect(detail).not.toContainText('item failed');
    await expect(detail).not.toContainText('needs_key');

    // Zoznam toho, čo sa nepodarilo, je pod rozklikom (P6), nie na povrchu.
    await expect(page.getByTestId('detail-items')).toBeVisible();
  });

  test('D16: opakovanie zlyhaných bez čerstvého potvrdenia je 4xx a NIČ nezapíše', async ({
    page,
    db,
    control,
  }) => {
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

    const before = await control.state();

    /* 1. Bez tokenu — telo požiadavky ho nemá vôbec. */
    const noToken = await api(page, 'POST', `/api/campaigns/${campaignId}/retry-failed`, {});
    expect(noToken.status()).toBeGreaterThanOrEqual(400);
    expect(noToken.status()).toBeLessThan(500);

    /* 2. S vymysleným tokenom — podpis nesedí. */
    const fakeToken = await api(page, 'POST', `/api/campaigns/${campaignId}/retry-failed`, {
      previewToken: 'nie.je.token',
    });
    expect(fakeToken.status()).toBeGreaterThanOrEqual(400);
    expect(fakeToken.status()).toBeLessThan(500);

    /* I3 — ani jeden z pokusov sa nesmel dotknúť shopu. */
    const after = await control.state();
    expect(after.writeCount).toBe(before.writeCount);

    /* A zľava zostala presne tam, kde bola — nič sa „nerozbehlo". */
    const rows = await db.query<{ status: string }>('SELECT status FROM campaigns WHERE id = ?', [
      campaignId,
    ]);
    expect(rows[0].status).toBe('partial');
  });

  test('I7: v UI neexistuje akcia, ktorá by zľavu v shope rušila', async ({ page, db }) => {
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

    await page.goto(`/zlavy/${campaignId}`);
    await expect(page.getByTestId('discount-detail')).toBeVisible();
    // Appka zľavu v eshope nikdy neruší ani neskracuje — také tlačidlo
    // neexistuje. „Zastaviť" sa smie týkať výhradne FRONTY, teda toho, čo sa
    // ešte nezapísalo.
    await expect(
      page.getByRole('button', { name: /Zrušiť zľavu|Vymazať zľavu|Zrušiť v eshope/ }),
    ).toHaveCount(0);
  });
});
