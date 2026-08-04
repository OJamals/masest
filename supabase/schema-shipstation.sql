-- ShipStation API Free order/label state. Additive; safe to re-run.
alter table public.orders add column if not exists shipstation_shipment_id text;
alter table public.orders add column if not exists shipstation_label_id text;
alter table public.orders add column if not exists shipstation_rate_id text;
alter table public.orders add column if not exists shipstation_carrier_id text;
alter table public.orders add column if not exists shipstation_service_code text;
alter table public.orders add column if not exists shipstation_label_url text;
alter table public.orders add column if not exists shipstation_cost numeric(12,2);
alter table public.orders add column if not exists shipstation_label_status text;
alter table public.orders add column if not exists shipstation_error text;
alter table public.orders add column if not exists shipstation_updated_at timestamptz;

-- CMS-owned default parcel per sellable variant. Staff may override at quote time.
alter table public.product_variants add column if not exists shipping_weight_lb numeric(10,3);
alter table public.product_variants add column if not exists shipping_length_in numeric(8,2);
alter table public.product_variants add column if not exists shipping_width_in numeric(8,2);
alter table public.product_variants add column if not exists shipping_height_in numeric(8,2);

do $$ begin
  alter table public.product_variants add constraint product_variants_shipping_weight_positive
    check (shipping_weight_lb is null or shipping_weight_lb > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.product_variants add constraint product_variants_shipping_dimensions_complete
    check (
      (shipping_length_in is null and shipping_width_in is null and shipping_height_in is null)
      or (shipping_length_in > 0 and shipping_width_in > 0 and shipping_height_in > 0)
    );
exception when duplicate_object then null;
end $$;

-- Idempotent provider tracking history. Existing deployments already have this table;
-- CREATE keeps this migration independently runnable on a fresh database.
create table if not exists public.shipment_events (
  id              bigint generated always as identity primary key,
  order_id        uuid not null references public.orders(id) on delete cascade,
  status          text not null,
  carrier         text,
  tracking_number text,
  note            text,
  created_at      timestamptz not null default now()
);
alter table public.shipment_events add column if not exists provider text;
alter table public.shipment_events add column if not exists provider_event_key text;
create unique index if not exists shipment_events_provider_event_key_uidx
  on public.shipment_events (provider, provider_event_key)
  where provider is not null and provider_event_key is not null;
create index if not exists shipment_events_order_idx
  on public.shipment_events (order_id, created_at desc);
alter table public.shipment_events enable row level security;
drop policy if exists shipment_events_company_read on public.shipment_events;
create policy shipment_events_company_read on public.shipment_events
  for select to authenticated using (
    exists (select 1 from public.orders o
            where o.id = shipment_events.order_id and o.company_id = public.current_company_id())
  );
grant select on public.shipment_events to authenticated;
grant select, insert on public.shipment_events to service_role;

create unique index if not exists orders_shipstation_shipment_uidx
  on public.orders (shipstation_shipment_id) where shipstation_shipment_id is not null;
create unique index if not exists orders_shipstation_label_uidx
  on public.orders (shipstation_label_id) where shipstation_label_id is not null;

do $$ begin
  alter table public.orders add constraint orders_shipstation_cost_nonnegative
    check (shipstation_cost is null or shipstation_cost >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.orders add constraint orders_shipstation_label_status_check
    check (
      shipstation_label_status is null
      or shipstation_label_status in (
        'rated', 'purchasing', 'label_pending', 'label_purchased',
        'reconcile_required', 'voided'
      )
    );
exception when duplicate_object then null;
end $$;

-- Atomic pre-charge claim. Prevents two staff requests from buying same label twice.
create or replace function public.claim_shipstation_label_purchase(
  p_order_id uuid,
  p_rate_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed uuid;
begin
  if p_rate_id is null or p_rate_id !~ '^se-[A-Za-z0-9_-]+$' then
    return false;
  end if;

  update public.orders
     set shipstation_label_status = 'purchasing',
         shipstation_rate_id = p_rate_id,
         shipstation_error = null,
         shipstation_updated_at = now()
   where id = p_order_id
     and status::text in ('paid', 'net_open', 'net_paid', 'fulfilled')
     and shipstation_shipment_id is not null
     and shipstation_label_id is null
     and shipstation_label_status is distinct from 'purchasing'
     and shipstation_label_status is distinct from 'reconcile_required'
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;

revoke all on function public.claim_shipstation_label_purchase(uuid, text) from public;
revoke all on function public.claim_shipstation_label_purchase(uuid, text) from anon;
revoke all on function public.claim_shipstation_label_purchase(uuid, text) from authenticated;
grant execute on function public.claim_shipstation_label_purchase(uuid, text) to service_role;

-- Insert provider event + advance order tracking in one transaction. Retries with the
-- same provider_event_key return applied=false and never duplicate customer history.
create or replace function public.apply_shipstation_tracking_event(
  p_tracking_number text,
  p_tracking_status text,
  p_event_key text,
  p_note text default null,
  p_estimated_delivery_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_event_id bigint;
  v_next_status text;
begin
  if coalesce(trim(p_tracking_number), '') = ''
     or p_tracking_status not in ('packing', 'shipped', 'delivered', 'blocked')
     or coalesce(trim(p_event_key), '') = '' then
    return jsonb_build_object('found', false, 'applied', false);
  end if;

  select * into v_order
    from public.orders
   where tracking_number = p_tracking_number
   order by created_at desc
   limit 1
   for update;
  if not found then
    return jsonb_build_object('found', false, 'applied', false);
  end if;

  insert into public.shipment_events (
    order_id, status, carrier, tracking_number, note, provider, provider_event_key
  ) values (
    v_order.id, p_tracking_status, v_order.carrier, p_tracking_number,
    nullif(trim(p_note), ''), 'shipstation', p_event_key
  )
  on conflict do nothing
  returning id into v_event_id;
  if v_event_id is null then
    return jsonb_build_object('found', true, 'applied', false, 'order_id', v_order.id);
  end if;

  v_next_status := case
    when v_order.tracking_status = 'delivered' then 'delivered'
    when p_tracking_status = 'packing' and v_order.tracking_status not in ('processing', 'packing')
      then v_order.tracking_status
    else p_tracking_status
  end;
  update public.orders
     set tracking_status = v_next_status,
         estimated_delivery_at = coalesce(p_estimated_delivery_at, estimated_delivery_at),
         updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('found', true, 'applied', true, 'order_id', v_order.id);
end;
$$;

revoke all on function public.apply_shipstation_tracking_event(text, text, text, text, timestamptz) from public;
revoke all on function public.apply_shipstation_tracking_event(text, text, text, text, timestamptz) from anon;
revoke all on function public.apply_shipstation_tracking_event(text, text, text, text, timestamptz) from authenticated;
grant execute on function public.apply_shipstation_tracking_event(text, text, text, text, timestamptz) to service_role;
