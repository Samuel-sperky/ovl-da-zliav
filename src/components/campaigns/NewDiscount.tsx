'use client';

/**
 * Aura Zľavy — NOVÁ ZĽAVA (V11; predloha `design/v3/nova-zlava.html`,
 * architektúra §2, kontrakt V3 K1–K8, invarianty I3, I9, I11; kontrakt UI,
 * bod 24).
 *
 * Jedna obrazovka, najviac TRI sekcie, dva stĺpce:
 *
 *   VÝBER PRODUKTOV      ·  ZÁPIS A POTVRDENIE
 *   PÁSMA A OKNO         ·  (dominanta: koľko produktov zlacnie)
 *
 * Pri prázdnom výbere sú sekcie DVE: pásma a okno sa nekreslia vôbec a prázdny
 * stav je jeden riadok v sekcii výberu (D14, 19. 8. 2026). Prekážky vlastnú
 * kartu nemajú — sú v karte rozhodnutia, ktoré blokujú (D13).
 *
 * Prečo je to jedna obrazovka a nie sprievodca: rozhodnutie „zlacniť 8 000
 * ležiakov" nemá tri nezávislé kroky. Počet produktov, percentá a dátum štartu
 * na sebe visia — zmena stropu mení odhad dobehnutia a ten mení navrhovaný
 * štart. V sprievodcovi by sa to dalo vidieť až na konci.
 *
 * PREČO SÚ TRI SEKCIE A NIE ŠTYRI (18. 8. 2026, P4)
 * ------------------------------------------------
 * Do 18. 8. boli ŠTART a POTVRDENIE dve karty nad sebou a obrazovka sa
 * nezmestila do 1,5 obrazovky pri 1440×900. Zlúčili sa do jednej karty
 * rozhodnutia: dominanta (počet produktov) je hore, dva dátumy pod ňou a
 * medzikroky výpočtu — rozpočet, fronta pred nami, dĺžka behu — sú v rozkliku
 * „Ako to počítam" (P6). Nič sa nezmazalo, len sa to prestalo pýtať pozornosť
 * skôr než dominanta (P1).
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
 *  5. **Strop výber neodmietne ticho.** Keď je vo filtri viac produktov, než
 *     pustí režim rozsahu, obrazovka to POVIE a rovno ponúkne prepnutie do
 *     plného rozsahu aj s upozornením, že si to vyžiada výslovné potvrdenie
 *     (`ScopeRelease`; do 27. 8. 2026 heslo — D105). Odmietnutie
 *     bez ponuky je tu zakázané — presne to bol dôvod, prečo sa appka nedala
 *     použiť na viac než desať produktov.
 *  6. **Čas hovorí jedno číslo.** Koľko je vo fronte pred nami vie povedať
 *     `/api/queue` (presne, z položiek) aj zoznam zliav (odhadom, z počítadiel).
 *     Zmieruje ich `resolveAhead()` a rozklik prizná, ktorý zdroj to bol.
 *     Keď sa nedá prečítať ani jeden, dátum dobehnutia sa NEDOPOČÍTA (P7).
 *     „Jedno číslo" platí aj cez potvrdenie: odhad tu je nad `aheadPending +
 *     itemsCount`, a `POST /api/campaigns` počíta ten istý súčet z celej fronty
 *     (`readQueuePending()`), takže karta „Zaradené do fronty" nevypíše skorší
 *     dátum, než aký ukázala táto obrazovka. Kto zmení jednu stranu, musí
 *     druhú — inak sa dva dátumy tej istej fronty rozídu.
 *  7. **Nič sa neobnovuje samo** (kontrakt UI, bod 4). Čísla sa načítajú pri
 *     otvorení a potom vždy, keď o to požiada tlačidlo Obnoviť v stavovom
 *     pruhu — obrazovka je registrovaná cez `useRefreshable()` a vlastné
 *     tlačidlo nekreslí.
 *
 * PREČO SA PREKÁŽKY POČÍTAJU LOKÁLNE
 * ----------------------------------
 * `GET /api/status` vracia prekážky pre PRÁZDNY výber. Tu sa nad tým istým
 * snapshotom prepočítajú znova, ale s výberom (`statusSnapshotFromPayload`) —
 * je to jediná podporovaná cesta, ako sa dozvedieť „prejde MOJICH 150", bez
 * druhého volania servera. `missingProductIds` sa dopĺňa ako PRÁZDNE pole
 * vedome: každý riadok výberu prišiel z katalógu appky, takže „ktoré z vybraných
 * v katalógu nie sú" je overene prázdna množina, nie domnienka. Označené
 * produkty, ktoré katalóg nevrátil, sa do výberu vôbec nedostanú a hlási ich
 * samostatný riadok v sekcii výberu.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 * **`selectionVersion` je poistka I3.** Rastie vždy, keď sa načítané riadky
 * naozaj zmenia — a práve preto sa porovnáva odtlačok riadkov, nie čas
 * načítania: obnova, ktorá vráti tú istú sadu, nesmie zahodiť hotovú skúšku,
 * ale akákoľvek zmena produktov, ich predajnosti či ceny ju zahodiť MUSÍ.
 *
 * **`queueBlockedReason()` je celá poistka I3 na jednom mieste.** Od 19. 8.
 * 2026 je to exportovaná čistá funkcia, nie IIFE vnútri komponentu — dovtedy
 * sa pravidlo „vpísaný počet musí sedieť s výberom" nedalo otestovať, lebo
 * jediný test si `blockedReason` podával ako prop. Kto sem pridá ďalší dôvod
 * zámku, pridá ho do tej funkcie a doplní mu test; kto tam pridá cestu, ktorá
 * zámok obchádza, obišiel I3.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BlockerRules } from '@/components/campaigns/BlockerList';
import DiscountPresets from '@/components/campaigns/DiscountPresets';
import NewDiscountConfirm from '@/components/campaigns/NewDiscountConfirm';
import NewDiscountStart from '@/components/campaigns/NewDiscountStart';
import ScopeRelease from '@/components/campaigns/ScopeRelease';
import styles from '@/components/campaigns/new-discount.module.css';
import {
  alarmingCards,
  cardOfBlocker,
  findCard,
  quietCards,
  resetPhrase,
  resolveAhead,
  type BlockerCard,
  type QueueSnapshotView,
} from '@/components/campaigns/queue-model';
import {
  DEFAULT_TIER_PERCENT,
  buildTiers,
  discountWriteRequest,
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
import { prefillNoteText } from '@/components/campaigns/presets-model';
import {
  createDiscount,
  fetchQueue,
  fetchStatus,
  keyMeta,
  listDiscounts,
  previewDiscount,
  scopeLimits,
  searchCatalog,
  type ApiError,
  type BudgetView,
  type CreateResult,
  type KeyMetaView,
  type PreviewData,
  type ScopeView,
  type StatusPayload,
} from '@/components/campaigns/zlavy-api';
import { useRefreshable } from '@/components/layout/refresh';
/* Značka príznaku (`FlagMark`) — pravidlo troch kanálov: príznak nesie
   farba AJ ikona AJ slovo, nikdy len farba. Import chýbal, lebo agent V6b
   dopísal značky a session mu skončila pred importom. */
import { FlagMark } from '@/components/ui/StatusMark';
import {
  SOLD_WINDOWS,
  catalogFilterKey,
  catalogSearchQuery,
  describeCatalogFilter,
  type CatalogFilterState,
} from '@/components/products/catalog-filter';
import SoldCoverageNote from '@/components/products/SoldCoverageNote';
import {
  fullyReadDays,
  soldCoverageNote,
  useSoldCoverage,
  type SoldCoverageState,
} from '@/components/products/sold-coverage';
import { addDays, diffDays, maxAllowedTo } from '@/lib/domain/dates';
import { collectOperationBlockers } from '@/lib/status/blockers';
/*
 * JEDNA CESTA K PRIMITÍVAM (V6b). Barrel `components/ui` je zámerne jediný
 * import: keby si obrazovka ťahala `Panel` zo súboru a `Table` z barrelu,
 * vznikli by dva spôsoby, ako dostať tú istú vec do stránky — a tretí pri
 * prvom refaktore (viď docblock `components/ui/index.ts`).
 */
