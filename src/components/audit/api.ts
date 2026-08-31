'use client';

/**
 * Aura Zľavy — klientske typy a čítanie audit logu (A16, D18, D39c, I4).
 *
 * Audit je append-only: tento modul má výhradne GET volania, žiadna mutácia
 * neexistuje (I4). Snapshoty prichádzajú zo servera už redigované (I1) —
 * UI ich len zobrazí.
 *
 * ODPOVEĎ SERVERA SA ČÍTA, NIE PRETYPÚVA (od 24. 8. 2026)
 * ------------------------------------------------------
 * Do 24. 8. 2026 tu stálo `getJson<AuditPage>(…)` a `getJson<AuditDetail>(…)`.
 * `Envelope<T>` sa v `campaigns/api.ts` overuje len po obálku — `T` za behu
 * neexistuje, takže obsah `data` nikto nečítal. Na obrazovke Histórie to
 * znamenalo dve biele obrazovky namiesto hlásenia:
 *
 *  - `AuditPanel` robí `setPage(res.data)` a hneď `page.data.map(…)`. Keď
 *    `data.data` nebolo pole (alebo chýbalo), spadol render, nie čítanie.
 *  - `AuditDetailDrawer` číta `detail.ok === null` ako tri stavy. Keby prišlo
 *    čokoľvek iné než `true`/`false`/`null`, vypadla by tretia vetva a riadok
 *    by tvrdil „neúspešné" o udalosti, o ktorej appka nevie nič.
 *
 * Preto sa obsah overuje TU, v tom istom vzore ako `dashboard/api.ts`:
 * `getJson<unknown>()` a k tomu `parseX()` postavené z `dashboard/json.ts`.
 * Tie helpery majú jedno miesto zámerne — tretia kópia tých istých piatich
 * funkcií by sa rozišla s prvými dvomi a Historia by začala čítať voľnejšie
 * než Prehľad.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Nečitateľný RIADOK sa zahodí, nečitateľná STRÁNKA je chyba.** Riadok
 *     bez `id` alebo bez času sa nedá ani zobraziť, ani otvoriť — zostal by
 *     z neho prázdny pruh v tabuľke. Ale keď `data` nie je pole, appka o obsahu
 *     stránky nevie NIČ a musí to priznať vetou (`unreadable_body`), nie
 *     prázdnou tabuľkou, ktorá sa číta ako „nič sa nestalo". História je
 *     dôkazný záznam; „prázdno" a „neprečítal som to" sú dve rôzne tvrdenia.
 *  2. **`ok` je TRI stavy, nie dva.** `null` znamená „appka nevie, či to
 *     dopadlo" a `readTriState` je jediné, čo to od `false` odlíši. `readFlag`
 *     by z „neviem" urobil „neúspech" a audit by tvrdil viac, než prečítal.
 *  3. **`actor` je uzavretý zoznam.** Neznámu rolu appka nevypustí na povrch
 *     (K10) — `readCode` z nej urobí `null` a riadok padne na `'system'`,
 *     teda na „appka", nie na surový kód z databázy.
 *  4. **`eventType` je zámerne OTVORENÝ reťazec.** Nový kód udalosti zo servera
 *     sa nezahadzuje: `auditEventLabel()` mu dá vetu „iná udalosť appky" a čas
 *     s výsledkom zostanú čitateľné. Zahodiť riadok preto, že appka nepozná
 *     jeho meno, by z auditu urobil neúplný dôkaz.
 */
import { getJson, type Envelope } from '@/components/campaigns/api';
import {
  asRecord,
  readCode,
  readCount,
  readText,
  readTriState,
} from '@/components/dashboard/json';
import { NEVIEME, productLabel, type ProductLabel } from '@/lib/ui/product-label';

