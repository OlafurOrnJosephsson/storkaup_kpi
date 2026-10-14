-- ============================================================================
-- customer_profiles_live_bc_v1 — BC-reitir prófílanna lesnir LIFANDI
-- (2026-10-14)
--
-- ── VANDINN ─────────────────────────────────────────────────────────
-- mart.v_customer_profile_enriched las BC-reitina úr raw.customer_analysis_raw,
-- sem GAS (core/customer_analysis.js) fyllir úr Google Sheets. Sú leið virkaði
-- ALDREI fyrir BC: loadSheetObjects_ staðlar ekki dálkaheiti, schema.js notar
-- ASCII-heiti síðan 2026-02-26 en blöðin íslensk, svo ekkert BC las. Og blöðin
-- frusu 2026-05-25. Mælt 2026-10-14 í api.v_customer_profiles_labeled, 6.387 raðir:
--   low_hanging_fruit_score > 0   : 0
--   total_bc_orders > 0           : 0
--   primary_category=Rekstrarvörur: 6.387  (pickPrimaryCategory_ á tómu)
-- Og þar sem öll LHFS voru jöfn gaf cume_dist öllum 1.0 -> ALLIR „Very High“.
-- /kpi/vidskiptavinur raðar sjálfgefið eftir LHFS, svo röðunin var merkingarlaus.
--
-- ── LAUSNIN ─────────────────────────────────────────────────────────
-- Neðsta lagið reiknar BC-reitina úr raw.bc_invoices_raw / bc_lines_raw /
-- bc_customers_raw. Dálkar, röð og gerðir óbreytt, svo efri lögin
-- (api.v_customer_profiles -> _labeled -> _labeled_trends -> mv_) og Webflow
-- þurfa engar breytingar. Formúlurnar fylgja GAS (calc*Score_, suggestAction_)
-- nema:
--   * LHFS = BC-sala UTAN VEFS (salesperson_code <> 'VEFUR') síðustu 365 d,
--     m.kr. m/VSK (2 aukastafir), x1,5 ef aldrei pantað á vef. GAS notaði
--     ævisölu BC (VEFUR með) mínus vefsölu, og námundaði í heilar milljónir.
--   * total_value / total_orders = BC eingöngu (VEFUR innifalið). GAS lagði
--     vefinn ofan á og tvítaldi þannig vefpantanir.
--   * primary_category / flokkafjöldi: stærsti level1 eftir upphæð síðustu
--     365 d (sama og mart.v_klaviyo_profiles_v1). Tómt ef engar línur — áður
--     „Rekstrarvörur“ á öllum.
--   * Fyrirtæki með BC-reikning síðustu 365 d en enga röð í
--     customer_analysis_raw fá nú röð. Áður sáust þau hvergi.
-- Og api.v_customer_profiles_labeled: lhfs_pct er nú hlutfallsröð MEÐAL
-- jákvæðra skora; LHFS = 0 er alltaf „Low“. Annars yrðu öll núllin (flest
-- fyrirtæki) „Medium“/„High“ eftir því hve stór hluti þau eru.
--
-- Ekki breytt: api.v_customer_segments les customer_analysis_raw beint
-- (primary_category þar er enn „Rekstrarvörur“ á öllum). Sér verk.
--
-- ── KEYRSLA ─────────────────────────────────────────────────────────
-- Skref 0 fyrst. Svo blokkin begin…commit í heild. Svo skref 2 og 3.
-- create or replace view heldur dálkum og gerðum (athugað 2026-10-14 gegn
-- information_schema), svo ekkert sem byggir á view-unum þarf að falla.
-- ============================================================================


-- ── Skref 0: view-stillingar ────────────────────────────────────────
-- create or replace view SKIPTIR ÚT reloptions. Ef þetta sýnir
-- security_invoker=true á öðru hvoru, settu `with (security_invoker = true)`
-- aftan við nafnið á því view-i hér að neðan áður en þú keyrir.
select n.nspname || '.' || c.relname as view, c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where (n.nspname, c.relname) in (('mart', 'v_customer_profile_enriched'),
                                 ('api',  'v_customer_profiles_labeled'));


