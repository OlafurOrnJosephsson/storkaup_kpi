-- ============================================================================
-- api.generate_shopping_list_v2 — Innkaupalisti generator
--
-- Powers the Innkaupalisti panel on /kpi/vidskiptavinur
-- (Webflow/customer-profiles.js:1211) and its XLSX/PDF export.
--
-- PROVENANCE: this file was reconstructed from the live database on 2026-08-05
-- via pg_get_functiondef. It had NO file in core/sql/ — the function existed only
-- in Supabase, created straight in the SQL editor. That made the Innkaupalisti
-- unreproducible if the project were lost (assessment item 7, lykilmannaáhætta).
-- Do not edit the database copy without updating this file.
--
-- ⚠️ KNOWN BUG — p_days_back is declared but NEVER USED.
-- There is no date predicate anywhere in the body, so the function aggregates
-- the customer's ENTIRE BC line history regardless of what the caller passes.
-- The frontend sends a window and silently gets all-time figures. This is
-- probably why api.generate_shopping_list_v3 exists (1488 chars vs 1225 here) —
-- likely the version that implements the filter, but nothing calls it.
-- Decide deliberately when porting to the admin app: fix the window, adopt v3,
-- or keep all-time behaviour on purpose. Do not copy this forward unexamined.
--
-- Sibling versions, all anon-revoked 2026-08-05 (security_revoke_anon_orphans):
--   api.generate_shopping_list_v1     1241 chars, no caller
--   api.generate_shopping_list_v3     1488 chars, no caller
--   public.generate_shopping_list_v1  2059 chars, no caller, divergent copy
-- ============================================================================

CREATE OR REPLACE FUNCTION api.generate_shopping_list_v2(
  p_customer_id text,
  p_days_back   integer DEFAULT 180,   -- NOT USED — see note above
  p_row_limit   integer DEFAULT 20
)
RETURNS TABLE(
  sku               text,
  product_name      text,
  order_count       bigint,
  total_qty_ordered numeric,
  total_revenue     numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'api', 'public', 'raw'
AS $function$
  with lines as (
    select
      l.sku::text as sku,
      coalesce(nullif(l.product_name::text, ''), l.sku::text) as product_name,
      coalesce(nullif(l.document_no::text, ''), 'row-' || l.id::text) as order_key,
      coalesce(l.qty, 0)::numeric as qty,
      coalesce(l.amount_excl, coalesce(l.qty,0) * coalesce(l.unit_price_excl,0), 0)::numeric as line_revenue
    from raw.bc_lines_raw l
    where trim(l.company_id::text) = trim(p_customer_id)
      and l.sku is not null
      and trim(l.sku::text) <> ''
  )
  select
    sku,
    max(product_name) as product_name,
    count(distinct order_key) as order_count,
    round(sum(qty), 2) as total_qty_ordered,
    round(sum(line_revenue), 2) as total_revenue
  from lines
  group by sku
  order by order_count desc, total_revenue desc, sku
  limit greatest(coalesce(p_row_limit, 20), 1);
$function$;


-- ── GRANTS — reflects measured state 2026-08-05 (audit Q5) ──────────────────
-- `anon` is required only because the Innkaupalisti currently runs in the
-- browser on /kpi/vidskiptavinur with the publishable key. It returns
-- per-customer BC purchase history, which is HÁTT exposure in
-- SECURITY_REVIEW.md section 4.
--
-- DROP `anon` HERE the moment the Innkaupalisti moves into the admin app —
-- that project calls Supabase server-side with service_role, so the browser
-- never needs this grant. Leaving it behind would defeat the migration.
grant execute on function api.generate_shopping_list_v2(text, integer, integer)
  to anon, authenticated, service_role;
