/**
 * Aura Zľavy — SLOVNÍK A POISTKA PROTI ŽARGÓNU (V3; K10, P3, architektúra §4).
 *
 * Dve časti, jeden cieľ:
 *
 *  A. `src/lib/ui/vocabulary.ts` prekladá KAŽDÝ vnútorný kód a na výstupe z neho
 *     nesmie zostať ani jeden — ani vtedy, keď kód nepozná.
 *  B. Grep cez `src/app/**` a `src/components/**`: keď sa žargón vráti do textu,
 *     ktorý používateľ VIDÍ, test padne. Je to jediná poistka, ktorú nemožno
 *     obísť „veď to je len dočasné".
 *
 * ── Prečo je skener taký opatrný ──────────────────────────────────────────────
 *
 * Test, ktorý pípa na `import { allowlistRepo }`, na `status === 'needs_key'`
 * alebo na `className="allowlist-grid"`, nikto nevydrží a o mesiac ho niekto
 * vypne. Preto skener hľadá VÝHRADNE text, ktorý sa vykreslí:
 *
 *   1. reťazcové literály, ktoré vyzerajú ako veta (medzera + aspoň dve slová),
 *   2. JSX text medzi značkami (aj s `{...}` výrazmi vnútri).
 *
 * A naopak — zámerne NEVIDÍ:
 *
 *   · `import`/`export … from` riadky (názvy modulov a symbolov),
 *   · hodnoty technických atribútov (`className`, `href`, `key`, `data-*` …);
 *     `title`, `alt`, `placeholder` a `aria-label` medzi ne NEPATRIA — tie
 *     používateľ číta, takže sa kontrolujú,
 *   · komentáre (vysvetliť invariant v komentári je správne, nie zakázané),
 *   · jednoslovné literály bez medzery (`'needs_key'` ako hodnota v porovnaní,
 *     v `Record` kľúči, v `fetch('/api/allowlist')` alebo v triede).
 *
 * Cena za to je známa a vedomá: grep vidí LITERÁLY, nie hodnoty premenných.
 * `<td>{item.status}</td>` vykreslí surový kód a tento test o tom nevie —
 * pred takou vecou chráni pravidlo „stav ide vždy cez `vocabulary.ts`", nie
 * regulárny výraz. Radšej menej falošných poplachov než test, ktorý sa vypne.
 *
 * ── Čo sa neskenuje a prečo ───────────────────────────────────────────────────
 *
 * `src/app/api/**` (samé `.ts`, žiadne JSX) je vrstva API, nie povrch. Jej
 * hlášky sa na obrazovku dostávajú cez `guardSentence()` / `itemSentence()`,
 * takže žargón v nich zastaví časť A tohto testu. Skenujú sa preto `.tsx`
 * z `src/app` a `.ts`/`.tsx` z `src/components` (tam žijú aj `api.ts` klienti
 * s hláškami, ktoré sa vykresľujú priamo).
 *
 * Skener je zámerne DUPLIKOVANÝ z `no-orders-scope.spec.ts` namiesto zdieľaného
 * helpera: V3 nevlastní žiadny spoločný testovací modul a import medzi spec
 * súbormi by testy druhého súboru zaregistroval dvakrát.
 *
 * Vlastník: V3.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_STATE,
  CAMPAIGN_STATUS_CODES,
  GUARD_CODES_KNOWN,
  GUARD_SENTENCES,
  ITEM_SENTENCES,
  STATE_TONES,
  SURFACE_STATES,
  SURFACE_TERMS,
  campaignModeSentence,
  campaignSentence,
  formatCountSk,
  guardSentence,
  itemSentence,
  pluralSk,
  queueSentence,
  todayHere,
  writeBudgetSentence,
} from '@/lib/ui/vocabulary';
import { formatDateSk } from '@/lib/ui/format';
import type { ItemStatus } from '@/contracts';

/* ═══════════════════════ 0. Zakázané výrazy (K10, §4) ═════════════════════ */

interface Rule {
  /** Ako sa pravidlo volá v hlásení. */
  readonly name: string;
  readonly pattern: RegExp;
  /** Čím sa to má nahradiť — aby hlásenie neboli len „nesmieš". */
  readonly instead: string;
}

