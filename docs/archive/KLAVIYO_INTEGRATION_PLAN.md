# Klaviyo KPI Integration Plan (v1)

## Goal

Measure whether Klaviyo campaigns/flows drive web conversions in Storkaup KPI.

v1 scope:
- Campaign/flow attribution for web orders only
- Attribution model: `last_click`
- Attribution window: 7 days from click to order

## Data Model (Supabase)

### 1) Raw events

Table: `raw_klaviyo_events`

Columns (minimum):
- `event_id text primary key`
- `event_type text not null` (`sent`, `opened`, `clicked`, `placed_order`, etc.)
- `event_ts timestamptz not null`
- `profile_id text null`
- `email text null`
- `message_id text null`
- `campaign_id text null`
- `flow_id text null`
- `metric_id text null`
- `source text not null default 'klaviyo'`
- `payload jsonb not null`
- `ingested_at timestamptz not null default now()`

Indexes:
- `idx_klaviyo_events_ts` on (`event_ts desc`)
- `idx_klaviyo_events_email` on (`lower(email)`)
- `idx_klaviyo_events_campaign_ts` on (`campaign_id`, `event_ts desc`)
- `idx_klaviyo_events_type_ts` on (`event_type`, `event_ts desc`)

### 2) Campaign/flow dimension

Table: `dim_klaviyo_campaigns`

Columns:
- `campaign_id text primary key`
- `campaign_name text`
- `channel text` (email/sms/push)
- `campaign_type text` (campaign/flow)
- `status text`
- `updated_at timestamptz not null default now()`
- `payload jsonb not null`

## Join Keys to Orders

Primary key for matching events -> order:
- `lower(email)` from Klaviyo event
- to `lower(real_email)` in `raw.newweb_orders_raw`

Fallback (optional later):
- profile-level identity table if multiple emails per account.

## Attribution Logic (v1)

Model:
- Last click wins
- Click must happen in `[order_time - 7 days, order_time]`
- Ignore clicks after order time

SQL outline:
1. Build `eligible_clicks`:
   - all `raw_klaviyo_events` where `event_type = 'clicked'`
2. Join each web order to matching clicks by email/time window
3. Rank clicks per order by `event_ts desc`
4. Keep `rn = 1` as attributed click
5. Aggregate by day/campaign

Output mart (recommended):
- `mv_klaviyo_attribution_daily`
- keys: `order_date`, `campaign_id`
- metrics: `attributed_orders`, `attributed_revenue_excl`, `attributed_revenue_incl`, `unique_buyers`

## GAS Ingestion (planned)

Function:
- `scheduledKlaviyoSync_v1()`

Behavior:
- Read checkpoint from Script Properties (e.g. `KLAVIYO_LAST_EVENT_TS`)
- Pull events incrementally from Klaviyo API
- Upsert into `raw_klaviyo_events` (idempotent on `event_id`)
- Update checkpoint only after successful batch
- Log summary (`fetched`, `upserted`, `checkpoint`)

Trigger recommendation:
- Every 15 minutes

## Dashboard KPIs (Webflow v1)

Cards:
- Campaign attributed revenue (today / 30d)
- Campaign attributed orders (today / 30d)
- Campaign conversion rate (attributed orders / delivered)
- Top campaigns by attributed revenue

Table:
- Campaign name
- Delivered / Clicked
- Attributed orders
- Attributed revenue
- CVR

## Sanity/Quality Checks

Daily checks:
1. `attributed_orders <= total_web_orders` per day
2. No duplicate `event_id` in raw table
3. Checkpoint advances at least once daily
4. Sync failure alerts go to `ALERT_EMAILS`

## What You Need To Provide

1. Klaviyo private API key with read access to:
- events
- campaigns/flows
- profiles (if needed for identity enrichment)
2. Rate-limit expectations from your Klaviyo plan
3. Final KPI definitions for finance alignment:
- Excl tax vs incl tax revenue reporting
- Exact denominator for conversion %
