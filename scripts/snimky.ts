/**
 * Aura Zľavy — STATICKÝ SNÍMKOVAČ OBRAZOVIEK.
 *
 *     npm run snimky
 *
 * PREČO EXISTUJE
 * --------------
 * Appka sa na tomto počítači nedá spustiť: binárka `argon2` je zablokovaná
 * Windows Application Control. Je to bezpečnostné opatrenie a neobchádza sa.
 * Používateľ tak nikdy nevidel ani jednu obrazovku toho, čo osem pracovníkov
 * postavilo — a rozhodnutia o rozložení, textoch a grafoch sa robili naslepo.
 *
 * Snímkovač appku NEPOTREBUJE. Obrazovky sú klientské komponenty a od servera
 * chcú len odpovede na `fetch`. Ten sa nahradí vymyslenými odpoveďami
 * (`scripts/snimky/fixtury.ts`), komponenty sa zabalia Vitom do jedného
 * súboru spolu so SKUTOČNÝM `globals.css`, skutočnými CSS modulmi a skutočným
 * písmom `@fontsource-variable/inter`, a Playwright to odfotí.
 *
 * Nespúšťa sa teda ani Next.js, ani databáza, ani Docker — a von zo stroja
 * neodíde ani jeden bajt.
 *
 * ČO Z TOHO VYPADNE
 * -----------------
 *  · `snimky/*.png` — každá obrazovka vo svetlej aj tmavej téme, 1440 × 900,
 *    celá stránka (nielen výrez okna),
 *  · výpis nálezov: čo na obrazovkách preteká, prekrýva sa, nesie farbu bez
 *    slova, ukazuje nulu namiesto pomlčky, obsahuje emodži alebo prerastá
 *    1,5 obrazovky (P4), plus každá cesta, na ktorú fixtúry odpoveď nemajú.
 *
 * Nálezy sa LEN POPISUJÚ — snímkovač do `src/` nesiaha.
 *
 * Vlastník: snímkovač (tento súbor + `scripts/snimky/`).
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium, type ConsoleMessage, type Page } from '@playwright/test';
import { build } from 'vite';

const TU = dirname(fileURLToPath(import.meta.url));
const KOREN = resolve(TU, '..');
const VYSTUP = join(KOREN, 'snimky');
const WEB = join(VYSTUP, '_web');

/** Okno, v ktorom sa appka posudzuje. Menej než polovica bežného monitora. */
const SIRKA = 1440;
const VYSKA = 900;

/* ═══════════════════════════ 1. Čo sa fotí ════════════════════════════════ */

/** Jedna snímka: obrazovka z `scripts/snimky/entry.tsx` a čo na nej urobiť. */
interface Zaber {
  /** Kľúč obrazovky v `OBRAZOVKY`. */
  readonly obrazovka: string;
  /** Prípona v mene súboru — odlíši dva zábery tej istej obrazovky. */
  readonly variant?: string;
  /** Slovenský názov do výpisu nálezov. */
  readonly nazov: string;
  /** Na čo sa počká, kým je obrazovka naozaj postavená. */
  readonly cakaj: string;
  /** Klik pred odfotením — napríklad otvorenie detailu kusu. */
  readonly klikni?: string;
}

const ZABERY: readonly Zaber[] = [
  {
    obrazovka: 'prehlad',
    nazov: 'Prehľad',
    cakaj: '[data-testid="overview"]',
  },
  {
    obrazovka: 'produkty',
    nazov: 'Produkty — katalóg',
    cakaj: '[data-testid="catalog-table"]',
  },
  {
    obrazovka: 'produkty',
    variant: 'detail',
    nazov: 'Produkty — katalóg s otvoreným detailom kusu',
    cakaj: '[data-testid="catalog-table"]',
    klikni: '[data-testid^="open-detail-"]',
  },
  {
    obrazovka: 'zlavy',
    nazov: 'Zľavy — zoznam',
    cakaj: '[data-testid="discounts-list"]',
  },
  {
    obrazovka: 'zlavy-detail',
    nazov: 'Zľavy — zoznam s otvoreným detailom zľavy',
    cakaj: '[data-testid="discounts-list"]',
  },
  {
    obrazovka: 'zlavy-nova',
    nazov: 'Zľavy — sprievodca novou zľavou',
    cakaj: '[data-testid="new-discount"]',
  },
  {
    obrazovka: 'nastavenia',
    nazov: 'Nastavenia — rozcestník',
    cakaj: '[data-testid="settings-cards"]',
  },
  {
    obrazovka: 'nastavenia-co-vie',
    nazov: 'Nastavenia — Čo appka vie',
    cakaj: '[data-testid="settings-sub-co-vie"]',
  },
  {
    obrazovka: 'nastavenia-napojenie',
    nazov: 'Nastavenia — Na čo je napojená',
    cakaj: '[data-testid="settings-sub-napojenie"]',
  },
  {
    obrazovka: 'nastavenia-zapisy',
    nazov: 'Nastavenia — Zápisy a rozpočty',
    cakaj: '[data-testid="settings-sub-co-smie"]',
  },
  {
    obrazovka: 'nastavenia-zamknute',
    nazov: 'Nastavenia — Zamknuté funkcie a poistky',
    cakaj: '[data-testid="settings-sub-historia"]',
  },
  {
    obrazovka: 'nastavenia-cervena-zona',
    nazov: 'Nastavenia — Červená zóna',
    cakaj: '[data-testid="settings-sub-cervena-zona"]',
  },
  {
    obrazovka: 'nastavenia-cervena-zona',
    variant: 'otvorena',
    nazov: 'Nastavenia — Červená zóna s otvoreným rozklikom',
    cakaj: '[data-testid="settings-sub-cervena-zona"]',
    // Zatvorený rozklik je celá obrazovka: nadpis a jeden červený odkaz.
    // Bez tohto kliku je najnebezpečnejšie tlačidlo appky neodfotené.
    klikni: '[data-testid="danger-zone-disclosure"] summary',
  },
];

