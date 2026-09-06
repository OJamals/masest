-- Durable support-message email effects.
-- Apply after schema-integration-events.sql and migrate-support-ticket-routing-2026-09-06.sql.
-- This is deliberately future-only: the messages trigger covers rows committed after this migration.

begin;

alter table public.notifications
  add column if not exists support_message_id uuid
    references public.messages(id) on delete cascade;

create unique index if not exists notifications_support_message_id_uniq
  on public.notifications (support_message_id)
  where support_message_id is not null;

create table if not exists public.support_message_email_envelopes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  effect_id uuid not null references public.integration_effects(id) on delete cascade,
  envelope jsonb not null check (
    jsonb_typeof(envelope) = 'object'
    and octet_length(envelope::text) <= 131072
  ),
  created_at timestamptz not null default now(),
  constraint support_message_email_envelopes_message_uniq unique (message_id),
  constraint support_message_email_envelopes_effect_uniq unique (effect_id)
);

create or replace function public.guard_support_message_email_envelope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.message_id is distinct from old.message_id
     or new.effect_id is distinct from old.effect_id
     or new.envelope is distinct from old.envelope
     or new.created_at is distinct from old.created_at then
    raise exception 'support_message_email_envelope_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists support_message_email_envelopes_immutable
  on public.support_message_email_envelopes;
create trigger support_message_email_envelopes_immutable
before update on public.support_message_email_envelopes
for each row execute function public.guard_support_message_email_envelope();

alter table public.support_message_email_envelopes enable row level security;
revoke all on table public.support_message_email_envelopes from public;
revoke all on table public.support_message_email_envelopes from anon, authenticated;
revoke all on table public.support_message_email_envelopes from service_role;
grant select on table public.support_message_email_envelopes to service_role;

create or replace function public.enqueue_support_message_email_effect()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_alert_kind text;
  v_effects jsonb;
  v_payload jsonb := jsonb_build_object('message_id', new.id);
begin
  if new.ticket_id is null then
    raise exception 'support_message_ticket_required_for_delivery';
  end if;

  select * into v_ticket
    from public.support_tickets as ticket
   where ticket.id = new.ticket_id;
  if not found then
    raise exception 'support_message_ticket_not_found_for_delivery';
  end if;

  -- Inbound mail already computes this field before insert. Dashboard buyer messages
  -- do not, so determine it from the exact pre-insert ticket/message state and persist it
  -- while preserving that inbound identity.
  if new.sender_role::text = 'buyer' then
    v_alert_kind := coalesce(new.external_alert_kind, case
      when exists (
        select 1 from public.support_tickets as ticket
         where ticket.id = new.ticket_id and ticket.status = 'resolved'
      ) or not exists (
        select 1
          from public.messages as previous_message
         where previous_message.ticket_id = new.ticket_id
           and previous_message.id <> new.id
      ) then 'support_request'
      else 'message'
    end);
    if new.external_alert_kind is null then
      update public.messages
         set external_alert_kind = v_alert_kind
       where id = new.id
         and external_alert_kind is null;
    end if;
  end if;

  v_effects := jsonb_build_array(jsonb_build_object(
    'effect_key', 'email-counterpart',
    'effect_type', 'support_message_email',
    'aggregate_type', 'support_ticket',
    'aggregate_id', new.ticket_id::text,
    'max_attempts', 8,
    'payload', v_payload
  ));

  perform public.ingest_integration_event(
    'masest',
    'production',
    'support-message/' || new.id::text,
    'support.message.created',
    new.id::text,
    new.created_at,
    new.created_at,
    encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
    '{}'::jsonb,
    v_effects
  );

  -- The buyer's in-product notification belongs to the same commit as the staff reply.
  if new.sender_role::text = 'staff'
     and new.company_id is not null
     and new.recipient_user_id is not null then
    insert into public.notifications (
      company_id, user_id, type, title, body, link, support_message_id
    ) values (
      new.company_id,
      new.recipient_user_id,
      'message'::public.notification_type,
      'New message from MASEST',
      left(new.body, 140),
      case when new.order_id is null
        then '/dashboard.html#messages'
        else '/dashboard.html?order=' || new.order_id::text || '#messages'
      end,
      new.id
    ) on conflict (support_message_id) where support_message_id is not null do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_support_message_email_after_insert on public.messages;
