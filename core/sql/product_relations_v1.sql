-- raw.product_relations — tengsl milli vara, tvenns konar
--
-- Fyllt úr GAS: syncProductRelationsToSupabase_v1() í core/web_catalog.js,
-- lesið úr tveimur flipum í PIM-skjalinu:
--   TENGSL_HRA        tengslin sem ERU á storkaup.is i dag   → kind='live'
--   TENGSL_TILLOGUR   tillögur úr körfugreiningu á BC        → kind='suggested'
--
-- Saman eru þau ákvörðunartækið: „þetta er tengt, þetta ætti að vera það".
-- Hvorugt dugar eitt. Tillaga án þess að vita hvað er þegar tengt leiðir
-- til tvíverknaðar; núverandi tengsl án tillagna segja ekkert um hvað vantar.
--
-- ── ÞRÍR RITHÆTTIR Í TVEIMUR FLIPUM ─────────────────────────────────
-- Mælt 2026-09-21 á raunverulegum flipum:
--   TENGSL_HRA      dálkur A  `STO_9003174_KASSI`   (STO_-form)
--                   dálkur B  `STO_A,STO_B,STO_C`   (KOMMUAÐSKILINN listi)
--   TENGSL_TILLOGUR dálkur A  `9004596`             (ber tala)
--                   dálkur D  `104924` EÐA `9001525_KASSI`  (BLANDAÐ)
--
-- Samstillingin normalíserar hvern dálk fyrir sig í BC-formið, stafrétt,
-- með forleiðandi núllum. Sú regla kostaði 2.036 BC-línur fyrr sama dag
-- þegar hún var brotin í web_catalog — sjá normStorkaupSku_.
--
-- ── FLIPINN NÆR YFIR FLEIRA EN VEFINN ───────────────────────────────
-- TENGSL_HRA ber 8.088 einstök SKU en vefurinn 4.474. Munurinn er
-- archived vörur úr Plytix (útdrátturinn ber 7.986 alls). Þær eru
-- geymdar óáreittar: vara sem er ekki á vefnum verður aldrei flett upp,
-- og að sía þær burt hér myndi henda sögu að óþörfu.
--
-- ── FERSKLEIKI ER PER RÖÐ ───────────────────────────────────────────
-- `fetched_at` kemur úr Sótt-dálki TENGSL_HRA. Tengslasóknin er
-- endurræsanleg og keyrð í skömmtum, svo flipinn er aldrei allur jafn
-- gamall — sumar raðir eru frá 16.9., aðrar frá 21.9. Ein dagsetning á
-- alla töfluna væri lygi. Viðmótið á að sýna þetta gildi.

create table if not exists raw.product_relations (
  sku          text not null,
  related_sku  text not null,
  kind         text not null check (kind in ('live', 'suggested')),
  score        numeric,
  reason       text,
  fetched_at   date,
  synced_at    timestamptz not null default now(),
  primary key (sku, related_sku, kind)
);

create index if not exists product_relations_sku_idx
  on raw.product_relations (sku);

create index if not exists product_relations_synced_at_idx
  on raw.product_relations (synced_at);

alter table raw.product_relations enable row level security;
revoke all on raw.product_relations from anon;
revoke all on raw.product_relations from authenticated;

comment on table raw.product_relations is
  'Tengsl milli vara. kind=live: thad sem er tengt a storkaup.is i dag. '
  'kind=suggested: tillogur ur korfugreiningu a BC. sku og related_sku eru '
  'BC-form (stafrett, forleidandi null haldast) — sami tengilykill og web_catalog.sku.';


-- ── RPC ─────────────────────────────────────────────────────────────
-- Skilar báðum tegundum fyrir eina vöru, auðguðum úr web_catalog.
--
-- `related_on_web` er ekki skraut. Tengsl sem vísa á vöru sem er farin af
-- vefnum eru dauður hlekkur á storkaup.is, og það er nákvæmlega eitt af
-- því sem portalinn á að finna. Án þess dálks líta þau eins út og góð
-- tengsl.
--
-- Vísvitandi EKKI hluti af stærri „pakka"-RPC: falli þetta á að hinir
-- panelarnir í portalinum standi. Sbr. non-negotiable um að Webflow-síður
-- eigi að þola að aukafyrirspurn bregðist.

drop function if exists public.get_product_relations_v1(text);

create or replace function public.get_product_relations_v1(p_sku text)
returns table (
  kind            text,
  related_sku     text,
  related_name    text,
  related_brand   text,
  related_slug    text,
  related_on_web  boolean,
  score           numeric,
  reason          text,
  fetched_at      date
)
language sql stable security definer
set search_path = public, raw
as $$
  with q as (
    select public.norm_ident_(p_sku) as ident
  ),
  -- Fyrirspurnin ma fyrirgefa forleidandi null (notandinn slaer inn 1015
  -- eda 01015), en TENGINGIN vid web_catalog er stafrett. Sjá
  -- "TVEIR LYKLAR" i search_products_v2.sql.
  target as (
    select distinct c.sku
    from raw.web_catalog c
    cross join q
    where q.ident is not null and public.norm_ident_(c.sku) = q.ident
    union
    select distinct r.sku
    from raw.product_relations r
    cross join q
    where q.ident is not null and public.norm_ident_(r.sku) = q.ident
  ),
  w as (
    select c.sku,
           min(c.product_name) as product_name,
           min(c.brand_name)   as brand_name,
           min(c.slug)         as slug
    from raw.web_catalog c
    group by c.sku
  )
  select
    r.kind::text,
    r.related_sku::text,
    w.product_name::text                  as related_name,
    w.brand_name::text                    as related_brand,
    w.slug::text                          as related_slug,
    (w.sku is not null)                   as related_on_web,
    r.score,
    r.reason,
    r.fetched_at
  from raw.product_relations r
  join target t on t.sku = r.sku
  left join w on w.sku = r.related_sku
  order by
    case r.kind when 'live' then 0 else 1 end,
    r.score desc nulls last,
    r.related_sku;
$$;

grant execute on function public.get_product_relations_v1(text) to anon, authenticated;
