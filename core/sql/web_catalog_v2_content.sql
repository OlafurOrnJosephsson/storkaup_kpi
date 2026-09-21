-- raw.web_catalog — innihaldsmerki, og yfirlits-RPC fyrir vöruportalinn
--
-- Keyrist Á EFTIR core/sql/web_catalog_v1.sql. Bætir tveimur dálkum við
-- töfluna sem er þegar til og bætir við einu RPC-i.
--
-- ── MERKIN, EKKI TEXTINN ────────────────────────────────────────────
-- Lýsingarnar sjálfar eru 828 KB og eru þegar til í Plytix og á vefnum.
-- Þriðja afritið hér væri texti sem fúnar milli samstillinga og enginn
-- les — portalinn tengir á vöruna til að lesa hana. Geymd eru merkin:
--
--   description_length   fjöldi stafa, 0 ef engin lýsing
--   description_is_name  lýsingin ER orðrétt vöruheitið
--
-- Mælt á öllum 4.474 vörum 2026-09-21:
--   4   án lýsingar
--   470 þar sem lýsingin er orðrétt vöruheitið  ← raunverulega vandamálið
--   miðgildi 114 stafir, lengst 2.449
--
-- Þau 470 eru tómur reitur í dulargervi. Þau töldust ekki með í fjórum
-- tómum og hefðu aldrei fundist með því að spyrja „er lýsing til".
--
-- MYND ER EKKI GEYMD SEM MERKI. 1 vara af 4.474 er án myndar. Panel sem
-- flaggar einu tilviki af fjögur þúsund kennir fólki að hunsa hann.

alter table raw.web_catalog
  add column if not exists description_length  integer,
  add column if not exists description_is_name boolean;

comment on column raw.web_catalog.description_length is
  'Stafafjoldi longDescription a vefnum. 0 = engin lysing. Textinn sjalfur er EKKI geymdur.';
comment on column raw.web_catalog.description_is_name is
  'Lysingin er ordrett voruheitid — tomur reitur i dulargervi. 470 vorur 2026-09-21.';


-- ── YFIRLIT FYRIR EINA VÖRU ─────────────────────────────────────────
-- Auðkenni + vefstaða + innihaldsmerki í einu kalli. Hreyfingar og
-- tengsl eru SÉR RPC — sjá get_product_relations_v1 og
-- get_product_buyers. Sú skipting er vísvitandi: falli þungu
-- sölufyrirspurnirnar á að hausinn á portalinum standi samt, sbr.
-- non-negotiable um að Webflow-síður þoli að aukafyrirspurn bregðist.
--
-- Fyrirspurnin fyrirgefur forleiðandi núll (norm_ident_) en skilar
-- `sku` á BC-formi, sem er það sem hin RPC-in taka við. Portalinn á að
-- nota GILDIÐ SEM KEMUR TIL BAKA í næstu köll, ekki það sem notandinn
-- sló inn — annars lendir „1015" á hreyfingafyrirspurn sem finnur ekkert.

drop function if exists public.get_product_overview_v1(text);

create or replace function public.get_product_overview_v1(p_sku text)
returns table (
  sku                 text,
  web_sku             text,
  brand_sku           text,
  product_name        text,
  brand_name          text,
  slug                text,
  product_url         text,
  on_web              boolean,
  description_length  integer,
  description_is_name boolean,
  content_flag        text,
  synced_at           timestamptz
)
language sql stable security definer
set search_path = public, raw
as $$
  with q as (
    select public.norm_ident_(p_sku) as ident
  )
  select
    c.sku::text,
    c.web_sku::text,
    c.brand_sku::text,
    c.product_name::text,
    c.brand_name::text,
    c.slug::text,
    case when c.slug is null or c.slug = '' then null
         else 'https://www.storkaup.is/vara/' || c.slug end::text as product_url,
    true                                            as on_web,
    c.description_length,
    c.description_is_name,
    -- Eitt orð sem viðmótið getur litað eftir. Röðin skiptir máli:
    -- "heiti" er verra en stutt lýsing, því það lítur út fyrir að vera
    -- lýsing en ber engar upplýsingar.
    (case
       when coalesce(c.description_length, 0) = 0 then 'engin'
       when c.description_is_name                 then 'heiti'
       when c.description_length < 40             then 'stutt'
       else 'i-lagi'
     end)::text                                     as content_flag,
    c.synced_at
  from raw.web_catalog c
  cross join q
  where q.ident is not null
    and public.norm_ident_(c.sku) = q.ident
  order by c.web_sku;
$$;

grant execute on function public.get_product_overview_v1(text) to anon, authenticated;
