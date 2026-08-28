/**
 * Aura Zľavy — e2e: panic button „kľúč unikol" (A18, D67, R5).
 *
 * Panic vyžaduje doslovný literál `KLUC UNIKOL` vypísaný rukou. Do 27. 8. 2026
 * k nemu chcel aj heslo; heslá zmizli (D99), potvrdenie literálom zostáva
 * nedotknuté — je to ono „potvrdenie" z I3. Po vykonaní je kľúč
 * z appky wipnutý, čakajúce kampane zrušené, appka je len na čítanie a UI
 * zobrazí runbook — appka kľúč revokovať NEVIE a nesmie to tvrdiť.
 *
 * KDE PANIC BÝVA: `/nastavenia/cervena-zona`, nie `/nastavenia`. Nastavenia sú
 * od 19. 8. 2026 rozcestník s podstránkami (`components/settings/sub-pages.ts`,
 * slug `cervena-zona`) a červená zóna sa naň zámerne nedostane ani ako
 * dlaždica (kontrakt UI, bod 14). Scenár preto ide rovno na podstránku — na
 * rozcestníku by `panic-open` nebol a čakalo by sa na neho do timeoutu.
 */
import type { Page } from '@playwright/test';

import { expect, storeApiKey, test } from './fixtures';

const PRODUCT = 201;
const PANIC_LITERAL = 'KLUC UNIKOL';

/** Podstránka Nastavení, na ktorej červená zóna žije (slug `cervena-zona`). */
const CERVENA_ZONA = '/nastavenia/cervena-zona';

/**
 * Otvorí červenú zónu tak, ako sa k nej dostane človek.
 *
 * Aj na vlastnej podstránke je celá sekcia ešte za rozklikom (kontrakt UI,
 * bod 14) — `panic-open` v DOM je, ale nie je vidieť. Scenár ho preto
 * neklikne „cez" zavretý rozklik: otvorí ho, a tým zároveň tvrdí, že tá brzda
 * pred najnebezpečnejšou akciou appky stále existuje.
 */
async function openCervenaZona(page: Page): Promise<void> {
  await page.goto(CERVENA_ZONA);
  const disclosure = page.getByTestId('danger-zone-disclosure');
  await expect(page.getByTestId('panic-open')).toBeHidden();
  await disclosure.locator('summary').click();
  await expect(page.getByTestId('panic-open')).toBeVisible();
}

function dateOnly(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

test.describe('panic button', () => {
  test('bez presného literálu sa nedá odoslať', async ({ page }) => {
    await storeApiKey(page);

    await openCervenaZona(page);
    await page.getByTestId('panic-open').click();
    await page.getByTestId('panic-confirm').fill('kluc unikol'); // malé písmená
    await expect(page.getByTestId('panic-submit')).toBeDisabled();

    await page.getByTestId('panic-confirm').fill(PANIC_LITERAL);
    await expect(page.getByTestId('panic-submit')).toBeEnabled();
  });

  test('panic wipne kľúč, zruší čakajúce kampane a ukáže runbook', async ({ page, db }) => {
    await storeApiKey(page);
    await db.seedAllowlist([PRODUCT]);

    const pendingCampaignId = await db.seedCampaign({
      name: 'Naplánovaná zľava',
      percent: 10,
      from: dateOnly(2),
      to: dateOnly(9),
      status: 'scheduled',
      mode: 'scheduled',
      items: [{ productId: PRODUCT, status: 'pending' }],
    });

    await openCervenaZona(page);
    await page.getByTestId('panic-open').click();
    await page.getByTestId('panic-confirm').fill(PANIC_LITERAL);
    await page.getByTestId('panic-submit').click();

    const result = page.getByTestId('panic-result');
    await expect(result).toBeVisible();
    // V3 (K10): panic maže OBA kľúče a hovorí to po slovensky — „wipe" je
    // vnútorné slovo a na povrchu nemá čo robiť.
    await expect(result).toContainText('Kľúče sú zmazané');
    // R5 — appka NESMIE tvrdiť, že kľúč revokovala; vie ho len zabudnúť a musí
    // poslať používateľa za správcom eshopu. (Pôvodné tvrdenie hľadalo slovo
    // „revok" BEZ negácie, takže presne tú vetu, ktorú R5 zakazuje, vyžadovalo.)
    await expect(result).not.toContainText(/revokoval/i);
    await expect(result).toContainText('appka kľúč zneplatniť nevie');
    await expect(result).toContainText('Kontaktuj správcu eshopu');

    /* D63/I1 — po kľúči nezostane v DB riadok. */
    expect(await db.keyRowCount()).toBe(0);

    /* D67 — čakajúca kampaň je zrušená a nič nebeží automaticky. */
    const rows = await db.query<{ status: string }>('SELECT status FROM campaigns WHERE id = ?', [
      pendingCampaignId,
    ]);
    expect(rows[0].status).toBe('cancelled');

    /* Audit incidentu existuje (I4 — append-only). */
    const audit = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE event_type IN ('key_panic_wipe','key_wiped')",
    );
    expect(Number(audit[0].n)).toBeGreaterThan(0);

    /* Appka je od teraz len na čítanie (D10). */
    await page.goto('/');
    await expect(page.getByTestId('readonly-notice')).toBeVisible();
  });

  test('panic je použiteľný aj bez uloženého kľúča', async ({ page, db }) => {
    await openCervenaZona(page);
    await expect(page.getByTestId('panic-button')).toContainText(
      'Teraz nie je uložený ani jeden kľúč',
    );

    await page.getByTestId('panic-open').click();
    await page.getByTestId('panic-confirm').fill(PANIC_LITERAL);
    await page.getByTestId('panic-submit').click();
    await expect(page.getByTestId('panic-result')).toBeVisible();

    const audit = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'key_panic_wipe'",
    );
    expect(Number(audit[0].n)).toBeGreaterThan(0);
  });
});
