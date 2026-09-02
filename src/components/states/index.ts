/**
 * Aura Zľavy — BARREL šiestich stavových obrazoviek (V6a, D134).
 *
 * PREČO je barrel práve TU dôležitejší než inde
 * ---------------------------------------------
 *
 * Prázdna obrazovka má v tejto appke ŠESŤ rôznych významov (nič nevzniklo /
 * filter nič nenašiel / nemerali sme to / kľúč nedovolí / zlyhalo / načítava)
 * a `state-copy.ts` má pre každý presne jednu vetu. Keď si volajúci vyberá
 * komponent z jedného zoznamu, vidí, že tá voľba existuje. Keď si ho importuje
 * po jednom zo šiestich ciest, vyberie si prvý, ktorý pozná, a z rozdielu
 * medzi „nemerali sme" a „nič tu nie je" sa stane „žiadne dáta" — teda presne
 * to, čo I11 zakazuje.
 *
 * `export *` (a teda bez default exportov) je z rovnakého dôvodu ako v
 * `components/ui/index.ts`: zoznam, ktorý sa nedá zabudnúť aktualizovať.
 * `state-copy` je súčasťou barrelu zámerne — vety a komponenty, ktoré ich
 * kreslia, patria k sebe.
 */

export * from '@/components/states/state-copy';

export * from '@/components/states/EmptyState';
export * from '@/components/states/ErrorState';
export * from '@/components/states/ForbiddenState';
export * from '@/components/states/LoadingState';
export * from '@/components/states/NoResultsState';
export * from '@/components/states/UnmeasuredState';
