/**
 * Aura Zľavy — dashboard (D1).
 *
 * MINIMÁLNY PLACEHOLDER od A0. Vlastníctvo PREBERÁ A13: `KeyCard`,
 * `AlertsBanner` (agregované `needs_key` + `missed` s rovnakou váhou — D8/D33b),
 * `UnackedResults` (D17), `CampaignsMini`, `AllowlistGrid` s badge
 * „podľa vlastného zápisu z DD.MM." (D7, I11).
 *
 * A0 tu ÚMYSELNE nečíta z DB ani z API — skeleton nesmie obsahovať business
 * logiku a `next build` nesmie závisieť od bežiacej databázy.
 */
import { APP_DISPLAY_NAME, APP_VERSION } from '@/version';

export default function DashboardPlaceholderPage() {
  return (
    <main>
      <h1>{APP_DISPLAY_NAME}</h1>
      <p>
        Skeleton verzie <code>{APP_VERSION}</code>. Dashboard dodá úloha A13.
      </p>
      <p>
        Appka je dostupná výhradne lokálne cez Caddy na <code>127.0.0.1:3050</code>.
      </p>
    </main>
  );
}
