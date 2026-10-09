-- ============================================================================
-- KPI-innskráning, áfangi 1 — aðgangslisti + heimildir fyrir innskráða.
--
-- HVAÐ: starfsmenn skrá sig inn með Google (@storkaup.is, OAuth client stilltur
-- "Internal") í gegnum Supabase Auth; Webflow/auth.js sendir token notandans í
-- stað anon-lykilsins. Þessi skrá:
--   1. býr til aðgangslista (raw.kpi_staff_access) — aðeins netföng á honum
--      geta stofnað aðgang;
--   2. trigger á auth.users sem hafnar öllum öðrum við stofnun;
--   3. gefur `authenticated` les-/skrifheimildir á allt sem anon notar í dag.
--
-- ÖRUGGT AÐ KEYRA STRAX: liður 3 bætir aðeins við heimildum; anon heldur
-- sínum þar til kpi_auth_revoke_anon.sql keyrir (eftir að innskráning er
-- staðfest á öllum síðum). Endurkeyranleg.
--
-- Listinn yfir hluti kemur úr mælingunni 2026-10-08
-- (core/sql/_audit_output/2026-10-08_anon_exposure.md, Q1 + Q2).
-- ============================================================================


-- ── 1. Aðgangslisti ─────────────────────────────────────────────────────────
create table if not exists raw.kpi_staff_access (
  email      text primary key check (email = lower(btrim(email))),
  note       text null,
  added_at   timestamptz not null default now()
);
alter table raw.kpi_staff_access enable row level security;
revoke all on table raw.kpi_staff_access from public, anon, authenticated;
grant all privileges on table raw.kpi_staff_access to service_role;

-- Fyrstu notendurnir. Bætið við með:
--   insert into raw.kpi_staff_access (email, note) values ('nafn@storkaup.is', 'sölumaður');
insert into raw.kpi_staff_access (email, note) values
  ('oj@storkaup.is', 'eigandi kerfisins')
on conflict (email) do nothing;


-- ── 2. Hafna öllum sem eru ekki á listanum, við stofnun aðgangs ────────────
-- "Internal" í Google hleypir öllum í Workspace inn; þessi trigger þrengir það
-- að listanum. Hann hafnar líka öllum öðrum leiðum (netfang/lykilorð o.s.frv.),
-- svo stilling sem gleymist í Supabase opnar ekki bakdyr.
--
-- ATH: fjarlæging af listanum lokar ekki aðgangi sem er þegar til. Til að
-- loka á starfsmann: eyðið honum líka í Supabase → Authentication → Users
-- (eða lokið Google-aðganginum, sem stoppar næstu innskráningu).
create or replace function raw.kpi_reject_unlisted_user_()
returns trigger
language plpgsql
security definer
set search_path to 'raw', 'public', 'pg_temp'
as $function$
begin
  if not exists (
    select 1 from raw.kpi_staff_access a
    where a.email = lower(btrim(coalesce(new.email, '')))
  ) then
    raise exception 'KPI: % er ekki á aðgangslista', coalesce(new.email, '(ekkert netfang)')
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function raw.kpi_reject_unlisted_user_() from public, anon, authenticated;

drop trigger if exists trg_kpi_reject_unlisted_user on auth.users;
create trigger trg_kpi_reject_unlisted_user
  before insert on auth.users
  for each row execute function raw.kpi_reject_unlisted_user_();


-- ── 3. `authenticated` fær það sem anon hefur (ekkert er tekið af anon hér) ──
-- Föll (Q1). Skrif-föllin sjö eru með; RLS á grunntöflunum er óbreytt.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api', 'public', 'mart')
      and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
    raise notice 'grant execute → authenticated: %', f.sig;
  end loop;
end $$;

-- Töflur / view / matview (Q2) — aðeins SELECT, því anon hefur engin skrif.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm')
      and n.nspname in ('api', 'public', 'mart')
      and has_table_privilege('anon', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'select')
  loop
    execute format('grant select on %I.%I to authenticated', r.nspname, r.relname);
    raise notice 'grant select → authenticated: %.%', r.nspname, r.relname;
  end loop;
end $$;

notify pgrst, 'reload schema';


-- ── STAÐFESTING ─────────────────────────────────────────────────────────────
-- Á að skila 0 / 0: ekkert sem anon nær í sem authenticated nær ekki í.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api','public','mart') and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')) as fn_gap,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p','v','m') and n.nspname in ('api','public','mart')
      and has_table_privilege('anon', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'select')) as rel_gap;
