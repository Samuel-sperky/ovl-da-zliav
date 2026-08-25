'use client';

/**
 * Aura Zľavy — sekcia KĽÚČE (V12; predloha `design/v3/nastavenia.html`).
 *
 * Dva kľúče, jedna tabuľka: kľúč na zápis zliav a kľúč na čítanie objednávok.
 * Predloha kreslí tri riadky (tretí je štatistiky), appka však tretí kľúč
 * nemá — a vymyslený riadok by bol klamstvo o tom, čo appka vie. Kreslíme
 * preto dva a nikde nepredstierame tretí.
 *
 * Čo tabuľka o kľúči hovorí: názov, dokedy platí, živý odpočet a stav. Čo o ňom
 * NEHOVORÍ: samotný kľúč. Ten sa nezobrazí nikde a nikdy — ani po vložení,
 * ani „na kontrolu". Jediná stopa po ňom sú posledné štyri znaky.
 *
 * Vloženie a obnova sú pod tlačidlom v riadku; formulár sa otvorí pod tabuľkou,
 * aby obrazovka nemala dva rozpísané formuláre naraz.
 *
 * ČO SA STANE PO EXPIRÁCII — A PREČO TO TU MUSÍ BYŤ NAPÍSANÉ
 * ---------------------------------------------------------
 * Kľúč na zápis platí 48 hodín, ale fronta na 150 produktov beží deň a fronta
 * na tisíce aj týždne. Expirácia uprostred behu je teda normálny stav, nie
 * výnimka — a používateľ, ktorý nevie, čo sa vtedy stane, si domyslí to
 * najhoršie (že o rozrobenú zľavu prišiel). Preto je pri tabuľke veta, ktorá
 * hovorí presne tri veci: fronta počká, nič sa nestratí, zapísané zľavy
 * v eshope zostanú. Táto veta sa odtiaľto nesmie stratiť.
 *
 * Vlastník: V12.
 */
import { useState } from 'react';

import ApiKeyForm from '@/components/settings/ApiKeyForm';
import OrdersKeyForm from '@/components/settings/OrdersKeyForm';
import { TONE_SIG_CLASS } from '@/components/settings/blockers-view';
import { ToneSigMark } from '@/components/ui/StatusMark';
import Button from '@/components/ui/Button';
import Countdown from '@/components/ui/Countdown';
import Note from '@/components/ui/Note';
import type { StatusTone } from '@/components/ui/ToneBadge';
import { formatDateSk, formatDateTimeSk } from '@/lib/ui/format';
import type { KeyMetaView } from '@/components/settings/api';

/** Ktorý formulár je práve otvorený. `null` = žiadny. */
type OpenForm = 'write' | 'orders' | null;

/**
 * Od koľkých zostávajúcich hodín sa o platnosti hovorí nahlas. Zhoda
 * s `KEY_WARNING_HOURS` v `lib/status/blockers.ts` je zámerná: obrazovka
 * a zoznam prekážok nesmú varovať v inom okamihu, inak si protirečia.
 */
export const KEY_WARNING_HOURS = 12;

/**
 * Stav kľúča ako SLOVO a tón. Čistá funkcia — presne tu sa dá ticho pokaziť,
 * že obrazovka povie „vložený" o kľúči, ktorý už neplatí, a používateľ potom
 * hodinu hľadá, prečo sa nezapisuje.
 */
