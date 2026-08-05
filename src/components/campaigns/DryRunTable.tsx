'use client';

/**
 * Aura Zľavy — dry-run diff tabuľka (D3, D4, D60, I11).
 *
 * Per produkt: názov, aktuálna cena, percento, okno, orientačná zľavnená
 * cena (VŽDY s `≈` markerom a plným znením v tooltipe — `PriceHint`), posledný
 * vlastný zápis (`SelfWriteBadge`, nikdy nie „stav shopu") a varovanie pri
 * variantoch. Raw JSON payloady sa tu NEVYKRESĽUJÚ (D3) — patria do auditu.
 *
 * Redizajn:
 *  · blokátor prekryvu (plán §2 bod 11 · U3) menuje kolidujúcu kampaň, jej okno
 *    a produkt, odkazuje na ňu a ponúka „Vyradiť kolidujúce zo sady" — dovtedy
 *    bola zablokovaná cesta bez inštrukcie,
 *  · blokátor „chýba API kľúč" má vlastnú hlášku a odkaz do Nastavení,
 *  · disclaimer o zaokrúhlení je raz ako legenda (`PriceHintLegend`), nie 3× na
 *    riadok (U10); v stĺpci „Upozornenia" zostáva len to, čo je pre riadok
 *    ODLIŠNÉ,
 *  · kódy rozhodnutí (D28, D60, I11…) sú preč z textu, surový kód blokátora
 *    zostáva v rozbaľovacom technickom detaile (plán §2 bod 10).
 */
import type {
  PreviewBlockerView,
  PreviewConflictView,
  PreviewItemView,
  PreviewWarningsView,
} from '@/components/campaigns/api';
import { KEY_MISSING_CODE } from '@/components/campaigns/api';
import Button from '@/components/ui/Button';
import PriceHint, { PriceHintLegend } from '@/components/ui/PriceHint';
import SelfWriteBadge from '@/components/ui/SelfWriteBadge';
import Table, { type TableColumn } from '@/components/ui/Table';
import VariantWarning from '@/components/ui/VariantWarning';
import { formatDateSk, formatEur, formatPercentSk } from '@/lib/ui/format';

export interface DryRunTableProps {
  items: PreviewItemView[];
  warnings: PreviewWarningsView;
  blockers: PreviewBlockerView[];
  conflicts?: PreviewConflictView[];
  percent: number;
  from: string;
  to: string;
  /** Keď je k dispozícii, blokátor prekryvu ponúkne „vyradiť zo sady" (U3). */
  onExcludeProducts?: (productIds: number[]) => void;
}