const RULES: readonly Rule[] = [
  {
    name: 'needs_key',
    pattern: /needs?[_\- ]?key/i,
    instead: `„${SURFACE_TERMS.keyMissing}" (K10)`,
  },
  {
    name: 'dry-run',
    pattern: /dry[\s_-]?run/i,
    instead: `„${SURFACE_TERMS.dryRun}" (K10)`,
  },
  {
    name: 'allowlist',
    pattern: /allow[\s_-]?list/i,
    instead: `„${SURFACE_TERMS.allowlist}" (K10)`,
  },
  {
    name: 'setReduction',
    pattern: /set[\s_-]?reduction/i,
    instead: '„zapísať zľavu" — názov endpointu shopu na povrch nepatrí (K10)',
  },
  {
    name: 'kód invariantu alebo rozhodnutia (I3, D28, K10)',
    pattern: /\b[IDK]\d{1,3}\b/,
    instead: 'veta, ktorá povie, čo sa stalo; kód patrí do „Technického detailu" (P6)',
  },
  {
    name: 'HTTP kód',
    // `§` je stopa po `${…}` — `HTTP ${status}` je kód rovnako ako `HTTP 404`.
    pattern: /\bhttp[\s-]*(?:\d|§|kód|kod|status|code|chyb)/i,
    instead: 'ľudský dôvod z `itemSentence()`; kód shopu až v „Technickom detaile" (P6)',
  },
  {
    name: 'camelCase kód',
    pattern: /\b[a-z]+[A-Z][A-Za-z]*\b/,
    instead: 'slovenská veta zo slovníka — vnútorný identifikátor na povrch nepatrí (K10)',
  },
  {
    name: 'snake_case kód',
    pattern: /\b[a-z]{2,}(?:_[a-z0-9]{2,})+\b/,
    instead: 'slovenská veta zo slovníka — kód stavu ani názov tabuľky na povrch nepatria (K10)',
  },
];

/** Slová, ktoré §4 zakazuje ako STAV zľavy (a slovník ich nesmie vyrobiť). */
const FORBIDDEN_STATE_WORDS = [
  'aktívna',
  'naplánovaná',
  'čaká',
  'chyba',
  'zlyhala',
  'needs_key',
  'draft',
  'pending',
] as const;

/* ═════════════════════════════ 1. Skener zdrojov ══════════════════════════ */

interface SourceFile {
  readonly path: string;
  readonly code: string;
}

interface SurfaceText {
  readonly path: string;
  readonly line: number;
  readonly kind: 'literál' | 'JSX';
  readonly text: string;
}

function listFiles(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, pattern));
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out.sort();
}

/** Odstráni `//` a `/* *\/` komentáre, zachová reťazce a počet riadkov. */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  while (i < source.length) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'template';
      out += ch;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += ch;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      if (ch === '\n') out += ch;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      out += ch + next;
      i += 2;
      continue;
    }
    if (
      (state === 'single' && ch === "'") ||
      (state === 'double' && ch === '"') ||
      (state === 'template' && ch === '`')
    ) {
      state = 'code';
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Prepíše zhody medzerami — zdroj sa skráti o obsah, nie o riadky. */
function blank(source: string, pattern: RegExp): string {
  return source.replace(pattern, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * Atribúty, ktorých hodnota je technická. `title`, `alt`, `placeholder`
 * a `aria-label` v zozname ZÁMERNE nie sú — tie používateľ číta.
 *
 * `raw`, `rawCode`, `rawDetail` sú v zozname preto, že K10 žargón v rozkliku
 * „Technický detail" VÝSLOVNE povoľuje a prop pomenovaný `raw*` je presne ten
 * rozklik. Je to jediná úniková cesta v tomto teste a je viditeľná v kóde —
 * nie magický komentár, ktorý sa dá dopísať kamkoľvek.
 */
const TECHNICAL_ATTRS =
  /\b(?:className|class|style|key|id|htmlFor|href|src|srcSet|rel|target|method|action|type|name|role|scope|colSpan|rowSpan|tabIndex|raw|rawCode|rawDetail|data-[\w-]+)\s*=\s*(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})/g;

function prepare(raw: string): string {
  let code = stripComments(raw);
  code = blank(code, /^[ \t]*import\b[^;]*;/gm);
  // Len re-exporty (`export { X } from '…'`). Voľnejší vzor by zožral aj
  // `export const x = { from: … };` aj s hláškami vnútri.
  code = blank(code, /^[ \t]*export\s+(?:\*|\{[^}]*\})\s*from\s*['"][^'"]*['"]\s*;/gm);
  code = blank(code, TECHNICAL_ATTRS);
  return code;
}

function lineAt(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (code[i] === '\n') line += 1;
  return line;
}

/** Reťazcové literály (`'`, `"`, `` ` ``) aj s pozíciou riadku. */
function extractStringLiterals(code: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let i = 0;
  let line = 1;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      const startLine = line;
      let text = '';
      i += 1;
      while (i < code.length) {
        const c = code[i];
        if (c === '\\') {
          text += ' ';
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        if (c === '\n') line += 1;
        text += c;
        i += 1;
      }
      out.push({ line: startLine, text });
      continue;
    }
    i += 1;
  }
  return out;
}

