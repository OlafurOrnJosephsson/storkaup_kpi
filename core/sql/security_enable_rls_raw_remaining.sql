-- ============================================================================
-- Enable RLS on the five raw tables that still lack it.
--
-- WHY NOW: this is the auth-migration landmine. Audit Q0 shows `anon` has no
-- USAGE on schema raw, so these tables are unreachable with the publishable key
-- today. But `authenticated` DOES hold that usage, and the Data API exposes the
-- raw schema (confirmed in the dashboard 2026-08-05: api, graphql_public, mart,
-- public, raw). The moment Supabase Auth is introduced, every logged-in user can
-- read these five tables directly over /rest/v1 with `Accept-Profile: raw` --
-- including raw.customer_analysis_raw, which carries primary_email and phone.
--
-- Fix it BEFORE auth ships, not after. After auth, this stops being hardening
-- and becomes an incident.
--
-- SAFE: identical to what security_lockdown_v2.sql already did for
-- customer_priority_flags_raw / sales_reps_ref / bc_credit_invoices_raw.
--   - GAS ingest uses service_role, which bypasses RLS entirely.
--   - Every read path is a view or a SECURITY DEFINER function, both of which
--     run as the owner and are exempt from RLS:
--       customer_analysis_raw  → api.v_customer_opportunities,
--                                api.v_customer_profiles (+ labeled/trends)
--       ga4_daily_metrics_raw  → public./api.website_kpi_pack (definer)
--       ga4_channel_daily_raw  → public./api.website_kpi_pack (definer)
--       raw_klaviyo_events     → mart.mv_klaviyo_attribution_daily, refreshed by
--                                public.refresh_mv_klaviyo_attribution_daily
--                                (definer)
--       dim_klaviyo_campaigns  → mart.v_klaviyo_campaign_cards_30d
--
-- No policy is created: RLS with zero policies means only the owner and
-- service_role get through, which is exactly the intent. Matches the
-- p_service_role_all pattern already on the other nine raw tables.
--
-- ROLLBACK: alter table raw.<name> disable row level security;
-- Idempotent — safe to re-run.
-- ============================================================================

alter table raw.customer_analysis_raw enable row level security;
alter table raw.ga4_channel_daily_raw enable row level security;
alter table raw.ga4_daily_metrics_raw enable row level security;
alter table raw.raw_klaviyo_events    enable row level security;
alter table raw.dim_klaviyo_campaigns enable row level security;


-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expect rls_enabled = true for all five. Re-run audit Q3 for the full picture:
-- every raw table should come back true.

select c.relname as table_name, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'raw'
  and c.relname in ('customer_analysis_raw', 'ga4_channel_daily_raw',
                    'ga4_daily_metrics_raw', 'raw_klaviyo_events',
                    'dim_klaviyo_campaigns')
order by c.relname;


-- ── AFTER RUNNING THIS: smoke-test the affected surfaces ────────────────────
-- RLS mistakes surface as silently-empty results, not errors. Check that these
-- still return data before considering it done:
--   /kpi/dashboard        website KPI cards  (ga4_* via website_kpi_pack)
--   /kpi/vidskiptavinur   customer profiles  (customer_analysis_raw via views)
--   Klaviyo attribution cards on the website dashboard
-- And in GAS: run scheduledGa4Sync_v1 and scheduledKlaviyoSync_v1 once manually.


-- ── NOT FIXED HERE — the other half of the same landmine ────────────────────
-- Enabling RLS closes DIRECT table reads. It does NOT close the views, which
-- run as owner and bypass RLS by design. api.v_customer_opportunities still
-- exposes primary_email from customer_analysis_raw to anon (audit Q2).
-- That is the read-surface migration (SECURITY_REVIEW.md section 5B — move
-- /kpi/vidskiptavinur behind login), not a grant fix.
