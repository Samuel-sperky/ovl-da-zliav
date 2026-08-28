'use client';

/**
 * Aura Zľavy — klientske typy a volania nastavení (A16, §5).
 *
 * Kľúč sa z API nikdy nevracia — len `last4`, časy a odpočet (I1, D65).
 *
 * Do 27. 8. 2026 boli citlivé mutácie (`domain`, `key`, `unlock-writes`)
 * `auth:'sudo'` a pri `401 sudo_required` sa vypýtalo heslo. Prihlásenie zmizlo
 * (D99, D100). Potvrdenie NEZMIZLO tam, kde bolo jediné: panic button ďalej
 * chce vypísanú frázu (`PANIC_CONFIRM_LITERAL`) a odomknutie zápisov `confirmed`.
 */
import type { Envelope } from '@/components/campaigns/api';
import { getJson, postJson } from '@/components/campaigns/api';
import type { BlockerWire, StatusPayload } from '@/lib/status/snapshot';

/**
 * Prekážky a celý obraz stavu appky sa NEODVODZUJÚ tu — prichádzajú hotové
 * zo servera z jediného zdroja pravdy (`lib/status/blockers.ts`). Typy sa dajú
 * doniesť aj do prehliadača, lebo `lib/status/snapshot.ts` je zámerne čistý
 * modul bez jediného serverového importu.
 */
export type { BlockerWire, StatusPayload };

/** Presný literál potvrdenia panic buttonu (D67) — bez diakritiky. */
export const PANIC_CONFIRM_LITERAL = 'KLUC UNIKOL';

/** Režim rozsahu podľa kontraktu V3 (bod K-jedna). Na povrchu nikdy surový. */
export type ScopeModeValue = 'pilot' | 'plny';

/** Slovenské meno režimu — obrazovka si ho nevymýšľa. */
export const SCOPE_MODE_LABELS: Readonly<Record<ScopeModeValue, string>> = {
  pilot: 'pilotný',
  plny: 'plný',
};

export interface SettingsView {
  shopDomain: string | null;
  domainConfirmedAt: string | null;
  eagerWriteDefault: boolean;
  writesLocked: boolean;
  writesLockedReason: string | null;
  onboardingDoneAt: string | null;
  /* ── rozsah a rozpočet (kontrakt V3) ─────────────────────────────────── */
  scopeMode: ScopeModeValue;
  /** Koľko produktov smie mať jedna zľava v platnom režime. */
  maxProducts: number;
  /** Uložený strop pre plný režim (v pilotnom sa nepoužíva). */
  maxProductsPerCampaign: number;
  /** Strop pilotného režimu — desať, a je vynútený aj v databáze. */
  pilotMaxProducts: number;
  /** `true` = hodnoty sú bezpečný predvolený stav, nie čítanie z databázy. */
  scopeFailClosed: boolean;
  /** Koľko zápisov smie appka minúť za jeden deň. */
  dailyWriteBudget: number;
}

/** Odpoveď prepnutia režimu rozsahu. */
export interface ScopeModeResult {
  scopeMode: ScopeModeValue;
  maxProducts: number;
  maxProductsPerCampaign: number;
  dailyWriteBudget: number;
  previousScopeMode: ScopeModeValue;
  pilotMaxProducts: number;
}

/** Stav rozpočtu zápisov za dnešný deň (čítané, nikdy dopočítavané). */
export interface BudgetStatusView {
  day: string;
  budget: number;
  spent: number;
  remaining: number;
  exhausted: boolean;
}

/** To, čo z fronty potrebujú Nastavenia: rozpočet a veľkosť fronty. */
export interface QueueView {
  budget: BudgetStatusView | null;
  queue: { pending: number; total: number; done: number; campaigns: number };
  estimate: { pending: number; perDay: number; days: number; date: string } | null;
  heartbeat: { lastTickAt: string | null; staleMs: number | null; stale: boolean };
  /**
   * Stropy eshopu a kedy sa denný rozpočet obnoví. Zámerne VOLITEĽNÉ: pole
   * pribudlo neskôr a obrazovka nesmie spadnúť na staršej odpovedi — keď chýba,
   * veta o obnove sa jednoducho nekreslí (vymyslený čas by bol tvrdenie).
   */
  limits?: {
    shopPerUtcDay: number;
    shopPerMinute: number;
    configuredPerDay: number;
    /** Presný okamih obnovy denného stropu. */
    nextResetAt: string;
  } | null;
}

/**
 * Denný ČÍTACÍ rozpočet katalógu (`GET /api/catalog/sync`).
 *
 * Je to iná kvóta než zápisová: čítania idú bez kľúča, počítajú sa na
 * zdrojovú adresu počítača a zo zápisov si neberú nič. Preto sú v Nastaveniach
 * dva prúžky vedľa seba, nie jeden spoločný.
 */
