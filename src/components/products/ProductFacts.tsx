/**
 * Aura Zľavy — AKO SA KRESLÍ HODNOTA A AKO SA KRESLIA TRI RÔZNE „PRÁZDNO".
 *
 * Tento súbor je vizuálna polovica `product-extras.ts`. Logika (ktoré z troch
 * prázdien to je) žije tam; tu sa rozhoduje výhradne o tom, ako to vyzerá —
 * a tie dve veci sú zámerne oddelené, aby sa dala tá prvá zmerať bez
 * prehliadača.
 *
 * PREČO TRI TVARY A NIE JEDNA POMLČKA
 * ───────────────────────────────────
 * Používateľ sa pýta na kód a EAN. Keby všetky tri dôvody, prečo ich nevidí,
 * vyzerali rovnako, dostal by odpoveď „nie je" na tri úplne rozdielne otázky:
 *
 *   ┌───────────┬──────────────────────┬─────────┬───────────────────────────┐
 *   │ dôvod     │ slovo                │ značka  │ čo s tým vie človek robiť │
 *   ├───────────┼──────────────────────┼─────────┼───────────────────────────┤
 *   │ `none`    │ „nemá"               │ krúžok  │ nič — údaj neexistuje     │
 *   │ `pending` │ „zatiaľ nenačítané"  │ kruh    │ počkať / otvoriť stránku  │
 *   │ `locked`  │ „zamknuté"           │ zámok   │ doplniť kľúč (Nastavenia) │
 *   └───────────┴──────────────────────┴─────────┴───────────────────────────┘
 *
 * Rozlišujú ich TRI kanály naraz, nikdy len jeden:
 *
 *  1. **Slovo.** Jediný kanál, ktorý prejde cez farbosleposť aj cez čítačku
 *     obrazovky. Preto je povinné a stojí hneď za pomlčkou.
 *  2. **Značka.** `<Icon>` z jedinej sady, nikdy textový glyf a nikdy emodži.
 *     Tvary nesú presne ten význam, aký majú v sade zapísaný.
 *  3. **Odtieň.** Prázdno je vždy `--dim`, hodnota `--ink2`/`--ink`. Odtieň
 *     oddeľuje „hodnota" od „prázdna", NIE tri prázdna navzájom — na to je
 *     príliš slabý kanál a stavová škála (`--st-*`) sem nepatrí: chýbajúci
 *     údaj nie je závažnosť.
 *
 * Štvrtý kanál je `title` s celou vetou; nie je to náhrada za predošlé tri,
 * lebo `title` sa na dotykovej obrazovke nezobrazí.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 *  · **Zamknuté sa TU nevysvetľuje.** Vysvetlenie má jedno miesto
 *    (Nastavenia → Zamknuté funkcie, rozhodnutie K2). Tu je len slovo
 *    a značka; keby tu stála veta o tom, čo chýba, žila by v appke na
 *    desiatkach riadkov naraz a po prvej zmene by si protirečili.
 *  · **Pomlčka je vždy, slovo je vždy.** Ani jedno bez druhého: holá pomlčka
 *    nepovie, ktoré z troch prázdien to je, a holé slovo nevyzerá ako chýbajúca
 *    hodnota.
 *  · **Nula nie je prázdno.** `quantity: 0` je „vypredané" a kreslí sa ako
 *    hodnota. O tom rozhoduje `product-extras.ts`, nie tento súbor.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: E2, vlna „kód a EAN" 20. 8. 2026.
 */
import type { CSSProperties, ReactNode } from 'react';

import Icon from '@/components/ui/Icon';
import {
  ABSENCE_ICON,
  ABSENCE_TITLE,
  ABSENCE_WORD,
  KPI_GAP_ICON,
  KPI_GAP_TITLE,
  KPI_GAP_WORD,
  type AbsenceKind,
  type CodeLineView,
  type Field,
  type KpiField,
  type KpiGapKind,
} from '@/components/products/product-extras';

/** Pomlčka. Jedna na celý súbor — dva rôzne znaky by sa na oko nelíšili. */
const DASH = '—';

/**
 * Prázdno so slovom a značkou. Nikdy holá pomlčka.
 *
 * Značka má `aria-hidden` (predvolené v `<Icon>`): slovo stojí v tom istom
 * uzle, takže čítačka by inak prečítala ten istý stav dvakrát.
 */
