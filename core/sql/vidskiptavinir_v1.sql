-- ============================================================================
-- vidskiptavinir_v1 — gagnalag nýju viðskiptavinasíðunnar (Webflow/vidskiptavinir.js)
-- 2026-10-15
--
-- Fjögur RPC, öll lesa-eingöngu, SECURITY DEFINER, aðeins `authenticated`
-- (KPI-síðurnar keyra sem innskráður notandi síðan 2026-10-09; anon nær engu):
--
--   api.search_customers_v1(p_q, p_limit)
--       Leitin efst á síðunni. Nafn, kennitala EÐA vörunúmer: tölustafastrengur
--       sem passar við SKU skilar þeim sem hafa keypt vöruna, síðast-keypt fyrst.
--
--   api.get_customer_card_v1(p_customer_id)
--       Lykiltölur prófílsins í einu kalli, fyrir alla fjölskylduna
--       (api.resolve_customer_family_ids: fyrstu 10 stafir kennitölu).
--       Pantanir UTAN VEFS (salesperson_code <> 'VEFUR') og á vef aðskildar —
--       orders_bc_365d í prófílkeðjunni telur VEFUR með og tvítelur því vefinn.
--
--   api.get_customer_products_v1(p_customer_id, p_days_back, p_limit)
--       Vörulistinn. Kemur í stað generate_shopping_list_v2, sem hunsaði
--       p_days_back (sjá þá skrá). Hér virkar tímabilið; null = öll saga.
--       Allar rásir (VEFUR með): listinn á að sýna hvað fyrirtækið kaupir.
--       Auk talna: síðast keypt, síðasta einingaverð, hvort varan er á vef
--       (raw.web_catalog) og `lapsed` — keypt reglulega en ekki lengur.
--
--   api.get_customer_touch_history_v1(p_customer_id)
--       Snertisagan úr raw.customer_priority_flags_history (til síðan
--       2026-10-08) + núverandi flaggröð. Áður sást aðeins síðasta snerting.
--
-- Keyra í Supabase SQL-ritlinum. Endurkeyranlegt (create or replace).
-- Prófanir neðst.
-- ============================================================================


-- ── 1. LEIT ─────────────────────────────────────────────────────────
create or replace function api.search_customers_v1(
  p_q     text,
  p_limit integer default 25
)
returns table (
  customer_id    text,
  customer_name  text,
  webshop_active boolean,
  lhfs_label     text,
  match_kind     text,     -- 'name' | 'kt' | 'sku'
  match_note     text      -- t.d. „Keypti 104886 · síðast 2026-10-02“
)
language plpgsql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
declare
  v_q      text := btrim(coalesce(p_q, ''));
  v_digits text := regexp_replace(v_q, '\D', '', 'g');
  v_lim    integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  if length(v_q) < 2 then
    return;
  end if;

  -- Tölustafir einir (bandstrik og bil leyfð): kennitala eða vörunúmer.
  if v_q ~ '^[0-9 -]+$' and length(v_digits) >= 3 then
    return query
    with by_kt as (
      select p.customer_id, p.customer_name, p.webshop_active, p.lhfs_label,
             'kt'::text as match_kind, null::text as match_note,
             0 as rank_group, coalesce(p.orders_bc_365d, 0) as rank_val
      from api.mv_customer_profiles_labeled_trends p
      where regexp_replace(p.customer_id, '\D', '', 'g') like v_digits || '%'
    ),
    sku_buyers as (
      select trim(i.company_id) as customer_id,
             max(coalesce(i.order_date, i.booking_date)::date) as last_d,
             count(distinct l.document_no) as n
      from raw.bc_lines_raw l
      join raw.bc_invoices_raw i on i.document_no = l.document_no
      where trim(l.sku) = v_digits
        and i.company_id is not null and trim(i.company_id) <> ''
      group by 1
    ),
    by_sku as (
      select b.customer_id,
             coalesce(p.customer_name, b.customer_id) as customer_name,
             p.webshop_active, p.lhfs_label,
             'sku'::text as match_kind,
             'Keypti ' || v_digits || ' · ' || b.n || '× · síðast ' || to_char(b.last_d, 'YYYY-MM-DD') as match_note,
             1 as rank_group, (current_date - b.last_d) * -1 as rank_val
      from sku_buyers b
      left join api.mv_customer_profiles_labeled_trends p on p.customer_id = b.customer_id
    )
    select x.customer_id, x.customer_name, x.webshop_active, x.lhfs_label, x.match_kind, x.match_note
    from (select * from by_kt union all select * from by_sku) x
    order by x.rank_group, x.rank_val desc, x.customer_name
    limit v_lim;
    return;
  end if;

  -- Annars nafn. Byrjar-á fyrst, svo inniheldur; virkustu efst.
  return query
  select p.customer_id, p.customer_name, p.webshop_active, p.lhfs_label,
         'name'::text, null::text
  from api.mv_customer_profiles_labeled_trends p
  where p.customer_name ilike '%' || v_q || '%'
  order by (p.customer_name ilike v_q || '%') desc,
           coalesce(p.orders_bc_365d, 0) + coalesce(p.orders_web_365d, 0) desc,
           p.customer_name
  limit v_lim;
