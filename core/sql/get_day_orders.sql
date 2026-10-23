-- Day orders list for the "Vefpantanir í dag" widget (Sölutölur / Mælaborð).
-- is_first_time flags orders whose buyer is making their first-ever web purchase
-- on p_day. Identity priority matches dashboard_first_time_web_buyers / day_kpi_pack:
--   company_id → real_email → company_name → customer_name.
--
-- EFTIR LOKUN MAGENTO API (2026-10-23). raw.newweb_orders_raw hætti að fyllast
-- 2026-10-21. Frá og með degi síðustu Magento-pöntunar koma raðir líka úr:
--   1. GA4 (raw.ga4_purchases_raw): pöntunin sést strax, með klukkustund og
--      upphæð. Þegar BC VEFUR-reikningur með sama pöntunarnúmeri er kominn
--      (síðasta 7–9 stafa talan í external_doc_no) koma nafn, kennitala og
--      raunupphæð án VSK úr BC. Annars „Pöntun N (bíður reiknings)“ og upphæð
--      = GA4 m/VSK × grand_excl_ratio.
--   2. BC VEFUR-reikningum bókuðum þennan dag sem GA4 sá ekki (~11% pantana).
--      Enginn tími (purchase_date null), raðast neðst.
--
-- HRAÐI (2026-10-23): fyrsta útgáfan tók 4 s og féll á tímamörkum í vafranum,
-- því hún reiknaði fyrsta kaupdag og kvörðun yfir alla söguna í hverju kalli.
-- Nú: frosnar töflur úr core/sql/web_bridge_perf_v1.sql (keyrið hana FYRST),
-- og BC-reikningar aðeins fyrir valinn dag og 14 daga á eftir.
--
-- Skilagerð óbreytt (dashboard.js les þessa fimm dálka). Heimildir: anon tekið
-- af 2026-10-09 (kpi_auth_revoke_anon.sql) — gefið það ekki aftur.

