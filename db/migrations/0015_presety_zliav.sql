-- 0015_presety_zliav.sql — úložisko presetov zliav
-- (KONTRAKT-V4-2026-08-28: D112, K7; 28. 8. 2026)
--
-- Preset je POMENOVANÁ KOMBINÁCIA troch vecí, ktoré dnes musí človek naklikať
-- pri každej zľave znova: filtra katalógu (query string z `catalogFilterKey()`),
-- pásiem s percentami a dĺžky okna v dňoch. Nič viac; zoznam ID produktov v ňom
-- NIE JE (odpoveď 92 — katalóg sa mení každú noc a uložené čísla by o týždeň
-- ukazovali iné kusy, než si používateľ uložil).
--
-- PREČO DATABÁZA A NIE PREHLIADAČ
-- -------------------------------
-- `src/components/products/saved-filters.ts` ukladá uložené filtre do
-- `localStorage` a sám v hlavičke píše, že serverové úložisko je eventuálna
-- odpoveď („keď server-side úložisko pribudne, mení sa len tento modul").
-- Pre uložený FILTER je prehliadač poctivá voľba: filter nič nemení, je to
-- pohľad na katalóg a jeho strata stojí jedno preklikanie.
--
-- Preset je iná trieda veci. Preset RIADI ZÁPIS DO PRODUKČNÉHO ESHOPU: nesie
-- percentá a dĺžku okna, teda presne tie čísla, ktoré po potvrdení odídu do
-- `setReduction`. Z toho vyplývajú tri dôvody, prečo patrí sem a nie do
-- prehliadača:
--
--   1. **Použitie sa musí dať doložiť.** Zľava sa zapisuje do produkcie a
--      appka o každom zápise vedie audit (I4, append-only). Preset uložený v
--      `localStorage` neexistuje pre nikoho okrem toho jedného profilu
--      prehliadača — po vyčistení dát alebo v inom prehliadači sa už nedá
--      povedať, ČO presne bolo pod menom „Ležiaky −20 %" v čase zápisu.
--      Riadok v DB áno, a `last_used_at` hovorí, kedy sa naposledy použil.
--   2. **Prehliadač nie je miesto pre vstup zápisovej cesty.** Obsah
--      `localStorage` môže prepísať čokoľvek, čo beží na tom origine, a
--      `saved-filters.ts` si preto rozbitý obsah číta ako prázdny zoznam.
--      Pri filtri je to nanajvýš prázdna obrazovka; pri presete by to bolo
--      percento, ktoré nikto nezadal. Tu má hodnoty pod kontrolou schéma
--      (CHECK na dĺžku okna) aj repozitár (validácia pásiem 1–30, I9).
--   3. **Preset prežije appku, nie iba záložku.** Beží to na jednom počítači,
--      ale DB je to, čo sa zálohuje (`scripts/backup.sh`, K10). Profil
--      prehliadača nie.
--
-- ČO SA TÝMTO NEMENÍ (dôležité)
-- -----------------------------
-- **I3 zostáva v plnej sile.** Preset je len PREDPLNENIE formulára — nie je to
-- druhá cesta k zápisu. Spustenie presetu prejde tým istým dry-runom a tým
-- istým potvrdením ako každá iná zľava (K7); táto tabuľka žiadny `previewToken`
-- nenesie a nemá ako ho obísť. Kto sem niekedy pridá stĺpec typu
-- `auto_confirm`, ruší jedinú bránu, ktorá pred produkčným eshopom po D100
-- zostala.
--
-- Percento sa pri zápise NEBERIE odtiaľto: berie sa z `campaign_items.percent`,
-- ktoré padlo pri potvrdení (0010, K3). `tiers` v presete je vstup do
-- formulára, nie zdroj pravdy pre executor — rovnaká úloha, akú má `rule`
-- v `campaign_tiers`.
--
-- POZOR NA POLOVIČNÝ BEH (rovnaké varovanie ako v 0010 a 0013)
-- -----------------------------------------------------------
-- DDL v MariaDB implicitne commituje, takže transakcia migračného runnera tu
-- pred polovičným stavom NECHRÁNI: keď migrácia padne uprostred, schéma je
-- čiastočne zmenená a riadok v `_migrations` nie je — pri ďalšom štarte sa celá
-- spustí ZNOVA. Preto je každý príkaz idempotentný (`CREATE TABLE IF NOT
-- EXISTS`, `GRANT`) a opakovaný beh je no-op, nie chyba (D88).
--
-- Vlastník: V4 (presety).

-- ── Presety zliav (D112) ───────────────────────────────────────────────────
-- `name` je od človeka a je UNIKÁTNE: rovnaké meno sa zámerne ODMIETNE, nie
-- prepíše. `saved-filters.ts` prepisuje, lebo uložený filter je pohľad; preset
-- je vstup zápisovej cesty a tichý prepis by znamenal, že „Ležiaky −20 %" má
-- dnes iný obsah než včera, pričom v audite je len meno. Zmena presetu je
-- preto výslovná operácia (`update`), nie vedľajší efekt ukladania.
--
-- `filter_query` je query string z `catalogFilterKey()` — bez stránkovania a
-- bez triedenia, presne ten istý tvar, aký ukladá `saved-filters.ts`. 1000
-- znakov je s rezervou nad tým, čo `catalogSearchParams()` dokáže vyrobiť.
--
-- `tiers` je JSON pole pásiem v tvare, aký prijíma `POST /api/campaigns`
-- (`ord`, `label`, `percent`, voliteľné `rule`) — bez `itemsCount`, ktorý je
-- snímka z času potvrdenia a v presete by bol vymyslené číslo (I11).
--
-- `duration_days` je INKLUZÍVNA dĺžka okna, ako ju počíta appka
-- (`to = addDays(from, dĺžka - 1)`). Strop 90 je odvodený, nie zvolený: I9 a
-- D29 pripúšťajú okno najviac +3 KALENDÁRNE mesiace a najkratšie také okno má
-- 89 dní (1. 2. → 1. 5. v nepriestupnom roku), takže inkluzívna dĺžka 90
-- (= `from` + 89 dní) je najväčšia, ktorá sa do troch mesiacov zmestí pre
-- KAŽDÝ štartovací deň. Skutočnú kontrolu okna aj tak robí kalendárne
-- `isWithinMaxWindow()` pred zápisom — toto je hrubá brzda v schéme, aby sa
-- nezmyselné číslo nedalo vôbec uložiť (K1 bod 3: aplikačná validácia sama
-- nikdy nestačila).
--
-- `last_used_at` je NULL = „ešte nepoužitý". Nie je to to isté ako „použitý
-- kedysi dávno" a nula ani `created_at` sa sem NEDOPĺŇA (I11).
CREATE TABLE IF NOT EXISTS discount_presets (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(60)   NOT NULL,
  filter_query   VARCHAR(1000) NOT NULL,
  tiers          JSON          NOT NULL,
  duration_days  SMALLINT UNSIGNED NOT NULL,
  created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at   DATETIME(3)   NULL,
  UNIQUE KEY uq_presets_name (name),
  CONSTRAINT ck_presets_duration CHECK (duration_days BETWEEN 1 AND 90),
  CONSTRAINT ck_presets_name_not_blank CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Granty pre aplikačného usera (D89 — appka nemá žiadne DDL právo) ───────
-- Vzor je `0012_grants.sql` a `0013`: `0008_grants.sql` menuje KONKRÉTNE
-- tabuľky, takže nová tabuľka by pre aplikačného usera neexistovala. Staršie
-- migrácie sa needitujú ani o medzeru — runner overuje SHA-256 checksum už
-- aplikovaných migrácií (D88, I14).
--
-- `DELETE` tu byť MUSÍ: preset sa dá zmazať a je to celý jeho životný cyklus.
-- Nie je to audit (I4 sa nemení a táto migrácia mu žiadne právo nepridáva).
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.discount_presets TO '{{APP_USER}}'@'%';

-- @tolerate-errno: 1227, 1045
FLUSH PRIVILEGES;
