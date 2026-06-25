-- CRM contact-view slice 1: polymorphic notes + tasks on a company or quote.
-- Additive + idempotent. Pooler-created tables need explicit service_role grants
-- (else inserts fail 42501). RLS on, no anon/authenticated policies (service-role
-- bypasses via grant), matching supabase/schema-audit-log.sql.

create table if not exists public.crm_notes (
  id            bigint generated always as identity primary key,
  subject_type  text not null check (subject_type in ('company','quote')),
  subject_id    text not null,
  kind          text not null default 'note' check (kind in ('note','call','email','meeting')),
  body          text not null,
  created_by    text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists crm_notes_subject_idx on public.crm_notes (subject_type, subject_id, created_at desc);

create table if not exists public.crm_tasks (
  id            bigint generated always as identity primary key,
  subject_type  text not null check (subject_type in ('company','quote')),
  subject_id    text not null,
  title         text not null,
  due_at        timestamptz,
  assigned_to   text,
  status        text not null default 'open' check (status in ('open','done')),
  created_by    text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  completed_by  text
);
create index if not exists crm_tasks_subject_idx on public.crm_tasks (subject_type, subject_id);
create index if not exists crm_tasks_status_due_idx on public.crm_tasks (status, due_at);

alter table public.crm_notes enable row level security;
alter table public.crm_tasks enable row level security;

grant all privileges on table public.crm_notes to service_role;
grant all privileges on table public.crm_tasks to service_role;
grant usage, select on all sequences in schema public to service_role;
