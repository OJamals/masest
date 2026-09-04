-- supabase/schema-email.sql — email delivery log + suppression list.
-- Apply via Supabase SQL editor / pooler. Service-role auto-grant does NOT fire for
-- new tables (see schema-phase5.sql), so the grants below are required.

create table if not exists public.email_events (
  id          uuid primary key default gen_random_uuid(),
  provider_message_id text,
  to_email    text not null,
  category    text,
  subject     text,
  status      text not null default 'sent',
  error       text,
  provider_event_id text,
  provider_occurred_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists email_events_provider_message_id_idx
  on public.email_events (provider_message_id);
create index if not exists email_events_provider_event_idx
  on public.email_events (provider_event_id)
  where provider_event_id is not null;
create index if not exists email_events_to_email_idx on public.email_events (to_email);
create index if not exists email_events_created_at_idx on public.email_events (created_at desc);

create table if not exists public.email_suppressions (
  email       text not null,
  reason      text not null,
  stream      text not null default 'all',
  created_at  timestamptz not null default now(),
  primary key (email, stream)
);

create table if not exists public.email_delivery_events (
  event_id            text primary key check (char_length(event_id) between 1 and 160),
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 512),
  recipient           text not null check (char_length(recipient) between 3 and 254),
  status              text not null check (status in (
                        'sent', 'delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained'
                      )),
  terminal            boolean not null default false,
  occurred_at         timestamptz not null,
  created_at          timestamptz not null default now()
);
alter table public.email_delivery_events
  drop constraint if exists email_delivery_events_status_check;
alter table public.email_delivery_events
  add constraint email_delivery_events_status_check check (status in (
    'sent', 'delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained'
  ));
create index if not exists email_delivery_events_message_idx
  on public.email_delivery_events (provider_message_id, occurred_at desc);

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
     or p_status not in ('sent', 'delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained')
     or p_occurred_at is null
     or (p_suppression_reason is not null
         and p_suppression_reason not in ('bounce', 'complaint')) then
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

  v_next_rank := case p_status
    when 'sent' then 10 when 'deferred' then 20 when 'delivered' then 30
    when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
    when 'complained' then 50 else 0 end;

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
    if v_next_rank > v_current_rank
       or (v_next_rank = v_current_rank
           and (v_email.provider_occurred_at is null or p_occurred_at >= v_email.provider_occurred_at)) then
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
    if to_regclass('public.newsletter_recipients') is not null then
      update public.newsletter_recipients
      set subscribed = false
      where email = lower(btrim(p_recipient));
    end if;
  end if;

  if to_regclass('public.newsletter_deliveries') is not null then
    with delivery_candidate as (
      select
        delivery.id,
        delivery.provider_occurred_at,
        case delivery.provider_status
          when 'sent' then 10 when 'deferred' then 20 when 'delivered' then 30
          when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
          when 'complained' then 50 else 0 end as current_rank
      from public.newsletter_deliveries delivery
      where delivery.provider_message_id = p_provider_message_id
        and delivery.normalized_email = lower(btrim(p_recipient))
      for update
    )
    update public.newsletter_deliveries
    set
      provider_status = p_status,
      provider_event_id = p_event_id,
      provider_occurred_at = p_occurred_at,
      updated_at = now()
    from delivery_candidate
    where newsletter_deliveries.id = delivery_candidate.id
      and (
        v_next_rank > delivery_candidate.current_rank
        or (v_next_rank = delivery_candidate.current_rank
            and (delivery_candidate.provider_occurred_at is null
                 or p_occurred_at >= delivery_candidate.provider_occurred_at))
      );
  end if;
  return jsonb_build_object('applied', true, 'email_found', v_email.id is not null);
end;
$$;

