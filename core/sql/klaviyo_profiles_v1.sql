-- ============================================================================
-- mart.v_klaviyo_profiles_v1 — ein röð per netfang, með eiginleikum sem
-- daglegt GAS-sync sendir á Klaviyo-prófíla. DRÖG: ekki keyrt enn.
--
-- ── HEIMILDIR ───────────────────────────────────────────────────────
-- Allt er lesið LIFANDI úr Supabase. raw.customer_analysis_raw er aðeins notuð
-- fyrir fyrirtækjaheiti: BC-reitir hennar koma úr Google Sheets-leiðinni, sem
-- hefur verið dauð síðan 2026-04, svo síðasta BC-pöntun, flokkablanda og skor
-- þar eru frosin.
--
--   pantanir á vef     raw.newweb_orders_raw (lifandi)
--   pantanir utan vefs raw.bc_invoices_raw, salesperson_code <> 'VEFUR'
--                      (vefpantanir fara líka í BC sem VEFUR — án síunnar
--                      tvíteljast þær). Aðeins jafn ferskt og síðasti
--                      processBcDrop_v1; sanity-checkið bc_freshness grípur >35 d.
--   vöruflokkar        raw.bc_lines_raw ⨝ raw.products_raw (allar línur, VEFUR
--                      með — flokkablandan á að ná yfir báðar rásir)
--   vefstaða           api.get_web_activation (aldrei pantað / að dofna / ...)
--   forgangslisti      raw.customer_priority_flags_raw
--   netföng            magento_customers_raw.real_email, real_email á
--                      vefpöntunum, customer_email á eldri vefpöntunum,
--                      email á BC-reikningum. Innskráningarnetfangið er aldrei
--                      notað (<uuid>@example.com — sjá _check_klaviyo_contacts.sql).
--
-- ── REGLUR ──────────────────────────────────────────────────────────
-- * Netfang á fleiri en einu fyrirtæki fylgir því sem síðast var pantað fyrir
--   (122 netföng milli fjölskyldna, 193 innan sömu, mælt 2026-10-12).
-- * ENGAR upphæðir fara út: Klaviyo er þriðji aðili. Aðeins dagsetningar,
--   fjöldi, flokkar, staða og sölumaður. Upphæðir eru notaðar hér inni til að
--   velja aðalflokk, en birtast ekki í neinum dálki.
-- * Pöntunarbil er aðeins reiknað með 3+ pöntunardögum síðustu 365 daga.
--
-- ── ÖRYGGI ──────────────────────────────────────────────────────────
-- security_invoker: view-ið virðir RLS þess sem kallar. GAS les með
-- service role. anon og authenticated fá EKKI aðgang — hér eru netföng.
--
-- Apply: keyra í Supabase SQL editor. Svo prófunarfyrirspurnina neðst.
-- Breytist dálkaröðin (dálki bætt inn í miðjuna) neitar `create or replace`;
-- keyrðu þá fyrst `drop view if exists mart.v_klaviyo_profiles_v1;`.
-- ============================================================================

