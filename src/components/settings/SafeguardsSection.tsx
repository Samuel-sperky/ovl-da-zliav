'use client';

/**
 * Aura Zľavy — sekcia POISTKY (V12; predloha `design/v3/nastavenia.html`).
 *
 * Zbierka bŕzd, ktoré stoja medzi používateľom a produkčným eshopom. Sú tu
 * spolu zámerne: keď je každá v inom kúte appky, nikto nevie povedať, čo appku
 * v skutočnosti drží.
 *
 * Riadok „počet sa píše ručne" je bez tlačidla, a to nie je nedopatrenie —
 * povinné ručné potvrdenie sa vypnúť NEDÁ a obrazovka to má povedať priamo,
 * nie mlčaním.
 *
 * Vlastník: V12.
 */
import EagerWriteToggle from '@/components/settings/EagerWriteToggle';
import UnlockWritesForm from '@/components/settings/UnlockWritesForm';
import { formatCountSk } from '@/lib/ui/vocabulary';
import type { SettingsView } from '@/components/settings/api';

export interface SafeguardsSectionProps {
  settings: SettingsView;
  onChanged: () => void;
}

export function SafeguardsSection({ settings, onChanged }: SafeguardsSectionProps) {
  return (
    <section className="sec" id="poistky" data-testid="safeguards-section">
      <div className="sec-h">
        <h2>Poistky</h2>
        <div className="act lvl-3">Brzdy pred produkčným eshopom</div>
      </div>

      <div className="kv">
        <span className="k">Strop na jednu zľavu</span>
        <span className="v">{formatCountSk(settings.maxProducts)} produktov</span>
        <span className="lvl-3">mení sa v Rozsahu zliav</span>

        <span className="k">Potvrdenie zápisu</span>
        <span className="v">počet produktov sa píše ručne</span>
        <span className="lvl-3">nedá sa vypnúť</span>

        <span className="k">Rušenie zľavy</span>
        <span className="v">appka zľavu zrušiť nevie</span>
        <span className="lvl-3">zľava vyprší sama</span>

        <EagerWriteToggle enabled={settings.eagerWriteDefault} onChanged={onChanged} />
      </div>

      <div className="set-form">
        <UnlockWritesForm
          writesLocked={settings.writesLocked}
          writesLockedReason={settings.writesLockedReason}
          onUnlocked={onChanged}
        />
      </div>

      <details className="tech">
        <summary>Technický detail</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td>Strop v databáze</td>
                <td className="mono">CHECK items_total &lt;= 10000</td>
              </tr>
              <tr>
                <td>Potvrdenie</td>
                <td className="mono">jednorazový podpísaný token, platnosť 15 min</td>
              </tr>
              <tr>
                <td>Zámok zápisov</td>
                <td className="mono">
                  {settings.writesLocked ? 'zamknuté' : 'otvorené'} · odomyká sa heslom
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export default SafeguardsSection;