create or replace function public.get_day_orders(
  p_day   date default current_date,
  p_limit int  default 10
) returns table (
  purchase_date  timestamptz,
  customer_name  text,
  customer_id    text,
  subtotal_excl  numeric,
  is_first_time  boolean
)
language sql
stable
security definer
set search_path to 'public', 'mart', 'raw'
as $$
  with c as (
    select * from mart.ga4_bridge_calibration where id = 1
  ),

  -- ── Magento (dagurinn einn, fyrsti kaupdagur úr frosnu töflunni) ─────────
  mag_day as (
    select
      n.purchase_date, n.company_name, n.customer_name, n.company_id, n.subtotal_excl,
      case
        when nullif(trim(n.company_id), '') is not null then 'cid:' || trim(n.company_id)
        when nullif(trim(n.real_email), '') is not null then 'email:' || lower(trim(n.real_email))
        when nullif(trim(n.company_name), '') is not null then 'cname:' || lower(trim(n.company_name))
        when nullif(trim(n.customer_name), '') is not null then 'cust:' || lower(trim(n.customer_name))
        else null
      end as buyer_key
    from raw.newweb_orders_raw n
    where n.purchase_date >= p_day::timestamp
      and n.purchase_date <  p_day::timestamp + interval '1 day'
  ),
  mag_rows as (
    select
      m.purchase_date::timestamptz as purchase_date,
      coalesce(nullif(trim(m.company_name), ''), nullif(trim(m.customer_name), ''), 'Óþekktur') as customer_name,
      m.company_id::text as customer_id,
      m.subtotal_excl::numeric as subtotal_excl,
      (fs.first_day >= p_day) as is_first_time
    from mag_day m
    left join mart.web_first_seen_frozen fs on fs.buyer_key = m.buyer_key
  ),

  -- ── Eftir lokun Magento ──────────────────────────────────────────────────
  ga4_day as (
    select g.transaction_id, g.purchase_day, g.purchase_hour, g.revenue_incl
    from raw.ga4_purchases_raw g, c
    where g.purchase_day = p_day
      and p_day >= c.cutover_ts::date
      and g.transaction_id ~ '^\d+$'
      and g.transaction_id::bigint >= c.min_order_id
      and not exists (select 1 from raw.newweb_orders_raw n where n.order_id = g.transaction_id)
  ),
  -- Aðeins reikningar sem geta átt við: bókaðir á valda deginum eða næstu 14
  -- dögum (pöntun dagsins er reikningsfærð þá). 90% innan dags, 99,3% innan 3.
  vefur as (
    select
      coalesce(substring(trim(i.external_doc_no) from '(\d{7,9})\s*$'),
               nullif(trim(i.external_doc_no), '')) as order_no,
      i.booking_date::date as day,
      nullif(trim(i.company_name), '') as company_name,
      i.company_id::text as company_id,
      regexp_replace(coalesce(i.company_id, ''), '\D', '', 'g') as company_key,
      coalesce(i.amount_excl, 0)::numeric as amount_excl
    from raw.bc_invoices_raw i
    where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
      and i.booking_date >= p_day
      and i.booking_date <  p_day + 15
  ),
  keys as (
    select distinct company_key from vefur where company_key <> ''
  ),
  -- Fyrsta vefkaup á kennitölu: frosin Magento-saga + VEFUR-reikningar, aðeins
  -- fyrir kennitölur sem birtast hér. Flett upp á company_id EINS OG HÚN ER í
  -- BC (vísir idx_bc_invoices_company_id). Fyrsta útgáfan bar regex-kennitölu
  -- saman við hverja röð: full skönnun á 110 þús. reikningum × 51 kennitala
  -- = 2,06 af 2,07 s fallsins (explain 2026-10-23).
  vefur_first as (
    select regexp_replace(coalesce(i.company_id, ''), '\D', '', 'g') as k, min(i.booking_date)::date as first_day
    from raw.bc_invoices_raw i
    where i.company_id in (select distinct v.company_id from vefur v where v.company_id is not null)
      and upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
    group by 1
  ),
  first_kt as (
    select k.company_key as k, least(fz.first_day, vf.first_day) as first_day
    from keys k
    left join mart.web_first_seen_kt_frozen fz on fz.k = k.company_key
    left join vefur_first vf on vf.k = k.company_key
  ),
  post_ga4 as (
    select
      ((g.purchase_day + make_interval(hours => coalesce(g.purchase_hour, 0)::int)) at time zone 'UTC') as purchase_date,
      coalesce(v.company_name, 'Pöntun ' || g.transaction_id || ' (bíður reiknings)') as customer_name,
      v.company_id as customer_id,
      coalesce(v.amount_excl, round(g.revenue_incl * c.grand_excl_ratio)) as subtotal_excl,
      coalesce(fk.first_day >= p_day, false) as is_first_time
    from ga4_day g
    cross join c
    left join lateral (
      select * from vefur v where v.order_no = g.transaction_id order by v.day limit 1
    ) v on true
    left join first_kt fk on fk.k = v.company_key
  ),
  post_bc as (
    select
      null::timestamptz as purchase_date,
      coalesce(v.company_name, 'Óþekktur') as customer_name,
      v.company_id as customer_id,
      v.amount_excl as subtotal_excl,
      coalesce(fk.first_day >= p_day, false) as is_first_time
    from vefur v
    cross join c
    left join first_kt fk on fk.k = v.company_key
    where v.day = p_day
      and p_day >= c.cutover_ts::date
      and (v.order_no is null or (
            not exists (select 1 from raw.ga4_purchases_raw g where g.transaction_id = v.order_no)
        and not exists (select 1 from raw.newweb_orders_raw n where n.order_id = v.order_no)))
  )
  select purchase_date, customer_name, customer_id, subtotal_excl, is_first_time
  from (
    select * from mag_rows
    union all select * from post_ga4
    union all select * from post_bc
  ) u
  order by purchase_date desc nulls last
  limit case when p_limit = 0 then null else p_limit end;
$$;

revoke all on function public.get_day_orders(date, int) from public, anon;
grant execute on function public.get_day_orders(date, int) to authenticated, service_role;

-- Staðfesting (les eingöngu):
--   explain analyze select * from public.get_day_orders(date '2026-10-21', 10);
--   select * from public.get_day_orders(date '2026-10-21', 0);
