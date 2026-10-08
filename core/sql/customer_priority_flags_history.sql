-- Saga forgangsflagga — raw.customer_priority_flags_history (2026-10-08)
--
-- VANDINN: raw.customer_priority_flags_raw er ein lína á viðskiptavin sem er
-- yfirskrifuð í stað. Þrjár leiðir eyddu gögnum óafturkræft:
--   1. api.set_customer_priority_flag með tómri stöðu → DELETE á línunni,
--      með athugasemd, sölumanni, snertidegi og eftirfylgni. Opið anon.
--   2. importPriorityFlagsFromSheet_v1 (core/utils.js) með replaceAll=true
--      (sjálfgefið) → DELETE á ÖLLUM línum gegnum REST.
--   3. Hver UPDATE — log_customer_priority_touch yfirskrifar athugasemd,
--      úthlutun yfirskrifar sölumann — án þess að fyrra gildið sé geymt.
--
-- LAUSNIN: AFTER UPDATE OR DELETE trigger sem afritar gömlu línuna hingað.
-- Valið fram yfir „mjúka eyðingu“ (status = null í stað DELETE) vegna þess að
-- sex lesendur túlka „lína til = flaggaður“: api.get_customer_priority_flags,
-- web_activation.sql og þrjár Webflow-síður (forgangslisti, customer-profiles,
-- activation). Mjúk eyðing hefði kallað á breytingu í þeim öllum og nýja
-- Webflow-pinna. Trigger breytir engu sem lesendur sjá og grípur allar þrjár
-- leiðirnar, líka þær sem fara framhjá RPC-föllunum.
--
-- Keyrist einu sinni í Supabase SQL-ritlinum. Endurkeyranleg.

create table if not exists raw.customer_priority_flags_history (
  history_id         bigint generated always as identity primary key,
  changed_at         timestamptz not null default now(),
  op                 text not null check (op in ('UPDATE', 'DELETE')),
  -- 'anon' = Webflow-síða, 'service_role' = GAS, annað = SQL-ritill o.þ.h.
  -- Segir HVAÐAN, ekki HVER: allar Webflow-síður deila anon-lyklinum.
  via_role           text null,
  customer_family_id text not null,
  old_row            jsonb not null,
  new_row            jsonb null
);

create index if not exists idx_customer_priority_flags_history_customer
  on raw.customer_priority_flags_history (customer_family_id, changed_at desc);

-- raw er sýnilegt í PostgREST (GAS les þaðan), svo lokað er beint:
-- RLS á án stefna, og engin réttindi nema service_role.
alter table raw.customer_priority_flags_history enable row level security;
revoke all on table raw.customer_priority_flags_history from public, anon, authenticated;
grant all privileges on table raw.customer_priority_flags_history to service_role;


create or replace function raw.customer_priority_flags_audit_()
returns trigger
language plpgsql
security definer
set search_path to 'raw', 'public', 'pg_temp'
as $function$
declare
  v_role text;
begin
  -- PostgREST setur request.jwt.claims; í SQL-ritlinum er hún ekki til.
  -- Gölluð stilling má aldrei fella skriftina sem kveikti á triggernum.
  begin
    v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  exception when others then
    v_role := null;
  end;
  v_role := coalesce(v_role, session_user::text);

  if tg_op = 'UPDATE' then
    -- Skrift sem breytir engu nema updated_at (t.d. sama staða send aftur)
    -- er ekki saga. Án þessarar síu fylltist taflan af tvíteknum línum.
    if (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
      return new;
    end if;
    insert into raw.customer_priority_flags_history
      (op, via_role, customer_family_id, old_row, new_row)
    values
      ('UPDATE', v_role, old.customer_family_id, to_jsonb(old), to_jsonb(new));
    return new;
  end if;

  insert into raw.customer_priority_flags_history
    (op, via_role, customer_family_id, old_row, new_row)
  values
    ('DELETE', v_role, old.customer_family_id, to_jsonb(old), null);
  return old;
end;
$function$;

-- Trigger-fall á ekki að vera kallanlegt sem RPC.
revoke all on function raw.customer_priority_flags_audit_() from public, anon, authenticated;

drop trigger if exists trg_customer_priority_flags_audit on raw.customer_priority_flags_raw;
create trigger trg_customer_priority_flags_audit
  after update or delete on raw.customer_priority_flags_raw
  for each row execute function raw.customer_priority_flags_audit_();


-- ── STAÐFESTING (keyrið eftir uppsetningu) ──────────────────────────────────
-- Á að skila einni línu: trg_customer_priority_flags_audit, enabled = 'O'.
--
--   select tgname, tgenabled
--   from pg_trigger
--   where tgrelid = 'raw.customer_priority_flags_raw'::regclass
--     and not tgisinternal;
--
-- Hvorki anon né authenticated á að ná í söguna (bæði false):
--
--   select has_table_privilege('anon', 'raw.customer_priority_flags_history', 'select') as anon,
--          has_table_privilege('authenticated', 'raw.customer_priority_flags_history', 'select') as authenticated;
--
-- Engin TRUNCATE-grip: triggerinn sér aðeins UPDATE og DELETE. Ef
-- importPriorityFlagsFromSheet_v1 færi einhvern tíma úr REST DELETE yfir í
-- TRUNCATE myndi sagan missa af því þegjandi.


-- ── ENDURHEIMT (handvirkt) ─────────────────────────────────────────────────
-- Síðasta eydda lína viðskiptavinar, eins og hún var:
--
--   insert into raw.customer_priority_flags_raw
--   select (jsonb_populate_record(null::raw.customer_priority_flags_raw, h.old_row)).*
--   from raw.customer_priority_flags_history h
--   where h.customer_family_id = '<kennitala>'
--     and h.op = 'DELETE'
--   order by h.changed_at desc
--   limit 1
--   on conflict (customer_family_id) do nothing;
--
-- Saga eins viðskiptavinar:
--
--   select changed_at, op, via_role,
--          old_row->>'status' as status, old_row->>'note' as note,
--          old_row->>'assigned_rep_name_norm' as rep
--   from raw.customer_priority_flags_history
--   where customer_family_id = '<kennitala>'
--   order by changed_at desc;