export interface CatalogReadsView {
  day: string;
  /** Koľko čítaní si appka za deň dovolí (rezerva pod stropom eshopu). */
  limit: number;
  used: number;
  remaining: number;
  exhausted: boolean;
  resetAt: string;
  minuteLimit: number;
  usedThisMinute: number;
  /** `false` = počítadlo sa nedalo prečítať, čísla sú bezpečný odhad. */
  known: boolean;
}

/**
 * Stav zrkadla katalógu. Tvar je podmnožina odpovede `GET /api/catalog/sync`;
 * typ z tej route sa sem doniesť NEDÁ — ťahá databázu aj klienta eshopu, teda
 * celý server do prehliadača.
 */
export interface CatalogView {
  loadedProducts: number;
  shopTotalProducts: number | null;
  percent: number | null;
  complete: boolean;
  lastFetchedAt: string | null;
  nextBatchAt: string | null;
  estimatedDaysLeft: number | null;
  estimatedFinishAt: string | null;
  reads: CatalogReadsView;
}

export interface KeyMetaView {
  present: boolean;
  last4: string | null;
  savedAt: string | null;
  expiresAt: string | null;
  secondsLeft: number | null;
  verifyStatus: 'unverified' | 'valid' | 'invalid' | 'forbidden' | null;
  /**
   * Prečo kľúč nie je overený, vetou. `null` = overený je, niet čo dodať.
   *
   * Stav (`verifyStatus`) a dôvod sú dve rôzne veci a obe treba: slovo v tabuľke
   * hovorí ČO, táto veta hovorí, čo s tým. Pri zablokovanej adrese je to
   * jediné miesto, kde sa človek dozvie, že nový kľúč nepomôže.
   *
   * Voliteľné v type, lebo staršie odpovede ho nemajú a chýbajúca veta nesmie
   * zhodiť obrazovku.
   */
  verifyNote?: string | null;
  /**
   * Má kľúč oprávnenie `product:read`? `null` = NEVIEME (kľúč sa neoveril),
   * chýbajúce pole = staršia odpoveď, čo znamená to isté. Server to posiela
   * z `scopeReport()` už dnes; obrazovka to dovtedy nečítala.
   *
   * Kreslí to VÝHRADNE `LockedFeatures` (kontrakt UI, bod 18) — a v troch
   * stavoch, nie v dvoch: „nevieme" sa nikdy nesmie stať „nemá".
   */
  productRead?: boolean | null;
  /**
   * Vyzerá to, že v oboch slotoch je ten istý kľúč? Porovnáva sa `last4`, takže
   * `true` je domnienka, nie fakt — a preto sa to menuje `looksLike…`.
   * `null` = jeden zo slotov je prázdny, niet čo porovnávať.
   */
  looksLikeSameKey?: boolean | null;
  /** Veta k tomu porovnaniu; `null` = niet čo dodať. */
  sameKeyNote?: string | null;
}

export interface CanaryView {
  ok: boolean;
  httpStatus: number | null;
  total: number;
  latencyMs: number;
}

export interface PanicResult {
  wiped: true;
  cancelledCampaigns: number;
  runbookUrl: string;
}

async function sendJson<T>(
  url: string,
  method: 'PUT' | 'DELETE',
  body?: unknown,
): Promise<Envelope<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    try {
      const parsed = (await res.json()) as Envelope<T>;
      if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed;
    } catch {
      /* neplatný JSON */
    }
    return {
      ok: false,
      error: { code: `http_${res.status}`, message: 'Server vrátil neočakávanú odpoveď.' },
    };
  } catch {
    return { ok: false, error: { code: 'network', message: 'Server neodpovedá. Skús znova.' } };
  }
}

export const getSettings = () => getJson<SettingsView>('/api/settings');
export const getKeyMeta = () => getJson<KeyMetaView>('/api/key');

/** Rozpočet a fronta pre sekciu Rozpočet. Čisto čítacie. */
export const getQueue = () => getJson<QueueView>('/api/queue');

/**
 * Celý obraz stavu appky aj s hotovým zoznamom prekážok. Lacný endpoint —
 * žiadne volanie eshopu, počty idú po indexoch.
 */
export const getStatus = () => getJson<StatusPayload>('/api/status');

/**
 * Stav katalógu a jeho denný čítací rozpočet. `GET` nič nespúšťa a na eshop
 * neodošle ani jeden dotaz; načítanie katalógu spúšťa iná obrazovka.
 */
export const getCatalog = () => getJson<{ catalog: CatalogView }>('/api/catalog/sync');

