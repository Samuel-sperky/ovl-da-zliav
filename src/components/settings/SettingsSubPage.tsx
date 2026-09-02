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
 *  5. **Cesta von je JEDNA a je nad nadpisom.** Od V6 je to omrvinka (D138),
 *     ktorá povie aj polohu; odkaz „← Nastavenia" povedal len to, že cesta
 *     existuje, a je zmazaný spolu s triedou `.sub-back` (D139). Kto pridá
 *     druhú cestu von, vyrobí dve miesta, ktoré sa vedia rozísť — a jedno
 *     z nich prestane byť pravda.
 *
 * Vlastník: V12 (omrvinka: V6a).
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import AuditPanel from '@/components/audit/AuditPanel';
import BudgetSection from '@/components/settings/BudgetSection';
import DiagnosticsSection from '@/components/settings/DiagnosticsSection';
import DomainForm from '@/components/settings/DomainForm';
import EnrichSection from '@/components/settings/EnrichSection';
import FeatureIndex from '@/components/settings/FeatureIndex';
import KeysSection from '@/components/settings/KeysSection';
import LockedFeatures from '@/components/settings/LockedFeatures';
import PanicButton from '@/components/settings/PanicButton';
import SafeguardsSection from '@/components/settings/SafeguardsSection';
import ScopeModeForm from '@/components/settings/ScopeModeForm';
import WritesSection from '@/components/settings/WritesSection';
import { SETTINGS_CSS } from '@/components/settings/styles';
import {
  pageBySlug,
  settingsTrail,
  subPagePath,
  type SettingsPage,
  type SettingsPageSlug,
} from '@/components/settings/sub-pages';
import ActionFailurePanel from '@/components/ui/ActionFailure';
import Breadcrumb from '@/components/ui/Breadcrumb';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/action-failure';
import {
  getCatalog,
  getEnrichState,
  getKeyMeta,
  getOrdersKeyMeta,
  getQueue,
  getSettings,
  getStatus,
  type CatalogView,
  type EnrichStatePayload,
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
    // `keys` je tu kvôli `LockedFeatures`: dôvod zámku je oprávnenie kľúča
    // (`productRead`), a bez prečítaného kľúča by sekcia vedela len „nevieme".
    // Je to čítanie z databázy, nie volanie eshopu — `GET /api/key` na shop
    // nesiahne ani raz.
    historia: ['settings', 'keys'],
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
  const [enrich, setEnrich] = useState<EnrichStatePayload | null>(null);
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
      /*
       * Štvrté volanie je stav DÁVKY obohacovania. Je tu vedome: do 31. 8. 2026
       * `catalog_enrich_state` nečítal žiadny endpoint ani komponent, takže dávka
       * mohla stáť tri týždne s odmietnutou adresou a Nastavenia o tom mlčali.
       * Cena sú tri dotazy po indexe a ani jedno volanie eshopu (K8).
       */
      const [q, st, c, e] = await Promise.all([
        getQueue(),
        getStatus(),
        getCatalog(),
        getEnrichState(),
      ]);
      setQueue(q.ok ? q.data : null);
      setStatus(st.ok ? st.data : null);
      setCatalog(c.ok ? c.data.catalog : null);
      // Neúspech NIE JE prázdny stav: `null` znamená „nevieme" a sekcia to povie.
      setEnrich(e.ok ? e.data : null);
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
      enrich,
      reload: () => void load(),
    });
  };

  return (
    <div className="set-page" data-testid={`settings-sub-${slug}`}>
      <style>{SETTINGS_CSS}</style>
      {/* Cesta von aj poloha naraz (D138). Do V6 tu stál odkaz „← Nastavenia",
          ktorý povedal len to prvé; omrvinka ho NAHRADILA a jeho trieda
          `.sub-back` je zo `SETTINGS_CSS` zmazaná (D139) — dve cesty von
          vedľa seba by boli dve miesta, ktoré sa vedia rozísť. */}
      <Breadcrumb items={settingsTrail(slug)} testId="settings-breadcrumb" />
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
  enrich: EnrichStatePayload | null;
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
          {/* Dávka obohacovania míňa denný ČÍTACÍ rozpočet, takže patrí pod
              rozpočty — a hlavne: je to jediné miesto v appke, kde sa dá
              prečítať, PREČO dávka stojí (D118 bod 2, D120). */}
          <EnrichSection enrich={input.enrich} />
        </>
      );

    case 'historia':
      return settings === null ? null : (
        <>
          {many ? groupTitle(page.groups[0].title) : null}
          <AuditPanel />
          <DiagnosticsSection />
          {/* Kľúč sa nemusel podariť prečítať; `null` znamená „nevieme", a to
              je zamknuté — sekcia si oprávnenie nikdy nedomyslí. */}
          <LockedFeatures productRead={input.writeKey?.productRead ?? null} />
          {many ? groupTitle(page.groups[1].title) : null}
          <SafeguardsSection settings={settings} onChanged={input.reload} />
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