-- ── Skref 1: view-in ────────────────────────────────────────────────
begin;

create or replace view mart.v_customer_profile_enriched as
with
inv as (
  select trim(both from i.company_id)                    as customer_id,
         i.document_no,
         coalesce(i.order_date, i.booking_date)::date    as order_date,
         coalesce(i.amount_incl, 0)                      as amount_incl,
         upper(trim(coalesce(i.salesperson_code, '')))   as salesperson_code
  from raw.bc_invoices_raw i
  where i.company_id is not null
    and trim(both from i.company_id) <> ''
    and i.document_no is not null
    and coalesce(i.order_date, i.booking_date) is not null
),
bc as (
  select customer_id,
         count(distinct document_no)                                                  as total_bc_orders,
         count(distinct document_no) filter (where order_date >= current_date - 90)   as orders_bc_90d,
         count(distinct document_no) filter (where order_date >= current_date - 365)  as orders_bc_365d,
         sum(amount_incl)                                                             as bc_total_incl,
         sum(amount_incl) filter (where order_date >= current_date - 365
                                    and salesperson_code <> 'VEFUR')                  as offline_incl_365d,
         max(order_date)                                                              as last_bc_order_date
  from inv
  group by 1
),
-- Óbreytt frá fyrri útgáfu (order_date eingöngu, ekki booking_date).
gaps as (
  select i.company_id,
         i.order_date::date - lag(i.order_date::date)
           over (partition by i.company_id order by i.order_date::date) as gap_days
  from raw.bc_invoices_raw i
  where i.company_id is not null and i.order_date is not null
),
gap_stats as (
  select company_id, avg(gap_days) as avg_days_between_bc_orders
  from gaps
  where gap_days is not null
  group by 1
),
web_last as (
  select trim(both from n.company_id)  as customer_id,
         max(n.purchase_date)::date    as last_web_order_date
  from raw.newweb_orders_raw n
  where n.company_id is not null and trim(both from n.company_id) <> ''
  group by 1
),
cats as (
  select inv.customer_id,
         coalesce(nullif(p.level1, ''),
                  nullif(split_part(coalesce(p.category_path, ''), ' / ', 1), '')) as level1,
         sum(coalesce(l.amount_excl, 0))                                         as amount_excl
  from raw.bc_lines_raw l
  join inv on inv.document_no = l.document_no
  left join raw.products_raw p on p.sku = l.sku
  where inv.order_date >= current_date - 365
  group by 1, 2
),
cat_summary as (
  select customer_id,
         (array_agg(level1 order by amount_excl desc))[1] as primary_category,
         count(*)                                         as category_count
  from cats
  where level1 is not null and amount_excl > 0
  group by 1
),
bc_cust as (
  select distinct on (trim(both from c.company_id))
         trim(both from c.company_id)        as customer_id,
         nullif(trim(c.company_name), '')    as company_name,
         nullif(trim(c.phone), '')           as phone
  from raw.bc_customers_raw c
  where c.company_id is not null
  order by trim(both from c.company_id)
),
inv_name as (
  select distinct on (trim(both from i.company_id))
         trim(both from i.company_id)        as customer_id,
         nullif(trim(i.company_name), '')    as company_name
  from raw.bc_invoices_raw i
  where i.company_id is not null and nullif(trim(i.company_name), '') is not null
  order by trim(both from i.company_id), coalesce(i.order_date, i.booking_date) desc nulls last
),
-- Innri reikningar Stórkaups, ekki viðskiptavinir (fundið 2026-10-14 með
-- customer_name ilike '%stórkaup%'). „99“ (staðgreiðsla/posi) var 14. efst á
-- LHFS við fyrstu keyrslu. EKKI sía á lengd númers: 9 stafa númer hér eru
-- kennitölur einstaklinga sem misstu fremsta 0 í Sheets.
internal_accounts(customer_id) as (
  values ('99'),          -- Stórkaup staðgreiðsla posi
         ('6001222820'),  -- Stórkaup ehf. (eigin kennitala)
         ('01'), ('1')    -- Þjónustuver Stórkaups
),
ids as (
  select ca.customer_id from raw.customer_analysis_raw ca
  union
  select bc.customer_id from bc where bc.orders_bc_365d > 0
  except
  select customer_id from internal_accounts
),
base as (
  select ids.customer_id,
         ca.customer_name                                         as ca_name,
         coalesce(ca.webshop_active, wl.customer_id is not null)  as webshop_active,
         ca.webshop_added_date,
         ca.primary_email,
         ca.phone                                                 as ca_phone,
         ca.webshop_orders,
         ca.webshop_sales,
         coalesce(bc.total_bc_orders, 0)                          as total_bc_orders,
         coalesce(bc.orders_bc_90d, 0)                            as orders_bc_90d,
         coalesce(bc.orders_bc_365d, 0)                           as orders_bc_365d,
         coalesce(bc.bc_total_incl, 0)                            as bc_total_incl,
         coalesce(bc.offline_incl_365d, 0)                        as offline_incl_365d,
         greatest(bc.last_bc_order_date, wl.last_web_order_date)  as last_order_date,
         cs.primary_category,
         cs.category_count,
         bcc.company_name                                         as bc_name,
         bcc.phone                                                as bc_phone,
         invn.company_name                                        as inv_name
  from ids
  left join raw.customer_analysis_raw ca on ca.customer_id = ids.customer_id
  left join bc            on bc.customer_id   = ids.customer_id
  left join web_last wl   on wl.customer_id   = ids.customer_id
  left join cat_summary cs on cs.customer_id  = ids.customer_id
  left join bc_cust bcc   on bcc.customer_id  = ids.customer_id
  left join inv_name invn on invn.customer_id = ids.customer_id
),
scored as (
  select b.*,
         -- calcFrequencyScore_
         case when b.total_bc_orders > 100 then 5
              when b.total_bc_orders > 50  then 4
              when b.total_bc_orders > 20  then 3
              when b.total_bc_orders > 5   then 2
              when b.total_bc_orders > 0   then 1
              else 0 end                                           as freq_score,
         -- calcRecencyScore_
         case when b.last_order_date is null                     then 0
              when current_date - b.last_order_date <= 30        then 5
              when current_date - b.last_order_date <= 90        then 4
              when current_date - b.last_order_date <= 180       then 3
              when current_date - b.last_order_date <= 365       then 2
              else 1 end                                           as recency_score,
         -- calcValueScore_
         case when b.bc_total_incl > 50000000 then 5
              when b.bc_total_incl > 20000000 then 4
              when b.bc_total_incl >  5000000 then 3
              when b.bc_total_incl >  1000000 then 2
              when b.bc_total_incl >        0 then 1
              else 0 end                                           as value_score,
         -- calcCategoryFitScore_
         case when b.category_count is null then 0
              when b.category_count >= 4    then 5
              when b.category_count  = 3    then 4
              when b.category_count  = 2    then 3
              else 2 end                                           as catfit_score,
         -- calcLowHangingFruitScore_ (sjá haus: utan vefs, 365 d)
         case when b.offline_incl_365d > 0
              then round((b.offline_incl_365d / 1000000.0)::numeric, 2)
                   * case when b.webshop_active then 1.0 else 1.5 end
              else 0 end                                           as lhfs
  from base b
),
final as (
  select s.*,
         round((s.recency_score + s.freq_score) / 2.0) as readiness_score
  from scored s
)
select f.customer_id,
       coalesce(nullif(trim(f.ca_name), ''), f.bc_name, f.inv_name)  as customer_name,
       f.webshop_active,
       f.webshop_added_date,
       f.primary_email,
       coalesce(f.bc_phone, nullif(trim(f.ca_phone), ''))            as phone,
       -- suggestAction_
       case when not f.webshop_active and f.lhfs > 5 and f.readiness_score >= 3
              then 'Onboarda á vef — stórt tækifæri'
            when f.webshop_active and f.lhfs > 3
              then 'Auka web share — kynna sjálfsafgreiðslu'
            when not f.webshop_active and f.readiness_score <= 2
              then 'Viðhalda sambandi, ekki forgangsviðskiptavinur'
            else 'Standard eftirfylgni'
       end                                                           as recommended_action,
       (f.value_score * 10 + f.catfit_score * 10)::numeric           as potential_score,
       f.lhfs::numeric                                               as low_hanging_fruit_score,
       f.bc_total_incl::numeric                                      as total_value,
       f.total_bc_orders::numeric                                    as total_orders,
       f.total_bc_orders::numeric                                    as total_bc_orders,
       f.orders_bc_90d::numeric                                      as orders_bc_90d,
       f.orders_bc_365d::numeric                                     as orders_bc_365d,
       f.webshop_orders,
       f.webshop_sales,
       f.primary_category,
       gs.avg_days_between_bc_orders,
       case when f.orders_bc_365d > 0 then 365.0 / f.orders_bc_365d end as estimated_order_interval_365d
