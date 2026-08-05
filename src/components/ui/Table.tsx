/**
 * Aura Zľavy — tabuľkový primitív (§8).
 *
 * Deklaratívna tabuľka so slovenským empty stavom.
 *
 * Redizajn (plán §2 bod 19, V24, V38):
 *   · `kind` na stĺpci určuje typ hodnoty — `num`/`money`/`date` dostanú
 *     tabulárne číslice a `nowrap` (dnes sa `2 450,00 €` láme na tri riadky
 *     a `−12 %` na dva),
 *   · na mobile sa tabuľka prekreslí do kariet (`data-label` z hlavičky) —
 *     appka je na telefóne scenár „pozriem, čo beží", nie zápis,
 *   · `stickyFirst` je alternatíva pre široké prehľadové tabuľky (audit):
 *     tabuľkový charakter zostane, prvý stĺpec sa ukotví a pravá hrana dostane
 *     scroll fade, aby bolo vidieť, že tam ďalšie stĺpce sú.
 */
import type { ReactNode } from 'react';

export type ColumnKind = 'text' | 'num' | 'money' | 'date';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Zarovnanie čísel doprava (`ovl-num`). Skratka pre `kind: 'num'`. */
  numeric?: boolean;
  /** Typ hodnoty — riadi zarovnanie, tabulárne číslice a `nowrap`. */
  kind?: ColumnKind;
  /** Text hlavičky pre kartový režim na mobile; default = `header`, ak je string. */
  label?: string;
}

export interface TableProps<T> {
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string | number;
  emptyLabel?: string;
  /** Akcia pri prázdnom stave (napr. „Zmazať filter"). */
  emptyAction?: ReactNode;
  caption?: string;
  /**
   * Ukotviť prvý stĺpec a nechať tabuľku horizontálne scrollovať namiesto
   * kartového režimu na mobile.
   */
  stickyFirst?: boolean;
}

function cellClass<T>(c: TableColumn<T>): string | undefined {
  const kind: ColumnKind = c.kind ?? (c.numeric ? 'num' : 'text');
  if (kind === 'num' || kind === 'money') return 'ovl-num';
  if (kind === 'date') return 'ovl-date';
  return undefined;
}

function labelOf<T>(c: TableColumn<T>): string | undefined {
  if (c.label != null) return c.label;
  return typeof c.header === 'string' ? c.header : undefined;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  emptyLabel = 'Žiadne záznamy.',
  emptyAction,
  caption,
  stickyFirst = false,
}: TableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="ovl-stack">
        <p className="ovl-muted ovl-small" style={{ margin: 0 }}>
          {emptyLabel}
        </p>
        {emptyAction}
      </div>
    );
  }
  const wrapClass = ['ovl-table-wrap', stickyFirst ? 'ovl-table-wrap--sticky-first' : '']
    .filter(Boolean)
    .join(' ');
  const tableClass = [
    'ovl-table',
    stickyFirst ? 'ovl-table--sticky-first' : 'ovl-table--cards',
  ].join(' ');
  return (
    <div className={wrapClass}>
      <table className={tableClass}>
        {caption ? <caption className="ovl-small ovl-muted">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cellClass(c)} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={cellClass(c)} data-label={labelOf(c)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Table;
