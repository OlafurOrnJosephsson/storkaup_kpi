-- ============================================================================
-- ÞREP 2 — laga dedup-lykilinn á raw.bc_lines_raw
--
-- ⛔ MÆLT OG HAFNAÐ 2026-08-07. EKKI KEYRA. Skjalið stendur sem heimild um
--    af hverju þessi leið var reynd og af hverju hún gengur ekki.
--
-- Hugmyndin var að taka 'Afsl.upphæð línu' inn í unique-lykilinn til að
-- aðgreina annars eins línur. Eftir að dálkurinn var mappaður og full
-- force-innhleðsla keyrð mældist:
--
--     linur_med_afslatt = 85     af 465.256 línum  (0,018%)
--
-- Afslátturinn er því nánast alltaf tómur. Þær ~6.319 raðir sem falla saman
-- hafa nær örugglega allar sama (tóma) afsláttargildið og myndu rekast á
-- áfram. Breytingin myndi kosta vísitölubyggingu á 700.000 raða töflu og
-- force-innhleðslu, og endurheimta nánast ekkert.
--
-- RAUNVERULEGA LAUSNIN er línunúmer frá BC. 'Númer fylgiskjals + línunúmer'
-- er ótvíræður lykill; allt annað er ágiskun. Það er beiðni á þann sem býr
-- til exportið, ekki kóðabreyting hér.
--
-- ÓSVARAÐ ÁÐUR EN NOKKUÐ ER GERT: eru raðirnar sem falla saman raunverulega
-- aðskildar línur, eða skilar exportið sjálft tvíteknum röðum? Ef það síðara
-- er dedup rétt hegðun og hér er ekkert að laga. Sjá athugun neðst.
--
-- VANDINN, MÆLDUR 2026-08-06:
--   [BC_DROP] Lines: 239505 / 471575 new
--   [BC_DROP] ✅ Bókaðar sölureikningslínur.xlsx — uploaded: 234924
-- 4.581 raðir (1,9%) hurfu. Upsertið notar
--   on_conflict=document_no,sku,product_name,qty,amount_excl
-- með resolution=ignore-duplicates, svo tvær línur sem eru eins á þessum fimm
-- falla saman í eina. Þær eru ekki afrit: sami reikningur getur haft sömu vöru
-- tvisvar með ólíkum afslætti, og SaaS-exportið hætti að skila þeim dálki sem
-- greindi þær í sundur.
--
-- AFLEIÐING: api.generate_shopping_list_v2 leggur saman qty og amount_excl per
-- SKU, svo Innkaupalistinn vantelur hjá viðskiptavinum sem hafa endurteknar
-- línur. ~2% kerfisbundin vanteljun, ekki tilviljanakennd.
--
-- ÞETTA LAGAR EKKI ALLT. Án línunúmers í exportinu er enginn sannur lykill:
-- tvær fullkomlega eins línur (sama vara, magn, upphæð OG afsláttur) falla enn
-- saman. Afslátturinn fækkar árekstrum verulega en útrýmir þeim ekki.
-- ============================================================================


-- ── 1. Finndu núverandi vísitölu ────────────────────────────────────────────
-- Keyrðu ÞETTA FYRST og skrifaðu niður nafnið. Nafnið er ekki þekkt hér því
-- taflan var búin til í SQL editor án þess að skilgreiningin færi í kóðasafnið.

select i.relname as index_name,
       pg_get_indexdef(i.oid) as definition
from   pg_index x
join   pg_class i on i.oid = x.indexrelid
join   pg_class t on t.oid = x.indrelid
join   pg_namespace n on n.oid = t.relnamespace
where  n.nspname = 'raw' and t.relname = 'bc_lines_raw' and x.indisunique;


-- ── 2. Ný vísitala með afslættinum ──────────────────────────────────────────
-- coalesce svo null-afsláttur (eldri raðir) reki sig ekki á; í Postgres eru
-- null-gildi ekki jöfn hvert öðru og myndu annars sleppa öllum dedup.
--
-- CONCURRENTLY svo taflan læsist ekki á meðan. ATH: má ekki keyra inni í
-- transaction — keyrðu þessa setningu eina og sér.

create unique index concurrently if not exists bc_lines_raw_dedup_v2
  on raw.bc_lines_raw (
    document_no, sku, product_name, qty, amount_excl, coalesce(line_discount, 0)
  );

-- Þegar sú að ofan er komin upp (athugaðu að hún sé valid — sjá VERIFY):
-- drop index concurrently raw.<nafnið úr skrefi 1>;


-- ── 3. Uppfærðu upsertið í kóðanum ──────────────────────────────────────────
-- core/utils.js → upsertBcLinesToSupabase_ → endpoint:
--   .../bc_lines_raw?on_conflict=document_no,sku,product_name,qty,amount_excl
-- verður
--   .../bc_lines_raw?on_conflict=document_no,sku,product_name,qty,amount_excl,line_discount
-- Svo clasp push.
--
-- ATH: PostgREST krefst þess að on_conflict passi við unique-vísitölu. Þar sem
-- vísitalan að ofan er á coalesce(line_discount,0) en ekki á dálknum sjálfum
-- gæti PostgREST ekki fundið hana. Prófaðu á einni skrá áður en þú treystir
-- þessu — ef upsertið villar með "no unique or exclusion constraint matching"
-- þarf vísitalan að vera á beina dálknum og línur með null-afslátt að fá 0 í
-- payloadinu í staðinn (toNum_ skilar 0, ekki null, svo það ætti að ganga).


-- ── 4. Endurheimta týndu raðirnar ───────────────────────────────────────────
-- Þær 4.581 raðir voru aldrei skrifaðar — þær koma ekki aftur af sjálfu sér.
-- Settu Bókaðar sölureikningslínur.xlsx EINA í BC_DROP og keyrðu
-- "Force re-upload". Ekki hafa sölureikningaskrána með (hún nullar order_no og
-- email á allri sögunni).


-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Vísitalan á að vera valid = true. Ef false þá féll byggingin og hana þarf að
-- fella og endurtaka.

select i.relname, x.indisvalid, pg_get_indexdef(i.oid)
from   pg_index x
join   pg_class i on i.oid = x.indexrelid
join   pg_class t on t.oid = x.indrelid
where  t.relname = 'bc_lines_raw' and x.indisunique;

select count(*) as linur_alls,
       count(*) filter (where line_discount is not null and line_discount <> 0) as linur_med_afslatt
from   raw.bc_lines_raw;


-- ── ATHUGUNIN SEM ÞARF AÐ GERA FYRST ────────────────────────────────────────
-- Áður en beðið er um línunúmer: er yfirleitt vandamál til staðar?
--
-- Opnaðu 'Bókaðar sölureikningslínur.xlsx' og raðaðu á Númer fylgiskjals + Nr.
-- (SKU). Leitaðu að reikningi sem hefur sömu vöru tvisvar.
--
--   Ef raðirnar eru EINS í hverjum einasta dálki  → exportið tvítekur, dedup
--     er rétt hegðun, ekkert að laga. Innkaupalistinn er réttur.
--   Ef þær eru ólíkar í einhverjum dálki sem er ekki í lyklinum (t.d. Tegund,
--     Mælieiningarkóði, Ein.verð) → línurnar eru raunverulega aðskildar og
--     Innkaupalistinn vantelur um ~1,3%. Þá er línunúmer réttlætanleg beiðni.
--
-- Þetta er fimm mínútna handverk í Excel og það sker úr um hvort hér sé
-- yfirleitt verkefni. Ekki byggja neitt fyrr en það liggur fyrir.
