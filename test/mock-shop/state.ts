/**
 * Aura Zľavy — PROGRAMOVATEĽNÝ STAV MOCK SHOPU (BUILD-SPEC §12, INVARIANT I6).
 *
 * Tento modul nesie *všetko*, čo mock shop vie o svete, a všetky scenáre, ktoré
 * z neho vieme vynútiť. Server (`server.ts`) je len HTTP obálka nad ním —
 * nemá vlastnú pamäť a nerozhoduje o scenároch.
 *
 * Prečo je stav samostatný modul:
 *   - test si vie scenár zapnúť **po** starte servera (`state.rateLimit(30)`),
 *   - `recordedRequests[]` je jediný zdroj pravdy pre overenie invariantov
 *     I1 (redakcia kľúča — hlavičky sú zaznamenané tak, ako prišli)
 *     a I10 (sekvenčné tempo 250 ms — každý záznam má `at`/`startedAt`),
 *   - scenáre sú deklaratívne a resetovateľné (`reset()` medzi testami).
 *
 * Vlastník: A6. Iné úlohy tento súbor NEEDITUJÚ, len ho používajú.
 */

/* ═══════════════════════════ 1. Katalóg a kľúče ════════════════════════════ */

/** Atribút produktu — tvar podľa `docs/api/sperky-api.md`. */
export interface MockProductAttribute {
  id_product_attribute: number;
  price_impact: number;
  reference: string;
  ean13: string;
  quantity: number;
  is_default: boolean;
  values: string[];
}

/**
 * Produkt v mock katalógu. Zľavu si mock pamätá (`lastReduction`), ale
 * **nikdy ju nevracia** v odpovediach — presne ako reálny shop (backlog B1,
 * invariant I11). Testy k nej pristupujú priamo cez stav, nie cez API.
 */
export interface MockProduct {
  id: number;
  name: string;
  price: number;
  has_attributes: boolean;
  description?: string;
  description_short?: string;
  attributes?: MockProductAttribute[];
  /** Posledný úspešný `setReduction` — len pre asserty v testoch. */
  lastReduction?: { reduction: number; from: string; to: string; at: number } | null;
  /**
   * SKUTOČNÝ stav zľavy v shope, nastaviteľný NEZÁVISLE od zápisov appky
   * (31. 8. 2026).
   *
   * Prečo to nestačilo mať v `lastReduction`: `getFull` z neho odvádzal stav
   * zľavy, takže shop odpovedal presne to, čo appka predtým zapísala. Proti
   * takému mocku `GET /api/catalog/reduction-check` nemôže NIKDY nájsť rozdiel
   * — a nájsť rozdiel je jeho jediná úloha.
   *
   * `undefined` = shop zrkadlí zápisy appky (pôvodné správanie).
   * `null` = shop tvrdí „žiadna zľava nebeží", aj keď appka zapísala.
   * objekt = shop tvrdí TÚTO zľavu (ruka v admine, flash sale, iné percento).
   */
  shopReduction?: { reduction: number; from: string; to: string } | null | undefined;
}

/** Scope-y podľa `docs/api/sperky-api.md`. Appka smie mať výhradne `product:edit` (I8). */
export type MockScope = 'product:edit' | 'orders:read';

export interface MockApiKey {
  key: string;
  scopes: MockScope[];
}

/* ═══════════════════════════ 2. Druhy zlyhaní ══════════════════════════════ */

/**
 * Druh vynúteného zlyhania. Názvy zodpovedajú tvarom z API dokumentácie,
 * nie taxonómii klienta (`ShopErrorKind`) — mock je HTTP server, nie klient.
 */
export type MockFailureKind =
  | 'rate_limited' // 429 + Retry-After, tvar {error}
  | 'server_error' // 500 {error:"request_failed"}
  | 'unauthorized' // 401 {error:"unauthorized"}
  | 'forbidden' // 403 {error:"forbidden"}
  | 'ip_banned' // 403 {error:"ip_banned"} — odmietnutá ADRESA, nie kľúč (X1)
  | 'invalid_input' // 400 {error:"invalid_input"}
  | 'not_found' // 404 {ok:false,errors:["not found"]}
  | 'invalid_dates' // 400 {ok:false,errors:["invalid_dates"]}
  | 'invalid_reduction' // 400 {ok:false,errors:["invalid_reduction"]}
  | 'range_too_long' // 400 {ok:false,errors:["range_too_long"]}
  | 'garbage' // 200 s nesmyselným tvarom (schema drift, D54)
  | 'hang'; // požiadavka sa prijme a odpoveď NIKDY nepríde (D45)

