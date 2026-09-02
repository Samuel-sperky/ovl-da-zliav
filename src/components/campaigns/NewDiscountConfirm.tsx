'use client';

/**
 * Aura Zľavy — NOVÁ ZĽAVA, karta ROZHODNUTIA (V11; predloha
 * `design/v3/nova-zlava.html`, kontrakt V3 K4, K8, K10, invariant I3,
 * kontrakt UI, bod 24).
 *
 * Jedna karta, v ktorej sa rozhoduje o zápise do PRODUKČNÉHO eshopu. Nesie
 * dominantu celej obrazovky — **počet produktov, ktoré zlacnejú** — a pod ňou
 * v jednom slede: čím sú, kedy budú zapísané (slot `plan`), čo o marži appka
 * nevie, ručne vpísaný počet a dve tlačidlá. Do 18. 8. 2026 boli čas a
 * potvrdenie dve samostatné sekcie nad sebou; obrazovka sa preto nezmestila do
 * 1,5 obrazovky a dominanta stála až pod dvojicou dátumov, teda pod menej
 * dôležitým číslom.
 *
 * DVE POISTKY, KTORÉ SA NEDAJÚ PREKLIKAŤ
 * --------------------------------------
 *
 *  1. **Skúška naprázdno musí prebehnúť** a musí sedieť na PRÁVE ZOBRAZENÝ
 *     výber. Keď sa čokoľvek zmení (produkty, pásma, okno), potvrdenie sa
 *     zamkne a skúška sa musí zopakovať — jednorazový podpísaný token nesie
 *     presne tú sadu, ktorú používateľ videl (I3, K4).
 *  2. **Počet produktov sa píše ručne.** Klik sa dá urobiť omylom, číslo
 *     8 000 sa omylom nenapíše. Je to povrchová podoba I3 a zámerne to
 *     spomaľuje (odpoveď 38).
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Dopad na maržu nikdy nebude číslo.** Shop nákupné ceny nevracia, takže
 *    každý taký odhad by bol vymyslený (K8). Na jeho mieste je veta o tom, čo
 *    chýba — a v tom bloku nesmie byť ani cifra, ani euro. Stráži to test.
 * 2. **Dominanta je počet produktov** (P1). Nič v tejto karte nesmie byť
 *    väčšie než `.big` — ani tlačidlo, ani dátum. Keď sa pridá nové číslo,
 *    patrí do riadku pod dominantu, nie vedľa nej.
 * 3. **Zamknuté tlačidlo hovorí dôvod.** `blockedReason` je jediná veta, ktorá
 *    vysvetlí, prečo sa nedá zaradiť; bez nej je zašedené tlačidlo hádanka.
 * 4. **Pomlčka sa do 64 px nekreslí** (D11, 19. 8. 2026). Pravidlo „keď appka
 *    nevie, je tam pomlčka, nikdy nula" (kontrakt UI, bod 5) platí ďalej, ale
 *    em pomlčka v rezoch dominanty prestáva byť interpunkciou a je z nej plný
 *    čierny obdĺžnik. Neznáme sa preto píše pomlčkou SO SLOVOM a v čitateľnej
 *    veľkosti. Nikdy nedávaj `'—'` do `.big`.
 * 5. **Dominanta zostáva dominantou aj vtedy, keď je hodnota neznáma**
 *    (P1, 19. 8. 2026). Pomlčka so slovom má 26 px, ručne vpísaný počet 28 px
 *    v ráme — v stave `catalogEmpty && itemsCount === 0` bolo teda najťažším
 *    prvkom karty pole, nie dominanta. Nespravilo sa to väčšou pomlčkou (to je
 *    presne defekt D11) ani ľahším poľom (to je presne defekt D12), ale tým, že
 *    krok bez obsahu prestal vyzerať ako krok, ktorý sa dá urobiť: pri
 *    `itemsCount === 0` je z poľa zamknutý riadok s dôvodom. Pri každom
 *    `itemsCount > 0` má pole plnú váhu z D12.
 *
 * PORADIE KROKOV = PORADIE ZÁVAŽNOSTI (D12, 19. 8. 2026)
 * ------------------------------------------------------
 * Do 19. 8. stálo pole na ručný počet nad dvojicou tlačidiel, v ktorej bolo
 * `Zaradiť do fronty` prvé, široké a plné, a `Skúška naprázdno` druhé — teda
 * opačne, než v akom poradí sa tie kroky robia a než akú váhu majú. Odteraz
 * idú pod sebou v poradí vykonávania: **skúška → ručne vpísaný počet →
 * zaradenie**, a ručný počet je v ráme a je najťažší prvok spodku karty.
 * Mení sa vzhľad a poradie potvrdenia, NIE jeho mechanika: `previewFresh`,
 * `typedCountMatches` ani `previewToken` sa tým nedotýkajú (I3).
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

import BlockerList from '@/components/campaigns/BlockerList';
import styles from '@/components/campaigns/zlavy.module.css';
import type { TierPlan } from '@/components/campaigns/discounts-model';
// Preklad blokátora zo skúšky naprázdno žije v `queue-model.ts` — používa ho aj
// panel opakovania a dve kópie toho istého prekladu by sa časom rozišli (K10).
import {
  confirmErrorText,
  previewBlockerText,
  type BlockerCard,
} from '@/components/campaigns/queue-model';
import type { ApiError, CreateResult, PreviewData } from '@/components/campaigns/zlavy-api';
import { hrefForAnchor } from '@/components/settings/sub-pages';
import { Button, Note, Panel, PanelBody, PanelHead } from '@/components/ui';
import { FlagMark } from '@/components/ui/StatusMark';
import { diffDays } from '@/lib/domain/dates';
import { SHOP_KEYED_LIMIT } from '@/lib/shop/rate-limits';
import { formatDateSk, formatDateTimeSk, formatEur } from '@/lib/ui/format';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/**
 * Kam vedie odkaz spod „Dopad na maržu — zamknuté" (kontrakt bod 18).
 *
 * Vysvetlenie má v celej appke JEDINÉ miesto: `settings/LockedFeatures.tsx`.
 * Karta rozhodnutia naň odkazuje jedným slovom a nedopisuje ani pol vety
 * vlastnými slovami — pravidlo 1 v hlavičke tohto súboru platí ďalej.
 */
