/**
 * Aura Zľavy — CELÁ PLOCHA SA NEPODARILA NAČÍTAŤ (D134, D142).
 *
 * ODKIAĽ SA BERIE (a prečo to nie je nový panel)
 * ---------------------------------------------
 * Predlohový `ErrorState` má vlastný nadpis, vlastnú vetu a vlastný retry. Táto
 * appka na to všetko už má cestu a je jedna: `describeActionFailure()`
 * (`lib/ui/action-failure.ts`) zloží slovenskú vetu a tón, `ErrorMessage` ju
 * vykreslí spolu s rozbaľovacím technickým detailom a `ActionFailurePanel` ju
 * postaví k formuláru. `ErrorState` je preto len ŠTVRTÝ tvar tej istej veci —
 * ten, ktorý zaberá celú plochu — a nesie ho `EmptyState` (D142: portuje sa
 * tvar, nie súbor).
 *
 * HRANICA MEDZI `ActionFailurePanel` A `ErrorState`
 * ------------------------------------------------
 *  · `ActionFailurePanel` — zlyhala MUTÁCIA. Panel stojí pri tlačidle, ktoré
 *    človek práve stlačil, a obsah obrazovky zostáva.
 *  · `ErrorState` — zlyhalo ČÍTANIE plochy. Obsah nie je vôbec, takže na jeho
 *    mieste musí stáť vysvetlenie aj ďalší krok.
 *
 * Kto to zamení, dostane buď chybu bez kontextu na prázdnej ploche, alebo
 * prázdnu obrazovku namiesto formulára, ktorý sa dá znova odoslať.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **PRÁVE JEDEN `role="alert"`.** Nesie ho `ErrorMessage` (`noteRole`) a
 *    tento komponent si žiadny ďalší nepridáva. Dva vnorené alerty prečíta
 *    čítačka dvakrát — to isté pravidlo, aké má `Note` v bode 2 svojej
 *    hlavičky, aj dôvod, prečo `Icon` nikdy nenesie meno súčasne s tlačidlom.
 * 2. **Zlyhanie NETVRDÍ, čo sa (ne)zapísalo.** Ani predvolená veta, ani nič
 *    v tomto súbore nesmie povedať „nič sa nezmenilo": pri neznámej chybe to
 *    appka nevie a mutácia mohla spadnúť aj uprostred. Je to I11 obráteným
 *    smerom a `lib/ui/action-failure.ts` má o tom celý odsek.
 * 3. **Veta je zo servera, nie z tohto súboru.** `failure` prichádza
 *    z `describeActionFailure()`; druhý slovník hlášok tu nevzniká. Predvolený
 *    nadpis a veta hovoria len o DÔSLEDKU pre obrazovku.
 * 4. **Prázdno je dôsledok, nie zistenie.** Text to musí povedať, inak sa
 *    zlyhané načítanie tvári ako „nič tu nie je" alebo ako nula (I11).
 * 5. **Raw obsah je redigovaný ešte pred príchodom sem** (I1). Tento komponent
 *    nič neredaktuje a žiadne tajomstvo nedostáva — len `{code, message}`
 *    z obálky API.
 *
 * PREČO JE „SKÚSIŤ ZNOVA" SLOT
 * ----------------------------
 * Predloha berie `onRetry`. Tu je akcia `ReactNode`, rovnako ako v celej
 * rodine: opakovanie často NIE JE správny ďalší krok (zabanovaná IP, vyčerpaná
 * kvóta, chýbajúci kľúč) a volajúci má na tlačidle `disabledReason` (D10) alebo
 * namiesto neho odkaz. Slovo na tlačidle je `RETRY_LABEL` (`state-copy.ts`),
 * aby dve obrazovky nemali dve rôzne.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V6a (rodina stavov, D134).
 */
import type { ReactNode } from 'react';

import EmptyState from '@/components/states/EmptyState';
import { STATE_STORY } from '@/components/states/state-copy';
import ErrorMessage from '@/components/ui/ErrorMessage';
import type { ActionFailure } from '@/lib/ui/action-failure';

export interface ErrorStateProps {
  /**
   * Čo sa nepodarilo — predvolene „Údaje sa nepodarilo načítať". Konkrétnejší
   * nadpis („Zoznam zliav sa nepodarilo načítať") je lepší, ak ho volajúci má.
   */
  title?: string;
  /** Jedna veta o DÔSLEDKU pre obrazovku. Nikdy tvrdenie o zápise (bod 2). */
  description?: ReactNode;
  /**
   * Hláška zlyhania z `describeActionFailure()`. Povinná: chybový stav bez
   * dôvodu je to isté ako „žiadne dáta" — nerozlíšiteľné od poruchy.
   */
  failure: ActionFailure;
  /** Redigovaný raw detail do rozbaľovacieho bloku (I1), ak ho volajúci má. */
  rawDetail?: string | null;
  /**
   * Ďalší krok. Text tlačidla je `RETRY_LABEL`, prvok kreslí volajúci — pozri
   * hlavičku modulu.
   */
  action?: ReactNode;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function ErrorState({
  title = STATE_STORY.zlyhalo.title,
  description = STATE_STORY.zlyhalo.meaning,
  failure,
  rawDetail,
  action,
  testId,
}: ErrorStateProps) {
  return (
    <EmptyState
      story="zlyhalo"
      title={title}
      description={description}
      /* Farbu, značku a `role="alert"` nesie výhradne táto vysvetlivka —
         prázdny stav sám nemá byť červený (bod 3 hlavičky `EmptyState`). */
      note={
        <ErrorMessage
          message={failure.message}
          rawCode={failure.rawCode}
          rawDetail={rawDetail}
          tone={failure.tone}
        />
      }
      action={action}
      testId={testId}
    />
  );
}

export default ErrorState;
