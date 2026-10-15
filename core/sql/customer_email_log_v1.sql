-- ============================================================================
-- customer_email_log_v1 — hvaða sniðmát fór á hvern, hvenær og frá hverjum
-- 2026-10-15
--
-- Sniðmátspóstar (core/email.js emailTemplates_) eru sendir úr
-- /kpi/vidskiptavinur, einn í einu eða í magni („Senda vefkynningu“). Áður
-- var hvergi skráð að póstur hefði farið: sölumaður gat hringt daginn eftir
-- vefkynningu án þess að vita af henni, og sami viðskiptavinur gat fengið
-- sama póstinn tvisvar í magnsendingu.
--
-- GAS skrifar línu fyrir HVERN póst sem Gmail tók við (webapp.js,
-- logTemplateEmails_), með service_role. Lesendur:
--   * snertisagan (api.get_customer_touch_history_v1, vidskiptavinir_v1.sql)
--   * magnsendingin sjálf: sleppir viðskiptavini sem fékk sama sniðmát
--     síðustu 30 daga.
--
-- Keyra í Supabase SQL-ritlinum, Á UNDAN vidskiptavinir_v1.sql (snertisagan
-- les töfluna). Endurkeyranlegt.
-- ============================================================================

create table if not exists raw.customer_email_log (
  id                 bigint generated always as identity primary key,
  sent_at            timestamptz not null default now(),
  customer_id        text not null,
  customer_family_id text not null,   -- tölustafir customer_id, sami lykill og flöggin
  template           text not null,
  lang               text null,
  to_email           text not null,
  sent_by            text null,       -- netfang innskráðs starfsmanns ('key' = gamli lykillinn)
  batch_id           text null        -- sama gildi á öllum póstum einnar magnsendingar
);

create index if not exists idx_customer_email_log_family
  on raw.customer_email_log (customer_family_id, sent_at desc);
create index if not exists idx_customer_email_log_template
  on raw.customer_email_log (template, sent_at desc);

-- raw er sýnilegt í PostgREST: RLS á án stefna, aðeins service_role.
alter table raw.customer_email_log enable row level security;
revoke all on table raw.customer_email_log from public, anon, authenticated;
grant all privileges on table raw.customer_email_log to service_role;


-- ── PRÓFUN ──────────────────────────────────────────────────────────
-- Síðustu sendingar:
--   select sent_at, customer_id, template, to_email, sent_by, batch_id
--   from raw.customer_email_log order by sent_at desc limit 20;
