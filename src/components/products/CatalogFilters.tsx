'use client';

/**
 * Aura Zľavy — ľavý panel filtrov tabu Produkty (V10; `design/v3/produkty.html`).
 *
 * Panel je 260 px široký, stále otvorený a hustý (na mobile sa vysunie cez
 * `.filters.open`). Dominanta obrazovky je TABUĽKA — tento panel je preto
 * zámerne tichý: malé písmo, žiadne karty, žiadne vysvetľujúce odstavce (P2).
 *
 * Zamknuté filtre (K8, architektúra §5)
 * ─────────────────────────────────────
 * Kategória, kov, typ šperku, marža, obrátkovosť a sklad sú v zozname
 * VIDITEĽNÉ, sivé a neklikateľné — nesmú byť skryté ani predstierané. Ich
 * zoznam sa NEPÍŠE natvrdo do obrazovky: prichádza z odpovede API
 * (`lockedFilters`). Keď dáta zo shopu pribudnú, filter zmizne zo zoznamu
 * v repozitári a táto obrazovka ho prestane kresliť sivý sama od seba.
 *
 * Čísla pri možnostiach sú z `counts` — meraný fakt, nie odhad (P7), preto sú
 * bez značky `≈`. Kým čísla nie sú, nekreslí sa nič; nula by klamala.
 *
 * Vlastník: V10.
 */
import type { CSSProperties } from 'react';

import type { CatalogCountsView, LockedFilterView } from '@/components/products/catalog-api';
import type {
  CatalogFilterState,
  SoldBucket,
  SoldWindow,
} from '@/components/products/catalog-filter';
import { SOLD_WINDOWS } from '@/components/products/catalog-filter';
import type { SavedFilter } from '@/components/products/saved-filters';
import { formatCountSk, SURFACE_TERMS } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Popisy ════════════════════════════════════ */

/** Vedrá predajnosti tak, ako ich číta človek. Kódy zostávajú vnútri. */
const BUCKET_LABELS: ReadonlyArray<{ bucket: SoldBucket; label: string }> = [
  { bucket: 'none', label: '0 predaných' },
  { bucket: 'low', label: '1 – 2 predané' },
  { bucket: 'mid', label: '3 – 9 predaných' },
  { bucket: 'high', label: '10 a viac' },
];

/**
 * Slovenské meno zamknutého filtra. Kľúče sú kódy z API — keď pribudne nový,
 * dostane meno tu; bez mena sa nekreslí vôbec (radšej nič než kód na povrchu).
 */
const LOCKED_LABELS: Readonly<Record<string, string>> = {
  stock: 'Sklad',
  turnover: 'Obrátkovosť',
  category: 'Kategória',
  metal: 'Kov',
  jewelryType: 'Typ šperku',
  margin: 'Marža',
};

/** Ktorý zamknutý filter patrí do ktorej skupiny panela. */
const LOCKED_IN_SOLD = ['turnover'] as const;
const LOCKED_IN_STOCK = ['stock'] as const;
const LOCKED_STANDALONE = ['category', 'metal', 'jewelryType', 'margin'] as const;

/* ═══════════════════════════ 2. Drobné kúsky ══════════════════════════════ */

/**
 * Tlačidlo bez vlastného vzhľadu — vzhľad nesie obal `.chip`. Dve tlačidlá
 * vedľa seba namiesto tlačidla v tlačidle: vnorené interaktívne prvky sú
 * neplatné HTML a klávesnica sa v nich stratí.
 */