/* Z vrstvy V6a sa tu dnes nepoužíva NIČ. Agent V6b si naimportoval celú
   tabuľkovú a rámcovú skupinu (`Table`, `Panel`, `PageHeader`, `Segmented`,
   `StatTile`, `ToneBadge`, `Chip`…) a session mu skončila pred prepisom
   sprievodcu, takže to bolo trinásť mien bez použitia. Import sa vráti vtedy,
   keď obrazovka tie primitíva naozaj začne kresliť — nie dopredu. Jediné, čo
   z jeho práce zostalo, je `FlagMark` pri príznakoch nižšie. */
import { statusSnapshotFromPayload } from '@/lib/status/snapshot';
import { formatDateSk, formatEur } from '@/lib/ui/format';
import { LOCKED_DIMENSION_REASON, lockedDimensionLabels } from '@/lib/ui/locked-dimensions';
import {
  knownValue,
  missingValue,
  productColumns,
  valueOrGap,
  type ProductColumnId,
  type ProductRowValues,
  type ProductSoldWindow,
} from '@/lib/ui/product-columns';
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

/* ═══════════════════════ tri kroky sprievodcu ═════════════════════════════ */

/**
 * TRI KROKY, KTORÉ SPRIEVODCA UKAZUJE NAHLAS (V6b, 2. 9. 2026).
 *
 * PREČO TO VZNIKLO: Samuel povedal „neviem vytvoriť zľavu". Obrazovka mala
 * tri karty bez poradia — výber, pásma, rozhodnutie — a nič nehovorilo, čo
 * príde po čom ani kde človek práve stojí. Kto nevedel, že skúška naprázdno
 * je POVINNÝ krok pred zaradením (I3), videl len vypnuté tlačidlo bez príčiny.
 *
 * Pás krokov je NÁVOD, nie navigácia: nedá sa naň klikať, lebo kroky sa
 * nepreskakujú. Zoradenie je zhodné s poradím podmienok v
 * `queueBlockedReason()` — tá istá príčinnosť, dvakrát tá istá pravda.
 */
export const WIZARD_STEPS = [
  { key: 'vyber', title: 'Výber produktov' },
  { key: 'pasma', title: 'Pásma a okno platnosti' },
  { key: 'zapis', title: 'Skúška naprázdno a potvrdenie' },
] as const;

/** Stav jedného kroku. Slovo je DRUHÝ kanál k číslu a farbe (kontrakt V6 §4). */
export type WizardStepState = 'done' | 'now' | 'next';

/** Slovo pre stav kroku — čítačka aj monochromatická snímka ho prečítajú. */
export const WIZARD_STEP_WORD: Readonly<Record<WizardStepState, string>> = {
  done: 'hotové',
  now: 'teraz',
  next: 'potom',
};

/** Z čoho sa rozhoduje, v ktorom kroku sprievodca stojí. */
export interface WizardProgress {
  /**
   * Koľko produktov by zľavu NAOZAJ dostalo — súčet pásiem, nie veľkosť
   * výberu (D121). Krok 1 nie je hotový tým, že sa niečo označilo: produkt
   * s neznámym predajom je vo výbere, ale do zápisu nejde.
   */
  readonly discountedCount: number;
  /** Percentá pásiem aj okno platnosti sú bez chyby. */
  readonly planReady: boolean;
  /** Skúška naprázdno sedí na PRÁVE ZOBRAZENÝ výber (I3). */
  readonly previewFresh: boolean;
  /** Zľava už je zaradená do fronty — sprievodca dobehol. */
  readonly created: boolean;
}

/**
 * Stav troch krokov, v poradí `WIZARD_STEPS`.
 *
 * Je to čistá funkcia a nie výraz v JSX zámerne: pravidlo „kým nie je čo
 * zapísať, tretí krok NIE JE na rade" je to isté pravidlo ako brána I3
 * v `queueBlockedReason()`, a keby žilo v JSX, nedalo by sa overiť bez
 * prehliadača. `previewFresh` nerobí z tretieho kroku „hotové": hotový je
 * až po zaradení do fronty — dovtedy chýba ručne vpísaný počet, teda posledná
 * brzda pred produkčným eshopom.
 */
export function wizardStepStates(progress: WizardProgress): readonly WizardStepState[] {
  if (progress.created) return ['done', 'done', 'done'];

  const hasWrite = progress.discountedCount > 0;
  if (!hasWrite) return ['now', 'next', 'next'];
  if (!progress.planReady) return ['done', 'now', 'next'];
  return ['done', 'done', 'now'];
}

/**
 * Prečo produkt s neznámym predajom zľavu nedostane — JEDNA formulácia (D121).
 *
 * Stojí v priznaní nad tabuľkou pásiem aj v prázdnej tabuľke pásiem. Dve
 * kópie tej istej vety by sa po prvej úprave rozišli a obrazovka by o tom
 * istom fakte hovorila dvakrát inak (kontrakt V6 §4, bod 1: priznania majú
 * zabehnuté formulácie).
 */
export const UNKNOWN_SOLD_PHRASE = 'pásmo sa im určiť nedá, zľavu nedostanú';

