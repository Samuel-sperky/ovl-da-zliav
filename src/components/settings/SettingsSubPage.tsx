'use client';

/**
 * Aura Zľavy — PODSTRÁNKA NASTAVENÍ (kontrakt UI 13. 8. 2026, body 13 a 14).
 *
 * Jedna podstránka = jedna otázka. Sekcie sa nezmenili ani o čiarku — zmenil sa
 * rám: namiesto dvanástich blokov na jednej 4,7-obrazovkovej stránke sú štyri
 * krátke stránky, z ktorých každá sa zmestí pod pravidlo P4.
 *
 * PREČO SÚ VŠETKY PODSTRÁNKY V JEDNOM KOMPONENTE
 * ----------------------------------------------
 * Načítanie dát je pre ne spoločné a vetvenie je jediné miesto, kde sa
 * rozhoduje, čo na ktorej podstránke stojí. Päť samostatných komponentov by
 * znamenalo päť kópií toho istého `Promise.all` a päť príležitostí, aby sa
 * jedna z nich rozišla so zvyškom.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Sťahuje sa len to, čo stránka naozaj kreslí.** „Čo appka vie" je
 *     statická tabuľka — nemá dôvod volať päť koncových bodov.
 *  2. **Kotvy (`id`) na sekciách zostávajú.** Sú to ciele odkazov z celej
 *     appky; `sub-pages.ts` na ne prekladá staré `/nastavenia#…`.
 *  3. **Červená zóna je za rozklikom.** Otvorená pri vstupe by z mazania
 *     kľúčov spravila vec na dosah omylom mierenej myši.
 *  4. **Pád jedného zdroja nezhodí stránku.** Sekcia, ktorej údaj chýba,
 *     to prizná sama.
 *
 * Vlastník: V12.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import AuditPanel from '@/components/audit/AuditPanel';
import BudgetSection from '@/components/settings/BudgetSection';
import DiagnosticsSection from '@/components/settings/DiagnosticsSection';
import DomainForm from '@/components/settings/DomainForm';
import FeatureIndex from '@/components/settings/FeatureIndex';
import KeysSection from '@/components/settings/KeysSection';
import LockedFeatures from '@/components/settings/LockedFeatures';
import PanicButton from '@/components/settings/PanicButton';
import SafeguardsSection from '@/components/settings/SafeguardsSection';
import ScopeModeForm from '@/components/settings/ScopeModeForm';
import SignOut from '@/components/settings/SignOut';
import WritesSection from '@/components/settings/WritesSection';
import { SETTINGS_CSS } from '@/components/settings/styles';
import {
  pageBySlug,
  subPagePath,
  type SettingsPage,
  type SettingsPageSlug,
} from '@/components/settings/sub-pages';
import ActionFailurePanel from '@/components/ui/ActionFailure';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import {
  getCatalog,
  getKeyMeta,
  getOrdersKeyMeta,
  getQueue,
  getSettings,
  getStatus,
  type CatalogView,
  type KeyMetaView,
  type QueueView,
  type SettingsView,
  type StatusPayload,
} from '@/components/settings/api';

/** Čo ktorá podstránka potrebuje prečítať. Prázdne = nič sa nesťahuje. */
export const PAGE_NEEDS: Readonly<Record<SettingsPageSlug, readonly ('settings' | 'keys' | 'queue')[]>> =
  {
    'co-vie': [],
    napojenie: ['settings', 'keys'],
    'co-smie': ['settings', 'queue'],
    historia: ['settings'],
    'cervena-zona': ['keys'],
  };

export interface SettingsSubPageProps {
  readonly slug: SettingsPageSlug;
}