end;
$function$;


-- ── 2. LYKILTÖLUR PRÓFÍLS ───────────────────────────────────────────
create or replace function api.get_customer_card_v1(p_customer_id text)
returns jsonb
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
with fam as (
  select trim(f.customer_id) as cid,
         regexp_replace(trim(f.customer_id), '\D', '', 'g') as cnorm
  from api.resolve_customer_family_ids(p_customer_id) f
  where trim(coalesce(f.customer_id, '')) <> ''
),
offline as (
  select i.document_no as oid, coalesce(i.order_date, i.booking_date)::date as d
  from raw.bc_invoices_raw i
  where trim(i.company_id) in (select cid from fam)
    and upper(trim(coalesce(i.salesperson_code, ''))) <> 'VEFUR'
    and coalesce(i.order_date, i.booking_date) is not null
),
web as (
  select n.order_id::text as oid, n.purchase_date::date as d
  from raw.newweb_orders_raw n
  where regexp_replace(trim(coalesce(n.company_id, '')), '\D', '', 'g')
        in (select cnorm from fam where cnorm <> '')
    and n.purchase_date is not null
),
o as (
  select count(distinct oid) filter (where d >= current_date - 365) as n365,
         max(d) as last_d,
         count(distinct d) filter (where d >= current_date - 365) as days365,
         min(d) filter (where d >= current_date - 365) as first365
  from offline
),
w as (
  select count(distinct oid) filter (where d >= current_date - 365) as n365,
         max(d) as last_d,
         count(distinct d) filter (where d >= current_date - 365) as days365,
         min(d) filter (where d >= current_date - 365) as first365
  from web
),
prof as (
  select p.customer_id, p.customer_name, p.webshop_active, p.low_hanging_fruit_score,
         p.lhfs_label, p.recommended_action, p.primary_category
  from api.mv_customer_profiles_labeled_trends p
  where p.customer_id in (select cid from fam)
  order by (p.customer_id = trim(p_customer_id)) desc,
           p.low_hanging_fruit_score desc nulls last
  limit 1
)
select jsonb_build_object(
  'customer_id',        trim(p_customer_id),
  'family_ids',         (select coalesce(jsonb_agg(cid order by cid), '[]'::jsonb) from fam),
  'customer_name',      (select customer_name from prof),
  'webshop_active',     coalesce((select webshop_active from prof), (select n365 from w) > 0),
  'lhfs',               (select low_hanging_fruit_score from prof),
  'lhfs_label',         (select lhfs_label from prof),
  'recommended_action', (select recommended_action from prof),
  'primary_category',   (select primary_category from prof),
  'offline_orders_365d', (select n365 from o),
  'web_orders_365d',     (select n365 from w),
  'last_offline_order',  (select last_d from o),
  'last_web_order',      (select last_d from w),
  -- Pöntunarbil = meðalbil milli pöntunardaga síðustu 365 d, aðeins með 3+
  -- dögum (sama regla og mart.v_klaviyo_profiles_v1).
  'offline_interval_days', (select case when days365 >= 3
                                   then round((last_d - first365)::numeric / (days365 - 1), 1) end from o),
  'web_interval_days',     (select case when days365 >= 3
                                   then round((last_d - first365)::numeric / (days365 - 1), 1) end from w)
);
$function$;


