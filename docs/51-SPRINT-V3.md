# Sprint V3 — prestavba na frontu a nové UI

Kontrakt: `docs/50-KONTRAKT-V3.md`. Vzhľad: `design/v3/ARCHITEKTURA.md`
a mockupy v `design/v3/*.html`. Odpovede: `docs/40-ODPOVEDE-V3.md`.

**Výhradné vlastníctvo súborov.** Každý súbor má práve jedného vlastníka.
Agent nesmie editovať súbor, ktorý nemá pridelený — ak ho potrebuje zmeniť,
napíše to do svojho výstupu ako požiadavku, neurobí to sám. Toto je jediná
vec, ktorá dovoľuje púšťať agentov paralelne.

---

## Fáza 1 — základ (paralelne, na sebe nezávislé)

### V1 · Migrácia a schéma
Vlastní: `db/migrations/0010_*.sql`, `db/migrations/0011_*.sql`

- `0010_fronta_a_pasma.sql`
  - `campaigns`: `status` + `'queued'`; `items_total/ok/failed/uncertain`
    `TINYINT → INT UNSIGNED`; `CHECK (items_total <= 10000)` (K1 bod 3);
    stĺpec `late TINYINT(1) NOT NULL DEFAULT 0` (K5).
  - `campaign_items`: `position TINYINT → INT UNSIGNED`; nový
    `percent TINYINT UNSIGNED NOT NULL` s `CHECK (percent BETWEEN 1 AND 30)`.
  - nová `campaign_tiers` (K3).
  - `settings`: `scope_mode ENUM('pilot','plny') NOT NULL DEFAULT 'pilot'`,
    `max_products_per_campaign INT UNSIGNED NOT NULL DEFAULT 10000`,
    `daily_write_budget SMALLINT UNSIGNED NOT NULL DEFAULT 200`.
- `0011_katalog.sql` — `catalog_cache` na 40k riadkov: indexy na `price`,
  `fetched_at`, `name` (prefix), `shop_status`.
- GRANTy: ak `0008_grants.sql` menuje stĺpce/tabuľky, doplň nové **novou**
  migráciou. Starú needituj (K11 bod 1).

Hotovo keď: migrácie prejdú na čistej DB aj na DB s dátami; audit log
zostáva append-only (SELECT, INSERT).

### V2 · Design tokeny a shell
Vlastní: `src/app/globals.css`, `src/app/layout.tsx`,
`src/components/layout/*`

- Prenes `design/v3/_v3.css` do `globals.css`: svetlá téma na holom `:root`,
  tmavá **len** pod `[data-theme="dark"]`, plus `prefers-color-scheme`
  variant. Triedy `.lvl-1/.lvl-2/.lvl-3` (hierarchia, pravidlo P1).
- `Nav.tsx`: presne štyri taby (K9). Hlavička je jeden riadok 56 px, sticky,
  vpravo `Zápisy X/200 dnes`, `Fronta X/Y`, prepínač témy — a nič iné.
- Zmaž z hlavičky, čo tam podľa architektúry nepatrí (vyhľadávanie,
  notifikácie).

Hotovo keď: `next build` prejde, hlavička sedí s `design/v3/prehlad.html`,
v svetlej aj tmavej téme.

### V3 · Slovník
Vlastní: `src/lib/ui/vocabulary.ts` (nový), `test/unit/vocabulary.spec.ts`

Jedno miesto, ktoré prekladá vnútorné kódy na slovenské vety podľa tabuľky
K10. Plus **grep test**, ktorý prejde `src/app/**` a `src/components/**` a
padne, keď v JSX texte nájde zakázaný výraz (`needs_key`, `dry-run`,
`allowlist`, `setReduction`, `I3`, `D28`, `HTTP 4xx`). Test je jediná
poistka, že sa žargón nevráti.

---

## Fáza 2 — backend fronty (po V1)

### V4 · Repozitáre
Vlastní: `src/lib/repo/campaigns.repo.ts`,
`src/lib/repo/campaign-items.repo.ts`, `src/lib/repo/catalog.repo.ts`,
`src/lib/repo/settings.repo.ts`, `src/lib/repo/tiers.repo.ts` (nový)

- Zápis položiek po dávkach (`INSERT … VALUES (…),(…)`), nie 10 000
  jednotlivých `INSERT`-ov.
- `catalog.repo`: stránkovaný `upsert`, filtrovaný `search` s `LIMIT/OFFSET`
  a `COUNT`. Raw parametrizované SQL, žiadne ORM, žiadna interpolácia.
- `settings.repo`: `scope_mode`, `max_products_per_campaign`,
  `daily_write_budget` — čítanie **fail-closed** (K1 bod 1).

### V5 · Rozpočet, guardy, executor
Vlastní: `src/lib/engine/guards.ts`, `src/lib/engine/executor.ts`,
`src/lib/engine/budget.ts` (nový)

- `budget.ts`: `spentToday()` z auditu za UTC deň, `remainingToday()`,
  `estimateFinish(pending, budget)`. Žiadny paralelný počítadlový stĺpec (K2).
- Guardy: nový kód `budget_exhausted`; `checkAllowlist` sa mení na
  `checkScope` — v `pilot` ako doteraz, v `plny` overí prítomnosť v katalógu.
  Fail-closed pri chybe repozitára zostáva.
