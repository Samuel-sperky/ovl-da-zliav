'use client';

/**
 * Aura Zľavy — ŽIVÝ STAV FRONTY V DETAILE ZĽAVY (kontrakt dokončenia B5, B6,
 * C1, C2; kontrakt V3 K2, K5, D45).
 *
 * Zľava na 150 produktov beží takmer celý deň, väčšia niekoľko dní. Používateľ
 * sa počas toho nesmie musieť pýtať „a čo teraz" ani otvárať log. Panel preto
 * odpovedá na štyri otázky, ktoré si vyžadujú RÔZNY ďalší krok:
 *
 *   1. **Kde to je** — koľko je zapísaných, koľko čaká, koľko sa nepodarilo a
 *      koľko je NEISTÝCH.
 *   2. **Koľko rozpočtu ostáva** a kedy sa obnoví.
 *   3. **Čo bude zajtra** — odhad dobehnutia.
 *   4. **Prečo to práve teraz stojí**, ak stojí — a čo s tým.
 *
 * NEISTÉ NIE JE ZLYHANÉ — A JE TO NAJDÔLEŽITEJŠIA VEC NA TEJTO OBRAZOVKE
 * ---------------------------------------------------------------------
 * „Nepodarilo sa" znamená, že shop zápis odmietol alebo neodpovedal — produkt
 * určite nie je zlacnený a rieši sa to zopakovaním. „Nevieme, či sa zapísalo"
 * znamená, že zápis odišiel a odpoveď nedorazila — produkt zlacnený BYŤ MÔŽE.
 * Sú to dva rôzne ďalšie kroky (pri druhom sa treba najprv pozrieť do eshopu),
 * takže sa v tomto paneli NIKDY nesčítajú do jedného čísla. Kto ich zlúči,
 * pošle používateľa opravovať niečo, čo je v poriadku.
 *
 * ČO SA TU EŠTE NESMIE POKAZIŤ
 * ----------------------------
 *  · **Nula sa nekreslí z neznalosti.** Keď sa stav fronty nedá prečítať, panel
 *    to povie vetou; prázdna fronta a nečitateľná fronta vyzerajú inak (P7).
 *  · **Vyčerpaný rozpočet nie je chyba.** Merací prúžok má pri plnom stropu
 *    jantárový, nie červený tón — appka len počká do obnovy (K2).
 *  · **Dôvod zastavenia sa neskladá tu.** Vety nesú prekážky z
 *    `lib/status/blockers.ts` a `queueStandSentence()`; tento súbor ich kreslí.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import BlockerList from '@/components/campaigns/BlockerList';
import styles from '@/components/campaigns/zlavy.module.css';
import {
  alarmingCards,
  dayCount,
  queueStandSentence,
  resetPhrase,
  type QueueSnapshotView,
} from '@/components/campaigns/queue-model';
import { fetchQueue } from '@/components/campaigns/zlavy-api';
import BudgetMeter from '@/components/ui/BudgetMeter';
import Note from '@/components/ui/Note';
import StatTile from '@/components/ui/StatTile';
import StatusPill from '@/components/ui/StatusPill';
import { formatDateSk } from '@/lib/ui/format';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/** Ako často sa stav fronty obnovuje. Endpoint je lacný a čisto čítací. */
const POLL_MS = 30_000;

export interface QueueLiveCampaign {
  readonly id: number;
  readonly itemsTotal: number;
  readonly itemsOk: number;
  readonly itemsFailed: number;
  readonly itemsUncertain: number;
  readonly itemsPending: number;
}

export interface QueueLiveProps {
  campaign: QueueLiveCampaign;
  testId?: string;
}

