-- raw.bc_lines_raw — vísitölur á sku
--
-- ── EKKI CONCURRENTLY, OG ÞAÐ ER Í LAGI ─────────────────────────────
-- Fyrsta útgáfa notaði `create index concurrently`. Supabase-ritillinn
-- vefur hverja keyrslu í transaction og hafnar því:
--   ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a
--   transaction block
-- Það gerist líka þegar skipunin er keyrð ein og sér — vefjan er
-- ritilsins, ekki skránnar.
--
-- Venjulegt `create index` tekur SHARE-lás: LESTUR HELDUR ÁFRAM, skrif í
-- `raw.bc_lines_raw` bíða á meðan. Á ~485 þúsund röðum eru það sekúndur.
-- Og skrif í þessa töflu gerast aðeins þegar einhver smellir á BC Sync
-- (`processBcDrop_v1`) — það er ekkert samfellt innstreymi sem getur
-- lent í lásnum. Glugginn er í reynd ókeypis.
--
-- Þyrfti þetta að vera CONCURRENTLY — t.d. á töflu með stöðugum skrifum
-- — væri leiðin psql eða annar biðlari sem vefur ekki.
--
-- ── RÓTIN, EKKI GREININ ─────────────────────────────────────────────
-- Þrisvar 2026-09-21 féll fyrirspurn á 8 sekúndna anon-þakinu, alltaf af
-- sömu ástæðu: `bc_lines_raw.sku` hefur enga vísitölu, svo hver leit að
-- vöru les alla töfluna (~485 þúsund línur).
--
--   search_products        — lagað með því að hætta að reikna regex per röð
--   get_product_buyers     — sama
--   get_product_transactions — SAMT á mörkunum, féll í vöruportalinum
--
-- Fyrstu tvær lagfæringarnar voru réttar en þær tóku bara kostnaðinn af
-- regexinu. Skönnunin sjálf stóð eftir, og hún er nógu dýr til að tvær
-- fyrirspurnir á sömu vöru — buyers og transactions samhliða — skili
-- annarri innan þaksins og hinni ekki. Það er ekki hegðun sem á að
-- laga með því að stytta gluggann; það er tafla sem vantar vísitölu.
--
-- ── TVÆR VÍSITÖLUR, TVÖ MYNSTUR ─────────────────────────────────────
-- Föllin sía svona (sjá get_product_drawer_v2.sql):
--
--   l.sku = p_sku  or  l.sku like p_sku || '\_%'
--
-- Jafnaðarmerkið notar venjulega btree-vísitölu. Forskeytis-LIKE gerir
-- það EKKI nema vísitalan sé með `text_pattern_ops` — sjálfgefin
-- collation gerir `like 'x%'` ónothæft fyrir btree. Þess vegna eru þær
-- tvær; önnur dugar ekki fyrir bæði mynstrin.
--
-- Þetta hjálpar líka search_products, þar sem `l.sku in (select …)`
-- verður uppfletting. ILIKE-greinarnar á heiti skanna áfram — það er
-- heitaleit og hún er eðli málsins dýr. Sú leit tilheyrir
-- /kpi/top-products; vöruportalinn snertir hana ekki lengur.

create index if not exists bc_lines_raw_sku_idx
  on raw.bc_lines_raw (sku);

create index if not exists bc_lines_raw_sku_pattern_idx
  on raw.bc_lines_raw (sku text_pattern_ops);

-- Staðfesting — báðar eiga að birtast, og planið á að segja
-- "Index Scan" eða "Bitmap Index Scan", ekki "Seq Scan":
--
--   select indexname from pg_indexes
--    where schemaname = 'raw' and tablename = 'bc_lines_raw';
--
--   explain (analyze, buffers)
--   select * from public.get_product_transactions('136266', 365, 25);
