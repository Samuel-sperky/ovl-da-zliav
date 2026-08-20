/**
 * Aura Zľavy — nenápadná výzva read-only režimu (D10).
 *
 * Pri chýbajúcom/expirovanom kľúči UI NEBLOKUJE nič na čítanie — všetky
 * zapisovacie akcie sú vypnuté s dôvodom (`Button disabledReason`) a pod
 * hlavičkou visí táto výzva s odkazom na vloženie nového kľúča.
 *
 * Redizajn: pás je full-bleed pod hlavičkou (predtým visel odsadený v strede
 * obsahu), ale zostáva nenápadný — žiadna veľká farebná plocha, len hairline
 * v tóne attention a jeden riadok textu. `READ_ONLY_TOOLTIP` je dôvod, ktorý
 * volajúci posiela do `Button disabledReason` (D10).
 */
import Link from 'next/link';

export interface ReadOnlyNoticeProps {
  keyPresent: boolean;
}

export const READ_ONLY_TOOLTIP =
  'API kľúč chýba alebo expiroval — appka je v režime len na čítanie. Vlož nový kľúč v Nastaveniach.';

export function ReadOnlyNotice({ keyPresent }: ReadOnlyNoticeProps) {
  if (keyPresent) return null;
  return (
    <div className="ovl-readonly-strip">
      <div className="ovl-readonly-notice" role="status" data-testid="readonly-notice">
        <span className="ovl-note-glyph" aria-hidden="true">
          ▲
        </span>
        Režim len na čítanie — API kľúč chýba alebo expiroval.{' '}
        <Link href="/nastavenia">Vložiť nový kľúč</Link>
      </div>
    </div>
  );
}

export default ReadOnlyNotice;
