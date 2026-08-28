'use client';

/**
 * Aura Zľavy — vloženie a obnova kľúča na ZÁPIS ZLIAV (V12; pôvodne A16).
 *
 * UI kľúč NIKDY nezobrazí — ani po vložení, ani „na kontrolu". Jediné, čo
 * o ňom hovorí, sú posledné štyri znaky, čas uloženia a živý odpočet platnosti.
 * Vstupné pole je typu heslo, hodnota sa po odoslaní okamžite zahodí a nikde
 * sa nezapisuje.
 *
 * TICHÝ NEÚSPECH JE ZAKÁZANÝ. Kľúč ide do PRODUKČNÉHO eshopu, takže dojem
 * „uložilo sa" bez uloženia je najhorší možný výsledok. Preto po každom
 * neúspechu: (a) zmizne akékoľvek staršie hlásenie o úspechu, (b) na obrazovke
 * je výslovné „kľúč sa NEULOŽIL", (c) pri chýbajúcej prihlásenej relácii sa
 * nezobrazí generická červená chyba, ale veta „nie si prihlásený" s odkazom.
 *
 * Formulár sa kreslí vnútri sekcie Kľúče, preto nemá vlastný rám ani nadpis
 * sekcie — hostiteľ ich dodáva.
 *
 * VÝSLEDOK OVERENIA JE STAV, TAKŽE MÁ TRI KANÁLY (A3, šprint 20)
 * -------------------------------------------------------------
 * „overený u eshopu", „neoverený", „eshop ho neprijal" a „nemá právo meniť
 * produkty" sú stavy kľúča, nie poznámky. Do 20. 8. 2026 mal riadok o už
 * uloženom kľúči farbu + značku + slovo, ale hlásenie hneď po uložení nieslo
 * to isté tvrdenie ako holé slovo v zátvorke — bez farby aj bez značky. Ten
 * istý stav tak vyzeral na dvoch miestach jednej obrazovky inak a „eshop ho
 * neprijal" splynulo s pokojnou vetou o úspechu. Obe miesta preto kreslia
 * `<SigMark>` z `verifyLook()`.
 *
 * Neznámy kód overenia sa PRIZNÁ, nezmizne — pozri `UNKNOWN_VERIFY`.
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import { SigMark, type SigVariant } from '@/components/ui/StatusMark';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/action-failure';
import {
  putKey,
  validateApiKey,
  type KeyMetaView,
} from '@/components/settings/api';

/** Vzhľad výsledku overenia: slovo na povrch a tón, z ktorého ide farba aj značka. */
export interface VerifyLook {
  readonly label: string;
  readonly tone: SigVariant;
}

/** Výsledok overenia kľúča → veta. Kód overenia na povrch nepatrí. */
export const VERIFY_LABELS: Record<string, VerifyLook> = {
  valid: { label: 'overený u eshopu', tone: 'ok' },
  unverified: { label: 'neoverený', tone: 'idle' },
  invalid: { label: 'eshop ho neprijal', tone: 'bad' },
  forbidden: { label: 'nemá právo meniť produkty', tone: 'bad' },
};

/**
 * Kód overenia, ktorý slovník nepozná.
 *
 * `putKey()` vracia `verifyStatus` ako obyčajný reťazec, takže sem naozaj vie
 * doraziť kód, o ktorom táto obrazovka nič nevie. Predtým sa vtedy stav ticho
 * stratil — indexácia mapy vrátila `undefined` a na obrazovke nezostalo nič.
 * Teraz sa prizná: jantár znamená „treba sa na to pozrieť", nie zelenú
 * (netvrdíme, že je overený) a nie červenú (netvrdíme, že ho eshop odmietol).
 */
export const UNKNOWN_VERIFY: VerifyLook = { label: 'stav overenia neznámy', tone: 'warn' };

/**
 * Výsledok overenia na vzhľad. `null` znamená, že sonda ešte nebežala — vtedy
 * appka nekreslí nič, lebo nemá čo tvrdiť.
 */
export function verifyLook(status: string | null | undefined): VerifyLook | null {
  if (status === null || status === undefined || status === '') return null;
  return VERIFY_LABELS[status] ?? UNKNOWN_VERIFY;
}

/**
 * Stav overenia ako JEDEN uzol — farba (trieda), značka (ikona) a slovo spolu.
 *
 * Je to komponent, a nie dvakrát opísaný `<span>`, z dvoch dôvodov. Prvý:
 * ten istý stav sa na tejto obrazovke kreslí na dvoch miestach (riadok
 * o uloženom kľúči a hlásenie hneď po uložení) a dve kópie sa časom rozídu —
 * presne tak vznikla podoba, kde jedno miesto malo tri kanály a druhé jeden.
 * Druhý: stav, ktorý vzniká až po odpovedi servera, sa v statickom renderi
 * nedá vykresliť, takže bez samostatného uzla by ho žiadny test nevidel.
 */
