'use client';

/**
 * Aura Zľavy — pravá strana hlavičky a read-only výzva (ARCHITEKTURA §0, K2).
 *
 * V hlavičke sú presne dve veci a nič viac: **stav fronty** a **prepínač témy**.
 * Žiadne vyhľadávanie, žiadne notifikácie, žiadne stavové badge — či sú zápisy
 * zapnuté, dokedy platí kľúč, koľko zápisov dnes ostáva a kde je katalóg, to
 * všetko nesie stavový pruh o riadok nižšie (`layout/StatusBar.tsx`).
 *
 * ČO ODTIAĽTO ZMIZLO A PREČO
 * --------------------------
 * Pruh „Ostrý zápis vypnutý" pod hlavičkou (`HeaderWritesStrip`) hovoril
 * DOSLOVA to isté, čo menovka zápisov v stavovom pruhu — tá istá veta, o riadok
 * vyššie, v celej šírke okna. Dva nositelia jedného faktu sa raz rozídu a do
 * tej doby ukrajujú z výšky obrazovky, ktorú P4 obmedzuje. Fakt zostal, nosič
 * je jeden: `writesChip()` v `layout/status.ts`.
 *
 * Read-only výzva (D10) zostáva, lebo NIE JE ten istý fakt: pruh hovorí, že
 * kľúč chýba alebo vypršal, výzva ponúka odkaz, ktorým sa to opraví. A objaví
 * sa len vtedy, keď je čo opravovať — keď nič nebráni zápisu, chróm je tri
 * riadky a nič viac (kontrakt UI, bod 3).
 *
 * DVE VECI, KTORÉ SA TU NESMÚ POKAZIŤ:
 *
 * 1. **Neznáme číslo sa nedopĺňa a neznámy stav sa nepomenúva.** Kým
 *    `/api/queue` nedodá čísla (alebo keď appka neodpovedá), hlavička napíše
 *    pomlčku a slovom prizná, že stav fronty nevie. „Fronta prázdna" je kladné
 *    tvrdenie, že na zápis nič nečaká, a smie padnúť LEN vtedy, keď to server
 *    povedal (`total === 0`). Appka zapisuje do produkčného shopu — vymyslené
 *    číslo aj vymyslený stav by tu boli tvrdenie, nie medzera. Rozhoduje o tom
 *    `queueHeaderLabel()` v `layout/queue.ts`, aby sa to dalo zmerať bez
 *    prehliadača (`test/unit/header-status.spec.ts`).
 * 2. **Stav sa sem POSIELA, neťahá.** Hlavička aj pruh stoja na jednom čítaní
 *    `/api/status`, ktoré robí `AppShell`. Vlastné čítanie by znamenalo druhý
 *    dotaz na tú istú vec — a druhú predstavu o tom, čo je pravda.
 *
 * Vlastník: L1.
 */
import Link from 'next/link';

import { queueHeaderLabel, useQueueHeader } from '@/components/layout/queue';
import ReadOnlyNotice from '@/components/layout/ReadOnlyNotice';
import type { StatusState } from '@/components/layout/status';
import ThemeToggle from '@/components/layout/ThemeToggle';

/**
 * Súhrn všetkých bežiacich front. Klik vedie na tab Zľavy.
 *
 * Tri stavy, nie dva: neznámy stav sa NESMIE zliať s prázdnou frontou. Text aj
 * vysvetlenie určuje `queueHeaderLabel()`; tento komponent už len kreslí.
 * Tlmené `hqueue off` majú oba nekladné stavy — je to existujúci token, nie
 * nová farba (predloha `design/v3/prazdne-stavy.html`).
 *
 * Exportuje sa kvôli testu, ktorý ho naozaj vykreslí (`renderToStaticMarkup`,
 * `test/unit/header-status.spec.ts`) — inak by sa dalo zmerať len rozhodnutie
 * v `queueHeaderLabel()`, nie to, či ho hlavička vôbec použije.
 */
export function QueueLink({ done, total }: { done: number | null; total: number | null }) {
  const view = queueHeaderLabel(done, total);
  return (
    <Link
      className={view.kind === 'running' ? 'hqueue' : 'hqueue off'}
      href="/zlavy"
      data-testid="header-queue"
      data-state={view.kind}
      title={view.title}
    >
      {view.fraction === null ? (
        view.label
      ) : (
        <>
          {view.label} <b>{view.fraction}</b>
        </>
      )}
    </Link>
  );
}

export interface HeaderRightProps {
  /** Stav appky z jediného čítania, ktoré robí `AppShell`. */
  state: StatusState;
}

/**
 * Pravá strana hlavičky. Keď sú čísla neznáme, hlavička to prizná namiesto
 * toho, aby mlčala alebo hádala. Do 27. 8. 2026 sa to týkalo najmä
 * prihlasovacej obrazovky — tá zmizla s D99, dôvod priznať neznalosť zostal
 * (načítanie, nedostupná appka).
 */
export function HeaderRight({ state }: HeaderRightProps) {
  const { queue } = useQueueHeader();

  // Kým sa nevie, či appka odpovedá, čísla sa netvrdia.
  const trusted = state.kind === 'ok' && state.payload !== null;

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
 * Full-bleed výzva pod stavovým pruhom pri chýbajúcom alebo expirovanom kľúči
 * (D10). Nie je to opakovanie menovky v pruhu — pruh hlási fakt, táto výzva
 * nesie odkaz, ktorým sa fakt zmení.
 *
 * Platnosť sa porovnáva s časom SERVERA zo snapshotu, nie s hodinami
 * prehliadača: rozdiel by sa prejavil presne v hodine, keď kľúč expiruje.
 */
export function HeaderReadOnlyNotice({ state }: HeaderRightProps) {
  if (state.kind !== 'ok' || state.payload === null) return null;

  const key = state.payload.apiKey;
  if (key.present !== true) return <ReadOnlyNotice keyPresent={false} />;

  const expires = key.expiresAt === null ? null : new Date(key.expiresAt).getTime();
  const now = new Date(state.payload.now).getTime();
  const expired =
    expires !== null && Number.isFinite(expires) && Number.isFinite(now) && expires <= now;

  return <ReadOnlyNotice keyPresent={!expired} />;
}
