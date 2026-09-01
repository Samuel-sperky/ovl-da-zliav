'use client';

/**
 * Aura Zľavy — HISTÓRIA ZĽIAV JEDNÉHO PRODUKTU (D127 bod 3, smer „produkt → zľavy").
 *
 * Odpoveď na otázku „kedy sme toto už zlacnili?". Číta VÝHRADNE
 * `GET /api/insights/product/[productId]/campaigns`, teda lokálnu DB —
 * na render ceste sa shop nevolá (K8) a nič sa tu nezapisuje.
 *
 * PREČO TO NIE JE TO ISTÉ, ČO „VŠETKY NAŠE ZÁPISY" V PANELI
 * ─────────────────────────────────────────────────────────
 * Rozklik „Všetky naše zápisy" kreslí `productWrites()`, a ten ZAHADZUJE
 * položky so stavom `pending` — je to log DOKONČENÝCH pokusov o zápis.
 * História je iná otázka: zľava naplánovaná na zajtra je platná odpoveď na
 * „bol tento produkt v zľave", nie medzera. Preto tu ide
 * `campaignItemsRepo.historyForProduct()`, ktorý vracia VŠETKY stavy, a preto
 * tu navyše stojí MENO zľavy a cena pred/po — dva údaje, ktoré ten log nemá.
 * Rozdiel je napísaný aj na obrazovke (`HISTORY_SCOPE_NOTE`): dva zoznamy
 * percent pod sebou by sa inak čítali ako ten istý zoznam dvakrát.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 * 1. **Prázdna história NIE JE chyba.** „Tento produkt sme ešte nezlacňovali"
 *    je ODPOVEĎ a vyzerá ako odpoveď — obyčajná veta, žiadny výstražný tón,
 *    žiadna pomlčka predstierajúca poruchu. Chyba načítania je NIEČO INÉ a má
 *    vlastnú vetu; keby sa zliali, výpadok siete by tvrdil, že produkt nikdy
 *    v zľave nebol.
 * 2. **Stav zápisu je stav NÁŠHO zápisu, nie stav eshopu** (I11). Vetu skladá
 *    `itemSentence()` — jediný slovník stavov položiek v appke — takže neznámy
 *    kód nikdy neprebliká surový a „zlacnené" nikdy neznamená „v shope beží
 *    zľava". To, že appka vidí len vlastné zápisy, hovorí pätka sekcie.
 * 3. **Cena po zľave je ORIENTAČNÁ a hovorí sa to raz, nie pri každom riadku.**
 *    Počíta ju server (`discountedPrice()`, D4); tu sa NEPREPOČÍTAVA. Keď cenu
 *    pred zľavou nepoznáme, je to pomlčka — nikdy dopočítaná z dnešného
 *    cenníka, lebo to by bola cena, ktorá vtedy neplatila.
 * 4. **Orezaný chvost sa priznáva.** `truncated` znamená, že starších zliav
 *    môže byť viac; ticho orezaný zoznam je zapísaná pasca tohto repa.
 * 5. **Žiadne `<dt>`.** Riadky sú `<div>`, a to je meranie, nie estetika:
 *    `panel-fakty-dvakrat.spec.ts` stráži, že sa žiadna MENOVKA v paneli
 *    neopakuje, a `produkty-detail-rozklik.spec.ts` počíta `<dt>` na povrchu
 *    ako rozpočet výšky. Zoznam zliav nie je dvojstĺpcová tabuľka údajov.
 *
 * Wire, model aj vykreslenie sú v jednom module zámerne: sú to tri pohľady na
 * jednu odpoveď jedného endpointu a keby bývali v troch súboroch, prvá zmena
 * tvaru by ich rozišla. Model (`historyRows`, `historyHint`) je čistý a dá sa
 * merať bez prehliadača — efekty v `renderToStaticMarkup` nebežia, takže cez
 * panel by sa dala odmerať jediná vetva, tá načítavacia.
 *
 * NAČÍTAVA PANEL, NIE TENTO MODUL, a je to z jedného dôvodu: nadpis zavretej
 * skupiny nesie POČET zliav (`historyHint`) a ten sa počíta z tej istej
 * odpovede, ktorú kreslí zoznam. Keby si odpoveď držal tento modul, panel by
 * musel počet uhádnuť — a uhádnutý počet v nadpise je presne to, čo
 * `produkty-detail-rozklik.spec.ts` zakazuje. Panel tak drží históriu rovnako,
 * ako drží zápisy, KPI aj krivku.
 *
 * Vlastník: V5 vlna 3 (Zľavy), D127 bod 3.
 */
import { asRecord, readCount, readFlag, readNumber, readText } from '@/components/dashboard/json';
import { FlagMark } from '@/components/ui/StatusMark';
import { formatDateSk, formatEur, formatPercentSk } from '@/lib/ui/format';
import { formatCountSk, itemSentence, pluralSk, type FlagTone } from '@/lib/ui/vocabulary';

