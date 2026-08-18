-- schema-quotes.sql — inbound contact/quote requests captured by POST /api/quote.
-- Replaces the third-party (Formspree) form handler: leads now live in our own DB,
-- surface in the admin Quotes tab, and trigger Resend (sales notify + buyer autoreply).
-- Apply once via the pooler (psql) or the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.quotes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  type        text not null default 'quote',     -- quote | audit | sample | distributor | technical | …
  name        text,
  email       text,
  company     text,
  phone       text,
  product     text,
  industry    text,
  location    text,
  message     text,
  payload     jsonb not null default '{}'::jsonb, -- full submission (volume, timeline, samples, ship_to, …)
  source      text default 'contact',
  status      text not null default 'new',        -- new | contacted | closed | spam
  notes       text,                               -- internal staff notes
  handled_at  timestamptz,
  handled_by  text
);

alter table public.quotes add column if not exists intake_id uuid;
alter table public.quotes add column if not exists intake_fingerprint text;

do $$ begin
  alter table public.quotes add constraint quotes_intake_identity_shape_chk check (
    (intake_id is null and intake_fingerprint is null)
    or (intake_id is not null and intake_fingerprint ~ '^[a-f0-9]{64}$')
  );
exception when duplicate_object then null; end $$;

create index if not exists quotes_status_idx  on public.quotes (status, created_at desc);
create index if not exists quotes_created_idx on public.quotes (created_at desc);
drop index if exists public.quotes_open_requisition_unique_idx;
create unique index quotes_open_requisition_unique_idx
  on public.quotes ((payload ->> 'requisition_id'))
  where source = 'requisition'
    and status not in ('closed', 'spam')
    and coalesce(payload ->> 'offer_status', '') not in ('declined', 'expired', 'ordered')
    and payload ? 'requisition_id';
create unique index if not exists quotes_intake_id_unique_idx
  on public.quotes (intake_id)
  where intake_id is not null;

alter table public.quotes add column if not exists priority text default 'normal';
alter table public.quotes add column if not exists next_step text;
alter table public.quotes add column if not exists due_at timestamptz;
alter table public.quotes add column if not exists lead_score integer default 0;
alter table public.quotes add column if not exists assigned_to text;
alter table public.quotes add column if not exists assigned_at timestamptz;

create index if not exists quotes_status_priority_due_idx
  on public.quotes (status, priority, due_at, created_at desc);

-- Reads/writes go through the service-role key (bypasses RLS). Enable RLS with NO policies
-- so anon/auth roles can never touch leads directly.
alter table public.quotes enable row level security;

-- Privilege grants. Tables created via raw SQL (pooler, as role `postgres`) skip Supabase's
-- auto-grant event trigger, so service_role hits "permission denied" (42501) on insert —
-- BYPASSRLS does NOT bypass table-level privileges. Public submissions go through
-- /api/quote with the service-role client, so browser roles do not need table grants.
revoke all on table public.quotes from anon, authenticated;
grant all on table public.quotes to service_role;
