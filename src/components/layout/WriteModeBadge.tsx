/**
 * Aura Zľavy — badge režimu zápisov (D77, D79).
 *
 * „ZÁPISY VYPNUTÉ (dev)" keď `writesEnabled=false` (env poistka I13),
 * „ZÁPISY ZAMKNUTÉ" pri runaway zámku (I12). Pri normálnom stave sa
 * nezobrazuje nič — absencia varovania = zápisy povolené.
 */
export interface WriteModeBadgeProps {
  writesEnabled: boolean;
  writesLocked: boolean;
}

export function WriteModeBadge({ writesEnabled, writesLocked }: WriteModeBadgeProps) {
  if (writesLocked) {
    return (
      <span
        className="ovl-badge ovl-badge--danger"
        data-testid="write-mode-badge"
        data-state="locked"
        title="Prekročený strop 60 zápisov/h — zápisy sú fail-closed zamknuté, odomknutie v Nastaveniach"
      >
        ZÁPISY ZAMKNUTÉ
      </span>
    );
  }
  if (!writesEnabled) {
    return (
      <span
        className="ovl-badge ovl-badge--warning"
        data-testid="write-mode-badge"
        data-state="disabled"
        title="NODE_ENV=production a WRITES_ENABLED=true nie sú splnené — všetko beží ako dry-run"
      >
        ZÁPISY VYPNUTÉ (dev)
      </span>
    );
  }
  return null;
}

export default WriteModeBadge;
