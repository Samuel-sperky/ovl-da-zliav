/**
 * Aura Zľavy — ako sa produkt POMENUJE na obrazovke (D116, 28. 8. 2026).
 *
 * Do 28. 8. 2026 obrazovky ukazovali `product_id`. Pre appku je to správny
 * identifikátor, pre človeka slepé číslo: v sklade ani v eshope podľa neho
 * produkt nenájde. Odteraz je na povrchu **`referencia · názov`** a `id` sa
 * sťahuje do technického detailu.
 *
 * PREČO JE TO JEDEN MODUL A NIE ŠTYRI KÓPIE
 * -----------------------------------------
 * Produkt sa pomenúva na štyroch miestach (Produkty, detail, položky zľavy,
 * História) a keby si každé písalo vlastné skladanie, rozišli by sa v tom, čo
 * robia s chýbajúcou referenciou — a práve to je tá zaujímavá otázka.
 *
 * CHÝBAJÚCA REFERENCIA JE „NEVIEME", NIE PRÁZDNO (I11)
 * ----------------------------------------------------
 * Referencia je pole z `getFull`, ktoré appka pozná len pre OBOHATENÉ produkty
 * (D118 — obohacuje sa prioritizovane, nie plošne). Neobohatený produkt teda
 * referenciu nemá a nesmie sa tváriť, že ju nemá SHOP. Preto sa nikdy nevracia
 * prázdny reťazec: `reference === null` dá pomlčku a `id` zostane viditeľné,
 * aby sa produkt dal aspoň identifikovať.
 *
 * Vlastník: V4.
 */

/** Pomlčka, ktorou appka hovorí „toto nevieme" (nie „toto je prázdne"). */
export const NEVIEME = '—';

export interface ProductLabelInput {
  readonly productId: number;
  /** Referencia z `getFull`. `null` = produkt nie je obohatený (D118). */
  readonly reference: string | null;
  /** Názov z katalógu. `null` = zrkadlo ho ešte nemá. */
  readonly name: string | null;
}

export interface ProductLabel {
  /** Čo sa ukáže na povrchu: `referencia · názov`, alebo čo z toho vieme. */
  readonly text: string;
  /** Referencia sama, alebo pomlčka — pre stĺpec, ktorý ju chce zvlášť. */
  readonly reference: string;
  /** Názov sám, alebo pomlčka. */
  readonly name: string;
  /** Vždy `#<id>` — patrí do technického detailu, nie na povrch. */
  readonly technical: string;
  /**
   * `true` = referenciu nepoznáme, lebo produkt NIE JE obohatený. Obrazovka
   * to smie priznať (napr. tichým „zatiaľ nevieme"), ale NESMIE to vydávať
   * za to, že produkt referenciu nemá.
   */
  readonly referenceUnknown: boolean;
}

/**
 * Zloží pomenovanie produktu pre obrazovku.
 *
 * Poradie je zámerné — referencia PRVÁ: podľa nej sa produkt hľadá v sklade
 * a v administrácii eshopu, názvy sa opakujú („Náramok z chirurgickej ocele…").
 */
export function productLabel(input: ProductLabelInput): ProductLabel {
  const reference = nonEmpty(input.reference);
  const name = nonEmpty(input.name);

  /* Prázdny reťazec zo shopu je to isté ako `null` — „nevieme", nie „je to
     bez referencie". Zrkadlo ukladá prázdne hodnoty ako NULL, ale odpoveď
     shopu sa môže zmeniť a obrazovka to nesmie odniesť. */
  const referenceUnknown = reference === null;

  let text: string;
  if (reference !== null && name !== null) text = `${reference} · ${name}`;
  else if (reference !== null) text = reference;
  else if (name !== null) text = name;
  else text = `#${input.productId}`;

  return {
    text,
    reference: reference ?? NEVIEME,
    name: name ?? NEVIEME,
    technical: `#${input.productId}`,
    referenceUnknown,
  };
}

/** `null`, `undefined` aj `'   '` znamenajú to isté: nevieme. */
function nonEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
