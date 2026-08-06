-- ============================================================================
-- Close anon EXECUTE on functions that NOTHING calls from a browser.
--
-- Found 2026-08-05 by _audit_anon_exposure.sql Q5. Every function in that
-- result set had anon_execute = true, including a destructive one that is not
-- mentioned in SECURITY_REVIEW.md and was missed by all three previous
-- lockdown files (security_revoke_anon_writes, security_lockdown_v2,
-- security_revoke_anon_bc).
--
-- SAFE: each revoke below was verified against every caller in the repo
-- (Webflow/*.js and core/*.js) before being included. Callers noted per line.
-- GAS reads/writes with service_role, which is unaffected by these revokes.
--
-- ROLLBACK: re-grant with `grant execute on function <sig> to anon;`
-- Idempotent — safe to re-run.
-- ============================================================================


-- ── 0. MOST URGENT — anon holds INSERT/UPDATE/DELETE on 8 views + a table ───
-- Found by Q2. This is almost certainly the residue of a historical
-- `grant all on all tables in schema public to anon` — every one of these nine
-- objects has all four privileges, which no design would ask for.
--
-- CONFIRMED EXPLOITABLE (Q7, 2026-08-05) — one of the nine, not hypothetically:
--
--   public.v_newweb_orders   is_insertable_into = YES   is_updatable = YES
--
-- A single-base-table view in Postgres is auto-updatable, and a view runs with
-- its OWNER's rights unless created with security_invoker=true (off by
-- default). raw.newweb_orders_raw has RLS enabled (Q3) — this view routes
-- straight around it. Combined with the anon INSERT/UPDATE/DELETE grants from
-- Q2, anyone holding the publishable key (which is in a public GitHub repo)
-- can insert fabricated web orders, alter existing revenue figures, or delete
-- rows from the primary source table behind every KPI on every dashboard.
-- No audit trail, no per-user attribution, recoverable only from backups.
-- This is the ingest target of safePoll_v2 — the one pipeline CLAUDE.md marks
-- as non-negotiable.
--
-- The other seven views came back is_insertable_into = NO (aggregates, so not
-- auto-updatable). Their grants were alarming but not exploitable. They are
-- revoked below anyway: the grants have no purpose, and "not auto-updatable"
-- is a property of the current view body, not a guarantee about the next edit.
--
-- mart.v_newweb_orders is ALSO auto-updatable (Q7) but anon holds no write
-- grant on it (Q2). Leave it that way — do not grant anything there.
--
-- GAS ingest is unaffected: safePoll_v2 and the other writers upsert into the
-- base tables with service_role, never through these views.
--
-- SAFE: nothing in the repo writes to any of them. Verified: only
-- v_web_daily_unified is referenced at all, and read-only
-- (dashboard.js:1017 and core/utils.js:3015, both `?select=`).
-- SELECT is deliberately left intact on all nine — read paths are a separate,
-- larger question, and revoking select here would break the dashboard.

revoke insert, update, delete on public.v_bc_monthly          from anon, public;
revoke insert, update, delete on public.v_bc_monthly_web      from anon, public;
revoke insert, update, delete on public.v_monthly_kpi_core    from anon, public;
revoke insert, update, delete on public.v_newweb_daily        from anon, public;
revoke insert, update, delete on public.v_newweb_orders       from anon, public;
revoke insert, update, delete on public.v_web_daily_unified   from anon, public;
revoke insert, update, delete on public.v_web_monthly_unified from anon, public;
revoke insert, update, delete on public.v_web_orders_unified  from anon, public;

-- public.sales_tasks: the TWIN of api.sales_tasks, and Q6 confirms it is a LIVE
-- write hole, not merely a stray grant. security_lockdown_v2.sql hardened
-- api.sales_tasks (one select-only policy) but never touched this table, which
-- carries three permissive policies for {anon, authenticated}:
--   sales_tasks_insert_all   insert   with_check = true
--   sales_tasks_update_all   update   using = true, with_check = true
--   sales_tasks_select_all   select   using = true
-- Grant + permitting policy are both present, so anon INSERT and UPDATE work
-- right now. (DELETE has the grant but no policy, so RLS blocks it.)
--
-- SAFE: api.create_sales_task inserts into api.sales_tasks, not this table
-- (security_lockdown_v2.sql:35), and nothing in Webflow/ references sales_tasks
-- directly any more. This table is orphaned.
-- Both halves are removed — the grant and the policies — so neither alone can
-- resurrect the path.

revoke insert, update, delete on public.sales_tasks from anon, public;

drop policy if exists sales_tasks_insert_all on public.sales_tasks;
drop policy if exists sales_tasks_update_all on public.sales_tasks;
-- select_all is left in place: harmless on an orphaned table, and dropping read
-- access is the separate, larger question we have not settled yet.


-- ── 1. CRITICAL — destructive, zero callers ─────────────────────────────────
-- Takes no arguments and is named "clear ... flags": a table-wide wipe of the
-- Forgangslisti, callable by anyone holding the publishable key (which lives
-- in a public GitHub repo). No caller anywhere in Webflow/ or core/.
-- The three write RPCs in SECURITY_REVIEW.md's CRITICAL list were locked in
-- June; this one was never on the list.

revoke execute on function api.clear_customer_priority_flags() from anon, public;


-- ── 2. HIGH — three dead doors to per-customer BC purchase history ──────────
-- Webflow calls ONLY api.generate_shopping_list_v2 (customer-profiles.js:1211).
-- v1, v3 and the divergent public.v1 copy are unreferenced but anon-open, each
-- returning the same class of data (what a named customer buys, from
-- raw.bc_lines_raw). Four doors, one in use.
-- NOTE: v3 (1488 chars) is the newest and largest — decide whether it is an
-- unwired improvement worth keeping before deleting any of these outright.
-- Revoking anon is reversible; dropping is not. Revoke now, triage later.

revoke execute on function api.generate_shopping_list_v1(text, integer, integer)    from anon, public;
revoke execute on function api.generate_shopping_list_v3(text, integer, integer)    from anon, public;
revoke execute on function public.generate_shopping_list_v1(text, integer, integer) from anon, public;


-- ── 3. MEDIUM — matview refresh triggers, callable by anyone ────────────────
-- These are maintenance operations: they take exclusive-ish locks and burn CPU
-- on large marts. All six are called ONLY from GAS with service_role:
--   refresh_mv_top_products_30d/_all/_master  → core/utils.js:3279, 3294, 3304
--   refresh_mv_customer_profiles_labeled_trends → core/utils.js:3747
--   refresh_mv_klaviyo_attribution_daily        → core/utils.js:3320
--   refresh_solution_page_marts                 → core/solution_pages.js:119
-- No browser needs them. Anon-executable refresh is a free resource-exhaustion
-- lever over the REST API — no data leaves, but the database can be pinned.

revoke execute on function public.refresh_mv_top_products_30d()                 from anon, public;
revoke execute on function public.refresh_mv_top_products_all()                 from anon, public;
revoke execute on function public.refresh_mv_top_products_master()              from anon, public;
revoke execute on function public.refresh_mv_customer_profiles_labeled_trends() from anon, public;
revoke execute on function public.refresh_mv_klaviyo_attribution_daily()        from anon, public;
revoke execute on function public.refresh_solution_page_marts()                 from anon, public;


-- ── SCOPE ──────────────────────────────────────────────────────────────────
-- This file revokes only what nothing calls. A number of grants are left in
-- place because a live KPI page depends on them, and a few open questions
-- remain about which of two same-named objects is actually in use.
--
-- That inventory is NOT recorded here on purpose: this repository is public
-- (jsDelivr serves Webflow/*.js from it), and a list of what is still reachable
-- without authentication is a roadmap. It lives in SECURITY_REVIEW.md §4, which
-- is gitignored. Read it there before touching any grant not covered above.


-- ── VERIFY ─────────────────────────────────────────────────────────────────
-- Re-run Q5 in _audit_anon_exposure.sql. Everything in section 1-3 above must
-- come back anon_execute = false. Save the output as the dated evidence file.