- Executor: pauza 250 ms → **≥ 3 s**; pred každou položkou kontrola rozpočtu;
  pri vyčerpaní kampaň → `queued` (nie `failed`); percento berie z položky,
  nie z kampane (K3). `Promise.all` nad zápismi ani náhodou.

Hotovo keď: test dokáže, že po vyčerpaní rozpočtu je stav `queued`, položky
zostávajú `pending` a druhý deň sa pokračuje presne tam, kde sa skončilo.

### V6 · Potvrdenie a preview pri 10k položkách
Vlastní: `src/lib/crypto/preview-token.ts`, `src/lib/engine/preview.ts`

- Streamový `computePayloadHash` nad trojicami `id:percent:price` (K4).
  Test na 10 000 položkách, ktorý meria, že sa nepostaví jeden obrí string.
- Vzorka do potvrdenia: 6 riadkov naprieč pásmami, nie prvých 6.

### V7 · Scheduler a synchronizácia katalógu
Vlastní: `src/lib/scheduler/*`, `src/lib/shop/catalog-sync.ts` (nový)

- Tick berie `queued` kampane a dobehne denný rozpočet.
- Plná synchronizácia katalógu stránkovane, denne mimo špičky, **mimo**
  zápisového rozpočtu (K7).
- Pripomienka deň pred expiráciou kľúča pri bežiacej fronte (K6).
- Po odstávke PC sa fronta **nerozbehne sama** — čaká na potvrdenie
  (odpoveď 43, zachováva doterajšie `missed`).

### V8 · API cesty
Vlastní: `src/app/api/**`

- `/api/catalog/search` — filtre, stránkovanie, počty pre bočný panel.
- `/api/campaigns` — pásma, `queued`, odhad dobehnutia, príznak `late`.
- `/api/queue` — stav fronty pre hlavičku a Prehľad.
- `/api/settings/scope-mode` — prepnutie `pilot`↔`plny`, sudo + audit (K1).
- Zamknuté filtre vracajú `locked: true`, nie vymyslené dáta (K8).
- Každá cesta ide cez `defineRoute()` — metóda, auth, rate limit, Origin, zod.

---

## Fáza 3 — obrazovky (po V2 a V8)

Každá vlastní svoj priečinok a nič mimo neho.

### V9 · Prehľad
Vlastní: `src/app/page.tsx`, `src/components/dashboard/**`
Podľa `design/v3/prehlad.html`, `prehlad-pokoj.html`,
`prehlad-pozastavene.html`, `prazdne-stavy.html`.
Štyri sekcie: Fronta (dominanta) · Čaká na vás + Nová zľava · Tržby ·
Zľavy naživo. **Nikdy** tabuľka produktov (hranica z architektúry §1).

### V10 · Produkty
Vlastní: `src/app/produkty/**`, `src/components/products/**`
Podľa `produkty.html`, `produkt-detail.html`. Ľavý panel filtrov 260 px,
dominanta je tabuľka. Zamknuté filtre sivé a neklikateľné, nie skryté.
Hromadný výber → lišta dole → „Zlacniť". **Nikdy** tržby eshopu.

### V11 · Zľavy
Vlastní: `src/app/zlavy/**`, `src/components/campaigns/**`
Podľa `zlavy.html`, `nova-zlava.html`, `zlava-detail.html`. Nová zľava:
výber → pásma a okno → štart a potvrdenie. Potvrdenie žiada **napísať počet
produktov** (I3 na povrchu). Varovanie o kľúči podľa K6.
Presmerovanie `/kampane/*` → `/zlavy/*`.

### V12 · Nastavenia, prihlásenie, mobil

> **27. 8. 2026 (D99):** prihlásenie je zrušené — `src/app/login/**`
> aj `prihlasenie.html` sú zmazané. Zvyšok tohto bodu (Nastavenia, onboarding,
> mobil) platí ďalej.

Vlastní: `src/app/nastavenia/**`, ~~`src/app/login/**`~~,
`src/app/onboarding/**`, `src/components/settings/**`
Podľa `nastavenia.html` (~~`prihlasenie.html`~~, D99). Audit sa sem skladá ako
„História a technický detail" (K9). Mobil podľa `m-*.html` — Prehľad,
Produkty, Nová zľava, Schválenie.

---

## Fáza 4 — uzavretie

### V13 · Upratanie a redirecty
Zmazať `/analytika`, `/ai-agent`, `/audit` ako samostatné taby a nechať
presmerovania. Odstrániť osirené komponenty. Žiadny mŕtvy kód.

### V14 · Testy a dôkaz
- Testy pre K1 (fail-closed režim), K2 (rozpočet), K3 (pásma), K4 (hash),
  K5 (`late`), K6 (kľúč vs. fronta).
- Grep testy invariantov musia prejsť **nezmenené**.
- e2e cesta z K12.
- `typecheck`, `lint`, `test`, `build`, `check-compose-bind`.

**Dôkaz nie je report agenta** (pasca z CLAUDE.md). Aspoň jedna cesta sa
overí s produkčným adaptérom, nie s fake závislosťou.