/* ═══════════════════ 1. Odpoveď servera, prečítaná a overená ══════════════ */

/** Pomlčka namiesto čísla — appka o tomto údaji nič netvrdí. */
const DASH = '—';

export interface ProductCampaignRowWire {
  readonly itemId: number;
  readonly campaignId: number;
  readonly campaignName: string | null;
  /** Percento pásma NA POLOŽKE — to, ktoré sa naozaj zapisovalo. */
  readonly percent: number | null;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  /** Stav ZÁPISU na tomto produkte, nie stav celej zľavy. */
  readonly itemStatus: string;
  /** Náš úspešný zápis, ktorého okno pokrýva dnešok. NIE stav eshopu. */
  readonly ownWriteCoversToday: boolean;
  readonly priceBefore: string | null;
  /** Cena po zľave tak, ako ju spočítal server (D4). Tu sa nepočíta. */
  readonly priceAfter: string | null;
}

export interface ProductCampaignsWire {
  readonly productId: number;
  readonly today: string | null;
  /** `true` = strop histórie sa dosiahol a starších zliav môže byť viac. */
  readonly truncated: boolean;
  readonly rows: readonly ProductCampaignRowWire[];
}

/**
 * Jeden riadok histórie. Bez `itemId` a `campaignId` sa riadok nedá priradiť
 * k zľave, takže sa zahodí; `itemStatus` ide ďalej surový — vetu z neho skladá
 * `itemSentence()` a ten si s neznámym kódom poradí sám.
 */
function parseRow(raw: unknown): ProductCampaignRowWire | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const itemId = readCount(record, 'itemId');
  const campaignId = readCount(record, 'campaignId');
  if (itemId === null || campaignId === null) return null;
  return {
    itemId,
    campaignId,
    campaignName: readText(record, 'campaignName'),
    percent: readNumber(record, 'percent'),
    dateFrom: readText(record, 'dateFrom'),
    dateTo: readText(record, 'dateTo'),
    itemStatus: readText(record, 'itemStatus') ?? '',
    ownWriteCoversToday: readFlag(record, 'ownWriteCoversToday'),
    priceBefore: readText(record, 'priceBefore'),
    priceAfter: readText(record, 'priceAfter'),
  };
}

/**
 * Telo odpovede → overený pohľad, alebo `null`.
 *
 * PRÁZDNY ZOZNAM JE ODPOVEĎ, NEČITATEĽNÉ TELO NIE JE. Preto sa `rows` musí
 * naozaj vrátiť ako pole: keby chýbalo, `[]` by z výpadku spravilo tvrdenie
 * „tento produkt nikdy v zľave nebol" (I11, P7).
 */
export function parseProductCampaigns(raw: unknown): ProductCampaignsWire | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const productId = readCount(record, 'productId');
  const rows = record['rows'];
  if (productId === null || !Array.isArray(rows)) return null;
  return {
    productId,
    today: readText(record, 'today'),
    truncated: readFlag(record, 'truncated'),
    rows: rows
      .map((row: unknown) => parseRow(row))
      .filter((row): row is ProductCampaignRowWire => row !== null),
  };
}

/* ═══════════════════════════ 2. Volanie ═══════════════════════════════════ */

export interface HistoryErrorView {
  readonly code: string;
  readonly message: string;
}

export type HistoryResult =
  | { ok: true; data: ProductCampaignsWire }
  | { ok: false; error: HistoryErrorView };

const UNREADABLE: HistoryErrorView = {
  code: 'shape',
  message: 'Server odpovedal inak, než sme čakali.',
};
const OFFLINE: HistoryErrorView = { code: 'network', message: 'Server neodpovedá.' };
const ABORTED: HistoryErrorView = { code: 'aborted', message: '' };

/** Zrušený dotaz nie je chyba — používateľ len rýchlo klikol na iný riadok. */
export const isHistoryAborted = (error: HistoryErrorView): boolean => error.code === 'aborted';

/**
 * História zliav jedného produktu.
 *
 * Telo sa NEPRETYPOVÁVA: `parseProductCampaigns()` ho prečíta, a keď sa
 * prečítať nedá, je to CHYBA, nie prázdna história.
 */
