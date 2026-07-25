-- MASEST content CMS foundation.
-- Staff writes through service-role Cloudflare Functions. Public pages consume generated snapshots.

create extension if not exists pgcrypto;

do $$ begin
  create type content_status as enum ('draft','published','archived');
exception when duplicate_object then null; end $$;

alter type content_status add value if not exists 'in_review';
alter type content_status add value if not exists 'changes_requested';
alter type content_status add value if not exists 'scheduled';

do $$ begin
  create type asset_status as enum ('available','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type technical_document_request_status as enum ('pending','approved','denied');
exception when duplicate_object then null; end $$;

create table if not exists public.content_entries (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  slug text not null,
  title text not null,
  status content_status not null default 'draft',
  locale text not null default 'en',
  payload jsonb not null,
  seo jsonb not null default '{}'::jsonb,
  version int not null default 1,
  published_at timestamptz,
  scheduled_at timestamptz,
  locked_by uuid references auth.users(id) on delete set null,
  locked_at timestamptz,
  review_note text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, slug, locale)
);

alter table public.content_entries
  add column if not exists scheduled_at timestamptz,
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz,
  add column if not exists review_note text;

create index if not exists content_entries_lookup_idx
  on public.content_entries (type, status, locale, slug);

create table if not exists public.content_revisions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.content_entries(id) on delete cascade,
  version int not null,
  status content_status not null,
  payload jsonb not null,
  seo jsonb not null default '{}'::jsonb,
  note text,
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entry_id, version)
);

create table if not exists public.content_assets (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  status asset_status not null default 'available',
  alt text not null,
  mime_type text,
  byte_size bigint,
  sha256 text,
  width int,
  height int,
  focal_point jsonb not null default '{}'::jsonb,
  usage jsonb not null default '[]'::jsonb,
  credit text,
  source_url text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.content_assets
  add column if not exists status asset_status not null default 'available',
  add column if not exists byte_size bigint,
  add column if not exists sha256 text,
  add column if not exists credit text,
  add column if not exists source_url text,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists content_assets_status_created_idx
  on public.content_assets (status, created_at desc);

create index if not exists content_assets_sha256_idx
  on public.content_assets (sha256)
  where sha256 is not null;

create table if not exists public.technical_documents (
  document_id text primary key,
  title text not null,
  document_type text not null check (document_type in ('sds','tds')),
  revision text not null,
  source_path text not null unique,
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  claim_status text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.technical_document_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  requester_email text,
  document_id text not null references public.technical_documents(document_id) on delete restrict,
  document_revision text not null,
  status technical_document_request_status not null default 'pending',
  requested_from text check (requested_from is null or length(requested_from) <= 500),
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_id, document_id, document_revision)
);

create index if not exists technical_document_requests_queue_idx
  on public.technical_document_requests (status, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('technical-documents', 'technical-documents', false, 26214400, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.content_entries enable row level security;
alter table public.content_revisions enable row level security;
alter table public.content_assets enable row level security;
alter table public.technical_documents enable row level security;
alter table public.technical_document_requests enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.content_entries to service_role;
grant select, insert, update, delete on public.content_revisions to service_role;
grant select, insert, update, delete on public.content_assets to service_role;
grant select, insert, update, delete on public.technical_documents to service_role;
grant select, insert, update, delete on public.technical_document_requests to service_role;
