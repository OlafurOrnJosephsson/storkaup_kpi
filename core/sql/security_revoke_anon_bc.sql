-- ============================================================================
-- Close anon read access to the frozen Business Central raw tables.
--
-- WHY: Syndis flagged that BC financial data was readable over the anon key.
-- BC ingest is frozen and the dashboard no longer needs these tables — the
-- BC-derived ratios are now entered manually in the password-protected Webflow
-- page (window.STORKAUP_BC_MANUAL) and dashboard_compat.sql returns null for them.
--
-- security_lockdown_v2.sql already enabled RLS on raw.bc_credit_invoices_raw;
-- raw.bc_invoices_raw was the remaining open table. This file is idempotent and
-- covers both.
--
-- SAFE: any SECURITY DEFINER function still reads these (it runs as the owner and
-- bypasses RLS); GAS ingest uses service_role (also bypasses RLS). Only DIRECT
-- anon /rest access is blocked.
--
-- RUN ORDER: deploy the updated dashboard_compat.sql + dashboard.js first, then
-- run this. (Reversed order only makes the BC cards blank until the deploy lands.)
-- ============================================================================

-- Remove any explicit anon grants (hygiene — RLS already gates these once enabled).
revoke select on table raw.bc_invoices_raw        from anon;
revoke select on table raw.bc_credit_invoices_raw from anon;

-- RLS with no anon policy => anon cannot read directly. service_role / owner bypass.
alter table raw.bc_invoices_raw        enable row level security;
alter table raw.bc_credit_invoices_raw enable row level security;

-- ── NOT SQL — also verify in the Supabase dashboard ──────────────────────────
-- Settings → API → Exposed schemas: confirm `raw` is NOT exposed (per the note in
-- security_lockdown_v2.sql). With `raw` removed from the API, these tables are
-- unreachable over /rest regardless of grants — this file is then defence in depth.
