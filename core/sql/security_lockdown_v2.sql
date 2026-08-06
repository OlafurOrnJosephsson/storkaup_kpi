-- ============================================================================
-- Security lockdown v2 — close anon write/delete holes flagged by the Supabase
-- linter (rls_disabled_in_public), while keeping the dashboards running.
--
-- WHY THIS IS SAFE: every dashboard READ goes through SECURITY DEFINER functions
-- (api.get_open_tasks, api.get_customer_priority_flags, api.get_active_sales_reps,
-- bc_* …). Those run as the table owner and bypass RLS, so enabling RLS blocks
-- only DIRECT anon access — not the dashboards. GAS ingest uses the service_role
-- key, which also bypasses RLS.
--
-- RUN ORDER (zero downtime):
--   1. Run PART A + PART C now            (additive RPCs + RLS on tables the
--                                          dashboard never writes directly).
--   2. Deploy the updated customer-profiles.js (sales_tasks writes → RPCs).
--   3. Run PART B                         (enable RLS on api.sales_tasks).
--
-- Running PART B before step 2 only makes the "create task" / "mark done"
-- buttons error until the frontend is live — no data risk, fully reversible.
-- ============================================================================


-- ── PART A — move api.sales_tasks writes behind SECURITY DEFINER RPCs ────────
-- Additive: safe to run anytime. The old direct writes keep working until PART B.

create or replace function api.create_sales_task(
  p_customer_id   text,
  p_customer_name text default '',
  p_priority      text default 'medium',
  p_reason        text default 'Eftirfylgni'
) returns api.sales_tasks
language sql
security definer
set search_path = api, public
as $$
  insert into api.sales_tasks (customer_id, customer_name, priority, reason, status)
  values (trim(p_customer_id), coalesce(p_customer_name, ''),
          coalesce(nullif(p_priority, ''), 'medium'),
          coalesce(nullif(p_reason, ''), 'Eftirfylgni'), 'open')
  returning *;
$$;

create or replace function api.complete_sales_task(p_id text)
returns api.sales_tasks
language sql
security definer
set search_path = api, public
as $$
  update api.sales_tasks set status = 'done'
  where id::text = trim(p_id)
  returning *;
$$;

grant execute on function api.create_sales_task(text, text, text, text) to anon, authenticated;
grant execute on function api.complete_sales_task(text)                 to anon, authenticated;


-- ── PART C — lock tables the dashboard never writes directly (safe now) ──────
-- All reads of these go through SECURITY DEFINER fns; GAS writes via service_role.
-- RLS with no policy => only owner / service_role can touch them.

-- Stray grant: anon was given read on this raw table (no schema-usage, so it was
-- already unreachable — remove it anyway for hygiene).
revoke select on table raw.customer_priority_flags_raw from anon;

alter table raw.customer_priority_flags_raw enable row level security;
alter table raw.sales_reps_ref              enable row level security;
alter table raw.bc_credit_invoices_raw      enable row level security;
alter table api.marketing_page_workflow     enable row level security;


-- ── PART B — enable RLS on api.sales_tasks (run AFTER the frontend is live) ───
-- Reads still work via api.get_open_tasks (security definer). The anon SELECT
-- policy is belt-and-suspenders so the task list works regardless of how
-- get_open_tasks is defined. Writes now go only through the RPCs in PART A.

alter table api.sales_tasks enable row level security;

drop policy if exists sales_tasks_anon_select on api.sales_tasks;
create policy sales_tasks_anon_select on api.sales_tasks
  for select to anon, authenticated using (true);

revoke insert, update, delete on api.sales_tasks from anon;


-- ── NOT SQL — also do this in the Supabase dashboard ─────────────────────────
-- ❌ WRONG — DO NOT FOLLOW. Corrected 2026-08-05.
--
-- The original text here read: "Settings → API → Exposed schemas: remove `raw`
-- ... this does not break anything." That is false and following it would have
-- taken down every ingest path in the project.
--
-- GAS does not talk to the tables directly — it writes through PostgREST with
-- `Content-Profile: raw` / `Accept-Profile: raw` and the service_role key. There
-- are 35 such call sites (core/utils.js ×29, core/ga4.js ×4,
-- core/newsales_v2.js ×2), including the Magento order upsert behind
-- safePoll_v2 — the one pipeline CLAUDE.md marks as non-negotiable. Un-exposing
-- `raw` returns 404 for all of them.
--
-- `raw` must stay exposed. What actually keeps it safe (verified 2026-08-05):
--   1. `anon` has NO USAGE on schema raw (audit Q0) — so anon cannot reach it
--      over /rest/v1 even though the schema is exposed.
--   2. RLS + a service_role-only policy on each table (audit Q6).
--
-- Note that (1) is now the single load-bearing control, so never grant
-- `usage on schema raw to anon`. And `authenticated` DOES hold that usage, which
-- is why the RLS gap on the remaining five raw tables must be closed before any
-- login is introduced — see security_enable_rls_raw_remaining.sql.
--
-- Also in that settings page: "Automatically expose new tables" grants Data API
-- roles privileges on every new table by default. Turn it OFF — that default is
-- the most plausible origin of the stray anon grants this project keeps finding.
