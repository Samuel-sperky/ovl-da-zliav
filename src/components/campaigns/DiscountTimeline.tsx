'use client';

/**
 * Aura Zľavy — OKNÁ ZLIAV V ČASE (graf G1; `/api/insights/timeline`).
 *
 * Endpoint bol hotový od šprintu B2 a nečítala ho ani jedna obrazovka — dáta
 * existovali, chýbala im obrazovka. Tento panel ich kreslí ako vodorovné pásy
 * na jednej trojmesačnej osi, teda odpovedá na otázku, na ktorú rebrík zliav
 * neodpovedá: **kedy sa zľavy prekrývajú.**
 *
 * Čo pás hovorí a čo nie, je v `timeline-model.ts` (orezané hrany, prekryv na
 * produkte podľa D28, prázdna vs. neprečítaná os). Tu je len vykreslenie:
 *
 *  - Šírku aj polohu pásu počíta `bandOf()` v percentách osi, nie CSS. Pás
 *    orezaný osou má hranu bez zaoblenia a hovorí to aj slovom — inak by zľava
 *    bežiaca od minulého mesiaca vyzerala, že začala na kraji osi.
 *  - Prekryv NA TOM ISTOM PRODUKTE je príznak pri riadku (D28). Prekryv len
 *    v čase príznak nemá: dva pásy nad sebou samy o sebe nič nehlásia.
 *  - Nič sa neobnovuje samo (kontrakt UI, bod 4) — panel je registrovaný cez
 *    `useRefreshable()` a vlastné tlačidlo Obnoviť nekreslí.
 *  - Žiadne volanie shopu (K8): os číta výhradne lokálnu databázu.
 *
 * Vlastník: V4 (obrazovka Zľavy).
 */
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { getJson } from '@/components/campaigns/api';
import {
  bandOf,
  orderTimeline,
  overlappingCampaignIds,
  parseTimeline,
  todayPct,
  type TimelineView,
} from '@/components/campaigns/timeline-model';
import styles from '@/components/campaigns/zlavy.module.css';
import { useRefreshable } from '@/components/layout/refresh';
import Note from '@/components/ui/Note';
import { FlagMark } from '@/components/ui/StatusMark';
import { formatDateSk } from '@/lib/ui/format';
import { formatCountSk } from '@/lib/ui/vocabulary';

export interface DiscountTimelineProps {
  /** Okno v dňoch (`7|30|90`). Bez neho príde pôvodná trojmesačná os. */
  readonly windowDays?: number | null;
  readonly testId?: string;
}

/**
 * OS A PÁSY ako samostatný, vykresliteľný komponent.
 *
 * Oddelené z toho istého dôvodu ako `QueueTiles` v detaile zľavy: panel si dáta
 * ťahá až v efekte, takže `renderToStaticMarkup` ho zastihne v stave
 * „Načítavam…" a tvrdenia o pásoch, orezaných hranách a prekryve by nemali čo
 * merať. Komponent je čistý — os dnu, pásy von.
 */
export function TimelineBands({ view }: { readonly view: TimelineView }) {
  const ordered = orderTimeline(view.campaigns);
  const overlaps = overlappingCampaignIds(view.campaigns);
  const marker = todayPct(view);

  return (
    <>
      <div className={styles.tlAxis} data-testid="timeline-axis">
        <span className="lvl-3">{formatDateSk(view.from)}</span>
        <span className="lvl-3">
          {view.windowDays === null ? 'tri mesiace' : `okno ${formatCountSk(view.windowDays)} dní`}
        </span>
        <span className="lvl-3">{formatDateSk(view.to)}</span>
      </div>

      {ordered.length === 0 ? (
        <div className="lvl-3" data-testid="timeline-empty">
          V tomto období appka nemá ani jednu zľavu.
        </div>
      ) : (
        <div className={styles.tl}>
          {ordered.map((campaign) => {
            const band = bandOf(campaign, view);
            if (band === null) return null;
            const clashes = overlaps.has(campaign.id);
            return (
              <div
                className={styles.tlRow}
                key={campaign.id}
                data-testid={`timeline-row-${campaign.id}`}
              >
                <div className={styles.tlName}>
                  <Link href={`/zlavy/${campaign.id}`}>{campaign.name}</Link>
                  <span className="lvl-3">
                    {formatDateSk(campaign.dateFrom)} – {formatDateSk(campaign.dateTo)} ·{' '}
                    {campaign.percent} %
                  </span>
                </div>
                <div className={styles.tlTrack}>
                  {marker === null ? null : (
                    <i className={styles.tlToday} style={{ left: `${marker}%` }} aria-hidden="true" />
                  )}
                  <span
                    className={styles.tlBand}
                    style={{ left: `${band.leftPct}%`, width: `${band.widthPct}%` }}
                    data-clip-start={band.clippedStart ? 'true' : 'false'}
                    data-clip-end={band.clippedEnd ? 'true' : 'false'}
                    data-testid={`timeline-band-${campaign.id}`}
                  />
                </div>
                <div className={styles.tlFlags}>
                  {band.clippedStart ? (
                    <span className="lvl-3" data-testid={`timeline-before-${campaign.id}`}>
                      začala pred osou
                    </span>
                  ) : null}
                  {band.clippedEnd ? (
                    <span className="lvl-3" data-testid={`timeline-after-${campaign.id}`}>
                      končí za osou
                    </span>
                  ) : null}
                  {clashes ? (
                    <span className="flag" data-testid={`timeline-clash-${campaign.id}`}>
                      <FlagMark />
                      prekrýva sa na tom istom produkte
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export function DiscountTimeline({
  windowDays = null,
  testId = 'discounts-timeline',
}: DiscountTimelineProps) {
  const [view, setView] = useState<TimelineView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = windowDays === null ? '' : `?window=${windowDays}`;
    const res = await getJson<unknown>(`/api/insights/timeline${query}`);
    if (!res.ok) {
      // Prázdna os by tvrdila „v tomto období nebežala ani jedna zľava" (I11).
      setView(null);
      setFailed(res.error.message);
      return;
    }
    const parsed = parseTimeline(res.data);
    setView(parsed);
    setFailed(parsed === null ? 'Odpoveď servera sa nepodarilo prečítať.' : null);
  }, [windowDays]);

  const { pending } = useRefreshable(load);

  return (
    <details className={styles.fold} data-testid={testId}>
      <summary>
        Okná zliav v čase
        {view === null ? '' : ` (${formatCountSk(view.campaigns.length)})`}
      </summary>
      <div className={styles.foldBody}>
        {failed === null ? null : (
          <Note variant="err" testId="timeline-error">
            Os zliav sa nepodarilo načítať: {failed}
          </Note>
        )}

        {pending && view === null && failed === null ? (
          <div className="lvl-3">Načítavam os zliav…</div>
        ) : null}

        {view === null ? null : <TimelineBands view={view} />}
      </div>
    </details>
  );
}

export default DiscountTimeline;
