-- api.klaviyo_sync_status_v1 — staðan á bak við merkið efst á /kpi/klaviyo
--
-- Merkið mældi aldur SÍÐUSTU EIGNUÐU PÖNTUNAR og kallaði hann „Gögn ekki
-- fersk“. 2026-10-16 sagði það „74 dagar síðan“ á meðan samstillingin
-- keyrði á 15 mín fresti án villu — engin herferð hafði farið út síðan í
-- júlí (síðasta „received email“), svo ekkert var til að eigna. Merkið las
-- eins og bilun og sendi fólk að leita að keyrslu sem vantaði.
--
-- Þrjár ólíkar spurningar, þrír reitir:
--   last_sync_ok_at   tókst samstillingin? (raw.ingestion_runs)
--   last_send_at      hvenær fór póstur síðast út? (received email)
--   last_click_at     hvenær smellti einhver síðast? (clicked email)
-- Webflow/dashboard.js (klRenderInsights) les þetta. Falli kallið heldur
-- merkið gömlu hegðuninni — aukakall má aldrei fella síðuna.
--
-- raw.raw_klaviyo_events er nokkur þúsund raðir; max() með síu er ódýrt.

create or replace function api.klaviyo_sync_status_v1()
returns table (
  last_sync_ok_at   timestamptz,
  last_sync_status  text,
  last_sync_at      timestamptz,
  last_event_at     timestamptz,
  last_send_at      timestamptz,
  last_click_at     timestamptz
)
language sql stable security definer
set search_path = raw, public
as $$
  select
    (select max(r.started_at) from raw.ingestion_runs r
      where r.job_name = 'scheduledKlaviyoSync_v1' and r.status = 'success'),
    (select r.status from raw.ingestion_runs r
      where r.job_name = 'scheduledKlaviyoSync_v1'
      order by r.started_at desc limit 1)::text,
    (select max(r.started_at) from raw.ingestion_runs r
      where r.job_name = 'scheduledKlaviyoSync_v1'),
    (select max(e.event_ts) from raw.raw_klaviyo_events e),
    (select max(e.event_ts) from raw.raw_klaviyo_events e
      where lower(e.event_type) = 'received email'),
    (select max(e.event_ts) from raw.raw_klaviyo_events e
      where lower(e.event_type) = 'clicked email');
$$;

revoke all on function api.klaviyo_sync_status_v1() from public, anon;
grant execute on function api.klaviyo_sync_status_v1() to authenticated, service_role;

notify pgrst, 'reload schema';
