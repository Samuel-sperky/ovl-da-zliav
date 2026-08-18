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
 *    nevedel prečítať), menovka na jej mieste ukáže POMLČKU a zdvihne príznak
 *    `unknown` — dôvod si pruh vyzdvihne do rozkliku (kontrakt UI, bod 5).
 *    Nula sem nepatrí: nula je tvrdenie, pomlčka je priznaná medzera.
 *
 * 4. **Jeden dotaz na celý chróm a NIKDY sám od seba.** Stav ťahá zdieľaný
 *    modulový store, nie každý komponent zvlášť, a spúšťa ho spoločné
 *    obnovovanie z `layout/refresh.ts` — teda otvorenie obrazovky a tlačidlo
 *    Obnoviť, nič iné. Časovač tu bol do 13. 8. 2026 a bol zrušený
 *    rozhodnutím používateľa: čísla sa nesmú pohnúť pod rukami. `useStatus()`
 *    sa smie volať z ľubovoľného počtu komponentov — dotaz bude jeden.
 *
 * 5. **Dátum a čas sú vždy konkrétne.** „Platí do 09.09.2026", nie „ešte 48 h";
 *    „Stav k 12:53", nie „pred 3 minútami" (kontrakt UI, bod 10). Odpočet
 *    a relatívny čas sa v tomto module nepoužívajú.
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
import { useRefreshable } from '@/components/layout/refresh';
import type { StatusTone } from '@/components/ui/ToneBadge';
import type { BlockerArea, BlockerId, BlockerResolution } from '@/lib/status/blockers';
import type { BlockerWire, StatusPayload } from '@/lib/status/snapshot';
import { formatDateSk, formatDateTimeSk } from '@/lib/ui/format';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═════════════════════════ 1. Sťahovanie stavu ════════════════════════════ */

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

/* ── Zdieľaný store: N komponentov, jeden dotaz (bod 4 v hlavičke). ──────── */

type Listener = (state: StatusState) => void;

let current: StatusState = LOADING;
const listeners = new Set<Listener>();
/** Posledné kolo obnovy, ktoré sa už sťahovalo. Bráni N dotazom pri N odberoch. */
let loadedTicket = -1;

async function loadStatus(ticket: number): Promise<void> {
  // Druhý (tretí, štvrtý…) odberateľ v tom istom kole si dotaz nezopakuje —
  // výsledok mu doručí listener, keď dobehne ten prvý.
  if (loadedTicket === ticket) return;
  loadedTicket = ticket;
  current = await fetchStatusOutcome();
  for (const listener of listeners) listener(current);
}

/**
 * Stav appky tak, ako sa naposledy načítal.
 *
 * Načíta sa pri otvorení obrazovky a potom už len na vyžiadanie (tlačidlo
 * Obnoviť v stavovom pruhu). Sám sa NEobnovuje — pozri bod 4 v hlavičke
 * modulu.
 */
