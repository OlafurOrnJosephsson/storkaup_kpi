-- ============================================================================
-- customer_not_web_v1 — „Ekki vefkúnni“ (2026-10-15)
--
-- Sumir viðskiptavinir panta ALDREI á vefnum, og það er ekki vegna þess að
-- enginn hafi talað við þá: þeir hafa eigið innkaupa-/pöntunarkerfi (EDI),
-- eru bundnir útboði eða rammasamningi, eða vilja það einfaldlega ekki.
-- Landspítali og heilbrigðisstofnanirnar raða sér efst á alla tækifæralista
-- (LHFS, „Panta í afgreiðslu“) og myndu gera það að eilífu.
--
-- Merkingin býr í raw.customer_priority_flags_raw, ekki í sér töflu:
--   * status verður 'nonpriority' — allar síður lesa „ekki forgangur“ eins;
--   * sögutriggerinn (customer_priority_flags_history.sql) grípur breytinguna
--     með actor_email/actor_name, svo „hver merkti og hvenær“ er skráð;
--   * get_customer_touch_history_v1 sýnir hana í snertisögunni.
-- Sér dálkar (not_web_reason, not_web_note) svo að snerting með athugasemd
-- yfirskrifi ekki ástæðuna — `note` er snertiathugasemdin.
--
-- Keyra í Supabase SQL-ritlinum, Á EFTIR kpi_staff_rep_v1.sql og
-- customer_priority_flags_history.sql. Endurkeyranlegt.
-- ============================================================================


-- ── 1. Dálkar ───────────────────────────────────────────────────────
alter table raw.customer_priority_flags_raw
  add column if not exists not_web_reason text null,
  add column if not exists not_web_note   text null,
  add column if not exists not_web_at     timestamptz null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_priority_flags_not_web_reason_chk') then
    alter table raw.customer_priority_flags_raw
      add constraint customer_priority_flags_not_web_reason_chk
      check (not_web_reason is null or not_web_reason in ('eigid_kerfi', 'utbod', 'vill_ekki', 'annad'));
  end if;
end $$;


-- ── 2. Merkja / afturkalla ──────────────────────────────────────────
-- p_reason null eða '' = afturkalla. Afturköllun breytir EKKI stöðunni:
-- viðskiptavinurinn er áfram „ekki forgangur“ þar til einhver setur hann í
-- forgang. Viðmótið afturkallar sjálft á undan „Setja í forgang“.
create or replace function api.set_customer_not_web_v1(
  p_customer_id   text,
  p_reason        text,
  p_note          text default null,
  p_customer_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'api', 'raw', 'public'
as $function$
declare
  v_raw    text := trim(coalesce(p_customer_id, ''));
  v_norm   text := regexp_replace(v_raw, '\D', '', 'g');
  v_key    text;
  v_reason text := nullif(lower(btrim(coalesce(p_reason, ''))), '');
begin
  if v_raw = '' then
    raise exception 'p_customer_id is required';
  end if;
  v_key := case when v_norm <> '' then v_norm else lower(v_raw) end;

  if v_reason is null then
    update raw.customer_priority_flags_raw f
    set not_web_reason = null, not_web_note = null, not_web_at = null, updated_at = now()
    where f.customer_family_id = v_key and f.not_web_reason is not null;
    return jsonb_build_object('ok', true, 'customer_family_id', v_key, 'not_web_reason', null);
  end if;

  if v_reason not in ('eigid_kerfi', 'utbod', 'vill_ekki', 'annad') then
    raise exception 'p_reason must be eigid_kerfi, utbod, vill_ekki or annad';
  end if;

  insert into raw.customer_priority_flags_raw (
    customer_family_id, customer_id, customer_name, status,
    not_web_reason, not_web_note, not_web_at, updated_at
  ) values (
    v_key, nullif(v_raw, ''), nullif(btrim(coalesce(p_customer_name, '')), ''), 'nonpriority',
    v_reason, nullif(btrim(coalesce(p_note, '')), ''), now(), now()
  )
  on conflict (customer_family_id) do update set
    status         = 'nonpriority',
    customer_name  = coalesce(raw.customer_priority_flags_raw.customer_name, excluded.customer_name),
    not_web_reason = excluded.not_web_reason,
    not_web_note   = excluded.not_web_note,
    not_web_at     = now(),
    updated_at     = now();

  return jsonb_build_object('ok', true, 'customer_family_id', v_key, 'not_web_reason', v_reason);
end;
$function$;


-- ── 3. Lesa ─────────────────────────────────────────────────────────
-- Lítið og sérstakt svo api.get_customer_priority_flags þurfi ekki að falla
-- og endurskapast (forgangslisti.js les það).
create or replace function api.get_not_web_customers_v1()
returns table (
  customer_family_id text,
  customer_id        text,
  not_web_reason     text,
  not_web_note       text,
  not_web_at         timestamptz
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
  select f.customer_family_id, f.customer_id, f.not_web_reason, f.not_web_note, f.not_web_at
  from raw.customer_priority_flags_raw f
  where f.not_web_reason is not null;
$function$;

revoke all on function api.set_customer_not_web_v1(text, text, text, text) from public, anon;
revoke all on function api.get_not_web_customers_v1()                      from public, anon;
grant execute on function api.set_customer_not_web_v1(text, text, text, text) to authenticated, service_role;
grant execute on function api.get_not_web_customers_v1()                      to authenticated, service_role;

notify pgrst, 'reload schema';


-- ── PRÓFUN ──────────────────────────────────────────────────────────
-- select * from api.get_not_web_customers_v1();
-- Í ritlinum (ekkert JWT) merkir sagan engan sem geranda — prófaðu í vafra.
