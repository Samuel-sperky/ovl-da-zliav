'use client';

/**
 * Aura Zľavy — sekcia „Katalóg" v Nastaveniach (K7).
 *
 * Prečo vôbec existuje: prestavba na V3 postavila celý výber produktov na
 * zrkadle katalógu (`catalog_cache`), ale ŽIADNE tlačidlo, ktoré ho naplní,
 * v UI nebolo. Cesta `POST /api/catalog/sync` existovala a jej vlastný komentár
 * hovoril „Manuálne načítanie celého katalógu („Načítať katalóg" v
 * Nastaveniach)" — len to tlačidlo nikto nepridal. Automatický nočný beh sa
 * pustí len mimo špičky (21:00–07:00), takže pri prvom spustení cez deň
 * zostali Produkty prázdne a zľava sa nedala vybrať vôbec.
 *
 * Synchronizácia je ČÍTANIE. Nekonzumuje denný rozpočet zápisov (K7) a do
 * shopu nikdy nič nezapíše — to je dôvod, prečo tu tlačidlo môže byť bez
 * potvrdzovania heslom.
 */
import { useEffect, useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import { catalogStatus, syncCatalog, type CatalogSyncView } from '@/components/settings/api';
import { formatCountSk } from '@/lib/ui/vocabulary';
import { formatDateTimeSk } from '@/lib/ui/format';

/** Slovenská veta k výsledku behu — kód sa na povrch nedostane (K10). */
function outcomeSentence(outcome: string): string {
  switch (outcome) {
    case 'ok':
      return 'Katalóg je načítaný.';
    case 'partial':
      return 'Časť katalógu sa načítala, zvyšok dobehne pri ďalšom pokuse.';
    case 'already_running':
      return 'Načítavanie už beží — nechaj ho dobehnúť.';
    case 'peak_hours':
      return 'Automatické načítanie beží až po 21:00; teraz ho spusti tlačidlom.';
    case 'no_key':
      return 'Chýba kľúč na čítanie shopu — vlož ho v sekcii Kľúče.';
    case 'no_domain':
      return 'Nie je nastavená adresa shopu.';
    default:
      return 'Načítanie sa nepodarilo.';
  }
}

export function CatalogSection() {
  const [view, setView] = useState<CatalogSyncView | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  useEffect(() => {
    let alive = true;
    void catalogStatus().then((res) => {
      if (alive && res.ok) setView(res.data);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function run(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const res = await syncCatalog();
    setBusy(false);
    if (res.ok) {
      setView(res.data);
      return;
    }
    setFailure(describeActionFailure(res.error, { action: 'Načítanie katalógu' }));
  }

  const products = view?.products ?? null;

  return (
    <section className="sec" id="katalog" data-testid="catalog-section">
      <div className="sec-h">
        <h2>Katalóg</h2>
        <div className="act">
          <Button small onClick={() => void run()} disabled={busy} data-testid="catalog-sync">
            {busy ? 'Načítavam…' : 'Načítať katalóg'}
          </Button>
        </div>
      </div>

      <div className="kv">
        <span>Produktov v appke</span>
        <strong>{products === null ? '—' : formatCountSk(products)}</strong>

        <span>Naposledy načítané</span>
        <strong>
          {view?.lastRunAt == null ? 'nikdy' : formatDateTimeSk(view.lastRunAt)}
        </strong>
      </div>

      <p className="muted">
        {view === null
          ? 'Bez načítaného katalógu sa nedá vybrať produkt do zľavy.'
          : outcomeSentence(view.outcome)}
      </p>

      {failure === null ? null : <ActionFailurePanel failure={failure} />}
    </section>
  );
}

export default CatalogSection;