const LOCKED_WHY_HREF = hrefForAnchor('#zamknute');

/* ══════════════ SKÚŠKA NAPRÁZDNO HOVORÍ ČÍSLAMI (I3, V6b) ═════════════════ */

/**
 * DENNÝ STROP ZÁPISOV — jedno číslo, jeden zdroj.
 *
 * Berie sa zo `shop/rate-limits.ts`, teda z TOHO ISTÉHO miesta, z ktorého ho
 * odvodzuje `MAX_DAILY_WRITE_BUDGET` v `lib/engine/budget.ts`
 * (`MAX_DAILY_WRITE_BUDGET = SHOP_KEYED_LIMIT.perUtcDay`). Priamo `budget.ts`
 * sa tu importovať NEDÁ — ten modul siaha na `db/pool`, a v `'use client'`
 * komponente by to do prehliadača vtiahlo databázový klient. Rovnosť oboch
 * ciest je preto TVRDENÍM V TESTE (`nova-zlava-dry-run.spec.ts`), nie
 * dôverou: keby sa rozišli, test zčervená.
 *
 * Prečo to takto úzkostlivo: to isté číslo už raz žilo na dvoch miestach
 * (`budget.ts` a literál `200` v `settings.repo.ts`) a pri zdvihnutí kvóty
 * 1. 9. 2026 sa rozišli OKAMŽITE — appka prijala 1000, repozitár ho odmietol
 * hláškou „musí byť 1–200". Ručne vpísaný strop v texte, ktorý má človek pred
 * zápisom do PRODUKČNÉHO eshopu čítať, by bol tá istá chyba o triedu horšie:
 * nerozišiel by sa kód, ale to, čo appka o sebe TVRDÍ.
 */
export const DAILY_WRITE_CAP = SHOP_KEYED_LIMIT.perUtcDay;

/**
 * Prvá veta skúšky naprázdno. Hovorí, ČO SA STANE — nie „potvrďte akciu".
 *
 * „Potvrďte akciu" je veta, ktorú človek preklikne bez čítania, lebo o akcii
 * nepovie nič. Pred zápisom do PRODUKČNÉHO eshopu bez prihlásenia (D98–D100)
 * je súhrn skúšky posledné miesto, kde sa dá odstúpiť; preto sú pod touto vetou
 * ČÍSLA a nie výzva.
 */
export const DRY_RUN_INTRO_SK =
  'Skúška prebehla a do shopu nezapísala nič. Keď potvrdíte, appka zapíše toto:';

