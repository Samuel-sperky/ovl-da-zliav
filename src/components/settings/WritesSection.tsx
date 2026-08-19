'use client';

/**
 * Aura Zľavy — ZÁPISY DO ESHOPU (Nastavenia, skupina „Čo appka smie robiť").
 *
 * Sekcia odpovedá na otázku, ktorú si používateľ kládol najčastejšie: PREČO SA
 * NIČ NEZAPÍSALO. Doteraz sa to dalo zistiť jedine z logu — appka vedela, že
 * zápisy nie sú povolené, ale nikde to nepovedala. Tu sú vedľa seba všetky tri
 * podmienky, ktoré musia platiť naraz, a pri každej stav aj ďalší krok.
 *
 * TRI VECI, KTORÉ SA TU NESMÚ POKAZIŤ
 * -----------------------------------
 * 1. **Vypnuté zápisy NIE SÚ chyba a musí to byť napísané.** Appka sa takto
 *    dodáva zámerne, aby prvý ostrý zápis do produkčného eshopu nevznikol
 *    omylom. Obrazovka to má povedať tou istou vetou ako dôvod — inak si
 *    používateľ myslí, že je appka pokazená, a začne ju „opravovať".
 * 2. **Obrazovka NEPREDSTIERA, že sa to dá prepnúť odtiaľto.** Povolenie
 *    zapisovať žije v konfigurácii appky na počítači, nie v databáze, takže tu
 *    nie je a nikdy nebude tlačidlo. Falošný prepínač, ktorý „nič nerobí", je
 *    horší než priznanie, že sa to robí inde.
 * 3. **Vety o prekážkach sa tu neskladajú.** Prichádzajú hotové zo servera
 *    z jediného zdroja pravdy (`lib/status/blockers.ts`) aj s číslami a ďalším
 *    krokom; tento súbor k nim dopĺňa len tón a poradie riadkov.
 *
 * Runaway zámok (tretí riadok) v zozname prekážok NIE JE — `blockers.ts` ho
 * nepozná, lebo nevzniká z limitov eshopu, ale z poistky appky. Preto sa
 * jediný odvodzuje priamo zo stavu a odkazuje do Poistiek, kde sa otvára.
 *
 * Vlastník: V12.
 */
import Note from '@/components/ui/Note';
import StatusPill from '@/components/ui/StatusPill';
import Icon from '@/components/ui/Icon';
import { TONE_ICON, type StatusTone } from '@/components/ui/ToneBadge';
import { formatDateTimeSk } from '@/lib/ui/format';
import {
  ASSUMED_NOTE,
  TONE_SIG_CLASS,
  blockerTone,
  pickBlocker,
} from '@/components/settings/blockers-view';
import type { SettingsView, StatusPayload } from '@/components/settings/api';

/** Jedna z troch podmienok, ktoré musia platiť naraz, aby appka zapísala. */
export interface WriteCondition {
  readonly key: 'povolenie' | 'kluc' | 'poistka';
  /** Čo sa kontroluje — krátko, slovensky. */
  readonly label: string;
  /** Stav ako SLOVO. Nikdy len farba. */
  readonly state: string;
  readonly tone: StatusTone;
  /** Čo sa deje. `null` = podmienka platí a niet čo dodať. */
  readonly what: string | null;
  /** Konkrétny ďalší krok. `null` = netreba nič. */
  readonly nextStep: string | null;
  /** Kotva na tejto stránke, kde sa to rieši. `null` = rieši sa mimo appky. */
  readonly anchor: string | null;
  /** `true` = veta stojí na bezpečnom predpoklade, nie na prečítanom údaji. */
  readonly assumed: boolean;
}

/**
 * Tri podmienky zápisu z jedného stavu.
 *
 * Čistá funkcia zámerne: presne tu sa dá ticho pokaziť, že obrazovka povie
 * „všetko je v poriadku" nad stavom, ktorý sa nepodarilo prečítať. Neznámy
 * údaj preto NIKDY nekončí ako „platí" — vždy ako priznaná domnienka.
 */