create or replace view mart.v_klaviyo_profiles_v1
with (security_invoker = true) as
with
web_orders as (
  select
    regexp_replace(coalesce(nullif(to_jsonb(n)->>'company_id', ''), to_jsonb(n)->>'national_id', ''), '\D', '', 'g') as company_key,
    'web:' || n.order_id::text   as order_ref,
    n.purchase_date::date        as order_date,
    'web'::text                  as channel,
    null::text                   as salesperson_code
  from raw.newweb_orders_raw n
  where n.purchase_date is not null
),
bc_orders as (
  select
    regexp_replace(coalesce(i.company_id, ''), '\D', '', 'g')   as company_key,
    'bc:' || i.document_no::text                                as order_ref,
    coalesce(i.order_date, i.booking_date)::date                as order_date,
    'bc'::text                                                  as channel,
    upper(trim(coalesce(i.salesperson_code, '')))               as salesperson_code
  from raw.bc_invoices_raw i
  where coalesce(i.order_date, i.booking_date) is not null
    and upper(trim(coalesce(i.salesperson_code, ''))) <> 'VEFUR'
),
all_orders as (
  select * from web_orders
  union all
  select * from bc_orders
),
company_orders as (
  select
    company_key,
    max(order_date)                                                          as last_order_date,
    max(order_date) filter (where channel = 'web')                           as last_web_order_date,
    max(order_date) filter (where channel = 'bc')                            as last_offline_order_date,
    count(distinct order_ref) filter (where order_date > current_date - 365) as orders_365d,
    count(distinct order_ref) filter (where order_date > current_date - 365
                                        and channel = 'web')                 as web_orders_365d,
    count(distinct order_date) filter (where order_date > current_date - 365) as order_days_365d,
    min(order_date) filter (where order_date > current_date - 365)           as first_order_in_365d
  from all_orders
  where company_key <> ''
  group by 1
),
company_rep as (
  -- Algengasti sölumaður á pöntunum utan vefs síðustu 365 daga.
  select distinct on (company_key) company_key, salesperson_code as sales_rep_code
  from bc_orders
  where order_date > current_date - 365 and salesperson_code <> ''
  group by company_key, salesperson_code
  order by company_key, count(*) desc, max(order_date) desc
),
company_cats as (
  select
    regexp_replace(coalesce(i.company_id, ''), '\D', '', 'g') as company_key,
    coalesce(nullif(p.level1, ''), nullif(split_part(coalesce(p.category_path, ''), ' / ', 1), '')) as level1,
    sum(coalesce(l.amount_excl, 0))                           as amount_excl
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  left join raw.products_raw p on p.sku = l.sku
  where coalesce(i.order_date, i.booking_date)::date > current_date - 365
  group by 1, 2
),
company_cat_summary as (
  select
    company_key,
    (array_agg(level1 order by amount_excl desc))[1] as primary_category,
    array_agg(level1 order by level1)                 as categories_365d
  from company_cats
  where company_key <> '' and level1 is not null and amount_excl > 0
  group by 1
),
activation as (
  select customer_key, company_name, has_account, state, priority_status, assigned_rep_name_norm
  from api.get_web_activation(false, null)
),
names as (
  select regexp_replace(coalesce(customer_id::text, ''), '\D', '', 'g') as company_key,
         max(nullif(trim(customer_name), ''))                           as customer_name
  from raw.customer_analysis_raw
  group by 1
),
raw_contacts as (
  select regexp_replace(coalesce(company_id, ''), '\D', '', 'g') as company_key,
         lower(trim(coalesce(real_email, '')))                  as email,
         'magento_account'::text                                 as src
  from raw.magento_customers_raw
  union all
  select regexp_replace(coalesce(nullif(to_jsonb(n)->>'company_id', ''), to_jsonb(n)->>'national_id', ''), '\D', '', 'g'),
         lower(trim(coalesce(to_jsonb(n)->>'real_email', ''))), 'newweb_order'
  from raw.newweb_orders_raw n
  union all
  select regexp_replace(coalesce(nullif(to_jsonb(o)->>'company_id', ''), to_jsonb(o)->>'national_id', ''), '\D', '', 'g'),
         lower(trim(coalesce(to_jsonb(o)->>'customer_email', ''))), 'oldweb_order'
  from raw.oldweb_orders_raw o
  union all
  select regexp_replace(coalesce(i.company_id, ''), '\D', '', 'g'),
         lower(trim(coalesce(i.email, ''))), 'bc_invoice'
  from raw.bc_invoices_raw i
),
contacts as (
  select company_key, email, array_agg(distinct src order by src) as sources
  from raw_contacts
  where company_key <> ''
    and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and email !~ '@(storkaup\.is|example\.com|test\.com|temporary\.com|pentest-tools\.com|[^@]*\.invalid)$'
  group by 1, 2
),
klaviyo_known as (
  -- Netföng sem Klaviyo þekkir nú þegar (hafa átt atburð þar). Syncið sendir
  -- aðeins þau nema SETTINGS.KLAVIYO_PROFILE_SYNC_INCLUDE_NEW = true.
  select distinct lower(email) as email
  from raw.raw_klaviyo_events
  where email is not null and email <> ''
),
contact_pick as (
  -- Eitt fyrirtæki per netfang: það sem síðast var pantað fyrir, svo það
  -- sem er með vefaðgang, svo lægsta kennitala (stöðug röðun).
  select distinct on (c.email)
    c.email,
    c.company_key,
    c.sources,
    count(*) over (partition by c.email)                          as companies_for_email
  from contacts c
  left join company_orders o on o.company_key = c.company_key
  order by c.email,
           o.last_order_date desc nulls last,
           ('magento_account' = any(c.sources)) desc,
           c.company_key
)
select
  cp.email,
  cp.company_key,
  left(cp.company_key, 10)                                         as family_key,
  coalesce(a.company_name, n.customer_name)                        as company_name,
  cp.companies_for_email,
  cp.sources,
  (k.email is not null)                                            as known_to_klaviyo,

  coalesce(a.has_account, false)                                   as has_web_account,
  coalesce(a.state, 'no_web_account')                              as web_state,

  o.last_order_date,
  o.last_web_order_date,
  o.last_offline_order_date,
  (current_date - o.last_order_date)                               as days_since_last_order,
  coalesce(o.orders_365d, 0)                                       as orders_365d,
  case when o.orders_365d > 0
       then round(100.0 * o.web_orders_365d / o.orders_365d) end   as web_order_share_pct_365d,

  case when o.order_days_365d >= 3
       then round((o.last_order_date - o.first_order_in_365d)::numeric / (o.order_days_365d - 1)) end
                                                                   as order_interval_days,
  case when o.order_days_365d >= 3
       then o.last_order_date + round((o.last_order_date - o.first_order_in_365d)::numeric / (o.order_days_365d - 1))::int end
                                                                   as expected_next_order_date,
  -- Alltaf true/false, aldrei null: Klaviyo heldur gömlu gildi ef það fær
  -- ekkert, svo flow sem byggir á dagsetningunni gæti ræst á úreltu bili.
  coalesce(
    o.order_days_365d >= 3
    and (current_date - o.last_order_date) < 365
    and o.last_order_date + round((o.last_order_date - o.first_order_in_365d)::numeric / (o.order_days_365d - 1))::int < current_date,
    false)                                                         as reorder_due,

  cs.primary_category,
  cs.categories_365d,

  r.sales_rep_code,
  (a.priority_status is not null)                                  as on_priority_list,
  a.assigned_rep_name_norm                                         as priority_rep
