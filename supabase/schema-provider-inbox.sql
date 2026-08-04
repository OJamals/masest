-- Durable provider receipts + local projections for ShipStation, Resend, and QBO.
-- Apply after schema-integration-events.sql, schema-integration-effect-handlers.sql,
-- schema-shipstation.sql, schema-email.sql, and schema-email-stream.sql.

create table if not exists public.integration_receipts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.integration_events(id) on delete restrict,
  provider text not null,
  environment_or_tenant text not null,
  provider_event_id text not null,
  transport_id text check (transport_id is null or char_length(transport_id) between 1 and 255),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  signature_verified_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists integration_receipts_event_idx
  on public.integration_receipts (event_id, received_at desc);
create index if not exists integration_receipts_provider_idx
  on public.integration_receipts (provider, received_at desc);

alter table public.integration_receipts enable row level security;
revoke all on table public.integration_receipts from public, anon, authenticated;
revoke all on table public.integration_receipts from service_role;
grant select on table public.integration_receipts to service_role;

drop trigger if exists integration_receipts_append_only on public.integration_receipts;
create trigger integration_receipts_append_only
before update or delete on public.integration_receipts
for each row execute function public.integration_attempts_append_only();

create or replace function public.ingest_provider_event(
  p_provider text,
  p_environment_or_tenant text,
  p_provider_event_id text,
  p_event_type text,
  p_provider_object_id text,
  p_occurred_at timestamptz,
  p_signature_verified_at timestamptz,
  p_payload_sha256 text,
  p_metadata jsonb default '{}'::jsonb,
  p_effects jsonb default '[]'::jsonb,
  p_transport_id text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if p_signature_verified_at is null then
    raise exception 'signature_verification_required';
  end if;
  if p_transport_id is not null and char_length(btrim(p_transport_id)) > 255 then
    raise exception 'invalid_transport_id';
  end if;

  v_event_id := public.ingest_integration_event(
    p_provider,
    p_environment_or_tenant,
    p_provider_event_id,
    p_event_type,
    p_provider_object_id,
    p_occurred_at,
    p_signature_verified_at,
    p_payload_sha256,
    p_metadata,
    p_effects
  );

  insert into public.integration_receipts (
    event_id,
    provider,
    environment_or_tenant,
    provider_event_id,
    transport_id,
    payload_sha256,
    signature_verified_at
  ) values (
    v_event_id,
    lower(btrim(p_provider)),
    btrim(p_environment_or_tenant),
    btrim(p_provider_event_id),
    nullif(btrim(coalesce(p_transport_id, '')), ''),
    lower(btrim(p_payload_sha256)),
    p_signature_verified_at
  );
  return v_event_id;
end;
$$;

revoke all on function public.ingest_provider_event(
  text, text, text, text, text, timestamptz, timestamptz, text, jsonb, jsonb, text
) from public;
revoke execute on function public.ingest_provider_event(
  text, text, text, text, text, timestamptz, timestamptz, text, jsonb, jsonb, text
) from anon, authenticated;
grant execute on function public.ingest_provider_event(
  text, text, text, text, text, timestamptz, timestamptz, text, jsonb, jsonb, text
) to service_role;

create or replace function public.ingest_qbo_provider_events(
  p_signature_verified_at timestamptz,
  p_transport_id text,
  p_events jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_count integer := 0;
begin
  if p_signature_verified_at is null then
    raise exception 'signature_verification_required';
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'qbo_events_required';
  end if;
  for v_row in select value from jsonb_array_elements(p_events)
  loop
    perform public.ingest_provider_event(
      'quickbooks',
      v_row ->> 'environment_or_tenant',
      v_row ->> 'provider_event_id',
      v_row ->> 'event_type',
      nullif(v_row ->> 'provider_object_id', ''),
      nullif(v_row ->> 'occurred_at', '')::timestamptz,
      p_signature_verified_at,
      v_row ->> 'payload_sha256',
      coalesce(v_row -> 'metadata', '{}'::jsonb),
      coalesce(v_row -> 'effects', '[]'::jsonb),
      p_transport_id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.ingest_qbo_provider_events(timestamptz, text, jsonb) from public;
revoke execute on function public.ingest_qbo_provider_events(timestamptz, text, jsonb) from anon, authenticated;
grant execute on function public.ingest_qbo_provider_events(timestamptz, text, jsonb) to service_role;

alter table public.orders add column if not exists tracking_provider_occurred_at timestamptz;
alter table public.shipment_events add column if not exists provider_occurred_at timestamptz;
alter table public.shipment_events add column if not exists provider_status_code text;
alter table public.shipment_events add column if not exists provider_event_code text;
alter table public.shipment_events add column if not exists payload_sha256 text;
create index if not exists shipment_events_provider_occurred_idx
  on public.shipment_events (order_id, provider_occurred_at desc)
  where provider_occurred_at is not null;

alter table public.email_events add column if not exists provider_event_id text;
alter table public.email_events add column if not exists provider_occurred_at timestamptz;
alter table public.messages add column if not exists external_alert_kind text;
create index if not exists email_events_provider_event_idx
  on public.email_events (provider_event_id)
  where provider_event_id is not null;

create table if not exists public.qbo_change_events (
  id uuid primary key default gen_random_uuid(),
  integration_event_id uuid not null unique references public.integration_events(id) on delete restrict,
  realm_id text not null,
  entity_name text not null,
  entity_id text not null,
  operation text not null,
  provider_occurred_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists qbo_change_events_entity_idx
  on public.qbo_change_events (realm_id, entity_name, entity_id, provider_occurred_at desc);

create table if not exists public.qbo_entity_state (
  realm_id text not null,
  entity_name text not null,
  entity_id text not null,
  operation text not null,
  provider_occurred_at timestamptz,
  integration_event_id uuid not null references public.integration_events(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (realm_id, entity_name, entity_id)
);

alter table public.qbo_change_events enable row level security;
alter table public.qbo_entity_state enable row level security;
revoke all on table public.qbo_change_events, public.qbo_entity_state from public, anon, authenticated;
grant select on table public.qbo_change_events, public.qbo_entity_state to service_role;

drop trigger if exists qbo_change_events_append_only on public.qbo_change_events;
create trigger qbo_change_events_append_only
before update or delete on public.qbo_change_events
for each row execute function public.integration_attempts_append_only();

create or replace function public.provider_integration_health()
returns table (
  provider text,
  event_count bigint,
  pending_count bigint,
  dead_count bigint,
  processing_count bigint,
  completed_count bigint,
  unmatched_count bigint,
  oldest_pending_at timestamptz,
  last_received_at timestamptz,
  last_success_at timestamptz,
  last_error_code text
)
language sql
stable
security definer
set search_path = public
as $$
  with providers(provider) as (
    values ('stripe'::text), ('shipstation'), ('resend'), ('quickbooks')
  ), event_stats as (
    select event.provider,
           count(*)::bigint event_count,
           max(event.received_at) last_received_at
      from public.integration_events event
     group by event.provider
  ), effect_stats as (
    select event.provider,
           count(*) filter (where effect.status in ('pending', 'processing'))::bigint pending_count,
           count(*) filter (where effect.status = 'dead')::bigint dead_count,
           count(*) filter (where effect.status = 'processing')::bigint processing_count,
           count(*) filter (where effect.status = 'completed')::bigint completed_count,
           count(*) filter (where effect.provider_result ->> 'skipped' in (
             'unmatched_order', 'unmatched_email', 'unmatched_provider_link'
           ))::bigint unmatched_count,
           min(effect.created_at) filter (where effect.status in ('pending', 'processing')) oldest_pending_at,
           max(effect.completed_at) filter (where effect.status = 'completed') last_success_at
      from public.integration_effects effect
      join public.integration_events event on event.id = effect.event_id
     group by event.provider
  )
  select providers.provider,
         coalesce(event_stats.event_count, 0),
         coalesce(effect_stats.pending_count, 0),
         coalesce(effect_stats.dead_count, 0),
         coalesce(effect_stats.processing_count, 0),
         coalesce(effect_stats.completed_count, 0),
         coalesce(effect_stats.unmatched_count, 0),
         effect_stats.oldest_pending_at,
         event_stats.last_received_at,
         effect_stats.last_success_at,
         coalesce(
           (select effect.last_error_code
              from public.integration_effects effect
              join public.integration_events event on event.id = effect.event_id
             where event.provider = providers.provider and effect.last_error_code is not null
             order by effect.updated_at desc, effect.id desc limit 1),
           (select event.last_error_code
              from public.integration_events event
             where event.provider = providers.provider and event.last_error_code is not null
             order by event.updated_at desc, event.id desc limit 1)
         )
    from providers
    left join event_stats using (provider)
    left join effect_stats using (provider)
   order by providers.provider;
$$;

create or replace function public.provider_integration_dead_letters(
  p_provider text default null,
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns table (
  id uuid,
  event_id uuid,
  provider text,
  provider_event_type text,
  effect_type text,
  aggregate_type text,
  aggregate_id text,
  status text,
  attempt_count integer,
  provider_result jsonb,
  last_error_code text,
  created_at timestamptz,
  completed_at timestamptz,
  dead_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 101);
begin
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'invalid_dead_letter_cursor';
  end if;
  return query
  select effect.id, effect.event_id, event.provider, event.provider_event_type,
         effect.effect_type, effect.aggregate_type, effect.aggregate_id, effect.status,
         effect.attempt_count, effect.provider_result, effect.last_error_code,
         effect.created_at, effect.completed_at, effect.dead_at
    from public.integration_effects effect
    join public.integration_events event on event.id = effect.event_id
   where effect.status = 'dead'
     and (p_provider is null or event.provider = lower(btrim(p_provider)))
     and (p_before_created_at is null
       or (effect.created_at, effect.id) < (p_before_created_at, p_before_id))
   order by effect.created_at desc, effect.id desc
   limit v_limit;
end;
$$;

revoke all on function public.provider_integration_health() from public, anon, authenticated;
revoke all on function public.provider_integration_dead_letters(text, integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.provider_integration_health() to service_role;
grant execute on function public.provider_integration_dead_letters(text, integer, timestamptz, uuid) to service_role;

create or replace function public.upsert_resend_inbound_message(
  p_company_id uuid,
  p_user_id uuid,
  p_external_message_id text,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company public.companies%rowtype;
  v_message public.messages%rowtype;
  v_previous_sender text;
  v_alert_kind text;
  v_inserted boolean := false;
begin
  if p_company_id is null or p_user_id is null
     or btrim(coalesce(p_external_message_id, '')) = ''
     or char_length(p_external_message_id) > 512
     or btrim(coalesce(p_body, '')) = ''
     or char_length(p_body) > 4000 then
    raise exception 'invalid_resend_inbound_message';
  end if;
  select * into v_company from public.companies where id = p_company_id for update;
  if not found then raise exception 'resend_inbound_company_not_found'; end if;

  select * into v_message
    from public.messages
   where source = 'email_reply' and external_message_id = p_external_message_id
   for update;
  if not found then
    select sender_role::text into v_previous_sender
      from public.messages
     where company_id = p_company_id
     order by created_at desc, id desc
     limit 1;
    v_alert_kind := case
      when v_previous_sender is null or v_company.support_thread_status = 'complete'
        then 'support_request'
      else 'message'
    end;
    insert into public.messages (
      company_id, user_id, sender_role, body, source, external_message_id,
      external_alert_kind, read_by_user, read_by_staff
    ) values (
      p_company_id, p_user_id, 'buyer', p_body, 'email_reply', p_external_message_id,
      v_alert_kind, true, false
    )
    on conflict do nothing
    returning * into v_message;
    if found then v_inserted := true; end if;
    if not found then
      select * into v_message
        from public.messages
       where source = 'email_reply' and external_message_id = p_external_message_id
       for update;
    end if;
  end if;
  if v_message.id is null or v_message.company_id is distinct from p_company_id then
    raise exception 'resend_inbound_message_identity_collision';
  end if;
  if v_previous_sender is null then
    select sender_role::text into v_previous_sender
      from public.messages
     where company_id = p_company_id
       and id <> v_message.id
       and created_at <= v_message.created_at
     order by created_at desc, id desc
     limit 1;
  end if;
  v_alert_kind := coalesce(v_message.external_alert_kind, case
    when v_previous_sender is null then 'support_request' else 'message' end);

  update public.companies
     set support_last_message_at = v_message.created_at,
         support_last_message_body = v_message.body,
         support_last_sender_role = 'buyer',
         support_thread_status = 'open',
         support_thread_completed_at = null,
         support_thread_completed_by = null
   where id = p_company_id
     and (support_last_message_at is null or support_last_message_at <= v_message.created_at);

  return jsonb_build_object(
    'message_id', v_message.id,
    'created_at', v_message.created_at,
    'inserted', v_inserted,
    'previous_sender_role', v_previous_sender,
    'prior_thread_status', v_company.support_thread_status,
    'alert_kind', v_alert_kind,
    'company_name', v_company.name
  );
end;
$$;

revoke all on function public.upsert_resend_inbound_message(uuid, uuid, text, text) from public;
revoke execute on function public.upsert_resend_inbound_message(uuid, uuid, text, text) from anon, authenticated;
grant execute on function public.upsert_resend_inbound_message(uuid, uuid, text, text) to service_role;

create or replace function public.finish_integration_projection(
  p_effect_id uuid,
  p_worker_id text,
  p_result jsonb
) returns jsonb
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
    raise exception 'projection_lease_not_owned';
  end if;
  insert into public.integration_attempts (
    effect_id, attempt_number, action, outcome, worker_id, finished_at
  ) values (
    v_effect.id, v_effect.attempt_count, 'provider_succeeded', 'succeeded', p_worker_id, now()
  );
  return coalesce(v_effect.provider_result, '{}'::jsonb);
end;
$$;

revoke all on function public.finish_integration_projection(uuid, text, jsonb) from public, anon, authenticated;

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
  if not found then
    v_result := jsonb_build_object('found', false, 'applied', false, 'skipped', 'unmatched_order');
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
    v_result := jsonb_build_object('found', true, 'applied', false, 'skipped', 'stale_event');
    return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
  end if;
  v_next_status := case
    when v_order.tracking_status = 'delivered' then 'delivered'
    when v_effect.payload ->> 'tracking_status' = 'packing'
      and v_order.tracking_status not in ('processing', 'packing') then v_order.tracking_status
    else v_effect.payload ->> 'tracking_status'
  end;
  update public.orders
     set tracking_status = v_next_status,
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
    'order_id', v_order.id
  );
  return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
end;
$$;

create or replace function public.apply_resend_delivery_integration_effect(
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
  v_email public.email_events%rowtype;
  v_occurred_at timestamptz;
  v_status text;
  v_event_type text;
  v_current_rank integer;
  v_next_rank integer;
  v_stale boolean;
  v_result jsonb;
  v_recipient_digests jsonb;
begin
  select * into v_effect from public.integration_effects where id = p_effect_id for update;
  if not found or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'resend_delivery_projection' then
    raise exception 'invalid_resend_projection_lease';
  end if;
  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{}'::jsonb);
  end if;
  select * into v_event from public.integration_events where id = v_effect.event_id;
  if not found or v_event.provider <> 'resend' then
    raise exception 'invalid_resend_projection_event';
  end if;
  begin
    v_occurred_at := nullif(v_effect.payload ->> 'occurred_at', '')::timestamptz;
  exception when others then
    raise exception 'invalid_resend_projection_time';
  end;
  v_status := v_effect.payload ->> 'status';
  v_event_type := v_effect.payload ->> 'event_type';
  v_recipient_digests := coalesce(v_effect.payload -> 'recipient_digests', '[]'::jsonb);
  select * into v_email
    from public.email_events
   where resend_id = v_effect.payload ->> 'resend_id'
   order by created_at desc
   limit 1
   for update;
  if not found then
    v_result := jsonb_build_object('found', false, 'applied', false, 'skipped', 'unmatched_email');
    return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
  end if;
  v_current_rank := case v_email.status
    when 'sent' then 10 when 'delayed' then 20 when 'delivered' then 30
    when 'bounced' then 40 when 'failed' then 40 when 'complained' then 50 else 0 end;
  v_next_rank := case v_status
    when 'sent' then 10 when 'delayed' then 20 when 'delivered' then 30
    when 'bounced' then 40 when 'failed' then 40 when 'complained' then 50 else 0 end;
  v_stale := (v_email.provider_occurred_at is not null
      and (v_occurred_at is null or v_occurred_at < v_email.provider_occurred_at))
    or v_next_rank < v_current_rank;
  if not v_stale then
    update public.email_events
       set status = v_status,
           provider_event_id = v_event.provider_event_id,
           provider_occurred_at = coalesce(v_occurred_at, provider_occurred_at),
           updated_at = now()
     where id = v_email.id;
  end if;
  if not v_stale and v_event_type in ('email.bounced', 'email.complained')
     and jsonb_typeof(v_recipient_digests) = 'array' then
    insert into public.email_suppressions (email, reason, stream)
    select distinct
      lower(btrim(recipient.email)),
      case when v_event_type = 'email.complained' then 'complaint' else 'hard_bounce' end,
      'all'
    from regexp_split_to_table(v_email.to_email, ',') as recipient(email)
    where btrim(recipient.email) <> ''
      and encode(extensions.digest(
        convert_to('resend-recipient:v1:' || lower(btrim(recipient.email)), 'UTF8'),
        'sha256'
      ), 'hex') in (select jsonb_array_elements_text(v_recipient_digests))
    on conflict (email, stream) do update
      set reason = excluded.reason;
  end if;
  v_result := jsonb_build_object(
    'found', true,
    'applied', not v_stale,
    'skipped', case when v_stale then 'stale_event' else null end
  );
  return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
end;
$$;

create or replace function public.apply_qbo_change_integration_effect(
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
  v_occurred_at timestamptz;
  v_applied boolean := false;
  v_result jsonb;
begin
  select * into v_effect from public.integration_effects where id = p_effect_id for update;
  if not found or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'qbo_change_projection' then
    raise exception 'invalid_qbo_projection_lease';
  end if;
  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{}'::jsonb);
  end if;
  select * into v_event from public.integration_events where id = v_effect.event_id;
  if not found or v_event.provider <> 'quickbooks' then
    raise exception 'invalid_qbo_projection_event';
  end if;
  begin
    v_occurred_at := nullif(v_effect.payload ->> 'occurred_at', '')::timestamptz;
  exception when others then
    raise exception 'invalid_qbo_projection_time';
  end;
  insert into public.qbo_change_events (
    integration_event_id, realm_id, entity_name, entity_id, operation, provider_occurred_at
  ) values (
    v_event.id,
    v_effect.payload ->> 'realm_id',
    v_effect.payload ->> 'entity_name',
    v_effect.payload ->> 'entity_id',
    v_effect.payload ->> 'operation',
    v_occurred_at
  ) on conflict (integration_event_id) do nothing;

  insert into public.qbo_entity_state (
    realm_id, entity_name, entity_id, operation, provider_occurred_at, integration_event_id
  ) values (
    v_effect.payload ->> 'realm_id',
    v_effect.payload ->> 'entity_name',
    v_effect.payload ->> 'entity_id',
    v_effect.payload ->> 'operation',
    v_occurred_at,
    v_event.id
  ) on conflict (realm_id, entity_name, entity_id) do update
    set operation = excluded.operation,
        provider_occurred_at = excluded.provider_occurred_at,
        integration_event_id = excluded.integration_event_id,
        updated_at = now()
    where public.qbo_entity_state.provider_occurred_at is null
       or (excluded.provider_occurred_at is not null
           and excluded.provider_occurred_at >= public.qbo_entity_state.provider_occurred_at)
  returning true into v_applied;
  v_result := jsonb_build_object(
    'applied', coalesce(v_applied, false),
    'skipped', case when coalesce(v_applied, false) then null else 'stale_event' end
  );
  return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
end;
$$;

revoke all on function public.apply_shipstation_tracking_integration_effect(uuid, text) from public;
revoke all on function public.apply_resend_delivery_integration_effect(uuid, text) from public;
revoke all on function public.apply_qbo_change_integration_effect(uuid, text) from public;
revoke execute on function public.apply_shipstation_tracking_integration_effect(uuid, text) from anon, authenticated;
revoke execute on function public.apply_resend_delivery_integration_effect(uuid, text) from anon, authenticated;
revoke execute on function public.apply_qbo_change_integration_effect(uuid, text) from anon, authenticated;
grant execute on function public.apply_shipstation_tracking_integration_effect(uuid, text) to service_role;
grant execute on function public.apply_resend_delivery_integration_effect(uuid, text) to service_role;
grant execute on function public.apply_qbo_change_integration_effect(uuid, text) to service_role;
