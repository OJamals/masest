-- Optional EmailOctopus companion. Apply after schema-email.sql and schema-newsletters.sql.
begin;

create table if not exists public.emailoctopus_contacts (
  recipient text primary key,
  enabled boolean not null,
  erase boolean not null default false,
  provider_blocked boolean not null default false,
  remote_seen boolean not null default false,
  revision bigint not null default 1,
  state text not null default 'pending' check (state in ('pending','processing','retry','synced','dead')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text
);
create index if not exists emailoctopus_contacts_pending_idx on public.emailoctopus_contacts (available_at)
  where state in ('pending','retry','processing');

create table if not exists public.emailoctopus_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);
create table if not exists public.emailoctopus_connection (
  singleton boolean primary key default true check (singleton),
  list_id uuid not null,
  checked_at timestamptz not null default now()
);
alter table public.emailoctopus_contacts enable row level security;
alter table public.emailoctopus_events enable row level security;
alter table public.emailoctopus_connection enable row level security;
revoke all on public.emailoctopus_contacts, public.emailoctopus_events, public.emailoctopus_connection from public, anon, authenticated;
grant all on public.emailoctopus_contacts, public.emailoctopus_events, public.emailoctopus_connection to service_role;

create or replace function public.queue_emailoctopus_contact(p_recipient text, p_enabled boolean, p_erase boolean default false)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.emailoctopus_contacts as contact (recipient, enabled, erase)
  values (lower(btrim(p_recipient)), p_enabled, p_erase)
  on conflict (recipient) do update set
    enabled = excluded.enabled,
    erase = contact.erase or excluded.erase,
    revision = contact.revision + 1,
    state = case when contact.state = 'processing' then 'processing' else 'pending' end,
    attempts = 0,
    available_at = now(),
    last_error = null;
$$;

create or replace function public.capture_emailoctopus_consent()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event record; v_enabled boolean;
begin
  select * into v_event from public.marketing_consent_events
    where recipient = new.recipient
    order by occurred_at desc, enabled asc, created_at desc, event_id desc limit 1;
  v_enabled := v_event.enabled and v_event.source in ('newsletter_signup','footer_newsletter','account_email_preferences');
  if v_enabled or exists (select 1 from public.emailoctopus_contacts where recipient = new.recipient) then
    perform public.queue_emailoctopus_contact(new.recipient, v_enabled);
  end if;
  return new;
end;
$$;
drop trigger if exists emailoctopus_consent_capture on public.marketing_consent_events;
create trigger emailoctopus_consent_capture after insert on public.marketing_consent_events
  for each row execute function public.capture_emailoctopus_consent();

create or replace function public.capture_emailoctopus_suppression()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.stream in ('all','marketing') and exists (
    select 1 from public.emailoctopus_contacts where recipient = new.email
  ) then perform public.queue_emailoctopus_contact(new.email, false); end if;
  return new;
end;
$$;
drop trigger if exists emailoctopus_suppression_capture on public.email_suppressions;
create trigger emailoctopus_suppression_capture after insert or update on public.email_suppressions
  for each row execute function public.capture_emailoctopus_suppression();

create or replace function public.capture_emailoctopus_erasure()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Auth erasure must invalidate consent before a later backfill can see it.
  if tg_table_schema = 'auth' and exists (
    select 1 from public.newsletter_recipients where email = lower(btrim(old.email))
  ) then
    perform public.set_marketing_email_preferences(jsonb_build_array(old.email), false,
      'account_erasure', null, null, '{}');
  end if;
  if exists (select 1 from public.emailoctopus_contacts where recipient = lower(btrim(old.email))) then
    perform public.queue_emailoctopus_contact(lower(btrim(old.email)), false, true);
  end if;
  return old;
end;
$$;
drop trigger if exists emailoctopus_erasure_capture on public.newsletter_recipients;
create trigger emailoctopus_erasure_capture after delete on public.newsletter_recipients
  for each row execute function public.capture_emailoctopus_erasure();
drop trigger if exists emailoctopus_account_erasure_capture on auth.users;
create trigger emailoctopus_account_erasure_capture before delete on auth.users
  for each row execute function public.capture_emailoctopus_erasure();

