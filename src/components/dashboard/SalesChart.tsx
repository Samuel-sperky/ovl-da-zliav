/**
 * Aura Zľavy — čiarový graf denného predaja (V9, architektúra §1 TAB 1).
 *
 * Jedna séria, jedna os, jedna trendová čiara. Druhá y-škála je zakázaná,
 * lebo dve rôzne škály v jednom ráme vyrábajú optický klam o vzťahu čísel.
 *
 * Dnešok sa kreslí PRERUŠOVANE a nevstupuje ani do priemeru, ani do trendu —
 * deň ešte beží a porovnávať polovicu dňa s celými dňami by klamalo.
 *
 * Geometriu počíta `sales-view.ts`; tu už nie je ani jeden výpočet, ktorý by
 * sa nedal otestovať bez prehliadača.
 *
 * Vlastník: V9.
 */
import type { ChartGeometry } from '@/components/dashboard/sales-view';
import { CHART } from '@/components/dashboard/sales-view';

export interface SalesChartProps {
  geometry: ChartGeometry;
  /** Popis nad rámom — obdobie, ktoré graf naozaj pokrýva. */
  caption: string;
  /** Text pre čítačku obrazovky; graf je obrázok, nie dekorácia. */
  label: string;
}

export function SalesChart({ geometry, caption, label }: SalesChartProps) {
  return (
    <>
      <div className="ct">{caption}</div>
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        data-testid="sales-chart"
      >
        {geometry.gridLines.map((grid, index) => (
          <g key={grid.label}>
            <line
              className="ax"
              x1={CHART.left}
              y1={grid.y}
              x2={CHART.right + 10}
              y2={grid.y}
              strokeDasharray={index === 0 ? undefined : '2 4'}
            />
            <text x="0" y={grid.y + 3}>
              {grid.label}
            </text>
          </g>
        ))}

        <path className="area" d={geometry.areaPath} />
        <polyline className="line" points={geometry.linePoints} />

        {geometry.trendLine === null ? null : (
          <line
            className="line trend"
            x1={geometry.trendLine.x1}
            y1={geometry.trendLine.y1}
            x2={geometry.trendLine.x2}
            y2={geometry.trendLine.y2}
          />
        )}

        {geometry.todayPoint === null ? null : (
          <>
            <polyline
              className="line proj"
              points={`${geometry.points[geometry.points.length - 1]?.x ?? CHART.left},${
                geometry.points[geometry.points.length - 1]?.y ?? CHART.baseline
              } ${geometry.todayPoint.x},${geometry.todayPoint.y}`}
            />
            <circle
              cx={geometry.todayPoint.x}
              cy={geometry.todayPoint.y}
              r="3.4"
              fill="var(--gold2)"
            />
          </>
        )}

        {geometry.xLabels.map((tick) => (
          <text key={tick.label} x={tick.x - 12} y={CHART.height - 4}>
            {tick.label}
          </text>
        ))}
      </svg>
    </>
  );
}

export default SalesChart;
