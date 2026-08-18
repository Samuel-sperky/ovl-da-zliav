'use client';

/**
 * Aura Zľavy — SEKCIA PREHĽADU: „Zľavy" (V9, architektúra §1 TAB 1, kontrakt
 * UI 13. 8. 2026).
 *
 * PREČO SÚ TO DVE BÝVALÉ SEKCIE V JEDNEJ
 * --------------------------------------
 * Do 18. 8. mal Prehľad zvlášť „Zľavy naživo" (čo beží) a zvlášť „Čaká na vás"
 * (čo by sa dalo zlacniť). Sú to však dva pohľady na tú istú vec — na zľavy —
 * a P5 dovoľuje štyri sekcie. Zlúčili sa preto do dvoch stĺpcov: vľavo čo
 * BEŽÍ, vpravo čo sa PONÚKA. Nič sa nestratilo, ubudol jeden nadpis a jeden
 * rám.
 *
 * TVRDÁ HRANICA: toto NIE JE zoznam produktov a nikdy ním nebude. Prehľad
 * odpovedá na „čo sa práve deje", konkrétne kusy patria do Produktov. Preto tu
 * nie je tabuľka a riadok zľavy je preklik, nie ovládací panel.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Vety návrhov skladá server.** Obrazovka si žiadnu nedopisuje a už vôbec
 *    nie vetu o príčine — „zľava priniesla +18 %" je presne to, čo P8 zakazuje.
 * 2. **Zamknutá funkcia je vidieť, ale nevysvetľuje sa tu.** Riadok so zámkom
 *    vedie do Nastavení, kde má vysvetlenie jediné miesto
 *    (`settings/LockedFeatures.tsx`) a rozširovať sa nesmie.
 * 3. **Riadok zľavy nesmie prerásť šírku stĺpca.** Preto vlastná dvojriadková
 *    geometria (`overview.module.css`), nie široká `.zrow` zo zoznamu zliav —
 *    tá má šesť pevných stĺpcov a na polovici monitora by tlačila obrazovku do
 *    vodorovného skrolu (kontrakt UI, bod 12).
 *
 * Vlastník: V9.
 */
import Link from 'next/link';

