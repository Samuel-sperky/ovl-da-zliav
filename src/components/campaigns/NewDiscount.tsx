'use client';

/**
 * Aura Zľavy — NOVÁ ZĽAVA (V11; predloha `design/v3/nova-zlava.html`,
 * architektúra §2, kontrakt V3 K1–K8, invarianty I3, I9, I11).
 *
 * Jedna obrazovka, štyri sekcie, dva stĺpce:
 *
 *   VÝBER PRODUKTOV      ·  ŠTART        (kedy fronta dobehne, kedy zľava nabehne)
 *   PÁSMA A OKNO         ·  POTVRDENIE   (dominanta: koľko produktov zlacnie)
 *
 * Prečo je to jedna obrazovka a nie sprievodca: rozhodnutie „zlacniť 8 000
 * ležiakov" nemá tri nezávislé kroky. Počet produktov, percentá a dátum štartu
 * na sebe visia — zmena stropu mení odhad dobehnutia a ten mení navrhovaný
 * štart. V sprievodcovi by sa to dalo vidieť až na konci.
 *
 * Na čom obrazovka stojí:
 *
 *  1. **Výber sa zmaterializuje.** Čísla v pásmach, vzorka aj priemerná cena sú
 *     spočítané z riadkov, ktoré NAOZAJ prišli z katalógu — nie z odhadu nad
 *     filtrom. Preto sa výber načítava po stránkach (najhoršie ležiaky prvé)
 *     a obrazovka pri tom ukazuje, kde je.
 *  2. **Produkty, na ktorých už podľa vlastných zápisov zľava beží, sa
 *     vynechajú** a povie sa to nahlas (I11, D28) — prepis existujúcej zľavy je
 *     vedomá akcia, nie vedľajší účinok hromadného výberu.
 *  3. **Bez skúšky naprázdno a bez ručne vpísaného počtu sa nezaraďuje** (I3).
 *     Akákoľvek zmena výberu, pásma alebo okna skúšku zneplatní.
 *  4. **Zamknuté filtre sú vidieť** (K8) a **dopad na maržu sa nikdy neukáže
 *     ako číslo** — nákupné ceny appka nemá.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import NewDiscountConfirm from '@/components/campaigns/NewDiscountConfirm';
import NewDiscountStart from '@/components/campaigns/NewDiscountStart';
import styles from '@/components/campaigns/zlavy.module.css';
import { fetchSession, sudoValid } from '@/components/campaigns/api';
import {
  DEFAULT_TIER_PERCENT,
  buildTiers,
  averagePrice as averagePriceOf,
  discountedPriceOf,
  estimateFinishDay,
  headlinePercent,
  proposeStart,
  queueAhead,
  spreadSample,
  todayLogical,
  typedCountMatches,
  validateTierPercent,
  type SelectableRow,
  type SoldBucketKey,
  type TierPlan,
} from '@/components/campaigns/discounts-model';
import {
  createDiscount,
  keyMeta,
  listDiscounts,
  previewDiscount,
  scopeLimits,
  searchCatalog,
  type BudgetView,
  type CreateResult,
  type KeyMetaView,
  type PreviewData,
  type ScopeView,
} from '@/components/campaigns/zlavy-api';
import SudoPrompt from '@/components/ui/SudoPrompt';
import {
  SOLD_WINDOWS,
  catalogFilterKey,
  catalogSearchQuery,
  type CatalogFilterState,
} from '@/components/products/catalog-filter';
import { addDays, diffDays, maxAllowedTo } from '@/lib/domain/dates';
import { formatDateSk, formatDateTimeSk, formatEur } from '@/lib/ui/format';
import { formatCountSk, guardSentence, pluralSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ konštanty ════════════════════════════════════ */

/** Koľko riadkov katalógu si vypýtame naraz. Väčšia strana `/api/catalog/search` neprijme. */
const PAGE_SIZE = 200;

