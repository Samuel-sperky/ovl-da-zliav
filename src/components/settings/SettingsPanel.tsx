'use client';

/**
 * Aura Zľavy — celá stránka NASTAVENIA (V12; predloha `design/v3/nastavenia.html`).
 *
 * Jedna stránka s kotvami: vľavo zoznam, vpravo obsah. Nastavenia sú jediná
 * obrazovka, kde dominantou NIE JE číslo — je ňou zoznam kotiev, lebo stránka
 * je referenčná: chodí sa sem niečo nájsť, nie sa na niečo pozerať.
 *
 * PREČO SÚ SEKCIE ZOSKUPENÉ DO ŠIESTICH OTÁZOK
 * --------------------------------------------
 * Do 12. 8. 2026 tu bolo desať rovnako vyzerajúcich blokov za sebou a rozsah
 * zliav bol štvrtý v poradí. Dôsledok bol merateľný: používateľ mesiace nevedel,
 * že strop desiatich produktov je iba prepínač a že strop plného rozsahu je už
 * uložený na tisícoch. Poradie preto nie je abecedné ani historické — sekcie
 * odpovedajú na otázky v tom poradí, v akom si ich človek kladie: čo appka vie,
 * na čo je napojená, čo smie robiť, koľko toho smie za deň, čo sa už stalo a
 * ako ju zastaviť. Skupiny sú jedna štruktúra (`SETTINGS_GROUPS`) použitá naraz
 * pre bočnú navigáciu aj pre poradie sekcií; dve kópie by sa časom rozišli a
 * kotvy by viedli inam, než kam ukazujú.
 *
 * ČO SA SEM SKLADÁ
 * ----------------
 * Audit prestal byť samostatný tab a je tu ako sekcia „História a technický
 * detail". Nič sa mu neubralo — má úplné filtre, stránkovanie aj detail so
 * snímkami; zmenil sa iba rám.
 *
 * PRAVIDLO PRE CELÚ STRÁNKU
 * -------------------------
 * Keď sa niečo nepodarí načítať, obrazovka to POVIE a nedopočíta si číslo.
 * Appka píše do produkčného eshopu; vymyslené číslo je tu tvrdenie, nie
 * medzera. Preto sa rozpočet, stav a katalóg načítavajú samostatne od
 * nastavení — keď spadne fronta, nastavenia sa aj tak zobrazia a naopak.
 *
 * Vlastník: V12.
 */
import { useCallback, useEffect, useState } from 'react';

import BudgetSection from '@/components/settings/BudgetSection';
import DiagnosticsSection from '@/components/settings/DiagnosticsSection';
import DomainForm from '@/components/settings/DomainForm';
import FeatureIndex from '@/components/settings/FeatureIndex';
import KeysSection from '@/components/settings/KeysSection';
import LockedFeatures from '@/components/settings/LockedFeatures';
import SignOut from '@/components/settings/SignOut';
import PanicButton from '@/components/settings/PanicButton';
import SafeguardsSection from '@/components/settings/SafeguardsSection';
import ScopeModeForm from '@/components/settings/ScopeModeForm';
import WritesSection from '@/components/settings/WritesSection';
import { SETTINGS_CSS } from '@/components/settings/styles';
import AuditPanel from '@/components/audit/AuditPanel';
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

/** Jedna kotva — sekcia, na ktorú vedie odkaz v bočnom zozname. */
export interface SettingsAnchor {
  readonly id: string;
  readonly label: string;
}

/** Skupina sekcií aj s otázkou, na ktorú spolu odpovedajú. */
export interface SettingsGroup {
  readonly title: string;
  readonly anchors: readonly SettingsAnchor[];
}

/**
 * Skupiny v poradí, v akom sa na stránke kreslia. Toto je JEDINÝ zdroj poradia
 * — bočná navigácia aj obsah stránky čítajú tú istú štruktúru.
 */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    title: 'Čo appka vie',
    anchors: [{ id: 'covie', label: 'Zoznam funkcií' }],
  },
  {
    title: 'Na čo je napojená',
    anchors: [
      { id: 'pripojenie', label: 'Pripojenie' },
      { id: 'kluce', label: 'Kľúče' },
    ],
  },
  {
    title: 'Čo smie robiť',
    anchors: [
      { id: 'rozsah', label: 'Rozsah zliav' },
      { id: 'zapisy', label: 'Zápisy do eshopu' },
    ],
  },
  {
    title: 'Koľko toho smie za deň',
    anchors: [{ id: 'rozpocet', label: 'Rozpočty' }],
  },
  {
    title: 'História a hranice',
    anchors: [
      { id: 'historia', label: 'História' },
      { id: 'diagnostika', label: 'Diagnostika' },
      { id: 'zamknute', label: 'Zamknuté funkcie' },
    ],
  },
  {
    title: 'Núdzové brzdy',
    anchors: [
      { id: 'poistky', label: 'Poistky' },
      { id: 'odhlasenie', label: 'Odhlásenie' },
      { id: 'cervena', label: 'Červená zóna' },
    ],
  },
];

