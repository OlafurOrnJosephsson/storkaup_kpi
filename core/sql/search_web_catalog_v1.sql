-- public.search_web_catalog_v1 — leitarreiturinn í vöruportalinum
--
-- ── HVERS VEGNA EKKI search_products ────────────────────────────────
-- Portalinn notaði fyrst `search_products`, og hún féll á
-- statement_timeout við innslátt (mælt í framleiðslu 2026-09-21:
-- „canceling statement due to statement timeout" á þremur lyklaslögum
-- í röð).
--
-- Það var ekki tilviljun heldur rangt tól. `search_products` leitar í
-- SÖLUGÖGNUM: hún skannar `bc_lines_raw` joinað við `bc_invoices_raw`
-- yfir 365 daga, ~485 þúsund línur, við hvert kall. Hún var alltaf á
-- mörkum 8 sekúndna þaksins og lyklaborðsleit gefur henni ekkert svigrúm.
--
-- Leitarreitur í vöruportali á að finna VÖRU. Vörulistinn er 4.474 raðir
-- og hann er allur hérna megin. Þessi leit snertir `bc_lines_raw` aldrei
-- og getur því ekki fallið á tíma.
--
-- Skiptingin er líka réttari: /kpi/top-products leitar í sölu og á að
-- gera það áfram — þar byrjar þú á „hvað seldist" og endar á vöru.
-- Portalinn byrjar á vöru. Tvær spurningar, tvö föll.
--
-- ── AUÐKENNI FYRST, EINS OG ANNARS STAÐAR ───────────────────────────
-- Nákvæmt treff á SKU eða birgjanúmeri raðast efst, svo hlutstrengur á
-- auðkenni, svo heitaleit. Sama regla og í search_products_v2, og af
-- sömu ástæðu: uppfletting á að gefa rétta svarið efst, ekki það
-- söluhæsta.
--
-- Skilar EINNI röð á hvert `sku` þótt varan sé til í tveimur
-- sölueiningum — `web_sku` listinn sýnir þær. Annars birtist sama varan
-- tvisvar í fellilistanum og notandinn heldur að hún sé tvær vörur.

drop function if exists public.search_web_catalog_v1(text, int);

create or replace function public.search_web_catalog_v1(
  p_query text,
  p_limit int default 20
) returns table (
  sku          text,
  web_skus     text,
  product_name text,
  brand_name   text,
  brand_sku    text,
  match_kind   text
)
language sql stable security definer
set search_path = public, raw
as $$
  with q as (
    select
      case when p_query is null or length(btrim(p_query)) < 2 then null
           else '%' || btrim(p_query) || '%' end as pat,
      case when p_query is null or length(btrim(p_query)) < 2 then null
           else public.norm_ident_(p_query) end  as ident
  ),
  hits as (
    select
      c.sku,
      string_agg(distinct c.web_sku, ', ' order by c.web_sku) as web_skus,
      min(c.product_name)                                     as product_name,
      min(c.brand_name)                                       as brand_name,
      min(c.brand_sku)                                        as brand_sku,
      -- Lægst vinnur. Sjá „auðkenni fyrst" að ofan.
      min(case
            when public.norm_ident_(c.brand_sku) = q.ident then 0
            when public.norm_ident_(c.sku)       = q.ident then 0
            when c.sku       ilike q.pat                   then 1
            when c.brand_sku ilike q.pat                   then 1
            else 2
          end) as rank,
      min(case
            when public.norm_ident_(c.brand_sku) = q.ident then 'birgjanúmer'
            when public.norm_ident_(c.sku)       = q.ident then 'sku'
            when c.sku ilike q.pat or c.brand_sku ilike q.pat then 'auðkenni'
            else 'heiti'
          end) as match_kind
    from raw.web_catalog c
    cross join q
    where q.pat is not null
      and (
        c.sku          ilike q.pat or
        c.brand_sku    ilike q.pat or
        c.product_name ilike q.pat or
        public.norm_ident_(c.sku)       = q.ident or
        public.norm_ident_(c.brand_sku) = q.ident
      )
    group by c.sku
  )
  select h.sku::text, h.web_skus::text, h.product_name::text,
         h.brand_name::text, h.brand_sku::text, h.match_kind::text
  from hits h
  order by h.rank, h.product_name
  limit p_limit;
$$;

grant execute on function public.search_web_catalog_v1(text, int) to anon, authenticated;
