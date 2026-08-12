'use client';

/**
 * Aura Zľavy — STAV KATALÓGU NAD TABUĽKOU (V10; kontrakt dokončenia A5, C1, C2).
 *
 * Toto je najdôležitejšia karta na tabe Produkty a je zámerne PRVÁ.
 *
 * Dôvod je konkrétny, nie estetický: appka má dnes v katalógu okolo 2 900
 * zo 41 082 produktov. Kým to nebolo na obrazovke, používateľ si vybral 150
 * kusov z necelých siedmich percent eshopu a nemal jedinú stopu, že mu 38 tisíc
 * produktov chýba. Tabuľka totiž vyzerá úplne rovnako, či je katalóg celý,
 * alebo z neho appka videla tridsať stránok.
 *
 * Karta odpovedá na štyri otázky, ktoré si používateľ kladie v tomto poradí:
 * koľko z koľkých je načítaných, kedy pribudne ďalšia dávka, prečo sa práve
 * čaká, a dokedy to celé potrvá.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **„Dáta k …" tu NIE JE.** Čerstvosť dát je v Produktoch presne raz —
 *    jeden sivý riadok nad tabuľkou (architektúra §0), a stráži to test. Táto
 *    karta hovorí o POKROKU načítania, nie o čase posledného čítania; to sú dve
 *    rôzne veci a druhý časový údaj v hlavičke karty by ich zlial.
 * 2. **Vety o prekážkach sa tu nepíšu.** Neúplný katalóg aj vyčerpaný rozpočet
 *    čítaní majú hotové vety v `lib/status/blockers.ts` a kreslí ich
 *    `BlockerNotes`. Vlastné vety má karta iba na pauzu po odmietnutí zo strany
 *    shopu a na chybu posledného behu — o tých prekážky nevedia.
 * 3. **Dlaždice a vysvetlivka nehovoria to isté.** Dlaždice sú čísla na jeden
 *    pohľad, vysvetlivka je DÔSLEDOK („produkty, ktoré ešte nie sú načítané, sa
 *    zatiaľ vybrať nedajú"). Kto by z dlaždíc urobil vety, dostane dva texty,
 *    ktoré sa raz rozídu.
 * 4. **Merací prúžok je len na ROZPOČET.** Meria sa ním spotreba čítaní (30/min
 *    a 300/deň bez kľúča), nikdy naplnenosť katalógu: pri katalógu je 100 %
 *    hotová práca, pri rozpočte vyčerpaný strop, a `BudgetMeter` by na dokončený
 *    katalóg napísal „strop vyčerpaný".
 * 5. **Kód chyby žije pod „Technickým detailom" (P6).** Na povrch nepatrí a
 *    obsah odpovede shopu sa doň nedostane ani z tade — route posiela KÓD (I1).
 *
 * Vlastník: V10.
 */
import BlockerNotes from '@/components/products/BlockerNotes';
import type { CatalogRunView, CatalogStatusView } from '@/components/products/catalog-status';
import {
  CATALOG_PANEL_BLOCKERS,
  catalogStateView,
  catalogWaitingNote,
  clockPhrase,
  finishTile,
  loadedTile,
  missingTile,
  nextBatchTile,
  pickBlockers,
  runOutcomeNote,
} from '@/components/products/catalog-status';
import BudgetMeter from '@/components/ui/BudgetMeter';
import Note from '@/components/ui/Note';
import StatTile from '@/components/ui/StatTile';
import StatusPill from '@/components/ui/StatusPill';
import type { Blocker } from '@/lib/status/blockers';
import { SURFACE_TERMS } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Vstupy ════════════════════════════════════ */

export interface CatalogStatusPanelProps {
  /** Stav z `GET /api/catalog/sync`. `null` = ešte sa nenačítal alebo sa nedal. */
  status: CatalogStatusView | null;
  /** `true` = stav sa nedal prečítať; karta to prizná, nemlčí. */
  failed: boolean;
  /** Prekážky z `GET /api/status` — už len tie, ktoré patria katalógu. */
  blockers: readonly Blocker[];
  /** Posledná dávka, ktorú používateľ spustil TÝMTO tlačidlom. */
  lastRun: CatalogRunView | null;
  /** `true` = dávka práve beží. */
  running: boolean;
  onLoadBatch: () => void;
}

/* ═══════════════════════════ 2. Karta ═════════════════════════════════════ */

