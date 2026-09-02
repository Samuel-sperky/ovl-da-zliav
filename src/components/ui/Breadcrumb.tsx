/**
 * Aura Zľavy — OMRVINKOVÁ CESTA (D138, V6).
 *
 * PREČO VZNIKLA
 * -------------
 * Navigácia má PRESNE ŠTYRI taby a taká zostane (D138 aj hlavička `Nav.tsx`).
 * Pod štvrtým z nich však žije päť podstránok a tie mali doteraz ako cestu von
 * jediný odkaz „← Nastavenia" v ľavom hornom rohu. Ten odkaz povedal, že cesta
 * von existuje — nepovedal, KDE človek stojí. Pri podstránkach, ktoré sa menujú
 * „Čo appka vie", „Čo smie robiť a koľko toho smie" a „Čo sa už stalo a ako
 * appku zastaviť", je to rozdiel medzi orientáciou a hádaním; názvy sú si
 * navzájom podobné zámerne (sú to otázky používateľa), takže sám nadpis
 * nestačí.
 *
 * Omrvinka teda nepridáva piatu oblasť do navigácie. Pridáva DRUHÝ riadok
 * k tomu istému štvrtému tabu: „Nastavenia › Čo smie robiť".
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Posledná omrvinka NIE JE odkaz.** Odkaz na stránku, na ktorej človek
 *     práve stojí, nikam nevedie a čítačke sľubuje pohyb, ktorý sa nestane.
 *     Preto `breadcrumbSteps()` poslednému kroku cestu ZAHODÍ, aj keď mu ju
 *     volajúci dá — nie je to voľba obrazovky, je to pravidlo komponentu.
 *  2. **Oddeľovač je pre čítačku neviditeľný.** Bez `aria-hidden` prečíta
 *     VoiceOver „Nastavenia jednoduchá pravá uhlová úvodzovka Čo smie robiť".
 *     Znak je preto v samostatnom `<span aria-hidden>` a nie v `::before`
 *     obsahu CSS — generovaný obsah čítačky podľa prehliadača občas čítajú
 *     a `aria-hidden` sa naň dať nedá.
 *  3. **Oddeľovač NIE JE pomlčka.** V tejto appke má „—" (U+2014) jediný
 *     význam: „nevieme" (I11, invariant priznaní). Omrvinka nesmie ten znak
 *     použiť ako dekoráciu, inak sa najdôležitejšia veta appky rozredí na
 *     interpunkciu. Používa sa „›" (U+203A).
 *  4. **`role="list"` na `<ol>` je oprava, nie zdvojenie.** Safari s VoiceOver
 *     odoberie zoznamu rolu, keď má `list-style: none` — a bez zoznamu čítačka
 *     nepovie „1 z 2", teda ani to, ako hlboko človek je.
 *  5. **Jednokroková omrvinka sa nekreslí.** Jeden krok nie je cesta von, len
 *     zopakovaný názov stránky. Kreslila by sľub navigácie, ktorá tam nie je.
 *
 * PREČO POSLEDNÁ OMRVINKA ZOPAKUJE `h1`
 * -------------------------------------
 * Podstránka Nastavení zámerne nekreslí `page.lead`, aby tú istú vetu nehovorila
 * tretí raz (pozri `SettingsSubPage.tsx`) — tak prečo omrvinka opakuje nadpis?
 * Lebo to nie je nadpis, ale POLOHA: nesie ju `<nav>` s vlastným menom, kreslí
 * sa v mikro veľkosti a jej úlohou je ukázať, z čoho podstránka visí. Bez
 * posledného kroku by cesta končila slovom „Nastavenia" a vyzerala ako odkaz
 * bez kontextu — presne to, čo mala nahradiť.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V6a.
 */
import Link from 'next/link';

import styles from '@/components/ui/breadcrumb.module.css';

/** Meno orientačného bodu pre čítačku. Bez oslovenia (kontrakt UI, bod 9). */
export const BREADCRUMB_NAV_LABEL = 'Cesta na stránku';

/**
 * Znak medzi krokmi. „›" (U+203A) — NIE pomlčka: tú má appka obsadenú
 * významom „nevieme" (bod 3 hlavičky).
 */
export const BREADCRUMB_SEPARATOR = '›';

/** Jeden krok cesty, ako ho zadáva obrazovka. */
export interface BreadcrumbItem {
  /**
   * Názov kroku po slovensky. Má to byť PRESNE ten názov, ktorý stojí na
   * cieľovej stránke — omrvinka, ktorá volá stránku inak než ona sama seba,
   * je horšia než žiadna.
   */
  readonly label: string;
  /**
   * Cesta na krok. Posledný krok ju nemá (je to stránka, na ktorej človek
   * stojí) a keby ju dostal, komponent ju aj tak zahodí.
   */
  readonly href?: string;
}

/** Krok pripravený na vykreslenie. Rozhodnutia sú už spravené, nie hádané. */
export interface BreadcrumbStep {
  readonly label: string;
  /** `null` = krok sa nekreslí ako odkaz. */
  readonly href: string | null;
  /** Posledný krok — stránka, na ktorej človek stojí. */
  readonly current: boolean;
  /** Či pred krokom stojí oddeľovač. Prvý ho nemá. */
  readonly separated: boolean;
}

/**
 * Kroky na vykreslenie. Čistá funkcia, aby sa dala dokázať bez DOM-u.
 *
 * Zahadzuje dve veci a obe zámerne: cestu POSLEDNÉHO kroku (bod 1 hlavičky)
 * a prázdny reťazec v `href`. To druhé nie je pedantnosť — `<Link href="">`
 * vedie na aktuálnu adresu, takže by to bol odkaz, ktorý sa dá kliknúť
 * a nestane sa nič.
 */
export function breadcrumbSteps(items: readonly BreadcrumbItem[]): readonly BreadcrumbStep[] {
  const lastIndex = items.length - 1;
  return items.map((item, index) => {
    const current = index === lastIndex;
    const raw = item.href ?? null;
    const usable = raw === null || raw === '' ? null : raw;
    return {
      label: item.label,
      href: current ? null : usable,
      current,
      separated: index > 0,
    };
  });
}

export interface BreadcrumbProps {
  /**
   * Cesta od koreňa k aktuálnej stránke. Menej než dva kroky sa nekreslí
   * (bod 5 hlavičky).
   */
  items: readonly BreadcrumbItem[];
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function Breadcrumb({ items, testId }: BreadcrumbProps) {
  const steps = breadcrumbSteps(items);
  if (steps.length < 2) return null;

  return (
    <nav className={styles.crumbs} aria-label={BREADCRUMB_NAV_LABEL} data-testid={testId}>
      <ol className={styles.list} role="list">
        {steps.map((step, index) => (
          <li className={styles.item} key={`${index}-${step.label}`}>
            {step.separated ? (
              <span className={styles.sep} aria-hidden="true">
                {BREADCRUMB_SEPARATOR}
              </span>
            ) : null}
            {step.current ? (
              <span className={styles.current} aria-current="page">
                {step.label}
              </span>
            ) : step.href === null ? (
              /* Krok bez cesty. Nie je to odkaz a netvári sa tak — mŕtvy odkaz
                 by z medzikroku spravil funkciu, ktorá nefunguje. */
              <span className={styles.plain}>{step.label}</span>
            ) : (
              <Link className={styles.link} href={step.href}>
                {step.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default Breadcrumb;
