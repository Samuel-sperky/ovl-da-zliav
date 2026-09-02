'use client';

/**
 * Aura Zľavy — ROZDELENIE CIEN V MIESTNEJ KÓPII KATALÓGU (V1, prevedené V6b).
 *
 * OTÁZKA: „leží môj výber v tučnej časti cenníka, alebo v chvoste?" Je to
 * otázka PRED zľavou, nie po nej: zľava na desiatich kusoch z pásma, kde má
 * eshop tisíce položiek, znamená niečo iné než zľava na desiatich kusoch
 * z okraja.
 *
 * ═══ AKÁ FORMA TO JE: STĹPEC. ROZHODNUTIE, NIE ZVYK (K5, D126, D135) ═══
 *
 * Do V6b stál tento graf MIMO jednotného jazyka: vlastný rám (`.chart`),
 * vlastný prázdny stav, vlastná legenda, vlastné pravidlo osi. Prevod na
 * `ChartCard` si vyžiadal odpovedať na otázku, ktorej sa dalo päť mesiacov
 * vyhýbať — **ktorá z troch foriem to vlastne je.**
 *
 * `CHART_KINDS` je uzavretý zoznam troch: čiara = vývoj v čase, stĺpec =
 * porovnanie medzi položkami, koláč = rozdelenie katalógu alebo výberu.
 * Histogram je ROZDELENIE, takže sa hlási ku koláču. **Zvolený je STĹPEC** a
 * `CHART_KINDS` sa NEROZŠIRUJE. Prečo:
 *
 *  1. **Krájanie na pásma z veličiny robí položky.** Kým je cena spojitá,
 *     rozdelenie je jej vlastnosť. Len čo je nakrájaná na dvadsaťjeden
 *     pomenovaných pásiem („40 – 50 €"), sú tie pásma POLOŽKY a otázka, ktorú
 *     graf naozaj dostáva — „v ktorom pásme je viac produktov" — je
 *     porovnanie medzi položkami. To je definícia stĺpca.
 *  2. **Koláč to neunesie ani technicky.** `MAX_PIE_SLICES` je šesť a pásiem
 *     je dvadsaťjeden; zliať pätnásť do „ostatné" by zahodilo presne ten tvar,
 *     kvôli ktorému graf existuje. A kruh nemá os: cena by v ňom prestala byť
 *     usporiadaná, takže „tučná časť cenníka" by sa z neho nedala prečítať.
 *  3. **Štvrtá forma by bola najdrahšia možnosť.** Presne takto sa časová os
 *     Zliav grafom NEstala — okno platnosti nemeria veličinu, ale interval,
 *     a keďže to nie je ani jedna z troch foriem, zostala tabuľkou. Kto pridá
 *     „histogram" ako štvrtú formu, dovolí štyri; a pri štyroch sa forma
 *     vyberá podľa toho, ako graf vyzerá.
 *
 * Zapísané je to aj v `ui/chart-language.ts` (sekcia 1), aby si to ďalší graf
 * nemusel vymyslieť znova.
 *
 * ═══ ČO SA PREVODOM ZMENILO — a čo sa ZÁMERNE nezmenilo ═══
 *
 *  · **Rám, hlavička, prázdny stav a prepis pre čítačku sú `ChartCard`.**
 *    Zmizol `.chart`, `.ct`, vlastný `.empty` blok a vlastná legenda. Plocha
 *    zostala INLINE SVG (`price-bins.ts`), lebo geometria zberného pásma,
 *    pripnutých značiek a šiestich popiskov osi je overená bez prehliadača
 *    a Recharts by ju nahradil vlastnou, ktorá tie tri veci nepozná. Jazyk
 *    grafov to dovoľuje výslovne: kreslí sa v `Charts.tsx` (inline SVG) aj
 *    v `ChartCard.tsx` (Recharts), jedno je rám a pravidlá, druhé je technika.
 *  · **Výška je `size="auto"`.** Plocha je 880 × 180, teda plochá; pevná
 *    `--chart-h` (220 – 380 px) by ju zarámovala do prázdna.
 *  · **ZBERNÉ PÁSMO UŽ NIE JE ŠRAFOVANÉ.** Toto je najdôležitejšia oprava
 *    prevodu a nie je kozmetická. Šrafovanie znamená v tejto appke „toto sme
 *    nemerali" — v čiare, v koláči aj v pahýli rebríka. Zberné pásmo je pritom
 *    NAMERANÝCH 180 produktov; šrafované vyzeralo ako priznanie nevedomosti nad
 *    poctivým meraním. Navyše to bol presne ten istý vzor: `<pattern>` mal
 *    napísané `stroke="var(--seq-teal-3)"`, ale trieda `.gapHatch` je v CSS
 *    a CSS prebíja prezentačný atribút, takže sa kreslilo `--line2`. Ten
 *    atribút bol mŕtvy a test naň mal zelené tvrdenie.
 *    Odteraz je zberné pásmo výplň radu s PRERUŠOVANOU hranou (`.barOpen`,
 *    legenda `open`) — teda značka DOLNEJ HRANICE, tá istá, akou `.dotEstimate`
 *    hovorí o nedočítanom dni. Tri kanály zostávajú tri: hrana (tvar),
 *    „a viac"/`≥` (slovo) a rovnaká farba radu (chvost je ten istý rad).
 *  · **Prepis existuje dvakrát a je to ZÁMER.** `srSummary` je pre čítačku
 *    (plocha je `aria-hidden`), `ChartTable` pod grafom je pre oko. Oba berú
 *    TIE ISTÉ `ChartRow[]`, nie zvlášť dopočítané čísla — dva prepisy z dvoch
 *    výpočtov sú dve čísla o produkčnom eshope, každé iné a obe dôveryhodné.
 *
 * ČO GRAF O SVOJICH DÁTACH PRIZNÁVA
 * ─────────────────────────────────
 *
 *  · **Je to kópia, nie dnešný cenník.** Riadok sa obnovuje pri otvorení
 *    zápisového formulára a ručne, takže môže byť týždne starý. Pod grafom
 *    stojí najstarší aj najnovší čas stiahnutia.
 *  · **Produkt bez ceny v grafe nie je.** Počet takých riadkov je pod grafom,
 *    nie zamlčaný — a nespadol do najlacnejšieho pásma ako nula.
 *  · **Chvost je zhrnutý.** Posledný stĺpec je zberný a pod grafom je najvyššia
 *    cena, aby bolo vidieť, kam siaha.
 *  · **Nie je to celý eshop.** Produkty, ktoré sa nikdy nestiahli, tu nie sú
 *    a z počtu riadkov sa to nedá zistiť. Preto „miestna kópia katalógu".
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Základňa osi y sa posunie od nuly.** Pri stĺpcoch je useknutá os
 *     najsilnejšie skreslenie, aké sa dá urobiť — pomer výšok prestane
 *     zodpovedať pomeru počtov a nikto si toho nevšimne. Hranicu preto dáva
 *     `chartScaleMax()` z jazyka grafov, jediné pravidlo osi v appke.
 *  2. **Zberné pásmo dostane obyčajnú hranu.** Vtedy začne graf tvrdiť, že
 *     drahšie produkty neexistujú. Šrafovanie ale NIE JE náhrada — pozri
 *     odsek o prevode vyššie.
 *  3. **Značka výberu stratí popis „pripnutá".** Cena nad hranicou osi sedí
 *     na okraji; bez slova o tom graf tvrdí, že produkt za 900 € stojí 200 €.
 *  4. **Riadok o úplnosti zrkadla vypadne.** `complete` je JEDINÝ kanál, ktorým
 *     graf priznáva, že tvar rozdelenia je tvar KÓPIE, nie eshopu. Chýbajúce
 *     produkty sa z počtu riadkov nedajú zistiť — histogram nad polovicou
 *     katalógu vyzerá presne ako histogram nad celým. Preto je `complete`
 *     zámerne NEPOVINNÝ a `undefined` znamená „nevieme": kto ho zabudne
 *     poslať, dostane opatrnejšie tvrdenie, nie tichý predpoklad úplnosti.
 *     Kreslí sa vo VŠETKÝCH stavoch rámu, aj v prázdnom.
 *  5. **Farba stĺpca odíde z rampy.** Stĺpce sú výhradne zo sekvenčnej rampy
 *     `--seq-teal-*`. Stavová škála `--st-*` sú ZMERANÉ stavy, nie voľné
 *     odtiene — kto ňou vyplní stĺpec, začne cenovým pásmom tvrdiť „v poriadku"
 *     alebo „problém". Stráži to `grafy-paleta.spec.ts`.
 *  6. **Popisky osi stratia štýl.** Kým bola plocha v `.chart`, písmo a farbu
 *     osi dával globálny predpis `.chart svg[role='img'] text`. `ChartCard` ten
 *     rám nekreslí, takže ich nesie `.axisTick` — bez neho by čísla na osi boli
 *     v SVG-východiskovom písme a v čiernej, teda v tmavej téme neviditeľné.
 *
 * Vlastník: V1 (graf), V6b (prevod na jednotný jazyk).
 */
