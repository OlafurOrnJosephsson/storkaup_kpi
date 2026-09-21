-- ============================================================================
-- MÆLING (les aðeins, breytir engu): hversu margar vefpantanir eru flokkaðar
-- sem sölumannspantanir EINGÖNGU vegna netfangs sem er ekki á @storkaup.is?
--
-- ── HVERS VEGNA ─────────────────────────────────────────────────────
-- `raw.sales_reps_ref` er ekki handvalin þótt hausinn á sales_reps_ref.sql
-- segi það. Hún er rifin niður og endurbyggð af
-- `syncSalesRepsRefToSupabase_v1()` úr CUSTOMERS-blaðinu og NEWWEB-pöntunum.
-- `addRef_` (core/utils.js) parar nafn við það netfang sem stendur á röðinni
-- og heldur AÐEINS ÞVÍ FYRSTA.
--
-- Í BC er til mynstur: tengiliður undir viðskiptavini sem heitir
-- „Sölumaður - <nafn>" og hefur eigin vefverslunarinnskráningu, svo
-- sölumaður geti pantað fyrir hans hönd. Sá tengiliður erfir NETFANG
-- VIÐSKIPTAVINARINS. Samstillingin sér „solumadur" í nafninu og skráir
-- netfang viðskiptavinarins sem sölumannsnetfang.
--
-- Afleiðing: pantanir sem viðskiptavinurinn leggur SJÁLFUR inn, með sínu
-- eigin netfangi, teljast sölumannspantanir. Sjálfsafgreiðsluhlutfallið er
-- of lágt. Staðfest 2026-09-21: glenn@ambrosialkitchen.is er skráð sem
-- sölumannsnetfang á `solumadurbjossi`, og Ambrosial Kitchen ehf
-- (kt. 7108211510) á 2 vefpantanir síðustu 365 daga.
--
-- Þar sem aðeins fyrsta netfang hvers nafns lifir er nákvæmlega EITT
-- netfang viðskiptavinar hafið upp per sölumannsnafn — hvaða viðskiptavinur
-- það verður ræðst af skönnunarröð. Það er hlutkesti, ekki villa í einni röð.
--
-- ── KEYRÐU ÞETTA ÁÐUR EN `addRef_` ER LAGAÐ ─────────────────────────
-- Lagfæringin hækkar sjálfsafgreiðsluhlutfallið á aðalmælaborðinu. Sú
-- hækkun er leiðrétting, ekki árangur, og GOALS.md rekur þessa tölu sem
-- norðurstjörnu. Skrifaðu niðurstöðuna hér að neðan svo stökkið eigi sér
-- skýringu eftir á.
-- ============================================================================

with reps as (
  select
    lower(trim(coalesce(r.name_norm, '')))  as rep_name_norm,
    lower(trim(coalesce(r.email_norm, ''))) as rep_email_norm
  from raw.sales_reps_ref r
  where coalesce(r.active, true) = true
),
web as (
  select
    regexp_replace(
      lower(translate(coalesce(n.customer_name, ''),
            'áðþæöéíóúýÁÐÞÆÖÉÍÓÚÝ', 'adthaeoeiouyadthaeoeiouy')),
      '[^a-z0-9]+', '', 'g') as customer_name_norm,
    lower(trim(coalesce(to_jsonb(n)->>'real_email', ''))) as customer_email_norm
  from raw.newweb_orders_raw n
  where n.purchase_date is not null
    and n.purchase_date >= (current_date - interval '365 days')::timestamptz

  union all

  select
    regexp_replace(
      lower(translate(coalesce(o.customer_name, ''),
            'áðþæöéíóúýÁÐÞÆÖÉÍÓÚÝ', 'adthaeoeiouyadthaeoeiouy')),
      '[^a-z0-9]+', '', 'g'),
    lower(trim(coalesce(to_jsonb(o)->>'customer_email', '')))
  from raw.oldweb_orders_raw o
  where o.purchase_date is not null
    and o.purchase_date >= (current_date - interval '365 days')::timestamptz
),
classified as (
  select
    exists (
      select 1 from reps r
      where r.rep_name_norm <> '' and r.rep_name_norm = w.customer_name_norm
    ) as by_name,
    exists (
      select 1 from reps r
      where r.rep_email_norm <> ''
        and r.rep_email_norm like '%@storkaup.is'
        and r.rep_email_norm = w.customer_email_norm
    ) as by_email_ok,
    exists (
      select 1 from reps r
      where r.rep_email_norm <> ''
        and r.rep_email_norm not like '%@storkaup.is'
        and r.rep_email_norm = w.customer_email_norm
    ) as by_email_bad
  from web w
)
select
  count(*)                                                   as vefpantanir_365d,
  count(*) filter (where by_name or by_email_ok or by_email_bad) as taldar_solumannspantanir_nuna,
  count(*) filter (where by_name)                            as samsvorun_a_nafni,
  -- ÞETTA ER TALAN: pantanir sem hætta að teljast sölumannspantanir og
  -- verða sjálfsafgreiðsla þegar netföng utan @storkaup.is eru felld niður.
  count(*) filter (where by_email_bad and not by_name and not by_email_ok)
                                                             as faerast_i_sjalfsafgreidslu
from classified;


-- ── HVAÐA NETFÖNG ERU ÞETTA, OG HVE MÖRG ────────────────────────────
-- Keyrðu þetta líka. Sé listinn lengri en örfáar raðir er mynstrið
-- útbreiddara en eitt tilvik og lagfæringin þeim mun brýnni.
select
  r.name_norm,
  r.email_norm,
  r.notes
from raw.sales_reps_ref r
where coalesce(r.active, true) = true
  and trim(coalesce(r.email_norm, '')) <> ''
  and r.email_norm not like '%@storkaup.is'
order by r.name_norm;


-- ── HVE MÖRG NETFÖNG VORU HUNSUÐ Í SÍÐUSTU SAMSTILLINGU ─────────────
-- Ekki SQL: `syncSalesRepsRefToSupabase_v1()` skrifar í Apps Script logginn
--   [SALES_REPS_REF][INFO] Candidates=<n> dropped_conflicts=<n>
-- `dropped_conflicts` telur hvert sinn sem nafn bar þegar annað netfang.
-- Há tala þar er beinn mælikvarði á hve margir umboðstengiliðir eru til.
