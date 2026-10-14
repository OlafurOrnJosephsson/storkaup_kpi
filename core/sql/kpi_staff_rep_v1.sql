-- ============================================================================
-- kpi_staff_rep_v1 — Google-innskráning ↔ sölumannsnafn (2026-10-15)
--
-- VANDINN: sölumenn eru auðkenndir með `name_norm` (t.d. solumadurhaddy) í
-- öllu sem skrifað hefur verið: assigned_rep_name_norm á forgangsflöggum,
-- updated_by á snertingum, „Ég er“-valið í vafranum. Innskráning á KPI-síðum
-- er hins vegar Google-netfang (síðan 2026-10-09). Ekkert tengdi þetta tvennt,
-- svo hver og einn þurfti að velja sig handvirkt.
--
-- LAUSNIN: netfangið TENGT við nafnið, ekki nafninu skipt út. Þá gildir allt
-- sem þegar er skráð áfram óbreytt. Að endurnefna væri hættulegt:
--   * name_norm þekkir líka pantanir sem sölumenn slá inn fyrir viðskiptavini
--     (is_rep_order í customer_priority_flags.sql);
--   * raw.sales_reps_ref er rifin niður og endurbyggð úr CUSTOMERS-blaðinu
--     (syncSalesRepsRefToSupabase_v1) — handbreyting þar þurrkast út.
--
-- Tengingin býr því í raw.kpi_staff_access, handstýrða aðgangslistanum
-- (kpi_auth_phase1.sql). Ein lína á starfsmann; samstilling snertir hana ekki.
--
-- Keyra í Supabase SQL-ritlinum: skref 1 og 2, svo skref 3 (tillaga), svo
-- fylla út skref 4 með réttum pörum. Endurkeyranlegt.
-- ============================================================================


-- ── 1. Dálkar ───────────────────────────────────────────────────────
alter table raw.kpi_staff_access
  add column if not exists rep_name_norm text null,   -- name_norm úr sales_reps_ref, solumadur*-formið
  add column if not exists display_name  text null;   -- fyrir þá sem eru ekki sölumenn


-- ── 2. „Hver er ég?“ ────────────────────────────────────────────────
-- Netfangið kemur úr JWT-inu sem gagnagrunnurinn hefur sjálfur sannreynt,
-- ekki úr vafranum.
--
-- LOGÍK, EKKI HANDAVINNA (2026-10-15). Sölumenn búa stundum til eigin
-- Magento-reikninga og nefna þá á mismunandi vegu (bjossisolumadur,
-- solumadurbjossi, storkauphaddy …). Svo:
--   1. raw.kpi_staff_access.rep_name_norm ef það er handstillt — undantekningin;
--   2. annars sölumannsreikningur í raw.sales_reps_ref með SAMA netfangi;
--   3. svo kanónískt form: öll nöfn sem eru eins án solumadur/storkaup eru
--      sama manneskja, og solumadur*-formið vinnur (það bera úthlutanirnar).
create or replace function api.get_my_staff_v1()
returns jsonb
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
  with me as (
    select lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) as email
  ),
  reps as (
    select r.name_norm,
           lower(btrim(r.email_norm)) as email_norm,
           regexp_replace(regexp_replace(lower(r.name_norm), 'solumadur|storkaup', '', 'g'), '[^a-z0-9]', '', 'g') as person_key
    from raw.sales_reps_ref r
    where coalesce(r.active, true) and btrim(coalesce(r.name_norm, '')) <> ''
  ),
  picked as (
    select coalesce(
             nullif(btrim(s.rep_name_norm), ''),
             -- 'vefur' er vefrásin, ekki manneskja (oj@ stendur á storkaupvefur).
             (select r.name_norm from reps r
              where r.email_norm = me.email and me.email <> '' and r.person_key not in ('', 'vefur')
              order by (r.name_norm like 'solumadur%') desc, r.name_norm limit 1)
           ) as rep,
           nullif(btrim(s.display_name), '') as display_name,
           me.email
    from me
    left join raw.kpi_staff_access s on s.email = me.email
  )
  select jsonb_build_object(
    'email',         p.email,
    'rep_name_norm', coalesce(
                       (select r2.name_norm from reps r1 join reps r2 on r2.person_key = r1.person_key
                        where r1.name_norm = p.rep and r1.person_key <> ''
                        order by (r2.name_norm like 'solumadur%') desc, r2.name_norm limit 1),
                       p.rep),
    'display_name',  p.display_name
  )
  from picked p;
