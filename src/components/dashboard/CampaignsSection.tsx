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
 * ČO PRIBUDLO 28. 8. 2026 (V4, kontrakt §2 bod 6)
 * -----------------------------------------------
 * Dva fakty pod stĺpcami: **najbližší plánovaný zápis** a **posledný výsledok
 * zápisu**. Obidva odpovedajú na otázku, ktorú „čo beží" nezodpovedá — či appka
 * do shopu naozaj píše. Zľava môže pokojne „bežať" a fronta pritom stáť.
 *
 * Nie sú to vety o príčine (P8): je tam čas a sú tam počty, záver si robí
 * človek. A `null` v oboch znamená „NEVIDÍME nič", nie „nič nie je" —
 * najbližší zápis sa hľadá len v okne prepínača a aktivita len v prečítaných
 * dňoch.
 *
 * Vlastník: V9; dva fakty pod stĺpcami V4.
 */
import Link from 'next/link';

import StateLine from '@/components/dashboard/StateLine';
import styles from '@/components/dashboard/overview.module.css';
import type { InsightRow } from '@/components/dashboard/api';
import type { LastWrite, LiveCampaign, NextFire } from '@/components/dashboard/overview-model';
import { FlagMark } from '@/components/ui/StatusMark';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';
import { formatDateSk, formatDateTimeSk } from '@/lib/ui/format';
import { NEVIEME } from '@/lib/ui/product-label';

export interface CampaignsSectionProps {
  /** Bežiace a pripravené zľavy; `null` = nepodarilo sa načítať. */
  campaigns: LiveCampaign[] | null;
  /** Zistenia zo servera; `null` = nepodarilo sa načítať. */
  insights: InsightRow[] | null;
  /**
   * Najbližší plánovaný zápis v okne prepínača. `null` = žiadny NEVIDÍME;
   * `undefined` = obrazovka o to nežiadala a riadok sa nekreslí vôbec.
   */
  nextFire?: NextFire | null;
  /** Posledný deň, v ktorom appka naozaj niečo zapisovala. `null` = žiadny. */
  lastWrite?: LastWrite | null;
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
          {formatDateSk(item.row.dateFrom)} – {formatDateSk(item.row.dateTo)}
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
        <span className="flag">
          <FlagMark />
          {row.text}
        </span>
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

/**
 * Chvost riadku o poslednom zápise — po jednom údaji za každý zmeraný počet.
 *
 * TROJSTAVOVOSŤ JE TU CELÝ ZMYSEL (I11, 31. 8. 2026). Každý zo štyroch počtov
 * môže byť HODNOTA, alebo `null`, čo znamená „appka to pole neprečítala".
 * Kým bol nečitateľný počet nula, karta o produkčných zápisoch tvrdila
 * „0 sa nepodarilo" tichým vynechaním údaja — a to je poloprávda, ktorá
 * vyzerá lepšie než skutočnosť. Neprečítaný počet sa preto PÍŠE, nie vynecháva;
 * vynechať sa smie len zmeraná nula.
 *
 * `null` znamená, že sa nedal prečítať ANI JEDEN zo štyroch počtov — vtedy sa
 * o výsledku nedá povedať nič a priznanie patrí do hlavičky riadku, nie za bodku.
 */
function writeTail(lastWrite: LastWrite): string[] | null {
  const { ok, failed, uncertain, skipped } = lastWrite;
  if (ok === null && failed === null && uncertain === null && skipped === null) return null;

  const tail: string[] = [];
  tail.push(ok === null ? 'nevieme, koľko sa zlacnilo' : `${formatCountSk(ok)} zlacnených`);
  if (failed === null) tail.push('nevieme, koľko sa nepodarilo');
  else if (failed > 0) tail.push(`${formatCountSk(failed)} sa nepodarilo`);
  if (uncertain === null) tail.push('nevieme, pri koľkých je zápis neistý');
  else if (uncertain > 0) tail.push(`${formatCountSk(uncertain)} nevieme, či sa zapísalo`);
  if (skipped === null) tail.push('nevieme, koľko sa preskočilo');
  else if (skipped > 0) tail.push(`${formatCountSk(skipped)} preskočených`);
  return tail;
}

/**
 * Dva fakty o ZÁPISE pod stĺpcami zliav.
 *
 * Prečo je posledný výsledok zápisu na Prehľade a nie len v Histórii: „zľava
 * beží" je tvrdenie o okne dátumov, nie o tom, že sa niečo zapísalo. Bez tohto
 * riadku sa tie dve veci na prístrojovej doske nedali rozlíšiť.
 *
 * Nepodarené a neisté položky sú v tom istom riadku ako úspešné a NIE pod
 * rozklikom: „zapísalo sa 240" bez „12 sa nepodarilo" je poloprávda, ktorá
 * vyzerá lepšie než skutočnosť.
 */
function WriteFacts({
  nextFire,
  lastWrite,
}: {
  nextFire: NextFire | null | undefined;
  lastWrite: LastWrite | null | undefined;
}) {
  if (nextFire === undefined && lastWrite === undefined) return null;

  const parts: string[] = [];

  if (nextFire !== undefined) {
    parts.push(
      nextFire === null
        ? `Najbližší plánovaný zápis ${NEVIEME} — v tomto okne žiadny nevidíme`
        : `Najbližší plánovaný zápis ${formatDateTimeSk(nextFire.fireAt)} · ${nextFire.name} (−${nextFire.percent} %)`,
    );
  }

  if (lastWrite !== undefined) {
    if (lastWrite === null) {
      parts.push('Posledný zápis do shopu — v prečítaných dňoch ani jeden');
    } else {
      const tail = writeTail(lastWrite);
      parts.push(
        tail === null
          ? `Posledný zápis ${NEVIEME} — najnovší deň (${formatDateSk(lastWrite.day)}) sa nepodarilo prečítať`
          : `Posledný zápis ${formatDateSk(lastWrite.day)} · ${tail.join(' · ')}`,
      );
    }
  }

  return (
    <div className="fresh" data-testid="campaigns-write-facts">
      {parts.join(' — ')}
    </div>
  );
}

export function CampaignsSection({
  campaigns,
  insights,
  nextFire,
  lastWrite,
}: CampaignsSectionProps) {
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

          `styles.liveCol` nesie priestor pre presah podfarbenia riadkov: bez
          neho `.campRow` so záporným okrajom `0 -8px` vylezie 8 px von zo
          stĺpca a snímkovač to hlási ako pretekanie aj ako tri presahy.
        */}
        {firstRun ? null : (
          <div className={styles.liveCol} data-testid="overview-live">
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
          {/*
            Riadok „Marža a obrátkovosť zamknuté" tu bol do 19. 8. 2026 a odišiel
            z dvoch dôvodov naraz: nie je to NÁVRH, hoci stál v stĺpci NÁVRHY,
            a tú istú vetu hovorí ľavý panel Produktov aj Nastavenia. Bol to
            zároveň posledný výskyt emoji v celej appke.
          */}
        </div>
      </div>

      <WriteFacts nextFire={nextFire} lastWrite={lastWrite} />
    </section>
  );
}

export default CampaignsSection;
