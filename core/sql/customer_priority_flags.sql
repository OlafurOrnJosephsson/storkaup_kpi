-- Manual campaign flags for customer onboarding prioritization.
-- Status values: priority / nonpriority (manual rep override).

create schema if not exists api;
create schema if not exists raw;

create table if not exists raw.customer_priority_flags_raw (
  -- Legacy column name kept for compatibility; value stores normalized exact customer key.
  customer_family_id text primary key,
  customer_id text null,
  customer_name text null,
  status text not null check (status in ('priority', 'nonpriority')),
  created_at timestamptz not null default now(),
  assigned_rep_name_norm text null,
  assigned_rep_updated_at timestamptz null,
  note text null,
  updated_at timestamptz not null default now()
);

alter table raw.customer_priority_flags_raw
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_customer_priority_flags_status
  on raw.customer_priority_flags_raw (status);
create index if not exists idx_customer_priority_flags_assigned_rep
  on raw.customer_priority_flags_raw (assigned_rep_name_norm);

drop function if exists api.get_customer_priority_flags();
create or replace function api.get_customer_priority_flags()
returns table (
  customer_family_id text,
  customer_id text,
  customer_name text,
  status text,
  onboarded_status text,
  first_web_order_at timestamptz,
  first_selfserve_order_at timestamptz,
  created_at timestamptz,
  assigned_rep_name_norm text,
  note text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
  with reps as (
    select
      lower(trim(coalesce(r.name_norm, ''))) as rep_name_norm,
      lower(trim(coalesce(r.email_norm, ''))) as rep_email_norm
    from raw.sales_reps_ref r
    where coalesce(r.active, true) = true
  ),
  flags as (
    select
      f.customer_family_id,
      f.customer_id,
      f.customer_name,
      f.status,
      f.created_at,
      f.assigned_rep_name_norm,
      f.note,
      f.updated_at
    from raw.customer_priority_flags_raw f
  ),
  unified_web_orders as (
    select
      regexp_replace(coalesce(to_jsonb(n)->>'company_id', ''), '\D', '', 'g') as company_id_norm,
      regexp_replace(coalesce(to_jsonb(n)->>'national_id', ''), '\D', '', 'g') as national_id_norm,
      n.purchase_date::timestamptz as purchase_date,
      regexp_replace(
        lower(
          translate(
            coalesce(n.customer_name, ''),
            'áðþæöéíóúýÁÐÞÆÖÉÍÓÚÝ',
            'adthaeoeiouyadthaeoeiouy'
          )
        ),
        '[^a-z0-9]+',
        '',
        'g'
      ) as customer_name_norm,
      lower(trim(coalesce(to_jsonb(n)->>'real_email', ''))) as customer_email_norm
    from raw.newweb_orders_raw n
    where n.purchase_date is not null
      and n.purchase_date >= (current_date - interval '365 days')::timestamptz

    union all

    select
      regexp_replace(coalesce(to_jsonb(o)->>'company_id', ''), '\D', '', 'g') as company_id_norm,
      regexp_replace(coalesce(to_jsonb(o)->>'national_id', ''), '\D', '', 'g') as national_id_norm,
      o.purchase_date::timestamptz as purchase_date,
      regexp_replace(
        lower(
          translate(
            coalesce(o.customer_name, ''),
            'áðþæöéíóúýÁÐÞÆÖÉÍÓÚÝ',
            'adthaeoeiouyadthaeoeiouy'
          )
        ),
        '[^a-z0-9]+',
        '',
        'g'
      ) as customer_name_norm,
      lower(trim(coalesce(to_jsonb(o)->>'customer_email', ''))) as customer_email_norm
    from raw.oldweb_orders_raw o
    where o.purchase_date is not null
      and o.purchase_date >= (current_date - interval '365 days')::timestamptz
  ),
  web_orders_for_customer as (
    select
      f.customer_family_id,
      o.purchase_date as purchase_date,
      (
        exists (
          select 1 from reps r
          where r.rep_name_norm <> ''
            and r.rep_name_norm = o.customer_name_norm
        )
        or exists (
          select 1 from reps r
          where r.rep_email_norm <> ''
            and r.rep_email_norm = o.customer_email_norm
        )
      ) as is_rep_order
    from flags f
    join unified_web_orders o
      on (
        o.company_id_norm = f.customer_family_id
        or o.national_id_norm = f.customer_family_id
      )
  ),
  agg as (
    select
      w.customer_family_id,
      min(w.purchase_date) as first_web_order_at,
      min(w.purchase_date) filter (where w.is_rep_order = false) as first_selfserve_order_at
    from web_orders_for_customer w
    group by w.customer_family_id
  )
  select
    f.customer_family_id,
    f.customer_id,
    f.customer_name,
    f.status,
    case
      when f.status <> 'priority' then 'nonpriority'
      when a.first_selfserve_order_at is not null then 'onboarded_selfserve'
      when a.first_web_order_at is not null then 'onboarded_rep_only'
      else 'priority_pending'
    end as onboarded_status,
    a.first_web_order_at,
    a.first_selfserve_order_at,
    f.created_at,
    f.assigned_rep_name_norm,
    f.note,
    f.updated_at
  from flags f
  left join agg a on a.customer_family_id = f.customer_family_id
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
  v_key text;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if v_raw = '' then
    raise exception 'p_customer_id is required';
  end if;

  if v_norm <> '' then
    v_key := v_norm;
  else
    v_key := lower(v_raw);
  end if;

  if v_status = '' then
    delete from raw.customer_priority_flags_raw
    where customer_family_id = v_key;
    return jsonb_build_object('ok', true, 'deleted', true, 'customer_family_id', v_key);
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
    v_key,
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
    'customer_family_id', v_key,
    'status', v_status,
    'assigned_rep_name_norm', (
      select f.assigned_rep_name_norm
      from raw.customer_priority_flags_raw f
      where f.customer_family_id = v_key
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
  v_key text;
  v_rep text := lower(trim(coalesce(p_assigned_rep_name_norm, '')));
begin
  if v_raw = '' then
    raise exception 'p_customer_id is required';
  end if;

  if v_norm <> '' then
    v_key := v_norm;
  else
    v_key := lower(v_raw);
  end if;

  if not exists (select 1 from raw.customer_priority_flags_raw f where f.customer_family_id = v_key) then
    raise exception 'customer flag row not found for customer_family_id=%', v_key;
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
    assigned_rep_updated_at = now()
  where f.customer_family_id = v_key;

  return jsonb_build_object(
    'ok', true,
    'customer_family_id', v_key,
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

create or replace function api.bulk_set_customer_priority_flags(
  p_customer_ids text[],
  p_status text default 'priority',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'api', 'raw', 'public'
as $function$
declare
  v_status text := lower(trim(coalesce(p_status, 'priority')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_raw text;
  v_norm text;
  v_key text;
  v_total integer := 0;
  v_inserted integer := 0;
begin
  if p_customer_ids is null or array_length(p_customer_ids, 1) is null then
    return jsonb_build_object('ok', true, 'total', 0, 'upserted', 0, 'status', v_status);
  end if;

  if v_status not in ('priority', 'nonpriority') then
    raise exception 'p_status must be priority or nonpriority';
  end if;

  foreach v_raw in array p_customer_ids loop
    v_raw := trim(coalesce(v_raw, ''));
    if v_raw = '' then
      continue;
    end if;

    v_norm := regexp_replace(v_raw, '\D', '', 'g');
    if v_norm <> '' then
      v_key := v_norm;
    else
      v_key := lower(v_raw);
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
      v_key,
      nullif(v_raw, ''),
      null,
      v_status,
      null,
      null,
      v_note,
      now()
    )
    on conflict (customer_family_id) do update set
      customer_id = excluded.customer_id,
      status = excluded.status,
      note = coalesce(excluded.note, raw.customer_priority_flags_raw.note),
      updated_at = now();

    v_total := v_total + 1;
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'upserted', v_inserted,
    'status', v_status
  );
end;
$function$;

grant select on table raw.customer_priority_flags_raw to authenticated, anon;
grant all privileges on table raw.customer_priority_flags_raw to service_role;

-- READ functions: anon still allowed (reads remain open pending auth migration)
grant execute on function api.get_customer_priority_flags() to authenticated, anon, service_role;
grant execute on function api.get_active_sales_reps() to authenticated, anon, service_role;

-- WRITE functions: anon/PUBLIC revoked (security review 2026-06-01). Mutating RPCs
-- must not be callable via the public sb_publishable key. Restore requires
-- authenticated access (Supabase Auth + RLS). See security_revoke_anon_writes.sql.
revoke execute on function api.set_customer_priority_flag(text, text, text, text)   from public, anon;
grant  execute on function api.set_customer_priority_flag(text, text, text, text)   to authenticated, service_role;
revoke execute on function api.assign_customer_priority_rep(text, text)             from public, anon;
grant  execute on function api.assign_customer_priority_rep(text, text)             to authenticated, service_role;
revoke execute on function api.bulk_set_customer_priority_flags(text[], text, text) from public, anon;
grant  execute on function api.bulk_set_customer_priority_flags(text[], text, text) to authenticated, service_role;
