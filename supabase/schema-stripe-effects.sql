-- Durable Stripe webhook effect ledger.
-- Apply only after operator approval; no production migration or scheduler is created here.
-- Idempotent: safe to re-run after schema-phase5.sql and schema-order-integrity.sql.

create table if not exists public.stripe_webhook_effects (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null check (
    char_length(stripe_event_id) between 1 and 255
  ),
  effect_key text not null check (
    effect_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'
  ),
  effect_type text not null check (effect_type in (
    'stock_decrement',
    'oversell_alert',
    'order_confirmation',
    'ach_failure_email',
    'company_notification',
    'billing_failure_email',
    'billing_recovery_email',
    'dispute_alert'
  )),
  payload jsonb not null default '{}'::jsonb check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 4096
    and not payload ?| array[
      'raw',
      'provider_payload',
      'stripe_payload',
      'secret',
      'token',
      'api_key'
    ]
  ),
  depends_on_effect_key text,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'completed', 'dead')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  provider_succeeded_at timestamptz,
  provider_result jsonb,
  last_error_code text,
  completed_at timestamptz,
  dead_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_webhook_effects_event_key_uniq
    unique (stripe_event_id, effect_key),
  constraint stripe_webhook_effects_dependency_fk
    foreign key (stripe_event_id, depends_on_effect_key)
    references public.stripe_webhook_effects (stripe_event_id, effect_key)
    deferrable initially deferred,
  constraint stripe_webhook_effects_lease_shape check (
    (status = 'processing' and lease_owner is not null and lease_expires_at is not null)
    or
    (status <> 'processing' and lease_owner is null and lease_expires_at is null)
  )
);

create index if not exists stripe_webhook_effects_claim_idx
  on public.stripe_webhook_effects (status, available_at, lease_expires_at, created_at)
  where status in ('pending', 'processing');

alter table public.stripe_webhook_effects enable row level security;
revoke all on table public.stripe_webhook_effects from public;
revoke all on table public.stripe_webhook_effects from anon, authenticated;
grant all on table public.stripe_webhook_effects to service_role;

-- Claim a bounded batch. Expired processing leases are eligible for reclaim.
create or replace function public.claim_stripe_webhook_effects(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
) returns setof public.stripe_webhook_effects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 25);
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 60), 15), 900);
begin
  if v_worker_id = '' or char_length(v_worker_id) > 128 then
    raise exception 'invalid_worker_id';
  end if;

  -- Terminal orders make their not-yet-delivered purchase effects obsolete.
  -- Finish these rows before claiming work so a delayed worker cannot send stale
  -- confirmations, decrement returned stock, or create stale order notifications.
  update public.stripe_webhook_effects as effect
     set status = 'completed',
         lease_owner = null,
         lease_expires_at = null,
         provider_succeeded_at = coalesce(effect.provider_succeeded_at, now()),
         provider_result = coalesce(
           effect.provider_result,
           case
             when effect.effect_type = 'stock_decrement' then
               jsonb_build_object('shorted_skus', '[]'::jsonb, 'skipped', 'order_terminal')
             else jsonb_build_object('skipped', 'order_terminal')
           end
         ),
         completed_at = coalesce(effect.completed_at, now()),
         last_error_code = null,
         updated_at = now()
    from public.orders as order_row
   where effect.payload ->> 'order_id' = order_row.id::text
     and order_row.status in ('cancelled', 'refunded')
     and (
       effect.status = 'pending'
       or (
         effect.status = 'processing'
         and effect.lease_expires_at <= now()
       )
     )
     and (
       effect.effect_type in ('stock_decrement', 'oversell_alert', 'order_confirmation')
       or (
         effect.effect_type = 'company_notification'
         and effect.payload ->> 'kind' in ('order_received', 'payment_cleared')
       )
     );

  return query
  with candidates as (
    select effect.id
      from public.stripe_webhook_effects as effect
     where (
       (
         effect.status = 'pending'
         and effect.available_at <= now()
       )
       or
       (
         effect.status = 'processing'
         and effect.lease_expires_at <= now()
       )
     )
       and (
         effect.depends_on_effect_key is null
         or exists (
           select 1
             from public.stripe_webhook_effects as dependency
            where dependency.stripe_event_id = effect.stripe_event_id
              and dependency.effect_key = effect.depends_on_effect_key
              and dependency.status = 'completed'
         )
       )
     order by effect.available_at, effect.created_at, effect.id
     for update skip locked
     limit v_limit
  )
  update public.stripe_webhook_effects as effect
     set status = 'processing',
         attempt_count = effect.attempt_count + 1,
         lease_owner = v_worker_id,
         lease_expires_at = now() + make_interval(secs => v_lease_seconds),
         updated_at = now()
    from candidates
   where effect.id = candidates.id
  returning effect.*;
