'use client';

/**
 * Aura Zľavy — DETAIL ZĽAVY (V11; predloha `design/v3/zlava-detail.html`,
 * architektúra §1 TAB 3, kontrakt V3 K2, K3, K5, K10, invarianty I7, I11).
 *
 * Tri sekcie a jeden rozklik:
 *
 *   1. **Priebeh fronty** — dominanta (P1). Koľko z koľkých, dokedy to potrvá,
 *      kedy zľava svieti zákazníkom a čo sa nepodarilo (s ľudským dôvodom).
 *   2. **Pásma** — podľa čoho ktorý produkt zlacnel a o koľko (K3).
 *   3. **Položky** — súhrn a len problémové riadky. Osemtisíc riadkov nikto
 *      neprečíta a appka ich sem ani nesťahuje (odpoveď 56).
 *
 *   + **Technický detail** (P6): kódy shopu, počty pokusov, čísla produktov
 *     a audit stopa. Na povrchu nič z toho nie je.
 *
 * Čo detail NIKDY nerobí: netvrdí, že pozná stav zľavy v shope (I11) a
 * neponúka zrušenie už zapísanej zľavy — zastaviť sa dá len to, čo ešte
 * nebolo zapísané (I7, D35).
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import DiscountState from '@/components/campaigns/DiscountState';
import styles from '@/components/campaigns/zlavy.module.css';
import { progressPercent, sentenceOf } from '@/components/campaigns/discounts-model';
import {
  getDiscount,
  stopDiscountQueue,
  type DiscountDetailData,
  type DiscountItemView,
} from '@/components/campaigns/zlavy-api';
import { formatDateSk, formatDateTimeSk, formatEur } from '@/lib/ui/format';
import { formatCountSk, itemSentence, pluralSk } from '@/lib/ui/vocabulary';

/** Koľko položiek si vypýtame. Detail nie je export katalógu (odpoveď 56). */
const ITEMS_LIMIT = 1000;

/** Koľko problémových riadkov sa vypíše; zvyšok je číslo, nie zoznam. */
const PROBLEM_ROWS = 20;

/** Stavy, ktoré sú v poriadku alebo sa ešte len chystajú — tie sa nevypisujú. */
const QUIET_STATUSES = new Set(['ok', 'pending', 'skipped']);

function isProblem(item: DiscountItemView): boolean {
  if (!QUIET_STATUSES.has(item.status)) return true;
  // D39c — rozhodovalo sa nad inou cenou. Nie je to chyba zápisu, ale
  // zamlčať sa to nesmie.
  return item.priceMismatch;
}

function Dot() {
  return (
    <span className="sep-dot" aria-hidden="true">
      ·
    </span>
  );
}

/** Zastavenie fronty — dva kroky. Zapísané zľavy v shope zostávajú (I7). */
function StopQueue({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await stopDiscountQueue(id, 'Zastavené v detaile zľavy');
    setBusy(false);
    if (res.ok) {
      setNote(null);
      onChanged();
      return;
    }
    setNote(res.error.message);
  }

  return (
    <details className="stopq" data-testid="detail-stop">
      <summary className="btn lg">Zastaviť frontu</summary>
      <div className="stopq-b">
        <span>Zapísané zostanú. Zrušiť sa nedajú.</span>
        <button
          type="button"
          className="btn sm danger"
          disabled={busy}
          onClick={() => void run()}
          data-testid="detail-stop-confirm"
        >
          Áno, zastaviť
        </button>
      </div>
      {note === null ? null : <div className={styles.note}>{note}</div>}
    </details>
  );
}

