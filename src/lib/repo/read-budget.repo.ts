/**
 * Aura Zľavy — repozitár tabuľky `shop_read_budget` (migrácia 0013;
 * KONTRAKT-DOKONCENIE-2026-08-12: A4).
 *
 * Perzistentná polovica zdieľaného počítadla čítaní zo shopu. Logika (stropy,
 * dráhy, fail-closed pravidlá) žije v `@/lib/shop/read-budget`; tu je len SQL a
 * jeden singleton, aby si všetci čitatelia shopu brali TO ISTÉ počítadlo.
 *
 * Prečo perzistentne a nie v pamäti: synchronizácia katalógu trvá dva dni a musí
 * prežiť reštart appky aj vypnutý počítač. Počítadlo v pamäti by sa po reštarte
 * vynulovalo a appka by strop shopu prekročila práve vtedy, keď je najbližšie
 * k banu.
 *
 * Čo sa tu nesmie pokaziť:
 *  - **Pripočítava sa, neprepisuje.** `ON DUPLICATE KEY UPDATE reads_used =
 *    reads_used + VALUES(reads_used)` — dva zdroje čítaní si tak nemôžu
 *    navzájom prepísať spotrebu na nulu.
 *  - **Žiadny zápisový rozpočet.** Táto tabuľka nemá s `write_attempt` (K2) nič
 *    spoločné a nikdy nesmie mať — zápisy majú vlastnú kvótu na kľúč.
 *  - **I4** — žiadny prístup k `audit_log`.
 *
 * Raw parametrizované SQL, žiadne ORM; do SQL sa neinterpoluje žiadna hodnota.
 *
 * Vlastník: V7 (katalóg).
 */
import type { DateOnly, Queryable } from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import {
  createReadBudget,
  type ReadBudget,
  type ReadBudgetStore,
  type ReadLane,
} from '@/lib/shop/read-budget';

/* ═══════════════════════════════ SQL ══════════════════════════════════════ */

const SQL_USED = 'SELECT reads_used FROM shop_read_budget WHERE lane = ? AND utc_day = ? LIMIT 1';

const SQL_ADD =
  'INSERT INTO shop_read_budget (lane, utc_day, reads_used) VALUES (?, ?, ?) ' +
  'ON DUPLICATE KEY UPDATE reads_used = reads_used + VALUES(reads_used)';

/* ═══════════════════════════════ Factory ══════════════════════════════════ */

export interface ReadBudgetRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export function createReadBudgetStore(deps: ReadBudgetRepoDeps = {}): ReadBudgetStore {
  const run = async <T>(sql: string, values: unknown[]): Promise<T> => {
    if (deps.defaultConn) return (await deps.defaultConn.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const readUsed = async (lane: ReadLane, day: DateOnly): Promise<number> => {
    const rows = await run<Array<{ reads_used: number | bigint | null }>>(SQL_USED, [lane, day]);
    const value = Array.isArray(rows) ? rows[0]?.reads_used : null;
    return value == null ? 0 : Number(value);
  };

  return {
    used: readUsed,

    async add(lane: ReadLane, day: DateOnly, count: number): Promise<number> {
      const delta = Math.max(0, Math.trunc(count));
      if (delta > 0) await run(SQL_ADD, [lane, day, delta]);
      // Nová hodnota sa dočíta späť, nie dopočíta: medzi `used()` a `add()` mohol
      // pripočítať aj druhý čitateľ shopu a UI má vidieť skutočný stav.
      return readUsed(lane, day);
    },
  };
}

/** Úložisko nad produkčným poolom. */
export const readBudgetStore: ReadBudgetStore = createReadBudgetStore();

/**
 * ZDIEĽANÉ počítadlo anonymných čítaní (bez kľúča) — katalóg a čokoľvek ďalšie,
 * čo číta shop bez `X-Api-Key`. Toto je tá jedna inštancia, o ktorú si majú
 * pýtať všetci; vlastné počítadlo si nezakladá nikto.
 */
export const anonReadBudget: ReadBudget = createReadBudget({
  store: readBudgetStore,
  lane: 'anon',
});

/**
 * ZDIEĽANÉ počítadlo čítaní S objednávkovým kľúčom (predajnosť, `orders:read`).
 * Existuje tu preto, aby `lib/sales/*` nemusel poznať SQL ani stropy — stačí mu
 * `orderReadBudget.reserve()` pred každým volaním shopu (A4).
 */
export const ordersReadBudget: ReadBudget = createReadBudget({
  store: readBudgetStore,
  lane: 'orders',
});

/**
 * ZDIEĽANÉ počítadlo čítaní `getFull` so ZÁPISOVÝM kľúčom v scope
 * `product:read` — obohacovanie katalógu (D118) a overenie zľavy v shope
 * (`/api/catalog/reduction-check`).
 *
 * Prečo to NIE JE `anonReadBudget` (stav do 31. 8. 2026): `getFull` je čítanie
 * S KĽÚČOM, takže shop ho účtuje NA KĽÚČ (~200/UTC deň), kým `anon` je strop
 * NA IP, z ktorého žije dvojdňová synchronizácia katalógu. Účtovaním do `anon`
 * si obohacovanie bralo cudzí strop: konzervatívne voči banu, ale katalóg tým
 * dostával menej, než mu patrí — a naopak, obohacovanie sa zastavilo na 240
 * namiesto 160, čo je práve to číslo, ktoré shop sleduje.
 *
 * Prečo to NIE JE `ordersReadBudget`, hoci má rovnaké čísla: je to INÝ KĽÚČ
 * (`shop_write` vs. `orders_read`) a shop účtuje na kľúč. Jedno počítadlo pre
 * obe by znamenalo, že predajnosť a obohacovanie si navzájom kradnú strop,
 * ktorý v skutočnosti nezdieľajú.
 */
export const productReadBudget: ReadBudget = createReadBudget({
  store: readBudgetStore,
  lane: 'product_read',
});
