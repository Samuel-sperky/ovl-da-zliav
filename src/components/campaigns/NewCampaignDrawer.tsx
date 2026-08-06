'use client';

/**
 * Aura Zľavy — drawer novej kampane (KISS, plán 33 §1 bod 7, §3, §5 C3).
 *
 * Nahrádza stránku /kampane/nova. DVOJKROKOVÝ tok sa drawerom NEMENÍ (I3):
 *   krok 1 (výber: sady produktov + allowlist + percento čipy + okno
 *   s presetmi a SK echom) → `POST /api/campaigns/preview` → krok 2
 *   (`DryRunTable` + `ConfirmPanel` so samostatným tlačidlom „Zapísať do
 *   PRODUKCIE", sudo rieši ConfirmPanel — D70). Žiadna cesta nezapisuje
 *   bez dry-run náhľadu a drawer žiadny krok neobchádza.
 *
 * Write-gate (B3 dokončenie, D10/D79): v režime len na čítanie je už
 * tlačidlo dry-runu vypnuté s dôvodom — používateľ sa dozvie o probléme
 * PRED vyplnením formulára, nie po ňom. Server zostáva fail-closed sám.
 *
 * `initial` predvypĺňa výber (duplikovanie kampane, akcie AI agenta) —
 * predvyplnenie je len pohodlie: prienik s allowlistom sa robí vždy a celý
 * tok vrátane potvrdení zostáva povinný.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AllowlistProduct,
  ApiError,
  PreviewResponse,
} from '@/components/campaigns/api';
import {
  getJson,
  postJson,
  todayDateOnly,
  validatePercent,
  validateWindow,
} from '@/components/campaigns/api';
import ConfirmPanel, { type ConfirmSubmit } from '@/components/campaigns/ConfirmPanel';
import DateRangePicker from '@/components/campaigns/DateRangePicker';
import DryRunTable from '@/components/campaigns/DryRunTable';
import PercentInput from '@/components/campaigns/PercentInput';
import {
  readLastSet,
  readNamedSets,
  saveNamedSet,
  writeLastSet,
  type ProductSet,
} from '@/components/campaigns/product-sets';
import { useWriteGate } from '@/components/campaigns/write-gate';
import Button from '@/components/ui/Button';
import Drawer from '@/components/ui/Drawer';
import ErrorMessage from '@/components/ui/ErrorMessage';
import SelfWriteBadge from '@/components/ui/SelfWriteBadge';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateSk, formatEur } from '@/lib/ui/format';

type Phase = 'draft' | 'previewing' | 'preview' | 'writing' | 'result';

interface ResultData {
  campaignId: number;
  status: string;
}

/** Predvyplnenie (duplikovanie kampane / akcia AI agenta) — len pohodlie. */
export interface NewCampaignPrefill {
  productIds?: number[];
  percent?: number | null;
  from?: string;
  to?: string;
}

export interface NewCampaignDrawerProps {
  open: boolean;
  onClose: () => void;
  prefill?: NewCampaignPrefill | null;
  /** Zavolá sa po ÚSPEŠNOM vytvorení kampane — volajúci si refetchne zoznam. */
  onCreated?: () => void;
  /** Vysvetľujúca veta pre používateľa (napr. zlyhané duplikovanie cez ?podla=). */
  notice?: string | null;
}

