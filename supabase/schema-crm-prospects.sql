-- Separate pre-account sales domain.
--
-- Prospect Organizations and Prospect Contacts are imported research targets.
-- They are not Companies, Buyer accounts, CRM account contacts, newsletter
-- recipients, or support-chat identities. Conversion requires an explicit
-- linked_company_id. Unknown consent never authorizes bulk marketing.

begin;

create table if not exists public.prospect_import_batches (
  id                    uuid primary key default gen_random_uuid(),
  source_sha256         text not null unique
                          check (source_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256       text not null
                          check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  source_generated_on   date not null,
  source_record_count   integer not null check (source_record_count >= 0),
  organization_count    integer not null check (organization_count >= 0),
  contact_count         integer not null check (contact_count >= 0),
  imported_by           text not null,
  imported_at           timestamptz not null default now(),
  verified_at           timestamptz
);

create table if not exists public.prospect_organizations (
  id                        uuid primary key default gen_random_uuid(),
  identity_key              text not null unique
                              check (identity_key ~ '^[0-9a-f]{64}$'),
  name                      text not null check (char_length(name) between 1 and 200),
  normalized_name           text not null check (char_length(normalized_name) between 1 and 200),
  segment                   text check (char_length(segment) <= 120),
  address                   text check (char_length(address) <= 300),
  city                      text check (char_length(city) <= 120),
  state                     text check (char_length(state) <= 64),
  postal_code               text check (char_length(postal_code) <= 32),
  location                  text check (char_length(location) <= 160),
  general_email             text check (char_length(general_email) <= 320),
  phone                     text check (char_length(phone) <= 64),
  website                   text check (char_length(website) <= 512),
  linkedin                  text check (char_length(linkedin) <= 512),
  status                    text not null default 'new'
                              check (status in ('new','researching','qualified','converted','archived')),
  priority                  text not null default 'unassigned'
                              check (priority in ('unassigned','low','normal','high')),
  marketing_consent         text not null default 'unknown'
                              check (marketing_consent in ('unknown','opted_in','opted_out')),
  marketing_consent_source  text,
  marketing_consent_at      timestamptz,
  outreach_status           text not null default 'unreviewed'
                              check (outreach_status in ('unreviewed','approved','blocked')),
  outreach_basis            text,
  outreach_reviewed_at      timestamptz,
  linked_company_id         uuid references public.companies(id) on delete set null,
  first_import_batch_id     uuid not null references public.prospect_import_batches(id),
  last_import_batch_id      uuid not null references public.prospect_import_batches(id),
  retention_review_at       date not null default (current_date + 365),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  check (
    (marketing_consent = 'unknown' and marketing_consent_source is null and marketing_consent_at is null)
    or
    (marketing_consent <> 'unknown' and marketing_consent_source is not null and marketing_consent_at is not null)
  ),
  check (
    (outreach_status = 'unreviewed' and outreach_basis is null and outreach_reviewed_at is null)
    or
    (outreach_status <> 'unreviewed' and outreach_basis is not null and outreach_reviewed_at is not null)
  ),
  check (status <> 'converted' or linked_company_id is not null)
);

create table if not exists public.prospect_contacts (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.prospect_organizations(id) on delete cascade,
  identity_key              text not null unique
                              check (identity_key ~ '^[0-9a-f]{64}$'),
  name                      text not null check (char_length(name) between 1 and 200),
  title                     text check (char_length(title) <= 160),
  email                     text check (char_length(email) <= 320),
  phone                     text check (char_length(phone) <= 64),
  linkedin                  text check (char_length(linkedin) <= 512),
  marketing_consent         text not null default 'unknown'
                              check (marketing_consent in ('unknown','opted_in','opted_out')),
  marketing_consent_source  text,
  marketing_consent_at      timestamptz,
  outreach_status           text not null default 'unreviewed'
                              check (outreach_status in ('unreviewed','approved','blocked')),
  outreach_basis            text,
  outreach_reviewed_at      timestamptz,
  needs_verification        boolean not null default false,
  first_import_batch_id     uuid not null references public.prospect_import_batches(id),
  last_import_batch_id      uuid not null references public.prospect_import_batches(id),
  retention_review_at       date not null default (current_date + 365),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  check (
    (marketing_consent = 'unknown' and marketing_consent_source is null and marketing_consent_at is null)
    or
    (marketing_consent <> 'unknown' and marketing_consent_source is not null and marketing_consent_at is not null)
  ),
  check (
    (outreach_status = 'unreviewed' and outreach_basis is null and outreach_reviewed_at is null)
    or
    (outreach_status <> 'unreviewed' and outreach_basis is not null and outreach_reviewed_at is not null)
  )
);

-- Provenance without copying source filenames, raw rows, notes, or contact PII.
create table if not exists public.prospect_source_records (
  import_batch_id           uuid not null references public.prospect_import_batches(id) on delete restrict,
  source_record_id          text not null check (char_length(source_record_id) between 1 and 80),
  record_type               text not null check (record_type in ('Organization','Person')),
  organization_id           uuid not null references public.prospect_organizations(id) on delete cascade,
  contact_id                uuid references public.prospect_contacts(id) on delete cascade,
  source_ids                text[] not null default '{}',
  created_at                timestamptz not null default now(),
  primary key (import_batch_id, source_record_id),
  check ((record_type = 'Organization' and contact_id is null) or (record_type = 'Person' and contact_id is not null))
);

create index if not exists prospect_organizations_status_idx
  on public.prospect_organizations (status, priority, updated_at desc)
  where deleted_at is null;
create index if not exists prospect_organizations_name_idx
  on public.prospect_organizations (normalized_name)
  where deleted_at is null;
create index if not exists prospect_organizations_retention_idx
  on public.prospect_organizations (retention_review_at)
  where deleted_at is null;
create index if not exists prospect_contacts_organization_idx
  on public.prospect_contacts (organization_id, name)
  where deleted_at is null;
create index if not exists prospect_contacts_email_idx
  on public.prospect_contacts (lower(email))
  where email is not null and deleted_at is null;
create index if not exists prospect_contacts_retention_idx
  on public.prospect_contacts (retention_review_at)
  where deleted_at is null;

alter table public.prospect_import_batches enable row level security;
alter table public.prospect_organizations enable row level security;
alter table public.prospect_contacts enable row level security;
alter table public.prospect_source_records enable row level security;

revoke all on table public.prospect_import_batches from public, anon, authenticated;
revoke all on table public.prospect_organizations from public, anon, authenticated;
revoke all on table public.prospect_contacts from public, anon, authenticated;
revoke all on table public.prospect_source_records from public, anon, authenticated;

grant select, insert, update, delete on table public.prospect_import_batches to service_role;
grant select, insert, update, delete on table public.prospect_organizations to service_role;
grant select, insert, update, delete on table public.prospect_contacts to service_role;
grant select, insert, update, delete on table public.prospect_source_records to service_role;

commit;