export function writeConditions(
  status: StatusPayload | null,
  settings: SettingsView,
): readonly WriteCondition[] {
  const blockers = status?.blockers ?? null;

  /* 1. Povolenie zapisovať — poistka mimo appky. */
  const permission = pickBlocker(blockers, ['writes_disabled']);
  const enabled = status?.writes.enabled ?? null;
  const povolenie: WriteCondition =
    enabled === true
      ? {
          key: 'povolenie',
          label: 'Povolenie zapisovať do eshopu',
          state: 'zapnuté',
          tone: 'good',
          what: null,
          nextStep: null,
          anchor: null,
          assumed: false,
        }
      : {
          key: 'povolenie',
          label: 'Povolenie zapisovať do eshopu',
          state: enabled === false ? 'vypnuté' : 'zatiaľ neviem',
          tone: permission === null ? 'attention' : blockerTone(permission),
          what:
            permission?.what ??
            'Stav povolenia sa nepodarilo prečítať — kým to appka nevie, správa sa, akoby zapisovať nesmela.',
          nextStep:
            permission?.nextStep ??
            'Skús obrazovku o chvíľu obnoviť; dovtedy appka do eshopu nezapíše nič.',
          anchor: null,
          assumed: permission?.assumed ?? true,
        };

  /* 2. Kľúč na zápis — jediná podmienka, ktorú vyrieši používateľ sám tu. */
  const key = pickBlocker(blockers, ['key_missing', 'key_expired', 'key_expires_soon']);
  const present = status?.apiKey.present ?? null;
  const kluc: WriteCondition =
    key === null
      ? {
          key: 'kluc',
          label: 'Kľúč na zápis zliav',
          state: present === true ? 'vložený a platný' : 'zatiaľ neviem',
          tone: present === true ? 'good' : 'attention',
          what:
            present === true
              ? null
              : 'Stav kľúča sa nepodarilo prečítať — appka s ním preto nepočíta.',
          nextStep: present === true ? null : 'Skús obrazovku o chvíľu obnoviť.',
          anchor: '#kluce',
          assumed: present !== true,
        }
      : {
          key: 'kluc',
          label: 'Kľúč na zápis zliav',
          state:
            key.id === 'key_missing'
              ? 'chýba'
              : key.id === 'key_expired'
                ? 'už neplatí'
                : 'čoskoro vyprší',
          tone: blockerTone(key),
          what: key.what,
          nextStep: key.nextStep,
          anchor: '#kluce',
          assumed: key.assumed,
        };

  /* 3. Runaway zámok — poistka appky, nie limit eshopu (viď doc-blok). */
  const locked = status?.writes.locked ?? settings.writesLocked;
  const lockedReason = status?.writes.lockedReason ?? settings.writesLockedReason;
  const poistka: WriteCondition =
    locked === true
      ? {
          key: 'poistka',
          label: 'Poistka proti príliš rýchlym zápisom',
          state: 'zápisy sú zastavené',
          tone: 'critical',
          what:
            lockedReason === null || lockedReason === ''
              ? 'Appka sa sama zastavila, lebo zapisovala rýchlejšie, než je bezpečné.'
              : `Appka sa sama zastavila. Dôvod: ${lockedReason}.`,
          nextStep:
            'Otvoriť sa to dá jedine ručne heslom v Poistkách — appka sa nikdy neodomkne sama.',
          anchor: '#poistky',
          assumed: false,
        }
      : {
          key: 'poistka',
          label: 'Poistka proti príliš rýchlym zápisom',
          state: 'nezasiahla',
          tone: 'good',
          what: null,
          nextStep: null,
          anchor: '#poistky',
          assumed: false,
        };

  return [povolenie, kluc, poistka];
}

export interface WritesSectionProps {
  status: StatusPayload | null;
  settings: SettingsView;
}

