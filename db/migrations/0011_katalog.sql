-- 0011_katalog.sql — `catalog_cache` ako zrkadlo katalógu, nie cache desiatich
-- produktov (KONTRAKT V3: K7, K1 bod 2)
--
-- Z 10 riadkov sa stáva 40 483. Bez indexov je každý filter a každé stránkovanie
-- full scan, takže tabuľka dostáva presne tie indexy, ktoré zodpovedajú
-- filtrom v UI: cena, čerstvosť dát, meno (prefix) a stav produktu v shope.
--
-- K1 bod 2: v režime `plny` nahrádza allowlist podmienka „produkt je v
-- `catalog_cache` a NIE JE `not_found`". Aby sa to dalo overiť, musí byť stav
-- produktu v shope aj tu — doteraz žil len v `products_allowlist`. Hodnoty sú
-- zámerne rovnaké ako tam (D49, D38), aby to bola jedna vec, nie dve podobné.
--
-- I11 zostáva: stav ZĽAVY tu naďalej NIE JE, shop ho cez API nevracia (backlog B1).

ALTER TABLE catalog_cache
  ADD COLUMN shop_status ENUM('ok','not_found','unknown') NOT NULL DEFAULT 'unknown'
    AFTER has_attributes;

-- Riadky, ktoré v katalógu už sú, boli načítané zo shopu — teda existujú.
UPDATE catalog_cache SET shop_status = 'ok' WHERE shop_status = 'unknown';

-- Filtre bočného panela (V10) a zoznam produktov.
ALTER TABLE catalog_cache
  ADD KEY ix_catalog_price (price),
  ADD KEY ix_catalog_fetched (fetched_at),
  ADD KEY ix_catalog_name (name(64)),
  ADD KEY ix_catalog_shop_status (shop_status);

-- Najčastejšia kombinácia: „len existujúce produkty, zoradené podľa ceny".
-- Samostatný index na `shop_status` má nízku selektivitu, tento pokrýva
-- filter aj triedenie naraz.
ALTER TABLE catalog_cache
  ADD KEY ix_catalog_status_price (shop_status, price);