import ChartCard, { ChartSummaryTable, type ChartLegendEntry } from '@/components/charts/ChartCard';
import ChartTable from '@/components/charts/ChartTable';
import styles from '@/components/charts/charts.module.css';
import {
  PRICE_CHART,
  eurWhole,
  priceHistogramGeometry,
  type PriceBinInput,
} from '@/components/charts/price-bins';
import useChartTheme from '@/components/charts/useChartTheme';
import { chartRowText, chartRows, type ChartRow } from '@/components/ui/chart-language';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';
import { formatDateTimeSk, formatEur } from '@/lib/ui/format';

export interface PriceHistogramProps {
  bins: readonly PriceBinInput[];
  /**
   * Ceny VYBRANÝCH produktov — referenčné značky pod osou, nie druhá séria.
   * Prázdne pole je legitímny stav: vtedy graf ukáže len rozdelenie a značky
   * ani ich legendu nekreslí.
   */
  selection: ReadonlyArray<{ productId: number; price: number }>;
  /** Koľko riadkov má miestna kópia katalógu spolu. */
  rows: number;
  /** Z toho bez ceny — do pásiem nevstupujú. */
  withoutPrice: number;
  maxPrice: number | null;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
  /**
   * Dočítalo posledné kolo zrkadlo katalógu po koniec (`catalog.complete`)?
   *
   * Sú to TRI stavy, nie dva, a graf ich rozlišuje: `true` = dočítalo,
   * `false` = zrkadlo celé nie je, `undefined` = stav katalógu sa nepodarilo
   * zistiť. Posledné dva sa nesmú zliať — „nie je celé" je meraný fakt,
   * „nevieme" je priznanie. Fail-closed: ani jeden z nich nedostane tvrdenie
   * „takto vyzerá cenník eshopu".
   */
  complete?: boolean;
}