create trigger messages_support_message_email_after_insert
after insert on public.messages
for each row execute function public.enqueue_support_message_email_effect();

drop function if exists public.claim_support_message_email_effect(uuid, text, integer);
create or replace function public.claim_support_message_email_effect(
  p_message_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 60), 15), 900);
  v_claimed public.integration_effects%rowtype;
  v_event public.integration_events%rowtype;
  v_message public.messages%rowtype;
begin
  if p_message_id is null or v_worker_id = '' or char_length(v_worker_id) > 128 then
    raise exception 'invalid_support_message_email_claim';
  end if;
  if p_worker_id is distinct from v_worker_id then
    raise exception 'invalid_support_message_email_claim';
  end if;

  -- Resolve by the ledger's indexed immutable event identity, then by its
  -- unique (event_id, effect_key). Avoid scanning JSON payloads in the shared queue.
  select event.* into v_event
    from public.integration_events as event
   where event.provider = 'masest'
     and event.environment_or_tenant = 'production'
     and event.provider_event_id = 'support-message/' || p_message_id::text;
  if not found then
    return jsonb_build_object('state', 'legacy', 'effect', null);
  end if;

  select effect.* into v_claimed
    from public.integration_effects as effect
   where effect.event_id = v_event.id
     and effect.effect_key = 'email-counterpart'
   for update skip locked;

  if not found then
    -- A concurrent generic claim may hold the row lock. Wait for that exact row
    -- to settle, then report its durable state instead of draining another effect.
    select effect.* into v_claimed
      from public.integration_effects as effect
     where effect.event_id = v_event.id
       and effect.effect_key = 'email-counterpart'
     for update;
  end if;
  if not found then
    raise exception 'invalid_support_message_email_effect';
  end if;

  select message.* into v_message
    from public.messages as message
   where message.id = p_message_id;
  if v_event.id is null
     or v_event.provider <> 'masest'
     or v_event.environment_or_tenant <> 'production'
     or v_event.provider_event_id <> ('support-message/' || p_message_id::text)
     or v_event.provider_event_type <> 'support.message.created'
     or v_event.provider_object_id is distinct from p_message_id::text
     or v_claimed.effect_key <> 'email-counterpart'
     or v_claimed.effect_type <> 'support_message_email'
     or v_claimed.payload <> jsonb_build_object('message_id', p_message_id)
     or v_claimed.aggregate_type <> 'support_ticket'
     or v_message.id is null
     or v_event.occurred_at is distinct from v_message.created_at
     or v_message.ticket_id::text is distinct from v_claimed.aggregate_id then
    raise exception 'invalid_support_message_email_effect';
  end if;

  if (v_claimed.status = 'pending' and v_claimed.available_at <= now())
     or (v_claimed.status = 'processing' and v_claimed.lease_expires_at <= now()) then
    update public.integration_effects as effect
       set status = 'processing',
           attempt_count = effect.attempt_count + 1,
           lease_owner = p_worker_id,
           lease_expires_at = now() + make_interval(secs => v_lease_seconds)
     where effect.id = v_claimed.id
     returning effect.* into v_claimed;

    insert into public.integration_attempts (
      effect_id, attempt_number, action, outcome, worker_id, started_at
    ) values (
      v_claimed.id, v_claimed.attempt_count, 'claimed', 'processing', p_worker_id, now()
    );
    perform public.refresh_integration_event_state(v_claimed.event_id);
    return jsonb_build_object('state', 'claimed', 'effect', to_jsonb(v_claimed));
  elsif v_claimed.status = 'pending' then
    return jsonb_build_object('state', 'retry', 'effect', to_jsonb(v_claimed));
  elsif v_claimed.status in ('processing', 'completed', 'dead') then
    return jsonb_build_object('state', v_claimed.status, 'effect', to_jsonb(v_claimed));
  end if;
  raise exception 'invalid_support_message_email_effect_status';
