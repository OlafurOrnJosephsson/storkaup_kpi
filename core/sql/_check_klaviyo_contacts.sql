-- ============================================================================
-- MÆLING (les aðeins, breytir engu): hvaða netföng getum við tengt við
-- fyrirtæki? Undirstaða fyrir daglegt sync af eiginleikum á Klaviyo-prófíla.
--
-- Klaviyo vinnur með netföng, okkar gögn með fyrirtæki (customer_key =
-- kennitala, aðeins tölustafir — sami lykill og api.get_web_activation).
-- Netföng koma úr þremur áttum:
--   raw.magento_customers_raw  vefaðgangar — AÐEINS real_email
--   raw.newweb_orders_raw      real_email á vefpöntunum
--   raw.oldweb_orders_raw      customer_email á eldri vefpöntunum
--
-- Innskráningarnetfangið (magento_customers_raw.email) er aldrei notað:
-- rafræn innskráning gefur því <uuid>@example.com (3.090 af 3.092 aðgöngum,
-- mælt 2026-10-12), og þeir fáu sem vantar real_email eru prófunaraðgangar
-- (poctest.invalid, pentest-tools.com, test.com, temporary.com).
--
-- Síað burt: @storkaup.is, @example.com og prófunarlénin hér að ofan.
-- raw.sales_reps_ref er VILJANDI ekki
-- notuð sem útilokunarlisti — hún ber netföng raunverulegra viðskiptavina
-- (sjá _measure_rep_email_misclass.sql), svo hún myndi henda þeim út.
--
-- Keyrðu fyrirspurnirnar hvora fyrir sig — ritillinn sýnir bara þá síðustu.
-- ============================================================================


-- ── A. Þekja: hversu mörg fyrirtæki og netföng, og hve mikið skarast við Klaviyo
with raw_contacts as (
  select regexp_replace(coalesce(company_id, ''), '\D', '', 'g')                as company_key,
         lower(trim(coalesce(real_email, '')))                                 as email,
         'magento_account'                                                      as src
  from raw.magento_customers_raw
  union all
  select regexp_replace(coalesce(nullif(to_jsonb(n)->>'company_id', ''), to_jsonb(n)->>'national_id', ''), '\D', '', 'g'),
         lower(trim(coalesce(to_jsonb(n)->>'real_email', ''))),
         'newweb_order'
  from raw.newweb_orders_raw n
  union all
  select regexp_replace(coalesce(nullif(to_jsonb(o)->>'company_id', ''), to_jsonb(o)->>'national_id', ''), '\D', '', 'g'),
         lower(trim(coalesce(to_jsonb(o)->>'customer_email', ''))),
         'oldweb_order'
  from raw.oldweb_orders_raw o
),
contacts as (
  select company_key, email, array_agg(distinct src) as srcs
  from raw_contacts
  where company_key <> ''
    and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and email !~ '@(storkaup\.is|example\.com|test\.com|temporary\.com|pentest-tools\.com|[^@]*\.invalid)$'
  group by 1, 2
),
kl as (
  select distinct lower(email) as email
  from raw.raw_klaviyo_events
  where event_type = 'received email'
    and event_ts > now() - interval '12 months'
    and email is not null
),
act as (
  select customer_key, state from api.get_web_activation(true, null)
)
select
  (select count(distinct company_key) from contacts)                                         as fyrirtaeki_med_netfang,
  (select count(distinct email) from contacts)                                               as netfong,
  (select count(distinct email) from contacts where 'magento_account' = any(srcs))           as ur_vefadgangi,
  (select count(distinct email) from contacts
    where srcs && array['newweb_order', 'oldweb_order'])                                     as ur_pontunum,
  (select count(*) from (select email from contacts
    group by 1 having count(distinct company_key) > 1) x)                                    as netfong_a_fleiri_fyrirtaekjum,
  -- Fjölskylda = fyrstu 10 tölustafir (sama regla og get_customer_profile_family_summary).
  -- Innan fjölskyldu er tvítekning meinlaus; milli fjölskyldna þarf reglu.
  (select count(*) from (select email from contacts
    group by 1 having count(distinct company_key) > 1
                  and count(distinct left(company_key, 10)) = 1) x)                          as innan_somu_fjolskyldu,
  (select count(*) from (select email from contacts
    group by 1 having count(distinct left(company_key, 10)) > 1) x)                          as milli_fjolskyldna,
  (select count(*) from kl)                                                                  as klaviyo_vidtakendur_12m,
  (select count(*) from kl where email in (select email from contacts))                      as klaviyo_tengd_fyrirtaeki,
  (select count(distinct email) from contacts where email not in (select email from kl))     as netfong_ekki_i_klaviyo,
  (select count(*) from act where state = 'never_ordered')                                   as aldrei_pantad_alls,
  (select count(*) from act where state = 'never_ordered'
    and customer_key in (select company_key from contacts))                                  as aldrei_pantad_med_netfang,
  (select count(*) from act where state in ('lapsing', 'lapsed'))                            as dofnandi_eda_uti_alls,
  (select count(*) from act where state in ('lapsing', 'lapsed')
    and customer_key in (select company_key from contacts))                                  as dofnandi_eda_uti_med_netfang;


-- ── B. Eru innskráningarnetföngin raunveruleg? Lén vefaðganga án real_email.
-- Rafræn innskráning gæti hafa búið til gervinetföng; ef eitthvert lén hér
-- er augljóslega gervi bætist það við síuna í A.
select split_part(lower(email), '@', 2)                               as len,
       count(*)                                                       as adgangar,
       count(*) filter (where coalesce(trim(real_email), '') = '')    as an_real_email
from raw.magento_customers_raw
group by 1
order by 2 desc
limit 20;