function binLabel(from: number, to: number | null): string {
  if (to === null) return `${eurWhole(from)} a viac`;
  return `${eurWhole(from)} – ${eurWhole(to)}`;
}

function products(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'produkt', 'produkty', 'produktov')}`;
}

/**
 * Veta o úplnosti zrkadla. Tvar rozdelenia je tvar KÓPIE, nie eshopu, a je to
 * jediné miesto, kde to graf povie — z výšok stĺpcov sa to zistiť nedá.
 */
function mirrorSentence(complete: boolean | undefined): string {
  if (complete === true) {
    return 'Zrkadlo katalógu bolo pri poslednom prechode dočítané po koniec; eshop odvtedy mohol produkty pridať aj zmazať.';
  }
  if (complete === false) {
    return 'Zrkadlo katalógu nie je celé — produkty, ktoré sa ešte nestiahli, v grafe nie sú a z výšok stĺpcov sa to nedá zistiť.';
  }
  return 'Či je zrkadlo katalógu celé, sa nepodarilo zistiť — nestiahnuté produkty by v grafe chýbali bez toho, aby to bolo vidieť.';
}

const CARD_TITLE = 'Ceny v miestnej kópii katalógu';
const CARD_SUBTITLE = 'Koľko produktov padá do ktorého cenového pásma';

export function PriceHistogram({
  bins,
  selection,
  rows,
  withoutPrice,
  maxPrice,
  oldestFetchedAt,
  newestFetchedAt,
  complete,
}: PriceHistogramProps) {
  const theme = useChartTheme();
  const geometry = priceHistogramGeometry(bins, selection);

  /* Priznanie o zrkadle patrí AJ do prázdneho stavu: prázdny graf je práve ten
     stav, v ktorom je neúplné zrkadlo najpravdepodobnejšie vysvetlenie. */
  const mirror = <div data-testid="price-histogram-mirror">{mirrorSentence(complete)}</div>;

  /*
   * JEDEN rad riadkov pre plochu, pre prepis čítačke aj pre viditeľnú tabuľku.
   *
   * Počet v pásme je VŽDY meraný: dotaz prešiel celú tabuľku, takže „v tomto
   * pásme nie je nič" je nula, nie medzera. Je to jediné miesto v grafoch tejto
   * appky, kde sa nula dopĺňa zámerne, a preto to má vlastné tvrdenie
   * v `grafy-ceny.spec.ts`. Produkty BEZ ceny sú iná vec — do pásiem
   * nevstupujú vôbec a graf ich priznáva vetou pod sebou.
   */
  const summaryRows: readonly ChartRow[] =
    geometry === null
      ? []
      : chartRows(
          geometry.bars.map((bar) => ({ label: binLabel(bar.from, bar.to), value: bar.count })),
        );

  const clamped = geometry === null ? 0 : geometry.marks.filter((mark) => mark.clamped).length;

  /*
   * Legenda ide cez `ChartCard`, nie vlastným blokom: druhá legenda vedľa
   * rámovej by bola presne ten dvojník, ktorý D142 zakazuje. Marky `open`
   * a `tick` v jazyku rámu preto pribudli — obe sú tu prvýkrát potrebné a obe
   * sú zapísané ako rozhodnutie v hlavičke `ChartCard.tsx`.
   *
   * Farba zberného pásma je TÁ ISTÁ ako farba stĺpca. Chvost nie je iná
   * veličina, len zhrnutá časť tej istej — rozdiel nesie hrana a slovo.
   */
  const legend: readonly ChartLegendEntry[] =
    geometry === null
      ? []
      : [
          { label: 'počet produktov v pásme', color: theme.ramp[4] },
          {
            label: 'zberné pásmo — chvost je zhrnutý, cena je dolná hranica',
            color: theme.ramp[4],
            open: true,
          },
          /* Legenda značiek stojí a padá s tým, či sa nejaká kreslí. Popis
             marky, ktorú v ráme nikto nevidí, je návod na neexistujúcu vec. */
          ...(geometry.marks.length === 0
            ? []
            : [{ label: 'ceny vybraných produktov', color: theme.ink, tick: true }]),
        ];

  return (
    <ChartCard
      title={CARD_TITLE}
      subtitle={CARD_SUBTITLE}
      as="h3"
      size="auto"
      legend={legend}
      empty={geometry === null}
      emptyTitle="Rozdelenie cien zatiaľ nemáme"
      emptyDescription="Graf sa objaví, keď bude v miestnej kópii katalógu aspoň jedna cena."
      testId="price-histogram"
      /* V prázdnom stave prepisovať nie je čo a rám ho ani nevykreslí — vetu
         nesie `EmptyState`. Prázdny prepis je preto odpoveď, nie obídenie
         povinného propu. */
      srSummary={
        geometry === null ? null : (
          <ChartSummaryTable
            caption="Počet produktov v cenovom pásme"
            labelHead="Cenové pásmo"
            valueHead="Produktov"
            rows={summaryRows}
            format={formatCountSk}
          />
        )
      }
      footer={
        <>
          {geometry === null ? null : (
            <>
              <div data-testid="price-histogram-note">
                {`${products(rows)} v miestnej kópii`}
                {withoutPrice === 0 ? null : `, z toho ${formatCountSk(withoutPrice)} bez ceny`}
                {/* Pomlčka, nikdy nula: „0 €" by tvrdilo, že najdrahší produkt
                    je zadarmo, a vynechanie riadku by zamlčalo, že tá otázka
                    existuje. */}
                {maxPrice === null
                  ? ' · najvyššia cena —'
                  : ` · najvyššia cena ${formatEur(maxPrice)}`}
                {/* Slovenské množné číslo, nie „1 značiek": veta o priznaní,
                    ktorá znie ako strojový preklad, sa čítať prestane. */}
                {clamped === 0
                  ? null
                  : ` · ${formatCountSk(clamped)} ${pluralSk(clamped, 'značka', 'značky', 'značiek')} ${pluralSk(clamped, 'pripnutá', 'pripnuté', 'pripnutých')} na okraj`}
              </div>
              <div data-testid="price-histogram-fetched">
                {oldestFetchedAt === null || newestFetchedAt === null
                  ? 'Ceny sú kópia, nie dnešný cenník'
                  : `Ceny stiahnuté od ${formatDateTimeSk(oldestFetchedAt)} do ${formatDateTimeSk(newestFetchedAt)}`}
              </div>
            </>
          )}
          {mirror}
          {/*
            Viditeľný prepis pre OKO. Berie tie isté `summaryRows` ako prepis
            pre čítačku — nikdy dopočítané čísla. `chartRowText()` je pre obe
            jedna funkcia, takže pomlčka sa v ani jednom z nich nemôže stať
            nulou (I11).
          */}
          {geometry === null ? null : (
            <ChartTable
              caption="počet produktov v cenovom pásme"
              columns={[{ head: 'Cenové pásmo' }, { head: 'Produktov', numeric: true }]}
              rows={summaryRows.map((row) => ({
                cells: [row.label, chartRowText(row, formatCountSk)],
              }))}
              testId="price-histogram-table"
            />
          )}
        </>
      }
    >
      {geometry === null ? null : (
        <svg
          className={styles.plotSvg}
          viewBox={`0 0 ${PRICE_CHART.width} ${PRICE_CHART.height}`}
          focusable="false"
          data-testid="price-histogram-svg"
        >
          {geometry.gridLines.map((grid, index) => (
            <g key={grid.value}>
              <line
                className={styles.gridLine}
                x1={PRICE_CHART.left}
                y1={grid.y}
                x2={PRICE_CHART.right}
                y2={grid.y}
                strokeDasharray={index === 0 ? undefined : '2 4'}
              />
              <text className={styles.axisTick} x="0" y={grid.y + 3}>
                {formatCountSk(grid.value)}
              </text>
            </g>
          ))}

          {geometry.bars.map((bar) => (
            /* Zberné pásmo má TÚ ISTÚ výplň (je to ten istý rad) a líši sa
               prerušovanou hranou. Šrafovanie tu byť NESMIE — pozri hlavičku. */
            <rect
              className={bar.open ? `${styles.bar} ${styles.barOpen}` : styles.bar}
              key={`${bar.from}`}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
            />
          ))}

          {/* Ceny výberu — neutrálne značky pod osou, nie druhá séria. */}
          {geometry.marks.map((mark) => (
            <line
              className={styles.refMark}
              key={mark.productId}
              x1={mark.x}
              y1={PRICE_CHART.baseline + 2}
              x2={mark.x}
              y2={PRICE_CHART.baseline + 10}
            />
          ))}

          {geometry.xLabels.map((tick) => (
            <text
              className={styles.axisTick}
              key={tick.value}
              x={tick.x}
              y={PRICE_CHART.height - 4}
              textAnchor="middle"
            >
              {eurWhole(tick.value)}
            </text>
          ))}
        </svg>
      )}
    </ChartCard>
  );
}

export default PriceHistogram;
