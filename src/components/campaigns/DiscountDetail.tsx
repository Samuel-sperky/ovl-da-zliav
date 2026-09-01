'use client';

/**
 * Aura Zľavy — DETAIL ZĽAVY (V11; kontrakt UI 13. 8. 2026 body 4, 9–12, 22;
 * invariant I7; architektúra §0 P1–P8, §1 TAB 3, §4).
 *
 * Obrazovka odpovedá na tri otázky v tomto poradí: **kde je zápis · čo sa
 * nepodarilo · čo sa dá urobiť.**
 *
 * SEKCIE (P5): najviac štyri, dnes tri.
 *
 *   1. **Priebeh** — dominanta (P1): koľko z koľkých je hotových (64 px).
 *      V nej aj štyri dlaždice fronty, denný rozpočet a dôvod, prečo sa
 *      prípadne nezapisuje.
 *   2. **Zopakovať to, čo sa nepodarilo** — len keď je čo.
 *   3. **Položky** — súhrn a len problémové riadky.
 *
 * Pod rozklikom (teda mimo počtu sekcií): **pásma**, **výkon výberu**,
 * **technický detail problémových položiek** a **audit stopa**. Do 13. 8. mal
 * detail šesť sekcií a bol vyšší než dve obrazovky; percentá pásiem sú odteraz
 * jednou vetou v hlavičke priebehu a celá tabuľka pásiem je na jeden klik.
 *
 * VÝŠKA JE SÚČASŤ NÁVRHU (P4, 24. 8. 2026)
 * ----------------------------------------
 * Detail meral 1 779 px pri 1440 × 900, teda 1,98 obrazovky pri strope 1,5×
 * (1 350 px). Zrazil sa na 1 339 px a ani jeden krok nebol „zmenšiť písmo":
 *
 *   · pruh fronty a jeho štyri dlaždice idú cez celú kartu a v JEDNOM rade
 *     (predtým 2×2 v 440 px stĺpci vedľa akcií, hoci pruh má štyri úseky),
 *   · vysvetľujúci odsek o neistých kusoch (256 znakov) je zrušený — bol to
 *     P2 a hovoril to, čo hovorí dlaždica aj panel opakovania,
 *   · deň dobehnutia sa presťahoval k dennému rozpočtu; sú to dve strany tej
 *     istej otázky a stáli pod sebou,
 *   · dve dlhé poznámky panelu opakovania stoja vedľa seba (`.retryPane`),
 *   · „Výkon výberu" je pod rozklikom: dva z jeho troch panelov sú zamknuté,
 *     takže na žiadnu z troch otázok detailu neodpovedá,
 *   · tabuľka položiek má pevné šírky stĺpcov a vlastný skrolovací rám.
 *
 * Kto sem pridá útvar, nech si najprv odmeria, čo to spraví s výškou —
 * `npm run snimky` to povie bez spustenej appky.
 *
 * ŠTYRI DLAŽDICE FRONTY SA NEZLIEVAJÚ (D45, kontrakt UI, bod 22)
 * -------------------------------------------------------------
 * `zapísané · čaká · nepodarilo sa · nevieme, či sa zapísalo`. Posledná je
 * vlastný stav, nie odroda zlyhania: zápis odišiel a odpoveď nedorazila, takže
 * produkt zlacnený BYŤ MÔŽE. Zliatie so „nepodarilo sa" by poslalo človeka
 * opravovať niečo, čo je možno v poriadku — preto sa tie dve čísla nikdy
 * nesčítajú a každé má vlastný ďalší krok.
 *
 * „ČAKÁ NA ZÁPIS" JE ODTERAZ MERANÉ ČÍSLO (nález U6, 31. 8. 2026)
 * ---------------------------------------------------------------
 * `campaign.itemsPending` z `/api/campaigns/[id]` je ODČÍTANIE
 * (`items_total − ok − failed − uncertain`), takže do dlaždice „Čaká na zápis"
 * spadla aj **preskočená, nenájdená, prerušená a zablokovaná** položka — a tá
 * už nikam čakať nebude. Osem stavov sa tým zlialo do štyroch kolónok, súčet
 * dlaždíc nesedel so `spolu` a obrazovka o hotových položkách tvrdila, že sa
 * na ne fronta ešte len dostane.
 *
 * Číslo preto pochádza z `GET /api/insights/campaign/[id]/items` (`GROUP BY
 * status` nad `campaign_items`) — endpoint existoval od 24. 8. 2026 a nikto ho
 * nečítal. Keď sa rozpad prečítať nedá, dlaždica má **pomlčku a vetu**, nikdy
 * odčítané číslo (P7): odčítanie je pravdivé len vtedy, keď žiadny netabuľkový
 * stav neexistuje, a to sa bez rozpadu zistiť nedá.
 *
 * Zvyšné stavy dlaždicu NEDOSTALI — pridať štyri ďalšie do radu, ktorý sa
 * 24. 8. skracoval kvôli P4, by obrazovku vrátilo nad strop. Sú v sekcii
 * Položky ako jeden riadok počtov a spolu s nimi aj počet položiek, ktorých
 * stav appka nepozná (K10 — počet áno, kód stavu nikdy).
 *
 * PRETO SA DUPLICITA RIEŠILA INAK (D15, 19. 8. 2026)
 * -------------------------------------------------
 * Dominanta a štyri dlaždice hovorili pri hotovej zľave to isté (`21 / 21`
 * a `21 · 0 · 0 · 0`), a nad dlaždicami to ešte raz opakovala veta
 * „zapísaných 21 · …" a pod nimi „ostáva zapísať 0". Dlaždice sa zrušiť
 * nesmú, tak sa zrušilo všetko ostatné: dominanta hovorí, koľko z fronty je
 * vybavených, pruh pod ňou je rozdelený na tie isté štyri stavy a dlaždice sú
 * jeho legenda. Kto sem pridá ďalšie číslo, nech si najprv overí, či už nemá
 * svoju dlaždicu.
 *
 * JEDEN ZOZNAM DÔVODOV, NIE DVE ČERVENÉ ŠKATULE (D16)
 * ---------------------------------------------------
 * Dôvod, prečo fronta stojí (`queueStandSentence`, stav BEHU appky), a
 * prekážky zápisu (`alarmingCards`, stav DÁT a poistiek) sú dve rôzne veci a
 * do jednej vety sa zliať nesmú — ale odpovedajú na tú istú otázku, takže
 * stoja v jednom ráme pod jedným nadpisom.
 *
 * ČO SA TU EŠTE NESMIE POKAZIŤ
 * ----------------------------
 *
 *  1. **Nič sa neobnovuje samo** (kontrakt UI, bod 4). Detail aj stav fronty
 *     sa čítajú JEDNÝM registrovaným načítaním v `layout/refresh.ts`, takže
 *     obe skupiny čísel platia k tomu istému okamihu a obrazovka ten okamih
 *     píše. Vlastné tlačidlo Obnoviť sa nekreslí — jediné je v stavovom pruhu.
 *  2. **Nula sa nekreslí z neznalosti** (P7). Čo sa nedá prečítať, je pomlčka
 *     alebo veta, nikdy nula.
 *  3. **Žiadna veta o kauzalite** (P8). Predané kusy stoja vedľa seba; appka
 *     nikdy nepovie, že ich priniesla zľava.
 *  4. **Odhad je označený `≈`** a tlmený (P7).
 *  5. **Dominanta je `.lvl-1`, nie vlastná veľkosť** (P1, 19. 8. 2026).
 *     Do 19. 8. niesla dominantu priebehu trieda `.prog-lg .n` so svojimi
 *     64 px, takže detail zľavy nemal na obrazovke ani jednu `.lvl-1` — a P1
 *     sa na ňom nedalo zmerať tou istou mierou ako inde. `.prog-lg` je odteraz
 *     len geometria (číslo a bočný popisok v jednom riadku), veľkosť nesie
 *     `.lvl-1 .big`. Kto sem vráti vlastnú veľkosť mimo `.lvl-1/2/3`, urobí
 *     z jednej role zase dva mechanizmy.
 *  6. **Zľava sa v eshope neruší** (I7, R6). Detail nesmie ponúknuť akciu,
 *     ktorá zruší zľavu v eshope — ani vypnutú, ani „zatiaľ nezapojenú".
 *     Katalóg to isté hovorí človeku pri každom už zlacnenom produkte
 *     (`products/catalog-status.ts`) a dve obrazovky si nesmú protirečiť
 *     o tom, či taká schopnosť vôbec existuje. Podrobne pri
 *     `expiryNoteText()`.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { StandPanel } from '@/components/campaigns/BlockerList';
import DiscountPerformance from '@/components/campaigns/DiscountPerformance';
import DiscountState from '@/components/campaigns/DiscountState';
import RetryFailed from '@/components/campaigns/RetryFailed';
import styles from '@/components/campaigns/zlavy.module.css';
import {
  NEW_DISCOUNT_GATE_SK,
  newDiscountFromProductsHref,
  percentHeadline,
} from '@/components/campaigns/DiscountsList';
import { sentenceOf } from '@/components/campaigns/discounts-model';
import {
  alarmingCards,
  dayCount,
  queueStandSentence,
  resetPhrase,
  type QueueSnapshotView,
} from '@/components/campaigns/queue-model';
import {
  campaignProducts,
  discountItemBreakdown,
  fetchQueue,
  getDiscount,
  stopDiscountQueue,
  type CampaignProductRowView,
  type CampaignProductsView,
  type DiscountDetailData,
  type DiscountItemView,
  type ItemBreakdownView,
} from '@/components/campaigns/zlavy-api';
import { useRefreshable } from '@/components/layout/refresh';
import { repeatDiscountHref } from '@/components/campaigns/presets-model';
import { hrefForAnchor } from '@/components/settings/sub-pages';
import BudgetMeter from '@/components/ui/BudgetMeter';
import Icon from '@/components/ui/Icon';
import StatTile from '@/components/ui/StatTile';
import { SigMark, type SigVariant } from '@/components/ui/StatusMark';
import { TONE_ICON } from '@/components/ui/ToneBadge';
import { DISCOUNTED_PRICE_DISCLAIMER_SK } from '@/lib/domain/pricing';
import { formatDateSk, formatDateTimeSk, formatEur } from '@/lib/ui/format';
import { productNameCell } from '@/lib/ui/product-label';
import { productColumns, valueOrGap } from '@/lib/ui/product-columns';
import { formatCountSk, itemSentence, pluralSk } from '@/lib/ui/vocabulary';

/**
 * Kam vedie odkaz spod „Dopad na maržu — zamknuté" (kontrakt bod 18).
 *
 * Vysvetlenie, PREČO je údaj zamknutý, má v celej appke jediné miesto:
 * `settings/LockedFeatures.tsx`. Detail naň teda odkazuje a nedopisuje ani
 * pol vety vlastnými slovami — dva výklady toho istého sa raz rozídu.
 * Kotva `#zamknute` sa na cestu prekladá cez `hrefForAnchor`, takže
 * presťahovanie sekcie medzi podstránkami Nastavení sem nesiahne.
 */
