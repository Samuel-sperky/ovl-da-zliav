/**
 * Aura Zľavy — badge režimu zápisov (D77, D79).
 *
 * „zápisy vypnuté (dev)" keď `writesEnabled=false` (env poistka I13),
 * „ZÁPISY ZAMKNUTÉ" pri runaway zámku (I12). Pri normálnom stave sa nezobrazuje
 * nič — absencia varovania = zápisy povolené.
 *
 * Redizajn (plán §2 bod 6, V22): dev režim je NAJBEZPEČNEJŠÍ stav — do
 * produkcie sa nedá nič zapísať — takže prestal byť žltá výstraha a je neutrál
 * s prefixom `● dev`. Runaway zámok zostáva critical, ten zásah naozaj vyžaduje.
 */
import ToneBadge from '@/components/ui/ToneBadge';

export interface WriteModeBadgeProps {
  writesEnabled: boolean;
  writesLocked: boolean;
}

export function WriteModeBadge({ writesEnabled, writesLocked }: WriteModeBadgeProps) {
  if (writesLocked) {
    return (
      <ToneBadge
        tone="critical"
        glyph="✕"
        data-testid="write-mode-badge"
        data-state="locked"
        title="Prekročený strop 60 zápisov/h — zápisy sú fail-closed zamknuté, odomknutie v Nastaveniach"
      >
        ZÁPISY ZAMKNUTÉ
      </ToneBadge>
    );
  }
  if (!writesEnabled) {
    return (
      <ToneBadge
        tone="idle"
        glyph="●"
        data-testid="write-mode-badge"
        data-state="disabled"
        title="NODE_ENV=production a WRITES_ENABLED=true nie sú splnené — všetko beží ako dry-run, do shopu sa nezapíše nič"
      >
        dev · zápisy vypnuté
      </ToneBadge>
    );
  }
  return null;
}

export default WriteModeBadge;
