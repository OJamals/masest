-- Replace Resend-specific delivery identity and inbound RPCs with the provider-neutral
-- Cloudflare Email Service contract. Apply before the Pages runtime deploy.

begin;

do $$
begin
  if exists (select 1 from public.order_provider_links where provider = 'resend') then
    raise exception 'resend_order_provider_links_require_manual_migration';
  end if;
end;
$$;

alter table public.order_provider_links
  drop constraint if exists order_provider_links_provider_check;
alter table public.order_provider_links
  add constraint order_provider_links_provider_check
  check (provider in ('stripe', 'shipstation', 'quickbooks'));

create or replace function public.link_order_provider_object(
  p_order_id uuid,
  p_provider text,
  p_object_type text,
  p_provider_object_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_order_id is null
     or p_provider not in ('stripe', 'shipstation', 'quickbooks')
     or p_object_type !~ '^[a-z][a-z0-9_]{0,63}$'
     or nullif(btrim(p_provider_object_id), '') is null
     or length(p_provider_object_id) > 255
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_order_provider_link';
  end if;

  insert into public.order_provider_links (
    order_id, provider, object_type, provider_object_id, metadata
  ) values (
    p_order_id, p_provider, p_object_type, btrim(p_provider_object_id), coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (provider, object_type, provider_object_id) do update
     set metadata = public.order_provider_links.metadata || excluded.metadata,
         updated_at = now()
   where public.order_provider_links.order_id = excluded.order_id
  returning id into v_id;

  if v_id is null then
    raise exception using errcode = '23505', message = 'provider_object_already_claimed';
  end if;
  return v_id;
end
$$;

revoke all on function public.link_order_provider_object(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.link_order_provider_object(uuid, text, text, text, jsonb)
  to service_role;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'email_events' and column_name = 'resend_id'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'email_events' and column_name = 'provider_message_id'
  ) then
    alter table public.email_events rename column resend_id to provider_message_id;
  end if;
end;
$$;

drop index if exists public.email_events_resend_id_idx;
create index if not exists email_events_provider_message_id_idx
  on public.email_events (provider_message_id);

create table if not exists public.email_delivery_events (
  event_id            text primary key check (char_length(event_id) between 1 and 160),
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 512),
  recipient           text not null check (char_length(recipient) between 3 and 254),
  status              text not null check (status in (
                        'delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained'
                      )),
  terminal            boolean not null default false,
  occurred_at         timestamptz not null,
  created_at          timestamptz not null default now()
);
create index if not exists email_delivery_events_message_idx
  on public.email_delivery_events (provider_message_id, occurred_at desc);
alter table public.email_delivery_events enable row level security;
revoke all on public.email_delivery_events from public, anon, authenticated;
grant all privileges on public.email_delivery_events to service_role;

create or replace function public.apply_email_delivery_event(
  p_event_id text,
  p_provider_message_id text,
  p_recipient text,
  p_status text,
  p_terminal boolean,
  p_occurred_at timestamptz,
  p_suppression_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted boolean := false;
  v_email public.email_events%rowtype;
  v_current_rank integer;
  v_next_rank integer;
begin
  if btrim(coalesce(p_event_id, '')) = ''
     or char_length(p_event_id) > 160
     or btrim(coalesce(p_provider_message_id, '')) = ''
     or char_length(p_provider_message_id) > 512
     or btrim(coalesce(p_recipient, '')) = ''
     or char_length(p_recipient) > 254
     or p_status not in ('delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained')
     or p_occurred_at is null
     or (p_suppression_reason is not null and p_suppression_reason not in ('bounce', 'complaint')) then
    raise exception 'invalid_email_delivery_event';
  end if;

  insert into public.email_delivery_events (
    event_id, provider_message_id, recipient, status, terminal, occurred_at
  ) values (
    btrim(p_event_id), btrim(p_provider_message_id), lower(btrim(p_recipient)),
    p_status, coalesce(p_terminal, false), p_occurred_at
  ) on conflict (event_id) do nothing
  returning true into v_inserted;
  if not coalesce(v_inserted, false) then
    return jsonb_build_object('applied', false, 'duplicate', true);
  end if;

  select * into v_email
    from public.email_events
   where provider_message_id = p_provider_message_id
   order by created_at desc
   limit 1
   for update;
  if found then
    v_current_rank := case v_email.status
      when 'sent' then 10 when 'deferred' then 20 when 'delivered' then 30
      when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
      when 'complained' then 50 else 0 end;
    v_next_rank := case p_status
      when 'deferred' then 20 when 'delivered' then 30
      when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
      when 'complained' then 50 else 0 end;
    if (v_email.provider_occurred_at is null or p_occurred_at >= v_email.provider_occurred_at)
       and v_next_rank >= v_current_rank then
      update public.email_events
         set status = p_status,
             provider_event_id = p_event_id,
             provider_occurred_at = p_occurred_at,
             updated_at = now()
       where id = v_email.id;
    end if;
  end if;

  if p_suppression_reason is not null then
    insert into public.email_suppressions (email, reason, stream)
    values (lower(btrim(p_recipient)), p_suppression_reason, 'all')
    on conflict (email, stream) do update set reason = excluded.reason;
  end if;
  return jsonb_build_object('applied', true, 'email_found', v_email.id is not null);
end;
$$;

revoke all on function public.apply_email_delivery_event(text, text, text, text, boolean, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_email_delivery_event(text, text, text, text, boolean, timestamptz, text)
  to service_role;

drop function if exists public.upsert_resend_inbound_message(uuid, uuid, text, text);
drop function if exists public.upsert_resend_inbound_message(uuid, uuid, text, text, text, uuid, uuid);
drop function if exists public.upsert_email_inbound_message(uuid, uuid, text, text, text, uuid, uuid);

create or replace function public.upsert_email_inbound_message(
  p_company_id uuid,
  p_user_id uuid,
  p_external_message_id text,
  p_body text,
  p_sender_role text default 'buyer',
  p_recipient_user_id uuid default null,
  p_order_id uuid default null,
  p_email_references text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_message public.messages%rowtype;
  v_previous_sender text;
  v_alert_kind text;
  v_inserted boolean := false;
begin
  if p_company_id is null
     or p_sender_role not in ('buyer', 'staff')
     or btrim(coalesce(p_external_message_id, '')) = ''
     or char_length(p_external_message_id) > 512
     or btrim(coalesce(p_body, '')) = ''
     or char_length(p_body) > 4000 then
    raise exception 'invalid_email_inbound_message';
  end if;
  if p_email_references is not null and (
    char_length(p_email_references) > 8192
    or p_email_references !~ '^(<[^<>[:space:]]{1,510}>)([[:space:]]+<[^<>[:space:]]{1,510}>)*$'
  ) then
    raise exception 'invalid_email_inbound_references';
  end if;
  select * into v_company from public.companies where id = p_company_id for update;
  if not found then raise exception 'email_inbound_company_not_found'; end if;

  if p_sender_role = 'buyer' and (
    p_user_id is null or not exists (
      select 1 from public.profiles where id = p_user_id and company_id = p_company_id
    )
  ) then
    raise exception 'email_inbound_user_company_mismatch';
  end if;
  if p_sender_role = 'staff' and (
    p_recipient_user_id is null or not exists (
      select 1 from public.profiles where id = p_recipient_user_id and company_id = p_company_id
    )
  ) then
    raise exception 'email_inbound_recipient_company_mismatch';
  end if;
  if p_order_id is not null and not exists (
    select 1 from public.orders where id = p_order_id and company_id = p_company_id
  ) then
    raise exception 'email_inbound_order_company_mismatch';
  end if;

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
    v_alert_kind := case when p_sender_role = 'buyer' then case
      when v_previous_sender is null or v_company.support_thread_status = 'complete' then 'support_request'
      else 'message'
    end else null end;
    insert into public.messages (
      company_id, user_id, recipient_user_id, sender_role, body, order_id, source,
      external_message_id, external_alert_kind, email_references, read_by_user, read_by_staff
    ) values (
      p_company_id,
      case when p_sender_role = 'buyer' then p_user_id else null end,
      case when p_sender_role = 'staff' then p_recipient_user_id else null end,
      p_sender_role::public.message_sender,
      p_body,
      p_order_id,
      'email_reply',
      p_external_message_id,
      v_alert_kind,
      p_email_references,
      p_sender_role = 'buyer',
      p_sender_role = 'staff'
    ) on conflict do nothing
    returning * into v_message;
    if found then v_inserted := true; end if;
    if not found then
      select * into v_message
        from public.messages
       where source = 'email_reply' and external_message_id = p_external_message_id
       for update;
    end if;
  end if;
  if v_message.id is null
     or v_message.company_id is distinct from p_company_id
     or v_message.sender_role::text is distinct from p_sender_role
     or v_message.order_id is distinct from p_order_id
     or (p_sender_role = 'buyer' and v_message.user_id is distinct from p_user_id)
     or (p_sender_role = 'staff'
         and v_message.recipient_user_id is distinct from p_recipient_user_id) then
    raise exception 'email_inbound_message_identity_collision';
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
  v_alert_kind := case when v_message.sender_role::text = 'buyer' then
    coalesce(v_message.external_alert_kind, case
      when v_previous_sender is null then 'support_request' else 'message' end)
    else null end;

  if v_inserted then
    update public.companies
       set support_thread_status = 'open',
           support_thread_completed_at = null,
           support_thread_completed_by = null
     where id = p_company_id;
  end if;

  return jsonb_build_object(
    'id', v_message.id,
    'message_id', v_message.id,
    'created_at', v_message.created_at,
    'company_id', v_message.company_id,
    'user_id', v_message.user_id,
    'recipient_user_id', v_message.recipient_user_id,
    'sender_role', v_message.sender_role,
    'body', v_message.body,
    'order_id', v_message.order_id,
    'email_delivery_id', v_message.email_delivery_id,
    'email_message_id', v_message.email_message_id,
    'email_references', v_message.email_references,
    'inserted', v_inserted,
    'previous_sender_role', v_previous_sender,
    'prior_thread_status', v_company.support_thread_status,
    'alert_kind', v_alert_kind,
    'company_name', v_company.name
  );
end;
$$;

revoke all on function public.upsert_email_inbound_message(uuid, uuid, text, text, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.upsert_email_inbound_message(uuid, uuid, text, text, text, uuid, uuid, text)
  to service_role;

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
set search_path = public, pg_temp
as $$
  with providers(provider) as (
    values ('stripe'::text), ('shipstation'), ('quickbooks')
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

revoke all on function public.provider_integration_health() from public, anon, authenticated;
grant execute on function public.provider_integration_health() to service_role;

-- No Resend integration events exist in production; retire the unreachable projection.
drop function if exists public.apply_resend_delivery_integration_effect(uuid, text);

commit;
