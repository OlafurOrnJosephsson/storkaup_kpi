-- Materialized layer for the solution-page pipeline.
-- The live view chain (segments → fit → affinity → themes) exceeds the
-- PostgREST statement timeout (57014) when GAS reads it over REST — same
-- issue as top_products (solved with mart.mv_top_products_master).
--
-- Apply order:
--   1. customer_segmentation.sql + solution_page_themes.sql (api views)
--   2. this file (mart MVs + refresh RPC + grants)
--   3. solution_page_products.sql (RPC re-pointed at mart.mv_customer_segments)
--
-- GAS calls public.refresh_solution_page_marts() before seeding, so the
-- MVs stay fresh without a scheduled refresh.

drop materialized view if exists mart.mv_solution_page_themes;
create materialized view mart.mv_solution_page_themes as
select * from api.v_solution_page_themes_v1;

drop materialized view if exists mart.mv_customer_segments;
create materialized view mart.mv_customer_segments as
select * from api.v_customer_segments;

-- Refresh runs as owner with a raised timeout — the whole point is that the
-- underlying chain is slower than the API role's statement_timeout.
create or replace function public.refresh_solution_page_marts()
returns void
language plpgsql
security definer
set statement_timeout = '300s'
as $$
begin
  refresh materialized view mart.mv_customer_segments;
  refresh materialized view mart.mv_solution_page_themes;
end;
$$;

grant usage on schema mart to service_role;
grant select on mart.mv_solution_page_themes, mart.mv_customer_segments to service_role;
grant execute on function public.refresh_solution_page_marts() to service_role;
