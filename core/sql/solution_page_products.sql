-- Solution page build support (cross-category SEO pages, kaffistofan template)
-- Run in Supabase SQL editor. Requires customer_segmentation.sql +
-- solution_page_themes.sql views to exist.
--
-- Part A: verification queries (run and inspect — do not skip).
--   The exported "SEO priority pages" sheet showed vidskiptavinir_365d ==
--   pantanir_365d in every row, which is almost certainly an export bug.
--   A1/A2 confirm what the live views actually say before re-prioritizing.
-- Part B: RPC that returns the product sections for one solution page —
--   top products per subcategory for a segment, i.e. exactly the H2-section
--   structure of storkaup.is/kaffistofan, but data-driven.

-- ============================================================
-- A0) Segment health — run AFTER re-applying customer_segmentation.sql +
--     solution_page_themes.sql (2026-07-16: live Supabase views were an
--     older generation — every customer landed in one segment and
--     fit_score was constant 1).
--     A0a: distribution should spread across several segments; if one
--          segment holds ~everything, segmentation inputs are broken.
--     A0b: if most rows have null last_bc_order_date, recency defaults
--          to 999 and everyone becomes at_risk_declining.
-- ============================================================
-- A0a:
-- select segment_id, count(*) as customers, sum(total_value)::bigint as total_value
-- from api.v_customer_segments
-- group by 1 order by 2 desc;
--
-- A0b:
-- select count(*) as total_rows,
--        count(*) filter (where last_bc_order_date is null) as null_last_order,
--        max(last_bc_order_date) as freshest_order_date
-- from raw.customer_analysis_raw;

-- ============================================================
-- A1) Live theme numbers — customers and orders should differ per row.
--     If they are equal here too, debug the views; if they differ, the
--     sheet export was broken and priorities must be re-pulled from A3.
-- ============================================================
-- select segment_id, category_l1, category_l2,
--        customers_365d, orders_365d, revenue_365d, solution_fit_score
-- from api.v_category_solution_fit_v1
-- order by revenue_365d desc
-- limit 20;

-- ============================================================
-- A2) Raw cross-check, independent of the segment join.
-- ============================================================
-- select count(distinct i.company_id)  as customers_365d,
--        count(distinct l.document_no) as orders_365d,
--        sum(coalesce(l.amount_excl, 0)) as revenue_365d
-- from raw.bc_lines_raw l
-- join raw.bc_invoices_raw i on i.document_no = l.document_no
-- where coalesce(i.order_date::date, current_date) >= current_date - 365;

-- ============================================================
-- A3) Fresh prioritized theme list — source of truth for the sheet.
-- ============================================================
-- select * from api.v_solution_page_themes_v1;

-- ============================================================
-- B) Product sections for a solution page.
--    One row per (subcategory, product); rank_in_group orders products
--    within each subcategory by segment revenue. Feeds the H2 sections +
--    product modules when building the next /kaffistofan-style page.
--    Example:
--      select * from api.get_solution_page_products_v1('coffee_room_heavy_buyers', 'Matvörur');
-- ============================================================
create or replace function api.get_solution_page_products_v1(
  p_segment_id text,
  p_category_l1 text default null,
  p_days_back int default 365,
  p_per_group int default 12
)
returns table (
  category_l1 text,
  category_l2 text,
  sku text,
  product_name text,
  orders bigint,
  customers bigint,
  revenue_excl numeric,
  rank_in_group bigint
)
language sql
stable
as $$
  with eligible_customers as (
    select customer_id
    from api.v_customer_segments
    where segment_id = p_segment_id
  ),
  prod as (
    select
      coalesce(
        nullif(p.level1, ''),
        nullif(split_part(coalesce(p.category_path, ''), ' / ', 1), ''),
        'Unknown'
      ) as category_l1,
      coalesce(
        nullif(p.level2, ''),
        nullif(split_part(coalesce(p.category_path, ''), ' / ', 2), ''),
        'Unknown'
      ) as category_l2,
      l.sku,
      coalesce(max(l.product_name), max(p.product_name), l.sku) as product_name,
      count(distinct l.document_no)::bigint as orders,
      count(distinct i.company_id)::bigint as customers,
      sum(coalesce(l.amount_excl, 0))::numeric as revenue_excl
    from raw.bc_lines_raw l
    join raw.bc_invoices_raw i on i.document_no = l.document_no
    join eligible_customers c on c.customer_id::text = i.company_id::text
    left join raw.products_raw p on p.sku = l.sku
    where coalesce(i.order_date::date, current_date) >= current_date - greatest(p_days_back, 1)
      and l.sku is not null
    group by 1, 2, l.sku
  ),
  ranked as (
    select
      prod.*,
      row_number() over (
        partition by prod.category_l1, prod.category_l2
        order by prod.revenue_excl desc, prod.orders desc
      ) as rank_in_group
    from prod
  )
  select
    category_l1,
    category_l2,
    sku,
    product_name,
    orders,
    customers,
    revenue_excl,
    rank_in_group
  from ranked
  where rank_in_group <= greatest(p_per_group, 1)
    and (p_category_l1 is null or category_l1 = p_category_l1)
  order by category_l1, category_l2, rank_in_group;
$$;

comment on function api.get_solution_page_products_v1(text, text, int, int)
is 'Top products per subcategory for a segment — H2 sections + product modules for cross-category solution pages (kaffistofan template).';
