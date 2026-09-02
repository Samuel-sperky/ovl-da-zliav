'use client';

/**
 * Aura Zľavy — ľavý panel filtrov tabu Produkty (V10; `design/v3/produkty.html`).
 *
 * Panel je 260 px široký, stále otvorený a hustý (na mobile sa vysunie cez
 * `.filters.open`). Dominanta obrazovky je TABUĽKA — tento panel je preto
 * zámerne tichý: malé písmo, žiadne karty, žiadne vysvetľujúce odstavce (P2).
 *
 * ZAMKNUTÉ FILTRE TU UŽ NIE SÚ (D125, K4 — 1. 9. 2026)
 * ────────────────────────────────────────────────────
 * Do 1. 9. 2026 mal panel na spodku skupinu „Zatiaľ nedostupné" so šiestimi
 * sivými riadkami (kategória, kov, typ šperku, obrátkovosť, sklad, marža) a
 * so siedmym o skutočnej zľave v eshope. **Celá zmizla**, lebo tie riadky boli
 * dve rôzne veci pod jedným priznaním:
 *
 *  · **Marža, sklad, obrátkovosť a posledný predaj zdroj MAJÚ** — `getFull` ich
 *    vracia a migrácia 0014 ich drží v zrkadle (`margin_percent`, `qty`,
 *    `qty_in_orders`, `last_time_in_order`). Sú preto nižšie ako NORMÁLNE
 *    filtre, v skupine s jednou vetou o tom, že platia nad obohatenými
 *    riadkami. Obrátkovosť pritom NEMÁ okno: `qty_in_orders` je celkové
 *    množstvo za históriu shopu, a tak sa aj menuje (R3 kontraktu V5).
 *  · **Kategória, kov a typ šperku zdroj NEMAJÚ** (kategórie sú v zrkadle len
 *    pole ID bez slovníka názvov). Podľa K4 filter bez dátového zdroja na
 *    obrazovke NEEXISTUJE — nie skrytý, nie sivý, ale žiadny. Že ich API
 *    neaplikuje, hlási `lockedFilters` v odpovedi; obrazovka ich nekreslí.
 *  · „Skutočná zľava v eshope" bola sivá zbytočne: filter „Zlacnené v shope"
 *    (D116) presne to robí — nad obohatenými riadkami a s priznaním.
 *
 * Vysvetlenie zamknutých vecí tým z tohto panela odišlo celé; jediné, čo
 * o hraniciach dát hovorí, je veta pri obohatených filtroch (I11).
 *
 * DVE SKUPINY O ZĽAVE, LEBO SÚ TO DVE RÔZNE VETY
 * ──────────────────────────────────────────────
 * „Zľavy podľa vlastných zápisov" hovorí, čo appka SAMA zapísala. „Zľava
 * v shope" hovorí, čo o produkte povedal SHOP pri obohatení
 * (`catalog_cache.reduction_*`, D116) — a to appka pozná LEN pri obohatených
 * riadkoch. Preto má tá skupina pod políčkom napísané, z koľkých riadkov
 * obohatených je: bez toho by zaškrtnuté políčko vydávalo dolnú hranicu za
 * počet produktov v zľave (I11). Kým čísla nie sú (`counts=0`), veta sa
 * nekreslí — nula by klamala tak isto.
 *
 * ZĽAVA JE VLASTNÝ ZÁPIS, NIE STAV ESHOPU
 * ───────────────────────────────────────
 * „Práve v zľave" a „nikdy nezlacnené" hovoria o tom, čo appka SAMA zapísala.
 * Nesie to NADPIS skupiny, nie poznámka pod ňou — poznámku pod skupinou nikto
 * nečíta a zámena týchto dvoch vecí je najdrahší omyl na tejto obrazovke.
 * Preto ten rozdiel drží NADPIS a pod políčkami zostáva jedna krátka veta.
 *
 * Čísla pri možnostiach sú z `counts` — meraný fakt, nie odhad (P7), preto sú
 * bez značky `≈`. Kým čísla nie sú, nekreslí sa nič; nula by klamala.
 *
 * PÔVOD RIADKU SA FILTRUJE INDE
 * ─────────────────────────────
 * `origin` (zrkadlo vs. dohľadané v eshope) nie je súčasťou `filter` a nesmie
 * ňou byť — zmena filtra spustí nový dotaz a dohľadané riadky zmiznú, takže
 * voľba „len dohľadané" by vrátila prázdnu tabuľku. Preto ho panel dostáva ako
 * dvojicu `origin` + `onOriginChange` od obrazovky, ktorá riadky drží.
 * Voliteľné sú zámerne: kým ich obrazovka neposiela, skupina sa NEKRESLÍ.
 * Vypínač, ktorý nič nerobí, je horší než chýbajúci vypínač.
 *
 * Vlastník: V10.
 */
