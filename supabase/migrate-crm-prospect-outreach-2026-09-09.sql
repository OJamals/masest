-- Add manual one-to-one Prospect outreach workspace to an existing Prospect domain.
begin;

create table if not exists public.prospect_outreach_drafts (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.prospect_organizations(id) on delete cascade,
  contact_id                uuid references public.prospect_contacts(id) on delete set null,
  recipient_email           text not null check (char_length(recipient_email) between 3 and 320),
  subject                   text not null check (char_length(subject) between 1 and 180),
  body_text                 text not null check (char_length(body_text) between 1 and 8000),
  compliance_basis          text check (char_length(compliance_basis) <= 1000),
  source_url                text check (char_length(source_url) <= 1000),
  status                    text not null default 'draft'
                              check (status in ('draft','approved','sent','replied','opted_out','archived')),
  created_by                text not null check (char_length(created_by) between 1 and 200),
  approved_by               text check (char_length(approved_by) between 1 and 200),
  approved_at               timestamptz,
  sent_at                   timestamptz,
  replied_at                timestamptz,
  opted_out_at              timestamptz,
  archived_at               timestamptz,
  retention_review_at       date not null default (current_date + 365),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (source_url is null or source_url ~ '^https://'),
  check (status not in ('approved','sent','replied') or (approved_by is not null and approved_at is not null))
);

create index if not exists prospect_outreach_drafts_organization_idx
  on public.prospect_outreach_drafts (organization_id, created_at desc);
create index if not exists prospect_outreach_drafts_status_idx
  on public.prospect_outreach_drafts (status, updated_at desc)
  where status <> 'archived';

alter table public.prospect_outreach_drafts enable row level security;
revoke all on table public.prospect_outreach_drafts from public, anon, authenticated;
grant select, insert, update, delete on table public.prospect_outreach_drafts to service_role;

commit;