$function$;

revoke all on function api.get_my_staff_v1() from public, anon;
grant execute on function api.get_my_staff_v1() to authenticated, service_role;

notify pgrst, 'reload schema';


-- ── 3. Gamli sölumannalistinn + tillaga að pörum (les aðeins) ───────
-- raw.sales_reps_ref er endurbyggð úr Magento-notendum „Sölumaður - X“
-- (CUSTOMERS-blaðið) og vefpöntunum. Hún hleypir aðeins @storkaup.is og
-- @example.com netföngum í gegn (isAllowedRepEmailForRef_), svo @storkaup.is
-- netfang þar er sterkasta vísbendingin. Nafnagisk er varaleið:
-- „haddy“ ≠ „haraldur“.
--
-- 3a. Hver sölumaður, með netfangi ef það er raunverulegt, og hvort hann er
--     þegar á aðgangslistanum (getur skráð sig inn) og tengdur:
select r.name_norm,
       nullif(r.email_norm, '')                               as netfang_i_magento,
       a.email                                                as a_adgangslista,
       a.rep_name_norm                                        as tengdur_vid,
       r.notes
from raw.sales_reps_ref r
left join raw.kpi_staff_access a
       on a.email = lower(r.email_norm) and r.email_norm like '%@storkaup.is'
where coalesce(r.active, true)
order by regexp_replace(regexp_replace(lower(r.name_norm), 'solumadur|storkaup', '', 'g'), '[^a-z0-9]', '', 'g'),
         r.name_norm;

-- 3b. Hver á aðgangslistanum, með tillögu: fyrst netfang sem stendur á
--     sölumanni, annars nafnagisk.
select a.email,
       a.note,
       a.rep_name_norm                                  as nuverandi,
       coalesce(
         (select r.name_norm from raw.sales_reps_ref r
          where coalesce(r.active, true) and lower(r.email_norm) = a.email
          order by (r.name_norm like 'solumadur%') desc limit 1),
         (select r.name_norm from raw.sales_reps_ref r
          where coalesce(r.active, true)
            and regexp_replace(regexp_replace(lower(r.name_norm), 'solumadur|storkaup', '', 'g'), '[^a-z0-9]', '', 'g')
                = regexp_replace(lower(split_part(a.email, '@', 1)), '[^a-z0-9]', '', 'g')
          order by (r.name_norm like 'solumadur%') desc limit 1)
       )                                                as tillaga
from raw.kpi_staff_access a
order by a.email;

-- ATH: sölumaður sem er EKKI á raw.kpi_staff_access getur ekki skráð sig
-- inn á KPI-síðurnar yfirhöfuð. Bættu honum við með rep_name_norm í einu:
--   insert into raw.kpi_staff_access (email, note, rep_name_norm)
--   values ('nafn@storkaup.is', 'sölumaður', 'solumadurnafn')
--   on conflict (email) do update set rep_name_norm = excluded.rep_name_norm;


-- ── 4. Handstilling (AÐEINS undantekningar) ─────────────────────────
-- Skref 2 finnur sölumann sjálft út frá netfanginu. Handstillið aðeins þá
-- sem logíkin nær ekki: netfang sem stendur ekki á neinum sölumannsreikningi,
-- eða reikning sem bendir á rangan mann (oj@ stendur á `storkaupvefur`,
-- vefrásinni). Notið solumadur*-formið.
--
-- update raw.kpi_staff_access set rep_name_norm = 'solumadurhaddy' where email = 'haddy@storkaup.is';
-- update raw.kpi_staff_access set rep_name_norm = 'solumadurbjossi' where email = '...@storkaup.is';
--
-- Starfsmaður sem er ekki sölumaður má fá birtingarnafn í staðinn:
-- update raw.kpi_staff_access set display_name = 'Ólafur' where email = 'oj@storkaup.is';
--
-- Prófun (sem innskráður notandi í vafranum, ekki í ritlinum — þar er
-- ekkert JWT og email kemur tómt):
--   select api.get_my_staff_v1();
