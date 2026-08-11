/**
 * Aura Zľavy — e2e: prvé spustenie a fail-closed doména (A18, D20, D55, D80).
 *
 * ZMENA V3 (V12, architektúra §3): onboarding prestal byť štvorkrokový
 * sprievodca so zámkami. Je to jedna obrazovka s tromi kartami — adresa
 * eshopu, kľúč na zápis, prvá zľava — a každá karta len POVIE, ako na tom
 * appka je, a pošle človeka tam, kde sa to nastavuje. Kroky sa preto už
 * nezamykajú (`step-N-state` v UI neexistuje) a allowlist zanikol úplne
 * (K1: strop rozsahu nahradil `scope_mode`).
 *
 * Čo z pôvodných tvrdení PLATÍ ĎALEJ a testuje sa tu:
 *
 *  1. **Onboarding nikdy nič nezapíše do eshopu** (D20, I3). Je to
 *     rozcestník, nie akcia — počet zápisov na mocku sa počas neho nesmie
 *     pohnúť ani o jeden.
 *  2. **Doména sa bez úspešného canary čítania NEULOŽÍ** (D55). Formulár sa
 *     presťahoval do Nastavení (`#pripojenie`), invariant je nedotknutý.
 *  3. Stavy kariet sú MERANÉ, nie predvolené: kým sa nevie, či kľúč je,
 *     appka nepíše „chýba" (P7).
 */
import { expect, login, storeApiKey, test } from './fixtures';
import { E2E_CONFIG } from './config';

test.describe('prvé spustenie', () => {
  test.beforeEach(async ({ db }) => {
    // Začína sa od nuly — doména ešte nie je potvrdená.
    await db.query(
      'UPDATE settings SET shop_domain = NULL, shop_domain_confirmed_at = NULL WHERE id = 1',
    );
  });

  test('tri karty povedia, čo chýba — a nič pri tom nezapíšu', async ({ page, control }) => {
    const before = await control.state();

    await login(page);
    await page.goto('/onboarding');
    const onboarding = page.getByTestId('onboarding');
    await expect(onboarding).toBeVisible();

    // Bez domény aj bez kľúča: obe karty priznajú, že chýbajú.
    await expect(onboarding).toContainText('Adresa eshopu');
    await expect(onboarding).toContainText('Kľúč na zápis zliav');
    await expect(onboarding).toContainText('Prvá zľava');
    await expect(onboarding.locator('.sig.warn').first()).toBeVisible();

    // D20 — rozcestník, nie akcia. Nikam sa nezapisuje a hovorí to nahlas.
    await expect(onboarding).toContainText('Táto stránka nič nezapisuje');
    expect((await control.state()).writeCount).toBe(before.writeCount);

    // Po vložení kľúča karta zmení stav na „vložený" — je to meraný fakt.
    await storeApiKey(page);
    await page.goto('/onboarding');
    await expect(onboarding).toContainText('vložený');
  });

  test('D55: doména sa bez úspešného canary čítania NEULOŽÍ', async ({ page, db }) => {
    await login(page);
    // Formulár domény býval v onboardingu; od V3 má jediné miesto — Nastavenia.
    await page.goto('/nastavenia#pripojenie');

    // Doména musí byť https (D80) a canary GET ide proti KANDIDÁTSKEJ doméne,
    // nie cez mock override — na `.invalid` host sa spojenie nedá vytvoriť (I6),
    // takže canary zlyhá a doména sa fail-closed neuloží.
    await page.getByTestId('domain-input').fill(E2E_CONFIG.shopDomain);
    await page.getByTestId('domain-password').fill(E2E_CONFIG.adminPassword);
    await page.getByTestId('domain-save').click();

    // Chybová hláška patrí formuláru domény. `getByRole('alert')` globálne by
    // trafilo aj `ProductionBar` (tiež `role="alert"`) → strict mode violation.
    await expect(page.getByTestId('domain-form').getByRole('alert')).toBeVisible();
    const rows = await db.query<{ shop_domain: string | null }>(
      'SELECT shop_domain FROM settings WHERE id = 1',
    );
    expect(rows[0].shop_domain).toBeNull();
  });
});
