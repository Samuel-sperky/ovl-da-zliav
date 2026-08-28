/**
 * Aura Zľavy — OVERENIE ODPOVEDE `GET /api/status` (vlna 24. 8. 2026).
 *
 * PREČO TENTO SÚBOR EXISTUJE
 * --------------------------
 * `StatusPayload` je jediný tvar, ktorý si obrazovky ťahajú CELÝ, aby si nad
 * ním prepočítali prekážky nad vlastným výberom (`statusSnapshotFromPayload()`).
 * Robia to dve: tab Zľavy (`campaigns/zlavy-api.ts`) a tab Produkty
 * (`products/catalog-api.ts`). Obe ho do 24. 8. 2026 brali cez holé
 * `as StatusPayload` — a `statusSnapshotFromPayload()` hneď na prvom riadku
 * siaha na `payload.apiKey.expiresAt` a `payload.writes.enabled`. Odpoveď bez
 * týchto blokov teda nebola „menej dát"; bol to `TypeError` a prázdna obrazovka,
 * presne ako pri neznámom kóde stavu.
 *
 * Parser je JEDEN pre obe obrazovky a stojí vedľa `json.ts` z toho istého
 * dôvodu, pre ktorý tam stojí aj on: druhá kópia by sa o mesiac rozišla s prvou
 * a jedna z obrazoviek by začala čítať voľnejšie než druhá.
 *
 * NIE JE to tretia implementácia čítania stavu. `dashboard/status-api.ts`
 * prekladá tú istú odpoveď do ÚZKEHO pohľadu pre prístrojovú dosku (`StatusView`,
 * `BlockerRow`); tu ide o CELÝ payload, lebo `blockers.ts` ho potrebuje celý.
 * Spoločné majú primitíva z `json.ts` a nič iné spoločné mať nemôžu.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Uzavreté zoznamy sa overujú, nepretypovávajú.** `severity`, `resolution`
 *    a spol. sú kľúče do tabuliek vzhľadu; neznáma hodnota = `undefined` tvar
 *    = pád vykresľovača.
 * 2. **Fail-closed je hlasný, nie tichý.** Neprečítaná závažnosť je `blokuje`,
 *    neprečítaný spôsob riešenia je `mimo_appky` a neprečítané `assumed` je
 *    `true`. Appka radšej ukáže navyše, než by zamlčala dôvod.
 * 3. **Nečitateľný payload je `null` pre CELOK.** Poloprázdny stav by na
 *    obrazovke vyzeral ako pokoj, a to je pri appke, ktorá píše do produkčného
 *    eshopu, to najhoršie možné tvrdenie (P7).
 *
 * Modul je čistý — žiadny React, žiadny `fetch`, žiadna DB.
 */
import {
  asRecord,
  readCode,
  readCount,
  readFlag,
  readText,
  readTriState,
} from '@/components/dashboard/json';
import { BLOCKER_ORDER } from '@/lib/status/blockers';
import type { BlockerWire, StatusPayload } from '@/lib/status/snapshot';

/* ══════════════════════ 1. Uzavreté zoznamy hodnôt ════════════════════════ */

/*
 * Zoznamy sú odvodené z TÝCH ISTÝCH typov, ktoré popisujú odpoveď — `satisfies`
 * ich drží v zhode. Keď v `snapshot.ts` pribudne hodnota a sem sa nedoplní,
 * neprejde typová kontrola, nie až používateľ.
 */

const SEVERITIES = ['blokuje', 'obmedzuje', 'informuje'] as const satisfies readonly BlockerWire['severity'][];

const AREAS = [
  'zapisy',
  'kluc',
  'rozpocet',
  'rozsah',
  'katalog',
  'citanie',
] as const satisfies readonly BlockerWire['area'][];

const SUBJECTS = ['operacia', 'produkt'] as const satisfies readonly BlockerWire['subject'][];