/** Čo skúška naprázdno ukazuje. Vstup je stav obrazovky, nie odpoveď servera. */
export interface DryRunFacts {
  /**
   * Koľko produktov sa NAOZAJ zapíše — teda veľkosť tela zápisu po D121, nie
   * veľkosť výberu. Produkt s nezmeraným predajom pásmo nedostane a do zápisu
   * nejde; keby tu stálo `rows.length`, súhrn by sľuboval zľavu tisícom
   * produktov, ktoré ju nedostanú.
   */
  readonly itemsCount: number;
  readonly tiers: readonly TierPlan[];
  /** Okno platnosti tak, ako je v poliach obrazovky (`YYYY-MM-DD`). */
  readonly from: string;
  readonly to: string;
  /**
   * Dnešný rozpočet zápisov zo servera. `null` = počítadlo neodpovedalo
   * číslom, takže sa NEDOPOČÍTAVA — „nevieme" je pomlčka, nikdy nula
   * (I11; `?? 0` by tu znamenalo „dnes je celý rozpočet voľný").
   */
  readonly budget: { readonly spent: number; readonly limit: number } | null;
}

/** Jeden riadok súhrnu: čo sa meria, aké je číslo, a či ho appka pozná. */
export interface DryRunLine {
  readonly key: 'produkty' | 'percenta' | 'okno' | 'rozpocet';
  readonly term: string;
  readonly value: string;
  /** `false` = časť hodnoty appka nemeria a hodnota to priznáva pomlčkou. */
  readonly known: boolean;
}

/** Dĺžka okna v dňoch vrátane oboch krajov; `0` = dátum sa nedá prečítať. */
function windowDaysOf(from: string, to: string): number {
  const shape = /^\d{4}-\d{2}-\d{2}$/;
  if (!shape.test(from) || !shape.test(to)) return 0;
  const days = diffDays(from, to) + 1;
  return days > 0 ? days : 0;
}

/**
 * ŠTYRI ČÍSLA, KTORÉ MUSÍ SKÚŠKA POVEDAŤ NAHLAS (I3, kontrakt V6 §4 bod 2).
 *
 * Koľko produktov · aké percentá · od kedy do kedy · koľko to zoberie
 * z denného rozpočtu zápisov. Do 2. 9. 2026 boli prvé tri roztrúsené po karte
 * (dominanta, prúžok pásiem, `NewDiscountStart`) a štvrté nikde — výsledok
 * skúšky pritom žil pod rozklikom `<details>`, teda ho človek pri potvrdzovaní
 * nemusel vidieť vôbec. Redizajn smie spraviť potvrdenie krajším, NIE tichším.
 *
 * Je to čistá funkcia zámerne: veta poskladaná v JSX sa dá overiť len
 * prehliadačom, a práve tu je cena chyby zápis do produkčného eshopu.
 */
export function dryRunLines(facts: DryRunFacts): readonly DryRunLine[] {
  const { itemsCount, tiers, from, to, budget } = facts;

  const products = `${formatCountSk(itemsCount)} ${pluralSk(
    itemsCount,
    'produkt',
    'produkty',
    'produktov',
  )}`;

  /* Pásma bez jediného produktu sa nevypisujú — percento, ktoré nikto
     nedostane, je v súhrne zápisu nepravda. */
  const withItems = tiers.filter((tier) => tier.productIds.length > 0);
  const percents =
    withItems.length === 0
      ? '— ani jedno pásmo nemá produkt'
      : withItems
          .map(
            (tier) =>
              `${tier.percent} % na ${formatCountSk(tier.productIds.length)} ${pluralSk(
                tier.productIds.length,
                'produkt',
                'produkty',
                'produktov',
              )}`,
          )
          .join(' · ');

  const days = windowDaysOf(from, to);
  const window =
    days === 0
      ? '— okno platnosti nie je doplnené'
      : `${formatDateSk(from)} – ${formatDateSk(to)} (${formatCountSk(days)} ${pluralSk(
          days,
          'deň',
          'dni',
          'dní',
        )})`;

  const writes = `${formatCountSk(itemsCount)} ${pluralSk(
    itemsCount,
    'zápis',
    'zápisy',
    'zápisov',
  )}`;
  /*
   * Rozpočet má DVE čísla a nesmú sa zliať: `limit` je naša dnešná brzda
   * (`settings.daily_write_budget`, dá sa posunúť len nadol), `DAILY_WRITE_CAP`
   * je strop SHOPU. Kým server hlási svoje číslo, hovoríme jeho; keď nehlási,
   * povieme strop a priznáme, že o dnešku nevieme.
   */
  const budgetValue =
    budget === null
      ? `${writes} · denný strop je ${formatCountSk(DAILY_WRITE_CAP)} · koľko z neho dnes zostáva — zatiaľ nevieme`
      : (() => {
          const free = Math.max(0, budget.limit - budget.spent);
          const head = `${writes} z dnešného rozpočtu ${formatCountSk(
            budget.limit,
          )} · voľných ${formatCountSk(free)}`;
          return itemsCount > free ? `${head} · zvyšok pôjde ďalšie dni` : head;
        })();

  return [
    /*
     * `known: true` aj pri nule je zámer: nula tu NIE JE „nevieme", je to
     * zmeraný fakt „nezapíše sa nič" (a v tom stave je skúška naprázdno aj
     * tak vypnutá). Pomlčka na mieste nuly by z priznania spravila ozdobu.
     */
    { key: 'produkty', term: 'Zlacnie', value: products, known: true },
    { key: 'percenta', term: 'O koľko', value: percents, known: withItems.length > 0 },
    { key: 'okno', term: 'Odkedy dokedy', value: window, known: days > 0 },
    { key: 'rozpocet', term: 'Z denného rozpočtu', value: budgetValue, known: budget !== null },
  ];
}

