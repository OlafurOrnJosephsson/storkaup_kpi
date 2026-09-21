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
-- ── MÆLT UPPHAFSÁSTAND, 2026-09-21 ──────────────────────────────────
-- Seinni fyrirspurnin (netfangalistinn) skilaði NÍU röðum. `notes` segir
-- hvaðan hver kom, og það er lærdómurinn:
--
--   solumaduratli      lagerkrm@hagkaup.is         CUSTOMERS | Admin
--   solumadurbjossi    glenn@ambrosialkitchen.is   CUSTOMERS | Admin | NEWWEB
--   solumadurolof      svenni@hertz.is             CUSTOMERS | Admin
--   solumadurbirgir    <uuid>@example.com          NEWWEB
--   solumadurstorkaup  <uuid>@example.com          NEWWEB
--   solumadurvefur     <uuid>@example.com          NEWWEB
--   storkauphaddy      <uuid>@example.com          NEWWEB
--   storkaupolafur     <uuid>@example.com          NEWWEB
--   storkaupsigrun     <uuid>@example.com          NEWWEB
--
-- Öll ÞRJÚ raunverulegu netföng viðskiptavina bera `CUSTOMERS | Admin`:
-- BC-tengiliðurinn „Sölumaður - <nafn>" samstillist yfir í Magento sem
-- viðskiptavinur með hlutverkið Admin, og ber netfang fyrirtækisins.
--
-- ATH: `Admin` ber EKKI sölumannsmerki. Það var NAFNIÐ sem kom þeim inn,
-- ekki hlutverkið — og þess vegna lyklar vörnin í `addRef_` á nafnið.
-- Röð sem á sér sölumann í ROLE en venjulegt mannsnafn heldur netfangi sínu.
--
-- Sex `@example.com` raðirnar koma allar úr NEWWEB: pantanir undir
-- sölumannsnafni þar sem `real_email` var staðgengill. Þær gera ekkert
-- gagn og ekkert tjón; þær hverfa með sömu lagfæringu.
--
-- Viðskiptavinirnir þrír eru ekki smáir: Hertz-Bílaþjónustan á 42
-- vefpantanir síðustu 365 daga og Hagkaup-verslanirnar 80 samtals.
--
-- MÆLT 2026-09-21:
--   vefpantanir_365d ................. 10.718
--   taldar_solumannspantanir_nuna ....    412   (3,8%)
--   samsvorun_a_nafni ................      0   ← sjá hér að neðan
--   faerast_i_sjalfsafgreidslu .......     24   (0,2% allra, 5,8% sölumannspantana)
--
-- ⚠️ `samsvorun_a_nafni = 0` FELLDI FORSENDUNA. Ætlunin var að netfangið
-- mætti falla af því að nafnasamsvörunin héldi flokkuninni réttri. Hún
-- grípur enga pöntun: vefpöntun ber FYRIRTÆKJANAFNIÐ, ekki tengiliðsnafnið,
-- svo `rep_name_norm = customer_name_norm` rætist aldrei. Öll flokkun
-- sölumannspantana hvílir á netfangi.
--
-- Þar með er umboðstengiliður sem deilir netfangi með viðskiptavininum
-- ÓAÐGREINANLEGUR frá honum. Pöntun Hertz gegnum umboðsaðganginn og pöntun
-- sem Svenni leggur sjálfur inn bera BÁÐAR svenni@hertz.is. Að halda
-- netfanginu kallar þær allar sölumannspantanir; að fella það kallar þær
-- allar sjálfsafgreiðslu. Við vitum ekki hlutföllin og gögnin geyma þau ekki.
--
-- RÉTTA RÖÐIN ER ÞVÍ ÖFUG VIÐ ÞAÐ SEM STÓÐ HÉR ÁÐUR:
--   1. Laga BC — hver „Sölumaður - X" tengiliður fái netfang sölumannsins
--      á @storkaup.is. Þá verða pantanirnar aðgreinanlegar í fyrsta sinn.
--   2. Bíða eftir samstillingu. Hún LENDIR: collectSalesRepsRefRows_ les
--      CUSTOMERS á undan NEWWEB og taflan er endurbyggð frá grunni, svo
--      CUSTOMERS-netfangið vinnur. Allar þrjár raunverulegu raðirnar bera
--      `CUSTOMERS | Admin`.
--   3. Endurkeyra þessa mælingu — talan á að lækka af sjálfu sér.
--   4. Deploya vörninni í addRef_ sem ÖRYGGISNETI gegn endurkomu.
--
-- Sex `<uuid>@example.com` raðirnar eiga sér enga CUSTOMERS-röð til að
-- leiðrétta (allar úr NEWWEB). Þær hverfa aðeins með vörninni í skrefi 4.
--
-- Í samhengi: 24 pantanir af 10.718 færa sjálfsafgreiðsluhlutfallið úr
-- 96,16% í 96,38%. Ómerkjanlegt í heild — en per viðskiptavin ræður það
-- stöðu, og 2 pantanir Ambrosial Kitchen eru allur þeirra vefferill.
--
-- ── EFTIR BC-LAGFÆRINGUNA, 2026-09-21 ───────────────────────────────
--   vefpantanir_365d ................. 10.722
--   taldar_solumannspantanir_nuna ....    379   (var 412)
--   samsvorun_a_nafni ................      0
--   faerast_i_sjalfsafgreidslu .......      7   (var 24)
--
-- ÞRJÚ NETFÖNG VIÐSKIPTAVINA HORFIN. Ólafur lagaði tengiliðina í BC, þeir
-- samstilltust í Magento og `scheduledReferenceSync_v1` endurbyggði töfluna:
--   solumaduratli   lagerkrm@hagkaup.is       → atlis@storkaup.is
--   solumadurbjossi glenn@ambrosialkitchen.is → thorbjorn@storkaup.is
--   solumadurolof   svenni@hertz.is           → oh@storkaup.is
-- Raðirnar fóru úr 20 í 19: `bjossisolumadur` hvarf, svo eitt af fjórum
-- samnefnapörum leystist af sjálfu sér. Enginn `person_key` dálkur þurfti.
--
-- Sölumannspantanir LÆKKUÐU, 412 → 379. Það var öfugt við spána: 45
-- umboðsaðgangar Bjössa báru `thorbjorn@storkaup.is` þegar, gegnum
-- `bjossisolumadur`, svo ekkert bættist við — aðeins netföng viðskiptavina
-- hættu að telja. Þær ~33 pantanir voru rangflokkaðar allan tímann.
--
-- ⚠️ EN TALAN ER 7, EKKI 0 — OG ÞAÐ FELLDI SEINNI FORSENDUNA.
-- Einu netföngin sem eftir stóðu utan @storkaup.is voru sex
-- `<uuid>@example.com` staðgenglar, og þeir bera SJÖ raunverulegar
-- sölumannspantanir. Þeir eru ekki hávaði heldur burðarvirki: af því
-- `samsvorun_a_nafni` er núll er staðgengillinn eina tengingin milli
-- þeirrar pöntunar og sölumanns.
--
-- Upphaflega vörnin hefði fellt þá og rangflokkað sjö sölumannspantanir
-- sem sjálfsafgreiðslu — þveröfugt við tilganginn. Hún hleypir nú
-- `@example.com` í gegn: lénið er frátekið (RFC 2606) og getur aldrei
-- verið netfang raunverulegs viðskiptavinar, svo sú hætta sem vörnin er
-- til við getur ekki komið þaðan. Fyrirspurnin hér að neðan var uppfærð
-- til að mæla sömu reglu.
--
-- Hermt á lifandi töflu eftir breytinguna: NÚLL raðir missa netfang.
-- Vörnin hefur ekkert að laga og á að hafa það áfram.
--
-- ── ÞETTA ER NÚNA EFTIRLIT, EKKI UNDIRBÚNINGUR ──────────────────────
-- Keyrðu þetta aftur ef sölumannspantanir hreyfast óútskýrt. Fari
-- `faerast_i_sjalfsafgreidslu` upp fyrir 7 hefur netfang viðskiptavinar
-- ratað inn á sölumannsnafn á ný — sem vörnin á að hindra, svo þá er
-- vörnin sjálf biluð eða mynstrið hefur breyst.
--
-- Fari `samsvorun_a_nafni` einhvern tíma UPP FYRIR NÚLL er það líka frétt:
-- þá er farið að bera aðgangsnafnið á vefpöntunum og nafnasamsvörunin,
-- sem hefur verið dauð allan tímann, byrjuð að vinna.
-- ============================================================================

