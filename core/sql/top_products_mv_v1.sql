-- Materialize top products and category master views.
-- api.v_top_products_master and api.v_category_master were timing out via REST API
-- because mart.v_top_products_master / mart.v_category_master hit v_order_lines_enriched
-- (full scan across all periods) on every request.
--
-- Fix: pre-compute both into MVs; redirect api views to read from MVs.
-- Refresh: called from refreshSupabaseMarts_v1 in GAS (off-peak guard already in place).
--
-- Apply: run in Supabase SQL editor.

-- 1. Materialized views
create materialized view if not exists mart.mv_top_products_master as
select * from mart.v_top_products_master;

create index if not exists idx_mv_top_products_master_period
  on mart.mv_top_products_master (period);

create index if not exists idx_mv_top_products_master_period_rev
  on mart.mv_top_products_master (period, total_revenue_excl desc nulls last);

create materialized view if not exists mart.mv_category_master as
select * from mart.v_category_master;

create index if not exists idx_mv_category_master_period
  on mart.mv_category_master (period);

create index if not exists idx_mv_category_master_period_rev
  on mart.mv_category_master (period, total_revenue_excl desc nulls last);

-- 2. Redirect api views to read from MVs
create or replace view api.v_top_products_master as
select * from mart.mv_top_products_master;

create or replace view api.v_category_master as
select * from mart.mv_category_master;

-- 3. Grants
grant select on mart.mv_top_products_master to anon, authenticated;
grant select on mart.mv_category_master to anon, authenticated;

-- 4. Refresh function (called from GAS refreshSupabaseMarts_v1)
create or replace function public.refresh_mv_top_products_master()
returns void
language plpgsql
security definer
as $$
begin
  refresh materialized view mart.mv_top_products_master;
  refresh materialized view mart.mv_category_master;
end;
$$;

notify pgrst, 'reload schema';
