-- ============================================================================
-- public.web_records_v1(p_month_start date)
--
-- "Met og áfangar" for the monthly digest (core/email.js ->
-- buildMonthlyDigestHtml_). Answers, for one closed calendar month:
--   * was it an all-time record month by web orders / by web revenue?
--   * which day of the month was the busiest, and was that an all-time day record?
--   * did the month cross a round cumulative-order milestone (10.000th order ...)?
--   * how does it compare to the same month a year earlier?
--
-- Deliberately a SEPARATE function from monthly_digest_stats, not more CTEs
-- bolted onto it, for two reasons:
--   1. monthly_digest_stats already exceeds the 8s anon statement_timeout (it
--      scans raw.bc_invoices_raw plus a full first_seen aggregate). Records are
--      cheap; keeping them apart keeps them cheap.
--   2. "Webflow dashboards must degrade gracefully if a secondary RPC fails"
--      applies just as much to the digest: if this call throws, the email drops
--      one section instead of not going out at all. core/email.js wraps it in
--      try/catch for exactly that reason.
--
-- Apply in the Supabase SQL editor. Idempotent.
--
-- -- TWO MEASUREMENT DECISIONS, BOTH DELIBERATE ------------------------------
--
-- A. History is NEWWEB + OLDWEB unioned, so "all-time" really means back to
--    2022-04 and not just to the Magento 2 cutover. monthly_digest_stats itself
--    reports NEWWEB only; that is not an inconsistency for any month after
--    2025-09, because raw.oldweb_orders_raw is empty from then on. It WOULD
--    disagree for a month before the cutover -- do not reuse this function to
--    caption a pre-2025-09 month without checking that.
--
-- B. Revenue is ranked on subtotal_INCL, while everything else in the digest is
--    excl. Not sloppiness: OLDWEB.subtotal_excl is not a VAT-exclusive figure at
--    all (it maps to the Magento 1 grid column `Subtotal`, a gross
--    pre-adjustment goods figure, and comes out ABOVE subtotal_incl on 65% of
--    its 20,980 orders -- see RUNBOOK.md, "OLDWEB revenue_excl is not
--    VAT-exclusive revenue"). Ranking the excl series across the cutover would
--    invent records that never happened. incl is the only revenue field that is
--    continuous over 2022 -> today, so the email labels the revenue record
--    "m/VSK" and leaves it at that.
--    Order COUNTS have no such problem, and are the headline metric here.
--
-- -- WHAT IS NOT FILTERED ----------------------------------------------------
-- No status filter. raw.newweb_orders_raw.status carries pending/canceled etc.,
-- but neither api.dashboard_compat nor monthly_digest_stats filters on it, and a
-- record that contradicts the number printed higher up in the same email is
-- worse than a record that counts a cancelled order. If that basis is ever
-- changed, change it in all three places in the same commit.
--
-- Only complete periods compete: months before date_trunc('month', current_date)
-- and days before current_date. A half-finished month can therefore never take
-- the crown off a finished one, and "yesterday was a record" stays true tomorrow.
-- ============================================================================

drop function if exists public.web_records_v1(text);

create or replace function public.web_records_v1(
  p_month_start date default (date_trunc('month', current_date) - interval '1 month')::date
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'raw'
as $function$
with params as (
  select
    p_month_start::date                         as month_start,
    (p_month_start + interval '1 month')::date   as month_end,
    date_trunc('month', current_date)::date      as cur_month_start,
    (p_month_start - interval '1 year')::date    as yoy_start
),

-- One row per web order, both eras. src is part of the identity key: the two
-- systems number orders independently, so order_id alone is not unique across
-- them. They also overlapped 2025-07-18..2025-08-18 during the parallel run --
-- check 4 in the VERIFY block below tests that overlap for genuine duplicates.
unified as (
  select 'new'::text as src,
         n.order_id::text as order_id,
         n.purchase_date  as purchase_date,
         coalesce(n.subtotal_incl, 0)::numeric as revenue_incl
  from raw.newweb_orders_raw n
  where n.order_id is not null and n.purchase_date is not null
  union all
  select 'old'::text,
         o.order_id::text,
         o.purchase_date,
         coalesce(o.subtotal_incl, 0)::numeric
  from raw.oldweb_orders_raw o
  where o.order_id is not null and o.purchase_date is not null
),

by_month as (
  select date_trunc('month', purchase_date)::date       as m,
         count(distinct src || ':' || order_id)::int     as orders,
         coalesce(sum(revenue_incl), 0)::numeric        as revenue_incl
  from unified
  group by 1
),
months as (          -- closed months only
  select b.* from by_month b cross join params p where b.m < p.cur_month_start
),
months_ranked as (
  select m, orders, revenue_incl,
         rank() over (order by orders       desc) as rank_orders,
         rank() over (order by revenue_incl desc) as rank_revenue
  from months
),
this_month as (
  select r.* from months_ranked r cross join params p where r.m = p.month_start
),
prev_best_month_orders as (
  select c.m, c.orders from months c cross join params p
  where c.m <> p.month_start order by c.orders desc, c.m desc limit 1
),
prev_best_month_revenue as (
  select c.m, c.revenue_incl from months c cross join params p
  where c.m <> p.month_start order by c.revenue_incl desc, c.m desc limit 1
),
month_span as (
  select count(*)::int as months_compared,
         to_char(min(m), 'YYYY-MM') as history_start
  from months
),
yoy as (
  select b.orders, b.revenue_incl
  from by_month b cross join params p where b.m = p.yoy_start
),

by_day as (
  select purchase_date::date                             as d,
         count(distinct src || ':' || order_id)::int      as orders,
         coalesce(sum(revenue_incl), 0)::numeric         as revenue_incl
  from unified
  group by 1
),
days as (            -- closed days only
  select * from by_day where d < current_date
),
days_ranked as (
  select d, orders, revenue_incl,
         rank() over (order by orders       desc) as rank_orders,
         rank() over (order by revenue_incl desc) as rank_revenue
  from days
),
best_day as (        -- busiest day OF THE REPORTED MONTH
  select r.* from days_ranked r cross join params p
  where r.d >= p.month_start and r.d < p.month_end
  order by r.orders desc, r.revenue_incl desc, r.d desc
  limit 1
),
prev_best_day_orders as (
  select d, orders from days
  where d <> (select d from best_day)
  order by orders desc, d desc
  limit 1
),

-- Cumulative-order milestone: the highest round-thousand order number that
-- landed inside the reported month. rn is the all-time sequence number of each
-- web order, so rn = 30000 is literally the 30.000th web order ever placed.
seq as (
  select purchase_date,
         row_number() over (order by purchase_date, src, order_id) as rn
  from unified
),
milestone as (
  select s.rn::int as rn, s.purchase_date::date as d
  from seq s cross join params p
  where s.purchase_date >= p.month_start::timestamp
    and s.purchase_date <  p.month_end::timestamp
    and s.rn % 1000 = 0
  order by s.rn desc
  limit 1
),
orders_total as (
  select count(*)::int as total
  from unified u cross join params p
  where u.purchase_date < p.month_end::timestamp
)

select jsonb_build_object(
  'month',           (select to_char(month_start, 'YYYY-MM') from params),
  'history_start',   (select history_start   from month_span),
  'months_compared', (select months_compared from month_span),

  'month_orders',       (select orders       from this_month),
  'month_revenue_incl', (select revenue_incl from this_month),
  'rank_orders',        (select rank_orders  from this_month),
  'rank_revenue',       (select rank_revenue from this_month),
  'is_record_orders',   coalesce((select rank_orders  from this_month) = 1, false),
  'is_record_revenue',  coalesce((select rank_revenue from this_month) = 1, false),

  'prev_best_orders', (
    select jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'orders', orders)
    from prev_best_month_orders),
  'prev_best_revenue', (
    select jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'revenue_incl', revenue_incl)
    from prev_best_month_revenue),

  'yoy_orders',       (select orders       from yoy),
  'yoy_revenue_incl', (select revenue_incl from yoy),

  'best_day', (
    select jsonb_build_object(
      'date',              to_char(d, 'YYYY-MM-DD'),
      'orders',            orders,
      'revenue_incl',      revenue_incl,
      'rank_orders',       rank_orders,
      'is_record_orders',  rank_orders = 1,
      'is_record_revenue', rank_revenue = 1)
    from best_day),
  'prev_best_day', (
    select jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'), 'orders', orders)
    from prev_best_day_orders),

  'milestone', (
    select jsonb_build_object('nth', rn, 'date', to_char(d, 'YYYY-MM-DD'))
    from milestone),
  'orders_all_time', (select total from orders_total)
);
$function$;