/** Na ktoré požiadavky sa scenár vzťahuje. */
export type MockTarget = 'any' | 'read' | 'write';

export interface FailNthConfig {
  /** 1-based poradie požiadavky, ktorá má zlyhať (v rámci `target`). */
  n: number;
  kind: MockFailureKind;
  target: MockTarget;
  /** `Retry-After` v sekundách — použije sa len pri `rate_limited`. */
  retryAfterSeconds?: number;
  /** Koľkokrát sa má scenár uplatniť (default 1 — presne n-tá požiadavka). */
  times: number;
}

/* ═══════════════════════════ 3. Záznam požiadavky ═══════════════════════════ */

/** Jedna položka dávky, tak ako ju mock rozparsoval. */
export interface RecordedBatchItem {
  controller: string | null;
  action: string | null;
  method: string;
  data: Record<string, unknown>;
}

/**
 * Zaznamenaná požiadavka. `headers` sú UMYSELNE surové (vrátane `x-api-key`) —
 * bez nich by sa nedal overiť invariant I1: test musí vedieť, že kľúč do shopu
 * odišiel, a zároveň že sa NIKDE inde (log, audit, odpoveď appky) nevyskytol.
 */
export interface RecordedRequest {
  /** Poradie od štartu / posledného `reset()`, 1-based. */
  seq: number;
  method: string;
  /** Cesta bez query stringu, napr. `/api/products/setReduction`. */
  path: string;
  /** Celé `req.url` vrátane query. */
  url: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** Kľúč z `X-Api-Key` alebo `Authorization: Bearer` — `null` keď neprišiel. */
  apiKey: string | null;
  /** Surové telo požiadavky. */
  rawBody: string;
  /** Rozparsované telo (JSON aj `application/x-www-form-urlencoded`). */
  body: Record<string, unknown>;
  /** Rozparsované položky dávky — len pre `POST /api/batch`. */
  batchItems?: RecordedBatchItem[];
  /** `Date.now()` v momente, keď mock telo dočítal (tempo zápisov, I10). */
  at: number;
  /** `performance.now()` — monotónny čas na presné meranie odstupov. */
  atMonotonic: number;
  atIso: string;
  /** Je to zápisové volanie (`setReduction`)? Sonda kľúča tiež (D53). */
  isWrite: boolean;
  /** Vyplní sa až pri odoslaní odpovede; pri `hang` zostane `undefined`. */
  responseStatus?: number;
  responseBody?: unknown;
  /** Trvanie obsluhy v ms (vrátane `delay`). */
  durationMs?: number;
}

/* ═══════════════════════════ 4. Stav mock shopu ═════════════════════════════ */

/** Kľúč, ktorý mock považuje za platný. Nie je to reálny kľúč (I1). */
export const DEFAULT_MOCK_API_KEY = 'fake-shop-key-0001';

export interface MockShopStateOptions {
  products?: MockProduct[];
  keys?: MockApiKey[];
  /** Default `per_page` paginátora shopu. */
  defaultPerPage?: number;
  /** Strop `per_page` paginátora shopu. */
  maxPerPage?: number;
}

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;

/** Maximálny počet položiek v `POST /api/batch`. */
export const BATCH_MAX_ITEMS = 25;

/** Akcie, ktoré sú v shope opt-in pre `/api/batch` (dnes len čítania). */
export const BATCHABLE_ACTIONS: readonly string[] = ['products.get', 'order.get'];

export class MockShopState {
  /** Katalóg. Kľúč mapy = `id` produktu. */
  readonly products = new Map<number, MockProduct>();

  /** Platné kľúče a ich scope-y. */
  readonly keys = new Map<string, MockScope[]>();

