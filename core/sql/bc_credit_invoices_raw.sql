-- Raw BC credit invoices table for GAS incremental sync.
-- Mirrors the key shape of raw.bc_invoices_raw so net logic can be built consistently.

create schema if not exists raw;

create table if not exists raw.bc_credit_invoices_raw (
  document_no text primary key,
  company_id text null,
  external_doc_no text null,
  company_name text null,
  currency text null,
  due_date timestamptz null,
  order_date timestamptz null,
  email text null,
  amount_excl numeric(18, 2) null,
  amount_incl numeric(18, 2) null,
  salesperson_code text null,
  remaining_amount numeric(18, 2) null,
  location_code text null,
  printed text null,
  closed text null,
  canceled text null,
  corrective text null,
  rsm_provider text null,
  rsm_date timestamptz null,
  source text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_bc_credit_invoices_raw_order_date
  on raw.bc_credit_invoices_raw (order_date);

create index if not exists idx_bc_credit_invoices_raw_company_id
  on raw.bc_credit_invoices_raw (company_id);

grant usage on schema raw to authenticated, service_role;
grant select on table raw.bc_credit_invoices_raw to authenticated;
grant all privileges on table raw.bc_credit_invoices_raw to service_role;