export async function fetchProductCampaigns(
  productId: number,
  signal?: AbortSignal,
): Promise<HistoryResult> {
  let body: unknown;
  try {
    const res = await fetch(
      `/api/insights/product/${encodeURIComponent(String(productId))}/campaigns`,
      { headers: { Accept: 'application/json' }, signal },
    );
    try {
      body = (await res.json()) as unknown;
    } catch {
      body = undefined;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: ABORTED };
    }
    return { ok: false, error: OFFLINE };
  }

  const envelope = asRecord(body);
  if (envelope === null || envelope['ok'] !== true) {
    const failure = asRecord(envelope?.['error']);
    return {
      ok: false,
      error: {
        code: failure === null ? UNREADABLE.code : (readText(failure, 'code') ?? UNREADABLE.code),
        message:
          failure === null
            ? UNREADABLE.message
            : (readText(failure, 'message') ?? UNREADABLE.message),
      },
    };
  }

  const data = parseProductCampaigns(envelope['data']);
  return data === null ? { ok: false, error: UNREADABLE } : { ok: true, data };
}

/* ═══════════════════════════ 3. Model riadku ══════════════════════════════ */

/** Výhrada, ktorá k cenám PATRÍ — hovorí sa raz, nie pri každom riadku (D4). */
export const HISTORY_PRICE_NOTE =
  'Cena po zľave je orientačná — počíta sa z ceny, ktorú appka v tej chvíli videla.';

/** Prečo je tento zoznam iný než rozklik „Všetky naše zápisy" nad ním. */
export const HISTORY_SCOPE_NOTE =
  'Aj zľavy, ktoré sa ešte nezapisovali — preto ich tu môže byť viac než dokončených zápisov.';

/**
 * Appka vidí VLASTNÉ zápisy, nie stav eshopu (I11).
 *
 * Vetu „Appka vidí len to, čo sama zapísala" hovorí skupina „Zľavy podľa
 * vlastných zápisov" o 30 px vyššie; zopakovať ju doslova by bol ten istý
 * fakt v paneli dvakrát. Táto je o výhrade, ktorú pridáva PRÁVE táto sekcia —
 * o značke „platí dnes" na riadku.
 */
export const HISTORY_OWN_WRITES_NOTE =
  'Že zľava platí dnes, hovorí náš zápis — nie stav eshopu.';

/** Prázdna história je odpoveď, nie chyba. */
export const HISTORY_EMPTY_TEXT = 'Tento produkt sme ešte do žiadnej zľavy nezaradili.';

/** Načítanie zlyhalo — a to sa NESMIE čítať ako prázdna história. */
export const HISTORY_FAILED_TEXT = 'Históriu zliav sa nepodarilo načítať.';

export interface HistoryRowView {
  readonly key: string;
  readonly campaignId: number;
  /** Meno zľavy; bez neho aspoň jej číslo, nikdy prázdno. */
  readonly name: string;
  /** `−20 %`, alebo pomlčka, keď percento neprišlo. */
  readonly percentText: string;
  /** `12. 5. 2026 – 26. 5. 2026` — kedy zľava platila. */
  readonly windowText: string;
  /** Veta o stave NÁŠHO zápisu (`itemSentence`). */
  readonly statusLabel: string;
  /** Tón z `itemSentence()`, vrátane `critical` — slovník ho tu neoreže. */
  readonly statusTone: FlagTone;
  /** `true` = náš úspešný zápis pokrýva dnešok. NIE tvrdenie o eshope. */
  readonly runningNow: boolean;
  /** `12,90 € → 10,32 €`, alebo pomlčka, keď cenu pred zľavou nepoznáme. */
  readonly priceText: string;
}

/**
 * Riadky histórie tak, ako sa vypíšu. Nič sa tu nedopočítava — percento aj
 * obe ceny prichádzajú zo servera a tu sa iba formátujú.
 */
export function historyRows(view: ProductCampaignsWire | null): readonly HistoryRowView[] {
  if (view === null) return [];
  return view.rows.map((row) => {
    const sentence = itemSentence(row.itemStatus);
    /* Cena po zľave bez ceny pred ňou je bezvýznamná — a dopočítať tú prvú
       z dnešného cenníka by bola cena, ktorá vtedy neplatila. */
    const priceText =
      row.priceBefore === null || row.priceAfter === null
        ? DASH
        : `${formatEur(row.priceBefore)} → ${formatEur(row.priceAfter)}`;
    return {
      key: `${row.itemId}`,
      campaignId: row.campaignId,
      name: row.campaignName ?? `Zľava č. ${row.campaignId}`,
      percentText: row.percent === null ? DASH : formatPercentSk(row.percent),
      windowText: `${formatDateSk(row.dateFrom)} – ${formatDateSk(row.dateTo)}`,
      statusLabel: sentence.label,
      statusTone: sentence.tone,
      runningNow: row.ownWriteCoversToday,
      priceText,
    };
  });
}

/**
 * Čo je v zavretej skupine histórie.
 *
 * ŠTYRI STAVY, ŠTYRI RÔZNE VETY — a to je celý dôvod, prečo je to funkcia
 * a nie `view?.rows.length ?? 0`. Nula v nadpise by pri nenačítanom zozname
 * bola tvrdenie, ktoré appka nemá čím kryť, a pri zlyhaní by z výpadku spravila
 * odpoveď „nikdy nebol v zľave".
 */
