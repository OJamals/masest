-- Applied 2026-08-06: tracking projection now stamps shipped_at, promotes settled
-- orders to fulfilled, records return-label scans, and reports whether the transition
-- warrants a buyer notification. Extracted verbatim from schema-provider-inbox.sql.
begin;

create or replace function public.apply_shipstation_tracking_integration_effect(
  p_effect_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.integration_effects%rowtype;
  v_event public.integration_events%rowtype;
  v_order public.orders%rowtype;
  v_history_id bigint;
  v_occurred_at timestamptz;
  v_result jsonb;
  v_stale boolean;
  v_next_status text;
  v_order_status text;
  v_shipped_at timestamptz;
  v_notify boolean;
begin
  select * into v_effect from public.integration_effects where id = p_effect_id for update;
  if not found or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'shipstation_tracking_projection' then
    raise exception 'invalid_shipstation_projection_lease';
  end if;
  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{}'::jsonb);
  end if;
  select * into v_event from public.integration_events where id = v_effect.event_id;
  if not found or v_event.provider <> 'shipstation' then
    raise exception 'invalid_shipstation_projection_event';
  end if;
  begin
    v_occurred_at := nullif(v_effect.payload ->> 'occurred_at', '')::timestamptz;
  exception when others then
    raise exception 'invalid_shipstation_projection_time';
  end;
  select * into v_order
    from public.orders
   where tracking_number = v_effect.payload ->> 'tracking_number'
   order by created_at desc
   limit 1
   for update;

  -- A return label's scans carry their own tracking number. They belong on the order's
  -- history, but they must never drive the OUTBOUND tracking_status — a returning parcel
  -- is not the order shipping again.
  if not found then
    select * into v_order
      from public.orders
     where shipstation_return_tracking_number = v_effect.payload ->> 'tracking_number'
     order by created_at desc
     limit 1
     for update;
    if found then
      insert into public.shipment_events (
        order_id, status, carrier, tracking_number, note, provider, provider_event_key,
        provider_occurred_at, provider_status_code, provider_event_code, payload_sha256
      ) values (
        v_order.id,
        v_effect.payload ->> 'tracking_status',
        v_order.carrier,
        v_effect.payload ->> 'tracking_number',
        coalesce(nullif(v_effect.payload ->> 'note', ''), 'Return shipment update'),
        'shipstation',
        v_effect.payload ->> 'event_key',
        v_occurred_at,
        nullif(v_effect.payload ->> 'status_code', ''),
        nullif(v_effect.payload ->> 'event_code', ''),
        v_event.payload_sha256
      ) on conflict do nothing returning id into v_history_id;
      v_result := jsonb_build_object(
        'found', true,
        'applied', false,
        'return_shipment', true,
        'history_inserted', v_history_id is not null,
        'order_id', v_order.id,
        'notify', false
      );
      return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
    end if;
    v_result := jsonb_build_object(
      'found', false, 'applied', false, 'notify', false, 'skipped', 'unmatched_order'
    );
    return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
  end if;

  insert into public.shipment_events (
    order_id, status, carrier, tracking_number, note, provider, provider_event_key,
    provider_occurred_at, provider_status_code, provider_event_code, payload_sha256
  ) values (
    v_order.id,
    v_effect.payload ->> 'tracking_status',
    v_order.carrier,
    v_effect.payload ->> 'tracking_number',
    nullif(v_effect.payload ->> 'note', ''),
    'shipstation',
    v_effect.payload ->> 'event_key',
    v_occurred_at,
    nullif(v_effect.payload ->> 'status_code', ''),
    nullif(v_effect.payload ->> 'event_code', ''),
    v_event.payload_sha256
  ) on conflict do nothing returning id into v_history_id;

  v_stale := v_order.tracking_provider_occurred_at is not null
    and (v_occurred_at is null or v_occurred_at < v_order.tracking_provider_occurred_at);
  if v_stale then
    v_result := jsonb_build_object(
      'found', true, 'applied', false, 'notify', false, 'skipped', 'stale_event'
    );
    return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
  end if;
  v_next_status := case
    when v_order.tracking_status = 'delivered' then 'delivered'
    when v_effect.payload ->> 'tracking_status' = 'packing'
      and v_order.tracking_status not in ('processing', 'packing') then v_order.tracking_status
    else v_effect.payload ->> 'tracking_status'
  end;

  -- shipped_at is the clock the review-reminder sweep and the fulfilment SLA both read.
  -- Stamp it on the first movement into shipped/delivered and never move it again.
  v_shipped_at := case
    when v_order.shipped_at is not null then v_order.shipped_at
    when v_next_status in ('shipped', 'delivered') then coalesce(v_occurred_at, now())
    else null
  end;

  -- Mirror shouldPromoteToFulfilled() in functions/_lib/order-lifecycle.js: only orders
  -- that are already settled may close. A shipped net_open order MUST stay net_open or the
  -- receivable silently disappears from the company's outstanding credit.
  v_order_status := v_order.status::text;
  if v_order_status in ('paid', 'net_paid', 'fulfilled')
     and (
       v_next_status = 'delivered'
       or (v_next_status = 'shipped' and coalesce(trim(v_order.tracking_number), '') <> '')
     ) then
    v_order_status := 'fulfilled';
  end if;

  -- Notify once per meaningful transition. Repeated in-transit scans of the same status,
  -- and the internal 'packing' step, are not buyer-facing events.
  v_notify := v_next_status is distinct from v_order.tracking_status
    and v_next_status in ('shipped', 'delivered', 'blocked');

  update public.orders
     set tracking_status = v_next_status,
         status = v_order_status::public.order_status,
         shipped_at = v_shipped_at,
         tracking_provider_occurred_at = coalesce(v_occurred_at, tracking_provider_occurred_at),
         estimated_delivery_at = coalesce(
           nullif(v_effect.payload ->> 'estimated_delivery_at', '')::timestamptz,
           estimated_delivery_at
         ),
         updated_at = now()
   where id = v_order.id;

  v_result := jsonb_build_object(
    'found', true,
    'applied', true,
    'history_inserted', v_history_id is not null,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'previous_tracking_status', v_order.tracking_status,
    'tracking_status', v_next_status,
    'previous_status', v_order.status::text,
    'status', v_order_status,
    'promoted_to_fulfilled', v_order_status = 'fulfilled' and v_order.status::text <> 'fulfilled',
    'notify', v_notify
  );
  return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
end;
$$;

revoke all on function public.apply_shipstation_tracking_integration_effect(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_shipstation_tracking_integration_effect(uuid, text) to service_role;

commit;