  /** Všetky prijaté požiadavky v poradí (I1, I10). */
  readonly recordedRequests: RecordedRequest[] = [];

  defaultPerPage: number;
  maxPerPage: number;

  /* ── scenáre ───────────────────────────────────────────────────────────── */

  /** Umelé zdržanie pred odpoveďou (ms) — `delay()`. */
  delayMs = 0;
  /** Trvalý 429 + `Retry-After` — `rateLimit()`. */
  rateLimitRetryAfter: number | null = null;
  /** Trvalý 403 `forbidden` na zápise — `forbidden()`. */
  forbiddenAll = false;

  /** Trvalý 403 `ip_banned` — `ipBanned()`. */
  ipBannedAll = false;

  /** `true` = ban zasiahne aj ČÍTANIE, ako skutočný ban. */
  ipBanReads = false;
  /** Od tejto (1-based) požiadavky vracia mock 401 — `unauthorizedAfter()`. */
  unauthorizedAfterN: number | null = null;
  /** Trvalý nesmyselný tvar s HTTP 200 — `returnGarbage()`. */
  garbageAll = false;
  /** Zápis sa prijme, uloží, ale odpoveď nikdy nepríde — `hangWrite()`. */
  hangWrites = false;
  /** Jednorazové zlyhanie n-tej požiadavky — `failNth()`. */
  failNthConfig: FailNthConfig | null = null;

  /* ── počítadlá ─────────────────────────────────────────────────────────── */

  requestCount = 0;
  readCount = 0;
  writeCount = 0;
  /** Koľkokrát sa už `failNth` uplatnil. */
  failNthApplied = 0;

  constructor(options: MockShopStateOptions = {}) {
    this.defaultPerPage = options.defaultPerPage ?? DEFAULT_PER_PAGE;
    this.maxPerPage = options.maxPerPage ?? MAX_PER_PAGE;
    for (const product of options.products ?? []) this.setProduct(product);
    for (const entry of options.keys ?? [{ key: DEFAULT_MOCK_API_KEY, scopes: ['product:edit'] }]) {
      this.keys.set(entry.key, [...entry.scopes]);
    }
  }

  /* ── katalóg ───────────────────────────────────────────────────────────── */

  setProduct(product: MockProduct): this {
    this.products.set(product.id, { lastReduction: null, ...product });
    return this;
  }

  setProducts(products: MockProduct[]): this {
    for (const product of products) this.setProduct(product);
    return this;
  }

  removeProduct(id: number): this {
    this.products.delete(id);
    return this;
  }

  /**
   * Nastaví stav zľavy tak, ako ho hlási shop — bez toho, aby appka čokoľvek
   * zapísala. `undefined` vráti produkt k zrkadleniu zápisov appky.
   */
  setShopReduction(
    id: number,
    reduction: { reduction: number; from: string; to: string } | null | undefined,
  ): this {
    const product = this.products.get(id);
    if (product !== undefined) product.shopReduction = reduction;
    return this;
  }

  getProduct(id: number): MockProduct | undefined {
    return this.products.get(id);
  }

  /** Produkty v deterministickom poradí podľa `id` (paginácia musí byť stabilná). */
  listProducts(): MockProduct[] {
    return [...this.products.values()].sort((a, b) => a.id - b.id);
  }

  /**
   * D39c — zmena ceny **medzi dvoma GETmi**. Vracia predchádzajúcu cenu, aby
   * test vedel doložiť `price_at_preview ≠ price_at_write`.
   */
  changePrice(id: number, newPrice: number): number | null {
    const product = this.products.get(id);
    if (product === undefined) return null;
    const previous = product.price;
    product.price = newPrice;
    return previous;
  }

  /* ── kľúče ─────────────────────────────────────────────────────────────── */

  addKey(key: string, scopes: MockScope[] = ['product:edit']): this {
    this.keys.set(key, [...scopes]);
    return this;
  }

  revokeKey(key: string): this {
    this.keys.delete(key);
    return this;
  }

  isKnownKey(key: string | null): boolean {
    return key !== null && this.keys.has(key);
  }

