'use client';

/**
 * Aura Zľavy — PALETA GRAFU PRE KOMPONENT (D135, D142, V6a).
 *
 * Jediné miesto, odkiaľ si graf vypýta farby. Nie preto, aby ich vypočítal, ale
 * aby si ich NEPÍSAL: `useChartTheme().series[0]` je jedna vec, `var(--chart-1)`
 * napísané v pätnástich komponentoch je pätnásť vecí, ktoré sa raz rozídu.
 *
 * PREČO TU NIE JE ŽIADNY EFEKT — a čo to znamená
 * ──────────────────────────────────────────────
 * Predloha (`aura-roadmap/src/components/charts/useChartTheme.ts`) drží stav,
 * číta `getComputedStyle` v efekte a pozoruje `data-theme` mutáciou. Musí,
 * pretože jej `chartTheme()` vracia rozlíšené hexy a tie sa pri prepnutí témy
 * menia.
 *
 * Tu `chartTheme()` vracia `var(--token)` (dôvod je v `chart-language.ts`,
 * sekcia 7), takže hodnoty sa NEMENIA — mení sa to, na čo sa doriešia, a to
 * robí prehliadač sám. Efekt by preto neprekresľoval nič a len by predstieral
 * prácu. Prepnutie témy je tým lacnejšie a spoľahlivejšie než v predlohe:
 * funguje aj pri prvom renderi, aj na serveri, aj keď JavaScript zlyhá.
 *
 * Hook to zostáva zámerne. Je to STABILNÝ vstupný bod pre všetky grafy V6b:
 * keby raz nejaký graf potreboval farbu ako HODNOTU v JavaScripte (počítať
 * kontrast, kresliť do canvasu), pridá sa čítanie sem — do jedného súboru,
 * ktorý už všetky grafy volajú — a ani jeden z nich sa nemusí zmeniť. Keby
 * `chartTheme()` volali priamo, bola by to úprava každého grafu v appke.
 *
 * Vlastník: V6a-GRAFY.
 */
import { chartTheme, type ChartTheme } from '@/components/ui/chart-language';

/**
 * Paleta je pre celý beh appky tá istá, takže sa skladá RAZ. Nová referencia
 * pri každom renderi by zbytočne prekresľovala Recharts, ktorý si props sérií
 * porovnáva podľa identity.
 */
const CHART_THEME: ChartTheme = chartTheme();

/** Paleta grafu. Farby sú `var(--token)` — tému dorieši prehliadač. */
export function useChartTheme(): ChartTheme {
  return CHART_THEME;
}

export default useChartTheme;
