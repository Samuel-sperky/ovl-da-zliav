'use client';

/**
 * Aura Zľavy — `/onboarding` (A16, §8, D20).
 *
 * Checklist v pevnom poradí: 1. doména → 2. kľúč → 3. allowlist →
 * 4. TESTOVACÍ DRY-RUN. Kroky sa odomykajú postupne a onboarding sa
 * NIKDY nekončí ostrým zápisom — posledný krok len ukáže, čo by appka
 * zapísala, a na tejto stránke neexistuje žiadne tlačidlo, ktoré by zapisovalo
 * do shopu (D20, I3). Ostrý zápis je výhradne cesta `/kampane/nova`.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import AddProductForm from '@/components/products/AddProductForm';
import AllowlistTable from '@/components/products/AllowlistTable';
import { getAllowlist, type AllowlistRow } from '@/components/products/api';
import ApiKeyForm from '@/components/settings/ApiKeyForm';
import DomainForm from '@/components/settings/DomainForm';
import {
  getKeyMeta,
  getSettings,
  type KeyMetaView,
  type SettingsView,
} from '@/components/settings/api';
import DateRangePicker from '@/components/campaigns/DateRangePicker';
import DryRunTable from '@/components/campaigns/DryRunTable';
import PercentInput from '@/components/campaigns/PercentInput';
import {
  addDays,
  postJson,
  todayDateOnly,
  validatePercent,
  validateWindow,
  type PreviewResponse,
} from '@/components/campaigns/api';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';

type StepState = 'pending' | 'done' | 'error';

function StepHeader({
  index,
  title,
  state,
  locked,
}: {
  index: number;
  title: string;
  state: StepState;
  locked: boolean;
}) {
  const badge =
    state === 'done'
      ? { label: 'hotové', tone: 'ok' }
      : state === 'error'
        ? { label: 'chyba', tone: 'danger' }
        : locked
          ? { label: 'zamknuté', tone: 'neutral' }
          : { label: 'čaká', tone: 'warning' };
  return (
    <div className="ovl-spread">
      <h2>
        {index}. {title}
      </h2>
      <span className={`ovl-badge ovl-badge--${badge.tone}`} data-testid={`step-${index}-state`}>
        {badge.label}
      </span>
    </div>
  );
}

export default function OnboardingPage() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [keyMeta, setKeyMeta] = useState<KeyMetaView | null>(null);
  const [allowlist, setAllowlist] = useState<AllowlistRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* krok 4 — testovací dry-run */
  const [selected, setSelected] = useState<number[]>([]);
  const [percent, setPercent] = useState<number | null>(10);
  const [from, setFrom] = useState(todayDateOnly());
  const [to, setTo] = useState(addDays(todayDateOnly(), 6));
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRawCode, setPreviewRawCode] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, k, a] = await Promise.all([getSettings(), getKeyMeta(), getAllowlist()]);
    if (s.ok) {
      setSettings(s.data);
      setLoadError(null);
    } else {
      setSettings(null);
      setLoadError(s.error.message);
    }
    setKeyMeta(k.ok ? k.data : null);
    setAllowlist(a.ok ? a.data : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const step1Done = Boolean(settings?.shopDomain);
  const step2Done = Boolean(keyMeta?.present);
  const step3Done = allowlist.length > 0;
  const step4Done = preview !== null;

  async function runDryRun() {
    setPreviewRawCode(null);
    setPreview(null);
    // Lokálna validácia PRED odoslaním (I9) — nikdy sa nespoliehame na 400.
    if (selected.length === 0) {
      setPreviewError('Vyber aspoň jeden produkt z allowlistu.');
      return;
    }
    const percentError = validatePercent(percent);
    if (percentError) {
      setPreviewError(percentError);
      return;
    }
    const windowError = validateWindow(from, to);
    if (windowError) {
      setPreviewError(windowError);
      return;
    }
    setPreviewError(null);
    setPreviewBusy(true);
    const res = await postJson<PreviewResponse>('/api/campaigns/preview', {
      productIds: selected,
      percent,
      from,
      to,
      kind: 'new',
    });
    setPreviewBusy(false);
    if (!res.ok) {
      setPreviewError(res.error.message);
      setPreviewRawCode(res.error.code);
      return;
    }
    setPreview(res.data);
  }

  if (loadError) {
    return <ErrorMessage message={`Onboarding sa nepodarilo načítať. ${loadError}`} />;
  }

  return (
    <div className="ovl-stack" style={{ gap: '1rem' }} data-testid="onboarding">
      <div>
        <h1 style={{ fontSize: '1.3rem', margin: '0 0 0.35rem' }}>Prvé spustenie</h1>
        <p className="ovl-small ovl-muted" style={{ margin: 0 }}>
          Štyri kroky v pevnom poradí. Posledný krok je <strong>testovací dry-run</strong> —
          onboarding do shopu nič nezapíše. Ostrý zápis sa robí až v sekcii Kampane a vždy
          po samostatnom potvrdení.
        </p>
      </div>

      {/* 1 — doména */}
      <section className="ovl-card" data-testid="onboarding-step-1">
        <StepHeader index={1} title="Doména shopu" state={step1Done ? 'done' : 'pending'} locked={false} />
        <DomainForm
          shopDomain={settings?.shopDomain ?? null}
          domainConfirmedAt={settings?.domainConfirmedAt ?? null}
          onSaved={() => void load()}
        />
      </section>

      {/* 2 — kľúč */}
      <section className="ovl-card" data-testid="onboarding-step-2">
        <StepHeader
          index={2}
          title="API kľúč"
          state={step2Done ? 'done' : 'pending'}
          locked={!step1Done}
        />
        {!step1Done ? (
          <p className="ovl-small ovl-muted">
            Najprv potvrď doménu shopu — bez nej appka nemá kam poslať sondu kľúča.
          </p>
        ) : (
          <ApiKeyForm keyMeta={keyMeta} onStored={() => void load()} />
        )}
      </section>

      {/* 3 — allowlist */}
      <section className="ovl-card" data-testid="onboarding-step-3">
        <StepHeader
          index={3}
          title="Allowlist produktov (max 10)"
          state={step3Done ? 'done' : 'pending'}
          locked={!step2Done}
        />
        {!step2Done ? (
          <p className="ovl-small ovl-muted">
            Najprv vlož API kľúč — bez neho sa názvy a ceny produktov nedajú načítať.
          </p>
        ) : (
          <div className="ovl-stack">
            <AllowlistTable rows={allowlist} onChanged={() => void load()} />
            <AddProductForm currentCount={allowlist.length} onAdded={() => void load()} />
          </div>
        )}
      </section>

      {/* 4 — testovací dry-run (KONIEC onboardingu, žiadny zápis) */}
      <section className="ovl-card" data-testid="onboarding-step-4">
        <StepHeader
          index={4}
          title="Testovací dry-run"
          state={step4Done ? 'done' : 'pending'}
          locked={!step3Done}
        />
        {!step3Done ? (
          <p className="ovl-small ovl-muted">
            Najprv pridaj aspoň jeden produkt do allowlistu.
          </p>
        ) : (
          <div className="ovl-stack">
            <p className="ovl-small">
              Dry-run ukáže, čo by appka zapísala — do shopu nepošle nič. Onboarding
              sa tu končí zámerne: prvý ostrý zápis urobíš vedome v sekcii Kampane.
            </p>
            <fieldset className="ovl-stack" style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="ovl-small">Produkty (len z allowlistu)</legend>
              {allowlist.map((p) => (
                <label key={p.productId} className="ovl-small">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.productId)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked
                          ? [...prev, p.productId]
                          : prev.filter((id) => id !== p.productId),
                      )
                    }
                    data-testid={`onboarding-product-${p.productId}`}
                  />{' '}
                  {p.name ?? p.label ?? `Produkt #${p.productId}`}{' '}
                  <span className="ovl-muted">#{p.productId}</span>
                </label>
              ))}
            </fieldset>
            <PercentInput value={percent} onChange={setPercent} />
            <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
            <div className="ovl-row">
              <Button
                variant="primary"
                onClick={() => void runDryRun()}
                disabled={previewBusy}
                data-testid="onboarding-dry-run"
              >
                {previewBusy ? 'Počítam dry-run…' : 'Spustiť testovací dry-run'}
              </Button>
            </div>
            {previewError ? (
              <ErrorMessage message={previewError} rawCode={previewRawCode} />
            ) : null}
            {preview ? (
              <div className="ovl-stack" data-testid="onboarding-dry-run-result">
                <DryRunTable
                  items={preview.items}
                  warnings={preview.warnings}
                  blockers={preview.blockers}
                  percent={percent ?? 0}
                  from={from}
                  to={to}
                />
                <p className="ovl-badge ovl-badge--ok" data-testid="onboarding-done">
                  Dry-run prešiel — onboarding je hotový a do shopu sa nezapísalo nič.
                </p>
                <p className="ovl-small">
                  Keď budeš chcieť zľavu naozaj zapísať, prejdi na{' '}
                  <Link href="/kampane/nova">vytvorenie kampane</Link>: tam ťa čaká
                  nový dry-run a samostatné potvrdenie zápisu.
                </p>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
