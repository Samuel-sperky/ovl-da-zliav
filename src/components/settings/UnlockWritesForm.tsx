'use client';

/**
 * Aura Zľavy — ZÁMOK ZÁPISOV (V12; pôvodne A16).
 *
 * Keď appka zapisuje rýchlejšie, než je bezpečné, sama sa zastaví a zámok
 * zostane, kým ho niekto ručne neotvorí. Appka sa NIKDY neodomkne sama
 * a odomknutie sa zapíše do histórie.
 *
 * ČÍM SA ODOMYKÁ (zmena 27. 8. 2026)
 * ----------------------------------
 * Do 27. 8. 2026 to bolo heslo. Prihlásenie z appky zmizlo (D99, D100), ale
 * odomknutie zápisov do PRODUKČNÉHO eshopu nesmie byť jeden tichý klik — to by
 * nebolo „bez hesla", to by bolo „bez potvrdenia", a potvrdenie I3 vyžaduje aj
 * po zrušení sudo. Heslo preto strieda výslovné zaškrtnutie; server ho žiada
 * ako `confirmed: true` a bez neho vracia 400.
 *
 * Zámok je jedna z dvoch vecí, ktoré smú byť červené (druhá je strata dát).
 * Vyčerpaný denný rozpočet červený NIE JE — to je informácia, nie chyba, a má
 * svoje miesto v sekcii Rozpočet.
 *
 * Kreslí sa vnútri sekcie Poistky; v pokojnom stave je to jeden riadok, po
 * zamknutí sa rozvinie na formulár.
 *
 * OBA STAVY MAJÚ TRI KANÁLY (A3, šprint 20)
 * -----------------------------------------
 * Zamknuté nieslo farbu + značku + slovo, pokojný stav bol holá veta — ten
 * istý údaj (zapisuje sa / nezapisuje sa) mal raz značku a raz nič. Kto
 * hľadal očami značku, v pokojnom stave nenašiel odpoveď a musel prečítať
 * odstavec. Odteraz nesú tri kanály obe vetvy; poučenie o tom, čo sa stane
 * pri zrýchlení, zostáva vetou pod značkou, kam patrí.
 *
 * TRI KANÁLY NESIE OD V6b `ToneBadge`, NIE RUČNÁ `.sig`
 * ----------------------------------------------------
 * Do V6b tu stálo `<span className="sig ok"><SigMark variant="ok" />…`, teda
 * farba, značka a slovo poskladané ručne z troch kusov — a slovník bol vlastný
 * (`ok` / `bad`) namiesto tónov appky (`good` / `critical`). `ToneBadge` je to
 * isté pravidlo ako primitívum: značku vyberá `TONE_ICON` z jedného slovníka
 * a chýbajúce slovo o sebe povie samo (`ui/signals.ts`), čo ručná dvojica
 * nedokázala. Vzniknúť tým nemôže druhý vykresľovač stavu — v tejto sekcii
 * (Poistky) je zámok jediný stav; tabuľkové bunky Kľúčov a Zápisov si `.sig`
 * nechávajú a dôvod je v hlavičke `KeysSection.tsx`.
 *
 * Vlastník: A16 (tri kanály: šprint 20; primitívum: V6b).
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import ToneBadge from '@/components/ui/ToneBadge';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/action-failure';
import { unlockWrites } from '@/components/settings/api';

export interface UnlockWritesFormProps {
  writesLocked: boolean;
  writesLockedReason: string | null;
  onUnlocked: () => void;
}

export function UnlockWritesForm({
  writesLocked,
  writesLockedReason,
  onUnlocked,
}: UnlockWritesFormProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const fail = (error: { code?: string | null; message?: string | null } | null) =>
    setFailure(describeActionFailure(error, { action: 'Odomknutie zápisov' }));

  async function submit() {
    if (!confirmed) {
      fail({
        code: 'validation_failed',
        message: 'Najprv zaškrtni potvrdenie — odomknutie zápisov sa nespustilo.',
      });
      return;
    }
    setFailure(null);
    setBusy(true);
    const res = await unlockWrites();
    setBusy(false);
    if (res.ok) {
      setConfirmed(false);
      setFailure(null);
      onUnlocked();
      return;
    }
    setConfirmed(false);
    fail(res.error);
  }

  if (!writesLocked) {
    return (
      <div className="stack" data-testid="unlock-writes-form">
        <div className="row">
          <ToneBadge tone="good" data-testid="unlock-writes-state">
            Zápisy nie sú zastavené
          </ToneBadge>
        </div>
        <p className="lvl-3">
          Keby appka začala zapisovať rýchlejšie, než je bezpečné, zastaví sa
          sama a otvoriť to pôjde len tu.
        </p>
      </div>
    );
  }

  return (
    <div className="stack" data-testid="unlock-writes-form">
      <div className="row">
        <ToneBadge tone="critical" data-testid="unlock-writes-state">
          Zápisy sú zastavené
        </ToneBadge>
      </div>
      <p className="set-note">
        Dôvod: {writesLockedReason ?? 'appka zapisovala rýchlejšie, než je bezpečné'}. Kým
        zámok trvá, do eshopu sa nezapíše nič — ani z fronty. Skôr než odomkneš,
        pozri sa do histórie, čo zápisy spôsobilo.
      </p>
      <label className="field set-w">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          disabled={busy}
          data-testid="unlock-writes-confirm"
        />
        <span className="lb">Pozrel som sa do histórie a chcem zápisy odomknúť</span>
      </label>
      <div className="row">
        <Button
          variant="danger"
          onClick={() => void submit()}
          disabled={busy || !confirmed}
          data-testid="unlock-writes-submit"
        >
          {busy ? 'Odomykám…' : 'Odomknúť zápisy'}
        </Button>
      </div>
      <ActionFailurePanel failure={failure} testId="unlock-writes-failure" />
    </div>
  );
}

export default UnlockWritesForm;