const LOCKED_WHY_HREF = hrefForAnchor('#zamknute');

/** Koľko položiek si vypýtame. Detail nie je export katalógu (odpoveď 56). */
const ITEMS_LIMIT = 1000;

/** Koľko problémových riadkov sa vypíše; zvyšok je číslo, nie zoznam. */
const PROBLEM_ROWS = 20;

/** Stavy, ktoré sú v poriadku alebo sa ešte len chystajú — tie sa nevypisujú. */
const QUIET_STATUSES = new Set(['ok', 'pending', 'skipped']);

/**
 * Stavy, ktoré majú v Priebehu vlastnú dlaždicu (D45). Sekcia Položky vypisuje
 * PRÁVE ZVYŠOK — tie stavy, ktoré by inak na obrazovke neboli vôbec. Zoznam je
 * napísaný takto (a nie ako výber štyroch z ôsmich), aby stav pridaný budúcou
 * migráciou spadol do zvyšku a objavil sa sám, nie aby ticho zmizol.
 */
const TILED_STATUSES = new Set(['ok', 'pending', 'failed', 'uncertain']);

function isProblem(item: DiscountItemView): boolean {
  if (!QUIET_STATUSES.has(item.status)) return true;
  // D39c — rozhodovalo sa nad inou cenou. Nie je to chyba zápisu, ale
  // zamlčať sa to nesmie.
  return item.priceMismatch;
}

/* ═══════════════════ zastavenie fronty a koniec zľavy ═════════════════════ */

/**
 * Zastavenie fronty — dva kroky. Týka sa VÝHRADNE toho, čo ešte nebolo
 * zapísané; už zapísané zľavy v eshope zostávajú a appka ich nezruší (I7) —
 * skončia samy dňom konca zľavy. Tú vetu povie `expiryNoteText()` nižšie.
 */
function StopQueue({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await stopDiscountQueue(id, 'Zastavené v detaile zľavy');
    setBusy(false);
    if (res.ok) {
      setNote(null);
      onChanged();
      return;
    }
    setNote(res.error.message);
  }

  return (
    <details className="stopq" data-testid="detail-stop">
      <summary className="btn">Zastaviť frontu</summary>
      <div className="stopq-b">
        <span>Zastaví sa len to, čo ešte nebolo zapísané. Zapísané v eshope zostanú.</span>
        <button
          type="button"
          className="btn sm danger"
          disabled={busy}
          onClick={() => void run()}
          data-testid="detail-stop-confirm"
        >
          Áno, zastaviť
        </button>
      </div>
      {note === null ? null : <div className={styles.note}>{note}</div>}
    </details>
  );
}

/**
 * Ako sa zapísaná zľava skončí — jedna veta (I7, R6).
 *
 * PREČO TU NIE JE TLAČIDLO. Do 26. 8. 2026 na tomto mieste stála akcia
 * „Zrušiť zľavu": disclosure s potvrdením a s finálnym tlačidlom, ktoré bolo
 * vypnuté, lebo serverová cesta neexistuje. Jej komentár tvrdil, že invariant
 * I7 sa „týmto MENÍ". Nezmenil sa: `docs/10-KONTRAKT.md` ho drží v pôvodnej
 * podobe, README ho hlási medzi tým, čo appka robí a nerobí,
 * `test/unit/no-clear-reduction.spec.ts` ho vynucuje a
 * `test/e2e/partial-failure-retry.spec.ts` výslovne žiada, aby v UI taká akcia
 * NEBOLA. `KONTRAKT-API-V5-2026-08-13.md` (R1), z ktorého tlačidlo vzniklo, je
 * NÁVRH — jeho sekcia Výsledok je prázdna.
 *
 * Katalóg tou istou vetou tvrdil opak (`catalog-status.ts` → „Appka zľavy
 * neruší — počkajte, kým doterajšia skončí"). Priznať NEZAPOJENÚ akciu je
 * správny vzor; priznať ZAKÁZANÚ nie je — je to prísľub schopnosti, ktorú
 * invariant zakazuje postaviť. Namiesto tlačidla tu preto stojí odpoveď na tú
 * istú otázku („ako sa toho zbavím?"): zapísaná zľava skončí sama dňom svojho
 * konca. Zastaviť sa dá fronta, teda to, čo sa ešte nezapísalo.
 *
 * Keď sa R1 raz schváli, mení sa NAJPRV I7 a jeho test, až potom táto
 * obrazovka — nikdy naopak.
 */
export function expiryNoteText(dateTo: string): string {
  return `Appka zľavu v eshope neruší — zapísané zľavy skončia samy ${formatDateSk(dateTo)}.`;
}

/**
 * STĹPEC AKCIÍ detailu ako samostatný, vykresliteľný komponent.
 *
 * Oddelený z toho istého dôvodu ako `QueueTiles` nižšie: `DiscountDetail` je
 * klientský komponent, ktorý čísla ťahá až v efekte, takže
 * `renderToStaticMarkup` ho zastihne v stave „Načítavam…" a tvrdenie o tom, čo
 * stĺpec akcií ponúka, nemá čo merať. A práve TU žila rozpornosť dvoch
 * obrazoviek, takže to je jediné miesto, kde ju test môže zmerať na
 * vykreslenom výstupe a nie v zdrojovom texte.
 */
