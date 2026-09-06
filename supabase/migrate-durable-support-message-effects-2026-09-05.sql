-- Durable support email intent. The AFTER INSERT trigger runs in the same
-- transaction as the canonical message write, so a lost response cannot lose
-- the delivery intent. Provider acceptance remains owned by the effect worker.
begin;

alter table public.integration_effects add column if not exists source_snapshot jsonb;
alter table public.integration_effects drop constraint if exists integration_effects_source_snapshot_chk;
do $$ begin
  alter table public.integration_effects add constraint integration_effects_source_snapshot_chk
    check (source_snapshot is null or jsonb_typeof(source_snapshot) = 'object');
exception when duplicate_object then null; end $$;

create or replace function public.assert_email_effects_ready()
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if to_regclass('public.integration_events') is null
     or to_regclass('public.integration_effects') is null
     or to_regclass('public.messages') is null
     or to_regclass('public.quotes') is null
     or to_regprocedure('public.prepare_support_email_delivery(uuid,jsonb)') is null then
    raise exception 'durable_email_effects_not_ready';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'messages_support_email_effect'
      and tgrelid = 'public.messages'::regclass and tgenabled <> 'D')
     or not exists (select 1 from pg_trigger where tgname = 'quotes_intake_email_effect'
      and tgrelid = 'public.quotes'::regclass and tgenabled <> 'D') then
    raise exception 'durable_email_effects_not_ready';
  end if;
  return true;
end; $$;
revoke all on function public.assert_email_effects_ready() from public, anon, authenticated;
grant execute on function public.assert_email_effects_ready() to service_role;

alter table public.messages add column if not exists external_alert_kind text;
do $$ begin
  alter table public.messages add constraint messages_external_alert_kind_chk
    check (external_alert_kind is null or external_alert_kind in ('support_request', 'message'));
exception when duplicate_object then null; end $$;

create or replace function public.enqueue_support_message_email_effect()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id text := 'support-message-' || new.id::text;
  v_payload jsonb := jsonb_build_object('message_id', new.id::text);
begin
  if new.sender_role::text not in ('buyer', 'staff') then
    return new;
  end if;

  -- Reuse the canonical event/effect ingestion seam. It owns identity,
  -- payload hashing, collision checks, and idempotent effect insertion.
  perform public.ingest_integration_event(
    'masest', 'production', v_event_id, 'support_message_created', new.id::text,
    new.created_at, now(),
    encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'),
    jsonb_build_object('source', 'support_message'),
    jsonb_build_array(jsonb_build_object(
      'effect_key', 'support-email',
      'effect_type', 'support_message_email',
      'aggregate_type', 'message',
      'aggregate_id', new.id::text,
      'payload', v_payload,
      'max_attempts', 8
    ))
  );

  return new;
end;
$$;

create or replace function public.freeze_support_message_alert_kind()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_previous text;
begin
  if new.sender_role::text = 'buyer' and new.external_alert_kind is null then
    select status::text into v_status from public.support_threads where id = new.thread_id;
    select sender_role::text into v_previous from public.messages
      where thread_id = new.thread_id order by created_at desc, id desc limit 1;
    new.external_alert_kind := case
      when v_previous is null or v_status = 'complete' then 'support_request'
      else 'message'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_support_alert_kind on public.messages;
create trigger messages_support_alert_kind
before insert on public.messages
for each row execute function public.freeze_support_message_alert_kind();

drop trigger if exists messages_support_email_effect on public.messages;
create trigger messages_support_email_effect
after insert on public.messages
for each row execute function public.enqueue_support_message_email_effect();

revoke all on function public.enqueue_support_message_email_effect() from public, anon, authenticated;
grant execute on function public.enqueue_support_message_email_effect() to service_role;
commit;

-- Contact/quote intake notifications share the same atomic ledger. Marketing
-- nurture remains consent-gated by the intake row and is handled separately by
-- the marketing delivery system.
begin;
create or replace function public.enqueue_quote_intake_email_effect()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_hash text;
  v_effects jsonb;
  v_event_id uuid;
  v_snapshot jsonb;
begin
  if new.source <> 'contact' then return new; end if;
  v_payload := jsonb_build_object('quote_id', new.id::text, 'kind', 'internal');
  v_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
  v_effects := jsonb_build_array(
    jsonb_build_object('effect_key','quote-internal','effect_type','quote_intake_email','aggregate_type','quote','aggregate_id',new.id::text,'payload',v_payload),
    jsonb_build_object('effect_key','quote-autoreply','effect_type','quote_intake_email','aggregate_type','quote','aggregate_id',new.id::text,'payload',jsonb_build_object('quote_id',new.id::text,'kind','autoreply'))
  );
  if new.payload -> 'marketing_email_enabled' = 'true'::jsonb then
    perform public.set_marketing_email_preferences(
      jsonb_build_array(new.email), true, 'quote_marketing_consent', null,
      new.name, array[nullif(new.industry, '')]
    );
    v_effects := v_effects || jsonb_build_array(jsonb_build_object(
      'effect_key','quote-nurture','effect_type','quote_nurture_enrollment',
      'aggregate_type','quote','aggregate_id',new.id::text,
      'payload',jsonb_build_object('quote_id',new.id::text,'consent_at',new.created_at)
    ));
  end if;
  v_event_id := public.ingest_integration_event(
    'masest', 'production', 'quote-intake-' || new.id::text,
    'quote_intake_created', new.id::text, new.created_at, now(), v_hash,
    jsonb_build_object('source', 'quote_intake'),
    v_effects
  );
  v_snapshot := jsonb_build_object(
    'id', new.id, 'email', new.email, 'name', new.name, 'company', new.company,
    'type', new.type, 'priority', new.priority, 'lead_score', new.lead_score,
    'industry', new.industry, 'payload', new.payload
  );
  update public.integration_effects
     set source_snapshot = v_snapshot
   where event_id = v_event_id and effect_type in ('quote_intake_email', 'quote_nurture_enrollment')
     and source_snapshot is null;
  return new;
end; $$;
drop trigger if exists quotes_intake_email_effect on public.quotes;
create trigger quotes_intake_email_effect after insert on public.quotes
for each row execute function public.enqueue_quote_intake_email_effect();
revoke all on function public.enqueue_quote_intake_email_effect() from public, anon, authenticated;
grant execute on function public.enqueue_quote_intake_email_effect() to service_role;
commit;
