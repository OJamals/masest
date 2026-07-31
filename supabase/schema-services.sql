-- MASEST service catalog schema. Service prices are managed in Admin > Pricing.
create table if not exists public.services (
  sku text primary key,
  name text not null,
  category text not null,
  unit text,
  public_price numeric(12,2),
  mode text not null default 'quote_service',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.services enable row level security;
drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services for select using (active = true);
grant select on public.services to anon, authenticated;
grant select, insert, update, delete on public.services to service_role;
