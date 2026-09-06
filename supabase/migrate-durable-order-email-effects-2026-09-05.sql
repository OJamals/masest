begin;

-- Durable staff initiated Order email effects. The existing guarded mutation remains
-- authoritative; these wrappers append the email intent in the same transaction.

create or replace function public.enqueue_order_email_effect(
  p_provider_event_id text, p_event_type text, p_provider_object_id text,
  p_effect_key text, p_effect_type text, p_order_id uuid, p_payload jsonb, p_metadata jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_event_id uuid;
  v_existing public.integration_events%rowtype;
  v_effect public.integration_effects%rowtype;
  v_effects jsonb;
  v_payload_hash text;
begin
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
      or p_order_id is null
      or btrim(coalesce(p_provider_event_id, '')) = ''
      or btrim(coalesce(p_event_type, '')) = ''
      or btrim(coalesce(p_effect_key, '')) = ''
      or p_payload->>'order_id' is distinct from p_order_id::text
      or p_effect_type not in ('order_tracking_email', 'return_label_email') then
    raise exception 'order_email_effect_invalid';
  end if;
  v_payload_hash := encode(
    extensions.digest(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_advisory_xact_lock(hashtextextended('masest:order-email:' || p_provider_event_id, 0));
  v_effects := jsonb_build_array(jsonb_build_object(
    'effect_key', p_effect_key, 'effect_type', p_effect_type,
    'aggregate_type', 'order', 'aggregate_id', p_order_id::text, 'payload', p_payload
  ));
  select * into v_existing from public.integration_events
    where provider = 'masest' and environment_or_tenant = 'production'
      and provider_event_id = p_provider_event_id for update;
  if found then
    if v_existing.provider_event_type is distinct from p_event_type
        or v_existing.provider_object_id is distinct from nullif(btrim(p_provider_object_id), '')
        or v_existing.payload_sha256 is distinct from v_payload_hash then
      raise exception 'order_email_event_identity_collision';
    end if;
    select * into v_effect from public.integration_effects
      where event_id = v_existing.id and effect_key = p_effect_key for update;
    if found then
      if v_effect.effect_type is distinct from p_effect_type
          or v_effect.aggregate_type is distinct from 'order'
          or v_effect.aggregate_id is distinct from p_order_id::text
          or v_effect.payload is distinct from p_payload then
        raise exception 'order_email_effect_identity_collision';
      end if;
      return v_existing.id;
    end if;
    -- The canonical event was retained but its effect was not; replay through
    -- the shared ingest seam using the original immutable event identity.
    v_event_id := public.ingest_integration_event(
      v_existing.provider, v_existing.environment_or_tenant, v_existing.provider_event_id,
      v_existing.provider_event_type, v_existing.provider_object_id, v_existing.occurred_at,
      v_existing.signature_verified_at, v_existing.payload_sha256, v_existing.metadata, v_effects);
    return v_event_id;
  end if;
  v_event_id := public.ingest_integration_event(
    'masest', 'production', p_provider_event_id, p_event_type, p_provider_object_id,
    now(), now(), v_payload_hash,
    coalesce(p_metadata, '{}'::jsonb),
    v_effects
  );
  return v_event_id;
end;
$$;

revoke all on function public.enqueue_order_email_effect(text,text,text,text,text,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_order_email_effect(text,text,text,text,text,uuid,jsonb,jsonb) to service_role;

create or replace function public.assert_order_email_effects_ready() returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if to_regprocedure('public.ingest_integration_event(text,text,text,text,text,timestamptz,timestamptz,text,jsonb,jsonb)') is null
      or to_regprocedure('public.finalize_shipstation_return_label_with_email(uuid,text,text,numeric,text,text,text,text,text)') is null
      or to_regprocedure('public.finalize_shipstation_return_label_reconciliation_with_email(uuid,text,text,numeric,text,text,text,text,text)') is null then
    raise exception 'order_email_effects_not_ready';
  end if;
  return jsonb_build_object('ready', true);
end;
$$;
revoke all on function public.assert_order_email_effects_ready() from public, anon, authenticated;
grant execute on function public.assert_order_email_effects_ready() to service_role;

create or replace function public.update_order_tracking_with_email(
  p_order_id uuid,
  p_operation_id uuid,
  p_expected_status text,
  p_tracking_status text,
  p_carrier text default null,
  p_tracking_number text default null,
  p_tracking_url text default null,
  p_estimated_delivery_at timestamptz default null,
  p_shipped_at timestamptz default null,
  p_promote_fulfilled boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order jsonb;
  v_payload jsonb;
  v_event_id uuid;
begin
  if p_operation_id is null then raise exception 'tracking_operation_id_required'; end if;
  select to_jsonb(o) into v_order from public.orders o where o.id = p_order_id for update;
  if v_order is null then raise exception 'order_not_found'; end if;
  if exists (select 1 from public.integration_events e where e.provider = 'masest'
      and e.environment_or_tenant = 'production' and e.provider_event_id = p_operation_id::text
      and (e.metadata->>'order_id') = p_order_id::text
      and (e.metadata->>'tracking_status') is not distinct from p_tracking_status
      and (e.metadata->>'carrier') is not distinct from p_carrier
      and (e.metadata->>'tracking_number') is not distinct from p_tracking_number
      and (e.metadata->>'tracking_url') is not distinct from p_tracking_url
      and (e.metadata->>'estimated_delivery_at')::timestamptz is not distinct from p_estimated_delivery_at
      and (e.metadata->>'shipped_at')::timestamptz is not distinct from p_shipped_at
      and (e.metadata->>'promote_fulfilled') is not distinct from p_promote_fulfilled::text) then
    return v_order || jsonb_build_object('operation_id', p_operation_id);
  end if;
  if exists (select 1 from public.integration_events e where e.provider = 'masest'
      and e.environment_or_tenant = 'production' and e.provider_event_id = p_operation_id::text) then
    raise exception 'tracking_operation_id_conflict';
  end if;
  v_order := public.update_order_tracking_guarded(
    p_order_id, p_expected_status, p_tracking_status, p_carrier, p_tracking_number,
    p_tracking_url, p_estimated_delivery_at, p_shipped_at, p_promote_fulfilled
  );
  v_payload := jsonb_build_object('order_id', p_order_id, 'operation_id', p_operation_id);
  v_event_id := public.enqueue_order_email_effect(
    p_operation_id::text, 'manual_tracking_email', p_order_id::text,
    'order-tracking-email-' || p_operation_id::text, 'order_tracking_email', p_order_id,
    v_payload, jsonb_build_object('order_id', p_order_id, 'order_number', v_order->>'order_number',
      'customer_email', v_order->>'customer_email', 'company_id', v_order->>'company_id',
      'tracking_status', v_order->>'tracking_status', 'carrier', v_order->>'carrier',
      'tracking_number', v_order->>'tracking_number', 'tracking_url', v_order->>'tracking_url',
      'estimated_delivery_at', v_order->>'estimated_delivery_at', 'shipped_at', v_order->>'shipped_at',
      'promote_fulfilled', p_promote_fulfilled)
  );
  return v_order || jsonb_build_object('operation_id', p_operation_id, 'event_id', v_event_id);
end;
$$;

create or replace function public.finalize_shipstation_return_label_with_email(
  p_order_id uuid,
  p_outbound_label_id text,
  p_return_label_id text,
  p_cost numeric,
  p_currency text,
  p_charge_event text,
  p_tracking_number text,
  p_reason text,
  p_label_url text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_payload jsonb;
  v_event_id uuid;
  v_order public.orders%rowtype;
begin
  v_result := public.finalize_shipstation_return_label(
    p_order_id, p_outbound_label_id, p_return_label_id, p_cost, p_currency,
    p_charge_event, p_tracking_number, p_reason
  );
  v_payload := jsonb_build_object('order_id', p_order_id, 'return_id', p_return_label_id);
  select * into v_order from public.orders where id = p_order_id;
  v_event_id := public.enqueue_order_email_effect(
    'return-label-email-' || p_return_label_id, 'return_label_email', p_return_label_id,
    'return-label-email-' || p_return_label_id, 'return_label_email', p_order_id, v_payload,
    jsonb_build_object('order_number', v_order.order_number, 'customer_email', v_order.customer_email,
      'outbound_label_id', p_outbound_label_id, 'reason', p_reason,
      'cost', p_cost, 'currency', p_currency, 'charge_event', p_charge_event,
      'tracking_number', p_tracking_number, 'label_url', p_label_url,
      'carrier', v_order.carrier)
  );
  return v_result || jsonb_build_object('event_id', v_event_id);
end;
$$;

revoke all on function public.update_order_tracking_with_email(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean) from public, anon, authenticated;
revoke all on function public.finalize_shipstation_return_label_with_email(uuid,text,text,numeric,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.update_order_tracking_with_email(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean) to service_role;
grant execute on function public.finalize_shipstation_return_label_with_email(uuid,text,text,numeric,text,text,text,text,text) to service_role;

create or replace function public.finalize_shipstation_return_label_reconciliation_with_email(
  p_order_id uuid, p_outbound_label_id text, p_return_label_id text, p_cost numeric,
  p_currency text, p_charge_event text, p_tracking_number text, p_reason text,
  p_label_url text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_result jsonb;
  v_payload jsonb;
  v_event_id uuid;
  v_order public.orders%rowtype;
begin
  v_result := public.finalize_shipstation_return_label_reconciliation(
    p_order_id, p_outbound_label_id, p_return_label_id, p_cost, p_currency,
    p_charge_event, p_tracking_number, p_reason);
  v_payload := jsonb_build_object('order_id', p_order_id, 'return_id', p_return_label_id);
  select * into v_order from public.orders where id = p_order_id;
  v_event_id := public.enqueue_order_email_effect(
    'return-label-email-' || p_return_label_id, 'return_label_email', p_return_label_id,
    'return-label-email-' || p_return_label_id, 'return_label_email', p_order_id, v_payload,
    jsonb_build_object('order_number', v_order.order_number, 'customer_email', v_order.customer_email,
      'outbound_label_id', p_outbound_label_id, 'reason', p_reason,
      'tracking_number', p_tracking_number, 'label_url', p_label_url,
      'carrier', v_order.carrier));
  return v_result || jsonb_build_object('event_id', v_event_id);
end;
$$;
revoke all on function public.finalize_shipstation_return_label_reconciliation_with_email(uuid,text,text,numeric,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.finalize_shipstation_return_label_reconciliation_with_email(uuid,text,text,numeric,text,text,text,text,text) to service_role;

commit;
