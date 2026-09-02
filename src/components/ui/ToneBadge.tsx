/**
 * Aura Zľavy — stavový badge ako primitív (32-UX-UI-PLAN §3.2, §3.3).
 *
 * Päť tónov (critical / attention / progress / good / idle) a tvrdé pravidlo:
 * **stav nie je nikdy len farba.** Každý badge nesie farbu + značku + text,
 * pretože v darku je susedná dvojica critical↔attention pod deuteranopiou
 * takmer nerozlíšiteľná (ΔE 4,0). Značka je dekoratívna (`aria-hidden`) —
 * význam nesie text, ktorý je pri nej vždy.
 *
 * Teal (`--brand`) ani gold (`--gold`) sa tu NESMÚ objaviť: nikdy nekódujú stav.
 *
 * ZNAČKA JE OD 19. 8. 2026 IKONA, NIE ZNAK
 * ----------------------------------------
 * Do tohto dátumu tu stáli textové glyfy. Ani jeden z nich nebol v písme
 * Inter, ktoré appka dodáva — všetky padali na systémový symbolový zásobník,
 * takže sa kreslili iným písmom, s inou hrúbkou a na každom operačnom systéme
 * inak; zmeraná typografia sa ich vôbec netýkala. Nahradila ich sada
 * `ui/Icon.tsx` (mriežka 16, hrúbka 1,5, `currentColor`).
 *
 * ZLÚČENIE S `Badge` Z `aura-roadmap` (D142, 2. 9. 2026)
 * ------------------------------------------------------
 * Predloha má na túto vec komponent `ui/Badge.tsx` a jeho docblock hovorí to
 * isté ako tento („Always contains TEXT — colour is never the only cue").
 * Nový súbor by teda vznikol len preto, aby sa o mesiac rozišiel s týmto —
 * preto sa portovalo PRAVIDLO, nie súbor. Čo z predlohy prišlo a čo NIE:
 *
 *  · **Prišlo:** poistka, že slovo naozaj je. Predloha ju nemá — `children`
 *    tam smie byť prázdne a badge sa nakreslí ako farebná pilulka. Tu to
 *    dopĺňa `ui/signals.ts` a chýbajúce slovo o sebe povie atribútom.
 *  · **Prišlo:** `data-tone` na koreni, aby sa tón dal zmerať jedným dotazom
 *    (predloha ho číta z triedy `badge-<tone>`; tu sa trieda skladá za behu).
 *  · **NEPRIŠLO:** tóny `neutral` / `accent` / `gold`. V predlohe kódujú
 *    KATEGÓRIU (rad, oblasť, značka) a jej vlastný komentár pripomína „never
 *    colour a neutral category red" — teda dva významy v jednej škále. Táto
 *    appka to má oddelené tvrdšie: teal a gold nekódujú stav NIKDY (stráži
 *    `test/unit/paleta.spec.ts`) a kategóriu kreslia tokeny grafov
 *    (`--chart-1..8`, D126). Šesťtónová škála by tú hranicu zmazala.
 *  · **NEPRIŠLO:** `icon?: LucideIcon`. Dôvod je v komentári pri prope.
 */
import type { HTMLAttributes, ReactNode } from 'react';

import Icon, { type IconName } from '@/components/ui/Icon';
import styles from '@/components/ui/signals.module.css';
import { signalWord, wordlessAttrs } from '@/components/ui/signals';

export type StatusTone = 'critical' | 'attention' | 'progress' | 'good' | 'idle';

/**
 * KOREŇOVÝ SLOVNÍK ZNAČIEK (§3.3) — jeden zdroj pravdy pre badge, pilulku,
 * vysvetlivku, chybovú hlášku aj legendy grafov.
 *
 * Odvodzuje sa z neho `NOTE_ICON` (`ui/primitives.ts`) aj značka chybovej
 * hlášky (`ui/ErrorMessage.tsx`), ktorá tu do 19. 8. 2026 mala DRUHÚ, ručne
 * písanú kópiu. Kto by si napísal vlastnú `Record<StatusTone, …>` tabuľku
 * značiek, otvorí presne tú chybu znova.
 */
export const TONE_ICON: Readonly<Record<StatusTone, IconName>> = {
  critical: 'x',
  attention: 'alertTriangle',
  progress: 'loader',
  good: 'check',
  idle: 'circle',
};


export interface ToneBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone: StatusTone;
  /**
   * Značka stavu (§3.3). Keď sa neuvedie, použije sa ikona tónu.
   *
   * Typ je `IconName`, nie `ReactNode` — D146 zakazuje NOVÚ ZÁVISLOSŤ kvôli
   * typu propu (`LucideIcon` v predlohe), nie typovanie. `IconName` je
   * miestne, prísnejšie a garantuje, že značka je z jednej sady: `ReactNode`
   * by sem pustil `<div>` a druhý kanál by tichučko prestal byť značkou.
   */
  icon?: IconName;
  children: ReactNode;
}

export function ToneBadge({ tone, icon, children, className, ...rest }: ToneBadgeProps) {
  const classes = ['ovl-badge', `ovl-badge--${tone}`, className ?? ''].filter(Boolean).join(' ');
  /*
   * Tretí kanál sa nedopĺňa v JSX, ale v `ui/signals.ts` — jedna poistka pre
   * celú signálnu skupinu. Badge bez slova nie je prázdny badge; je to farebná
   * pilulka, ktorú časť používateľov od susednej nerozlíši.
   */
  const { word, wordless } = signalWord(children);
  return (
    <span
      className={classes}
      /*
       * `data-tone` nesie tón MECHANICKY, popri triede. Trieda `.ovl-badge--*`
       * zostáva (kreslí ju `globals.css` a merajú ju `paleta.spec.ts`
       * aj `mrtve-triedy.spec.ts`), ale skladá sa do template stringu, takže sa
       * z markupu ťažko číta. Atribút je to isté tvrdenie v tvare, ktorý sa dá
       * zmerať jedným dotazom — a je to ten istý tvar, aký už nesú
       * `StatusPill`, `BudgetMeter` aj smer v dlaždici.
       */
      data-tone={tone}
      {...rest}
      /* Až za `rest` — príznak chýbajúceho slova sa nesmie dať prepísať zvonku. */
      {...wordlessAttrs(wordless)}
    >
      <Icon className="ovl-badge-glyph" name={icon ?? TONE_ICON[tone]} size={0.9} />
      {wordless ? <span className={styles.wordless}>{word}</span> : children}
    </span>
  );
}

export default ToneBadge;