export function DryRunTable({
  items,
  warnings,
  blockers,
  conflicts = [],
  percent,
  from,
  to,
  onExcludeProducts,
}: DryRunTableProps) {
  const keyMissing = blockers.some((b) => b.code === KEY_MISSING_CODE);
  const otherBlockers = blockers.filter(
    (b) => b.code !== KEY_MISSING_CODE && b.code !== 'future_overlap',
  );
  const conflictProductIds = [...new Set(conflicts.map((c) => c.productId))];

  const columns: TableColumn<PreviewItemView>[] = [
    {
      key: 'product',
      header: 'Produkt',
      render: (it) => (
        <div className="ovl-stack" style={{ gap: '0.15rem' }}>
          <span>
            {it.name ?? <span className="ovl-muted">bez názvu</span>}{' '}
            <span className="ovl-muted ovl-small">#{it.productId}</span>
          </span>
          <VariantWarning hasAttributes={it.hasAttributes} />
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Aktuálna cena',
      kind: 'money',
      render: (it) => formatEur(it.price),
    },
    {
      key: 'percent',
      header: 'Zľava',
      kind: 'num',
      render: () => formatPercentSk(percent),
    },
    {
      key: 'window',
      header: 'Okno',
      kind: 'date',
      render: () => `${formatDateSk(from)} – ${formatDateSk(to)}`,
    },
    {
      key: 'discounted',
      header: 'Orientačná cena po zľave',
      kind: 'money',
      render: (it) => <PriceHint price={it.price} percent={percent} />,
    },
    {
      key: 'lastOwnWrite',
      header: 'Posledný vlastný zápis',
      render: (it) => (
        <SelfWriteBadge
          writtenAt={it.lastOwnWrite?.at ?? null}
          detail={
            it.lastOwnWrite
              ? `${formatPercentSk(it.lastOwnWrite.percent)} · ${formatDateSk(it.lastOwnWrite.from)} – ${formatDateSk(it.lastOwnWrite.to)}`
              : undefined
          }
        />
      ),
    },
    {
      key: 'warnings',
      header: 'Upozornenia',
      render: (it) =>
        it.warnings.length === 0 ? (
          <span className="ovl-muted">—</span>
        ) : (
          <ul className="ovl-small" style={{ margin: 0, paddingLeft: '1rem' }}>
            {it.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ),
    },
  ];

  return (
    <div className="ovl-stack" data-testid="dry-run-table">
      {keyMissing ? (
        <div className="ovl-note ovl-note--critical" role="alert" data-testid="blocker-key-missing">
          <span className="ovl-note-glyph" aria-hidden="true">
            ⚿
          </span>
          <strong>Chýba platný API kľúč.</strong> Bez neho appka neprečíta ceny zo shopu a nič
          nezapíše. <a href="/nastavenia">Vložiť nový kľúč</a> — rozpracovanú kampaň si medzitým
          môžeš uložiť ako koncept.
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="ovl-note ovl-note--critical" role="alert" data-testid="blocker-overlap">
          <span className="ovl-note-glyph" aria-hidden="true">
            ✕
          </span>
          <strong>Prekryv s inou naplánovanou kampaňou.</strong> Dve naplánované zľavy na jednom
          produkte appka nepovolí — nedá sa zistiť, ktorá v shope vyhrá.
          <ul className="ovl-small" style={{ margin: '0.35rem 0 0', paddingLeft: '1rem' }}>
            {conflicts.map((c) => (
              <li key={`${c.campaignId}-${c.productId}`}>
                Produkt <strong>#{c.productId}</strong> už má kampaň{' '}
                <a href={`/kampane/${c.campaignId}`}>
                  „{c.campaignName}" (#{c.campaignId})
                </a>{' '}
                na <span className="ovl-num">{formatDateSk(c.from)} – {formatDateSk(c.to)}</span>.
              </li>
            ))}
          </ul>
          {onExcludeProducts && conflictProductIds.length > 0 ? (
            <div className="ovl-row" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
              <Button
                small
                variant="primary"
                onClick={() => onExcludeProducts(conflictProductIds)}
                data-testid="exclude-conflicting"
              >
                Vyradiť kolidujúce zo sady ({conflictProductIds.length})
              </Button>
            </div>
          ) : (
            <p className="ovl-small ovl-muted" style={{ margin: '0.35rem 0 0' }}>
              Zmeň okno kampane alebo zruš pôvodnú kampaň.
            </p>
          )}
          <details>
            <summary>Technický detail</summary>
            <div>
              kód: <code>future_overlap</code>
            </div>
          </details>
        </div>
      ) : null}

      {otherBlockers.length > 0 ? (
        <div className="ovl-note ovl-note--critical" role="alert" data-testid="dry-run-blockers">
          <span className="ovl-note-glyph" aria-hidden="true">
            ✕
          </span>
          <strong>Dry-run sa nedá potvrdiť:</strong>
          <ul className="ovl-small" style={{ margin: '0.25rem 0 0', paddingLeft: '1rem' }}>
            {otherBlockers.map((b, i) => (
              <li key={i}>
                {b.message}
                {b.productId != null ? ` (produkt #${b.productId})` : ''}
              </li>
            ))}
          </ul>
          <details>
            <summary>Technický detail</summary>
            <pre>{otherBlockers.map((b) => b.code).join('\n')}</pre>
          </details>
        </div>
      ) : null}

      {warnings.keyExpiresBeforeStart && !keyMissing ? (
        <div className="ovl-note ovl-note--attention" role="note">
          <span className="ovl-note-glyph" aria-hidden="true">
            ▲
          </span>
          API kľúč expiruje skôr, než sa kampaň spustí — pred spustením ho bude treba vložiť znova,
          inak kampaň skončí v stave „vyžaduje kľúč".
        </div>
      ) : null}
      {warnings.overwrite.length > 0 ? (
        <div className="ovl-note ovl-note--attention" role="note" data-testid="overwrite-warning">
          <span className="ovl-note-glyph" aria-hidden="true">
            ▲
          </span>
          Na produktoch {warnings.overwrite.map((p) => `#${p}`).join(', ')} podľa vlastnej evidencie
          zľava beží alebo je naplánovaná — potvrdenie bude explicitné{' '}
          <strong>prepísanie</strong> s diffom starý → nový. Shop môže mať iný stav.
        </div>
      ) : null}
      {warnings.hasAttributes.length > 0 ? (
        <p className="ovl-small ovl-muted" data-testid="attributes-warning">
          {warnings.hasAttributes.length === 1
            ? '1 produkt v sade má varianty'
            : `${warnings.hasAttributes.length} produkty v sade majú varianty`}{' '}
          — výsledné ceny variantov určuje shop (označené v riadku).
        </p>
      ) : null}

      <Table
        columns={columns}
        rows={items}
        rowKey={(it) => it.productId}
        emptyLabel="Žiadne produkty v náhľade."
      />

      <PriceHintLegend />
      <p className="ovl-small ovl-muted">
        Stav zľavy v shope appka cez API overiť nevie — zobrazuje výhradne vlastné zápisy.
      </p>
    </div>
  );
}

export default DryRunTable;