export function DetailActions({
  campaign,
  pendingItems,
  onChanged,
}: {
  campaign: DiscountDetailData['campaign'];
  /** Meraný počet čakajúcich položiek, `null` = rozpad sa nedal prečítať. */
  pendingItems: number | null;
  onChanged: () => void;
}) {
  /*
   * Veta o konci má zmysel len tam, kde je čo čakať: appka už niečo zapísala
   * (alebo o tom nevie, D45) a zľava ešte neskončila. Pri skončenej zľave by
   * to bola informácia o minulosti a na povrchu šum (P2).
   */
  const live = campaign.itemsOk + campaign.itemsUncertain;
  const showExpiry = live > 0 && sentenceOf(campaign).state !== 'skončila';

  return (
    <>
      {/*
       * Zastavenie fronty sa skrýva len vtedy, keď VIEME, že nič nečaká.
       * Pri neznámom počte (`null`) tlačidlo zostáva: zastavenie nič
       * nezapisuje, takže tu je fail-open správna strana — skryť poistku na
       * základe nevedomosti by bolo horšie než ju ponúknuť zbytočne.
       */}
      {pendingItems === 0 ? null : <StopQueue id={campaign.id} onChanged={onChanged} />}
      {showExpiry ? (
        <div className={styles.sideNote} data-testid="detail-expiry">
          {expiryNoteText(campaign.dateTo)}
        </div>
      ) : null}
      {/*
       * ZOPAKOVAŤ ZĽAVU (D112, K7) — ODKAZ na formulár novej zľavy
       * s predplnenými pásmami, percentami a dĺžkou okna. Nie je to zápis
       * a nie je to kópia: produkty sa vyberú znova z aktuálneho katalógu
       * a zľava prejde skúškou naprázdno aj potvrdením ako každá iná (I3).
       * Prenášať zoznam ID by predstieralo, že appka vie, čo je dnes v pásme.
       */}
      <Link className="btn" href={repeatDiscountHref(campaign)} data-testid="detail-repeat">
        Zopakovať zľavu
      </Link>
      <div className={styles.sideNote} data-testid="detail-repeat-note">
        Predplní formulár novej zľavy. Nezapisuje — zľava vznikne až po skúške naprázdno a po
        potvrdení.
      </div>
    </>
  );
}

/* ═══════════════════════════ obrazovka ════════════════════════════════════ */

/**
 * ŠTYRI DLAŽDICE FRONTY ako samostatný, vykresliteľný komponent.
 *
 * Oddelené od `DiscountDetail` z toho istého dôvodu, pre ktorý sa 19. 8. 2026
 * oddelila `PerformanceCard` od `DiscountPerformance`: detail je klientský
 * komponent, ktorý si čísla ťahá až v efekte, takže `renderToStaticMarkup` ho
 * zastihne v stave „Načítavam…" a tvrdenia o dlaždiciach nemajú čo merať.
 * Test tak dokázal nanajvýš to, že v ZDROJI niekde stojí `<Icon>` — a presne
 * taká hrubosť merania (súbor namiesto výskytu) nechala prejsť značku
 * odstránenú z jedného z dvoch hostiteľov.
 *
 * Komponent je čistý: žiadne hooky, žiadne načítavanie, len čísla dnu a
 * markup von. `test/unit/znacky-zlavy-fronta.spec.ts` ho vykresľuje naozaj a
 * pri KAŽDEJ zo štyroch dlaždíc kontroluje tri kanály zvlášť.
 */
export function QueueTiles({
  campaign,
  pendingItems,
}: {
  campaign: DiscountDetailData['campaign'];
  /**
   * Koľko položiek naozaj čaká na zápis — MERANÝ počet zo rozpadu po stavoch,
   * alebo `null`, keď sa rozpad prečítať nedal. Nie je to
   * `campaign.itemsPending`: to je odčítanie a počíta aj položky, ktoré už
   * dopadli (preskočené, nenájdené, prerušené, zablokované). Pozri hlavičku
   * modulu, sekciu o U6.
   */
  pendingItems: number | null;
}) {
  /** Má stav čo hlásiť? Prúžok farby dostane len dlaždica s nenulovým číslom. */
  const anyOf = (units: number): 'ano' | 'nie' => (units > 0 ? 'ano' : 'nie');
  /* Neznámy počet nefarbí — pomlčka nie je poplach a nie je ani nula. */
  const pendingAny: 'ano' | 'nie' = pendingItems === null ? 'nie' : anyOf(pendingItems);

  return (
    <>
{/*
       * Štyri dlaždice fronty — nikdy tri (D45, kontrakt UI, bod 22).
       * „Nevieme, či sa zapísalo" je vlastný stav: zápis odišiel a
       * odpoveď nedorazila, takže produkt zlacnený BYŤ MÔŽE. Farbu
       * dostane len dlaždica, ktorá má čo hlásiť — červený prúžok nad
       * nulou zlyhaní by bol falošný poplach. Stav preto nesie farbu,
       * značku aj slovo naraz.
       *
       * PREČO ZNAČKA STOJÍ VEDĽA `StatTile`, A NIE V JEJ POPISKU
       * -------------------------------------------------------
       * Do 20. 8. 2026 tu boli len DVA kanály — farba (`data-state` a
       * ľavý prúžok) a slovo. Značku dlaždice stratili vtedy, keď sa
       * stará mapa glyfov po prechode na ikony vyprázdnila namiesto toho,
       * aby ju niekto nahradil; na obrazovke to vyzeralo ako medzera
       * navyše, takže si toho nikto nevšimol a nič nespadlo. Meno tej
       * mapy sa sem zámerne nepíše ani v komentári — `zlava-detail-
       * priebeh.spec.ts` ho hľadá v celom súbore vrátane komentárov.
       *
       * `StatTile` (`ui/StatTile.tsx`) berie `label` ako REŤAZEC, takže
       * značku doň vložiť nejde — a vložiť ju ako ZNAK do textu sa
       * nesmie: rodina `.sig` sa práve preto prepísala z `content:`
       * v `::before` na `<Icon>` (`ui/StatusMark.tsx`). Meniť `StatTile`
       * na `ReactNode` by zase znamenalo siahnuť na primitív, ktorý
       * kreslí dlaždice na štyroch ďalších obrazovkách kvôli jednej.
       *
       * Ikona preto stojí ako SÚRODENEC dlaždice a `.queueTile` je
       * mriežka „značka | telo" — presne ten istý útvar, aký má v tomto
       * tabe riadok prekážky (`.blocker` + `.blockerGlyph` +
       * `.blockerBody`). Tvar ikony sa berie z koreňového slovníka
       * značiek `TONE_ICON` (`ui/ToneBadge.tsx`), teda z toho istého
       * miesta, odkiaľ ho má badge aj `ToneSigMark` — nová tabuľka
       * „stav fronty → ikona" tu zámerne NEVZNIKÁ. Tón vedľa mena ikony
       * je ten istý, ktorým `zlavy.module.css` farbí úsek pruhu.
       *
       * Značka je `aria-hidden`: slovo stojí v tej istej dlaždici, takže
       * čítačka by inak prečítala ten istý stav dvakrát.
       */}
      <div className={`kpis ${styles.queueTiles}`}>
        <div className={styles.queueTile} data-state="ok" data-any={anyOf(campaign.itemsOk)}>
          {/* tón `good` — tá istá farba, akou pruh kreslí úsek `ok` */}
          <Icon className={styles.queueGlyph} name={TONE_ICON.good} size={0.85} />
          <StatTile
            label={`Zapísané`}
            value={formatCountSk(campaign.itemsOk)}
            detail={
              campaign.itemsOk === 0
                ? null
                : `z ${formatCountSk(campaign.itemsTotal)} produktov tejto zľavy`
            }
            testId="tile-ok"
          />
        </div>
        <div className={styles.queueTile} data-state="pending" data-any={pendingAny}>
          {/* tón `progress` — zápis ešte len príde, nie je to chyba */}
          <Icon className={styles.queueGlyph} name={TONE_ICON.progress} size={0.85} />
          <StatTile
            label={`Čaká na zápis`}
            /* Pomlčka, nie odčítané číslo: bez rozpadu po stavoch sa nedá
               povedať, či v odčítaní nie sú položky, ktoré už dopadli (U6). */
            value={pendingItems === null ? '—' : formatCountSk(pendingItems)}
            detail={
              pendingItems === null
                ? 'rozpad položiek po stavoch sa nepodarilo prečítať'
                : pendingItems === 0
                  ? null
                  : 'fronta na ne ešte nedošla'
            }
            testId="tile-pending"
          />
        </div>
        <div
          className={styles.queueTile}
          data-state="failed"
          data-any={anyOf(campaign.itemsFailed)}
        >
          {/* tón `critical` — zápis sa nepodaril, produkt zlacnený nie je */}
          <Icon className={styles.queueGlyph} name={TONE_ICON.critical} size={0.85} />
          <StatTile
            label={`Nepodarilo sa`}
            value={formatCountSk(campaign.itemsFailed)}
            detail={
              campaign.itemsFailed === 0
                ? null
                : /* Kratšie o dve slová než pôvodné znenie: pri štyroch
                     dlaždicach vedľa seba rozhoduje o výške celého radu
                     najdlhší popis, a „tieto produkty" nič nepridávalo. */
                  'zlacnené nie sú, dajú sa zopakovať'
            }
            testId="tile-failed"
          />
        </div>
        <div
          className={styles.queueTile}
          data-state="uncertain"
          data-any={anyOf(campaign.itemsUncertain)}
        >
          {/* tón `attention` — treba sa pozrieť, nie je to zlyhanie */}
          <Icon className={styles.queueGlyph} name={TONE_ICON.attention} size={0.85} />
          <StatTile
            label={`Nevieme, či sa zapísalo`}
            value={formatCountSk(campaign.itemsUncertain)}
            detail={
              campaign.itemsUncertain === 0 ? null : 'zápis odišiel, odpoveď nedorazila'
            }
            testId="tile-uncertain"
          />
        </div>
      </div>
    </>
  );
}

