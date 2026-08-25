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
 * 4. **Dlaždica „Po uvoľnení by prešlo" sa nesmie stratiť.** Používateľ mesiace
 *    nevedel, že strop desiatich produktov je prepínač a že strop plného
 *    rozsahu je už uložený na tisícoch — a nevedel to preto, že obrazovka
 *    ukazovala výhradne to, čo platí TERAZ. Číslo, ktoré by platilo po
 *    prepnutí, je celý dôvod, prečo sa dá poistka nájsť skôr, než sa do nej
 *    narazí. Tabuľka oboch rozsahov vedľa seba je tá istá vec pre pomalšie
 *    čítanie; ani jedno z toho nie je ozdoba.
 *
 * Appka režimom nič nezapisuje — mení sa len to, čo smie prejsť neskôr cez
 * bránu pred zápisom.
 *
 * Vlastník: V12.
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import Note from '@/components/ui/Note';
import StatTile from '@/components/ui/StatTile';
import SudoPrompt from '@/components/ui/SudoPrompt';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import { SigMark, type SigVariant } from '@/components/ui/StatusMark';
import { formatCountSk } from '@/lib/ui/vocabulary';
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
  /* Trieda aj značka z jednej hodnoty (pozri DiscountDetail) — plný rozsah je
     jantárové upozornenie, pilotný zelené potvrdenie. */
  const scopeSig: SigVariant = full ? 'warn' : 'ok';

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
          <span className={`sig ${scopeSig}`} data-testid="scope-mode-current">
            <SigMark variant={scopeSig} />
            {full ? 'plný rozsah' : 'pilotný rozsah'}
          </span>
        </div>
      </div>

      <Note testId="scope-intro">
        Toto je jediné miesto, kde sa mení, <b>koľko produktov smie mať jedna zľava</b>.
        Strop plného rozsahu je uložený na {formatCountSk(settings.maxProductsPerCampaign)}{' '}
        produktoch, treba ho uvoľniť.
      </Note>

      <div className="kpis">
        <StatTile
          label="Teraz platí"
          value={`${SCOPE_MODE_LABELS[mode]} rozsah`}
          detail={full ? 'produkt musí byť v katalógu' : 'len povolené produkty'}
          testId="scope-mode-tile"
        />
        <StatTile
          label="Najviac na jednu zľavu"
          value={`${formatCountSk(settings.maxProducts)} produktov`}
          detail="strop stráži aj databáza"
          testId="scope-max"
        />
        <StatTile
          label={full ? 'Po sprísnení by prešlo' : 'Po uvoľnení by prešlo'}
          value={`${formatCountSk(full ? settings.pilotMaxProducts : settings.maxProductsPerCampaign)} produktov`}
          detail={full ? 'návrat do pilotného rozsahu, bez hesla' : 'uložený strop plného rozsahu'}
          testId="scope-other"
        />
      </div>

      <div className="tbl-frame">
        <table className="tbl plain">
          <thead>
            <tr>
              <th>Rozsah</th>
              <th>Najviac na jednu zľavu</th>
              <th>Ktorý produkt prejde</th>
              <th>Ako sa naň prepne</th>
            </tr>
          </thead>
          <tbody data-testid="scope-modes">
            <tr>
              <td className="name">
                pilotný{' '}
                {full ? null : (
                  <span className="sig ok" data-testid="scope-row-pilot">
                    <SigMark variant="ok" />
                    teraz platí
                  </span>
                )}
              </td>
              <td data-l="Najviac na jednu zľavu">
                {formatCountSk(settings.pilotMaxProducts)} produktov
              </td>
              <td data-l="Ktorý produkt prejde">len ten, ktorý je v zozname povolených</td>
              <td data-l="Ako sa naň prepne">sprísnenie je vždy voľné, heslo netreba</td>
            </tr>
            <tr>
              <td className="name">
                plný{' '}
                {full ? (
                  <span className="sig ok" data-testid="scope-row-full">
                    <SigMark variant="ok" />
                    teraz platí
                  </span>
                ) : null}
              </td>
              <td data-l="Najviac na jednu zľavu">
                {formatCountSk(settings.maxProductsPerCampaign)} produktov
              </td>
              <td data-l="Ktorý produkt prejde">každý, ktorý appka vidí vo svojom katalógu</td>
              <td data-l="Ako sa naň prepne">uvoľnenie si vypýta heslo</td>
            </tr>
          </tbody>
        </table>
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
          {/* Rovnaký tvar ako pri opačnom prechode vyššie: tlačidlo a vedľa
              neho jedno slovo o hesle. Čo sa pri sprísnení stane s už
              zapísanými zľavami, stojí pod rozklikom (P6) — na povrchu by to
              bol štvrtý odstavec tejto sekcie. */}
          <div className="row">
            <Button
              onClick={() => void switchTo('pilot')}
              disabled={busy}
              data-testid="scope-confirm-pilot"
            >
              {busy ? 'Prepínam…' : 'Vrátiť pilotný rozsah'}
            </Button>
            <span className="lvl-3">heslo netreba</span>
          </div>
        </div>
      )}

      <ActionFailurePanel failure={failure} testId="scope-failure" />

      <details className="tech">
        <summary>Technický detail</summary>
        <div className="body">
          {/* Dve vety, ktoré do 24. 8. 2026 stáli na povrchu sekcie: pätka pod
              tabuľkou a odstavec nad tlačidlom „Vrátiť pilotný rozsah". Obe
              boli nad stropom P2 (99 a 150 znakov) a obe hovoria o dôsledku,
              nie o tom, čo teraz platí. Nezmizli — sú o jedno kliknutie ďalej
              (P6). Kto ich vráti na povrch, poruší P2. */}
          <p data-testid="scope-why-no-write">
            Zmena rozsahu nezapíše ani nezruší nič. Mení len to, čo appka pustí pri
            najbližšom potvrdení zľavy.
          </p>
          <p data-testid="scope-why-pilot-free">
            Sprísnenie je vždy voľné: návrat do pilotného rozsahu heslo nevyžaduje. Už
            zapísané zľavy zostanú v eshope a dobehnú — appka ich zrušiť nedokáže.
          </p>
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
    </section>
  );
}

export default ScopeModeForm;
