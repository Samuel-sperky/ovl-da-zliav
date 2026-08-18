/**
 * Aura Zľavy — e2e: CESTA Z K12 (V14).
 *
 * Kontrakt V3, K12 („definícia hotového") žiada jednu súvislú cestu appkou:
 *
 *   prihlásenie → Prehľad → filter produktov → nová zľava s DVOMA pásmami
 *   → potvrdenie → zaradenie do fronty → fronta beží
 *
 * Prechádza sa klikaním, nie volaním API — jediné dve výnimky sú uloženie
 * kľúča (šifruje sa master keyom, cez UI by to bol krok navyše bez pridanej
 * hodnoty) a prepnutie rozsahu do `plny`, ktoré má vlastnú obrazovku aj vlastný
 * test (`routes-v8.spec.ts`, K1 bod 4). Bez `plny` by 30 produktov narazilo na
 * strop pilotu (10) a cesta by skončila skôr, než začne.
 *
 * ČO TENTO TEST NEDOKAZUJE — a prečo
 * ──────────────────────────────────
 * Že fronta naozaj ZAPÍŠE do shopu. E2E beží zámerne mimo
 * `NODE_ENV=production` (v produkcii je `SHOP_BASE_URL_OVERRIDE` zakázaný, I6)
 * a s `WRITES_ENABLED=false` (I13), takže ostrý zápis je fail-closed odmietnutý
 * a scheduler je vypnutý (`SCHEDULER_ENABLED=false`), aby e2e nepálilo kampane
 * nedeterministicky. Zápisovú cestu fronty preto dokazuje
 * `test/integration/kontrakt-v3-dokaz.spec.ts` nad PRODUKČNÝMI repozitármi,
 * produkčným wiringom `scheduler/boot.ts` a reálnym mock shopom.
 *
 * Tu sa dokazuje to, čo e2e dokázať vie a nič iné to nedokáže: že sa celá cesta
 * dá preklikať, že vzniknú dve pásma s rôznym percentom, že bez skúšky
 * naprázdno a bez ručne vpísaného počtu sa zaradiť nedá (I3) a že zľava skončí
 * vo FRONTE — nie zapísaná — a fronta o nej vie.
 *
 * Vlastník: V14.
 */
import { api, expect, login, storeApiKey, test } from './fixtures';

/** Produkty bez jediného predaja → pásmo A („0 predaných"). */
const NEVER_SOLD = Array.from({ length: 18 }, (_, i) => 5001 + i);
/** Produkty s 2 predanými kusmi → pásmo B („1–2 predané"). */
const SLOW_SOLD = Array.from({ length: 12 }, (_, i) => 6001 + i);
/** Lacný tovar, ktorý cenový filter MUSÍ odrezať — dôkaz, že filter filtruje. */
const CHEAP = Array.from({ length: 10 }, (_, i) => 7001 + i);

const SELECTED_TOTAL = NEVER_SOLD.length + SLOW_SOLD.length; // 30

/** Deň v posune od dneška — predaje musia padnúť do okna 30 dní (default UI). */
function dayOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