/**
 * Končí `>` na pozícii `gtIndex` značku? Odfiltruje `=>` a porovnania.
 * Generiká (`useState<Foo>(…)`) tým NEPREJDÚ — na tie je `CODE_FRAGMENT`.
 */
function isTagEnd(code: string, gtIndex: number): boolean {
  const lt = code.lastIndexOf('<', gtIndex);
  if (lt === -1) return false;
  const inner = code.slice(lt + 1, gtIndex);
  if (inner.includes('>')) return false;
  return /^[A-Za-z/]/.test(inner);
}

/** JSX text medzi značkami; `{výraz}` sa z neho vyhodí, text okolo zostáva. */
function extractJsxText(code: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  const re = />([^<]*)</g;
  let match: RegExpExecArray | null = re.exec(code);
  while (match !== null) {
    if (isTagEnd(code, match.index)) {
      const chunk = match[1] ?? '';
      let text = chunk;
      let previous = '';
      while (text !== previous) {
        previous = text;
        text = text.replace(/\{[^{}]*\}/g, ' ');
      }
      if (text.trim() !== '') out.push({ line: lineAt(code, match.index), text });
    }
    match = re.exec(code);
  }
  return out;
}

/**
 * Znaky, ktoré v texte pre používateľa nebývajú, ale v kóde áno. Zátvorky sú
 * v zozname zámerne: generiká a volania (`labelOf<T>(x): string`) inak vyzerajú
 * ako JSX text. Cena je známa — vetu so zátvorkou skener preskočí. To je ten
 * správny smer omylu: radšej nechytiť, než pípať na kód.
 */
const CODE_FRAGMENT = /[{}[\]();=|]|&&|=>/;
const WORD = /[A-Za-zÀ-ÖØ-öø-ž]{2,}/g;

/**
 * `${…}` v šablóne sa nahradí `§`, NIE medzerou. Medzera by z cesty
 * `` `/api/allowlist/${id}/mark-unknown` `` vyrobila „vetu o dvoch slovách"
 * a skener by pípal na URL. So `§` zostane cesta jedným tokenom a veta
 * (`Vybraných ${n} produktov`) si medzery ponechá.
 */
function normalize(text: string): string {
  return text.replace(/\$\{[^}]*\}/g, '§').trim();
}

function wordCount(text: string): number {
  return (text.match(WORD) ?? []).length;
}

/**
 * Je to text, ktorý používateľ uvidí?
 *
 * Literál musí vyzerať ako VETA: medzera medzi slovami a aspoň dve slová.
 * Samotná podmienka „dve slová" nestačí — `not_found` má tiež dve, lebo `_`
 * slová oddeľuje. Preto je medzera povinná; kód sa do jedného tokenu zmestí
 * vždy, veta nikdy.
 *
 * JSX text smie byť aj jednoslovný (`<span>zlacnené</span>`), ale len keď je to
 * naozaj slovo — nie zvyšok porovnania typu `{a > b && …}`.
 */
function isSurfaceText(text: string, kind: SurfaceText['kind']): boolean {
  const t = normalize(text);
  if (t === '' || CODE_FRAGMENT.test(t)) return false;
  if (/\s/.test(t) && wordCount(t) >= 2) return true;
  if (kind === 'JSX' && wordCount(t) === 1 && /^[\wÀ-ÖØ-öø-ž.,!?:·%€–—-]+$/.test(t)) return true;
  return false;
}

function surfaceTexts(files: readonly SourceFile[]): SurfaceText[] {
  const out: SurfaceText[] = [];
  for (const file of files) {
    for (const hit of extractStringLiterals(file.code)) {
      if (isSurfaceText(hit.text, 'literál')) {
        out.push({ path: file.path, line: hit.line, kind: 'literál', text: normalize(hit.text) });
      }
    }
    // JSX žije len v `.tsx`; v `.ts` sú `>` a `<` výhradne operátory a generiká.
    if (!file.path.endsWith('.tsx')) continue;
    for (const hit of extractJsxText(file.code)) {
      if (isSurfaceText(hit.text, 'JSX')) {
        out.push({ path: file.path, line: hit.line, kind: 'JSX', text: normalize(hit.text) });
      }
    }
  }
  return out;
}