create or replace function public.bind_emailoctopus_list(p_list_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.emailoctopus_connection (list_id) values (p_list_id) on conflict do nothing;
  update public.emailoctopus_connection set checked_at = now() where list_id = p_list_id;
  if not found then raise exception 'emailoctopus_list_change_requires_review'; end if;
  return true;
end;
$$;

create or replace function public.claim_emailoctopus_contact(p_worker_id uuid)
returns table (recipient text, enabled boolean, erase boolean, revision bigint, remote_seen boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contact public.emailoctopus_contacts;
begin
  select * into v_contact from public.emailoctopus_contacts c
  where ((c.state in ('pending','retry') and c.available_at <= now())
    or (c.state = 'processing' and c.lease_expires_at <= now())
    or (c.state = 'synced' and c.last_synced_at < now() - interval '6 hours'))
  order by c.erase desc, c.enabled asc, c.available_at, c.recipient
  for update skip locked limit 1;
  if not found then return; end if;
  update public.emailoctopus_contacts c set state = 'processing', attempts = c.attempts + 1,
    lease_token = p_worker_id, lease_expires_at = now() + interval '120 seconds'
    where c.recipient = v_contact.recipient;
  return query select v_contact.recipient,
    v_contact.enabled and not v_contact.provider_blocked and not v_contact.erase
      and exists (select 1 from public.newsletter_recipients r where r.email = v_contact.recipient and r.subscribed)
      and not exists (select 1 from public.email_suppressions s where s.email = v_contact.recipient and s.stream in ('all','marketing')),
    v_contact.erase, v_contact.revision, v_contact.remote_seen;
end;
$$;

create or replace function public.finish_emailoctopus_contact(
  p_recipient text, p_worker_id uuid, p_revision bigint, p_success boolean,
  p_retryable boolean default false, p_remote_seen boolean default false, p_error text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contact public.emailoctopus_contacts;
begin
  select * into v_contact from public.emailoctopus_contacts
    where recipient = p_recipient and lease_token = p_worker_id and state = 'processing' for update;
  if not found then return false; end if;
  if p_success and v_contact.erase and v_contact.revision = p_revision then
    delete from public.emailoctopus_contacts where recipient = p_recipient;
    return true;
  end if;
  update public.emailoctopus_contacts set
    state = case when revision <> p_revision then 'pending' when p_success then 'synced'
      when p_retryable and attempts < 10 then 'retry' else 'dead' end,
    available_at = now() + case when revision <> p_revision then interval '0 seconds' else interval '5 minutes' end,
    lease_token = null, lease_expires_at = null,
    remote_seen = remote_seen or p_remote_seen,
    last_synced_at = case when p_success and revision = p_revision then now() else last_synced_at end,
    last_error = case when p_success or revision <> p_revision then null else left(p_error, 100) end
  where recipient = p_recipient;
  return true;
end;
$$;

create or replace function public.apply_emailoctopus_event(
  p_event_id text, p_recipient text, p_kind text
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(btrim(p_recipient)); v_inserted boolean;
begin
  if p_kind is null or p_event_id is null or v_email is null
    or p_kind not in ('unsubscribed','bounced','complained','deleted')
    or length(p_event_id) not between 1 and 200 or length(v_email) > 320
    or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_emailoctopus_event';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));
  -- A dedicated managed list cannot enroll outsiders or recreate erased recipients.
  if not exists (select 1 from public.emailoctopus_contacts where recipient = v_email)
    and not exists (select 1 from public.newsletter_recipients where email = v_email) then return false; end if;
  insert into public.emailoctopus_events (event_id) values (p_event_id)
    on conflict do nothing returning true into v_inserted;
  if not coalesce(v_inserted, false) then return false; end if;
  if exists (select 1 from public.newsletter_recipients where email = v_email) then
    perform public.set_marketing_email_preferences(jsonb_build_array(v_email), false,
      'emailoctopus_' || p_kind, null, null, '{}');
  end if;
  perform public.queue_emailoctopus_contact(v_email, false);
  update public.emailoctopus_contacts set provider_blocked = true where recipient = v_email;
  if p_kind in ('bounced','complained') then
    insert into public.email_suppressions (email, reason, stream)
      values (v_email, 'emailoctopus_' || p_kind, 'all')
      on conflict (email, stream) do nothing;
  end if;
  return true;
end;
$$;

create or replace function public.emailoctopus_status()
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'list_id', (select list_id from public.emailoctopus_connection),
    'checked_at', (select checked_at from public.emailoctopus_connection),
    'pending', count(*) filter (where state in ('pending','processing','retry')),
    'synced', count(*) filter (where state = 'synced'),
    'dead', count(*) filter (where state = 'dead'),
    'blocked', count(*) filter (where provider_blocked),
    'last_synced_at', max(last_synced_at)
  ) from public.emailoctopus_contacts;
$$;

-- Seed only auditable, explicit opt-ins; imports and default-on accounts are excluded.
insert into public.emailoctopus_contacts (recipient, enabled)
select r.email, true from public.newsletter_recipients r
join lateral (select enabled, source from public.marketing_consent_events e where e.recipient = r.email
  order by occurred_at desc, enabled asc, created_at desc, event_id desc limit 1) e on true
where r.subscribed and e.enabled and e.source in ('newsletter_signup','footer_newsletter','account_email_preferences')
  and not exists (select 1 from public.email_suppressions s where s.email = r.email and s.stream in ('all','marketing'))
on conflict do nothing;

revoke all on function public.queue_emailoctopus_contact(text,boolean,boolean),
  public.capture_emailoctopus_consent(), public.capture_emailoctopus_suppression(), public.capture_emailoctopus_erasure(),
  public.bind_emailoctopus_list(uuid), public.claim_emailoctopus_contact(uuid),
  public.finish_emailoctopus_contact(text,uuid,bigint,boolean,boolean,boolean,text),
  public.apply_emailoctopus_event(text,text,text), public.emailoctopus_status() from public, anon, authenticated;
grant execute on function public.bind_emailoctopus_list(uuid), public.claim_emailoctopus_contact(uuid),
  public.finish_emailoctopus_contact(text,uuid,bigint,boolean,boolean,boolean,text),
  public.apply_emailoctopus_event(text,text,text), public.emailoctopus_status() to service_role;
commit;
