-- Checkout shipping quote snapshots.
--
-- /api/shipping-rates consolidates cart units into cartons, rates those cartons, and hands
-- the buyer a signed token. The buyer then leaves for Stripe and returns as a webhook, so
-- the carton plan has to survive the round trip: without it the fulfillment side re-derives
-- packing independently and can buy a shipment that differs from the one the buyer paid for.
--
-- One row per offered rate. The webhook reads the row matching the rate the buyer selected
-- and copies its package plan onto the order.
begin;

create table if not exists public.checkout_shipping_quotes (
  rate_id          text primary key check (length(rate_id) between 1 and 100),
  carrier_id       text check (carrier_id is null or length(carrier_id) <= 100),
  service_code     text check (service_code is null or length(service_code) <= 100),
  amount_minor     integer not null check (amount_minor >= 0),
  currency         text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  cart             jsonb not null default '[]'::jsonb,
  address          jsonb not null default '{}'::jsonb,
  billing_address  jsonb not null default '{}'::jsonb,
  packages         jsonb not null default '[]'::jsonb,
  rate             jsonb not null default '{}'::jsonb,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);

comment on table public.checkout_shipping_quotes is
  'Carton plan + rate snapshot behind each rate offered at checkout; replayed at label purchase.';

create index if not exists checkout_shipping_quotes_created_idx
  on public.checkout_shipping_quotes (created_at desc);

alter table public.checkout_shipping_quotes enable row level security;

revoke all on table public.checkout_shipping_quotes from public, anon, authenticated;
grant select, insert, update, delete on table public.checkout_shipping_quotes to service_role;

-- Retention: the signed token lives 15 minutes and the webhook lands within minutes of
-- payment. Two weeks is generous headroom for delayed ACH settlement and replayed events.
create or replace function public.purge_checkout_shipping_quotes(p_days integer default 14)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.checkout_shipping_quotes
   where created_at < now() - make_interval(days => greatest(coalesce(p_days, 14), 1));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_checkout_shipping_quotes(integer) from public, anon, authenticated;
grant execute on function public.purge_checkout_shipping_quotes(integer) to service_role;

commit;
