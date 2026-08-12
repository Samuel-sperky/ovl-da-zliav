'use client';

/**
 * Aura Zľavy — sekcia ROZPOČTY (V12; kontrakt V3, bod K-dva; A4).
 *
 * Eshop dovolí obmedzený počet volaní za deň, takže zľava na tisíce produktov
 * nie je akcia, ale fronta bežiaca dni. Táto sekcia je jediné miesto, kde je
 * rozpočet rozpísaný; v hlavičke je z neho len jedno číslo.
 *
 * DVA ROZPOČTY, KTORÉ SA NESMÚ ZLIAŤ DO JEDNÉHO
 * ---------------------------------------------
 * Zápisy idú s kľúčom a majú vlastnú kvótu na kľúč. Čítanie katalógu ide BEZ
 * kľúča, na inú kvótu, počítanú na adresu počítača. Vyčerpané čítania preto
 * zápisu nebránia a naopak — a keby tu bol jeden spoločný prúžok, používateľ by
 * si myslel, že načítavanie katalógu mu ujedá zo zliav. Sú to dva prúžky vedľa
 * seba a každý má svoj popis.
 *
 * TRI VECI, KTORÉ SA TU NESMÚ POKAZIŤ
 * -----------------------------------
 * 1. **Vyčerpaný rozpočet nie je chyba.** Je to informácia, takže má neutrálnu
 *    farbu a vetu „pokračujem zajtra" — nikdy nie červenú a nikdy nie slovo
 *    o zlyhaní. `BudgetMeter` to drží sám (predvolený tón plného stropu je
 *    `attention`, nie `critical`); kto by si tu vypýtal červenú, poruší K2.
 * 2. **Neznáme číslo sa nedopĺňa.** Keď server rozpočet nevie povedať, prúžok
 *    sa NEKRESLÍ a na jeho mieste je veta s dôvodom. Prúžok s nulou by bol
 *    tvrdenie, nie medzera — a appka zapisuje do produkčného eshopu.
 * 3. **Odhad je označený.** Dátum dobehnutia fronty je plán pri dnešnej
 *    rýchlosti, nie sľub, preto nesie znak `≈` a tlmenejší odtieň.
 *
 * Spotreba sa NEPOČÍTA tu — appka ju číta z histórie, ktorá sa nedá prepísať.
 * Táto obrazovka je čisto čítacia.
 *
 * Vlastník: V12.
 */
import BudgetMeter from '@/components/ui/BudgetMeter';
import Note from '@/components/ui/Note';
import StatTile from '@/components/ui/StatTile';
import { formatDateTimeSk } from '@/lib/ui/format';
import { dayMonthSk, formatCountSk } from '@/lib/ui/vocabulary';
import type { CatalogView, QueueView, SettingsView } from '@/components/settings/api';

export interface BudgetSectionProps {
  settings: SettingsView;
  queue: QueueView | null;
  /**
   * Stav katalógu a jeho čítací rozpočet. `null` aj chýbajúca hodnota znamenajú
   * to isté — nevieme; prúžok čítaní sa vtedy NEKRESLÍ.
   */
  catalog?: CatalogView | null;
}

/**
 * Hotová fráza o obnove stropu (`o 02:00`) z času obnovy.
 *
 * `BudgetMeter` si frázu ZÁMERNE nezostavuje sám — nevie, či strop beží na UTC
 * deň, lokálnu polnoc alebo kĺzavú minútu. Tu to vieme: čas obnovy prichádza zo
 * servera ako presný okamih, takže sa len preloží do lokálneho času. Keď čas
 * nepoznáme, vrátime `null` a riadok o obnove sa nekreslí — vymyslená hodina by
 * bola sľub, ktorý appka nedrží.
 */
export function resetPhraseSk(iso: string | null | undefined): string | null {
  if (iso == null || iso === '') return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const hh = String(at.getHours()).padStart(2, '0');
  const mi = String(at.getMinutes()).padStart(2, '0');
  return `o ${hh}:${mi}`;
}

