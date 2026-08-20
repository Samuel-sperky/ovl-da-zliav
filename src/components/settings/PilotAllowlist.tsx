'use client';

/**
 * Aura Zľavy — povolené produkty pre pilotný režim (K1).
 *
 * Prečo vôbec existuje: predvolený režim rozsahu je `pilot` a guard `checkScope`
 * v ňom vyžaduje, aby KAŽDÝ produkt zľavy bol v aktívnom allowliste. Prestavba
 * na V3 ale obrazovku allowlistu zrušila — prvá zľava teda spadla na
 * „aspoň jeden produkt nie je v aktívnom allowliste" a používateľ to nemal ako
 * v appke napraviť. Cesty `/api/allowlist` pritom celý čas existovali; stratil
 * sa len ich volajúci.
 *
 * Zámerne to NIE JE riešené oslabením guardu. Allowlist je v pilotnom režime
 * jediná tvrdá brzda pred produkčným eshopom: desať produktov, ktoré človek
 * vedome vypísal. Keď je zapnutý plný režim, sekcia sa nezobrazuje — tam
 * rozsah drží katalóg a strop `max_products_per_campaign`.
 */
import { useCallback, useEffect, useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import {
  addAllowedProduct,
  listAllowedProducts,
  removeAllowedProduct,
  type AllowedProductView,
} from '@/components/settings/api';
import { formatEur } from '@/lib/ui/format';

/** Strop pilotného režimu. Rovnaké číslo drží guard aj CHECK v databáze. */
const PILOT_MAX = 10;

export function PilotAllowlist() {
  const [rows, setRows] = useState<readonly AllowedProductView[] | null>(null);
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const load = useCallback(async () => {
    const res = await listAllowedProducts();
    if (res.ok) setRows(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(): Promise<void> {
    const productId = Number(id.trim());
    if (!Number.isInteger(productId) || productId <= 0) {
      setFailure({
        message: 'Zadaj číslo produktu zo shopu.',
        rawCode: null,
        tone: 'attention',
        needsLogin: false,
      });
      return;
    }
    setBusy(true);
    setFailure(null);
    const res = await addAllowedProduct(productId);
    setBusy(false);
    if (res.ok) {
      setId('');
      await load();
      return;
    }
    setFailure(describeActionFailure(res.error, { action: 'Pridanie produktu' }));
  }

  async function remove(productId: number): Promise<void> {
    setBusy(true);
    setFailure(null);
    const res = await removeAllowedProduct(productId);
    setBusy(false);
    if (res.ok) {
      await load();
      return;
    }
    setFailure(describeActionFailure(res.error, { action: 'Odobranie produktu' }));
  }

  const count = rows?.length ?? 0;
  const full = count >= PILOT_MAX;

  return (
    <div data-testid="pilot-allowlist">
      <div className="sec-h">
        <h3>Povolené produkty</h3>
        <div className="act lvl-3">
          {count} z {PILOT_MAX}
        </div>
      </div>

      <p className="muted">
        V pilotnom režime appka zapíše zľavu výhradne produktom z tohto zoznamu.
      </p>

      <div className="row">
        <input
          type="text"
          inputMode="numeric"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Číslo produktu zo shopu"
          disabled={busy || full}
          aria-label="Číslo produktu zo shopu"
          data-testid="allow-input"
        />
        <Button small onClick={() => void add()} disabled={busy || full} data-testid="allow-add">
          Povoliť
        </Button>
      </div>

      {full ? (
        <p className="lvl-3">
          Zoznam je plný. Ak chceš zlacňovať tisíce produktov, prepni rozsah na plný.
        </p>
      ) : null}

      {rows === null ? (
        <p className="lvl-3">Načítavam…</p>
      ) : rows.length === 0 ? (
        <p className="lvl-3">Zoznam je prázdny — appka teraz nezapíše nič.</p>
      ) : (
        <div className="tbl-frame">
          <table className="tbl plain">
            <thead>
              <tr>
                <th>Produkt</th>
                <th className="n">Cena</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId}>
                  <td>{r.name ?? r.label ?? `Produkt ${r.productId}`}</td>
                  <td className="n">{r.price === null ? '—' : formatEur(r.price)}</td>
                  <td className="n">
                    <Button
                      small
                      onClick={() => void remove(r.productId)}
                      disabled={busy}
                      data-testid={`allow-remove-${r.productId}`}
                    >
                      Odobrať
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {failure === null ? null : <ActionFailurePanel failure={failure} />}
    </div>
  );
}

export default PilotAllowlist;
