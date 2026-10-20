-- ============================================================================
-- Greiðsluskilmálar viðskiptamanna (2026-10-20)
--
-- 'Kóði greiðsluskilmála' bætt við Viðskiptamenn-exportið úr BC. Gildin:
-- LM+10D, LM+25D, LM+30D … (reikningsviðskipti), SJUKRA (Sjúkratryggingar),
-- 0D, og TÓMT = staðgreiðsla (sniðmátið STGR skilur reitinn eftir tóman, sjá
-- leiðbeiningar bókhalds um stofnun viðskiptamanns). Sker hreinna úr um
-- staðgreiðslu en -1 í credit_limit.
--
-- Lesandi: creditinfoUrtak_v1 (admin/creditinfo.js) — úrtak fyrir prófun
-- Snjallákvörðunar Creditinfo.
--
-- RÖÐ: keyrðu þetta FYRST, svo BC Sync úr valmyndinni. Innlesturinn sendir
-- payment_terms_code; án dálksins hafnar PostgREST allri viðskiptamannaskránni
-- (PGRST204). Viðskiptamenn eru alltaf full upsert (merge á company_id), svo
-- dálkurinn fyllist í öllum röðum í fyrstu keyrslu — engin force þarf.
-- ============================================================================

alter table raw.bc_customers_raw
  add column if not exists payment_terms_code text;

comment on column raw.bc_customers_raw.payment_terms_code is
  'Kóði greiðsluskilmála úr BC. Tómt = staðgreiðsla (STGR). Kom í exportið 2026-10-20.';

notify pgrst, 'reload schema';


-- ── VERIFY (eftir BC Sync) ──────────────────────────────────────────────────
-- Exportið 2026-10-20 hafði 6.519 viðskiptamenn: LM+25D 2.490, LM+10D 1.982,
-- SJUKRA 1.051, tómt 777, 0D 134.

select coalesce(payment_terms_code, '(tómt)') as greidsluskilmalar,
       count(*)                                as vidskiptamenn,
       count(*) filter (where credit_limit = -1) as med_minus_einn,
       count(*) filter (where arrears > 0)       as i_vanskilum
from   raw.bc_customers_raw
group  by 1
order  by 2 desc;
