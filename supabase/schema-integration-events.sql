-- Generic provider inbox/outbox ledger.
-- Additive foundation: current Stripe callers remain on stripe_webhook_effects until cutover.
-- Apply after schema-stripe-effects.sql. Safe to re-run; migration parity fails closed.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.integration_json_has_forbidden_key(p_value jsonb)
returns boolean
language sql
immutable
strict
set search_path = public
as $$
  select case jsonb_typeof(p_value)
    when 'object' then exists (
      select 1
        from jsonb_each(p_value) as entry(key, value)
       where lower(entry.key) = any(array[
         'raw',
         'raw_payload',
         'rawpayload',
         'payload',
         'provider_payload',
         'providerpayload',
         'stripe_payload',
         'stripepayload',
         'secret',
         'token',
         'api_key',
         'apikey',
         'signature',
         'authorization',
         'card',
         'bank',
         'routing_number',
         'routingnumber',
         'account_number',
         'accountnumber'
       ])
          or public.integration_json_has_forbidden_key(entry.value)
    )
    when 'array' then exists (
      select 1
        from jsonb_array_elements(p_value) as item(value)
       where public.integration_json_has_forbidden_key(item.value)
    )
    else false
  end;
$$;

revoke all on function public.integration_json_has_forbidden_key(jsonb) from public;
revoke execute on function public.integration_json_has_forbidden_key(jsonb) from anon, authenticated;
grant execute on function public.integration_json_has_forbidden_key(jsonb) to service_role;

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (
    provider ~ '^[a-z][a-z0-9_-]{0,31}$'
  ),
  environment_or_tenant text not null default 'production' check (
    char_length(environment_or_tenant) between 1 and 128
  ),
  provider_event_id text not null check (
    char_length(provider_event_id) between 1 and 512
  ),
  provider_event_type text not null check (
    char_length(provider_event_type) between 1 and 160
  ),
  provider_object_id text check (
    provider_object_id is null or char_length(provider_object_id) between 1 and 255
  ),
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  signature_verified_at timestamptz,
  payload_sha256 text not null check (
    payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 2048
    and not public.integration_json_has_forbidden_key(metadata)
  ),
  status text not null default 'received' check (
    status in ('received', 'processing', 'processed', 'retry', 'dead', 'ignored', 'quarantined')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  processed_at timestamptz,
  dead_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_events_provider_identity_uniq
    unique (provider, environment_or_tenant, provider_event_id),
  constraint integration_events_lease_shape check (
    (status = 'processing' and lease_owner is not null and lease_expires_at is not null)
    or
    (status <> 'processing' and lease_owner is null and lease_expires_at is null)
  )
);

