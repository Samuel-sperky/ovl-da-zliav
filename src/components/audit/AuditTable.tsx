'use client';

/**
 * Aura Zľavy — tabuľka histórie (V12; pôvodne A16).
 *
 * Tri stĺpce, presne ako predloha: <b>Kedy · Čo sa stalo · Kto</b>. Vnútorný
 * kód udalosti, číslo produktu, číslo zľavy ani odpoveď eshopu v nich NIE SÚ —
 * tie patria o úroveň nižšie, do rozkliku „Technický detail". Preto je na konci
 * riadku tlačidlo, ktoré ten rozklik otvorí.
 *
 * História je append-only: tento komponent nemá a NESMIE mať žiadnu akciu,
 * ktorá by riadok zmenila alebo zmazala.
 */
import Button from '@/components/ui/Button';
import { FlagMark } from '@/components/ui/StatusMark';
import { formatDateTimeSk } from '@/lib/ui/format';
import {
  auditActorLabel,
  auditEventLabel,
  auditProductLabel,
  type AuditRow,
} from '@/components/audit/api';

export interface AuditTableProps {
  rows: readonly AuditRow[];
  onSelect: (id: number) => void;
}

/**
 * Čo sa stalo — najprv veta zo servera, inak preklad kódu udalosti.
 *
 * Vstup je ZÁMERNE len tá časť riadku, ktorú funkcia naozaj číta: to isté
 * pravidlo potrebuje aj audit stopa v detaile zľavy (V6b), kde riadok prichádza
 * z `/api/campaigns/[id]` a nemá polia filtra histórie. Druhá kópia pravidla by
 * znamenala dve appky, ktoré tú istú udalosť pomenujú inak.
 */
export function auditRowText(row: Pick<AuditRow, 'message' | 'eventType'>): string {
  const message = row.message === null ? '' : row.message.trim();
  return message === '' ? auditEventLabel(row.eventType) : message;
}

/**
 * Má riadok niesť príznak „nepodarilo sa"?
 *
 * Len vtedy, keď sa vypisuje veta zo servera. Preklad kódu udalosti výsledok
 * hovorí sám („produkt sa nepodarilo zlacniť") a druhý príznak vedľa neho by
 * bol ten istý údaj dvakrát — presne tá redundancia, ktorú pravidlo o žiadnych
 * vysvetľujúcich odstavcoch zakazuje.
 */
export function showsFailureFlag(row: Pick<AuditRow, 'ok' | 'message'>): boolean {
  if (row.ok !== false) return false;
  return row.message !== null && row.message.trim() !== '';
}

export function AuditTable({ rows, onSelect }: AuditTableProps) {
  if (rows.length === 0) {
    return (
      <div className="empty" data-testid="audit-table">
        <div className="t">Zatiaľ nič</div>
        <div>Pre zvolené obdobie a typ nie je v histórii žiadny záznam.</div>
      </div>
    );
  }

  return (
    <table className="tbl" data-testid="audit-table">
      <thead>
        <tr>
          <th>Kedy</th>
          <th>Čo sa stalo</th>
          <th>Kto</th>
          <th className="act" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          /*
           * D116 — o KTORÝ PRODUKT ide, sa na povrchu hovorí „referencia ·
           * názov", nie číslom. Doplnenie prichádza JOIN-om pri čítaní; audit
           * sa neprepisuje (I4). Keď appka nepozná ani referenciu, ani názov,
           * riadok o produkte na povrchu MLČÍ — `productId` zostáva
           * v rozkliku Technický detail, kam ho D116 sťahuje.
           */
          const label = auditProductLabel(row);
          return (
          <tr key={row.id} className={row.ok === false ? 'muted' : undefined}>
            <td data-l="Kedy">{formatDateTimeSk(row.ts)}</td>
            <td className="name" data-l="Čo sa stalo">
              {auditRowText(row)}
              {label === null ? null : (
                <div className="lvl-3" data-testid={`audit-product-${row.id}`}>
                  {label.text}
                  {label.referenceUnknown ? (
                    <span className="lvl-3"> · kód produktu zatiaľ nevieme</span>
                  ) : null}
                </div>
              )}
              {showsFailureFlag(row) ? (
                <div className="flag">
                  <FlagMark />
                  nepodarilo sa
                </div>
              ) : null}
            </td>
            <td data-l="Kto">{auditActorLabel(row.actor)}</td>
            <td className="act">
              <Button small onClick={() => onSelect(row.id)} data-testid={`audit-detail-${row.id}`}>
                Detail
              </Button>
            </td>
          </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default AuditTable;
