'use client';

/**
 * Aura Zľavy — pravá strana hlavičky (ARCHITEKTURA §0, K2).
 *
 * Presne dve veci a nič viac: **stav fronty** a **prepínač témy**. Žiadne
 * vyhľadávanie, žiadne notifikácie, žiadne stavové badge — platnosť kľúčov
 * a detail rozpočtu majú svoje miesto v Nastaveniach (ARCHITEKTURA §3.6,
 * kotva „Kľúče a rozpočet"), nie v každom riadku hlavičky.
 *
 * KAM SA PODEL ROZPOČET ZÁPISOV
 * -----------------------------
 * Do stáleho stavového pruhu pod hlavičkou (`layout/StatusBar.tsx`), a to
 * zámerne: tunajší prúžok bol ručne dorobená kópia primitíva `ui/BudgetMeter`
 * — tá istá vec nakreslená druhýkrát, bez slova o úrovni („blíži sa strop")
 * a bez času obnovy. Dve kópie meradla rozpočtu sa skôr či neskôr rozídu, tak
 * zostala tá, ktorá je otestovaná (`ui-primitives.spec.ts`). Rozpočet je preto
 * VIDNO ROVNAKO STÁLE ako predtým, len o riadok nižšie a pravdivejšie.
 *
 * DVE VECI, KTORÉ SA TU NESMÚ POKAZIŤ:
 *
 * 1. **Vyčerpaný rozpočet nie je chyba.** Pri 200/200 sa nič nerozbilo — appka
 *    len počká na obnovu stropu (K2, odpoveď 59). Červená je vyhradená pre
 *    stratu dát a zastavený zápis.
 * 2. **Neznáme číslo sa nedopĺňa.** Kým `/api/queue` nedodá čísla (alebo keď
 *    appka neodpovedá), hlavička píše, že je fronta prázdna, len keď to naozaj
 *    vie. Appka zapisuje do produkčného shopu — vymyslené číslo by tu bolo
 *    tvrdenie, nie medzera.
 */
import Link from 'next/link';

import { useHealth, type HealthData } from '@/components/layout/health';
import { formatCount, useQueueHeader } from '@/components/layout/queue';
import ReadOnlyNotice from '@/components/layout/ReadOnlyNotice';
import ThemeToggle from '@/components/layout/ThemeToggle';
import type { StatusTone } from '@/components/ui/ToneBadge';

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
 *
 * Funkcia zostáva aj po prechode na V3: hlavička už nekreslí stavový badge,
 * ale podľa nej sa rozhoduje, či sa čísla rozpočtu a fronty dajú tvrdiť.
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

/** Súhrn všetkých bežiacich front. Klik vedie na tab Zľavy. */
function QueueLink({ done, total }: { done: number | null; total: number | null }) {
  const empty = done === null || total === null || total === 0;
  return (
    <Link
      className={empty ? 'hqueue off' : 'hqueue'}
      href="/zlavy"
      data-testid="header-queue"
      data-state={empty ? 'empty' : 'running'}
      title="Súhrn všetkých bežiacich front — klik otvorí Zľavy"
    >
      {empty ? (
        'Fronta prázdna'
      ) : (
        <>
          Fronta{' '}
          <b>
            {formatCount(done)}/{formatCount(total)}
          </b>
        </>
      )}
    </Link>
  );
}

/**
 * Pravá strana hlavičky. Vykresľuje sa aj na prihlasovacej obrazovke — vtedy
 * sú čísla neznáme a hlavička to prizná namiesto toho, aby mlčala alebo
 * hádala.
 */
export function HeaderRight() {
  const { health, loading, unreachable, unauthenticated } = useHealth();
  const view = headerStatusView({ loading, unauthenticated, unreachable, health });
  const { queue } = useQueueHeader();

  // Kým sa nevie, či appka odpovedá, čísla sa netvrdia.
  const trusted = view.kind === 'ok';

  return (
    <div className="hdr-r">
      <QueueLink
        done={trusted && queue !== null ? queue.done : null}
        total={trusted && queue !== null ? queue.total : null}
      />
      <ThemeToggle />
    </div>
  );
}

/**
 * Pruh pod hlavičkou pri vypnutých ostrých zápisoch (I13, ARCHITEKTURA §1).
 * `WRITES_ENABLED` sa v UI NEZOBRAZUJE ako prepínač — len ako tento fakt.
 *
 * Pruh je NEUTRÁLNY, nie červený: vypnuté zápisy sú najbezpečnejší možný stav
 * appky, ktorá inak píše do produkčného shopu. Červená by klamala o závažnosti.
 */
export function HeaderWritesStrip() {
  const { health, loading } = useHealth(60_000);
  if (loading || health === null) return null;
  if (health.writesLocked) {
    return (
      <div className="hdr-strip" role="status" data-testid="writes-strip" data-state="locked">
        Zápisy sú zamknuté poistkou
      </div>
    );
  }
  if (!health.writesEnabled) {
    return (
      <div className="hdr-strip calm" role="status" data-testid="writes-strip" data-state="disabled">
        Ostrý zápis vypnutý
      </div>
    );
  }
  return null;
}

/** Samostatný full-bleed pruh pod hlavičkou — read-only výzva (D10). */
export function HeaderReadOnlyNotice() {
  const { health, loading } = useHealth(60_000);
  if (loading || health === null) return null;
  const expired =
    health.key.expiresAt != null && new Date(health.key.expiresAt).getTime() <= Date.now();
  return <ReadOnlyNotice keyPresent={health.key.present && !expired} />;
}
