/**
 * Aura Zľavy — HELPER na mock shop v testoch (BUILD-SPEC §12, INVARIANT I6).
 *
 * Toto je jediné miesto, kde sa nastavuje `SHOP_BASE_URL_OVERRIDE`. Helper:
 *   1. spustí mock na `127.0.0.1` + ephemeral porte,
 *   2. presmeruje naň klienta cez `SHOP_BASE_URL_OVERRIDE` (v produkcii je táto
 *      premenná fail-fast zakázaná — `src/env.ts`, `src/instrumentation-node.ts`),
 *   3. po teste ho zastaví a ENV vráti do pôvodného stavu.
 *
 * Použitie (vitest):
 *
 * ```ts
 * const mock = await useMockShop();          // beforeAll/afterAll spraví sám
 * mock.state.rateLimit(30);
 * ```
 * alebo manuálne `const mock = await startMockShopWithOverride()` + `mock.stop()`.
 *
 * POZOR na cache ENV: `src/env.ts` parsuje premenné pri prvom importe. Preto
 * helper override nastaví **skôr**, než test importuje modul, ktorý `env` číta —
 * v praxi to znamená `await useMockShop()` v `beforeAll` a dynamický `import()`
 * shop klienta v teste, ak si test klienta stavia sám.
 *
 * Vlastník: A6.
 */
import { afterAll, afterEach, beforeAll } from 'vitest';

import { DEFAULT_STATE_OPTIONS, VALID_API_KEY } from '../mock-shop/fixtures';
import { startMockShop, type MockShopServer, type StartMockShopOptions } from '../mock-shop/server';
import { MockShopState } from '../mock-shop/state';

export { VALID_API_KEY, NO_SCOPE_API_KEY, UNKNOWN_API_KEY } from '../mock-shop/fixtures';
export { MockShopState } from '../mock-shop/state';

const ENV_OVERRIDE_KEY = 'SHOP_BASE_URL_OVERRIDE';

export interface RunningMockShop extends MockShopServer {
  /** Zastaví server a vráti `SHOP_BASE_URL_OVERRIDE` do pôvodného stavu. */
  stop(): Promise<void>;
}

/**
 * Spustí mock a nastaví `SHOP_BASE_URL_OVERRIDE`. Default katalóg aj kľúče sú
 * z `fixtures.ts`; `options.state` umožní priniesť si vlastný stav.
 */
export async function startMockShopWithOverride(
  options: StartMockShopOptions = {},
): Promise<RunningMockShop> {
  const server = await startMockShop({ ...DEFAULT_STATE_OPTIONS, ...options });
  const previous = process.env[ENV_OVERRIDE_KEY];
  process.env[ENV_OVERRIDE_KEY] = server.baseUrl;

  return {
    ...server,
    state: server.state,
    async close() {
      await server.close();
    },
    async stop() {
      if (previous === undefined) delete process.env[ENV_OVERRIDE_KEY];
      else process.env[ENV_OVERRIDE_KEY] = previous;
      await server.close();
    },
  };
}

/**
 * Registruje mock pre celý testovací súbor: `beforeAll` ho spustí, `afterEach`
 * mu resetuje scenáre a `recordedRequests`, `afterAll` ho zastaví.
 *
 * Vracia stabilný obal — `handle.state` a `handle.baseUrl` sú platné až po
 * `beforeAll`, preto sú to gettery, nie hodnoty.
 */
export interface MockShopHandle {
  readonly baseUrl: string;
  readonly port: number;
  readonly state: MockShopState;
  /** Kľúč, ktorý mock považuje za platný (scope `product:edit`). */
  readonly apiKey: string;
}

export function useMockShop(options: StartMockShopOptions = {}): MockShopHandle {
  let running: RunningMockShop | null = null;

  const require_ = (): RunningMockShop => {
    if (running === null) {
      throw new Error('mock shop ešte nebeží — použi `useMockShop()` a čítaj až v testoch');
    }
    return running;
  };

  beforeAll(async () => {
    running = await startMockShopWithOverride(options);
  });

  afterEach(() => {
    // Scenáre ani história sa nesmú prelievať medzi testami.
    running?.state.reset();
  });

  afterAll(async () => {
    await running?.stop();
    running = null;
  });

  return {
    get baseUrl() {
      return require_().baseUrl;
    },
    get port() {
      return require_().port;
    },
    get state() {
      return require_().state;
    },
    apiKey: VALID_API_KEY,
  };
}

/**
 * Jednorazový mock pre jeden test — `await using` friendly tvar bez globálnych
 * hooks. Vždy volaj `stop()` vo `finally`.
 */
export async function withMockShop<T>(
  fn: (mock: RunningMockShop) => Promise<T>,
  options: StartMockShopOptions = {},
): Promise<T> {
  const mock = await startMockShopWithOverride(options);
  try {
    return await fn(mock);
  } finally {
    await mock.stop();
  }
}

/** Prázdny stav bez produktov a bez kľúčov — pre testy „nič nie je nastavené". */
export function emptyMockState(): MockShopState {
  return new MockShopState({ products: [], keys: [] });
}
