/**
 * Aura Zľavy — ŠTYRI DLAŽDICE STAVU KATALÓGU, ZHUSTENÉ (D8, vlna O3).
 *
 * Kontrakt UI, bod 16: dlaždice OSTÁVAJÚ štyri. Neúplný katalóg je najväčšie
 * riziko tabu Produkty a z chýbajúcej dlaždice sa nedá zistiť, že tá otázka
 * vôbec existuje. Defekt D8 nie je v ich počte, ale v tom, koľko miesta zaberú,
 * keď tri zo štyroch nemajú čo povedať.
 *
 * ČO SA ZMENILO OPROTI `StatTile`
 * -------------------------------
 * Nič, čo by sa dalo dosiahnuť menším písmom. Zmenil sa jeden vzťah: **detail
 * patrí k HODNOTE, nie k dlaždici.** Dlaždica s pomlčkou preto tretí riadok
 * vôbec nekreslí a jej dôvod ide do jedného spoločného rozkliku „Prečo —" —
 * presne v tvare, aký na dôvody pomlčiek používa stavový pruh (architektúra §0,
 * kontrakt UI bod 5). Predtým mala každá zo štyroch dlaždíc vlastnú
 * dvojriadkovú vysvetlivku a tri z nich vysvetľovali, prečo nič nevedia.
 *
 * Detail hodnoty sa navyše NEZALAMUJE: v mriežke sú všetky bunky rovnako
 * vysoké, takže jedna zalomená vysvetlivka predlžovala celý pás. Celý text
 * zostáva dostupný v `title`.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Štyri dlaždice, vždy.** Komponent nič nevynecháva a nezlučuje; keď
 *     hodnota nie je známa, je to POMLČKA, nikdy nula (kontrakt UI, bod 5).
 *  2. **`data-testid` dlaždíc sa nemení.** Vedie na ne e2e (`katalog-obnova`)
 *     a je to jediná cesta, ako sa dá overiť, že karta hovorí pravdu.
 *  3. **Vlastný vzhľad sa nezavádza.** Geometria je `.kpis` / `.kpi` zo
 *     spoločného systému; tu sa iba uberá vzduch, žiadna nová farba ani nová
 *     rola popisku (tri roly z vlny F ostávajú tri).
 *
 * Vlastník: O3.
 */

import type { CatalogTileView } from '@/components/products/catalog-status';

/** Čo appka nevie. Nikdy nula — nula je tvrdenie. */
export const UNKNOWN_VALUE = '—';

export interface CatalogTile {
  readonly label: string;
  readonly view: CatalogTileView;
  readonly testId: string;
}

/* Zhustenie nesie trieda `.kpi.dense` v globals.css, nie inline štýly:
   geometria dlaždice patrí k `.kpi`, aby sa dala nájsť na jednom mieste. */

export interface CatalogTilesProps {
  readonly tiles: readonly CatalogTile[];
}

export function CatalogTiles({ tiles }: CatalogTilesProps) {
  const unknown = tiles.filter((tile) => tile.view.value === UNKNOWN_VALUE);

  return (
    <>
      <div className="kpis" data-testid="catalog-tiles">
        {tiles.map(({ label, view, testId }) => {
          const missing = view.value === UNKNOWN_VALUE;
          return (
            <div className="kpi dense" key={testId} data-testid={testId}>
              <div className="k">
                {label}
              </div>
              <div className="v" data-unknown={missing ? 'ano' : 'nie'}>
                {view.value}
              </div>
              {missing ? null : (
                <div className="s" title={view.detail}>
                  {view.detail}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Dôvody pomlčiek na JEDNOM mieste (P6). Keď appka vie všetko, rozklik
          sa nekreslí — prázdny rozklik je pozvánka do prázdnej miestnosti. */}
      {unknown.length === 0 ? null : (
        <details className="tech bare" style={{ marginTop: '6px' }} data-testid="catalog-tiles-why">
          <summary>Prečo {UNKNOWN_VALUE}</summary>
          <div className="body">
            <table>
              <tbody>
                {unknown.map((tile) => (
                  <tr key={tile.testId}>
                    <td>{tile.label}</td>
                    <td>{tile.view.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

export default CatalogTiles;
