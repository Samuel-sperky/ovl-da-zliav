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
 * TRETIA DRÁHA, KTORÁ TÚ KVÓTU NAOPAK DELÍ (31. 8. 2026)
 * ------------------------------------------------------
 * Obohacovanie katalógu (`getFull`, dráha `product_read`) číta SO zápisovým
 * kľúčom, takže míňa tú istú dennú kvótu ako zápisy zliav. `engine/budget.ts`
 * to od 31. 8. 2026 odpočítava — ale len NAD rezervou `WRITE_QUOTA_RESERVE`,
 * takže čítania nedokážu zápisom zobrať všetko. Na obrazovke z toho boli dva
 * oddelené prúžky a nič, čo by povedalo, prečo zápisový zostatok klesol; táto
 * sekcia to preto pomenúva dvoma vetami pod zápisovým prúžkom.
 *
 * Čísla na to prichádzajú HOTOVÉ zo servera (`keyedReadsCharged`,
 * `writeReserve`). Keď v odpovedi nie sú (staršia odpoveď), veta sa NEKRESLÍ:
 * rezerva odpísaná z konštanty v tomto súbore by bola tvrdenie o stave, ktorý
 * appka neprečítala (I11). Nikdy sa nedosádza nula.
 *
 * TRI VECI, KTORÉ SA TU NESMÚ POKAZIŤ
 * -----------------------------------
 * 1. **Vyčerpaný rozpočet nie je chyba.** Je to informácia, takže má neutrálnu
 *    farbu a vetu „pokračujem zajtra" — nikdy nie červenú a nikdy nie slovo
 *    o zlyhaní. `BudgetMeter` to drží sám (predvolený tón plného stropu je
 *    `attention`, nie `critical`); kto by si tu vypýtal červenú, poruší K2.
 * 2. **Neznáme číslo sa nedopĺňa.** Keď server rozpočet nevie povedať, prúžok
 *    sa NEKRESLÍ a na jeho mieste to appka POVIE — priznanie „zatiaľ neviem"
 *    ostáva na povrchu, len jeho výklad je pod rozklikom. Prúžok s nulou by bol
 *    tvrdenie, nie medzera — a appka zapisuje do produkčného eshopu.
 * 3. **Odhad je označený.** Dátum dobehnutia fronty je plán pri dnešnej
 *    rýchlosti, nie sľub, preto nesie znak `≈` a tlmenejší odtieň.
 *
 * Spotreba sa NEPOČÍTA tu — appka ju číta z histórie, ktorá sa nedá prepísať.
 * Táto obrazovka je čisto čítacia.
 *
 * KDE STOJÍ DÔVOD (vlna 2 šprintu 20, 20. 8. 2026)
 * ------------------------------------------------
 * Na povrchu ostalo TVRDENIE — že rozpočty sú dva, že sa niektoré číslo nedá
 * prečítať, že fronta teraz nezapisuje. Prečo to tak je (dve kvóty a dva spôsoby
 * počítania, prísnejšia možnosť pri neznámom čísle, tichá appka) sa presunulo
 * pod rozklik „Technický detail" — pravidlo P6, strop P2 je 90 znakov na jeden
 * blok povrchu. Nič sa nezmazalo, dôvod je o jedno kliknutie ďalej. Kto ho vráti
 * na povrch, poruší P2; stráži to `test/unit/text-zapisy-povrch.spec.ts`.
 *
 * Slová „chyba", „zlyhal" a „porucha" sa v tejto sekcii nesmú objaviť ANI pod
 * rozklikom — vyčerpaný rozpočet nie je porucha (K2) a testy V12 ich hľadajú
 * nad CELÝM vykresleným HTML, teda aj v obsahu rozkliku.
 *
 * Vlastník: V12.
 */
