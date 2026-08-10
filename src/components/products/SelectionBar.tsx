'use client';

/**
 * Aura Zľavy — spodná lišta výberu tabu Produkty (V10; `design/v3/produkty.html`).
 *
 * Vysunie sa zdola, až keď je niečo označené. Nesie dve veci, ktoré sa ľahko
 * pomýlia a preto sú v texte oddelené:
 *
 *   `11 vybraných na tejto stránke` — čo som naklikal,
 *   `Vybrať všetkých 11 640`        — čo vyhovuje filtru.
 *
 * Rozdiel je podstatný: druhá možnosť nepošle do zľavy zoznam čísel, ale
 * FILTER (`newDiscountHref`), takže sprievodca sa spýta na tie isté riadky
 * a adresa neopuchne na desaťtisíce čísel.
 *
 * Strop na jednu zľavu (K1) sa tu len POVIE — nezmenšuje výber a nič
 * neodmieta. Orezanie je rozhodnutie sprievodcu, nie tabuľky; tabuľka by
 * inak potichu zahodila niečo, čo si používateľ označil.
 *
 * Vlastník: V10.
 */
import Link from 'next/link';
import { useState } from 'react';

import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface SelectionBarProps {
  /** Koľko riadkov je označených na práve zobrazenej stránke. */
  pageSelected: number;
  /** Koľko riadkov je označených celkovo (naprieč stránkami). */
  totalSelected: number;
  /** Koľko riadkov vyhovuje filtru. */
  matching: number;
  /** Účinný strop produktov na jednu zľavu; `null` = ešte ho nepoznáme. */
  maxProducts: number | null;
  allMatchingSelected: boolean;
  discountHref: string;
  onSelectAllMatching: () => void;
  onClear: () => void;
  onSaveFilter: (name: string) => void;
}

export function SelectionBar({
  pageSelected,
  totalSelected,
  matching,
  maxProducts,
  allMatchingSelected,
  discountHref,
  onSelectAllMatching,
  onClear,
  onSaveFilter,
}: SelectionBarProps) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const count = allMatchingSelected ? matching : totalSelected;
  const onlyThisPage = !allMatchingSelected && totalSelected === pageSelected;
  const overCap = maxProducts !== null && count > maxProducts;

  function save() {
    const trimmed = name.trim();
    if (trimmed === '') return;
    onSaveFilter(trimmed);
    setName('');
    setNaming(false);
  }

  return (
    <div className="selbar" data-testid="selection-bar">
      <span className="cnt num">
        {formatCountSk(count)}
        <small>
          {allMatchingSelected
            ? 'vybraných podľa filtra'
            : onlyThisPage
              ? 'vybraných na tejto stránke'
              : 'vybraných'}
        </small>
      </span>

      {!allMatchingSelected && matching > totalSelected ? (
        <button
          type="button"
          className="all"
          style={{ background: 'transparent', border: 0, font: 'inherit', cursor: 'pointer' }}
          onClick={onSelectAllMatching}
          data-testid="select-all-matching"
        >
          Vybrať všetkých {formatCountSk(matching)}
          {maxProducts === null
            ? ''
            : ` · do jednej zľavy sa zmestí ${formatCountSk(maxProducts)}`}
        </button>
      ) : null}

      {overCap && maxProducts !== null ? (
        <span className="flag" data-testid="selection-over-cap">
          do jednej zľavy sa zmestí {formatCountSk(maxProducts)}{' '}
          {pluralSk(maxProducts, 'produkt', 'produkty', 'produktov')}
        </span>
      ) : null}

      <div className="sp">
        {naming ? (
          <>
            <input
              className="inp"
              style={{ width: '180px' }}
              value={name}
              autoFocus
              placeholder="Pomenujte filter"
              aria-label="Meno filtra"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') save();
                if (event.key === 'Escape') setNaming(false);
              }}
              data-testid="save-filter-name"
            />
            <button type="button" className="btn ghost" onClick={save} data-testid="save-filter-confirm">
              Uložiť
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={onClear} data-testid="clear-selection">
              Zrušiť výber
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setNaming(true)}
              data-testid="save-filter"
            >
              Uložiť filter
            </button>
          </>
        )}
        <Link className="btn primary" href={discountHref} data-testid="discount-selection">
          Zlacniť
        </Link>
      </div>
    </div>
  );
}

export default SelectionBar;
