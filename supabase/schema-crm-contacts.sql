-- CRM slice 4: contact-level records keyed to a company.
-- Additive + idempotent. Pooler-created tables need explicit service_role grants
-- (else inserts fail 42501). RLS on, no anon/authenticated policies (service-role
-- bypasses via grant), matching supabase/schema-crm.sql.

create table if not exists public.crm_contacts (
  id            bigint generated always as identity primary key,
  company_id    text not null,
  name          text not null,
  role          text not null default 'other'
                  check (role in ('procurement','plant_manager','maintenance','engineering','operations','accounts_payable','executive','other')),
  title         text,
  email         text,
  phone         text,
  is_primary    boolean not null default false,
  notes         text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  deleted_at    timestamptz
);
create index if not exists crm_contacts_company_idx on public.crm_contacts (company_id, is_primary desc, name);

alter table public.crm_contacts enable row level security;

grant all privileges on table public.crm_contacts to service_role;
grant usage, select on all sequences in schema public to service_role;
