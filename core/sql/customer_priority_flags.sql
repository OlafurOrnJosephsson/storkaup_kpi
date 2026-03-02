-- Manual campaign flags for customer onboarding prioritization.
-- Status values: priority / nonpriority (manual rep override).

create schema if not exists api;
create schema if not exists raw;

create table if not exists raw.customer_priority_flags_raw (
  customer_family_id text primary key,
  customer_id text null,
  customer_name text null,
  status text not null check (status in ('priority', 'nonpriority')),
  note text null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_priority_flags_status
  on raw.customer_priority_flags_raw (status);

create or replace function api.get_customer_priority_flags()
returns table (
  customer_family_id text,
  customer_id text,
  customer_name text,
  status text,
  note text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
  select
    f.customer_family_id,
    f.customer_id,
    f.customer_name,
    f.status,
    f.note,
    f.updated_at
  from raw.customer_priority_flags_raw f
  order by f.updated_at desc;
$function$;

create or replace function api.set_customer_priority_flag(
  p_customer_id text,
  p_status text,
  p_customer_name text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'api', 'raw', 'public'
as $function$
declare
  v_raw text := trim(coalesce(p_customer_id, ''));
  v_norm text := regexp_replace(v_raw, '\D', '', 'g');
  v_family text;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if v_raw = '' then
    raise exception 'p_customer_id is required';
  end if;

  if v_norm <> '' then
    v_family := case when length(v_norm) > 10 then left(v_norm, 10) else v_norm end;
  else
    v_family := v_raw;
  end if;

  if v_status = '' then
    delete from raw.customer_priority_flags_raw
    where customer_family_id = v_family;
    return jsonb_build_object('ok', true, 'deleted', true, 'customer_family_id', v_family);
  end if;

  if v_status not in ('priority', 'nonpriority') then
    raise exception 'p_status must be priority or nonpriority (or empty to clear)';
  end if;

  insert into raw.customer_priority_flags_raw (
    customer_family_id,
    customer_id,
    customer_name,
    status,
    note,
    updated_at
  ) values (
    v_family,
    nullif(v_raw, ''),
    nullif(trim(coalesce(p_customer_name, '')), ''),
    v_status,
    nullif(trim(coalesce(p_note, '')), ''),
    now()
  )
  on conflict (customer_family_id) do update set
    customer_id = excluded.customer_id,
    customer_name = excluded.customer_name,
    status = excluded.status,
    note = excluded.note,
    updated_at = now();

  return jsonb_build_object('ok', true, 'customer_family_id', v_family, 'status', v_status);
end;
$function$;

grant select on table raw.customer_priority_flags_raw to authenticated, anon;
grant all privileges on table raw.customer_priority_flags_raw to service_role;

grant execute on function api.get_customer_priority_flags() to authenticated, anon, service_role;
grant execute on function api.set_customer_priority_flag(text, text, text, text) to authenticated, anon, service_role;
