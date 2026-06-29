-- MASEST commerce — Supabase schema (Phase 1)
-- Run in Supabase SQL editor (or `supabase db push`). Idempotent-ish: safe to re-run types/tables guarded.
-- Covers: B2B accounts + approval gate, company profiles, addresses, products (mode flag), orders skeleton.
-- Payments (Stripe/QBO) columns exist now but are wired in Phase 2/3.

-- ---------- extensions ----------
create extension if not exists pgcrypto;

-- ---------- enums ----------
do $$ begin
  create type company_status as enum ('pending','approved','rejected','suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type profile_role as enum ('buyer','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type address_type as enum ('ship','bill');
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_mode as enum ('buy','quote');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('cart','pending_payment','paid','net_open','net_paid','fulfilled','cancelled','refunded');
exception when duplicate_object then null; end $$;
alter type order_status add value if not exists 'refunded';

do $$ begin
  create type payment_method as enum ('stripe','net');
exception when duplicate_object then null; end $$;

-- ---------- tables ----------
create table if not exists public.companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  status          company_status not null default 'pending',
  net_terms_days  int not null default 0,          -- 0 = pay-now only; 30 = NET-30 once approved
  credit_limit    numeric(12,2),
  tax_exempt      boolean not null default false,
  resale_cert_url text,
  created_at      timestamptz not null default now()
);

-- profiles.id == auth.users.id (1:1 with Supabase Auth user)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete set null,
  role        profile_role not null default 'buyer',
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now()
);
create index if not exists profiles_company_idx on public.profiles(company_id);

create table if not exists public.addresses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  type        address_type not null default 'ship',
  line1       text not null,
  line2       text,
  city        text not null,
  state       text not null,
  zip         text not null,
  country     text not null default 'US',
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists addresses_company_idx on public.addresses(company_id);

-- catalog. mode drives UI: 'buy' = cart/checkout, 'quote' = existing quote form.
create table if not exists public.products (
  sku             text primary key,
  name            text not null,
  group_key       text,                  -- descale | degrease | water | exterior
  hmis            text,
  mode            product_mode not null default 'quote',
  hazmat          boolean not null default false,
  taxable         boolean not null default true,
  price           numeric(12,2),         -- null until owner supplies (buy rows only)
  currency        text not null default 'usd',
  stripe_price_id text,                  -- set in Phase 2
  active          boolean not null default true,
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.orders (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid references public.companies(id),   -- null = guest checkout (no B2B account)
  user_id               uuid references public.profiles(id),
  customer_email        text,
  status                order_status not null default 'cart',
  payment_method        payment_method,
  subtotal              numeric(12,2) not null default 0,
  tax                   numeric(12,2) not null default 0,
  total                 numeric(12,2) not null default 0,
  currency              text not null default 'usd',
  stripe_payment_intent text,
  qbo_invoice_id        text,
  ship_address          jsonb,
  created_at            timestamptz not null default now()
);
create index if not exists orders_company_idx on public.orders(company_id);

alter table public.orders add column if not exists tracking_status text default 'processing';
alter table public.orders add column if not exists customer_email text;
alter table public.orders add column if not exists carrier text;
alter table public.orders add column if not exists tracking_number text;
alter table public.orders add column if not exists tracking_url text;
alter table public.orders add column if not exists estimated_delivery_at timestamptz;
alter table public.orders add column if not exists shipped_at timestamptz;

create index if not exists orders_tracking_status_idx
  on public.orders (tracking_status, estimated_delivery_at, created_at desc);

create table if not exists public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  -- Line-items are historical snapshots. sku holds the variant sku (vsku) sold; no FK to the
  -- mutable catalog (a deleted variant must not erase order history). name/unit_price are copied.
  sku         text not null,
  product_sku text,                              -- base product sku, for reporting (no FK)
  name        text not null,
  qty         int not null check (qty > 0),
  unit_price  numeric(12,2) not null,
  line_total  numeric(12,2) not null
);
create index if not exists order_items_order_idx on public.order_items(order_id);

-- ---------- helper: caller's company ----------
create or replace function public.current_company_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid()
$$;

revoke all on function public.current_company_id() from public;
grant execute on function public.current_company_id() to authenticated, service_role;

-- ---------- RLS ----------
alter table public.companies   enable row level security;
alter table public.profiles    enable row level security;
alter table public.addresses   enable row level security;
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- products: public read of active rows (catalog shows buy + quote items)
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated using (active = true);

-- companies: members read their own; admins update their own
drop policy if exists companies_member_read on public.companies;
create policy companies_member_read on public.companies
  for select to authenticated using (id = public.current_company_id());

drop policy if exists companies_admin_update on public.companies;
create policy companies_admin_update on public.companies
  for update to authenticated using (
    id = public.current_company_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- profiles: self or same-company read; self update
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (id = auth.uid() or company_id = public.current_company_id());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  -- WITH CHECK blocks self-escalation: a self-update may not produce a row that is
  -- platform staff (is_staff) or company admin (role='admin'). Today authenticated has
  -- no UPDATE grant on profiles at all, so this is defense-in-depth — it prevents a
  -- future `grant update` from silently opening a privilege-escalation hole.
  with check (
    id = auth.uid()
    and is_staff is not true
    and (role is null or role <> 'admin')
  );

-- addresses / orders / order_items: scoped to caller's company
drop policy if exists addresses_company on public.addresses;
create policy addresses_company on public.addresses
  for select to authenticated using (company_id = public.current_company_id());

drop policy if exists orders_company on public.orders;
create policy orders_company on public.orders
  for select to authenticated using (company_id = public.current_company_id());

drop policy if exists order_items_company on public.order_items;
create policy order_items_company on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o
            where o.id = order_items.order_id and o.company_id = public.current_company_id())
  );

-- NOTE: inserts/updates to companies/profiles/orders are done by the service-role key in
-- serverless functions (bypasses RLS). No insert policies for anon/auth = default deny,
-- which prevents client-side tampering with approval status, prices, or order totals.

-- ---------- GRANTS ----------
-- Required: Supabase's default-privilege auto-grant did not fire for these tables, so the
-- roles (incl. service_role) start with no table access. service_role bypasses RLS but still
-- needs table GRANTs. Without this block every query returns "permission denied".
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

grant usage on schema public to anon, authenticated;
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.companies, public.profiles, public.addresses,
                public.orders, public.order_items to authenticated;
grant insert, update on public.addresses to authenticated;

-- ---------- PRODUCT VARIANTS (volume tiers, e.g. 5 / 15 / 55 gal) ----------
-- Each row is a purchasable volume of a parent product. Cart, checkout, and Stripe key on `vsku`.
-- Buyable = parent product mode='buy' + active, AND variant active + non-null price.
-- (Service-role auto-grant does not fire for new tables — explicit grants below are required.)
create table if not exists public.product_variants (
  id              uuid primary key default gen_random_uuid(),
  vsku            text unique not null,
  product_sku     text not null references public.products(sku) on delete cascade,
  label           text not null,
  gallons         numeric(8,2) not null,
  price           numeric(12,2),
  currency        text not null default 'usd',
  stripe_price_id text,
  active          boolean not null default true,
  sort            int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists product_variants_sku_idx on public.product_variants(product_sku);

alter table public.product_variants enable row level security;
drop policy if exists product_variants_public_read on public.product_variants;
create policy product_variants_public_read on public.product_variants for select using (active = true);

grant select on public.product_variants to anon, authenticated;
grant select, insert, update, delete on public.product_variants to service_role;