from final f
left join gap_stats gs on gs.company_id = f.customer_id;


create or replace view api.v_customer_profiles_labeled as
with scored as (
  select p.customer_id,
         p.customer_name,
         p.webshop_active,
         p.primary_email,
         p.phone,
         p.recommended_action,
         p.potential_score,
         p.low_hanging_fruit_score,
         p.total_bc_orders,
         p.orders_bc_90d,
         p.orders_bc_365d,
         p.webshop_orders,
         p.webshop_sales,
         p.avg_days_between_bc_orders,
         p.estimated_order_interval_365d,
         p.primary_category,
         p.orders_web_365d,
         p.avg_days_between_web_orders,
         -- Hlutfallsröð MEÐAL jákvæðra skora; 0 = ekkert tækifæri = Low.
         case when coalesce(p.low_hanging_fruit_score, 0) > 0
              then cume_dist() over (partition by coalesce(p.low_hanging_fruit_score, 0) > 0
                                     order by p.low_hanging_fruit_score)
              else 0::double precision
         end as lhfs_pct
  from api.v_customer_profiles p
)
select customer_id,
       customer_name,
       webshop_active,
       primary_email,
       phone,
       recommended_action,
       potential_score,
       low_hanging_fruit_score,
       total_bc_orders,
       orders_bc_90d,
       orders_bc_365d,
       webshop_orders,
       webshop_sales,
       avg_days_between_bc_orders,
       estimated_order_interval_365d,
       primary_category,
       orders_web_365d,
       avg_days_between_web_orders,
       lhfs_pct,
       round((lhfs_pct * 100.0::double precision)::numeric, 1) as lhfs_percentile,
       case
         when lhfs_pct >= 0.90::double precision then 'Very High'
         when lhfs_pct >= 0.70::double precision then 'High'
         when lhfs_pct >= 0.40::double precision then 'Medium'
         else 'Low'
       end as lhfs_label
