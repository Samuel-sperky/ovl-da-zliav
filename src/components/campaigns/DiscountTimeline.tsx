'use client';

/**
 * Aura Zľavy — OKNÁ ZLIAV V ČASE (`/api/insights/timeline`).
 *
 * Endpoint bol hotový od šprintu B2 a nečítala ho ani jedna obrazovka. Tento
 * rozklik ich čerta: odpovedá na otázku, na ktorú tabuľka zliav neodpovedá —
 * **kedy sa zľavy prekrývajú.**
 *
 * PREČO TABUĽKA, A NIE GRAF (D126, V6b)
 * ─────────────────────────────────────
 * Jazyk grafov je UZAVRETÝ zoznam troch foriem (`ui/chart-language.ts`):
 * **čiara** = vývoj v čase, **stĺpec** = porovnanie medzi položkami, **koláč**
 * = rozdelenie. Okná na osi nie sú ani jedna z nich: nemerajú veličinu, ktorá
 * by rástla alebo sa dala porovnať, ale INTERVALY. Postaviť to na `ChartCard`
 * by znamenalo nakresliť Gantta z vodorovných stĺpcov — teda ŠTVRTÚ formu
 * prezlečenú za druhú, a presne to má D126 zakázané. Preto je nosičom
 * `ui/Table` a graf sa nepredstiera.
 *
 * Prevodom sa nič nestratilo a jedna vec sa naopak PRIZNALA:
 *
 *  1. **Poloha v čase zostáva.** Pás sa kreslí ďalej, len už nie ako riadok
 *     grafu, ale v bunke stĺpca „Na osi": šírku aj polohu počíta `bandOf()`
 *     v percentách osi (nie CSS) a orezaná hrana je HRANA — a hovorí to aj
 *     slovom, inak by zľava bežiaca od minulého mesiaca vyzerala, že začala
 *     na kraji osi. Pás je pre čítačku tichý; jej kanál sú dátumy v susednej
 *     bunke a slová pod pásom.
 *  2. **Prekryv NA TOM ISTOM PRODUKTE (D28) má tri stavy, nie dva.** Do V6b
 *     bol príznak, alebo nič — a „nič" znamenalo aj „je to čisté", aj
 *     „nevieme, ktoré produkty v tej zľave sú". Tá druhá možnosť bola TICHÁ.
 *     Bunka teraz kreslí `overlappingCampaignIds()` → fakt,
 *     `unprovableOverlapIds()` → pomlčku (I11), inak „neprekrýva sa".
 *  3. **Riadok, ktorý na os nezasahuje, sa už nezahadzuje.** Do V6b sa taký
 *     pás len nenakreslil (`band === null`) a zľava zo zoznamu tichlo zmizla.
 *     Rozpor medzi odpoveďou servera a osou je teraz priznanie v bunke.
 *
 * Ďalej platí: nič sa neobnovuje samo (kontrakt UI, bod 4) — je registrovaný
 * cez `useRefreshable()` a vlastné tlačidlo Obnoviť nekreslí. Žiadne volanie
 * shopu (K8): os číta výhradne lokálnu databázu.
 *
 * Vlastník: V6b, oblasť Zľavy — krok 3 (os a história).
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
  unprovableOverlapIds,
  type TimelineCampaign,
  type TimelineView,
} from '@/components/campaigns/timeline-model';
import styles from '@/components/campaigns/zlavy.module.css';
import { useRefreshable } from '@/components/layout/refresh';
import EmptyState from '@/components/states/EmptyState';
import ErrorState from '@/components/states/ErrorState';
import LoadingState from '@/components/states/LoadingState';
import { FlagMark } from '@/components/ui/StatusMark';
import { Table, type TableCell, type TableColumn } from '@/components/ui/Table';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/action-failure';
import { formatDateSk } from '@/lib/ui/format';
import { NEVIEME } from '@/lib/ui/product-label';
import { formatCountSk } from '@/lib/ui/vocabulary';

export interface DiscountTimelineProps {
  /** Okno v dňoch (`7|30|90`). Bez neho príde pôvodná trojmesačná os. */
  readonly windowDays?: number | null;
  readonly testId?: string;
}

/** Ako sa os pomenuje v pätke aj v `caption` — jedno miesto, jedna veta. */
function axisLabel(view: TimelineView): string {
  return view.windowDays === null
    ? 'tri mesiace'
    : `okno ${formatCountSk(view.windowDays)} dní`;
}

