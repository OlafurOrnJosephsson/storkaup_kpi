-- ============================================================================
-- ANON EXPOSURE AUDIT — read-only. Changes nothing. Safe to run any time.
--
-- WHY: the repo records the grants we remembered to write down. This asks the
-- database what `anon` can ACTUALLY reach right now. Run it before and after
-- every security change — the "after" output is the evidence artifact.
--
-- HOW: Supabase → SQL Editor. Run each query separately (they return separate
-- result sets). Use "Download CSV" on Q1 + Q2 to keep a dated snapshot.
-- ============================================================================


-- ── Q0. Schema reachability ─────────────────────────────────────────────────
-- The master gate. Without USAGE on a schema, grants inside it are unreachable
-- (security_lockdown_v2.sql assumed this was true for `raw` — verify it).
-- Note: PostgREST also needs the schema in Settings → API → Exposed schemas;
-- that is a project setting, NOT visible here. Check it in the dashboard too.

select
  n.nspname                                        as schema,
  has_schema_privilege('anon', n.nspname, 'usage') as anon_usage,
  has_schema_privilege('authenticated', n.nspname, 'usage') as authed_usage
from pg_namespace n
where n.nspname in ('api', 'public', 'mart', 'raw', 'extensions', 'storage')
order by 1;


-- ── Q1. Every function anon can EXECUTE ─────────────────────────────────────
-- security_definer = true means the function bypasses RLS and runs as owner.
-- definer + anon-executable = the data is served to anyone holding the
-- publishable key, regardless of RLS. This is the core of the finding.

select
  n.nspname                                    as schema,
  p.proname                                    as function,
  pg_get_function_identity_arguments(p.oid)    as args,
  p.prosecdef                                  as security_definer,
  pg_get_userbyid(p.proowner)                  as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('api', 'public', 'mart', 'raw')
  and p.prokind = 'f'
  and has_function_privilege('anon', p.oid, 'execute')
order by p.prosecdef desc, n.nspname, p.proname;


-- ── Q2. Every table / view / matview anon can touch ─────────────────────────
-- rls_enabled = false on a table anon can SELECT means unrestricted read.
-- Any true in insert/update/delete is a write path — treat as critical.

select
  n.nspname     as schema,
  c.relname     as object,
  case c.relkind
    when 'r' then 'table'  when 'p' then 'table (partitioned)'
    when 'v' then 'view'   when 'm' then 'matview'
  end           as kind,
  c.relrowsecurity                                as rls_enabled,
  has_table_privilege('anon', c.oid, 'select')    as anon_select,
  has_table_privilege('anon', c.oid, 'insert')    as anon_insert,
  has_table_privilege('anon', c.oid, 'update')    as anon_update,
  has_table_privilege('anon', c.oid, 'delete')    as anon_delete
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm')
  and n.nspname in ('api', 'public', 'mart', 'raw')
  and (   has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('anon', c.oid, 'insert')
       or has_table_privilege('anon', c.oid, 'update')
       or has_table_privilege('anon', c.oid, 'delete'))
order by
  (has_table_privilege('anon', c.oid, 'insert')
   or has_table_privilege('anon', c.oid, 'update')
   or has_table_privilege('anon', c.oid, 'delete')) desc,
  n.nspname, c.relname;


-- ── Q3. RLS status of every raw.* table ─────────────────────────────────────
-- Q2 only lists what anon can reach. This lists ALL raw tables so we can see
-- which ones were never covered — bc_lines_raw / bc_customers_raw have no RLS
-- statement anywhere in the repo.

select
  c.relname                     as table_name,
  c.relrowsecurity              as rls_enabled,
  (select count(*) from pg_policy pol where pol.polrelid = c.oid) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'raw'
  and c.relkind in ('r', 'p')
order by c.relrowsecurity, c.relname;

-- ── Q4. Function inventory (for repo-drift diff) ────────────────────────────
-- Full list of api/public/mart functions. Download as CSV and hand it over —
-- anything here that has no matching file in core/sql/ exists ONLY in the
-- database (generate_shopping_list_v2 is one; there are probably more).

select
  n.nspname || '.' || p.proname                 as qualified_name,
  pg_get_function_identity_arguments(p.oid)     as args,
  p.prosecdef                                   as security_definer,
  length(pg_get_functiondef(p.oid))             as def_chars
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('api', 'public', 'mart')
  and p.prokind = 'f'
order by 1;


-- ── Q5. TARGETED: the objects the Q4 inventory flagged as unknown ───────────
-- Added after the first Q4 run. Two problems surfaced:
--   (a) five functions exist in BOTH `api` and `public` with different body
--       sizes -- i.e. independently drifted copies, not wrappers. Locking down
--       api.X achieves nothing if public.X is also granted to anon.
--   (b) ten functions exist only in the database, with no file in core/sql/.
--       One of them (clear_customer_priority_flags) is an undocumented WRITE.
-- This answers "who can call these" without re-running the whole audit.

