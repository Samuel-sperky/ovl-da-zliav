/**
 * Aura Zľavy — BRÁNA PRED `npm test` (audit kvality testov, 24. 8. 2026).
 *
 * PREČO EXISTUJE
 * --------------
 * `npm test` bolo holé `vitest run`. Štrnásť súborov v `test/integration/` sa
 * vešia na `describe.skipIf(!available)` a `dbAvailable()` chybu spojenia
 * prehltlo, takže bez bežiacej MariaDB ticho zmizlo 129 testov a exit kód bol
 * 0. Balík tak vedel byť „zelený" bez jediného dôkazu o migráciách (A0),
 * grantoch nad `audit_log` (I4), strope allowlistu (I2) a redakcii kľúča (I1).
 * To isté platilo v CI — keby service kontajner MariaDB nenabehol, workflow by
 * prešiel.
 *
 * ČO ROBÍ
 * -------
 * Pripojí sa na testovaciu DB. Keď to nejde, vypíše KDE to skúšal, PREČO to
 * zlyhalo a KTORÉ súbory by boli ticho vypadli — a skončí s exit kódom 1, takže
 * `npm test` sa k vitestu vôbec nedostane. Beží ako `pretest`.
 *
 * Kto naozaj chce bežať bez databázy, má na to `npm run test:unit` (tam sa nič
 * nepreskakuje, lebo tam žiadny DB-viazaný test nie je) alebo vedomé
 * `ALLOW_SKIP_DB_TESTS=1`, ktoré si vypýta hlasné varovanie na stderr.
 *
 * Beží priamo cez `node scripts/require-test-db.ts` (Node 22+ type stripping).
 * Rovnako ako `scripts/migrate.ts` neimportuje NIČ lokálne a vystačí si
 * s `node:*` a `mariadb`: brána musí fungovať sama o sebe a `test/helpers/db.ts`
 * sa z Node bez `.ts` prípony v ceste importovať nedá (a s ňou zase padá
 * `tsc --noEmit`). Preto je tu vlastné spojenie — je to sedem riadkov, nie
 * druhá kópia helpera.
 *
 * INVARIANT I1: do výstupu ide host, port a názov schémy — NIKDY heslo. Hláška
 * ovládača sa pred vypísaním redaguje.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import mariadb from 'mariadb';

/**
 * Rovnaké ENV defaulty ako `test/setup.ts` a `test/helpers/db.ts`. Vitest ich
 * nastaví sám, ale táto brána beží PRED ním, takže si ich musí doplniť — inak
 * by sa pýtala inej databázy než testy, ktoré stráži.
 */
const HOST = process.env.DB_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DB_PORT ?? 3306);
const DATABASE = process.env.DB_NAME ?? 'ovl_zliav_test';
const USER = process.env.DB_MIGRATION_USER ?? 'ovl_zliav_mig';
const PASSWORD = process.env.DB_MIGRATION_PASSWORD ?? 'test_mig_password';

/** Meno ENV premennej, ktorou sa dá preskočenie povoliť (`test/helpers/db.ts`). */
const SKIP_ENV = 'ALLOW_SKIP_DB_TESTS';

/** Heslo sa do terminálu ani do CI logu nedostane ani cez hlášku ovládača (I1). */
function redact(text: string): string {
  return PASSWORD.length > 0 ? text.split(PASSWORD).join('***') : text;
}

/**
 * Súbory, ktoré by bez DB ticho vypadli. Zisťuje sa to skenom, nie zoznamom —
 * ručne písaný zoznam by o mesiac klamal.
 */
function dbGatedSpecs(): string[] {
  const dir = resolve(process.cwd(), 'test', 'integration');
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.spec.ts'))
    .filter((name) => readFileSync(join(dir, name), 'utf8').includes('describe.skipIf(!available)'))
    .sort();
}

const target = `${HOST}:${PORT}/${DATABASE}`;
let reason: string | null = null;

try {
  const conn = await mariadb.createConnection({
    host: HOST,
    port: PORT,
    user: USER,
    password: PASSWORD,
    connectTimeout: 5000,
  });
  await conn.end();
} catch (error) {
  reason = redact(error instanceof Error ? error.message : String(error));
}

if (reason === null) {
  process.stdout.write(`[DB] testovacia MariaDB ${target} odpovedá — integračné testy pobežia.\n`);
  process.exit(0);
}

const gated = dbGatedSpecs();
const zoznam =
  gated.length > 0
    ? gated.map((name) => `      - test/integration/${name}`).join('\n')
    : '      (sken nenašiel ani jeden — skontroluj test/integration/)';

process.stderr.write(
  [
    '',
    '  ✖ Testovacia MariaDB nie je dostupná, takže `npm test` NEBEŽÍ.',
    '',
    `      kde:    ${target} (user ${USER})`,
    `      dôvod:  ${reason}`,
    '',
    '    Bez nej by sa TICHO preskočilo týchto ' + String(gated.length) + ' súborov a balík',
    '    by bol zelený bez dôkazu o migráciách (A0), grantoch nad audit_log (I4),',
    '    strope allowlistu (I2) a redakcii kľúča (I1):',
    zoznam,
    '',
    '    Riešenie:  docker compose up -d ovl-zliav-test-db',
    '    Bez DB:    npm run test:unit   (nepreskakuje sa nič — DB-viazané testy tam nie sú)',
    `    Vedome:    ${SKIP_ENV}=1 npx vitest run   (preskočenie sa vypíše na stderr)`,
    '',
  ].join('\n'),
);
process.exit(1);
