/**
 * Aura Zľavy — HĽADANIE BODU POD KURZOROM (V1).
 *
 * Vrstva myši je pri čiarovom grafe PREDVOLENÁ, nie bonus: bez nej sa hodnota
 * konkrétneho dňa nedá prečítať inak než odhadom z osi. Aby sa dala otestovať
 * bez prehliadača, je celé hľadanie tu — v čistých funkciách, ktoré nevedia nič
 * o `DOM`, `React` ani `SVG`.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Prepočet z pixelov do sústavy `viewBox` sa rozíde so skutočnou šírkou.**
 *     Graf sa vykresľuje na `width: 100%`, takže mierka závisí od šírky stĺpca
 *     a mení sa pri každom preložení okna. Preto sa počíta z NAMERANEJ šírky
 *     rámu (`rect.width`), nikdy z konštanty. Keby sa tu objavila pevná šírka,
 *     bublina by na inom rozlíšení ukazovala susedný deň — a vyzeralo by to
 *     ako chyba dát, nie ako chyba prepočtu.
 *
 *  2. **Bublina začne ukazovať aj tam, kde meranie nie je.** `nearestPoint()`
 *     vracia najbližší MERANÝ bod bez ohľadu na vzdialenosť. Volajúci preto
 *     musí kresliť bublinu len vtedy, keď kurzor je v ráme — inak by graf nad
 *     dierou v pokrytí ukázal hodnotu susedného dňa a tvrdil o nesťahovanom dni
 *     niečo, čo appka nevie.
 *
 * Vlastník: V1.
 */

/** Rozmer rámu, ako ho nameral prehliadač. */
export interface FrameRect {
  left: number;
  width: number;
}

/**
 * Vodorovná poloha kurzora prepočítaná do sústavy `viewBox`.
 * `null`, keď rám nemá šírku — vtedy sa nedá povedať nič.
 */
export function pointerToViewBoxX(
  clientX: number,
  rect: FrameRect,
  viewBoxWidth: number,
): number | null {
  if (!Number.isFinite(rect.width) || rect.width <= 0) return null;
  return ((clientX - rect.left) / rect.width) * viewBoxWidth;
}

/** Najbližší bod v sústave `viewBox`. `null`, keď nie je z čoho vyberať. */
export function nearestPoint<T extends { x: number }>(points: readonly T[], x: number): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = Math.abs(point.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

/**
 * Poloha bubliny v percentách šírky rámu. Držať ju v percentách a nie
 * v pixeloch je zámer: rám sa prispôsobuje šírke stĺpca a bublina sa tak
 * neposunie mimo bodu pri prvom preložení okna.
 */
export function tipLeftPercent(x: number, viewBoxWidth: number): number {
  if (viewBoxWidth <= 0) return 0;
  return Math.min(100, Math.max(0, (x / viewBoxWidth) * 100));
}
