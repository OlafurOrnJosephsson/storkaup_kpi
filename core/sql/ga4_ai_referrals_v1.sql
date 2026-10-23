-- raw.ga4_ai_referrals_daily — umferð frá gervigreindarspjalli (2026-10-23)
--
-- AEO-mæling, fyrsta skref. GA4-lotur þar sem sessionSource er ChatGPT,
-- Perplexity, Copilot, Gemini, Claude o.fl., dag × uppruni × lendingarsíða,
-- með lotum, virkum lotum, pöntunum og veltu (m/VSK, eins og GA4 skilar).
--
-- v2 (ga4_ai_referrals_v2.sql) bætir new_vs_returning við — keyra hana líka.
--
-- Fyllt af syncGa4AiReferrals_v1 (core/ga4.js), sem keyrir með
-- scheduledGa4Sync_v1 á hverjum morgni (síðustu 35 dagar endurskrifaðir).
-- Afturfylling: backfillGa4AiReferrals_v1() einu sinni eftir að þetta er keyrt.
--
-- Fyrirvarar:
-- - Lágmarkstala. Öpp sem senda engan referrer lenda í „Direct“ í GA4.
-- - Pantanir/velta fyrir 2026-10-01 eru ekki sambærilegar (GTM v96/v97).
-- - Síunin (regex) er í GAS; nýr aðstoðarmaður → bæta við GA4_AI_SOURCE_REGEX_
--   og flokkuninni í view-inu hér að neðan.

create table if not exists raw.ga4_ai_referrals_daily (
  day              date        not null,
  session_source   text        not null,
  session_medium   text        not null,
  landing_page     text        not null,
  sessions         integer     not null default 0,
  engaged_sessions integer     not null default 0,
  transactions     integer     not null default 0,
  purchase_revenue numeric     not null default 0,
  synced_at        timestamptz not null default now(),
  primary key (day, session_source, session_medium, landing_page)
);

-- Sama og hinar raw-töflurnar: RLS á, engin anon/authenticated-réttindi.
alter table raw.ga4_ai_referrals_daily enable row level security;
revoke all on raw.ga4_ai_referrals_daily from public, anon, authenticated;
grant select, insert, update on raw.ga4_ai_referrals_daily to service_role;


-- Flokkun eftir aðstoðarmanni. Aðeins til fyrirspurna í ritlinum í bili —
-- ekki veitt authenticated fyrr en spjald á mælaborði þarf hana.
create or replace view mart.v_ai_referrals_daily as
select
  r.day,
  case
    when r.session_source ~ '(chatgpt\.com|openai\.com)' then 'ChatGPT'
    when r.session_source ~ 'perplexity'                 then 'Perplexity'
    when r.session_source ~ 'copilot\.microsoft'         then 'Copilot'
    when r.session_source ~ '(gemini|bard)\.google'      then 'Gemini'
    when r.session_source ~ 'claude\.ai'                 then 'Claude'
    else 'Annað'
  end as assistant,
  r.session_source,
  r.session_medium,
  r.landing_page,
  r.sessions,
  r.engaged_sessions,
  r.transactions,
  r.purchase_revenue
from raw.ga4_ai_referrals_daily r;

revoke all on mart.v_ai_referrals_daily from public, anon, authenticated;
grant select on mart.v_ai_referrals_daily to service_role;


-- ── VERIFY eftir backfillGa4AiReferrals_v1() ───────────────────────────────
-- 1. Mánuður × aðstoðarmaður:
--      select date_trunc('month', day)::date as man, assistant,
--             sum(sessions) lotur, sum(transactions) pantanir,
--             round(sum(purchase_revenue)) velta
--      from mart.v_ai_referrals_daily
--      group by 1, 2 order by 1 desc, 3 desc;
--
-- 2. Lendingarsíður síðustu 90 daga — hvaða efni gervigreindin vísar á:
--      select landing_page, sum(sessions) lotur, sum(transactions) pantanir
--      from mart.v_ai_referrals_daily
--      where day >= current_date - 90
--      group by 1 order by 2 desc limit 30;
--
-- 3. Hlutfall af allri umferð (raw.ga4_channel_daily_raw):
--      select a.man, a.ai, t.allt, round(100.0 * a.ai / nullif(t.allt, 0), 2) as pct
--      from (select date_trunc('month', day)::date man, sum(sessions) ai
--            from raw.ga4_ai_referrals_daily group by 1) a
--      join (select date_trunc('month', day)::date man, sum(sessions) allt
--            from raw.ga4_channel_daily_raw group by 1) t using (man)
--      order by 1 desc;
