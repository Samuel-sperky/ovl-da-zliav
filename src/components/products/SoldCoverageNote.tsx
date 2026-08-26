/**
 * Aura Zľavy — VETA O POKRYTÍ PREDAJNOSTI (KONTRAKT-PREDAJNOST P3; kontrakt V3 K8).
 *
 * Stojí tam, kde sa predajnosť číta a kde sa podľa nej rozhoduje: nad tabuľkou
 * Produktov a nad pásmami v sprievodcovi. Text skladá `soldCoverageNote()` —
 * tento komponent nič neformuluje, len vykresľuje, a keď nie je čo priznať,
 * nevykreslí ani prázdny rám.
 *
 * Server-safe: žiadne hooky, žiadne `use client`. Pokrytie prichádza ako
 * vlastnosť, takže sa dá vykresliť aj v teste bez prehliadača a bez siete.
 *
 * Vlastník: V10.
 */
import Note from '@/components/ui/Note';
import type { SoldCoverageState } from '@/components/products/sold-coverage';
import { soldCoverageNote } from '@/components/products/sold-coverage';

export interface SoldCoverageNoteProps {
  /** Čo appka o stiahnutých dňoch vie. */
  coverage: SoldCoverageState;
  /** Okno, na ktoré sa obrazovka práve pýta (30, 60, 90, 180, 360). */
  windowDays: number;
  /** `data-testid` koreňa — nech sa dá adresovať v teste aj v e2e. */
  testId?: string;
}

export function SoldCoverageNote({
  coverage,
  windowDays,
  testId = 'sold-coverage-note',
}: SoldCoverageNoteProps) {
  const note = soldCoverageNote(coverage, windowDays);
  if (note === null) return null;
  return (
    <Note variant={note.variant} testId={testId}>
      {note.text}
    </Note>
  );
}

export default SoldCoverageNote;
