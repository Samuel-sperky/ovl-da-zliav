'use client';

/**
 * Aura Zľavy — tab Produkty (V10; `design/v3/produkty.html`, architektúra §1).
 *
 * Odpovedá na otázku „ktoré konkrétne kusy a aké majú čísla". Preto tu NIE SÚ
 * tržby eshopu — tie patria do Prehľadu a hranica medzi obrazovkami je tvrdá
 * (architektúra §1). Táto obrazovka nikdy nesčítava peniaze; sčítava kusy.
 *
 * Rozloženie: hore karta so stavom katalógu, pod ňou ľavý panel filtrov 260 px
 * (stále otvorený) a zvyšok tabuľka. Dominanta je TABUĽKA (P1) a skroluje
 * výhradne ona, vo vlastnom ráme (P4).
 *
 * Prečo je karta katalógu PRVÁ
 * ────────────────────────────
 * Tabuľka vyzerá rovnako, či je katalóg celý, alebo z neho appka videla tridsať
 * stránok. Zrkadlo je k 19. 8. 2026, 00:13 úplné (41 220 z 41 220), lenže eshop
 * medzitým pridáva a maže a prechod sa môže zaseknúť na rozpočte čítaní. Bez
 * tej karty by si používateľ vybral 150 kusov zo zlomku eshopu a nemal by ako
 * to zistiť. Preto je stav katalógu prvá vec na obrazovke, nie posledná.
 *
 * Výber a jeho dve podoby
 * ───────────────────────
 * Naklikané riadky sa držia v množine čísel a prežijú prechod na ďalšiu
 * stránku aj prechod medzi tabmi (kontrakt UI, bod 17 — odloží ho
 * `catalog-selection.ts`). Hromadný výber („Vybrať všetkých 11 640") sa
 * NEROZBAĽUJE do zoznamu — je to príznak `allMatching` a do sprievodcu ide ako
 * FILTER. Zmena filtra výber zruší: ponechať výber z inej otázky by znamenalo
 * zlacniť niečo, na čo sa už používateľ nepozeral.
 *
 * Hľadanie: zrkadlo hneď, eshop na kliknutie
 * ──────────────────────────────────────────
 * Písanie do poľa hľadá v zrkadle — podľa NÁZVU a ČÍSLA produktu, slovo po
 * slove: „náramok zirkón" nájde všetky náramky so zirkónom bez ohľadu na
 * poradie slov, nie len tie, čo majú v názve práve túto dvojicu za sebou.
 * Eshop pozná navyše kód, popis aj kategórie, ale hľadanie v ňom míňa anonymný
 * rozpočet čítaní, takže sa NIKDY nespustí samo: je to tlačidlo, ktoré stojí
 * hneď pri poli a je dostupné vždy, keď je v hľadaní text — aj keď zrkadlo
 * niečo našlo. Tri nájdené názvy nie sú dôkaz, že v eshope nie je tridsať
 * ďalších, ktoré majú hľadané slovo len v kóde alebo v popise.
 *
 * Počet zhôd je pri neúplnom zrkadle DOLNÁ HRANICA
 * ────────────────────────────────────────────────
 * `total` z API je počet v zrkadle (`totalSource`), nie v eshope. Kým katalóg
 * nie je načítaný celý, obrazovka ho označí `≈` a stlmí (P7, kontrakt UI bod 8).
 * Keď sa stav katalógu nepodarí zistiť, `≈` tam OSTÁVA — neistota sa nemá ako
 * vyvrátiť a tvrdiť presné číslo by bolo horšie než priznať odhad.
 *
 * Prekážky výberu sa počítajú TU a lokálne
 * ────────────────────────────────────────
 * `GET /api/status` vracia prekážky pre PRÁZDNY výber. Obrazovka si ich
 * prepočítava nad vlastným výberom cez `statusSnapshotFromPayload()` — je to
 * jediná podporovaná cesta a šetrí volanie servera pri každom kliknutí na
 * zaškrtávacie políčko. Strop rozsahu je preto vidieť skôr, než doň niekto
 * narazí, a nie až ako tiché odmietnutie v sprievodcovi.
 *
 * `missingProductIds` sa dopĺňa LEN keď sa dá overiť
 * ──────────────────────────────────────────────────
 * Payload stavu ich zámerne nenesie a `blockers.ts` je fail-closed: neoverené
 * nie je to isté ako overene v poriadku. Obrazovka si preto pamätá stav
 * v shope pri každom riadku, ktorý používateľ videl, a zoznam pošle len vtedy,
 * keď pozná KAŽDÝ vybraný kus. Pri hromadnom výbere podľa filtra ho neposiela
 * vôbec — desaťtisíce riadkov nikto neoveroval a tvrdiť opak by bola lož.
 *
 * Čerstvosť dát je jeden sivý riadok nad tabuľkou a nikde inde (architektúra
 * §0). Je to MERANÝ čas posledného načítania katalógu, preto bez značky `≈`
 * (P7); keď ho ešte niet, obrazovka to povie, nedopočíta. Karta stavu katalógu
 * hovorí o POKROKU načítania, nie o čase — sú to dve rôzne veci.
 *
 * Graf rozdelenia cien je POD ROZKLIKOM — čo sa na ňom smie ticho pokaziť
 * ─────────────────────────────────────────────────────────────────────────
 *  1. **Rozklik sa zmení na sekciu.** Sekcie sú na tejto obrazovke štyri (stav
 *     katalógu, filtre, tabuľka, lišta výberu) a P5 povoľuje štyri. Piata sa
 *     nepridáva tým, že sa `<details>` „len otvorí natvrdo" — vtedy padne aj
 *     P4 (1,5 obrazovky pri 1440×900). Graf je technika, technika ide pod
 *     rozklik (P6).
 *  2. **Dotaz sa presunie do `useEffect` pri otvorení obrazovky.** Rozdelenie
 *     cien sa žiada AŽ pri prvom otvorení rozkliku. Kto to prevedie na efekt
 *     nad `[]`, pošle dotaz každému, kto na Produkty len nakukne.
 *  3. **Prázdny stav sa zamení za prázdny rám.** Kým `prices` nie sú, kreslí sa
 *     VETA. Osi bez stĺpcov tvrdia, že katalóg je prázdny — a `PriceHistogram`
 *     preto pri nulovom súčte vracia vetu, nie graf. Kto sem vloží graf
 *     s nulami, obíde to.
 *  4. **Značky pod osou začnú niečo dopočítavať.** Do grafu ide cena len tých
 *     vybraných kusov, ktoré sú na načítanej stránke (`priceMarks`). Vybraný
 *     kus z inej stránky cenu nemá a nesmie ju dostať domyslenú — a pri výbere
 *     „všetkých zhôd" sa značky nekreslia vôbec.
 *  5. **`complete` sa začne posielať ako `false`, keď stav katalógu chýba.**
 *     „Zrkadlo nie je celé" je meraný fakt, „nevieme, či je celé" je priznanie.
 *     Zliať ich znamená tvrdiť viac, než appka vie.
 *
 * Vlastník: V10.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import PriceHistogram from '@/components/charts/PriceHistogram';
import BlockerNotes from '@/components/products/BlockerNotes';
import CatalogFilters from '@/components/products/CatalogFilters';
import CatalogStatusPanel from '@/components/products/CatalogStatusPanel';
import CatalogTable from '@/components/products/CatalogTable';
import ProductDetailPanel from '@/components/products/ProductDetailPanel';
import SelectionBar from '@/components/products/SelectionBar';
import type {
  CatalogPricesView,
  CatalogSearchView,
  ShopStatus,
} from '@/components/products/catalog-api';
import {
  appStatus,
  catalogPrices,
  catalogSyncStatus,
  isAborted,
  runCatalogBatch,
  lookupInShop,
  searchCatalog,
} from '@/components/products/catalog-api';
import type { CatalogFilterState, CatalogSort, PerPage } from '@/components/products/catalog-filter';
import {
  catalogFilterKey,
  DEFAULT_CATALOG_FILTER,
  newDiscountHref,
  parseCatalogFilterQuery,
} from '@/components/products/catalog-filter';
import {
  readSelection,
  restoreSelection,
  writeSelection,
} from '@/components/products/catalog-selection';
import type { CatalogRunView, CatalogStatusView } from '@/components/products/catalog-status';
import {
  CATALOG_PANEL_BLOCKERS,
  catalogEmptyView,
  dropBlockers,
  filterIsNarrowed,
  pickBlockers,
  rowReason,
  SELECTION_BLOCKERS,
  toRunView,
} from '@/components/products/catalog-status';
import type { SavedFilter } from '@/components/products/saved-filters';
import { readSavedFilters, removeFilter, saveFilter } from '@/components/products/saved-filters';
import EmptyState from '@/components/ui/EmptyState';
import Note from '@/components/ui/Note';
import { LOGIC_TIME_ZONE } from '@/lib/domain/dates';
import { formatDateTimeSk } from '@/lib/ui/format';
import type { Blocker } from '@/lib/status/blockers';
import { collectOperationBlockers, collectProductBlockers } from '@/lib/status/blockers';
import type { StatusPayload, StatusSnapshotOverlay } from '@/lib/status/snapshot';
import { blockerFromWire, statusSnapshotFromPayload } from '@/lib/status/snapshot';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Čerstvosť dát ═════════════════════════════ */

