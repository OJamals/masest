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
                        'delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained'
                      )),
  terminal            boolean not null default false,
  occurred_at         timestamptz not null,
  created_at          timestamptz not null default now()
);
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
     or p_status not in ('delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained')
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

-- ---------- GRANTS (service-role auto-grant does not fire for new tables) ----------
alter table public.email_delivery_events enable row level security;
revoke all on public.email_delivery_events from public, anon, authenticated;
grant all privileges on public.email_events, public.email_suppressions, public.email_delivery_events to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on function public.apply_email_delivery_event(text, text, text, text, boolean, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_email_delivery_event(text, text, text, text, boolean, timestamptz, text)
  to service_role;
