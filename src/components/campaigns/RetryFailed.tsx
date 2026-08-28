'use client';

/**
 * Aura Zľavy — ZOPAKOVANIE TOHO, ČO SA NEPODARILO (kontrakt dokončenia B7;
 * kontrakt V3 K4, K10, invarianty I3, I7, rozhodnutia D15, D16, D36, D45).
 *
 * PREČO TENTO PANEL VZNIKOL
 * -------------------------
 * Zopakovanie na serveri existovalo, ale z obrazovky sa nedalo použiť: jediné
 * volanie, ktoré niečo robí, si vyžaduje čerstvé potvrdenie, a bez neho vracalo
 * odmietnutie bez vysvetlenia. Používateľ tak videl len to, že sa nič nestalo.
 * Panel ide preto opačným poradím: najprv POVIE, čo by sa zopakovalo a prečo si
 * to vyžiada nové potvrdenie, a až potom ponúkne cestu.
 *
 * TRI KROKY, KTORÉ SA NEDAJÚ PRESKOČIŤ
 * ------------------------------------
 *  1. **Popis** (čisto čítacie) — sada produktov, jej rozpad a okno opravnej
 *     zľavy. Nič sa nezapisuje, žiadne potvrdenie sa nevydáva.
 *  2. **Skúška naprázdno** nad zúženou sadou — jediné miesto, odkiaľ pochádza
 *     jednorazové potvrdenie zápisu (I3).
 *  3. **Zaradenie** s tým potvrdením. Do 27. 8. 2026 k nemu patrilo aj heslo
 *     (sudo, D70); sudo zrušilo D100 a I3 znie odteraz „žiadny zápis bez
 *     dry-runu + potvrdenia" — čerstvá skúška naprázdno teda zostáva povinná.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Potvrdenie musí sedieť na PRÁVE ZOBRAZENÚ sadu.** Keď sa popis medzitým
 *    zmení (fronta zatiaľ niečo dopísala), staré potvrdenie sa zahodí a skúška
 *    sa musí zopakovať. Je to tá istá poistka ako pri novej zľave a platí bez
 *    výnimky (I3).
 * 2. **Neisté sa neschová medzi zlyhané** (D45). Panel obe skupiny vypisuje
 *    zvlášť a hovorí, že pri neistých sa najprv treba pozrieť do eshopu —
 *    zopakovanie je bezpečné (rovnaký zápis, a keď tam zľava už je, appka ju
 *    druhýkrát nepíše), ale používateľ má vedieť, čo robí.
 * 3. **Opravná zľava nič neruší** (I7). Vzniká NOVÁ zľava s tými istými
 *    percentami a tým istým oknom; zapísané zľavy v shope zostávajú.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import styles from '@/components/campaigns/zlavy.module.css';
import {
  RETRY_WHY_FRESH,
  previewBlockerText,
  productCount,
  type RetryPlanView,
} from '@/components/campaigns/queue-model';
import {
  previewDiscount,
  retryFailed,
  retryPlan,
  type PreviewData,
} from '@/components/campaigns/zlavy-api';
import Note from '@/components/ui/Note';
import { FlagMark } from '@/components/ui/StatusMark';
import { formatDateSk } from '@/lib/ui/format';
import { formatCountSk } from '@/lib/ui/vocabulary';

type Busy = 'idle' | 'loading' | 'previewing' | 'creating';

/**
 * Odtlačok sady, na ktorú potvrdenie platí. Keď sa zmení čokoľvek z nej,
 * potvrdenie prestáva platiť — presne ako pri novej zľave (I3).
 */
function planSignature(plan: RetryPlanView): string {
  return `${plan.percent}|${plan.window.from}|${plan.window.to}|${plan.productIds.join(',')}`;
}

export interface RetryFailedProps {
  campaignId: number;
  /** Zavolá sa po úspešnom zaradení opravnej zľavy — detail sa má prekresliť. */
  onCreated?: () => void;
  testId?: string;
}

