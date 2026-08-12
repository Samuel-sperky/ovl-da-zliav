'use client';

/**
 * Aura Zľavy — ŽIVÝ STAV APPKY PRE SPOLOČNÝ CHRÓM (C1, C2, C3).
 *
 * Používateľ povedal dve veci naraz: „nevidím, čo appka robí" a „nevidím, prečo
 * sa niečo NEstalo". Odpoveď na obe už v appke existuje — `GET /api/status` vracia
 * fakty aj hotový zoznam prekážok z `lib/status/blockers.ts`. Chýbalo len miesto,
 * kde to vidno z KAŽDEJ obrazovky. Tento modul je jeho mozog: sťahovanie stavu
 * a čisté funkcie, ktoré z payloadu robia krátke menovky do stáleho pruhu.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Farba sa volí podľa `resolution`, NIE podľa `severity`.** Je to napísané
 *    v doc-bloku `blockers.ts` a je to jediné pravidlo, ktoré drží K2 pri živote:
 *    vyčerpaný denný rozpočet má závažnosť `blokuje`, ale `resolution: 'cakanie'`,
 *    takže je NEUTRÁLNY — nič sa nepokazilo, appka len čaká na polnoc. Kto by
 *    farbil podľa závažnosti, rozsvieti pruh na červeno pri úplne zdravom behu.
 *    Prevod má na starosti `resolutionTone()` a nikto si ho nemá robiť po svojom.
 *
 * 2. **Vysvetlenie sa NEPÍŠE druhýkrát.** Krátka menovka („Kľúč chýba") je len
 *    štítok; celá veta aj ďalší krok sa berú z prekážky, ktorú poslal server
 *    (`explain()`). Keby si pruh písal vlastné vety, appka by o tej istej veci
 *    hovorila na dvoch miestach dvoma spôsobmi a jedna z nich by časom klamala.
 *    Vlastná veta je preto len fallback pre stav, ktorý žiadnu prekážku nemá.
 *
 * 3. **Neznáme číslo sa nedopĺňa.** Keď sekcia v payloade chýba (server ju
 *    nevedel prečítať), menovka to prizná („nevieme"). Nula ani pomlčka
 *    s optimistickým tónom sem nepatria — appka zapisuje do produkčného shopu.
 *
 * 4. **Jeden poller pre celý chróm.** Stav ťahá zdieľaný modulový store, nie
 *    každý komponent zvlášť. `/api/status` je lacný, ale nie zadarmo a jeho
 *    doc-blok výslovne prosí, aby sa nevolal viackrát, než treba. `useStatus()`
 *    sa preto smie volať z ľubovoľného počtu komponentov — request bude jeden.
 *
 * Modul je server-safe len čo do typov: obsahuje `use client`, ale všetky
 * odvodzovacie funkcie sú ČISTÉ a testovateľné bez prehliadača
 * (`test/unit/status-bar.spec.ts`).
 *
 * Vlastník: L1.
 */
import { useEffect, useState } from 'react';

import { classifyHealthStatus, type HealthOutcomeKind } from '@/components/layout/health';
import { formatResumeTime } from '@/components/layout/queue';
import type { StatusTone } from '@/components/ui/ToneBadge';
import type { BlockerArea, BlockerId, BlockerResolution } from '@/lib/status/blockers';
import type { BlockerWire, StatusPayload } from '@/lib/status/snapshot';
import { formatCountdownSk, formatDateTimeSk } from '@/lib/ui/format';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═════════════════════════ 1. Sťahovanie stavu ════════════════════════════ */

/** Ako často sa stav obnovuje. Rovnaké tempo ako `useHealth()`. */
export const STATUS_POLL_MS = 30_000;

/**
 * Čo o stave práve vieme.
 *
 * `kind` je zámerne tá istá trojica ako pri `/api/health`: neprihlásený
 * používateľ (401) NIE JE porucha appky a pruh to nesmie hlásiť ako poruchu.
 */
export interface StatusState {
  readonly kind: 'loading' | HealthOutcomeKind;
  /** Telo `GET /api/status`. `null` vždy, keď `kind !== 'ok'`. */
  readonly payload: StatusPayload | null;
}

const LOADING: StatusState = { kind: 'loading', payload: null };

/**
 * Načíta `/api/status` a rozlíši „nie si prihlásený" od „appka neodpovedá".
 * NIKDY nehádže — pruh stavu, ktorý spadne, je horší než pruh, ktorý prizná
 * medzeru.
 */