/**
 * STĹPCE OSI. Mená hlavičiek sú tie isté ako v tabuľke zoznamu zliav
 * („Zľava", „Názov", „Okno platnosti") — dve tabuľky toho istého tabu, ktoré
 * ten istý fakt menujú inak, sa čítajú ako dve appky.
 *
 * Prilepené sú prvé DVA stĺpce (percento a názov, D137): kto dorolluje
 * k prekryvu, musí ešte vedieť, o ktorú zľavu ide. Preto majú oba `width` —
 * bez neho sa druhý prilepený stĺpec nemá o čo odsadiť (`stickyOffsets()`).
 */
export function timelineColumns(view: TimelineView): readonly TableColumn<TimelineCampaign>[] {
  const overlaps = overlappingCampaignIds(view.campaigns);
  const unprovable = unprovableOverlapIds(view.campaigns);
  const marker = todayPct(view);

  return [
    {
      key: 'percent',
      header: 'Zľava',
      width: '92px',
      headerTitle: 'O koľko percent zľava zlacňuje. Pásma sú v jej detaile.',
      cell: (row): TableCell => ({
        content: <span className={styles.nowrap}>{row.percent} %</span>,
      }),
    },
    {
      key: 'name',
      header: 'Názov',
      width: '210px',
      cell: (row): TableCell => ({
        content: (
          <span className={styles.rowName}>
            <Link href={`/zlavy/${row.id}`}>{row.name}</Link>
          </span>
        ),
      }),
    },
    {
      key: 'window',
      header: 'Okno platnosti',
      width: '154px',
      headerTitle: 'Odkedy dokedy je zľava v eshope viditeľná. Oba dni sa počítajú.',
      cell: (row): TableCell => ({
        content: (
          <span className={styles.nowrap}>
            {formatDateSk(row.dateFrom)} – {formatDateSk(row.dateTo)}
          </span>
        ),
      }),
    },
    {
      key: 'axis',
      header: 'Na osi',
      headerTitle:
        'Kde v zobrazenom období zľava leží. Orezaná hrana znamená, že pokračuje mimo osi.',
      cell: (row): TableCell => {
        const band = bandOf(row, view);
        /* Porovnáva sa výslovne — Turbopack tu už raz zahodil skrátený guard. */
        if (band === null) {
          return {
            content: NEVIEME,
            unknown: true,
            title:
              'Do zobrazeného obdobia táto zľava nezasahuje, hoci ju server na os poslal — poloha sa nedá nakresliť.',
          };
        }
        return {
          content: (
            <>
              {/*
                Pás je DRUHÝ kanál k dátumom v bunke vedľa: to isté okno,
                nakreslené do mierky. Pre čítačku je tichý (`aria-hidden`),
                lebo z absolútnych percent by prečítala hluk.
              */}
              <span className={styles.tlTrack} aria-hidden="true">
                {marker === null ? null : (
                  <i className={styles.tlToday} style={{ left: `${marker}%` }} />
                )}
                <span
                  className={styles.tlBand}
                  style={{ left: `${band.leftPct}%`, width: `${band.widthPct}%` }}
                  data-clip-start={band.clippedStart ? 'true' : 'false'}
                  data-clip-end={band.clippedEnd ? 'true' : 'false'}
                  data-testid={`timeline-band-${row.id}`}
                />
              </span>
              {band.clippedStart ? (
                <span className={styles.cellUnder} data-testid={`timeline-before-${row.id}`}>
                  začala pred osou
                </span>
              ) : null}
              {band.clippedEnd ? (
                <span className={styles.cellUnder} data-testid={`timeline-after-${row.id}`}>
                  končí za osou
                </span>
              ) : null}
            </>
          ),
        };
      },
    },
    {
      key: 'clash',
      header: 'Prekryv na produkte',
      width: '236px',
      headerTitle:
        'Blokujúci je len prekryv na TOM ISTOM produkte (D28). Prekryv len v čase nie je poplach.',
      cell: (row): TableCell => {
        /* Fakt vyhráva nad priznaním: keď prekryv NA PRODUKTE dokázaný je,
           nie je čo nevedieť. */
        if (overlaps.has(row.id)) {
          return {
            content: (
              <span className="flag" data-testid={`timeline-clash-${row.id}`}>
                <FlagMark />
                prekrýva sa na tom istom produkte
              </span>
            ),
            title: 'Dve zľavy nad tým istým kusom v tom istom čase — do eshopu sa zapíše posledná.',
          };
        }
        if (unprovable.has(row.id)) {
          return {
            content: <span data-testid={`timeline-unknown-${row.id}`}>{NEVIEME}</span>,
            unknown: true,
            title:
              'Zľava, s ktorou sa prekrýva v čase, nemá načítané produkty — či ide o tie isté kusy, appka nevie.',
          };
        }
        return {
          content: 'neprekrýva sa',
          title: 'Na tejto osi sa s inou zľavou na tom istom produkte nestretáva.',
        };
      },
    },
  ];
}

