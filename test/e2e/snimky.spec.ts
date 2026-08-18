/**
 * Aura Zľavy — SNÍMKY OBRAZOVIEK pre report zo šprintu
 * (KONTRAKT-DOKONCENIE-2026-08-12, akceptačné kritérium 8).
 *
 * Nie je to test správania — nič netvrdí o logike a nesmie zlyhať na obsahu.
 * Je to dôkaz, že obrazovky po prestavbe priehľadnosti naozaj vykreslia to, čo
 * o nich hovorí report, a že sa na to dá pozrieť bez vypĺňania basic auth pred
 * Caddym (to sa z agenta spraviť nedá — preto sa jazdí cez e2e harness, ktorý
 * servuje appku priamo).
 *
 * POZOR NA ČÍTANIE SNÍMOK: dáta sú z e2e harnessu a mock shopu, NIE z ostrej
 * inštalácie. Nasadená zľava zámerne zrkadlí tú skutočnú z 12. 8. (21 produktov,
 * 10 %, okno 14.–27. 8., všetko zapísané), aby snímky ukazovali obrazovky
 * v stave, v akom sú u používateľa naozaj.
 *
 * Snímky idú do `screenshots/`.
 *
 * Vlastník: A18.
 */
import { expect, login, storeApiKey, test } from './fixtures';

/** Zrkadlo skutočnej zľavy z 12. 8. 2026 — 21 produktov, všetky zapísané. */
const PRODUKTY = Array.from({ length: 21 }, (_, i) => 201 + i);

test.describe('snímky obrazoviek', () => {
  test('štyri taby a detail zľavy po prestavbe priehľadnosti', async ({ page, db }) => {
    await login(page);
    await storeApiKey(page);

    /* 1. Prehľad bez jedinej zľavy — verdikt, prázdny stav a riadok kontrol. */
    await page.goto('/');
    await expect(page.getByTestId('overview')).toBeVisible();
    await expect(page.getByTestId('verdict-headline')).toBeVisible();
    await expect(page.getByTestId('overview-checks')).toBeVisible();
    await page.screenshot({ path: 'screenshots/aktualne-1-prehlad-prazdny.png', fullPage: true });

    /* 2. Produkty — stav katalógu a strop výberu. */
    await page.goto('/produkty');
    await expect(page.getByTestId('catalog-table')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/aktualne-2-produkty.png', fullPage: true });

    /* 3. Nová zľava — jedna obrazovka, štyri sekcie. */
    await page.goto('/zlavy/nova');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/aktualne-3-nova-zlava.png', fullPage: true });

    /* 4. Nastavenia — „čo appka vie", režim rozsahu, rozpočty, brzdy. */
    await page.goto('/nastavenia');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/aktualne-4-nastavenia.png', fullPage: true });

    /* ── teraz do appky nasadíme dokončenú zľavu ── */
    const campaignId = await db.seedCampaign({
      name: 'Ležiaky — 10 %',
      percent: 10,
      from: '2026-08-14',
      to: '2026-08-27',
      status: 'done',
      items: PRODUKTY.map((productId) => ({ productId, status: 'ok', percent: 10 })),
    });

    /* 5. Prehľad so zľavou — na mieste prázdneho stavu je fronta. */
    await page.goto('/');
    await expect(page.getByTestId('overview')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/aktualne-5-prehlad-so-zlavou.png', fullPage: true });

    /* 6. Zoznam zliav. */
    await page.goto('/zlavy');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/aktualne-6-zlavy-zoznam.png', fullPage: true });

    /* 7. Detail zľavy — fronta naživo, rozpočet, položky. */
    await page.goto(`/zlavy/${campaignId}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/aktualne-7-zlava-detail.png', fullPage: true });
  });
});
