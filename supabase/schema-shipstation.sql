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

-- Existing installations may have the earlier constraint. Normalize legacy
-- `voided`, then accept the new void/reconciliation states.
alter table public.orders drop constraint if exists orders_shipstation_label_status_check;
update public.orders
   set shipstation_label_status = 'label_voided'
 where shipstation_label_status = 'voided';
alter table public.orders add constraint orders_shipstation_label_status_check
  check (
    shipstation_label_status is null
    or shipstation_label_status in (
      'rated', 'purchasing', 'label_pending', 'label_purchased',
      'reconcile_required', 'voiding', 'label_voided', 'label_void_failed',
      'void_reconcile_required', 'voided'
    )
  );

-- Immutable order finance evidence. Positive recognized entries are realized
-- costs. Pending negative entries are provider-approved refund requests and do
-- not reduce realized cost until a later settlement entry confirms carrier credit.
create table if not exists public.order_financial_entries (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders(id) on delete restrict,
  source                text not null check (char_length(source) between 1 and 40),
  entry_type            text not null check (char_length(entry_type) between 1 and 80),
  provider_object_id    text not null check (char_length(provider_object_id) between 1 and 255),
  amount                numeric(14,2) not null,
  currency              text not null check (currency ~ '^[a-z]{3}$'),
  recognition_state     text not null check (recognition_state in ('recognized', 'pending')),
  actor_id              text,
  reason                text check (reason is null or char_length(reason) <= 280),
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  unique (source, entry_type, provider_object_id)
);
create index if not exists order_financial_entries_order_idx
  on public.order_financial_entries (order_id, created_at desc);
alter table public.order_financial_entries enable row level security;
revoke all on public.order_financial_entries from public, anon, authenticated;
grant select, insert on public.order_financial_entries to service_role;

create or replace function public.prevent_order_financial_entry_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'order_financial_entries_immutable';
end;
$$;
drop trigger if exists order_financial_entries_immutable on public.order_financial_entries;
create trigger order_financial_entries_immutable
  before update or delete on public.order_financial_entries
  for each row execute function public.prevent_order_financial_entry_mutation();

