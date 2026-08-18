'use client';

/**
 * Aura Zľavy — SPOLOČNÉ OBNOVOVANIE ČÍSEL NA VYŽIADANIE (kontrakt UI, bod 4).
 *
 * Do 13. 8. si každá obrazovka ťahala svoje čísla vlastným `setInterval`om —
 * stavový pruh každých 30 s, hlavička s frontou každých 60 s, Prehľad po
 * svojom. Používateľ tak čítal riadok, ktorý sa mu pod rukami prepísal, a pri
 * appke, ktorá zapisuje do ostrého shopu, je to horšie než staré číslo: nedá
 * sa ukázať prstom na to, čo bolo vidieť pred sekundou.
 *
 * Preto sa automatické obnovovanie RUŠÍ a nahrádza jediným mechanizmom:
 * čísla sa načítajú raz pri otvorení a potom vždy, keď si to niekto vypýta
 * tlačidlom Obnoviť. Obnovujú sa VŠETKY naraz — jeden žetón, ktorý počúvajú
 * všetky registrované načítania.
 *
 * AKO SA TO POUŽÍVA NA OBRAZOVKE
 * ------------------------------
 *
 *     const { pending } = useRefreshable(async () => {
 *       setData(await fetchJson('/api/nieco'));
 *     });
 *
 * Načítanie zbehne pri pripojení komponentu a potom pri každom stlačení
 * Obnoviť. Tlačidlo samo je v stavovom pruhu a volá `requestRefresh()` —
 * obrazovka si vlastné nekreslí.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Žiadny časovač.** V tomto module nie je `setInterval` ani `setTimeout`
 *    a nesmie sem pribudnúť. Je to celý dôvod jeho existencie: keď sa sem
 *    vráti automatika, vráti sa aj problém, kvôli ktorému vznikol.
 *
 * 2. **Žetón sa mení LEN na požiadanie.** Nie pri prepnutí tabu, nie pri
 *    návrate do okna, nie po chybe. Čokoľvek z toho je „pohlo sa to samo".
 *
 * 3. **Čas poslednej aktualizácie je MERANÝ, nie odhadnutý.** Hook hlási čas
 *    dokončenia svojho načítania; kto potrebuje presnejší údaj (napr. čas
 *    servera zo snapshotu), berie si ho z odpovede, nie odtiaľto.
 *
 * 4. **Zlyhané načítanie nemlčí.** Výnimka z `load` sa prehltne (jeden pokazený
 *    endpoint nesmie zhodiť celý chróm), ale `pending` sa vždy vypne — inak by
 *    tlačidlo Obnoviť zostalo navždy v stave „obnovujem".
 *
 * Vlastník: L1.
 */
import { useEffect, useRef, useState } from 'react';

/** Načítanie, ktoré sa má zopakovať pri každom vyžiadaní. */
export type RefreshLoad = (token: number) => void | Promise<void>;

/* ═══════════════════════════ Modulový obchod ══════════════════════════════ */

/** Poradové číslo vyžiadania. Rastie VÝHRADNE v `requestRefresh()`. */
let token = 0;
/** Koľko registrovaných načítaní práve beží. */
let running = 0;

const tokenListeners = new Set<(next: number) => void>();
const busyListeners = new Set<(next: number) => void>();

function announceBusy(): void {
  for (const listener of busyListeners) listener(running);
}

/**
 * Vyžiada obnovu všetkých registrovaných čísel. Volá to tlačidlo Obnoviť
 * v stavovom pruhu; obrazovky si vlastné tlačidlo nekreslia.
 */
export function requestRefresh(): void {
  token += 1;
  for (const listener of tokenListeners) listener(token);
}

/* ═══════════════════════════════ Hooky ════════════════════════════════════ */

/** Čo o jednom registrovanom načítaní vieme. */
export interface RefreshState {
  /** Kedy načítanie naposledy dobehlo (ms). `null` = ešte ani raz. */
  readonly at: number | null;
  /** Beží práve teraz. */
  readonly pending: boolean;
}

/**
 * Zaregistruje načítanie do spoločného obnovovania.
 *
 * `load` sa smie pokojne písať ako anonymná funkcia priamo vo volaní — jej
 * identita sa zámerne NEsleduje. Sledovať ju by znamenalo, že sa čísla načítajú
 * znova pri každom prekreslení komponentu, čo je automatické obnovovanie
 * zadnými dverami.
 */
export function useRefreshable(load: RefreshLoad): RefreshState {
  const [ticket, setTicket] = useState(token);
  const [at, setAt] = useState<number | null>(null);
  const [pending, setPending] = useState(true);

  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });

  useEffect(() => {
    tokenListeners.add(setTicket);
    setTicket(token);
    return () => {
      tokenListeners.delete(setTicket);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setPending(true);
    running += 1;
    announceBusy();

    void (async () => {
      try {
        await latest.current(ticket);
      } catch {
        // Jeden pokazený endpoint nesmie zhodiť chróm. Že sa nič nenačítalo,
        // povie obrazovka svojím vlastným „nevieme", nie výnimka v konzole.
      } finally {
        running -= 1;
        if (alive) {
          setAt(Date.now());
          setPending(false);
        }
        announceBusy();
      }
    })();

    return () => {
      alive = false;
    };
  }, [ticket]);

  return { at, pending };
}

/** Ovládanie pre tlačidlo Obnoviť. */
export interface RefreshBus {
  /** Beží aspoň jedno registrované načítanie. */
  readonly busy: boolean;
  readonly refresh: () => void;
}

/**
 * Stav spoločného obnovovania pre tlačidlo v pruhu. `busy` je pravdivé, kým
 * beží čokoľvek registrované — tlačidlo tak nehlási hotovo skôr než obrazovka.
 */
export function useRefreshBus(): RefreshBus {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const listener = (next: number) => setBusy(next > 0);
    busyListeners.add(listener);
    listener(running);
    return () => {
      busyListeners.delete(listener);
    };
  }, []);

  return { busy, refresh: requestRefresh };
}
