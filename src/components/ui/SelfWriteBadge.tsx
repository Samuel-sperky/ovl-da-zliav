/**
 * Aura Zľavy — badge „podľa vlastného zápisu z DD.MM." (D7, D38, I11).
 *
 * Appka NIKDY netvrdí, že pozná skutočný stav zľavy v shope. Každé
 * zobrazenie stavu zľavy nesie tento badge; dovetok „shop môže mať iný
 * stav" je povinný a neodstrániteľný.
 */
import { formatDayMonthSk } from '@/lib/ui/format';

export interface SelfWriteBadgeProps {
  /** Dátum posledného VLASTNÉHO zápisu; `null` = žiadny vlastný zápis. */
  writtenAt: string | Date | null;
  /** Voliteľný detail zápisu (percento, okno) pre title tooltip. */
  detail?: string;
}

export function SelfWriteBadge({ writtenAt, detail }: SelfWriteBadgeProps) {
  const suffix = 'shop môže mať iný stav';
  if (writtenAt == null) {
    return (
      <span className="ovl-selfwrite" title={detail}>
        bez vlastného zápisu — {suffix}
      </span>
    );
  }
  return (
    <span className="ovl-selfwrite" title={detail}>
      podľa vlastného zápisu z {formatDayMonthSk(writtenAt)} — {suffix}
    </span>
  );
}

export default SelfWriteBadge;