export function VerifyState({ look, testId }: { look: VerifyLook; testId: string }) {
  return (
    <span className={`sig ${look.tone}`} data-testid={testId}>
      <SigMark variant={look.tone} />
      {look.label}
    </span>
  );
}

/**
 * Hlásenie o NEULOŽENOM kľúči.
 *
 * Vlastný uzol z rovnakého dôvodu ako `VerifyState`: je to najdôležitejší stav
 * tejto obrazovky (do produkčného eshopu sa nič nezapísalo) a zároveň jediný,
 * ktorý vzniká až po odpovedi servera — bez samostatného uzla ho statický
 * render nevykreslí a test nevidí, či mu nechýba značka.
 */
export function NotStoredState() {
  return (
    <p className="sig bad" data-testid="api-key-not-stored">
      <SigMark variant="bad" />
      Kľúč sa NEULOŽIL — v appke zostáva pôvodný stav a do eshopu sa nič
      neposlalo.
    </p>
  );
}

export interface ApiKeyFormProps {
  keyMeta: KeyMetaView | null;
  onStored: () => void;
}

export function ApiKeyForm({ keyMeta, onStored }: ApiKeyFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [stored, setStored] = useState<{ last4: string; verifyStatus: string } | null>(null);

  /** Neúspech je vždy hlasný: úspešné hlásenie zmizne, chyba sa pomenuje. */
  function fail(error: { code?: string | null; message?: string | null } | null) {
    setStored(null);
    setFailure(describeActionFailure(error, { action: 'Uloženie kľúča na zápis zliav' }));
  }

  async function submit(value: string) {
    const localError = validateApiKey(value);
    if (localError) {
      fail({ code: 'validation_failed', message: localError });
      return;
    }
    setFailure(null);
    setBusy(true);
    const res = await putKey(value.trim());
    setBusy(false);
    if (res.ok) {
      // Kľúč držíme len po dobu odoslania a hneď ho zahadzujeme.
      setApiKey('');
      setFailure(null);
      setStored({ last4: res.data.last4, verifyStatus: res.data.verifyStatus });
      onStored();
      return;
    }
    // Kľúč nedržíme ani po neúspechu — používateľ ho vloží znova. Preto MUSÍ
    // byť na obrazovke nepochybné, že sa nič neuložilo.
    setApiKey('');
    fail(res.error);
  }

  const verify = verifyLook(keyMeta?.verifyStatus);
  /* Po uložení je výsledok overenia STAV, nie vsuvka: nesie farbu, značku aj
     slovo rovnako ako riadok o už uloženom kľúči. Neznámy kód sa prizná. */
  const storedVerify = stored === null ? null : (verifyLook(stored.verifyStatus) ?? UNKNOWN_VERIFY);

  return (
    <div data-testid="api-key-form">
      {keyMeta?.present === true ? (
        <div className="lvl-3" data-testid="api-key-meta">
          Uložený kľúč končí na {keyMeta.last4 ?? '????'}
          {verify ? (
            <>
              {' · '}
              <VerifyState look={verify} testId="api-key-verify" />
            </>
          ) : null}
        </div>
      ) : (
        <div className="lvl-3" data-testid="api-key-missing">
          Bez tohto kľúča appka do eshopu nič nezapíše. Fronta počká, nič sa
          nestratí.
        </div>
      )}

      <form
        className="set-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void submit(apiKey);
        }}
      >
        <label className="field set-w">
          <span className="lb">
            {keyMeta?.present === true ? 'Nový kľúč na zápis zliav' : 'Kľúč na zápis zliav'}
          </span>
          <input
            className="inp"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={busy}
            placeholder="vlož kľúč — nikdy sa nezobrazí"
            data-testid="api-key-input"
          />
        </label>
        <div className="row">
          <Button type="submit" variant="primary" disabled={busy} data-testid="api-key-save">
            {busy ? 'Ukladám…' : 'Uložiť kľúč'}
          </Button>
          <span className="lvl-3">appka kľúč najprv overí u eshopu</span>
        </div>
      </form>

      {stored && storedVerify ? (
        <p className="set-note" data-testid="api-key-stored">
          Kľúč končiaci na {stored.last4} je uložený (
          <VerifyState look={storedVerify} testId="api-key-stored-verify" />
          ). Zľavy, ktoré na kľúč čakali a sú ešte vo svojom okne, appka dopísala sama.
        </p>
      ) : null}

      {failure ? (
        <div className="stack">
          <NotStoredState />
          <ActionFailurePanel failure={failure} testId="api-key-failure" />
        </div>
      ) : null}

      <p className="set-note">
        Kľúč sa ukladá zašifrovaný, neopustí pamäť odoslania a UI ani záznamy ho
        nikdy nezobrazia.
      </p>

    </div>
  );
}

export default ApiKeyForm;