export function QueueLive({ campaign, testId }: QueueLiveProps) {
  const [snapshot, setSnapshot] = useState<QueueSnapshotView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchQueue();
    if (res.ok) {
      setSnapshot(res.data);
      setFailed(null);
      return;
    }
    // Nečitateľná fronta NIE JE prázdna fronta — nula je tvrdenie (P7).
    setSnapshot(null);
    setFailed(res.error.message);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const stand = snapshot === null ? null : queueStandSentence(snapshot.standing.reason);
  const writing = snapshot !== null && snapshot.standing.writing;
  const alarming = snapshot === null ? [] : alarmingCards(snapshot.standing.blockers);
  const budget = snapshot === null ? null : snapshot.budget;
  const estimate = snapshot === null ? null : snapshot.estimate;
  const current = snapshot === null ? null : snapshot.current;
  const otherAhead = current !== null && current.campaignId !== campaign.id;
  const uncertainGroup = snapshot === null ? null : snapshot.attention.uncertain;

  return (
    <section className="sec" data-testid={testId ?? 'detail-queue'}>
      <div className="sec-h">
        <h2>Fronta naživo</h2>
        <div className="act">
          {snapshot === null ? (
            <StatusPill tone="idle" label="Stav fronty nepoznáme" testId="queue-live-pill" />
          ) : (
            <StatusPill
              tone={writing ? 'progress' : 'idle'}
              label={writing ? 'Zapisuje sa' : 'Fronta teraz nezapisuje'}
              live
              testId="queue-live-pill"
            />
          )}
        </div>
      </div>

      {failed === null ? null : (
        <Note variant="err" testId="queue-live-error">
          Stav fronty sa nepodarilo prečítať: {failed} Čísla nižšie sú z poslednej odpovede o tejto
          zľave, nie zo živej fronty.
        </Note>
      )}

      <div className="kpis">
        <StatTile
          label="Zapísané"
          value={formatCountSk(campaign.itemsOk)}
          detail={`z ${formatCountSk(campaign.itemsTotal)} produktov tejto zľavy`}
          testId="tile-ok"
        />
        <StatTile
          label="Čaká na zápis"
          value={formatCountSk(campaign.itemsPending)}
          detail={
            campaign.itemsPending === 0
              ? 'fronta má túto zľavu vybavenú'
              : 'fronta na ne ešte nedošla'
          }
          testId="tile-pending"
        />
        <StatTile
          label="Nepodarilo sa"
          value={formatCountSk(campaign.itemsFailed)}
          detail={
            campaign.itemsFailed === 0
              ? 'nič sa nepokazilo'
              : 'tieto produkty zlacnené nie sú — dajú sa zopakovať'
          }
          testId="tile-failed"
        />
        <StatTile
          label="Nevieme, či sa zapísalo"
          value={formatCountSk(campaign.itemsUncertain)}
          detail={
            campaign.itemsUncertain === 0
              ? 'každý zápis dostal odpoveď'
              : 'zápis odišiel, odpoveď nedorazila — najprv sa pozrite do eshopu'
          }
          testId="tile-uncertain"
        />
      </div>

      {campaign.itemsUncertain === 0 ? null : (
        <div className={styles.startNote}>
          <Note variant="warn" testId="queue-uncertain-note">
            {uncertainGroup === null || uncertainGroup.what === ''
              ? 'Pri týchto produktoch zápis odišiel, ale odpoveď nedorazila — appka nevie potvrdiť, že zľava naozaj platí.'
              : uncertainGroup.what}{' '}
            {uncertainGroup === null || uncertainGroup.nextStep === ''
              ? 'Pozrite sa na ne priamo v eshope. Ak zľava neplatí, spustite nižšie zopakovanie — appka pošle ten istý zápis ešte raz a ak tam zľava už je, druhýkrát ju nepíše.'
              : uncertainGroup.nextStep}
          </Note>
        </div>
      )}

      <div className={styles.liveGrid}>
        <div>
          {budget === null ? (
            <div className="lvl-3">Dnešný rozpočet zápisov sa nepodarilo prečítať.</div>
          ) : (
            <BudgetMeter
              label="Zápisy dnes"
              spent={budget.spent}
              limit={budget.budget}
              resetsAt={snapshot === null ? null : resetPhrase(snapshot.limits.nextResetAt)}
              large
              testId="queue-live-budget"
            />
          )}
        </div>
        <div className={styles.liveNext}>
          <div className="lvl-3">Čo bude ďalej</div>
          <div>
            {estimate === null ? (
              <span className="lvl-3">Odhad dobehnutia zatiaľ nevieme.</span>
            ) : estimate.days === 0 ? (
              <>
                Celá fronta by mala dobehnúť <b className="est">ešte dnes</b>.
              </>
            ) : (
              <>
                Celá fronta pobeží ešte <b>{dayCount(estimate.days)}</b>, hotová by mala byť{' '}
                <b className="est">{formatDateSk(estimate.date)}</b>.
              </>
            )}
          </div>
          {budget === null ? null : (
            <div className="lvl-3">
              Dnes ostáva {formatCountSk(budget.remaining)}{' '}
              {pluralSk(budget.remaining, 'zápis', 'zápisy', 'zápisov')} z{' '}
              {formatCountSk(budget.budget)}
              {budget.exhausted ? ' — zvyšok pokračuje po obnove rozpočtu.' : '.'}
            </div>
          )}
        </div>
      </div>

      {otherAhead && current !== null ? (
        <div className={styles.aheadLine} data-testid="queue-live-ahead">
          Rozpočet zápisov sa delí — teraz je na rade zľava{' '}
          <Link href={`/zlavy/${current.campaignId}`}>{current.name}</Link>, ktorej ešte chýba{' '}
          <b>{formatCountSk(current.itemsPending)}</b>{' '}
          {pluralSk(current.itemsPending, 'produkt', 'produkty', 'produktov')}.
        </div>
      ) : null}

      {writing || stand === null ? null : (
        <div className={styles.startNote}>
          <Note
            variant={stand.tone === 'critical' ? 'err' : stand.tone === 'idle' ? 'info' : 'warn'}
            testId="queue-live-stand"
          >
            {stand.what} {stand.nextStep}
            {stand.path === null ? null : (
              <>
                {' '}
                <Link href={stand.path}>Otvoriť</Link>
              </>
            )}
          </Note>
        </div>
      )}

      {alarming.length === 0 ? null : (
        <div className="gap-t">
          <BlockerList
            cards={alarming}
            title="Čo bráni zápisu"
            testId="queue-live-blockers"
          />
        </div>
      )}

      <div className="fresh">
        Stav podľa vlastných zápisov appky, obnovuje sa sám každú polminútu.
      </div>
    </section>
  );
}

export default QueueLive;
