-- ============================================================================
-- Lagersala (2026-10-12) — hvað hefur farið af storkaup.is/lagersala.
--
-- /lagersala er handvalinn listi (~136 vörur), ekki flokkur og ekki merki á
-- vörunni. GAS (core/lagersala.js) les síðuna daglega, flettir hverri vöru upp
-- í vörulistanum (GraphQL) og skrifar eina línu á vöru á dag hingað: hver var
-- á listanum þann dag, og hvað var til.
--
-- AF HVERJU BIRGÐIR EN EKKI SALA:
--   newweb_orders_raw er ein lína á PÖNTUN. Vörunúmerin eru kommuskeytt og
--   `qty` er heildarmagn pöntunarinnar, svo magn á vöru er ekki til. Og BC
--   (sími, sölufólk) kemur aðeins mánaðarlega. Birgðalækkun nær yfir allar
--   rásir — hún er aðalmælingin. Vefpantanir eru taldar sem PANTANIR sem
--   innihalda lagersöluvöru, ekki einingar.
--
-- UPPHAFSSTAÐA = fyrsta skot vörunnar. Salan opnaði 2026-10-12 og fyrsta skot
-- var tekið síðdegis sama dag, svo sala fyrir hádegi þann dag telst ekki.
--
-- Keyrist í Supabase SQL-ritlinum.
-- ============================================================================

create table if not exists raw.lagersala_snapshot (
  snap_date    date        not null,
  web_sku      text        not null,          -- STO_119246_STK — einkvæmt á vefnum
  sku          text        not null,          -- 119246 — tengilykill við pantanir
  slug         text        null,
  product_name text        null,
  qty          numeric     null,              -- til ráðstöfunar í grunneiningu; null = óþekkt
  captured_at  timestamptz not null default now(),
  primary key (snap_date, web_sku)
);
create index if not exists lagersala_snapshot_sku_idx on raw.lagersala_snapshot (sku);

alter table raw.lagersala_snapshot enable row level security;
revoke all on table raw.lagersala_snapshot from public, anon, authenticated;
grant all privileges on table raw.lagersala_snapshot to service_role;


-- Samantekt fyrir kortið á /kpi/dashboard. Ein jsonb-lína.
--   items           vörur á listanum í nýjasta skoti
--   items_moved     þar af sem hafa lækkað frá upphafi
--   sold_out        þar af sem standa á 0 eða minna
--   cleared_pct     meðalhlutfall farið, vara fyrir vöru (0–1). EKKI summa
--                   eininga: 10.000 skálar og einn ræstivagn eru ekki sama magn.
--   web_orders      vefpantanir frá opnun sem innihalda lagersöluvöru
--   web_customers   ólíkir kaupendur í þeim pöntunum
--   top             5 vörur sem mest hefur farið af, hlutfallslega
create or replace function public.lagersala_summary_v1()
returns jsonb
language sql
stable
security definer
set search_path to 'raw', 'public', 'pg_temp'
as $function$
  with bounds as (
    select min(snap_date) as launch, max(snap_date) as latest from raw.lagersala_snapshot
  ),
  firsts as (
    select distinct on (web_sku) web_sku, qty as start_qty, snap_date as first_date
    from raw.lagersala_snapshot
    order by web_sku, snap_date
  ),
  cur as (
    select s.web_sku, s.sku, s.product_name, s.slug, s.qty as cur_qty, f.start_qty
    from raw.lagersala_snapshot s
    join firsts f using (web_sku)
    where s.snap_date = (select latest from bounds)
  ),
  scored as (
    select *,
      case when start_qty > 0 and cur_qty is not null
           then least(1, greatest(0, (start_qty - cur_qty) / start_qty)) end as cleared
    from cur
  ),
  skus as (
    select distinct regexp_replace(sku, '[^0-9]', '', 'g') as sku from cur
  ),
  web as (
    select o.order_id, coalesce(nullif(o.company_id, ''), lower(o.real_email)) as buyer
    from raw.newweb_orders_raw o
    where o.purchase_date >= (select launch from bounds)
      and coalesce(lower(o.status), '') not in ('canceled', 'closed')
      and string_to_array(replace(coalesce(o.sku_normalized, ''), ' ', ''), ',')
          && (select array_agg(sku) from skus)
  )
  select jsonb_build_object(
    'launch_date',   (select launch from bounds),
    'latest_date',   (select latest from bounds),
    'captured_at',   (select max(captured_at) from raw.lagersala_snapshot),
    'items',         (select count(*) from scored),
    'items_moved',   (select count(*) from scored where cleared > 0),
    'sold_out',      (select count(*) from scored where start_qty > 0 and cur_qty <= 0),
    'cleared_pct',   (select coalesce(avg(cleared), 0) from scored where cleared is not null),
    'web_orders',    (select count(distinct order_id) from web),
    'web_customers', (select count(distinct buyer) from web where buyer is not null),
    'top', coalesce((
      select jsonb_agg(t order by t.cleared desc, t.name)
      from (
        select product_name as name, sku, slug, start_qty, cur_qty, cleared
        from scored where cleared > 0
        order by cleared desc, product_name
        limit 5
      ) t
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.lagersala_summary_v1() from public, anon;
grant execute on function public.lagersala_summary_v1() to authenticated, service_role;

notify pgrst, 'reload schema';

-- STAÐFESTING: anon = false, authenticated = true.
select has_function_privilege('anon', 'public.lagersala_summary_v1()', 'execute') as anon,
       has_function_privilege('authenticated', 'public.lagersala_summary_v1()', 'execute') as authenticated;