/**
 * TABUĽKA PROBLÉMOVÝCH POLOŽIEK — PEVNÉ ŠÍRKY (UX2, 24. 8. 2026; D124, 1. 9. 2026).
 *
 * Tabuľka mala kedysi päť stĺpcov, každý s `white-space: nowrap` z `table.tbl`,
 * a pri automatickom rozvrhu si vypýtala ~845 px do rámu širokého 732. Posledný
 * stĺpec tak končil odrezaný za hranou karty.
 *
 * „Poznámka" bola vždy DÔVOD toho, čo hovorí stĺpec „Zapísané" — nie
 * samostatný údaj. Preto je odteraz druhým riadkom tej istej bunky: tabuľka sa
 * zmestí, dôvod stojí pri stave, ktorý vysvetľuje, a nič sa nestratilo.
 *
 * PIATY STĹPEC JE OD 1. 9. 2026 SPÄŤ, A JE TO INÝ PIATY STĹPEC (D122, D124)
 * ------------------------------------------------------------------------
 * „Referencia" nie je návrat „Poznámky": je to KRÁTKY kód (jednotky znakov),
 * nie voľný text, ktorý sa naťahoval podľa najdlhšej vety. Miesto naň dal
 * výhradne stĺpec názvu (46 % → 32 %), ktorý sa v tejto tabuľke smie lámať
 * (`.itemsScroll table.tbl td { white-space: normal }`); „Cena pri príprave",
 * „Zľava" ani „Zapísané" o žiadne percento neprišli, takže pretečenia, ktoré
 * UX2 odmeral, sa vrátiť nemajú.
 *
 * ČO Z JEDNOTNEJ SADY TÁTO TABUĽKA BERIE A ČO VYNECHÁVA (D124)
 * -----------------------------------------------------------
 * Berie `reference` a `name` — identitu produktu, ktorá je všade tá istá vec.
 * VYNECHÁVA `price` aj `discountNow`, a je to celé pravidlo D124: tabuľka
 * ukazuje cenu PRI PRÍPRAVE a percento TEJTO zľavy, čo sú iné veličiny než
 * aktuálna cena a zľava, ktorá na produkte beží teraz. Premenovať ich na „Cena"
 * a „Zľava teraz" by bolo presne to zliatie, kvôli ktorému sa tabuľky rozišli;
 * história zápisu sa navyše neprepisuje (I4).
 *
 * Šírky nesie `<colgroup>` a `table-layout: fixed`, nie odhad prehliadača —
 * inak by jeden dlhý názov produktu zase pretlačil stav mimo kartu.
 *
 * Vlastný komponent je zámer: rozvrh tabuľky sa dá takto overiť bez appky aj
 * bez prehliadača (`test/unit/zlavy-ux2-rozvrh.spec.ts`).
 */
