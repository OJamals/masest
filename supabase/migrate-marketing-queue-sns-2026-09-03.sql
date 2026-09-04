-- Cloudflare Queue ownership + SES/SNS lifecycle consolidation.
-- Safe to re-run. Apply atomically with service-role migration authority.
begin;

-- Added before claim_newsletter_deliveries is compiled: that function gates
-- campaign claims on the latest canonical consent mirror state.
alter table public.marketing_consent_events
  add column if not exists provider_sync_state text not null default 'not_required',
  add column if not exists provider_sync_attempts integer not null default 0,
  add column if not exists provider_sync_available_at timestamptz not null default now(),
  add column if not exists provider_sync_lease_token uuid,
  add column if not exists provider_sync_lease_expires_at timestamptz,
  add column if not exists provider_sync_error text,
  add column if not exists provider_synced_at timestamptz;

alter table public.newsletter_delivery_sources
  drop constraint if exists newsletter_delivery_sources_source_type_check;
alter table public.newsletter_delivery_sources
  add constraint newsletter_delivery_sources_source_type_check
  check (source_type in ('newsletter', 'blog_post', 'nurture', 'offer', 'review', 'test'));

alter table public.newsletter_deliveries
  add column if not exists provider_status text,
  add column if not exists provider_event_id text,
  add column if not exists provider_occurred_at timestamptz;

create or replace function public.materialize_newsletter_deliveries(
  p_source_type text,
  p_source_id text,
  p_parent_id text,
  p_subject text,
  p_html text,
  p_category text,
  p_metadata jsonb,
  p_emails jsonb
)
returns table(created boolean, total_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created boolean := false;
  v_inserted int := 0;
begin
  if p_source_type not in ('newsletter', 'blog_post', 'nurture', 'offer', 'review', 'test') then
    raise exception 'invalid_delivery_source_type';
  end if;
  if p_source_type in ('newsletter', 'offer') and (
    p_parent_id is null
    or p_parent_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'invalid_delivery_parent_id';
  end if;

  insert into public.newsletter_delivery_sources (
    source_type, source_id, parent_id, subject, html, category, metadata
  ) values (
    p_source_type, p_source_id, p_parent_id, p_subject, p_html, p_category,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source_type, source_id) do nothing;
  get diagnostics v_inserted = row_count;
  v_created := v_inserted = 1;

  if v_created then
    insert into public.newsletter_deliveries (
      source_type, source_id, normalized_email, provider_idempotency_key, available_at
    )
    select
      p_source_type,
      p_source_id,
      email,
      (case when p_source_type = 'blog_post' then 'blog-newsletter:' else p_source_type || ':' end)
        || p_source_id || ':' || email,
      coalesce(nullif(p_metadata->>'available_at', '')::timestamptz, now())
    from (
      select distinct lower(btrim(value)) as email
      from jsonb_array_elements_text(coalesce(p_emails, '[]'::jsonb))
    ) normalized
    where email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    on conflict (source_type, source_id, normalized_email) do nothing;

    update public.newsletter_delivery_sources source
    set
      total_count = counts.total_count,
      status = case when counts.total_count = 0 then 'complete' else 'pending' end,
      completed_at = case when counts.total_count = 0 then now() else null end,
      updated_at = now()
    from (
      select count(*)::int as total_count
      from public.newsletter_deliveries
      where source_type = p_source_type and source_id = p_source_id
    ) counts
    where source.source_type = p_source_type and source.source_id = p_source_id;
  end if;

  return query
  select v_created, source.total_count
  from public.newsletter_delivery_sources source
  where source.source_type = p_source_type and source.source_id = p_source_id;
end;
$$;

drop function if exists public.claim_newsletter_deliveries(uuid, text, int, int);
drop function if exists public.claim_newsletter_deliveries(uuid, text, text, int, int);
create function public.claim_newsletter_deliveries(
  p_worker_id uuid,
  p_source_type text,
  p_source_id text default null,
  p_limit int default 25,
  p_lease_seconds int default 300
)
returns table(
  id uuid,
  source_type text,
  source_id text,
  normalized_email text,
  state text,
  attempts int,
  provider_idempotency_key text,
  subject text,
  html text,
  category text
)
language sql
security definer
set search_path = public
as $$
  with expired_candidates as (
    select delivery.id
    from public.newsletter_deliveries delivery
    where (p_source_type is null or delivery.source_type = p_source_type)
      and (p_source_id is null or delivery.source_id = p_source_id)
      and delivery.state = 'processing'
      and delivery.lease_expires_at <= now()
    order by delivery.available_at, delivery.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 25), 1), 500)
  ),
  expired as (
    update public.newsletter_deliveries delivery
    set
      state = 'dead',
      last_error = 'ambiguous_processing_timeout',
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
    from expired_candidates
    where delivery.id = expired_candidates.id
    returning delivery.*
  ),
  candidates as (
    select
      delivery.id,
      exists (
        select 1 from public.email_suppressions suppression
        where suppression.email = delivery.normalized_email
          and suppression.stream = 'all'
      ) or (
        delivery.source_type <> 'test' and (
          exists (
            select 1 from public.email_suppressions suppression
            where suppression.email = delivery.normalized_email
              and suppression.stream = 'marketing'
          )
          or exists (
            select 1 from public.newsletter_recipients recipient
            where recipient.email = delivery.normalized_email
              and recipient.subscribed = false
          )
        )
      ) as blocked
    from public.newsletter_deliveries delivery
    where (
        (p_source_type is null and delivery.source_type <> 'test')
        or delivery.source_type = p_source_type
      )
      and (p_source_id is null or delivery.source_id = p_source_id)
      and delivery.state in ('pending', 'retry')
      and delivery.available_at <= now()
      and (
        delivery.source_type = 'test'
        or coalesce((
          select consent.provider_sync_state
          from public.marketing_consent_events consent
          where consent.recipient = delivery.normalized_email
          order by consent.occurred_at desc, consent.enabled asc, consent.created_at desc, consent.event_id desc
          limit 1
        ), 'pending') in ('not_required', 'synced', 'superseded')
      )
    order by delivery.available_at, delivery.created_at
    for update of delivery skip locked
    limit least(greatest(coalesce(p_limit, 25), 1), 500)
  ),
  claimed as (
    update public.newsletter_deliveries delivery
    set
      state = case when candidates.blocked then 'suppressed' else 'processing' end,
      attempts = delivery.attempts + case when candidates.blocked then 0 else 1 end,
      lease_token = case when candidates.blocked then null else p_worker_id end,
      lease_expires_at = case when candidates.blocked then null
        else now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 30)) end,
      last_error = case when candidates.blocked then 'marketing_suppressed' else delivery.last_error end,
      updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  ),
  changed as (
    select * from expired
    union all
    select * from claimed
  )
  select
    changed.id,
    changed.source_type,
    changed.source_id,
    changed.normalized_email,
    changed.state,
    changed.attempts,
    changed.provider_idempotency_key,
    source.subject,
    source.html,
    source.category
  from changed
  join public.newsletter_delivery_sources source
    on source.source_type = changed.source_type and source.source_id = changed.source_id;