function load(dir: string, pattern: RegExp): SourceFile[] {
  return listFiles(resolve(process.cwd(), dir), pattern).map((path) => ({
    path: relative(process.cwd(), path).split('\\').join('/'),
    code: prepare(readFileSync(path, 'utf8')),
  }));
}

const SURFACE_FILES: readonly SourceFile[] = [
  ...load('src/app', /\.tsx$/),
  ...load('src/components', /\.(ts|tsx)$/),
];

const SURFACE_TEXTS = surfaceTexts(SURFACE_FILES);

function violations(rule: Rule): string[] {
  return SURFACE_TEXTS.filter((t) => rule.pattern.test(t.text)).map(
    (t) => `${t.path}:${t.line} (${t.kind})  «${t.text}»`,
  );
}

function report(rule: Rule, hits: readonly string[]): string {
  if (hits.length === 0) return '';
  return [
    `Zakázaný výraz na povrchu — ${rule.name}. Namiesto neho: ${rule.instead}.`,
    ...hits,
  ].join('\n');
}

/* ══════════════════════ A. Slovník je jediný prekladač ════════════════════ */

describe('K10 — slovník prekladá každý vnútorný kód', () => {
  it('stav zľavy má presne štyri slová a nič iné', () => {
    expect([...SURFACE_STATES]).toEqual(['pripravená', 'zapisuje sa', 'beží', 'skončila']);
    for (const status of CAMPAIGN_STATUS_CODES) {
      expect(SURFACE_STATES, `stav ${status}`).toContain(CAMPAIGN_STATE[status]);
    }
    expect(Object.keys(STATE_TONES).sort()).toEqual([...SURFACE_STATES].sort());
  });

  it('každý stav zľavy vrátane `queued` má vetu', () => {
    for (const status of CAMPAIGN_STATUS_CODES) {
      const sentence = campaignSentence({ status, today: '2026-08-10' });
      expect(sentence.text.length, `stav ${status}`).toBeGreaterThan(0);
      expect(sentence.text.startsWith(sentence.state), `stav ${status}`).toBe(true);
    }
  });

  it('každý stav položky má krátky tvar aj ľudský dôvod', () => {
    const statuses: readonly ItemStatus[] = [
      'pending',
      'ok',
      'failed',
      'uncertain',
      'not_found',
      'blocked',
      'interrupted',
      'skipped',
    ];
    for (const status of statuses) {
      const entry = ITEM_SENTENCES[status];
      expect(entry.label.length, `položka ${status}`).toBeGreaterThan(0);
      expect(entry.reason.length, `položka ${status}`).toBeGreaterThan(10);
      expect(itemSentence(status)).toEqual(entry);
    }
  });

  it('každý kód guardu má vetu a neznámy kód sa nikdy nezobrazí surový', () => {
    for (const code of GUARD_CODES_KNOWN) {
      expect(GUARD_SENTENCES[code].text.length, `guard ${code}`).toBeGreaterThan(0);
    }
    const unknown = guardSentence('nieco_co_este_neexistuje');
    expect(unknown.text).not.toContain('nieco_co_este_neexistuje');
    expect(unknown.text).not.toContain('_');
    expect(itemSentence('celkom_novy_stav').label).not.toContain('_');
  });

  /**
   * Najdôležitejšie tvrdenie celého súboru: keby slovník sám hovoril žargónom,
   * grep nad obrazovkami by nechytil nič — obrazovka len zobrazí, čo dostane.
   */
  it('ani jedna veta zo slovníka neobsahuje žargón', () => {
    const produced: string[] = [
      ...Object.values(SURFACE_TERMS),
      ...Object.values(ITEM_SENTENCES).flatMap((s) => [s.label, s.reason]),
      ...Object.values(GUARD_SENTENCES).flatMap((s) => (s.hint === null ? [s.text] : [s.text, s.hint])),
      ...CAMPAIGN_STATUS_CODES.map(
        (status) =>
          campaignSentence({
            status,
            today: '2026-08-10',
            failedCount: 12,
            lateCount: 3,
            paused: true,
            budgetExhausted: true,
            adminChanged: true,
            writesStopped: true,
            startShiftedTo: '2026-09-06',
          }).text,
      ),
      campaignModeSentence('eager'),
      campaignModeSentence('scheduled'),
      guardSentence('cokolvek_neznanie').text,
      queueSentence(3420, 8000),
      queueSentence(0, 0),
      writeBudgetSentence(100, 200).text,
      writeBudgetSentence(200, 200).text,
    ];

    for (const rule of RULES) {
      const hits = produced.filter((text) => rule.pattern.test(text));
      expect(hits.join('\n'), `slovník sám používa ${rule.name}`).toBe('');
    }
  });

  it('slovník nepoužíva stavové slová, ktoré §4 zakazuje', () => {
    const states = CAMPAIGN_STATUS_CODES.map((status) =>
      campaignSentence({ status, today: '2026-08-10' }).state.toLowerCase(),
    );
    for (const word of FORBIDDEN_STATE_WORDS) {
      expect(states, `zakázané stavové slovo „${word}"`).not.toContain(word);
    }
  });

  it('príznak stojí za stavom, nikdy namiesto neho (§4)', () => {
    const s = campaignSentence({
      status: 'running',
      failedCount: 12,
      today: '2026-08-10',
    });
    expect(s.state).toBe('zapisuje sa');
    expect(s.text).toBe('zapisuje sa · 12 sa nepodarilo');
    expect(s.tone).toBe('progress');
    expect(s.flags.map((f) => f.tone)).toEqual(['attention']);
  });

  it('vyčerpaný rozpočet je informácia, nie chyba (K2)', () => {
    const s = campaignSentence({ status: 'queued', budgetExhausted: true, today: '2026-08-10' });
    expect(s.state).toBe('zapisuje sa');
    expect(s.flags.map((f) => f.tone)).toEqual(['neutral']);
    expect(writeBudgetSentence(200, 200).tone).toBe('neutral');
    expect(writeBudgetSentence(200, 200).text).toContain('pokračujem');
  });

  it('červená je len pre zastavený zápis, nie pre zlyhané položky (§4)', () => {
    const failedItems = campaignSentence({ status: 'running', failedCount: 12, today: '2026-08-10' });
    expect(failedItems.flags.some((f) => f.tone === 'critical')).toBe(false);

    const stopped = campaignSentence({ status: 'running', writesStopped: true, today: '2026-08-10' });
    expect(stopped.flags.some((f) => f.tone === 'critical')).toBe(true);
  });

  it('chýbajúci kľúč netvrdí, že sa zapisuje, kým sa nič nezapísalo (K6)', () => {
    const nothingYet = campaignSentence({ status: 'needs_key', today: '2026-08-10' });
    expect(nothingYet.state).toBe('pripravená');
    expect(nothingYet.text).toBe(`pripravená · ${SURFACE_TERMS.keyMissing}`);

    const midQueue = campaignSentence({ status: 'needs_key', itemsWritten: 3420, today: '2026-08-10' });
    expect(midQueue.state).toBe('zapisuje sa');
  });

  it('okno platnosti rozhoduje, či dopísaná zľava beží alebo skončila (§4)', () => {
    const common = { status: 'done', dateFrom: '2026-09-04', dateTo: '2026-09-18' } as const;
    expect(campaignSentence({ ...common, today: '2026-08-10' }).state).toBe('pripravená');
    expect(campaignSentence({ ...common, today: '2026-09-10' }).state).toBe('beží');
    expect(campaignSentence({ ...common, today: '2026-09-19' }).state).toBe('skončila');
  });

  it('deň sa počíta v Europe/Bratislava, nikdy v UTC', () => {
    // 22:30 UTC 9. 8. je v Bratislave už 10. 8. (CEST +2). V UTC by vyšiel 9. 8.
    expect(todayHere(new Date('2026-08-09T22:30:00Z'))).toBe('2026-08-10');
    // A v zime (+1) tiež — kontrola, že to nie je natvrdo posunutých 120 minút.
    expect(todayHere(new Date('2026-01-09T23:30:00Z'))).toBe('2026-01-10');
  });

  it('slovenské tvary po číslovke (CLDR sk: 1 / 2–4 / ostatné)', () => {
    expect(pluralSk(1, 'produkt', 'produkty', 'produktov')).toBe('produkt');
    expect(pluralSk(3, 'produkt', 'produkty', 'produktov')).toBe('produkty');
    expect(pluralSk(0, 'produkt', 'produkty', 'produktov')).toBe('produktov');
    expect(pluralSk(22, 'produkt', 'produkty', 'produktov')).toBe('produktov');
    expect(formatCountSk(40483)).toBe('40 483');
    // Jediný formátovač dátumu v UI je `formatDateSk` (kontrakt UI bod 10).
    // `dayMonthSk` (`4. 9.`) aj `formatDayMonthSk` (`04.09.`) sú od 20. 8. 2026
    // zmazané — tvar dátumu na povrchu stráži `test/unit/datumy-povrch.spec.ts`.
    expect(formatDateSk('2026-09-04')).toBe('4. 9. 2026');
    expect(queueSentence(3420, 8000)).toBe('Fronta 3 420/8 000');
    expect(queueSentence(0, 0)).toBe('Fronta prázdna');
  });
});

