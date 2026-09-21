-- public.get_product_buyers / get_product_transactions
-- Modalinn á /kpi/top-products — og pallarnir sem vöruportalinn erfir.
--
-- ── VILLAN ──────────────────────────────────────────────────────────
-- Báðar útgáfurnar sía svona:
--
--   where regexp_replace(l.sku, '_[A-Za-z0-9]+$', '') = p_sku
--
-- Það reiknar regex á HVERJA RÖÐ í bc_lines_raw og engin vísitala getur
-- hjálpað. Mælt í framleiðslu 2026-09-21: modalinn skilaði „Villa við að
-- sækja gögn" og Network sýndi HTTP 500 frá get_product_buyers.
--
-- Þetta er NÁKVÆMLEGA sama villa og felldi search_products fyrr sama dag,
-- og sama einkenni: gengur í SQL-ritlinum, fellur hjá anon á 8 sekúndna
-- statement_timeout. Ritillinn hefur ekkert þak, svo hún sést ekki þar.
--
-- Villan er líklega ekki ný. Fram til 2026-09-21 stóð modalinn opinn og
-- tómur við hverja innhleðslu (sjá 2d50477), svo enginn smellti á vöru og
-- enginn sá að gagnasóknin undir virkaði ekki. Lagfæringin á modalnum
-- afhjúpaði hana; hún olli henni ekki.
--
-- ── LAGFÆRINGIN ─────────────────────────────────────────────────────
-- Sama lögun og í search_products_v2.sql: bera saman STRENGI í stað þess
-- að umrita hverja röð.
--
--   l.sku = p_sku  or  l.sku like p_sku || '\_%'
--
-- Fyrri greinin tekur vörur án sölueiningarviðskeytis, sú seinni allar
-- með. Forskeytisleit er vísitöluvæn þar sem regex er það aldrei, og hún
-- er víðari en gamla regexið en ekki þrengri — `_[A-Za-z0-9]+$` tók
-- aðeins síðasta lið, LIKE tekur hvað sem á eftir kemur. Það finnur
-- fleiri raðir, aldrei færri, svo lagfæringin getur ekki falið sölu.
--
-- `p_sku` kemur úr normalizeSkuForLookup í Webflow/top-products.js, sem
-- sker viðskeytið en EKKI forleiðandi núll. Það er rétt: BC heldur þeim,
-- og hér er tengilykill en ekki fyrirspurnarlykill. Sjá „TVEIR LYKLAR"
-- í core/sql/search_products_v2.sql.
--
-- % og _ eru varin í mynstrinu. SKU eru tölustafir í raun, svo það er
-- belti og axlabönd — en LIKE-mynstur sem er byggt úr gildi og ekki
-- varið er gildra sem kostar ekkert að loka.

create or replace function public.get_product_buyers(
  p_sku       text,
  p_days_back int default 365
) returns table (
  customer_no   text,
  customer_name text,
  orders        bigint,
  qty_total     numeric,
  revenue_excl  numeric
)
language sql stable security definer
set search_path = public, raw
as $$
  with k as (
    select btrim(coalesce(p_sku, '')) as sku,
           replace(replace(replace(btrim(coalesce(p_sku, '')),
                   '\', '\\'), '%', '\%'), '_', '\_') as pat
  )
  select
    i.company_id::text                                                  as customer_no,
    max(coalesce(nullif(trim(i.company_name), ''), i.company_id))::text as customer_name,
    count(distinct l.document_no)::bigint                               as orders,
    sum(l.qty)::numeric                                                 as qty_total,
    sum(l.amount_excl)::numeric                                         as revenue_excl
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  cross join k
  where k.sku <> ''
    and (l.sku = k.sku or l.sku like k.pat || '\_%')
    and coalesce(i.booking_date, i.order_date) >= current_date - p_days_back
  group by i.company_id
  order by revenue_excl desc nulls last
  limit 100;
$$;

grant execute on function public.get_product_buyers(text, int) to anon, authenticated;


create or replace function public.get_product_transactions(
  p_sku       text,
  p_days_back int default 90,
  p_limit     int default 100
) returns table (
  booking_date  date,
  document_no   text,
  customer_name text,
  qty           numeric,
  amount_excl   numeric
)
language sql stable security definer
set search_path = public, raw
as $$
  with k as (
    select btrim(coalesce(p_sku, '')) as sku,
           replace(replace(replace(btrim(coalesce(p_sku, '')),
                   '\', '\\'), '%', '\%'), '_', '\_') as pat
  )
  select
    coalesce(i.booking_date, i.order_date)                           as booking_date,
    l.document_no::text,
    coalesce(nullif(trim(i.company_name), ''), i.company_id)::text   as customer_name,
    l.qty::numeric,
    l.amount_excl::numeric
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  cross join k
  where k.sku <> ''
    and (l.sku = k.sku or l.sku like k.pat || '\_%')
    and coalesce(i.booking_date, i.order_date) >= current_date - p_days_back
  order by coalesce(i.booking_date, i.order_date) desc nulls last
  limit case when p_limit = 0 then null else p_limit end;
$$;

grant execute on function public.get_product_transactions(text, int, int) to anon, authenticated;

-- Skilagerðin er ÓBREYTT á báðum, svo PostgREST-skyndiminnid tharf ekki
-- ad endurhladast. Ef 500 heldur afram eftir thetta, keyrdu samt:
--   notify pgrst, 'reload schema';