export interface NewDiscountConfirmProps {
  itemsCount: number;
  /**
   * Vieme vôbec, koľko produktov to je? `false` = zrkadlo katalógu je prázdne,
   * takže nula by bola tvrdenie o niečom, čo sa nemeralo — dominanta je vtedy
   * pomlčka (kontrakt UI, bod 5). Predvolene `true`.
   */
  countKnown?: boolean;
  tiers: readonly TierPlan[];
  /** Priemer cien, ktoré naozaj prišli; `null` = ani jednu cenu nepoznáme. */
  averagePrice: number | null;
  /**
   * Okno platnosti z polí obrazovky. Do súhrnu skúšky naprázdno patrí preto,
   * že „od kedy do kedy" je jedno zo štyroch čísel, ktoré človek potvrdzuje
   * (I3) — a dovtedy stálo len v `plan`, teda vedľa rozhodnutia, nie v ňom.
   * Predvolene prázdne: karta sa vykreslí aj bez doplneného okna a súhrn to
   * prizná vetou, nie vymysleným dátumom.
   */
  from?: string;
  to?: string;
  /**
   * Dnešný rozpočet zápisov (`spent` / `limit`) zo servera; `null` = nevieme.
   * To isté číslo dostáva `NewDiscountStart` — sem ide preto, aby súhrn skúšky
   * povedal ČÍSLOM, koľko z rozpočtu zápis zoberie.
   */
  budget?: { readonly spent: number; readonly limit: number } | null;
  /**
   * Kedy bude zapísané a kedy zľava nabehne (`NewDiscountStart`). Je to slot,
   * nie vlastná sekcia: oba dátumy patria k rozhodnutiu a samostatná karta ich
   * od neho odtrhla.
   */
  plan?: ReactNode;
  /**
   * Prekážky, ktoré teraz stoja v ceste zápisu (D13). Do 19. 8. mali vlastnú
   * kartu v pravom stĺpci a hovorili to isté, čo stavový pruh nad obrazovkou.
   * Kreslia sa TU, pri rozhodnutí, ktoré blokujú — a nikde inde na obrazovke.
   */
  obstacles?: readonly BlockerCard[];
  typed: string;
  onTyped: (value: string) => void;
  /** Skúška naprázdno sedí na aktuálny výber a nemá blokátory. */
  previewFresh: boolean;
  preview: PreviewData | null;
  previewAt: string | null;
  busy: 'idle' | 'loading' | 'previewing' | 'creating';
  /** Prečo je zaradenie zamknuté; `null` = dá sa zaradiť. */
  blockedReason: string | null;
  /**
   * Chyba z posledného pokusu — CELÁ obálka, nie len jej správa. Bez kódu sa
   * veta servera dá len vykresliť, nie preložiť, a práve tie vety nesú žargón,
   * ktorý na povrch nesmie (K10).
   */
  error: ApiError | null;
  created: CreateResult | null;
  onPreview: () => void;
  onQueue: () => void;
}