/* ═══════════════════ B. Grep: žargón sa nesmie vrátiť do UI ═══════════════ */

describe('P3/K10 — na povrchu nie je žargón', () => {
  it('sanity — skener naozaj číta obrazovky a rozumie im', () => {
    expect(SURFACE_FILES.length).toBeGreaterThan(30);
    expect(SURFACE_TEXTS.length).toBeGreaterThan(100);
    expect(SURFACE_FILES.some((f) => f.path.startsWith('src/app/'))).toBe(true);
    expect(SURFACE_FILES.some((f) => f.path.startsWith('src/components/'))).toBe(true);
  });

  /**
   * Bez tohto testu je celá časť B na nič: keby skener vracal prázdno alebo
   * hlásil čokoľvek, „zelená" by nedokazovala nič.
   */
  it('sanity — skener chytá text a NEchytá kód', () => {
    const sample = [
      "import { allowlistRepo } from '@/lib/repo/allowlist.repo';",
      'const CLS = 42;',
      'export function Panel({ status }: { status: string }) {',
      '  const ready = status === "needs_key";',
      '  const url = "/api/allowlist";',
      '  const many = items.length > maxItems ? <Full /> : <Empty />;',
      '  return (',
      '    <div className="allowlist-grid card" data-state="needs_key">',
      '      <p title="Kampaň čaká na kľúč">Kampaň je v stave needs_key</p>',
      '      <span>{ready ? "hotovo" : "čaká"}</span>',
      '      <b>zlacnené</b>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');

    const found = surfaceTexts([{ path: 'vzorka.tsx', code: prepare(sample) }]);
    const texts = found.map((t) => t.text);

    // Chytené: JSX text, hodnota `title`, jednoslovný JSX text.
    expect(texts).toContain('Kampaň je v stave needs_key');
    expect(texts).toContain('Kampaň čaká na kľúč');
    expect(texts).toContain('zlacnené');

    // Nechytené: import, `className`, `data-*`, cesta, porovnanie so stavom.
    expect(texts.join('\n')).not.toContain('lib/repo');
    expect(texts.join('\n')).not.toContain('allowlist-grid');
    expect(texts.join('\n')).not.toContain('/api/allowlist');
    expect(texts.some((t) => t.includes('maxItems'))).toBe(false);
    expect(texts.some((t) => t.trim() === 'needs_key')).toBe(false);

    // A nad touto vzorkou pravidlo `needs_key` PADNE — inak by test nič nemeral.
    const needsKeyRule = RULES.find((r) => r.name === 'needs_key');
    expect(needsKeyRule).toBeDefined();
    const hits = found.filter((t) => (needsKeyRule as Rule).pattern.test(t.text));
    expect(hits.map((h) => h.text)).toEqual(['Kampaň je v stave needs_key']);
  });

  for (const rule of RULES) {
    it(`v texte pre používateľa nie je: ${rule.name}`, () => {
      const hits = violations(rule);
      expect(report(rule, hits)).toBe('');
    });
  }

  it('nikde na povrchu nestojí zakázané stavové slovo namiesto štyroch povolených (§4)', () => {
    // Hľadá sa VÝHRADNE `needs_key` ako slovo v texte — „aktívna" a „naplánovaná"
    // sa v inej vete (napr. „aktívna zľava v shope") povedať smú; zakázané sú ako
    // NÁZOV STAVU, a to grep od bežnej vety spoľahlivo neodlíši. Zvyšok §4 drží
    // časť A: obrazovka stav nepíše sama, dostane ho zo slovníka.
    const hits = SURFACE_TEXTS.filter((t) => /\bneeds_key\b/i.test(t.text)).map(
      (t) => `${t.path}:${t.line}  «${t.text}»`,
    );
    expect(hits.join('\n')).toBe('');
  });
});
