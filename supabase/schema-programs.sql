-- MASEST commerce — program subscriptions (Stripe). ADDITIVE. Run after prior schema files.
-- Tier -> Stripe price id mapping lives in the PROGRAM_PRICES env var (JSON), not here.
create table if not exists public.program_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid references public.companies(id) on delete cascade,
  tier                   text,
  stripe_subscription_id text unique,
  stripe_customer_id     text,
  status                 text not null default 'checkout',  -- checkout|active|trialing|past_due|canceled
  created_at             timestamptz not null default now()
);
create index if not exists program_subs_company_idx on public.program_subscriptions (company_id);
alter table public.program_subscriptions enable row level security;
drop policy if exists program_subs_company on public.program_subscriptions;
create policy program_subs_company on public.program_subscriptions
  for select to authenticated using (company_id = public.current_company_id());
grant select on public.program_subscriptions to authenticated;
grant select, insert, update, delete on public.program_subscriptions to service_role;
