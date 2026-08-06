'use client';

/**
 * Aura Zľavy — karta „Predajnosť" (KONTRAKT-PREDAJNOST-2026-08-06, P1).
 *
 * Číta `GET /api/sales` (read-only). Zobrazuje pre produkty allowlistu KUSY
 * predané za obdobie, kusy na deň a dni od posledného predaja.
 *
 * Tri veci, ktoré táto karta hovorí nahlas, pretože inak by klamala (I11):
 *   1. **Nie je to obrátkovosť.** Na tú chýba COGS a zásoba nevariantných
 *      produktov — karta „Obrátkovosť" zostáva zamknutá a táto sa za ňu
 *      nevydáva.
 *   2. **Nie sú to peniaze.** Zaplatená suma patrí celej objednávke, nie
 *      položke, takže obrat na produkt sa priradiť NEDÁ. Merajú sa kusy (P4).
 *   3. **Obdobie je krátke a je napísané.** Okno prvého behu je 3 dni (P3)
 *      a nočne sa rozširuje, takže produkt s predajom raz za týždeň tu na
 *      začiatku vyzerá ako nepredávaný. Bez dát karta zobrazí prázdny stav
 *      s dôvodom — NIKDY nuly, ktoré by vyzerali ako „nič sa nepredáva".
 *
 * Stav nie je nikdy len farba (§3.2): každý badge nesie farbu + glyf + text.
 * Teal je vyhradený ako sekvenčná rampa a stav nekóduje.
 */
import { useEffect, useState } from 'react';

import type { ProductSalesMetrics, SalesInsightsReport } from '@/contracts';

import { getJson } from '@/components/campaigns/api';
import EmptyState from '@/components/ui/EmptyState';
import Table, { type TableColumn } from '@/components/ui/Table';
import ToneBadge from '@/components/ui/ToneBadge';
import { formatDateTimeSk } from '@/lib/ui/format';

/** Pod týmto pokrytím je „0 kusov" bežné aj u produktu, ktorý sa predáva. */
const SHORT_COVERAGE_DAYS = 7;

function productName(row: ProductSalesMetrics): string {
  return row.name ?? row.label ?? `produkt #${row.productId}`;
}

function daysSk(n: number): string {
  if (n === 1) return '1 deň';
  if (n >= 2 && n <= 4) return `${n} dni`;
  return `${n} dní`;
}

const columns: ReadonlyArray<TableColumn<ProductSalesMetrics>> = [
  {
    key: 'product',
    header: 'Produkt',
    render: (row) => (
      <>
        {productName(row)} <span className="ovl-muted">#{row.productId}</span>
      </>
    ),
  },
  {
    key: 'units',
    header: 'Kusy za obdobie',
    kind: 'num',
    render: (row) => row.unitsSold,
  },
  {
    key: 'perDay',
    header: 'Kusy / deň',
    kind: 'num',
    // `null` = nie je pokrytý ani jeden deň; nedopočítava sa (I11).
    render: (row) => (row.unitsPerDay == null ? '—' : row.unitsPerDay.toFixed(2)),
  },
  {
    key: 'since',
    header: 'Dni od posledného predaja',
    kind: 'num',
    render: (row) =>
      row.daysSinceLastSale == null ? (
        <span className="ovl-muted">v období bez predaja</span>
      ) : row.daysSinceLastSale === 0 ? (
        'dnes'
      ) : (
        daysSk(row.daysSinceLastSale)
      ),
  },
];

