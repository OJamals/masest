-- Canonical support conversations: one table owns both participant chats and
-- company-wide chats. Messages, dashboard chat, staff replies, and email
-- replies all address the same thread row.

begin;

create table if not exists public.support_threads (
  id                  uuid primary key default gen_random_uuid(),
  participant_user_id uuid references public.profiles(id) on delete cascade,
  company_id          uuid references public.companies(id) on delete cascade,
  status              text not null default 'open'
                      check (status in ('open', 'escalated', 'complete')),
  completed_at        timestamptz,
  completed_by        uuid references public.profiles(id) on delete set null,
  last_message_at     timestamptz,
  last_message_body   text,
  last_sender_role    text,
  last_order_id       uuid references public.orders(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint support_threads_owner_check
    check (participant_user_id is not null or company_id is not null)
);

create unique index if not exists support_threads_participant_unique
  on public.support_threads(participant_user_id)
  where participant_user_id is not null;
create unique index if not exists support_threads_company_unique
  on public.support_threads(company_id)
  where participant_user_id is null;
create index if not exists support_threads_inbox_idx
  on public.support_threads(status, last_message_at desc);
create index if not exists support_threads_company_idx
  on public.support_threads(company_id, last_message_at desc);

alter table public.support_threads enable row level security;
revoke all on public.support_threads from public, anon, authenticated;
grant all privileges on public.support_threads to service_role;
grant select on public.support_threads to authenticated;
drop policy if exists support_threads_scope on public.support_threads;
create policy support_threads_scope on public.support_threads
  for select to authenticated using (
    participant_user_id = (select auth.uid())
    or (
      participant_user_id is null
      and company_id = public.current_company_id()
    )
  );

alter table public.messages
  add column if not exists thread_id uuid;

-- Create one participant thread for every message that already records its
-- customer. The current company remains context, never the thread identity.
insert into public.support_threads (
  participant_user_id, company_id, status, completed_at, completed_by,
  created_at, updated_at
)
select distinct on (participant.id)
  participant.id,
  coalesce(participant.company_id, message.company_id),
  coalesce(company.support_thread_status, 'open'),
  company.support_thread_completed_at,
  company.support_thread_completed_by,
  min(message.created_at) over (partition by participant.id),
  now()
from public.messages message
join public.profiles participant
  on participant.id = coalesce(message.user_id, message.recipient_user_id)
left join public.companies company on company.id = message.company_id
where coalesce(message.user_id, message.recipient_user_id) is not null
order by participant.id, message.created_at desc
on conflict (participant_user_id) where participant_user_id is not null
do update set
  company_id = excluded.company_id,
  updated_at = now();

update public.messages message
set thread_id = thread.id
from public.support_threads thread
where thread.participant_user_id = coalesce(message.user_id, message.recipient_user_id)
  and message.thread_id is null;

-- Old staff rows did not always persist the selected recipient. If their
-- company history names exactly one participant, keep those rows in that
-- participant's conversation. Ambiguous or ownerless history stays in a
-- company-wide thread instead of guessing a customer.
with one_participant as (
  select message.company_id, min(thread.participant_user_id::text)::uuid as participant_user_id
  from public.messages message
  join public.support_threads thread on thread.id = message.thread_id
  where thread.participant_user_id is not null
  group by message.company_id
  having count(distinct thread.participant_user_id) = 1
)
update public.messages message
set thread_id = thread.id
from one_participant owner
join public.support_threads thread
  on thread.participant_user_id = owner.participant_user_id
where message.thread_id is null
  and message.company_id = owner.company_id;

insert into public.support_threads (
  participant_user_id, company_id, status, completed_at, completed_by,
  created_at, updated_at
)
select
  null,
  message.company_id,
  coalesce(company.support_thread_status, 'open'),
  company.support_thread_completed_at,
  company.support_thread_completed_by,
  min(message.created_at),
  now()
from public.messages message
left join public.companies company on company.id = message.company_id
where message.thread_id is null
group by message.company_id, company.support_thread_status,
  company.support_thread_completed_at, company.support_thread_completed_by
on conflict (company_id) where participant_user_id is null
do update set updated_at = now();

update public.messages message
set thread_id = thread.id
from public.support_threads thread
where message.thread_id is null
  and thread.participant_user_id is null
  and thread.company_id = message.company_id;

do $$
begin
  if exists (select 1 from public.messages where thread_id is null) then
    raise exception 'support_thread_backfill_incomplete';
  end if;
end;
$$;

alter table public.messages
  alter column thread_id set not null,
  alter column company_id drop not null;

alter table public.messages
  drop constraint if exists messages_thread_id_fkey,
  add constraint messages_thread_id_fkey
    foreign key (thread_id) references public.support_threads(id) on delete cascade;

alter table public.messages
  drop constraint if exists messages_order_company_fkey,
  drop constraint if exists messages_order_id_fkey;
alter table public.messages
  add constraint messages_order_id_fkey
    foreign key (order_id) references public.orders(id) on delete set null;
drop index if exists public.messages_order_company_idx;
create index if not exists messages_thread_idx
  on public.messages(thread_id, created_at);
create index if not exists messages_thread_order_idx
  on public.messages(thread_id, order_id, created_at)
  where order_id is not null;

create or replace function public.ensure_support_message_thread()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_thread public.support_threads%rowtype;
  v_participant_id uuid := coalesce(new.user_id, new.recipient_user_id);
  v_profile_company_id uuid;
  v_order public.orders%rowtype;
begin
  if new.thread_id is null then
    if v_participant_id is not null then
      select company_id into v_profile_company_id
        from public.profiles
       where id = v_participant_id;
      if not found then raise exception 'support_participant_not_found'; end if;
      new.company_id := coalesce(new.company_id, v_profile_company_id);
      insert into public.support_threads (participant_user_id, company_id)
      values (v_participant_id, new.company_id)
      on conflict (participant_user_id) where participant_user_id is not null
      do update set company_id = excluded.company_id, updated_at = now()
      returning * into v_thread;
    elsif new.company_id is not null then
      insert into public.support_threads (participant_user_id, company_id)
      values (null, new.company_id)
      on conflict (company_id) where participant_user_id is null
      do update set updated_at = now()
      returning * into v_thread;
    else
      raise exception 'support_thread_owner_required';
    end if;
    new.thread_id := v_thread.id;
  else
    select * into v_thread
      from public.support_threads
     where id = new.thread_id;
    if not found then raise exception 'support_thread_not_found'; end if;
  end if;

  if new.company_id is distinct from v_thread.company_id then
    raise exception 'support_message_company_mismatch';
  end if;

  if v_thread.participant_user_id is not null then
    if new.sender_role::text = 'buyer' and (
      new.user_id is distinct from v_thread.participant_user_id
      or new.recipient_user_id is not null
    ) then
      raise exception 'support_message_buyer_mismatch';
    end if;
    if new.sender_role::text = 'staff' and
       new.recipient_user_id is distinct from v_thread.participant_user_id then
      raise exception 'support_message_recipient_mismatch';
    end if;
  else
    if new.sender_role::text = 'buyer' and (
      new.user_id is null or not exists (
        select 1 from public.profiles
         where id = new.user_id and company_id = v_thread.company_id
      )
    ) then
      raise exception 'support_business_participant_mismatch';
    end if;
    if new.sender_role::text = 'staff' and new.recipient_user_id is not null then
      raise exception 'support_business_recipient_invalid';
    end if;
  end if;

  if new.order_id is not null then
    select * into v_order from public.orders where id = new.order_id;
    if not found or not (
      (v_thread.participant_user_id is not null
        and v_order.user_id = v_thread.participant_user_id)
      or (v_thread.company_id is not null
        and v_order.company_id = v_thread.company_id)
    ) then
      raise exception 'support_order_thread_mismatch';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_support_message_thread()
  from public, anon, authenticated;
grant execute on function public.ensure_support_message_thread() to service_role;

drop trigger if exists messages_ensure_support_thread on public.messages;
create trigger messages_ensure_support_thread
before insert or update of thread_id, company_id, user_id, recipient_user_id,
  sender_role, order_id on public.messages
for each row execute function public.ensure_support_message_thread();

create or replace function public.project_support_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.support_threads
     set last_message_at = new.created_at,
         last_message_body = new.body,
         last_sender_role = new.sender_role::text,
         last_order_id = new.order_id,
         updated_at = now()
   where id = new.thread_id
     and (last_message_at is null or last_message_at <= new.created_at);

  -- Compatibility projection for company CRM/activity consumers. Thread
  -- lifecycle and inbox ordering are owned only by support_threads.
  if new.company_id is not null then
    update public.companies
       set support_last_message_at = new.created_at,
           support_last_message_body = new.body,
           support_last_sender_role = new.sender_role::text,
           support_last_order_id = new.order_id
     where id = new.company_id
       and (support_last_message_at is null or support_last_message_at <= new.created_at);
  end if;
  return new;
end;
$$;

revoke all on function public.project_support_message()
  from public, anon, authenticated;
grant execute on function public.project_support_message() to service_role;

drop trigger if exists messages_project_support_thread on public.messages;
create trigger messages_project_support_thread
after insert on public.messages
for each row execute function public.project_support_message();

with latest as (
  select distinct on (message.thread_id)
    message.thread_id, message.created_at, message.body,
    message.sender_role::text as sender_role, message.order_id
  from public.messages message
  order by message.thread_id, message.created_at desc, message.id desc
)
update public.support_threads thread
set last_message_at = latest.created_at,
    last_message_body = latest.body,
    last_sender_role = latest.sender_role,
    last_order_id = latest.order_id,
    updated_at = now()
from latest
where thread.id = latest.thread_id;

drop policy if exists messages_company on public.messages;
drop policy if exists messages_support_scope on public.messages;
create policy messages_support_scope on public.messages
  for select to authenticated using (
    exists (
      select 1
      from public.support_threads thread
      where thread.id = messages.thread_id
        and (
          thread.participant_user_id = (select auth.uid())
          or (
            thread.participant_user_id is null
            and thread.company_id = public.current_company_id()
          )
        )
    )
  );

drop function if exists public.append_support_message(
  uuid, uuid, text, text, uuid, text, boolean, uuid
);

create or replace function public.append_support_message(
  p_company_id uuid,
  p_user_id uuid,
  p_sender_role text,
  p_body text,
  p_order_id uuid default null,
  p_source text default 'dashboard',
  p_reopen boolean default null,
  p_recipient_user_id uuid default null,
  p_thread_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_thread public.support_threads%rowtype;
  v_message public.messages%rowtype;
  v_profile public.profiles%rowtype;
  v_company public.companies%rowtype;
  v_order public.orders%rowtype;
  v_previous_sender text;
  v_body text := btrim(coalesce(p_body, ''));
  v_source text := btrim(coalesce(p_source, ''));
  v_thread_user_id uuid := coalesce(p_thread_user_id, p_user_id, p_recipient_user_id);
  v_company_id uuid := p_company_id;
  v_reopen boolean;
begin
  if p_sender_role not in ('buyer', 'staff')
     or v_body = ''
     or char_length(v_body) > 4000
     or v_source = ''
     or char_length(v_source) > 64 then
    raise exception 'invalid_support_message';
  end if;

  if v_thread_user_id is not null then
    select * into v_profile from public.profiles where id = v_thread_user_id;
    if not found then raise exception 'support_participant_not_found'; end if;
    v_company_id := coalesce(v_company_id, v_profile.company_id);
    if v_company_id is distinct from v_profile.company_id then
      raise exception 'support_participant_company_mismatch';
    end if;
    if p_sender_role = 'buyer' and (
      p_user_id is distinct from v_thread_user_id or p_recipient_user_id is not null
    ) then
      raise exception 'support_user_thread_mismatch';
    end if;
    if p_sender_role = 'staff' and
       p_recipient_user_id is distinct from v_thread_user_id then
      raise exception 'support_recipient_thread_mismatch';
    end if;

    insert into public.support_threads (participant_user_id, company_id)
    values (v_thread_user_id, v_company_id)
    on conflict (participant_user_id) where participant_user_id is not null
    do update set company_id = excluded.company_id, updated_at = now()
    returning * into v_thread;
  else
    if p_sender_role <> 'staff' or v_company_id is null or p_recipient_user_id is not null then
      raise exception 'support_thread_user_required';
    end if;
    insert into public.support_threads (participant_user_id, company_id)
    values (null, v_company_id)
    on conflict (company_id) where participant_user_id is null
    do update set updated_at = now()
    returning * into v_thread;
  end if;

  if v_company_id is not null then
    select * into v_company from public.companies where id = v_company_id;
    if not found then raise exception 'support_company_not_found'; end if;
  end if;

  if p_order_id is not null then
    select * into v_order from public.orders where id = p_order_id;
    if not found or not (
      (v_thread.participant_user_id is not null
        and v_order.user_id = v_thread.participant_user_id)
      or (v_thread.company_id is not null
        and v_order.company_id = v_thread.company_id)
    ) then
      raise exception 'support_order_thread_mismatch';
    end if;
  end if;

  select sender_role::text into v_previous_sender
    from public.messages
   where thread_id = v_thread.id
   order by created_at desc, id desc
   limit 1;

  insert into public.messages (
    thread_id, company_id, user_id, recipient_user_id, sender_role, body,
    order_id, source, read_by_staff, read_by_user
  ) values (
    v_thread.id,
    v_thread.company_id,
    case when p_sender_role = 'buyer' then v_thread.participant_user_id else null end,
    case when p_sender_role = 'staff' then v_thread.participant_user_id else null end,
    p_sender_role::public.message_sender,
    v_body,
    p_order_id,
    v_source,
    p_sender_role = 'staff',
    p_sender_role = 'buyer'
  ) returning * into v_message;

  v_reopen := coalesce(p_reopen, p_sender_role = 'buyer');
  if v_reopen then
    update public.support_threads
       set status = 'open', completed_at = null, completed_by = null,
           updated_at = now()
     where id = v_thread.id;
  end if;

  return jsonb_build_object(
    'id', v_message.id,
    'created_at', v_message.created_at,
    'thread_id', v_message.thread_id,
    'thread_user_id', v_thread.participant_user_id,
    'company_id', v_message.company_id,
    'user_id', v_message.user_id,
    'recipient_user_id', v_message.recipient_user_id,
    'order_id', v_message.order_id,
    'sender_role', v_message.sender_role,
    'body', v_message.body,
    'source', v_message.source,
    'previous_sender_role', v_previous_sender,
    'prior_thread_status', v_thread.status,
    'company_name', v_company.name,
    'customer_name', v_profile.full_name
  );
end;
$$;

revoke all on function public.append_support_message(
  uuid, uuid, text, text, uuid, text, boolean, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.append_support_message(
  uuid, uuid, text, text, uuid, text, boolean, uuid, uuid
) to service_role;

drop function if exists public.upsert_email_inbound_message(
  uuid, uuid, text, text, text, uuid, uuid, text
);

create or replace function public.upsert_email_inbound_message(
  p_company_id uuid,
  p_user_id uuid,
  p_external_message_id text,
  p_body text,
  p_sender_role text default 'buyer',
  p_recipient_user_id uuid default null,
  p_order_id uuid default null,
  p_email_references text default null,
  p_thread_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_thread public.support_threads%rowtype;
  v_message public.messages%rowtype;
  v_company public.companies%rowtype;
  v_profile public.profiles%rowtype;
  v_previous_sender text;
  v_alert_kind text;
  v_inserted boolean := false;
  v_participant_id uuid := coalesce(p_user_id, p_recipient_user_id);
begin
  if p_sender_role not in ('buyer', 'staff')
     or btrim(coalesce(p_external_message_id, '')) = ''
     or char_length(p_external_message_id) > 512
     or btrim(coalesce(p_body, '')) = ''
     or char_length(p_body) > 4000 then
    raise exception 'invalid_email_inbound_message';
  end if;
  if p_email_references is not null and (
    char_length(p_email_references) > 8192
    or p_email_references !~ '^(<[^<>[:space:]]{1,255}[^<>[:space:]]{0,255}>)([[:space:]]+<[^<>[:space:]]{1,255}[^<>[:space:]]{0,255}>)*$'
  ) then
    raise exception 'invalid_email_inbound_references';
  end if;

  if p_thread_id is not null then
    select * into v_thread from public.support_threads where id = p_thread_id for update;
  elsif v_participant_id is not null then
    select * into v_thread from public.support_threads
     where participant_user_id = v_participant_id for update;
  elsif p_company_id is not null then
    select * into v_thread from public.support_threads
     where participant_user_id is null and company_id = p_company_id for update;
  end if;
  if v_thread.id is null then raise exception 'email_inbound_thread_not_found'; end if;
  if p_company_id is distinct from v_thread.company_id then
    raise exception 'email_inbound_company_mismatch';
  end if;

  if p_sender_role = 'buyer' and (
    p_user_id is null
    or (v_thread.participant_user_id is not null
      and p_user_id is distinct from v_thread.participant_user_id)
    or (v_thread.participant_user_id is null and not exists (
      select 1 from public.profiles
       where id = p_user_id and company_id = v_thread.company_id
    ))
  ) then
    raise exception 'email_inbound_user_thread_mismatch';
  end if;
  if p_sender_role = 'staff' and (
    v_thread.participant_user_id is null
    or p_recipient_user_id is distinct from v_thread.participant_user_id
  ) then
    raise exception 'email_inbound_recipient_thread_mismatch';
  end if;

  if p_order_id is not null and not exists (
    select 1 from public.orders order_row
     where order_row.id = p_order_id
       and (
         (v_thread.participant_user_id is not null
           and order_row.user_id = v_thread.participant_user_id)
         or (v_thread.company_id is not null
           and order_row.company_id = v_thread.company_id)
       )
  ) then
    raise exception 'email_inbound_order_thread_mismatch';
  end if;

  if v_thread.company_id is not null then
    select * into v_company from public.companies where id = v_thread.company_id;
  end if;
  if v_thread.participant_user_id is not null then
    select * into v_profile from public.profiles where id = v_thread.participant_user_id;
  end if;

  select * into v_message
    from public.messages
   where source = 'email_reply' and external_message_id = p_external_message_id
   for update;
  if not found then
    select sender_role::text into v_previous_sender
      from public.messages
     where thread_id = v_thread.id
     order by created_at desc, id desc
     limit 1;
    v_alert_kind := case when p_sender_role = 'buyer' then case
      when v_previous_sender is null or v_thread.status = 'complete' then 'support_request'
      else 'message'
    end else null end;
    insert into public.messages (
      thread_id, company_id, user_id, recipient_user_id, sender_role, body,
      order_id, source, external_message_id, external_alert_kind,
      email_references, read_by_user, read_by_staff
    ) values (
      v_thread.id,
      v_thread.company_id,
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
     or v_message.thread_id is distinct from v_thread.id
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
     where thread_id = v_thread.id
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
    update public.support_threads
       set status = 'open', completed_at = null, completed_by = null,
           updated_at = now()
     where id = v_thread.id;
  end if;

  return jsonb_build_object(
    'id', v_message.id,
    'message_id', v_message.id,
    'created_at', v_message.created_at,
    'thread_id', v_message.thread_id,
    'thread_user_id', v_thread.participant_user_id,
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
    'prior_thread_status', v_thread.status,
    'alert_kind', v_alert_kind,
    'company_name', v_company.name,
    'customer_name', v_profile.full_name
  );
end;
$$;

revoke all on function public.upsert_email_inbound_message(
  uuid, uuid, text, text, text, uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.upsert_email_inbound_message(
  uuid, uuid, text, text, text, uuid, uuid, text, uuid
) to service_role;

-- Order cancellation/return requests use the same participant thread. Exact
-- order owners remain eligible even without a company; company members retain
-- access to company-owned orders.
create or replace function public.create_order_support_request(
  p_order_id uuid,
  p_type text,
  p_reason text,
  p_line_items jsonb,
  p_requested_by uuid,
  p_requested_email text,
  p_message_body text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_request public.order_requests%rowtype;
  v_message jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_can_message boolean := false;
begin
  if p_order_id is null
     or p_type not in ('cancel', 'return')
     or char_length(v_reason) < 8
     or char_length(v_reason) > 1000
     or p_requested_by is null
     or jsonb_typeof(coalesce(p_line_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_line_items, '[]'::jsonb)) > 50 then
    raise exception 'invalid_order_support_request';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id
   for update;
  if not found then raise exception 'order_not_found'; end if;

  v_can_message := v_order.user_id = p_requested_by or (
    v_order.company_id is not null and exists (
      select 1 from public.profiles
       where id = p_requested_by and company_id = v_order.company_id
    )
  );
  if not v_can_message then raise exception 'order_support_requester_mismatch'; end if;

  insert into public.order_requests (
    order_id, type, reason, line_items, requested_by, requested_email
  ) values (
    p_order_id,
    p_type,
    v_reason,
    coalesce(p_line_items, '[]'::jsonb),
    p_requested_by,
    nullif(left(btrim(coalesce(p_requested_email, '')), 320), '')
  )
  on conflict (order_id, type) where status = 'open' do nothing
  returning * into v_request;

  if not found then
    select * into v_request
      from public.order_requests
     where order_id = p_order_id
       and type = p_type
       and status = 'open'
     order by created_at desc
     limit 1;
    return jsonb_build_object(
      'duplicate', true,
      'request', to_jsonb(v_request),
      'message', null,
      'chat_linked', true
    );
  end if;

  v_message := public.append_support_message(
    case when v_order.user_id = p_requested_by then null else v_order.company_id end,
    p_requested_by,
    'buyer',
    p_message_body,
    p_order_id,
    'order_request',
    true,
    null,
    p_requested_by
  );

  return jsonb_build_object(
    'duplicate', false,
    'request', to_jsonb(v_request),
    'message', v_message,
    'chat_linked', true
  );
end;
$$;

revoke all on function public.create_order_support_request(
  uuid, text, text, jsonb, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.create_order_support_request(
  uuid, text, text, jsonb, uuid, text, text
) to service_role;

commit;