export interface NewDiscountInitial {
  /** Konkrétne označené produkty z tabu Produkty; `null` = výber z filtra. */
  readonly productIds: readonly number[] | null;
  readonly filter: CatalogFilterState;
  /** Koľko produktov filtru vyhovovalo v tabe Produkty (len na porovnanie). */
  readonly expectedTotal: number | null;
  /**
   * Okno platnosti z adresy (`?od=&do=`). Používajú ho návrhy z Prehľadu, keď
   * nadväzujú na končiacu zľavu — bez neho by ho používateľ prepisoval ručne.
   * Keď je zadané, appka si okno UŽ NEPOSÚVA sama (má prednosť človek, K5).
   */
  readonly window: { readonly from: string; readonly to: string | null } | null;
  /**
   * Percentá pásiem z presetu alebo zo zopakovanej zľavy (D112). Prázdny objekt
   * = formulár si necháva svoje predvolené. Percento pásma, ktoré v adrese
   * nebolo, sa NEDOPOČÍTAVA z ostatných.
   */
  readonly percents?: Readonly<Partial<Record<SoldBucketKey, number>>>;
  /** Dĺžka okna v dňoch z presetu; `null` = predvolená dĺžka appky. */
  readonly windowDays?: number | null;
  /**
   * Odkiaľ sú polia predplnené — LEN na vetu pre človeka. Na zápis to nemá
   * žiadny vplyv: preset ani zopakovanie neobchádzajú dry-run a potvrdenie (I3).
   */
  readonly prefillFrom?: {
    readonly kind: 'preset' | 'campaign';
    readonly label: string;
  } | null;
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
  /**
   * Označené produkty, ktoré katalóg vôbec nevrátil. Do výberu sa nedostanú,
   * takže prekážky o nich mlčia — ale používateľ ich označil a musí sa
   * dozvedieť, že zľavu nedostanú (K7).
   */
  const [notInCatalog, setNotInCatalog] = useState(0);
  /** Koľko riadkov má zrkadlo katalógu vôbec; `0` = ešte sa nesynchronizovalo. */
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);
  /**
   * Koľko produktov filtra nemá predaj za okno ZMERANÝ (D121, `counts.soldUnknown`).
   * `null` = nepýtali sme sa alebo to odpoveď nepovedala — teda „nevieme koľko
   * nevieme", nikdy nie nula. Bez tohto čísla obrazovka pri nedočítanom okne
   * tvrdila, že filtru nevyhovuje ani jeden produkt.
   */
  const [soldUnknown, setSoldUnknown] = useState<number | null>(null);
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
  /** Celý obraz stavu appky — z neho sa lokálne prepočítavajú prekážky. */
  const [status, setStatus] = useState<StatusPayload | null>(null);
  /** Živý stav fronty: presný počet čakajúcich položiek a spotreba rozpočtu. */
  const [queue, setQueue] = useState<QueueSnapshotView | null>(null);
  /**
   * Za koľko dní má appka objednávky naozaj stiahnuté (KONTRAKT-PREDAJNOST P3).
   * Pravidlá pásiem
   * hovoria „0 predaných za 180 dní" bez ohľadu na to, koľko dní sa zmeralo —
   * a podľa nich sa tu podpisuje zápis do ostrého shopu.
   */
  const soldCoverage = useSoldCoverage();

  const [name, setName] = useState('');
  /*
   * Predvolené percentá, PREKRYTÉ tým, čo prišlo z presetu alebo zo zopakovanej
   * zľavy (D112). Preset predplní len pásma, ktoré naozaj nesie — zvyšok
   * zostáva na predvolených hodnotách appky a nič sa nedopočítava.
   */
  const [percents, setPercents] = useState<Record<SoldBucketKey, number>>({
    ...DEFAULT_TIER_PERCENT,
    ...(initial.percents ?? {}),
  });
  /**
   * Dĺžka okna, ktorú appka použije pri SVOJOM návrhu štartu. Z presetu je to
   * jeho `durationDays`, inak predvolené 14 dní (D12).
   */
  const windowLength =
    initial.windowDays !== null && initial.windowDays !== undefined
      ? initial.windowDays
      : DEFAULT_WINDOW_DAYS;
  const [from, setFrom] = useState(initial.window?.from ?? '');
  // Návrh nadväznosti pozná len začiatok — dĺžku doplní preset alebo predvolená.
  const [to, setTo] = useState(
    initial.window === null
      ? ''
      : (initial.window.to ?? addDays(initial.window.from, windowLength - 1)),
  );
  // Okno z adresy sa počíta ako „človek si ho už zvolil" — návrh appky ho
  // potom neprepíše (K5).
  const [windowTouched, setWindowTouched] = useState(initial.window !== null);

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewSig, setPreviewSig] = useState<string | null>(null);
  const [previewAt, setPreviewAt] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  // Obrazovka sa otvára do načítania — nie do prázdneho výberu.
  const [busy, setBusy] = useState<Busy>('loading');
  // Celá obálka chyby, nie len jej správa: karta rozhodnutia prekladá vetu
  // servera podľa KÓDU (K10) a bez kódu by ju vykreslila verbatim.
  const [error, setError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<CreateResult | null>(null);


  /** Generácia načítania — odpoveď starého výberu sa nesmie zapísať do nového. */
  const gen = useRef(0);
  /** To isté pre kontext (strop, kľúč, fronta, stav) pri obnove. */
  const ctxGen = useRef(0);
  /** Verzia výberu — mení sa len vtedy, keď sa naozaj zmenili riadky (I3). */
  const [selectionVersion, setSelectionVersion] = useState(0);
  /** Odtlačok posledných načítaných riadkov; prázdny = ešte nič neprišlo. */
  const selectionPrint = useRef<string | null>(null);
  /** Poradové číslo vyžiadanej obnovy; `null` = prvé načítanie ešte nezačalo. */
  const [refreshTicket, setRefreshTicket] = useState<number | null>(null);

  /* ── 1. Kontext: strop, rozpočet, fronta pred nami, kľúč ─────────────── */

  // Registrácia do spoločného obnovovania (kontrakt UI, bod 4): raz pri
  // otvorení a potom vždy, keď to vypýta tlačidlo Obnoviť v stavovom pruhu.
  useRefreshable(async (token) => {
    const mine = ctxGen.current + 1;
    ctxGen.current = mine;
    const fresh = (): boolean => ctxGen.current === mine;
    // Znovunačítanie výberu visí na tomto čísle — ide o tie isté dáta.
    setRefreshTicket(token);

    await Promise.all([
      scopeLimits().then((res) => {
        if (!fresh()) return;
        if (res.ok) setScope(res.data);
        // Výber sa načítava až po tejto odpovedi: v režime `pilot` je strop 10
        // a bez neho by prvé načítanie zbytočne prelistovalo celý katalóg (K1).
        setScopeReady(true);
      }),
      keyMeta().then((res) => {
        if (fresh() && res.ok) setKey(res.data);
      }),
      listDiscounts(50).then((res) => {
        if (!fresh() || !res.ok) return;
        setBudget(res.data.budget);
        setAhead(queueAhead(res.data.data));
      }),
      // Presný stav fronty a rozpočtu. Keď sa nedá prečítať, ostáva `null` a
      // obrazovka sa vráti k odhadu zo zoznamu zliav — nikdy k nule (P7).
      fetchQueue().then((res) => {
        if (fresh() && res.ok) setQueue(res.data);
      }),
      fetchStatus().then((res) => {
        if (fresh() && res.ok) setStatus(res.data);
      }),
    ]);
  });

  /*
   * Efektívny strop jednej zľavy. Keď sa nastavenia nedajú prečítať, siahne sa
   * po tom istom čísle zo stavu appky — inak by obrazovka o strope MLČALA
   * práve vtedy, keď oň používateľ zakopne, a výber by sa orezal bez slova.
   */
  const maxProducts =
    scope !== null
      ? Math.min(scope.maxProducts, HARD_MAX_PRODUCTS)
      : status !== null && status.scope.maxProducts !== null
        ? Math.min(status.scope.maxProducts, HARD_MAX_PRODUCTS)
        : null;
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
    /** ID, ktoré katalóg naozaj vrátil — zvyšok označených v ňom nie je (K7). */
    const seen = new Set<number>();
    let dropped = 0;
    let total: number | null = null;
    let mirrorRows: number | null = null;
    let unknownSold: number | null = null;
    let failure: string | null = null;

    const take = (
      data: readonly {
        productId: number;
        name: string | null;
        reference?: string | null;
        price: string | null;
        /** `null` = „za toto okno to nevieme" (D121) — nikdy sa nedosádza nula. */
        unitsSold: number | null;
        discountedNow: boolean;
      }[],
    ): void => {
      for (const row of data) {
        seen.add(row.productId);
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
          // D116 — referencia sa NESIE ďalej, aj keď ju katalóg zatiaľ nemusí
          // poslať; chýbajúca hodnota je „nevieme", nie prázdny kód.
          ...(row.reference === undefined || row.reference === null
            ? {}
            : { reference: row.reference }),
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
        mirrorRows = res.data.catalogTotal;
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
          mirrorRows = res.data.catalogTotal;
          unknownSold = res.data.counts === null ? null : res.data.counts.soldUnknown;
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
      setSoldUnknown(null);
      setLoadError(failure);
      return;
    }
    setRows(collected);
    setMatching(total);
    setSoldUnknown(unknownSold);
    setSkipped(dropped);
    // Chýbajúce hlásime LEN pri označených produktoch: pri výbere z filtra
    // prišlo z katalógu všetko, čo v ňom je, takže „chýbajúce" tam neexistuje.
    setNotInCatalog(
      source === 'products'
        ? (initial.productIds ?? []).filter((id) => !seen.has(id)).length
        : 0,
    );
    setCatalogTotal(mirrorRows);
    setLoadError(failure);

    /*
     * I3 — skúška naprázdno platí pre PRÁVE ZOBRAZENÝ výber. Verzia preto rastie
     * pri každej skutočnej zmene riadkov (iné produkty, iná predajnosť, iná
     * cena), ale NIE pri obnove, ktorá vrátila tú istú sadu. Odtlačok je jediné
     * miesto, kde sa to rozhoduje.
     */
    const print = selectionPrintOf(collected);
    if (print !== selectionPrint.current) {
      selectionPrint.current = print;
      setSelectionVersion((value) => value + 1);
    }
  }, [cap, filter, initial.productIds, source]);

  useEffect(() => {
    if (!scopeReady || refreshTicket === null) return;
    const timer = setTimeout(() => {
      void loadSelection();
    }, 300);
    return () => clearTimeout(timer);
    // Závislosťami sú TEXTOVÉ ODTLAČKY vstupov (`filterKey`, `pickedKey`), nie
    // objekty — inak by sa výber načítaval znova pri každom prekreslení.
  }, [filterKey, pickedKey, source, cap, scopeReady, refreshTicket, loadSelection]);

  /* ── 3. Pásma, vzorka, priemerná cena ────────────────────────────────── */

  /*
   * D121 (28. 8. 2026) — pásma sa skladajú LEN z produktov, ktorých predaj
   * appka naozaj zmerala. Produkt s neznámym predajom sa do pásma nezaradí
   * (predtým spadol do vedra `none`, teda −30 %) a do kampane sa NEDOSTANE;
   * priznáme ho počtom nižšie.
   */
  const partition = useMemo(
    () =>
      rows === null
        ? { tiers: [] as TierPlan[], unknownProductIds: [] as readonly number[] }
        : buildTiers(rows, filter.soldWindowDays, percents),
    [rows, filter.soldWindowDays, percents],
  );
  const tiers: TierPlan[] = partition.tiers;
  /** Produkty, ktoré sa do zľavy nedostanú, lebo ich predaj nepoznáme (D121). */
  const skippedUnknown = partition.unknownProductIds;
  /** Len tie produkty, ktoré pásmo naozaj dostali — toto ide do kampane. */
  const tieredProductIds = useMemo(
    () => tiers.flatMap((tier) => [...tier.productIds]),
    [tiers],
  );
  const itemsCount = rows === null ? 0 : rows.length;
  /**
   * KOĽKO PRODUKTOV ZĽAVU NAOZAJ DOSTANE (D121, I3).
   *
   * `itemsCount` je veľkosť VÝBERU, `discountedCount` je veľkosť ZÁPISU. Kým
   * server posielal predaje ako nulu, boli to tie isté čísla; po D121 sa
   * rozchádzajú: produkt s neznámym predajom je vo výbere, ale do pásma sa
   * nezaradí a `discountWriteRequest()` ho do tela zápisu nepustí
   * (`discounts-model.ts` — telo je zjednotenie pásiem).
   *
   * Preto všade, kde sa hovorí o TOM, ČO SA ZAPÍŠE — brána ručne vpísaného
   * počtu, dominanta karty rozhodnutia, odhad dobehnutia, súčtový riadok pásiem
   * — stojí `discountedCount`. Do 31. 8. 2026 tam stál `itemsCount`, takže pri
   * dnešnom pokrytí (2 dni zo 180) karta hlásila „Vyberá sa 200", brána žiadala
   * napísať 200 a do fronty išlo 5: ručne vpísaný počet je povrchová podoba I3
   * a potvrdzoval INÚ množinu, než sa zapisuje.
   */
  const discountedCount = tieredProductIds.length;
  const sample = useMemo(() => spreadSample(rows ?? [], tiers, 6), [rows, tiers]);
  const tierOfProduct = useMemo(() => {
    const map = new Map<number, TierPlan>();
    for (const tier of tiers) for (const id of tier.productIds) map.set(id, tier);
    return map;
  }, [tiers]);
  const avgPrice = useMemo(() => averagePriceOf(rows ?? []), [rows]);

  /* ── 4. Odhad dobehnutia a navrhovaný štart ──────────────────────────── */

  /*
   * Rozpočet aj počet položiek pred nami majú DVA zdroje a musia dať jedno
   * číslo. Prednosť má `/api/queue`: ten číta priamo položky fronty, kým
   * zoznam zliav sčítava počítadlá kampaní, ktoré sa dorovnávajú až po behu.
   */
  const queueBudget = queue === null ? null : queue.budget;
  const perDay =
    queueBudget !== null
      ? queueBudget.budget
      : budget !== null
        ? budget.budget
        : (scope?.dailyWriteBudget ?? null);
  const remainingToday =
    queueBudget !== null ? queueBudget.remaining : budget !== null ? budget.remaining : null;

  const aheadView = resolveAhead({
    queuePending: queue === null ? null : queue.queue.pending,
    listPending: ahead === null ? null : ahead.pending,
  });
  const aheadPending = aheadView.pending;

  // Bez známeho rozpočtu ANI bez známej fronty pred nami sa dátum nedopočíta —
  // vymyslený deň dobehnutia je horší než priznaná medzera (P7).
  const estimate =
    perDay === null || discountedCount === 0 || !aheadView.known
      ? null
      : estimateFinishDay(aheadPending + discountedCount, perDay, {
          ...(remainingToday !== null ? { remainingToday } : {}),
        });
  const finishDay = estimate === null ? null : estimate.date;
  const queueDays = estimate === null ? null : estimate.days;
  const proposedStart = finishDay === null ? null : proposeStart(finishDay);

  const startBudget =
    queueBudget !== null
      ? {
          spent: queueBudget.spent,
          limit: queueBudget.budget,
          resetsAt: resetPhrase(queue === null ? null : queue.limits.nextResetAt),
        }
      : budget !== null
        ? { spent: budget.spent, limit: budget.budget, resetsAt: null }
        : null;

  // Kým sa okna nikto nedotkol, drží sa návrhu appky (K5). Po prvej ručnej
  // zmene sa už neposúva sám — používateľ má prednosť pred odhadom.
  useEffect(() => {
    if (windowTouched) return;
    const start = proposedStart ?? todayLogical();
    if (start === from) return;
    setFrom(start);
    setTo(addDays(start, windowLength - 1));
  }, [proposedStart, windowTouched, from, windowLength]);

  const windowDays = safeWindowDays(from, to);

  /* ── 4b. Prekážky nad VLASTNÝM výberom a strop rozsahu (K1, C2) ───────── */

  /**
   * Prekážky pre výber, ktorý sa naozaj zaradí. `missingProductIds: []` je
   * overený fakt, nie domnienka — každý riadok výberu prišiel z katalógu appky
   * (viď hlavička súboru).
   */
  const blockerCards: readonly BlockerCard[] = useMemo(() => {
    if (status === null) return [];
    const snapshot = statusSnapshotFromPayload(status, {
      selection: { selectedCount: itemsCount },
      missingProductIds: [],
    });
    return collectOperationBlockers(snapshot).map(cardOfBlocker);
  }, [status, itemsCount]);

  /** Koľko produktov by do zľavy išlo, keby strop rozsahu nebol. */
  const wanted = matching ?? itemsCount;
  /** `true` = výber orezal STROP REŽIMU, nie vlastný strop používateľa. */
  const scopeTrims = maxProducts !== null && wanted > maxProducts;

  /**
   * Tá istá prekážka, ale spočítaná nad tým, čo používateľ CHCEL — inak by veta
   * tvrdila „vo výbere je 10 produktov" práve vtedy, keď ich je 150 a 140 sa
   * zahodilo.
   */
  const scopeBlocker: BlockerCard | null = useMemo(() => {
    if (status === null || !scopeTrims) return null;
    const snapshot = statusSnapshotFromPayload(status, {
      selection: { selectedCount: wanted },
      missingProductIds: [],
    });
    const cards = collectOperationBlockers(snapshot).map(cardOfBlocker);
    return findCard(cards, 'scope_pilot_cap') ?? findCard(cards, 'scope_full_cap');
  }, [status, scopeTrims, wanted]);

  const alarming = alarmingCards(blockerCards);
  const rules = quietCards(blockerCards);

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

  /*
   * I3 — čo všetko robí zo skúšky naprázdno „inú" skúšku: iné riadky
   * (`selectionVersion`), iný počet, iné okno, iné pásmo, iné percento a iné
   * obdobie predajnosti (mení pravidlo pásma, teda aj to, čo človek videl).
   */
  const signature = `${selectionVersion}|${itemsCount}|${discountedCount}|${from}|${to}|${filter.soldWindowDays}|${tiers
    .map((tier) => `${tier.ord}:${tier.percent}`)
    .join(',')}`;
  const previewFresh =
    preview !== null && previewSig === signature && preview.previewToken !== '';

  const runPreview = useCallback(async () => {
    if (rows === null || rows.length === 0 || tiers.length === 0) return;
    if (percentError !== undefined || windowError !== null) return;
    setBusy('previewing');
    setError(null);
    /*
     * D121 — produkty a pásma skladá JEDNA funkcia, aby sa nemali ako rozísť.
     * Do 28. 8. 2026 tu stáli dva nezávislé výrazy (`rows.map(…)` a pásma),
     * takže produkt s neznámym predajom šiel do kampane bez platného percenta
     * — a mutácia toho riadku nechala 93 testov zelených. Podrobne v docbloku
     * `discountWriteRequest()`.
     */
    const res = await previewDiscount({
      ...discountWriteRequest(partition),
      from,
      to,
      kind: 'new',
      ...(from === to ? { oneDayAcknowledged: true } : {}),
    });
    setBusy('idle');
    if (!res.ok) {
      setPreview(null);
      setPreviewSig(null);
      setError(res.error);
      return;
    }
    setPreview(res.data);
    setPreviewSig(signature);
    setPreviewAt(new Date().toISOString());
    setError(null);
  }, [rows, tiers, tieredProductIds, percentError, windowError, from, to, signature]);

  const blockedReason = queueBlockedReason({
    itemsCount: discountedCount,
    skippedUnknown: skippedUnknown.length,
    writesLocked: scope !== null && scope.writesLocked,
    percentError,
    windowError,
    previewFresh,
    previewBlockers: preview === null ? 0 : preview.blockers.length,
    typed,
  });

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
      setError(res.error);
      return;
    }
    setCreated(res.data);
  }, [preview, name, tiers, from, to, filter.soldWindowDays]);

  function onQueue() {
    if (blockedReason !== null) return;
    // Do 27. 8. 2026 tu stálo overenie sudo okna (D70). Zaradenie do fronty
    // ďalej NIE JE jeden klik: `blockedReason` a náhľad (dry-run) držia I3.
    void doQueue();
  }

  /* ── 6. Vykreslenie ──────────────────────────────────────────────────── */

  /*
   * ZAMKNUTÉ ROZMERY Z JEDNÉHO ZOZNAMU (D125, K4; 1. 9. 2026).
   *
   * Do zelenej brány V5 tu stál literál `['kategória', 'kov', 'typ šperku',
   * 'marža', 'obrátkovosť']` s vetou „Čaká na dáta zo shopu". Marža a celkovo
   * objednané pritom na Produktoch NORMÁLNE FILTRUJÚ (`CatalogFilters.tsx`,
   * `catalog.repo.ts` po D125) — takže tá istá appka na jednej obrazovke podľa
   * marže filtrovala a na druhej tvrdila, že na ňu dáta nemá. Zoznam je odteraz
   * odvodený od `LockedCatalogFilter`, teda od jediného vlastníka tej otázky.
   */
  const lockedChips = lockedDimensionLabels();

  /** Veta o predplnení z presetu / zo zopakovanej zľavy; `null` = nič také. */
  const prefillNote = prefillNoteText(initial.prefillFrom ?? null);

  /** Prázdne zrkadlo katalógu — z neho sa počet vyhovujúcich NEDÁ prečítať. */
  const catalogEmpty = catalogTotal === 0;
  /** Z koľkých sa vyberá. Neznáme je pomlčka, nikdy nula (kontrakt UI, bod 5). */
  const matchingUnknown = matching === null || (source === 'filter' && catalogEmpty);

  const emptySelection = rows !== null && itemsCount === 0 && busy !== 'loading';

  /*
   * PRÁZDNY VÝBER MÁ DVA RÔZNE DÔVODY A NESMÚ SA ZLIAŤ (I11, 31. 8. 2026).
   *
   * Predvolený filter tejto obrazovky je „0 predaných za 180 dní" (`LEZIAKY`
   * v `app/zlavy/nova/page.tsx`), a vedro `none` znamená po D121 MERANÚ nulu:
   * pri nedočítanom okne server prepne bránu na `1 = 0` a nevráti nič. Veta
   * „filtru nevyhovuje ani jeden produkt" je vtedy nepravda — produktov je
   * 40 511, len o ich predaji appka nevie nič. Fail-closed drží (nič sa
   * nezapíše), ale obrazovka musí povedať PRAVÝ dôvod.
   */
  const emptyText = emptySelectionText({
    catalogEmpty,
    wantsMeasuredZero: filter.soldBuckets.includes('none'),
    coverageAdmitted: soldCoverageNote(soldCoverage, filter.soldWindowDays) !== null,
    soldWindowDays: filter.soldWindowDays,
    soldUnknown,
  });

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

      {/*
       * Odkiaľ sú predplnené polia (D112). Veta hovorí OBE veci: čím sú
       * vyplnené a že sa tým NIČ nezapísalo — preset ani zopakovanie zľavy
       * neobchádzajú skúšku naprázdno a potvrdenie (I3).
       */}
      {prefillNote === null ? null : (
        <div className="lvl-3" data-testid="prefill-note">
          {prefillNote}
        </div>
      )}

      <div className={styles.nz}>
        {/* ── ĽAVÝ STĹPEC ─────────────────────────────────────────────── */}
        <div className={styles.nzCol}>
          {/* SEKCIA 1 — VÝBER PRODUKTOV */}
          <section className="sec" data-testid="new-discount-selection">
            <div className="sec-h">
              <h2>Výber produktov</h2>
              {/* `.chip.on` sa od `.chip` líši len pozadím, obrysom a farbou
                  textu. Ktorý zdroj výberu práve platí, preto bez
                  `aria-pressed` nie je čím prečítať. */}
              <div className="act">
                <button
                  type="button"
                  className={source === 'filter' ? 'chip on' : 'chip'}
                  aria-pressed={source === 'filter'}
                  onClick={() => setSource('filter')}
                  data-testid="source-filter"
                >
                  Z filtra
                </button>
                {hasPicked ? (
                  <button
                    type="button"
                    className={source === 'products' ? 'chip on' : 'chip'}
                    aria-pressed={source === 'products'}
                    onClick={() => setSource('products')}
                    data-testid="source-products"
                  >
                    Z označených{' '}
                    <span className="c">{formatCountSk((initial.productIds ?? []).length)}</span>
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
                <span key={chip} className="chip lock" title={LOCKED_DIMENSION_REASON}>
                  {chip}
                </span>
              ))}
              <span className="lvl-3" style={{ marginLeft: '8px' }}>
                Obdobie
              </span>
              {/*
               * `.seg button.on` sa od nevybraného líši VÝHRADNE pozadím
               * a farbou textu (`globals.css`). Bez `aria-pressed` je teda
               * zvolené okno stav oznámený len farbou — presne to, čo P3
               * zakazuje. Súrodenec „Obdobie" vedľa je len text, takže rolu
               * a meno nesie skupina; bez roly by `aria-label` na `<span>`
               * čítačka zahodila.
               */}
              <span className="seg" role="group" aria-label="Za koľko dní sa počítajú predané kusy">
                {SOLD_WINDOWS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={filter.soldWindowDays === days ? 'on' : undefined}
                    aria-pressed={filter.soldWindowDays === days}
                    onClick={() => setFilter({ ...filter, soldWindowDays: days })}
                    data-testid={`window-${days}`}
                  >
                    {days}
                  </button>
                ))}
              </span>
            </div>

            {/*
             * Jeden riadok namiesto dvoch: koľko sa vyberá, z koľkých, a strop.
             * Strop režimu sa tu neopakuje — je v tichých pravidlách pod
             * rozklikom a keď výber oreže, hlási ho `ScopeRelease` (P6).
             */}
            <div className="spread gap-t">
              <div className="lvl-2">
                Vyberá sa{' '}
                <b data-testid="selected-count">
                  {/* Prázdne zrkadlo katalógu = nevieme, nie nula (kontrakt UI, bod 5). */}
                  {matchingUnknown && itemsCount === 0 ? '—' : formatCountSk(itemsCount)}
                </b>{' '}
                {matchingUnknown ? (
                  <span className="lvl-3">z —</span>
                ) : (
                  <span className="lvl-3">
                    z {formatCountSk(matching ?? 0)}{' '}
                    {source === 'products' ? 'označených' : 'vo filtri'}
                  </span>
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
                    matchingUnknown || matching === null || matching === 0
                      ? 0
                      : Math.min(100, (itemsCount / matching) * 100)
                  }%`,
                }}
              />
            </div>

            {skipped === 0 && notInCatalog === 0 && skippedUnknown.length === 0 ? null : (
              <div className="prog-meta">
                {skipped === 0 ? null : (
                  <span className="flag neutral" data-testid="skipped-discounted">
                    <FlagMark tone="neutral" />
                    {formatCountSk(skipped)} už má zľavu podľa vlastných zápisov — vynechané
                  </span>
                )}
                {/*
                  D121 (28. 8. 2026) — produkt, ktorého predaj appka NEPOZNÁ, sa
                  do pásma nezaradí a do zľavy nepôjde. Bez tohto riadku by
                  zmizol ticho: počet v dominante by nesedel s výberom a človek
                  by nevedel, prečo. Do 28. 8. 2026 taký produkt spadol do pásma
                  „0 predaných", teda −30 %.
                */}
                {skippedUnknown.length === 0 ? null : (
                  <span className="flag neutral" data-testid="skipped-unknown-sold">
                    <FlagMark tone="neutral" />
                    {formatCountSk(skippedUnknown.length)} má neznámy predaj — pásmo sa im
                    určiť nedá, zľavu nedostanú
                  </span>
                )}
                {notInCatalog === 0 ? null : (
                  <span className="flag" data-testid="missing-in-catalog">
                    <FlagMark />
                    {formatCountSk(notInCatalog)} označených appka v katalógu nevidí — zľavu
                    nedostanú
                  </span>
                )}
              </div>
            )}

            {scopeTrims ? (
              <ScopeRelease
                wanted={wanted}
                allowed={maxProducts ?? itemsCount}
                blocker={scopeBlocker}
              />
            ) : null}

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

            {/*
             * D14 — prázdny stav je JEDEN RIADOK v tejto karte, nie druhá
             * karta pod ňou. Do 19. 8. 2026 mala sekcia pásiem pri prázdnom
             * katalógu na svojom mieste vycentrovaný prázdny stav a s ním
             * ~300 px ničoho: obrazovka pýtala rozhodnutie a pol ľavého
             * stĺpca bolo prázdnych. Veta a tlačidlo zostávajú presne jedno
             * a jedno (kontrakt UI, bod 11), len prestali potrebovať kartu.
             */}
            {/*
             * Vysvetlivka o pokrytí musí prežiť aj prázdny výber — do 31. 8.
             * 2026 ležala VNÚTRI sekcie pásiem, ktorú `emptySelection` skrýva,
             * takže práve na obrazovke, ktorá „nevieme" potrebuje najviac, tretí
             * stav zmizol úplne.
             */}
            {emptySelection ? (
              <SoldCoverageNote coverage={soldCoverage} windowDays={filter.soldWindowDays} />
            ) : null}
            {emptySelection ? (
              <div className={styles.nzEmpty} data-testid="new-discount-empty">
                <span className="lvl-2">{emptyText}</span>
                <Link
                  className={`btn primary sm ${styles.pushRight}`}
                  href={`/produkty?${catalogSearchQuery(filter)}`}
                >
                  Otvoriť Produkty
                </Link>
              </div>
            ) : null}

          </section>

          {/* SEKCIA 2 — PÁSMA A OKNO PLATNOSTI. Bez výberu sa nekreslí vôbec. */}
          {emptySelection ? null : (
            <section className="sec" data-testid="new-discount-tiers">
              <div className="sec-h">
                <h2>Pásma a okno platnosti</h2>
                <div className="act">
                  <Link className="lvl-3" href={`/produkty?${catalogSearchQuery(filter)}`}>
                    Upraviť výber v Produktoch
                  </Link>
                </div>
              </div>

              <>
                {/* Pravidlo pásma („0 predaných za 180 dní") znie ako meraný
                    fakt o pol roku. Príkaz na zápis do ostrého shopu sa
                    podpisuje TU, takže tu musí stáť aj to, za koľko dní sú
                    objednávky naozaj stiahnuté. Pri plnom pokrytí veta
                    zmizne. */}
                <SoldCoverageNote coverage={soldCoverage} windowDays={filter.soldWindowDays} />

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
                          Načítavam výber…
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
                        {/* Súčet pásiem, nie veľkosť výberu: riadky nad ním
                            hovoria o produktoch, ktoré pásmo dostali. */}
                        <td className="n">{formatCountSk(discountedCount)}</td>
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

                <div className={`spread ${styles.winline}`}>
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
                  <span className="lvl-3">
                    Rovnaké okno pre všetkých {formatCountSk(discountedCount)}
                  </span>
                </div>
                {/* Dátumy stoja v poliach hneď nad tým. V nápovede zostáva len
                    to, čo sa z nich vyčítať nedá: že koniec je VRÁTANE a že je
                    to čas shopu, nie tohto počítača. */}
                {windowError === null ? (
                  <div className="hint">00:00 – 23:59, čas shopu.</div>
                ) : (
                  <div className={styles.note} role="alert" data-testid="window-error">
                    {windowError}
                  </div>
                )}

                {/* Vzorka je vlastný komponent zámerne: rozvrh a bunky sa
                    tak dajú overiť bez siete aj bez prehliadača — tabuľka
                    z tejto obrazovky sa inak vykresliť nedá, lebo riadky
                    prichádzajú až z katalógu. */}
                <SampleTable
                  sample={sample}
                  total={discountedCount}
                  soldWindowDays={filter.soldWindowDays}
                  coverage={soldCoverage}
                  tierOfProduct={tierOfProduct}
                />
              </>
            </section>
          )}

          {/*
           * PRESETY (D112, K7) — pod rozklikom, teda mimo počtu sekcií (P5).
           * Panel vie dve veci: predplniť formulár z uloženého presetu
           * a ULOŽIŤ aktuálne nastavenie ako nový preset. Ani jedna z nich nie
           * je zápis do shopu — zaradiť do fronty sa dá výhradne cez skúšku
           * naprázdno a potvrdenie v pravom stĺpci (I3).
           */}
          <DiscountPresets
            draft={
              tiers.length === 0
                ? null
                : { filter, tiers, windowDays: windowDays > 0 ? windowDays : windowLength }
            }
            testId="new-discount-presets"
          />
        </div>

        {/* ── PRAVÝ STĹPEC ────────────────────────────────────────────── */}
        <div className={styles.nzCol}>
          {/*
           * SEKCIA 2 (v pravom stĺpci) — ROZHODNUTIE. Dominanta (počet
           * produktov) a pod ňou dva dátumy zo `NewDiscountStart`; medzikroky
           * výpočtu sú v jeho rozkliku. Od 19. 8. 2026 sem patria aj prekážky
           * (D13): mali vlastnú kartu vedľa, hoci to isté hlásil stavový pruh
           * nad obrazovkou. Prekážka patrí k rozhodnutiu, ktoré blokuje.
           */}
          <NewDiscountConfirm
            itemsCount={discountedCount}
            countKnown={!(catalogEmpty && itemsCount === 0)}
            tiers={tiers}
            averagePrice={avgPrice}
            obstacles={alarming}
            plan={
              <NewDiscountStart
                itemsCount={discountedCount}
                perDay={perDay}
                aheadPending={aheadPending}
                aheadNames={ahead === null ? [] : ahead.names}
                ahead={aheadView}
                finishDay={finishDay}
                queueDays={queueDays}
                budget={startBudget}
                proposedStart={proposedStart}
                from={from}
                onUseProposal={() => {
                  if (proposedStart === null) return;
                  const length = windowDays > 0 ? windowDays : windowLength;
                  setWindowTouched(true);
                  setFrom(proposedStart);
                  setTo(addDays(proposedStart, length - 1));
                }}
                keyExpiresAt={key === null ? null : key.expiresAt}
                keyPresent={key === null ? true : key.present}
              />
            }
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

          <BlockerRules cards={rules} testId="new-discount-rules" />
        </div>
      </div>

    </div>
  );
}

/* ═══════════════════════════ pomocníci ════════════════════════════════════ */

/** Všetko, z čoho sa rozhoduje, či sa dá zaradiť do fronty. */
export interface QueueGateState {
  /**
   * Koľko produktov by sa NAOZAJ zapísalo — súčet pásiem, nie veľkosť výberu.
   * Po D121 to nie je to isté číslo (produkt s neznámym predajom je vo výbere,
   * ale do zápisu nejde), a brána musí strážiť to, čo sa zapíše.
   */
  itemsCount: number;
  /**
   * Koľko produktov výberu vypadlo, lebo ich predaj appka nezmerala (D121).
   * Chýbajúca hodnota sa číta ako 0 — je to len text dôvodu, nie povolenie:
   * pri `itemsCount === 0` je zaradenie zakázané tak či tak.
   */
  skippedUnknown?: number;
  /** Rozsah appky zápisy zamkol (`scope.writesLocked`). */
  writesLocked: boolean;
  /** Chyba percenta pásma; `undefined` aj `null` znamenajú „bez chyby". */
  percentError: string | null | undefined;
  /** Chyba okna zľavy; `null` = bez chyby. */
  windowError: string | null;
  /** Skúška naprázdno sedí na PRÁVE ZOBRAZENÝ výber (odtlačok `signature`). */
  previewFresh: boolean;
  /** Koľko prekážok našla posledná skúška. */
  previewBlockers: number;
  /** Čo je vpísané v poli ručného počtu. */
  typed: string;
}

/** Z čoho sa skladá veta o prázdnom výbere. */
export interface EmptySelectionReason {
  /** Zrkadlo katalógu je prázdne — nemá sa z čoho vyberať. */
  catalogEmpty: boolean;
  /** Filter žiada MERANÚ nulu (vedro `none`) — presne to, čo brána vyprázdni. */
  wantsMeasuredZero: boolean;
  /** Pokrytie okna si appka priznala (`soldCoverageNote() !== null`). */
  coverageAdmitted: boolean;
  soldWindowDays: number;
  /** `counts.soldUnknown`; `null` = odpoveď to nepovedala. */
  soldUnknown: number | null;
}

/**
 * PRÁZDNY VÝBER MÁ DVA RÔZNE DÔVODY A NESMÚ SA ZLIAŤ (I11, 31. 8. 2026).
 *
 * Predvolený filter tejto obrazovky je „0 predaných za 180 dní" (`LEZIAKY`
 * v `app/zlavy/nova/page.tsx`), a vedro `none` znamená po D121 MERANÚ nulu: pri
 * nedočítanom okne server prepne bránu na `1 = 0` a nevráti nič. Veta „filtru
 * nevyhovuje ani jeden produkt" je vtedy NEPRAVDA — produktov je 40 511, len
 * o ich predaji appka nevie nič. Fail-closed drží (nič sa nezapíše), ale
 * obrazovka, ktorá „nevieme" potrebuje najviac, musí povedať PRAVÝ dôvod.
 */
export function emptySelectionText(reason: EmptySelectionReason): string {
  if (reason.catalogEmpty) return 'Zatiaľ nie je čo zlacniť — katalóg ešte nie je načítaný.';
  if (!reason.wantsMeasuredZero || !reason.coverageAdmitted) {
    return 'Zatiaľ nie je čo zlacniť — filtru nevyhovuje ani jeden produkt.';
  }
  const head =
    'Zatiaľ nie je čo zlacniť — filter „0 predaných" vyberá len produkty so ZMERANÝM predajom';
  const tail = 'Nie je to tak, že by filtru nevyhovoval ani jeden produkt.';
  // `null` aj `0` znamenajú „koľko ich je, appka nevie" — číslo si nedomýšľa.
  if (reason.soldUnknown === null || reason.soldUnknown === 0) {
    return `${head} a za ${formatCountSk(reason.soldWindowDays)} dní ho zmeraný nemá. ${tail}`;
  }
  return (
    `${head} a ${formatCountSk(reason.soldUnknown)} ` +
    `${pluralSk(reason.soldUnknown, 'produkt ho', 'produkty ho', 'produktov ho')} ` +
    `za toto okno zmeraný nemá. ${tail}`
  );
}

/**
 * POISTKA PRED ZÁPISOM DO PRODUKČNÉHO ESHOPU (I3) — jediné miesto, ktoré
 * hovorí, prečo sa nedá zaradiť, a teda aj jediné, ktoré môže zaradenie
 * povoliť. `null` znamená „dá sa"; čokoľvek iné je veta pre človeka a zároveň
 * dôvod, prečo je tlačidlo vypnuté.
 *
 * Prečo je to vlastná exportovaná funkcia a nie IIFE vnútri komponentu
 * (19. 8. 2026): dovtedy sa pravidlo „vpísaný počet musí sedieť s výberom"
 * nedalo otestovať vôbec. Test karty rozhodnutia si `blockedReason` podával
 * ako prop, takže overil len to, že vypnuté tlačidlo je vypnuté — o samotnom
 * pravidle nezistil nič. Mechanika sa presunom nemení ani o znak: poradie
 * podmienok, ich znenie aj to, čo sa hashuje do `preview_token`, ostávajú
 * také, aké boli.
 *
 * Poradie podmienok je poradie závažnosti a NESMIE sa prehádzať: bez produktov
 * nemá zmysel hovoriť o skúške, bez čerstvej skúšky nemá zmysel hovoriť
 * o vpísanom počte. Ručný počet je posledný, lebo je to posledná brzda.
 */
export function queueBlockedReason(gate: QueueGateState): string | null {
  if (gate.itemsCount === 0) {
    /*
     * „Nič si nevybral" a „vybral si, ale predaje nepoznáme" sú dve rôzne veci
     * (D121, I11). Do 31. 8. 2026 sa zlievali: brána počítala veľkosť výberu,
     * takže pri 200 označených a nezmeraných predajoch nepovedala nič a
     * tlačidlo skúšky naprázdno bolo zapnuté, hoci klik neurobil nič.
     */
    const unknown = gate.skippedUnknown ?? 0;
    if (unknown > 0) {
      return (
        `Ani jeden z vybraných produktov nemá predaj za toto okno zmeraný ` +
        `(${formatCountSk(unknown)}), takže pásmo sa im určiť nedá. Zľava sa ` +
        `z nemeraného predpokladu nezapíše.`
      );
    }
    return 'Vyberte aspoň jeden produkt.';
  }
  if (gate.writesLocked) {
    const sentence = guardSentence('writes_locked');
    return `${sentence.text} ${sentence.hint ?? ''}`.trim();
  }
  if (gate.percentError !== undefined && gate.percentError !== null) return gate.percentError;
  if (gate.windowError !== null) return gate.windowError;
  if (!gate.previewFresh) return 'Najprv spustite skúšku naprázdno pre tento výber.';
  if (gate.previewBlockers > 0) {
    return 'Skúška našla prekážku — kým trvá, zaradiť sa nedá.';
  }
  if (!typedCountMatches(gate.typed, gate.itemsCount)) {
    return `Do poľa napíšte ${formatCountSk(gate.itemsCount)}.`;
  }
  return null;
}

/**
 * Odtlačok načítaného výberu — poistka I3 (viď hlavička súboru).
 *
 * Nesie presne to, čo rozhoduje o zápise a o tom, čo mal človek pred očami:
 * ktoré produkty, do akého pásma padnú (`unitsSold`) a za akú cenu ich videl.
 * Keď sa čokoľvek z toho zmení, hotová skúška naprázdno prestáva platiť; keď
 * obnova vráti tú istú sadu, skúška platí ďalej. Poradie riadkov je súčasťou
 * odtlačku zámerne — mení sa s triedením a s ním aj vzorka, ktorú človek videl.
 */
export function selectionPrintOf(rows: readonly SelectableRow[]): string {
  return rows.map((row) => `${row.productId}:${row.unitsSold}:${row.price ?? ''}`).join(',');
}

/**
 * Stĺpce jednotnej sady, ktoré má vzorka ČÍM naplniť (D124).
 *
 * Riadky výberu prichádzajú z `/api/catalog/search`, ktoré obohatené polia
 * (marža, sklad, obrátkovosť, stav zľavy v shope) nenesie — tie štyri stĺpce sa
 * preto VYNECHÁVAJÚ. Nepremenúvajú sa a nedopĺňajú sa iným číslom; to je celé
 * pravidlo D124 a jediný spôsob, ako sa táto tabuľka nerozíde s Produktmi.
 */
export const SAMPLE_COLUMN_IDS = [
  'reference',
  'name',
  'price',
  'soldWindow',
] as const satisfies readonly ProductColumnId[];

/**
 * VZORKA VÝBERU — vlastný komponent zámerne (D124, 1. 9. 2026).
 *
 * Do 1. 9. 2026 bola vzorka vpletená do `NewDiscount` a `renderToStaticMarkup`
 * ju nikdy nezastihol (riadky prichádzajú až z katalógu), takže jej bunky
 * strážil jediný ZDROJOVÝ test — teda test, ktorý hľadá reťazec v súbore
 * a pri prepísaní tej istej chyby inými slovami zostane zelený. Ako samostatný
 * komponent sa dá vykresliť s hotovými riadkami a merať sa dá SPRÁVANIE.
 *
 * „Pásmo" a „Nová cena" sú stĺpce SPRIEVODCU: patria k rozhodovaniu o zľave,
 * nie k popisu produktu, takže v jednotnej sade nie sú a v tabuľke Produktov
 * nemajú čo hľadať.
 */
export function SampleTable({
  sample,
  total,
  soldWindowDays,
  coverage,
  tierOfProduct,
}: {
  readonly sample: readonly SelectableRow[];
  /** Z koľkých produktov je vzorka vybraná — teda veľkosť ZÁPISU. */
  readonly total: number;
  readonly soldWindowDays: number;
  readonly coverage: SoldCoverageState;
  readonly tierOfProduct: ReadonlyMap<number, TierPlan>;
}) {
  /* Prázdna tabuľka nie je stav — kreslí sa, až keď je z čoho. */
  if (sample.length === 0) return null;
  const columns = productColumns(SAMPLE_COLUMN_IDS, { soldWindowDays });
  return (
    <>
      {/* Popis vzorky stál v prvom `<th>`. Po D124 tam stojí MENO STĹPCA
          („Referencia"), lebo hlavička jednotnej sady musí byť v každej
          tabuľke rovnaká — popis tabuľky sa preto presunul nad ňu. */}
      <div className="hint gap-t" data-testid="sample-caption">
        Vzorka — {formatCountSk(sample.length)} z {formatCountSk(total)}
      </div>
      <div className="tbl-frame">
        <table className="tbl">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  className={column.numeric ? 'n' : undefined}
                  title={column.headTitle}
                  data-col={column.id}
                >
                  {column.label}
                </th>
              ))}
              <th className="n">Pásmo</th>
              <th className="n">Nová cena</th>
            </tr>
          </thead>
          <tbody>
            {sample.map((row) => {
              const tier = tierOfProduct.get(row.productId);
              const newPrice = discountedPriceOf(row.price, tier?.percent ?? 0);
              /*
               * Trojstavovosť si NEKRESLÍ táto tabuľka — kreslí si ju STĹPEC
               * (D124). Nula v „Predané za okno" tu totiž rozhoduje o PÁSME
               * (0 predaných → najhlbšia zľava), takže „nevieme" vydané za nulu
               * je cesta k −30 % na tisícoch kusov (31. 8. 2026). Keď o tom
               * rozhoduje definícia stĺpca, nedá sa to tu obísť dosadenou nulou.
               */
              const values = sampleRowValues(row, soldWindowDays, coverage);
              return (
                <tr key={row.productId}>
                  {columns.map((column) => {
                    const cell = column.cell(values);
                    const cellClass = column.numeric
                      ? 'n'
                      : column.id === 'name'
                        ? 'name'
                        : undefined;
                    return (
                      <td
                        key={column.id}
                        className={cellClass}
                        data-col={column.id}
                        data-l={column.label}
                        title={cell.title ?? undefined}
                      >
                        {/* Priznanie sa STLMÍ, hodnota nie — inak sa pomlčka
                            číta ako údaj. */}
                        {cell.unknown ? <span className="lvl-3">{cell.text}</span> : cell.text}
                      </td>
                    );
                  })}
                  <td className="n" data-l="Pásmo">
                    {tier === undefined ? '—' : `${tier.letter} · ${tier.percent} %`}
                  </td>
                  <td className="n" data-l="Nová cena">
                    <b>{newPrice === null ? '—' : formatEur(newPrice)}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="tbl-foot">
          <span className="lvl-3">Orientačný prepočet, zaokrúhlenie shopu sa môže líšiť</span>
        </div>
      </div>
    </>
  );
}

/**
 * Pokrytie predajnosti → vstup jednotného stĺpca „Predané za okno" (D124, I11).
 *
 * Vzorka dostáva z `/api/catalog/search` len jedno číslo (`unitsSold`) a to,
 * za koľko dní má appka objednávky NAOZAJ stiahnuté, vie iba pokrytie. Bez
 * tohto preloženia by stĺpec nemal ako rozlíšiť „nula sa predala" od „okno nie
 * je dočítané" — a práve podľa tej nuly sa v sprievodcovi vyberá pásmo.
 *
 * `daysPartial` sa do dočítaných dní NERÁTA (`fullyReadDays`): server po D121
 * sčítava kusy výhradne z dní so `status = 'complete'`, takže čiastočný deň je
 * pre číslo predajov medzera. Nezistené pokrytie (`asked: false`, alebo
 * nečitateľná odpoveď) je nula dočítaných dní — teda dolná hranica, nie plné
 * okno; opačná voľba by z neznalosti spravila meranie.
 */
function soldWindowOf(
  units: number | null,
  windowDays: number,
  coverage: SoldCoverageState,
): ProductSoldWindow {
  const complete =
    coverage.asked && coverage.coverage !== null
      ? Math.min(fullyReadDays(coverage.coverage), windowDays)
      : 0;
  const unknownDays = Math.max(windowDays - complete, 0);
  return {
    windowDays,
    completeDays: complete,
    unknownDays,
    /* `null` je po D121 odpoveď servera „za toto okno to nevieme", nie nula. */
    units: units === null ? missingValue<number>('days_missing') : knownValue(units),
    lowerBound: unknownDays > 0,
  };
}

/**
 * Riadok výberu → hodnoty jednotných stĺpcov (D124).
 *
 * Každá medzera dostáva DÔVOD, lebo odpoveď katalógu ho nenesie a bez neho by
 * bunka nevedela, čo prizná. Referencia chýba preto, že produkt nie je
 * obohatený (D118) — nikdy preto, že by ju shop nemal.
 */
function sampleRowValues(
  row: SelectableRow,
  windowDays: number,
  coverage: SoldCoverageState,
): ProductRowValues {
  return {
    productId: row.productId,
    reference: valueOrGap(row.reference ?? null, 'not_enriched'),
    name: valueOrGap(row.name, 'shop_has_none'),
    price: valueOrGap(row.price, 'shop_has_none'),
    soldWindow: soldWindowOf(row.unitsSold, windowDays, coverage),
  };
}

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

/**
 * Filter ako čipy — to isté, čo vidno v tabe Produkty (D125, 1. 9. 2026).
 *
 * Slovník je JEDEN a žije v `catalog-filter.ts`; tu zostáva len veta pre stav
 * „nič sa neobmedzilo". Dovtedy tu bola vlastná kópia, ktorá poznala sedem
 * podmienok z pätnástich — zľava zúžená maržou či skladom sa v zhrnutí hlásila
 * ako „celý katalóg", hoci sa zapisovala úplne iná množina.
 */
function describeFilter(filter: CatalogFilterState): string[] {
  const chips = describeCatalogFilter(filter);
  return chips.length === 0 ? ['celý katalóg'] : chips;
}

export default NewDiscount;