const BARE_BUTTON: CSSProperties = {
  background: 'transparent',
  border: 0,
  padding: 0,
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

function LockedOption({ code }: { code: string }) {
  const label = LOCKED_LABELS[code];
  if (label === undefined) return null;
  return (
    <div className="fopt locked" aria-disabled="true" title={SURFACE_TERMS.lockedFeature}>
      {label}
    </div>
  );
}

function LockedGroup({ codes, locked }: { codes: readonly string[]; locked: readonly string[] }) {
  const present = codes.filter((code) => locked.includes(code));
  if (present.length === 0) return null;
  return (
    <>
      {present.map((code) => (
        <LockedOption key={code} code={code} />
      ))}
    </>
  );
}

function Count({ value }: { value: number | null }) {
  if (value === null) return null;
  return <span className="c num">{formatCountSk(value)}</span>;
}

/* ═══════════════════════════ 3. Panel ═════════════════════════════════════ */

export interface CatalogFiltersProps {
  filter: CatalogFilterState;
  counts: CatalogCountsView | null;
  lockedFilters: Readonly<Record<string, LockedFilterView>>;
  saved: readonly SavedFilter[];
  /** Meno uloženého filtra, ktorý presne sedí s aktuálnym stavom. */
  activeSaved: string | null;
  /** Otvorený panel na mobile. Na desktope je otvorený vždy. */
  open: boolean;
  onChange: (patch: Partial<CatalogFilterState>) => void;
  onApplySaved: (query: string) => void;
  onRemoveSaved: (name: string) => void;
}

export function CatalogFilters({
  filter,
  counts,
  lockedFilters,
  saved,
  activeSaved,
  open,
  onChange,
  onApplySaved,
  onRemoveSaved,
}: CatalogFiltersProps) {
  const locked = Object.keys(lockedFilters);

  function toggleBucket(bucket: SoldBucket, on: boolean) {
    const next = on
      ? [...filter.soldBuckets, bucket]
      : filter.soldBuckets.filter((b) => b !== bucket);
    onChange({ soldBuckets: next, page: 1 });
  }

  const soldCount = (bucket: SoldBucket): number | null =>
    counts === null ? null : counts.sold[bucket];

  return (
    <aside className={open ? 'filters open' : 'filters'} data-testid="catalog-filters">
      {saved.length > 0 ? (
        <div className="fgroup">
          <h3>Uložené filtre</h3>
          <div className="chips">
            {saved.map((row) => (
              <span key={row.name} className={row.name === activeSaved ? 'chip on' : 'chip'}>
                <button type="button" style={BARE_BUTTON} onClick={() => onApplySaved(row.query)}>
                  {row.name}
                </button>
                <button
                  type="button"
                  className="x"
                  style={BARE_BUTTON}
                  aria-label={`Zabudnúť uložený filter ${row.name}`}
                  onClick={() => onRemoveSaved(row.name)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="fgroup">
        <h3>Obdobie</h3>
        <div className="seg" aria-label="Za koľko dní sa počítajú predané kusy">
          {SOLD_WINDOWS.map((days: SoldWindow) => (
            <button
              key={days}
              type="button"
              className={days === filter.soldWindowDays ? 'on' : undefined}
              aria-pressed={days === filter.soldWindowDays}
              onClick={() => onChange({ soldWindowDays: days, page: 1 })}
            >
              {days}
            </button>
          ))}
        </div>
      </div>

      <div className="fgroup">
        <h3>Predajnosť</h3>
        {BUCKET_LABELS.map(({ bucket, label }) => (
          <label className="fopt" key={bucket}>
            <input
              className="cb"
              type="checkbox"
              checked={filter.soldBuckets.includes(bucket)}
              onChange={(event) => toggleBucket(bucket, event.target.checked)}
              data-testid={`filter-sold-${bucket}`}
            />
            {label}
            <Count value={soldCount(bucket)} />
          </label>
        ))}
        <LockedGroup codes={LOCKED_IN_SOLD} locked={locked} />
      </div>

      {/* Sklad je dnes celý bez dát (shop ho cez API nevracia). Keď pribudne,
          zmizne z `lockedFilters` — a vtedy sem patria skutočné možnosti;
          prázdna skupina s nadpisom by vyzerala ako pokazený filter. */}
      {LOCKED_IN_STOCK.some((code) => locked.includes(code)) ? (
        <div className="fgroup">
          <h3>Sklad</h3>
          <LockedGroup codes={LOCKED_IN_STOCK} locked={locked} />
        </div>
      ) : null}

      <div className="fgroup">
        <h3>Cena</h3>
        <div className="row">
          <input
            className="inp"
            style={{ width: '78px' }}
            inputMode="decimal"
            value={filter.priceFrom}
            aria-label="Cena od"
            placeholder="od"
            onChange={(event) => onChange({ priceFrom: event.target.value, page: 1 })}
            data-testid="filter-price-from"
          />
          <span className="lvl-3">–</span>
          <input
            className="inp"
            style={{ width: '78px' }}
            inputMode="decimal"
            value={filter.priceTo}
            aria-label="Cena do"
            placeholder="do"
            onChange={(event) => onChange({ priceTo: event.target.value, page: 1 })}
            data-testid="filter-price-to"
          />
          <span className="lvl-3">€</span>
        </div>
      </div>

      <div className="fgroup">
        <h3>História zliav</h3>
        <label className="fopt">
          <input
            className="cb"
            type="checkbox"
            checked={filter.currentlyDiscounted}
            onChange={(event) => onChange({ currentlyDiscounted: event.target.checked, page: 1 })}
            data-testid="filter-discounted-now"
          />
          Práve v zľave
          <Count value={counts === null ? null : counts.discountedNow} />
        </label>
        <label className="fopt">
          <input
            className="cb"
            type="checkbox"
            checked={filter.neverDiscounted}
            onChange={(event) => onChange({ neverDiscounted: event.target.checked, page: 1 })}
            data-testid="filter-never-discounted"
          />
          Nikdy nezlacnené
          <Count value={counts === null ? null : counts.neverDiscounted} />
        </label>
        <div className="lvl-3" style={{ marginTop: '4px' }}>
          Podľa vlastných zápisov appky.
        </div>
      </div>

      {LOCKED_STANDALONE.some((code) => locked.includes(code)) ? (
        <div className="fgroup">
          <h3>Zatiaľ nedostupné</h3>
          <LockedGroup codes={LOCKED_STANDALONE} locked={locked} />
          <div className="lvl-3" style={{ marginTop: '6px' }}>
            {SURFACE_TERMS.lockedFeature} · <a href="/nastavenia#zamknute">viac</a>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export default CatalogFilters;
