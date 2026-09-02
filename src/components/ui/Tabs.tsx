'use client';

/**
 * Aura Zľavy — ZÁLOŽKY (`Tabs`). Prepínajú OBSAH, nie zobrazenie.
 *
 * Predloha: `aura-roadmap/src/components/ui/Tabs.tsx` (D133, D142).
 * Záložka mení, ČO je pod ňou (detail zľavy: Prehľad / Položky / Priebeh);
 * keď sa mení len to, AKO sú tie isté dáta nakreslené, patrí tam `Segmented`.
 * Rozdiel nie je estetický — nesie ho `role`, teda to, čo o prepínači povie
 * čítačka.
 *
 * TRI KANÁLY VÝBERU
 * -----------------
 * Vybraná záložka nie je označená len farbou (§4 bod 3):
 *
 *   FARBA  — `--ink` proti `--dim`,
 *   TVAR   — 2 px podčiarknutie, ktoré prežije čiernobielu tlač aj
 *            deuteranopiu,
 *   ARIA   — `aria-selected="true"` na tom istom uzle.
 *
 * Vzhľad výberu VISÍ NA TOM ATRIBÚTE (`frame.module.css` selektuje
 * `.tab[aria-selected='true']`), takže vybraná záložka sa nedá nakresliť bez
 * toho, aby to čítačka vedela. Trieda, ktorú by šlo nakresliť samu, je presne
 * tá diera, ktorou tri kanály v tejto appke už raz vytiekli.
 *
 * KLÁVESNICA (ARIA APG, vzor „tabs with automatic activation")
 * -----------------------------------------------------------
 * Celá skupina je JEDEN zastavovací bod tabulátora (roving `tabIndex`), vnútri
 * sa hýbe `←`/`→` a `Home`/`End`, a **výber ide s fokusom**. Preto sa po
 * klávese fokus výslovne presúva na novú záložku: keby zostal na starej, tá by
 * v tom istom okamihu prestala byť zastavovacím bodom a človek by mal fokus na
 * prvku, ktorý už nie je vybraný ani dosiahnuteľný tabulátorom.
 *
 * `↑`/`↓` sa zámerne NESPRACÚVAJÚ — vodorovný tablist ich podľa APG nemá
 * a stránka ich potrebuje na posun. Zakázané záložky nie sú v obehu klávesnice
 * (`frame.ts`, bod A).
 *
 * PANELY KRESLÍ VOLAJÚCI
 * ----------------------
 * `Tabs` sú len lišta. Panel patrí obrazovke a musí mať
 * `role="tabpanel"`, `id={tabPanelId(idBase, value)}` a
 * `aria-labelledby={tabId(idBase, value)}` — identifikátory sa skladajú
 * funkciami z `frame.ts`, aby sa lišta a panel nemohli rozísť.
 *
 * **Kto kreslí panely, MUSÍ poslať `idBase`.** Bez neho si lišta vezme
 * `useId()`, ktorý obrazovka nepozná, a `aria-controls` bude ukazovať do
 * prázdna — pre čítačku pokazený odkaz. `idBase` bez panelov (lišta ako
 * navigácia) je naopak v poriadku.
 *
 * POČET NA ZÁLOŽKE JE TROJSTAVOVÝ (I11)
 * -------------------------------------
 * `count` nie je `number`. `undefined` = záložka číslo nemá; `null` =
 * „nevieme" a kreslí sa POMLČKA; číslo = číslo. Nula je tvrdenie („nič tam
 * nie je") a nesmie zastupovať nevedomosť — appku to už raz stálo pásma
 * zliav nad neznámym predajom (D121).
 *
 * Vlastník: V6a (rámec stránky).
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import styles from '@/components/ui/frame.module.css';
import { joinClasses, nextTabIndex, tabCountText, tabId, tabPanelId } from '@/components/ui/frame';

export interface TabItem<T extends string> {
  /** Hodnota, ktorou obrazovka záložku pozná. Vchádza aj do `id` panela. */
  value: T;
  /** Viditeľný popis. Slovensky — je to UI text. */
  label: ReactNode;
  /** Značka pred popisom. Dekorácia, význam nesie popis (D146). */
  icon?: ReactNode;
  /** Počet položiek za popisom. `null` = „nevieme" → pomlčka, nikdy nula. */
  count?: number | null;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: readonly TabItem<T>[];
  /**
   * Meno skupiny pre čítačku. Povinné: tablist bez mena je „skupina záložiek"
   * a nič viac, takže sa z neho nedá zistiť, čo prepína.
   */
  ariaLabel: string;
  /**
   * Spoločná predpona identifikátorov. Pošli ju, keď kreslíš panely — pozri
   * hlavičku modulu.
   */
  idBase?: string;
  className?: string;
  /** `data-testid` koreňa lišty. */
  testId?: string;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  ariaLabel,
  idBase,
  className,
  testId,
}: TabsProps<T>) {
  const generatedBase = useId();
  const base = idBase === undefined ? generatedBase : idBase;

  /*
   * Uzly záložiek podľa hodnoty. Sú tu preto, aby sa po klávese dal fokus
   * presunúť NA NOVÚ záložku — pozri hlavičku modulu.
   */
  const nodes = useRef(new Map<T, HTMLButtonElement>());

  const enabled = items.filter((item) => item.disabled !== true);

  /*
   * Keď je vybraná hodnota mimo zoznamu (alebo zakázaná), nemá roving
   * `tabIndex` komu dať nulu a celá lišta vypadne z tabulátora. Zastupuje ju
   * prvá povolená záložka — lišta zostane dosiahnuteľná, výber sa nemení.
   */
  const selectedIsEnabled = enabled.some((item) => item.value === value);
  const firstEnabled = enabled.length > 0 ? enabled[0]!.value : null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = enabled.findIndex((item) => item.value === value);
    const next = nextTabIndex(event.key, enabled.length, at);
    /* Výslovné porovnanie: Turbopack tu už raz skrátený guard zahodil. */
    if (next === null) return;

    const target = enabled[next];
    if (target === undefined) return;

    event.preventDefault();
    if (target.value !== value) onChange(target.value);
    nodes.current.get(target.value)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={joinClasses(styles.tabs, className)}
      data-testid={testId}
    >
      {items.map((item) => {
        const selected = item.value === value;
        const stopsTab = selected || (!selectedIsEnabled && item.value === firstEnabled);
        return (
          <button
            key={item.value}
            id={tabId(base, item.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(base, item.value)}
            tabIndex={stopsTab ? 0 : -1}
            disabled={item.disabled === true}
            onClick={() => onChange(item.value)}
            className={styles.tab}
            ref={(node) => {
              if (node === null) nodes.current.delete(item.value);
              else nodes.current.set(item.value, node);
            }}
          >
            {item.icon === undefined || item.icon === null ? null : item.icon}
            {item.label}
            {item.count === undefined ? null : (
              <span className={styles.tabCount}>{tabCountText(item.count)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
