-- public.search_products — leitin á /kpi/top-products, nú með birgjanúmerum
--
-- Kallað úr Webflow/top-products.js (fetchSearchProducts). Krefst
-- core/sql/web_catalog_v1.sql fyrst; án þeirrar töflu er villa.
--
-- ── HVAÐ BREYTTIST ──────────────────────────────────────────────────
-- 1. Birgjanúmer virka í leitarreitnum. Að slá inn 7276 finnur
--    STO_114112 (WypAll þurrku) þótt sú tala komi hvergi fyrir í BC.
-- 2. Tvær nýjar kólumnur: `brand_sku` og `match_kind`. Frontendið hunsar
--    þær þar til einhver bætir við [data-field="..."] — engin JS-breyting
--    þarf til að leitin sjálf virki.
-- 3. Fyrirspurn styttri en 2 stafir skilar engu. Áður gaf eins stafs
--    fyrirspurn ILIKE '%x%' yfir alla bc_lines_raw. Frontendið hindraði
--    það hvort eð er, en fallið er anon-grantað og átti ekki að treysta
--    á það.
--
-- ── AUÐKENNISTREFF RAÐAST ALLTAF EFST ───────────────────────────────
-- Mælt í framleiðslu 2026-09-18: `search_products('7276')` skilaði tveimur
-- röðum. Sú rétta var STO_114112 (birgjanúmer 7276). Sú ranga var
-- Ecolab-hreinsiefni, sku 117276 — það hitti af því að BC-skuið
-- `117276_STK` INNIHELDUR „7276". Röðin réðst af veltu, svo hefði
-- Ecolab selst meira hefði rangt svar staðið efst.
--
-- Hlutstrengsleitin er ekki fjarlægð — fólk leitar að hluta úr sku og
-- að heitum, og það á að halda áfram að virka. En hún má ekki keppa við
-- auðkenni. Raðað er fyrst á því hvort fyrirspurnin hitti auðkenni
-- NÁKVÆMLEGA (birgjanúmer eða sku vörunnar) og fyrst þar á eftir á veltu.
-- Uppfletting gefur því ævinlega rétta svarið efst og hávaðinn fer neðar
-- í stað þess að hverfa. `match_kind` segir hvort heldur var — sama og
-- „Lykill"-kólumnan í pim/lookup_sku.js, og af sömu ástæðu: svar án
-- þess hvers vegna það kom er ekki hægt að lesa yfir.
--
-- Normalíseringin á fyrirspurninni speglar normStorkaupSku_ í
-- core/web_catalog.js — STO_-forskeyti og sölueiningarviðskeyti af, og
-- forleiðandi núll af hreinum tölum. Þau tvö verða að haldast í takt,
-- annars finnur SQL-ið ekki það sem GAS skrifaði.
--
-- ── HVAÐ BREYTTIST EKKI, OG HVERS VEGNA ─────────────────────────────
-- Vörur án sölu í glugganum koma AÐEINS með þegar fyrirspurnin hitti
-- auðkenni NÁKVÆMLEGA, aldrei við heitaleit og aldrei við hlutstreng.
-- Annars myndi "salernispappír" allt í einu skila hverri vöru í
-- vörulistanum með núllum, og textaleitin sem er í notkun núna fylltist
-- af hávaða. Auðkennisleit er uppfletting — þar er „til á vefnum, hefur
-- ekki selst" rétta svarið. Heitaleit er sölugreining.
--
-- ATH: vara sem kemur úr vörulistanum án sölu fær orders=0, revenue=0.
-- Það er ekki „engin sala nokkurn tíma" heldur „engin sala í síðustu
-- p_days_back dögum".
--
-- Síunin fyrir bc_lines_raw er vísvitandi FYRIR group by, eins og í
-- upphaflegu útgáfunni. Að hópa allan gluggann fyrst og sía svo fellur á
-- 8 sek anon statement_timeout á þessari töflu.

-- Normalíserun auðkennis — eitt fall svo fyrirspurnin og taflan noti
-- sömu reglu. Speglar normStorkaupSku_ í core/web_catalog.js:
--   STO_117268_STK → 117268      0117268 → 117268      AC 070/23CS → AC 070/23CS
-- Forleiðandi núll eru skorin af HREINUM tölum eingöngu; strengur eins og
-- "007A" er auðkenni í sjálfu sér og má ekki breytast.
--
-- VERÐUR að koma á undan search_products: Postgres parse-ar SQL-líkama
-- við create (check_function_bodies), svo fall sem vísar í óskilgreint
-- fall fellur strax.
create or replace function public.norm_ident_(p text)
returns text
language sql immutable parallel safe
as $$
  select case
    when v ~ '^[0-9]+$' then (v::numeric)::text
    else v
  end
  from (
    select nullif(
      regexp_replace(
        regexp_replace(upper(btrim(coalesce(p, ''))), '^STO[_\-\s]+', ''),
        '[_\-](STK|KASSI|BRETTI|PK|PAKKI)$', ''
      ), ''
    ) as v
  ) t;
