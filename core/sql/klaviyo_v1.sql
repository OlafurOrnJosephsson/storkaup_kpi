-- Klaviyo v1 raw schema + last-click attribution mart
-- Attribution rule: last click, 30-day window, email match

create schema if not exists raw;
create schema if not exists mart;

create table if not exists raw.raw_klaviyo_events (
  event_id text primary key,
  event_type text,
  event_ts timestamptz not null,
  profile_id text,
  email text,
  message_id text,
  campaign_id text,
  flow_id text,
  metric_id text,
  source text not null default 'klaviyo',
  payload jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now()
);

create index if not exists idx_raw_klaviyo_events_ts
  on raw.raw_klaviyo_events (event_ts desc);

create index if not exists idx_raw_klaviyo_events_email
  on raw.raw_klaviyo_events ((lower(email)));

create index if not exists idx_raw_klaviyo_events_campaign_ts
  on raw.raw_klaviyo_events (campaign_id, event_ts desc);

create index if not exists idx_raw_klaviyo_events_type_ts
  on raw.raw_klaviyo_events (event_type, event_ts desc);

create table if not exists raw.dim_klaviyo_campaigns (
  campaign_id text primary key,
  campaign_name text,
  channel text,
  campaign_type text,
  status text,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create materialized view if not exists mart.mv_klaviyo_attribution_daily as
with web_orders as (
  select
    o.order_id,
    o.purchase_date,
    lower(o.real_email) as email,
    coalesce(o.subtotal_excl, 0) as revenue_excl,
    coalesce(o.subtotal_incl, 0) as revenue_incl
  from raw.newweb_orders_raw o
  where o.order_id is not null
    and o.purchase_date is not null
    and o.real_email is not null
),
clicks as (
  select
    e.event_id,
    e.event_ts,
    lower(
      coalesce(
        nullif(e.email, ''),
        nullif(e.payload->'attributes'->>'email', ''),
        nullif(e.payload->'attributes'->'properties'->>'$email', ''),
        nullif(e.payload->'attributes'->'properties'->>'email', '')
      )
    ) as email,
    coalesce(
      nullif(e.campaign_id, ''),
      nullif(e.payload #>> '{relationships,campaign,data,id}', ''),
      nullif(e.payload #>> '{relationships,campaign,data,0,id}', ''),
      nullif(e.payload #>> '{attributes,campaign_id}', ''),
      nullif(e.payload #>> '{attributes,campaign,id}', ''),
      nullif(e.payload #>> '{attributes,attribution,campaign_id}', ''),
      nullif(e.payload #>> '{attributes,properties,campaign_id}', ''),
      nullif(e.payload #>> '{attributes,event_properties,$campaign}', ''),
      nullif(e.payload #>> '{attributes,event_properties,campaign_id}', '')
    ) as campaign_id,
    coalesce(
      nullif(e.flow_id, ''),
      nullif(e.payload #>> '{relationships,flow,data,id}', ''),
      nullif(e.payload #>> '{relationships,flow,data,0,id}', ''),
      nullif(e.payload #>> '{attributes,flow_id}', ''),
      nullif(e.payload #>> '{attributes,flow,id}', ''),
      nullif(e.payload #>> '{attributes,attribution,flow_id}', ''),
      nullif(e.payload #>> '{attributes,properties,flow_id}', ''),
      nullif(e.payload #>> '{attributes,event_properties,$flow}', ''),
      nullif(e.payload #>> '{attributes,event_properties,flow_id}', '')
    ) as flow_id
  from raw.raw_klaviyo_events e
  where e.event_ts is not null
    and lower(e.payload::text) like '%click%'
),
ranked as (
  select
    o.order_id,
    o.purchase_date,
    o.email,
    o.revenue_excl,
    o.revenue_incl,
    c.campaign_id,
    c.flow_id,
    c.event_id,
    c.event_ts,
    row_number() over (
      partition by o.order_id
      order by c.event_ts desc
    ) as rn
  from web_orders o
  join clicks c
    on c.email = o.email
   and c.event_ts <= o.purchase_date
   and c.event_ts >= (o.purchase_date - interval '30 days')
)
select
  date_trunc('day', purchase_date)::date as order_date,
  campaign_id,
  flow_id,
  count(*) as attributed_orders,
  sum(revenue_excl) as attributed_revenue_excl,
  sum(revenue_incl) as attributed_revenue_incl
from ranked
where rn = 1
group by 1, 2, 3;

create index if not exists idx_mv_klaviyo_attribution_daily_order_date
  on mart.mv_klaviyo_attribution_daily (order_date desc);

create or replace function public.refresh_mv_klaviyo_attribution_daily()
returns void
language plpgsql
security definer
as $$
begin
  if to_regclass('mart.mv_klaviyo_attribution_daily') is not null then
    refresh materialized view mart.mv_klaviyo_attribution_daily;
  end if;
  if to_regclass('mart.mv_klaviyo_attribution_daily_nobot') is not null then
    refresh materialized view mart.mv_klaviyo_attribution_daily_nobot;
  end if;
end;
$$;

create materialized view if not exists mart.mv_klaviyo_attribution_daily_nobot as
with web_orders as (
  select
    o.order_id,
    o.purchase_date,
    lower(o.real_email) as email,
    coalesce(o.subtotal_excl, 0) as revenue_excl,
    coalesce(o.subtotal_incl, 0) as revenue_incl
  from raw.newweb_orders_raw o
  where o.order_id is not null
    and o.purchase_date is not null
    and o.real_email is not null
),
clicks as (
  select
    e.event_id,
    e.event_ts,
    lower(
      coalesce(
        nullif(e.email, ''),
        nullif(e.payload->'attributes'->>'email', ''),
        nullif(e.payload->'attributes'->'properties'->>'$email', ''),
        nullif(e.payload->'attributes'->'properties'->>'email', '')
      )
    ) as email,
    coalesce(
      nullif(e.campaign_id, ''),
      nullif(e.payload #>> '{relationships,campaign,data,id}', ''),
      nullif(e.payload #>> '{relationships,campaign,data,0,id}', ''),
      nullif(e.payload #>> '{attributes,campaign_id}', ''),
      nullif(e.payload #>> '{attributes,campaign,id}', ''),
      nullif(e.payload #>> '{attributes,attribution,campaign_id}', ''),
      nullif(e.payload #>> '{attributes,properties,campaign_id}', ''),
      nullif(e.payload #>> '{attributes,event_properties,$campaign}', ''),
      nullif(e.payload #>> '{attributes,event_properties,campaign_id}', '')
    ) as campaign_id,
    coalesce(
      nullif(e.flow_id, ''),
      nullif(e.payload #>> '{relationships,flow,data,id}', ''),
      nullif(e.payload #>> '{relationships,flow,data,0,id}', ''),
      nullif(e.payload #>> '{attributes,flow_id}', ''),
      nullif(e.payload #>> '{attributes,flow,id}', ''),
      nullif(e.payload #>> '{attributes,attribution,flow_id}', ''),
      nullif(e.payload #>> '{attributes,properties,flow_id}', ''),
      nullif(e.payload #>> '{attributes,event_properties,$flow}', ''),
      nullif(e.payload #>> '{attributes,event_properties,flow_id}', '')
    ) as flow_id
  from raw.raw_klaviyo_events e
  where e.event_ts is not null
    and lower(e.payload::text) like '%click%'
    and coalesce((nullif(e.payload #>> '{attributes,event_properties,Bot Click}', ''))::boolean, false) = false
),
ranked as (
  select
    o.order_id,
    o.purchase_date,
    o.email,
    o.revenue_excl,
    o.revenue_incl,
    c.campaign_id,
    c.flow_id,
    c.event_id,
    c.event_ts,
    row_number() over (
      partition by o.order_id
      order by c.event_ts desc
    ) as rn
  from web_orders o
  join clicks c
    on c.email = o.email
   and c.event_ts <= o.purchase_date
   and c.event_ts >= (o.purchase_date - interval '30 days')
)
select
  date_trunc('day', purchase_date)::date as order_date,
  campaign_id,
  flow_id,
  count(*) as attributed_orders,
  sum(revenue_excl) as attributed_revenue_excl,
  sum(revenue_incl) as attributed_revenue_incl
from ranked
where rn = 1
group by 1, 2, 3;

create index if not exists idx_mv_klaviyo_attribution_daily_nobot_order_date
  on mart.mv_klaviyo_attribution_daily_nobot (order_date desc);

create or replace view mart.v_klaviyo_campaign_cards_30d as
with recent as (
  select
    campaign_id,
    sum(attributed_orders) as attributed_orders_30d,
    sum(attributed_revenue_excl) as attributed_revenue_excl_30d,
    sum(attributed_revenue_incl) as attributed_revenue_incl_30d
  from mart.mv_klaviyo_attribution_daily
  where order_date >= (current_date - interval '30 days')
    and campaign_id is not null
    and campaign_id <> ''
  group by campaign_id
),
events_norm as (
  select
    coalesce(
      nullif(e.campaign_id, ''),
      nullif(e.payload #>> '{attributes,event_properties,$campaign}', ''),
      nullif(e.payload #>> '{attributes,event_properties,campaign_id}', '')
    ) as campaign_id,
    coalesce(
      nullif(e.payload #>> '{attributes,event_properties,Campaign Name}', ''),
      nullif(e.payload #>> '{attributes,event_properties,campaign_name}', ''),
      nullif(e.payload #>> '{attributes,event_properties,Message Name}', ''),
      nullif(e.payload #>> '{attributes,event_properties,message_name}', '')
    ) as campaign_name,
    e.event_ts
  from raw.raw_klaviyo_events e
  where e.event_ts is not null
),
campaign_names as (
  select distinct on (campaign_id)
    campaign_id,
    campaign_name
  from events_norm
  where campaign_id is not null
    and campaign_id <> ''
  order by campaign_id, event_ts desc
)
select
  r.campaign_id,
  coalesce(nullif(cn.campaign_name, ''), r.campaign_id) as campaign_name,
  r.attributed_orders_30d,
  r.attributed_revenue_excl_30d,
  r.attributed_revenue_incl_30d
from recent r
left join campaign_names cn
  on cn.campaign_id = r.campaign_id
order by r.attributed_revenue_excl_30d desc, r.attributed_orders_30d desc;

create or replace view mart.v_klaviyo_campaign_cards_30d_nobot as
with recent as (
  select
    campaign_id,
    sum(attributed_orders) as attributed_orders_30d,
    sum(attributed_revenue_excl) as attributed_revenue_excl_30d,
    sum(attributed_revenue_incl) as attributed_revenue_incl_30d
  from mart.mv_klaviyo_attribution_daily_nobot
  where order_date >= (current_date - interval '30 days')
    and campaign_id is not null
    and campaign_id <> ''
  group by campaign_id
),
events_norm as (
  select
    coalesce(
      nullif(e.campaign_id, ''),
      nullif(e.payload #>> '{attributes,event_properties,$campaign}', ''),
      nullif(e.payload #>> '{attributes,event_properties,campaign_id}', '')
    ) as campaign_id,
    coalesce(
      nullif(e.payload #>> '{attributes,event_properties,Campaign Name}', ''),
      nullif(e.payload #>> '{attributes,event_properties,campaign_name}', ''),
      nullif(e.payload #>> '{attributes,event_properties,Message Name}', ''),
      nullif(e.payload #>> '{attributes,event_properties,message_name}', '')
    ) as campaign_name,
    e.event_ts
  from raw.raw_klaviyo_events e
  where e.event_ts is not null
),
campaign_names as (
  select distinct on (campaign_id)
    campaign_id,
    campaign_name
  from events_norm
  where campaign_id is not null
    and campaign_id <> ''
  order by campaign_id, event_ts desc
)
select
  r.campaign_id,
  coalesce(nullif(cn.campaign_name, ''), r.campaign_id) as campaign_name,
  r.attributed_orders_30d,
  r.attributed_revenue_excl_30d,
  r.attributed_revenue_incl_30d
from recent r
left join campaign_names cn
  on cn.campaign_id = r.campaign_id
order by r.attributed_revenue_excl_30d desc, r.attributed_orders_30d desc;
