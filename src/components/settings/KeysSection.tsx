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
 * Vlastník: V12.
 */
import { useState } from 'react';

import ApiKeyForm from '@/components/settings/ApiKeyForm';
import OrdersKeyForm from '@/components/settings/OrdersKeyForm';
import Button from '@/components/ui/Button';
import Countdown from '@/components/ui/Countdown';
import { formatDateSk, formatDateTimeSk } from '@/lib/ui/format';
import type { KeyMetaView } from '@/components/settings/api';

/** Ktorý formulár je práve otvorený. `null` = žiadny. */
type OpenForm = 'write' | 'orders' | null;

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
        {present ? (
          <span className="sig ok">vložený</span>
        ) : (
          <span className="sig warn">chýba</span>
        )}
        {present && meta?.last4 !== null && meta?.last4 !== undefined ? (
          <div className="lvl-3">končí na {meta.last4}</div>
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
