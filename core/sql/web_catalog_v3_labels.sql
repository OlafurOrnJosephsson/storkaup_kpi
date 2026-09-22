-- raw.web_catalog — vottanir og skjöl, og yfirlits-RPC uppfært
--
-- Keyrist Á EFTIR web_catalog_v1.sql og web_catalog_v2_content.sql.
--
-- ── HVAÐ ER GEYMT ───────────────────────────────────────────────────
--   labels         text[]  vottanir, 12 föst gildi
--   datasheet_url  text    Plytix-slóð, fyrsta skráin
--   safety_url     text    öryggisblað
--   brochure_url   text    bæklingur
--
-- Mælt á öllum 4.480 vörum 2026-09-22:
--   732  bera vottun   (Food safe 339 · Svansmerking 246 · FSC 108 ·
--                       Evrópublómið 105 · Asthma Allergy 105 · Vegan 57 …)
--   1.462 með gagnablað · 357 með öryggisblað · 140 með bækling
--
-- `isToxicProduct` er EKKI geymt: false á öllum 4.480. Reiturinn er
-- ósnertur í Plytix og segir því ekkert. Merki sem er alltaf false lítur
-- út eins og merki og er það ekki.
--
-- ── ÞETTA ER EKKI GAT Í BIRTINGU HELDUR Í PIM-INU ───────────────────
-- Vefurinn ber 1.462 gagnablöð, 357 öryggisblöð og 140 bæklinga.
-- Plytix-útdrátturinn mældist með 1.454 / 356 / 138 (2026-09-11,
-- pim/buildPimWorksheet.js). Tölurnar passa upp á eitt: vefurinn birtir
-- allt sem PIM-ið á. Skrárnar sem vantar eru ekki til, og þær verða ekki
-- til nema þær komi frá birgjum.
--
-- Þess vegna ber portalinn LEITARHNAPP á birgjagátt frekar en að þykjast
-- vita hvaða vörur „ættu" að hafa skjöl. Þekja eftir vörumerki mæld
-- sama dag sýnir að ályktun innan vörumerkis gengur ekki upp:
--   Abena 725 vörur / 425 gagnablöð (59%)
--   Nilfisk 530 / 39 (7%)   Vikan 256 / 167 (65%)   Ecolab 240 / 133 (55%)
-- Þegar þriðjungur til níu tíundu vantar er „vantar" normið, ekki frávik.

alter table raw.web_catalog
  add column if not exists labels        text[],
  add column if not exists datasheet_url text,
  add column if not exists safety_url    text,
  add column if not exists brochure_url  text;

comment on column raw.web_catalog.labels is
  'Vottanir ur ProductLabels — 12 fost gildi, t.d. Svansmerking, FSC, Evropublomid.';
comment on column raw.web_catalog.safety_url is
  'Oryggisblad (Plytix-slod). 357 vorur af 4.480 bera thad 2026-09-22.';


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
  labels              text[],
  datasheet_url       text,
  safety_url          text,
  brochure_url        text,
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
    (case
       when coalesce(c.description_length, 0) = 0 then 'engin'
       when c.description_is_name                 then 'heiti'
       when c.description_length < 40             then 'stutt'
       else 'i-lagi'
     end)::text                                     as content_flag,
    c.labels,
    c.datasheet_url::text,
    c.safety_url::text,
    c.brochure_url::text,
    c.synced_at
  from raw.web_catalog c
  cross join q
  where q.ident is not null
    and public.norm_ident_(c.sku) = q.ident
  order by c.web_sku;
$$;

grant execute on function public.get_product_overview_v1(text) to anon, authenticated;
