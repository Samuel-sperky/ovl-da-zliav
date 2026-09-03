/**
 * Aura Zľavy — DĹŽKY OKIEN PREDAJNOSTI. JEDEN ZDROJ, ŽIADNA KÓPIA (D149, K9).
 *
 * Prečo tento modul vznikol
 * -------------------------
 * Do 3. 9. 2026 žilo to isté číslo na troch miestach: `SOLD_WINDOWS` v UI
 * (`components/products/catalog-filter.ts`), `ALLOWED_SOLD_WINDOWS` v zrkadle
 * katalógu (`lib/repo/catalog.repo.ts`) a — ako STROP — literál `90`
 * v `SALES_WINDOW_DAYS` (`src/env.ts`). Prvé dve sa zhodovali náhodou, tretie
 * bolo s nimi v rozpore: filter ponúkal 180 a 360 dní, ale ENV schéma taký
 * rozsah sťahovania vôbec neprijala, takže za dvoma z piatich okien NIKDY
 * nemohli byť dáta. To je pasca D125 („filter bez dátového zdroja je sľub,
 * ktorý appka nedodrží") a v tomto repe už raz stála produkčné číslo:
 * `MAX_DAILY_WRITE_BUDGET` existoval dvakrát a pri zdvihnutí kvóty sa kópie
 * rozišli okamžite.
 *
 * Modul je preto ZÁMERNE LIST: neimportuje nič. `src/env.ts` z neho číta strop,
 * takže akýkoľvek import (najmä `@/env` alebo repozitár) by vyrobil cyklus.
 *
 * Čo sa tu NESMIE pokaziť
 * -----------------------
 *  1. **Strop sa neprepisuje ručne.** `MAX_SALES_WINDOW_DAYS` je `Math.max()`
 *     nad zoznamom. Pridanie okna 720 dní tak zdvihne strop samo — a rovnako
 *     odobranie 360 ho samo zníži.
 *  2. **Zoznam je uzavretý.** Každá ďalšia hodnota je rozhodnutie o tom, čo
 *     appka tvrdí o čase, nie parameter dotazu (rovnaký dôvod ako pri
 *     `WINDOW_DAYS_ALLOWED` v `api/insights/_shared.ts`).
 *  3. **Strop okna NIE JE sľub dát.** `SALES_WINDOW_DAYS = 360` znamená len
 *     „appka smie o také okno požiadať". Koľko dní toho okna je naozaj
 *     stiahnutých, hovorí `sales_sync_state` a v odpovediach `completeDays` /
 *     `unknownDays` — a kým sa nedočíta, je súčet DOLNÁ HRANICA (I11).
 *
 * Vlastník: sales-sync (V7, D149).
 */

/* ═════════════════════════ 1. Okná predajnosti ════════════════════════════ */

/**
 * Okná predajnosti, ktoré appka ponúka — JEDINÝ ZDROJ.
 *
 * Tuple s `as const` je zámer: `SoldWindowDays` z neho robí uzavretý typ, takže
 * okno mimo zoznamu neprejde typecheckom, nie až validáciou za behu.
 */
export const SOLD_WINDOW_CHOICES = [30, 60, 90, 180, 360] as const;

export type SoldWindowDays = (typeof SOLD_WINDOW_CHOICES)[number];

/**
 * Najdlhšie okno, o aké sa dá požiadať — ODVODENÉ, nikdy napísané.
 *
 * Toto je strop `SALES_WINDOW_DAYS` v `src/env.ts`. Keby sa tam napísal ručne,
 * bola by to druhá kópia toho istého čísla a rozišla by sa presne v tej chvíli,
 * keď niekto do zoznamu vyššie pridá alebo z neho odoberie okno.
 */
export const MAX_SALES_WINDOW_DAYS: number = Math.max(...SOLD_WINDOW_CHOICES);

/** Je to okno, ktoré appka ponúka? Fail-closed: čokoľvek iné je `false`. */
export function isSoldWindowDays(value: number): value is SoldWindowDays {
  return (SOLD_WINDOW_CHOICES as readonly number[]).includes(value);
}
