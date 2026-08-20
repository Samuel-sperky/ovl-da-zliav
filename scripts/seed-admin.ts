/**
 * Aura Zľavy — vytvorenie/zmena admin používateľa (D68, SPRINT-PLAN §3 bod 2).
 *
 * Interaktívne: `npm run seed-admin`. Meno ani heslo sa NEZAPISUJE do repa,
 * neposiela sa v argumentoch (aby neskončilo v histórii shellu) a heslo sa pri
 * písaní nezobrazuje.
 *
 * - argon2id s OWASP parametrami m=19456 KiB, t=2, p=1 (SPRINT-PLAN §3 bod 1 —
 *   presné parametre „podľa sperky-ai" nemáme, toto je dohodnutý default).
 * - minimálna dĺžka hesla 12 znakov, žiadne zložitostné pravidlá (D68).
 * - hash sa vypisuje LEN ako potvrdenie prefixu; plaintext hesla nikdy (I1).
 *
 * Beží priamo cez `node scripts/seed-admin.ts` (Node 22 type stripping), preto
 * neimportuje nič z `src/`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import argon2 from 'argon2';
import mariadb from 'mariadb';

const MIN_PASSWORD_LENGTH = 12;
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

function ask(question: string, mask: boolean): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise<string>((resolvePrompt) => {
    if (mask) {
      // Vypneme echo: readline pri `terminal: true` posiela znaky sám,
      // preto ich prepíšeme hviezdičkami cez vlastný _writeToOutput.
      const target = rl as unknown as { _writeToOutput?: (s: string) => void };
      target._writeToOutput = (chunk: string) => {
        if (chunk.includes(question)) process.stdout.write(question);
        else process.stdout.write('*');
      };
    }
    rl.question(question, (answer) => {
      if (mask) process.stdout.write('\n');
      rl.close();
      resolvePrompt(answer);
    });
  });
}

function readSecretFile(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  const e = process.env;
  const passwordFile = e.DB_PASSWORD_FILE;
  const passwordPlain = e.DB_PASSWORD;
  if (!passwordFile && passwordPlain === undefined) {
    throw new Error('Chýba DB_PASSWORD_FILE alebo DB_PASSWORD — bez DB heslá nezapíšem.');
  }

  const username = (await ask('Prihlasovacie meno admina: ', false)).trim();
  if (username.length < 3 || username.length > 64) {
    throw new Error('Meno musí mať 3–64 znakov.');
  }

  const password = await ask(`Heslo (min. ${MIN_PASSWORD_LENGTH} znakov): `, true);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Heslo musí mať aspoň ${MIN_PASSWORD_LENGTH} znakov (D68).`);
  }
  const again = await ask('Heslo znova: ', true);
  if (password !== again) {
    throw new Error('Heslá sa nezhodujú.');
  }

  const hash = await argon2.hash(password, ARGON2_OPTIONS);

  const conn = await mariadb.createConnection({
    host: e.DB_HOST ?? '127.0.0.1',
    port: Number(e.DB_PORT ?? 3306),
    database: e.DB_NAME ?? 'ovl_zliav',
    user: e.DB_USER ?? 'ovl_zliav_app',
    password: passwordFile ? readSecretFile(passwordFile) : (passwordPlain as string),
    timezone: 'Z',
    multipleStatements: false,
  });

  try {
    await conn.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?) ' +
        'ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
      [username, hash],
    );
    const rows = (await conn.query('SELECT id FROM users WHERE username = ?', [
      username,
    ])) as Array<{ id: number }>;
    console.log(
      `[seed-admin] hotovo: user "${username}" (id ${rows[0]?.id ?? '?'}), ` +
        `hash argon2id ${hash.slice(0, 26)}…`,
    );
    console.log('[seed-admin] Heslo sa nikam nezapisuje — ulož si ho do správcu hesiel.');
  } finally {
    await conn.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(`[seed-admin] CHYBA: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