create table if not exists public.integration_effects (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.integration_events(id) on delete restrict,
  effect_key text not null check (
    effect_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'
  ),
  effect_type text not null check (
    effect_type ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  aggregate_type text check (
    aggregate_type is null or aggregate_type ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  aggregate_id text check (
    aggregate_id is null or char_length(aggregate_id) between 1 and 255
  ),
  payload jsonb not null default '{}'::jsonb check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 8192
    and not public.integration_json_has_forbidden_key(payload)
  ),
  payload_sha256 text not null check (
    payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  depends_on_effect_key text,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'completed', 'dead')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  provider_succeeded_at timestamptz,
  provider_result jsonb check (
    provider_result is null
    or (
      jsonb_typeof(provider_result) = 'object'
      and octet_length(provider_result::text) <= 4096
      and not public.integration_json_has_forbidden_key(provider_result)
    )
  ),
  last_http_status integer check (
    last_http_status is null or last_http_status between 100 and 599
  ),
  last_error_code text check (
    last_error_code is null or char_length(last_error_code) between 1 and 80
  ),
  completed_at timestamptz,
  dead_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_effects_event_key_uniq
    unique (event_id, effect_key),
  constraint integration_effects_dependency_fk
    foreign key (event_id, depends_on_effect_key)
    references public.integration_effects (event_id, effect_key)
    deferrable initially deferred,
  constraint integration_effects_lease_shape check (
    (status = 'processing' and lease_owner is not null and lease_expires_at is not null)
    or
    (status <> 'processing' and lease_owner is null and lease_expires_at is null)
  )
);

create table if not exists public.integration_attempts (
  id uuid primary key default gen_random_uuid(),
  effect_id uuid not null references public.integration_effects(id) on delete restrict,
  attempt_number integer not null check (attempt_number >= 0),
  action text not null check (
    action in ('migrated', 'claimed', 'provider_succeeded', 'completed', 'retry', 'dead', 'replay')
  ),
  outcome text not null check (
    outcome in ('migrated', 'processing', 'succeeded', 'completed', 'pending', 'dead', 'replayed')
  ),
  worker_id text check (
    worker_id is null or char_length(worker_id) between 1 and 128
  ),
  actor text check (
    actor is null or char_length(actor) between 1 and 128
  ),
  reason text check (
    reason is null or char_length(reason) between 1 and 500
  ),
  http_status integer check (
    http_status is null or http_status between 100 and 599
  ),
  provider_request_id text check (
    provider_request_id is null or char_length(provider_request_id) between 1 and 255
  ),
  response_sha256 text check (
    response_sha256 is null or response_sha256 ~ '^[a-f0-9]{64}$'
  ),
  error_code text check (
    error_code is null or char_length(error_code) between 1 and 80
  ),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists integration_events_status_idx
  on public.integration_events (provider, status, received_at);
create index if not exists integration_effects_claim_idx
  on public.integration_effects (status, available_at, lease_expires_at, created_at)
  where status in ('pending', 'processing');
create index if not exists integration_effects_event_idx
  on public.integration_effects (event_id, created_at);
create index if not exists integration_attempts_effect_idx
  on public.integration_attempts (effect_id, created_at, id);

create or replace function public.guard_integration_event_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.provider is distinct from old.provider
     or new.environment_or_tenant is distinct from old.environment_or_tenant
     or new.provider_event_id is distinct from old.provider_event_id
     or new.provider_event_type is distinct from old.provider_event_type
     or new.provider_object_id is distinct from old.provider_object_id
     or new.occurred_at is distinct from old.occurred_at
     or new.received_at is distinct from old.received_at
     or new.signature_verified_at is distinct from old.signature_verified_at
     or new.payload_sha256 is distinct from old.payload_sha256
     or new.metadata is distinct from old.metadata
     or new.created_at is distinct from old.created_at
     or new.attempt_count < old.attempt_count
     or (old.processed_at is not null and new.processed_at is distinct from old.processed_at)
     or (old.dead_at is not null and new.dead_at is distinct from old.dead_at) then
    raise exception 'integration_event_identity_immutable';
  end if;
  return new;
end;
$$;

create or replace function public.guard_integration_effect_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.event_id is distinct from old.event_id
     or new.effect_key is distinct from old.effect_key
     or new.effect_type is distinct from old.effect_type
     or new.aggregate_type is distinct from old.aggregate_type
     or new.aggregate_id is distinct from old.aggregate_id
     or new.payload is distinct from old.payload
     or new.payload_sha256 is distinct from old.payload_sha256
     or new.depends_on_effect_key is distinct from old.depends_on_effect_key
     or new.max_attempts is distinct from old.max_attempts
     or new.created_at is distinct from old.created_at
     or new.attempt_count < old.attempt_count
     or (old.provider_succeeded_at is not null and new.provider_succeeded_at is distinct from old.provider_succeeded_at)
     or (old.provider_succeeded_at is not null and new.provider_result is distinct from old.provider_result)
     or (old.completed_at is not null and new.completed_at is distinct from old.completed_at)
     or (old.dead_at is not null and new.dead_at is distinct from old.dead_at) then
    raise exception 'integration_effect_identity_immutable';
  end if;
  return new;
end;
$$;

create or replace function public.integration_attempts_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'immutable_audit_history';
end;
$$;

create or replace function public.touch_integration_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists integration_events_identity_immutable on public.integration_events;
create trigger integration_events_identity_immutable
before update on public.integration_events
for each row execute function public.guard_integration_event_identity();

drop trigger if exists integration_effects_identity_immutable on public.integration_effects;
create trigger integration_effects_identity_immutable
before update on public.integration_effects
for each row execute function public.guard_integration_effect_identity();

drop trigger if exists integration_attempts_append_only on public.integration_attempts;
create trigger integration_attempts_append_only
before update or delete on public.integration_attempts
for each row execute function public.integration_attempts_append_only();

drop trigger if exists integration_events_touch_updated_at on public.integration_events;
create trigger integration_events_touch_updated_at
before update on public.integration_events
for each row execute function public.touch_integration_updated_at();

drop trigger if exists integration_effects_touch_updated_at on public.integration_effects;
create trigger integration_effects_touch_updated_at
before update on public.integration_effects
for each row execute function public.touch_integration_updated_at();

alter table public.integration_events enable row level security;
alter table public.integration_effects enable row level security;
alter table public.integration_attempts enable row level security;

revoke all on table public.integration_events from public;
revoke all on table public.integration_effects from public;
revoke all on table public.integration_attempts from public;
revoke all on table public.integration_events from anon, authenticated;
revoke all on table public.integration_effects from anon, authenticated;
revoke all on table public.integration_attempts from anon, authenticated;
revoke all on table public.integration_events from service_role;
revoke all on table public.integration_effects from service_role;
revoke all on table public.integration_attempts from service_role;
grant select on table public.integration_events to service_role;
grant select on table public.integration_effects to service_role;
grant select on table public.integration_attempts to service_role;

create or replace function public.refresh_integration_event_state(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_pending integer;
  v_processing integer;
  v_completed integer;
  v_dead integer;
  v_attempts integer;
begin
  select count(*)::integer,
         count(*) filter (where status = 'pending')::integer,
         count(*) filter (where status = 'processing')::integer,
         count(*) filter (where status = 'completed')::integer,
         count(*) filter (where status = 'dead')::integer,
         coalesce(sum(attempt_count), 0)::integer
    into v_total, v_pending, v_processing, v_completed, v_dead, v_attempts
    from public.integration_effects
   where event_id = p_event_id;

  if v_total = 0 then
    return;
  end if;

  if v_processing > 0 then
    update public.integration_events
       set status = 'processing',
           attempt_count = greatest(attempt_count, v_attempts),
           lease_owner = 'effect-worker',
           lease_expires_at = now() + interval '15 minutes',
           last_error_code = null
     where id = p_event_id;
  elsif v_pending > 0 then
    update public.integration_events
       set status = case when v_attempts > 0 then 'retry' else 'received' end,
           attempt_count = greatest(attempt_count, v_attempts),
           lease_owner = null,
           lease_expires_at = null
     where id = p_event_id;
  elsif v_completed = v_total then
    update public.integration_events
       set status = 'processed',
           attempt_count = greatest(attempt_count, v_attempts),
           lease_owner = null,
           lease_expires_at = null,
           last_error_code = null,
           processed_at = coalesce(processed_at, now())
     where id = p_event_id;
  elsif v_dead > 0 then
    update public.integration_events
       set status = 'dead',
           attempt_count = greatest(attempt_count, v_attempts),
           lease_owner = null,
           lease_expires_at = null,
           dead_at = coalesce(dead_at, now())
     where id = p_event_id;
  end if;
end;
$$;

create or replace function public.ingest_integration_event(
  p_provider text,
  p_environment_or_tenant text,
  p_provider_event_id text,
  p_event_type text,
  p_provider_object_id text,
  p_occurred_at timestamptz,
  p_signature_verified_at timestamptz,
  p_payload_sha256 text,
  p_metadata jsonb default '{}'::jsonb,
  p_effects jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.integration_events%rowtype;
  v_effect jsonb;
  v_effect_row public.integration_effects%rowtype;
  v_payload jsonb;
  v_payload_sha256 text;
begin
  if jsonb_typeof(coalesce(p_effects, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_integration_effects';
  end if;

  insert into public.integration_events (
    provider,
    environment_or_tenant,
    provider_event_id,
    provider_event_type,
    provider_object_id,
    occurred_at,
    signature_verified_at,
    payload_sha256,
    metadata
  ) values (
    lower(btrim(coalesce(p_provider, ''))),
    btrim(coalesce(p_environment_or_tenant, '')),
    btrim(coalesce(p_provider_event_id, '')),
    btrim(coalesce(p_event_type, '')),
    nullif(btrim(coalesce(p_provider_object_id, '')), ''),
    p_occurred_at,
    p_signature_verified_at,
    lower(btrim(coalesce(p_payload_sha256, ''))),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (provider, environment_or_tenant, provider_event_id) do nothing
  returning * into v_event;

  if not found then
    select *
      into v_event
      from public.integration_events
     where provider = lower(btrim(coalesce(p_provider, '')))
       and environment_or_tenant = btrim(coalesce(p_environment_or_tenant, ''))
       and provider_event_id = btrim(coalesce(p_provider_event_id, ''))
     for update;

    -- Redelivery verification time is receipt-specific, not provider-event identity.
    -- Keep first receipt immutable without turning later valid signatures into collisions.
    -- Pre-cutover Stripe events carry synthetic receipt fields; their effect identities
    -- still compare below, allowing safe recovery after runtime cutover.
    if not (
      v_event.provider = 'stripe'
      and v_event.metadata ->> 'migrated_from' = 'stripe_webhook_effects'
    ) and (
       v_event.payload_sha256 is distinct from lower(btrim(coalesce(p_payload_sha256, '')))
       or v_event.provider_event_type is distinct from btrim(coalesce(p_event_type, ''))
       or v_event.provider_object_id is distinct from nullif(btrim(coalesce(p_provider_object_id, '')), '')
       or v_event.occurred_at is distinct from p_occurred_at
       or v_event.metadata is distinct from coalesce(p_metadata, '{}'::jsonb)
    ) then
      raise exception 'integration_event_identity_collision';
    end if;
  end if;

  for v_effect in select value from jsonb_array_elements(coalesce(p_effects, '[]'::jsonb))
  loop
    if jsonb_typeof(v_effect) <> 'object' then
      raise exception 'invalid_integration_effect';
    end if;
    v_payload := coalesce(v_effect -> 'payload', '{}'::jsonb);
    v_payload_sha256 := encode(
      extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
      'hex'
    );

    insert into public.integration_effects (
      event_id,
      effect_key,
      effect_type,
      aggregate_type,
      aggregate_id,
      payload,
      payload_sha256,
      depends_on_effect_key,
      max_attempts
    ) values (
      v_event.id,
      v_effect ->> 'effect_key',
      v_effect ->> 'effect_type',
      nullif(v_effect ->> 'aggregate_type', ''),
      nullif(v_effect ->> 'aggregate_id', ''),
      v_payload,
      v_payload_sha256,
      nullif(v_effect ->> 'depends_on_effect_key', ''),
      coalesce(nullif(v_effect ->> 'max_attempts', '')::integer, 8)
    )
    on conflict (event_id, effect_key) do nothing
    returning * into v_effect_row;

    if not found then
      select *
        into v_effect_row
        from public.integration_effects
       where event_id = v_event.id
         and effect_key = v_effect ->> 'effect_key';
      if v_effect_row.effect_type is distinct from v_effect ->> 'effect_type'
         or v_effect_row.aggregate_type is distinct from nullif(v_effect ->> 'aggregate_type', '')
         or v_effect_row.aggregate_id is distinct from nullif(v_effect ->> 'aggregate_id', '')
         or v_effect_row.payload is distinct from v_payload
         or v_effect_row.payload_sha256 is distinct from v_payload_sha256
         or v_effect_row.depends_on_effect_key is distinct from nullif(v_effect ->> 'depends_on_effect_key', '')
         or v_effect_row.max_attempts is distinct from coalesce(nullif(v_effect ->> 'max_attempts', '')::integer, 8) then
        raise exception 'integration_effect_identity_collision';
      end if;
    end if;
  end loop;

  if jsonb_array_length(coalesce(p_effects, '[]'::jsonb)) = 0
     and not exists (
       select 1 from public.integration_effects where event_id = v_event.id
     ) then
    update public.integration_events
       set status = 'ignored',
           processed_at = coalesce(processed_at, now()),
           lease_owner = null,
           lease_expires_at = null,
           last_error_code = null
     where id = v_event.id;
  end if;

  return v_event.id;
end;
$$;

create or replace function public.claim_integration_effects(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
) returns setof public.integration_effects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 25);
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 60), 15), 900);
  v_candidate public.integration_effects%rowtype;
  v_claimed public.integration_effects%rowtype;
begin
  if v_worker_id = '' or char_length(v_worker_id) > 128 then
    raise exception 'invalid_worker_id';
  end if;

  for v_candidate in
    select effect.*
      from public.integration_effects as effect
     where (
       (effect.status = 'pending' and effect.available_at <= now())
       or
       (effect.status = 'processing' and effect.lease_expires_at <= now())
     )
       and (
         effect.depends_on_effect_key is null
         or exists (
           select 1
             from public.integration_effects as dependency
            where dependency.event_id = effect.event_id
              and dependency.effect_key = effect.depends_on_effect_key
              and dependency.status = 'completed'
         )
       )
     order by effect.available_at, effect.created_at, effect.id
     for update skip locked
     limit v_limit
  loop
    update public.integration_effects as effect
       set status = 'processing',
           attempt_count = effect.attempt_count + 1,
           lease_owner = v_worker_id,
           lease_expires_at = now() + make_interval(secs => v_lease_seconds)
     where effect.id = v_candidate.id
     returning effect.* into v_claimed;

    insert into public.integration_attempts (
      effect_id, attempt_number, action, outcome, worker_id, started_at
    ) values (
      v_claimed.id, v_claimed.attempt_count, 'claimed', 'processing', v_worker_id, now()
    );

    perform public.refresh_integration_event_state(v_claimed.event_id);
    return next v_claimed;
  end loop;
end;
$$;

create or replace function public.record_integration_effect_success(
  p_effect_id uuid,
  p_worker_id text,
  p_result jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.integration_effects%rowtype;
begin
  update public.integration_effects as effect
     set provider_succeeded_at = coalesce(effect.provider_succeeded_at, now()),
         provider_result = coalesce(effect.provider_result, coalesce(p_result, '{}'::jsonb)),
         last_error_code = null
   where effect.id = p_effect_id
     and effect.status = 'processing'
     and effect.lease_owner = p_worker_id
  returning effect.* into v_effect;

  if not found then
    return false;
  end if;

  insert into public.integration_attempts (
    effect_id, attempt_number, action, outcome, worker_id, finished_at
  ) values (
    v_effect.id, v_effect.attempt_count, 'provider_succeeded', 'succeeded', p_worker_id, now()
  );
  return true;
end;
$$;

create or replace function public.complete_integration_effect(
  p_effect_id uuid,
  p_worker_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.integration_effects%rowtype;
begin
  update public.integration_effects as effect
     set status = 'completed',
         lease_owner = null,
         lease_expires_at = null,
         completed_at = coalesce(effect.completed_at, now()),
         last_error_code = null
   where effect.id = p_effect_id
     and effect.status = 'processing'
     and effect.lease_owner = p_worker_id
     and effect.provider_succeeded_at is not null
  returning effect.* into v_effect;

  if not found then
    return false;
  end if;

  insert into public.integration_attempts (
    effect_id, attempt_number, action, outcome, worker_id, finished_at
  ) values (
    v_effect.id, v_effect.attempt_count, 'completed', 'completed', p_worker_id, now()
  );
  perform public.refresh_integration_event_state(v_effect.event_id);
  return true;
end;
$$;

create or replace function public.fail_integration_effect(
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
  v_effect public.integration_effects%rowtype;
  v_max_attempts integer := least(greatest(coalesce(p_max_attempts, 8), 1), 20);
  v_base_seconds integer := least(greatest(coalesce(p_base_backoff_seconds, 30), 1), 3600);
  v_error_code text := left(
    regexp_replace(lower(coalesce(p_error_code, 'effect_failed')), '[^a-z0-9_:-]', '_', 'g'),
    80
  );
  v_cap_seconds double precision;
  v_delay_seconds double precision;
begin
  select *
    into v_effect
    from public.integration_effects
   where id = p_effect_id
     and status = 'processing'
     and lease_owner = p_worker_id
   for update;

  if not found then
    raise exception 'effect_lease_not_owned';
  end if;

  v_max_attempts := least(v_max_attempts, v_effect.max_attempts);
  if v_effect.attempt_count >= v_max_attempts then
    update public.integration_effects as effect
       set status = 'dead',
           lease_owner = null,
           lease_expires_at = null,
           last_error_code = v_error_code,
           dead_at = coalesce(effect.dead_at, now())
     where effect.id = p_effect_id
    returning effect.* into v_effect;

    insert into public.integration_attempts (
      effect_id, attempt_number, action, outcome, worker_id, error_code, finished_at
    ) values (
      v_effect.id, v_effect.attempt_count, 'dead', 'dead', p_worker_id, v_error_code, now()
    );

    -- A dead prerequisite can never become completed without explicit replay.
    -- Terminalize all pending descendants now so the event cannot remain in retry forever.
    with recursive blocked as (
      select child.id, child.effect_key
        from public.integration_effects as child
       where child.event_id = v_effect.event_id
         and child.depends_on_effect_key = v_effect.effect_key
         and child.status = 'pending'
      union
      select child.id, child.effect_key
        from public.integration_effects as child
        join blocked as parent on child.depends_on_effect_key = parent.effect_key
       where child.event_id = v_effect.event_id
         and child.status = 'pending'
    ), terminalized as (
      update public.integration_effects as child
         set status = 'dead',
             lease_owner = null,
             lease_expires_at = null,
             last_error_code = left('dependency_dead:' || v_effect.effect_key, 80),
             dead_at = coalesce(child.dead_at, now())
       where child.id in (select id from blocked)
      returning child.id, child.attempt_count
    )
    insert into public.integration_attempts (
      effect_id, attempt_number, action, outcome, worker_id, error_code, finished_at
    )
    select
      terminalized.id,
      terminalized.attempt_count,
      'dead',
      'dead',
      p_worker_id,
      left('dependency_dead:' || v_effect.effect_key, 80),
      now()
    from terminalized;

    perform public.refresh_integration_event_state(v_effect.event_id);
    return 'dead';
  end if;

  v_cap_seconds := least(
    21600::double precision,
    v_base_seconds::double precision * power(
      2::double precision,
      least(greatest(v_effect.attempt_count - 1, 0), 10)
    )
  );
  v_delay_seconds := random() * v_cap_seconds;

  update public.integration_effects as effect
     set status = 'pending',
         lease_owner = null,
         lease_expires_at = null,
         available_at = now() + make_interval(secs => v_delay_seconds),
         last_error_code = v_error_code
   where effect.id = p_effect_id
  returning effect.* into v_effect;

  insert into public.integration_attempts (
    effect_id, attempt_number, action, outcome, worker_id, error_code, finished_at
  ) values (
    v_effect.id, v_effect.attempt_count, 'retry', 'pending', p_worker_id, v_error_code, now()
  );
  perform public.refresh_integration_event_state(v_effect.event_id);
  return 'pending';
end;
$$;

create or replace function public.replay_integration_effect(
  p_effect_id uuid,
  p_actor text,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := btrim(coalesce(p_actor, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_effect public.integration_effects%rowtype;
begin
  if v_actor = '' or char_length(v_actor) > 128 then
    raise exception 'replay_actor_required';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'replay_reason_required';
  end if;

  update public.integration_effects as effect
     set status = 'pending',
         lease_owner = null,
         lease_expires_at = null,
         available_at = now(),
         last_error_code = null
   where effect.id = p_effect_id
     and effect.status = 'dead'
  returning effect.* into v_effect;

  if not found then
    return false;
  end if;

  insert into public.integration_attempts (
    effect_id, attempt_number, action, outcome, actor, reason, finished_at
  ) values (
    v_effect.id, v_effect.attempt_count, 'replay', 'replayed', v_actor, v_reason, now()
  );
  perform public.refresh_integration_event_state(v_effect.event_id);
  return true;
end;
$$;

-- Migrate the existing Stripe ledger one-for-one. The legacy table and RPCs stay live.
insert into public.integration_events (
  provider,
  environment_or_tenant,
  provider_event_id,
  provider_event_type,
  occurred_at,
  received_at,
  payload_sha256,
  metadata,
  status,
  attempt_count,
  available_at,
  lease_owner,
  lease_expires_at,
  last_error_code,
  processed_at,
  dead_at,
  created_at,
  updated_at
)
select
  'stripe',
  'production',
  stripe_effect.stripe_event_id,
  'legacy.stripe_effects',
  min(stripe_effect.created_at),
  min(stripe_effect.created_at),
  encode(
    extensions.digest(
      convert_to('stripe:' || stripe_effect.stripe_event_id, 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  jsonb_build_object('migrated_from', 'stripe_webhook_effects'),
  case
    when bool_and(stripe_effect.status = 'completed') then 'processed'
    when bool_or(stripe_effect.status = 'processing') then 'processing'
    when bool_or(stripe_effect.status = 'pending') then
      case when sum(stripe_effect.attempt_count) > 0 then 'retry' else 'received' end
    else 'dead'
  end,
  sum(stripe_effect.attempt_count)::integer,
  min(stripe_effect.available_at),
  case when bool_or(stripe_effect.status = 'processing') then 'legacy-stripe-worker' else null end,
  case when bool_or(stripe_effect.status = 'processing') then max(stripe_effect.lease_expires_at) else null end,
  max(stripe_effect.last_error_code),
  case when bool_and(stripe_effect.status = 'completed') then max(stripe_effect.completed_at) else null end,
  case when bool_and(stripe_effect.status in ('completed', 'dead'))
             and bool_or(stripe_effect.status = 'dead') then max(stripe_effect.dead_at) else null end,
  min(stripe_effect.created_at),
  max(stripe_effect.updated_at)
from public.stripe_webhook_effects as stripe_effect
group by stripe_effect.stripe_event_id
on conflict (provider, environment_or_tenant, provider_event_id) do nothing;

do $$
begin
  if exists (
    select 1
      from public.stripe_webhook_effects as stripe_effect
      join public.integration_effects as existing on existing.id = stripe_effect.id
      join public.integration_events as event on event.id = existing.event_id
     where event.provider is distinct from 'stripe'
        or event.environment_or_tenant is distinct from 'production'
        or event.provider_event_id is distinct from stripe_effect.stripe_event_id
        or existing.effect_key is distinct from stripe_effect.effect_key
  ) then
    raise exception 'integration_effect_migration_identity_collision';
  end if;
end;
$$;

insert into public.integration_effects (
  id,
  event_id,
  effect_key,
  effect_type,
  payload,
  payload_sha256,
  depends_on_effect_key,
  status,
  attempt_count,
  max_attempts,
  available_at,
  lease_owner,
  lease_expires_at,
  provider_succeeded_at,
  provider_result,
  last_error_code,
  completed_at,
  dead_at,
  created_at,
  updated_at
)
select
  stripe_effect.id,
  event.id,
  stripe_effect.effect_key,
  stripe_effect.effect_type,
  stripe_effect.payload,
  encode(
    extensions.digest(convert_to(stripe_effect.payload::text, 'UTF8'), 'sha256'),
    'hex'
  ),
  stripe_effect.depends_on_effect_key,
  stripe_effect.status,
  stripe_effect.attempt_count,
  8,
  stripe_effect.available_at,
  stripe_effect.lease_owner,
  stripe_effect.lease_expires_at,
  stripe_effect.provider_succeeded_at,
  stripe_effect.provider_result,
  stripe_effect.last_error_code,
  stripe_effect.completed_at,
  stripe_effect.dead_at,
  stripe_effect.created_at,
  stripe_effect.updated_at
from public.stripe_webhook_effects as stripe_effect
join public.integration_events as event
  on event.provider = 'stripe'
 and event.environment_or_tenant = 'production'
 and event.provider_event_id = stripe_effect.stripe_event_id
on conflict (id) do nothing;

insert into public.integration_attempts (
  effect_id,
  attempt_number,
  action,
  outcome,
  actor,
  reason,
  started_at,
  finished_at,
  created_at
)
select
  stripe_effect.id,
  stripe_effect.attempt_count,
  'migrated',
  'migrated',
  'schema-integration-events',
  'one-for-one migration from stripe_webhook_effects',
  stripe_effect.created_at,
  stripe_effect.updated_at,
  stripe_effect.updated_at
from public.stripe_webhook_effects as stripe_effect
where not exists (
  select 1
    from public.integration_attempts as attempt
   where attempt.effect_id = stripe_effect.id
     and attempt.action = 'migrated'
);

do $$
declare
  v_source_count bigint;
  v_target_count bigint;
  v_source_sha256 text;
  v_target_sha256 text;
begin
  select count(*) into v_source_count from public.stripe_webhook_effects;
  select count(*)
    into v_target_count
    from public.integration_effects as effect
    join public.integration_events as event on event.id = effect.event_id
   where event.provider = 'stripe'
     and event.environment_or_tenant = 'production'
     and event.provider_event_id in (
       select stripe_event_id from public.stripe_webhook_effects
     );

  if v_source_count is distinct from v_target_count then
    raise exception 'integration_effect_migration_count_mismatch';
  end if;

  select encode(
    extensions.digest(
      convert_to(coalesce(string_agg(row_value, E'\n' order by row_value), ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  ) into v_source_sha256
  from (
    select jsonb_build_object(
      'id', stripe_effect.id,
      'event', stripe_effect.stripe_event_id,
      'key', stripe_effect.effect_key,
      'type', stripe_effect.effect_type,
      'payload', stripe_effect.payload,
      'depends', stripe_effect.depends_on_effect_key,
      'status', stripe_effect.status,
      'attempts', stripe_effect.attempt_count,
      'available', stripe_effect.available_at,
      'lease_owner', stripe_effect.lease_owner,
      'lease_expires', stripe_effect.lease_expires_at,
      'provider_succeeded', stripe_effect.provider_succeeded_at,
      'provider_result', stripe_effect.provider_result,
      'error', stripe_effect.last_error_code,
      'completed', stripe_effect.completed_at,
      'dead', stripe_effect.dead_at,
      'created', stripe_effect.created_at,
      'updated', stripe_effect.updated_at
    )::text as row_value
    from public.stripe_webhook_effects as stripe_effect
  ) as source_rows;

  select encode(
    extensions.digest(
      convert_to(coalesce(string_agg(row_value, E'\n' order by row_value), ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  ) into v_target_sha256
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
   where event.provider = 'stripe'
     and event.environment_or_tenant = 'production'
     and event.provider_event_id in (
       select stripe_event_id from public.stripe_webhook_effects
     )
  ) as target_rows;

  if v_source_sha256 is distinct from v_target_sha256 then
    raise exception 'integration_effect_migration_checksum_mismatch';
  end if;
end;
$$;

revoke all on function public.refresh_integration_event_state(uuid) from public;
revoke all on function public.guard_integration_event_identity() from public;
revoke all on function public.guard_integration_effect_identity() from public;
revoke all on function public.integration_attempts_append_only() from public;
revoke all on function public.touch_integration_updated_at() from public;
revoke all on function public.ingest_integration_event(text, text, text, text, text, timestamptz, timestamptz, text, jsonb, jsonb) from public;
revoke all on function public.claim_integration_effects(text, integer, integer) from public;
revoke all on function public.record_integration_effect_success(uuid, text, jsonb) from public;
revoke all on function public.complete_integration_effect(uuid, text) from public;
revoke all on function public.fail_integration_effect(uuid, text, text, integer, integer) from public;
revoke all on function public.replay_integration_effect(uuid, text, text) from public;

revoke execute on function public.refresh_integration_event_state(uuid) from anon, authenticated;
revoke execute on function public.guard_integration_event_identity() from anon, authenticated;
revoke execute on function public.guard_integration_effect_identity() from anon, authenticated;
revoke execute on function public.integration_attempts_append_only() from anon, authenticated;
revoke execute on function public.touch_integration_updated_at() from anon, authenticated;
revoke execute on function public.ingest_integration_event(text, text, text, text, text, timestamptz, timestamptz, text, jsonb, jsonb) from anon, authenticated;
revoke execute on function public.claim_integration_effects(text, integer, integer) from anon, authenticated;
revoke execute on function public.record_integration_effect_success(uuid, text, jsonb) from anon, authenticated;
revoke execute on function public.complete_integration_effect(uuid, text) from anon, authenticated;
revoke execute on function public.fail_integration_effect(uuid, text, text, integer, integer) from anon, authenticated;
revoke execute on function public.replay_integration_effect(uuid, text, text) from anon, authenticated;

grant execute on function public.ingest_integration_event(text, text, text, text, text, timestamptz, timestamptz, text, jsonb, jsonb) to service_role;
grant execute on function public.claim_integration_effects(text, integer, integer) to service_role;
grant execute on function public.record_integration_effect_success(uuid, text, jsonb) to service_role;
grant execute on function public.complete_integration_effect(uuid, text) to service_role;
grant execute on function public.fail_integration_effect(uuid, text, text, integer, integer) to service_role;
grant execute on function public.replay_integration_effect(uuid, text, text) to service_role;

-- Operator-visible parity record returned by direct SQL application.
select
  (select count(*) from public.stripe_webhook_effects) as source_count,
  (
    select count(*)
      from public.integration_effects as effect
      join public.integration_events as event on event.id = effect.event_id
     where event.provider = 'stripe'
       and event.environment_or_tenant = 'production'
       and event.provider_event_id in (
         select stripe_event_id from public.stripe_webhook_effects
       )
  ) as target_count,
  'integration_migration_verification'::text as verification;
