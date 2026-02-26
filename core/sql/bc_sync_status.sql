-- BC sync status RPC for dashboard metadata
-- Exposes last successful BC sync timestamp and recent error count.

create schema if not exists api;

create or replace function api.bc_sync_status()
returns table (
  last_success_at timestamptz,
  last_run_at timestamptz,
  last_error_at timestamptz,
  error_count_24h bigint
)
language sql
stable
security definer
set search_path = raw, public
as $$
  with src as (
    select
      started_at,
      status
    from raw.ingestion_runs
    where job_name = 'scheduledBcSync_v1'
  )
  select
    max(started_at) filter (where status = 'success') as last_success_at,
    max(started_at) as last_run_at,
    max(started_at) filter (where status = 'error') as last_error_at,
    count(*) filter (
      where status = 'error'
        and started_at >= (now() - interval '24 hours')
    )::bigint as error_count_24h
  from src;
$$;

grant usage on schema api to anon, authenticated, service_role;
grant execute on function api.bc_sync_status() to anon, authenticated, service_role;