select
  n.nspname || '.' || p.proname               as qualified_name,
  pg_get_function_identity_arguments(p.oid)   as args,
  length(pg_get_functiondef(p.oid))           as def_chars,
  p.prosecdef                                 as security_definer,
  has_function_privilege('anon', p.oid, 'execute')          as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authed_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('api', 'public', 'mart')
  and p.prokind = 'f'
  and p.proname in (
        -- (a) duplicated across api + public
        'dashboard_compat', 'bc_sync_status', 'website_kpi_pack',
        'web_booking_reconciliation_30d', 'generate_shopping_list_v1',
        -- (b) database-only, no file in core/sql/
        'clear_customer_priority_flags', 'generate_shopping_list_v2',
        'generate_shopping_list_v3', 'get_open_tasks', 'top_products_dynamic',
        'refresh_mv_top_products_30d', 'refresh_mv_top_products_all',
        'top_categories_by_days', 'top_products_by_days'
      )
order by p.proname, n.nspname;


-- ── Q6. What do the RLS policies actually ALLOW? ────────────────────────────
-- Q3 showed RLS is ON for bc_invoices_raw / bc_lines_raw / bc_customers_raw --
-- but each has 1 policy, and a permissive policy re-opens what RLS closed.
-- bc_credit_invoices_raw has 0 policies (genuinely closed), so the asymmetry
-- needs explaining. Same question for public.sales_tasks.
-- `roles` = who it applies to; `qual` = the USING clause. A policy for {anon}
-- (or {public}) with qual `true` means RLS is decorative.

select
  n.nspname          as schema,
  c.relname          as object,
  pol.polname        as policy,
  case pol.polcmd when 'r' then 'select' when 'a' then 'insert'
                  when 'w' then 'update' when 'd' then 'delete'
                  when '*' then 'all' end                as command,
  pol.polpermissive                                      as permissive,
  (select array_agg(r.rolname) from pg_roles r
     where r.oid = any(pol.polroles))                    as roles,
  pg_get_expr(pol.polqual, pol.polrelid)                 as using_clause,
  pg_get_expr(pol.polwithcheck, pol.polrelid)            as with_check
from pg_policy pol
join pg_class c     on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('raw', 'api', 'public', 'mart')
order by n.nspname, c.relname, pol.polname;


-- ── Q7. Are the 8 public views auto-updatable? ──────────────────────────────
-- Decides whether the anon INSERT/UPDATE/DELETE grants in Q2 were actually
-- exploitable or merely alarming. is_insertable_into = YES means a write
-- through the view reaches the base table.
-- Run this BEFORE security_revoke_anon_orphans.sql if you want the evidence
-- captured; the revoke does not change these columns, only the grants.

select
  table_schema, table_name,
  is_insertable_into, is_updatable, is_trigger_insertable_into
from information_schema.views
where table_schema in ('public', 'api', 'mart')
  and table_name in (
    'v_bc_monthly', 'v_bc_monthly_web', 'v_monthly_kpi_core', 'v_newweb_daily',
    'v_newweb_orders', 'v_web_daily_unified', 'v_web_monthly_unified',
    'v_web_orders_unified'
  )
order by is_insertable_into desc, table_name;


-- ── Q8. Does public.v_newweb_orders expose kennitölur over anon SELECT? ─────
-- raw.newweb_orders_raw carries `national_id` and `real_email`
-- (core/newsales_v2.js:125-151). Q2 shows anon holds SELECT on the passthrough
-- view public.v_newweb_orders. If either column appears below, kennitölur and
-- customer emails are directly readable at /rest/v1/v_newweb_orders with the
-- publishable key -- no RPC, no page, just the key. That is a larger read
-- exposure than anything listed in SECURITY_REVIEW.md section 4.

select
  table_schema, table_name, ordinal_position, column_name, data_type
from information_schema.columns
where table_schema in ('public', 'mart')
  and table_name in ('v_newweb_orders', 'v_web_orders_unified')
  and (table_schema, table_name, column_name) is not null
order by table_schema, table_name, ordinal_position;


-- ── Q9. Integrity check — was the writable view ever actually used? ─────────
-- Every legitimate writer stamps a provenance value in `source`:
--   'newsales_v2'  core/newsales_v2.js:151  (safePoll_v2 / Magento ingest)
--   'NEWWEB'       core/salessummaries.js:338, 366
-- A row inserted through public.v_newweb_orders by an outside caller would
-- almost certainly leave `source` null or carry an unexpected value -- an
-- attacker would have to know the column exists and guess a valid marker.
-- This does NOT prove absence of tampering (UPDATE of an existing row leaves
-- source intact), but a null/unknown bucket is the cheapest possible tell.

select
  coalesce(source, '‹null›')      as source,
  count(*)                        as rows,
  min(purchase_date)::date        as first_order,
  max(purchase_date)::date        as last_order,
  round(sum(grand_total))         as total_grand
from raw.newweb_orders_raw
group by 1
order by 2 desc;

-- Second angle: rows whose insert looks structurally unlike GAS output.
-- GAS always sets order_id, purchase_date and status together.
select count(*) as suspect_rows
from raw.newweb_orders_raw
where source is null
   or purchase_date is null
   or status is null;



