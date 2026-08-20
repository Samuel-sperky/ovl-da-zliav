/**
 * Aura Zľavy — overenie OBJEDNÁVKOVÉHO kľúča pred jeho uložením (P2, P5, I8').
 *
 * Prečo tento súbor vôbec existuje:
 *
 * `/api/key` nesmie uložiť kľúč, ktorý shop odmietne — pri zápisovom kľúči to
 * rieši sonda `reduction=0` (D53) v `lib/shop/client.ts`. Objednávkový kľúč sa
 * musí overiť analogicky, teda skutočným čítaním objednávok. To ale podľa
 * INVARIANTU I8' smie robiť VÝHRADNE modul `src/lib/shop/orders-client.ts`.
 * Route ho preto nevolá priamo (a tento súbor tiež nie) — volá sondu, ktorú si
 * objednávkový klient sem zaregistruje.
 *
 * Dohodnuté rozhranie (kontrakt medzi `/api/key` a objednávkovým klientom):
 *
 * ```ts
 * // v src/lib/shop/orders-client.ts, pri načítaní modulu:
 * import { registerOrdersKeyProbe } from '@/lib/keys/orders-key-probe';
 * export const probeOrdersKey: OrdersKeyProbe = async (key, ctx) => { … };
 * registerOrdersKeyProbe(probeOrdersKey);
 * ```
 *
 * Sonda vracia rovnaký `KeyProbeResult` ako sonda zápisového kľúča:
 *   - `valid`     — shop čítanie objednávok povolil (HTTP 200),
 *   - `forbidden` — kľúč shop prijal, ale nemá scope na čítanie objednávok (403),
 *   - `invalid`   — shop kľúč odmietol (401),
 *   - `unknown`   — sieťová/technická chyba, o kľúči sa nedá povedať nič.
 *
 * FAIL-CLOSED: kým sonda registrovaná nie je, `/api/key` objednávkový kľúč
 * NEULOŽÍ a povie prečo. Nikdy sa nesmie stať, že sa neoverený kľúč uloží
 * s hláškou „uložené" — to je presne ten tichý neúspech, ktorý appka zakazuje.
 *
 * Umiestnenie: ZÁMERNE mimo `src/lib/shop/` — ten modul má uzavretý zoznam
 * súborov (test `shop-errors.spec.ts`) a tento súbor patrí ku ceste kľúča, nie
 * ku klientovi shopu.
 *
 * Vlastník: A11 (`/api/key`). Objednávkový klient tento súbor iba používa.
 */
import type { KeyProbeResult, SecretRef, ShopCtx } from '@/contracts';

/** Sonda objednávkového kľúča — implementuje ju výhradne objednávkový klient. */
export type OrdersKeyProbe = (key: SecretRef, ctx: ShopCtx) => Promise<KeyProbeResult>;

/**
 * Hláška, keď sonda ešte nie je zapojená. Je pravdivá: appka nevie kľúč overiť,
 * takže ho neuloží — nepredstiera ani úspech, ani že kľúč je zlý.
 */
export const ORDERS_PROBE_MISSING_MESSAGE =
  'Objednávkový klient shopu ešte nie je zapojený, takže kľúč sa nedá overiť — ' +
  'kľúč sa NEULOŽIL. Toto je stav appky, nie chyba tvojho kľúča.';

/** Kód chyby pre `/api/key`, aby ju UI vedelo odlíšiť od odmietnutého kľúča. */
export const ORDERS_PROBE_MISSING_CODE = 'orders_probe_unavailable';

let registered: OrdersKeyProbe | null = null;

/**
 * Zaregistruje sondu. Volá to objednávkový klient pri načítaní svojho modulu.
 * Opakované volanie prepíše predchádzajúcu registráciu (HMR v dev režime).
 */
export function registerOrdersKeyProbe(probe: OrdersKeyProbe): void {
  registered = probe;
}

/** Zaregistrovaná sonda, alebo `null` — volajúci MUSÍ `null` riešiť fail-closed. */
export function getOrdersKeyProbe(): OrdersKeyProbe | null {
  return registered;
}

/** Výhradne pre testy: vráti registráciu do výchozieho stavu. */
export function resetOrdersKeyProbe(): void {
  registered = null;
}