import BudgetMeter from '@/components/ui/BudgetMeter';
import Note from '@/components/ui/Note';
import StatTile from '@/components/ui/StatTile';
import { formatDateSk, formatDateTimeSk } from '@/lib/ui/format';
import { formatCountSk } from '@/lib/ui/vocabulary';
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

  /*
   * JEDNA KVÓTA KĽÚČA: čítania na zápisovom kľúči a rezerva zápisov.
   *
   * Obe čísla musia prísť zo servera. `undefined` znamená „nevieme" a vtedy sa
   * o rezerve NEHOVORÍ vôbec — dosadená nula by tvrdila, že rezerva neexistuje,
   * a odpísaná konštanta by tvrdila stav, ktorý appka neprečítala (I11).
   * Porovnáva sa explicitne (`!== undefined`); Turbopack tu už raz zahodil
   * skrátený guard ako compile-time falsy.
   */
  const keyedReads = budget?.keyedReadsToday;
  const keyedReadsCharged = budget?.keyedReadsCharged;
  const writeReserve = budget?.writeReserve;
  const shared =
    keyedReadsCharged !== undefined &&
    writeReserve !== undefined &&
    Number.isFinite(keyedReadsCharged) &&
    Number.isFinite(writeReserve)
      ? { charged: keyedReadsCharged, reserve: writeReserve }
      : null;

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

      {/* Zostáva JEDINÁ veta, ktorú nehovorí nič iné na tejto obrazovke: že sú
          to dva oddelené rozpočty. Prečo je zľava fronta na dni, povie dlaždica
          „Fronta hotová ≈" vedľa; čo z oddelenia plynie, stojí pod rozklikom. */}
      {/* „Čítania" bez určenia by po 31. 8. 2026 nebola pravda: čítanie
          KATALÓGU má naozaj oddelený rozpočet, ale obohacovanie ide so
          zápisovým kľúčom a kvótu delí. Veta preto pomenúva, o ktoré čítanie
          ide; to druhé je pod zápisovým prúžkom a v technickom detaile. */}
      <Note testId="budget-intro">
        <b>Zápisy a čítanie katalógu majú oddelené rozpočty.</b>
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
              Koľko zápisov dnes odišlo, <b>zatiaľ neviem</b>.
            </Note>
          )}

          {/*
            Prečo zápisový zostatok nesedí s odčítaním „strop − zápisy".
            Tón je bežný text, nie výstraha: ubúdanie kvóty čítaniami je
            NORMÁLNY priebeh dňa. Červená je v tejto appke vyhradená strate
            dát a zastavenému zápisu a rezerva je presne to, čo zastaveniu
            zabraňuje. Keď čísla neprišli, nekreslí sa ani jedna z viet.
          */}
          {shared === null ? null : (
            <>
              <div className="lvl-3" data-testid="budget-writes-keyed-reads">
                Zo zostatku ubrali dnes čítania na tom istom kľúči{' '}
                {formatCountSk(shared.charged)} zápisov.
              </div>
              <div className="lvl-3" data-testid="budget-writes-reserve">
                Rezerva {formatCountSk(shared.reserve)} zápisov je pre zľavy nedotknuteľná.
              </div>
            </>
          )}
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
              Koľko čítaní katalógu dnes odišlo, <b>zatiaľ neviem</b>.
            </Note>
          )}
          <div className="lvl-3">Z toho appka číta katalóg aj predajnosť.</div>
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
              // Jediný formátovač dátumu (kontrakt UI bod 10). Do 20. 8. 2026
              // tu bol krátky tvar `2. 9.` kvôli šírke dlaždice — bol to ale
              // druhý tvar toho istého dňa, takže `≈ 2. 9.` v Nastaveniach
              // a `02.09.2026` v detaile zľavy vyzerali ako dva rôzne údaje.
              // Čo sa tým smie ticho pokaziť: `.est` je v úzkej dlaždici a
              // dlhší dátum sa v nej môže zlomiť tak, že znak `≈` zostane
              // visieť sám na riadku. Kontrolovať treba pri 1440×900.
              <span className="est" data-testid="budget-estimate">
                {formatDateSk(queue.estimate.date)}
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
          Fronta teraz nezapisuje. Keď sa appka rozbehne, pokračuje tam, kde skončila.
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
          {/* Sem sa vo vlne 2 presunuli štyri vysvetlenia z povrchu (P6). Sú
              písané ako trvalé pravidlá, nie ako komentár k aktuálnemu stavu,
              preto sa kreslia vždy — aj keď práve teraz všetky čísla poznáme. */}
          <p data-testid="budget-why-two">
            Zápisy idú s kľúčom a majú vlastnú kvótu na kľúč. Načítavanie katalógu ide bez
            kľúča, na inú kvótu, počítanú na adresu počítača. Preto načítavanie katalógu
            neuberá zo zliav a naopak.
          </p>
          {/* Toto je TRVALÉ pravidlo, nie komentár k dnešným číslam, takže sa
              kreslí vždy — a zámerne bez jediného čísla. Číslami hovoria len
              vety pod zápisovým prúžkom, a tie len vtedy, keď čísla naozaj
              prišli zo servera (I11). */}
          <p data-testid="budget-why-shared-quota">
            Obohacovanie katalógu (podrobnosti o produkte) naopak číta so zápisovým
            kľúčom, takže míňa tú istú dennú kvótu ako zápisy zliav. Čítania nad rezervu
            preto zápisový strop zmenšujú — je to normálny priebeh dňa, nie zastavenie
            zápisov. Na rezervu zápisov sa čítania nedostanú ani vtedy, keď vyčerpajú
            celú svoju dráhu, takže appka nikdy nestratí schopnosť zapísať zľavu.
          </p>
          <p data-testid="budget-why-unknown-writes">
            Kým appka nevie, koľko zápisov dnes odišlo, správa sa, akoby bol rozpočet
            minutý — radšej nezapíše nič, než by prekročila strop eshopu.
          </p>
          <p data-testid="budget-why-unknown-reads">
            Kým appka nevie, koľko čítaní katalógu dnes odišlo, načítavanie radšej počká.
            Zliav sa to netýka, tie majú vlastný rozpočet.
          </p>
          <p data-testid="budget-why-idle">
            Fronta nezapisuje aj vtedy, keď sa appka neozvala dosť dlho na to, aby sa
            dalo povedať, že beží.
          </p>
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
              {/* Riadok existuje len vtedy, keď čísla prišli. Pomlčka by tu
                  bola menšie zlo než nula, ale aj tak by tvrdila, že rezerva
                  je vec, ktorú appka sledovala a nedočítala — pri staršej
                  odpovedi o nej nevie vôbec. */}
              {shared === null ? null : (
                <tr>
                  <td>Čítania na zápisovom kľúči</td>
                  <td className="mono" data-testid="budget-keyed-reads-detail">
                    {keyedReads === undefined ? '' : `${keyedReads} dnes · `}
                    {shared.charged} odpočítaných · rezerva {shared.reserve}
                  </td>
                </tr>
              )}
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
