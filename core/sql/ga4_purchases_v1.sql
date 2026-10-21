-- raw.ga4_purchases_raw — vefpantanir eins og GA4 sá þær (2026-10-21)
--
-- Magento API lokaðist 2026-10-21 (Hagar, PHP2Shell/BlockStrap) og
-- raw.newweb_orders_raw hætti að fyllast. GA4 purchase-taggið sendir
-- transaction_id, value (= grand_total m/VSK) og ISK, svo GA4 er brúin fyrir
-- vefsöluna á mælaborðinu þar til BC VEFUR kemur úr Databricks.
--
-- Kvörðun 1.–20. okt (ga4PurchaseCalibration_v1): GA4 náði 89,3% pantana og
-- 88,1% veltu; 721 af 721 pöruðum pöntunum með sömu upphæð og grand_total.
-- Hin ~2% sem pöruðust ekki eru gömul pöntunarnúmer (skoðun á eldri pöntun).
--
-- Taflan geymir það sem GA4 sagði, ósíað. Síun og uppreikningur koma í
-- view-i ofan á (seinni hluti, eftir að lifandi skilgreining
-- mart.v_web_daily_unified hefur verið sótt — hún er ekki í repoinu).
--
-- Fyllt af scheduledGa4PurchaseSync_v1 (core/ga4.js), á klukkutíma fresti.

create table if not exists raw.ga4_purchases_raw (
  transaction_id text primary key,
  purchase_day   date        not null,
  purchase_hour  smallint,
  revenue_incl   numeric     not null default 0,
  synced_at      timestamptz not null default now()
);

create index if not exists idx_ga4_purchases_raw_day
  on raw.ga4_purchases_raw (purchase_day);

-- Sama og hinar raw-töflurnar: RLS á, engin anon/authenticated-réttindi.
-- Lestur fer í gegnum security definer-föll / view; GAS skrifar sem service_role.
alter table raw.ga4_purchases_raw enable row level security;
revoke all on raw.ga4_purchases_raw from public, anon, authenticated;
grant select, insert, update on raw.ga4_purchases_raw to service_role;