export function WritesSection({ status, settings }: WritesSectionProps) {
  const conditions = writeConditions(status, settings);
  const enabled = status?.writes.enabled ?? null;
  const blocked = conditions.some((c) => c.tone === 'critical' || c.tone === 'attention');

  return (
    <section className="sec" id="zapisy" data-testid="writes-section">
      <div className="sec-h">
        <h2>Zápisy do eshopu</h2>
        <div className="act lvl-3">Musia platiť všetky tri naraz</div>
      </div>

      <div className="set-pill-row">
        <StatusPill
          tone={enabled === true ? 'good' : enabled === false ? 'critical' : 'attention'}
          label={
            enabled === true
              ? 'Appka smie zapisovať'
              : enabled === false
                ? 'Appka teraz nezapíše nič'
                : 'Stav zápisov zatiaľ neviem'
          }
          detail={settings.shopDomain}
          testId="writes-pill"
        />
        <p className="set-note">
          {blocked
            ? 'Kým niektorá z podmienok neplatí, fronta počká. Nič sa nestratí a nič sa nezapíše ' +
              'napoly — zľavy, ktoré čakajú, sa zapíšu hneď, ako podmienka začne platiť.'
            : 'Všetky tri podmienky platia. Fronta zapisuje podľa denného rozpočtu, ' +
              'jeden produkt za druhým.'}
        </p>
      </div>

      {enabled === false ? (
        <Note variant="warn" testId="writes-disabled-note">
          <b>Nie je to chyba.</b> Appka sa dodáva s vypnutým zápisom zámerne, aby prvý
          ostrý zápis do eshopu nikdy nevznikol náhodou. Povolenie žije v konfigurácii
          appky na tomto počítači, nie v jej nastaveniach — <b>z tejto obrazovky sa
          prepnúť nedá a ani nemá</b>. Prepne ho ten, kto appku na počítači spustil:
          v konfiguračnom súbore povolí zápis a appku reštartuje. Presné názvy sú
          v technickom detaile nižšie.
        </Note>
      ) : null}

      <div className="tbl-frame">
        <table className="tbl plain">
          <thead>
            <tr>
              <th>Podmienka</th>
              <th>Stav</th>
              <th>Čo s tým</th>
            </tr>
          </thead>
          <tbody data-testid="writes-conditions">
            {conditions.map((condition) => (
              <tr key={condition.key} data-testid={`writes-condition-${condition.key}`}>
                <td className="name">{condition.label}</td>
                <td data-l="Stav">
                  <span className={TONE_SIG_CLASS[condition.tone]}>{condition.state}</span>
                </td>
                <td data-l="Čo s tým">
                  {condition.what === null ? (
                    <span className="lvl-3">netreba nič</span>
                  ) : (
                    <>
                      <div>{condition.what}</div>
                      {condition.nextStep === null ? null : (
                        <div className="lvl-3">{condition.nextStep}</div>
                      )}
                      {condition.anchor === null ? null : (
                        <a className="set-jump" href={condition.anchor}>
                          Prejsť na to
                        </a>
                      )}
                      {condition.assumed ? (
                        <div className="lvl-3">
                          <Icon name={TONE_ICON.attention} size={0.85} /> {ASSUMED_NOTE}
                        </div>
                      ) : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tbl-foot">
          <span>
            Appka zľavu nikdy nezruší — to platí bez ohľadu na tieto tri podmienky. Zapísaná
            zľava vyprší sama v deň, ktorý má nastavený.
          </span>
        </div>
      </div>

      <details className="tech">
        <summary>Technický detail</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td>Súbor s konfiguráciou</td>
                <td className="mono">.env</td>
              </tr>
              <tr>
                <td>Povolenie zápisu</td>
                <td className="mono">WRITES_ENABLED=true</td>
              </tr>
              <tr>
                <td>Druhá polovica poistky</td>
                <td className="mono">NODE_ENV=production</td>
              </tr>
              <tr>
                <td>Po zmene</td>
                <td>appku treba reštartovať, inak zmena neplatí</td>
              </tr>
              <tr>
                <td>Zámok appky</td>
                <td>
                  {status?.writes.locked === true
                    ? `zamknuté od ${formatDateTimeSk(status.writes.lockedAt)}`
                    : 'otvorený'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export default WritesSection;
