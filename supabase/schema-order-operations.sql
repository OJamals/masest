-- Order operations: paid-shipping provenance, staff acceptance, cancellation record,
-- and buyer-initiated cancel/return requests.
--
-- `shipstation_*` columns describe the shipment MASEST bought. The `paid_shipping_*`
-- columns describe what the BUYER selected and paid for at checkout. Keeping them apart is
-- the point: fulfillment can pre-select the paid service and staff can see at a glance when
-- the shipment diverged from it.
begin;

alter table public.orders add column if not exists shipping_package_plan jsonb;
alter table public.orders add column if not exists paid_shipping_rate_id text;
alter table public.orders add column if not exists paid_shipping_carrier_id text;
alter table public.orders add column if not exists paid_shipping_service_code text;
alter table public.orders add column if not exists accepted_at timestamptz;
alter table public.orders add column if not exists accepted_by uuid;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists cancel_reason text;

comment on column public.orders.shipping_package_plan is
  'Carton plan the buyer was rated on at checkout; replayed verbatim at label purchase.';
comment on column public.orders.paid_shipping_service_code is
  'Carrier service the buyer selected and paid for, independent of what was later bought.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_cancel_reason_len'
  ) then
    alter table public.orders
      add constraint orders_cancel_reason_len
      check (cancel_reason is null or length(cancel_reason) between 1 and 500);
  end if;
end;
$$;

create index if not exists orders_unaccepted_idx
  on public.orders (created_at desc)
  where accepted_at is null and status in ('paid', 'net_open');

-- Buyer-initiated cancellation / return requests. Requests never move money on their own:
-- staff approval routes into the audited cancel or return flow.
create table if not exists public.order_requests (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  type          text not null check (type in ('cancel', 'return')),
  status        text not null default 'open' check (status in ('open', 'approved', 'declined', 'withdrawn')),
  reason        text check (reason is null or length(reason) between 1 and 1000),
  line_items    jsonb not null default '[]'::jsonb,
  requested_by  uuid,
  requested_email text,
  resolved_by   uuid,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 1000),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.order_requests is
  'Buyer-initiated cancel/return requests. Approval triggers the audited staff flow; the row itself moves no money.';

-- One open request of a kind per order: re-submitting is idempotent from the buyer's side
-- and staff never see a duplicate queue entry.
create unique index if not exists order_requests_open_uidx
  on public.order_requests (order_id, type)
  where status = 'open';
create index if not exists order_requests_queue_idx
  on public.order_requests (status, created_at desc);

create or replace function public.touch_order_request()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists order_requests_touch on public.order_requests;
create trigger order_requests_touch
  before update on public.order_requests
  for each row execute function public.touch_order_request();

alter table public.order_requests enable row level security;

revoke all on table public.order_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.order_requests to service_role;

-- persist_stripe_order carries the new provenance columns in the SAME atomic insert.
-- The unique guard on stripe_payment_intent is what makes this write idempotent, so the
-- package plan and paid service must land with it — a follow-up UPDATE would be a second
-- step that a retried webhook could skip, leaving the order without its plan.
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
    company_id, status, payment_method, qbo_sync_status, subtotal, shipping, tax, total,
    currency, stripe_payment_intent, customer_email, purchase_order_number, ship_address,
    shipping_package_plan, paid_shipping_rate_id, paid_shipping_carrier_id,
    paid_shipping_service_code
  ) values (
    nullif(p_order->>'company_id', '')::uuid,
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
    nullif(p_order->>'paid_shipping_service_code', '')
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

commit;