export async function fetchStatusOutcome(url = '/api/status'): Promise<StatusState> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    return { kind: 'unreachable', payload: null };
  }

  const kind = classifyHealthStatus(res.status);
  if (kind !== 'ok') return { kind, payload: null };

  try {
    const body: unknown = await res.json();
    if (body !== null && typeof body === 'object' && 'ok' in body) {
      const envelope = body as { ok: boolean; data?: StatusPayload };
      if (envelope.ok && envelope.data !== undefined) {
        return { kind: 'ok', payload: envelope.data };
      }
      return { kind: 'unreachable', payload: null };
    }
    return { kind: 'ok', payload: body as StatusPayload };
  } catch {
    return { kind: 'unreachable', payload: null };
  }
}

/* ── Zdieľaný store: N komponentov, jeden request (bod 4 v hlavičke). ─────── */

type Listener = (state: StatusState) => void;

let current: StatusState = LOADING;
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function refreshStatus(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    current = await fetchStatusOutcome();
    for (const listener of listeners) listener(current);
  } finally {
    inFlight = false;
  }
}

/**
 * Živý stav appky. Prvý pripojený komponent rozbehne poller, posledný
 * odpojený ho zastaví — v odhlásenej alebo zavretej appke nič nebeží.
 */
export function useStatus(): StatusState {
  const [state, setState] = useState<StatusState>(current);

  useEffect(() => {
    listeners.add(setState);
    setState(current);
    timer ??= setInterval(() => void refreshStatus(), STATUS_POLL_MS);
    void refreshStatus();

    return () => {
      listeners.delete(setState);
      if (listeners.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);

  return state;
}

/* ═══════════════════ 2. Prevod prekážok na tón a vetu ═════════════════════ */

/** Jedna menovka do pruhu: farba + glyf + text, a za tým celá veta na hover. */
export interface StatusChip {
  readonly tone: StatusTone;
  /** Prebitie glyfu tónu. Používa sa len tam, kde tón sám nestačí. */
  readonly glyph?: string;
  /** Krátky štítok do pruhu — pár slov, nikdy celá veta. */
  readonly label: string;
  /** Celá veta aj s ďalším krokom. Ide do `title` a do čítačky. */
  readonly title: string;
}

/**
 * PREKÁŽKA → FARBA. Jediné povolené miesto tohto prevodu.
 *
 * Rozhoduje `resolution` (kto a ako to odstráni), nie `severity` (či to teraz
 * zastavuje). Dôvod je v hlavičke, bod 1:
 *
 *  - `cakanie`    — nič sa nepokazilo, appka čaká na čas → neutrál,
 *  - `mimo_appky` — appka je v najbezpečnejšom stave (napr. vypnuté zápisy),
 *                   z obrazovky sa s tým nedá nič robiť → neutrál,
 *  - `sam`/`sudo` — používateľ TERAZ môže niečo urobiť → jantárová výzva.
 *
 * Červená sa z prekážok NEVYRÁBA vôbec — je vyhradená pre stratu dát
 * a zastavený zápis (runaway zámok), ktorý prichádza mimo zoznamu prekážok.
 */
export function resolutionTone(resolution: BlockerResolution): StatusTone {
  if (resolution === 'sam' || resolution === 'sudo') return 'attention';
  return 'idle';
}

/**
 * Prvá prekážka z uvedených oblastí. `null` = v tejto oblasti nič neviazne.
 * Zoznam prekážok chodí zo servera už zoradený podľa závažnosti, takže „prvá"
 * je vždy tá najzávažnejšia — poradie si tu nikto nesmie prehadzovať.
 */
export function blockerIn(
  payload: StatusPayload | null,
  areas: readonly BlockerArea[],
): BlockerWire | null {
  if (payload === null) return null;
  return payload.blockers.find((blocker) => areas.includes(blocker.area)) ?? null;
}

/**
 * Celá veta k menovke. Keď prekážka existuje, hovorí ONA — appka o jednej veci
 * nehovorí dvakrát (hlavička, bod 2).
 */
export function explain(fallback: string, blocker: BlockerWire | null): string {
  return blocker === null ? fallback : `${blocker.what} ${blocker.nextStep}`;
}

/* ═══════════════════════ 3. Jednotlivé menovky pruhu ══════════════════════ */

/** Dokedy sa odpoveď shopu považuje za čerstvú. Deň je hranica jednej zmeny. */
const SHOP_FRESH_MS = 24 * 60 * 60 * 1000;

/** Referenčný čas payloadu (čas SERVERA, nie hodiny prehliadača). */
function payloadNow(payload: StatusPayload): number {
  const parsed = new Date(payload.now).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * SPOJENIE SO SHOPOM.
 *
 * Appka shop kvôli stavovému pruhu NEPINGUJE — každé volanie ide z denného
 * rozpočtu čítaní. Jediný dôkaz o živom spojení, ktorý má zadarmo, je čas
 * posledného úspešného čítania katalógu. Preto pilulka netvrdí „pripojené",
 * ale to, čo je zmerané: kedy sa shop naposledy ozval.
 */
export function connectionChip(state: StatusState): StatusChip {
  if (state.kind === 'loading') {
    return {
      tone: 'idle',
      label: 'Zisťujem stav',
      title: 'Appka práve zisťuje, v akom je stave.',
    };
  }
  if (state.kind === 'unauthenticated') {
    return {
      tone: 'idle',
      label: 'Stav po prihlásení',
      title: 'Nie si prihlásený — stav appky sa zobrazí po prihlásení. Nie je to porucha appky.',
    };
  }
  if (state.kind === 'unreachable' || state.payload === null) {
    return {
      tone: 'critical',
      label: 'Appka neodpovedá',
      title: 'Appka neodpovedala na otázku o svojom stave — skontroluj, či beží kontajner a databáza.',
    };
  }

  const lastFetchedAt = state.payload.catalog?.lastFetchedAt ?? null;
  if (lastFetchedAt === null) {
    return {
      tone: 'idle',
      label: 'Shop sa ešte neozval',
      title: 'Appka zatiaľ nemá zo shopu načítaný ani jeden produkt, takže o spojení nemá čo tvrdiť.',
    };
  }

  const when = new Date(lastFetchedAt).getTime();
  const fresh = Number.isFinite(when) && payloadNow(state.payload) - when <= SHOP_FRESH_MS;
  return {
    tone: fresh ? 'good' : 'idle',
    label: fresh ? 'Shop odpovedá' : 'Shop sa dlho neozval',
    title: `Naposledy sa shop ozval ${formatDateTimeSk(lastFetchedAt)}. Je to posledné úspešné čítanie katalógu, nie kontrola spojenia navyše.`,
  };
}

/**
 * KĽÚČ NA ZÁPIS. Expirovaný kľúč je jantárový, nie červený: nič sa nestratilo
 * a rieši sa to vložením nového kľúča v Nastaveniach (K2, `blockers.ts`).
 */
export function keyChip(payload: StatusPayload | null): StatusChip {
  const blocker = blockerIn(payload, ['kluc']);
  const tone = blocker === null ? 'good' : resolutionTone(blocker.resolution);

  if (payload === null || payload.apiKey.present === null) {
    return {
      tone: 'attention',
      label: 'Kľúč — nevieme',
      title: explain('Nepodarilo sa zistiť, či je kľúč na zápis vložený.', blocker),
    };
  }
  if (!payload.apiKey.present) {
    return {
      tone,
      label: 'Kľúč chýba',
      title: explain('Kľúč na zápis do shopu nie je vložený.', blocker),
    };
  }
  if (payload.apiKey.expiresAt === null) {
    return {
      tone,
      label: 'Kľúč — neznáma platnosť',
      title: explain('Kľúč je vložený, ale nevieme, dokedy platí.', blocker),
    };
  }

  const expires = new Date(payload.apiKey.expiresAt).getTime();
  if (!Number.isFinite(expires)) {
    return {
      tone: 'attention',
      label: 'Kľúč — neznáma platnosť',
      title: explain('Kľúč je vložený, ale jeho platnosti nerozumieme.', blocker),
    };
  }

  const secondsLeft = Math.floor((expires - payloadNow(payload)) / 1000);
  return {
    tone,
    label: `Kľúč ${formatCountdownSk(secondsLeft)}`,
    title: explain(
      `Kľúč na zápis platí ešte ${formatCountdownSk(secondsLeft)}; keď vyprší, vlož v Nastaveniach nový.`,
      blocker,
    ),
  };
}

/**
 * SÚ ZÁPISY VÔBEC ZAPNUTÉ.
 *
 * Zámok poistky (runaway) má prednosť pred vypnutými zápismi a je to jediný
 * stav v tomto pruhu, ktorý smie byť ČERVENÝ — zápis sa zastavil sám a niekto
 * to musí odomknúť.
 */
export function writesChip(payload: StatusPayload | null): StatusChip {
  const blocker = blockerIn(payload, ['zapisy']);

  if (payload !== null && payload.writes.locked === true) {
    const reason = payload.writes.lockedReason;
    return {
      tone: 'critical',
      label: 'Zápisy zastavené',
      title:
        reason === null || reason.trim() === ''
          ? 'Appka sama zastavila zápisy do shopu. Odomknúť ich treba v Nastaveniach.'
          : `Appka sama zastavila zápisy do shopu: ${reason} Odomknúť ich treba v Nastaveniach.`,
    };
  }
  if (payload === null || payload.writes.enabled === null) {
    return {
      tone: 'attention',
      label: 'Zápisy — nevieme',
      title: explain('Nepodarilo sa zistiť, či má appka zápisy do shopu zapnuté.', blocker),
    };
  }
  if (!payload.writes.enabled) {
    return {
      tone: resolutionTone(blocker?.resolution ?? 'mimo_appky'),
      label: 'Ostrý zápis vypnutý',
      title: explain(
        'Appka teraz do shopu nezapíše nič. Zapnúť to môže len správca počítača.',
        blocker,
      ),
    };
  }
  return {
    tone: 'good',
    label: 'Ostrý zápis zapnutý',
    title: 'Appka smie zapisovať do ostrého shopu — každý zápis je vidieť zákazníkom.',
  };
}

/**
 * STAV KATALÓGU. Neúplný katalóg je NEUTRÁLNY: synchronizácia beží sama a
 * čakanie nie je porucha (`resolution: 'cakanie'`). Prázdny katalóg jantárový —
 * ten sa sám nenaplní, kým ho niekto nespustí.
 */
export function catalogChip(payload: StatusPayload | null): StatusChip {
  const blocker = blockerIn(payload, ['katalog']);
  const loaded = payload?.catalog?.loadedProducts ?? null;

  if (payload === null || payload.catalog === null || loaded === null) {
    return {
      tone: 'attention',
      label: 'Katalóg — nevieme',
      title: explain('Stav katalógu sa nepodarilo prečítať.', blocker),
    };
  }

  const total = payload.catalog.shopTotalProducts;

  if (loaded === 0) {
    return {
      tone: blocker === null ? 'attention' : resolutionTone(blocker.resolution),
      label: 'Katalóg prázdny',
      title: explain(
        'Appka nemá načítaný ani jeden produkt zo shopu. Spusti načítanie katalógu v Produktoch.',
        blocker,
      ),
    };
  }
  if (total === null) {
    return {
      tone: 'idle',
      label: `Katalóg ${formatCountSk(loaded)}`,
      title: explain(
        `Načítaných je ${formatCountSk(loaded)} produktov; koľko ich má shop celkom, appka zatiaľ nevie.`,
        blocker,
      ),
    };
  }
  if (loaded >= total) {
    return {
      tone: 'good',
      label: 'Katalóg úplný',
      title: `Načítaných je všetkých ${formatCountSk(total)} produktov, ktoré shop hlási.`,
    };
  }
  return {
    tone: blocker === null ? 'idle' : resolutionTone(blocker.resolution),
    label: `Katalóg ${formatCountSk(loaded)} z ${formatCountSk(total)}`,
    title: explain(
      `Načítaných je ${formatCountSk(loaded)} z ${formatCountSk(total)} produktov.`,
      blocker,
    ),
  };
}

/* ═══════════════════════ 4. Denný rozpočet zápisov ════════════════════════ */

/**
 * Rozpočet buď MÁ čísla (a kreslí sa meracím prúžkom), alebo ich nemá — a vtedy
 * sa nedopĺňa nula, ale prizná sa medzera (hlavička, bod 3).
 */
export type BudgetView =
  | {
      readonly kind: 'meter';
      readonly label: string;
      readonly spent: number;
      readonly limit: number;
      /** Hotová fráza s predložkou („o 02:00"). `null` = nevieme kedy. */
      readonly resetsAt: string | null;
      readonly title: string;
    }
  | { readonly kind: 'unknown'; readonly chip: StatusChip };

/** Menovka prúžku. Jedno miesto — aby sa text v pruhu a v teste nerozišiel. */
export const BUDGET_LABEL = 'Zápisy dnes';

/**
 * Kedy sa denný rozpočet obnoví.
 *
 * Čas sa NEPOČÍTA tu: prichádza z prekážky, ktorú poslal server (`clearsAt`
 * pri `write_budget_*`). Appka tak nemá druhú, vlastnú predstavu o tom, kedy
 * je polnoc UTC — a v miestnom čase ju ukáže cez `formatResumeTime()`.
 */
export function budgetResetPhrase(payload: StatusPayload | null): string | null {
  const blocker = blockerIn(payload, ['rozpocet']);
  if (blocker === null || blocker.clearsAt === null) return null;
  return `o ${formatResumeTime(blocker.clearsAt)}`;
}

export function budgetView(payload: StatusPayload | null): BudgetView {
  const blocker = blockerIn(payload, ['rozpocet']);
  const budget = payload?.writeBudget ?? null;

  if (budget === null) {
    return {
      kind: 'unknown',
      chip: {
        tone: 'attention',
        label: 'Zápisy dnes — nevieme',
        title: explain('Koľko zápisov dnes odišlo, sa nepodarilo zistiť.', blocker),
      },
    };
  }

  return {
    kind: 'meter',
    label: BUDGET_LABEL,
    spent: budget.spent,
    limit: budget.budget,
    resetsAt: budgetResetPhrase(payload),
    title: explain(
      `Z denného rozpočtu ${formatCountSk(budget.budget)} zápisov je minutých ${formatCountSk(budget.spent)}.`,
      blocker,
    ),
  };
}

/* ═════════════════════════ 5. Zámky v navigácii ═══════════════════════════ */

/** Zámok na jednom tabe — zámok bez dôvodu sa v tejto appke nekreslí. */
export interface NavLock {
  readonly href: string;
  /** Čo je zamknuté — názov tabu, aby zámok dával zmysel aj mimo navigácie. */
  readonly label: string;
  /** Krátky dôvod do zámku v pruhu. */
  readonly reason: string;
  /** Celá veta aj s ďalším krokom — na hover a pre čítačku. */
  readonly title: string;
}

/**
 * Oblasti, ktoré zastavia zápis ako taký. Rozpočet ani rozsah medzi ne
 * NEPATRIA: pri vyčerpanom rozpočte sa zľava normálne založí a fronta ju
 * dopíše zajtra, takže tab zamknutý nie je.
 */
const WRITE_STOPPING_AREAS: readonly BlockerArea[] = ['zapisy', 'kluc'];

/**
 * Krátky dôvod k prekážke. Zámerne NIE je to prepis `blocker.what` — do zámku
 * v jednoriadkovom pruhu sa celá veta nezmestí a orezaná veta klame. Celá veta
 * ide do `title` a na cieľovú obrazovku.
 */
const LOCK_REASON: Readonly<Partial<Record<BlockerId, string>>> = {
  writes_disabled: 'ostrý zápis je vypnutý',
  key_missing: 'chýba kľúč na zápis',
  key_expired: 'kľúč expiroval',
};

/** Tab, ktorého hlavná akcia je zápis do shopu. */
const WRITE_TAB = { href: '/zlavy', label: 'Zľavy' } as const;

/**
 * Ktoré taby sú teraz nepoužiteľné a prečo.
 *
 * Zamknuté sa NESKRÝVA a odkaz zostáva živý (pravidlo `LockBadge`): zoznam
 * zliav sa dá čítať vždy, len sa z neho teraz nedá zapísať nová. Kým sa stav
 * načítava alebo kým nie sme prihlásení, zámok sa NEKRESLÍ — appka netvrdí
 * o zámku nič, kým nemá dôvod.
 */
export function navLocks(state: StatusState): readonly NavLock[] {
  if (state.kind !== 'ok' || state.payload === null) return [];
  const payload = state.payload;

  if (payload.writes.locked === true) {
    const reason = payload.writes.lockedReason;
    return [
      {
        ...WRITE_TAB,
        reason: 'nová zľava sa teraz nezapíše, zápisy zastavila poistka',
        title:
          reason === null || reason.trim() === ''
            ? 'Appka sama zastavila zápisy do shopu. Odomknúť ich treba v Nastaveniach.'
            : `Appka sama zastavila zápisy do shopu: ${reason} Odomknúť ich treba v Nastaveniach.`,
      },
    ];
  }

  const blocker =
    payload.blockers.find(
      (candidate) =>
        candidate.severity === 'blokuje' && WRITE_STOPPING_AREAS.includes(candidate.area),
    ) ?? null;
  if (blocker === null) return [];

  const reason = LOCK_REASON[blocker.id] ?? 'zápis do shopu sa teraz nedá spustiť';
  return [
    {
      ...WRITE_TAB,
      reason: `nová zľava sa teraz nezapíše, ${reason}`,
      title: explain('Zápis do shopu sa teraz nedá spustiť.', blocker),
    },
  ];
}
