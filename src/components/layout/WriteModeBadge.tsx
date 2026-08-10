/**
 * Aura Zľavy — badge režimu zápisov (D77, D79).
 *
 * „zápisy vypnuté · dry-run" keď `writesEnabled=false` (env poistka I13),
 * „ZÁPISY ZAMKNUTÉ" pri runaway zámku (I12). Pri normálnom stave sa nezobrazuje
 * nič — absencia varovania = zápisy povolené.
 *
 * Redizajn (plán §2 bod 6, V22): vypnuté zápisy sú NAJBEZPEČNEJŠÍ stav — do
 * produkcie sa nedá nič zapísať — takže to prestala byť žltá výstraha a je
 * neutrál. Runaway zámok zostáva critical, ten zásah naozaj vyžaduje.
 *
 * POZOR NA OZNAČENIE: badge píše výhradne o REŽIME ZÁPISOV, nikdy o `NODE_ENV`.
 * Predtým hlásil „dev · zápisy vypnuté", hoci appka bežala v
 * `NODE_ENV=production` a zápisy boli vypnuté len cez `WRITES_ENABLED=false` —
 * dve úplne iné veci. Appka zapisuje do PRODUKČNÉHO shopu bez stagingu a
 * používateľ si podľa tohto badge robí obraz, či je zápis ostrý; slovo „dev"
 * ho v takom prostredí uspáva. `/api/health` navyše `NODE_ENV` nehlási (I1) a
 * hlásiť ho ani nebude — badge preto tvrdí len to, čo naozaj vie:
 * ostré zápisy sú vypnuté a všetko beží ako dry-run.
 *
 * POZOR (V3): tento badge UŽ NIE JE v hlavičke. Hlavička má podľa
 * `design/v3/ARCHITEKTURA.md` §0 presne tri veci vpravo (rozpočet zápisov,
 * fronta, prepínač témy) a nič iné. Komponent zostáva, lebo miesto pre neho je
 * v Nastaveniach — kotva „Kľúče a rozpočet" (§3.6). Kým ho tam V12 nezavesí, nikde sa
 * nevykresľuje. Nemazať bez toho, aby sa tá informácia objavila inde.
 */
import ToneBadge, { type StatusTone } from '@/components/ui/ToneBadge';

export interface WriteModeBadgeProps {
  writesEnabled: boolean;
  writesLocked: boolean;
}

export interface WriteModeView {
  tone: StatusTone;
  glyph: string;
  /** `locked` = runaway zámok (I12), `disabled` = vypnuté ostré zápisy (I13). */
  state: 'locked' | 'disabled';
  label: string;
  title: string;
}

export const WRITES_DISABLED_LABEL = 'zápisy vypnuté · dry-run';
export const WRITES_LOCKED_LABEL = 'ZÁPISY ZAMKNUTÉ';

/**
 * Čisté rozhodnutie, čo badge o režime zápisov tvrdí. `null` = zápisy sú ostré
 * a badge sa nekreslí. Zámok má prednosť pred vypnutím.
 */
export function writeModeView({ writesEnabled, writesLocked }: WriteModeBadgeProps): WriteModeView | null {
  if (writesLocked) {
    return {
      tone: 'critical',
      glyph: '✕',
      state: 'locked',
      label: WRITES_LOCKED_LABEL,
      title:
        'Prekročený strop 60 zápisov/h — zápisy sú fail-closed zamknuté, odomknutie v Nastaveniach',
    };
  }
  if (!writesEnabled) {
    return {
      tone: 'idle',
      glyph: '●',
      state: 'disabled',
      label: WRITES_DISABLED_LABEL,
      title:
        'Ostré zápisy sú vypnuté poistkou prostredia (I13) — všetko beží ako dry-run, do shopu sa nezapíše nič. Nesúvisí to s vývojovým režimom.',
    };
  }
  return null;
}

export function WriteModeBadge(props: WriteModeBadgeProps) {
  const view = writeModeView(props);
  if (view === null) return null;
  return (
    <ToneBadge
      tone={view.tone}
      glyph={view.glyph}
      data-testid="write-mode-badge"
      data-state={view.state}
      title={view.title}
    >
      {view.label}
    </ToneBadge>
  );
}

export default WriteModeBadge;