create table if not exists public.marketing_consent_events (
  event_id text primary key check (char_length(event_id) between 1 and 160),
  recipient text not null check (char_length(recipient) between 3 and 254),
  enabled boolean not null,
  source text not null,
  occurred_at timestamptz not null,
  provider_sync_state text not null default 'not_required',
  provider_sync_attempts integer not null default 0,
  provider_sync_available_at timestamptz not null default now(),
  provider_sync_lease_token uuid,
  provider_sync_lease_expires_at timestamptz,
  provider_sync_error text,
  provider_synced_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.marketing_consent_events
  add column if not exists provider_sync_state text not null default 'not_required',
  add column if not exists provider_sync_attempts integer not null default 0,
  add column if not exists provider_sync_available_at timestamptz not null default now(),
  add column if not exists provider_sync_lease_token uuid,
  add column if not exists provider_sync_lease_expires_at timestamptz,
  add column if not exists provider_sync_error text,
  add column if not exists provider_synced_at timestamptz;
alter table public.marketing_consent_events
  drop constraint if exists marketing_consent_events_provider_sync_state_check;
alter table public.marketing_consent_events
  add constraint marketing_consent_events_provider_sync_state_check check (
    provider_sync_state in ('not_required', 'pending', 'processing', 'retry', 'synced', 'superseded', 'dead')
  );
create index if not exists marketing_consent_events_recipient_idx
  on public.marketing_consent_events (recipient, occurred_at desc);
create index if not exists marketing_consent_events_sync_idx
  on public.marketing_consent_events (provider_sync_state, provider_sync_available_at);

create or replace function public.apply_ses_subscription_event(
  p_event_id text,
  p_recipient text,
  p_enabled boolean,
  p_occurred_at timestamptz,
  p_source text default 'ses_subscription'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted boolean := false;
  v_recipient text;
  v_winner text;
begin
  if btrim(coalesce(p_event_id, '')) = ''
     or char_length(p_event_id) > 160
     or lower(btrim(coalesce(p_recipient, ''))) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or p_enabled is null
     or p_occurred_at is null then
    raise exception 'invalid_ses_subscription_event';
  end if;

  v_recipient := lower(btrim(p_recipient));
  perform pg_advisory_xact_lock(hashtextextended(v_recipient, 0));

  insert into public.marketing_consent_events (
    event_id, recipient, enabled, source, occurred_at, provider_sync_state
  ) values (
    btrim(p_event_id), v_recipient, p_enabled,
    left(coalesce(nullif(btrim(p_source), ''), 'ses_subscription'), 80), p_occurred_at,
    'not_required'
  ) on conflict (event_id) do nothing
  returning true into v_inserted;
  if not coalesce(v_inserted, false) then
    return jsonb_build_object('applied', false, 'duplicate', true);
  end if;

  select event.event_id into v_winner
  from public.marketing_consent_events event
  where event.recipient = v_recipient
  order by event.occurred_at desc, event.enabled asc, event.created_at desc, event.event_id desc
  limit 1;
  if v_winner <> btrim(p_event_id) then
    return jsonb_build_object('applied', false, 'stale', true);
  end if;

  update public.marketing_consent_events event
  set
    provider_sync_state = 'superseded',
    provider_sync_lease_token = null,
    provider_sync_lease_expires_at = null,
    provider_sync_error = null
  where event.recipient = v_recipient
    and event.event_id <> v_winner
    and event.provider_sync_state in ('pending', 'processing', 'retry');

  insert into public.newsletter_recipients (email, source, subscribed)
  values (v_recipient, 'ses_subscription', p_enabled)
  on conflict (email) do update set
    source = excluded.source,
    subscribed = excluded.subscribed;

  update public.profiles profile
  set marketing_email_enabled = p_enabled
  from auth.users auth_user
  where auth_user.id = profile.id
    and lower(btrim(auth_user.email)) = lower(btrim(p_recipient));

  if p_enabled then
    delete from public.email_suppressions
    where email = v_recipient and stream = 'marketing';
  else
    insert into public.email_suppressions (email, reason, stream)
    values (v_recipient, 'provider_unsubscribe', 'marketing')
    on conflict (email, stream) do update set reason = excluded.reason;
  end if;
  return jsonb_build_object('applied', true, 'enabled', p_enabled);
end;
$$;

create or replace function public.claim_marketing_consent_sync_events(
  p_worker_id uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 120
) returns table(event_id text, recipient text, enabled boolean, attempts integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  with ranked as (
    select
      event.event_id,
      row_number() over (
        partition by event.recipient
        order by event.occurred_at desc, event.enabled asc, event.created_at desc, event.event_id desc
      ) as position
    from public.marketing_consent_events event
  )
  update public.marketing_consent_events event
  set
    provider_sync_state = 'superseded',
    provider_sync_lease_token = null,
    provider_sync_lease_expires_at = null,
    provider_sync_error = null
  from ranked
  where event.event_id = ranked.event_id
    and ranked.position > 1
    and event.provider_sync_state in ('pending', 'processing', 'retry');

  update public.marketing_consent_events event
  set
    provider_sync_state = 'retry',
    provider_sync_lease_token = null,
    provider_sync_lease_expires_at = null,
    provider_sync_available_at = now(),
    provider_sync_error = 'processing_lease_expired'
  where event.provider_sync_state = 'processing'
    and event.provider_sync_lease_expires_at <= now();

  update public.marketing_consent_events event
  set provider_sync_state = 'dead', provider_sync_error = 'retry_limit_exhausted'
  where event.provider_sync_state in ('pending', 'retry')
    and event.provider_sync_attempts >= 8;

  return query
  with candidates as (
    select event.event_id
    from public.marketing_consent_events event
    where event.provider_sync_state in ('pending', 'retry')
      and event.provider_sync_available_at <= now()
    order by event.provider_sync_available_at, event.occurred_at, event.event_id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
  ), claimed as (
    update public.marketing_consent_events event
    set
      provider_sync_state = 'processing',
      provider_sync_attempts = event.provider_sync_attempts + 1,
      provider_sync_lease_token = p_worker_id,
      provider_sync_lease_expires_at = now()
        + make_interval(secs => greatest(coalesce(p_lease_seconds, 120), 30)),
      provider_sync_error = null
    from candidates
    where event.event_id = candidates.event_id
    returning event.event_id, event.recipient, event.enabled, event.provider_sync_attempts
  )
  select claimed.event_id, claimed.recipient, claimed.enabled, claimed.provider_sync_attempts
  from claimed;
end;
$$;

create or replace function public.finish_marketing_consent_sync_event(
  p_event_id text,
  p_worker_id uuid,
  p_success boolean,
  p_retryable boolean default false,
  p_error text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state text;
begin
  if btrim(coalesce(p_event_id, '')) = '' or p_success is null then
    raise exception 'invalid_marketing_consent_sync_result';
  end if;
  update public.marketing_consent_events event
  set
    provider_sync_state = case
      when p_success then 'synced'
      when coalesce(p_retryable, false) and event.provider_sync_attempts < 8 then 'retry'
      else 'dead'
    end,
    provider_sync_available_at = case
      when not p_success and coalesce(p_retryable, false) and event.provider_sync_attempts < 8
        then now() + make_interval(secs => least(3600, 15 * power(2, least(event.provider_sync_attempts, 8))::integer))
      else event.provider_sync_available_at
    end,
    provider_sync_lease_token = null,
    provider_sync_lease_expires_at = null,
    provider_sync_error = case when p_success then null else left(coalesce(p_error, 'ses_contact_sync_failed'), 500) end,
    provider_synced_at = case when p_success then now() else event.provider_synced_at end
  where event.event_id = btrim(p_event_id)
    and event.provider_sync_state = 'processing'
    and event.provider_sync_lease_token = p_worker_id
  returning event.provider_sync_state into v_state;
  return v_state;
end;
$$;

-- ---------- GRANTS (service-role auto-grant does not fire for new tables) ----------
alter table public.email_delivery_events enable row level security;
alter table public.marketing_consent_events enable row level security;
revoke all on public.email_delivery_events from public, anon, authenticated;
revoke all on public.marketing_consent_events from public, anon, authenticated;
grant all privileges on public.email_events, public.email_suppressions, public.email_delivery_events,
  public.marketing_consent_events to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on function public.apply_email_delivery_event(text, text, text, text, boolean, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_email_delivery_event(text, text, text, text, boolean, timestamptz, text)
  to service_role;
revoke all on function public.apply_ses_subscription_event(text, text, boolean, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_ses_subscription_event(text, text, boolean, timestamptz, text)
  to service_role;
revoke all on function public.claim_marketing_consent_sync_events(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_marketing_consent_sync_events(uuid, integer, integer)
  to service_role;
revoke all on function public.finish_marketing_consent_sync_event(text, uuid, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.finish_marketing_consent_sync_event(text, uuid, boolean, boolean, text)
  to service_role;
