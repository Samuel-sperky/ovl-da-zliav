'use client';

/**
 * Aura Zľavy — stavová časť hlavičky (D5, D10, D77, D79, D87).
 *
 * Polluje `/api/health` a kreslí `KeyTtlBadge`, `SchedulerBadge`,
 * `WriteModeBadge`, prepínač témy a pod hlavičkou `ReadOnlyNotice`. Keď health
 * endpoint neodpovedá, shell to priznáva (degradovaný badge) — nič nepredstiera.
 *
 * A NEPREDSTIERA ANI OPAČNE: keď stav nie je známy len preto, že požiadavka
 * prebehla bez session (401), hlavička to hlási ako „stav po prihlásení",
 * neutrálnym tónom. Predtým sa tento prípad zliewal s nedostupnosťou a appka
 * o sebe červeno tvrdila, že nebeží, hoci bežala úplne v poriadku.
 *
 * Mobil (plán §2 bod 19, K8): `KeyTtlBadge` je viditeľný VŽDY — D5 to vyžaduje
 * a skrývať ho nesmieme. Skladá sa len scheduler a režim zápisov za prepínač
 * „stav appky"; na šírke ≥ 720 px sú aj tie stále viditeľné (CSS).
 */
import { useState } from 'react';

import KeyTtlBadge from '@/components/layout/KeyTtlBadge';
import ReadOnlyNotice from '@/components/layout/ReadOnlyNotice';
import SchedulerBadge from '@/components/layout/SchedulerBadge';
import ThemeToggle from '@/components/layout/ThemeToggle';
import WriteModeBadge from '@/components/layout/WriteModeBadge';
import { useHealth, type HealthData } from '@/components/layout/health';
import ToneBadge, { type StatusTone } from '@/components/ui/ToneBadge';

/** Vstup čistého rozhodovania — presne to, čo `useHealth()` vie. */
export interface HeaderStatusInput {
  loading: boolean;
  unauthenticated: boolean;
  unreachable: boolean;
  health: HealthData | null;
}

export type HeaderStatusView =
  | { kind: 'loading' }
  | { kind: 'ok' }
  | {
      kind: 'unauthenticated' | 'unreachable';
      tone: StatusTone;
      glyph: string;
      label: string;
      title: string;
    };

export const HEALTH_UNAUTHENTICATED_LABEL = 'stav appky · po prihlásení';
export const HEALTH_UNREACHABLE_LABEL = 'stav appky nedostupný';

/**
 * Čisté rozhodnutie, čo hlavička o stave appky TVRDÍ. Štyri kombinácie
 * (prihlásený/neprihlásený × beží/nebeží):
 *
 *  - neprihlásený + beží → 401 → `unauthenticated`, neutrál (žiadna porucha),
 *  - neprihlásený + nebeží → sieťová chyba → `unreachable`, critical,
 *  - prihlásený + beží → `ok`,
 *  - prihlásený + nebeží → `unreachable`, critical.
 *
 * `unauthenticated` má prednosť: keď vieme, že stav nepoznáme len pre chýbajúcu
 * session, NESMIEME hlásiť poruchu. Neznámy dôvod bez dát je fail-closed
 * `unreachable` — radšej priznaná nevedomosť než predstieraná pohoda.
 */
export function headerStatusView(input: HeaderStatusInput): HeaderStatusView {
  if (input.loading) return { kind: 'loading' };
  if (input.unauthenticated) {
    return {
      kind: 'unauthenticated',
      tone: 'idle',
      glyph: '○',
      label: HEALTH_UNAUTHENTICATED_LABEL,
      title: 'Nie si prihlásený — stav appky sa zobrazí po prihlásení. Nie je to porucha appky.',
    };
  }
  if (input.unreachable || input.health === null) {
    return {
      kind: 'unreachable',
      tone: 'critical',
      glyph: '✕',
      label: HEALTH_UNREACHABLE_LABEL,
      title: 'Appka neodpovedá na kontrolu stavu — skontroluj, či beží kontajner a databáza.',
    };
  }
  return { kind: 'ok' };
}

/** Stav „nič nevieme" — vedie na fail-closed `unreachable`. */
const EMPTY_INPUT: HeaderStatusInput = {
  loading: false,
  unauthenticated: false,
  unreachable: true,
  health: null,
};

export function HeaderBadges() {
  const { health, loading, unreachable, unauthenticated } = useHealth();
  const [moreOpen, setMoreOpen] = useState(false);
  const view = headerStatusView({ loading, unauthenticated, unreachable, health });

  if (view.kind === 'loading') {
    return (
      <>
        <span className="ovl-badge ovl-shimmer" aria-hidden>
          načítavam stav…
        </span>
        <ThemeToggle />
      </>
    );
  }
  /* `ok` bez dát je podľa `headerStatusView()` nemožné; `health` sa tu overuje
     len preto, aby TypeScript videl zúženie na ne-null. */
  if (view.kind !== 'ok' || health === null) {
    const badge = view.kind === 'ok' ? headerStatusView({ ...EMPTY_INPUT }) : view;
    if (badge.kind === 'loading' || badge.kind === 'ok') return null;
    return (
      <>
        <ToneBadge
          tone={badge.tone}
          glyph={badge.glyph}
          data-testid={
            badge.kind === 'unauthenticated' ? 'health-unauthenticated' : 'health-unreachable'
          }
          title={badge.title}
        >
          {badge.label}
        </ToneBadge>
        <ThemeToggle />
      </>
    );
  }
  return (
    <>
      <KeyTtlBadge present={health.key.present} expiresAt={health.key.expiresAt} />
      <button
        type="button"
        className="ovl-theme-pill ovl-status-more"
        onClick={() => setMoreOpen((v) => !v)}
        aria-expanded={moreOpen}
        title="Stav schedulera a režim zápisov"
      >
        stav appky {moreOpen ? '▴' : '▾'}
      </button>
      <span className="ovl-status-secondary" data-open={moreOpen ? 'true' : 'false'}>
        <SchedulerBadge
          lastTickAt={health.scheduler.lastTickAt}
          ageSec={health.scheduler.ageSec}
        />
        <WriteModeBadge
          writesEnabled={health.writesEnabled}
          writesLocked={health.writesLocked}
        />
      </span>
      <ThemeToggle />
    </>
  );
}

/** Samostatný full-bleed pruh pod hlavičkou — read-only výzva (D10). */
export function HeaderReadOnlyNotice() {
  const { health, loading } = useHealth(60_000);
  if (loading || !health) return null;
  const expired =
    health.key.expiresAt != null && new Date(health.key.expiresAt).getTime() <= Date.now();
  return <ReadOnlyNotice keyPresent={health.key.present && !expired} />;
}