const RESOLUTIONS = [
  'sam',
  // Do 27. 8. 2026 tu stálo 'sudo'; D105 (dôsledok D100) prekážku prekrstilo na
  // 'potvrdenie', pretože heslo, ktorým sa dala otvoriť, už neexistuje.
  'potvrdenie',
  'cakanie',
  'mimo_appky',
] as const satisfies readonly BlockerWire['resolution'][];

const SCOPE_MODES = ['pilot', 'plny'] as const satisfies readonly NonNullable<
  StatusPayload['scope']['mode']
>[];

const SALES_BLOCKS = ['permission', 'ip_ban'] as const satisfies readonly NonNullable<
  NonNullable<StatusPayload['salesSync']>['block']
>[];

const SECTIONS = [
  'writes',
  'apiKey',
  'writeBudget',
  'scope',
  'catalog',
  'catalogReads',
  'salesSync',
] as const satisfies readonly StatusPayload['unreadable'][number][];

/* ══════════════════════════ 2. Jedna prekážka ═════════════════════════════ */

/**
 * Prekážka z odpovede → `BlockerWire`.
 *
 * Riadok bez rozpoznaného `id` alebo bez oboch viet sa zahodí: `id` je kľúč,
 * podľa ktorého UI páruje poradie a widget, a prekážka bez `what`/`nextStep`
 * je prázdny riadok, ktorý nič nehovorí. Že sa niečo zahodilo, sa NESTRATÍ —
 * `summary.blocked` a `summary.blockingCount` idú zo servera nezávisle, takže
 * poplach zostáva, aj keď sa jeden riadok nedá vykresliť.
 */
export function parseBlockerWire(raw: unknown): BlockerWire | null {
  const record = asRecord(raw);
  if (record === null) return null;

  const id = readCode(record, 'id', BLOCKER_ORDER);
  const what = readText(record, 'what');
  const nextStep = readText(record, 'nextStep');
  if (id === null || what === null || nextStep === null) return null;

  const productIdsRaw = record['productIds'];
  const productIds = Array.isArray(productIdsRaw)
    ? productIdsRaw.filter((value): value is number => typeof value === 'number' && value >= 0)
    : [];

  return {
    id,
    area: readCode(record, 'area', AREAS) ?? 'zapisy',
    // Fail-closed: prekážka bez rozpoznanej závažnosti je tá, ktorá zastavuje.
    severity: readCode(record, 'severity', SEVERITIES) ?? 'blokuje',
    subject: readCode(record, 'subject', SUBJECTS) ?? 'operacia',
    productIds,
    what,
    nextStep,
    path: readText(record, 'path'),
    // Fail-closed: netvrdíme, že sa to vyrieši samo ani že s tým používateľ
    // pohne — `mimo_appky` je tvrdenie „z tejto obrazovky s tým nič nespravíte".
    resolution: readCode(record, 'resolution', RESOLUTIONS) ?? 'mimo_appky',
    passableNow: readFlag(record, 'passableNow'),
    clearsAt: readText(record, 'clearsAt'),
    // Keď sa nedá prečítať, či veta stojí na domnienke, JE to domnienka.
    assumed: record['assumed'] !== false,
  };
}

/* ═══════════════════════════ 3. Celý payload ══════════════════════════════ */