test.describe('K12 — celá cesta appky', () => {
  test('prihlásenie → Prehľad → filter → dve pásma → potvrdenie → fronta', async ({
    page,
    db,
    control,
  }) => {
    /* ── 0. Katalóg shopu (K7): 40 produktov, z toho 12 s predajom ──
     *
     * Do `catalog_cache` sa NEZAPISUJE ručne — katalóg si appka zrkadlí sama
     * cez `POST /api/catalog/sync`. Ručný zápis by do výberu prepašoval
     * produkty, ktoré shop nepozná, a skúška naprázdno by ich (správne)
     * odmietla ako „v shope sa nenašiel". */
    await control.setProducts([
      ...NEVER_SOLD.map((id) => ({ id, price: 19.9 })),
      ...SLOW_SOLD.map((id) => ({ id, price: 29.9 })),
      ...CHEAP.map((id) => ({ id, price: 4.9 })),
    ]);
    await db.seedSales(SLOW_SOLD.map((productId) => ({ productId, day: dayOffset(-5), unitsSold: 2 })));

    /* ── 1. Prihlásenie ── */
    await login(page);

    // K1 — 30 produktov sa do pilotu (strop 10) nezmestí; uvoľnenie rozsahu je
    // sudo akcia a zapisuje sa do auditu. Sudo okno platí od prihlásenia.
    const scope = await api(page, 'POST', '/api/settings/scope-mode', { mode: 'plny' });
    expect(scope.status(), await scope.text()).toBe(200);
    await storeApiKey(page);
    const writesAfterKeyProbe = (await control.state()).writeCount;

    // K7 — synchronizácia katalógu je ČÍTANIE a rozpočet zápisov nemíňa.
    const sync = await api(page, 'POST', '/api/catalog/sync');
    expect(sync.status(), await sync.text()).toBe(200);
    expect((await control.state()).writeCount).toBe(writesAfterKeyProbe);

    /* ── 2. Prehľad ── */
    await page.goto('/');
    await expect(page.getByTestId('overview')).toBeVisible();

    // V tomto bode ešte NEEXISTUJE ani jedna zľava, takže pod verdiktom stojí
    // prázdny stav — jedna veta a jedno tlačidlo (kontrakt UI, bod 11). Fronta
    // sa na to isté miesto vráti, len čo nejaká zľava vznikne; overuje sa
    // nižšie, po potvrdení. Kým tu bola nula, používateľ videl číslo bez toho,
    // aby sa dozvedel, čo s ním.
    await expect(page.getByTestId('overview-status')).toBeVisible();
    await expect(page.getByTestId('overview-empty')).toBeVisible();

    // Riadok kontrol je vidieť VŽDY — to je celý zmysel priehľadnosti (C1).
    await expect(page.getByTestId('overview-checks')).toBeVisible();

    /* ── 3. Produkty a filter ── */
    await page.goto('/produkty');
    await expect(page.getByTestId('catalog-table')).toBeVisible();
    await expect(page.getByTestId('catalog-matching')).toContainText('40');

    // Cenový filter odreže lacný tovar — 40 → 30.
    await page.getByTestId('filter-price-from').fill('10');
    await expect(page.getByTestId('catalog-matching')).toContainText(String(SELECTED_TOTAL), {
      timeout: 15_000,
    });

    /* ── 4. Výber → Zlacniť ── */
    await page.getByTestId('select-page').check();
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    await page.getByTestId('discount-selection').click();

    /* ── 5. Nová zľava: DVE pásma s rôznym percentom (K3) ── */
    await expect(page.getByTestId('new-discount')).toBeVisible();
    await expect(page.getByTestId('tier-none')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('tier-low')).toBeVisible();

    await page.getByTestId('tier-percent-none').fill('30');
    await page.getByTestId('tier-percent-low').fill('20');
    await expect(page.getByTestId('tier-percent-error')).toBeHidden();

    // Dominantou potvrdenia je počet produktov, nie tlačidlo.
    await expect(page.getByTestId('confirm-count')).toContainText(String(SELECTED_TOTAL));

    /* ── 6. I3 — bez skúšky naprázdno a bez vpísaného počtu sa nezaraďuje ── */
    await expect(page.getByTestId('queue-discount')).toBeDisabled();

    await page.getByTestId('dry-run').click();
    await expect(page.getByTestId('dry-run-result')).toBeVisible({ timeout: 30_000 });
    // Skúška naprázdno je skúška: do shopu z nej nesmie odísť ani jeden zápis.
    expect((await control.state()).writeCount).toBe(writesAfterKeyProbe);

    // Ani po skúške sa bez ručne vpísaného počtu zaradiť nedá (odpoveď 38).
    await expect(page.getByTestId('queue-discount')).toBeDisabled();
    await page.getByTestId('confirm-count-input').fill(String(SELECTED_TOTAL - 1));
    await expect(page.getByTestId('queue-discount')).toBeDisabled();

    /* ── 7. Potvrdenie a zaradenie do fronty ── */
    await page.getByTestId('confirm-count-input').fill(String(SELECTED_TOTAL));
    // Skúška nesmie nájsť prekážku — ak nájde, chce to vidieť dôvod, nie timeout.
    await expect(page.getByTestId('preview-blockers')).toBeHidden();
    await expect(page.getByTestId('queue-discount')).toBeEnabled();
    await page.getByTestId('queue-discount').click();

    await expect(page.getByTestId('new-discount-created')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('new-discount-created')).toContainText(String(SELECTED_TOTAL));

    // K2 — zaradenie je fronta, nie zápis: na shop stále neodišlo nič.
    expect((await control.state()).writeCount).toBe(writesAfterKeyProbe);

    /* ── 8. Fronta o zľave vie a čaká presne na 30 položiek ── */
    const queue = await api(page, 'GET', '/api/queue');
    expect(queue.status(), await queue.text()).toBe(200);
    const queueBody = (await queue.json()) as {
      data: { queue: { pending: number; total: number; campaigns: number } };
    };
    expect(queueBody.data.queue.pending).toBe(SELECTED_TOTAL);
    expect(queueBody.data.queue.total).toBe(SELECTED_TOTAL);
    expect(queueBody.data.queue.campaigns).toBe(1);

    // Druhá strana tej istej výmeny: teraz už zľava existuje, takže pod
    // verdiktom stojí fronta a prázdny stav zmizol.
    await page.goto('/');
    await expect(page.getByTestId('overview-status')).toBeVisible();
    await expect(page.getByTestId('queue-number')).toBeVisible();
    await expect(page.getByTestId('overview-empty')).toHaveCount(0);

    // A DB to potvrdzuje z druhej strany: stav `queued`, dve pásma s rôznym
    // percentom, hlavička = najvyššie percento (K3), položky ešte `pending`.
    const campaigns = await db.query<{ id: number; status: string; percent: number }>(
      'SELECT id, status, percent FROM campaigns',
    );
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].status).toBe('queued');
    expect(Number(campaigns[0].percent)).toBe(30);

    const tiers = await db.query<{ percent: number; items_count: number }>(
      'SELECT percent, items_count FROM campaign_tiers WHERE campaign_id = ? ORDER BY ord',
      [campaigns[0].id],
    );
    expect(tiers.map((t) => Number(t.percent))).toEqual([30, 20]);
    expect(tiers.map((t) => Number(t.items_count))).toEqual([NEVER_SOLD.length, SLOW_SOLD.length]);

    const items = await db.query<{ percent: number; status: string; n: number }>(
      'SELECT percent, status, COUNT(*) AS n FROM campaign_items WHERE campaign_id = ? ' +
        'GROUP BY percent, status ORDER BY percent DESC',
      [campaigns[0].id],
    );
    expect(items.map((row) => [Number(row.percent), row.status, Number(row.n)])).toEqual([
      [30, 'pending', NEVER_SOLD.length],
      [20, 'pending', SLOW_SOLD.length],
    ]);

    /* ── 9. Zoznam zliav ju ukazuje ako bežiacu frontu ── */
    await page.goto('/zlavy');
    await expect(page.getByTestId('discounts-list')).toBeVisible();
    await expect(page.getByTestId('discount-row').first()).toContainText('30');
  });
});