from scored;

commit;


-- ── Skref 2: endurnýja MV-ið (síðurnar lesa það) ───────────────────
select public.refresh_mv_customer_profiles_labeled_trends();


-- ── Skref 3: prófun ─────────────────────────────────────────────────
-- Væntum: lhfs_pos og bc_orders_pos vel yfir 0, cat_rekstrar langt undir
-- rows_total, n_actions 3-4, very_high ~10% af lhfs_pos.
select count(*)                                                    as rows_total,
       count(*) filter (where low_hanging_fruit_score > 0)        as lhfs_pos,
       count(*) filter (where total_bc_orders > 0)                as bc_orders_pos,
       count(*) filter (where primary_category = 'Rekstrarvörur') as cat_rekstrar,
       count(*) filter (where primary_category is null)           as cat_null,
       count(distinct recommended_action)                         as n_actions,
       count(*) filter (where lhfs_label = 'Very High')           as very_high,
       max(low_hanging_fruit_score)                               as lhfs_max
from api.mv_customer_profiles_labeled_trends;

-- Efstu 15 — eiga að vera þekkt stór fyrirtæki sem kaupa mikið utan vefs.
select customer_id, customer_name, webshop_active, low_hanging_fruit_score,
       lhfs_label, recommended_action, primary_category, orders_bc_365d
from api.mv_customer_profiles_labeled_trends
order by low_hanging_fruit_score desc
limit 15;
