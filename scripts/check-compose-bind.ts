/**
 * Aura Zľavy — CI kontrola compose bindov (I5, R10, D78, D96).
 *
 * Zlyhá (exit 1), ak:
 *  - `ovl-zliav-app` alebo `ovl-zliav-db` majú `ports:`,
 *  - `ovl-zliav-caddy` publikuje čokoľvek iné než presne `127.0.0.1:3070:3070`,
 *  - existuje služba pomenovaná `app`, `db`, `web` alebo `caddy` (pasca R10 —
 *    kolízia network aliasov v rodine stackov),
 *  - chýba niektorá z povinných služieb.
 *
 * Kontroluje `docker-compose.yml` a — ak existuje — aj
 * `docker-compose.override.yml` a `docker-compose.override.example.yml`.
 *
 * Bez závislostí (package.json je zamknutý): jednoduchý riadkový parser YAML
 * postačuje, lebo compose súbor vlastní A14 a drží konzistentné odsadenie.
 * Spúšťa sa cez `npm run check-compose-bind` (Node 22 type stripping) aj
 * importuje z `test/unit/compose-bind.spec.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ComposeService {
  name: string;
  /** riadky publikovaných portov, napr. '127.0.0.1:3070:3070' */
  ports: string[];
}

export interface ComposeCheckResult {
  ok: boolean;
  errors: string[];
  services: ComposeService[];
}

const REQUIRED_SERVICES = ['ovl-zliav-app', 'ovl-zliav-db', 'ovl-zliav-caddy'] as const;
const FORBIDDEN_SERVICE_NAMES = ['app', 'db', 'web', 'caddy'] as const;
const ONLY_ALLOWED_PORT = '127.0.0.1:3070:3070';
const CADDY_SERVICE = 'ovl-zliav-caddy';

/** Zmaž komentár mimo úvodzoviek (postačuje pre náš compose formát). */
function stripComment(line: string): string {
  const idx = line.indexOf('#');
  if (idx === -1) return line;
  // hrubé, ale bezpečné: ak je '#' vnútri úvodzoviek, nechaj riadok tak
  const before = line.slice(0, idx);
  const quotes = (before.match(/"/g) ?? []).length;
  return quotes % 2 === 0 ? before : line;
}

/**
 * Riadkový parser: nájde blok `services:`, v ňom mená služieb (odsadenie 2)
 * a pod každou službou položky `ports:` (odsadenie 4) s ich zoznamom.
 */
export function parseComposeServices(yamlText: string): ComposeService[] {
  const lines = yamlText.split('\n');
  const services: ComposeService[] = [];
  let inServices = false;
  let current: ComposeService | null = null;
  let inPorts = false;

  for (const rawLine of lines) {
    const line = stripComment(rawLine).replace(/\s+$/, '');
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent === 0) {
      inServices = trimmed === 'services:';
      current = null;
      inPorts = false;
      continue;
    }
    if (!inServices) continue;

    if (indent === 2 && trimmed.endsWith(':')) {
      current = { name: trimmed.slice(0, -1), ports: [] };
      services.push(current);
      inPorts = false;
      continue;
    }
    if (!current) continue;

    if (indent === 4) {
      if (trimmed === 'ports:' || trimmed.startsWith('ports:')) {
        inPorts = true;
        // inline flow zoznam: ports: ["127.0.0.1:3070:3070"]
        const inline = trimmed.match(/^ports:\s*\[(.*)\]\s*$/);
        if (inline) {
          for (const item of inline[1].split(',')) {
            const v = item.trim().replace(/^["']|["']$/g, '');
            if (v) current.ports.push(v);
          }
          inPorts = false;
        } else if (trimmed !== 'ports:') {
          // ports: <skalár> — nevalidné v compose, ale zaznamenaj
          current.ports.push(trimmed.slice('ports:'.length).trim());
          inPorts = false;
        }
        continue;
      }
      inPorts = false;
      continue;
    }

    if (inPorts && indent >= 6 && trimmed.startsWith('-')) {
      const v = trimmed.slice(1).trim().replace(/^["']|["']$/g, '');
      if (v) current.ports.push(v);
    }
  }
  return services;
}

/** Vyhodnotí invariant I5 + pascu R10 nad jedným compose súborom. */
export function checkComposeText(yamlText: string, opts?: { requireAll?: boolean }): ComposeCheckResult {
  const requireAll = opts?.requireAll ?? true;
  const services = parseComposeServices(yamlText);
  const errors: string[] = [];
  const names = services.map((s) => s.name);

  for (const forbidden of FORBIDDEN_SERVICE_NAMES) {
    if (names.includes(forbidden)) {
      errors.push(
        `Služba '${forbidden}' je zakázaná (pasca R10) — použi ovl-zliav-* mená, inak network alias koliduje s iným stackom.`,
      );
    }
  }

  if (requireAll) {
    for (const required of REQUIRED_SERVICES) {
      if (!names.includes(required)) {
        errors.push(`Chýba povinná služba '${required}' (R10).`);
      }
    }
  }

  for (const svc of services) {
    if (svc.name === CADDY_SERVICE) {
      if (requireAll && svc.ports.length === 0) {
        errors.push(`'${CADDY_SERVICE}' musí publikovať presne '${ONLY_ALLOWED_PORT}' (I5, D96).`);
      }
      for (const p of svc.ports) {
        if (p !== ONLY_ALLOWED_PORT) {
          errors.push(
            `'${CADDY_SERVICE}' publikuje '${p}' — povolené je výhradne '${ONLY_ALLOWED_PORT}' (I5, D96).`,
          );
        }
      }
    } else if (svc.ports.length > 0) {
      errors.push(
        `Služba '${svc.name}' má ports: [${svc.ports.join(', ')}] — žiadna služba okrem '${CADDY_SERVICE}' nesmie publikovať port (I5, D96).`,
      );
    }
  }

  return { ok: errors.length === 0, errors, services };
}

/** Skontroluje compose súbory v koreňovom adresári repa. */
export function checkComposeFiles(repoRoot: string): ComposeCheckResult {
  const mainPath = join(repoRoot, 'docker-compose.yml');
  if (!existsSync(mainPath)) {
    return { ok: false, errors: [`Chýba ${mainPath}.`], services: [] };
  }
  const result = checkComposeText(readFileSync(mainPath, 'utf8'), { requireAll: true });
  const errors = [...result.errors];

  for (const override of ['docker-compose.override.yml', 'docker-compose.override.example.yml']) {
    const p = join(repoRoot, override);
    if (!existsSync(p)) continue;
    const r = checkComposeText(readFileSync(p, 'utf8'), { requireAll: false });
    for (const e of r.errors) errors.push(`[${override}] ${e}`);
  }

  return { ok: errors.length === 0, errors, services: result.services };
}

/* ── main ──────────────────────────────────────────────────────────────── */
const isMain = process.argv[1]?.endsWith('check-compose-bind.ts');
if (isMain) {
  const result = checkComposeFiles(process.cwd());
  if (!result.ok) {
    console.error('check-compose-bind: PORUŠENIE INVARIANTU I5 / R10:');
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `check-compose-bind: OK — jediný publikovaný port je ${ONLY_ALLOWED_PORT} na ${CADDY_SERVICE} (I5).`,
  );
}