$$;


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
  brand_sku    text,
  match_kind   text
)
language sql stable security definer
set search_path = public, raw
as $$
  with q as (
    select
      case
        when p_query is null or length(btrim(p_query)) < 2 then null
        else '%' || btrim(p_query) || '%'
      end as pat,
      -- Sama normalíserun og normStorkaupSku_ i core/web_catalog.js.
      case
        when p_query is null or length(btrim(p_query)) < 2 then null
        else public.norm_ident_(p_query)
      end as ident
  ),
  -- Allur vörulistinn, einn á hvert normalíserað sku. Sama vara í tveimur
  -- sölueiningum á tvær raðir í web_catalog en má bara eiga eina hér.
  cat_all as (
    select c.sku,
           min(c.brand_sku)                     as brand_sku,
           min(public.norm_ident_(c.brand_sku)) as brand_ident,
           min(c.product_name)                  as product_name
    from raw.web_catalog c
    group by c.sku
  ),
  -- NÁKVÆM auðkennistreff eingöngu. Þetta eru einu raðirnar sem mega
  -- bætast við án sölu, og einu raðirnar sem fá match_rank 0.
  cat_hits as (
    select a.sku,
           a.brand_sku,
           a.product_name,
           (case when a.brand_ident = q.ident then 'brand_sku' else 'sku' end)::text as match_kind
    from cat_all a
    cross join q
    where q.ident is not null
      and (a.brand_ident = q.ident or a.sku = q.ident)
  ),
  -- BC-rithættirnir á þeim vörum sem auðkennið hitti, reiknaðir á LITLU
  -- hliðinni. Þetta er ekki snyrtimennska heldur 8 sekúndna þakið:
  --
  -- Fyrsta útgáfa skrifaði `regexp_replace(l.sku, …) in (select …)` beint
  -- í OR-keðjuna. Af því að ILIKE-greinarnar á undan fella langflestar
  -- raðir keyrði sá regex á NÆR HVERRI RÖÐ í bc_lines_raw, og fallið féll
  -- á statement_timeout hjá anon þótt það gengi í SQL-ritlinum, sem hefur
  -- ekkert slíkt þak. Einkennið var HTTP 500 í vafranum og ekkert að sjá
  -- í ritlinum — versta samsetningin.
  --
  -- Hér eru rithættirnir taldir upp í staðinn: berja talan, hún með
  -- þekktum sölueiningarviðskeytum, og það sem vefurinn segir sjálfur
  -- (web_sku án STO_-forskeytis er nákvæmlega BC-rithátturinn). Listinn
  -- telur í mesta lagi nokkra tugi, svo samanburðurinn verður jafnaðar-
  -- merki í stað regex á hverja röð.
  cat_bc as (
    select h.sku || s.suffix as bc_sku
    from cat_hits h
    cross join (values (''), ('_STK'), ('_KASSI'), ('_BRETTI'), ('_PK'), ('_PAKKI')) as s(suffix)
    union
    select regexp_replace(c.web_sku, '^STO[_\-\s]+', '')
    from raw.web_catalog c
    join cat_hits h2 on h2.sku = c.sku
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
        l.sku in (select cb.bc_sku from cat_bc cb)
      )
      and coalesce(i.booking_date, i.order_date) >= current_date - p_days_back
    group by 1
  )
  select
    coalesce(s.sku, h.sku)                        as sku,
    coalesce(s.product_name, h.product_name)      as product_name,
    coalesce(s.orders, 0)::bigint                 as orders,
    coalesce(s.revenue_excl, 0)::numeric          as revenue_excl,
    a.brand_sku                                   as brand_sku,
    coalesce(h.match_kind, 'leit')::text           as match_kind
  from sales s
  full outer join cat_hits h on h.sku = s.sku
  left join cat_all a on a.sku = coalesce(s.sku, h.sku)
  order by
    case when h.sku is null then 1 else 0 end,      -- match_rank: auðkenni fyrst
    coalesce(s.revenue_excl, 0) desc nulls last,
    coalesce(s.sku, h.sku)
  limit p_limit;
$$;

grant execute on function public.search_products(text, int, int) to anon, authenticated;
