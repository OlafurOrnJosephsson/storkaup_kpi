-- ============================================================================
-- public.product_sales_activity_v1 — sölusaga fyrir lista af SKU (2026-10-01)
--
-- TILGANGUR: vöruvöktunin (core/storkaup_pricing.js) finnur vörur sem vefurinn
-- merkir "Vara væntanleg" — staða <= 0 í BC og ekki sérpöntun. Margar þeirra
-- ættu í raun að vera sérpöntun. Þetta fall gefur sölusöguna sem þarf til að
-- greina á milli: vara sem seldist í síðustu viku er raunverulega væntanleg;
-- vara sem hefur ekki selst í ár er nánast örugglega sérpöntun.
--
-- AÐEINS SÖLUGÖGN. Supabase hefur engin innkaupagögn úr BC, svo "er opin
-- innkaupapöntun?" er ekki hægt að svara hér.
--
-- SKU-SAMSVÖRUN eins og get_product_drawer_v3.sql: parent-SKU + þekkt
-- sölueiningarviðskeyti + web_sku úr raw.web_catalog. Jafnaðarleit á
-- l.sku = any(...) nær idx_bc_lines_sku; regexp á l.sku gerir það ekki.
--
-- AÐGANGUR: aðeins service_role (GAS). Ekki anon — skilar sölutölum.
-- ============================================================================

create or replace function public.product_sales_activity_v1(
  p_skus text[]
) returns table (
  sku              text,
  last_sale        date,
  invoices_12m     bigint,
  customers_12m    bigint,
  invoices_all     bigint
)
language sql stable security definer
set search_path = public, raw
as $$
  with parents as (
    select distinct btrim(p) as parent
    from unnest(coalesce(p_skus, array[]::text[])) as p
    where btrim(coalesce(p, '')) <> ''
  ),
  cand as (
    select pa.parent, c.line_sku
    from parents pa
    cross join lateral (
      select distinct s as line_sku
      from unnest(
        array[pa.parent,
              pa.parent || '_STK',
              pa.parent || '_KASSI',
              pa.parent || '_BRETTI',
              pa.parent || '_PK',
              pa.parent || '_PAKKI']
        || coalesce((
             select array_agg(regexp_replace(w.web_sku, '^STO[_]', ''))
             from raw.web_catalog w
             where w.sku = pa.parent
           ), array[]::text[])
      ) as s
      where s <> ''
    ) c
  ),
  hits as (
    select
      cand.parent,
      l.document_no,
      i.company_id,
      coalesce(i.booking_date, i.order_date)::date as d
    from cand
    join raw.bc_lines_raw l    on l.sku = cand.line_sku
    join raw.bc_invoices_raw i on i.document_no = l.document_no
  )
  select
    pa.parent::text                                                       as sku,
    max(h.d)                                                              as last_sale,
    count(distinct h.document_no) filter (where h.d >= current_date - 365) as invoices_12m,
    count(distinct h.company_id)  filter (where h.d >= current_date - 365) as customers_12m,
    count(distinct h.document_no)                                         as invoices_all
  from parents pa
  left join hits h on h.parent = pa.parent
  group by pa.parent;
$$;

revoke all on function public.product_sales_activity_v1(text[]) from public, anon, authenticated;
grant execute on function public.product_sales_activity_v1(text[]) to service_role;

notify pgrst, 'reload schema';

-- Prófun (service_role / SQL-ritill):
--   select * from public.product_sales_activity_v1(array['106268','135063','107768']);
