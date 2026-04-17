-- Materialized view for customer profiles list (Forgangslisti / Innkaupalistar).
-- Wraps api.v_customer_profiles_labeled_trends so initial page loads hit a
-- pre-computed snapshot instead of re-evaluating rolling window calculations.
--
-- Refresh cadence: called from scheduledCustomerAnalysisSync_v1 after each ingest run.
-- Staleness: at most ~24h behind the live view, acceptable for a daily-refresh list.
--
-- Apply: run in Supabase SQL editor.

create materialized view if not exists api.mv_customer_profiles_labeled_trends as
select * from api.v_customer_profiles_labeled_trends;

create index if not exists idx_mv_cplit_customer_id
  on api.mv_customer_profiles_labeled_trends (customer_id);

create index if not exists idx_mv_cplit_lhfs_score
  on api.mv_customer_profiles_labeled_trends (low_hanging_fruit_score desc nulls last);

create or replace function public.refresh_mv_customer_profiles_labeled_trends()
returns void
language plpgsql
security definer
as $$
begin
  if to_regclass('api.mv_customer_profiles_labeled_trends') is not null then
    refresh materialized view api.mv_customer_profiles_labeled_trends;
  end if;
end;
$$;
