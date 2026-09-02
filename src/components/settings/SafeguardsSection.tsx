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
 * Z toho istého dôvodu je bez tlačidla aj riadok „Čas zápisu". Zápis ide vždy
 * hneď pri potvrdení, aj keď okno zľavy začína až o týždne: podľa odchýlky
 * D33b sa zmeškané spustenie NIKDY nedobehne automaticky, takže čo je zapísané
 * dopredu, to sa nedá zmeškať. Odložený zápis (`mode='scheduled'`) formulár
 * novej zľavy neponúka — a kým ho neponúka, nesmie tu stáť prepínač, ktorý by
 * predstieral, že sa dá zvoliť. (Predvoľba `eagerWriteDefault` v databáze aj
 * `PUT /api/settings/eager-write-default` zostávajú, sú v BUILD-SPEC §5;
 * obrazovka ich len prestala ponúkať, kým ich niekto nezačne čítať.)
 *
 * ČO SA ZMENILO V V6b (a čo nie)
 * ------------------------------
 * Rám je `Panel` + `PanelHead` (D142, D143), geometria v
 * `settings-sections.module.css`. Kotva `id="poistky"` zostáva — odkazuje na
 * ňu riadok poistky v `WritesSection` a rozcestník podľa nej presmeruje starý
 * odkaz `/nastavenia#poistky`.
 *
 * Mriežka `.kv` zostáva ZÁMERNE globálna a nesťahuje sa do modulu: tie isté
 * tri stopy (popis — hodnota — vysvetlenie) kreslí ešte `DomainForm`
 * a `BudgetSection`, ktoré na primitíva neprešli, a druhá kópia mriežky vedľa
 * prvej by sa po prvej úprave rozišla. Šírky stôp sú meraná oprava
 * (`SETTINGS_CSS`, „prečo hodnota nedostáva 1fr") a stráži ich
 * `nastavenia-suvislost.spec.ts`.
 *
 * Vlastník: V12 (rámec a primitíva: V6b).
 */
import styles from '@/components/settings/settings-sections.module.css';
import UnlockWritesForm from '@/components/settings/UnlockWritesForm';
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel';
import { formatCountSk } from '@/lib/ui/vocabulary';
import type { SettingsView } from '@/components/settings/api';

export interface SafeguardsSectionProps {
  settings: SettingsView;
  onChanged: () => void;
}

export function SafeguardsSection({ settings, onChanged }: SafeguardsSectionProps) {
  return (
    <Panel id="poistky" className={styles.section} data-testid="safeguards-section">
      <PanelHead title="Poistky" subtitle="Brzdy pred produkčným eshopom" />
      <PanelBody>
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

          <span className="k">Čas zápisu</span>
          <span className="v" data-testid="write-time">zľava sa zapíše hneď pri potvrdení</span>
          <span className="lvl-3">odložený zápis sa nedá zvoliť</span>
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
                    {settings.writesLocked ? 'zamknuté' : 'otvorené'} · odomyká sa výslovným
                    potvrdením
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </PanelBody>
    </Panel>
  );
}

export default SafeguardsSection;
