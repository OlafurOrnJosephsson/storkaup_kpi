-- Restore anon EXECUTE on priority-flag WRITE RPCs (2026-06-03).
--
-- Context: these were revoked in security_revoke_anon_writes.sql (2026-06-01) as
-- part of a broad anon-write lockdown. However, customer_priority_flags_raw stores
-- internal sales-workflow data only (no BC financials, no PII beyond customer IDs
-- already readable via the read RPCs). The table is Storkaup-created, not sourced
-- from BC. IP-allowlisting the REST API is not supported by Supabase natively, so
-- the net risk of restoring these grants is low until Supabase Auth lands (Phase 3).

grant execute on function api.set_customer_priority_flag(text, text, text, text)   to anon;
grant execute on function api.assign_customer_priority_rep(text, text)             to anon;
grant execute on function api.bulk_set_customer_priority_flags(text[], text, text) to anon;