export interface AuditRow {
  id: number;
  ts: string;
  actor: 'user' | 'scheduler' | 'system';
  userId: number | null;
  eventType: string;
  ok: boolean | null;
  campaignId: number | null;
  campaignItemId: number | null;
  productId: number | null;
  /**
   * Kód produktu DOPLNENÝ K ZOBRAZENIU (D116). Audit sa NEPREPISUJE (I4) —
   * referencia sa k riadku pripája JOIN-om pri čítaní, takže `null` znamená
   * „appka ju nepozná" (produkt nie je obohatený, D118 — alebo ju server
   * k riadku neposlal), nikdy „produkt referenciu nemá".
   *
   * Pole je VOLITEĽNÉ zámerne: doplnenie je vlastnosť zobrazenia, nie riadku
   * histórie, a riadok bez neho je úplne platný záznam.
   */
  reference?: string | null;
  /** Názov produktu z toho istého doplnenia; `null` = nevieme. */
  productName?: string | null;
  operationId: string | null;
  requestId: string | null;
  httpStatus: number | null;
  message: string | null;
}

export interface AuditDetail extends AuditRow {
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  /** D39c — „rozhodoval si nad inou cenou". */
  priceMismatch: boolean;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditPage {
  data: AuditRow[];
  page: number;
  perPage: number;
  total: number;
}

/** Stav filtrov `/audit` (D18) — produkt, dátum, typ operácie, výsledok. */
export interface AuditFilterState {
  productId: string;
  campaignId: string;
  eventType: string;
  from: string;
  to: string;
  /** `''` = všetko, `'true'` = úspešné, `'false'` = neúspešné. */
  ok: '' | 'true' | 'false';
  page: number;
  perPage: number;
}

export const EMPTY_FILTERS: AuditFilterState = {
  productId: '',
  campaignId: '',
  eventType: '',
  from: '',
  to: '',
  ok: '',
  page: 1,
  perPage: 25,
};

/**
 * Vnútorný kód udalosti → veta, ktorú používateľ prečíta bez slovníka.
 *
 * Toto je JEDINÉ miesto, kde sa kódy histórie prekladajú. Tabuľka aj výber
 * v filtri z neho čerpajú, takže sa nemôžu rozísť — a keď pribudne nový kód,
 * `auditEventLabel()` ho nikdy nevypustí na povrch surový.
 */
export const AUDIT_EVENT_LABELS: Readonly<Record<string, string>> = {
  write_attempt: 'pokus o zlacnenie produktu',
  write_ok: 'produkt zlacnený',
  write_failed: 'produkt sa nepodarilo zlacniť',
  write_uncertain: 'nevieme, či sa produkt zlacnil',
  write_skipped: 'zlacnenie preskočené, už tam bolo',
  campaign_created: 'zľava vytvorená',
  campaign_confirmed: 'zľava potvrdená',
  campaign_cancelled: 'zľava zrušená',
  campaign_needs_key: 'zľava čaká na kľúč',
  campaign_missed: 'zľava zmeškala svoj štart',
  campaign_finished: 'zľava dopísaná',
  allowlist_added: 'pridané medzi povolené produkty',
  allowlist_removed: 'odobrané z povolených produktov',
  allowlist_marked_unknown: 'stav produktu označený za neznámy',
  scope_mode_changed: 'zmena rozsahu zliav',
  catalog_refreshed: 'načítaný katalóg',
  key_stored: 'vložený kľúč',
  key_wiped: 'zmazaný kľúč',
  key_panic_wipe: 'kľúče zmazané po úniku',
  domain_changed: 'zmena adresy eshopu',
  canary_ok: 'skúška spojenia prešla',
  canary_fail: 'skúška spojenia neprešla',
  writes_locked: 'zápisy zastavené',
  writes_unlocked: 'zápisy odomknuté',
  /*
   * Presety (D112). Vety hovoria o PRESETE, nie o zľave — preset len predplní
   * formulár a v eshope sa ním nič nezmenilo. Použitie presetu sa v Histórii
   * nezobrazuje, pretože sa neauditovalo (zdôvodnenie v `lib/audit/events.ts`);
   * kedy bol naposledy použitý, stojí v panele presetov.
   */
  preset_created: 'preset uložený',
  preset_deleted: 'preset zmazaný',
  /*
   * Vety k HISTORICKÝM udalostiam. Appka ich od 27. 8. 2026 nezapisuje (D99,
   * D100), ale staršie riadky auditu ich nesú a `audit_log` sa nemení (D101).
   * Bez týchto prekladov by o nich História povedala len „iná udalosť appky",
   * čiže by sa vlastná minulosť appky prestala dať prečítať — a „nevieme" je
   * horšie než odpoveď (I11). Nemazať.
   */
  login_ok: 'prihlásenie',
  login_fail: 'neúspešné prihlásenie',
  lockout: 'účet dočasne uzamknutý',
  /* HISTORICKÉ — appka ich už nezapisuje (D100, 27. 8. 2026); pozri
     src/lib/audit/events.ts. Dátum je v menovke zámerne: bez neho by
     používateľ čítal o hesle, ktoré appka dnes nikde nepýta. */
  sudo_ok: 'potvrdenie heslom (do 27. 8. 2026)',
  sudo_fail: 'neúspešné potvrdenie heslom (do 27. 8. 2026)',
};

/**
 * Pomenovanie produktu pre riadok histórie (D116).
 *
 * `null` znamená „tento riadok nie je o konkrétnom produkte" (napr. rotácia
 * kľúča) ALEBO „appka o ňom nevie ani referenciu, ani názov". V druhom prípade
 * by na povrchu stálo len `#id`, teda slepé číslo, ktoré D116 z povrchu práve
 * sťahuje — patrí do rozkliku Technický detail, kde `productId` stojí ďalej.
 */
export function auditProductLabel(row: AuditRow): ProductLabel | null {
  if (row.productId === null) return null;
  const label = productLabel({
    productId: row.productId,
    reference: row.reference ?? null,
    name: row.productName ?? null,
  });
  return label.referenceUnknown && label.name === NEVIEME ? null : label;
}

/** Kód udalosti → veta. Neznámy kód sa NIKDY nezobrazí surový. */
export function auditEventLabel(eventType: string): string {
  const known = Object.prototype.hasOwnProperty.call(AUDIT_EVENT_LABELS, eventType)
    ? AUDIT_EVENT_LABELS[eventType]
    : undefined;
  return known ?? 'iná udalosť appky';
}

/** Kto to urobil — na povrchu jedno slovo, nie názov vnútornej role. */
export const AUDIT_ACTOR_LABELS: Readonly<Record<AuditRow['actor'], string>> = {
  user: 'človek',
  scheduler: 'appka',
  system: 'appka',
};

/** Možnosti výberu v filtri histórie; prázdna hodnota = bez obmedzenia. */
export const AUDIT_EVENT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'všetko' },
  ...Object.keys(AUDIT_EVENT_LABELS).map((value) => ({
    value,
    label: auditEventLabel(value),
  })),
];

