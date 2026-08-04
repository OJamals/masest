-- Remove legacy Stripe-only effect persistence after generic runtime deployment.
-- Exact count/checksum parity for every legacy row is mandatory. Generic-only rows
-- may arrive after runtime deployment and before this transaction; rollback restores them.

do $$
declare
  v_legacy_count bigint;
  v_generic_count bigint;
  v_legacy_sha256 text;
  v_generic_sha256 text;
begin
  if to_regclass('public.stripe_webhook_effects') is null then
    return;
  end if;

  select count(*) into v_legacy_count from public.stripe_webhook_effects;
  select count(*)
    into v_generic_count
    from public.integration_effects as effect
    join public.integration_events as event on event.id = effect.event_id
    join public.stripe_webhook_effects as legacy on legacy.id = effect.id
   where event.provider = 'stripe'
     and event.environment_or_tenant = 'production';
  if v_legacy_count is distinct from v_generic_count then
    raise exception 'integration_cutover_count_mismatch';
  end if;

  select encode(extensions.digest(convert_to(
    coalesce(string_agg(row_value, E'\n' order by row_value), ''), 'UTF8'
  ), 'sha256'), 'hex')
  into v_legacy_sha256
  from (
    select jsonb_build_object(
      'id', effect.id,
      'event', effect.stripe_event_id,
      'key', effect.effect_key,
      'type', effect.effect_type,
      'payload', effect.payload,
      'depends', effect.depends_on_effect_key,
      'status', effect.status,
      'attempts', effect.attempt_count,
      'available', effect.available_at,
      'lease_owner', effect.lease_owner,
      'lease_expires', effect.lease_expires_at,
      'provider_succeeded', effect.provider_succeeded_at,
      'provider_result', effect.provider_result,
      'error', effect.last_error_code,
      'completed', effect.completed_at,
      'dead', effect.dead_at,
      'created', effect.created_at,
      'updated', effect.updated_at
    )::text as row_value
    from public.stripe_webhook_effects as effect
  ) as legacy_rows;

  select encode(extensions.digest(convert_to(
    coalesce(string_agg(row_value, E'\n' order by row_value), ''), 'UTF8'
  ), 'sha256'), 'hex')
  into v_generic_sha256
  from (
    select jsonb_build_object(
      'id', effect.id,
      'event', event.provider_event_id,
      'key', effect.effect_key,
      'type', effect.effect_type,
      'payload', effect.payload,
      'depends', effect.depends_on_effect_key,
      'status', effect.status,
      'attempts', effect.attempt_count,
      'available', effect.available_at,
      'lease_owner', effect.lease_owner,
      'lease_expires', effect.lease_expires_at,
      'provider_succeeded', effect.provider_succeeded_at,
      'provider_result', effect.provider_result,
      'error', effect.last_error_code,
      'completed', effect.completed_at,
      'dead', effect.dead_at,
      'created', effect.created_at,
      'updated', effect.updated_at
    )::text as row_value
    from public.integration_effects as effect
    join public.integration_events as event on event.id = effect.event_id
    join public.stripe_webhook_effects as legacy on legacy.id = effect.id
   where event.provider = 'stripe'
     and event.environment_or_tenant = 'production'
  ) as generic_rows;

  if v_legacy_sha256 is distinct from v_generic_sha256 then
    raise exception 'integration_cutover_checksum_mismatch';
  end if;
end;
$$;

drop function if exists public.claim_stripe_webhook_effects(text, integer, integer);
drop function if exists public.record_stripe_webhook_effect_success(uuid, text, jsonb);
drop function if exists public.complete_stripe_webhook_effect(uuid, text);
drop function if exists public.retry_stripe_webhook_effect(uuid, text, text, integer, integer);
drop function if exists public.apply_stripe_stock_effect(uuid, text);
drop function if exists public.deliver_stripe_notification_effect(uuid, text, jsonb);
drop table public.stripe_webhook_effects;