export function useStatus(): StatusState {
  const [state, setState] = useState<StatusState>(current);

  useEffect(() => {
    listeners.add(setState);
    setState(current);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  useRefreshable(loadStatus);

  return state;
}

/**
 * KEDY BOLI ČÍSLA V PRUHU NAČÍTANÉ.
 *
 * Berie sa čas SERVERA zo snapshotu (`payload.now`), nie hodiny prehliadača:
 * pruh hovorí o tom, ku ktorému okamihu appka svoje fakty prečítala. Keď stav
 * nepoznáme, je tu pomlčka — nie čas, ktorý by si prehliadač domyslel.
 */
export interface StatusFreshness {
  readonly label: string;
  readonly title: string;
  /** `true` = čas nepoznáme; pruh na to nasadí pomlčku a rozklik. */
  readonly unknown: boolean;
}

export function statusFreshness(state: StatusState): StatusFreshness {
  if (state.kind !== 'ok' || state.payload === null) {
    return {
      label: '—',
      title: 'Kedy sa stav naposledy načítal, appka teraz nevie.',
      unknown: true,
    };
  }
  const when = new Date(state.payload.now);
  if (!Number.isFinite(when.getTime())) {
    return {
      label: '—',
      title: 'Času, ku ktorému stav platí, appka nerozumie.',
      unknown: true,
    };
  }
  const stamp = formatDateTimeSk(when);
  const sameDay = formatDateSk(when) === formatDateSk(new Date());
  return {
    label: sameDay ? stamp.slice(-5) : stamp,
    title: `Čísla v pruhu sú z ${stamp}. Novšie budú po stlačení tlačidla Obnoviť — appka ich sama neprepisuje.`,
    unknown: false,
  };
}

/**
 * PREKÁŽKY: bráni niečo zápisu?
 *
 * Jediné miesto, kde sa táto otázka odpovedá pre celý chróm aj pre obrazovky.
 * Kontrakt UI, bod 3: keď nič neprekáža, obrazovka NEKRESLÍ sekciu prekážok —
 * stačí zelená značka v pruhu. Obrazovky sa preto pýtajú sem a nepočítajú si
 * prekážky po svojom.
 */
export function hasBlockers(state: StatusState): boolean {
  if (state.kind !== 'ok' || state.payload === null) return false;
  return state.payload.blockers.length > 0;
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
  /**
   * Hodnotu sa nepodarilo zistiť, takže v menovke stojí POMLČKA (kontrakt UI,
   * bod 5). Pruh si takéto menovky pozbiera do jedného rozkliku „Prečo —",
   * aby dôvod nebol na povrchu, ale bol dočítateľný (P6).
   */
  readonly unknown?: boolean;
}

/** Znak pre „toto appka nevie". Nikdy nie nula — nula je tvrdenie. */
const NEVIEME = '—';

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
      title: 'Stav appky sa zobrazí po prihlásení. Nie je to porucha appky.',
    };
  }
  if (state.kind === 'unreachable' || state.payload === null) {
    return {
      tone: 'critical',
      label: 'Appka neodpovedá',
      title:
        'Appka neodpovedala na otázku o svojom stave. Tlačidlom Obnoviť sa to dá skúsiť znova; ak sa nič nezmení, appka nebeží.',
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
 * KĽÚČ NA ZÁPIS — DOKEDY PLATÍ.
 *
 * Píše sa DÁTUM, nie odpočet (kontrakt UI, bod 10). Odpočet „ešte 48 h" je
 * pri fronte bežiacej týždne nepoužiteľný: nedá sa porovnať s dátumom štartu
 * zľavy a mení sa pri každom pohľade. Dátum sa dá porovnať a zapamätať.
 *
 * Expirovaný kľúč je jantárový, nie červený: nič sa nestratilo a rieši sa to
 * vložením nového kľúča v Nastaveniach (K2, `blockers.ts`).
 */
export function keyChip(payload: StatusPayload | null): StatusChip {
  const blocker = blockerIn(payload, ['kluc']);
  const tone = blocker === null ? 'good' : resolutionTone(blocker.resolution);

  if (payload === null || payload.apiKey.present === null) {
    return {
      tone: 'attention',
      label: `Kľúč ${NEVIEME}`,
      unknown: true,
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
      label: `Kľúč do ${NEVIEME}`,
      unknown: true,
      title: explain('Kľúč je vložený, ale nevieme, dokedy platí.', blocker),
    };
  }

  const expires = new Date(payload.apiKey.expiresAt).getTime();
  if (!Number.isFinite(expires)) {
    return {
      tone: 'attention',
      label: `Kľúč do ${NEVIEME}`,
      unknown: true,
      title: explain('Kľúč je vložený, ale jeho platnosti nerozumieme.', blocker),
    };
  }

  const day = formatDateSk(payload.apiKey.expiresAt);
  if (expires <= payloadNow(payload)) {
    return {
      tone: 'attention',
      label: 'Kľúč vypršal',
      title: explain(
        `Kľúč na zápis platil do ${day}. Nový sa vkladá v Nastaveniach.`,
        blocker,
      ),
    };
  }
  return {
    tone,
    label: `Kľúč do ${day}`,
    title: explain(
      `Kľúč na zápis platí do ${day}; potom sa v Nastaveniach vkladá nový.`,
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
      label: `Zápisy ${NEVIEME}`,
      unknown: true,
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
      label: `Katalóg ${NEVIEME}`,
      unknown: true,
      title: explain('Stav katalógu sa nepodarilo prečítať.', blocker),
    };
  }

  const total = payload.catalog.shopTotalProducts;

  if (loaded === 0) {
    return {
      tone: blocker === null ? 'attention' : resolutionTone(blocker.resolution),
      label: 'Katalóg prázdny',
      title: explain(
        'Appka nemá načítaný ani jeden produkt zo shopu. Načítanie katalógu sa spúšťa v Produktoch.',
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
 * ROZPOČET PRE OBRAZOVKU S ROZPADOM (Nastavenia → „Kľúče a rozpočet").
 *
 * Buď MÁ čísla — a vtedy sa kreslí meracím prúžkom `ui/BudgetMeter` — alebo ich
 * nemá, a vtedy sa nedopĺňa nula, ale prizná sa medzera (hlavička, bod 3).
 * Do stavového pruhu tento tvar NEIDE: tam patrí len číslo z `budgetChip()`.
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

/**
 * ROZPOČET DO PRUHU — LEN ČÍSLO (kontrakt UI, bod 15).
 *
 * V pruhu nie je merací prúžok ani rozpad na kľúče: pruh je chróm a musí ostať
 * jeden riadok. `21/200 dnes` povie o rýchlosti presne toľko, koľko sa dá
 * prečítať za pol sekundy; celý rozpad má svoje miesto v Nastaveniach
 * (kotva „Kľúče a rozpočet") a kreslí ho tamojšia obrazovka cez `budgetView()`.
 *
 * Tón je VŽDY neutrálny, aj pri 200/200 (K2, odpoveď 59): vyčerpaný rozpočet
 * je plánovaná rýchlosť, nie chyba. Pri vyčerpaní pribudne za číslo čas, kedy
 * sa pokračuje — neosobne, bez „pokračujem".
 */
export function budgetChip(payload: StatusPayload | null): StatusChip {
  const blocker = blockerIn(payload, ['rozpocet']);
  const budget = payload?.writeBudget ?? null;

  if (budget === null) {
    return {
      tone: 'attention',
      label: `Zápisy dnes ${NEVIEME}`,
      unknown: true,
      title: explain('Koľko zápisov dnes odišlo, sa nepodarilo zistiť.', blocker),
    };
  }

  const count = `${formatCountSk(budget.spent)}/${formatCountSk(budget.budget)}`;
  const resume = budgetResetPhrase(payload);
  const exhausted = budget.remaining <= 0;
  return {
    tone: 'idle',
    label:
      exhausted && resume !== null
        ? `Zápisy ${count} dnes · ďalšie ${resume}`
        : `Zápisy ${count} dnes`,
    title: explain(
      `Z denného rozpočtu ${formatCountSk(budget.budget)} zápisov je minutých ${formatCountSk(budget.spent)}.`,
      blocker,
    ),
  };
}

export function budgetView(payload: StatusPayload | null): BudgetView {
  const blocker = blockerIn(payload, ['rozpocet']);
  const budget = payload?.writeBudget ?? null;

  if (budget === null) {
    return { kind: 'unknown', chip: budgetChip(payload) };
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
