-- MASEST commerce — Phase 5 schema (dashboards: messaging, notifications, stock, offers, traffic).
-- ADDITIVE migration. Run in Supabase SQL editor AFTER schema.sql. Safe to re-run (guarded).
-- The Phase-5 functions degrade gracefully if this has not been applied yet (they return empty
-- sets / clear errors rather than 500s), so deploying functions before this runs will not crash.

-- ---------- column additions ----------
-- Stock tracking (admin sets; checkout/webhook may decrement when track_stock = true).
alter table public.products         add column if not exists stock        int;
alter table public.products         add column if not exists track_stock  boolean not null default false;
alter table public.products         add column if not exists image_url    text;
alter table public.products         add column if not exists photo_alt    text;
alter table public.product_variants add column if not exists stock        int;
alter table public.product_variants add column if not exists track_stock  boolean not null default false;

-- Stripe customer for the company → saved payment methods via Stripe Billing Portal (SAQ-A safe).
alter table public.companies add column if not exists stripe_customer_id text;

-- Platform-staff flag. NOTE: the AUTHORITATIVE admin gate is the ADMIN_EMAILS env var checked in
-- functions/_lib/supabase.js requireStaff(). This column only mirrors it for convenient reads/RLS.
alter table public.profiles add column if not exists is_staff boolean not null default false;

-- ---------- enums ----------
do $$ begin
  create type message_sender as enum ('buyer','staff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_type as enum ('order','message','offer','account','system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type offer_audience as enum ('all','approved','pending','company');
exception when duplicate_object then null; end $$;

-- ---------- messages: one support thread per company ----------
-- buyer ↔ MASEST staff. Author user_id is null for staff replies (staff act via service role).
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  user_id       uuid references public.profiles(id) on delete set null,
  sender_role   message_sender not null,
  body          text not null,
  order_id      uuid references public.orders(id) on delete set null,
  read_by_staff boolean not null default false,
  read_by_user  boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists messages_company_idx on public.messages(company_id, created_at);
alter table public.messages add column if not exists source text not null default 'dashboard';
alter table public.messages add column if not exists external_thread_id text;
alter table public.messages add column if not exists external_message_id text;
create index if not exists messages_external_idx on public.messages(source, external_message_id) where external_message_id is not null;

create table if not exists public.crisp_sessions (
  session_id text primary key,
  website_id text,
  email text,
  nickname text,
  phone text,
  company_id uuid references public.companies(id) on delete set null,
  company_name text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists crisp_sessions_company_idx on public.crisp_sessions(company_id);

-- ---------- notifications: per company (optionally targeted to a user) ----------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  type        notification_type not null default 'system',
  title       text not null,
  body        text,
  link        text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_company_idx on public.notifications(company_id, created_at);

-- ---------- offers: admin-created promos / broadcasts ----------
create table if not exists public.offers (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  body           text,
  cta_url        text,
  audience       offer_audience not null default 'approved',
  company_id     uuid references public.companies(id) on delete cascade,  -- when audience='company'
  created_by     text,                                                    -- staff email
  recipients     int not null default 0,                                  -- how many got it
  emailed        boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ---------- page_views: first-party traffic (privacy-light; no PII, no cookies) ----------
create table if not exists public.page_views (
  id          bigint generated always as identity primary key,
  path        text not null,
  referrer    text,
  ua_family   text,                 -- coarse bucket (e.g. "Chrome", "Safari", "bot")
  visitor     text,                 -- random per-session id from client (not an account id)
  created_at  timestamptz not null default now()
);
create index if not exists page_views_created_idx on public.page_views(created_at);
create index if not exists page_views_path_idx on public.page_views(path);

-- ---------- RLS ----------
alter table public.messages      enable row level security;
alter table public.notifications enable row level security;
alter table public.offers        enable row level security;
alter table public.page_views    enable row level security;

-- Company members may read their own messages/notifications (reads also go through functions).
drop policy if exists messages_company on public.messages;
create policy messages_company on public.messages
  for select to authenticated using (company_id = public.current_company_id());

drop policy if exists notifications_company on public.notifications;
create policy notifications_company on public.notifications
  for select to authenticated using (company_id = public.current_company_id());

-- offers / page_views: no client read. Admin reads via service role only. (default deny)

-- ---------- GRANTS (service-role auto-grant does not fire for new tables) ----------
grant select on public.messages, public.notifications to authenticated;
grant all privileges on public.messages, public.notifications, public.crisp_sessions, public.offers, public.page_views to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Atomic tracked-stock decrement for checkout/webhook flows.
create or replace function public.decrement_variant_stock(p_vsku text, p_qty integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_vsku is null or p_qty is null or p_qty <= 0 then
    return false;
  end if;

  update public.product_variants
     set stock = stock - p_qty
   where vsku = p_vsku
     and track_stock is true
     and stock is not null
     and stock >= p_qty;

  if found then
    return true;
  end if;

  return exists (
    select 1
      from public.product_variants
     where vsku = p_vsku
       and (track_stock is not true or stock is null)
  );
end;
$$;

revoke all on function public.decrement_variant_stock(text, integer) from public;
grant execute on function public.decrement_variant_stock(text, integer) to service_role;