import type { CatalogCountsView } from '@/components/products/catalog-api';
import type {
  CatalogFilterState,
  CatalogStock,
  LastSaleWindow,
  OriginFilter,
  ShopPresence,
  SoldBucket,
  SoldWindow,
} from '@/components/products/catalog-filter';
import { LAST_SALE_WINDOWS, SOLD_WINDOWS } from '@/components/products/catalog-filter';
import type { SavedFilter } from '@/components/products/saved-filters';
import { FilterChip } from '@/components/ui';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Popisy ════════════════════════════════════ */

/** Vedrá predajnosti tak, ako ich číta človek. Kódy zostávajú vnútri. */
const BUCKET_LABELS: ReadonlyArray<{ bucket: SoldBucket; label: string }> = [
  { bucket: 'none', label: '0 predaných' },
  { bucket: 'low', label: '1 – 2 predané' },
  { bucket: 'mid', label: '3 – 9 predaných' },
  { bucket: 'high', label: '10 a viac' },
];

/** Sklad z obohatenia (D125). Tri možnosti, z ktorých vždy platí práve jedna. */
const STOCK_LABELS: ReadonlyArray<{ value: CatalogStock; label: string }> = [
  { value: 'any', label: 'Bez ohľadu na sklad' },
  { value: 'in', label: 'Na sklade (viac než 0)' },
  { value: 'out', label: 'Vypredané (0 a menej)' },
];

/**
 * Čo eshop o produkte povedal pri poslednom načítaní. Tri vylučujúce sa
 * možnosti, z ktorých vždy platí práve jedna — pozri `ShopPresence`.
 */
const PRESENCE_LABELS: ReadonlyArray<{ value: ShopPresence; label: string }> = [
  { value: 'known', label: 'Ktoré eshop pozná' },
  { value: 'withMissing', label: 'Aj tie, ktoré už nevracia' },
  { value: 'onlyMissing', label: 'Len tie, ktoré už nevracia' },
];

/** Odkiaľ je riadok v tabuľke. Kreslí sa len vtedy, keď to obrazovka vie použiť. */
const ORIGIN_LABELS: ReadonlyArray<{ value: OriginFilter; label: string }> = [
  { value: 'all', label: 'Všetky riadky' },
  { value: 'mirror', label: 'Z načítaného katalógu' },
  { value: 'shop', label: 'Dohľadané v eshope' },
];

/* ═══════════════════════════ 2. Drobné kúsky ══════════════════════════════ */

/**
 * Dvojica polí „od – do" nad jedným číslom. Je to ten istý tvar, aký má cena —
 * dva rôzne tvary pre to isté by sa v hustom paneli čítali ako dve rôzne veci.
 */
function RangeRow({
  unit,
  fromValue,
  toValue,
  fromLabel,
  toLabel,
  testIdPrefix,
  onFrom,
  onTo,
}: {
  unit: string;
  fromValue: string;
  toValue: string;
  fromLabel: string;
  toLabel: string;
  testIdPrefix: string;
  onFrom: (next: string) => void;
  onTo: (next: string) => void;
}) {
  return (
    <div className="row">
      <input
        className="inp"
        style={{ width: '78px' }}
        inputMode="decimal"
        value={fromValue}
        aria-label={fromLabel}
        placeholder="od"
        onChange={(event) => onFrom(event.target.value)}
        data-testid={`${testIdPrefix}-from`}
      />
      <span className="lvl-3">–</span>
      <input
        className="inp"
        style={{ width: '78px' }}
        inputMode="decimal"
        value={toValue}
        aria-label={toLabel}
        placeholder="do"
        onChange={(event) => onTo(event.target.value)}
        data-testid={`${testIdPrefix}-to`}
      />
      <span className="lvl-3">{unit}</span>
    </div>
  );
}

