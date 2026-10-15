-- ============================================================================
-- GREINING (les aðeins, breytir engu): sölumenn og vefnotkun viðskiptavina
-- 2026-10-15
--
-- Spurningin: hvaða sölumenn geta bætt sig í að koma sínum viðskiptavinum á
-- vefinn — og hvar liggur tækifærið hjá hverjum?
--
-- „Viðskiptavinir sölumanns“ = þeir sem hann pantar MEST fyrir utan vefs
-- síðustu 365 d (sama regla og „pantar hjá“ í get_customer_reps_v1). Þeir sem
-- eingöngu afgreiðslan sinnir lenda á „(enginn sölumaður)“. Innri reikningar
-- og merktir „ekki vefkúnni“ eru utan við.
--
-- Pantanir síðustu 365 d, hver pöntun talin einu sinni:
--   offline  BC-reikningar utan vefs (salesperson_code <> VEFUR)
--     ├ slegid_inn_bc   — sölumaðurinn sjálfur (hans kóði)
--     └ afgreidsla      — afgreiðslan (bc_salesperson_map.role)
--   vefur    raw.newweb_orders_raw
--     ├ sjalf           — viðskiptavinurinn sjálfur  ← MARKMIÐIÐ
--     └ solumadur_vef   — sölumannsreikningur pantar fyrir hann
-- (VEFUR-reikningar í BC eru vefpantanirnar aftur og eru því ekki taldar.)
--
-- Lesið svona:
--   lágt sjalfsafgr_pct + hátt slaer_inn_bc_pct  → sölumaðurinn ER pöntunar-
--        kerfi viðskiptavinanna; mest að vinna með onboarding
--   hátt slaer_inn_vef_pct                       → notar vefinn, en FYRIR þá;
--        næsta skref er að afhenda viðskiptavininum aðganginn
--   hátt afgreidsla_pct                          → viðskiptavinirnir panta
--        þegar sjálfir; vefkynning ein og sér gæti dugað
-- ============================================================================

