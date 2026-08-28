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
 *  4. **Dve slová sú dve podmienky, nie fráza** (19. 8. 2026). Cez celý stack —
 *     pole, debounce, `?query=`, `WHERE`, kolácia DB — sa dá overiť len tu:
 *     unit test vidí tvar SQL, ale nie to, čo z DB naozaj vypadne. Na živých
 *     dátach to bol rozdiel 10 verzus 797 produktov.
 *  5. **Prázdny výsledok povie, KDE sa hľadalo** (bod 11). Prázdna tabuľka bez
 *     vysvetlenia sa číta ako „taký produkt neexistuje", hoci zrkadlo pozná
 *     z produktu len názov a číslo.
 *
 * ZRKADLO MUSÍ SEDIEŤ S MOCKOM (24. 8. 2026). Tabuľka si pre viditeľnú stránku
 * sama vypýta `POST /api/catalog/details` a kus, ktorý shop nepozná, sa podľa
 * D49 označí `shop_status = 'not_found'` — predvolený filter „Ktoré eshop pozná"
 * ho potom skryje a hľadanie nad ním vráti nulu. Riadky nasadené do
 * `catalog_cache` preto MUSIA byť aj v katalógu mocku (`control.setProducts`),
 * s tým istým názvom a cenou: doťahovanie detailu ich do zrkadla prepíše.
 * Bez toho tento súbor netestuje hľadanie, ale mlčky prázdnu tabuľku.
 *
 * Test NEKLIKÁ na „Dohľadať v eshope" — to je platené volanie do eshopu
 * a scenár o jeho výsledku patrí k mocku hľadania (`hladanie-produktov.spec.ts`).
 * Tu sa overuje, že ponuka existuje a je dosiahnuteľná.
 *
 * Vlastník: V15 (hľadanie a tabuľka).
 */
import { expect, test, type Control, type DbHelper } from './fixtures';

/** Zrkadlo je zámerne NEÚPLNÉ — presne to spúšťa značku `≈`. */
const MIRROR = [
  { id: 901, name: 'Strieborná retiazka Lumen 45 cm', price: 34.9 },
  { id: 902, name: 'Zlatý prsteň Lumen s briliantom', price: 129.0 },
  { id: 903, name: 'Strieborné náušnice Aria', price: 19.5 },
] as const;

const SHOP_TOTAL = 41_082;

/**
 * Zrkadlo pre hľadanie viacerých slov. Prvé dva názvy majú OBE slová, ale ani
 * jeden ich nemá vedľa seba v tom poradí, v akom ich človek napíše — jeden
 * súvislý podreťazec by z nich nenašiel ani jeden. Ďalšie dva majú vždy len
 * jedno zo slov, takže strážia, že spojka je `AND` a nie `OR`.
 */
const SLOVA = [
  { id: 911, name: 'Strieborný náramok so zirkónmi 19 cm', price: 24.9 },
  { id: 912, name: 'Zirkónový náramok Aria', price: 29.9 },
  { id: 913, name: 'Zlatý náramok Lumen', price: 149.0 },
  { id: 914, name: 'Zirkónové náušnice Aria', price: 18.5 },
] as const;

/**
 * Vloží riadky do zrkadla katalógu — a do katalógu mocku, aby ich shop poznal.
 * Poradie je jedno; dôvod, prečo obe, je v hlavičke súboru.
 */
async function seedMirror(
  db: DbHelper,
  control: Control,
  rows: readonly { id: number; name: string; price: number }[],
): Promise<void> {
  await control.setProducts(rows.map((row) => ({ id: row.id, name: row.name, price: row.price })));
  for (const product of rows) {
    await db.query(
      'INSERT INTO catalog_cache (product_id, name, price, has_attributes, source, fetched_at) ' +
        'VALUES (?, ?, ?, 0, ?, UTC_TIMESTAMP(3)) ' +
        'ON DUPLICATE KEY UPDATE name = VALUES(name), price = VALUES(price), ' +
        'fetched_at = UTC_TIMESTAMP(3)',
      [product.id, product.name, product.price, 'list'],
    );
  }
}

