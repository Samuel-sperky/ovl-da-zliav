/**
 * Aura Zľavy — nenápadná výzva read-only režimu (D10).
 *
 * Pri chýbajúcom/expirovanom kľúči UI NEBLOKUJE nič na čítanie — všetky
 * zapisovacie akcie sú disabled s tooltipom a v hlavičke visí táto výzva
 * s odkazom na vloženie nového kľúča.
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
    <div className="ovl-readonly-notice" role="status" data-testid="readonly-notice">
      Režim len na čítanie — API kľúč chýba alebo expiroval.{' '}
      <Link href="/nastavenia">Vložiť nový kľúč</Link>
    </div>
  );
}

export default ReadOnlyNotice;
