/**
 * Aura Zľavy — badge „podľa vlastného zápisu z DD.MM." (D7, D38, I11).
 *
 * Appka NIKDY netvrdí, že pozná skutočný stav zľavy v shope. Každé zobrazenie
 * stavu zľavy nesie tento badge a dovetok „shop môže mať iný stav" je povinný
 * a neodstrániteľný.
 *
 * Redizajn (plán §2 bod 7): viditeľný text je skrátený na `vlastný zápis 05.08.`,
 * PLNÉ znenie nesie `title` **aj** `aria-label` — teda zostáva v prístupnostnom
 * strome pri každej položke — a raz na sekciu sa vykreslí `<SelfWriteLegend/>`.
 * Deväť identických viet pod sebou prestalo byť varovaním a začalo byť šumom.
 *
 * Forma badge (prerušovaný okraj + kurzíva) sa NEMENÍ: práve ona odlišuje
 * „našu evidenciu" od „tvrdenia o shope" aj bez farby (K9).
 */
import { formatDayMonthSk } from '@/lib/ui/format';

export const SELF_WRITE_SUFFIX = 'shop môže mať iný stav';

/** Plné znenie D7 pre `title`/`aria-label` a pre legendu sekcie. */
export function selfWriteFullText(writtenAt: string | Date | null): string {
  return writtenAt == null
    ? `bez vlastného zápisu — ${SELF_WRITE_SUFFIX}`
    : `podľa vlastného zápisu z ${formatDayMonthSk(writtenAt)} — ${SELF_WRITE_SUFFIX}`;
}

export interface SelfWriteBadgeProps {
  /** Dátum posledného VLASTNÉHO zápisu; `null` = žiadny vlastný zápis. */
  writtenAt: string | Date | null;
  /** Voliteľný detail zápisu (percento, okno) — pridá sa do tooltipu. */
  detail?: string;
}

export function SelfWriteBadge({ writtenAt, detail }: SelfWriteBadgeProps) {
  const full = selfWriteFullText(writtenAt);
  const tooltip = detail ? `${full} · ${detail}` : full;
  const short =
    writtenAt == null ? 'bez vlastného zápisu' : `vlastný zápis ${formatDayMonthSk(writtenAt)}`;
  return (
    <span className="ovl-selfwrite" title={tooltip} aria-label={tooltip}>
      {short}
    </span>
  );
}

/**
 * Plné znenie D7 raz na sekciu — patrí pod nadpis zoznamu alebo tabuľky.
 * Sekcie so `SelfWriteBadge` ju MAJÚ vykresliť (plán §2 bod 7).
 */
export function SelfWriteLegend() {
  return (
    <p className="ovl-legend" data-testid="selfwrite-legend">
      Stavy zliav sú „podľa vlastného zápisu z DD.MM." — {SELF_WRITE_SUFFIX}. Appka pozná len to,
      čo sama zapísala.
    </p>
  );
}

export default SelfWriteBadge;