create or replace function public.record_order_financial_entry(
  p_order_id uuid,
  p_source text,
  p_entry_type text,
  p_provider_object_id text,
  p_amount numeric,
  p_currency text,
  p_recognition_state text,
  p_actor_id text default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_existing public.order_financial_entries%rowtype;
begin
  insert into public.order_financial_entries (
    order_id, source, entry_type, provider_object_id, amount, currency,
    recognition_state, actor_id, reason, metadata
  ) values (
    p_order_id, trim(p_source), trim(p_entry_type), trim(p_provider_object_id),
    round(p_amount, 2), lower(trim(p_currency)), trim(p_recognition_state),
    nullif(trim(p_actor_id), ''), nullif(trim(p_reason), ''), coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source, entry_type, provider_object_id) do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  select * into strict v_existing
    from public.order_financial_entries
   where source = trim(p_source)
     and entry_type = trim(p_entry_type)
     and provider_object_id = trim(p_provider_object_id);
  if v_existing.order_id <> p_order_id
     or v_existing.amount <> round(p_amount, 2)
     or v_existing.currency <> lower(trim(p_currency))
     or v_existing.recognition_state <> trim(p_recognition_state) then
    raise exception 'order_financial_entry_identity_conflict';
  end if;
  return v_existing.id;
end;
$$;
revoke all on function public.record_order_financial_entry(uuid, text, text, text, numeric, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_order_financial_entry(uuid, text, text, text, numeric, text, text, text, text, jsonb) to service_role;

-- Backfill only provider-confirmed purchased labels with known cost. Re-running
-- is safe through the provider identity key.
insert into public.order_financial_entries (
  order_id, source, entry_type, provider_object_id, amount, currency,
  recognition_state, metadata, created_at
)
select id, 'shipstation', 'postage_purchase', shipstation_label_id,
       shipstation_cost, lower(currency), 'recognized',
       jsonb_strip_nulls(jsonb_build_object(
         'shipment_id', shipstation_shipment_id,
         'rate_id', shipstation_rate_id,
         'backfilled', true
       )),
       coalesce(shipstation_updated_at, created_at, now())
  from public.orders
 where shipstation_label_id is not null
   and shipstation_cost is not null
   and shipstation_cost >= 0
   and shipstation_label_status in ('label_purchased', 'label_pending')
on conflict (source, entry_type, provider_object_id) do nothing;

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
     and (shipstation_label_id is null or shipstation_label_status in ('label_voided', 'voided'))
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

-- Atomic pre-void claim. Provider access happens only for a label currently owned
-- by this order and before carrier movement. Rejected voids may be retried; an
-- ambiguous request stays locked for reconciliation.
create or replace function public.claim_shipstation_label_void(
  p_order_id uuid,
  p_label_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed uuid;
begin
  if p_label_id is null or p_label_id !~ '^se-[A-Za-z0-9_-]+$' then
    return false;
  end if;

  update public.orders
     set shipstation_label_status = 'voiding',
         shipstation_error = null,
         shipstation_updated_at = now()
   where id = p_order_id
     and status::text in ('paid', 'net_open', 'net_paid', 'fulfilled')
     and shipstation_label_id = p_label_id
     and shipstation_label_status in ('label_purchased', 'label_void_failed')
     and coalesce(tracking_status, 'processing') not in (
       'shipped', 'in_transit', 'out_for_delivery', 'delivered'
     )
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;
revoke all on function public.claim_shipstation_label_void(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_shipstation_label_void(uuid, text) to service_role;

-- Complete the provider-approved void, pending financial credit, and shipment
-- history in one DB transaction. Repeating after success repairs/returns the same
-- ledger identity without duplicating it.
create or replace function public.finalize_shipstation_label_void(
  p_order_id uuid,
  p_label_id text,
  p_actor_id text,
  p_reason text,
  p_provider_message text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_financial_id uuid;
begin
  if p_label_id is null or p_label_id !~ '^se-[A-Za-z0-9_-]+$'
     or char_length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'shipstation_label_void_finalize_invalid';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id
   for update;
  if not found
     or v_order.shipstation_label_id is distinct from p_label_id
     or v_order.shipstation_label_status not in ('voiding', 'label_voided', 'voided') then
    raise exception 'shipstation_label_void_finalize_mismatch';
  end if;

  update public.orders
     set shipstation_label_status = 'label_voided',
         shipstation_label_url = null,
         shipstation_error = null,
         tracking_status = 'processing',
         carrier = null,
         tracking_number = null,
         tracking_url = null,
         shipstation_updated_at = now()
   where id = p_order_id;

  v_financial_id := public.record_order_financial_entry(
    p_order_id,
    'shipstation',
    'postage_void_requested',
    p_label_id,
    -abs(coalesce(v_order.shipstation_cost, 0)),
    lower(coalesce(v_order.currency, 'usd')),
    'pending',
    nullif(trim(p_actor_id), ''),
    trim(p_reason),
    jsonb_strip_nulls(jsonb_build_object('provider_message', nullif(trim(p_provider_message), '')))
  );

  insert into public.shipment_events (
    order_id, status, carrier, tracking_number, note, provider, provider_event_key
  ) values (
    p_order_id, 'processing', v_order.carrier, v_order.tracking_number,
    'ShipStation label ' || p_label_id || ' voided; carrier refund pending',
    'shipstation', 'label-void:' || p_label_id
  ) on conflict (provider, provider_event_key) where provider is not null and provider_event_key is not null
    do nothing;

  return jsonb_build_object(
    'applied', true,
    'order_id', p_order_id,
    'label_id', p_label_id,
    'financial_entry_id', v_financial_id,
    'refund_state', 'pending'
  );
end;
$$;
revoke all on function public.finalize_shipstation_label_void(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_shipstation_label_void(uuid, text, text, text, text) to service_role;

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
