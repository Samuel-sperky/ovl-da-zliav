/**
 * Aura Zľavy — panel neúspešnej akcie (mutácie).
 *
 * Nad `ErrorMessage` pridáva jedinú, ale dôležitú vec: keď akcia spadla na
 * CHÝBAJÚCU SESSION (401 `unauthorized`), hláška nie je generická červená chyba,
 * ktorá vyzerá ako porucha appky, ale ľudská veta („nie si prihlásený, akcia sa
 * nevykonala") plus odkaz na prihlásenie.
 *
 * Prečo to má vlastný komponent: presne tento stav priviedol používateľa
 * k tomu, že si myslel, že API kľúč do produkčného shopu je uložený, hoci
 * POST spadol na 401 a neuložilo sa nič. Rovnaké správanie preto musí platiť
 * na VŠETKÝCH mutáciách nastavení, nie len na jednej.
 *
 * Text a tón určuje čistá `describeActionFailure()` (`lib/ui/first-run.ts`);
 * tento komponent ho už len vykreslí. Žiadne tajomstvo sem nikdy nevstupuje —
 * dostáva výhradne `{code, message}` z API obálky (I1).
 */
import Link from 'next/link';

import ErrorMessage from '@/components/ui/ErrorMessage';
import { LOGIN_PATH, type ActionFailure as ActionFailureData } from '@/lib/ui/first-run';

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
      {failure.needsLogin ? (
        <p className="ovl-small" style={{ margin: 0 }}>
          <Link href={LOGIN_PATH} data-testid="action-failure-login-link">
            Prejsť na prihlásenie →
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export default ActionFailurePanel;
