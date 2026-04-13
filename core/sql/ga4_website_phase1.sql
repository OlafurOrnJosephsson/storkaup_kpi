-- GA4 website dashboard Phase 1
-- Run in Supabase SQL editor.

create schema if not exists raw;
create schema if not exists api;

create table if not exists raw.ga4_daily_metrics_raw (
  day date primary key,
  sessions bigint not null default 0,
  total_users bigint not null default 0,
  screen_page_views bigint not null default 0,
  engaged_sessions bigint not null default 0,
  engagement_rate numeric not null default 0,
  event_count bigint not null default 0,
  add_to_cart bigint not null default 0,
  begin_checkout bigint not null default 0,
  purchases bigint not null default 0,
  source text,
  updated_at timestamptz not null default now()
);

create table if not exists raw.ga4_channel_daily_raw (
  day date not null,
  channel_group text not null,
  sessions bigint not null default 0,
  total_users bigint not null default 0,
  engaged_sessions bigint not null default 0,
  event_count bigint not null default 0,
  source text,
  updated_at timestamptz not null default now(),
  primary key (day, channel_group)
);

create index if not exists ga4_channel_daily_raw_day_idx
  on raw.ga4_channel_daily_raw(day desc);

create or replace function api.website_kpi_pack(p_day date default current_date)
returns table (
  day date,
  sessions bigint,
  total_users bigint,
  screen_page_views bigint,
  engaged_sessions bigint,
  engagement_rate numeric,
  event_count bigint,
  add_to_cart bigint,
  begin_checkout bigint,
  purchases bigint,
  vs_prev7_sessions_pct numeric,
  vs_prev7_users_pct numeric,
  vs_prev7_page_views_pct numeric,
  vs_prev7_purchases_pct numeric,
  top_channels jsonb
)
language sql
stable
security definer
set search_path to 'public', 'raw'
as $function$
with params as (
  select p_day::date as day
),
d0 as (
  select
    p.day,
    coalesce(g.sessions, 0)::bigint as sessions,
    coalesce(g.total_users, 0)::bigint as total_users,
    coalesce(g.screen_page_views, 0)::bigint as screen_page_views,
    coalesce(g.engaged_sessions, 0)::bigint as engaged_sessions,
    coalesce(g.engagement_rate, 0)::numeric as engagement_rate,
    coalesce(g.event_count, 0)::bigint as event_count,
    coalesce(g.add_to_cart, 0)::bigint as add_to_cart,
    coalesce(g.begin_checkout, 0)::bigint as begin_checkout,
    coalesce(g.purchases, 0)::bigint as purchases
  from params p
  left join raw.ga4_daily_metrics_raw g on g.day = p.day
),
prev7 as (
  select
    coalesce(avg(g.sessions), 0)::numeric as avg_sessions,
    coalesce(avg(g.total_users), 0)::numeric as avg_total_users,
    coalesce(avg(g.screen_page_views), 0)::numeric as avg_page_views,
    coalesce(avg(g.purchases), 0)::numeric as avg_purchases
  from raw.ga4_daily_metrics_raw g
  where g.day >= ((select day from params) - interval '7 day')::date
    and g.day < (select day from params)
),
channels as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'channel', c.channel_group,
        'sessions', c.sessions,
        'users', c.total_users,
        'engagedSessions', c.engaged_sessions,
        'eventCount', c.event_count
      )
      order by c.sessions desc, c.channel_group asc
    ),
    '[]'::jsonb
  ) as top_channels
  from (
    select
      channel_group,
      sessions,
      total_users,
      engaged_sessions,
      event_count
    from raw.ga4_channel_daily_raw
    where day = (select day from params)
    order by sessions desc, channel_group asc
    limit 5
  ) c
)
select
  d0.day,
  d0.sessions,
  d0.total_users,
  d0.screen_page_views,
  d0.engaged_sessions,
  d0.engagement_rate,
  d0.event_count,
  d0.add_to_cart,
  d0.begin_checkout,
  d0.purchases,
  case when coalesce(prev7.avg_sessions, 0) = 0 then 0
    else round((d0.sessions - prev7.avg_sessions) / prev7.avg_sessions, 4)
  end as vs_prev7_sessions_pct,
  case when coalesce(prev7.avg_total_users, 0) = 0 then 0
    else round((d0.total_users - prev7.avg_total_users) / prev7.avg_total_users, 4)
  end as vs_prev7_users_pct,
  case when coalesce(prev7.avg_page_views, 0) = 0 then 0
    else round((d0.screen_page_views - prev7.avg_page_views) / prev7.avg_page_views, 4)
  end as vs_prev7_page_views_pct,
  case when coalesce(prev7.avg_purchases, 0) = 0 then 0
    else round((d0.purchases - prev7.avg_purchases) / prev7.avg_purchases, 4)
  end as vs_prev7_purchases_pct,
  channels.top_channels
from d0
cross join prev7
cross join channels;
$function$;

grant usage on schema api to anon, authenticated, service_role;
grant execute on function api.website_kpi_pack(date) to anon, authenticated, service_role;
