-- Manual campaign flags for customer onboarding prioritization.
-- Status values: priority / nonpriority (manual rep override).

create schema if not exists api;
create schema if not exists raw;

create table if not exists raw.customer_priority_flags_raw (
  customer_family_id text primary key,
  customer_id text null,
  customer_name text null,
  status text not null check (status in ('priority', 'nonpriority')),
  assigned_rep_name_norm text null,
  assigned_rep_updated_at timestamptz null,
  note text null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_priority_flags_status
  on raw.customer_priority_flags_raw (status);
create index if not exists idx_customer_priority_flags_assigned_rep
  on raw.customer_priority_flags_raw (assigned_rep_name_norm);

create or replace function api.get_customer_priority_flags()
returns table (
  customer_family_id text,
  customer_id text,
  customer_name text,
  status text,
  assigned_rep_name_norm text,
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
    f.assigned_rep_name_norm,
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
    assigned_rep_name_norm,
    assigned_rep_updated_at,
    note,
    updated_at
  ) values (
    v_family,
    nullif(v_raw, ''),
    nullif(trim(coalesce(p_customer_name, '')), ''),
    v_status,
    null,
    null,
    nullif(trim(coalesce(p_note, '')), ''),
    now()
  )
  on conflict (customer_family_id) do update set
    customer_id = excluded.customer_id,
    customer_name = excluded.customer_name,
    status = excluded.status,
    assigned_rep_name_norm = coalesce(raw.customer_priority_flags_raw.assigned_rep_name_norm, excluded.assigned_rep_name_norm),
    assigned_rep_updated_at = raw.customer_priority_flags_raw.assigned_rep_updated_at,
    note = excluded.note,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'customer_family_id', v_family,
    'status', v_status,
    'assigned_rep_name_norm', (
      select f.assigned_rep_name_norm
      from raw.customer_priority_flags_raw f
      where f.customer_family_id = v_family
      limit 1
    )
  );
end;
$function$;

create or replace function api.assign_customer_priority_rep(
  p_customer_id text,
  p_assigned_rep_name_norm text default null
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
  v_rep text := lower(trim(coalesce(p_assigned_rep_name_norm, '')));
begin
  if v_raw = '' then
    raise exception 'p_customer_id is required';
  end if;

  if v_norm <> '' then
    v_family := case when length(v_norm) > 10 then left(v_norm, 10) else v_norm end;
  else
    v_family := v_raw;
  end if;

  if not exists (select 1 from raw.customer_priority_flags_raw f where f.customer_family_id = v_family) then
    raise exception 'customer flag row not found for customer_family_id=%', v_family;
  end if;

  if v_rep <> '' and not exists (
    select 1
    from raw.sales_reps_ref r
    where coalesce(r.active, true) = true
      and lower(trim(coalesce(r.name_norm, ''))) = v_rep
  ) then
    raise exception 'assigned rep not found in raw.sales_reps_ref: %', v_rep;
  end if;

  update raw.customer_priority_flags_raw f
  set
    assigned_rep_name_norm = nullif(v_rep, ''),
    assigned_rep_updated_at = now(),
    updated_at = now()
  where f.customer_family_id = v_family;

  return jsonb_build_object(
    'ok', true,
    'customer_family_id', v_family,
    'assigned_rep_name_norm', nullif(v_rep, '')
  );
end;
$function$;

create or replace function api.get_active_sales_reps()
returns table (
  name_norm text,
  email_norm text
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
  select
    trim(coalesce(r.name_norm, '')) as name_norm,
    lower(trim(coalesce(r.email_norm, ''))) as email_norm
  from raw.sales_reps_ref r
  where coalesce(r.active, true) = true
    and trim(coalesce(r.name_norm, '')) <> ''
  order by 1;
$function$;

grant select on table raw.customer_priority_flags_raw to authenticated, anon;
grant all privileges on table raw.customer_priority_flags_raw to service_role;

grant execute on function api.get_customer_priority_flags() to authenticated, anon, service_role;
grant execute on function api.set_customer_priority_flag(text, text, text, text) to authenticated, anon, service_role;
grant execute on function api.assign_customer_priority_rep(text, text) to authenticated, anon, service_role;
grant execute on function api.get_active_sales_reps() to authenticated, anon, service_role;