const TEMY = [
  { kluc: 'svetla', nazov: 'svetlá', schema: 'light' as const },
  { kluc: 'tmava', nazov: 'tmavá', schema: 'dark' as const },
];

/* ═══════════════════════════ 2. Zabalenie ═════════════════════════════════ */

/**
 * Zabalí obrazovky do jedného súboru, ktorý sa dá otvoriť z disku.
 *
 * `format: 'iife'` je zámerný: modulový skript by sa cez `file://` nenačítal
 * (prehliadač ho blokuje ako cudzí pôvod), takže by bola stránka prázdna.
 *
 * `envDir` ukazuje do `scripts/snimky/`, kde žiadne `.env` nie je. Bez toho by
 * Vite čítal `.env` projektu — a hoci von púšťa len premenné s predponou
 * `VITE_`, tajomstvá sa k baličkovi snímok nemajú dostať vôbec.
 */
/** To jediné, čo snímkovač z výsledku zabalenia potrebuje — mená súborov. */
interface Balicek {
  readonly output: readonly { readonly fileName: string }[];
}

async function zabal(): Promise<{ js: string; css: string }> {
  const vysledok = (await build({
    root: KOREN,
    configFile: false,
    // Stránka sa otvára z disku (`file://`), takže odkazy na písmo a obrázky
    // musia byť RELATÍVNE. S predvoleným `/` by `/assets/inter-…woff2`
    // ukazovalo do koreňa disku a appka by sa vykreslila v Segoe UI.
    base: './',
    envDir: join(TU, 'snimky'),
    envPrefix: 'SNIMKY_NEPOUZITE_',
    publicDir: false,
    logLevel: 'warn',
    resolve: {
      alias: {
        '@': join(KOREN, 'src'),
        'next/link': join(TU, 'snimky', 'next-link.tsx'),
        'next/navigation': join(TU, 'snimky', 'next-navigation.ts'),
      },
    },
    build: {
      outDir: WEB,
      emptyOutDir: true,
      cssCodeSplit: false,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: join(TU, 'snimky', 'entry.tsx'),
        output: { format: 'iife', entryFileNames: 'obrazovky.js' },
      },
    },
  })) as unknown as Balicek | readonly Balicek[];

  const baliky = Array.isArray(vysledok) ? vysledok : [vysledok as Balicek];
  const subory = baliky.flatMap((b) => [...b.output]).map((o) => o.fileName);
  const css = subory.find((n) => n.endsWith('.css'));
  if (css === undefined) throw new Error('Vite nevyrobil CSS — snímky by boli holý text.');

  return { js: 'obrazovky.js', css };
}

/** Stránka, ktorú Playwright otvorí. Bez siete — všetko je vedľa nej na disku. */
function stranka(js: string, css: string): string {
  return `<!doctype html>
<html lang="sk" data-theme="light">
<head>
<meta charset="utf-8">
<title>Aura Zľavy — snímky</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="./${css}">
</head>
<body>
<div id="root"></div>
<script src="./${js}"></script>
</body>
</html>
`;
}

/* ═══════════════════════════ 3. Fotenie ═══════════════════════════════════ */

interface Vysledok {
  readonly subor: string;
  readonly nazov: string;
  readonly tema: string;
  readonly sirka: number;
  readonly vyska: number;
  readonly nalezy: readonly { druh: string; popis: string }[];
  readonly chyby: readonly string[];
}

