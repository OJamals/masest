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
  contract_version smallint,
  plan_id          text,
  plan_digest      text,
  cart_digest      text,
  address_digest   text,
  carrier_id       text check (carrier_id is null or length(carrier_id) <= 100),
  service_code     text check (service_code is null or length(service_code) <= 100),
  amount_minor     integer not null check (amount_minor >= 0),
  currency         text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  cart             jsonb not null default '[]'::jsonb,
  address          jsonb not null default '{}'::jsonb,
  billing_address  jsonb not null default '{}'::jsonb,
  billing_same_as_shipping boolean not null default true,
  packages         jsonb not null default '[]'::jsonb,
  rate             jsonb not null default '{}'::jsonb,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);

alter table public.checkout_shipping_quotes add column if not exists contract_version smallint;
alter table public.checkout_shipping_quotes add column if not exists plan_id text;
alter table public.checkout_shipping_quotes add column if not exists plan_digest text;
alter table public.checkout_shipping_quotes add column if not exists cart_digest text;
alter table public.checkout_shipping_quotes add column if not exists address_digest text;
alter table public.checkout_shipping_quotes add column if not exists billing_same_as_shipping boolean not null default true;

comment on table public.checkout_shipping_quotes is
  'Carton plan + rate snapshot behind each rate offered at checkout; replayed at label purchase.';
comment on column public.checkout_shipping_quotes.plan_digest is
  'SHA-256 digest binding carton geometry, cart/address digests, provider rate, amount, and currency.';

create index if not exists checkout_shipping_quotes_created_idx
  on public.checkout_shipping_quotes (created_at desc);
create unique index if not exists checkout_shipping_quotes_plan_uidx
  on public.checkout_shipping_quotes (plan_id)
  where plan_id is not null;

alter table public.checkout_shipping_quotes enable row level security;

revoke all on table public.checkout_shipping_quotes from public, anon, authenticated;
grant select, insert, update, delete on table public.checkout_shipping_quotes to service_role;

-- The Session contract, exact cartons, Buyer ownership, and legacy review marker must land
-- in the same idempotent transaction as the paid Order. A follow-up update could be skipped
-- after a Worker crash and would leave a paid Order detached from its fulfillment authority.
alter table public.orders add column if not exists fulfillment_contract_status text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_fulfillment_contract_status_check'
  ) then
    alter table public.orders
      add constraint orders_fulfillment_contract_status_check
      check (fulfillment_contract_status is null or fulfillment_contract_status in ('bound', 'legacy_review_required'));
  end if;
end;
$$;

comment on column public.orders.fulfillment_contract_status is
  'bound for Checkout v3 carton plans; legacy_review_required blocks silent catalog recomputation.';

-- A successful missing profile is a supported authenticated retail Buyer. Order ownership
-- therefore belongs to the Auth identity, not to the optional public.profiles projection;
-- otherwise persist_stripe_order would fail its FK after Checkout deliberately accepted the
-- profileless state. Existing profile ids equal auth.users ids, so this is a lossless change.
alter table public.orders drop constraint if exists orders_user_id_fkey;
alter table public.orders
  add constraint orders_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

create or replace function public.persist_stripe_order(
  p_order jsonb,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  insert into public.orders (
    company_id, user_id, status, payment_method, qbo_sync_status, subtotal, shipping, tax, total,
    currency, stripe_payment_intent, customer_email, purchase_order_number, ship_address,
    shipping_package_plan, paid_shipping_rate_id, paid_shipping_carrier_id,
    paid_shipping_service_code, fulfillment_contract_status, shipstation_error
  ) values (
    nullif(p_order->>'company_id', '')::uuid,
    nullif(p_order->>'user_id', '')::uuid,
    coalesce(nullif(p_order->>'status', ''), 'paid')::public.order_status,
    'stripe'::public.payment_method,
    nullif(p_order->>'qbo_sync_status', '')::public.qbo_sync_status,
    coalesce((p_order->>'subtotal')::numeric, 0),
    coalesce((p_order->>'shipping')::numeric, 0),
    coalesce((p_order->>'tax')::numeric, 0),
    coalesce((p_order->>'total')::numeric, 0),
    coalesce(nullif(p_order->>'currency', ''), 'usd'),
    nullif(p_order->>'stripe_payment_intent', ''),
    nullif(p_order->>'customer_email', ''),
    nullif(p_order->>'purchase_order_number', ''),
    p_order->'ship_address',
    case
      when jsonb_typeof(p_order->'shipping_package_plan') = 'array'
        then p_order->'shipping_package_plan'
      else null
    end,
    nullif(p_order->>'paid_shipping_rate_id', ''),
    nullif(p_order->>'paid_shipping_carrier_id', ''),
    nullif(p_order->>'paid_shipping_service_code', ''),
    nullif(p_order->>'fulfillment_contract_status', ''),
    nullif(p_order->>'shipstation_error', '')
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, sku, product_sku, name, qty, unit_price, line_total, backordered
  )
  select
    v_order_id,
    item.sku,
    item.product_sku,
    item.name,
    item.qty,
    item.unit_price,
    item.line_total,
    coalesce(item.backordered, false)
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    sku text,
    product_sku text,
    name text,
    qty integer,
    unit_price numeric,
    line_total numeric,
    backordered boolean
  );

  return jsonb_build_object('id', v_order_id);
end;
$$;

revoke all on function public.persist_stripe_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_stripe_order(jsonb, jsonb) to service_role;

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