export function SalesCard() {
  const [data, setData] = useState<SalesInsightsReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void getJson<SalesInsightsReport>('/api/sales').then((res) => {
      if (res.ok) setData(res.data);
      else setFailed(true);
    });
  }, []);

  const coverage = data?.coverage ?? null;
  const hasData = coverage?.hasData === true;

  return (
    <section className="ovl-card ovl-view-in" data-testid="ai-sales-card">
      <div className="ovl-spread" style={{ alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Predajnosť</h2>
        {coverage == null ? null : !hasData ? (
          <ToneBadge tone="idle" data-testid="sales-coverage-badge">
            zatiaľ bez dát
          </ToneBadge>
        ) : coverage.daysPartial > 0 ? (
          <ToneBadge tone="attention" data-testid="sales-coverage-badge">
            dáta za {daysSk(coverage.daysCovered)} — časť dní je dopočítaná len čiastočne
          </ToneBadge>
        ) : (
          <ToneBadge tone="good" data-testid="sales-coverage-badge">
            dáta za {daysSk(coverage.daysCovered)}
          </ToneBadge>
        )}
      </div>

      <p className="ovl-small ovl-muted" style={{ margin: '0.25rem 0 0.75rem' }}>
        Počet predaných <strong>kusov</strong> na produkt allowlistu z vlastných súčtov appky. Nie je
        to obrátkovosť — na tú chýba COGS a zásoba nevariantných produktov, a karta „Obrátkovosť"
        zostáva zamknutá. Nie je to ani obrat: zaplatená suma patrí celej objednávke, nie položke,
        takže peniaze na produkt appka priradiť nedokáže.
      </p>

      {failed ? (
        <p className="ovl-error" role="alert">
          Predajnosť sa nepodarilo načítať. Skús obnoviť stránku.
        </p>
      ) : data == null || coverage == null ? (
        <div className="ovl-skeleton" style={{ minHeight: '6rem' }} aria-busy="true" />
      ) : !hasData ? (
        /* Bez dát sa NEZOBRAZUJÚ nuly — nula bez dát je vymyslené číslo (I11). */
        <EmptyState title="Appka o predaji zatiaľ nič nevie" testId="sales-no-data">
          {coverage.syncEnabled
            ? 'Prvá synchronizácia predajov ešte nedobehla — alebo chýba kľúč na čítanie predajov. Kým nie je pokrytý ani jeden deň, karta zámerne nezobrazuje nuly: neznamenali by „nič sa nepredáva", ale „appka nemá dáta".'
            : 'Synchronizácia predajov je vypnutá v konfigurácii, takže sa nesťahuje žiadny deň. Nuly by tu boli vymyslené číslo, preto karta nezobrazuje nič.'}
        </EmptyState>
      ) : (
        <div className="ovl-stack" style={{ gap: '0.6rem' }}>
          <p className="ovl-small ovl-muted" style={{ margin: 0 }} data-testid="sales-coverage">
            Obdobie s dátami: <strong>{coverage.from}</strong> – <strong>{coverage.to}</strong> (
            {daysSk(coverage.daysCovered)}) · naposledy synchronizované{' '}
            {coverage.lastSyncedAt == null ? 'neznáme' : formatDateTimeSk(coverage.lastSyncedAt)}
          </p>

          {coverage.daysCovered < SHORT_COVERAGE_DAYS ? (
            <p className="ovl-note ovl-note--attention" role="note" style={{ margin: 0 }}>
              <span className="ovl-note-glyph" aria-hidden="true">
                ▲
              </span>
              Obdobie je krátke ({daysSk(coverage.daysCovered)}). Produkt, ktorý sa predáva raz za
              týždeň, tu vyzerá rovnako ako nepredávaný. Nulu preto čítaj ako „za tieto dni sa
              nepredal", nie ako „nepredáva sa" — história sa dopĺňa nočne a obdobie sa samo
              rozširuje.
            </p>
          ) : null}

          {coverage.daysPartial > 0 ? (
            <p className="ovl-note" role="note" style={{ margin: 0 }}>
              <span className="ovl-note-glyph" aria-hidden="true">
                ○
              </span>
              {daysSk(coverage.daysPartial)} z obdobia je dopočítaných len čiastočne — synchronizácia
              sa preruší korektne a pokračuje ďalší beh, takže kusy za tieto dni môžu ešte narásť.
            </p>
          ) : null}

          <Table
            columns={columns}
            rows={data.products}
            rowKey={(row) => row.productId}
            emptyLabel="V allowliste nie je žiadny produkt, ku ktorému by sa dala predajnosť ukázať."
            caption="Kusy predané za obdobie s dátami. Žiadne peniaze — obrat na produkt sa z objednávky priradiť nedá."
          />
        </div>
      )}
    </section>
  );
}

export default SalesCard;