/** Filtre → query string (prázdne polia sa vynechávajú). */
export function toQuery(f: AuditFilterState): string {
  const q = new URLSearchParams();
  if (/^\d+$/.test(f.productId.trim())) q.set('productId', f.productId.trim());
  if (/^\d+$/.test(f.campaignId.trim())) q.set('campaignId', f.campaignId.trim());
  if (f.eventType !== '') q.set('eventType', f.eventType);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from)) q.set('from', f.from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to)) q.set('to', f.to);
  if (f.ok !== '') q.set('ok', f.ok);
  q.set('page', String(f.page));
  q.set('perPage', String(f.perPage));
  return q.toString();
}

/* ── čítanie odpovede servera ──────────────────────────────────────────── */

/** Roly, ktoré appka pozná. Čokoľvek iné je `null` a padá na `'system'`. */
const ACTORS: readonly AuditRow['actor'][] = ['user', 'scheduler', 'system'];

/**
 * Jeden riadok histórie, alebo `null`, keď sa nedá ani zobraziť.
 *
 * Hranica je `id` a `ts`: bez identity sa riadok nedá otvoriť do detailu a bez
 * času sa nedá zaradiť. Všetko ostatné je nullable UŽ V TYPE, takže nečitateľné
 * pole je `null` — teda „appka to neprečítala", nie nula a nie prázdny reťazec.
 */