export function SettingsSubPage({ slug }: SettingsSubPageProps) {
  const page = pageBySlug(slug);
  const needs = PAGE_NEEDS[slug];

  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [writeKey, setWriteKey] = useState<KeyMetaView | null>(null);
  const [ordersKey, setOrdersKey] = useState<KeyMetaView | null>(null);
  const [queue, setQueue] = useState<QueueView | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [catalog, setCatalog] = useState<CatalogView | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [ready, setReady] = useState(needs.length === 0);

  const load = useCallback(async () => {
    if (needs.includes('settings')) {
      const s = await getSettings();
      if (s.ok) {
        setSettings(s.data);
        setFailure(null);
      } else {
        setSettings(null);
        setFailure(describeActionFailure(s.error, { action: 'Načítanie nastavení' }));
      }
    }
    if (needs.includes('keys')) {
      const [k, o] = await Promise.all([getKeyMeta(), getOrdersKeyMeta()]);
      setWriteKey(k.ok ? k.data : null);
      setOrdersKey(o.ok ? o.data : null);
    }
    if (needs.includes('queue')) {
      const [q, st, c] = await Promise.all([getQueue(), getStatus(), getCatalog()]);
      setQueue(q.ok ? q.data : null);
      setStatus(st.ok ? st.data : null);
      setCatalog(c.ok ? c.data.catalog : null);
    }
    setReady(true);
  }, [needs]);

  useEffect(() => {
    void load();
  }, [load]);

  if (page === null) return null;

  const body = () => {
    if (failure !== null) {
      return <ActionFailurePanel failure={failure} testId="settings-failure" />;
    }
    if (!ready || (needs.includes('settings') && settings === null)) {
      return <div className="ovl-skeleton" style={{ minHeight: '12rem' }} aria-busy="true" />;
    }
    return sections(page, {
      settings,
      writeKey,
      ordersKey,
      queue,
      status,
      catalog,
      reload: () => void load(),
    });
  };

  return (
    <div className="set-page" data-testid={`settings-sub-${slug}`}>
      <style>{SETTINGS_CSS}</style>
      <Link className="sub-back" href="/nastavenia">
        ← Nastavenia
      </Link>
      {/* `page.lead` sa TU nekreslí zámerne — používateľ ho práve prečítal na
          karte rozcestníka, na ktorú klikol, a `h1` nad tým ho hovorí tretí
          raz. Pole samo zostáva: `SettingsIndex.tsx` ho na tej karte kreslí. */}
      <h1 className="page">{page.title}</h1>
      {body()}
    </div>
  );
}

/** Všetko, čo sekcie potrebujú. Zložené na jednom mieste, nie po kúskoch. */
interface SectionInput {
  settings: SettingsView | null;
  writeKey: KeyMetaView | null;
  ordersKey: KeyMetaView | null;
  queue: QueueView | null;
  status: StatusPayload | null;
  catalog: CatalogView | null;
  reload: () => void;
}

/** Nadpis skupiny. Kreslí sa len tam, kde má stránka viac než jednu. */
function groupTitle(title: string) {
  return (
    <h2 className="set-grp" data-testid="settings-group" key={`grp-${title}`}>
      {title}
    </h2>
  );
}

function sections(page: SettingsPage, input: SectionInput) {
  const many = page.groups.length > 1;
  const settings = input.settings;

  switch (page.slug) {
    case 'co-vie':
      return <FeatureIndex />;

    case 'napojenie':
      return settings === null ? null : (
        <>
          <DomainForm
            shopDomain={settings.shopDomain}
            domainConfirmedAt={settings.domainConfirmedAt}
            onSaved={input.reload}
          />
          <KeysSection
            writeKey={input.writeKey}
            ordersKey={input.ordersKey}
            onStored={input.reload}
          />
        </>
      );

    case 'co-smie':
      return settings === null ? null : (
        <>
          {many ? groupTitle(page.groups[0].title) : null}
          <ScopeModeForm settings={settings} onChanged={input.reload} />
          <WritesSection status={input.status} settings={settings} />
          {many ? groupTitle(page.groups[1].title) : null}
          <BudgetSection settings={settings} queue={input.queue} catalog={input.catalog} />
        </>
      );

    case 'historia':
      return settings === null ? null : (
        <>
          {many ? groupTitle(page.groups[0].title) : null}
          <AuditPanel />
          <DiagnosticsSection />
          <LockedFeatures />
          {many ? groupTitle(page.groups[1].title) : null}
          <SafeguardsSection settings={settings} onChanged={input.reload} />
          <SignOut />
          <p className="dz-link" data-testid="danger-zone-link">
            Keby kľúč unikol, dá sa zmazať naraz s čakajúcimi zľavami —{' '}
            <Link href={subPagePath('cervena-zona')}>Červená zóna</Link>.
          </p>
        </>
      );

    case 'cervena-zona':
      return (
        <details className="dz-open" data-testid="danger-zone-disclosure">
          <summary>Zobraziť červenú zónu</summary>
          <PanicButton
            keyPresent={(input.writeKey?.present ?? false) || (input.ordersKey?.present ?? false)}
            onWiped={input.reload}
          />
        </details>
      );
  }
}

export default SettingsSubPage;
