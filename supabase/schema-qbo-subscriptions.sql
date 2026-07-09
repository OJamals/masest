-- QuickBooks queue for paid Stripe program invoices.
-- One Stripe invoice produces one QBO Invoice + linked Payment. The Stripe invoice
-- id is unique so webhook retries and manual syncs cannot duplicate revenue.

create table if not exists public.qbo_subscription_invoices (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies(id) on delete cascade,
  stripe_invoice_id        text not null unique,
  stripe_subscription_id   text,
  stripe_customer_id       text,
  stripe_payment_intent    text,
  customer_email           text,
  tier                     text,
  description              text,
  subtotal                 numeric(12,2) not null default 0,
  tax                      numeric(12,2) not null default 0,
  total                    numeric(12,2) not null default 0,
  currency                 text not null default 'usd',
  qbo_sync_status          qbo_sync_status not null default 'pending',
  qbo_invoice_id           text,
  qbo_payment_id           text,
  qbo_intuit_tid           text,
  qbo_payment_intuit_tid   text,
  qbo_intuit_tids          jsonb not null default '[]'::jsonb,
  qbo_synced_at            timestamptz,
  qbo_attempts             int not null default 0,
  qbo_next_attempt_at      timestamptz,
  qbo_error                text,
  created_at               timestamptz not null default now()
);

create index if not exists qbo_subscription_invoices_pending_idx
  on public.qbo_subscription_invoices (qbo_next_attempt_at)
  where qbo_sync_status in ('pending', 'error');

create or replace function public.claim_qbo_subscription_invoices(batch int)
returns setof public.qbo_subscription_invoices
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.qbo_subscription_invoices i
  set qbo_sync_status = 'processing'
  where i.id in (
    select id
    from public.qbo_subscription_invoices
    where qbo_sync_status = 'pending'
      and (qbo_next_attempt_at is null or qbo_next_attempt_at <= now())
    order by created_at
    limit batch
    for update skip locked
  )
  returning i.*;
end
$$;

alter table public.qbo_subscription_invoices enable row level security;
grant select, insert, update, delete on public.qbo_subscription_invoices to service_role;
revoke all on function public.claim_qbo_subscription_invoices(int) from public;
grant execute on function public.claim_qbo_subscription_invoices(int) to service_role;