export function DiscountDetail({ id }: { id: number }) {
  const [data, setData] = useState<DiscountDetailData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getDiscount(id, ITEMS_LIMIT);
    setLoading(false);
    if (res.ok) {
      setData(res.data);
      setFailed(null);
      return;
    }
    setData(null);
    setFailed(res.error.message);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed !== null) {
    return (
      <section className="sec" data-testid="detail-error">
        <div className="empty">
          <div className="t">Zľavu sa nepodarilo načítať</div>
          <div>{failed}</div>
          <div className="a">
            <button type="button" className="btn" onClick={() => void load()}>
              Skúsiť znova
            </button>
            <Link className="btn" href="/zlavy">
              Späť na zoznam
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (data === null) {
    return (
      <section className="sec">
        <div className={styles.busy}>{loading ? 'Načítavam zľavu…' : 'Zľava nie je k dispozícii.'}</div>
      </section>
    );
  }

  const campaign = data.campaign;
  const done = campaign.itemsOk + campaign.itemsFailed + campaign.itemsUncertain;
  const sentence = sentenceOf(campaign);
  const problems = data.items.filter(isProblem);
  const shown = problems.slice(0, PROBLEM_ROWS);
  const scanned = data.items.length;

  return (
    <div className={styles.page} data-testid="discount-detail">
      <div className={styles.dhead}>
        <Link className="lvl-3" href="/zlavy">
          ← Zľavy
        </Link>
        <h1>{campaign.name}</h1>
        <DiscountState sentence={sentence} testId="detail-state" />
      </div>

      {/* 1 · DOMINANTA — priebeh fronty a čo sa nepodarilo */}
      <section className="sec" data-testid="detail-progress">
        <div className={`${styles.top} ${styles.topStart}`}>
          <div>
            <div className="prog-lg">
              <div className="n num" data-testid="detail-number">
                {formatCountSk(done)}{' '}
                <span className="of">/ {formatCountSk(campaign.itemsTotal)}</span>
              </div>
              <div className="side lvl-3">
                zapísaných {formatCountSk(campaign.itemsOk)}
                {campaign.itemsFailed === 0
                  ? ''
                  : ` · ${formatCountSk(campaign.itemsFailed)} sa nepodarilo`}
                {campaign.itemsUncertain === 0
                  ? ''
                  : ` · ${formatCountSk(campaign.itemsUncertain)} nevieme, či sa zapísalo`}
              </div>
            </div>

            <div className="bar" aria-hidden="true">
              <i style={{ width: `${progressPercent(done, campaign.itemsTotal).toFixed(2)}%` }} />
            </div>

            <div className="prog-meta">
              {data.estimate === null ? (
                <span className="lvl-3">Odhad dokončenia zatiaľ nevieme</span>
              ) : (
                <span>
                  Hotové <b className="est">{formatDateSk(data.estimate.date)}</b>
                </span>
              )}
              <Dot />
              <span>
                zľava svieti{' '}
                <b>
                  {formatDateSk(campaign.dateFrom)} – {formatDateSk(campaign.dateTo)}
                </b>
              </span>
              <Dot />
              <span>
                ostáva zapísať <b>{formatCountSk(campaign.itemsPending)}</b>
              </span>
            </div>

            <div className="fresh">Stav podľa vlastných zápisov appky</div>

            {problems.length === 0 ? null : (
              <details className="tech" data-testid="detail-problems">
                <summary>
                  {formatCountSk(problems.length)} sa nepodarilo — pozrieť
                </summary>
                <div className="body">
                  <table>
                    <tbody>
                      {shown.map((item) => (
                        <tr key={item.id}>
                          <td>{item.nameAtWrite ?? 'bez názvu'}</td>
                          <td>
                            <b>{itemSentence(item.status).reason}</b>
                          </td>
                        </tr>
                      ))}
                      {problems.length > shown.length ? (
                        <tr>
                          <td>a ďalších {formatCountSk(problems.length - shown.length)}</td>
                          <td />
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                  <details className="tech bare" style={{ marginTop: '8px' }}>
                    <summary>Technický detail</summary>
                    <div className="body mono">
                      {shown.map((item) => (
                        <div key={`raw-${item.id}`}>
                          {item.productId} → {item.status}
                          {item.httpStatus === null ? '' : ` · ${item.httpStatus}`}
                          {item.errorCode === null ? '' : ` · ${item.errorCode}`}
                          {` · ${item.attemptCount}×`}
                          {item.finishedAt === null ? '' : ` · ${formatDateTimeSk(item.finishedAt)}`}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </details>
            )}
          </div>

          <div className={styles.side}>
            {campaign.itemsPending > 0 ? (
              <StopQueue id={campaign.id} onChanged={() => void load()} />
            ) : null}
            <Link className="btn" href="/zlavy">
              Späť na zoznam
            </Link>
          </div>
        </div>
      </section>

      {/* 2 · Pásma */}
      <section className="sec" data-testid="detail-tiers">
        <div className="sec-h">
          <h2>Pásma</h2>
          <div className="act lvl-3">
            Dopad na maržu <span className="lockline">odomkne sa po doplnení nákupných cien</span>
          </div>
        </div>
        {data.tiers.length === 0 ? (
          <div className="lvl-3">
            Jedno percento pre celý výber: <b>{campaign.percent} %</b>
          </div>
        ) : (
          <table className={styles.tiersRead}>
            <thead>
              <tr>
                <th>Pásmo</th>
                <th>Pravidlo</th>
                <th className="n">Produktov</th>
                <th className="n">Zľava</th>
              </tr>
            </thead>
            <tbody>
              {data.tiers.map((tier) => (
                <tr key={tier.ord}>
                  <td>
                    <b className="lvl-2">{tier.ord}</b>
                  </td>
                  <td>{tier.label}</td>
                  <td className="n num">{formatCountSk(tier.itemsCount)}</td>
                  <td className="n num">
                    <b className="lvl-2">{tier.percent} %</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 3 · Položky — súhrn a len problémové riadky */}
      <section className="sec" data-testid="detail-items">
        <div className="sec-h">
          <h2>Položky</h2>
          <div className="act lvl-3">
            {formatCountSk(campaign.itemsTotal)} celkom · {formatCountSk(campaign.itemsOk)}{' '}
            zapísaných · {formatCountSk(campaign.itemsPending)} čaká ·{' '}
            {formatCountSk(campaign.itemsFailed)} sa nepodarilo
          </div>
        </div>

        <div className="tbl-frame">
          <table className="tbl">
            <thead>
              <tr>
                <th>Názov</th>
                <th className="n">Cena pri príprave</th>
                <th className="n">Zľava</th>
                <th>Zapísané</th>
                <th>Poznámka</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td className="name lvl-3">Zatiaľ sa nič nepokazilo.</td>
                  <td className="n">—</td>
                  <td className="n">—</td>
                  <td>—</td>
                  <td>—</td>
                </tr>
              ) : (
                shown.map((item) => {
                  const say = itemSentence(item.status);
                  return (
                    <tr key={item.id}>
                      <td className="name">{item.nameAtWrite ?? 'bez názvu'}</td>
                      <td className="n" data-l="Cena">
                        {formatEur(item.priceAtPreview)}
                      </td>
                      <td className="n" data-l="Zľava">
                        {item.percent === undefined ? `${campaign.percent} %` : `${item.percent} %`}
                      </td>
                      <td data-l="Zapísané">
                        <span className={item.status === 'ok' ? 'sig ok' : 'sig warn'}>
                          {say.label}
                        </span>
                      </td>
                      <td data-l="Poznámka">
                        {item.priceMismatch ? 'Cena sa medzitým zmenila' : say.reason}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <div className="tbl-foot">
            <span>
              Zobrazujeme len to, čo sa nepodarilo alebo je podozrivé
              {scanned < campaign.itemsTotal
                ? ` — prezreli sme prvých ${formatCountSk(scanned)} z ${formatCountSk(campaign.itemsTotal)}`
                : ''}
              . Ak niekto zmení percentá v administrácii shopu, nevieme o tom.
            </span>
          </div>
        </div>

        <details className="tech" data-testid="detail-audit">
          <summary>
            Technický detail — posledných {formatCountSk(Math.min(8, data.auditTrail.length))}{' '}
            {pluralSk(Math.min(8, data.auditTrail.length), 'záznam', 'záznamy', 'záznamov')}
          </summary>
          <div className="body">
            <table>
              <tbody>
                {data.auditTrail.slice(0, 8).map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTimeSk(row.ts)}</td>
                    <td>
                      <b>{row.message ?? row.eventType}</b>
                    </td>
                  </tr>
                ))}
                {data.auditTrail.length === 0 ? (
                  <tr>
                    <td>—</td>
                    <td>zatiaľ žiadny záznam</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <div style={{ marginTop: '6px' }}>
              <Link href="/nastavenia#historia">Celá história v Nastaveniach</Link>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}

export default DiscountDetail;
