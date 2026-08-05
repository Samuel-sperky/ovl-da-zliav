/**
 * Aura Zľavy — generátor master key / session secret (D61, §7, I1).
 *
 * Použitie:
 *   npm run gen-master-key                      -> secrets/master.key
 *   npm run gen-master-key -- secrets/session.key
 *   npm run gen-master-key -- --force secrets/master.key
 *
 * Vytvorí 32 náhodných bajtov v hex tvare (64 znakov), zapíše ich do súboru
 * s právami `0400` a NIKDY nevypíše obsah na stdout (I1).
 *
 * POZOR (D62): rotácia master key sa nerieši tooling-om. Nový master key
 * znamená, že existujúci záznam v `api_key` sa už nedá dešifrovať — musí sa
 * wipnúť a API kľúč zadať v UI znova.
 *
 * Beží priamo cez `node scripts/gen-master-key.ts` (Node 22 type stripping).
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY_BYTES = 32;
const DEFAULT_TARGET = 'secrets/master.key';

export function generateKeyHex(): string {
  return randomBytes(KEY_BYTES).toString('hex');
}

function main(argv: string[]): void {
  const force = argv.includes('--force');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const target = resolve(positional[0] ?? DEFAULT_TARGET);

  if (existsSync(target) && !force) {
    console.error(
      `[gen-master-key] ${target} už existuje. Prepísanie znefunkční uložený API kľúč ` +
        '(D62: nový master key = wipe záznamu + nové zadanie kľúča v UI).\n' +
        'Ak to naozaj chceš, spusti to s --force.',
    );
    process.exit(1);
  }

  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  // Zápis s právami 0600, potom sprísnenie na 0400 (D61).
  writeFileSync(target, `${generateKeyHex()}\n`, { mode: 0o600, flag: 'w' });
  chmodSync(target, 0o400);

  console.log(`[gen-master-key] hotovo: ${target} (${KEY_BYTES} B, hex, chmod 400)`);
  console.log('[gen-master-key] Ďalšie kroky:');
  console.log('  1) vlastník súboru musí byť uid appky (v compose 10050:10050),');
  console.log('  2) bind-mount do kontajnera ako :ro,');
  console.log('  3) súbor NIKDY necommituj — `secrets/` je v .gitignore (I1).');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
