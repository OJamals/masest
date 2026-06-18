-- supabase/schema-email.sql — email delivery log + suppression list.
-- Apply via Supabase SQL editor / pooler. Service-role auto-grant does NOT fire for
-- new tables (see schema-phase5.sql), so the grants below are required.

create table if not exists public.email_events (
  id          uuid primary key default gen_random_uuid(),
  resend_id   text,
  to_email    text not null,
  category    text,
  subject     text,
  status      text not null default 'sent',
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists email_events_resend_id_idx on public.email_events (resend_id);
create index if not exists email_events_to_email_idx on public.email_events (to_email);
create index if not exists email_events_created_at_idx on public.email_events (created_at desc);

create table if not exists public.email_suppressions (
  email       text primary key,
  reason      text not null,
  created_at  timestamptz not null default now()
);

-- ---------- GRANTS (service-role auto-grant does not fire for new tables) ----------
grant all privileges on public.email_events, public.email_suppressions to service_role;
grant usage, select on all sequences in schema public to service_role;
