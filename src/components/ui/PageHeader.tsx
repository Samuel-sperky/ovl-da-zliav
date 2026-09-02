/**
 * Aura Zľavy — HLAVIČKA STRÁNKY (`PageHeader`).
 *
 * Predloha: `aura-roadmap/src/components/ui/PageHeader.tsx` (D133, D142).
 * Poradie je vždy to isté — značka · nadkapitola · `h1` · popis · akcie
 * vpravo — a práve to je jej celá úloha: **zvislý rytmus zhora rovnaký na
 * každej obrazovke**. Dnes má každá obrazovka vlastnú hlavičku
 * (`zlavy.module.css` `.head`, `h1.page` v Nastaveniach, Prehľad a Produkty
 * nič), takže sa nadpisy začínajú v troch rôznych výškach a človek pri
 * prepnutí oblasti hľadá, kde stránka začína.
 *
 * ROZDIELY PROTI PREDLOHE
 * -----------------------
 *  1. `icon` berie `ReactNode`, nie `LucideIcon` (D146).
 *  2. Vzhľad je vo `frame.module.css` (D143).
 *  3. Predloha mala vnútorný `style={{ minWidth: 0 }}` priamo v JSX; tu je to
 *     trieda. Inline štýl obchádza tokenovú vrstvu a strážny test ho nevidí.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Jedno `h1` na strom.** Nadpis stránky je `h1`, všetko ostatné pod ním
 *     je `h2`/`h3`. Dva `h1` hovoria čítačke, že sú to dva dokumenty
 *     (`test/unit/nadpisy-osnova.spec.ts`) — preto sa `PageHeader` kreslí RAZ,
 *     na vrchu obrazovky, a nikdy vnútri panela.
 *
 *  B. **Popis nie je nadpis a nemá byť dlhý.** Je to jedna veta o tom, čo
 *     obrazovka robí — nie odstavec. Šírku drží `frame.module.css` (68 znakov).
 *
 *  C. **Akcie sú vpravo, ale nie za hranou.** Na úzkom okne spadnú pod nadpis
 *     (`flex-wrap`) — nikdy sa neodrežú. Tlačidlo, ktoré nie je vidieť, appka
 *     nemá.
 *
 *  D. **Značka NIE JE stav.** Zlatá je tu kategória („toto je Aura"), stav
 *     nesie výhradne mierka `--st-*`. Značka a stav sa v tejto appke nesmú
 *     miešať (stráži `test/unit/paleta.spec.ts`).
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V6a (rámec stránky).
 */
import type { ReactNode } from 'react';

import styles from '@/components/ui/frame.module.css';
import { joinClasses } from '@/components/ui/frame';

export interface PageHeaderProps {
  /**
   * Nadkapitola nad nadpisom — v ktorej oblasti človek stojí („Nastavenia",
   * „Zľavy"). Najtichší z troch popiskov (D2).
   */
  eyebrow?: ReactNode;
  /** Nadpis stránky. Kreslí sa ako `h1` — pozri bod A hlavičky. */
  title: ReactNode;
  /** Jedna veta o tom, čo obrazovka robí. */
  description?: ReactNode;
  /** Akcie zarovnané vpravo; na úzkom okne spadnú pod nadpis. */
  actions?: ReactNode;
  /** Značka pred nadpisom. Dekorácia, nie stav (bod D hlavičky). */
  icon?: ReactNode;
  className?: string;
  /** `data-testid` koreňa — nech sa dá hlavička adresovať v e2e. */
  testId?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  icon,
  className,
  testId,
}: PageHeaderProps) {
  /*
   * Skrátený guard tu nestojí zámerne: Turbopack v tomto repe už raz
   * vyhodnotil `if (!x)` ako compile-time falsy a null-guard zahodil.
   */
  return (
    <header className={joinClasses(styles.pageHeader, className)} data-testid={testId}>
      {icon === undefined || icon === null ? null : (
        <span className={styles.pageHeaderMark} aria-hidden="true">
          {icon}
        </span>
      )}
      <div className={styles.pageHeaderText}>
        {eyebrow === undefined || eyebrow === null ? null : (
          <p className={styles.eyebrow}>{eyebrow}</p>
        )}
        <h1>{title}</h1>
        {description === undefined || description === null ? null : (
          <p className={styles.pageHeaderDesc}>{description}</p>
        )}
      </div>
      {actions === undefined || actions === null ? null : (
        <div className={styles.pageHeaderActions}>{actions}</div>
      )}
    </header>
  );
}

export default PageHeader;