from contact_pick cp
left join company_orders      o  on o.company_key  = cp.company_key
left join company_rep         r  on r.company_key  = cp.company_key
left join company_cat_summary cs on cs.company_key = cp.company_key
left join activation          a  on a.customer_key = cp.company_key
left join names               n  on n.company_key  = cp.company_key
left join klaviyo_known       k  on k.email        = cp.email;

revoke all on mart.v_klaviyo_profiles_v1 from anon, authenticated, public;
grant select on mart.v_klaviyo_profiles_v1 to service_role;


-- ── PRÓFUN (keyra eftir apply) ──────────────────────────────────────
-- Tekur tíma? Ef þetta fer yfir ~8 s þarf view-ið að verða materialized view
-- sem syncið endurnýjar fyrst.
--
-- select
--   count(*)                                                    as netfong,
--   count(distinct company_key)                                 as fyrirtaeki,
--   count(*) filter (where 'bc_invoice' = any(sources)
--                      and sources = array['bc_invoice'])        as adeins_ur_bc,
--   count(*) filter (where last_order_date is null)             as aldrei_pantad,
--   count(*) filter (where order_interval_days is not null)     as med_pontunarbil,
--   count(*) filter (where known_to_klaviyo)                    as thekkt_i_klaviyo,
--   count(*) filter (where reorder_due)                         as komid_ad_endurpontun,
--   count(*) filter (where primary_category is not null)        as med_flokk,
--   count(*) filter (where sales_rep_code is not null)          as med_solumann,
--   count(*) filter (where on_priority_list)                    as a_forgangslista,
--   count(*) filter (where web_state = 'never_ordered'
--                      and last_offline_order_date is not null) as aldrei_a_vef_en_kaupa_utan
-- from mart.v_klaviyo_profiles_v1;
