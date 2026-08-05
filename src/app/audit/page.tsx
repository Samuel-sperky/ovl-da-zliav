/**
 * Aura Zľavy — `/audit` (A16, §8, D18, D39c, I4).
 *
 * Filtre (produkt, dátum, typ operácie, výsledok), tabuľka a detail so
 * snapshotmi pred/po. Audit je append-only — z UI sa nedá nič upraviť
 * ani zmazať (I4).
 */
import type { Metadata } from 'next';

import AuditPanel from '@/components/audit/AuditPanel';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Audit — ${APP_DISPLAY_NAME}`,
};

export default function AuditPage() {
  return (
    <>
      <h1 style={{ fontSize: '1.3rem', margin: '0 0 0.35rem' }}>Audit log</h1>
      <p className="ovl-small ovl-muted" style={{ margin: '0 0 1rem' }}>
        Každá operácia appky je tu zapísaná natrvalo. Záznamy sa nikdy nemenia
        ani nemažú a API kľúč v nich nikdy nie je.
      </p>
      <AuditPanel />
    </>
  );
}