with roles as (
  select m.code,
         coalesce(m.role, case when nullif(btrim(m.rep_name_norm), '') is not null then 'solumadur' else 'annad' end) as role,
         nullif(regexp_replace(regexp_replace(lower(coalesce(m.rep_name_norm, '')), 'solumadur|storkaup', '', 'g'), '[^a-z0-9]', '', 'g'), '') as person
  from raw.bc_salesperson_map m
),
rep_accounts as (
  select r.name_norm,
         regexp_replace(regexp_replace(lower(r.name_norm), 'solumadur|storkaup', '', 'g'), '[^a-z0-9]', '', 'g') as person
  from raw.sales_reps_ref r
  where coalesce(r.active, true) and btrim(coalesce(r.name_norm, '')) <> ''
),
excluded as (
  select f.customer_family_id as ckey
  from raw.customer_priority_flags_raw f
  where (to_jsonb(f) ->> 'not_web_reason') is not null
  union
  select unnest(array['99', '6001222820', '01', '1'])
),
off as (
  select regexp_replace(btrim(i.company_id), '\D', '', 'g') as ckey,
         upper(btrim(i.salesperson_code)) as code,
         i.document_no
  from raw.bc_invoices_raw i
  where coalesce(i.order_date, i.booking_date) >= current_date - 365
    and nullif(btrim(i.company_id), '') is not null
    and upper(btrim(coalesce(i.salesperson_code, ''))) not in ('', 'VEFUR')
),
off_r as (
  select o.ckey, o.code, o.document_no,
         coalesce(r.role, 'solumadur') as role,
         coalesce(r.person, lower(o.code)) as person
  from off o
  left join roles r on r.code = o.code
  where o.ckey <> '' and o.ckey not in (select ckey from excluded)
),
owner as (
  select distinct on (ckey) ckey, person
  from (select ckey, person, count(distinct document_no) as n
        from off_r where role = 'solumadur' group by 1, 2) z
  order by ckey, n desc
),
cust_off as (
  select ckey,
         count(distinct document_no) as offline_n,
         count(distinct document_no) filter (where role = 'afgreidsla') as desk_n
  from off_r group by 1
),
keyed as (
  select o.ckey, count(distinct x.document_no) as n
  from owner o
  join off_r x on x.ckey = o.ckey and x.person = o.person
  group by 1
),
web as (
  select regexp_replace(coalesce(n.company_id, ''), '\D', '', 'g') as ckey,
         n.order_id,
         exists (select 1 from rep_accounts r
                 where r.person not in ('', 'vefur')
                   and r.name_norm = regexp_replace(lower(translate(coalesce(n.customer_name, ''),
                         'áðþæöéíóúýÁÐÞÆÖÉÍÓÚÝ', 'adthaeoeiouyadthaeoeiouy')), '[^a-z0-9]+', '', 'g')) as by_rep
  from raw.newweb_orders_raw n
  where n.purchase_date >= current_date - 365
),
cust_web as (
  select ckey,
         count(distinct order_id) filter (where not by_rep) as self_n,
         count(distinct order_id) filter (where by_rep)     as repweb_n
  from web
  where ckey <> '' and ckey not in (select ckey from excluded)
  group by 1
),
cust as (
  select coalesce(o.person, '(enginn sölumaður)') as person,
         c.ckey, c.offline_n, c.desk_n,
         coalesce(k.n, 0) as keyed_n,
         coalesce(w.self_n, 0) as self_n,
         coalesce(w.repweb_n, 0) as repweb_n,
         c.offline_n + coalesce(w.self_n, 0) + coalesce(w.repweb_n, 0) as total_n
  from cust_off c
  left join owner o on o.ckey = c.ckey
  left join keyed k on k.ckey = c.ckey
  left join cust_web w on w.ckey = c.ckey
),
pkey as (
  select v, regexp_replace(regexp_replace(lower(coalesce(v, '')), 'solumadur|storkaup', '', 'g'), '[^a-z0-9]', '', 'g') as person
  from (select assigned_rep_name_norm as v from raw.customer_priority_flags_raw
        union select updated_by from raw.customer_priority_flags_raw) z
),
flags as (
  select p.person,
         count(*) filter (where f.status = 'priority') as i_forgangi,
         count(*) filter (where f.status = 'priority'
                            and f.last_contacted_at >= now() - interval '90 days') as snert_90d
  from raw.customer_priority_flags_raw f
  join pkey p on p.v = f.assigned_rep_name_norm
  group by 1
)
select c.person                                                         as solumadur,
       count(*)                                                         as vidskiptavinir,
       sum(c.total_n)                                                   as pantanir,
       round(100.0 * sum(c.self_n)   / nullif(sum(c.total_n), 0), 1)    as sjalfsafgr_pct,
       round(100.0 * sum(c.keyed_n)  / nullif(sum(c.total_n), 0), 1)    as slaer_inn_bc_pct,
       round(100.0 * sum(c.repweb_n) / nullif(sum(c.total_n), 0), 1)    as slaer_inn_vef_pct,
       round(100.0 * sum(c.desk_n)   / nullif(sum(c.total_n), 0), 1)    as afgreidsla_pct,
       count(*) filter (where c.self_n = 0)                             as aldrei_sjalf_a_vef,
       count(*) filter (where c.self_n > 0 and c.self_n * 2 >= c.total_n) as adallega_sjalf_a_vef,
       count(*) filter (where c.self_n = 0 and c.total_n >= 12)         as tidir_an_vefs,   -- 12+ pantanir/ár, aldrei sjálf á vef
       coalesce(max(f.i_forgangi), 0)                                   as i_forgangi,
       coalesce(max(f.snert_90d), 0)                                    as snert_forgang_90d
from cust c
left join flags f on f.person = c.person
group by c.person
having count(*) >= 3
order by sum(c.total_n) desc;