export function keyRowState(meta: KeyMetaView | null): {
  readonly label: string;
  readonly tone: StatusTone;
} {
  if (meta?.present !== true) return { label: 'chýba', tone: 'attention' };

  /*
   * OVERENIE SA ČÍTA PRED ČASOM (24. 8. 2026).
   *
   * Do 24. 8. sa tu rozhodovalo VÝHRADNE podľa `secondsLeft`. `verifyStatus`
   * pritom v `KeyMetaView` je a route ho posiela — len ho nikto nečítal. Kľúč,
   * ktorý shop nikdy nepotvrdil, tak dostal zelené „vložený a platný"; stačilo
   * mu mať pred sebou dosť času. Na živých dátach to bol objednávkový kľúč
   * s `verify_status = 'unverified'`: appka tvrdila platnosť, ktorú nikdy
   * nezmerala, a človek podľa toho slova hľadal príčinu inde.
   *
   * Poradie je preto takéto a nie opačné: „nevieme, či funguje" je dôležitejšia
   * správa než „a mimochodom mu za dva dni vyprší platnosť". Čas má zmysel až
   * pri kľúči, o ktorom vieme, že funguje.
   *
   * TRI STAVY, KTORÉ SA NESMÚ ZLIAŤ:
   *   neoverený        — NEVIEME, či funguje. Priznanie, nie verdikt → `idle`.
   *   shop ho neprijal — VIEME, že nefunguje → `critical`.
   *   čoskoro vyprší   — VIEME, že funguje, ale nie dlho → `attention`.
   *
   * Zelená patrí jedinému stavu: shop kľúč potvrdil A čas mu nedochádza.
   * Na povrch nesmie ísť vnútorný kód ani príčina (K10, P8) — appka tu vie ČO,
   * nie PREČO; prečo sa overiť nedalo, hovorí `verifyNote` z `/api/key`.
   */
  const verified = meta.verifyStatus;
  if (verified === 'invalid') return { label: 'shop ho neprijal', tone: 'critical' };
  if (verified === 'forbidden') return { label: 'shop mu prístup zakázal', tone: 'critical' };
  if (verified === 'unverified' || verified === null) {
    return { label: 'vložený, ale neoverený', tone: 'idle' };
  }
  if (verified !== 'valid') {
    // Server je za typom, ale za behu cezeň dorazí čokoľvek. Neznámy kód sa
    // PRIZNÁ — nikdy sa mlčky nepovažuje za platnosť.
    return { label: 'vložený, stav neznámy', tone: 'attention' };
  }

  const left = meta.secondsLeft;
  if (left === null) return { label: 'vložený, platnosť neznáma', tone: 'attention' };
  if (left <= 0) return { label: 'už neplatí', tone: 'critical' };
  if (left < KEY_WARNING_HOURS * 3600) return { label: 'vložený, čoskoro vyprší', tone: 'attention' };
  return { label: 'vložený a platný', tone: 'good' };
}

export interface KeysSectionProps {
  writeKey: KeyMetaView | null;
  ordersKey: KeyMetaView | null;
  onStored: () => void;
}

interface KeyRowProps {
  label: string;
  purpose: string;
  meta: KeyMetaView | null;
  open: boolean;
  onToggle: () => void;
  testId: string;
}

function KeyRow({ label, purpose, meta, open, onToggle, testId }: KeyRowProps) {
  const present = meta?.present === true;
  const state = keyRowState(meta);
  return (
    <tr data-testid={testId}>
      <td className="name">
        {label}
        <div className="lvl-3">{purpose}</div>
      </td>
      <td data-l="Platí do">
        {present && meta?.expiresAt !== null && meta?.expiresAt !== undefined ? (
          <>
            {formatDateSk(meta.expiresAt)}{' '}
            <span className="lvl-3">
              (<Countdown expiresAt={meta.expiresAt} expiredLabel="už neplatí" />)
            </span>
          </>
        ) : (
          <span className="lvl-3">—</span>
        )}
      </td>
      <td data-l="Stav">
        {/* Pomenovaný uzol: bez `data-testid` sa stav kľúča nedá zmerať inak
            než hľadaním slova v celom markupe, a taký test prežije aj to, keď
            sa slovo presunie do iného riadka tabuľky. */}
        <span className={TONE_SIG_CLASS[state.tone]} data-testid={`${testId}-state`}>
          <ToneSigMark tone={state.tone} />
          {state.label}
        </span>
        {present && meta?.last4 !== null && meta?.last4 !== undefined ? (
          <div className="lvl-3">končí na {meta.last4}</div>
        ) : null}
        {/* Slovo hovorí ČO, veta hovorí, čo s tým. Bez nej sa pri zablokovanej
            adrese nedá tušiť, že nový kľúč nepomôže — a človek by ho skúšal
            vkladať znova a znova. */}
        {present && typeof meta?.verifyNote === 'string' ? (
          <div className="lvl-3" data-testid={`${testId}-verify-note`}>
            {meta.verifyNote}
          </div>
        ) : null}
      </td>
      <td className="act">
        <Button small onClick={onToggle} data-testid={`${testId}-toggle`}>
          {open ? 'Zavrieť' : present ? 'Obnoviť' : 'Vložiť'}
        </Button>
      </td>
    </tr>
  );
}