end;
$$;

create or replace function public.store_support_message_email_envelope(
  p_effect_id uuid,
  p_worker_id text,
  p_envelope jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_effect public.integration_effects%rowtype;
  v_message public.messages%rowtype;
  v_envelope public.support_message_email_envelopes%rowtype;
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
begin
  if p_effect_id is null or v_worker_id = '' or char_length(v_worker_id) > 128 then
    raise exception 'invalid_support_message_email_envelope';
  end if;

  if p_worker_id is distinct from v_worker_id then
    raise exception 'invalid_support_message_email_envelope';
  end if;

  select effect.* into v_effect
    from public.integration_effects as effect
   where effect.id = p_effect_id
     and effect.effect_type = 'support_message_email'
     and effect.status = 'processing'
     and effect.lease_owner = p_worker_id
     and effect.lease_expires_at > now()
     and nullif(effect.payload ->> 'message_id', '') is not null
   for update;
  if not found then
    raise exception 'invalid_support_message_email_envelope_lease';
  end if;

  select * into v_envelope
    from public.support_message_email_envelopes
   where effect_id = v_effect.id;
  if found then
    return v_envelope.envelope;
  end if;
  if p_envelope is null then
    return null;
  end if;
  if jsonb_typeof(p_envelope) <> 'object'
     or octet_length(p_envelope::text) > 131072 then
    raise exception 'invalid_support_message_email_envelope';
  end if;

  begin
    select * into v_message
      from public.messages as message
     where message.id = (v_effect.payload ->> 'message_id')::uuid
       and message.ticket_id::text = v_effect.aggregate_id;
  exception when invalid_text_representation then
    raise exception 'invalid_support_message_email_effect';
  end;
  if not found then
    raise exception 'invalid_support_message_email_effect';
  end if;

  -- Keep this as a VALUES insert: the migration never backfills rows. The effect
  -- row lock serializes first writers; the follow-up read preserves a bounded
  -- fail-closed path if a privileged concurrent insert nevertheless won.
  insert into public.support_message_email_envelopes (message_id, effect_id, envelope)
  values (v_message.id, v_effect.id, p_envelope)
  on conflict (effect_id) do nothing
  returning * into v_envelope;
  if not found then
    select * into v_envelope
      from public.support_message_email_envelopes
     where effect_id = v_effect.id;
  end if;
  if not found or v_envelope.message_id is distinct from v_message.id then
    raise exception 'support_message_email_envelope_identity_collision';
  end if;
  return v_envelope.envelope;
end;
$$;

revoke all on function public.guard_support_message_email_envelope() from public;
revoke execute on function public.guard_support_message_email_envelope() from anon, authenticated;
grant execute on function public.guard_support_message_email_envelope() to service_role;

revoke all on function public.enqueue_support_message_email_effect() from public;
revoke execute on function public.enqueue_support_message_email_effect() from anon, authenticated;
grant execute on function public.enqueue_support_message_email_effect() to service_role;

revoke all on function public.claim_support_message_email_effect(uuid, text, integer) from public;
revoke execute on function public.claim_support_message_email_effect(uuid, text, integer) from anon, authenticated;
grant execute on function public.claim_support_message_email_effect(uuid, text, integer) to service_role;

revoke all on function public.store_support_message_email_envelope(uuid, text, jsonb) from public;
revoke execute on function public.store_support_message_email_envelope(uuid, text, jsonb) from anon, authenticated;
grant execute on function public.store_support_message_email_envelope(uuid, text, jsonb) to service_role;

commit;
