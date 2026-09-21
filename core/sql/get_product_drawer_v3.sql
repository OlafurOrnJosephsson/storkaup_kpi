-- public.get_product_buyers / get_product_transactions — v3
--
-- ── HVERS VEGNA ÞRIÐJA ÚTGÁFAN ──────────────────────────────────────
-- v1:  where regexp_replace(l.sku, '_[A-Za-z0-9]+$', '') = p_sku
--      Regex á hverja röð. Féll á 8 sek þakinu.
--
-- v2:  where l.sku = p_sku or l.sku like p_sku || '\_%'
--      Ódýrara per röð, EN ENN FULL SKÖNNUN. Mælt 2026-09-21 með
--      explain analyze: 5.908 ms, 118.772 buffer-snertingar á einni
--      vöru með NÍU sölulínum.
--
-- Ástæðan er ekki að vísitölu vanti — `idx_bc_lines_sku` var til allan
-- tímann. Postgres breytir `LIKE 'abc%'` í vísitölubil AÐEINS þegar
-- mynstrið er fast við PLÖNUN. Hér er það `p_sku || '\_%'`, reiknað úr
-- breytu, svo forskeytisbragðið dettur út og hún skannar. v2 skipti
-- regex-skönnun út fyrir LIKE-skönnun — jafn óvísitöluvænt.
--
-- ── = ANY (FYLKI) ER VÍSITÖLUVÆNT ───────────────────────────────────
-- Jafnaðarmerki á móti fylki notar vísitölu þótt fylkið sé reiknað á
-- keyrslutíma. Rithættirnir eru taldir upp á litlu hliðinni, eins og
-- gert var í search_products_v2 — sama lausn, og hún hefði átt að fara
-- hingað í fyrstu atrennu.
--
-- Fylkið er byggt úr TVEIMUR heimildum svo það missi ekki af neinu:
--   1. p_sku sjálft og þekkt sölueiningarviðskeyti
--   2. web_sku úr raw.web_catalog án STO_-forskeytis — það ER BC-
--      rithátturinn, beint úr vörulistanum, og nær yfir viðskeyti sem
--      okkur dettur ekki í hug að telja upp
--
-- Heimild 2 er ný í v3 og er ástæðan fyrir að upptalningin er örugg.
-- v2 taldi bara viðskeyti; vara með óvænt viðskeyti hefði horfið þegjandi.
--
-- ── VÍSITÖLURNAR SEM VORU BÚNAR TIL Í MISGRIPUM ─────────────────────
-- `bc_lines_raw_sku_idx` er afrit af `idx_bc_lines_sku` og
-- `bc_lines_raw_sku_pattern_idx` var fyrir LIKE-leiðina sem er hér með
-- horfin. Báðar kosta við hvert innskrif í bc_lines_raw án þess að
-- nokkuð lesi þær. Þær eru felldar neðst — staðfestu fyrst að
-- idx_bc_lines_sku sé í raun á (sku):
--
--   select indexname, indexdef from pg_indexes
--    where schemaname='raw' and tablename='bc_lines_raw';

create or replace function public.get_product_buyers(
  p_sku       text,
  p_days_back int default 365
) returns table (
  customer_no   text,
  customer_name text,
  orders        bigint,
  qty_total     numeric,
  revenue_excl  numeric
)
language sql stable security definer
set search_path = public, raw
as $$
  with cand as (
    select array(
      select distinct s from unnest(
        array[btrim(coalesce(p_sku, '')),
              btrim(coalesce(p_sku, '')) || '_STK',
              btrim(coalesce(p_sku, '')) || '_KASSI',
              btrim(coalesce(p_sku, '')) || '_BRETTI',
              btrim(coalesce(p_sku, '')) || '_PK',
              btrim(coalesce(p_sku, '')) || '_PAKKI']
        || coalesce((
             select array_agg(regexp_replace(w.web_sku, '^STO[_]', ''))
             from raw.web_catalog w
             where w.sku = btrim(coalesce(p_sku, ''))
           ), array[]::text[])
      ) as s
      where s <> ''
    ) as skus
  )
  select
    i.company_id::text                                                  as customer_no,
    max(coalesce(nullif(trim(i.company_name), ''), i.company_id))::text as customer_name,
    count(distinct l.document_no)::bigint                               as orders,
    sum(l.qty)::numeric                                                 as qty_total,
    sum(l.amount_excl)::numeric                                         as revenue_excl
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  cross join cand
  where l.sku = any (cand.skus)
    and coalesce(i.booking_date, i.order_date) >= current_date - p_days_back
  group by i.company_id
  order by revenue_excl desc nulls last
  limit 100;
$$;

grant execute on function public.get_product_buyers(text, int) to anon, authenticated;


create or replace function public.get_product_transactions(
  p_sku       text,
  p_days_back int default 90,
  p_limit     int default 100
) returns table (
  booking_date  date,
  document_no   text,
  customer_name text,
  qty           numeric,
  amount_excl   numeric
)
language sql stable security definer
set search_path = public, raw
as $$
  with cand as (
    select array(
      select distinct s from unnest(
        array[btrim(coalesce(p_sku, '')),
              btrim(coalesce(p_sku, '')) || '_STK',
              btrim(coalesce(p_sku, '')) || '_KASSI',
              btrim(coalesce(p_sku, '')) || '_BRETTI',
              btrim(coalesce(p_sku, '')) || '_PK',
              btrim(coalesce(p_sku, '')) || '_PAKKI']
        || coalesce((
             select array_agg(regexp_replace(w.web_sku, '^STO[_]', ''))
             from raw.web_catalog w
             where w.sku = btrim(coalesce(p_sku, ''))
           ), array[]::text[])
      ) as s
      where s <> ''
    ) as skus
  )
  select
    coalesce(i.booking_date, i.order_date)                           as booking_date,
    l.document_no::text,
    coalesce(nullif(trim(i.company_name), ''), i.company_id)::text   as customer_name,
    l.qty::numeric,
    l.amount_excl::numeric
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  cross join cand
  where l.sku = any (cand.skus)
    and coalesce(i.booking_date, i.order_date) >= current_date - p_days_back
  order by coalesce(i.booking_date, i.order_date) desc nulls last
  limit case when p_limit = 0 then null else p_limit end;
$$;

grant execute on function public.get_product_transactions(text, int, int) to anon, authenticated;


-- ── STAÐFESTING ─────────────────────────────────────────────────────
-- Planið á að sýna Index Scan / Bitmap Index Scan á bc_lines_raw, og
-- buffers að fara úr ~118.000 niður í tugi:
--
--   explain (analyze, buffers)
--   select * from public.get_product_transactions('136266', 365, 25);
--
-- Vantar einhverjar sölulínur eftir breytinguna væri það merki um
-- viðskeyti sem hvorki upptalningin né web_catalog nær yfir. Berðu þá
-- saman við gamla formið:
--
--   select count(*) from raw.bc_lines_raw
--    where regexp_replace(sku, '_[A-Za-z0-9]+$', '') = '136266';


-- ── AFRITAVÍSITÖLURNAR ──────────────────────────────────────────────
-- Keyrðu ÞETTA aðeins eftir að hafa staðfest að idx_bc_lines_sku sé á
-- (sku). Þær kosta við hvert innskrif og ekkert les þær.
--
--   drop index if exists raw.bc_lines_raw_sku_idx;
--   drop index if exists raw.bc_lines_raw_sku_pattern_idx;