export function KeysSection({ writeKey, ordersKey, onStored }: KeysSectionProps) {
  /**
   * Keď kľúč na zápis CHÝBA, formulár je otvorený hneď. Je to najčastejší
   * dôvod, prečo sem človek prišiel, a schovať vtedy pole za ďalší klik by
   * bolo úradníctvo. Keď kľúč je, riadok zostane zbalený — obnova je výnimka.
   */
  const [open, setOpen] = useState<OpenForm>(writeKey?.present === true ? null : 'write');

  const toggle = (which: Exclude<OpenForm, null>) =>
    setOpen((current) => (current === which ? null : which));

  /* Route posiela to isté porovnanie v oboch odpovediach, takže je jedno,
   * z ktorého riadka sa prečíta — a keby jedno chýbalo (staršia odpoveď),
   * použije sa druhé. */
  const sameKeyNote = writeKey?.sameKeyNote ?? ordersKey?.sameKeyNote ?? null;

  return (
    <section className="sec" id="kluce" data-testid="keys-section">
      <div className="sec-h">
        <h2>Kľúče</h2>
        <div className="act lvl-3">Zápis platí 48 hodín · objednávky 30 dní</div>
      </div>

      <div className="tbl-frame">
        <table className="tbl plain">
          <thead>
            <tr>
              <th>Kľúč</th>
              <th>Platí do</th>
              <th>Stav</th>
              <th className="act" />
            </tr>
          </thead>
          <tbody>
            <KeyRow
              label="Zápis zliav"
              purpose="ním appka zlacňuje produkty"
              meta={writeKey}
              open={open === 'write'}
              onToggle={() => toggle('write')}
              testId="key-row-write"
            />
            <KeyRow
              label="Objednávky"
              purpose="ním appka zisťuje, čo sa predáva"
              meta={ordersKey}
              open={open === 'orders'}
              onToggle={() => toggle('orders')}
              testId="key-row-orders"
            />
          </tbody>
        </table>
        <div className="tbl-foot">
          <span>Kľúče sú uložené zašifrované. Nikdy sa nezobrazia ani nezapíšu do histórie.</span>
        </div>
      </div>

      {/* Jeden kľúč v oboch slotoch. Veta stojí RAZ pod tabuľkou, nie v oboch
          riadkoch: je to tvrdenie o tej dvojici, nie o jednom kľúči, a v každom
          riadku by to bolo to isté povedané dvakrát. Zdroj je `sameKeyNote`
          z `/api/key`, aby obidva riadky nemohli hovoriť inak. */}
      {typeof sameKeyNote === 'string' ? (
        <Note testId="keys-same-key-note">{sameKeyNote}</Note>
      ) : null}

      <Note testId="keys-expiry-note">
        <b>Keď kľúč na zápis vyprší:</b> fronta sa zastaví a počká, <b>nič sa nestratí</b>
        {' '}a zľavy, ktoré už v eshope sú, tam zostanú a dobehnú. Appka si nový kľúč
        nevypýta sama a nevyrobí ho — vygeneruješ ho v eshope a vložíš sem tlačidlom
        <b> Obnoviť</b>. Fronta potom pokračuje presne tam, kde stála, a zľavy, ktoré na
        kľúč čakali a sú ešte vo svojom okne, appka dopíše sama. Kľúč na zápis platí
        48 hodín od vloženia, kľúč na objednávky 30 dní — dlhšiu platnosť nastaviť
        nevieme, je to pravidlo eshopu.
      </Note>

      {open === 'write' ? (
        <div className="set-form">
          <ApiKeyForm
            keyMeta={writeKey}
            onStored={() => {
              setOpen(null);
              onStored();
            }}
          />
        </div>
      ) : null}

      {open === 'orders' ? (
        <div className="set-form">
          <OrdersKeyForm
            keyMeta={ordersKey}
            onStored={() => {
              setOpen(null);
              onStored();
            }}
          />
        </div>
      ) : null}

      <details className="tech">
        <summary>Technický detail</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td className="mono">shop_write</td>
                <td className="mono">
                  {writeKey?.present === true
                    ? `vložený ${formatDateTimeSk(writeKey.savedAt)} · exp ${formatDateTimeSk(writeKey.expiresAt)} · sonda ${writeKey.verifyStatus ?? '—'}`
                    : 'nie je uložený'}
                </td>
              </tr>
              <tr>
                <td className="mono">orders_read</td>
                <td className="mono">
                  {ordersKey?.present === true
                    ? `vložený ${formatDateTimeSk(ordersKey.savedAt)} · exp ${formatDateTimeSk(ordersKey.expiresAt)} · sonda ${ordersKey.verifyStatus ?? '—'}`
                    : 'nie je uložený'}
                </td>
              </tr>
              <tr>
                <td>Šifrovanie</td>
                <td className="mono">AES-256-GCM, master key mimo obrazu aj zálohy</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export default KeysSection;
