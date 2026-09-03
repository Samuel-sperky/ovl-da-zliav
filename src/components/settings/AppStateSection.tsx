'use client';

/**
 * Aura Zľavy — STAV A PREKÁŽKY V NASTAVENIACH (V7, D152; 3. 9. 2026).
 *
 * PREČO TENTO SÚBOR VZNIKOL
 * ─────────────────────────
 * Do V7 stál stavový pás a sekcia prekážok na PREHĽADE. Samuel označil
 * „priveľa vecí na obrazovke" ako jednu zo štyroch príčin, pre ktoré je V6
 * nečitateľná, a D152 z toho urobil rozhodnutie: Prehľad má štyri sekcie (KPI
 * riadok · graf · tabuľka · bežiace zľavy) a **stavový pás s poistkami
 * odchádza na Nastavenia**.
 *
 * Táto sekcia je ten presun. NIE JE to nová formulácia stavu: kreslí presne tie
 * isté tri komponenty, ktoré kreslil Prehľad — `StatusBand`, `StatusSection`
 * pod jeho rozklikom a `BlockersSection` mimo rozkliku. Ani jedna veta o stave
 * appky sa neskladá druhýkrát; verdikt, kontroly aj vety prekážok prichádzajú
 * hotové z `overview-verdict.ts` a z `GET /api/status`.
 *
 * PREČO SÚ TIE KOMPONENTY ĎALEJ V `components/dashboard/`
 * ──────────────────────────────────────────────────────
 * Presunula sa OBRAZOVKA, na ktorej sa kreslia, nie ich vlastníctvo. Presun
 * súborov (a s nimi tried z `overview.module.css`) by prepísal cesty v ôsmich
 * testoch, ktoré ich čítajú Z DISKU podľa cesty — a to je churn bez merateľného
 * zisku. Ktorá obrazovka komponent kreslí, je fakt o routovaní; priečinok je
 * o tom, kto vetám rozumie.
 *
 * PREČO SI SEKCIA ŤAHÁ DÁTA SAMA
 * ──────────────────────────────
 * `SettingsSubPage` číta `/api/queue` aj `/api/status` tiež, ale cez
 * `settings/api.ts`, ktorý má INÉ typy a iné parsery (`QueueView` proti
 * `QueueSnapshot`). Zdieľať jeden objekt by znamenalo jeden z tých dvoch
 * parserov prepísať — teda meniť, čomu appka o stave verí, kvôli rozvrhu
 * obrazovky. Cena za samostatnosť je päť dotazov nad LOKÁLNOU databázou; na
 * shop z tejto cesty neodíde ani jeden request (K8).
 *
 * ČO SA TU NESMIE POKAZIŤ (nesie sa z hlavičky `StatusBand`)
 * ────────────────────────────────────────────────────────
 *  1. **PREKÁŽKY NIKDY NEIDÚ POD ROZKLIK.** `BlockersSection` stojí MIMO
 *     `StatusBand`, hneď pod ním. Bez kľúča na zápis je celý zvyšok appky
 *     dekorácia — grafy sú pravdivé a appka pritom nezapíše ani jednu zľavu.
 *     Zabaliť prekážku do `<details>` by z povinného čítania spravilo
 *     voliteľné, a to platí na Nastaveniach rovnako ako na Prehľade.
 *  2. **PÁS SA SÁM OTVORÍ, KEĎ NIE JE ZELENO.** Rozhoduje o tom `StatusBand`
 *     podľa verdiktu, takže sa to presunom nemení.
 *  3. **„Nežiadali sme" a „nevieme" sú dve rôzne vety.** Kým prvá odpoveď
 *     nedobehla, kreslí sa kostra — nie pás so samými pomlčkami. Pomlčka je
 *     tvrdenie o appke a to sa nesmie povedať o dátach, ktoré sa práve ťahajú.
 *
 * Vlastník: V7, krok 4/4 (presun stavu z Prehľadu).
 */
import { useCallback, useEffect, useState } from 'react';