import StateLine from '@/components/dashboard/StateLine';
import styles from '@/components/dashboard/overview.module.css';
import type { InsightRow } from '@/components/dashboard/api';
import type { LiveCampaign } from '@/components/dashboard/overview-model';
import { dayMonthSk, formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface CampaignsSectionProps {
  /** Bežiace a pripravené zľavy; `null` = nepodarilo sa načítať. */
  campaigns: LiveCampaign[] | null;
  /** Zistenia zo servera; `null` = nepodarilo sa načítať. */
  insights: InsightRow[] | null;
}

/** Koľko riadkov sa do stĺpca zmestí, kým sekcia neprerastie obrazovku (P4). */
const MAX_ROWS = 3;

/** Pravý koniec riadku zľavy — pri zapisovaní pruh, inak vlastné zápisy. */
function Trailing({ item }: { item: LiveCampaign }) {
  if (item.writing) {
    return (
      <span className="prog-sm">
        <span className="bar" aria-hidden="true">
          <i style={{ width: `${item.percent.toFixed(2)}%` }} />
        </span>
        <span className="n num">
          {formatCountSk(item.row.itemsTotal - item.row.itemsPending)}/
          {formatCountSk(item.row.itemsTotal)}
        </span>
      </span>
    );
  }
  if (item.row.itemsOk === 0) {
    return <span className="lvl-3">zatiaľ nezapísané</span>;
  }
  return (
    <span className="lvl-3">
      zlacnených <b>{formatCountSk(item.row.itemsOk)}</b>
    </span>
  );
}

function CampaignRow({ item }: { item: LiveCampaign }) {
  return (
    <Link
      href={`/zlavy/${item.row.id}`}
      className={
        item.sentence.state === 'skončila'
          ? `${styles.campRow} ${styles.campDone}`
          : styles.campRow
      }
      data-testid="live-row"
    >
      <span className={styles.campName}>{item.row.name}</span>
      <span className="lvl-2">{item.percentLabel}</span>
      <span className={styles.campMeta}>
        <StateLine sentence={item.sentence} />
        <span className="sep-dot" aria-hidden="true">
          ·
        </span>
        <span className="lvl-3">
          {formatCountSk(item.row.itemsTotal)}{' '}
          {pluralSk(item.row.itemsTotal, 'produkt', 'produkty', 'produktov')}
        </span>
        <span className="sep-dot" aria-hidden="true">
          ·
        </span>
        <span className="lvl-3">
          {dayMonthSk(item.row.dateFrom)} – {dayMonthSk(item.row.dateTo)}
        </span>
        <span className="sep-dot" aria-hidden="true">
          ·
        </span>
        <Trailing item={item} />
      </span>
    </Link>
  );
}

function InsightLine({ row }: { row: InsightRow }) {
  const action = row.action;
  return (
    <div className="suggest">
      {row.tone === 'attention' ? (
        <span className="flag">{row.text}</span>
      ) : (
        <span>{row.text}</span>
      )}
      {action === null ? (
        <Link className="btn sm" href={row.href}>
          Otvoriť
        </Link>
      ) : (
        <Link className="btn sm" href={action.href}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function CampaignsSection({ campaigns, insights }: CampaignsSectionProps) {
  // Prázdne pole znamená „appka nemá ani jednu zľavu"; `null` znamená „zoznam
  // sa nepodarilo prečítať". Sú to dve rôzne veci a nesmú splynúť.
  const firstRun = campaigns !== null && campaigns.length === 0;

  // Pozornosť pred návrhom: zlyhaná položka je fakt, návrh je len ponuka.
  const rows = [
    ...(insights ?? []).filter((row) => row.tone === 'attention'),
    ...(insights ?? []).filter((row) => row.tone === 'info'),
  ].slice(0, MAX_ROWS);

  return (
    <section className="sec" data-testid="overview-campaigns">
      <div className="sec-h">
        <h2>Zľavy</h2>
        <div className="act">
          <Link className="btn sm" href="/zlavy">
            Zoznam zliav
          </Link>
        </div>
      </div>

      <div className={firstRun ? styles.midSingle : styles.mid}>
        {/*
          Keď v appke ešte NIE JE ani jedna zľava, ľavý stĺpec sa nekreslí:
          „Zatiaľ nie je žiadna zľava" už povedala dominanta a druhá kópia tej
          istej vety na jednej obrazovke je šum. Návrhy sú vtedy najpotrebnejšie
          a dostanú celú šírku.
        */}
        {firstRun ? null : (
          <div data-testid="overview-live">
            <div className={`${styles.colh} lvl-3`}>Beží teraz</div>
            {campaigns === null ? (
              <div className="suggest">
                <span className="lvl-3">Zoznam zliav sa nepodarilo načítať.</span>
              </div>
            ) : (
              campaigns.map((item) => <CampaignRow key={item.row.id} item={item} />)
            )}
          </div>
        )}

        <div data-testid="overview-suggestions">
          <div className={`${styles.colh} lvl-3`}>Návrhy</div>
          {rows.length === 0 ? (
            <div className="suggest">
              <span className="lvl-3">
                {insights === null
                  ? 'Návrhy sa nepodarilo načítať.'
                  : 'Zatiaľ žiadny návrh. Ležiaky sú v Produktoch.'}
              </span>
            </div>
          ) : (
            rows.map((row) => <InsightLine key={row.id} row={row} />)
          )}
          <div className="suggest">
            <span className="sig lock">Marža a obrátkovosť zamknuté</span>
            <Link className="btn sm" href="/nastavenia">
              Nastavenia
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default CampaignsSection;