-- ── 3. VÖRULISTI ────────────────────────────────────────────────────
create or replace function api.get_customer_products_v1(
  p_customer_id text,
  p_days_back   integer default 365,   -- null = öll saga
  p_limit       integer default 300
)
returns table (
  sku             text,
  product_name    text,
  category        text,
  order_count     bigint,
  total_qty       numeric,
  uom             text,
  first_bought    date,
  last_bought     date,
  avg_gap_days    numeric,
  last_unit_price numeric,
  on_web          boolean,
  web_url         text,
  lapsed          boolean
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
with fam as (
  select trim(f.customer_id) as cid
  from api.resolve_customer_family_ids(p_customer_id) f
  where trim(coalesce(f.customer_id, '')) <> ''
),
lines as (
  select trim(l.sku) as sku,
         nullif(trim(l.product_name), '') as product_name,
         l.document_no,
         coalesce(i.order_date, i.booking_date)::date as d,
         coalesce(l.qty, 0)::numeric as qty,
         nullif(trim(l.uom), '') as uom,
         l.unit_price_excl::numeric as unit_price
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  where trim(i.company_id) in (select cid from fam)
    and l.sku is not null and trim(l.sku) <> ''
    and coalesce(i.order_date, i.booking_date) is not null
    and (p_days_back is null
         or coalesce(i.order_date, i.booking_date)::date >= current_date - p_days_back)
),
days as (
  select sku, d, lag(d) over (partition by sku order by d) as prev_d
  from (select distinct sku, d from lines) x
),
gaps as (
  select sku, avg(d - prev_d)::numeric as avg_gap
  from days where prev_d is not null
  group by sku
),
agg as (
  select sku,
         max(product_name) as product_name,
         count(distinct document_no) as order_count,
         sum(qty) as total_qty,
         mode() within group (order by uom) as uom,
         min(d) as first_bought,
         max(d) as last_bought,
         (array_agg(unit_price order by d desc) filter (where unit_price is not null))[1] as last_unit_price
  from lines
  group by sku
),
web as (
  select distinct on (w.sku) w.sku, w.slug
  from raw.web_catalog w
  order by w.sku, w.web_sku
)
select a.sku,
       coalesce(a.product_name, a.sku),
       coalesce(nullif(p.level1, ''),
                nullif(split_part(coalesce(p.category_path, ''), ' / ', 1), '')),
       a.order_count,
       round(a.total_qty, 2),
       a.uom,
       a.first_bought,
       a.last_bought,
       round(g.avg_gap, 1),
       round(a.last_unit_price, 2),
       (w.sku is not null),
       case when w.slug is not null then 'https://www.storkaup.is/vara/' || w.slug end,
       -- Keypt reglulega (3+ pantanir) en síðustu kaup eldri en tvöfalt
       -- meðalbil, og minnst 45 dagar. „Hættur að kaupa“ í viðmótinu.
       (a.order_count >= 3
        and current_date - a.last_bought > greatest(45, 2 * coalesce(g.avg_gap, 0)))
from agg a
left join gaps g on g.sku = a.sku
left join raw.products_raw p on p.sku = a.sku
left join web w on w.sku = a.sku
order by a.order_count desc, a.last_bought desc, a.sku
limit least(greatest(coalesce(p_limit, 300), 1), 1000);
$function$;


-- ── 4. SNERTISAGA ───────────────────────────────────────────────────
create or replace function api.get_customer_touch_history_v1(p_customer_id text)
returns table (
  event_at  timestamptz,
  kind      text,     -- 'touch' | 'status' | 'rep' | 'removed' | 'created'
  note_text text,
  by_name   text,
  followup  date
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
with k as (
  -- Sami lykill og set_customer_priority_flag býr til.
  select case when regexp_replace(trim(coalesce(p_customer_id, '')), '\D', '', 'g') <> ''
              then regexp_replace(trim(coalesce(p_customer_id, '')), '\D', '', 'g')
              else lower(trim(coalesce(p_customer_id, ''))) end as key
),
h as (
  -- actor_name (síðan 2026-10-15) er innskráður starfsmaður sem gerði
  -- breytinguna. updated_by er „síðast snert af“ og hreyfist aðeins við
  -- snertingu, svo það má ALDREI eigna forgangs- eða sölumannabreytingu:
  -- þá stæði síðasti snertir við annarra manna verk. Eldri línur án
  -- actor_name sýna þar engan, sem er satt.
  select hh.changed_at, hh.op, hh.old_row, hh.new_row, hh.actor_name
  from raw.customer_priority_flags_history hh, k
  where hh.customer_family_id = k.key
),
ev as (
  -- Snerting: last_contacted_at hreyfðist. Athugasemd aðeins ef hún breyttist,
  -- annars væri gamla textanum endurtekið á hverja snertingu.
  select (new_row ->> 'last_contacted_at')::timestamptz as ev_at, 'touch'::text as ev_kind,
         case when (new_row ->> 'note') is distinct from (old_row ->> 'note')
              then new_row ->> 'note' end as ev_text,
         coalesce(actor_name, new_row ->> 'updated_by') as ev_by,
         (new_row ->> 'next_followup_at')::date as ev_followup
  from h
  where op = 'UPDATE'
    and (new_row ->> 'last_contacted_at') is distinct from (old_row ->> 'last_contacted_at')
    and (new_row ->> 'last_contacted_at') is not null
  union all
  select changed_at, 'status',
         case when new_row ->> 'status' = 'priority' then 'Sett í forgang'
              else 'Tekinn úr forgangi' end
         || coalesce(': ' || case when (new_row ->> 'note') is distinct from (old_row ->> 'note')
                                  then new_row ->> 'note' end, ''),
         actor_name, null
  from h
  where op = 'UPDATE' and (new_row ->> 'status') is distinct from (old_row ->> 'status')
  union all
  select changed_at, 'rep',
         case when nullif(new_row ->> 'assigned_rep_name_norm', '') is null then 'Sölumaður fjarlægður'
              else 'Sölumaður: ' || (new_row ->> 'assigned_rep_name_norm') end,
         actor_name, null
  from h
  where op = 'UPDATE'
    and (new_row ->> 'assigned_rep_name_norm') is distinct from (old_row ->> 'assigned_rep_name_norm')
  union all
  select changed_at, 'removed', 'Fjarlægður af lista', actor_name, null
  from h where op = 'DELETE'
  union all
  -- Núverandi röð: hvenær flaggað, og síðasta snerting ef hún er eldri en
  -- sagan (snertingar fyrir 2026-10-08 eru aðeins til hér).
  select f.created_at, 'created',
         case when f.status = 'priority' then 'Sett í forgang' else 'Merkt: ekki forgangur' end,
         null, null
  from raw.customer_priority_flags_raw f, k
  where f.customer_family_id = k.key
  union all
  select f.last_contacted_at, 'touch', f.note, f.updated_by, f.next_followup_at
  from raw.customer_priority_flags_raw f, k
  where f.customer_family_id = k.key
    and f.last_contacted_at is not null
    and not exists (select 1 from h
                    where (h.new_row ->> 'last_contacted_at')::timestamptz = f.last_contacted_at)
)
select ev_at, ev_kind, ev_text, ev_by, ev_followup
from ev
where ev_at is not null
order by ev_at desc
limit 100;
$function$;


-- ── 5. NÖFN + HVER PANTAR FYRIR ÞÁ (bætt við 2026-10-15) ────────────
-- Fyrir lista af viðskiptavinum (vinnulistinn: ~80) og prófílinn (einn):
--   customer_name   flaggröðin ber oft ekkert nafn; MV → BC-viðskiptamenn →
--                   nýjasti BC-reikningur
--   offline_rep     algengasti sölumaður á pöntunum UTAN VEFS síðustu 365 d.
--                   BC ber kóða (salesperson_code). Hann er tengdur manneskju
--                   þar sem kóðinn = fyrri hluti netfangs (HB ↔ hb@storkaup.is),
--                   fyrst úr kpi_staff_access, svo sales_reps_ref. Annars
--                   stendur kóðinn sjálfur — betra en ekkert, og satt.
--   web_rep         sölumaður sem slær inn VEFPANTANIR fyrir þá: nafn
--                   pöntunarinnar = sölumannsreikningur (sama regla og
--                   is_rep_order í customer_priority_flags.sql, nafnhlutinn
--                   eingöngu — netfangshlutinn ruglar viðskiptavinum saman,
--                   sjá _measure_rep_email_misclass.sql).
-- BC-sölumannskóðar sem tengjast ENGU netfangi (mælt 2026-10-15: EJ 4.592
-- reikningar/365 d, HH 3.964, BTI 2.073, BB 1.264 …). Kóði = upphafsstafir,
-- netfang = oft önnur stytting, svo regla nær þeim ekki. Handvörpun hér
-- gengur fyrir öllu. rep_name_norm fyrir sölumenn (solumadur*-form),
-- display_name fyrir aðra (t.d. þjónustuver).
create table if not exists raw.bc_salesperson_map (
  code          text primary key check (code = upper(btrim(code))),
  rep_name_norm text null,
  display_name  text null,
  note          text null,
  updated_at    timestamptz not null default now()
);
-- HLUTVERK (2026-10-15). Afgreiðslan (EJ, HH) slær inn pantanir sem
-- viðskiptavinurinn leggur SJÁLFUR fram í síma/pósti/við borð. Hún „á“ því
-- ekki viðskiptavininn og má ekki teljast sölumaður hans — og slíkur
-- viðskiptavinur er einmitt besti vefframbjóðandinn: hann pantar þegar sjálfur.
--   solumadur   tengdur sölumaður (sjálfgefið ef rep_name_norm er sett)
--   afgreidsla  slær inn pantanir viðskiptavina
--   verkstaedi  verkstæðið
--   annad       annað starfsfólk / hætt
alter table raw.bc_salesperson_map
  add column if not exists role text null
    check (role is null or role in ('solumadur', 'afgreidsla', 'verkstaedi', 'annad'));
update raw.bc_salesperson_map set role = 'solumadur'  where role is null and nullif(btrim(rep_name_norm), '') is not null;
update raw.bc_salesperson_map set role = 'afgreidsla' where code in ('EJ', 'HH');
update raw.bc_salesperson_map set role = 'verkstaedi' where code in ('HÖL', 'HÖG');
update raw.bc_salesperson_map set role = 'annad'      where role is null;

alter table raw.bc_salesperson_map enable row level security;
revoke all on table raw.bc_salesperson_map from public, anon, authenticated;
grant all privileges on table raw.bc_salesperson_map to service_role;

-- Skilagerðin breyttist (desk_orders, offline_orders): drop fyrst. Aðeins
-- Webflow/vidskiptavinir.js kallar á fallið, svo það er hættulaust.
drop function if exists api.get_customer_reps_v1(text[]);
create function api.get_customer_reps_v1(p_customer_ids text[])
returns table (
  customer_id        text,
  customer_name      text,
  offline_rep_code   text,     -- algengasti SÖLUMAÐUR utan vefs (ekki afgreiðsla)
  offline_rep        text,
  offline_rep_orders bigint,
  desk_orders        bigint,   -- pantanir slegnar inn í afgreiðslu, 365 d
  offline_orders     bigint,   -- allar pantanir utan vefs, 365 d
  web_rep            text,
  web_rep_orders     bigint
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
with ids as (
  select distinct trim(x) as customer_id,
         regexp_replace(trim(x), '\D', '', 'g') as norm
  from unnest(coalesce(p_customer_ids, '{}'::text[])) x
  where btrim(coalesce(x, '')) <> ''
  limit 2000
),
reps as (
  select r.name_norm,
         lower(btrim(r.email_norm)) as email_norm,
         regexp_replace(regexp_replace(lower(r.name_norm), 'solumadur|storkaup', '', 'g'), '[^a-z0-9]', '', 'g') as person_key
  from raw.sales_reps_ref r
  where coalesce(r.active, true) and btrim(coalesce(r.name_norm, '')) <> ''
),
code_map as (
  select distinct on (code) code, name_norm, role
  from (
    select m.code, coalesce(nullif(btrim(m.rep_name_norm), ''), nullif(btrim(m.display_name), '')) as name_norm,
           coalesce(m.role, case when nullif(btrim(m.rep_name_norm), '') is not null then 'solumadur' else 'annad' end) as role,
           -1 as pri
    from raw.bc_salesperson_map m
    union all
    select upper(split_part(s.email, '@', 1)) as code,
           coalesce(nullif(btrim(s.rep_name_norm), ''),
                    (select r.name_norm from reps r
                     where r.email_norm = s.email and r.person_key not in ('', 'vefur')
                     order by (r.name_norm like 'solumadur%') desc limit 1)) as name_norm,
           'solumadur', 0 as pri
    from raw.kpi_staff_access s
    union all
    select upper(split_part(r.email_norm, '@', 1)), r.name_norm, 'solumadur', 1
    from reps r
    where r.email_norm like '%@storkaup.is' and r.person_key not in ('', 'vefur')
  ) z
  where name_norm is not null and code <> ''
  order by code, pri, (name_norm like 'solumadur%') desc
),
off as (
  select ids.customer_id,
         upper(btrim(i.salesperson_code)) as code,
         count(distinct i.document_no) as n,
         max(coalesce(i.order_date, i.booking_date)) as last_d
  from ids
  join raw.bc_invoices_raw i
    on regexp_replace(btrim(coalesce(i.company_id, '')), '\D', '', 'g') = ids.norm
  where ids.norm <> ''
    and coalesce(i.order_date, i.booking_date) >= current_date - 365
    and upper(btrim(coalesce(i.salesperson_code, ''))) not in ('', 'VEFUR')
  group by 1, 2
),
-- Óþekktur kóði (ekki í neinni vörpun) telst sölumaður: betra að sýna
-- kóðann en að fela hann.
off_role as (
  select o.*, coalesce(cm.role, 'solumadur') as role
  from off o left join code_map cm on cm.code = o.code
),
off_top as (
  select distinct on (customer_id) customer_id, code, n
  from off_role
  where role = 'solumadur'
  order by customer_id, n desc, last_d desc
),
off_sum as (
  select customer_id,
         sum(n) filter (where role = 'afgreidsla') as desk_n,
         sum(n) as all_n
  from off_role
  group by 1
),
web as (
  select ids.customer_id, r.name_norm, count(*) as n
  from ids
  join raw.newweb_orders_raw o
    on regexp_replace(coalesce(o.company_id, ''), '\D', '', 'g') = ids.norm
  join reps r
    on r.name_norm = regexp_replace(lower(translate(coalesce(o.customer_name, ''),
                       'áðþæöéíóúýÁÐÞÆÖÉÍÓÚÝ', 'adthaeoeiouyadthaeoeiouy')), '[^a-z0-9]+', '', 'g')
  where ids.norm <> ''
    and o.purchase_date >= current_date - 365
    and r.person_key not in ('', 'vefur')
  group by 1, 2
),
web_top as (
  select distinct on (customer_id) customer_id, name_norm, n
  from web
  order by customer_id, n desc
)
select ids.customer_id,
       coalesce(
         (select p.customer_name from api.mv_customer_profiles_labeled_trends p
          where p.customer_id = ids.customer_id limit 1),
         (select nullif(btrim(c.company_name), '') from raw.bc_customers_raw c
          where btrim(c.company_id) = ids.customer_id limit 1),
         (select nullif(btrim(i.company_name), '') from raw.bc_invoices_raw i
          where btrim(i.company_id) = ids.customer_id
          order by coalesce(i.order_date, i.booking_date) desc nulls last limit 1)
       ),
       o.code,
       cm.name_norm,
       o.n,
       coalesce(os.desk_n, 0)::bigint,
       coalesce(os.all_n, 0)::bigint,
       w.name_norm,
       w.n
from ids
left join off_top o   on o.customer_id = ids.customer_id
left join code_map cm on cm.code = o.code
left join off_sum os  on os.customer_id = ids.customer_id
left join web_top w   on w.customer_id = ids.customer_id;
$function$;

-- Hvaða BC-kóðar eru til og hverjir tengjast manneskju? (les aðeins)
--   select upper(btrim(salesperson_code)) as code, count(*) as reikningar_365d
--   from raw.bc_invoices_raw
--   where coalesce(order_date, booking_date) >= current_date - 365
--   group by 1 order by 2 desc;
--
-- Handvörpun (fyllið út þá sem þið þekkið; óþekktir sýna kóðann sjálfan):
--   insert into raw.bc_salesperson_map (code, rep_name_norm, display_name, note) values
--     ('EJ',  null, '<Nafn>', ''),
--     ('HH',  null, '<Nafn>', ''),
--     ('BTI', 'solumadurbjossi', null, 'Þorbjörn?'),
--     ('BB',  null, '<Nafn>', '')
--   on conflict (code) do update set rep_name_norm = excluded.rep_name_norm,
--     display_name = excluded.display_name, note = excluded.note, updated_at = now();


-- ── RÉTTINDI ────────────────────────────────────────────────────────
revoke all on function api.get_customer_reps_v1(text[])                   from public, anon;
grant execute on function api.get_customer_reps_v1(text[])                   to authenticated, service_role;
revoke all on function api.search_customers_v1(text, integer)            from public, anon;
revoke all on function api.get_customer_card_v1(text)                     from public, anon;
revoke all on function api.get_customer_products_v1(text, integer, integer) from public, anon;
revoke all on function api.get_customer_touch_history_v1(text)            from public, anon;
grant execute on function api.search_customers_v1(text, integer)            to authenticated, service_role;
grant execute on function api.get_customer_card_v1(text)                     to authenticated, service_role;
grant execute on function api.get_customer_products_v1(text, integer, integer) to authenticated, service_role;
grant execute on function api.get_customer_touch_history_v1(text)            to authenticated, service_role;

notify pgrst, 'reload schema';


-- ── PRÓFANIR ────────────────────────────────────────────────────────
-- select * from api.search_customers_v1('landsp');
-- select * from api.search_customers_v1('104886');        -- vörunúmer
-- select api.get_customer_card_v1('7108902269');
-- select * from api.get_customer_products_v1('7108902269', 365, 20);
-- select * from api.get_customer_products_v1('7108902269', null, 20);  -- öll saga
-- select * from api.get_customer_touch_history_v1('<kt á flaggaðan viðskiptavin>');