-- ── LESTU ÞETTA FYRST: RITILLINN SÝNIR AÐEINS SÍÐUSTU SETNINGUNA ────
-- Supabase-SQL-ritillinn keyrir allar setningar í skjalinu en birtir
-- AÐEINS niðurstöðu þeirrar síðustu. Skjalið bar áður talninguna fyrst og
-- netfangalistann síðast, svo talan datt þegjandi út og notandinn sá bara
-- listann. Röðinni er snúið við: aðaltalan er SÍÐUST og kemur því upp
-- sjálfkrafa.
--
-- Viltu hina fyrirspurnina merkirðu hana eina og ýtir á Run — ritillinn
-- keyrir aðeins það sem er valið.
-- ============================================================================


-- ── 1. HVAÐA NETFÖNG ERU ÞETTA (merktu og keyrðu eitt og sér) ───────
-- Sé listinn lengri en örfáar raðir er mynstrið útbreiddara en eitt
-- tilvik og lagfæringin þeim mun brýnni.
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
  and r.email_norm not like '%@example.com'
order by r.name_norm;


-- ── HVE MÖRG NETFÖNG VORU HUNSUÐ Í SÍÐUSTU SAMSTILLINGU ─────────────
-- Ekki SQL: `syncSalesRepsRefToSupabase_v1()` skrifar í Apps Script logginn
--   [SALES_REPS_REF][INFO] Candidates=<n> dropped_conflicts=<n>
-- `dropped_conflicts` telur hvert sinn sem nafn bar þegar annað netfang.
-- Há tala þar er beinn mælikvarði á hve margir umboðstengiliðir eru til.


-- ── 2. AÐALTALAN — birtist sjálfkrafa því hún er síðust ─────────────
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
        -- <uuid>@example.com er staðgengill Magento, ekki netfang
        -- viðskiptavinar, og hann BER raunverulegar sölumannspantanir.
        -- Vörnin í addRef_ hleypir honum í gegn, svo mælingin verður að
        -- gera það líka — annars mælir hún reglu sem er ekki í gildi.
        and r.rep_email_norm not like '%@example.com'
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