-- -- GRANTS -----------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC on a new function by default, which is how
-- anon ends up able to call things nobody meant to expose (see the
-- security_revoke_anon_*.sql files). Only GAS needs this one, and GAS calls as
-- service_role (callSupabaseRpc_ in core/utils.js).
revoke all on function public.web_records_v1(date) from public;
revoke all on function public.web_records_v1(date) from anon;
grant execute on function public.web_records_v1(date) to service_role;

notify pgrst, 'reload schema';


-- -- VERIFY -----------------------------------------------------------------
-- 1) The exact payload the digest will use for the month reported on 2026-09-01:
--
-- select jsonb_pretty(public.web_records_v1('2026-08-01'));

-- 2) Top 10 months all time -- does August 2026 actually lead on orders?
--
-- with unified as (
--   select 'new' src, order_id::text oid, purchase_date, coalesce(subtotal_incl,0) inc
--     from raw.newweb_orders_raw where order_id is not null and purchase_date is not null
--   union all
--   select 'old', order_id::text, purchase_date, coalesce(subtotal_incl,0)
--     from raw.oldweb_orders_raw where order_id is not null and purchase_date is not null)
-- select to_char(date_trunc('month', purchase_date),'YYYY-MM') as ym,
--        count(distinct src||':'||oid) as orders,
--        round(sum(inc)) as revenue_incl
-- from unified
-- where date_trunc('month', purchase_date) < date_trunc('month', current_date)
-- group by 1 order by orders desc limit 10;

-- 3) Top 10 days all time -- was 2026-08-31 really the busiest day?
--    (same unified CTE as above)
--
-- select purchase_date::date as d,
--        count(distinct src||':'||oid) as orders,
--        round(sum(inc)) as revenue_incl
-- from unified where purchase_date::date < current_date
-- group by 1 order by orders desc limit 10;

-- 4) Parallel-run sanity: did any order land in BOTH systems 2025-07-18..08-18?
--    A non-zero count means those two months are double-counted above and the
--    identity key has to become something cross-system (web_order_no).
--
-- select count(*) as shared_order_ids
-- from raw.newweb_orders_raw n
-- join raw.oldweb_orders_raw o on o.order_id::text = n.order_id::text;