  hasScope(key: string | null, scope: MockScope): boolean {
    if (key === null) return false;
    return (this.keys.get(key) ?? []).includes(scope);
  }

  /** Scopes kľúča — pre `GET /api/whoami` (API v5). Neznámy kľúč → `null`. */
  scopesOf(key: string | null): MockScope[] | null {
    if (key === null) return null;
    const scopes = this.keys.get(key);
    return scopes === undefined ? null : [...scopes];
  }

  /* ── scenáre (fluent API) ──────────────────────────────────────────────── */

  /** Umelé zdržanie každej odpovede (test timeoutov a tempa). */
  delay(ms: number): this {
    this.delayMs = Math.max(0, ms);
    return this;
  }

  /** Trvalý 429 s `Retry-After: <s>` (D42). `null`/vynechané = 30 s. */
  rateLimit(retryAfterSeconds = 30): this {
    this.rateLimitRetryAfter = Math.max(0, retryAfterSeconds);
    return this;
  }

  /** Trvalý 403 `forbidden` — kľúč bez scope `product:edit` (D52). */
  forbidden(enabled = true): this {
    this.forbiddenAll = enabled;
    return this;
  }

  /**
   * Trvalý 403 `ip_banned` — shop odmieta našu ADRESU, nie kľúč.
   *
   * Je to iný stav než `forbidden()` a rozdiel je celý zmysel tohto prepínača:
   * shop tento kód vracia aj na volanie BEZ kľúča, takže z neho NESMIE vzniknúť
   * wipe kľúča. Zmerané na ostrom shope 24. 8. 2026.
   */
  ipBanned(enabled = true, opts: { reads?: boolean } = {}): this {
    this.ipBannedAll = enabled;
    // `reads: true` = ban platí na VŠETKO, ako v skutočnosti. Default je len
    // zápis, aby sa dala zmerať zápisová vetva (viď komentár nižšie).
    this.ipBanReads = opts.reads === true;
    return this;
  }

  /** Od (n+1)-tej požiadavky vracia mock 401 `unauthorized` (D51, TTL/revoke). */
  unauthorizedAfter(n: number): this {
    this.unauthorizedAfterN = Math.max(0, n);
    return this;
  }

  /** HTTP 200 s tvarom, ktorý neprejde zod schémou → `schema_drift` (D54). */
  returnGarbage(enabled = true): this {
    this.garbageAll = enabled;
    return this;
  }

  /**
   * „Vis" pri zápise: mock zápis **vykoná** (stav sa zmení), ale odpoveď nepošle
   * — presne situácia D45 (timeout PO odoslaní ⇒ `uncertain`).
   */
  hangWrite(enabled = true): this {
    this.hangWrites = enabled;
    return this;
  }

  /**
   * Nech n-tá požiadavka (v rámci `target`) zlyhá daným druhom.
   * Default `target: 'write'` — najčastejší scenár je „7. zápis z 10 spadol".
   */
  failNth(
    n: number,
    kind: MockFailureKind,
    opts: { target?: MockTarget; retryAfterSeconds?: number; times?: number } = {},
  ): this {
    this.failNthConfig = {
      n,
      kind,
      target: opts.target ?? 'write',
      retryAfterSeconds: opts.retryAfterSeconds,
      times: opts.times ?? 1,
    };
    this.failNthApplied = 0;
    return this;
  }

  /** Zruší všetky scenáre, počítadlá nechá. */
  clearScenarios(): this {
    this.delayMs = 0;
    this.rateLimitRetryAfter = null;
    this.forbiddenAll = false;
    this.ipBannedAll = false;
    this.ipBanReads = false;
    this.unauthorizedAfterN = null;
    this.garbageAll = false;
    this.hangWrites = false;
    this.failNthConfig = null;
    this.failNthApplied = 0;
    return this;
  }

  /** Kompletný reset medzi testami: scenáre, počítadlá aj história. */
  reset(): this {
    this.clearScenarios();
    this.requestCount = 0;
    this.readCount = 0;
    this.writeCount = 0;
    this.recordedRequests.length = 0;
    for (const product of this.products.values()) {
      product.lastReduction = null;
      // `undefined`, nie `null`: `null` je platné tvrdenie shopu „zľava nebeží".
      product.shopReduction = undefined;
    }
    return this;
  }