/** Ploché poradie kotiev — odvodené zo skupín, nikdy písané druhýkrát. */
export const SETTINGS_ANCHORS: readonly SettingsAnchor[] = SETTINGS_GROUPS.flatMap(
  (group) => group.anchors,
);

export function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [keyMeta, setKeyMeta] = useState<KeyMetaView | null>(null);
  const [ordersKeyMeta, setOrdersKeyMeta] = useState<KeyMetaView | null>(null);
  const [queue, setQueue] = useState<QueueView | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [catalog, setCatalog] = useState<CatalogView | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [active, setActive] = useState<string>(SETTINGS_ANCHORS[0]?.id ?? 'covie');

  const load = useCallback(async () => {
    // Čítania sú nezávislé: pád fronty, stavu ani katalógu nesmie zhodiť celé
    // Nastavenia. Každý zdroj má na obrazovke vlastné priznanie medzery.
    const [s, k, o, q, st, c] = await Promise.all([
      getSettings(),
      getKeyMeta(),
      getOrdersKeyMeta(),
      getQueue(),
      getStatus(),
      getCatalog(),
    ]);
    if (s.ok) {
      setSettings(s.data);
      setFailure(null);
    } else {
      setSettings(null);
      setFailure(describeActionFailure(s.error, { action: 'Načítanie nastavení' }));
    }
    setKeyMeta(k.ok ? k.data : null);
    setOrdersKeyMeta(o.ok ? o.data : null);
    setQueue(q.ok ? q.data : null);
    setStatus(st.ok ? st.data : null);
    setCatalog(c.ok ? c.data.catalog : null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Kotva sa zvýrazní podľa toho, ktorá sekcia je práve hore. Keď prehliadač
   * sledovanie prienikov nevie, zvýrazní sa len to, na čo sa klikne — stránka
   * funguje aj tak. */
  useEffect(() => {
    if (settings === null) return;
    if (typeof IntersectionObserver !== 'function') return;
    const sections = SETTINGS_ANCHORS.map((a) => document.getElementById(a.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible !== undefined) setActive(visible.target.id);
      },
      { rootMargin: '-72px 0px -60% 0px', threshold: 0 },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [settings]);

  if (failure) {
    return <ActionFailurePanel failure={failure} testId="settings-failure" />;
  }

  if (settings === null) {
    return <div className="ovl-skeleton" style={{ minHeight: '12rem' }} aria-busy="true" />;
  }

  /** Nadpis skupiny nad prvou sekciou skupiny. */
  const groupTitle = (title: string) => (
    <h2 className="set-grp" data-testid="settings-group">
      {title}
    </h2>
  );

  return (
    <div className="set-page" data-testid="settings-panel">
      <style>{SETTINGS_CSS}</style>
      <div className="layout-anchors">
        <nav className="anchors" aria-label="Časti nastavení">
          {SETTINGS_GROUPS.map((group) => (
            <div className="anchor-grp" key={group.title}>
              <span className="anchor-grp-t">{group.title}</span>
              {group.anchors.map(({ id, label }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className={id === active ? 'on' : undefined}
                  onClick={() => setActive(id)}
                >
                  {label}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <div>
          <h1 className="page">Nastavenia</h1>
          <p className="set-lead">
            Tu je vidieť, čo appka vie, na čo je napojená, čo smie robiť a koľko toho
            smie za jeden deň. Nič sa tu nezapisuje do eshopu.
          </p>

          {groupTitle('Čo appka vie')}
          <FeatureIndex />

          {groupTitle('Na čo je napojená')}
          <DomainForm
            shopDomain={settings.shopDomain}
            domainConfirmedAt={settings.domainConfirmedAt}
            onSaved={() => void load()}
          />
          <KeysSection writeKey={keyMeta} ordersKey={ordersKeyMeta} onStored={() => void load()} />

          {groupTitle('Čo smie robiť')}
          <ScopeModeForm settings={settings} onChanged={() => void load()} />
          <WritesSection status={status} settings={settings} />

          {groupTitle('Koľko toho smie za deň')}
          <BudgetSection settings={settings} queue={queue} catalog={catalog} />

          {groupTitle('História a hranice')}
          <AuditPanel />
          <DiagnosticsSection />
          <LockedFeatures />

          {groupTitle('Núdzové brzdy')}
          <SafeguardsSection settings={settings} onChanged={() => void load()} />
          <SignOut />

          {/* Červená zóna maže OBA kľúče — stačí, že je uložený ktorýkoľvek. */}
          <PanicButton
            keyPresent={(keyMeta?.present ?? false) || (ordersKeyMeta?.present ?? false)}
            onWiped={() => void load()}
          />
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
