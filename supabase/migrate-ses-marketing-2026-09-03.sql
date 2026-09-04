-- Consolidate marketing consent in Supabase while Amazon SES owns transport.
-- One RPC atomically updates account preference, send audience, and suppression.
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

create or replace function public.set_marketing_email_preferences(
  p_emails jsonb,
  p_enabled boolean,
  p_source text default 'preference',
  p_user_id uuid default null,
  p_name text default null,
  p_tags text[] default '{}'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_email text;
begin
  if p_enabled is null or jsonb_typeof(coalesce(p_emails, 'null'::jsonb)) <> 'array' then
    raise exception 'invalid_marketing_preference';
  end if;

  create temporary table if not exists pg_temp.marketing_preference_emails (
    email text primary key
  ) on commit drop;
  truncate pg_temp.marketing_preference_emails;

  insert into pg_temp.marketing_preference_emails (email)
  select distinct lower(btrim(value))
  from jsonb_array_elements_text(p_emails)
  where lower(btrim(value)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

  select count(*)::integer into v_count from pg_temp.marketing_preference_emails;
  if v_count = 0 then raise exception 'invalid_marketing_email'; end if;
  if p_user_id is not null and v_count <> 1 then raise exception 'account_preference_requires_one_email'; end if;

  for v_email in
    select selected.email from pg_temp.marketing_preference_emails selected order by selected.email
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_email, 0));
  end loop;

  if p_user_id is not null then
    update public.profiles
    set marketing_email_enabled = p_enabled
    where id = p_user_id;
    if not found then raise exception 'profile_not_found'; end if;
  end if;

  insert into public.newsletter_recipients (email, name, source, tags, subscribed)
  select
    email,
    nullif(left(coalesce(p_name, ''), 120), ''),
    left(coalesce(nullif(btrim(p_source), ''), 'preference'), 80),
    coalesce(p_tags, '{}'),
    p_enabled
  from pg_temp.marketing_preference_emails
  on conflict (email) do update set
    name = coalesce(excluded.name, public.newsletter_recipients.name),
    source = excluded.source,
    tags = case when cardinality(excluded.tags) > 0 then excluded.tags else public.newsletter_recipients.tags end,
    subscribed = excluded.subscribed;

  if p_enabled then
    delete from public.email_suppressions suppression
    using pg_temp.marketing_preference_emails selected
    where suppression.email = selected.email and suppression.stream = 'marketing';
  else
    insert into public.email_suppressions (email, reason, stream)
    select email, 'user_preference', 'marketing'
    from pg_temp.marketing_preference_emails
      on conflict (email, stream) do update set reason = excluded.reason;
  end if;

  insert into public.marketing_consent_events (
    event_id, recipient, enabled, source, occurred_at, provider_sync_state,
    provider_sync_available_at
  )
  select
    'db:' || gen_random_uuid()::text,
    email,
    p_enabled,
    left(coalesce(nullif(btrim(p_source), ''), 'preference'), 80),
    clock_timestamp(),
    'pending',
    now()
  from pg_temp.marketing_preference_emails;

  with ranked as (
    select
      event.event_id,
      row_number() over (
        partition by event.recipient
        order by event.occurred_at desc, event.enabled asc, event.created_at desc, event.event_id desc
      ) as position
    from public.marketing_consent_events event
    join pg_temp.marketing_preference_emails selected on selected.email = event.recipient
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

  return v_count;
end;
$$;

revoke all on function public.set_marketing_email_preferences(jsonb, boolean, text, uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.set_marketing_email_preferences(jsonb, boolean, text, uuid, text, text[])
  to service_role;

-- Mirror SES account-level bounce/complaint suppression into the canonical local
-- blocklist in one bounded RPC. Disabling newsletter recipients also prevents
-- suppressed addresses from being materialized into every future campaign.
create or replace function public.sync_ses_suppressions(p_entries jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_entries, 'null'::jsonb)) <> 'array' then
    raise exception 'invalid_ses_suppression_entries';
  end if;

  create temporary table if not exists pg_temp.ses_suppression_entries (
    email text primary key,
    reason text not null check (reason in ('bounce', 'complaint'))
  ) on commit drop;
  truncate pg_temp.ses_suppression_entries;

  insert into pg_temp.ses_suppression_entries (email, reason)
  select
    lower(btrim(entry->>'email')),
    lower(btrim(entry->>'reason'))
  from jsonb_array_elements(p_entries) entry
  where lower(btrim(entry->>'email')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and lower(btrim(entry->>'reason')) in ('bounce', 'complaint')
  on conflict (email) do update set reason = excluded.reason;

  select count(*)::integer into v_count from pg_temp.ses_suppression_entries;
  if v_count <> jsonb_array_length(p_entries) then
    raise exception 'invalid_ses_suppression_entries';
  end if;

  insert into public.email_suppressions (email, reason, stream)
  select email, reason, 'all'
  from pg_temp.ses_suppression_entries
  on conflict (email, stream) do update set reason = excluded.reason;

  update public.newsletter_recipients recipient
  set subscribed = false
  from pg_temp.ses_suppression_entries suppression
  where recipient.email = suppression.email;

  return v_count;
end;
$$;

revoke all on function public.sync_ses_suppressions(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_ses_suppressions(jsonb)
  to service_role;

-- Resolve offer recipients inside Postgres. This replaces one Auth Admin request
-- per profile with a single bounded RPC and applies both consent and suppression.
create or replace function public.marketing_company_emails(p_company_ids jsonb)
returns table(email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with selected_companies as (
    select distinct value::uuid as company_id
    from jsonb_array_elements_text(coalesce(p_company_ids, '[]'::jsonb))
  )
  select distinct lower(btrim(auth_user.email)) as email
  from public.profiles profile
  join selected_companies selected on selected.company_id = profile.company_id
  join auth.users auth_user on auth_user.id = profile.id
  left join public.newsletter_recipients recipient
    on recipient.email = lower(btrim(auth_user.email))
  where auth_user.email is not null
    and lower(btrim(auth_user.email)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and profile.marketing_email_enabled is not false
    and recipient.subscribed is not false
    and not exists (
      select 1
      from public.email_suppressions suppression
      where suppression.email = lower(btrim(auth_user.email))
        and suppression.stream in ('all', 'marketing')
    )
  order by email;
$$;

revoke all on function public.marketing_company_emails(jsonb)
  from public, anon, authenticated;
grant execute on function public.marketing_company_emails(jsonb)
  to service_role;

-- One-time/idempotent bridge for existing accounts. Never revives an explicit
-- recipient opt-out; active suppression also keeps the recipient disabled.
insert into public.newsletter_recipients (email, source, subscribed)
select
  lower(btrim(auth_user.email)),
  'account_migration',
  profile.marketing_email_enabled is not false
    and not exists (
      select 1 from public.email_suppressions suppression
      where suppression.email = lower(btrim(auth_user.email))
        and suppression.stream in ('all', 'marketing')
    )
from auth.users auth_user
join public.profiles profile on profile.id = auth_user.id
where auth_user.email is not null
  and lower(btrim(auth_user.email)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
on conflict (email) do update set
  subscribed = public.newsletter_recipients.subscribed and excluded.subscribed;

insert into public.email_suppressions (email, reason, stream)
select lower(btrim(auth_user.email)), 'user_preference', 'marketing'
from auth.users auth_user
join public.profiles profile on profile.id = auth_user.id
where auth_user.email is not null and profile.marketing_email_enabled is false
on conflict (email, stream) do update set reason = excluded.reason;

-- Seed each existing canonical recipient once. SES list starts OPT_OUT; Worker
-- must explicitly mirror current DB consent before any campaign can claim it.
insert into public.marketing_consent_events (
  event_id, recipient, enabled, source, occurred_at, provider_sync_state,
  provider_sync_available_at
)
select
  'ses-bootstrap:' || md5(recipient.email),
  recipient.email,
  recipient.subscribed,
  'ses_contact_bootstrap',
  now(),
  'pending',
  now()
from public.newsletter_recipients recipient
where not exists (
  select 1
  from public.marketing_consent_events event
  where event.recipient = recipient.email
)
on conflict (event_id) do nothing;

-- Provider-neutral quote nurture uses the existing durable delivery ledger. Each
-- source snapshots one message for one consented lead; available_at schedules it.
alter table public.newsletter_delivery_sources
  drop constraint if exists newsletter_delivery_sources_source_type_check;
alter table public.newsletter_delivery_sources
  add constraint newsletter_delivery_sources_source_type_check
  check (source_type in ('newsletter', 'blog_post', 'nurture', 'offer', 'review', 'test'));

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

revoke all on function public.materialize_newsletter_deliveries(text, text, text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.materialize_newsletter_deliveries(text, text, text, text, text, text, jsonb, jsonb)
  to service_role;