export function NewDiscountConfirm({
  itemsCount,
  countKnown = true,
  tiers,
  averagePrice,
  from = '',
  to = '',
  budget = null,
  plan,
  obstacles = [],
  typed,
  onTyped,
  previewFresh,
  preview,
  previewAt,
  busy,
  blockedReason,
  error,
  created,
  onPreview,
  onQueue,
}: NewDiscountConfirmProps) {
  const blockers = preview === null ? [] : preview.blockers;

  /* ── hotovo: zľava je vo fronte ── */
  if (created !== null) {
    return (
      <Panel data-testid="new-discount-created">
        <PanelHead as="h2" title="Zaradené do fronty" />
        <PanelBody>
          <div className="lvl-1">
            <span className="big">{formatCountSk(created.itemsTotal)}</span>
            <span className="sub">
              {pluralSk(created.itemsTotal, 'produkt čaká', 'produkty čakajú', 'produktov čaká')} na
              zápis
            </span>
          </div>
          <div className="prog-meta">
            {created.estimate === null ? (
              <span className="lvl-3">Odhad dobehnutia zatiaľ nevieme</span>
            ) : (
              <span>
                Hotové <b className="est">{formatDateSk(created.estimate.date)}</b>
              </span>
            )}
            {created.keyExpiresBeforeFinish === true ? (
              <>
                <span className="sep-dot" aria-hidden="true">
                  ·
                </span>
                <span className="flag">
                  <FlagMark />
                  Kľúč na zápis vyprší skôr, než fronta dobehne
                </span>
              </>
            ) : null}
          </div>
          <div className="row gap-t">
            <Link className="btn primary" href={`/zlavy/${created.campaignId}`}>
              Otvoriť zľavu
            </Link>
            <Link className="btn" href="/zlavy">
              Zoznam zliav
            </Link>
          </div>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel data-testid="new-discount-confirm">
      <PanelHead as="h2" title="Zápis a potvrdenie" />
      <PanelBody>
        <div className={`${styles.confirm} lvl-1`}>
          {countKnown ? (
            <span className="big" data-testid="confirm-count">
              {formatCountSk(itemsCount)}
            </span>
          ) : (
            /*
             * D11 — tu bola do 19. 8. 2026 em pomlčka v `.big`, teda v 64 px
             * a reze 660. V tej veľkosti pomlčka nie je znak, ale vyplnený
             * obdĺžnik: dominanta karty vyzerala ako chyba vykreslenia a
             * popisok pod ňou nemal nad sebou hodnotu. Pomlčka zostáva —
             * dostala len slovo a veľkosť, v ktorej sa dá prečítať.
             */
            <span className={styles.unknown} data-testid="confirm-count">
              — zatiaľ nevieme
            </span>
          )}
          <span className={styles.cap}>
            {countKnown ? 'produktov dostane zľavu' : 'koľko produktov dostane zľavu'}
          </span>
        </div>

        <div className={`prog-meta ${styles.center}`}>
          {tiers.map((tier) => (
            <span key={tier.ord}>
              {tier.letter} <b>{formatCountSk(tier.productIds.length)}</b> · {tier.percent} %
            </span>
          ))}
          {averagePrice === null ? (
            <span className="lvl-3">priemernú cenu nevieme</span>
          ) : (
            <span>
              Priemerná cena <b>{formatEur(averagePrice)}</b>
            </span>
          )}
        </div>

        {plan}

        {/* K8 — dopad na maržu sa NIKDY neukáže ako číslo, ani odhadom.
            Prečo je zamknutý, hovorí jediné miesto v appke; tu je naň odkaz
            v jednom slove, nie druhý výklad (kontrakt bod 18). */}
        <div className={styles.margin}>
          <span className="lvl-3">Dopad na maržu</span>
          <span className="lockline">zamknuté</span>
          <Link className="lockwhy" href={LOCKED_WHY_HREF}>
            prečo
          </Link>
        </div>

        {/*
         * D13 — prekážky stoja tam, kde blokujú: pri rozhodnutí. Vlastnú kartu
         * v pravom stĺpci už nemajú, lebo tá hovorila to isté, čo stavový pruh.
         */}
        {obstacles.length === 0 ? null : (
          <div className={styles.confirmObstacles}>
            <BlockerList cards={obstacles} testId="confirm-obstacles" />
          </div>
        )}

        {/* Krok 1 — skúška naprázdno. Robí sa ako prvá, teda stojí ako prvá. */}
        <div className={styles.stepDry}>
          <Button
            className={styles.wide}
            disabled={busy === 'previewing' || busy === 'loading' || itemsCount === 0}
            busy={busy === 'previewing'}
            onClick={onPreview}
            data-testid="dry-run"
          >
            {busy === 'previewing' ? 'Počítam…' : 'Skúška naprázdno'}
          </Button>
          <div className="hint" style={{ textAlign: 'center' }}>
            Skúška nič nezapíše — prepočíta výber a ukáže, čo by sa stalo.
          </div>
        </div>

        {/*
         * SÚHRN SKÚŠKY — ŠTYRI ČÍSLA NAHLAS (I3, kontrakt V6 §4 bod 2).
         *
         * Do 2. 9. 2026 bol výsledok skúšky VÝHRADNE pod rozklikom `<details>`
         * a rozpočet zápisov v ňom nebol vôbec. Človek teda mohol prejsť celým
         * potvrdením bez toho, aby raz videl, čo sa zapíše. Súhrn preto stojí
         * ODKRYTÝ a PRED ručne vpísaným počtom: čísla sa čítajú predtým, než sa
         * jedno z nich prepisuje do poľa. Rozklik pod ním zostáva — je v ňom
         * technický detail skúšky, nie jej výsledok.
         *
         * Nedá sa vypnúť ani zapamätať: žiadne „už nezobrazovať", žiadna voľba,
         * ktorá by druhý raz krok preskočila. Jednorazový podpísaný token robí
         * z každého zápisu vlastnú skúšku (I3, D16) a UI to nesmie obchádzať.
         */}
        {preview === null ? null : (
          <Panel soft className={styles.dry} data-testid="dry-run-summary">
            {/* Odsadenie vnútra vlastní `PanelBody` — `.panelSoft` je len
                plocha a bez tela by text ležal na ráme. */}
            <PanelBody>
              <p className={styles.dryIntro}>{DRY_RUN_INTRO_SK}</p>
              <dl className={styles.dryList}>
                {dryRunLines({ itemsCount, tiers, from, to, budget }).map((line) => (
                  <div key={line.key} className={styles.dryRow}>
                    <dt className={styles.dryTerm}>{line.term}</dt>
                    <dd
                      className={styles.dryValue}
                      data-known={line.known ? 'yes' : 'no'}
                      data-testid={`dry-run-${line.key}`}
                    >
                      {line.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {previewFresh ? null : (
                /* Tri kanály: ikona z `Note`, tón `warn` a SLOVO. Zastaraná
                   skúška nesmie vyzerať ako platná — čísla nad tým opisujú
                   iný výber. */
                <div className={styles.dryStale}>
                  <Note variant="warn" testId="dry-run-stale">
                    Výber sa po tejto skúške zmenil — čísla vyššie platia pre starý výber. Spustite
                    skúšku naprázdno znova.
                  </Note>
                </div>
              )}
            </PanelBody>
          </Panel>
        )}

        {/*
         * Krok 2 — ručne vpísaný počet. Povrchová podoba I3 a najťažší prvok
         * spodku karty: pred ním sa nedá prekliknúť ďalej.
         *
         * P1, 19. 8. 2026 — keď vo výbere nie je ani jeden produkt, nie je čo
         * potvrdzovať: skúška naprázdno je z toho istého dôvodu vypnutá a
         * `blockedReason` hlási „Vyberte aspoň jeden produkt". Pole by v tom
         * stave bolo najťažším prvkom karty (28 px v ráme) nad dominantou, ktorá
         * je vtedy pomlčka so slovom v 26 px — dominanta by sa neohla, prevrátila
         * by sa. Krok preto z obrazovky nemizne, len sa kreslí ako zamknutý
         * riadok, ktorý povie dôvod. Mení sa vzhľad, NIE mechanika: `typed`
         * ostáva prázdny a `typedCountMatches` ani `previewToken` sa toho
         * netýkajú (I3).
         */}
        {itemsCount === 0 ? (
          <div className={`${styles.gate} ${styles.gateLocked}`} data-testid="confirm-count-locked">
            <span className={styles.gateLabel}>Napíšte počet produktov</span>
            <span className="lockline">odomkne sa, keď bude vo výbere aspoň jeden produkt</span>
          </div>
        ) : (
          <div className={styles.gate}>
            <label className={styles.gateLabel} htmlFor="confirm-count-input">
              Napíšte počet produktov
            </label>
            <input
              id="confirm-count-input"
              className={`inp ${styles.gateInput}`}
              inputMode="numeric"
              autoComplete="off"
              placeholder={countKnown ? String(itemsCount) : ''}
              value={typed}
              onChange={(event) => onTyped(event.target.value)}
              data-testid="confirm-count-input"
            />
          </div>
        )}

        {/*
         * Krok 3 — zápis do ostrého eshopu.
         *
         * `busy` sa tu ZAPNÚŤ NESMIE (docblok `ui/Button.tsx`): na
         * potvrdzovacom tlačidle zápisu sa animácie nepoužívajú. Stav hovorí
         * slovo v tlačidle („Zaraďujem…"), nie krútiaci sa krúžok.
         *
         * A `disabledReason` sa tu tiež nepoužíva, hoci ho `Button` má:
         * vykreslil by dôvod DRUHÝ raz vedľa riadku pod tlačidlom. Dôvod má na
         * karte jedno miesto (`queue-blocked-reason`) a je to `role="status"`,
         * takže ho čítačka ohlási aj tak — `title` na `disabled` prvku sa
         * neohlási spoľahlivo a na dotyku sa nezobrazí vôbec (U17).
         */}
        <div className={styles.acts}>
          <Button
            variant="primary"
            className={styles.wide}
            disabled={blockedReason !== null || busy === 'creating'}
            title={blockedReason ?? undefined}
            onClick={onQueue}
            data-testid="queue-discount"
          >
            {busy === 'creating' ? 'Zaraďujem…' : 'Zaradiť do fronty'}
          </Button>
        </div>

        {blockedReason === null ? null : (
          <div className={styles.noteQuiet} role="status" data-testid="queue-blocked-reason">
            {blockedReason}
          </div>
        )}

        {error === null ? null : (
          <div className={styles.note} role="alert" data-testid="confirm-error">
            {confirmErrorText(error.code, error.message)}
          </div>
        )}

        {blockers.length === 0 ? null : (
          <div className="gap-t" data-testid="preview-blockers">
            {blockers.map((blocker, index) => (
              <div key={`${blocker.code}-${index}`} className="row wrapx">
                <span className="flag">
                  <FlagMark />
                  {previewBlockerText(blocker.code, blocker.message)}
                </span>
              </div>
            ))}
            <details className="tech">
              <summary>Technický detail</summary>
              <div className="body mono">
                {blockers.map((blocker, index) => (
                  <div key={`raw-${blocker.code}-${index}`}>
                    {blocker.code}
                    {blocker.productId === undefined ? '' : ` · ${blocker.productId}`}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        {preview === null ? null : (
          <details className="tech" data-testid="dry-run-result">
            <summary>
              Výsledok poslednej skúšky
              {previewAt === null ? '' : ` · ${formatDateTimeSk(previewAt)}`}
            </summary>
            <div className="body">
              <table>
                <tbody>
                  <tr>
                    <td>Prepočítané u nás</td>
                    <td>
                      <b>
                        {formatCountSk(preview.itemsTotal)}{' '}
                        {pluralSk(preview.itemsTotal, 'produkt', 'produkty', 'produktov')}
                      </b>
                    </td>
                  </tr>
                  <tr>
                    <td>Zapísané pri skúške</td>
                    <td>
                      <b>nič — skúška do shopu nezapisuje</b>
                    </td>
                  </tr>
                  <tr>
                    <td>Ceny</td>
                    <td>
                      <b>
                        {preview.priceSource === 'shop'
                          ? 'čerstvé zo shopu'
                          : preview.priceSource === 'catalog'
                            ? 'z posledného načítania katalógu'
                            : 'nepodarilo sa načítať'}
                      </b>
                    </td>
                  </tr>
                  <tr>
                    <td>Platí pre výber</td>
                    <td>
                      <b>{previewFresh ? 'áno' : 'nie — výber sa medzitým zmenil'}</b>
                    </td>
                  </tr>
                  <tr>
                    <td>Produkty s variantmi</td>
                    <td>
                      <b>
                        {formatCountSk(preview.warnings.hasAttributes.length)} — ceny variantov
                        appka negarantuje
                      </b>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        )}
      </PanelBody>
    </Panel>
  );
}

export default NewDiscountConfirm;
