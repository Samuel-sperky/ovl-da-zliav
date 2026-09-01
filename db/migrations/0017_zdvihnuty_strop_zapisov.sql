-- 0017_zdvihnuty_strop_zapisov.sql — denný rozpočet zápisov po zdvihnutí kvóty
--
-- PREČO (1. 9. 2026)
-- -----------------
-- Migrácia 0010 zapísala `CHECK (daily_write_budget BETWEEN 1 AND 200)` s
-- komentárom „200/deň je strop shopu, nie náš". Tá veta bola pravdivá — dovtedy.
-- Správca shopu 1. 9. 2026 na žiadosť (`docs/64-ZIADOST-LIMITY-2026-09-01.md`)
-- zdvihol kvótu kľúča „Discount handler" z `20/min · 200/deň` na
-- `150/min · 1000/deň`.
--
-- Bez tejto migrácie by appka tvrdila jedno a databáza druhé:
-- `MAX_DAILY_WRITE_BUDGET` (`lib/engine/budget.ts`) sa odvodzuje zo
-- `SHOP_KEYED_LIMIT.perUtcDay`, takže po zdvihnutí prijme hodnotu do 1000 ako
-- PLATNÚ — a `UPDATE settings SET daily_write_budget = 1000` by spadol na
-- `CHECK`. Obrazovka by hodnotu prijala a uloženie by zlyhalo; presne ten druh
-- tichého rozporu, ktorý sa hľadá najhoršie.
--
-- ČO SA TÝM NEMENÍ
-- ---------------
-- Rozpočet zostáva konfigurovateľný NADOL a `1` je ďalej platná hodnota —
-- fronta sa pri nej spomalí, nezastaví (rezerva `WRITE_QUOTA_RESERVE` to drží).
-- Strop na jednu zľavu (`ck_settings_max_products`, 1–10 000) sa NEDOTÝKA:
-- koľko produktov smie mať jedna zľava je iná otázka než koľko zápisov denne.
--
-- POZOR NA BUDÚCE ZDVIHNUTIE
-- --------------------------
-- Správca ohlásil, že pri bezproblémovom behu kvótu zdvihne znova. Horná hranica
-- tu je LITERÁL, lebo SQL si TypeScriptovú konštantu naimportovať nevie — takže
-- toto je JEDINÉ miesto v repe, ktoré sa pri ďalšom zdvihnutí musí zmeniť RUČNE
-- spolu so `SHOP_KEYED_LIMIT`. Všetko ostatné je odvodené. Keby sa rozišli,
-- appka znova začne prijímať hodnotu, ktorú DB odmietne.
--
-- Vlastník: A9 (rozpočet zápisov).

-- ── 1. Nahradenie stropu ──────────────────────────────────────────────────
-- MariaDB nevie `CHECK` upraviť na mieste; treba zhodiť a pridať. `IF EXISTS`
-- je kvôli opakovanému behu — runner migráciu druhýkrát nepustí, ale ručné
-- spustenie pri obnove zo zálohy nesmie skončiť chybou.
ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS ck_settings_daily_budget;

ALTER TABLE settings
  ADD CONSTRAINT ck_settings_daily_budget CHECK (daily_write_budget BETWEEN 1 AND 1000);

-- ── 2. Granty ─────────────────────────────────────────────────────────────
-- Žiadna nová tabuľka nevznikla, takže sa nič neudeľuje. Riadok je tu preto,
-- aby bolo vidieť, že to nie je zabudnuté: 0012/0013/0014/0016 menujú tabuľky
-- konkrétne a `settings` medzi nimi už je.
