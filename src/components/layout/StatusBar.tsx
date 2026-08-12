'use client';

/**
 * Aura Zľavy — STÁLY STAVOVÝ PRUH (C1, C2; predloha `sperky-admin.html`,
 * pätka sidebaru).
 *
 * Predloha mala v pätke bočného panela stály blok: pilulku spojenia a pod ňou
 * dva meracie prúžky („minúta 0/18", „dnes 0/200"). Vzor preberáme, umiestnenie
 * nie — táto appka má HORNÚ navigáciu a bočný panel sa nezavádza (rozhodnutie
 * z KISS redizajnu). To isté teda visí ako jeden riadok pod hlavičkou.
 *
 * Odpovedá na päť otázok, ktoré sa inak dali zistiť len z logov alebo z DB:
 * ozval sa shop, dokedy platí kľúč, koľko zo denného rozpočtu je minutých, či
 * sú zápisy vôbec zapnuté a kde je katalóg.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Je to PRUH, nie panel.** Výška je pevná (`--ovl-statusbar-h`) a obsah sa
 *    nezalamuje — keď sa nezmestí, vodorovne sa posúva. Pevná výška nie je
 *    kozmetika: `--ovl-chrome-h` z nej počíta odsadenie lepkavých prvkov
 *    obrazoviek (bočný panel, kotvy v Nastaveniach). Keby pruh rástol, prekryl
 *    by ich.
 *
 * 2. **Kým stav nepoznáme, nekreslí sa päť menoviek „nevieme".** Pri načítaní,
 *    na prihlasovacej obrazovke a pri nedostupnej appke je v pruhu JEDNA
 *    pilulka a JEDNA veta, ktorá povie prečo. Päť neznámych hodnôt vyzerá ako
 *    päť porúch — a to je presne to klamstvo, ktorému sa appka vyhýba.
 *
 * 3. **Nič sa tu nepočíta ani nepomenúva.** Tóny, menovky aj vety prichádzajú
 *    z `layout/status.ts`, ktorý ich odvodzuje z prekážok servera. Tu je len
 *    značkovanie. Kto sem pridá `if` nad číslami, rozdvojí pravdu.
 *
 * 4. **Primitíva sa nekopírujú.** Prúžok je `BudgetMeter`, pilulka `StatusPill`,
 *    menovka `ToneBadge`, zámok `LockBadge` — všetko z `components/ui`. Vlastný
 *    variant toho istého sa tu nezavádza.
 *
 * Vlastník: L1.
 */
import {
  budgetView,
  catalogChip,
  connectionChip,
  keyChip,
  writesChip,
  type NavLock,
  type StatusChip,
  type StatusState,
} from '@/components/layout/status';
import BudgetMeter from '@/components/ui/BudgetMeter';
import LockBadge from '@/components/ui/LockBadge';
import StatusPill from '@/components/ui/StatusPill';
import ToneBadge from '@/components/ui/ToneBadge';

/** Menovka pruhu. Celá veta ide do `title`, aby sa pruh nerozrástol. */
function Chip({ chip, testId }: { chip: StatusChip; testId: string }) {
  return (
    <ToneBadge tone={chip.tone} glyph={chip.glyph} title={chip.title} data-testid={testId}>
      {chip.label}
    </ToneBadge>
  );
}

export interface StatusBarProps {
  state: StatusState;
  /** Zámky navigácie — dôvod sa píše sem, nie len ako visiaci zámok pri tabe. */
  locks?: readonly NavLock[];
}

export function StatusBar({ state, locks = [] }: StatusBarProps) {
  const connection = connectionChip(state);
  const lock = locks[0];

  // Bod 2 v hlavičke: bez známeho stavu jedna pilulka a jedna veta prečo.
  if (state.kind !== 'ok' || state.payload === null) {
    return (
      <section className="ovl-statusbar" aria-label="Stav appky" data-testid="status-bar">
        <div className="ovl-statusbar-in">
          <StatusPill tone={connection.tone} label={connection.label} live testId="status-connection" />
          <span className="ovl-statusbar-note">{connection.title}</span>
        </div>
      </section>
    );
  }

  const budget = budgetView(state.payload);

  return (
    <section className="ovl-statusbar" aria-label="Stav appky" data-testid="status-bar">
      <div className="ovl-statusbar-in">
        <span className="ovl-statusbar-cell" title={connection.title}>
          <StatusPill tone={connection.tone} label={connection.label} live testId="status-connection" />
        </span>

        <Chip chip={keyChip(state.payload)} testId="status-key" />
        <Chip chip={writesChip(state.payload)} testId="status-writes" />

        {budget.kind === 'meter' ? (
          <span className="ovl-statusbar-meter" title={budget.title}>
            <BudgetMeter
              label={budget.label}
              spent={budget.spent}
              limit={budget.limit}
              resetsAt={budget.resetsAt}
              testId="status-budget"
            />
          </span>
        ) : (
          <Chip chip={budget.chip} testId="status-budget" />
        )}

        <Chip chip={catalogChip(state.payload)} testId="status-catalog" />

        {lock === undefined ? null : (
          <span className="ovl-statusbar-lock" title={lock.title}>
            <LockBadge label={lock.label} reason={lock.reason} testId="status-lock" />
          </span>
        )}
      </div>
    </section>
  );
}

export default StatusBar;