end;
$$;

-- Record an external provider success before the separate completion write. Reclaimed
-- rows with this marker skip the provider call and only finish ledger bookkeeping.
create or replace function public.record_stripe_webhook_effect_success(
  p_effect_id uuid,
  p_worker_id text,
  p_result jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stripe_webhook_effects
     set provider_succeeded_at = coalesce(provider_succeeded_at, now()),
         provider_result = coalesce(provider_result, coalesce(p_result, '{}'::jsonb)),
         updated_at = now()
   where id = p_effect_id
     and status = 'processing'
     and lease_owner = p_worker_id;
  return found;
end;
$$;

create or replace function public.complete_stripe_webhook_effect(
  p_effect_id uuid,
  p_worker_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stripe_webhook_effects
     set status = 'completed',
         lease_owner = null,
         lease_expires_at = null,
         completed_at = coalesce(completed_at, now()),
         last_error_code = null,
         updated_at = now()
   where id = p_effect_id
     and status = 'processing'
     and lease_owner = p_worker_id
     and provider_succeeded_at is not null;
  return found;
end;
$$;

create or replace function public.retry_stripe_webhook_effect(
  p_effect_id uuid,
  p_worker_id text,
  p_error_code text,
  p_max_attempts integer default 8,
  p_base_backoff_seconds integer default 30
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.stripe_webhook_effects%rowtype;
  v_max_attempts integer := least(greatest(coalesce(p_max_attempts, 8), 1), 20);
  v_base_seconds integer := least(greatest(coalesce(p_base_backoff_seconds, 30), 1), 3600);
  v_error_code text := left(
    regexp_replace(lower(coalesce(p_error_code, 'effect_failed')), '[^a-z0-9_:-]', '_', 'g'),
    80
  );
begin
  select *
    into v_effect
    from public.stripe_webhook_effects
   where id = p_effect_id
     and status = 'processing'
     and lease_owner = p_worker_id
   for update;

  if not found then
    raise exception 'effect_lease_not_owned';
  end if;

  if v_effect.attempt_count >= v_max_attempts then
    update public.stripe_webhook_effects
       set status = 'dead',
           lease_owner = null,
           lease_expires_at = null,
           last_error_code = v_error_code,
           dead_at = now(),
           updated_at = now()
     where id = p_effect_id;
    return 'dead';
  end if;

  update public.stripe_webhook_effects
     set status = 'pending',
         lease_owner = null,
         lease_expires_at = null,
         available_at = now() + make_interval(
           secs => least(
             21600,
             v_base_seconds * power(2, least(greatest(v_effect.attempt_count - 1, 0), 10))
           )::double precision
         ),
         last_error_code = v_error_code,
         updated_at = now()
   where id = p_effect_id;
  return 'pending';
end;
$$;

-- Stock is a local provider effect. Decrement + provider marker share one transaction,
-- so response loss cannot apply inventory twice.
create or replace function public.apply_stripe_stock_effect(
  p_effect_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.stripe_webhook_effects%rowtype;
  v_order_id uuid;
  v_order_status public.order_status;
  v_line record;
  v_applied boolean;
  v_shorted text[] := array[]::text[];
  v_result jsonb;
begin
  select *
    into v_effect
    from public.stripe_webhook_effects
   where id = p_effect_id
   for update;

  if not found
     or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'stock_decrement' then
    raise exception 'invalid_stock_effect_lease';
  end if;

  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{"shorted_skus":[]}'::jsonb);
  end if;

  begin
    v_order_id := nullif(v_effect.payload ->> 'order_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_stock_effect_order';
  end;
  if v_order_id is null then
    raise exception 'invalid_stock_effect_order';
  end if;

  select status
    into v_order_status
    from public.orders
   where id = v_order_id;
  if not found then
    raise exception 'invalid_stock_effect_order';
  end if;
  if v_order_status in ('cancelled', 'refunded') then
    v_result := jsonb_build_object(
      'shorted_skus', '[]'::jsonb,
      'skipped', 'order_terminal'
    );
    update public.stripe_webhook_effects
       set provider_succeeded_at = now(),
           provider_result = v_result,
           updated_at = now()
     where id = p_effect_id;
    return v_result;
  end if;

  for v_line in
    select item.sku, item.qty
      from public.order_items as item
     where item.order_id = v_order_id
       and item.sku is not null
       and item.qty > 0
       and coalesce(item.backordered, false) is false
     order by item.id
  loop
    select public.decrement_variant_stock(v_line.sku, v_line.qty)
      into v_applied;
    if v_applied is distinct from true then
      v_shorted := array_append(v_shorted, v_line.sku);
    end if;
  end loop;

  v_result := jsonb_build_object('shorted_skus', to_jsonb(v_shorted));
  update public.stripe_webhook_effects
     set provider_succeeded_at = now(),
         provider_result = v_result,
         updated_at = now()
   where id = p_effect_id;
  return v_result;
end;
$$;

-- Notification insert + provider marker share one transaction for response-loss safety.
create or replace function public.deliver_stripe_notification_effect(
  p_effect_id uuid,
  p_worker_id text,
  p_notification jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.stripe_webhook_effects%rowtype;
  v_order_id uuid;
  v_order_status public.order_status;
  v_company_id uuid;
  v_type text;
  v_title text;
  v_body text;
  v_link text;
begin
  select *
    into v_effect
    from public.stripe_webhook_effects
   where id = p_effect_id
   for update;

  if not found
     or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'company_notification' then
    raise exception 'invalid_notification_effect_lease';
  end if;

  if v_effect.provider_succeeded_at is not null then
    return true;
  end if;

  if v_effect.payload ->> 'kind' in ('order_received', 'payment_cleared') then
    begin
      v_order_id := nullif(v_effect.payload ->> 'order_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_notification_effect_order';
    end;
    if v_order_id is null then
      raise exception 'invalid_notification_effect_order';
    end if;
    select status
      into v_order_status
      from public.orders
     where id = v_order_id;
    if not found then
      raise exception 'invalid_notification_effect_order';
    end if;
    if v_order_status in ('cancelled', 'refunded') then
      update public.stripe_webhook_effects
         set provider_succeeded_at = now(),
             provider_result = jsonb_build_object('skipped', 'order_terminal'),
             updated_at = now()
       where id = p_effect_id;
      return true;
    end if;
  end if;

  if jsonb_typeof(p_notification) <> 'object' then
    raise exception 'invalid_notification';
  end if;
  begin
    v_company_id := nullif(p_notification ->> 'company_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_notification';
  end;
  v_type := p_notification ->> 'type';
  v_title := btrim(coalesce(p_notification ->> 'title', ''));
  v_body := btrim(coalesce(p_notification ->> 'body', ''));
  v_link := btrim(coalesce(p_notification ->> 'link', ''));
  if v_company_id is null
     or v_type is null
     or v_type not in ('order', 'account')
     or v_title = ''
     or char_length(v_title) > 160
     or v_body = ''
     or char_length(v_body) > 500
     or v_link = ''
     or char_length(v_link) > 500 then
    raise exception 'invalid_notification';
  end if;

  insert into public.notifications (company_id, type, title, body, link)
  values (v_company_id, v_type::public.notification_type, v_title, v_body, v_link);

  update public.stripe_webhook_effects
     set provider_succeeded_at = now(),
         provider_result = '{"inserted":true}'::jsonb,
         updated_at = now()
   where id = p_effect_id;
  return true;
end;
$$;

revoke all on function public.claim_stripe_webhook_effects(text, integer, integer) from public;
revoke all on function public.record_stripe_webhook_effect_success(uuid, text, jsonb) from public;
revoke all on function public.complete_stripe_webhook_effect(uuid, text) from public;
revoke all on function public.retry_stripe_webhook_effect(uuid, text, text, integer, integer) from public;
revoke all on function public.apply_stripe_stock_effect(uuid, text) from public;
revoke all on function public.deliver_stripe_notification_effect(uuid, text, jsonb) from public;

revoke execute on function public.claim_stripe_webhook_effects(text, integer, integer) from anon, authenticated;
revoke execute on function public.record_stripe_webhook_effect_success(uuid, text, jsonb) from anon, authenticated;
revoke execute on function public.complete_stripe_webhook_effect(uuid, text) from anon, authenticated;
revoke execute on function public.retry_stripe_webhook_effect(uuid, text, text, integer, integer) from anon, authenticated;
revoke execute on function public.apply_stripe_stock_effect(uuid, text) from anon, authenticated;
revoke execute on function public.deliver_stripe_notification_effect(uuid, text, jsonb) from anon, authenticated;

grant execute on function public.claim_stripe_webhook_effects(text, integer, integer) to service_role;
grant execute on function public.record_stripe_webhook_effect_success(uuid, text, jsonb) to service_role;
grant execute on function public.complete_stripe_webhook_effect(uuid, text) to service_role;
grant execute on function public.retry_stripe_webhook_effect(uuid, text, text, integer, integer) to service_role;
grant execute on function public.apply_stripe_stock_effect(uuid, text) to service_role;
grant execute on function public.deliver_stripe_notification_effect(uuid, text, jsonb) to service_role;
