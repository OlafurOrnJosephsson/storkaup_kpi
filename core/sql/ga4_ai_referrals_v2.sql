-- raw.ga4_ai_referrals_daily v2 — nýr/endurkominn (2026-10-23)
--
-- Keyra á eftir ga4_ai_referrals_v1.sql. Bætir new_vs_returning í töfluna og
-- lykilinn, tæmir hana og endurskapar view-ið. Keyra svo
-- backfillGa4AiReferrals_v1() (core/ga4.js, main) til að fylla aftur.
--
-- Hvers vegna: GA4 gefur beinni lotu síðasta þekkta uppruna notandans.
-- Fastakúnni sem kom einu sinni úr ChatGPT ber „chatgpt.com“ áfram í seinni
-- heimsóknum. ga4AiReferrerCheck_v1 (2026-10-23), referrer á session_start
-- í AI-lotum frá jan. 2025:
--   storkaup.is (lota hófst aftur eftir hlé)   233  39 %  erfður uppruni
--   chatgpt/gemini/perplexity/claude              73  12 %  raunverulegur smellur
--   tómur, nýr notandi                           114  19 %  raunverulegt (app)
--   tómur, endurkominn                           169  29 %  óljóst
-- Nýr notandi getur ekki erft uppruna, svo new_vs_returning = 'new' er hreina
-- talan. Allar 20 pantanir í v1 voru hjá endurkomnum.

drop view if exists mart.v_ai_referrals_daily;

truncate raw.ga4_ai_referrals_daily;

alter table raw.ga4_ai_referrals_daily
  add column if not exists new_vs_returning text not null default '(not set)';

alter table raw.ga4_ai_referrals_daily drop constraint if exists ga4_ai_referrals_daily_pkey;
alter table raw.ga4_ai_referrals_daily
  add primary key (day, session_source, session_medium, landing_page, new_vs_returning);

create view mart.v_ai_referrals_daily as
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
  r.new_vs_returning,
  (r.new_vs_returning = 'new') as is_new_user,
  r.sessions,
  r.engaged_sessions,
  r.transactions,
  r.purchase_revenue
from raw.ga4_ai_referrals_daily r;

revoke all on mart.v_ai_referrals_daily from public, anon, authenticated;
grant select on mart.v_ai_referrals_daily to service_role;


-- ── VERIFY eftir backfillGa4AiReferrals_v1() ───────────────────────────────
-- Hrein tala (nýir notendur) á móti öllu, eftir mánuðum:
--   select date_trunc('month', day)::date man,
--          sum(sessions) filter (where is_new_user) nyir,
--          sum(sessions) allt,
--          sum(transactions) filter (where is_new_user) pant_nyir,
--          sum(transactions) pant_allt
--   from mart.v_ai_referrals_daily group by 1 order by 1 desc;
-- Vænt: nyir samtals um 170–180 frá jan. 2025, pant_nyir = 0 (staðan 2026-10-23).