/** Vráti `catalog_sync_state` do východiska — `db.reset()` ho nečistí. */
async function resetSyncState(db: DbHelper): Promise<void> {
  await db.query(
    'UPDATE catalog_sync_state SET per_page = 100, last_page = 0, shop_total = NULL, ' +
      'rows_written = 0, completed = 0, started_at = NULL, last_read_at = NULL, ' +
      'finished_at = NULL, paused_until = NULL, pause_reason = NULL, last_error = NULL ' +
      'WHERE id = 1',
  );
}

test.describe('produkty — hľadanie, počet zhôd a výber', () => {
  test('výber prežije prechod na iný tab, ponuka dohľadania nezmizne', async ({
    page,
    db,
    control,
  }) => {
    await seedMirror(db, control, MIRROR);

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

  /**
   * DVE SLOVÁ NIE SÚ FRÁZA.
   *
   * Do 19. 8. 2026 išiel celý text do jediného `LIKE '%…%'`, teda sa hľadala
   * súvislá fráza v presnom poradí. Na živých dátach to znamenalo, že
   * „náramok zirkón" našlo 10 produktov z 797, ktoré obe slová naozaj majú.
   * Zrkadlo je tu ÚPLNÉ, aby sa popri tom overilo aj druhé číslo v hlavičke:
   * nad dočítaným katalógom sú to „produkty", nie „načítané riadky", a `≈`
   * pri počte zhôd nemá čo robiť.
   */
  test('hľadanie dvoch slov nájde obe bez ohľadu na poradie a diakritiku', async ({
    page,
    db,
    control,
  }) => {
    await seedMirror(db, control, SLOVA);
    await db.query(
      'UPDATE catalog_sync_state SET per_page = 100, last_page = 1, shop_total = ?, ' +
        'rows_written = ?, completed = 1, started_at = UTC_TIMESTAMP(3), ' +
        'last_read_at = UTC_TIMESTAMP(3), finished_at = UTC_TIMESTAMP(3), paused_until = NULL, ' +
        'pause_reason = NULL, last_error = NULL WHERE id = 1',
      [SLOVA.length, SLOVA.length],
    );

    try {
      await page.goto('/produkty');
      await expect(page.getByTestId('catalog-table')).toBeVisible();

      /* 1. Dočítané zrkadlo: presné číslo bez `≈` (kontrakt bod 8 z druhej
            strany). Slovo „produktov" sa overuje až v kroku 3a — pri rovnosti
            oboch čísel appka druhé číslo zámerne NEPÍŠE (bod 17, W2,
            20. 8. 2026: „4 z 4 produktov" hovorí to isté dvakrát). */
      const matching = page.getByTestId('catalog-matching');
      await expect(matching).not.toContainText('≈', { timeout: 15_000 });
      await expect(matching).toContainText(String(SLOVA.length));

      /* 2. Pole priznáva, kde hľadá — a kde nie. */
      await expect(page.getByTestId('catalog-search-hint')).toContainText(
        'Hľadá v názve a čísle; kód nájde eshop.',
      );

      const riadky = page.locator('table.tbl tbody tr');

      /* 3. Dve slová, ktoré v žiadnom názve nestoja vedľa seba. Fráza by
            nenašla nič; slovo po slove sú to dva produkty. */
      await page.getByTestId('catalog-search').fill('náramok zirkón');
      await expect(riadky).toHaveCount(2, { timeout: 15_000 });
      await expect(riadky.nth(0)).toContainText('náramok');
      await expect(riadky.nth(1)).toContainText('náramok');
      // `AND`, nie `OR`: náramok bez zirkónu ani zirkón bez náramku sa neráta.
      await expect(page.locator('table.tbl tbody')).not.toContainText('Lumen');
      await expect(page.locator('table.tbl tbody')).not.toContainText('náušnice');

      /* 3a. Teraz sú čísla rôzne (2 z 4), takže druhé číslo je na obrazovke —
             a nad DOČÍTANÝM zrkadlom sú to „produkty", nie „načítané riadky".
             To je celý zmysel bodu 8: slovo „načítaných" priznáva výsek
             katalógu a nad úplným katalógom by klamalo opačným smerom. */
      await expect(matching).toContainText(`z ${String(SLOVA.length)} produktov`);
      await expect(matching).not.toContainText('načítaných');

      /* 4. Poradie slov je jedno. */
      await page.getByTestId('catalog-search').fill('zirkón náramok');
      await expect(riadky).toHaveCount(2, { timeout: 15_000 });

      /* 5. Diakritika sa nerieši v kóde — skladá ju kolácia
            `utf8mb4_unicode_ci`. Bez nej by tento krok vrátil nulu. */
      await page.getByTestId('catalog-search').fill('naramok zirkon');
      await expect(riadky).toHaveCount(2, { timeout: 15_000 });

      /* 6. Jedno slovo naďalej funguje ako predtým. */
      await page.getByTestId('catalog-search').fill('náramok');
      await expect(riadky).toHaveCount(3, { timeout: 15_000 });
    } finally {
      await resetSyncState(db);
    }
  });

  /**
   * PRÁZDNY VÝSLEDOK MUSÍ POVEDAŤ, KDE SA HĽADALO (kontrakt bod 11).
   *
   * Zrkadlo pozná z produktu len názov a číslo — kód, popis ani kategórie
   * v ňom fyzicky nie sú. Prázdna tabuľka bez tejto vety sa preto číta ako
   * „taký produkt neexistuje", čo je tvrdenie, ktoré appka nemá čím kryť.
   */
  test('prázdny výsledok hľadania priznáva, kde sa hľadalo, a ponúka eshop', async ({
    page,
    db,
    control,
  }) => {
    await seedMirror(db, control, SLOVA);
    await db.query(
      'UPDATE catalog_sync_state SET per_page = 100, last_page = 1, shop_total = ?, ' +
        'rows_written = ?, completed = 1, started_at = UTC_TIMESTAMP(3), ' +
        'last_read_at = UTC_TIMESTAMP(3), finished_at = UTC_TIMESTAMP(3), paused_until = NULL, ' +
        'pause_reason = NULL, last_error = NULL WHERE id = 1',
      [SLOVA.length, SLOVA.length],
    );

    try {
      await page.goto('/produkty');
      await expect(page.getByTestId('catalog-table')).toBeVisible();

      /* Kód produktu, ktorý zrkadlo nemá ako poznať. */
      await page.getByTestId('catalog-search').fill('REF-000123');

      const empty = page.getByTestId('catalog-empty');
      await expect(empty).toBeVisible({ timeout: 15_000 });

      /* 1. Kde sa hľadalo, ku ktorému okamihu a čo pozná len eshop. */
      await expect(empty).toContainText('v názve a čísle produktu');
      await expect(empty).toContainText('kód produktu, popis a kategórie pozná iba eshop');
      /* Konkrétny čas a dátum, nie „nedávno" (kontrakt bod 10). */
      await expect(empty).toContainText(/stav k \d{1,2}\. \d{1,2}\. \d{4}, \d{2}:\d{2}/);
      /* Dočítané zrkadlo o sebe netvrdí, že mu niečo chýba. */
      await expect(empty).not.toContainText('zatiaľ nemá celý katalóg');

      /* 2. Jedno tlačidlo a je to ďalší krok, nie ďalšia dávka riadkov. */
      await expect(page.getByTestId('catalog-empty-lookup')).toBeEnabled({ timeout: 15_000 });
      await expect(page.getByTestId('catalog-empty-load')).toBeHidden();
    } finally {
      await resetSyncState(db);
    }
  });
});