export function BudgetSection({ settings, queue, catalog }: BudgetSectionProps) {
  const budget = queue?.budget ?? null;
  const known = budget !== null;
  const spent = budget?.spent ?? 0;
  const limit = budget?.budget ?? settings.dailyWriteBudget;
  const remaining = budget?.remaining ?? 0;
  const exhausted = budget?.exhausted === true;

  const pending = queue?.queue.pending ?? 0;
  const total = queue?.queue.total ?? 0;
  const done = queue?.queue.done ?? 0;

  // Chýbajúca hodnota a `null` znamenajú to isté — nevieme. Zjednotí sa hneď
  // na začiatku, aby sa ďalej nemuselo rozlišovať medzi dvoma tvarmi „neviem".
  const cat = catalog ?? null;
  const reads = cat?.reads ?? null;
  const readsReset = resetPhraseSk(reads?.resetAt);
  /**
   * Obnova ZÁPISOVÉHO stropu je vlastný okamih zo servera. Keď ho nepoznáme,
   * riadok o obnove sa nekreslí — hodina odhadnutá z iného rozpočtu by bola
   * tvrdenie, nie údaj.
   */
  const writesReset = resetPhraseSk(queue?.limits?.nextResetAt);

  return (
    <section className="sec" id="rozpocet" data-testid="budget-section">
      <div className="sec-h">
        <h2>Rozpočty na dnes</h2>
        <div className="act lvl-3">Deň sa počíta podľa eshopu</div>
      </div>

      <Note testId="budget-intro">
        Eshop pustí za jeden deň obmedzený počet volaní, preto je zľava na tisíce
        produktov fronta na dni, nie jedna akcia. <b>Zápisy a čítania majú oddelené
        rozpočty</b> — načítavanie katalógu neuberá zo zliav a naopak.
      </Note>

      <div className="set-meters" data-testid="budget-meters">
        <div className="stack">
          {known ? (
            <BudgetMeter
              label="Zápisy zliav dnes"
              spent={spent}
              limit={limit}
              resetsAt={writesReset}
              large
              testId="budget-meter-writes"
            />
          ) : (
            <Note variant="warn" testId="budget-writes-unknown">
              Koľko zápisov dnes odišlo, <b>zatiaľ neviem</b>. Kým to tak je, appka sa
              správa, akoby bol rozpočet minutý — radšej nezapíše nič, než by prekročila
              strop eshopu.
            </Note>
          )}
          <div className="lvl-3">
            Zapisuje sa jeden produkt za druhým, s pauzou. Keď sa strop minie, fronta
            počká do obnovy a pokračuje presne tam, kde skončila.
          </div>
        </div>

        <div className="stack">
          {reads !== null && reads.known ? (
            <BudgetMeter
              label="Čítania katalógu dnes"
              spent={reads.used}
              limit={reads.limit}
              resetsAt={readsReset}
              large
              testId="budget-meter-reads"
            />
          ) : (
            <Note variant="warn" testId="budget-reads-unknown">
              Koľko čítaní katalógu dnes odišlo, <b>zatiaľ neviem</b>. Načítavanie
              katalógu preto radšej počká — zliav sa to netýka, tie majú vlastný
              rozpočet.
            </Note>
          )}
          <div className="lvl-3">
            Z toho appka číta katalóg aj predajnosť. Strop je nižší než ten, čo eshop
            pustí — zvyšok je rezerva pre ostatné volania z tohto počítača.
          </div>
        </div>
      </div>

      <div className="kpis">
        <StatTile
          label="Dnes zapísané"
          value={
            <>
              {known ? formatCountSk(spent) : '—'}{' '}
              <span className="lvl-3">/ {formatCountSk(limit)}</span>
            </>
          }
          detail={
            known
              ? exhausted
                ? 'pokračujem zajtra'
                : `zostáva ${formatCountSk(remaining)}`
              : 'zatiaľ neviem'
          }
          testId="budget-spent"
        />
        <StatTile
          label="Vo fronte"
          value={
            <>
              {formatCountSk(done)} <span className="lvl-3">/ {formatCountSk(total)}</span>
            </>
          }
          detail={pending > 0 ? `čaká ${formatCountSk(pending)}` : 'fronta je prázdna'}
          testId="budget-queue"
        />
        <StatTile
          label="Fronta hotová"
          value={
            queue?.estimate != null ? (
              // Krátky tvar `2. 9.` — dlhý dátum sa v úzkej dlaždici zlomí
              // a znak odhadu by zostal visieť na samostatnom riadku.
              <span className="est" data-testid="budget-estimate">
                {dayMonthSk(queue.estimate.date)}
              </span>
            ) : (
              '—'
            )
          }
          detail={queue?.estimate != null ? 'pri dnešnej rýchlosti' : 'niet čo dopočítať'}
          testId="budget-finish"
        />
        <StatTile
          label="Katalóg načítaný"
          value={
            cat === null ? (
              '—'
            ) : (
              <>
                {formatCountSk(cat.loadedProducts)}{' '}
                <span className="lvl-3">
                  / {cat.shopTotalProducts === null ? '?' : formatCountSk(cat.shopTotalProducts)}
                </span>
              </>
            )
          }
          detail={
            cat === null
              ? 'zatiaľ neviem'
              : cat.complete
                ? 'celý katalóg je načítaný'
                : 'dočítava sa ďalej, po dávkach'
          }
          testId="budget-catalog"
        />
      </div>

      {queue?.heartbeat.stale === true ? (
        <Note variant="warn" testId="budget-idle">
          Fronta teraz nezapisuje — appka sa neozvala dosť dlho na to, aby sa dalo
          povedať, že beží. Keď sa rozbehne, pokračuje tam, kde skončila.
        </Note>
      ) : null}

      <div className="kv">
        <span className="k">Zápisy — náš strop</span>
        <span className="v" data-testid="budget-limit">
          {formatCountSk(settings.dailyWriteBudget)} na deň
        </span>
        <span className="lvl-3">znížiť ho zatiaľ vie len správca appky</span>

        {/* Strop eshopu je CUDZIE číslo — nikdy sa nenahrádza naším rozpočtom.
            Keby sme sem dosadili vlastný strop, používateľ by prestal vedieť,
            ktoré z tých dvoch čísel si smie zmeniť sám. */}
        <span className="k">Zápisy — strop eshopu</span>
        <span className="v" data-testid="budget-shop-limit">
          {queue?.limits == null ? '—' : `${formatCountSk(queue.limits.shopPerUtcDay)} na deň`}
        </span>
        <span className="lvl-3">
          {queue?.limits == null ? 'zatiaľ neviem' : 'vyšší nedostaneme, eshop viac neprijme'}
        </span>

        <span className="k">Čítania — náš strop</span>
        <span className="v" data-testid="budget-reads-limit">
          {reads === null ? '—' : `${formatCountSk(reads.limit)} na deň`}
        </span>
        <span className="lvl-3">
          {reads === null ? 'zatiaľ neviem' : 'nižší než strop eshopu, zvyšok je rezerva'}
        </span>
      </div>

      <details className="tech">
        <summary>Technický detail</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td>Deň rozpočtu</td>
                <td className="mono">{budget?.day ?? '—'} (UTC)</td>
              </tr>
              <tr>
                <td>Zdroj spotreby</td>
                <td className="mono">count(write_attempt) nad audit_log</td>
              </tr>
              <tr>
                <td>Pauza medzi zápismi</td>
                <td className="mono">min. 3 s (limit 20/min)</td>
              </tr>
              <tr>
                <td>Čítania</td>
                <td className="mono">
                  {reads === null
                    ? '—'
                    : `${reads.usedThisMinute}/${reads.minuteLimit} min · ${reads.used}/${reads.limit} deň`}
                </td>
              </tr>
              <tr>
                <td>Posledný krok fronty</td>
                <td className="mono">{queue?.heartbeat.lastTickAt ?? '—'}</td>
              </tr>
              <tr>
                <td>Posledné čítanie katalógu</td>
                <td className="mono">{formatDateTimeSk(catalog?.lastFetchedAt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export default BudgetSection;
