/**
 * Aura Zľavy — DÁTOVÁ TABUĽKA POD GRAFOM (V1, kontrakt UX/dizajn 19. 8. 2026).
 *
 * Ku každému grafu v tejto appke musí existovať tabuľka s tými istými číslami.
 * Nie je to ústupok prístupnosti, je to podmienka, za ktorej sa graf vôbec smie
 * nakresliť: SVG je pre čítačku obrazovky jeden obrázok a `aria-label` unesie
 * vetu, nie rad hodnôt. Kto sem pridá graf bez tabuľky, urobí časť prístrojovej
 * dosky nečitateľnou pre časť ľudí — a nič to nenahlási.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Tabuľka sa rozíde s grafom.** Toto je najhoršia možnosť zo všetkých:
 *     dve čísla o produkčnom eshope, každé iné, a obe vyzerajú dôveryhodne.
 *     Preto sa riadky NIKDY neskladajú zvlášť — volajúci ich musí odvodiť
 *     z tej istej hodnoty, z akej kreslí značky. Kto sem začne posielať
 *     samostatne dopočítané čísla, vyrobí druhý zdroj pravdy.
 *
 *  2. **Do tabuľky sa dostane odhad bez označenia.** Tabuľka je doslovný
 *     prepis grafu vrátane toho, čo graf priznáva: nedokončený deň, chýbajúce
 *     obdobie, orezané pásmo. Na to slúži stĺpec `note` — nie poznámka pod
 *     tabuľkou, ktorú si nikto nespojí s riadkom.
 *
 *  3. **Rozklik sa zmení na zložený stav.** `<details>` je zámerne bez
 *     `open` — tabuľka je alternatíva, nie druhá polovica obsahu. Kto ju
 *     otvorí natvrdo, zdvojí každý graf na obrazovke.
 *
 * Vlastník: V1.
 */
import styles from '@/components/charts/charts.module.css';

export interface ChartTableColumn {
  /** Hlavička stĺpca — slovensky, bez skratiek. */
  head: string;
  /** Čísla sa zarovnávajú doprava; text doľava. */
  numeric?: boolean;
}

export interface ChartTableRow {
  /** Bunky v poradí stĺpcov. Prázdna hodnota je pomlčka, nikdy nula. */
  cells: readonly string[];
}

export interface ChartTableProps {
  /** Čo tabuľka prepisuje — dopĺňa sa do textu rozkliku. */
  caption: string;
  columns: readonly ChartTableColumn[];
  rows: readonly ChartTableRow[];
  testId?: string;
}

/**
 * Rozklik s doslovným prepisom grafu.
 *
 * Text rozkliku je vždy „Dátová tabuľka grafu" plus to, čoho sa graf týka.
 * Jedno pomenovanie naprieč appkou je zámer: kto si raz nájde tabuľku pod
 * jedným grafom, vie ju hľadať pod každým ďalším.
 */
export function ChartTable({ caption, columns, rows, testId }: ChartTableProps) {
  return (
    <details className={`tech ${styles.tableFold}`} data-testid={testId}>
      <summary>Dátová tabuľka grafu — {caption}</summary>
      <div className="body">
        <table className={styles.dataTable}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.head} className={column.numeric === true ? 'num' : undefined}>
                  {column.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.cells.join('|')}>
                {row.cells.map((cell, index) => (
                  <td
                    key={columns[index]?.head ?? String(index)}
                    className={columns[index]?.numeric === true ? 'num' : undefined}
                  >
                    {cell === '' ? '—' : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default ChartTable;