export function NewCampaignDrawer({
  open,
  onClose,
  prefill,
  onCreated,
  notice,
}: NewCampaignDrawerProps) {
  const gate = useWriteGate();
  const [phase, setPhase] = useState<Phase>('draft');
  const [allowlist, setAllowlist] = useState<AllowlistProduct[] | null>(null);
  const [eagerDefault, setEagerDefault] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [percent, setPercent] = useState<number | null>(null);
  const [from, setFrom] = useState(todayDateOnly());
  const [to, setTo] = useState('');
  const [overwriteIntent, setOverwriteIntent] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ResultData | null>(null);
  const [lastSet, setLastSet] = useState<ProductSet | null>(null);
  const [namedSets, setNamedSets] = useState<ProductSet[]>([]);
  const [setName, setSetName] = useState('');
  const [setNote, setSetNote] = useState<string | null>(null);
  // Aplikovaný prefill sa viaže na IDENTITU objektu — nový prefill (druhé
  // `?nova=1` v tom istom mounte) sa tak aplikuje tiež, starý sa neopakuje.
  const [appliedPrefill, setAppliedPrefill] = useState<NewCampaignPrefill | null>(null);
  const [allowlistFailed, setAllowlistFailed] = useState(false);
  // Generácia zavretia: odpoveď dry-runu rozbehnutého PRED zavretím sa zahodí.
  const closeGen = useRef(0);

  // Zlyhanie fetchu allowlistu NIE JE prázdny allowlist — drží sa samostatný
  // error stav s možnosťou opakovania, inak by sa poškodil prefill aj sady.
  const loadAllowlist = useCallback(() => {
    setAllowlist(null);
    setAllowlistFailed(false);
    void getJson<AllowlistProduct[]>('/api/allowlist').then((res) => {
      if (res.ok) {
        setAllowlist(res.data.filter((p) => p.slot != null));
      } else {
        setAllowlistFailed(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    loadAllowlist();
    void getJson<{ eagerWriteDefault: boolean }>('/api/settings').then((res) => {
      if (res.ok) setEagerDefault(res.data.eagerWriteDefault);
    });
    setLastSet(readLastSet());
    setNamedSets(readNamedSets());
  }, [open, loadAllowlist]);

  // Prefill sa aplikuje raz po načítaní allowlistu — VŽDY len prienik
  // s aktuálnym allowlistom (výber mimo allowlistu neexistuje, I2).
  useEffect(() => {
    if (!open || allowlist == null || !prefill || appliedPrefill === prefill) return;
    const allowed = new Set(allowlist.map((p) => p.productId));
    if (prefill.productIds && prefill.productIds.length > 0) {
      const usable = prefill.productIds.filter((id) => allowed.has(id));
      setSelected(usable);
      if (usable.length < prefill.productIds.length) {
        setSetNote(
          `${prefill.productIds.length - usable.length} z predvyplnených produktov už nie je v allowliste — vynechali sa.`,
        );
      }
    }
    if (prefill.percent != null && validatePercent(prefill.percent) === null) {
      setPercent(prefill.percent);
    }
    const today = todayDateOnly();
    if (prefill.from && prefill.to) {
      const f = prefill.from >= today ? prefill.from : today;
      const t = prefill.to >= f ? prefill.to : '';
      if (t && validateWindow(f, t) === null) {
        setFrom(f);
        setTo(t);
      }
    }
    setAppliedPrefill(prefill);
  }, [open, appliedPrefill, allowlist, prefill]);

  const selectedWithOwnWrite = useMemo(() => {
    if (!allowlist) return [];
    const today = todayDateOnly();
    return allowlist.filter(
      (p) => selected.includes(p.productId) && p.lastOwnWrite != null && p.lastOwnWrite.to >= today,
    );
  }, [allowlist, selected]);

  const percentError = percent == null ? 'Zadaj percento zľavy.' : validatePercent(percent);
  const windowError = !to ? 'Zadaj dátum DO.' : validateWindow(from, to);
  const selectionError =
    selected.length === 0
      ? 'Vyber aspoň jeden produkt.'
      : selected.length > 10
        ? 'Jedna operácia môže zapísať najviac 10 produktov.'
        : null;
  const localValid = !percentError && !windowError && !selectionError;

  function resetAll() {
    setPhase('draft');
    setSelected([]);
    setPercent(null);
    setFrom(todayDateOnly());
    setTo('');
    setOverwriteIntent(false);
    setPreview(null);
    setError(null);
    setResult(null);
    setSetName('');
    setSetNote(null);
    setAppliedPrefill(null);
  }

  function close() {
    // Počas zápisu sa drawer zavrieť NEDÁ — výsledok operácie musí byť vidieť.
    if (phase === 'writing') return;
    closeGen.current += 1;
    if (phase === 'result') {
      // Po výsledku začína ďalšie otvorenie odznova.
      resetAll();
    } else {
      // Preview token je jednorazový a expiruje — pri zavretí sa zahadzuje,
      // aby drawer nezamrzol v kroku 2 so spáleným tokenom. Rozrobený výber
      // (produkty/percento/dátumy) zostáva ako draft.
      setPhase('draft');
      setPreview(null);
      setError(null);
    }
    onClose();
  }

  function toggleProduct(productId: number) {
    setSelected((cur) =>
      cur.includes(productId) ? cur.filter((id) => id !== productId) : [...cur, productId],
    );
  }

  function applySet(set: ProductSet) {
    if (!allowlist) return;
    const allowed = new Set(allowlist.map((p) => p.productId));
    const usable = set.productIds.filter((id) => allowed.has(id));
    setSelected(usable);
    if (set.percent != null && validatePercent(set.percent) === null) setPercent(set.percent);
    setSetNote(
      usable.length < set.productIds.length
        ? `Sada „${set.name}": ${set.productIds.length - usable.length} produkt(ov) už nie je v allowliste — vynechali sa.`
        : null,
    );
  }

  function saveCurrentAsSet() {
    if (selected.length === 0 || setName.trim().length === 0) return;
    setNamedSets(saveNamedSet({ name: setName, productIds: [...selected], percent }));
    setSetName('');
  }

  async function startDryRun() {
    // Lokálna validácia VŽDY pred serverom (I9).
    if (!localValid || percent == null || !gate.canWrite) return;
    setError(null);
    setPhase('previewing');
    const gen = closeGen.current;
    const res = await postJson<PreviewResponse>('/api/campaigns/preview', {
      productIds: [...selected].sort((a, b) => a - b),
      percent,
      from,
      to,
      kind: overwriteIntent || selectedWithOwnWrite.length > 0 ? 'overwrite' : 'new',
      // D30 — jednodňové okno: dry-run sa smie zobraziť, inak by bol tok slepý.
      // ZÁVÄZNÉ potvrdenie sa tým NEOBCHÁDZA: `POST /api/campaigns` ho vyžaduje
      // v `acknowledgements.oneDay` ešte pred spálením preview tokenu (I3, D30).
      ...(from === to ? { oneDayAcknowledged: true } : {}),
    });
    // Drawer sa medzitým zavrel — odpoveď (aj token) sa zahadzuje.
    if (gen !== closeGen.current) return;
    if (res.ok) {
      setPreview(res.data);
      setPhase('preview');
    } else {
      setError(res.error);
      setPhase('draft');
    }
  }

  async function confirm(submit: ConfirmSubmit) {
    // In-flight guard: kým beží zápis, druhé potvrdenie sa nespustí.
    if (phase === 'writing') return;
    if (!preview || percent == null) return;
    setError(null);
    setPhase('writing');
    const res = await postJson<ResultData>('/api/campaigns', {
      previewToken: preview.previewToken,
      name: submit.name,
      mode: submit.mode,
      acknowledgements: submit.acknowledgements,
    });
    if (res.ok) {
      writeLastSet({ productIds: [...selected], percent });
      setLastSet(readLastSet());
      setResult(res.data);
      setPhase('result');
      onCreated?.();
    } else {
      setError(res.error);
      setPhase('preview');
    }
  }

  const step2 = preview != null && (phase === 'preview' || phase === 'writing');
  const subtitle =
    phase === 'result'
      ? 'Hotovo'
      : step2
        ? 'Krok 2 z 2 — dry-run náhľad a potvrdenie'
        : 'Krok 1 z 2 — výber produktov, percenta a okna';

  return (
    <Drawer
      open={open}
      onClose={close}
      title="Nová kampaň"
      subtitle={subtitle}
      testId="new-campaign-drawer"
      footer={
        !step2 && phase !== 'result' ? (
          <>
            <Button onClick={close} disabled={phase === 'previewing'}>
              Zrušiť
            </Button>
            <Button
              variant="primary"
              disabled={!localValid || phase === 'previewing' || gate.loading || !gate.canWrite}
              disabledReason={
                gate.reason ??
                selectionError ??
                percentError ??
                windowError ??
                undefined
              }
              onClick={() => void startDryRun()}
            >
              {phase === 'previewing' ? 'Pripravuje sa dry-run…' : 'Pokračovať na dry-run →'}
            </Button>
          </>
        ) : undefined
      }
    >
      {/* ── výsledok ── */}
      {phase === 'result' && result ? (
        <section className="ovl-stack" style={{ gap: '0.75rem' }} data-testid="wizard-result">
          <h3 style={{ margin: 0 }}>Kampaň vytvorená</h3>
          <p style={{ margin: 0 }}>
            Kampaň <strong>#{result.campaignId}</strong> má stav{' '}
            <StatusBadge status={result.status as never} />.
          </p>
          <p className="ovl-small ovl-muted" style={{ margin: 0 }}>
            Skutočný stav zľavy v shope sa cez API nedá overiť — zobrazujeme len vlastné zápisy.
          </p>
          <div className="ovl-row" style={{ gap: '0.5rem' }}>
            <a className="ovl-btn ovl-btn--primary" href={`/kampane/${result.campaignId}`}>
              Otvoriť detail kampane
            </a>
            <Button onClick={close}>Zavrieť</Button>
          </div>
        </section>
      ) : null}

      {/* ── krok 2: dry-run + potvrdenie ── */}
      {step2 && preview && percent != null ? (
        <div className="ovl-stack" style={{ gap: '1rem' }} data-testid="wizard-step2">
          <DryRunTable
            items={preview.items}
            warnings={preview.warnings}
            blockers={preview.blockers}
            percent={percent}
            from={from}
            to={to}
          />
          {preview.blockers.length === 0 ? (
            <ConfirmPanel
              items={preview.items}
              warnings={preview.warnings}
              percent={percent}
              from={from}
              to={to}
              defaultName={`Zľava −${percent} % (${formatDateSk(from)} – ${formatDateSk(to)})`}
              eagerDefault={eagerDefault}
              submitting={phase === 'writing'}
              error={error ? { message: error.message, rawCode: error.code } : null}
              onConfirm={confirm}
              onBack={() => {
                setPreview(null);
                setError(null);
                setPhase('draft');
              }}
            />
          ) : (
            <Button
              onClick={() => {
                setPreview(null);
                setPhase('draft');
              }}
            >
              ← Späť na úpravu
            </Button>
          )}
        </div>
      ) : null}

      {/* ── krok 1: výber ── */}
      {!step2 && phase !== 'result' ? (
        <div className="ovl-stack" style={{ gap: '1.25rem' }} data-testid="wizard-step1">
          {notice ? (
            <p className="ovl-small" role="status" style={{ margin: 0 }} data-testid="prefill-notice">
              {notice}
            </p>
          ) : null}
          <section className="ovl-stack" style={{ gap: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>1. Produkty (len allowlist, max 10)</h3>

            {(lastSet && lastSet.productIds.length > 0) || namedSets.length > 0 ? (
              <div className="ovl-row" style={{ gap: '0.35rem', flexWrap: 'wrap' }} data-testid="product-sets">
                {lastSet && lastSet.productIds.length > 0 ? (
                  <button
                    type="button"
                    className="ovl-chip"
                    onClick={() => applySet(lastSet)}
                    data-testid="apply-last-set"
                  >
                    ↺ posledná sada ({lastSet.productIds.length})
                  </button>
                ) : null}
                {namedSets.map((set) => (
                  <button
                    key={set.name}
                    type="button"
                    className="ovl-chip"
                    onClick={() => applySet(set)}
                  >
                    {set.name} ({set.productIds.length})
                  </button>
                ))}
              </div>
            ) : null}
            {setNote ? (
              <p className="ovl-small ovl-muted" style={{ margin: 0 }} data-testid="set-note">
                {setNote}
              </p>
            ) : null}

            {allowlistFailed ? (
              <div className="ovl-stack" style={{ gap: '0.4rem' }}>
                <p className="ovl-error ovl-small" role="alert" style={{ margin: 0 }} data-testid="allowlist-error">
                  Allowlist sa nepodarilo načítať — výber produktov zatiaľ nie je k dispozícii.
                </p>
                <div>
                  <Button small onClick={loadAllowlist} data-testid="allowlist-retry">
                    Skúsiť znova
                  </Button>
                </div>
              </div>
            ) : allowlist == null ? (
              <div className="ovl-skeleton" style={{ minHeight: '4rem' }} aria-busy="true" />
            ) : allowlist.length === 0 ? (
              <p className="ovl-muted" style={{ margin: 0 }}>
                Allowlist je prázdny — najprv pridaj produkty v sekcii <a href="/produkty">Produkty</a>.
              </p>
            ) : (
              <div className="ovl-stack" style={{ gap: '0.4rem' }}>
                {allowlist.map((p) => (
                  <label
                    key={p.productId}
                    className="ovl-row ovl-small"
                    style={{ gap: '0.5rem', alignItems: 'baseline' }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(p.productId)}
                      onChange={() => toggleProduct(p.productId)}
                      data-testid={`product-${p.productId}`}
                    />
                    <span>
                      {p.name ?? p.label ?? 'bez názvu'}{' '}
                      <span className="ovl-muted">
                        #{p.productId} · {formatEur(p.price)}
                      </span>
                    </span>
                    <SelfWriteBadge
                      writtenAt={p.lastOwnWrite?.at ?? null}
                      detail={
                        p.lastOwnWrite
                          ? `−${p.lastOwnWrite.percent} % · ${formatDateSk(p.lastOwnWrite.from)} – ${formatDateSk(p.lastOwnWrite.to)}`
                          : undefined
                      }
                    />
                  </label>
                ))}
              </div>
            )}

            {selected.length > 0 ? (
              <div className="ovl-row" style={{ gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  className="ovl-input--sm"
                  placeholder="Uložiť výber ako sadu…"
                  maxLength={60}
                  value={setName}
                  onChange={(e) => setSetName(e.target.value)}
                  data-testid="set-name-input"
                />
                <Button small disabled={setName.trim().length === 0} onClick={saveCurrentAsSet}>
                  Uložiť sadu
                </Button>
              </div>
            ) : null}

            {selectionError && selected.length > 0 ? (
              <p className="ovl-error ovl-small" role="alert" style={{ margin: 0 }}>
                {selectionError}
              </p>
            ) : null}
            {selectedWithOwnWrite.length > 0 ? (
              <p className="ovl-small" style={{ margin: 0 }} data-testid="overwrite-hint">
                ⚠ {selectedWithOwnWrite.length}{' '}
                {selectedWithOwnWrite.length === 1 ? 'vybraný produkt má' : 'vybrané produkty majú'}{' '}
                podľa vlastnej DB bežiacu alebo naplánovanú zľavu — kampaň pôjde ako explicitné{' '}
                <strong>prepísanie</strong> s diffom starý → nový v potvrdení.
              </p>
            ) : (
              <label className="ovl-small">
                <input
                  type="checkbox"
                  checked={overwriteIntent}
                  onChange={(e) => setOverwriteIntent(e.target.checked)}
                />{' '}
                Vedome prepisujem prípadnú existujúcu zľavu
              </label>
            )}
          </section>

          <section className="ovl-stack" style={{ gap: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>2. Percento</h3>
            <PercentInput value={percent} onChange={setPercent} />
          </section>

          <section className="ovl-stack" style={{ gap: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>3. Okno platnosti</h3>
            <DateRangePicker
              from={from}
              to={to}
              onChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }}
            />
          </section>

          {error ? <ErrorMessage message={error.message} rawCode={error.code} /> : null}

          <p className="ovl-small ovl-muted" style={{ margin: 0 }}>
            Zápis do produkcie je vždy dvojkrokový: najprv dry-run náhľad, až potom samostatné
            tlačidlo „Zapísať do PRODUKCIE".
          </p>
        </div>
      ) : null}
    </Drawer>
  );
}

export default NewCampaignDrawer;
