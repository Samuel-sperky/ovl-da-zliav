/**
 * Aura Zľavy — BARREL vrstvy UI primitív (V6a).
 *
 * PREČO existuje
 * --------------
 *
 * V6a postavilo primitíva dvanástimi paralelnými behmi a každý si niesol
 * vlastnú predstavu o tom, odkiaľ sa komponent importuje. Obrazovky V6b majú
 * jedno miesto, kam sa pozrieť — inak sa v repe nazbierajú tri spôsoby, ako
 * dostať `Table` do stránky, a štvrtý vznikne pri prvom refaktore.
 *
 * PREČO `export *` a nie explicitný zoznam
 * ----------------------------------------
 *
 * Explicitný zoznam sa s modulmi ROZÍDE: nový export sa doň zabudne dopísať
 * a volajúci si namiesto barrelu siahne priamo do súboru — presne ten dlh,
 * ktorý barrel má odstrániť. `export *` sa rozísť nemá ako. Cena je, že
 * **default exporty tu NIE SÚ** (`export *` ich neprenáša) — a je to zámer:
 * každý komponent má aj pomenovaný export, takže jedna cesta stačí a dve by
 * znamenali dva mená pre tú istú vec.
 *
 * PREČO tu nie sú `*.module.css`
 * ------------------------------
 *
 * Vzhľad primitív žije v CSS moduloch vedľa komponentu (D143). Triedy sú
 * lokálne pre komponent, ktorý ich kreslí; keby sa reexportovali, dala by sa
 * cudzia obrazovka ostylovať zvnútra a lokálnosť by prestala niečo znamenať.
 *
 * Duplicitné mená (`DeltaSense`, `NoteVariant`, `barListBars`) sú tu bezpečné:
 * komponent ich len REEXPORTUJE z modulu pravidiel, takže obe cesty vedú na tú
 * istú deklaráciu a `export *` nemá čo rozhodovať.
 */

// Pravidlá a slovníky (bez JSX)
export * from '@/components/ui/blocker-look';
export * from '@/components/ui/chart-language';
export * from '@/components/ui/frame';
export * from '@/components/ui/kpi';
export * from '@/components/ui/primitives';
export * from '@/components/ui/signals';

// Ikony
export * from '@/components/ui/Icon';
export * from '@/components/ui/StatusMark';

// Rámec stránky
export * from '@/components/ui/Breadcrumb';
export * from '@/components/ui/PageHeader';
export * from '@/components/ui/Panel';
export * from '@/components/ui/RunbookPanel';
export * from '@/components/ui/Segmented';
export * from '@/components/ui/Tabs';
export * from '@/components/ui/Toolbar';

// Ovládacie prvky a vrstvy
export * from '@/components/ui/Button';
export * from '@/components/ui/Chip';
export * from '@/components/ui/Drawer';

// Stav, priznania a výstrahy
export * from '@/components/ui/ActionFailure';
export * from '@/components/ui/BudgetMeter';
export * from '@/components/ui/Countdown';
export * from '@/components/ui/ErrorMessage';
export * from '@/components/ui/LockBadge';
export * from '@/components/ui/Note';
export * from '@/components/ui/StatusPill';
export * from '@/components/ui/ToneBadge';

// Čísla, tabuľky a grafy
export * from '@/components/ui/BarList';
export * from '@/components/ui/Charts';
export * from '@/components/ui/DeltaPill';
export * from '@/components/ui/Pagination';
export * from '@/components/ui/StatTile';
export * from '@/components/ui/Table';