export function AbsenceValue({ why, style }: { why: AbsenceKind; style?: CSSProperties }) {
  return (
    <span
      style={{ color: 'var(--dim)', fontWeight: 500, whiteSpace: 'nowrap', ...style }}
      title={ABSENCE_TITLE[why]}
      data-absence={why}
    >
      {DASH} <Icon name={ABSENCE_ICON[why]} size={0.8} /> {ABSENCE_WORD[why]}
    </span>
  );
}

/**
 * Hodnota, alebo to správne prázdno.
 *
 * `render` dostane hotovú hodnotu — formátovanie (euro, počet, dátum) patrí
 * volajúcemu, lebo len on vie, čo to číslo znamená.
 */
export function FieldValue<T>({
  field,
  render,
}: {
  field: Field<T>;
  render: (value: T) => ReactNode;
}) {
  if (!field.known) return <AbsenceValue why={field.why} />;
  return <>{render(field.value)}</>;
}

/* ═══════════ Prázdna čítacej vrstvy KPI (V4, D114/D118) ═══════════════════
 *
 * TEN ISTÝ TVAR, INÝ SLOVNÍK — a to je zámer.
 *
 * KPI z obohatenia majú vlastné dôvody chýbania (`KpiGapKind`
 * v `product-extras.ts`): „produkt nie je obohatený" nie je to isté ako „eshop
 * to nevedie" a ani jedno nie je to isté ako „dni chýbajú". Keby sa mapovali na
 * tri prázdna verejnej cesty, zliali by sa práve tie dva, ktoré I11 rozlišovať
 * káže — preto je tu druhá dvojica komponentov a nie prepočet na `AbsenceKind`.
 *
 * VYZERAJÚ ROVNAKO: pomlčka, značka, slovo, `title`. Rozdiel je len v tom, čo
 * to slovo hovorí. Používateľ sa nemá učiť dva jazyky prázdna.
 */

/** Prázdno KPI so slovom a značkou. Nikdy holá pomlčka, nikdy nula. */
export function KpiAbsence({ gap, style }: { gap: KpiGapKind; style?: CSSProperties }) {
  return (
    <span
      style={{ color: 'var(--dim)', fontWeight: 500, ...style }}
      title={KPI_GAP_TITLE[gap]}
      data-kpi-gap={gap}
    >
      {DASH} <Icon name={KPI_GAP_ICON[gap]} size={0.8} /> {KPI_GAP_WORD[gap]}
    </span>
  );
}

/** Hodnota KPI, alebo to správne prázdno. `0` je hodnota, nie prázdno. */
export function KpiValueText<T>({
  field,
  render,
}: {
  field: KpiField<T>;
  render: (value: T) => ReactNode;
}) {
  if (!field.known) return <KpiAbsence gap={field.gap} />;
  return <>{render(field.value)}</>;
}

/**
 * Druhý riadok pod názvom produktu v tabuľke.
 *
 * Je to `<div>`, nie `<span>`: v bunke `td.name` je `white-space: nowrap`
 * a výpustka, takže riadok musí mať vlastný rám, v ktorom sa oreže. Na úzkej
 * obrazovke (≤ 640 px) sa bunka mení na kartu a riadok sa zalomí s ňou.
 *
 * `11.5 px` je tá istá veľkosť, akú má vedľajší príznak (`.flag`) — dva
 * takmer rovnaké tlmené riadky pod jedným názvom by pri rôznej veľkosti
 * vyzerali ako chyba sadzby.
 */
const CODE_LINE: CSSProperties = {
  fontSize: '11.5px',
  fontWeight: 500,
  lineHeight: 1.25,
  marginTop: '2px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'inherit',
};

export function CodeLine({ line }: { line: CodeLineView }) {
  return (
    <div
      style={{ ...CODE_LINE, color: line.kind === 'value' ? 'var(--ink2)' : 'var(--dim)' }}
      title={line.title}
      data-testid="row-codes"
      data-codes={line.kind}
    >
      {line.icon === null ? null : (
        <>
          <Icon name={line.icon} size={0.8} />{' '}
        </>
      )}
      <span className="num">{line.text}</span>
    </div>
  );
}

export default CodeLine;