export function parseStatusPayload(raw: unknown): StatusPayload | null {
  const root = asRecord(raw);
  if (root === null) return null;

  const now = readText(root, 'now');
  const blockersRaw = root['blockers'];
  const summaryRaw = asRecord(root['summary']);
  // Bez času, bez zoznamu prekážok alebo bez zhrnutia to nie je odpoveď
  // `/api/status`. Prázdny zoznam prekážok znamená „nič nebráni zápisu" a to
  // sa z nečitateľnej odpovede povedať nesmie.
  if (now === null || !Array.isArray(blockersRaw) || summaryRaw === null) return null;

  const writesRaw = asRecord(root['writes']);
  const apiKeyRaw = asRecord(root['apiKey']);
  const scopeRaw = asRecord(root['scope']);
  const budgetRaw = asRecord(root['writeBudget']);
  const catalogRaw = asRecord(root['catalog']);
  const readsRaw = asRecord(root['catalogReads']);
  const salesRaw = asRecord(root['salesSync']);

  const unreadableRaw = root['unreadable'];
  const unreadable = Array.isArray(unreadableRaw)
    ? unreadableRaw.filter((value): value is StatusPayload['unreadable'][number] =>
        (SECTIONS as readonly string[]).includes(value as string),
      )
    : [];

  return {
    now,
    // `null` v poistkách znamená „nevieme" a `blockers.ts` to vie spracovať
    // fail-closed. Chýbajúci blok preto nie je nula ani `false`.
    writes: {
      enabled: writesRaw === null ? null : readTriState(writesRaw, 'enabled'),
      locked: writesRaw === null ? null : readTriState(writesRaw, 'locked'),
      lockedReason: writesRaw === null ? null : readText(writesRaw, 'lockedReason'),
      lockedAt: writesRaw === null ? null : readText(writesRaw, 'lockedAt'),
    },
    apiKey: {
      present: apiKeyRaw === null ? null : readTriState(apiKeyRaw, 'present'),
      expiresAt: apiKeyRaw === null ? null : readText(apiKeyRaw, 'expiresAt'),
    },
    writeBudget: parseWriteBudget(budgetRaw),
    scope: {
      mode: scopeRaw === null ? null : readCode(scopeRaw, 'mode', SCOPE_MODES),
      maxProductsSetting: scopeRaw === null ? null : readCount(scopeRaw, 'maxProductsSetting'),
      maxProducts: scopeRaw === null ? null : readCount(scopeRaw, 'maxProducts'),
      // Fail-closed: kým sa nedozvieme opak, čísla rozsahu sú domnienka (K1).
      failClosed: scopeRaw === null || scopeRaw['failClosed'] !== false,
    },
    catalog:
      catalogRaw === null
        ? null
        : {
            loadedProducts: readCount(catalogRaw, 'loadedProducts'),
            shopTotalProducts: readCount(catalogRaw, 'shopTotalProducts'),
            lastFetchedAt: readText(catalogRaw, 'lastFetchedAt'),
          },
    catalogReads:
      readsRaw === null
        ? null
        : {
            usedThisMinute: readCount(readsRaw, 'usedThisMinute'),
            usedThisUtcDay: readCount(readsRaw, 'usedThisUtcDay'),
          },
    salesSync:
      salesRaw === null
        ? null
        : {
            block: readCode(salesRaw, 'block', SALES_BLOCKS),
            since: readText(salesRaw, 'since'),
            probeAt: readText(salesRaw, 'probeAt'),
          },
    blockers: blockersRaw
      .map(parseBlockerWire)
      .filter((wire): wire is BlockerWire => wire !== null),
    summary: {
      blocked: readFlag(summaryRaw, 'blocked'),
      blockingCount: readCount(summaryRaw, 'blockingCount') ?? 0,
      worstBlockerId: readCode(summaryRaw, 'worstBlockerId', BLOCKER_ORDER),
      waitUntil: readText(summaryRaw, 'waitUntil'),
      anyAssumed: readFlag(summaryRaw, 'anyAssumed'),
    },
    unreadable,
  };
}

/**
 * Denný rozpočet zápisov. Neúplný blok je `null` pre celý rozpočet — polovica
 * čísel by na obrazovke vyzerala ako meraný stav (P7).
 */
function parseWriteBudget(raw: ReturnType<typeof asRecord>): StatusPayload['writeBudget'] {
  if (raw === null) return null;
  const day = readText(raw, 'day');
  const budget = readCount(raw, 'budget');
  const spent = readCount(raw, 'spent');
  const remaining = readCount(raw, 'remaining');
  if (day === null || budget === null || spent === null || remaining === null) return null;
  return { day, budget, spent, remaining, exhausted: readFlag(raw, 'exhausted') };
}