export function parseAuditRow(raw: unknown): AuditRow | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = readCount(record, 'id');
  const ts = readText(record, 'ts');
  if (id === null || ts === null) return null;
  return {
    id,
    ts,
    actor: readCode(record, 'actor', ACTORS) ?? 'system',
    userId: readCount(record, 'userId'),
    // Otvorený reťazec zámerne (bod 4 hlavičky) — vetu mu dá `auditEventLabel`.
    eventType: readText(record, 'eventType') ?? '',
    ok: readTriState(record, 'ok'),
    campaignId: readCount(record, 'campaignId'),
    campaignItemId: readCount(record, 'campaignItemId'),
    productId: readCount(record, 'productId'),
    /*
     * Doplnenie z JOIN-u sa číta TOLERANTNE: server ho môže poslať pod
     * `reference`/`productName` alebo pod `productReference`/`name`, a keď ho
     * neposiela vôbec, zostáva `null`. Chýbajúce doplnenie NIE JE chyba riadku
     * — história je dôkazný záznam a musí sa zobraziť aj bez pomenovania.
     */
    reference: readText(record, 'reference') ?? readText(record, 'productReference'),
    productName: readText(record, 'productName') ?? readText(record, 'name'),
    operationId: readText(record, 'operationId'),
    requestId: readText(record, 'requestId'),
    httpStatus: readCount(record, 'httpStatus'),
    message: readText(record, 'message'),
  };
}

/**
 * Stránka histórie, alebo `null`, keď o jej obsahu appka nevie nič.
 *
 * `page`/`perPage`/`total` padajú na hodnoty, ktoré sa dajú prečítať z toho, čo
 * naozaj prišlo — `total` na počet prečítaných riadkov, nie na nulu: nula by
 * z tabuľky, ktorá riadky MÁ, urobila vetu „história je prázdna".
 */
export function parseAuditPage(raw: unknown, fallbackPerPage: number): AuditPage | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const rows = record['data'];
  if (!Array.isArray(rows)) return null;
  const data = rows.map(parseAuditRow).filter((row): row is AuditRow => row !== null);
  return {
    data,
    page: readCount(record, 'page') ?? 1,
    perPage: readCount(record, 'perPage') ?? fallbackPerPage,
    total: readCount(record, 'total') ?? data.length,
  };
}

/** Detail jednej udalosti. Snapshoty ostávajú `unknown` — kreslí ich drawer. */
export function parseAuditDetail(raw: unknown): AuditDetail | null {
  const row = parseAuditRow(raw);
  if (row === null) return null;
  const record = asRecord(raw);
  if (record === null) return null;
  return {
    ...row,
    beforeSnapshot: record['beforeSnapshot'],
    afterSnapshot: record['afterSnapshot'],
    priceMismatch: record['priceMismatch'] === true,
    ip: readText(record, 'ip'),
    userAgent: readText(record, 'userAgent'),
  };
}

/**
 * Chybová obálka pre telo, ktoré prišlo, ale nedá sa prečítať.
 *
 * Zámerne NIE prázdna stránka (bod 1 hlavičky): „neprečítal som to" a „nič sa
 * nestalo" sú v dôkaznom zázname dve rôzne tvrdenia.
 */
const unreadable = <T,>(): Envelope<T> => ({
  ok: false,
  error: {
    code: 'unreadable_body',
    message: 'Históriu sa nepodarilo prečítať. Skúste obrazovku obnoviť.',
  },
});

export async function getAudit(f: AuditFilterState): Promise<Envelope<AuditPage>> {
  const res = await getJson<unknown>(`/api/audit?${toQuery(f)}`);
  if (!res.ok) return res;
  const page = parseAuditPage(res.data, f.perPage);
  return page === null ? unreadable<AuditPage>() : { ok: true, data: page };
}

export async function getAuditDetail(id: number): Promise<Envelope<AuditDetail>> {
  const res = await getJson<unknown>(`/api/audit/${id}`);
  if (!res.ok) return res;
  const detail = parseAuditDetail(res.data);
  return detail === null ? unreadable<AuditDetail>() : { ok: true, data: detail };
}
