-- public.search_products — leitin á /kpi/top-products, nú með birgjanúmerum
--
-- Kallað úr Webflow/top-products.js (fetchSearchProducts). Krefst
-- core/sql/web_catalog_v1.sql fyrst; án þeirrar töflu er villa.
--
-- ── HVAÐ BREYTTIST ──────────────────────────────────────────────────
-- 1. Birgjanúmer virka í leitarreitnum. Að slá inn 7276 finnur
--    STO_114112 (WypAll þurrku) þótt sú tala komi hvergi fyrir í BC.
-- 2. Ný kólumna `brand_sku` í svarinu. Frontendið hunsar hana þar til
--    einhver bætir við [data-field="brand_sku"] — engin JS-breyting þarf.
-- 3. Fyrirspurn styttri en 2 stafir skilar engu. Áður gaf eins stafs
--    fyrirspurn ILIKE '%x%' yfir alla bc_lines_raw. Frontendið hindraði
--    það hvort eð er, en fallið er anon-grantað og átti ekki að treysta
--    á það.
--
-- ── HVAÐ BREYTTIST EKKI, OG HVERS VEGNA ─────────────────────────────
-- Vörur án sölu í glugganum koma AÐEINS með þegar fyrirspurnin hitti
-- AUÐKENNI (birgjanúmer eða sku), aldrei þegar hún hitti bara heiti.
-- Þetta er vísvitandi: annars myndi "salernispappír" allt í einu skila
-- hverri vöru í vörulistanum með núllum, og textaleitin sem er í notkun
-- núna fylltist af hávaða. Auðkennisleit er uppfletting — þar er „til á
-- vefnum, hefur ekki selst" rétta svarið. Heitaleit er sölugreining.
--
-- ATH: vara sem kemur úr vörulistanum án sölu fær orders=0, revenue=0 og
-- raðast neðst. Það er ekki sama og „engin sala nokkurn tíma" — það er
-- „engin sala í síðustu p_days_back dögum".
--
-- Síunin fyrir bc_lines_raw er vísvitandi FYRIR group by, eins og í
-- upphaflegu útgáfunni. Að hópa allan gluggann fyrst og sía svo fellur á
-- 8 sek anon statement_timeout á þessari töflu.

drop function if exists public.search_products(text, int, int);

create or replace function public.search_products(
  p_query     text,
  p_days_back int default 365,
  p_limit     int default 50
) returns table (
  sku          text,
  product_name text,
  orders       bigint,
  revenue_excl numeric,
  brand_sku    text
)
language sql stable security definer
set search_path = public, raw
as $$
  with q as (
    select case
             when p_query is null or length(btrim(p_query)) < 2 then null
             else '%' || btrim(p_query) || '%'
           end as pat
  ),
  -- Allur vörulistinn, einn á hvert normalíserað sku. Sama vara í tveimur
  -- sölueiningum á tvær raðir í web_catalog en má bara eiga eina hér.
  cat_all as (
    select c.sku,
           min(c.brand_sku)    as brand_sku,
           min(c.product_name) as product_name
    from raw.web_catalog c
    group by c.sku
  ),
  -- AUÐKENNIS-treff eingöngu — sjá hausinn. Heiti er ekki með hér.
  cat_hits as (
    select a.sku, a.brand_sku, a.product_name
    from cat_all a
    cross join q
    where q.pat is not null
      and (a.brand_sku ilike q.pat or a.sku ilike q.pat)
  ),
  sales as (
    select regexp_replace(l.sku, '_[A-Za-z0-9]+$', '') as sku,
           max(l.product_name)                          as product_name,
           count(distinct l.document_no)::bigint        as orders,
           sum(l.amount_excl)::numeric                  as revenue_excl
    from raw.bc_lines_raw l
    join raw.bc_invoices_raw i on i.document_no = l.document_no
    cross join q
    where q.pat is not null
      and (
        l.sku          ilike q.pat or
        l.product_name ilike q.pat or
        regexp_replace(l.sku, '_[A-Za-z0-9]+$', '') in (select ch.sku from cat_hits ch)
      )
      and coalesce(i.booking_date, i.order_date) >= current_date - p_days_back
    group by 1
  )
  select
    coalesce(s.sku, h.sku)                   as sku,
    coalesce(s.product_name, h.product_name) as product_name,
    coalesce(s.orders, 0)::bigint            as orders,
    coalesce(s.revenue_excl, 0)::numeric     as revenue_excl,
    a.brand_sku                              as brand_sku
  from sales s
  full outer join cat_hits h on h.sku = s.sku
  left join cat_all a on a.sku = coalesce(s.sku, h.sku)
  order by coalesce(s.revenue_excl, 0) desc nulls last, coalesce(s.sku, h.sku)
  limit p_limit;
$$;

grant execute on function public.search_products(text, int, int) to anon, authenticated;
