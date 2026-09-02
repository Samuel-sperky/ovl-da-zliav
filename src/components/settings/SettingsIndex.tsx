'use client';

/**
 * Aura Zľavy — ROZCESTNÍK NASTAVENÍ (kontrakt UI 13. 8. 2026, bod 13;
 * redizajn V6b, krok 1/3).
 *
 * Štyri karty, každá s vlastným stavom. Klik otvorí podstránku. Nie je to
 * menu: karta hovorí, čo sa za ňou práve deje, takže sa dá zistiť stav appky
 * bez otvorenia čohokoľvek.
 *
 * ČO SA ZMENILO V V6b (a čo nie)
 * ------------------------------
 * Obrazovka stojí na primitívach `PageHeader` a `Panel` a na module
 * `settings-index.module.css` (D143). Zmizol s tým `<style>{SETTINGS_CSS}</style>`
 * aj trieda `.set-page`: rozcestník zo `SETTINGS_CSS` nekreslil ani jedno
 * pravidlo pre sekcie a nosil ich so sebou 12 kB. Jeho vlastné triedy
 * (`.set-cards`, `.set-card`, `.card-*`, `.set-lead`) sú zo `SETTINGS_CSS`
 * ZMAZANÉ v tom istom kroku (D139) — dve sady tried natrvalo je presne ten
 * dlh, ktorý D139 zakazuje. `h1.page` a `.set-page` v `SETTINGS_CSS` zostali,
 * lebo ich kreslí ešte `SettingsSubPage.tsx` (krok 2/3).
 *
 * Nezmenilo sa nič z toho, čo obrazovka HOVORÍ: vety kariet sú ďalej z
 * `index-cards.ts`, stav ďalej nesie farba + značka + slovo, a poradie aj
 * počet kariet ďalej čítajú `INDEX_PAGES`.
 *
 * PREČO TU NIE JE OMRVINKA
 * ------------------------
 * D138 dal omrvinku POD-stránkam Nastavení a rozcestník je ich koreň. Cesta
 * z jedného kroku nie je cesta, len zopakovaný názov stránky — `Breadcrumb`
 * to má ako pravidlo v sebe (bod 5 jeho hlavičky) a jednokrokovú omrvinku
 * nekreslí. Vykresliť ju tu by teda znamenalo zavolať komponent, ktorý vráti
 * `null`. Rozcestník je namiesto toho ZDROJ prvého kroku: `SETTINGS_ROOT.label`
 * je názov v tejto hlavičke aj prvá omrvinka na každej podstránke, takže sa
 * nemôže stať, že cesta volá rozcestník inak než on sám seba.
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
 *     POVIE — nikdy sa nedopĺňa upokojujúca veta ani nula (P7). Appka je dnes
 *     bez `shop_write` kľúča, takže priznania sú BEŽNÝ stav tejto obrazovky,
 *     nie výnimka (R4) — musí vyzerať dobre aj vtedy, keď sú všetky štyri
 *     vety „nepodarilo prečítať".
 *  2. **Červená zóna tu nie je.** Ani ako karta, ani ako odkaz (bod 14).
 *  3. **Čítania sú nezávislé.** Pád jedného zdroja nesmie zhodiť rozcestník;
 *     karta, ktorej údaj chýba, to prizná sama.
 *  4. **Odkaz je v nadpise, nie okolo karty.** Terč je aj tak celá karta
 *     (`.hit::after` v module), ale štyri pásma karty musia zostať PRIAMYMI
 *     deťmi panela — inak sa rozpadne `subgrid` a stavy prestanú stáť
 *     v jednej línii.
 *
 * Vlastník: V12 (rámec a primitíva: V6b).
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
import { cardState, type CardFacts } from '@/components/settings/index-cards';
import styles from '@/components/settings/settings-index.module.css';
import {
  INDEX_PAGES,
  SETTINGS_ROOT,
  subPagePath,
  subPagePathForAnchor,
} from '@/components/settings/sub-pages';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { ToneSigMark } from '@/components/ui/StatusMark';

/**
 * Veta pod nadpisom. Popisuje, čo obrazovka JE — a hneď aj to, čo NEROBÍ:
 * na obrazovke, ktorá vedie k prepínačom nad produkčným eshopom, je „nič sa
 * tu nezapisuje" fakt, nie upokojenie.
 */
export const SETTINGS_INDEX_LEAD =
  'Štyri otázky, štyri stránky. Nič sa tu nezapisuje do eshopu.';

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
    <div className={styles.page} data-testid="settings-index">
      {/* Názov sa berie zo `SETTINGS_ROOT`, nie z literálu — omrvinka na
          podstránkach kreslí prvý krok z toho ISTÉHO miesta, takže sa nemôže
          stať, že cesta volá rozcestník inak než on sám seba (D138). */}
      <PageHeader
        title={SETTINGS_ROOT.label}
        description={SETTINGS_INDEX_LEAD}
        testId="settings-header"
      />

      <div className={styles.cards} data-testid="settings-cards">
        {INDEX_PAGES.map((page) => {
          const state = cardState(page.slug, facts);
          const sections = page.groups.flatMap((group) => group.anchors.map((a) => a.label));
          return (
            <Panel
              key={page.slug}
              className={styles.card}
              data-testid={`settings-card-${page.slug}`}
            >
              <h2 className={styles.cardTitle}>
                <Link className={styles.hit} href={subPagePath(page.slug)}>
                  {page.title}
                </Link>
              </h2>
              <p className={styles.lead}>{page.lead}</p>
              <div className={styles.sections}>
                {sections.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className={styles.state}>
                <span
                  className={TONE_SIG_CLASS[state.tone]}
                  data-testid={`settings-card-state-${page.slug}`}
                >
                  <ToneSigMark tone={state.tone} />
                  {state.sentence}
                </span>
                {state.word !== null ? (
                  <span className={styles.word}>{state.word}</span>
                ) : null}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

export default SettingsIndex;
