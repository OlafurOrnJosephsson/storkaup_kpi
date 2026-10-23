-- Day orders list for the "Vefpantanir í dag" widget (Sölutölur / Mælaborð).
-- is_first_time flags orders whose buyer is making their first-ever web purchase
-- on p_day. Identity priority matches dashboard_first_time_web_buyers / day_kpi_pack:
--   company_id → real_email → company_name → customer_name.
--
-- EFTIR LOKUN MAGENTO API (2026-10-23). raw.newweb_orders_raw hætti að fyllast
-- 2026-10-21 og listinn sagði „Engar pantanir fundust“. Frá og með degi síðustu
-- Magento-pöntunar koma raðir líka úr:
--   1. GA4 (raw.ga4_purchases_raw): pöntunin sést strax, með klukkustund og
--      upphæð. Þegar BC-reikningur með sama númeri er kominn
--      (external_doc_no = transaction_id, 97% samsvörun) koma nafn fyrirtækis,
--      kennitala og raunupphæð án VSK úr BC. Annars „Pöntun N (bíður reiknings)“
--      og upphæð = GA4 m/VSK × hlutfall án VSK úr Magento 1.–20. okt.
--   2. BC VEFUR-reikningum bókuðum þennan dag sem GA4 sá ekki (~11% pantana).
--      Þeir hafa engan tíma (purchase_date null) og raðast neðst.
-- Síun á gömlum pöntunarnúmerum og tvítalningu = sama og
-- mart.v_web_daily_unified (core/sql/ga4_realtime_v1.sql).
--
-- Skilagerðin er óbreytt (dashboard.js les þessa fimm dálka), svo
-- create or replace dugar og heimildir haldast. EF lifandi útgáfan hefur aðra
-- skilagerð fellur keyrslan á villu og ekkert breytist.
--
-- Heimildir: anon tekið af 2026-10-09 (kpi_auth_revoke_anon.sql). Eldri útgáfa
-- þessarar skrár gaf anon aðgang — gerið það ekki aftur.

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
set search_path to 'public', 'raw'
as $$
  with buyer_keyed as (
    select
      purchase_date,
      company_name,
      customer_name,
      company_id,
      subtotal_excl,
      case
        when nullif(trim(company_id), '') is not null then 'cid:' || trim(company_id)
        when nullif(trim(real_email), '') is not null then 'email:' || lower(trim(real_email))
        when nullif(trim(company_name), '') is not null then 'cname:' || lower(trim(company_name))
        when nullif(trim(customer_name), '') is not null then 'cust:' || lower(trim(customer_name))
        else null
      end as buyer_key
    from raw.newweb_orders_raw
    where purchase_date is not null
  ),
  first_seen as (
    select buyer_key, min(purchase_date)::date as first_day
    from buyer_keyed
    where buyer_key is not null
    group by buyer_key
  ),
  mag_rows as (
    select
      b.purchase_date::timestamptz as purchase_date,
      coalesce(nullif(trim(b.company_name), ''), nullif(trim(b.customer_name), ''), 'Óþekktur') as customer_name,
      b.company_id::text as customer_id,
      b.subtotal_excl::numeric as subtotal_excl,
      (fs.first_day >= p_day) as is_first_time
    from buyer_keyed b
    left join first_seen fs on fs.buyer_key = b.buyer_key
    where b.purchase_date >= p_day::timestamp
      and b.purchase_date < (p_day::timestamp + interval '1 day')
  ),

  -- ── Eftir lokun Magento ──────────────────────────────────────────────────
  cutover as (
    select max(purchase_date)::date as day from raw.newweb_orders_raw
  ),
  id_floor as (
    select min(order_id::bigint) as min_id
    from raw.newweb_orders_raw
    where purchase_date >= date '2026-10-01' and order_id ~ '^\d+$'
  ),
  ratio as (
    select sum(subtotal_excl) / nullif(sum(grand_total), 0) as excl_ratio
    from raw.newweb_orders_raw
    where purchase_date >= date '2026-10-01' and purchase_date < date '2026-10-21'
  ),
  -- external_doc_no er stundum „<innkaupanr. kúnna> / <pöntunarnr.>“
  -- (t.d. „04126 / 12699983“, „SO91165 / 12759710“): pöntunarnúmerið er
  -- síðasta 7–9 stafa talan. Annars reiturinn eins og hann er.
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
      and i.booking_date is not null
  ),
  ga4 as (
    select g.transaction_id, g.purchase_day, g.purchase_hour, g.revenue_incl
    from raw.ga4_purchases_raw g, id_floor f
    where g.transaction_id ~ '^\d+$'
      and g.transaction_id::bigint >= f.min_id
      and not exists (select 1 from raw.newweb_orders_raw n where n.order_id = g.transaction_id)
  ),
  -- Fyrsta vefkaup eftir kennitölu: Magento-saga + VEFUR-reikningar.
  first_seen_kt as (
    select k, min(d) as first_day
    from (
      select regexp_replace(coalesce(n.company_id, ''), '\D', '', 'g') as k, n.purchase_date::date as d
      from raw.newweb_orders_raw n
      where n.purchase_date is not null
      union all
      select v.company_key, v.day from vefur v
    ) u
    where k <> ''
    group by k
  ),
  post_ga4 as (
    select
      ((g.purchase_day + make_interval(hours => coalesce(g.purchase_hour, 0)::int)) at time zone 'UTC') as purchase_date,
      coalesce(v.company_name, 'Pöntun ' || g.transaction_id || ' (bíður reiknings)') as customer_name,
      v.company_id as customer_id,
      coalesce(v.amount_excl, round(g.revenue_incl * r.excl_ratio)) as subtotal_excl,
      coalesce(fk.first_day >= p_day, false) as is_first_time
    from ga4 g
    cross join ratio r
    cross join cutover c
    left join lateral (
      select * from vefur v where v.order_no = g.transaction_id order by v.day limit 1
    ) v on true
    left join first_seen_kt fk on fk.k = v.company_key
    where g.purchase_day = p_day
      and p_day >= c.day
  ),
  post_bc as (
    select
      null::timestamptz as purchase_date,
      coalesce(v.company_name, 'Óþekktur') as customer_name,
      v.company_id as customer_id,
      v.amount_excl as subtotal_excl,
      coalesce(fk.first_day >= p_day, false) as is_first_time
    from vefur v
    cross join cutover c
    left join first_seen_kt fk on fk.k = v.company_key
    where v.day = p_day
      and p_day >= c.day
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
--   select * from public.get_day_orders(current_date, 0);
--   select * from public.get_day_orders(date '2026-10-20', 5);  -- Magento-dagur, óbreyttur
