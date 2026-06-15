-- Web activation funnel — fresh, BC-free.
--
-- Goal: drive the North Star (move customers to repeat web ordering) using ONLY
-- data sources that are still fresh after BC ingest was closed:
--   raw.magento_customers_raw  → "has a web account" (1 row per Magento user; a
--                                 company has >=1 row, keyed by company_id = kennitala)
--   raw.newweb_orders_raw       → fresh web orders (Magento), order-level
--   raw.oldweb_orders_raw       → legacy web orders
--   raw.sales_reps_ref          → to split rep-placed orders from real self-serve
--   raw.customer_priority_flags_raw → priority status + assigned rep overlay
--
-- It deliberately touches NO BC table — those are frozen and their rolling
-- windows now decay to zero, so any BC-derived "migration" signal is unreliable.
--
-- Read pattern mirrors api.get_customer_priority_flags(): SECURITY DEFINER so the
-- anon dashboard role can read despite RLS on the raw tables.
--
-- Apply: run in the Supabase SQL editor.
--
-- ASSUMPTIONS (verify against actual schema; easy to tune):
--   1. *_orders_raw is ORDER-LEVEL (one row per web order). If it is line-level,
--      web_orders_count inflates — switch count(*) to count(distinct <order_id>).
--   2. Account key = company_id (company kennitala). magento_customers_raw does not
--      currently carry national_id, so individual-in-business accounts only appear
--      here if they have web orders. (Add national_id to the magento upsert to fix.)
--   3. No account-created date yet (not synced). When created_at is added to
--      raw.magento_customers_raw we can add account-age urgency to 'never_ordered'.
--   4. State thresholds 30 / 60 / 90 days — tune to taste.

create schema if not exists api;