function Count({ value }: { value: number | null }) {
  if (value === null) return null;
  return <span className="c num">{formatCountSk(value)}</span>;
}

/**
 * Skupina možností, z ktorých platí práve jedna. Prepínač, nie zaškrtávacie
 * políčka: pri políčkach by „nič nezaškrtnuté" muselo niečo znamenať, a to,
 * čo by znamenalo (predvolený stav servera), by v paneli nebolo vidieť.
 */
function ChoiceGroup<T extends string>({
  name,
  options,
  value,
  onPick,
  testIdPrefix,
}: {
  name: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onPick: (next: T) => void;
  testIdPrefix: string;
}) {
  return (
    <>
      {options.map((option) => (
        <label className="fopt" key={option.value}>
          <input
            className="cb"
            type="radio"
            name={name}
            checked={option.value === value}
            onChange={() => onPick(option.value)}
            data-testid={`${testIdPrefix}-${option.value}`}
          />
          {option.label}
        </label>
      ))}
    </>
  );
}

/* ═══════════════════════════ 3. Panel ═════════════════════════════════════ */

export interface CatalogFiltersProps {
  filter: CatalogFilterState;
  counts: CatalogCountsView | null;
  saved: readonly SavedFilter[];
  /** Meno uloženého filtra, ktorý presne sedí s aktuálnym stavom. */
  activeSaved: string | null;
  /** Otvorený panel na mobile. Na desktope je otvorený vždy. */
  open: boolean;
  onChange: (patch: Partial<CatalogFilterState>) => void;
  onApplySaved: (query: string) => void;
  onRemoveSaved: (name: string) => void;
  /**
   * Pôvod riadku — NIE je súčasťou filtra (pozri hlavičku modulu). Kým
   * obrazovka dvojicu neposiela, skupina sa vôbec nekreslí.
   */
  origin?: OriginFilter;
  onOriginChange?: (origin: OriginFilter) => void;
}