/**
 * Tvrdý strop jednej zľavy — zhodný s `PREVIEW_MAX_PRODUCTS` (K1 bod 3, K4).
 * Nedá sa importovať: `lib/crypto/preview-token` je serverový modul.
 */
const HARD_MAX_PRODUCTS = 10_000;

/** Poistka proti nekonečnému listovaniu, keby server vracal plné strany donekonečna. */
const MAX_PAGES = Math.ceil(HARD_MAX_PRODUCTS / PAGE_SIZE) + 2;

/** Predvolená dĺžka okna zľavy v dňoch (D12 preset 14 dní). */
const DEFAULT_WINDOW_DAYS = 14;

export interface NewDiscountInitial {
  /** Konkrétne označené produkty z tabu Produkty; `null` = výber z filtra. */
  readonly productIds: readonly number[] | null;
  readonly filter: CatalogFilterState;
  /** Koľko produktov filtru vyhovovalo v tabe Produkty (len na porovnanie). */
  readonly expectedTotal: number | null;
}

type Busy = 'idle' | 'loading' | 'previewing' | 'creating';

/* ═══════════════════════════ obrazovka ════════════════════════════════════ */

export function NewDiscount({ initial }: { initial: NewDiscountInitial }) {
  const hasPicked = initial.productIds !== null && initial.productIds.length > 0;

  const [source, setSource] = useState<'filter' | 'products'>(hasPicked ? 'products' : 'filter');
  const [filter, setFilter] = useState<CatalogFilterState>(initial.filter);
  const [capText, setCapText] = useState('');

  const [rows, setRows] = useState<readonly SelectableRow[] | null>(null);
  const [matching, setMatching] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [scope, setScope] = useState<ScopeView | null>(null);
  /** `true` = na otázku o strope už prišla odpoveď (aj záporná). */
  const [scopeReady, setScopeReady] = useState(false);
  const [budget, setBudget] = useState<BudgetView | null>(null);
  const [ahead, setAhead] = useState<{
    pending: number;
    names: readonly { name: string; pending: number }[];
  } | null>(null);
  const [key, setKey] = useState<KeyMetaView | null>(null);

  const [name, setName] = useState('');
  const [percents, setPercents] = useState<Record<SoldBucketKey, number>>({
    ...DEFAULT_TIER_PERCENT,
  });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [windowTouched, setWindowTouched] = useState(false);

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewSig, setPreviewSig] = useState<string | null>(null);
  const [previewAt, setPreviewAt] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  // Obrazovka sa otvára do načítania — nie do prázdneho výberu.
  const [busy, setBusy] = useState<Busy>('loading');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateResult | null>(null);

  const [sudoUntil, setSudoUntil] = useState<string | null>(null);
  const [showSudo, setShowSudo] = useState(false);

  /** Generácia načítania — odpoveď starého výberu sa nesmie zapísať do nového. */
  const gen = useRef(0);
  /** Verzia výberu — mení sa len vtedy, keď sa naozaj zmenili riadky. */
  const [selectionVersion, setSelectionVersion] = useState(0);

  /* ── 1. Kontext: strop, rozpočet, fronta pred nami, kľúč ─────────────── */

  useEffect(() => {
    let alive = true;
    void scopeLimits().then((res) => {
      if (!alive) return;
      if (res.ok) setScope(res.data);
      // Výber sa načítava až po tejto odpovedi: v režime `pilot` je strop 10
      // a bez neho by prvé načítanie zbytočne prelistovalo celý katalóg (K1).
      setScopeReady(true);
    });
    void keyMeta().then((res) => {
      if (alive && res.ok) setKey(res.data);
    });
    void listDiscounts(50).then((res) => {
      if (!alive || !res.ok) return;
      setBudget(res.data.budget);
      setAhead(queueAhead(res.data.data));
    });
    void fetchSession().then((session) => {
      if (alive) setSudoUntil(session?.sudoUntil ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const maxProducts = scope === null ? null : Math.min(scope.maxProducts, HARD_MAX_PRODUCTS);
  const capParsed = capText.trim() === '' ? null : Number(capText.replace(/\s/g, ''));
  const cap =
    capParsed !== null && Number.isInteger(capParsed) && capParsed > 0
      ? Math.min(capParsed, maxProducts ?? HARD_MAX_PRODUCTS)
      : (maxProducts ?? HARD_MAX_PRODUCTS);

  const filterKey = catalogFilterKey(filter);
  const pickedKey = hasPicked ? (initial.productIds ?? []).join(',') : '';

  /* ── 2. Materializácia výberu ────────────────────────────────────────── */

  const loadSelection = useCallback(async () => {
    const mine = gen.current + 1;
    gen.current = mine;
    setBusy('loading');
    setLoadError(null);
    setLoaded(0);

    const collected: SelectableRow[] = [];
    let dropped = 0;
    let total: number | null = null;
    let asOf: string | null = null;
    let failure: string | null = null;

    const take = (
      data: readonly {
        productId: number;
        name: string | null;
        price: string | null;
        unitsSold: number;
        discountedNow: boolean;
      }[],
    ): void => {
      for (const row of data) {
        // I11 / D28 — na produkte podľa VLASTNÝCH zápisov beží zľava. Prepis je
        // vedomá akcia, nie vedľajší účinok hromadného výberu.
        if (row.discountedNow) {
          dropped += 1;
          continue;
        }
        if (collected.length >= cap) continue;
        collected.push({
          productId: row.productId,
          name: row.name,
          price: row.price,
          unitsSold: row.unitsSold,
          discountedNow: row.discountedNow,
        });
      }
    };

    if (source === 'products') {
      const ids = [...(initial.productIds ?? [])];
      total = ids.length;
      for (let offset = 0; offset < ids.length; offset += PAGE_SIZE) {
        const chunk = ids.slice(offset, offset + PAGE_SIZE);
        const res = await searchCatalog(filter, {
          perPage: chunk.length,
          counts: false,
          productIds: chunk,
        });
        if (gen.current !== mine) return;
        if (!res.ok) {
          failure = res.error.message;
          break;
        }
        asOf = res.data.dataAsOf;
        take(res.data.data);
        setLoaded(collected.length);
        if (collected.length >= cap) break;
      }
    } else {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const res = await searchCatalog(filter, {
          page,
          perPage: PAGE_SIZE,
          counts: page === 1,
          // „Najhoršie ležiaky prvé" — najmenej predávané idú do výberu prvé.
          sort: 'sold_asc',
        });
        if (gen.current !== mine) return;
        if (!res.ok) {
          failure = res.error.message;
          break;
        }
        if (page === 1) {
          total = res.data.total;
          asOf = res.data.dataAsOf;
        }
        take(res.data.data);
        setLoaded(collected.length);
        if (res.data.data.length < PAGE_SIZE) break;
        if (collected.length >= cap) break;
      }
    }

    if (gen.current !== mine) return;
    setBusy('idle');
    if (failure !== null && collected.length === 0) {
      // Zlyhanie čítania NIE JE prázdny výber (P7).
      setRows(null);
      setMatching(null);
      setLoadError(failure);
      return;
    }
    setRows(collected);
    setMatching(total);
    setSkipped(dropped);
    setDataAsOf(asOf);
    setLoadError(failure);
    setSelectionVersion((value) => value + 1);
  }, [cap, filter, initial.productIds, source]);

  useEffect(() => {
    if (!scopeReady) return;
    const timer = setTimeout(() => {
      void loadSelection();
    }, 300);
    return () => clearTimeout(timer);
    // Závislosťami sú TEXTOVÉ ODTLAČKY vstupov (`filterKey`, `pickedKey`), nie
    // objekty — inak by sa výber načítaval znova pri každom prekreslení.
  }, [filterKey, pickedKey, source, cap, scopeReady, loadSelection]);

  /* ── 3. Pásma, vzorka, priemerná cena ────────────────────────────────── */

  const tiers: TierPlan[] = useMemo(
    () => (rows === null ? [] : buildTiers(rows, filter.soldWindowDays, percents)),
    [rows, filter.soldWindowDays, percents],
  );
  const itemsCount = rows === null ? 0 : rows.length;
  const sample = useMemo(() => spreadSample(rows ?? [], tiers, 6), [rows, tiers]);
  const tierOfProduct = useMemo(() => {
    const map = new Map<number, TierPlan>();
    for (const tier of tiers) for (const id of tier.productIds) map.set(id, tier);
    return map;
  }, [tiers]);
  const avgPrice = useMemo(() => averagePriceOf(rows ?? []), [rows]);

  /* ── 4. Odhad dobehnutia a navrhovaný štart ──────────────────────────── */

  const perDay = budget !== null ? budget.budget : (scope?.dailyWriteBudget ?? null);
  const aheadPending = ahead === null ? 0 : ahead.pending;
  const estimate =
    perDay === null || itemsCount === 0
      ? null
      : estimateFinishDay(aheadPending + itemsCount, perDay, {
          ...(budget !== null ? { remainingToday: budget.remaining } : {}),
        });
  const finishDay = estimate === null ? null : estimate.date;
  const proposedStart = finishDay === null ? null : proposeStart(finishDay);

  // Kým sa okna nikto nedotkol, drží sa návrhu appky (K5). Po prvej ručnej
  // zmene sa už neposúva sám — používateľ má prednosť pred odhadom.
  useEffect(() => {
    if (windowTouched) return;
    const start = proposedStart ?? todayLogical();
    if (start === from) return;
    setFrom(start);
    setTo(addDays(start, DEFAULT_WINDOW_DAYS - 1));
  }, [proposedStart, windowTouched, from]);

  const windowDays = safeWindowDays(from, to);

  /* ── 5. Skúška naprázdno a zaradenie do fronty (I3) ──────────────────── */

  const percentError = tiers
    .map((tier) => validateTierPercent(tier.percent))
    .find((message) => message !== null);

  const windowError = ((): string | null => {
    if (from === '' || to === '') return 'Doplňte okno platnosti zľavy.';
    if (to < from) return 'Koniec zľavy nesmie byť pred jej začiatkom.';
    if (from < todayLogical()) return 'Zľava nesmie začínať v minulosti.';
    if (to > maxAllowedTo(from)) return 'Zľava môže trvať najviac tri mesiace.';
    return null;
  })();

  const signature = `${selectionVersion}|${itemsCount}|${from}|${to}|${tiers
    .map((tier) => `${tier.ord}:${tier.percent}`)
    .join(',')}`;
  const previewFresh =
    preview !== null && previewSig === signature && preview.previewToken !== '';

  const runPreview = useCallback(async () => {
    if (rows === null || rows.length === 0 || tiers.length === 0) return;
    if (percentError !== undefined || windowError !== null) return;
    setBusy('previewing');
    setError(null);
    const res = await previewDiscount({
      productIds: rows.map((row) => row.productId),
      percent: headlinePercent(tiers),
      from,
      to,
      kind: 'new',
      tiers: tiers.map((tier) => ({
        ord: tier.ord,
        label: `${tier.letter} · ${tier.label}`,
        percent: tier.percent,
        productIds: tier.productIds,
      })),
      ...(from === to ? { oneDayAcknowledged: true } : {}),
    });
    setBusy('idle');
    if (!res.ok) {
      setPreview(null);
      setPreviewSig(null);
      setError(res.error.message);
      return;
    }
    setPreview(res.data);
    setPreviewSig(signature);
    setPreviewAt(new Date().toISOString());
    setError(null);
  }, [rows, tiers, percentError, windowError, from, to, signature]);

  const blockedReason = ((): string | null => {
    if (itemsCount === 0) return 'Vyberte aspoň jeden produkt.';
    if (scope !== null && scope.writesLocked) {
      const sentence = guardSentence('writes_locked');
      return `${sentence.text} ${sentence.hint ?? ''}`.trim();
    }
    if (percentError !== undefined && percentError !== null) return percentError;
    if (windowError !== null) return windowError;
    if (!previewFresh) return 'Najprv spustite skúšku naprázdno pre tento výber.';
    if (preview !== null && preview.blockers.length > 0) {
      return 'Skúška našla prekážku — kým trvá, zaradiť sa nedá.';
    }
    if (!typedCountMatches(typed, itemsCount)) {
      return `Do poľa napíšte ${formatCountSk(itemsCount)}.`;
    }
    return null;
  })();

  const doQueue = useCallback(async () => {
    if (preview === null || preview.previewToken === '') return;
    setBusy('creating');
    setError(null);
    const res = await createDiscount({
      previewToken: preview.previewToken,
      name: name.trim() === '' ? defaultName(tiers, from, to) : name.trim(),
      mode: 'eager',
      tiers: tiers.map((tier) => ({
        ord: tier.ord,
        label: `${tier.letter} · ${tier.label}`,
        percent: tier.percent,
        rule: { soldWindowDays: filter.soldWindowDays, bucket: tier.bucket },
        itemsCount: tier.productIds.length,
      })),
      acknowledgements: from === to ? { irreversible: true, oneDay: true } : { irreversible: true },
    });
    setBusy('idle');
    if (!res.ok) {
      // Token je jednorazový — po neúspechu sa musí skúška zopakovať (I3).
      setPreview(null);
      setPreviewSig(null);
      setError(res.error.message);
      return;
    }
    setCreated(res.data);
  }, [preview, name, tiers, from, to, filter.soldWindowDays]);

  function onQueue() {
    if (blockedReason !== null) return;
    // D70 — od poslednej autentifikácie viac než 15 min → heslo znova.
    if (!sudoValid(sudoUntil)) {
      setShowSudo(true);
      return;
    }
    void doQueue();
  }

  /* ── 6. Vykreslenie ──────────────────────────────────────────────────── */

  const lockedChips = ['kategória', 'kov', 'typ šperku', 'marža', 'obrátkovosť'];

  return (
    <div data-testid="new-discount">
      <div className={styles.nzHead}>
        <span className={styles.nzTitle}>Nová zľava</span>
        <input
          className={`inp ${styles.nzName}`}
          value={name}
          maxLength={120}
          placeholder={defaultName(tiers, from, to)}
          onChange={(event) => setName(event.target.value)}
          aria-label="Názov zľavy"
          data-testid="discount-name"
        />
        <Link className={`lvl-3 ${styles.pushRight}`} href="/zlavy">
          Zrušiť
        </Link>
      </div>

      <div className={styles.nz}>
        {/* ── ĽAVÝ STĹPEC ─────────────────────────────────────────────── */}
        <div className={styles.nzCol}>
          {/* SEKCIA 1 — VÝBER PRODUKTOV */}
          <section className="sec" data-testid="new-discount-selection">
            <div className="sec-h">
              <h2>Výber produktov</h2>
              <div className="act">
                <button
                  type="button"
                  className={source === 'filter' ? 'chip on' : 'chip'}
                  onClick={() => setSource('filter')}
                >
                  Z filtra
                </button>
                {hasPicked ? (
                  <button
                    type="button"
                    className={source === 'products' ? 'chip on' : 'chip'}
                    onClick={() => setSource('products')}
                  >
                    Z označených <span className="c">{formatCountSk((initial.productIds ?? []).length)}</span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="row wrapx">
              {describeFilter(filter).map((chip) => (
                <span key={chip} className="chip on">
                  {chip}
                </span>
              ))}
              {lockedChips.map((chip) => (
                <span key={chip} className="chip lock" title="Čaká na dáta zo shopu">
                  {chip}
                </span>
              ))}
              <span className="lvl-3" style={{ marginLeft: '8px' }}>
                Obdobie
              </span>
              <span className="seg">
                {SOLD_WINDOWS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={filter.soldWindowDays === days ? 'on' : undefined}
                    onClick={() => setFilter({ ...filter, soldWindowDays: days })}
                    data-testid={`window-${days}`}
                  >
                    {days}
                  </button>
                ))}
              </span>
            </div>

            <div className="spread gap-t">
              <div className="lvl-2">
                {matching === null ? (
                  <span className="lvl-3">Počet produktov zatiaľ nevieme</span>
                ) : source === 'products' ? (
                  <>
                    Označených <b>{formatCountSk(matching)}</b>{' '}
                    {pluralSk(matching, 'produkt', 'produkty', 'produktov')}
                  </>
                ) : (
                  <>
                    Filtru vyhovuje <b>{formatCountSk(matching)}</b>{' '}
                    {pluralSk(matching, 'produkt', 'produkty', 'produktov')}
                  </>
                )}
              </div>
              <div className="row">
                <span className="lvl-3">Najhoršie ležiaky prvé, strop</span>
                <input
                  className={`inp ${styles.capInput}`}
                  inputMode="numeric"
                  value={capText}
                  placeholder={formatCountSk(cap)}
                  onChange={(event) => setCapText(event.target.value)}
                  aria-label="Strop počtu produktov"
                  data-testid="cap-input"
                />
              </div>
            </div>

            <div className="bar" aria-hidden="true">
              <i
                style={{
                  width: `${
                    matching === null || matching === 0
                      ? 0
                      : Math.min(100, (itemsCount / matching) * 100)
                  }%`,
                }}
              />
            </div>

            <div className="prog-meta">
              <span>
                Vyberá sa <b data-testid="selected-count">{formatCountSk(itemsCount)}</b>
                {matching === null ? null : <> z {formatCountSk(matching)}</>}
              </span>
              <span className="sep-dot" aria-hidden="true">
                ·
              </span>
              <span>
                Strop na jednu zľavu{' '}
                {maxProducts === null ? (
                  <span className="lvl-3">nevieme</span>
                ) : (
                  <b>{formatCountSk(maxProducts)}</b>
                )}
              </span>
              {skipped === 0 ? null : (
                <>
                  <span className="sep-dot" aria-hidden="true">
                    ·
                  </span>
                  <span className="flag neutral" data-testid="skipped-discounted">
                    {formatCountSk(skipped)} už má zľavu podľa vlastných zápisov — vynechané
                  </span>
                </>
              )}
            </div>

            {busy === 'loading' ? (
              <div className={styles.busy} data-testid="selection-busy">
                Načítavam výber… {formatCountSk(loaded)}
              </div>
            ) : null}
            {loadError === null ? null : (
              <div className={styles.note} role="alert">
                {loadError}
              </div>
            )}

            <div className="fresh">
              {dataAsOf === null
                ? 'Katalóg zatiaľ nemáme načítaný'
                : `Dáta k ${formatDateTimeSk(dataAsOf)}`}
            </div>
          </section>

          {/* SEKCIA 2 — PÁSMA A OKNO PLATNOSTI */}
          <section className="sec" data-testid="new-discount-tiers">
            <div className="sec-h">
              <h2>Pásma a okno platnosti</h2>
              <div className="act">
                <Link className="lvl-3" href={`/produkty?${catalogSearchQuery(filter)}`}>
                  Upraviť výber v Produktoch
                </Link>
              </div>
            </div>

            <table className={styles.tiers}>
              <thead>
                <tr>
                  <th>Pásmo</th>
                  <th>Pravidlo</th>
                  <th className="n">Produktov</th>
                  <th className="n">Zľava</th>
                </tr>
              </thead>
              <tbody>
                {tiers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="lvl-3">
                      Zatiaľ nie je z čoho pásma zostaviť.
                    </td>
                  </tr>
                ) : (
                  tiers.map((tier) => (
                    <tr key={tier.bucket} data-testid={`tier-${tier.bucket}`}>
                      <td>
                        <span className={styles.band} data-ord={tier.ord}>
                          <i />
                          {tier.letter}
                        </span>
                      </td>
                      <td>{tier.label}</td>
                      <td className="n">{formatCountSk(tier.productIds.length)}</td>
                      <td className="n">
                        <input
                          className={`inp ${styles.pctInput}`}
                          inputMode="numeric"
                          value={String(tier.percent)}
                          aria-label={`Zľava pásma ${tier.letter} v percentách`}
                          onChange={(event) => {
                            const value = Number(event.target.value.replace(/[^\d]/g, ''));
                            setPercents((current) => ({
                              ...current,
                              [tier.bucket]: Number.isFinite(value) ? value : 0,
                            }));
                          }}
                          data-testid={`tier-percent-${tier.bucket}`}
                        />{' '}
                        %
                      </td>
                    </tr>
                  ))
                )}
                {tiers.length === 0 ? null : (
                  <tr className="sum">
                    <td colSpan={2}>Spolu — najhoršie ležiaky prvé, po strop</td>
                    <td className="n">{formatCountSk(itemsCount)}</td>
                    <td className="n">
                      <span className="lvl-3">
                        {formatCountSk(tiers.length)}{' '}
                        {pluralSk(tiers.length, 'pásmo', 'pásma', 'pásiem')}
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {percentError === undefined || percentError === null ? null : (
              <div className={styles.note} role="alert" data-testid="tier-percent-error">
                {percentError}
              </div>
            )}

            <div
              className="spread gap-t"
              style={{ borderTop: '1px solid var(--line)', paddingTop: '11px' }}
            >
              <div className={styles.win}>
                <span className="lvl-3">Platí od</span>
                <input
                  type="date"
                  className="inp"
                  value={from}
                  onChange={(event) => {
                    setWindowTouched(true);
                    setFrom(event.target.value);
                  }}
                  aria-label="Zľava platí od"
                  data-testid="date-from"
                />
                <span className="lvl-3">do</span>
                <input
                  type="date"
                  className="inp"
                  value={to}
                  onChange={(event) => {
                    setWindowTouched(true);
                    setTo(event.target.value);
                  }}
                  aria-label="Zľava platí do"
                  data-testid="date-to"
                />
                <span className="lvl-3">
                  {windowDays > 0
                    ? `${formatCountSk(windowDays)} ${pluralSk(windowDays, 'deň', 'dni', 'dní')}`
                    : ''}
                </span>
              </div>
              <span className="lvl-3">Rovnaké okno pre všetkých {formatCountSk(itemsCount)}</span>
            </div>
            {windowError === null ? (
              <div className="hint">
                Platí od 00:00 dňa {formatDateSk(from)} do 23:59 dňa {formatDateSk(to)}, čas shopu.
              </div>
            ) : (
              <div className={styles.note} role="alert" data-testid="window-error">
                {windowError}
              </div>
            )}

            <div className={`tbl-frame gap-t`}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Vzorka — {formatCountSk(sample.length)} z {formatCountSk(itemsCount)}</th>
                    <th className="n">Cena</th>
                    <th className="n">Predané {filter.soldWindowDays} d</th>
                    <th className="n">Pásmo</th>
                    <th className="n">Nová cena</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.length === 0 ? (
                    <tr>
                      <td className="name lvl-3">Vzorka bude, keď bude výber.</td>
                      <td className="n">—</td>
                      <td className="n">—</td>
                      <td className="n">—</td>
                      <td className="n">—</td>
                    </tr>
                  ) : (
                    sample.map((row) => {
                      const tier = tierOfProduct.get(row.productId);
                      const newPrice = discountedPriceOf(row.price, tier?.percent ?? 0);
                      return (
                        <tr key={row.productId}>
                          <td className="name">{row.name ?? 'bez názvu'}</td>
                          <td className="n" data-l="Cena">
                            {formatEur(row.price)}
                          </td>
                          <td className="n" data-l="Predané">
                            {formatCountSk(row.unitsSold)}
                          </td>
                          <td className="n" data-l="Pásmo">
                            {tier === undefined ? '—' : `${tier.letter} · ${tier.percent} %`}
                          </td>
                          <td className="n" data-l="Nová cena">
                            <b>{newPrice === null ? '—' : formatEur(newPrice)}</b>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <div className="tbl-foot">
                <span>
                  {avgPrice === null
                    ? 'Priemernú cenu vo výbere zatiaľ nevieme'
                    : `Priemerná cena vo výbere ${formatEur(avgPrice)}`}
                </span>
                <span className="lvl-3">Orientačný prepočet, zaokrúhlenie shopu sa môže líšiť</span>
              </div>
            </div>
          </section>
        </div>

        {/* ── PRAVÝ STĹPEC ────────────────────────────────────────────── */}
        <div className={styles.nzCol}>
          <NewDiscountStart
            itemsCount={itemsCount}
            perDay={perDay}
            aheadPending={aheadPending}
            aheadNames={ahead === null ? [] : ahead.names}
            finishDay={finishDay}
            proposedStart={proposedStart}
            from={from}
            onUseProposal={() => {
              if (proposedStart === null) return;
              const length = windowDays > 0 ? windowDays : DEFAULT_WINDOW_DAYS;
              setWindowTouched(true);
              setFrom(proposedStart);
              setTo(addDays(proposedStart, length - 1));
            }}
            keyExpiresAt={key === null ? null : key.expiresAt}
            keyPresent={key === null ? true : key.present}
          />

          <NewDiscountConfirm
            itemsCount={itemsCount}
            tiers={tiers}
            averagePrice={avgPrice}
            typed={typed}
            onTyped={setTyped}
            previewFresh={previewFresh}
            preview={preview}
            previewAt={previewAt}
            busy={busy}
            blockedReason={blockedReason}
            error={error}
            created={created}
            onPreview={() => void runPreview()}
            onQueue={onQueue}
          />
        </div>
      </div>

      {showSudo ? (
        <SudoPrompt
          actionLabel="Zaradenie zľavy do fronty zápisov"
          onSuccess={(until) => {
            setSudoUntil(until);
            setShowSudo(false);
            void doQueue();
          }}
          onCancel={() => setShowSudo(false)}
        />
      ) : null}
    </div>
  );
}

/* ═══════════════════════════ pomocníci ════════════════════════════════════ */

/** Dĺžka okna v dňoch. Nedopočítaný ani rozpísaný dátum nesmie zhodiť render. */
function safeWindowDays(from: string, to: string): number {
  const shape = /^\d{4}-\d{2}-\d{2}$/;
  if (!shape.test(from) || !shape.test(to)) return 0;
  const days = diffDays(from, to) + 1;
  return days > 0 ? days : 0;
}

/** Predvolený názov zľavy — nikdy prázdny, vždy s oknom a najvyšším percentom. */
function defaultName(tiers: readonly TierPlan[], from: string, to: string): string {
  const percent = headlinePercent(tiers);
  const window = from === '' || to === '' ? '' : ` ${formatDateSk(from)} – ${formatDateSk(to)}`;
  return percent === 0 ? `Zľava${window}` : `Zľava do ${percent} %${window}`;
}

/** Filter ako čipy — to isté, čo vidno v tabe Produkty. Zamknuté sem nepatria. */
function describeFilter(filter: CatalogFilterState): string[] {
  const chips: string[] = [];
  if (filter.query.trim() !== '') chips.push(`„${filter.query.trim()}"`);
  if (filter.soldBuckets.includes('none')) chips.push('0 predaných');
  if (filter.soldBuckets.includes('low')) chips.push('1–2 predané');
  if (filter.soldBuckets.includes('mid')) chips.push('3–9 predaných');
  if (filter.soldBuckets.includes('high')) chips.push('10 a viac predaných');
  if (filter.priceFrom.trim() !== '') chips.push(`cena od ${filter.priceFrom}`);
  if (filter.priceTo.trim() !== '') chips.push(`cena do ${filter.priceTo}`);
  if (filter.neverDiscounted) chips.push('nikdy nezlacnené');
  if (chips.length === 0) chips.push('celý katalóg');
  return chips;
}

export default NewDiscount;