-- ---------------------------------------------------------------------------
-- Per-customer activation state.
-- p_only_with_account: when true, restrict to customers that actually have a
--                      web account (the strongest activation/reactivation targets).
-- p_states:            optional filter, e.g. array['never_ordered','lapsing'].
-- ---------------------------------------------------------------------------
drop function if exists api.get_web_activation(boolean, text[]);
create or replace function api.get_web_activation(
  p_only_with_account boolean default false,
  p_states            text[]  default null
)
returns table (
  customer_key            text,
  company_name            text,
  has_account             boolean,
  account_count           integer,
  web_orders_count        bigint,
  self_serve_orders       bigint,
  first_web_order_at      timestamptz,
  last_web_order_at       timestamptz,
  days_since_last_order   integer,
  state                   text,
  priority_status         text,
  assigned_rep_name_norm  text
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $fn$
  with reps as (
    select
      lower(trim(coalesce(r.name_norm, '')))  as rep_name_norm,
      lower(trim(coalesce(r.email_norm, ''))) as rep_email_norm
    from raw.sales_reps_ref r
    where coalesce(r.active, true) = true
  ),
  web as (
    select
      regexp_replace(coalesce(to_jsonb(n)->>'company_id', ''),  '\D', '', 'g') as company_id_norm,
      regexp_replace(coalesce(to_jsonb(n)->>'national_id', ''), '\D', '', 'g') as national_id_norm,
      n.purchase_date::timestamptz as purchase_date,
      regexp_replace(lower(translate(coalesce(n.customer_name, ''),
        'áðþæöéíóúýÁÐÞÆÖÉÍÓÚÝ', 'adthaeoeiouyadthaeoeiouy')), '[^a-z0-9]+', '', 'g') as customer_name_norm,
      lower(trim(coalesce(to_jsonb(n)->>'real_email', ''))) as customer_email_norm
    from raw.newweb_orders_raw n
    where n.purchase_date is not null

    union all

    select
      regexp_replace(coalesce(to_jsonb(o)->>'company_id', ''),  '\D', '', 'g'),
      regexp_replace(coalesce(to_jsonb(o)->>'national_id', ''), '\D', '', 'g'),
      o.purchase_date::timestamptz,
      regexp_replace(lower(translate(coalesce(o.customer_name, ''),
        'áðþæöéíóúýÁÐÞÆÖÉÍÓÚÝ', 'adthaeoeiouyadthaeoeiouy')), '[^a-z0-9]+', '', 'g'),
      lower(trim(coalesce(to_jsonb(o)->>'customer_email', '')))
    from raw.oldweb_orders_raw o
    where o.purchase_date is not null
  ),
  web_keyed as (
    select
      coalesce(nullif(w.company_id_norm, ''), w.national_id_norm) as customer_key,
      w.purchase_date,
      (
        exists (select 1 from reps r where r.rep_name_norm  <> '' and r.rep_name_norm  = w.customer_name_norm)
        or
        exists (select 1 from reps r where r.rep_email_norm <> '' and r.rep_email_norm = w.customer_email_norm)
      ) as is_rep_order
    from web w
    where coalesce(nullif(w.company_id_norm, ''), w.national_id_norm) <> ''
  ),
  order_agg as (
    select
      customer_key,
      count(*)                                       as web_orders_count,
      count(*) filter (where is_rep_order = false)   as self_serve_orders,
      min(purchase_date)                             as first_web_order_at,
      max(purchase_date)                             as last_web_order_at
    from web_keyed
    group by customer_key
  ),
  accounts as (
    select
      regexp_replace(coalesce(company_id, ''), '\D', '', 'g') as customer_key,
      max(company_name)                                       as company_name,
      count(*)                                                as account_count
    from raw.magento_customers_raw
    where regexp_replace(coalesce(company_id, ''), '\D', '', 'g') <> ''
    group by 1
  ),
  base as (
    select
      coalesce(a.customer_key, o.customer_key)  as customer_key,
      a.company_name,
      coalesce(a.account_count, 0)              as account_count,
      coalesce(o.web_orders_count, 0)           as web_orders_count,
      coalesce(o.self_serve_orders, 0)          as self_serve_orders,
      o.first_web_order_at,
      o.last_web_order_at
    from accounts a
    full outer join order_agg o on o.customer_key = a.customer_key
  ),
  classified as (
    select
      b.*,
      case
        when b.web_orders_count = 0                                     then 'never_ordered'
        when (current_date - b.first_web_order_at::date) <= 30          then 'activating'
        when (current_date - b.last_web_order_at::date)  <= 60          then 'active'
        when (current_date - b.last_web_order_at::date)  <= 90          then 'lapsing'
        else 'lapsed'
      end as state
    from base b
  )
  select
    c.customer_key,
    c.company_name,
    (c.account_count > 0) as has_account,
    c.account_count,
    c.web_orders_count,
    c.self_serve_orders,
    c.first_web_order_at,
    c.last_web_order_at,
    case when c.last_web_order_at is null then null
         else (current_date - c.last_web_order_at::date) end as days_since_last_order,
    c.state,
    f.status                 as priority_status,
    f.assigned_rep_name_norm
  from classified c
  left join raw.customer_priority_flags_raw f on f.customer_family_id = c.customer_key
  where (p_only_with_account = false or c.account_count > 0)
    and (p_states is null or c.state = any(p_states));
$fn$;

-- ---------------------------------------------------------------------------
-- Headline activation KPIs (the leading indicators that move BEFORE revenue).
-- ---------------------------------------------------------------------------
drop function if exists api.web_activation_kpis();
create or replace function api.web_activation_kpis()
returns table (
  web_active_90d              bigint,  -- ordered on web in last 90d (the core growth number)
  new_web_customers_mtd       bigint,  -- first-ever web order this calendar month
  account_never_ordered       bigint,  -- has a web account, zero web orders (prime activation target)
  lapsing_30_to_90d           bigint,  -- ordered before but quiet 60-90d (catch before they churn)
  lapsed_over_90d             bigint
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $fn$
  with a as (
    select * from api.get_web_activation(false, null)
  )
  select
    count(*) filter (where last_web_order_at >= (current_date - interval '90 days')),
    count(*) filter (where first_web_order_at >= date_trunc('month', current_date)),
    count(*) filter (where state = 'never_ordered'),
    count(*) filter (where state = 'lapsing'),
    count(*) filter (where state = 'lapsed')
  from a;
$fn$;

-- ---------------------------------------------------------------------------
-- Per-rep activation scoreboard — turns the KPI into a behaviour driver for the
-- sales team. Only counts customers that have a priority flag with an assigned rep.
-- ---------------------------------------------------------------------------
drop function if exists api.web_activation_by_rep();
create or replace function api.web_activation_by_rep()
returns table (
  assigned_rep_name_norm  text,
  targets                 bigint,  -- assigned customers not yet self-serve active
  account_never_ordered   bigint,
  lapsing                 bigint,
  activated_mtd           bigint   -- assigned customers whose first web order is this month
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $fn$
  with a as (
    select * from api.get_web_activation(false, null)
    where assigned_rep_name_norm is not null and assigned_rep_name_norm <> ''
  )
  select
    assigned_rep_name_norm,
    count(*) filter (where state in ('never_ordered','lapsing','lapsed')),
    count(*) filter (where state = 'never_ordered'),
    count(*) filter (where state = 'lapsing'),
    count(*) filter (where first_web_order_at >= date_trunc('month', current_date))
  from a
  group by assigned_rep_name_norm
  order by 2 desc;
$fn$;

-- Read grants mirror the existing priority-flag read RPCs (anon stays open
-- pending Supabase Auth Phase 3; these expose no BC financials).
grant execute on function api.get_web_activation(boolean, text[]) to authenticated, anon, service_role;
grant execute on function api.web_activation_kpis()                to authenticated, anon, service_role;
grant execute on function api.web_activation_by_rep()              to authenticated, anon, service_role;
