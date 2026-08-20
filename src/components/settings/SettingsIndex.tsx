'use client';

/**
 * Aura Zľavy — ROZCESTNÍK NASTAVENÍ (kontrakt UI 13. 8. 2026, bod 13).
 *
 * Štyri karty, každá s vlastným stavom. Klik otvorí podstránku. Nie je to
 * menu: karta hovorí, čo sa za ňou práve deje, takže sa dá zistiť stav appky
 * bez otvorenia čohokoľvek.
 *
 * PRESMEROVANIE STARÝCH ODKAZOV
 * -----------------------------
 * Po appke vedie na `/nastavenia#rozsah`, `#kluce`, `#historia`, `#zamknute`,
 * `#pripojenie` a `#rozpocet` niekoľko odkazov — z prekážok na Prehľade, zo
 * zoznamu funkcií aj z pravidiel AI. Tie kotvy teraz žijú na podstránkach,
 * takže by klik skončil tu a nič by sa nestalo. Rozcestník preto kotvu prečíta
 * a presmeruje na podstránku, ktorá ju naozaj má. Neznáma kotva presmerovanie
 * nespustí — človek zostane tu a vidí štyri karty, čo je horší, ale poctivý
 * výsledok oproti hádaniu.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Karta bez stavu je len menu.** Keď sa údaje nedajú prečítať, stav to
 *     POVIE — nikdy sa nedopĺňa upokojujúca veta ani nula (P7).
 *  2. **Červená zóna tu nie je.** Ani ako karta, ani ako odkaz (bod 14).
 *  3. **Čítania sú nezávislé.** Pád jedného zdroja nesmie zhodiť rozcestník;
 *     karta, ktorej údaj chýba, to prizná sama.
 *
 * Vlastník: V12.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  getKeyMeta,
  getOrdersKeyMeta,
  getQueue,
  getSettings,
  getStatus,
  type KeyMetaView,
  type QueueView,
  type SettingsView,
  type StatusPayload,
} from '@/components/settings/api';
import { TONE_SIG_CLASS } from '@/components/settings/blockers-view';
import { ToneSigMark } from '@/components/ui/StatusMark';
import { cardState, type CardFacts } from '@/components/settings/index-cards';
import { SETTINGS_CSS } from '@/components/settings/styles';
import { INDEX_PAGES, subPagePath, subPagePathForAnchor } from '@/components/settings/sub-pages';

export function SettingsIndex() {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [writeKey, setWriteKey] = useState<KeyMetaView | null>(null);
  const [ordersKey, setOrdersKey] = useState<KeyMetaView | null>(null);
  const [queue, setQueue] = useState<QueueView | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);

  /* Starý odkaz s kotvou → podstránka, ktorá tú kotvu má. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = subPagePathForAnchor(window.location.hash);
    if (target !== null) router.replace(target);
  }, [router]);

  const load = useCallback(async () => {
    const [s, k, o, q, st] = await Promise.all([
      getSettings(),
      getKeyMeta(),
      getOrdersKeyMeta(),
      getQueue(),
      getStatus(),
    ]);
    setSettings(s.ok ? s.data : null);
    setWriteKey(k.ok ? k.data : null);
    setOrdersKey(o.ok ? o.data : null);
    setQueue(q.ok ? q.data : null);
    setStatus(st.ok ? st.data : null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const facts: CardFacts = {
    settings,
    writeKey,
    ordersKey,
    queue,
    blockers: status?.blockers ?? null,
  };

  return (
    <div className="set-page" data-testid="settings-index">
      <style>{SETTINGS_CSS}</style>

      <h1 className="page">Nastavenia</h1>
      {/* Že je pod každou kartou napísané, čo sa za ňou deje, je vidieť na
          kartách samých — bol to popis obrazovky na obrazovke. */}
      <p className="set-lead">Štyri otázky, štyri stránky. Nič sa tu nezapisuje do eshopu.</p>

      <div className="set-cards" data-testid="settings-cards">
        {INDEX_PAGES.map((page) => {
          const state = cardState(page.slug, facts);
          const sections = page.groups.flatMap((group) => group.anchors.map((a) => a.label));
          return (
            <Link
              key={page.slug}
              className="set-card"
              href={subPagePath(page.slug)}
              data-testid={`settings-card-${page.slug}`}
            >
              <h2>{page.title}</h2>
              <p className="card-lead">{page.lead}</p>
              <div className="card-in">
                {sections.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className="card-state">
                <span
                  className={TONE_SIG_CLASS[state.tone]}
                  data-testid={`settings-card-state-${page.slug}`}
                >
                  <ToneSigMark tone={state.tone} />
                  {state.sentence}
                </span>
                {state.word !== null ? <span className="card-word">{state.word}</span> : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default SettingsIndex;
