/**
 * Aura Zľavy — panel neúspešnej akcie (mutácie).
 *
 * Prečo to má vlastný komponent: presne tento stav priviedol používateľa
 * k tomu, že si myslel, že API kľúč do produkčného shopu je uložený, hoci POST
 * spadol a neuložilo sa nič. Rovnaké správanie preto musí platiť na VŠETKÝCH
 * mutáciách nastavení, nie len na jednej.
 *
 * Do 27. 8. 2026 panel navyše rozlišoval 401 `unauthorized` a ponúkal odkaz na
 * `/login`. Prihlásenie zmizlo (D99), takže s ním aj tá vetva — appka nesmie
 * ponúkať cestu, ktorá neexistuje.
 *
 * Text a tón určuje čistá `describeActionFailure()` (`lib/ui/action-failure.ts`);
 * tento komponent ho už len vykreslí. Žiadne tajomstvo sem nikdy nevstupuje —
 * dostáva výhradne `{code, message}` z API obálky (I1).
 */
import ErrorMessage from '@/components/ui/ErrorMessage';
import type { ActionFailure as ActionFailureData } from '@/lib/ui/action-failure';

export interface ActionFailurePanelProps {
  failure: ActionFailureData | null;
  /** `data-testid` panelu — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function ActionFailurePanel({ failure, testId }: ActionFailurePanelProps) {
  if (!failure) return null;
  return (
    <div className="ovl-stack" style={{ gap: '0.35rem' }} data-testid={testId}>
      <ErrorMessage message={failure.message} rawCode={failure.rawCode} tone={failure.tone} />
    </div>
  );
}

export default ActionFailurePanel;
