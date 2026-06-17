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

create index if not exists quotes_status_idx  on public.quotes (status, created_at desc);
create index if not exists quotes_created_idx on public.quotes (created_at desc);

-- Reads/writes go through the service-role key (bypasses RLS). Enable RLS with NO policies
-- so anon/auth roles can never touch leads directly.
alter table public.quotes enable row level security;

-- Privilege grants. Tables created via raw SQL (pooler, as role `postgres`) skip Supabase's
-- auto-grant event trigger, so service_role hits "permission denied" (42501) on insert —
-- BYPASSRLS does NOT bypass table-level privileges. RLS above (no policies) still blocks
-- anon/authenticated at the row level even with the grant.
grant all on table public.quotes to anon, authenticated, service_role;