$$;

create or replace function public.finish_newsletter_delivery(
  p_id uuid,
  p_worker_id uuid,
  p_state text,
  p_error text default null,
  p_available_at timestamptz default null,
  p_provider_message_id text default null,
  p_sent_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.newsletter_deliveries%rowtype;
  v_subject text;
  v_category text;
begin
  if p_state not in ('sent', 'suppressed', 'retry', 'dead') then
    raise exception 'invalid_delivery_transition';
  end if;
  update public.newsletter_deliveries
  set
    state = p_state,
    last_error = left(p_error, 500),
    available_at = coalesce(p_available_at, available_at),
    provider_message_id = coalesce(p_provider_message_id, provider_message_id),
    provider_status = case when p_state = 'sent' then 'sent' else provider_status end,
    sent_at = coalesce(p_sent_at, sent_at),
    lease_token = null,
    lease_expires_at = null,
    updated_at = now()
  where id = p_id and state = 'processing' and lease_token = p_worker_id
  returning * into v_delivery;
  if not found then return false; end if;

  if p_state = 'sent' and v_delivery.provider_message_id is not null then
    select source.subject, source.category into v_subject, v_category
    from public.newsletter_delivery_sources source
    where source.source_type = v_delivery.source_type and source.source_id = v_delivery.source_id;
    insert into public.email_events (
      provider_message_id, to_email, category, subject, status
    ) values (
      v_delivery.provider_message_id, v_delivery.normalized_email, v_category, v_subject, 'sent'
    );
  end if;
  return true;
end;
$$;

alter table public.email_delivery_events
  drop constraint if exists email_delivery_events_status_check;
alter table public.email_delivery_events
  add constraint email_delivery_events_status_check check (status in (
    'sent', 'delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained'
  ));

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
    update public.newsletter_recipients
    set subscribed = false
    where email = lower(btrim(p_recipient));
  end if;

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

  return jsonb_build_object('applied', true, 'email_found', v_email.id is not null);
end;
$$;

with ranked_email_delivery_events as (
  select distinct on (event.provider_message_id, event.recipient)
    event.event_id,
    event.provider_message_id,
    event.recipient,
    event.status,
    event.occurred_at,
    case event.status
      when 'sent' then 10 when 'deferred' then 20 when 'delivered' then 30
      when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
      when 'complained' then 50 else 0 end as event_rank
  from public.email_delivery_events event
  order by
    event.provider_message_id,
    event.recipient,
    case event.status
      when 'sent' then 10 when 'deferred' then 20 when 'delivered' then 30
      when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
      when 'complained' then 50 else 0 end desc,
    event.occurred_at desc,
    event.event_id desc
)
update public.email_events email
set
  status = event.status,
  provider_event_id = event.event_id,
  provider_occurred_at = event.occurred_at,
  updated_at = now()
from ranked_email_delivery_events event
where email.provider_message_id = event.provider_message_id
  and lower(btrim(email.to_email)) = event.recipient
  and (
    event.event_rank > case email.status
      when 'sent' then 10 when 'deferred' then 20 when 'delivered' then 30
      when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
      when 'complained' then 50 else 0 end
    or (
      event.event_rank = case email.status
        when 'sent' then 10 when 'deferred' then 20 when 'delivered' then 30
        when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
        when 'complained' then 50 else 0 end
      and (email.provider_occurred_at is null or event.occurred_at > email.provider_occurred_at)
    )
  );

with ranked_email_delivery_events as (
  select distinct on (event.provider_message_id, event.recipient)
    event.event_id,
    event.provider_message_id,
    event.recipient,
    event.status,
    event.occurred_at,
    case event.status
      when 'sent' then 10 when 'deferred' then 20 when 'delivered' then 30
      when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
      when 'complained' then 50 else 0 end as event_rank
  from public.email_delivery_events event
  order by
    event.provider_message_id,
    event.recipient,
    case event.status
      when 'sent' then 10 when 'deferred' then 20 when 'delivered' then 30
      when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
      when 'complained' then 50 else 0 end desc,
    event.occurred_at desc,
    event.event_id desc
)
update public.newsletter_deliveries delivery
set
  provider_status = event.status,
  provider_event_id = event.event_id,
  provider_occurred_at = event.occurred_at,
  updated_at = now()
from ranked_email_delivery_events event
where delivery.provider_message_id = event.provider_message_id
  and delivery.normalized_email = event.recipient
  and (
    event.event_rank > case delivery.provider_status
      when 'sent' then 10 when 'deferred' then 20 when 'delivered' then 30
      when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
      when 'complained' then 50 else 0 end
    or (
      event.event_rank = case delivery.provider_status
        when 'sent' then 10 when 'deferred' then 20 when 'delivered' then 30
        when 'bounced' then 40 when 'failed' then 40 when 'rejected' then 40
        when 'complained' then 50 else 0 end
      and (delivery.provider_occurred_at is null or event.occurred_at > delivery.provider_occurred_at)
    )
  );

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
    and lower(btrim(auth_user.email)) = v_recipient;

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

alter table public.marketing_consent_events enable row level security;
revoke all on public.marketing_consent_events from public, anon, authenticated;
grant all privileges on public.marketing_consent_events to service_role;

revoke all on function public.claim_newsletter_deliveries(uuid, text, text, int, int)
  from public, anon, authenticated;
grant execute on function public.claim_newsletter_deliveries(uuid, text, text, int, int)
  to service_role;
revoke all on function public.finish_newsletter_delivery(uuid, uuid, text, text, timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finish_newsletter_delivery(uuid, uuid, text, text, timestamptz, text, timestamptz)
  to service_role;
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

commit;