async function odfot(
  page: Page,
  zaber: Zaber,
  tema: (typeof TEMY)[number],
  adresa: string,
): Promise<Vysledok> {
  const chyby: string[] = [];
  const zapisChybu = (msg: ConsoleMessage) => {
    if (msg.type() === 'error') chyby.push(msg.text());
  };
  page.on('console', zapisChybu);
  page.on('pageerror', (err) => chyby.push(`pageerror: ${err.message}`));

  // Každý záber dostáva vlastnú stránku — zmena samotného `#fragmentu` by
  // dokument nenačítala znova a druhá obrazovka by sa nikdy nevykreslila.
  await page.goto(`${adresa}#obrazovka=${zaber.obrazovka}&tema=${tema.kluc}`);
  await page.waitForSelector(zaber.cakaj, { timeout: 20_000 });
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-snimky') === 'hotovo',
    undefined,
    { timeout: 20_000 },
  );

  if (zaber.klikni !== undefined) {
    await page.locator(zaber.klikni).first().click();
    await page.waitForTimeout(400);
  }

  // Písmo musí byť naozaj načítané — inak sa fotí náhradné Segoe UI a všetky
  // úsudky o hustote textu sú o inom písme, než appka posiela.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(200);

  const meno = `${zaber.obrazovka}${zaber.variant === undefined ? '' : `-${zaber.variant}`}-${tema.kluc}.png`;
  const cesta = join(VYSTUP, meno);
  await page.screenshot({ path: cesta, fullPage: true });

  const rozmer = await page.evaluate(() => ({
    sirka: document.documentElement.scrollWidth,
    vyska: document.documentElement.scrollHeight,
  }));
  const nalezy = await page.evaluate(() =>
    (window as unknown as { __snimkyNalezy: () => { druh: string; popis: string }[] })
      .__snimkyNalezy(),
  );

  page.off('console', zapisChybu);

  return {
    subor: meno,
    nazov: zaber.nazov,
    tema: tema.nazov,
    sirka: rozmer.sirka,
    vyska: rozmer.vyska,
    nalezy,
    chyby,
  };
}

/* ═══════════════════════════ 4. Beh ═══════════════════════════════════════ */

async function hlavne(): Promise<void> {
  await rm(VYSTUP, { recursive: true, force: true });
  await mkdir(WEB, { recursive: true });

  console.log('Balím obrazovky (Vite)…');
  const { js, css } = await zabal();
  await writeFile(join(WEB, 'index.html'), stranka(js, css), 'utf8');
  const adresa = pathToFileURL(join(WEB, 'index.html')).href;

  console.log(`Fotím ${ZABERY.length * TEMY.length} snímok pri ${SIRKA} × ${VYSKA}…`);
  const prehliadac = await chromium.launch();
  const vysledky: Vysledok[] = [];

  try {
    for (const tema of TEMY) {
      const kontext = await prehliadac.newContext({
        viewport: { width: SIRKA, height: VYSKA },
        deviceScaleFactor: 1,
        colorScheme: tema.schema,
        reducedMotion: 'reduce',
      });
      for (const zaber of ZABERY) {
        const page = await kontext.newPage();
        try {
          vysledky.push(await odfot(page, zaber, tema, adresa));
        } catch (chyba) {
          // Jedna nepostavená obrazovka nesmie zhodiť celý beh — ostatné sa
          // odfotia a nález sa vypíše ako každý iný.
          const dovod = chyba instanceof Error ? chyba.message.split('\n')[0] : String(chyba);
          vysledky.push({
            subor: '—',
            nazov: zaber.nazov,
            tema: tema.nazov,
            sirka: 0,
            vyska: 0,
            nalezy: [{ druh: 'obrazovka-sa-nepostavila', popis: dovod ?? 'neznáma chyba' }],
            chyby: [],
          });
        }
        await page.close();
      }
      await kontext.close();
    }
  } finally {
    await prehliadac.close();
  }

  vypis(vysledky);
}

function vypis(vysledky: readonly Vysledok[]): void {
  console.log('\n════════════════════════ SNÍMKY ════════════════════════');
  for (const v of vysledky) {
    console.log(`snimky/${v.subor}  —  ${v.nazov} (${v.tema}), ${v.sirka} × ${v.vyska} px`);
  }

  console.log('\n═════════════════ ČO VYZERÁ ROZBITO ═════════════════');
  let spolu = 0;
  for (const v of vysledky) {
    if (v.nalezy.length === 0 && v.chyby.length === 0) continue;
    console.log(`\n■ ${v.nazov} — ${v.tema} (${v.subor})`);
    for (const n of v.nalezy) {
      spolu += 1;
      console.log(`   · [${n.druh}] ${n.popis}`);
    }
    for (const ch of v.chyby) {
      spolu += 1;
      console.log(`   · [konzola] ${ch}`);
    }
  }
  if (spolu === 0) console.log('\nMeranie nenašlo nič. Pozri sa na snímky očami.');
  else console.log(`\nSpolu ${spolu} nálezov. Snímkovač nič neopravuje — len hlási.`);
}

await hlavne();