/**
 * OS AKO TABUĽKA — samostatný, vykresliteľný komponent.
 *
 * Oddelené z toho istého dôvodu ako `QueueTiles` v detaile zľavy: rozklik si
 * dáta ťahá až v efekte, takže `renderToStaticMarkup` ho zastihne v stave
 * „Načítavam…" a tvrdenia o pásoch, orezaných hranách a prekryve by nemali čo
 * merať. Komponent je čistý — os dnu, riadky von.
 */
export function TimelineTable({ view }: { readonly view: TimelineView }) {
  const ordered = orderTimeline(view.campaigns);
  const label = axisLabel(view);
  const marker = todayPct(view);

  return (
    <>
      {/*
        Rozsah osi stojí NAD tabuľkou a nie v `caption`: `caption` je meno
        tabuľky pre čítačku, kdežto „od čoho do čoho" je fakt, ktorý musí
        vidieť aj oko — bez neho sa percentá pásov nedajú na nič prepočítať.
      */}
      <p className={styles.productsNote} data-testid="timeline-axis">
        Os: {formatDateSk(view.from)} – {formatDateSk(view.to)} · {label}
        {marker === null
          ? ' · dnešný deň na tejto osi neleží'
          : ` · dnes je ${formatDateSk(view.today)}`}
      </p>

      <Table
        caption={`Okná zliav v čase — ${label}: percento, názov, okno platnosti, poloha na osi a prekryv na tom istom produkte`}
        columns={timelineColumns(view)}
        rows={ordered}
        rowKey={(row) => String(row.id)}
        rowMeta={(row) => ({ testId: `timeline-row-${row.id}` })}
        stickyColumns={2}
        empty={
          <EmptyState
            title="V tomto období appka nemá ani jednu zľavu"
            description="Za zvolené obdobie nevznikla ani jedna zľava — nie je to výpadok čítania."
            testId="timeline-empty"
          />
        }
        testId="timeline-table"
      />
    </>
  );
}

export function DiscountTimeline({
  windowDays = null,
  testId = 'discounts-timeline',
}: DiscountTimelineProps) {
  const [view, setView] = useState<TimelineView | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const load = useCallback(async () => {
    const query = windowDays === null ? '' : `?window=${windowDays}`;
    const res = await getJson<unknown>(`/api/insights/timeline${query}`);
    if (!res.ok) {
      // Prázdna os by tvrdila „v tomto období nebežala ani jedna zľava" (I11).
      setView(null);
      setFailure(describeActionFailure(res.error, { action: 'Načítanie osi zliav' }));
      return;
    }
    const parsed = parseTimeline(res.data);
    setView(parsed);
    setFailure(
      parsed === null
        ? describeActionFailure(
            { message: 'Odpoveď servera sa nepodarilo prečítať.', code: null },
            { action: 'Načítanie osi zliav' },
          )
        : null,
    );
  }, [windowDays]);

  const { pending } = useRefreshable(load);

  return (
    <details className={styles.fold} data-testid={testId}>
      <summary>
        Okná zliav v čase
        {view === null ? '' : ` (${formatCountSk(view.campaigns.length)})`}
      </summary>
      <div className={styles.foldBody}>
        {failure === null ? null : (
          <ErrorState
            title="Os zliav sa nepodarilo načítať"
            description="Kedy sa zľavy prekrývajú, obrazovka teraz nevie — nie je to obdobie bez zliav."
            failure={failure}
            testId="timeline-error"
          />
        )}

        {pending && view === null && failure === null ? (
          <LoadingState label="Načítavam os zliav…" blocks={2} testId="timeline-busy" />
        ) : null}

        {view === null ? null : <TimelineTable view={view} />}
      </div>
    </details>
  );
}

export default DiscountTimeline;
