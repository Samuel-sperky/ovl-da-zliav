'use client';

/**
 * Aura Zľavy — sekcia OBOHACOVANIE KATALÓGU (D118 bod 2, D120; I11).
 *
 * PREČO TÁTO SEKCIA VZNIKLA AŽ 31. 8. 2026
 * ----------------------------------------
 * Dávka obohacovania si od migrácie 0014 zapisovala pokrok, denný diel a hlavne
 * DÔVOD PAUZY do `catalog_enrich_state` — a nečítal to nikto. `grep -rn
 * loadEnrichState src/` vracal výhradne engine a repozitár, takže dávka mohla
 * stáť tri týždne s odmietnutou adresou a človek to zistil jedine `SELECT`-om
 * do databázy. Presne to I11 zakazuje: appka VIE, že stojí, a nepovie to.
 *
 * PREČO STOJÍ PRI ROZPOČTOCH
 * --------------------------
 * Dávka míňa denný ČÍTACÍ rozpočet (dráha `product_read`, ~150 produktov na
 * deň) — je to teda tá istá otázka ako „koľko toho appka smie za deň", nie
 * samostatný kút. Od 31. 8. 2026 to platí dvojnásobne: dráha `product_read`
 * číta SO zápisovým kľúčom, takže tie čítania sa v `engine/budget.ts`
 * odpočítavajú od zápisového stropu (nad rezervou `WRITE_QUOTA_RESERVE`).
 * Sekcia to preto povie aj tu, dvoma vetami BEZ čísel — čísla vlastní
 * rozpočtová sekcia, ktorá ich dostáva zo servera. Vlastnú kotvu do `SETTINGS_ANCHORS` zámerne NEDOSTALA: ploché
 * poradie kotiev je zmluva, ktorú strážia testy V12, a sekcia sa dá nájsť
 * rovnako dobre pod rozpočtami, kam vecne patrí. Odkaz z Prehľadu preto vedie
 * priamo na `#obohacovanie` na tejto podstránke.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Neobohatený katalóg nie je chyba.** 41 348 produktov pri ~150 za deň je
 *     ~276 dní; „ešte to nie je hotové" je PRIEBEH. Preto tu nie je červená ani
 *     slovo o poruche — červená je vyhradená strate dát a zastavenému zápisu.
 *  2. **Nula sa nedopĺňa, kreslí sa pomlčka.** Každé číslo má tri stavy:
 *     hodnota · „dnes nebežala" · „nevieme" (I11). Nula obohatených je meraný
 *     fakt a povie sa ako nula.
 *  3. **`paused_until` bez hodnoty pri odmietnutej adrese je ZÁMER.** Dôvod
 *     trvá, kým doň nezasiahne človek, takže žiadny čas ďalšieho pokusu
 *     neexistuje — a veta to musí povedať tak, aby to nevyzeralo ako chyba
 *     appky. Text je v `lib/catalog/enrich-view.ts`, nie tu: tú istú vetu
 *     kreslí aj stavový pás Prehľadu a dve formulácie by sa raz rozišli.
 *  4. **Sekcia je čisto čítacia.** Žiadne tlačidlo „obohať teraz": dávku
 *     vlastní scheduler a plošný prechod na dopyt by minul dennú kvótu za
 *     minútu.
 *
 * Vlastník: V4 (obohacovanie).
 */
import Note from '@/components/ui/Note';
import StatTile from '@/components/ui/StatTile';
import ToneBadge from '@/components/ui/ToneBadge';
import {
  enrichCoverageSentence,
  enrichNote,
  type EnrichStatePayload,
} from '@/lib/catalog/enrich-view';
import { formatDateTimeSk } from '@/lib/ui/format';
import { formatCountSk } from '@/lib/ui/vocabulary';

/** Čím appka hovorí „toto nevieme". Nikdy nula, nikdy dopočítaný odhad. */
const DASH = '—';

export interface EnrichSectionProps {
  /**
   * Odpoveď `GET /api/catalog/enrich`. `null` = nedala sa prečítať; sekcia to
   * POVIE a nič si nedopočíta.
   */
  enrich: EnrichStatePayload | null;
}

/**
 * Riadok „Čas ďalšieho pokusu" v technickom detaile.
 *
 * Štyri odpovede, nie dve: nevieme · dávka nestojí · čas · „neexistuje, čaká sa
 * na človeka". Práve tá posledná je pointa D120 — pri odmietnutej adrese žiadny
 * čas obnovenia neexistuje a prázdna bunka by vyzerala ako chýbajúci údaj.
 */
function resumeCell(state: EnrichStatePayload['state']): string {
  if (state === null) return DASH;
  if (!state.paused) return 'dávka nestojí';
  if (state.pausedUntil === null) {
    return state.waitsForHuman ? 'neexistuje — čaká sa na človeka' : DASH;
  }
  return formatDateTimeSk(state.pausedUntil);
}

