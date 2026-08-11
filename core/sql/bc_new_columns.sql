-- ============================================================================
-- Nýir BC-dálkar úr SaaS-exportinu (2026-08-07)
--
-- BAKGRUNNUR: diagnoseBcDropHeaders_v1 sýndi að SaaS-útgáfa BC skilar dálkum
-- sem schema.js þekkti ekki, og hætti að skila öðrum. Þrír þeirra laga vandamál
-- sem voru mæld 2026-08-06:
--
--   Pöntunarnr. (BC_LINES)        hvarf úr sölureikningum → order_no varð null
--                                  → api.search_orders skilar auðu sp_no og nýir
--                                    BC-reikningar finnast ekki eftir pöntunarnr.
--   Afsl.upphæð línu (BC_LINES)   greinir í sundur tvær annars eins línur; án
--                                  hans féllu 4.581 af 239.505 línum (1,9%) saman
--                                  í on_conflict lyklinum → Innkaupalistinn
--                                    vantelur magn og upphæð.
--   Upphæð vanskila (BC_CUSTOMERS) kom í staðinn fyrir 'Hamarksskuld (SGM)' sem
--                                  hvarf. Betra merki: heimild er skráning,
--                                  vanskil eru staðreynd.
--
-- ÞETTA SKJAL ER ÞREP 1 — hrein viðbót. Engin vísitala snert, engin gögn
-- endurskrifuð, ekkert getur tapast. Þrep 2 (dedup-lykillinn) er í
-- bc_lines_dedup_key.sql og er sérstök ákvörðun.
--
-- RÖÐ: keyrðu þetta FYRST, svo clasp push, svo BC-innhleðslu úr valmyndinni.
-- Nýju dálkarnir fyllast við næstu innhleðslu; eldri raðir halda null þar til
-- force-innhleðsla er keyrð (sjá neðst).
-- ============================================================================


-- ── 1. Nýir dálkar ──────────────────────────────────────────────────────────

alter table raw.bc_lines_raw
  add column if not exists order_no      text,
  add column if not exists line_discount numeric;

alter table raw.bc_customers_raw
  add column if not exists arrears      numeric,
  add column if not exists status_sgm   text,
  add column if not exists contact_name text;

comment on column raw.bc_lines_raw.order_no is
  'Pöntunarnr. úr BC-línum. Sölureikningarnir hættu að skila því í SaaS-útgáfunni; hér er eina heimildin.';
comment on column raw.bc_lines_raw.line_discount is
  'Afsl.upphæð línu. Aðgreinir annars eins línur — sjá bc_lines_dedup_key.sql.';
comment on column raw.bc_customers_raw.arrears is
  'Upphæð vanskila (SGM). Kom í stað credit_limit sem SaaS-exportið hætti að skila.';


-- ── 2. Fylla order_no afturvirkt á sölureikninga ────────────────────────────
-- Línurnar eiga pöntunarnúmerið; reikningarnir ekki lengur. Join á document_no
-- endurheimtir það fyrir allar raðir sem hafa línu með gildi.
-- Aðeins skrifað þar sem order_no er tómt — sögulegar raðir úr eldra exporti
-- (fyrir SaaS) halda sínu upprunalega gildi.

update raw.bc_invoices_raw i
set    order_no = src.order_no
from (
  select document_no, min(order_no) as order_no
  from   raw.bc_lines_raw
  where  order_no is not null and btrim(order_no) <> ''
  group  by document_no
) src
where  src.document_no = i.document_no
  and  (i.order_no is null or btrim(i.order_no) = '');

-- Kreditreikningar fá EKKI order_no, viljandi.
-- raw.bc_credit_invoices_raw hefur engan slíkan dálk og hefur aldrei haft:
-- BC_CREDIT_INVOICES í schema.js mappar ekki pöntunarnúmer, og
-- api.search_orders skilar hörðu tómu sp_no fyrir kreditraðir
-- (core/sql/search_orders.sql:85) og leitar aðeins í document_no, company_name
-- og company_id á þeim. Að bæta við dálki sem ekkert les væri ruslsöfnun.
-- Ef kreditreikningar eiga einhvern tímann að finnast eftir pöntunarnúmeri þarf
-- að breyta search_orders fyrst — þá er dálkurinn réttlætanlegur, ekki fyrr.


-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Fyrir innhleðslu eru nýju dálkarnir tómir — það er rétt. Keyrðu aftur eftir
-- BC-innhleðslu og þá eiga tölurnar að hækka.

select
  (select count(*) from raw.bc_lines_raw     where order_no      is not null) as linur_med_pontunarnr,
  (select count(*) from raw.bc_lines_raw     where line_discount is not null) as linur_med_afslatt,
  (select count(*) from raw.bc_invoices_raw  where order_no      is not null) as reikningar_med_pontunarnr,
  (select count(*) from raw.bc_customers_raw where arrears       is not null) as vidskiptavinir_med_vanskil,
  (select count(*) from raw.bc_customers_raw where arrears       > 0)         as vidskiptavinir_i_vanskilum;


-- ── AÐ FYLLA ELDRI RAÐIR ────────────────────────────────────────────────────
-- Venjuleg innhleðsla er incremental og sleppir röðum sem eru þegar til, svo
-- nýju dálkarnir fyllast aðeins á nýjum röðum. Til að fylla söguna þarf
-- force-innhleðslu — en AÐEINS á þeim skrám sem eiga við:
--
--   Viðskiptamenn.xlsx            → arrears, status_sgm, contact_name
--   Bókaðar sölureikningslínur.xlsx → order_no, line_discount
--
-- Settu ÞÆR TVÆR einar í BC_DROP möppuna og keyrðu "Force re-upload".
-- Ekki setja Bókaðir sölureikningar.xlsx með: force á þá skrá skrifar
-- order_no = null og email = null yfir allar sögulegar raðir, því SaaS-exportið
-- skilar þeim ekki lengur. Það myndi eyða því sem kafli 2 hér að ofan var að
-- endurheimta.