export function historyHint(view: ProductCampaignsWire | null, failed: boolean): string {
  if (failed) return 'nepodarilo sa načítať';
  if (view === null) return 'zatiaľ nenačítané';
  const count = view.rows.length;
  if (count === 0) return 'zatiaľ v žiadnej';
  const text = `${formatCountSk(count)} ${pluralSk(count, 'zľava', 'zľavy', 'zliav')}`;
  return view.truncated ? `${text} · najnovšie` : text;
}

/* ═══════════════════════════ 4. Vykreslenie ═══════════════════════════════ */

/** Jeden riadok histórie. Dva riadky textu, nie tabuľka — pozri bod 5 hlavičky. */
function HistoryRow({ row }: { row: HistoryRowView }) {
  return (
    <div
      style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: '13px' }}
      data-testid="history-row"
      data-campaign={row.campaignId}
    >
      <div className="row" style={{ alignItems: 'baseline', gap: '10px' }}>
        <b style={{ fontWeight: 640, color: 'var(--ink)', minWidth: '52px' }}>{row.percentText}</b>
        <span style={{ color: 'var(--ink2)' }}>{row.name}</span>
        {row.runningNow ? (
          <span className="flag neutral" data-testid="history-running">
            <FlagMark tone="neutral" />
            platí dnes podľa nášho zápisu
          </span>
        ) : null}
      </div>
      <div className="row" style={{ alignItems: 'baseline', gap: '10px' }}>
        <span className="lvl-3">{row.windowText}</span>
        <span className="lvl-3">{row.priceText}</span>
        <span
          className={row.statusTone === 'good' || row.statusTone === 'neutral' ? 'flag neutral' : 'flag'}
          style={{ marginLeft: 'auto' }}
          data-testid="history-status"
          data-tone={row.statusTone}
        >
          <FlagMark tone={row.statusTone} />
          {row.statusLabel}
        </span>
      </div>
    </div>
  );
}

export interface DiscountHistoryListProps {
  /** Načítaná história; `null` = ešte sa načítava. */
  view: ProductCampaignsWire | null;
  /** Načítanie zlyhalo — vtedy sa NEPREDSTIERA prázdna história. */
  failed: boolean;
}

/**
 * Zoznam bez načítania — všetko, čo sa naozaj vykreslí.
 *
 * Oddelené od `ProductDiscountHistory` zámerne: `renderToStaticMarkup` efekty
 * nespúšťa, takže cez panel by sa dala odmerať jediná vetva (načítavanie).
 * Nad touto funkciou sa dá vykresliť KTORÝKOĽVEK zo štyroch stavov bez
 * prehliadača a bez siete.
 */
export function DiscountHistoryList({ view, failed }: DiscountHistoryListProps) {
  const rows = historyRows(view);

  return (
    <div data-testid="product-discount-history">
      {failed ? (
        /* Chyba NIE JE prázdna história — dve rôzne veci, dve rôzne vety. */
        <div className="lvl-3" data-testid="history-failed">
          {HISTORY_FAILED_TEXT}
        </div>
      ) : view === null ? (
        <div className="lvl-3" data-testid="history-loading">
          Načítavam…
        </div>
      ) : rows.length === 0 ? (
        /*
         * ODPOVEĎ, NIE PORUCHA. Obyčajná veta v tom istom tlmenom tóne ako
         * ostatné poznámky panela — žiadna výstraha, žiadna pomlčka, nič, čo
         * by sa dalo prečítať ako „niečo sa pokazilo".
         */
        <div className="lvl-3" data-testid="history-empty">
          {HISTORY_EMPTY_TEXT}
        </div>
      ) : (
        <>
          <div>
            {rows.map((row) => (
              <HistoryRow key={row.key} row={row} />
            ))}
          </div>
          {view.truncated ? (
            <div className="lvl-3" style={{ marginTop: '6px' }} data-testid="history-truncated">
              Starších zliav môže byť viac — zoznam je zastavený na najnovších.
            </div>
          ) : null}
          <div className="lvl-3" style={{ marginTop: '6px' }} data-testid="history-price-note">
            {HISTORY_PRICE_NOTE}
          </div>
        </>
      )}

      {/* Platí pre všetky štyri stavy: aj prázdna história je len o NAŠICH
          zápisoch, nie o tom, čo v eshope naozaj bežalo. */}
      <div className="lvl-3" style={{ marginTop: '6px' }} data-testid="history-scope">
        {HISTORY_SCOPE_NOTE} {HISTORY_OWN_WRITES_NOTE}
      </div>
    </div>
  );
}

export default DiscountHistoryList;
