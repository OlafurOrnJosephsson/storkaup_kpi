-- Reference table for sales rep matching in dashboard_compat.
-- Keep this list curated (name/email normalized) for stable salesRep/selfServe metrics.

create schema if not exists raw;

create table if not exists raw.sales_reps_ref (
  id bigserial primary key,
  name_norm text not null default '',
  email_norm text not null default '',
  active boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sales_reps_ref_name_norm
  on raw.sales_reps_ref (name_norm)
  where name_norm <> '';

create unique index if not exists uq_sales_reps_ref_email_norm
  on raw.sales_reps_ref (email_norm)
  where email_norm <> '';

grant usage on schema raw to authenticated, service_role;
grant select on table raw.sales_reps_ref to authenticated;
grant all privileges on table raw.sales_reps_ref to service_role;

-- Optional helper to upsert reps from a values list.
-- Replace sample rows with your 18 reps (normalized name/email).
-- Name normalization rule should match dashboard_compat:
-- lower + translate(áðþæöéíóúý -> adthaeoeiouy) + remove non [a-z0-9].
insert into raw.sales_reps_ref (name_norm, email_norm, active, notes)
values
  ('', '', true, 'replace with curated sales reps')
on conflict do nothing;
