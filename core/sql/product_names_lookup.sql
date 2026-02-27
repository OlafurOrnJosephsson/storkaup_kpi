-- Canonical product-name lookup by SKU list (for Webflow top-products rendering).
-- Resolves suffix variants like *_KASSI / *_BRETTI and numeric SKU normalization.

create schema if not exists api;

create or replace function api.get_product_names_by_skus(
  p_skus text[]
)
returns table (
  input_sku text,
  canonical_sku text,
  product_name text
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
with in_skus as (
  select distinct
    trim(s) as input_sku,
    regexp_replace(trim(s), '[_][A-Za-z0-9]+$', '', 'g') as input_sku_base,
    regexp_replace(regexp_replace(trim(s), '[_][A-Za-z0-9]+$', '', 'g'), '[^0-9]', '', 'g') as input_sku_digits
  from unnest(coalesce(p_skus, array[]::text[])) as s
  where trim(coalesce(s, '')) <> ''
),
products as (
  select
    trim(coalesce(p.sku, '')) as canonical_sku,
    nullif(trim(coalesce(p.product_name, '')), '') as product_name,
    regexp_replace(trim(coalesce(p.sku, '')), '[_][A-Za-z0-9]+$', '', 'g') as sku_base,
    regexp_replace(regexp_replace(trim(coalesce(p.sku, '')), '[_][A-Za-z0-9]+$', '', 'g'), '[^0-9]', '', 'g') as sku_digits
  from raw.products_raw p
  where trim(coalesce(p.sku, '')) <> ''
),
matches as (
  select
    i.input_sku,
    p.canonical_sku,
    p.product_name,
    case
      when p.canonical_sku = i.input_sku then 1
      when p.sku_base = i.input_sku_base and i.input_sku_base <> '' then 2
      when p.sku_digits = i.input_sku_digits and i.input_sku_digits <> '' then 3
      else 99
    end as rank_key
  from in_skus i
  join products p
    on p.canonical_sku = i.input_sku
    or (i.input_sku_base <> '' and p.sku_base = i.input_sku_base)
    or (i.input_sku_digits <> '' and p.sku_digits = i.input_sku_digits)
),
ranked as (
  select
    m.*,
    row_number() over (
      partition by m.input_sku
      order by m.rank_key asc, length(coalesce(m.product_name, '')) desc, m.canonical_sku asc
    ) as rn
  from matches m
  where m.product_name is not null
)
select
  r.input_sku,
  r.canonical_sku,
  r.product_name
from ranked r
where r.rn = 1
order by r.input_sku;
$function$;

grant execute on function api.get_product_names_by_skus(text[]) to anon, authenticated, service_role;