/**
 * `Dáta k 10. 8. 03:00`. Deň sa počíta cez `Intl` v doménovej zóne — v UTC by
 * sa medzi 22:00 a polnocou ukazoval včerajšok. Formátovač sa vyrába vo
 * funkcii, nie na module scope: `next build` volá modul pri kompilácii.
 */
function dataAsOfSentence(iso: string | null): string {
  if (iso === null) return 'Katalóg sa zatiaľ nenačítal.';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Katalóg sa zatiaľ nenačítal.';
  // JEDEN tvar dátumu (kontrakt UI bod 10). Do 20. 8. 2026 si táto veta
  // skladala vlastný `Intl` bez roku (`Dáta k 10. 8. 03:00`), takže riadok
  // „Dáta k" mal na štyroch miestach štyri tvary. Teraz ho nesie `formatDateTimeSk`.
  return `Dáta k ${formatDateTimeSk(at)}`;
}

/**
 * `19. 8. 2026, 00:13` — presný okamih, ku ktorému zrkadlo platí. Rok je tu
 * navyše oproti riadku nad tabuľkou zámerne: táto veta stojí v prázdnom stave,
 * kde ide o to, či sa vôbec oplatí veriť tomu, že produkt neexistuje.
 * `null` = zrkadlo sa ešte nenačítalo, a vtedy sa čas NEDOPLŇUJE (P7).
 */