/**
 * Prepnutie režimu rozsahu. Uvoľnenie (pilotný → plný, aj zdvihnutie stropu)
 * server ZAZNAMENÁ do auditu ako uvoľnenie (`looseningScope`) a od 28. 8. 2026
 * si ho vypýta potvrdením (`confirmed: true`, D106) — bez neho vracia 409
 * `confirmation_required` a rozsah zostane, kde bol. Sprísnenie späť je vždy
 * voľné, aby sa dalo pribrzdiť aj v núdzi; preto je `confirmed` voliteľné
 * a rozhodnutie padá na serveri, ktorý jediný vie, čo je uvoľnenie.
 *
 * Do 27. 8. 2026 si uvoľnenie vypýtalo heslo — heslá zmazalo D99, sudo bránu
 * D100 a slovo v UI D105.
 */
export const postScopeMode = (
  mode: ScopeModeValue,
  maxProductsPerCampaign?: number,
  confirmed?: boolean,
) =>
  postJson<ScopeModeResult>('/api/settings/scope-mode', {
    mode,
    ...(maxProductsPerCampaign === undefined ? {} : { maxProductsPerCampaign }),
    ...(confirmed === undefined ? {} : { confirmed }),
  });

/**
 * Stav OBJEDNÁVKOVÉHO kľúča (`orders_read`, P2/P5). Tvar odpovede je rovnaký
 * ako pri zápisovom kľúči a obsahuje výhradne `present`, `last4` a časy (D65, I1).
 */
export const getOrdersKeyMeta = () => getJson<KeyMetaView>('/api/key?kind=orders_read');

/**
 * Zmena adresy shopu. `confirmed` je POVINNÉ (D106, 28. 8. 2026): kto prepíše
 * doménu, tomu zápisová cesta pošle dešifrovaný produkčný API kľúč na jeho
 * adresu, a canary to nezastaví (číta bez kľúča). Preto tu nie je voliteľný
 * parameter — kto zavolá `putDomain`, potvrdenie už má.
 */
export const putDomain = (domain: string, confirmed: true) =>
  sendJson<{ shopDomain: string; canary: { ok: boolean; total: number } }>(
    '/api/settings/domain',
    'PUT',
    { domain, confirmed },
  );

export const testConnection = () => postJson<CanaryView>('/api/settings/test-connection');

/* `PUT /api/settings/eager-write-default` tu ZÁMERNE nemá klienta: predvoľbu
   `eagerWriteDefault` nečíta žiadna cesta zápisu, takže obrazovka ju neponúka.
   Keď ju formulár novej zľavy začne čítať (D22), klient sa vráti sem. */

/**
 * Odomknutie zápisov. `confirmed: true` je jediné potvrdenie tejto akcie od
 * zrušenia hesiel (D99) — server ho vyžaduje ako `z.literal(true)`, takže
 * vynechanie skončí 400, nikdy odomknutím.
 */
export const unlockWrites = () =>
  postJson<{ writesLocked: false }>('/api/settings/unlock-writes', { confirmed: true });

export const putKey = (apiKey: string) =>
  sendJson<{ last4: string; expiresAt: string; verifyStatus: string }>('/api/key', 'PUT', {
    apiKey,
  });

/**
 * Vloženie objednávkového kľúča. Server ho uloží LEN vtedy, keď mu shop skutočne
 * povolí čítanie objednávok — inak vráti chybu a v DB sa nič nezmení.
 */
export const putOrdersKey = (apiKey: string) =>
  sendJson<{ last4: string; expiresAt: string; verifyStatus: string; kind: string }>(
    '/api/key',
    'PUT',
    { apiKey, kind: 'orders_read' },
  );

export const panicWipeKey = () =>
  sendJson<PanicResult>('/api/key', 'DELETE', {
    confirm: PANIC_CONFIRM_LITERAL,
  });

/* ── lokálna validácia pred odoslaním ─────────────────────────────────── */

/** Doména shopu MUSÍ byť jedna a výhradne `https://` (D80). */
export function validateDomain(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return 'Zadaj doménu shopu.';
  if (!value.startsWith('https://')) {
    return 'Doména musí začínať na https:// — http ani iné schémy appka neprijme.';
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Doména nie je platná URL adresa.';
  }
  if (url.protocol !== 'https:') return 'Doména musí používať https.';
  if (url.hostname === '') return 'Doména neobsahuje názov hostiteľa.';
  return null;
}

/** API kľúč: 16–256 znakov podľa §5; obsah kľúča sa nikde nezobrazuje (I1). */
export function validateApiKey(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return 'Vlož API kľúč zo shopu.';
  if (value.length < 16) return 'Kľúč je príliš krátky (minimum 16 znakov) — skopíruj ho celý.';
  if (value.length > 256) return 'Kľúč je príliš dlhý (maximum 256 znakov).';
  return null;
}
