'use client';

/**
 * Aura Zľavy — ľavý panel filtrov tabu Produkty (V10; `design/v3/produkty.html`).
 *
 * Panel je 260 px široký, stále otvorený a hustý (na mobile sa vysunie cez
 * `.filters.open`). Dominanta obrazovky je TABUĽKA — tento panel je preto
 * zámerne tichý: malé písmo, žiadne karty, žiadne vysvetľujúce odstavce (P2).
 *
 * Zamknuté filtre (K8, architektúra §5) — JEDNA SKUPINA, JEDNO VYSVETLENIE
 * ───────────────────────────────────────────────────────────────────────
 * Kategória, kov, typ šperku, marža, obrátkovosť a sklad sú v zozname
 * VIDITEĽNÉ, sivé a neklikateľné — nesmú byť skryté ani predstierané. Ich
 * zoznam sa NEPÍŠE natvrdo do obrazovky: prichádza z odpovede API
 * (`lockedFilters`). Keď dáta zo shopu pribudnú, filter zmizne zo zoznamu
 * v repozitári a táto obrazovka ho prestane kresliť sivý sama od seba.
 *
 * Do 19. 8. 2026 boli zamknuté filtre v paneli DVOMA rôznymi spôsobmi naraz
 * (D9): obrátkovosť visela pod Predajnosťou, sklad mal vlastnú skupinu
 * s jediným sivým riadkom, skutočná zľava sedela medzi zaškrtávacími políčkami
 * a kategória, kov, typ a marža stáli zvlášť v skupine „Zatiaľ nedostupné".
 * Ten istý stav sa dal prečítať v troch rôznych tvaroch a vysvetlenie k nemu
 * bolo na dvoch miestach. Teraz je zamknuté JEDNOU skupinou na spodku panela,
 * s jednou vetou a jedným odkazom do Nastavení — kontrakt UI, bod 18:
 * vysvetlenie žije na jedinom mieste (`LockedFeatures.tsx`) a NEROZŠIRUJE sa.
 *
 * „Skutočná zľava v eshope" je v tej skupine tiež, hoci ju API do
 * `lockedFilters` neposiela: nie je to filter nad stĺpcom zrkadla, ale
 * schopnosť, ktorú appka celú nemá. Až API začne vedieť filtrovať podľa
 * skutočnej zľavy, tento riadok odtiaľto zmizne.
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
 * Riadok „Skutočná zľava v eshope" zostáva medzi zamknutými: filter nad
 * obohatenými riadkami NIE JE stav zľavy celého katalógu a zliať to dvoje by
 * bolo presne to tvrdenie, ktoré K8 zakazuje.
 *
 * ZĽAVA JE VLASTNÝ ZÁPIS, NIE STAV ESHOPU
 * ───────────────────────────────────────
 * „Práve v zľave" a „nikdy nezlacnené" hovoria o tom, čo appka SAMA zapísala.
 * Nesie to NADPIS skupiny, nie poznámka pod ňou — poznámku pod skupinou nikto
 * nečíta a zámena týchto dvoch vecí je najdrahší omyl na tejto obrazovke.
 * Preto ten rozdiel drží nadpis aj po presune zamknutého riadku o skupinu
 * nižšie, a pod políčkami zostáva jedna krátka veta. Riadok „Skutočná zľava
 * v eshope" bol pri nich druhou poistkou, nie jedinou.
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
import type { CSSProperties } from 'react';

import type { CatalogCountsView, LockedFilterView } from '@/components/products/catalog-api';
import type {
  CatalogFilterState,
  OriginFilter,
  ShopPresence,
  SoldBucket,
  SoldWindow,
} from '@/components/products/catalog-filter';
import { SOLD_WINDOWS } from '@/components/products/catalog-filter';
import type { SavedFilter } from '@/components/products/saved-filters';
import Icon from '@/components/ui/Icon';
import { formatCountSk, pluralSk, SURFACE_TERMS } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Popisy ════════════════════════════════════ */

/** Vedrá predajnosti tak, ako ich číta človek. Kódy zostávajú vnútri. */
const BUCKET_LABELS: ReadonlyArray<{ bucket: SoldBucket; label: string }> = [
  { bucket: 'none', label: '0 predaných' },
  { bucket: 'low', label: '1 – 2 predané' },
  { bucket: 'mid', label: '3 – 9 predaných' },
  { bucket: 'high', label: '10 a viac' },
];