import BlockersSection from '@/components/dashboard/BlockersSection';
import StatusBand from '@/components/dashboard/StatusBand';
import StatusSection from '@/components/dashboard/StatusSection';
import styles from '@/components/settings/settings-sections.module.css';
import { LoadingState } from '@/components/states';
import { getCampaigns, getQueue, type CampaignRow, type QueueSnapshot } from '@/components/dashboard/api';
import {
  getCatalogSync,
  getEnrichState,
  getStatus,
  type CatalogSyncView,
  type StatusView,
} from '@/components/dashboard/status-api';
import { unreadableSentence } from '@/components/dashboard/live-status-model';
import { calmNumbers, queueProgress } from '@/components/dashboard/overview-model';
import { overviewChecks, overviewVerdict } from '@/components/dashboard/overview-verdict';
import type { EnrichStatePayload } from '@/lib/catalog/enrich-view';
import { todayHere } from '@/lib/ui/vocabulary';

/** Kotva sekcie. Odkazuje na ňu tichý riadok Prehľadu aj rozcestník Nastavení. */
export const APP_STATE_ANCHOR = 'stav';

interface StateData {
  queue: QueueSnapshot | null;
  campaigns: CampaignRow[] | null;
  status: StatusView | null;
  catalog: CatalogSyncView | null;
  /** Stav DÁVKY obohacovania; `null` = odpoveď sa nedala prečítať. */
  enrich: EnrichStatePayload | null;
}

export function AppStateSection() {
  const [data, setData] = useState<StateData | null>(null);

  const load = useCallback(async () => {
    const [queue, campaigns, status, catalog, enrich] = await Promise.all([
      getQueue(),
      getCampaigns(),
      getStatus(),
      getCatalogSync(),
      getEnrichState(),
    ]);
    setData({ queue, campaigns, status, catalog, enrich });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    /*
     * Kotva `#stav` a odstup nad sekciou. `.section` z modulu nesie
     * `scroll-margin-top: 72px` — bez neho by kotva skočila pod prilepenú
     * hlavičku appky a človek by pristál na prázdnom mieste.
     */
    <div
      id={APP_STATE_ANCHOR}
      className={`${styles.section} ${styles.stateStack}`}
      data-testid="app-state-section"
    >
      {data === null ? (
        <LoadingState blocks={1} label="Načítavam stav appky…" />
      ) : (
        <StateBody data={data} onChanged={() => void load()} />
      )}
    </div>
  );
}

/**
 * Telo sekcie. Vlastný komponent preto, aby sa `data` nemuselo v každom výraze
 * znovu porovnávať s `null` — Turbopack tu už raz skrátený guard zahodil, takže
 * jedna vetva navrchu je bezpečnejšia než osem vnútri.
 */
function StateBody({ data, onChanged }: { data: StateData; onChanged: () => void }) {
  const today = todayHere();
  const snapshot = data.queue;
  const rows = data.campaigns;

  const progress = queueProgress({ snapshot, campaigns: rows, today });
  /*
   * Nečitateľný zoznam zliav je `null`, nie prázdne pole: `calmNumbers([])`
   * vráti samé nuly a „0 zliav beží" je tvrdenie o ostrom eshope, nie priznaná
   * medzera. Sekcia z `null` nakreslí pomlčky.
   */
  const calm = rows === null ? null : calmNumbers(rows, today);

  const verdictInput = {
    status: data.status,
    sync: data.catalog,
    heartbeat: snapshot === null ? null : snapshot.heartbeat,
    progress,
  };
  const verdict = overviewVerdict(verdictInput);

  const budget =
    snapshot === null || snapshot.budget === null
      ? null
      : {
          spent: snapshot.budget.spent,
          budget: snapshot.budget.budget,
          remaining: snapshot.budget.remaining,
        };

  return (
    <>
      <StatusBand
        verdict={verdict}
        keyPresent={data.status === null ? null : data.status.apiKey.present}
        budget={budget === null ? null : { spent: budget.spent, budget: budget.budget }}
        pending={snapshot === null ? null : snapshot.queue.pending}
      >
        <StatusSection
          verdict={verdict}
          checks={overviewChecks(verdictInput)}
          progress={progress}
          budget={budget}
          calm={calm}
          enrich={data.enrich}
          gap={
            data.status === null
              ? 'Stav appky sa nepodarilo prečítať. Čísla preto nedopĺňame.'
              : unreadableSentence(data.status.unreadable)
          }
          onChanged={onChanged}
        />
      </StatusBand>

      {/* Prekážky MIMO rozkliku — bod 1 hlavičky tohto súboru. */}
      <BlockersSection blockers={data.status === null ? null : data.status.blockers} />
    </>
  );
}

export default AppStateSection;