export function ItemsTable({
  rows,
  fallbackPercent,
}: {
  readonly rows: readonly DiscountItemView[];
  /** Percento zľavy pre položky, ktoré vlastné percento nemajú (K3). */
  readonly fallbackPercent: number;
}) {
  /*
   * Jednotná sada (D124) — len tie stĺpce, ktoré tu znamenajú TO ISTÉ čo
   * v tabuľke Produktov. Zvyšné tri sú stĺpce histórie zápisu a kreslia sa
   * pod vlastnými menami hneď za nimi (rozbor v hlavičke komponentu).
   */
  const columns = productColumns(['reference', 'name']);
  return (
    <table className="tbl">
      <colgroup>
        <col className={styles.colRef} />
        <col className={styles.colName} />
        <col className={styles.colPrice} />
        <col className={styles.colPct} />
        <col className={styles.colState} />
      </colgroup>
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
          <th className="n">Cena pri príprave</th>
          <th className="n">Zľava</th>
          <th>Zapísané</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="lvl-3">—</td>
            <td className="name lvl-3">Zatiaľ sa nič nepokazilo.</td>
            <td className="n">—</td>
            <td className="n">—</td>
            <td>—</td>
          </tr>
        ) : (
          rows.map((item) => {
            const say = itemSentence(item.status);
            /* Trieda aj značka z JEDNEJ hodnoty — dve kópie tej istej
               podmienky by sa časom rozišli a farba by hovorila iné
               než tvar. */
            const itemSig: SigVariant = item.status === 'ok' ? 'ok' : 'warn';
            const reason = item.priceMismatch ? 'Cena sa medzitým zmenila' : say.reason;
            /*
             * D122 — referencia má VLASTNÝ prvý stĺpec, takže sa do názvu
             * nezliepa. Referencia sa k položke DOPĹŇA pri zobrazení (JOIN na
             * strane servera); história zápisu sa neprepisuje (I4). Keď ju
             * appka nepozná, je to „produkt nie je obohatený" (D118) — nikdy
             * vymyslený kód a nikdy tvrdenie, že produkt referenciu nemá.
             */
            const values = {
              productId: item.productId,
              reference: valueOrGap(item.reference ?? null, 'not_enriched'),
              name: valueOrGap(item.nameAtWrite, 'shop_has_none'),
            };
            /* `#id` zostáva dosiahnuteľné, ale v technickom detaile (D116). */
            const technical = productNameCell({
              productId: item.productId,
              name: item.nameAtWrite,
            }).technical;
            return (
              <tr key={item.id}>
                {columns.map((column) => {
                  const cell = column.cell(values);
                  return (
                    <td
                      key={column.id}
                      className={column.id === 'name' ? 'name' : undefined}
                      data-col={column.id}
                      data-l={column.label}
                      title={column.id === 'name' ? technical : (cell.title ?? undefined)}
                    >
                      {cell.unknown ? <span className="lvl-3">{cell.text}</span> : cell.text}
                    </td>
                  );
                })}
                <td className="n" data-l="Cena">
                  {formatEur(item.priceAtPreview)}
                </td>
                <td className="n" data-l="Zľava">
                  {item.percent === undefined ? `${fallbackPercent} %` : `${item.percent} %`}
                </td>
                <td data-l="Zapísané">
                  <span className={`sig ${itemSig}`}>
                    <SigMark variant={itemSig} />
                    {say.label}
                  </span>
                  {reason === '' ? null : (
                    <span className={`lvl-3 ${styles.itemReason}`}>{reason}</span>
                  )}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

/* ═══════════ PRODUKTY ZĽAVY — rozklik „ktorých 21" (D127 bod 1) ═══════════ */

/** Koľko riadkov nesie jedna strana rozkliku. Toľko, koľko vracia route. */
export const PRODUCTS_PER_PAGE = 100;

/**
 * Prečo referenciu ani dnešný názov nevieme, keď produkt v zrkadle NIE JE.
 *
 * Jednotné stĺpce poznajú `not_enriched` („nepýtali sme sa") a `shop_has_none`
 * („pýtali sme a shop nič nevie"). Zmiznutý produkt nie je ani jedno: appka sa
 * pýtala, shop odpovedal a produkt tam odvtedy nie je. Preto sa dôvod dopĺňa
 * TU, do `title` bunky — vymyslieť si nový kód medzery v spoločnom module by
 * znamenalo zmeniť význam slovníka kvôli jednej tabuľke.
 */
export const GONE_FROM_CATALOG_SK =
  'Produkt už v zrkadle katalógu nie je. Riadok zľavy zostáva ako dôkaz o tom, ' +
  'čo appka urobila, ale referenciu ani dnešný názov nemá odkiaľ vziať.';

/** Odkiaľ je „cena pred" — veta k stĺpcu, nie kód. */
function priceBeforeNote(row: CampaignProductRowView): string | null {
  if (row.priceBeforeSource === 'write') return 'cena pri zápise';
  if (row.priceBeforeSource === 'preview') return 'cena pri príprave';
  return null;
}

/**
 * TABUĽKA PRODUKTOV JEDNEJ ZĽAVY.
 *
 * Čo tu drží a prečo:
 *
 *  1. **Referencia je PRVÝ stĺpec** (D122) a berie sa z jednotnej sady (D124),
 *     takže sa volá rovnako a znamená to isté ako na Produktoch.
 *  2. **Riadok sa nestratí.** Produkt, ktorý z katalógu zmizol, tu JE — s
 *     pomlčkou a s dôvodom v `title` (`GONE_FROM_CATALOG_SK`). Route ho drží
 *     cez `LEFT JOIN`, tabuľka ho nesmie odfiltrovať.
 *  3. **„Cena po" je ORIENTAČNÁ** (D4, I11). Appka ju vypočítala z ceny, ktorú
 *     naposledy videla; skutočnú zľavnenú cenu cez API nevidela nikdy. Preto ju
 *     sprevádza `DISCOUNTED_PRICE_DISCLAIMER_SK` a nikdy sa nedopočítava
 *     z neznámej ceny — bez „ceny pred" je „cena po" pomlčka, nie nula.
 *  4. **Zaškrtávanie nie je zápis.** Výber slúži jedine na predplnenie
 *     sprievodcu (`?produkty=…`); skúška naprázdno a potvrdenie sa odohrajú
 *     tam nanovo (I3).
 *
 * Komponent je čistý (žiadne načítanie, žiadne hooky okrem tých, ktoré dostane
 * zvonka), aby sa dal vykresliť a overiť bez appky aj bez prehliadača.
 */
export function CampaignProductsTable({
  rows,
  selected,
  onToggle,
}: {
  readonly rows: readonly CampaignProductRowView[];
  /** ID produktov, ktoré sú zaškrtnuté. Prázdna množina = nič nie je vybrané. */
  readonly selected: ReadonlySet<number>;
  /** `undefined` = tabuľka je len na čítanie a zaškrtávadlá sa nekreslia. */
  readonly onToggle?: (productId: number) => void;
}) {
  const columns = productColumns(['reference', 'name']);
  const pickable = onToggle !== undefined;

  return (
    <table className="tbl" data-testid="detail-products-table">
      <thead>
        <tr>
          {pickable ? <th aria-label="Vybrať" /> : null}
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
          <th className="n">Cena pred</th>
          <th className="n" title={DISCOUNTED_PRICE_DISCLAIMER_SK}>
            Cena po
          </th>
          <th>Zapísané</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const say = itemSentence(row.status);
          const sig: SigVariant = row.status === 'ok' ? 'ok' : 'warn';
          /*
           * Dva rôzne dôvody pre tú istú pomlčku (I11): produkt buď v zrkadle
           * nie je vôbec, alebo v ňom je a nie je obohatený (D118). Kód medzery
           * je v oboch prípadoch ten istý, dôvod v `title` nie.
           */
          const gone = !row.inCatalog;
          const values = {
            productId: row.productId,
            reference: valueOrGap(row.reference, 'not_enriched'),
            name: valueOrGap(row.catalogName, 'not_enriched'),
          };
          const beforeNote = priceBeforeNote(row);
          return (
            <tr key={row.itemId} data-testid="detail-products-row">
              {pickable ? (
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(row.productId)}
                    onChange={() => onToggle(row.productId)}
                    aria-label={`Vybrať produkt ${row.reference ?? `#${row.productId}`}`}
                    data-testid="detail-products-pick"
                  />
                </td>
              ) : null}
              {columns.map((column) => {
                const cell = column.cell(values);
                const title = cell.unknown && gone ? GONE_FROM_CATALOG_SK : cell.title;
                return (
                  <td
                    key={column.id}
                    className={column.id === 'name' ? 'name' : undefined}
                    data-col={column.id}
                    data-l={column.label}
                    title={title ?? undefined}
                  >
                    {cell.unknown ? <span className="lvl-3">{cell.text}</span> : cell.text}
                    {/*
                      Názov PRI ZÁPISE je iný fakt než dnešný názov v katalógu
                      a história zápisu sa neprepisuje (I4). Preto sa nedosadzuje
                      do stĺpca „Názov", ale stojí pod ním s vlastným menom.
                    */}
                    {column.id === 'name' &&
                    row.catalogName === null &&
                    row.nameAtWrite !== null ? (
                      <span className="lvl-3" data-testid="detail-products-name-at-write">
                        pri zápise: {row.nameAtWrite}
                      </span>
                    ) : null}
                  </td>
                );
              })}
              <td className="n" data-l="Cena pred">
                {formatEur(row.priceBefore)}
                {beforeNote === null ? null : <span className="lvl-3">{beforeNote}</span>}
                {row.priceMismatch ? (
                  <span className="lvl-3" data-testid="detail-products-mismatch">
                    cena sa medzitým zmenila
                  </span>
                ) : null}
              </td>
              <td className="n" data-l="Cena po" title={DISCOUNTED_PRICE_DISCLAIMER_SK}>
                {formatEur(row.priceAfter)}
                <span className="lvl-3">
                  {row.priceAfterEstimated ? `orientačne · −${row.percent} %` : `−${row.percent} %`}
                </span>
              </td>
              <td data-l="Zapísané">
                <span className={`sig ${sig}`}>
                  <SigMark variant={sig} />
                  {say.label}
                </span>
                {row.reductionUnverifiable ? (
                  <span className="lvl-3" data-testid="detail-products-unverifiable">
                    zľavu sa po zápise nepodarilo overiť
                  </span>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * ROZKLIK „Produkty v zľave" — načítanie, stránkovanie a začatie novej zľavy
 * z vybraných riadkov (D127 body 1 a 2).
 *
 * Načítava sa AŽ po otvorení rozkliku: strana môže mať sto riadkov a detail
 * zľavy sa otvára pri každom kliku v rebríku. Kto rozklik nikdy neotvorí,
 * nezaplatí zaň ani jeden dotaz.
 *
 * Z tejto cesty NEODCHÁDZA žiadny zápis. Jediné, čo výber robí, je adresa
 * `/zlavy/nova?produkty=…` — hodnoty formulára. Skúška naprázdno a potvrdenie
 * sa odohrajú v sprievodcovi nanovo (I3) a route, ktorá by zoznam produktov
 * premenila na kampaň, neexistuje.
 */
export function CampaignProductsPane({ id, total }: { id: number; total: number }) {
  const [data, setData] = useState<CampaignProductsView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set<number>());

  const load = useCallback(
    async (want: number) => {
      setBusy(true);
      const res = await campaignProducts(id, want, PRODUCTS_PER_PAGE);
      setBusy(false);
      if (res.ok) {
        setData(res.data);
        setFailed(null);
        return;
      }
      // Zlyhanie čítania NIE JE prázdny zoznam — prázdny zoznam by tvrdil, že
      // zľava nemá produkty, a to tu nikto nevie (P7).
      setData(null);
      setFailed(res.error.message);
    },
    [id],
  );

  const toggle = useCallback((productId: number) => {
    setPicked((before) => {
      const next = new Set(before);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }, []);

  const pages = total === 0 ? 1 : Math.ceil(total / PRODUCTS_PER_PAGE);
  const startHref = newDiscountFromProductsHref([...picked]);

  return (
    <details
      className={styles.fold}
      data-testid="detail-products"
      onToggle={(event) => {
        if (event.currentTarget.open && data === null && failed === null && !busy) {
          void load(1);
        }
      }}
    >
      <summary>
        Produkty v zľave ({formatCountSk(total)}) — referencia, cena pred a po, stav zápisu
      </summary>
      <div className={styles.foldBody}>
        {failed === null ? null : (
          <div className="lvl-3" data-testid="detail-products-error">
            Zoznam produktov zľavy sa nepodarilo načítať: {failed}
          </div>
        )}

        {data === null ? (
          failed === null ? (
            <div className="lvl-3">{busy ? 'Načítavam produkty…' : 'Zoznam sa ešte nenačítal.'}</div>
          ) : null
        ) : (
          <>
            <div className="tbl-frame">
              <div className={styles.itemsScroll}>
                <CampaignProductsTable rows={data.items} selected={picked} onToggle={toggle} />
              </div>
              <div className="tbl-foot">
                <span>
                  Strana {formatCountSk(data.page)} z {formatCountSk(pages)} ·{' '}
                  {formatCountSk(data.items.length)}{' '}
                  {pluralSk(data.items.length, 'riadok', 'riadky', 'riadkov')} z{' '}
                  {formatCountSk(total)}. {DISCOUNTED_PRICE_DISCLAIMER_SK}
                </span>
              </div>
            </div>

            {pages <= 1 ? null : (
              <div className="row wrapx" data-testid="detail-products-paging">
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || data.page <= 1}
                  onClick={() => void load(data.page - 1)}
                >
                  Predošlá strana
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || data.page >= pages}
                  onClick={() => void load(data.page + 1)}
                >
                  Ďalšia strana
                </button>
              </div>
            )}

            {/*
             * ZAČAŤ NOVÚ ZĽAVU Z VYBRANÝCH (D127 bod 2). Odkaz, nie akcia:
             * vedie do sprievodcu s predplneným výberom a tam sa nanovo urobí
             * skúška naprázdno a vypýta potvrdenie (I3).
             */}
            <div className={styles.sideNote} data-testid="detail-products-start">
              {startHref === null ? (
                <span className="lvl-3">
                  Zaškrtnutím riadkov sa dá z tohto výberu založiť nová zľava. {NEW_DISCOUNT_GATE_SK}
                </span>
              ) : (
                <>
                  <Link className="btn primary" href={startHref} data-testid="detail-products-new">
                    Nová zľava z vybraných ({formatCountSk(picked.size)})
                  </Link>
                  <span className="lvl-3">{NEW_DISCOUNT_GATE_SK}</span>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

export function DiscountDetail({ id }: { id: number }) {
  const [data, setData] = useState<DiscountDetailData | null>(null);
  const [queue, setQueue] = useState<QueueSnapshotView | null>(null);
  const [breakdown, setBreakdown] = useState<ItemBreakdownView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * Detail zľavy, stav celej fronty a rozpad položiek po stavoch JEDNÝM
   * načítaním. Do 13. 8. sa fronta doťahovala vlastným časovačom každých 30 s —
   * dve skupiny čísel na jednej obrazovke tak platili k rôznym okamihom a
   * riadok sa pod rukami prepisoval. Rozpad prišiel k nim (31. 8. 2026) z toho
   * istého dôvodu: dlaždica „Čaká na zápis" a riadok zvyšných stavov sa
   * navzájom dopĺňajú, takže musia platiť k jednému okamihu.
   *
   * Neúspešný rozpad NEZHODÍ obrazovku — je to jedno číslo a jeden riadok, oba
   * majú svoju pomlčku. Detail zľavy je to, bez čoho tu nie je čo kresliť.
   */
  const load = useCallback(async () => {
    const [detail, snapshot, items] = await Promise.all([
      getDiscount(id, ITEMS_LIMIT),
      fetchQueue(),
      discountItemBreakdown(id),
    ]);
    if (detail.ok) {
      setData(detail.data);
      setFailed(null);
    } else {
      setData(null);
      setFailed(detail.error.message);
    }
    setQueue(snapshot.ok ? snapshot.data : null);
    setBreakdown(items.ok ? items.data : null);
  }, [id]);

  const { at, pending } = useRefreshable(load);

  if (failed !== null) {
    return (
      <section className="sec" data-testid="detail-error">
        <div className="empty">
          <div className="t">Zľavu sa nepodarilo načítať</div>
          <div>{failed} Ďalší pokus: tlačidlo Obnoviť v stavovom pruhu.</div>
          <div className="a">
            <Link className="btn" href="/zlavy">
              Späť na zoznam
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (data === null) {
    return (
      <div className={styles.busy}>
        {pending ? 'Načítavam zľavu…' : 'Zľava nie je k dispozícii.'}
      </div>
    );
  }

  const campaign = data.campaign;
  const done = campaign.itemsOk + campaign.itemsFailed + campaign.itemsUncertain;
  const sentence = sentenceOf(campaign);
  const head = percentHeadline(campaign.percent, data.tiers);
  const problems = data.items.filter(isProblem);
  const shown = problems.slice(0, PROBLEM_ROWS);
  const scanned = data.items.length;

  const budget = queue === null ? null : queue.budget;
  const stand = queue === null ? null : queueStandSentence(queue.standing.reason);
  const writing = queue !== null && queue.standing.writing;
  const alarming = queue === null ? [] : alarmingCards(queue.standing.blockers);
  const showStand =
    stand !== null && !writing && queue !== null && queue.standing.reason !== 'queue_empty';

  /*
   * Panel opakovania sa ponúka vtedy, keď má o čom hovoriť — teda keď niečo
   * neprešlo alebo o niečom nevieme (D45). Či sa naozaj dá zopakovať, rozhodne
   * server; panel si to vypýta sám a prípadné „ešte nie" aj vysvetlí.
   */
  const retryWorthShowing = campaign.itemsFailed > 0 || campaign.itemsUncertain > 0;

  /** Podiel jedného stavu na celej zľave — šírka jeho úseku v pruhu fronty. */
  const shareOf = (units: number): string =>
    campaign.itemsTotal <= 0 ? '0' : ((units / campaign.itemsTotal) * 100).toFixed(2);

  /*
   * KOĽKO POLOŽIEK NAOZAJ ČAKÁ (nález U6) — jedna hodnota pre celú obrazovku.
   *
   * `campaign.itemsPending` sa tu už nečíta: je to odčítanie, do ktorého padnú
   * aj položky, ktoré dopadli. Meraný počet je v rozpade po stavoch; keď rozpad
   * nie je, je to `null` — teda „nevieme", nie nula (P7). Explicitné
   * `=== undefined` je tu zámer: `?? null` by na kľúči s hodnotou `0` fungoval
   * rovnako, ale Turbopack v tomto repe už raz zahodil práve takú skratku.
   */
  const pendingRaw = breakdown === null ? undefined : breakdown.tally['pending'];
  const pendingItems: number | null = pendingRaw === undefined ? null : pendingRaw;

  /*
   * Stavy, ktoré v Priebehu dlaždicu NEMAJÚ. Zoznam sa neopisuje z číselníka —
   * odvodzuje sa od toho, čo dlaždice pokrývajú, takže deviaty stav z budúcej
   * migrácie sa na obrazovke objaví sám. Nuly sa nevypisujú (P2): riadok má
   * hovoriť o tom, čo sa naozaj stalo.
   */
  const otherStates =
    breakdown === null
      ? []
      : Object.entries(breakdown.tally)
          .filter(([status, count]) => count > 0 && !TILED_STATUSES.has(status))
          .map(([status, count]) => ({ status, count }));

  /*
   * Riadok mlčí len vtedy, keď rozpad JE a nemá čo dodať — teda všetko, čo
   * kampaň má, pokrývajú štyri dlaždice. Prázdny `<div>` by na obrazovke
   * nechal medzeru bez významu.
   */
  const breakdownSilent =
    breakdown !== null &&
    otherStates.length === 0 &&
    breakdown.unrecognized === 0 &&
    breakdown.total === campaign.itemsTotal;

  return (
    <div className={styles.page} data-testid="discount-detail">
      {/* Omrvinka „← Zľavy" tu bola dovtedy, kým bol detail samostatná
          stránka. Od šprintu 20 stojí zoznam vľavo od detailu, takže odkaz
          späť by ukazoval na to, čo je vidieť (P2). */}
      <div className={styles.dhead}>
        {/* `h2`, nie `h1`. Od šprintu 20 stojí detail vnútri shellu, ktorý
            svoje `<h1>Zľavy</h1>` už má; druhý by rozbil osnovu čítačke
            obrazovky. Sekcie nižšie sú preto `h3`. */}
        <h2>{campaign.name}</h2>
        <DiscountState sentence={sentence} testId="detail-state" />
      </div>

      {/* 1 · DOMINANTA — priebeh fronty, štyri dlaždice a denný rozpočet */}
      <section className="sec" data-testid="detail-progress">
        <div className="sec-h">
          <h3>Priebeh</h3>
          <div className="act lvl-3">
            zľava <b>{head.big}</b>
            {head.sub === null ? null : <> · {head.sub}</>} · svieti{' '}
            <b>
              {formatDateSk(campaign.dateFrom)} – {formatDateSk(campaign.dateTo)}
            </b>
          </div>
        </div>

        <div className={`${styles.top} ${styles.topStart}`}>
          <div>
            {/*
             * D15 — dominanta a dlaždice sú JEDEN ÚTVAR, nie dva zoznamy tých
             * istých čísel. Dominanta hovorí, koľko z fronty je vybavených;
             * pruh pod ňou je rozdelený na tie isté štyri stavy a dlaždice
             * pod pruhom sú jeho legenda. Vetu „zapísaných 21 · 0 sa
             * nepodarilo · 0 nevieme" sme zrušili — bola to štvorica dlaždíc
             * napísaná ešte raz, slovami.
             *
             * P1, 19. 8. 2026 — dominanta tejto obrazovky niesla veľkosť cez
             * `.prog-lg .n` (64 px), teda mimo škály `.lvl-1/.lvl-2/.lvl-3`.
             * Dva mechanizmy pre tú istú rolu znamenali, že sa P1 nedá zmerať
             * jednotne: detail zľavy nemal ani jednu `.lvl-1`, hoci dominantu
             * mal. `.prog-lg` je odteraz LEN GEOMETRIA (číslo a bočný popisok
             * v jednom riadku); veľkosť nesie `.lvl-1 .big`. Trieda `.n`
             * zostáva ako háčik pre `.of` a pre bočný popisok — kým integrátor
             * neprepíše `globals.css` podľa návrhu, držia obe pravidlá tú istú
             * mieru (64 px, na mobile 44 px), takže sa nič nehýbe.
             */}
            <div className="prog-lg lvl-1">
              <div className="n big num" data-testid="detail-number">
                {formatCountSk(done)}{' '}
                <span className="of">/ {formatCountSk(campaign.itemsTotal)}</span>
              </div>
              <div className="side lvl-3">
                {/* „Vybavenú" sa smie povedať len z MERANEJ nuly; pri neznámom
                    počte zostáva neutrálny popisok, nie tvrdenie o hotovosti. */}
                {pendingItems === 0 ? 'fronta má túto zľavu vybavenú' : 'vybavených z fronty'}
              </div>
            </div>

          </div>

          <div className={styles.side}>
            <DetailActions
              campaign={campaign}
              pendingItems={pendingItems}
              onChanged={() => void load()}
            />
            {/* Tlačidlo „Späť na zoznam" tu stálo, kým bol detail samostatná
                stránka. Zoznam je odteraz vľavo — v stĺpci akcií zostávajú len
                akcie, ktoré niečo menia. */}
          </div>
        </div>

        {/*
         * PRUH A JEHO LEGENDA STOJA CEZ CELÚ KARTU (UX2, 24. 8. 2026).
         *
         * Do 24. 8. boli vnútri ľavého stĺpca `.top`, teda v 440 px vedľa
         * stĺpca akcií. Dlaždice sa tam skladali 2×2, hoci pruh nad nimi má
         * štyri úseky vedľa seba — legenda čítala inak než to, čoho je
         * legendou, a brala 190 px výšky na obrazovke, ktorá prerastala P4
         * takmer dvojnásobne. Sú preto pod `.top`, cez celú šírku a v jednom
         * rade. Akcie zostali hore pri dominante, kde sa o nich rozhoduje.
         */}
        <div className={styles.queueBar} aria-hidden="true">
          <i data-state="ok" style={{ width: `${shareOf(campaign.itemsOk)}%` }} />
          <i data-state="uncertain" style={{ width: `${shareOf(campaign.itemsUncertain)}%` }} />
          <i data-state="failed" style={{ width: `${shareOf(campaign.itemsFailed)}%` }} />
          {/* Neznámy počet nekreslí úsek — prázdna koľaj je „nevieme" a slovami
              to hovorí dlaždica pod pruhom, ktorá má v tej chvíli pomlčku.
              Nulová šírka z neznalosti by tvrdila, že nič nečaká. */}
          <i
            data-state="pending"
            style={{ width: `${pendingItems === null ? '0' : shareOf(pendingItems)}%` }}
          />
        </div>

        <QueueTiles campaign={campaign} pendingItems={pendingItems} />

        {/*
         * Pod dlaždicami zostáva už len to, čo v nich NIE JE — deň
         * dobehnutia. „Ostáva zapísať N" tu bolo tretí raz to isté číslo,
         * ktoré má vlastnú dlaždicu.
         *
         * Vysvetľujúci odsek o neistých kusoch, ktorý tu stál do 24. 8. 2026,
         * je zrušený: 256 znakov výkladu na povrchu je P2 a hovoril to isté,
         * čo dlaždica „Nevieme, či sa zapísalo" so svojím popisom („zápis
         * odišiel, odpoveď nedorazila") a čo o kus nižšie hovorí panel
         * opakovania, ktorý ten ďalší krok aj vykoná.
         */}
        <div className={styles.liveGrid}>
          <div>
            {budget === null ? (
              <div className="lvl-3">Dnešný rozpočet zápisov sa nepodarilo prečítať.</div>
            ) : (
              <BudgetMeter
                label="Zápisy dnes"
                spent={budget.spent}
                limit={budget.budget}
                resetsAt={queue === null ? null : resetPhrase(queue.limits.nextResetAt)}
                testId="detail-budget"
              />
            )}
          </div>
          <div className={styles.liveNext}>
            {/*
             * Deň dobehnutia stál do 24. 8. 2026 vo vlastnom riadku nad
             * rozpočtom. Sú to dve strany tej istej veci — koľko sa dnes
             * ešte zapíše a kedy to teda skončí — takže stoja vedľa seba
             * a obrazovka je o riadok kratšia (P4).
             */}
            {data.estimate === null ? (
              /* Mlčí sa len pri MERANEJ nule — vtedy nie je čo odhadovať. */
              pendingItems === 0 ? null : (
                <span className="lvl-3">odhad dokončenia zatiaľ nevieme</span>
              )
            ) : (
              <span className="lvl-3" data-testid="detail-estimate">
                hotové <b className="est">{formatDateSk(data.estimate.date)}</b>
                {data.estimate.days === 0 ? null : (
                  <> · pobeží ešte {dayCount(data.estimate.days)}</>
                )}
              </span>
            )}
            {budget === null ? (
              <span className="lvl-3">
                Koľko zápisov dnes ostáva, sa nedá prečítať — odhad preto nedopočítavame.
              </span>
            ) : (
              <span className="lvl-3">Rozpočet sa delí medzi všetky zľavy vo fronte.</span>
            )}
          </div>
        </div>

        {/*
         * D16 — jeden zoznam, nie dve červené škatule pod sebou. Dôvod,
         * prečo fronta stojí (stav BEHU appky), a prekážky zápisu (stav
         * DÁT a poistiek) sú dve rôzne veci, ktoré sa nesmú zliať do
         * jednej vety — ale odpovedajú na tú istú otázku, takže patria do
         * jedného rámu s jedným nadpisom. Do 19. 8. 2026 bola prvá z nich
         * vyplnená ružová `Note` a druhá skupina s vlastným nadpisom;
         * obrazovka tak mala dva poplachy tam, kde je jeden dôvod.
         */}
        <StandPanel
          stand={showStand ? stand : null}
          cards={alarming}
          testId="detail-blockers"
          className="gap-t"
        />

        <div className="fresh">
          Podľa vlastných zápisov appky · Dáta k{' '}
          {formatDateTimeSk(at === null ? null : new Date(at))}
        </div>
      </section>

      {/* Pásma — pod rozklikom, teda mimo počtu sekcií (P5, P6). Percentá sú
          na povrchu v hlavičke priebehu, tu je pravidlo a počty. */}
      <details className={styles.fold} data-testid="detail-tiers">
        <summary>Pásma — podľa čoho ktorý produkt zlacnel</summary>
        <div className={styles.foldBody}>
          {data.tiers.length === 0 ? (
            <div className="lvl-3">
              Jedno percento pre celý výber: <b>{campaign.percent} %</b>
            </div>
          ) : (
            <table className={styles.tiersRead}>
              <thead>
                <tr>
                  <th>Pásmo</th>
                  <th>Pravidlo</th>
                  <th className="n">Produktov</th>
                  <th className="n">Zľava</th>
                </tr>
              </thead>
              <tbody>
                {data.tiers.map((tier) => (
                  <tr key={tier.ord}>
                    <td>
                      <b className="lvl-2">{tier.ord}</b>
                    </td>
                    <td>{tier.label}</td>
                    <td className="n num">{formatCountSk(tier.itemsCount)}</td>
                    <td className="n num">
                      <b className="lvl-2">{tier.percent} %</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* K8, šprint 20 B3 — rovnaká dvojica ako na potvrdení novej zľavy.
              Prečo je zamknutá, hovorí jedno miesto ("čo appka zatiaľ nevidí
              a prečo"), nie každá obrazovka vlastnými slovami. Odkaz je preto
              jedno slovo: výklad patrí tam, nie sem. */}
          <div className="lvl-3 gap-t">
            Dopad na maržu <span className="lockline">zamknuté</span>{' '}
            <Link className="lockwhy" href={LOCKED_WHY_HREF}>
              prečo
            </Link>
          </div>
        </div>
      </details>

      {/* 2 · Zopakovanie — len keď je čo. Panel si sadu aj dôvody vypýta sám
          a bez čerstvého potvrdenia nezaradí nič (I3, D16). */}
      {retryWorthShowing ? (
        /*
         * Obal je LEN geometria (`zlavy.module.css` → `.retryPane`). Panel
         * opakovania vlastní iný súbor a jeho obsah sa tu nemení; mení sa to,
         * že jeho dve dlhé poznámky stoja vedľa seba a nie pod sebou. Sekcia
         * tým stratila ~70 px z 431 a detail sa vošiel pod strop P4.
         */
        <div className={styles.retryPane}>
          <RetryFailed campaignId={campaign.id} onCreated={() => void load()} />
        </div>
      ) : null}

      {/*
       * Výkon výberu — pod rozklikom, teda mimo počtu sekcií (P5, P6).
       *
       * Do 24. 8. 2026 to bola tretia sekcia na povrchu. Detail mal ale
       * 1 692 px, teda 1,88 obrazovky pri strope 1,5 — a z troch panelov tejto
       * sekcie sú dva zamknuté: tržby v eurách appka nečíta a vlaňajšok nemá
       * (K8). Na tri otázky, na ktoré detail odpovedá (kde je zápis · čo sa
       * nepodarilo · čo sa dá urobiť), neodpovedá ani jeden z nich. Predané
       * kusy sú kontext, a kontext ide pod rozklik skôr než práca.
       *
       * Žiadny záver o príčine (P8) — čísla stoja vedľa seba a nič netvrdia.
       */}
      <details className={`${styles.fold} ${styles.perfPane}`} data-testid="detail-performance-fold">
        <summary>Výkon výberu — predané kusy pred zľavou a teraz</summary>
        <div className={styles.foldBody}>
          <DiscountPerformance id={campaign.id} />
        </div>
      </details>

      {/* 4 · Položky — súhrn a len problémové riadky */}
      <section className="sec" data-testid="detail-items">
        <div className="sec-h">
          <h3>Položky</h3>
          {/* Štyri čísla tu boli tie isté štyri dlaždice o sekciu vyššie,
              napísané slovami. Zostáva jediné, ktoré dlaždice nemajú. */}
          <div className="act lvl-3">
            {formatCountSk(campaign.itemsTotal)}{' '}
            {pluralSk(campaign.itemsTotal, 'položka', 'položky', 'položiek')}
          </div>
        </div>

        {/*
         * ZVYŠNÉ STAVY — to, čo štyri dlaždice Priebehu nepokrývajú (U6).
         *
         * Kým tento riadok neexistoval, preskočená, nenájdená, prerušená a
         * zablokovaná položka nebola na obrazovke NIKDE: v Priebehu ju
         * odčítanie prilepilo k „čaká na zápis" a v tabuľke nižšie sa vypisujú
         * len problémové riadky, a to najviac `PROBLEM_ROWS` z prvej
         * stránky. Rozpad ide `GROUP BY status` nad celou kampaňou, takže
         * hovorí aj o položkách, ktoré si detail vôbec nestiahol.
         *
         * Pri neznámych stavoch sa píše POČET, nikdy kód stavu (K10). Nuly sa
         * nevypisujú — riadok má hovoriť o tom, čo sa stalo, nie o ôsmich
         * kolónkach.
         */}
        {breakdownSilent ? null : (
          <div className="lvl-3" data-testid="detail-items-breakdown">
            {breakdown === null ? (
              'Rozpad položiek po stavoch sa nepodarilo prečítať — koľko z nich už dopadlo mimo štyroch dlaždíc vyššie, appka teraz nevie.'
            ) : (
              <>
                {otherStates.length === 0 ? null : (
                  <span data-testid="detail-items-other">
                    Mimo štyroch dlaždíc:{' '}
                    {otherStates
                      .map((s) => `${itemSentence(s.status).label} ${formatCountSk(s.count)}`)
                      .join(' · ')}
                    .{' '}
                  </span>
                )}
                {breakdown.unrecognized === 0 ? null : (
                  <span data-testid="detail-items-unknown">
                    {formatCountSk(breakdown.unrecognized)}{' '}
                    {pluralSk(breakdown.unrecognized, 'položka', 'položky', 'položiek')} je v stave,
                    ktorý appka nepozná — čo sa s nimi stalo, nevieme.{' '}
                  </span>
                )}
                {breakdown.total === campaign.itemsTotal ? null : (
                  <span data-testid="detail-items-mismatch">
                    Rozpad našiel {formatCountSk(breakdown.total)}{' '}
                    {pluralSk(breakdown.total, 'položku', 'položky', 'položiek')}, hlavička{' '}
                    {formatCountSk(campaign.itemsTotal)} — tie dve čísla sa rozišli.
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/*
         * ROZKLIK SO VŠETKÝMI PRODUKTMI ZĽAVY (D127 bod 1). Tabuľka nižšie
         * vypisuje len to, čo sa POKAZILO — na otázku „ktorých 21" neodpovedá
         * a odpovedať nemá. Rozklik je odpoveď na ňu a načíta sa až po otvorení.
         */}
        <CampaignProductsPane id={campaign.id} total={campaign.itemsTotal} />

        <div className="tbl-frame">
          <div className={styles.itemsScroll}>
            <ItemsTable rows={shown} fallbackPercent={campaign.percent} />
          </div>
          <div className="tbl-foot">
            <span>
              Vypisuje sa len to, čo sa nepodarilo alebo je podozrivé
              {problems.length > shown.length
                ? ` — z ${formatCountSk(problems.length)} takých riadkov je vidieť prvých ${formatCountSk(shown.length)}`
                : ''}
              {scanned < campaign.itemsTotal
                ? `, prezretých bolo prvých ${formatCountSk(scanned)} z ${formatCountSk(campaign.itemsTotal)}`
                : ''}
              .
            </span>
          </div>
        </div>

        <details className="tech" data-testid="detail-tech">
          <summary>Technický detail</summary>
          <div className="body mono">
            {shown.length === 0 ? (
              <div>zatiaľ žiadny problémový riadok</div>
            ) : (
              shown.map((item) => (
                <div key={`raw-${item.id}`}>
                  {item.productId} → {item.status}
                  {item.httpStatus === null ? '' : ` · ${item.httpStatus}`}
                  {item.errorCode === null ? '' : ` · ${item.errorCode}`}
                  {` · ${item.attemptCount}×`}
                  {item.finishedAt === null ? '' : ` · ${formatDateTimeSk(item.finishedAt)}`}
                </div>
              ))
            )}
          </div>
        </details>

        <details className="tech" data-testid="detail-audit">
          <summary>
            História zápisov — posledných {formatCountSk(Math.min(8, data.auditTrail.length))}{' '}
            {pluralSk(Math.min(8, data.auditTrail.length), 'záznam', 'záznamy', 'záznamov')}
          </summary>
          <div className="body">
            <table>
              <tbody>
                {data.auditTrail.slice(0, 8).map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTimeSk(row.ts)}</td>
                    <td>
                      <b>{row.message ?? row.eventType}</b>
                    </td>
                  </tr>
                ))}
                {data.auditTrail.length === 0 ? (
                  <tr>
                    <td>—</td>
                    <td>zatiaľ žiadny záznam</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <div style={{ marginTop: '6px' }}>
              <Link href="/nastavenia#historia">Celá história v Nastaveniach</Link>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}

export default DiscountDetail;
