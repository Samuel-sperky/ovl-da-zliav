/**
 * Aura Zľavy — PREČO SA NIEČO NESTALO (zoznam prekážok; kontrakt dokončenia
 * C2, C5, kontrakt V3 K10).
 *
 * Jeden vykresľovač pre všetky tri obrazovky tabu Zľavy. Prekážky prichádzajú
 * z jediného zdroja pravdy (`lib/status/blockers.ts`) dvoma cestami — hotové zo
 * servera a lokálne prepočítané nad vlastným výberom — a `queue-model.ts` ich
 * zjednotil na `BlockerCard`. Tu sa už nič nerozhoduje ani neskladá; kreslí sa.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Farba podľa `resolution`, nie podľa `severity`.** Je to pravidlo
 *    `blockers.ts` a má dôvod: vyčerpaný denný rozpočet je závažnosťou
 *    „blokuje", ale nie je to chyba — appka počká do polnoci. Farbenie podľa
 *    závažnosti by z každého normálneho dňa spravilo poplach (K2).
 * 2. **Stav nikdy nie je len farba.** Každý riadok nesie farbu, glyf aj slovo
 *    o tom, kto to vyrieši (`RESOLUTION_WORD`). V tmavej téme sú jantárová a
 *    červená pod deuteranopiou takmer nerozlíšiteľné.
 * 3. **Veta sa tu neprepisuje.** `what` a `nextStep` sú hotové vety s číslami
 *    z `blockers.ts`. Skrátiť ich „aby sa to zmestilo" znamená zahodiť práve to
 *    číslo, kvôli ktorému veta vznikla.
 * 4. **Domnienka sa priznáva.** `assumed` znamená, že údaj chýbal a veta stojí
 *    na najprísnejšom predpoklade. Appka sa nesmie tváriť, že niečo vie.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';

import styles from '@/components/campaigns/zlavy.module.css';
import {
  RESOLUTION_GLYPH,
  RESOLUTION_TONE,
  RESOLUTION_WORD,
  type BlockerCard,
} from '@/components/campaigns/queue-model';
import { formatDateTimeSk } from '@/lib/ui/format';

/** Kam vedie prekážka — popis odkazu podľa cesty, nikdy podľa kódu. */
function pathLabel(path: string): string {
  if (path === '/nastavenia') return 'Otvoriť Nastavenia';
  if (path === '/produkty') return 'Otvoriť Produkty';
  if (path === '/') return 'Otvoriť Prehľad';
  return 'Otvoriť';
}

export interface BlockerRowProps {
  card: BlockerCard;
  testId?: string;
}

export function BlockerRow({ card, testId }: BlockerRowProps) {
  const tone = RESOLUTION_TONE[card.resolution];

  return (
    <div
      className={styles.blocker}
      data-tone={tone}
      data-blocker={card.id}
      data-testid={testId}
      role={tone === 'critical' ? 'alert' : 'status'}
    >
      <span className={styles.blockerGlyph} aria-hidden="true">
        {RESOLUTION_GLYPH[card.resolution]}
      </span>
      <div className={styles.blockerBody}>
        <div className={styles.blockerWhat}>{card.what}</div>
        {card.nextStep === '' ? null : (
          <div className={styles.blockerStep}>{card.nextStep}</div>
        )}
        <div className={styles.blockerMeta}>
          <span>{RESOLUTION_WORD[card.resolution]}</span>
          {card.clearsAt === null ? null : (
            <>
              <span className="sep-dot" aria-hidden="true">
                ·
              </span>
              <span>uvoľní sa {formatDateTimeSk(card.clearsAt)}</span>
            </>
          )}
          {card.assumed ? (
            <>
              <span className="sep-dot" aria-hidden="true">
                ·
              </span>
              <span>appka to nevie overiť, tak počíta s horším</span>
            </>
          ) : null}
          {card.path === null ? null : (
            <>
              <span className="sep-dot" aria-hidden="true">
                ·
              </span>
              <Link href={card.path}>{pathLabel(card.path)}</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export interface BlockerListProps {
  cards: readonly BlockerCard[];
  /** Nadpis nad zoznamom. Bez neho sa kreslia len riadky. */
  title?: string;
  testId?: string;
}

export function BlockerList({ cards, title, testId }: BlockerListProps) {
  if (cards.length === 0) return null;
  return (
    <div className={styles.blockers} data-testid={testId}>
      {title === undefined ? null : <div className={styles.blockersTitle}>{title}</div>}
      {cards.map((card) => (
        <BlockerRow key={card.id} card={card} />
      ))}
    </div>
  );
}

/**
 * Tiché pravidlá, ktoré nič nezastavujú (napr. trvalý strop, ktorý výber
 * neprekročil). Sú zbalené, lebo inak by prekryli skutočný problém — ale
 * nie skryté, lebo práve z nich sa dá zistiť, čo appka vôbec vie.
 */
export function BlockerRules({ cards, testId }: { cards: readonly BlockerCard[]; testId?: string }) {
  if (cards.length === 0) return null;
  return (
    <details className="tech" data-testid={testId}>
      <summary>Čo teraz platí</summary>
      <div className="body">
        {cards.map((card) => (
          <div key={card.id} className={styles.ruleRow}>
            <b>{card.what}</b>
            {card.nextStep === '' ? null : <div className="lvl-3">{card.nextStep}</div>}
          </div>
        ))}
      </div>
    </details>
  );
}

export default BlockerList;
