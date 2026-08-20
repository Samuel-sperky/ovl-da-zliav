/**
 * Aura Zľavy — stav zľavy a jeho príznaky ako jeden riadok (V9, architektúra §4).
 *
 * Gramatika je vždy `stav · príznak · príznak`. Stav má presne štyri slová
 * a príznak NIKDY nestojí namiesto stavu ani nemení jeho farbu — zľava so
 * zlyhanými položkami stále beží. Vetu skladá slovník, tento komponent ju
 * len oblieka do tried, ktoré vlastní `globals.css`.
 *
 * Červená je vyhradená pre stratu dát a zastavený zápis. Zlyhané položky sú
 * jantárové, vyčerpaný rozpočet je sivý — je to informácia, nie chyba.
 *
 * Vlastník: V9.
 */
import type { CampaignSentence, FlagTone, StateTone } from '@/lib/ui/vocabulary';

import styles from '@/components/dashboard/overview.module.css';

/** Tón stavu → trieda bodky z `globals.css`. */
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

export interface StateLineProps {
  sentence: CampaignSentence;
  testId?: string;
}

export function StateLine({ sentence, testId }: StateLineProps) {
  return (
    <span data-testid={testId} data-state={sentence.tone}>
      <span className={STATE_CLASS[sentence.tone]}>
        <span className="g" aria-hidden="true" />
        {sentence.state}
      </span>
      {sentence.flags.map((flag) => (
        <span key={flag.text}>
          <span className="sep-dot" aria-hidden="true">
            ·
          </span>
          <span className={flagClass(flag.tone)}>{flag.text}</span>
        </span>
      ))}
    </span>
  );
}

export default StateLine;