export function CatalogFilters({
  filter,
  counts,
  saved,
  activeSaved,
  open,
  onChange,
  onApplySaved,
  onRemoveSaved,
  origin,
  onOriginChange,
}: CatalogFiltersProps) {
  function toggleBucket(bucket: SoldBucket, on: boolean) {
    const next = on
      ? [...filter.soldBuckets, bucket]
      : filter.soldBuckets.filter((b) => b !== bucket);
    onChange({ soldBuckets: next, page: 1 });
  }

  const soldCount = (bucket: SoldBucket): number | null =>
    counts === null ? null : counts.sold[bucket];

  return (
    <aside className={open ? 'filters open' : 'filters'} data-testid="catalog-filters">
      {saved.length > 0 ? (
        <div className="fgroup">
          <h3>Uložené filtre</h3>
          {/* ZNAČKA PLATNÉHO FILTRA JE `FilterChip` (V6b, D137/D139/D142).
              Do V6b to bol `<span class="chip on">` s dvoma tlačidlami bez
              vzhľadu — a stav „tento filter práve platí" nesla VÝHRADNE farba
              (`.chip.on` v `globals.css` mení pozadie, rám a farbu textu, a nič
              viac). `aria-pressed` je kanál pre čítačku, nie pre oko, takže
              vidiaci používateľ s deuteranopiou nemal z toho ani jeden. Primitívum
              pridáva ZNAČKU vedľa slova, teda tretí kanál (kontrakt V6 §4 bod 3),
              a nesie ho `data-selected` na obale.

              Trieda `.chip` v `globals.css` zostáva — kreslí ju sprievodca novej
              zľavy (`chip lock`), takže mazať sa nesmie (D139). */}
          <div className="chips">
            {saved.map((row) => (
              <FilterChip
                key={row.name}
                label={row.name}
                active={row.name === activeSaved}
                onApply={() => onApplySaved(row.query)}
                onRemove={() => onRemoveSaved(row.name)}
                /* Uložený filter sa ZABÚDA, nie ruší: predvolené „Zrušiť
                   filter …" by tvrdilo, že klik vypne filtrovanie, kým on
                   zmaže pomenovanie. */
                removeLabel={`Zabudnúť uložený filter ${row.name}`}
                testId={`saved-filter-${row.name}`}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="fgroup">
        <h3>Obdobie</h3>
        {/* `role="group"` nie je ozdoba: na `<div>` bez roly je `aria-label`
            podľa ARIA neplatný a čítačka ho zahodí — z prepínača potom zostane
            „30, 60, 90, 180, 360" bez toho, čo tie čísla znamenajú. */}
        <div className="seg" role="group" aria-label="Za koľko dní sa počítajú predané kusy">
          {SOLD_WINDOWS.map((days: SoldWindow) => (
            <button
              key={days}
              type="button"
              className={days === filter.soldWindowDays ? 'on' : undefined}
              aria-pressed={days === filter.soldWindowDays}
              onClick={() => onChange({ soldWindowDays: days, page: 1 })}
            >
              {days}
            </button>
          ))}
        </div>
      </div>

      <div className="fgroup">
        <h3>Predajnosť</h3>
        {BUCKET_LABELS.map(({ bucket, label }) => (
          <label className="fopt" key={bucket}>
            <input
              className="cb"
              type="checkbox"
              checked={filter.soldBuckets.includes(bucket)}
              onChange={(event) => toggleBucket(bucket, event.target.checked)}
              data-testid={`filter-sold-${bucket}`}
            />
            {label}
            <Count value={soldCount(bucket)} />
          </label>
        ))}
        {/*
         * D121 — vedrá hovoria len o produktoch, ktorých predaj appka ZMERALA.
         * Pri nedočítanom okne je „0 predaných" nula (server prepne bránu na
         * `1 = 0`), takže súčet vedier je zlomok `total` a bez tohto riadku by
         * chýbajúce desaťtisíce riadkov zmizli bez slova — používateľ zaklikne
         * „0 predaných", dostane prázdny zoznam a v paneli číslo 0.
         * `null` = odpoveď to nepovedala, teda „nevieme koľko nevieme".
         */}
        {counts === null ? null : (
          <p className="lvl-3" data-testid="filter-sold-unknown">
            {counts.soldUnknown === null
              ? 'Koľko produktov má predaj neznámy, sa nedalo zistiť.'
              : counts.soldUnknown === 0
                ? null
                : `${formatCountSk(counts.soldUnknown)} ${pluralSk(
                    counts.soldUnknown,
                    'produkt má',
                    'produkty majú',
                    'produktov má',
                  )} predaj za toto okno NEZNÁMY — do vedier sa nepočítajú a ani jedno ich nevyberie.`}
          </p>
        )}
      </div>

      <div className="fgroup">
        <h3>Cena</h3>
        <div className="row">
          <input
            className="inp"
            style={{ width: '78px' }}
            inputMode="decimal"
            value={filter.priceFrom}
            aria-label="Cena od"
            placeholder="od"
            onChange={(event) => onChange({ priceFrom: event.target.value, page: 1 })}
            data-testid="filter-price-from"
          />
          <span className="lvl-3">–</span>
          <input
            className="inp"
            style={{ width: '78px' }}
            inputMode="decimal"
            value={filter.priceTo}
            aria-label="Cena do"
            placeholder="do"
            onChange={(event) => onChange({ priceTo: event.target.value, page: 1 })}
            data-testid="filter-price-to"
          />
          <span className="lvl-3">€</span>
        </div>
      </div>

      {/* Nadpis hovorí, čo tie dve políčka naozaj vedia. „História zliav" by
          sľubovala stav eshopu — appka ho nepozná a políčka ho nefiltrujú. */}
      <div className="fgroup">
        <h3>Zľavy podľa vlastných zápisov</h3>
        {/* Odkedy má tabuľka aj stĺpec „Zľava v shope" (V4 D114), musí byť
            povedané, ktorá z tých dvoch viet sa dá filtrovať. Podľa shopu to
            nejde a nemá ísť: jeho odpoveď appka pozná len pri OBOHATENÝCH
            produktoch, takže taký filter by sa pýtal na zlomok katalógu
            a vydával ho za celok (I11). */}
        <p className="lvl-3" data-testid="filter-discount-source-note">
          Filtruje sa podľa toho, čo zapísala appka. Čo o zľave hovorí shop, je
          v stĺpci „Zľava v shope“ — a len pri obohatených produktoch.
        </p>
        <label className="fopt">
          <input
            className="cb"
            type="checkbox"
            checked={filter.currentlyDiscounted}
            onChange={(event) => onChange({ currentlyDiscounted: event.target.checked, page: 1 })}
            data-testid="filter-discounted-now"
          />
          Práve v zľave
          <Count value={counts === null ? null : counts.discountedNow} />
        </label>
        <label className="fopt">
          <input
            className="cb"
            type="checkbox"
            checked={filter.neverDiscounted}
            onChange={(event) => onChange({ neverDiscounted: event.target.checked, page: 1 })}
            data-testid="filter-never-discounted"
          />
          Nikdy nezlacnené
          <Count value={counts === null ? null : counts.neverDiscounted} />
        </label>
      </div>

      {/* Stav zľavy PODĽA SHOPU (D116) — vlastná skupina, nie tretie políčko
          v skupine vyššie: tam by sa dve rôzne tvrdenia o tom istom produkte
          čítali ako jedno. Poznámka pod políčkom priznáva, že appka pozná stav
          shopu len pri obohatených riadkoch (I11). */}
      <div className="fgroup">
        <h3>Zľava v shope</h3>
        <label className="fopt">
          <input
            className="cb"
            type="checkbox"
            checked={filter.shopDiscounted}
            onChange={(event) => onChange({ shopDiscounted: event.target.checked, page: 1 })}
            data-testid="filter-shop-discounted"
          />
          Zlacnené v shope
          <Count value={counts === null ? null : counts.shopDiscountedNow} />
        </label>
        {counts === null ? null : (
          <div className="lvl-3" style={{ marginTop: '6px' }} data-testid="filter-shop-discounted-scope">
            {`Z ${formatCountSk(counts.enrichedRows)} obohatených produktov`}
          </div>
        )}
      </div>

      {/*
       * ĎALŠIE ÚDAJE Z OBOHATENIA (D125, K4) — filtre, ktoré appka NAOZAJ vie
       * naplniť: `margin_percent`, `qty`, `qty_in_orders`, `last_time_in_order`
       * z `getFull` (migrácia 0014). Do 1. 9. 2026 boli sivé v skupine „Zatiaľ
       * nedostupné", hoci pole v schéme bolo — priznanie bez dôvodu.
       *
       * Jedna veta na spodku hovorí, z koľkých riadkov odpoveď je: neobohatený
       * produkt sa do výsledku NEDOSTANE, a bez toho čísla by prázdna tabuľka
       * vyzerala ako „také produkty neexistujú" namiesto „toľko ich vieme" (I11).
       */}
      <div className="fgroup" data-testid="filter-enriched">
        <h3>Marža</h3>
        <RangeRow
          unit="%"
          fromValue={filter.marginPercentFrom}
          toValue={filter.marginPercentTo}
          fromLabel="Marža od (%)"
          toLabel="Marža do (%)"
          testIdPrefix="filter-margin"
          onFrom={(value) => onChange({ marginPercentFrom: value, page: 1 })}
          onTo={(value) => onChange({ marginPercentTo: value, page: 1 })}
        />
        {/* Marža prichádza zo shopu hotová — appka ju NEPOČÍTA (0014, bod 2).
            Veta to hovorí, aby nikto nehľadal vzorec, ktorý v appke nie je. */}
        <p className="lvl-3" data-testid="filter-margin-note">
          Percento marže tak, ako ho posiela shop. Appka ju neprepočítava.
        </p>

        <h3>Sklad</h3>
        <ChoiceGroup
          name="stock"
          options={STOCK_LABELS}
          value={filter.stock}
          onPick={(value) => onChange({ stock: value, page: 1 })}
          testIdPrefix="filter-stock"
        />

        {/* NÁZOV NESĽUBUJE OKNO (R3). `qty_in_orders` je celkové množstvo za
            históriu shopu; „obrátkovosť za 30 dní" sa bez histórie objednávok
            vypočítať nedá, takže sa tak ani nemenuje. */}
        <h3>Celkovo objednané</h3>
        <RangeRow
          unit="ks"
          fromValue={filter.orderedTotalFrom}
          toValue={filter.orderedTotalTo}
          fromLabel="Celkovo objednané od (ks)"
          toLabel="Celkovo objednané do (ks)"
          testIdPrefix="filter-ordered"
          onFrom={(value) => onChange({ orderedTotalFrom: value, page: 1 })}
          onTo={(value) => onChange({ orderedTotalTo: value, page: 1 })}
        />
        <p className="lvl-3" data-testid="filter-ordered-note">
          Za celú históriu eshopu, NIE za zvolené obdobie — obrátkovosť za okno
          appka nemá z čoho počítať.
        </p>

        <h3>Posledný predaj</h3>
        <div className="seg" role="group" aria-label="Posledný predaj starší než">
          {/* `null` = bez filtra. Prepínač, nie políčka: „starší než 90 aj 180"
              je tá istá otázka dvakrát. */}
          <button
            type="button"
            className={filter.lastSaleOlderDays === null ? 'on' : undefined}
            aria-pressed={filter.lastSaleOlderDays === null}
            onClick={() => onChange({ lastSaleOlderDays: null, page: 1 })}
            data-testid="filter-last-sale-any"
          >
            všetky
          </button>
          {LAST_SALE_WINDOWS.map((days: LastSaleWindow) => (
            <button
              key={days}
              type="button"
              className={filter.lastSaleOlderDays === days ? 'on' : undefined}
              aria-pressed={filter.lastSaleOlderDays === days}
              onClick={() => onChange({ lastSaleOlderDays: days, page: 1 })}
              data-testid={`filter-last-sale-${days}`}
            >
              {`> ${days} d`}
            </button>
          ))}
        </div>
        <p className="lvl-3" data-testid="filter-last-sale-note">
          Vrátane produktov, o ktorých shop nevie žiadny predaj — to sú tie
          najhoršie ležiaky a vynechať ich by filter pokazilo.
        </p>

        {counts === null ? null : (
          <div className="lvl-3" style={{ marginTop: '6px' }} data-testid="filter-enriched-scope">
            {`Tieto štyri filtre platia len pre ${formatCountSk(
              counts.enrichedRows,
            )} obohatených produktov; o ostatných appka tieto čísla nepozná a nevráti ich.`}
          </div>
        )}
      </div>

      {/* Stav v eshope je fail-closed: predvolene sa neponúkajú kusy, ktoré
          eshop pri poslednom načítaní nenašiel. Dostať sa k nim ale musí dať —
          práve tie treba z výberu odobrať alebo skontrolovať. */}
      <div className="fgroup">
        <h3>Stav v eshope</h3>
        <ChoiceGroup
          name="shop-presence"
          options={PRESENCE_LABELS}
          value={filter.shopPresence}
          onPick={(value) => onChange({ shopPresence: value, page: 1 })}
          testIdPrefix="filter-presence"
        />
      </div>

      {origin === undefined || onOriginChange === undefined ? null : (
        <div className="fgroup" data-testid="filter-origin">
          <h3>Odkiaľ je riadok</h3>
          <ChoiceGroup
            name="row-origin"
            options={ORIGIN_LABELS}
            value={origin}
            onPick={onOriginChange}
            testIdPrefix="filter-origin"
          />
        </div>
      )}

    </aside>
  );
}

export default CatalogFilters;
