'use client';

/**
 * Aura Zľavy — celá stránka NASTAVENIA (V12; predloha `design/v3/nastavenia.html`).
 *
 * Jedna stránka s kotvami: vľavo zoznam, vpravo obsah. Nastavenia sú jediná
 * obrazovka, kde dominantou NIE JE číslo — je ňou zoznam kotiev, lebo stránka
 * je referenčná: chodí sa sem niečo nájsť, nie sa na niečo pozerať.
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
 * medzera. Preto sa rozpočet a fronta načítavajú samostatne od nastavení —
 * keď spadne fronta, nastavenia sa aj tak zobrazia a naopak.
 *
 * Vlastník: V12.
 */
import { useCallback, useEffect, useState } from 'react';

import BudgetSection from '@/components/settings/BudgetSection';
import CatalogSection from '@/components/settings/CatalogSection';
import DomainForm from '@/components/settings/DomainForm';
import KeysSection from '@/components/settings/KeysSection';
import LockedFeatures from '@/components/settings/LockedFeatures';
import SignOut from '@/components/settings/SignOut';
import PanicButton from '@/components/settings/PanicButton';
import SafeguardsSection from '@/components/settings/SafeguardsSection';
import ScopeModeForm from '@/components/settings/ScopeModeForm';
import { SETTINGS_CSS } from '@/components/settings/styles';
import AuditPanel from '@/components/audit/AuditPanel';
import ActionFailurePanel from '@/components/ui/ActionFailure';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import {
  getKeyMeta,
  getOrdersKeyMeta,
  getQueue,
  getSettings,
  type KeyMetaView,
  type QueueView,
  type SettingsView,
} from '@/components/settings/api';

/** Kotvy v poradí, v akom sa na stránke kreslia. */
export const SETTINGS_ANCHORS: readonly { id: string; label: string }[] = [
  { id: 'pripojenie', label: 'Pripojenie' },
  { id: 'kluce', label: 'Kľúče' },
  { id: 'katalog', label: 'Katalóg' },
  { id: 'rozpocet', label: 'Rozpočet' },
  { id: 'rozsah', label: 'Rozsah zliav' },
  { id: 'poistky', label: 'Poistky' },
  { id: 'zamknute', label: 'Zamknuté funkcie' },
  { id: 'historia', label: 'História' },
  { id: 'odhlasenie', label: 'Odhlásenie' },
  { id: 'cervena', label: 'Červená zóna' },
];

export function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [keyMeta, setKeyMeta] = useState<KeyMetaView | null>(null);
  const [ordersKeyMeta, setOrdersKeyMeta] = useState<KeyMetaView | null>(null);
  const [queue, setQueue] = useState<QueueView | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [active, setActive] = useState<string>(SETTINGS_ANCHORS[0]?.id ?? 'pripojenie');

  const load = useCallback(async () => {
    // Čítania sú nezávislé: pád fronty nesmie zhodiť celé Nastavenia.
    const [s, k, o, q] = await Promise.all([
      getSettings(),
      getKeyMeta(),
      getOrdersKeyMeta(),
      getQueue(),
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

  return (
    <div className="set-page" data-testid="settings-panel">
      <style>{SETTINGS_CSS}</style>
      <div className="layout-anchors">
        <nav className="anchors" aria-label="Časti nastavení">
          {SETTINGS_ANCHORS.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              className={id === active ? 'on' : undefined}
              onClick={() => setActive(id)}
            >
              {label}
            </a>
          ))}
        </nav>

        <div>
          <h1 className="page">Nastavenia</h1>

          <DomainForm
            shopDomain={settings.shopDomain}
            domainConfirmedAt={settings.domainConfirmedAt}
            onSaved={() => void load()}
          />

          <KeysSection
            writeKey={keyMeta}
            ordersKey={ordersKeyMeta}
            onStored={() => void load()}
          />

          <CatalogSection />

          <BudgetSection settings={settings} queue={queue} />

          <ScopeModeForm settings={settings} onChanged={() => void load()} />

          <SafeguardsSection settings={settings} onChanged={() => void load()} />

          <LockedFeatures />

          <AuditPanel />

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
