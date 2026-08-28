/**
 * Aura Zľavy — spoločná konfigurácia e2e behu (A18).
 *
 * Tento modul je bez side-effectov, aby ho mohol importovať aj `playwright.config.ts`,
 * aj harness (`serve.ts`), aj fixtures v testovacích workeroch.
 *
 * INVARIANT I6: každá adresa je `127.0.0.1`; reálna doména shopu tu nie je
 * a nikdy nebude. `shopDomain` je `.invalid` TLD (RFC 2606) — neexistujúci host.
 * INVARIANT I1: žiadne reálne tajomstvo — všetko tu je syntetické. Heslo tu
 * od 27. 8. 2026 nie je vôbec: prihlásenie zmizlo (D99), takže e2e nemá čo
 * vypĺňať ani čím sa autentifikovať.
 *
 * Vlastník: A18.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

/**
 * Koreň repozitára. Playwright transpiluje TS do CJS, takže `import.meta.url`
 * tu nie je k dispozícii — koreň hľadáme podľa `package.json` nad cwd.
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolvePath(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

/** Jediný povolený host pre appku, mock aj control server (I6, I5). */
export const E2E_HOST = '127.0.0.1';

export const E2E_CONFIG = {
  appPort: Number(process.env.E2E_PORT ?? 3131),
  controlPort: Number(process.env.E2E_CONTROL_PORT ?? 3132),
  dbHost: process.env.DB_HOST ?? E2E_HOST,
  dbPort: Number(process.env.DB_PORT ?? 3306),
  dbName: process.env.DB_NAME ?? 'ovl_zliav_e2e',
  dbUser: process.env.DB_USER ?? 'ovl_zliav_app',
  dbPassword: process.env.DB_PASSWORD ?? 'test_app_password',
  migUser: process.env.DB_MIGRATION_USER ?? 'ovl_zliav_mig',
  migPassword: process.env.DB_MIGRATION_PASSWORD ?? 'test_mig_password',
  masterKeyFile: process.env.MASTER_KEY_FILE ?? 'secrets/e2e-master.key',
  sessionSecretFile: process.env.SESSION_SECRET_FILE ?? 'secrets/e2e-session.key',
  /**
   * TLS pre e2e (F.6). Pôvodným dôvodom bola `Secure` session cookie (D69) —
   * tá 27. 8. 2026 zmizla (D99). Certifikát zostáva, pretože harness
   * (`serve.ts`) appku ďalej servuje cez HTTPS a `APP_BASE_URL` nižšie na to
   * spoléha. Je self-signed, generuje ho harness do gitignorovaného
   * `secrets/` a Playwright ho akceptuje cez `ignoreHTTPSErrors`
   * (viď `playwright.config.ts`). Do repa sa nedostane
   * (I1: `secrets/`, `*.key`, `*.pem` sú v `.gitignore`).
   */
  tlsKeyFile: 'secrets/e2e-tls.key',
  tlsCertFile: 'secrets/e2e-tls.pem',
  /**
   * Meno riadku v `users`, ktorý harness seeduje. Po D99 to NIE JE
   * prihlasovacie meno — nikde sa ním neprihlasuje, existuje len preto, že
   * `campaigns.created_by` a `audit_log.user_id` majú FK na `users(id)`
   * (D101). `E2E_ADMIN_PASSWORD` k nemu zaniklo spolu s prihlásením.
   */
  adminUsername: process.env.E2E_ADMIN_USERNAME ?? 'e2e-admin',
  /** Doména v `settings`. Nikdy sa na ňu nepripája — klient ide na mock (I6). */
  shopDomain: 'https://shop.e2e.invalid',
} as const;

/** Appka beží cez HTTPS (self-signed) — tak ju harness servuje (viď `tlsKeyFile`). */
export const APP_BASE_URL = `https://${E2E_HOST}:${E2E_CONFIG.appPort}`;
export const CONTROL_BASE_URL = `http://${E2E_HOST}:${E2E_CONFIG.controlPort}`;
