/**
 * Aura Zľavy — OKNO PREDAJA PRE KARTY A TABUĽKU PREHĽADU (V7, D149, D155).
 *
 * D155 dal Prehľadu DVA prepínače okna a tento modul patrí PRVÉMU z nich:
 * ovláda KPI karty a s nimi tabuľku. Nie je to úspora miesta ani estetika —
 * stĺpce tabuľky „predané za okno" a „predané/sklad" sú TÁ ISTÁ veličina, akú
 * nesie tretia karta, takže tabuľka je jej rozpis. Dva prepínače nad jednou
 * veličinou by na jednej obrazovke postavili dve čísla za dve rôzne obdobia
 * a obe by vyzerali rovnako dôveryhodne.
 *
 * Druhý prepínač patrí GRAFU a v tomto module NIE JE. Graf odpovedá na inú
 * otázku (denný priebeh, nie súhrn okna) a Samuel ho oddelil výslovne.
 *
 * ═══ ZOZNAM OKIEN SA TU NEPÍŠE RUČNE (K9) ═══
 * Berie sa zo `SOLD_WINDOW_CHOICES` (`lib/sales/windows.ts`) — z TOHO ISTÉHO
 * zoznamu, z ktorého sa odvodzuje strop `SALES_WINDOW_DAYS` v `src/env.ts`,
 * povolené okná zrkadla (`ALLOWED_SOLD_WINDOWS`) aj `?long=` na čítacích
 * endpointoch. Druhá kópia `[30, 60, 90, 180, 360]` by sa pri prvej zmene
 * rozišla s prvou a Prehľad by ponúkal okno, za ktorým appka dáta ani nesmie
 * sťahovať — presne to, čo CLAUDE.md menuje ako „to isté číslo nesmie žiť na
 * dvoch miestach", a presne to, čo D149 opravovalo (strop bol 90, kým filter
 * ponúkal 360).
 *
 * `lib/sales/windows.ts` je ZÁMERNE list — neimportuje nič, takže sa dá načítať
 * aj v prehliadači a `src/env.ts` z neho môže čítať bez cyklu.
 *
 * Dôsledok, na ktorý treba pamätať: `WINDOW_DAYS_ALLOWED` v
 * `app/api/insights/_shared.ts` je iný, KRATŠÍ zoznam (dnes 7/30/90) a patrí
 * prepínaču grafu. Okná 60, 180 a 360 preto na čítacích endpointoch grafu
 * NEEXISTUJÚ a tento modul ich tam ani neposiela; karty čítajú vlastné
 * odpovede a keď ich server odmietne, karta ukáže pomlčku (R4) — nikdy nulu.
 *
 * ═══ PREČO SÚ HODNOTY PREPÍNAČA REŤAZCE ═══
 * `ui/Segmented` je generický nad `T extends string`, pretože hodnotu nesie
 * `aria-checked` na `<button>` a atribút je reťazec. Prevod tam a späť je
 * preto TU, na jednom mieste, a späť ide výhradne cez `isSoldWindow()` —
 * fail-closed: čokoľvek, čo v zozname nie je, sa zahodí a okno sa nezmení.
 *
 * Čistý modul: žiadny React, žiadny `fetch`, žiadne `use client`. Vzhľad
 * prepínača je v `sold-window.module.css` vedľa `SoldWindowSwitch.tsx` (D143).
 *
 * Vlastník: V7, krok 1/4 (KPI riadok a prepínače okna).
 */
import { dayCount } from '@/components/campaigns/queue-model';
import { SOLD_WINDOW_CHOICES, isSoldWindowDays, type SoldWindowDays } from '@/lib/sales/windows';

/**
 * Okná, ktoré prepínač kariet a tabuľky ponúka. Odvodené, nie prepísané.
 *
 * Typ sa NEPREMENÚVA na vlastný typ Prehľadu: tabuľka posiela to isté číslo do
 * `?soldWindow=` / `?long=` ako Produkty a čítacie endpointy, takže dva typy
 * pre jednu veličinu by znamenali dve miesta, kde sa dá zabudnúť na nové okno.
 * `SoldWindow` je tu len KRATŠIE MENO toho istého typu, nie druhá deklarácia.
 */
export const SOLD_WINDOW_DAYS: readonly SoldWindowDays[] = SOLD_WINDOW_CHOICES;

export type SoldWindow = SoldWindowDays;

/**
 * Predvolené okno kariet: 30 dní.
 *
 * Najkratšie z ponuky, a to zámerne — dlhšie okno je dnes takmer isto len
 * DOLNÁ HRANICA (`SALES_WINDOW_DAYS` sa dočítava po dňoch, R3 kontraktu), a
 * obrazovka nemá začínať číslom, ktoré musí hneď priznávať medzeru.
 */
export const DEFAULT_SOLD_WINDOW: SoldWindow = 30;

/**
 * Je to okno, ktoré appka pozná? Fail-closed: čokoľvek iné je `false`.
 *
 * Rozpoznávanie sa TU NEPÍŠE — je to `isSoldWindowDays()` z jedného zdroja.
 * Vlastné `includes()` by bolo druhé pravidlo o tom istom zozname.
 */
export const isSoldWindow: (value: number) => value is SoldWindow = isSoldWindowDays;

/**
 * Hodnota prepínača → okno. `null` pri čomkoľvek mimo zoznamu.
 *
 * Nedosadzuje sa predvolených 30: keby prepínač poslal „14", tichý fallback
 * by prekreslil karty za 30 dní a nadpis by tvrdil 14. Radšej sa nestane nič.
 */
export function soldWindowFromValue(value: string): SoldWindow | null {
  const days = Number(value);
  if (!Number.isFinite(days)) return null;
  return isSoldWindow(days) ? days : null;
}

/** Hodnota prepínača z okna. Jedna cesta tam, jedna späť. */
export function soldWindowValue(days: SoldWindow): string {
  return String(days);
}

/** Jedna možnosť prepínača: číslo na tlačidle, celá fráza pre čítačku. */
export interface SoldWindowOption {
  readonly value: string;
  readonly label: string;
  /**
   * Meno pre čítačku. Samotné „180" nepovie nič, „180 dní" povie — presne ten
   * dôvod, pre ktorý `Segmented` prop `title` vôbec má.
   */
  readonly title: string;
}

/** Možnosti prepínača v poradí zoznamu. Fráza dní ide cez `dayCount()`. */
export function soldWindowOptions(): readonly SoldWindowOption[] {
  return SOLD_WINDOW_DAYS.map((days) => ({
    value: soldWindowValue(days),
    label: String(days),
    title: dayCount(days),
  }));
}
