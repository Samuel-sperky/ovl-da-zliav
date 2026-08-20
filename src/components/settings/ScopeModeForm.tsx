'use client';

/**
 * Aura Zľavy — REŽIM ROZSAHU (V12; kontrakt V3, bod K-jedna).
 *
 * Pôvodná poistka „najviac desať produktov" bola brzda pre pilot, nie cieľový
 * stav. Nezanikla — zmenila sa na režim, ktorý sa dá uvoľniť, ale nikdy nie
 * omylom. Táto obrazovka je jediné miesto, kde sa režim mení.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 * 1. **Uvoľnenie stojí heslo, sprísnenie nikdy.** Prechod na plný rozsah si
 *    server vypýta znova heslom; návrat do pilotného ide bez neho, aby sa dala
 *    appka pribrzdiť aj v núdzi. Táto asymetria je celý zmysel poistky a
 *    obrazovka ju nesmie „zjednodušiť" na jeden spoločný dialóg.
 * 2. **Používateľ musí vedieť, čo prepína.** Pred prepnutím na plný rozsah je
 *    na obrazovke doslova napísané, čo prestane platiť: strop desiatich
 *    produktov aj zoznam povolených produktov. Bez toho je to prepínač
 *    s neznámym následkom nad produkčným eshopom.
 * 3. **„Neviem" je pilotný rozsah.** Keď server prizná, že hodnotu nedokázal
 *    prečítať, obrazovka to povie a NEtvrdí, že rozsah je plný.
 *
 * Appka režimom nič nezapisuje — mení sa len to, čo smie prejsť neskôr cez
 * bránu pred zápisom.
 *
 * Vlastník: V12.
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import SudoPrompt from '@/components/ui/SudoPrompt';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import { formatCountSk } from '@/lib/ui/vocabulary';
import PilotAllowlist from '@/components/settings/PilotAllowlist';
import {
  SCOPE_MODE_LABELS,
  SUDO_REQUIRED_CODE,
  postScopeMode,
  type ScopeModeValue,
  type SettingsView,
} from '@/components/settings/api';

export interface ScopeModeFormProps {
  settings: SettingsView;
  onChanged: () => void;
}

export function ScopeModeForm({ settings, onChanged }: ScopeModeFormProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [needSudo, setNeedSudo] = useState(false);
  const [pending, setPending] = useState<ScopeModeValue | null>(null);
  const [confirming, setConfirming] = useState(false);

  const mode = settings.scopeMode;
  const full = mode === 'plny';

  async function switchTo(next: ScopeModeValue) {
    setFailure(null);
    setBusy(true);
    const res = await postScopeMode(next);
    setBusy(false);
    if (res.ok) {
      setPending(null);
      setConfirming(false);
      setFailure(null);
      onChanged();
      return;
    }
    if (res.error.code === SUDO_REQUIRED_CODE) {
      // Vypršané okno hesla NIE JE odhlásenie — pýtame heslo, nie prihlásenie.
      setPending(next);
      setNeedSudo(true);
      return;
    }
    setPending(null);
    setFailure(describeActionFailure(res.error, { action: 'Zmena rozsahu zliav' }));
  }

  return (
    <section className="sec" id="rozsah" data-testid="scope-mode">
      <div className="sec-h">
        <h2>Rozsah zliav</h2>
        <div className="act">
          <span className={`sig ${full ? 'warn' : 'ok'}`} data-testid="scope-mode-current">
            {full ? 'plný rozsah' : 'pilotný rozsah'}
          </span>
        </div>
      </div>

      <div className="kv">
        <span className="k">Teraz platí</span>
        <span className="v">{SCOPE_MODE_LABELS[mode]} rozsah</span>
        <span className="lvl-3">
          {full ? 'produkt musí byť v katalógu' : 'len povolené produkty'}
        </span>

        <span className="k">Najviac na jednu zľavu</span>
        <span className="v" data-testid="scope-max">
          {formatCountSk(settings.maxProducts)} produktov
        </span>
        <span className="lvl-3">strop stráži aj databáza</span>
      </div>

      {settings.scopeFailClosed ? (
        <p className="set-note gap-t" data-testid="scope-fail-closed">
          <b>Hodnotu sa nepodarilo prečítať.</b> Appka preto pracuje v pilotnom
          rozsahu — je to bezpečnejšia možnosť. Nie je to tvrdenie o tom, čo je
          v databáze uložené.
        </p>
      ) : null}

      {!full ? (
        <div className="set-form" data-testid="scope-to-full">
          {!confirming ? (
            <div className="row">
              <Button onClick={() => setConfirming(true)} data-testid="scope-open-full">
                Prejsť na plný rozsah
              </Button>
              <span className="lvl-3">vyžaduje heslo</span>
            </div>
          ) : (
            <>
              <p className="set-note">
                <b>Čo sa zmení.</b> Jedna zľava bude môcť mať až{' '}
                {formatCountSk(settings.maxProductsPerCampaign)} produktov namiesto
                dnešných {formatCountSk(settings.pilotMaxProducts)}. Zoznam povolených
                produktov sa prestane vynucovať — jedinou podmienkou zostane, že
                produkt appka vidí v katalógu. Zápisy do eshopu sú nevratné a týmto
                sa ich rozsah otvára z desiatok na tisíce.
              </p>
              <p className="set-note">
                Naspäť do pilotného rozsahu sa dá kedykoľvek a bez hesla. Zmena sa
                zapíše do histórie aj so starou a novou hodnotou.
              </p>
              <div className="row">
                <Button
                  variant="primary"
                  onClick={() => void switchTo('plny')}
                  disabled={busy}
                  data-testid="scope-confirm-full"
                >
                  {busy ? 'Prepínam…' : 'Áno, prejsť na plný rozsah'}
                </Button>
                <Button onClick={() => setConfirming(false)} disabled={busy}>
                  Ponechať pilotný
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="set-form" data-testid="scope-to-pilot">
          <p className="set-note">
            Sprísnenie je vždy voľné: návrat do pilotného rozsahu heslo
            nevyžaduje. Už zapísané zľavy zostanú v eshope a dobehnú — appka ich
            zrušiť nedokáže.
          </p>
          <div className="row">
            <Button
              onClick={() => void switchTo('pilot')}
              disabled={busy}
              data-testid="scope-confirm-pilot"
            >
              {busy ? 'Prepínam…' : 'Vrátiť pilotný rozsah'}
            </Button>
          </div>
        </div>
      )}

      <ActionFailurePanel failure={failure} testId="scope-failure" />

      <details className="tech">
        <summary>Technický detail</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td>Režim</td>
                <td className="mono">scope_mode={mode}</td>
              </tr>
              <tr>
                <td>Strop</td>
                <td className="mono">
                  effective={settings.maxProducts} · max_products_per_campaign=
                  {settings.maxProductsPerCampaign} · pilot={settings.pilotMaxProducts}
                </td>
              </tr>
              <tr>
                <td>Čítanie</td>
                <td className="mono">
                  {settings.scopeFailClosed ? 'fail-closed default' : 'settings row'}
                </td>
              </tr>
              <tr>
                <td>Audit</td>
                <td className="mono">scope_mode_changed (before/after snapshot)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      {needSudo ? (
        <SudoPrompt
          actionLabel="prechod na plný rozsah zliav"
          onSuccess={() => {
            setNeedSudo(false);
            const next = pending;
            setPending(null);
            if (next !== null) void switchTo(next);
          }}
          onCancel={() => {
            setNeedSudo(false);
            setPending(null);
          }}
        />
      ) : null}

      {/*
        Povolené produkty majú význam LEN v pilotnom režime — tam ich guard
        vyžaduje (K1). V plnom režime rozsah drží katalóg a strop, takže by
        zoznam len mätúco visel na obrazovke.
      */}
      {full ? null : <PilotAllowlist />}
    </section>
  );
}

export default ScopeModeForm;