function mirrorAsOfPhrase(iso: string | null): string | null {
  if (iso === null) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const day = new Intl.DateTimeFormat('sk-SK', {
    timeZone: LOGIC_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(at);
  const time = new Intl.DateTimeFormat('sk-SK', {
    timeZone: LOGIC_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return `${day}, ${time}`;
}

/* ═══════════════════════════ 2. Obrazovka ═════════════════════════════════ */

export interface CatalogPanelProps {
  /** Filter z adresy — odkaz z Prehľadu vedie presne na jeden výber. */
  initialFilter?: CatalogFilterState;
}

export function CatalogPanel({ initialFilter }: CatalogPanelProps) {
  const [filter, setFilter] = useState<CatalogFilterState>(
    initialFilter ?? DEFAULT_CATALOG_FILTER,
  );
  const [queryDraft, setQueryDraft] = useState(filter.query);
  const [view, setView] = useState<CatalogSearchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [saved, setSaved] = useState<readonly SavedFilter[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Vynúti nové načítanie po chybe bez toho, aby sa dotkol filtra. */
  const [reloadTick, setReloadTick] = useState(0);

  /* Stav appky (prekážky, strop rozsahu) a stav katalógu. Oba sú lacné GETy. */
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [catalog, setCatalog] = useState<CatalogStatusView | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [lastRun, setLastRun] = useState<CatalogRunView | null>(null);
  const [running, setRunning] = useState(false);

  /**
   * DOHĽADANIE V ESHOPE (kontrakt UI, body 25–28).
   *
   * Zrkadlo katalógu má časť produktov, takže „ešte som to nenačítal" vyzerá
   * presne ako „taký produkt neexistuje". Toto ten rozdiel odstráni. Míňa ale
   * anonymný rozpočet čítaní, preto sa NIKDY nespúšťa samo pri písaní —
   * výhradne na kliknutie.
   */
  const [lookingUp, setLookingUp] = useState(false);
  /** Prepočíta stav po dávke, bez toho, aby sa dotkol filtra. */
  const [statusTick, setStatusTick] = useState(0);

  /**
   * ROZDELENIE CIEN (graf pod rozklikom).
   *
   * Načítava sa AŽ PRI PRVOM OTVORENÍ rozkliku, nie pri otvorení obrazovky.
   * Dôvod nie je výkon endpointu (je to jeden `GROUP BY` nad `catalog_cache`,
   * bez shopu), ale to, že graf je technika: kto ho neotvorí, nemá dôvod na
   * ďalší dotaz. `pricesAsked` drží, že sa už žiadalo — bez neho by každé
   * zavretie a otvorenie rozkliku poslalo dotaz znova.
   */
  const [prices, setPrices] = useState<CatalogPricesView | null>(null);
  const [pricesAsked, setPricesAsked] = useState(false);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesFailed, setPricesFailed] = useState(false);

  /** Filter bez stránkovania — dve stránky tej istej otázky sú tá istá otázka. */
  const filterKey = catalogFilterKey(filter);

  /**
   * Úzka obrazovka. Trieda `.filters-toggle` z návrhového systému je dnes
   * prebitá neskorším `display:none` mimo media query, takže by tlačidlo
   * zostalo skryté aj na mobile a panel filtrov by sa nedal otvoriť. Kým sa
   * to v globálnom CSS neopraví, rozhoduje o ňom `matchMedia` — nie trieda.
   * Prvý render je zámerne „široký": server o šírke okna nevie a blikajúce
   * tlačidlo je menšie zlo než nesúlad hydratácie.
   */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 760px)');
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  /* Uložené filtre — len raz, pri otvorení. */
  useEffect(() => {
    setSaved(readSavedFilters());
  }, []);

  /* Stav appky a stav katalógu. Ani jedno volanie nechodí na shop. */
  useEffect(() => {
    const controller = new AbortController();
    void appStatus(controller.signal).then((res) => {
      if (res.ok) {
        setStatus(res.data);
        setStatusFailed(false);
        return;
      }
      // Bez stavu appka nepozná stropy ani prekážky. Mlčať by znamenalo tváriť
      // sa, že nič neplatí — a to je presne ten druh ticha, kvôli ktorému
      // používateľ nevie, prečo sa niečo nestalo.
      if (!isAborted(res.error)) setStatusFailed(true);
    });
    void catalogSyncStatus(controller.signal).then((res) => {
      if (res.ok) {
        setCatalog(res.data.catalog);
        setCatalogFailed(false);
        return;
      }
      if (!isAborted(res.error)) setCatalogFailed(true);
    });
    return () => controller.abort();
  }, [statusTick]);

  /* Hľadanie sa neodosiela po každom znaku. */
  useEffect(() => {
    if (queryDraft === filter.query) return;
    const timer = setTimeout(() => {
      setFilter((current) => ({ ...current, query: queryDraft, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [queryDraft, filter.query]);

  /* Zmena filtra ruší výber — výber z inej otázky nesmie prejsť do zľavy. */
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return;
    lastFilterKey.current = filterKey;
    setSelected(new Set());
    setAllMatching(false);
  }, [filterKey]);

  /**
   * Obnova výberu z predošlej návštevy tabu (kontrakt UI, bod 17).
   *
   * Beží PRED prvým načítaním riadkov — inak by obrazovka stiahla predvolenú
   * otázku a o okamih ju zahodila. Efekt je zámerne AŽ ZA efektom vyššie:
   * pri pripojení komponentu bežia oba a keby bol prvý, obnovená otázka by sa
   * tomu druhému javila ako zmena filtra a zmazala by práve obnovený výber.
   * Z rovnakého dôvodu si prepíše aj `lastFilterKey` — obnova nie je zmena,
   * ktorú urobil človek.
   */
  const bootFilter = useRef(initialFilter ?? DEFAULT_CATALOG_FILTER);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const next = restoreSelection(bootFilter.current, readSelection());
    lastFilterKey.current = catalogFilterKey(next.filter);
    setFilter(next.filter);
    setQueryDraft(next.filter.query);
    setSelected(new Set(next.productIds));
    setAllMatching(next.allMatching);
    setRestored(true);
  }, []);

  /* Odloženie výberu. Prázdny výber sa neukladá — o to sa stará modul. */
  useEffect(() => {
    if (!restored) return;
    writeSelection({ filter: filterKey, productIds: [...selected], allMatching });
  }, [restored, filterKey, selected, allMatching]);

  /* Načítanie stránky katalógu. Zrušený dotaz NIE JE chyba — používateľ len
     rýchlo preklikol ďalej a hneď za ním beží nový, takže sa nechá „Načítavam". */
  useEffect(() => {
    if (!restored) return;
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    void searchCatalog(filter, controller.signal).then((res) => {
      if (!live) return;
      if (res.ok) {
        setView(res.data);
        setError(null);
        setLoading(false);
        return;
      }
      if (isAborted(res.error)) return;
      setError(res.error.message);
      setLoading(false);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [filter, reloadTick, restored]);

  const rows = useMemo(() => (view === null ? [] : view.data), [view]);

  /**
   * Načítanie rozdelenia cien — spúšťa ho výhradne otvorenie rozkliku.
   *
   * Nie je to `useEffect` nad `pricesAsked`: efekt by pri zlyhaní a ďalšom
   * otvorení už nikdy nezbehol. Takto je „skúsiť znova" to isté volanie.
   */
  const loadPrices = useCallback((): void => {
    setPricesAsked(true);
    setPricesLoading(true);
    void catalogPrices().then((res) => {
      setPricesLoading(false);
      if (res.ok) {
        setPrices(res.data);
        setPricesFailed(false);
        return;
      }
      // Zrušený dotaz nie je chyba; všetko ostatné obrazovka prizná.
      if (!isAborted(res.error)) setPricesFailed(true);
    });
  }, []);

  /**
   * Značky pod osou = ceny VYBRANÝCH produktov, a to len tých, ktorých cenu
   * appka naozaj vidí na načítanej stránke.
   *
   * Výber prežije stránkovanie, takže vybraný kus z inej stránky tu cenu nemá —
   * a dopočítať sa nedá. Značka „na nule" alebo domyslená cena by tvrdila niečo
   * o produkte, na ktorý sa nikto nepozeral. Preto sem ide len to, čo je merané,
   * a graf sa nesnaží tváriť, že pozná celý výber. Pri hromadnom výbere podľa
   * filtra (`allMatching`) sa značky nekreslia vôbec: desaťtisíce čiarok pod
   * osou nie sú informácia, sú to plný pás.
   */
  const priceMarks = useMemo(() => {
    if (allMatching || selected.size === 0) return [];
    const marks: Array<{ productId: number; price: number }> = [];
    for (const row of rows) {
      if (!selected.has(row.productId) || row.price === null) continue;
      const price = Number(row.price);
      if (Number.isFinite(price)) marks.push({ productId: row.productId, price });
    }
    return marks;
  }, [rows, selected, allMatching]);

  /**
   * Dohľadá v eshope to, čo zrkadlo nemá. Výhradne na kliknutie.
   *
   * Hľadá sa to, čo je vo FILTRI, nie to, čo je práve v poli — písmená do
   * filtra dobiehajú s odstupom a bez tejto poistky by kliknutie hneď po
   * doťukaní zaplatilo čítania za predošlé slovo. Tlačidlo je dovtedy vypnuté;
   * toto je druhý zámok, nie ten prvý.
   */
  async function lookupNow(): Promise<void> {
    if (filter.query.trim() === '') return;
    setLookingUp(true);
    const res = await lookupInShop(filter);
    setLookingUp(false);
    if (res.ok) {
      setView(res.data);
      setError(null);
      return;
    }
    if (!isAborted(res.error)) setError(res.error.message);
  }

  /**
   * Veta o poslednom dohľadaní. Hovorí MERANÉ fakty: koľko riadkov pribudlo
   * z eshopu a koľko sa ich nestihlo dotiahnuť. Žiadny odhad, teda ani `≈`.
   */
  const lookupNote = ((): string | null => {
    const lookup = view?.lookup;
    if (lookup === undefined || !lookup.requested) return null;
    if (lookup.error !== null) return 'Dohľadanie v eshope neprešlo.';
    if (lookup.addedFromShop === 0 && lookup.notFetched === 0) {
      return 'V eshope sa nenašlo nič ďalšie.';
    }
    const pribudlo = `Z eshopu pribudlo ${lookup.addedFromShop} produktov.`;
    return lookup.notFetched > 0
      ? `${pribudlo} Ďalších ${lookup.notFetched} sa nestihlo dotiahnuť — dnešný rozpočet čítaní.`
      : pribudlo;
  })();
  const matching = view === null ? 0 : view.total;
  const catalogTotal = view === null ? 0 : view.catalogTotal;

  /**
   * Dočítal posledný prechod zrkadlo po koniec? Nezisťuje sa to porovnávaním
   * čísel, ale výhradne z `catalog.complete` — a keď sa stav katalógu
   * nepodarilo zistiť, odpoveď je „nie". Fail-closed: nevedieť nie je to isté
   * ako mať celý eshop, a od tohto jedného príznaku visia dve tvrdenia na
   * obrazovke (značka `≈` a slovo za druhým číslom).
   */
  const catalogIsComplete = catalog !== null && catalog.complete;

  /**
   * P7 — je počet zhôd meraný fakt, alebo dolná hranica?
   *
   * Fakt je len vtedy, keď zrkadlo obsahuje celý eshop. Vo všetkých ostatných
   * prípadoch — vrátane toho, keď sa stav katalógu NEPODARILO zistiť — je to
   * dolná hranica a píše sa `≈`. Fail-closed je tu úmysel: neistota sa nemá
   * ako vyvrátiť a presné číslo by bolo tvrdenie, ktoré appka nemá kryté.
   */
  const matchingIsLowerBound = !catalogIsComplete;

  /** Je v hľadaní text, ktorý už dobehol do filtra? Bez neho nie je čo dohľadať. */
  const searchTerm = filter.query.trim();
  const searchDraft = queryDraft.trim();
  /** Kým doťukané písmená nedobehnú do filtra, dohľadalo by sa iné slovo. */
  const searchSettled = searchDraft === searchTerm;

  /**
   * Stav v shope pri každom riadku, ktorý používateľ počas tejto návštevy
   * videl. Bez toho sa výber naprieč stránkami nedá overiť — a neoverený výber
   * sa `blockers.ts` vyhodnotí prísnejšie, čo je správne, ale zbytočné.
   */
  const seenShopStatus = useRef(new Map<number, ShopStatus>());

  const pageSelected = useMemo(
    () => rows.filter((row) => selected.has(row.productId)).length,
    [rows, selected],
  );

  const detailRow = detailId === null ? undefined : rows.find((row) => row.productId === detailId);

  /* ─────────────────────── Prekážky nad vlastným výberom ─────────────────── */

  const selectedCount = allMatching ? matching : selected.size;

  /**
   * Ktoré z vybraných kusov shop nenašiel. `null` = nedá sa overiť a zoznam sa
   * NEPOSIELA — fail-closed je tu úmysel, nie opomenutie.
   */
  const verifiedMissing = useMemo<readonly number[] | null>(() => {
    // Mapa sa dopĺňa PRIAMO TU, nie vo `useEffect`: efekt beží až po vykreslení,
    // takže by tento prepočet vždy pracoval s predošlou stránkou. Zápis je
    // idempotentný — opakovaný beh memoizácie nič nepokazí.
    const seen = seenShopStatus.current;
    for (const row of rows) seen.set(row.productId, row.shopStatus);

    if (allMatching) return null;
    const ids = [...selected];
    if (!ids.every((id) => seen.has(id))) return null;
    return ids.filter((id) => seen.get(id) === 'not_found');
  }, [allMatching, selected, rows]);

  const selectionBlockers = useMemo<readonly Blocker[]>(() => {
    if (status === null) return [];
    const overlay: StatusSnapshotOverlay = {
      selection: { selectedCount },
      ...(verifiedMissing === null ? {} : { missingProductIds: verifiedMissing }),
    };
    const all = collectOperationBlockers(statusSnapshotFromPayload(status, overlay));
    return pickBlockers(all, SELECTION_BLOCKERS);
  }, [status, selectedCount, verifiedMissing]);

  const catalogBlockers = useMemo<readonly Blocker[]>(() => {
    if (status === null) return [];
    return pickBlockers(status.blockers.map(blockerFromWire), CATALOG_PANEL_BLOCKERS);
  }, [status]);

  const detailBlockers = useMemo<readonly Blocker[]>(() => {
    if (status === null || detailRow === undefined) return [];
    const snapshot = statusSnapshotFromPayload(status, {
      selection: { selectedCount: 1, productIds: [detailRow.productId] },
      missingProductIds: detailRow.shopStatus === 'not_found' ? [detailRow.productId] : [],
    });
    // Prekážky celého katalógu už stoja v karte nad tabuľkou — v paneli
    // o jednom kuse by to bola len druhá kópia tej istej vety.
    return dropBlockers(
      collectProductBlockers(detailRow.productId, snapshot),
      CATALOG_PANEL_BLOCKERS,
    );
  }, [status, detailRow]);

  /* ─────────────────────────── Ďalšia dávka katalógu ─────────────────────── */

  const loadBatch = useCallback(() => {
    if (running) return;
    setRunning(true);
    void runCatalogBatch().then((res) => {
      setRunning(false);
      if (!res.ok) {
        if (isAborted(res.error)) return;
        setCatalogFailed(true);
        setLastRun(null);
        return;
      }
      setCatalog(res.data.catalog);
      setCatalogFailed(false);
      setLastRun(toRunView(res.data));
      // Nové riadky aj nové prekážky — obe sa po dávke mohli zmeniť.
      setStatusTick((tick) => tick + 1);
      setReloadTick((tick) => tick + 1);
    });
  }, [running]);

  function change(patch: Partial<CatalogFilterState>) {
    // Detail patrí k riadku, ktorý je práve vidieť. Po zmene filtra alebo
    // stránky by visel nad iným zoznamom, tak sa zavrie.
    setDetailId(null);
    setFilter((current) => ({ ...current, ...patch }));
  }

  function toggleRow(productId: number, checked: boolean) {
    setSelected((current) => {
      // Hromadný výber sa pri prvom ručnom zásahu rozpadne na to, čo je vidieť —
      // inak by sa „všetkých 11 640 okrem jedného" tvárilo ako celý filter.
      const base = allMatching ? new Set(rows.map((row) => row.productId)) : new Set(current);
      if (checked) base.add(productId);
      else base.delete(productId);
      return base;
    });
    setAllMatching(false);
  }

  function togglePage(checked: boolean) {
    setSelected((current) => {
      const base = allMatching ? new Set<number>() : new Set(current);
      for (const row of rows) {
        if (checked) base.add(row.productId);
        else base.delete(row.productId);
      }
      return base;
    });
    setAllMatching(false);
  }

  function clearSelection() {
    setSelected(new Set());
    setAllMatching(false);
  }

  function applySaved(query: string) {
    const next = parseCatalogFilterQuery(query);
    setQueryDraft(next.query);
    setFilter({ ...next, page: 1, perPage: filter.perPage });
    setFiltersOpen(false);
  }

  const activeSaved = saved.find((row) => row.query === filterKey)?.name ?? null;
  const showBar = allMatching || selected.size > 0;
  const maxProducts = status === null ? null : status.scope.maxProducts;
  const discountHref = allMatching
    ? newDiscountHref({ kind: 'filter', filter, total: matching })
    : newDiscountHref({ kind: 'products', productIds: [...selected] });

  const empty = catalogEmptyView({ narrowed: filterIsNarrowed(filter), status: catalog });

  /**
   * PRÁZDNY VÝSLEDOK HĽADANIA MUSÍ POVEDAŤ, KDE SA HĽADALO.
   *
   * Prázdna tabuľka po zadanom texte je najsilnejšie tvrdenie na tejto
   * obrazovke — číta sa ako „taký produkt neexistuje". Pritom zrkadlo hľadá
   * VÝHRADNE v názve a čísle: kód produktu, popis ani kategórie v ňom fyzicky
   * nie sú (`raw` je `{id, name, price, has_attributes}`), takže nula tu často
   * znamená len „hľadalo sa inde, než kde to je".
   *
   * Text preto nesie tri veci a nič viac (kontrakt bod 11 — jedna veta a jedno
   * tlačidlo): kde sa hľadalo, ku ktorému okamihu zrkadlo platí (bod 10 —
   * konkrétny čas a dátum) a čo pozná len eshop. Keď zrkadlo NIE JE dočítané,
   * pridá sa k tomu aj to — tvrdenie „hľadanie našlo všetko" nesmie zaznieť
   * ani tu, ani v počte zhôd (`matchingIsLowerBound`).
   */
  const searchEmpty = ((): { title: string; description: string } => {
    const asOf = mirrorAsOfPhrase(view === null ? null : view.dataAsOf);
    const where =
      asOf === null
        ? 'V zrkadle katalógu sa hľadá len v názve a čísle produktu'
        : `V zrkadle katalógu (stav k ${asOf}) sa hľadá len v názve a čísle produktu`;
    return {
      title: 'V názve ani čísle produktu nič také nie je',
      description: catalogIsComplete
        ? `${where}; kód produktu, popis a kategórie pozná iba eshop.`
        : `${where}; kód produktu, popis a kategórie pozná iba eshop — a zrkadlo zatiaľ nemá celý katalóg.`,
    };
  })();

  return (
    <>
      <CatalogStatusPanel
        status={catalog}
        failed={catalogFailed}
        blockers={catalogBlockers}
        lastRun={lastRun}
        running={running}
        onLoadBatch={loadBatch}
      />

      <div className="layout-filters">
        <CatalogFilters
          filter={filter}
          counts={view === null ? null : view.counts}
          lockedFilters={view === null ? {} : view.lockedFilters}
          saved={saved}
          activeSaved={activeSaved}
          open={filtersOpen}
          onChange={change}
          onApplySaved={applySaved}
          onRemoveSaved={(name) => setSaved(removeFilter(name))}
        />

        {/* Nie `<main>`: hlavný orientačný bod stránky je `main.wrap` z rozloženia
            appky a dva naraz sú neplatné HTML aj mätúca navigácia pre čítačku. */}
        <div>
          <div className="row wrapx" style={{ marginBottom: '10px' }}>
            <input
              className="inp"
              style={{ width: '300px', maxWidth: '100%' }}
              type="search"
              value={queryDraft}
              placeholder="Hľadať názov, číslo alebo kód produktu"
              aria-label="Hľadať v katalógu"
              onChange={(event) => setQueryDraft(event.target.value)}
              data-testid="catalog-search"
            />

            {/* DOHĽADANIE JE PONUKA, NIE AUTOMAT (kontrakt UI, body 25–28).
                Stojí pri poli a je dostupné vždy, keď je v hľadaní text — aj
                keď zrkadlo niečo našlo. Dôvod už nie je „mám len časť
                katalógu": zrkadlo je úplné, ale pozná o produkte len NÁZOV
                a ČÍSLO. Kód, popis a kategórie vie iba eshop, takže tri
                nájdené názvy nie sú dôkaz o neexistujúcich tridsiatich.
                Spúšťa ho výhradne kliknutie, lebo míňa rozpočet čítaní. */}
            {searchDraft === '' ? null : (
              <button
                type="button"
                className="btn sm"
                onClick={() => void lookupNow()}
                disabled={lookingUp || !searchSettled}
                title="Prehľadá celý eshop — názov, popis, kód aj kategórie."
                data-testid="catalog-lookup"
              >
                {lookingUp ? 'Hľadám v eshope…' : 'Dohľadať v eshope'}
              </button>
            )}

            {/* Čo hľadá pole a čo až eshop. Jedna veta, nie odstavec (P2). */}
            <span className="lvl-3" data-testid="catalog-search-hint">
              Hľadá v názve a čísle; kód nájde eshop.
            </span>

            {narrow ? (
              <button
                type="button"
                className="btn sm ghost"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
                data-testid="toggle-filters"
              >
                Filtre
              </button>
            ) : null}
            {/* P7 — dolná hranica nesie `≈` a tlmenejší odtieň; merané číslo
                zostáva plné. Kým sa nenačítal ani prvý riadok, je tu POMLČKA:
                nula je tvrdenie, a to appka v tej chvíli nemá čím kryť
                (kontrakt UI, bod 5). */}
            <span
              className="num"
              style={{
                marginLeft: 'auto',
                fontSize: '22px',
                fontWeight: matchingIsLowerBound ? 620 : 660,
                color: matchingIsLowerBound ? 'var(--ink2)' : 'var(--ink)',
                letterSpacing: '-0.02em',
                lineHeight: 1.05,
                whiteSpace: 'nowrap',
              }}
              title={
                matchingIsLowerBound
                  ? 'Počet v načítaných riadkoch — v eshope ich môže byť viac.'
                  : undefined
              }
              data-testid="catalog-matching"
            >
              {view === null ? '—' : `${matchingIsLowerBound ? '≈ ' : ''}${formatCountSk(matching)}`}
              {/* „načítaných", alebo „produktov"? Rozhoduje `catalog.complete`,
                  nie odhad. Kým je zrkadlo neúplné, druhé číslo je počet
                  riadkov, ktoré appka má — nie veľkosť eshopu, a bez toho slova
                  by neúplný katalóg vyzeral ako celý. Keď je zrkadlo dočítané,
                  klame to opačným smerom: úplný katalóg by vyzeral ako výsek. */}
              {/* BOD 17 (W2, 20. 8. 2026): keď sa druhé číslo rovná prvému,
                  veta „41 220 z 41 220 načítaných" hovorí to isté dvakrát.
                  Pri neúplnom zrkadle sa NEskrýva ani pri rovnosti — vtedy
                  slovo „načítaných" nesie, že to nie je veľkosť eshopu. */}
              {view === null || (matching === catalogTotal && catalogIsComplete) ? null : (
                <small
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--dim)',
                    marginLeft: '6px',
                    letterSpacing: 0,
                  }}
                >
                  z {formatCountSk(catalogTotal)} {catalogIsComplete ? 'produktov' : 'načítaných'}
                </small>
              )}
            </span>
          </div>

          <div className="fresh" data-testid="catalog-data-as-of">
            {dataAsOfSentence(view === null ? null : view.dataAsOf)}
          </div>

          {/* Výsledok posledného dohľadania — pri mieste, kde vzniklo. Sú to
              MERANÉ čísla (koľko riadkov pribudlo, koľko sa nestihlo), takže
              sa neoznačujú `≈` (P7). */}
          {lookupNote !== null ? (
            <Note variant="info" testId="catalog-lookup-note">
              {lookupNote}
            </Note>
          ) : null}

          {/* Strop rozsahu a chýbajúce kusy — nad tabuľkou, teda tam, kde sa
              výber robí, a nie až v sprievodcovi ako tiché odmietnutie. */}
          <BlockerNotes
            blockers={selectionBlockers}
            here="/produkty"
            testId="selection-blockers"
          />

          {statusFailed ? (
            <div style={{ marginTop: '8px' }}>
              <Note variant="warn" testId="status-failed">
                Aké stropy a prekážky teraz platia, sa nepodarilo zistiť — obrazovka ich preto
                neukazuje.{' '}
                <span className="lvl-3" style={{ display: 'inline' }}>
                  Vyberať sa dá ďalej, ale koľko produktov naozaj prejde, potvrdí až náhľad zľavy.
                  Skúste obrazovku obnoviť.
                </span>
              </Note>
            </div>
          ) : null}

          {error === null ? (
            <div style={{ marginTop: '10px' }}>
              <CatalogTable
                rows={rows}
                soldWindowDays={view === null ? filter.soldWindowDays : view.soldWindowDays}
                total={matching}
                totalIsLowerBound={matchingIsLowerBound}
                page={filter.page}
                perPage={filter.perPage}
                loading={loading}
                selected={selected}
                allMatchingSelected={allMatching}
                onToggleRow={toggleRow}
                onTogglePage={togglePage}
                onOpenDetail={setDetailId}
                onPage={(page) => change({ page })}
                onPerPage={(perPage: PerPage) => change({ perPage, page: 1 })}
                sort={filter.sort}
                /* Poradie nie je iná otázka, preto sa výber NERUŠÍ — mení sa
                   len `sort`, ktorý do kľúča filtra nevstupuje. */
                onSort={(sort: CatalogSort) => change({ sort, page: 1 })}
                rowReason={rowReason}
                emptyState={
                  <EmptyState
                    /* Prázdny výsledok HĽADANIA je iný príbeh než prázdny
                       katalóg: nehovorí „nič tu nie je", ale „nič také nie je
                       TAM, kde zrkadlo vie pozrieť". Preto má vlastnú vetu
                       a vlastný ďalší krok. */
                    title={searchTerm.length > 0 ? searchEmpty.title : empty.title}
                    description={
                      searchTerm.length > 0 ? searchEmpty.description : empty.description
                    }
                    action={
                      /* Ďalší krok po prázdnom hľadaní je eshop, nie ďalšia
                         stovka riadkov v abecednom poradí — kód, popis
                         a kategórie pozná len on. Tlačidlo je to isté, ktoré
                         stojí pri poli (rovnaká akcia aj rovnaké zámky), ale
                         patrí aj sem: prázdny stav bez ďalšieho kroku je slepá
                         ulica (kontrakt bod 11). */
                      searchTerm.length > 0 ? (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => void lookupNow()}
                          disabled={lookingUp || !searchSettled}
                          data-testid="catalog-empty-lookup"
                        >
                          {lookingUp ? 'Hľadám v eshope…' : 'Dohľadať v eshope'}
                        </button>
                      ) : empty.offerLoad ? (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={loadBatch}
                          disabled={running}
                          data-testid="catalog-empty-load"
                        >
                          {running ? 'Načítavam ďalšiu dávku…' : 'Načítať ďalšiu dávku'}
                        </button>
                      ) : undefined
                    }
                    testId="catalog-empty"
                  />
                }
              />
            </div>
          ) : (
            <section className="sec" data-testid="catalog-error">
              <div className="lvl-2">{error}</div>
              <div className="row gap-t">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setError(null);
                    setReloadTick((tick) => tick + 1);
                  }}
                >
                  Skúsiť znova
                </button>
              </div>
            </section>
          )}

          {/*
            ROZDELENIE CIEN — POD ROZKLIKOM, A TO ZÁMERNE.
            ─────────────────────────────────────────────
            Graf odpovedá na otázku PRED zľavou: „leží môj výber v tučnej časti
            cenníka, alebo v chvoste?" Zľava na desiatich kusoch z pásma, kde má
            eshop tisíce položiek, znamená niečo iné než zľava na desiatich
            kusoch z okraja.

            Prečo `<details>` a nie piata sekcia: P5 dovoľuje na obrazovke štyri
            sekcie a Produkty ich už majú (stav katalógu, filtre, tabuľka, lišta
            výberu). Graf je navyše TECHNIKA — pomáha rozhodnúť, ale bez neho sa
            výber urobiť dá — a technika patrí pod rozklik (P6). Zavretý rozklik
            stojí jeden riadok, takže obrazovka zostáva v 1,5 obrazovky (P4).

            Stojí POD tabuľkou, nie nad ňou: dominanta obrazovky je tabuľka (P1)
            a graf je poznámka k výberu, ktorý sa v nej práve robí.
          */}
          <details
            className="tech"
            style={{ marginTop: '10px' }}
            onToggle={(event) => {
              if (!event.currentTarget.open) return;
              if (pricesAsked) return;
              loadPrices();
            }}
            data-testid="catalog-prices-fold"
          >
            <summary>Rozdelenie cien v katalógu</summary>
            <div className="body">
              {pricesFailed ? (
                <Note variant="warn" testId="catalog-prices-failed">
                  Rozdelenie cien sa nepodarilo načítať — graf preto nie je čím nakresliť.{' '}
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={loadPrices}
                    disabled={pricesLoading}
                    data-testid="catalog-prices-retry"
                  >
                    Skúsiť znova
                  </button>
                </Note>
              ) : prices === null ? (
                /* Kým dáta nie sú, NEKRESLÍ sa prázdny rám s osou — ten by
                   tvrdil, že katalóg je prázdny. Je tu jedna veta.

                   Trieda je `lvl-3`, nie `fresh`: `.fresh` je podľa
                   architektúry §0 vyhradená pre JEDEN riadok „Dáta k …" na
                   obrazovku a `produkty-v10.spec.ts` to počíta. */
                <div className="lvl-3" data-testid="catalog-prices-loading">
                  {pricesLoading
                    ? 'Načítavam rozdelenie cien…'
                    : 'Rozdelenie cien sa načíta pri otvorení.'}
                </div>
              ) : (
                <PriceHistogram
                  bins={prices.bins}
                  selection={priceMarks}
                  rows={prices.rows}
                  withoutPrice={prices.withoutPrice}
                  maxPrice={prices.maxPrice}
                  oldestFetchedAt={prices.oldestFetchedAt}
                  newestFetchedAt={prices.newestFetchedAt}
                  /* Stav katalógu si obrazovka už načítala. Keď sa ho zistiť
                     nepodarilo (`catalog === null`), ide dnu `undefined` —
                     graf potom povie „nevieme", nie „zrkadlo nie je celé". */
                  complete={catalog === null ? undefined : catalog.complete}
                />
              )}
            </div>
          </details>

          {showBar ? (
            <SelectionBar
              pageSelected={pageSelected}
              totalSelected={selected.size}
              matching={matching}
              maxProducts={maxProducts}
              allMatchingSelected={allMatching}
              discountHref={discountHref}
              onSelectAllMatching={() => setAllMatching(true)}
              onClear={clearSelection}
              onSaveFilter={(name) => setSaved(saveFilter(name, filterKey))}
            />
          ) : null}
        </div>
      </div>

      {detailRow === undefined ? null : (
        <ProductDetailPanel
          row={detailRow}
          soldWindowDays={view === null ? filter.soldWindowDays : view.soldWindowDays}
          blockers={detailBlockers}
          onClose={() => setDetailId(null)}
        />
      )}
    </>
  );
}

export default CatalogPanel;
