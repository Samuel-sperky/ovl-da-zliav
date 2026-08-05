/**
 * Aura Zľavy — tabuľkový primitív (§8).
 *
 * Deklaratívna tabuľka so slovenským empty stavom a horizontálnym
 * scrollom na úzkych obrazovkách.
 */
import type { ReactNode } from 'react';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Zarovnanie čísel doprava (`ovl-num`). */
  numeric?: boolean;
}

export interface TableProps<T> {
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string | number;
  emptyLabel?: string;
  caption?: string;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  emptyLabel = 'Žiadne záznamy.',
  caption,
}: TableProps<T>) {
  if (rows.length === 0) {
    return <p className="ovl-muted ovl-small">{emptyLabel}</p>;
  }
  return (
    <div className="ovl-table-wrap">
      <table className="ovl-table">
        {caption ? <caption className="ovl-small ovl-muted">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.numeric ? 'ovl-num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'ovl-num' : undefined}>
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