  /* ── vyhodnotenie scenára pre jednu požiadavku ─────────────────────────── */

  /**
   * Rozhodne, či a ako má požiadavka zlyhať. Poradie priorít je zámerné:
   * rate limit a auth sú transportné vrstvy pred akoukoľvek business logikou.
   */
  decideFailure(kindOf: { isWrite: boolean; seq: number; targetSeq: number }): {
    kind: MockFailureKind;
    retryAfterSeconds?: number;
  } | null {
    if (this.rateLimitRetryAfter !== null) {
      return { kind: 'rate_limited', retryAfterSeconds: this.rateLimitRetryAfter };
    }
    if (this.unauthorizedAfterN !== null && kindOf.seq > this.unauthorizedAfterN) {
      return { kind: 'unauthorized' };
    }
    if (this.ipBannedAll && (this.ipBanReads || kindOf.isWrite)) {
      /*
       * ÚMYSELNE len na ZÁPISE, hoci skutočný ban platí na všetko.
       *
       * Dôvod je v tom, čo sa testuje: nebezpečná cesta je tá, kde `ip_banned`
       * dorazí NA ZÁPISE — tam ho executor do 25. 8. 2026 zamieňal za odmietnutý
       * kľúč a kľúč zmazal. Keď ban zasiahne už predzápisový GET (D39), beh
       * skončí v generickej vetve zlyhania, ktorá sa kľúča NEDOTÝKA, takže
       * o kľúč sa nepríde — len dôvod je menej konkrétny.
       *
       * Zapnúť ho aj na čítanie by znamenalo, že sa k zápisovej vetve nikdy
       * nedostaneme a test by meral iný stav, než ktorý ho vyvolal.
       */
      return { kind: 'ip_banned' };
    }
    if (this.forbiddenAll && kindOf.isWrite) {
      return { kind: 'forbidden' };
    }
    const cfg = this.failNthConfig;
    if (cfg !== null && this.failNthApplied < cfg.times) {
      const matchesTarget =
        cfg.target === 'any' ||
        (cfg.target === 'write' && kindOf.isWrite) ||
        (cfg.target === 'read' && !kindOf.isWrite);
      if (matchesTarget && kindOf.targetSeq >= cfg.n) {
        this.failNthApplied += 1;
        return { kind: cfg.kind, retryAfterSeconds: cfg.retryAfterSeconds };
      }
    }
    if (this.garbageAll) return { kind: 'garbage' };
    if (this.hangWrites && kindOf.isWrite) return { kind: 'hang' };
    return null;
  }

  /* ── pomôcky nad `recordedRequests` ────────────────────────────────────── */

  /** Požiadavky na danú cestu (bez query). */
  requestsTo(path: string): RecordedRequest[] {
    return this.recordedRequests.filter((r) => r.path === path);
  }

  /** Iba zápisové volania (`setReduction`) v poradí odoslania (I10). */
  writeRequests(): RecordedRequest[] {
    return this.recordedRequests.filter((r) => r.isWrite);
  }

  /**
   * Odstupy medzi susednými zápismi v ms (monotónny čas) — podklad pre
   * `test/integration/sequential-writes.spec.ts` (I10, ≥ 250 ms).
   */
  writeGapsMs(): number[] {
    const writes = this.writeRequests();
    const gaps: number[] = [];
    for (let i = 1; i < writes.length; i += 1) {
      gaps.push(writes[i].atMonotonic - writes[i - 1].atMonotonic);
    }
    return gaps;
  }

  /** Všetky kľúče, ktoré kedy prišli v hlavičkách (I1 — smie ich vidieť len shop). */
  seenApiKeys(): string[] {
    const seen = new Set<string>();
    for (const r of this.recordedRequests) if (r.apiKey !== null) seen.add(r.apiKey);
    return [...seen];
  }

  /** Prišiel kľúč aj na čítacie volanie? Musí byť `false` (D48). */
  keyLeakedToReads(): boolean {
    return this.recordedRequests.some((r) => !r.isWrite && r.apiKey !== null);
  }
}