export function RetryFailed({ campaignId, onCreated, testId }: RetryFailedProps) {
  const [plan, setPlan] = useState<RetryPlanView | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>('loading');

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewSig, setPreviewSig] = useState<string | null>(null);
  const [oneDayAck, setOneDayAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);


  const load = useCallback(async () => {
    setBusy('loading');
    const res = await retryPlan(campaignId);
    setBusy('idle');
    if (!res.ok) {
      setPlan(null);
      setPlanError(res.error.message);
      return;
    }
    setPlan(res.data);
    setPlanError(null);
    // Popis sa mohol zmeniť — staré potvrdenie na novú sadu neplatí (I3).
    setPreview(null);
    setPreviewSig(null);
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (planError !== null) {
    return (
      <section className="sec" data-testid={testId ?? 'detail-retry'}>
        <div className="sec-h">
          <h2>Zopakovať to, čo sa nepodarilo</h2>
        </div>
        <Note variant="err" testId="retry-plan-error">
          Nepodarilo sa zistiť, čo by sa dalo zopakovať: {planError}
        </Note>
        <div className="row gap-t">
          <button type="button" className="btn sm" onClick={() => void load()}>
            Skúsiť znova
          </button>
        </div>
      </section>
    );
  }

  if (plan === null) {
    return (
      <section className="sec" data-testid={testId ?? 'detail-retry'}>
        <div className={styles.busy}>Zisťujem, čo by sa dalo zopakovať…</div>
      </section>
    );
  }

  const signature = planSignature(plan);
  const previewFresh =
    preview !== null && previewSig === signature && preview.previewToken !== '';
  const oneDayWindow = plan.window.from !== '' && plan.window.from === plan.window.to;
  const previewBlockers = preview === null ? [] : preview.blockers;

  async function runPreview(current: RetryPlanView, sig: string): Promise<void> {
    setBusy('previewing');
    setError(null);
    const res = await previewDiscount({
      productIds: current.productIds,
      percent: current.percent,
      from: current.window.from,
      to: current.window.to,
      kind: 'retry',
      parentCampaignId: current.campaignId,
      ...(current.window.from === current.window.to ? { oneDayAcknowledged: true } : {}),
    });
    setBusy('idle');
    if (!res.ok) {
      setPreview(null);
      setPreviewSig(null);
      setError(res.error.message);
      return;
    }
    setPreview(res.data);
    setPreviewSig(sig);
  }

  async function doRetry(token: string): Promise<void> {
    setBusy('creating');
    setError(null);
    const res = await retryFailed(campaignId, token);
    setBusy('idle');
    if (!res.ok) {
      // Potvrdenie je jednorazové — po neúspechu sa skúška musí zopakovať (I3).
      setPreview(null);
      setPreviewSig(null);
      setError(res.error.message);
      return;
    }
    setCreatedId(res.data.campaignId);
    onCreated?.();
  }

  function onConfirm(): void {
    if (preview === null || preview.previewToken === '') return;
    // Do 27. 8. 2026 tu stálo overenie sudo okna (D70). Čerstvý náhľad
    // a potvrdenie zostávajú — tie držia I3, nie heslo.
    void doRetry(preview.previewToken);
  }

  if (createdId !== null) {
    return (
      <section className="sec" data-testid={testId ?? 'detail-retry'}>
        <div className="sec-h">
          <h2>Oprava je vo fronte</h2>
        </div>
        <div className="lvl-2">
          Založili sme novú zľavu s {productCount(plan.productIds.length)}, ktoré neprešli. Pôvodná
          zľava sa nemení a zapísané zľavy v eshope zostávajú.
        </div>
        <div className="row gap-t">
          <Link className="btn primary" href={`/zlavy/${createdId}`}>
            Otvoriť opravu
          </Link>
          <Link className="btn" href="/zlavy">
            Zoznam zliav
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="sec" data-testid={testId ?? 'detail-retry'}>
      <div className="sec-h">
        <h2>Zopakovať to, čo sa nepodarilo</h2>
        <div className="act">
          <button
            type="button"
            className="btn sm ghost"
            disabled={busy !== 'idle'}
            onClick={() => void load()}
            data-testid="retry-refresh"
          >
            Prepočítať
          </button>
        </div>
      </div>

      <div className="lvl-2" data-testid="retry-what">
        {plan.what}
      </div>
      <div className="hint">{plan.nextStep}</div>

      {plan.possible ? (
        <>
          <div className={styles.retryNumbers}>
            <div>
              <div className="lvl-3">Zopakuje sa</div>
              <div className={styles.scopeBig} data-testid="retry-count">
                {formatCountSk(plan.items.retryable)}
              </div>
            </div>
            <div>
              <div className="lvl-3">Určite sa nezapísalo</div>
              <div className={styles.scopeBig}>{formatCountSk(plan.items.notWritten)}</div>
            </div>
            <div>
              <div className="lvl-3">Nevieme, či sa zapísalo</div>
              <div className={styles.scopeBig} data-testid="retry-uncertain">
                {formatCountSk(plan.items.uncertain)}
              </div>
            </div>
            <div>
              <div className="lvl-3">Fronta na ne nedošla</div>
              <div className={styles.scopeBig}>{formatCountSk(plan.items.pending)}</div>
            </div>
          </div>

          <div className="prog-meta">
            <span>
              Zľava <b>{plan.percent} %</b>
            </span>
            <span className="sep-dot" aria-hidden="true">
              ·
            </span>
            <span>
              okno{' '}
              <b>
                {formatDateSk(plan.window.from)} – {formatDateSk(plan.window.to)}
              </b>
            </span>
            <span className="sep-dot" aria-hidden="true">
              ·
            </span>
            <span className="lvl-3">rovnaké percento aj okno ako pôvodná zľava</span>
          </div>

          {plan.items.uncertain === 0 ? null : (
            <div className={styles.startNote}>
              <Note variant="warn" testId="retry-uncertain-note">
                {formatCountSk(plan.items.uncertain)} z nich je takých, pri ktorých zápis odišiel a
                odpoveď nedorazila. Pozrite sa na ne najprv v eshope. Zopakovanie je aj tak
                bezpečné: appka pošle ten istý zápis ešte raz a ak tam zľava už je, druhýkrát ju
                nepíše.
              </Note>
            </div>
          )}

          {oneDayWindow ? (
            <label className={styles.retryAck}>
              <input
                type="checkbox"
                className="cb"
                checked={oneDayAck}
                onChange={(event) => setOneDayAck(event.target.checked)}
                data-testid="retry-one-day"
              />
              <span>
                Okno opravy je jediný deň ({formatDateSk(plan.window.from)}). Potvrdzujem, že to tak
                má byť.
              </span>
            </label>
          ) : null}

          <div className={styles.startNote}>
            <Note variant="info" testId="retry-why-fresh">
              {RETRY_WHY_FRESH}
            </Note>
          </div>

          <div className={styles.acts}>
            <button
              type="button"
              className={previewFresh ? 'btn primary' : 'btn primary off'}
              disabled={!previewFresh || busy === 'creating'}
              onClick={onConfirm}
              data-testid="retry-confirm"
            >
              {busy === 'creating' ? 'Zaraďujem…' : 'Potvrdiť a zaradiť opravu'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy !== 'idle' || (oneDayWindow && !oneDayAck)}
              onClick={() => void runPreview(plan, signature)}
              data-testid="retry-preview"
            >
              {busy === 'previewing' ? 'Počítam…' : 'Skúška naprázdno'}
            </button>
          </div>

          {previewFresh ? null : (
            <div className={styles.noteQuiet} data-testid="retry-blocked-reason">
              {preview === null
                ? 'Najprv spustite skúšku naprázdno — bez nej sa zaradiť nedá.'
                : 'Sada sa medzitým zmenila. Spustite skúšku naprázdno znova.'}
            </div>
          )}

          {error === null ? null : (
            <div className={styles.note} role="alert" data-testid="retry-error">
              {error}
            </div>
          )}

          {previewBlockers.length === 0 ? null : (
            <div className="gap-t" data-testid="retry-preview-blockers">
              {previewBlockers.map((blocker, index) => (
                <div key={`${blocker.code}-${index}`} className="row wrapx">
                  <span className="flag">
                    <FlagMark />
                    {previewBlockerText(blocker.code, blocker.message)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

    </section>
  );
}

export default RetryFailed;
