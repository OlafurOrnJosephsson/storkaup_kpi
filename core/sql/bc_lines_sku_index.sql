-- raw.bc_lines_raw — vísitölur á sku
--
-- ⚠️ KEYRIST EIN OG SÉR. `create index concurrently` má ekki vera inni í
-- transaction-blokk. Límdu hvora skipun fyrir sig ef ritillinn kvartar.
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

create index concurrently if not exists bc_lines_raw_sku_idx
  on raw.bc_lines_raw (sku);

create index concurrently if not exists bc_lines_raw_sku_pattern_idx
  on raw.bc_lines_raw (sku text_pattern_ops);

-- Staðfesting — báðar eiga að birtast, og planið á að segja
-- "Index Scan" eða "Bitmap Index Scan", ekki "Seq Scan":
--
--   select indexname from pg_indexes
--    where schemaname = 'raw' and tablename = 'bc_lines_raw';
--
--   explain (analyze, buffers)
--   select * from public.get_product_transactions('136266', 365, 25);
