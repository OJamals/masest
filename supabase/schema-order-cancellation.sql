-- Order cancellation effect handlers.
--
-- Cancelling a paid order touches four providers (ShipEngine label, Stripe refund, QBO
-- credit memo, Resend notice) plus local stock. Doing that inline means a mid-sequence
-- failure leaves the order in a state nobody can name. These run as leased effect rows on
-- the integration ledger instead: each step is idempotent, retried independently, and
-- visible in the per-order timeline.
--
-- Both functions follow the established handler contract: verify the lease, return the
-- recorded result when already succeeded, then hand off to finish_integration_projection.
begin;

-- Return cancelled lines to inventory. Backordered lines never decremented stock, so they
-- must not increment it here — that would manufacture inventory that was never reserved.
create or replace function public.apply_order_restock_effect(
  p_effect_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.integration_effects%rowtype;
  v_order_id uuid;
  v_order_status public.order_status;
  v_line record;
  v_restored jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  select * into v_effect
    from public.integration_effects
   where id = p_effect_id
   for update;
  if not found
     or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'order_restock' then
    raise exception 'invalid_restock_effect_lease';
  end if;
  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{}'::jsonb);
  end if;

  begin
    v_order_id := nullif(v_effect.payload ->> 'order_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_restock_effect_order';
  end;
  if v_order_id is null then
    raise exception 'invalid_restock_effect_order';
  end if;

  select status into v_order_status from public.orders where id = v_order_id for update;
  if not found then
    raise exception 'invalid_restock_effect_order';
  end if;

  -- Stock was only ever decremented for a settled order. Cancelling an unsettled one
  -- (pending ACH, unpaid NET draft) must not hand inventory back that was never taken.
  if v_order_status not in ('paid', 'net_open', 'net_paid', 'fulfilled') then
    v_result := jsonb_build_object('restored', '[]'::jsonb, 'skipped', 'stock_never_reserved');
    return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
  end if;

  for v_line in
    select item.sku, sum(item.qty)::integer as qty
      from public.order_items as item
     where item.order_id = v_order_id
       and coalesce(item.backordered, false) = false
       and coalesce(trim(item.sku), '') <> ''
     group by item.sku
  loop
    if public.increment_variant_stock(v_line.sku, v_line.qty) then
      v_restored := v_restored || jsonb_build_object('sku', v_line.sku, 'qty', v_line.qty);
    end if;
  end loop;

  v_result := jsonb_build_object('restored', v_restored, 'order_id', v_order_id);
  return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
end;
$$;

revoke all on function public.apply_order_restock_effect(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_order_restock_effect(uuid, text) to service_role;

-- Close the order. Runs last in the chain so the money and the label have already been
-- reversed: a buyer must never see "cancelled" before the refund exists.
create or replace function public.apply_order_cancellation_effect(
  p_effect_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.integration_effects%rowtype;
  v_order public.orders%rowtype;
  v_reason text;
  v_result jsonb;
begin
  select * into v_effect
    from public.integration_effects
   where id = p_effect_id
   for update;
  if not found
     or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'order_cancelled' then
    raise exception 'invalid_cancellation_effect_lease';
  end if;
  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{}'::jsonb);
  end if;

  select * into v_order
    from public.orders
   where id = nullif(v_effect.payload ->> 'order_id', '')::uuid
   for update;
  if not found then
    raise exception 'invalid_cancellation_effect_order';
  end if;

  if v_order.status = 'cancelled' then
    v_result := jsonb_build_object(
      'order_id', v_order.id, 'status', 'cancelled', 'skipped', 'already_cancelled'
    );
    return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
  end if;
  -- A fully refunded order is already closed on the money side; overwriting that status
  -- would erase the refund from every report that keys on it.
  if v_order.status = 'refunded' then
    v_result := jsonb_build_object(
      'order_id', v_order.id, 'status', 'refunded', 'skipped', 'already_refunded'
    );
    return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
  end if;

  v_reason := left(nullif(trim(v_effect.payload ->> 'reason'), ''), 500);

  update public.orders
     set status = 'cancelled',
         cancelled_at = coalesce(cancelled_at, now()),
         cancel_reason = coalesce(v_reason, cancel_reason),
         updated_at = now()
   where id = v_order.id;

  insert into public.shipment_events (order_id, status, tracking_number, note, provider)
  values (
    v_order.id,
    'blocked',
    nullif(v_order.tracking_number, ''),
    coalesce('Order cancelled: ' || v_reason, 'Order cancelled'),
    'masest'
  ) on conflict do nothing;

  v_result := jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'previous_status', v_order.status::text,
    'status', 'cancelled'
  );
  return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
end;
$$;

revoke all on function public.apply_order_cancellation_effect(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_order_cancellation_effect(uuid, text) to service_role;

commit;
