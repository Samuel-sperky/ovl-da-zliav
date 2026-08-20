/**
 * Aura Zľavy — stav zľavy a jeho príznaky ako jeden riadok (V11, architektúra §4).
 *
 * Značku stavu aj príznaku kreslí od 19. 8. 2026 `<StateMark>` / `<FlagMark>`
 * (`ui/StatusMark.tsx`), nie `content:` v `::before`. Triedy `.state.*` a
 * `.flag` nesú už len farbu a typografiu; kto pridá tretí stav a zabudne na
 * značku, dostane stav zredukovaný na farbu a slovo — a nič nespadne.
 *
 * Gramatika je vždy `stav · príznak · príznak`. Stav má presne štyri slová
 * (`pripravená`, `zapisuje sa`, `beží`, `skončila`) a príznak NIKDY nestojí
 * namiesto stavu ani nemení jeho farbu — zľava so zlyhanými položkami stále
 * beží. Vetu skladá slovník (`lib/ui/vocabulary`), tento komponent ju len
 * oblieka do tried, ktoré vlastní `globals.css`.
 *
 * Červená je vyhradená pre stratu dát a zastavený zápis. Zlyhané položky sú
 * jantárové, vyčerpaný rozpočet sivý — je to informácia, nie chyba (K2).
 *
 * Vlastník: V11.
 */
import { FlagMark, StateMark } from '@/components/ui/StatusMark';
import styles from '@/components/campaigns/zlavy.module.css';
import type { CampaignSentence, FlagTone, StateTone } from '@/lib/ui/vocabulary';

const STATE_CLASS: Readonly<Record<StateTone, string>> = {
  idle: 'state pripravena',
  progress: 'state zapisuje',
  live: 'state bezi',
  done: 'state skoncila',
};

function flagClass(tone: FlagTone): string {
  if (tone === 'neutral') return 'flag neutral';
  if (tone === 'critical') return `flag ${styles.flagCritical}`;
  return 'flag';
}

export interface DiscountStateProps {
  sentence: CampaignSentence;
  testId?: string;
}

export function DiscountState({ sentence, testId }: DiscountStateProps) {
  return (
    <span data-testid={testId} data-state={sentence.tone}>
      <span className={STATE_CLASS[sentence.tone]}>
        <StateMark tone={sentence.tone} />
        {sentence.state}
      </span>
      {sentence.flags.map((flag) => (
        <span key={flag.text}>
          <span className="sep-dot" aria-hidden="true">
            ·
          </span>
          <span className={flagClass(flag.tone)}>
            <FlagMark tone={flag.tone} />
            {flag.text}
          </span>
        </span>
      ))}
    </span>
  );
}

export default DiscountState;