/**
 * Slovenské meno zamknutého filtra. Kľúče sú kódy z API — keď pribudne nový,
 * dostane meno tu; bez mena sa nekreslí vôbec (radšej nič než kód na povrchu).
 */
const LOCKED_LABELS: Readonly<Record<string, string>> = {
  stock: 'Sklad',
  turnover: 'Obrátkovosť',
  category: 'Kategória',
  metal: 'Kov',
  jewelryType: 'Typ šperku',
  margin: 'Marža',
};

/**
 * Poradie zamknutých filtrov v jedinej skupine „Zatiaľ nedostupné" (D9).
 * Zhora to, čo si používateľ pýta najčastejšie. Kód, ktorý tu nie je, sa
 * nekreslí — radšej nič než kód na povrchu (P3).
 */
const LOCKED_ORDER = ['category', 'metal', 'jewelryType', 'turnover', 'stock', 'margin'] as const;

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
 * Tlačidlo bez vlastného vzhľadu — vzhľad nesie obal `.chip`. Dve tlačidlá
 * vedľa seba namiesto tlačidla v tlačidle: vnorené interaktívne prvky sú
 * neplatné HTML a klávesnica sa v nich stratí.
 */
const BARE_BUTTON: CSSProperties = {
  background: 'transparent',
  border: 0,
  padding: 0,
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

function LockedOption({
  label,
  testId,
}: {
  label: string;
  testId?: string | undefined;
}) {
  return (
    <div
      className="fopt locked"
      aria-disabled="true"
      title={SURFACE_TERMS.lockedFeature}
      data-testid={testId}
    >
      {label}
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
  lockedFilters: Readonly<Record<string, LockedFilterView>>;
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
  lockedFilters,
  saved,
  activeSaved,
  open,
  onChange,
  onApplySaved,
  onRemoveSaved,
  origin,
  onOriginChange,
}: CatalogFiltersProps) {
  const locked = Object.keys(lockedFilters);
  /** Zamknuté filtre v jednom zozname a v stálom poradí — pozri hlavičku (D9). */
  const lockedRows = LOCKED_ORDER.filter((code) => locked.includes(code)).map((code) => ({
    code: code as string,
    label: LOCKED_LABELS[code] as string,
  }));

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
          <div className="chips">
            {saved.map((row) => (
              <span key={row.name} className={row.name === activeSaved ? 'chip on' : 'chip'}>
                {/* Že filter práve platí, hovorí trieda `on` na obale — teda
                    pozadie a farba textu, a nič iné. `aria-pressed` patrí na
                    tlačidlo, lebo obal je `<span>` bez roly. */}
                <button
                  type="button"
                  style={BARE_BUTTON}
                  aria-pressed={row.name === activeSaved}
                  onClick={() => onApplySaved(row.query)}
                  data-testid={`saved-filter-${row.name}`}
                >
                  {row.name}
                </button>
                <button
                  type="button"
                  className="x"
                  style={BARE_BUTTON}
                  aria-label={`Zabudnúť uložený filter ${row.name}`}
                  onClick={() => onRemoveSaved(row.name)}
                >
                  {/* Rovnaká ikona ako v šuplíku aj v detaile produktu —
                      appka mala do 19. 8. 2026 na „zavrieť" tri rôzne znaky:
                      U+2715 dvakrát a U+00D7 raz. */}
                  <Icon name="x" size={0.85} />
                </button>
              </span>
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

      {/* JEDINÉ miesto so zamknutými filtrami (D9). Skupina stojí na spodku,
          lebo sa ňou nedá pracovať — je to priznanie, nie ovládanie. Vysvetlenie
          je jedna veta a jeden odkaz; celé žije v `LockedFeatures.tsx` a tu sa
          NEROZŠIRUJE (kontrakt UI, bod 18). */}
      <div className="fgroup" data-testid="filter-locked">
        <h3>Zatiaľ nedostupné</h3>
        {lockedRows.map((row) => (
          <LockedOption key={row.code} label={row.label} />
        ))}
        {/* Skutočná zľava v eshope nie je stĺpec zrkadla, takže ju API do
            `lockedFilters` nepošle — a napriek tomu musí byť vidieť. */}
        <LockedOption label="Skutočná zľava v eshope" testId="filter-real-discount" />
        <div className="lvl-3" style={{ marginTop: '6px' }}>
          {SURFACE_TERMS.lockedFeature} · <a href="/nastavenia#zamknute">viac</a>
        </div>
      </div>
    </aside>
  );
}

export default CatalogFilters;
