-- Newsletter platform: drafts/queue, imported recipients, settings. Apply via the
-- pooled service-role connection. Idempotent. Service-role only (RLS off).
create extension if not exists pgcrypto;

create table if not exists public.newsletters (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  body_md text not null default '',
  source text not null default 'compose',        -- 'compose' | 'blog_post'
  blog_slug text,
  status text not null default 'draft',           -- draft|scheduled|queueing|sending|sent|failed|canceled
  audience jsonb not null default '{"populations":[],"recipient_tags":[]}'::jsonb,
  schedule jsonb not null default '{}'::jsonb,     -- {mode, send_at, interval_days, next_run_at}
  recipient_count int not null default 0,
  sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists newsletters_status_idx on public.newsletters (status);
create index if not exists newsletters_due_idx on public.newsletters ((schedule->>'next_run_at')) where status = 'scheduled';

-- Imported / manually-added recipients (users + website leads are resolved live at send).
create table if not exists public.newsletter_recipients (
  email text primary key,
  name text,
  source text not null default 'manual',           -- 'import' | 'manual'
  tags text[] not null default '{}',
  subscribed boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists newsletter_recipients_sub_idx on public.newsletter_recipients (subscribed);

-- Singleton settings row (auto-send latest blog toggle).
create table if not exists public.newsletter_settings (
  id int primary key default 1,
  auto_send_latest_blog boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.newsletter_settings (id) values (1) on conflict (id) do nothing;

grant select, insert, update, delete on public.newsletters to service_role;
grant select, insert, update, delete on public.newsletter_recipients to service_role;
grant select, insert, update on public.newsletter_settings to service_role;

-- Durable newsletter/blog delivery queue. Source rows snapshot rendered content once;
-- recipient rows carry transport state. Apply only through the operator-owned migration
-- path. No production migration or scheduler change is performed by this file.
alter table public.newsletters
  add column if not exists delivery_source_id text,
  add column if not exists delivery_summary jsonb not null default '{}'::jsonb,
  add column if not exists provider text,
  add column if not exists provider_campaign_id text,
  add column if not exists provider_message_id text,
  add column if not exists provider_template_id text,
  add column if not exists provider_status text,
  add column if not exists provider_error text;

create index if not exists newsletters_provider_campaign_idx
  on public.newsletters (provider, provider_campaign_id)
  where provider_campaign_id is not null;

create table if not exists public.newsletter_delivery_sources (
  source_type text not null check (source_type in ('newsletter', 'blog_post', 'nurture', 'offer', 'review', 'test')),
  source_id text not null,
  parent_id text not null,
  subject text not null,
  html text not null,
  category text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'complete')),
  total_count int not null default 0,
  sent_count int not null default 0,
  suppressed_count int not null default 0,
  dead_count int not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_type, source_id)
);

create table if not exists public.newsletter_deliveries (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  normalized_email text not null check (normalized_email = lower(btrim(normalized_email))),
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'sent', 'suppressed', 'retry', 'dead')),
  attempts int not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_idempotency_key text not null,
  provider_message_id text,
  provider_status text,
  provider_event_id text,
  provider_occurred_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (source_type, source_id)
    references public.newsletter_delivery_sources (source_type, source_id)
    on delete cascade,
  unique (source_type, source_id, normalized_email),
  unique (provider_idempotency_key)
);

create index if not exists newsletter_deliveries_claim_idx
  on public.newsletter_deliveries (source_type, state, available_at, lease_expires_at);
create index if not exists newsletter_deliveries_source_idx
  on public.newsletter_deliveries (source_type, source_id, state);

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
create or replace function public.claim_newsletter_deliveries(
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

create or replace function public.newsletter_delivery_summary(
  p_source_type text,
  p_source_id text
)
returns table(
  total int,
  pending int,
  processing int,
  retry int,
  sent int,
  suppressed int,
  dead int,
  terminal int,
  complete boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::int,
    count(*) filter (where state = 'pending')::int,
    count(*) filter (where state = 'processing')::int,
    count(*) filter (where state = 'retry')::int,
    count(*) filter (where state = 'sent')::int,
    count(*) filter (where state = 'suppressed')::int,
    count(*) filter (where state = 'dead')::int,
    count(*) filter (where state in ('sent', 'suppressed', 'dead'))::int,
    count(*) = count(*) filter (where state in ('sent', 'suppressed', 'dead'))
  from public.newsletter_deliveries
  where source_type = p_source_type and source_id = p_source_id;
$$;

revoke all on public.newsletter_delivery_sources from anon, authenticated;
revoke all on public.newsletter_deliveries from anon, authenticated;
grant select, insert, update, delete on public.newsletter_delivery_sources to service_role;
grant select, insert, update, delete on public.newsletter_deliveries to service_role;
revoke all on function public.materialize_newsletter_deliveries(text, text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.claim_newsletter_deliveries(uuid, text, text, int, int) from public, anon, authenticated;
revoke all on function public.finish_newsletter_delivery(uuid, uuid, text, text, timestamptz, text, timestamptz) from public, anon, authenticated;
revoke all on function public.newsletter_delivery_summary(text, text) from public, anon, authenticated;
grant execute on function public.materialize_newsletter_deliveries(text, text, text, text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.claim_newsletter_deliveries(uuid, text, text, int, int) to service_role;
grant execute on function public.finish_newsletter_delivery(uuid, uuid, text, text, timestamptz, text, timestamptz) to service_role;
grant execute on function public.newsletter_delivery_summary(text, text) to service_role;