export function CatalogStatusPanel({
  status,
  failed,
  blockers,
  lastRun,
  running,
  onLoadBatch,
}: CatalogStatusPanelProps) {
  const state = catalogStateView(status);
  const loaded = loadedTile(status);
  const missing = missingTile(status);
  const nextBatch = nextBatchTile(status);
  const finish = finishTile(status);
  const waiting = catalogWaitingNote(status);
  const run = lastRun === null ? null : runOutcomeNote(lastRun);
  const panelBlockers = pickBlockers(blockers, CATALOG_PANEL_BLOCKERS);

  const reads = status?.reads ?? null;
  // Strop čítaní sa obnovuje o polnoci UTC, nie o lokálnej — `resetAt` z route
  // je konkrétny čas, tak sa aj vypíše. Fráza ide do prúžku hotová.
  const readsReset = reads === null ? null : clockPhrase(reads.resetAt);

  return (
    <section className="sec" style={{ marginBottom: '12px' }} data-testid="catalog-status">
      <div className="sec-h">
        <h2>Stav katalógu</h2>
        <div className="act">
          <button
            type="button"
            className="btn sm ghost"
            onClick={onLoadBatch}
            disabled={running}
            data-testid="catalog-load-batch"
          >
            {running ? 'Načítavam ďalšiu dávku…' : 'Načítať ďalšiu dávku'}
          </button>
        </div>
      </div>

      <div
        className="row wrapx"
        style={{ alignItems: 'flex-start', gap: '14px', marginBottom: '12px' }}
      >
        <StatusPill
          tone={state.tone}
          label={state.label}
          detail={state.detail}
          live
          testId="catalog-state"
        />
        {reads === null ? null : (
          <>
            <BudgetMeter
              label="Čítania katalógu dnes"
              spent={reads.used}
              limit={reads.limit}
              resetsAt={readsReset}
              testId="catalog-reads-day"
            />
            <BudgetMeter
              label="Čítania za minútu"
              spent={reads.usedThisMinute}
              limit={reads.minuteLimit}
              testId="catalog-reads-minute"
            />
          </>
        )}
      </div>

      <div className="kpis">
        <StatTile
          label="Načítaných z katalógu"
          value={loaded.value}
          detail={loaded.detail}
          testId="catalog-tile-loaded"
        />
        <StatTile
          label="Zatiaľ chýba"
          value={missing.value}
          detail={missing.detail}
          testId="catalog-tile-missing"
        />
        <StatTile
          label="Ďalšia dávka"
          value={nextBatch.value}
          detail={nextBatch.detail}
          testId="catalog-tile-next"
        />
        <StatTile
          label="Katalóg bude celý"
          value={finish.value}
          detail={finish.detail}
          testId="catalog-tile-finish"
        />
      </div>

      {failed ? (
        <div style={{ marginTop: '8px' }}>
          <Note variant="warn" testId="catalog-status-failed">
            Stav katalógu sa nepodarilo načítať, takže čísla vyššie môžu byť staré.{' '}
            <span className="lvl-3" style={{ display: 'inline' }}>
              Skúste obrazovku obnoviť; na samotné načítavanie katalógu to nemá vplyv.
            </span>
          </Note>
        </div>
      ) : null}

      <BlockerNotes blockers={panelBlockers} here="/produkty" testId="catalog-blockers" />

      {waiting === null ? null : (
        <div style={{ marginTop: '8px' }}>
          <Note variant={waiting.variant} testId="catalog-waiting">
            {waiting.what}{' '}
            <span className="lvl-3" style={{ display: 'inline' }}>
              {waiting.nextStep}
            </span>
          </Note>
        </div>
      )}

      {run === null ? null : (
        <div style={{ marginTop: '8px' }}>
          <Note variant={run.variant} testId="catalog-last-run">
            {run.what}{' '}
            <span className="lvl-3" style={{ display: 'inline' }}>
              {run.nextStep}
            </span>
          </Note>
        </div>
      )}

      {status === null ? null : (
        <details className="tech">
          <summary>{SURFACE_TERMS.technicalDetail}</summary>
          <div className="body">
            <table>
              <tbody>
                <tr>
                  <td>Prečítaných stránok</td>
                  <td>
                    <b>
                      {status.pagesDone}
                      {status.pagesTotal === null ? '' : ` / ${status.pagesTotal}`}
                    </b>
                  </td>
                </tr>
                <tr>
                  <td>Veľkosť stránky</td>
                  <td>
                    <b>{status.perPage}</b>
                  </td>
                </tr>
                <tr>
                  <td>Počítadlo čítaní prečítané</td>
                  <td>
                    <b>{reads?.known === true ? 'áno' : 'nie'}</b>
                  </td>
                </tr>
                <tr>
                  <td>Kód poslednej chyby</td>
                  <td>
                    <b>{status.lastError ?? '—'}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

export default CatalogStatusPanel;
