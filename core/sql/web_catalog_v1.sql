-- raw.web_catalog — birti vörulistinn á storkaup.is
--
-- Fyllt úr GAS: syncWebCatalogToSupabase_v1() í core/web_catalog.js,
-- keyrt úr scheduledCludoSync_v1 (á 12 tíma fresti).
--
-- TILGANGUR: leyfa /kpi-síðum að fletta upp á BIRGJANÚMERI. Vafrinn
-- kemst ekki í storkaup.is/api/graphql — svarið ber engan
-- Access-Control-Allow-Origin haus og preflight fær 400 frá CSRF-vörn
-- Apollo (mælt 2026-09-18) — svo gögnin verða að liggja hérna megin.
--
-- LYKLARNIR TVEIR:
--   web_sku  óbreytt úr GraphQL ("STO_117268_STK"). Frumlykill, einkvæmt.
--   sku      normalíserað í berja töluna ("117268"). TENGILYKILL við BC,
--            og VÍSVITANDI ekki einkvæmt: sama vara getur verið til í
--            tveimur sölueiningum (STO_9004599_STK og _KASSI, báðar í
--            birtingu). Þess vegna er frumlykillinn web_sku, ekki sku.
--
-- AÐGANGUR: engin bein lesheimild fyrir anon. Síðurnar lesa þetta
-- eingöngu gegnum public.search_products, sem er security definer.
-- Birgjanúmer eru hvort eð er opinber á storkaup.is sjálfu, en það er
-- ekki ástæða til að opna töfluna beint — sbr. SECURITY_REVIEW.md.

create table if not exists raw.web_catalog (
  web_sku      text primary key,
  sku          text not null,
  brand_sku    text,
  product_name text,
  brand_name   text,
  slug         text,
  synced_at    timestamptz not null default now()
);

create index if not exists web_catalog_sku_idx
  on raw.web_catalog (sku);

-- Uppflettingin er ILIKE á birgjanúmeri, svo lower() vísirinn er sá sem
-- er notaður. Án hans er þetta full scan á 4.473 raðir við hvern innslátt.
create index if not exists web_catalog_brand_sku_lower_idx
  on raw.web_catalog (lower(brand_sku));

create index if not exists web_catalog_synced_at_idx
  on raw.web_catalog (synced_at);

alter table raw.web_catalog enable row level security;

revoke all on raw.web_catalog from anon;
revoke all on raw.web_catalog from authenticated;

comment on table raw.web_catalog is
  'Birti vorulistinn a storkaup.is (getProductsV2). Fyllt ur GAS a 12h fresti. '
  'web_sku = ohreyft ur GraphQL; sku = normaliserad berja talan, tengilykill vid BC.';
