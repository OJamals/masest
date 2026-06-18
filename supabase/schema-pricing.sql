-- MASEST Phase 2 — explicit per-tier variant pricing.
-- Run in Supabase SQL editor (or via pooler). Idempotent / re-runnable.
--
-- Model: price_tiers holds an explicit price per (vsku, tier). The API resolves
-- the caller's effective price as price_tiers[tier] ?? product_variants.price
-- (legacy base = the fallback / list price). companies.price_tier maps an
-- approved B2B account to its tier; guests + pending accounts get 'retail'.

do $$ begin
  create type pricing_tier as enum ('retail', 'hvac', 'wholesale');
exception when duplicate_object then null; end $$;

create table if not exists public.price_tiers (
  vsku text not null references public.product_variants(vsku) on delete cascade,
  tier pricing_tier not null,
  price numeric(12,2) not null check (price >= 0),
  currency text not null default 'usd',
  updated_at timestamptz not null default now(),
  primary key (vsku, tier)
);
create index if not exists price_tiers_vsku_idx on public.price_tiers(vsku);

alter table public.companies
  add column if not exists price_tier pricing_tier not null default 'retail';

-- RLS: public read. Effective prices are resolved server-side; exposing the
-- list is acceptable and lets the storefront show tier prices to logged-in users.
alter table public.price_tiers enable row level security;
drop policy if exists price_tiers_public_read on public.price_tiers;
create policy price_tiers_public_read on public.price_tiers
  for select to anon, authenticated using (true);

-- Pooler-created tables need explicit grants or service_role writes fail 42501.
grant select on public.price_tiers to anon, authenticated;
grant select, insert, update, delete on public.price_tiers to service_role;

-- Seed the retail tier from current variant prices so the admin matrix shows a
-- complete retail column. hvac/wholesale start empty and fall back to base price
-- until staff sets them. Idempotent.
insert into public.price_tiers (vsku, tier, price, currency)
select vsku, 'retail', price, coalesce(currency, 'usd')
from public.product_variants
where price is not null
on conflict (vsku, tier) do nothing;