export function EnrichSection({ enrich }: EnrichSectionProps) {
  const note = enrichNote(enrich);
  // Turbopack tu už raz zahodil `if (!state)` ako compile-time falsy.
  const state = enrich === null ? null : enrich.state;
  const coverage = enrich === null ? null : enrich.coverage;

  /** Dnešný diel. `null` = dávka dnes nebežala, a to nie je nula (I11). */
  const today = state === null ? null : state.enrichedToday;

  return (
    <section className="sec" id="obohacovanie" data-testid="enrich-section">
      <div className="sec-h">
        <h2>Obohacovanie katalógu</h2>
        <div className="act">
          <ToneBadge tone={note.tone} data-testid="enrich-tone">
            {note.label}
          </ToneBadge>
        </div>
      </div>

      {/*
        Dôvod stavu je na POVRCHU, nie pod rozklikom. Je to jediná veta, ktorá
        vysvetľuje, prečo sa katalóg nehýbe — a práve jej absencia bola tri
        týždne celý problém.
      */}
      <Note
        variant={note.tone === 'attention' ? 'warn' : 'info'}
        testId="enrich-what"
      >
        {note.what}
        {note.nextStep === null ? null : (
          <>
            {' '}
            <b>{note.nextStep}</b>
          </>
        )}
      </Note>

      {/*
        Odkiaľ sa dávke berie kvóta — a hlavne, že ju delí so zápismi zliav.
        Vety sú ZÁMERNE bez čísel: presné čísla (koľko čítaní sa dnes odpočítalo
        a aká je rezerva) vlastní rozpočtová sekcia, ktorá ich má zo servera.
        Tu by museli byť odpísané z konštanty, a to je tvrdenie o stave, ktorý
        táto sekcia neprečítala (I11). Tón je bežný text: ubúdanie kvóty
        čítaniami je priebeh, nie zastavenie zápisov.
      */}
      <div className="lvl-3" data-testid="enrich-shared-quota">
        Obohacovanie číta so zápisovým kľúčom, takže míňa tú istú dennú kvótu ako zľavy.
      </div>
      <div className="lvl-3" data-testid="enrich-write-reserve">
        Rezervu zápisov to nezmenšuje — tú časť kvóty si zľavy držia.
      </div>

      <div className="kpis">
        <StatTile
          label="Obohatených produktov"
          value={
            coverage === null || coverage.enriched === null ? (
              DASH
            ) : (
              <>
                {formatCountSk(coverage.enriched)}{' '}
                <span className="lvl-3">
                  /{' '}
                  {coverage.catalogProducts === null
                    ? DASH
                    : formatCountSk(coverage.catalogProducts)}
                </span>
              </>
            )
          }
          detail={coverage === null ? 'zatiaľ neviem' : enrichCoverageSentence(coverage)}
          testId="enrich-coverage"
        />
        <StatTile
          label="Dnes obohatených"
          value={
            today === null ? (
              DASH
            ) : (
              <>
                {formatCountSk(today)}{' '}
                <span className="lvl-3">
                  {/* Cieľ sa kreslí len keď ho appka pozná; „/ 0" by bol výmysel. */}
                  / {state === null || state.dailyTarget <= 0 ? DASH : formatCountSk(state.dailyTarget)}
                </span>
              </>
            )
          }
          /*
           * „Dnes" je UTC deň eshopu, nie lokálna polnoc — kvótu resetuje shop.
           * Tri stavy, tri vety: hodnota · „dnes nebežala" (počítadlo je z iného
           * dňa) · „nevieme" (stav sa nedal prečítať). Zliať druhú s treťou by
           * znamenalo vydávať problém databázy za správu o dávke.
           */
          detail={
            state === null
              ? 'zatiaľ neviem'
              : today === null
                ? 'dnes dávka nebežala'
                : 'deň sa počíta podľa eshopu'
          }
          testId="enrich-today"
        />
        <StatTile
          label="Naposledy čítané"
          value={
            state === null || state.lastReadAt === null ? (
              DASH
            ) : (
              formatDateTimeSk(state.lastReadAt)
            )
          }
          detail={
            state === null || state.lastReadAt === null
              ? 'zo shopu sme ešte nečítali'
              : 'meraný fakt, nie odhad'
          }
          testId="enrich-last-read"
        />
      </div>

      {/*
        Technický detail (P6): čísla, ktoré na povrchu nemusia byť, ale bez
        ktorých sa problém nedá popísať do žiadosti správcovi shopu. Kód chyby
        tu NIE JE — von ide len príznak (I1, K10).
      */}
      <details className="tech">
        <summary>Technický detail</summary>
        <div className="body">
          <table data-testid="enrich-detail">
            <tbody>
              <tr>
                <td>Dôvod pauzy</td>
                {/* Uplynutá pauza NIE JE pauza — dôvod sa vypisuje len vtedy,
                    keď dávka naozaj stojí (`paused` počíta server). */}
                <td>{state === null ? DASH : state.paused ? note.label : 'žiadny'}</td>
              </tr>
              <tr>
                <td>Čas ďalšieho pokusu</td>
                <td>{resumeCell(state)}</td>
              </tr>
              <tr>
                <td>Posledný beh spadol</td>
                <td>{state === null ? DASH : state.failedLastTime ? 'áno' : 'nie'}</td>
              </tr>
              <tr>
                <td>Produktov podľa eshopu</td>
                <td>
                  {coverage === null || coverage.shopTotalProducts === null
                    ? DASH
                    : formatCountSk(coverage.shopTotalProducts)}
                </td>
              </tr>
              <tr>
                <td>Prvý beh dávky</td>
                <td>
                  {state === null || state.startedAt === null
                    ? DASH
                    : formatDateTimeSk(state.startedAt)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export default EnrichSection;
