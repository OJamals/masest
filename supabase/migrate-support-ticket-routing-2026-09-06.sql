-- Route every new support write through a locked ticket beneath its canonical
-- thread. Apply after migrate-support-tickets-2026-09-06.sql.

begin;

-- The cutover is monotonic. Version 1 protects deployed old RPC call shapes;
-- version 2 is entered only by an explicitly authorized service-role activation.
create table if not exists public.support_ticket_routing_contract (
  singleton boolean primary key default true check (singleton),
  version integer not null default 1 check (version in (1, 2)),
  updated_at timestamptz not null default now()
);
insert into public.support_ticket_routing_contract (singleton, version)
values (true, 1) on conflict (singleton) do nothing;
alter table public.support_ticket_routing_contract enable row level security;
revoke all on public.support_ticket_routing_contract from public, anon, authenticated, service_role;

alter table public.order_requests
  add column if not exists ticket_id uuid;

-- Freeze every pre-routing support writer while the final additive backfill,
-- NOT NULL invariant, and replacement RPCs are installed in this transaction.
-- The lock waits for already-running writes and prevents a new null-ticket gap.
-- It is not a caller-drain proof: Plan 043 must pause/drain ingress before this
-- migration is applied, then prove new code/workers before explicit activation.
lock table public.support_threads, public.support_tickets,
  public.support_ticket_events, public.messages
  in share row exclusive mode;

do $$
declare
  v_constraint record;
begin
  select constraint_row.contype, constraint_row.confrelid,
         constraint_row.confupdtype, constraint_row.confdeltype,
         constraint_row.convalidated,
         array(
           select attribute.attname::text
             from unnest(constraint_row.conkey) with ordinality key_column(attnum, position)
             join pg_attribute attribute
               on attribute.attrelid = constraint_row.conrelid
              and attribute.attnum = key_column.attnum
            order by key_column.position
         ) as key_columns,
         array(
           select attribute.attname::text
             from unnest(constraint_row.confkey) with ordinality key_column(attnum, position)
             join pg_attribute attribute
               on attribute.attrelid = constraint_row.confrelid
              and attribute.attnum = key_column.attnum
            order by key_column.position
         ) as referenced_columns
    into v_constraint
    from pg_constraint constraint_row
   where constraint_row.conrelid = 'public.order_requests'::regclass
     and constraint_row.conname = 'order_requests_ticket_fkey';
  if found and (
    v_constraint.contype <> 'f'
    or v_constraint.confrelid <> 'public.support_tickets'::regclass
    or v_constraint.confupdtype <> 'a'
    or v_constraint.confdeltype <> 'n'
    or v_constraint.convalidated is not true
    or v_constraint.key_columns <> array['ticket_id']::text[]
    or v_constraint.referenced_columns <> array['id']::text[]
  ) then
    raise exception 'order_request_ticket_constraint_collision';
  end if;
  if not found then
    alter table public.order_requests
      add constraint order_requests_ticket_fkey
      foreign key (ticket_id) references public.support_tickets(id)
      on delete set null;
  end if;
end;
$$;

-- Never replace a managed ticket assignment. A post-039 null is the only
-- value that may be reconciled, and it always receives the stable legacy
-- ticket whose identity is the canonical thread identity.
do $$
begin
  if exists (
    select 1
      from public.messages message
      left join public.support_tickets ticket on ticket.id = message.ticket_id
     where message.ticket_id is not null
       and (ticket.id is null or ticket.thread_id is distinct from message.thread_id)
  ) then
    raise exception 'support_message_ticket_identity_collision';
  end if;
end;
$$;

-- 039 was additive, so threads/messages may have arrived after its snapshot.
-- Continue its stable legacy identity rule: only a missing thread-id ticket is
-- created, and the thread projection supplies the exact historical lifecycle.
do $$
begin
  if exists (
    select 1
      from public.support_threads thread
      join public.support_tickets ticket on ticket.id = thread.id
     where ticket.thread_id is distinct from thread.id
  ) then
    raise exception 'legacy_support_ticket_identity_collision';
  end if;
end;
$$;

insert into public.support_tickets (
  id, thread_id, subject, status, priority, category, primary_order_id,
  resolved_at, last_message_at, last_message_body, last_sender_role,
  created_at, updated_at, version
)
select
  thread.id, thread.id, 'Legacy support conversation',
  case when thread.status = 'complete' then 'resolved' else 'open' end,
  case when thread.status = 'escalated' then 'high' else 'normal' end,
  'general', thread.last_order_id,
  case when thread.status = 'complete' then thread.completed_at else null end,
  thread.last_message_at, left(thread.last_message_body, 500),
  thread.last_sender_role, thread.created_at,
  greatest(thread.created_at, thread.updated_at), 1
from public.support_threads thread
where not exists (
  select 1 from public.support_tickets ticket where ticket.id = thread.id
)
and exists (
  select 1 from public.messages message
   where message.thread_id = thread.id and message.ticket_id is null
);

do $$
begin
  if exists (
    select 1
      from public.support_threads thread
      join public.support_ticket_events event
        on event.idempotency_key = 'legacy-created/' || thread.id::text
     where event.ticket_id is distinct from thread.id
        or event.event_type is distinct from 'created'
        or event.detail ->> 'source' is distinct from 'legacy_thread_backfill'
  ) then
    raise exception 'legacy_support_ticket_event_collision';
  end if;
end;
$$;

insert into public.support_ticket_events (
  ticket_id, idempotency_key, event_type, to_value, detail, created_at
)
select
  ticket.id, 'legacy-created/' || ticket.id::text, 'created', ticket.status,
  jsonb_build_object('source', 'legacy_thread_backfill', 'thread_id', ticket.thread_id),
  ticket.created_at
from public.support_tickets ticket
where ticket.id = ticket.thread_id
  and exists (
    select 1 from public.messages message
     where message.thread_id = ticket.thread_id
       and message.ticket_id is null
  )
  and not exists (
    select 1 from public.support_ticket_events event
     where event.idempotency_key = 'legacy-created/' || ticket.id::text
  );

-- At this point a stable legacy ticket is authoritative only for a thread
-- that still needs null-message reconciliation. Do not infer provenance for a
-- later managed ticket merely because an operator chose thread.id as its id.
do $$
begin
  if exists (
    select 1
      from public.support_threads thread
      join public.messages message
        on message.thread_id = thread.id and message.ticket_id is null
      join public.support_tickets ticket
        on ticket.id = thread.id and ticket.thread_id = thread.id
     where not exists (
       select 1 from public.support_ticket_events event
        where event.idempotency_key = 'legacy-created/' || ticket.id::text
          and event.ticket_id = ticket.id
          and event.event_type = 'created'
     )
  ) then
    raise exception 'legacy_support_ticket_event_missing';
  end if;
end;
$$;

-- Reconcile only the untouched 039 legacy snapshot. Version 1 plus the sole
-- immutable legacy-created event proves that no ticket-native workflow update
-- has occurred. In that narrow case, support_threads is still the deployed
-- lifecycle authority and may have changed between 039 and this cutover. A
-- resolved thread with no completed_at remains valid: 039 intentionally kept
-- that historical timestamp nullable, so the ticket and cutover event do too.

with lifecycle_candidates as (
  select
    ticket.id as ticket_id,
    ticket.status as from_status,
    case when thread.status = 'complete' then 'resolved' else 'open' end as to_status,
    ticket.priority as from_priority,
    case when thread.status = 'escalated' then 'high' else 'normal' end as to_priority,
    thread.status as observed_thread_status,
    thread.completed_at,
    thread.completed_by,
    thread.updated_at as thread_updated_at
  from public.support_threads thread
  join public.support_tickets ticket
    on ticket.id = thread.id and ticket.thread_id = thread.id
  where ticket.version = 1
    and exists (
      select 1 from public.support_ticket_events event
       where event.ticket_id = ticket.id
         and event.idempotency_key = 'legacy-created/' || ticket.id::text
         and event.event_type = 'created'
         and event.detail ->> 'source' = 'legacy_thread_backfill'
    )
    and not exists (
      select 1 from public.support_ticket_events event
       where event.ticket_id = ticket.id
         and event.idempotency_key <> 'legacy-created/' || ticket.id::text
    )
    and (
      ticket.status is distinct from case when thread.status = 'complete' then 'resolved' else 'open' end
      or ticket.priority is distinct from case when thread.status = 'escalated' then 'high' else 'normal' end
    )
), reconciled as (
  update public.support_tickets ticket
     set status = candidate.to_status,
         priority = candidate.to_priority,
         resolved_at = case when candidate.to_status = 'resolved' then candidate.completed_at else null end,
         updated_at = greatest(ticket.updated_at, candidate.thread_updated_at, now()),
         version = ticket.version + 1
    from lifecycle_candidates candidate
   where ticket.id = candidate.ticket_id
  returning
    ticket.id as ticket_id,
    candidate.from_status,
    candidate.to_status,
    candidate.from_priority,
    candidate.to_priority,
    candidate.observed_thread_status,
    candidate.completed_at,
    candidate.completed_by
)
insert into public.support_ticket_events (
  ticket_id, idempotency_key, actor_id, event_type, from_value, to_value, detail
)
select
  row.ticket_id,
  'routing-cutover/' || row.ticket_id::text || '/status',
  row.completed_by,
  'status_changed',
  row.from_status,
  row.to_status,
  jsonb_build_object(
    'source', 'support_ticket_routing_cutover',
    'observed_thread_status', row.observed_thread_status,
    'thread_completed_at', row.completed_at
  )
from reconciled row
where row.from_status is distinct from row.to_status
union all
select
  row.ticket_id,
  'routing-cutover/' || row.ticket_id::text || '/priority',
  null,
  'priority_changed',
  row.from_priority,
  row.to_priority,
  jsonb_build_object(
    'source', 'support_ticket_routing_cutover',
    'observed_thread_status', row.observed_thread_status
  )
from reconciled row
where row.from_priority is distinct from row.to_priority;

-- Plan 043 must execute post-039 buyer-reopen and staff-resolve fixtures in
-- PostgreSQL before this migration is approved for application.

update public.messages message
set ticket_id = legacy_ticket.id
from public.support_tickets legacy_ticket
where message.ticket_id is null
  and legacy_ticket.id = message.thread_id
  and legacy_ticket.thread_id = message.thread_id;

-- Refresh only conversation projections from the messages now assigned to a
-- stable legacy ticket. Managed status, priority, assignment, and order scope
-- remain untouched. The distinct guard keeps migration reruns idempotent.
with latest as (
  select distinct on (message.ticket_id)
    message.ticket_id, message.created_at, message.body, message.sender_role::text as sender_role
  from public.messages message
  join public.support_tickets ticket
    on ticket.id = message.ticket_id and ticket.id = ticket.thread_id
  order by message.ticket_id, message.created_at desc, message.id desc
)
update public.support_tickets ticket
set last_message_at = latest.created_at,
    last_message_body = left(latest.body, 500),
    last_sender_role = latest.sender_role,
    updated_at = greatest(ticket.updated_at, latest.created_at),
    version = ticket.version + 1
from latest
where ticket.id = latest.ticket_id
  and (
    ticket.last_message_at is distinct from latest.created_at
    or ticket.last_message_body is distinct from left(latest.body, 500)
    or ticket.last_sender_role is distinct from latest.sender_role
  );

do $$
declare
  v_message_count bigint;
  v_linked_count bigint;
begin
  select count(*) into v_message_count from public.messages;
  select count(*) into v_linked_count
    from public.messages message
    join public.support_tickets ticket
      on ticket.id = message.ticket_id
     and ticket.thread_id = message.thread_id;
  if v_linked_count <> v_message_count then
    raise exception 'support_message_ticket_backfill_incomplete';
  end if;
end;
$$;

alter table public.messages alter column ticket_id set not null;

drop function if exists public.resolve_support_ticket(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, boolean
);

create or replace function public.resolve_support_ticket(
  p_thread_id uuid,
  p_ticket_id uuid,
  p_requester_id uuid,
  p_participant_user_id uuid,
  p_company_id uuid,
  p_order_id uuid,
  p_subject text,
  p_category text default 'general',
  p_start_ticket boolean default false
) returns table (
  thread_id uuid,
  participant_user_id uuid,
  company_id uuid,
  ticket_id uuid,
  ticket_number bigint,
  subject text,
  ticket_status text,
  ticket_priority text,
  ticket_category text,
  ticket_version integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_thread public.support_threads%rowtype;
  v_ticket public.support_tickets%rowtype;
  v_order public.orders%rowtype;
  v_profile public.profiles%rowtype;
  v_company public.companies%rowtype;
  v_company_id uuid := p_company_id;
  v_exact_thread_id uuid;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_category text := btrim(coalesce(p_category, 'general'));
  v_ticket_count bigint;
  v_contract_version integer;
begin
  if v_category not in ('general', 'product', 'order', 'shipping', 'billing', 'account', 'technical') then
    raise exception 'invalid_support_ticket_category';
  end if;
  select version into v_contract_version from public.support_ticket_routing_contract
   where singleton = true for share;

  if p_participant_user_id is not null then
    select * into v_profile from public.profiles where id = p_participant_user_id;
    if not found then raise exception 'support_participant_not_found'; end if;
    v_company_id := coalesce(v_company_id, v_profile.company_id);
    if v_company_id is distinct from v_profile.company_id then
      raise exception 'support_participant_company_mismatch';
    end if;
  elsif v_company_id is not null then
    select * into v_company from public.companies where id = v_company_id;
    if not found then raise exception 'support_company_not_found'; end if;
  end if;

  -- Read explicit ticket identity without locking it, then lock its canonical
  -- thread first. A supplied thread hint never overrides an exact ticket.
  if p_ticket_id is not null then
    select ticket.thread_id into v_exact_thread_id
      from public.support_tickets ticket where ticket.id = p_ticket_id;
    if not found then raise exception 'support_ticket_not_found'; end if;
  end if;

  -- This is deliberately the first write lock. All ticket locks in this
  -- migration are taken only after this canonical thread lock.
  if v_exact_thread_id is not null then
    select * into v_thread from public.support_threads
     where id = v_exact_thread_id for update;
    if not found then raise exception 'support_ticket_not_found'; end if;
  elsif p_thread_id is not null then
    select * into v_thread from public.support_threads
     where id = p_thread_id for update;
    if not found then raise exception 'support_thread_not_found'; end if;
  elsif p_participant_user_id is not null then
    insert into public.support_threads (participant_user_id, company_id)
    values (p_participant_user_id, v_company_id)
    on conflict (participant_user_id) where participant_user_id is not null
    do update set company_id = excluded.company_id, updated_at = now()
    returning * into v_thread;
  elsif v_company_id is not null then
    insert into public.support_threads (participant_user_id, company_id)
    values (null, v_company_id)
    on conflict (company_id) where participant_user_id is null
    do update set updated_at = now()
    returning * into v_thread;
  else
    raise exception 'support_thread_user_required';
  end if;

  if p_participant_user_id is not null
     and v_thread.participant_user_id is distinct from p_participant_user_id then
    raise exception 'support_participant_thread_mismatch';
  end if;
  if v_thread.company_id is distinct from v_company_id then
    raise exception 'support_company_thread_mismatch';
  end if;
  if p_requester_id is not null then
    if v_thread.participant_user_id is not null then
      if p_requester_id is distinct from v_thread.participant_user_id then
        raise exception 'support_requester_thread_mismatch';
      end if;
    elsif not exists (
      select 1 from public.profiles profile
       where profile.id = p_requester_id
         and profile.company_id = v_thread.company_id
    ) then
      raise exception 'support_requester_thread_mismatch';
    end if;
  end if;
  if p_order_id is not null then
    select * into v_order from public.orders where id = p_order_id;
    if not found or not (
      (v_thread.participant_user_id is not null and v_order.user_id = v_thread.participant_user_id)
      or (v_thread.company_id is not null and v_order.company_id = v_thread.company_id)
    ) then
      raise exception 'support_order_thread_mismatch';
    end if;
  end if;

  if p_ticket_id is not null then
    select * into v_ticket from public.support_tickets
     where id = p_ticket_id for update;
    if not found then raise exception 'support_ticket_not_found'; end if;
    if v_ticket.thread_id is distinct from v_thread.id then
      raise exception 'support_ticket_thread_mismatch';
    end if;
    if p_order_id is not null and v_ticket.primary_order_id is not null
       and v_ticket.primary_order_id is distinct from p_order_id then
      raise exception 'support_ticket_order_mismatch';
    end if;
  elsif p_start_ticket is null or (p_start_ticket is false and v_contract_version = 1) then
    -- Contract v1 has no episode-selection intent. Under the thread lock it
    -- may use exactly one ticket (resolved included), or create ticket one
    -- for a fresh thread; it can never select or create ticket two.
    select count(*) into v_ticket_count from public.support_tickets
     where thread_id = v_thread.id;
    if v_ticket_count > 1 then raise exception 'support_ticket_legacy_ambiguity'; end if;
    if v_ticket_count = 1 then
      select * into v_ticket from public.support_tickets
       where thread_id = v_thread.id order by created_at asc, id asc limit 1 for update;
    else
      v_subject := coalesce(nullif(v_subject, ''), 'Support request');
      if char_length(v_subject) > 200 then raise exception 'invalid_support_ticket_subject'; end if;
      insert into public.support_tickets (
        thread_id, subject, category, primary_order_id, status, priority
      ) values (
        v_thread.id, v_subject, v_category, p_order_id, 'open', 'normal'
      ) returning * into v_ticket;
      insert into public.support_ticket_events (
        ticket_id, idempotency_key, event_type, to_value, detail
      ) values (
        v_ticket.id, 'ticket-created/' || v_ticket.id::text, 'created', v_ticket.status,
        jsonb_build_object('source', 'resolve_support_ticket_v1', 'thread_id', v_thread.id)
      );
    end if;
  elsif p_start_ticket then
    if v_subject = '' or char_length(v_subject) > 200 then
      raise exception 'invalid_support_ticket_subject';
    end if;
    insert into public.support_tickets (
      thread_id, subject, category, primary_order_id, status, priority
    ) values (
      v_thread.id, v_subject, v_category, p_order_id, 'open', 'normal'
    ) returning * into v_ticket;
    insert into public.support_ticket_events (
      ticket_id, idempotency_key, event_type, to_value, detail
    ) values (
      v_ticket.id, 'ticket-created/' || v_ticket.id::text, 'created', v_ticket.status,
      jsonb_build_object('source', 'resolve_support_ticket', 'thread_id', v_thread.id)
    );
  else
    select * into v_ticket from public.support_tickets
     where thread_id = v_thread.id and status <> 'resolved'
     order by updated_at desc, id desc limit 1 for update;
    if not found then
      v_subject := coalesce(nullif(v_subject, ''), 'Support request');
      if char_length(v_subject) > 200 then raise exception 'invalid_support_ticket_subject'; end if;
      insert into public.support_tickets (
        thread_id, subject, category, primary_order_id, status, priority
      ) values (
        v_thread.id, v_subject, v_category, p_order_id, 'open', 'normal'
      ) returning * into v_ticket;
      insert into public.support_ticket_events (
        ticket_id, idempotency_key, event_type, to_value, detail
      ) values (
        v_ticket.id, 'ticket-created/' || v_ticket.id::text, 'created', v_ticket.status,
        jsonb_build_object('source', 'resolve_support_ticket', 'thread_id', v_thread.id)
      );
    end if;
  end if;

  return query select v_thread.id, v_thread.participant_user_id, v_thread.company_id,
    v_ticket.id, v_ticket.ticket_number, v_ticket.subject, v_ticket.status,
    v_ticket.priority, v_ticket.category, v_ticket.version;
end;
$$;

revoke all on function public.resolve_support_ticket(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, boolean
) from public, anon, authenticated, service_role;

drop function if exists public.append_support_message(
  uuid, uuid, text, text, uuid, text, boolean, uuid, uuid
);
drop function if exists public.append_support_message(
  uuid, uuid, text, text, uuid, text, boolean, uuid, uuid, uuid, uuid, text, text, boolean
);
drop function if exists public.append_support_message(
  uuid, uuid, text, text, uuid, text, boolean, uuid, uuid, uuid, uuid, text, text, boolean, integer
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
  p_thread_user_id uuid default null,
  p_thread_id uuid default null,
  p_ticket_id uuid default null,
  p_subject text default null,
  p_category text default 'general',
  p_start_ticket boolean default false,
  p_contract_version integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resolution record;
  v_thread public.support_threads%rowtype;
  v_ticket public.support_tickets%rowtype;
  v_message public.messages%rowtype;
  v_profile public.profiles%rowtype;
  v_company public.companies%rowtype;
  v_previous_sender text;
  v_body text := btrim(coalesce(p_body, ''));
  v_source text := btrim(coalesce(p_source, ''));
  v_subject text;
  v_thread_user_id uuid := coalesce(p_thread_user_id, p_user_id, p_recipient_user_id);
  v_contract_version integer;
  v_reopen boolean;
begin
  if p_sender_role not in ('buyer', 'staff') or v_body = '' or char_length(v_body) > 4000
     or v_source = '' or char_length(v_source) > 64 then
    raise exception 'invalid_support_message';
  end if;
  if p_contract_version is null or p_contract_version not in (1, 2) then
    raise exception 'invalid_support_message_contract_version';
  end if;
  if p_contract_version = 1 and (p_start_ticket or p_ticket_id is not null) then
    raise exception 'support_ticket_v1_routing_forbidden';
  end if;
  select version into v_contract_version from public.support_ticket_routing_contract
   where singleton = true for share;
  if v_contract_version = 1 and p_start_ticket and p_ticket_id is null then
    raise exception 'support_ticket_routing_not_enabled';
  elsif p_contract_version = 1 and v_contract_version = 2 then
    raise exception 'support_ticket_v1_contract_retired';
  end if;
  if p_sender_role = 'buyer' and (
    p_user_id is null or p_user_id is distinct from v_thread_user_id or p_recipient_user_id is not null
  ) then raise exception 'support_user_thread_mismatch'; end if;
  if p_sender_role = 'staff' and p_recipient_user_id is distinct from v_thread_user_id then
    raise exception 'support_recipient_thread_mismatch';
  end if;
  if v_thread_user_id is null and (p_sender_role <> 'staff' or p_company_id is null) then
    raise exception 'support_thread_user_required';
  end if;

  select left(line, 120) into v_subject
    from regexp_split_to_table(v_body, E'\r\n|\r|\n') line
   where btrim(line) <> ''
   limit 1;

  select * into v_resolution from public.resolve_support_ticket(
    p_thread_id, p_ticket_id,
    case when p_sender_role = 'buyer' then p_user_id else null end,
    case when p_thread_id is not null then null else v_thread_user_id end,
    p_company_id, p_order_id,
    coalesce(p_subject, v_subject), p_category,
    case when p_contract_version = 1 then null else p_start_ticket end
  );
  select * into v_thread from public.support_threads where id = v_resolution.thread_id;
  select * into v_ticket from public.support_tickets where id = v_resolution.ticket_id;
  if p_sender_role = 'staff'
     and p_recipient_user_id is distinct from v_thread.participant_user_id then
    raise exception 'support_recipient_thread_mismatch';
  end if;
  if v_thread.participant_user_id is not null then
    select * into v_profile from public.profiles where id = v_thread.participant_user_id;
  end if;
  if v_thread.company_id is not null then
    select * into v_company from public.companies where id = v_thread.company_id;
  end if;

  select sender_role::text into v_previous_sender from public.messages
   where ticket_id = v_ticket.id order by created_at desc, id desc limit 1;
  insert into public.messages (
    thread_id, ticket_id, company_id, user_id, recipient_user_id, sender_role, body,
    order_id, source, read_by_staff, read_by_user
  ) values (
    v_thread.id, v_ticket.id, v_thread.company_id,
    case when p_sender_role = 'buyer' then p_user_id else null end,
    case when p_sender_role = 'staff' then p_recipient_user_id else null end,
    p_sender_role::public.message_sender, v_body, p_order_id, v_source,
    p_sender_role = 'staff', p_sender_role = 'buyer'
  ) returning * into v_message;

  -- Buyer replies always reopen their exact episode. The explicit legacy
  -- start-thread signal remains a compatible staff reopen without becoming
  -- distinct-ticket creation intent.
  v_reopen := v_resolution.ticket_status = 'resolved' and (
    p_sender_role = 'buyer'
    or coalesce(p_reopen, false)
  );
  update public.support_tickets set
    status = case when v_reopen then 'open' else status end,
    resolved_at = case when v_reopen then null else resolved_at end,
    first_response_at = case when p_sender_role = 'staff' then coalesce(first_response_at, v_message.created_at) else first_response_at end,
    last_message_at = case
      when last_message_at is null or last_message_at <= v_message.created_at then v_message.created_at
      else last_message_at end,
    last_message_body = case
      when last_message_at is null or last_message_at <= v_message.created_at then left(v_message.body, 500)
      else last_message_body end,
    last_sender_role = case
      when last_message_at is null or last_message_at <= v_message.created_at then p_sender_role
      else last_sender_role end,
    updated_at = greatest(updated_at, v_message.created_at, now()), version = version + 1
  where id = v_ticket.id returning * into v_ticket;
  if v_reopen then
    insert into public.support_ticket_events (ticket_id, idempotency_key, event_type, from_value, to_value, detail)
    values (v_ticket.id, 'ticket-reopened/' || v_message.id::text, 'status_changed', 'resolved', 'open',
      jsonb_build_object('source', v_source, 'message_id', v_message.id));
  end if;

  return jsonb_build_object(
    'id', v_message.id, 'created_at', v_message.created_at,
    'thread_id', v_message.thread_id, 'thread_user_id', v_thread.participant_user_id,
    'company_id', v_message.company_id, 'user_id', v_message.user_id,
    'recipient_user_id', v_message.recipient_user_id, 'order_id', v_message.order_id,
    'sender_role', v_message.sender_role, 'body', v_message.body, 'source', v_message.source,
    'previous_sender_role', v_previous_sender, 'company_name', v_company.name,
    'customer_name', v_profile.full_name,
    'prior_thread_status', case when v_resolution.ticket_status = 'resolved' then 'complete' else 'open' end,
    'prior_ticket_status', v_resolution.ticket_status, 'ticket_id', v_ticket.id,
    'ticket_number', v_ticket.ticket_number, 'ticket_status', v_ticket.status,
    'ticket', to_jsonb(v_ticket)
  );
end;
$$;

revoke all on function public.append_support_message(
  uuid, uuid, text, text, uuid, text, boolean, uuid, uuid, uuid, uuid, text, text, boolean, integer
) from public, anon, authenticated;
grant execute on function public.append_support_message(
  uuid, uuid, text, text, uuid, text, boolean, uuid, uuid, uuid, uuid, text, text, boolean, integer
) to service_role;

drop function if exists public.upsert_email_inbound_message(
  uuid, uuid, text, text, text, uuid, uuid, text, uuid
);
drop function if exists public.upsert_email_inbound_message(
  uuid, uuid, text, text, text, uuid, uuid, text, uuid, uuid
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
  p_thread_id uuid default null,
  p_ticket_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resolution record;
  v_thread public.support_threads%rowtype;
  v_ticket public.support_tickets%rowtype;
  v_message public.messages%rowtype;
  v_company public.companies%rowtype;
  v_profile public.profiles%rowtype;
  v_previous_sender text;
  v_alert_kind text;
  v_inserted boolean := false;
  v_contract_version integer;
begin
  if p_sender_role not in ('buyer', 'staff') or btrim(coalesce(p_external_message_id, '')) = ''
     or char_length(p_external_message_id) > 512 or btrim(coalesce(p_body, '')) = ''
     or char_length(p_body) > 4000 then raise exception 'invalid_email_inbound_message'; end if;
  if p_email_references is not null and (
    char_length(p_email_references) > 8192
    or p_email_references !~ '^(<[^<>[:space:]]{1,255}[^<>[:space:]]{0,255}>)([[:space:]]+<[^<>[:space:]]{1,255}[^<>[:space:]]{0,255}>)*$'
  ) then raise exception 'invalid_email_inbound_references'; end if;
  select version into v_contract_version from public.support_ticket_routing_contract
   where singleton = true for share;
  if p_ticket_id is null and v_contract_version = 2 then
    raise exception 'email_inbound_ticket_required';
  end if;

  begin
    select * into v_resolution from public.resolve_support_ticket(
      p_thread_id, p_ticket_id, case when p_sender_role = 'buyer' then p_user_id else null end,
      case when p_thread_id is null then coalesce(p_user_id, p_recipient_user_id) else null end,
      p_company_id, p_order_id, null, 'general',
      case when p_ticket_id is null then null else false end
    );
  exception when raise_exception then
    if sqlerrm = 'support_ticket_legacy_ambiguity' then
      raise exception 'email_inbound_ticket_required';
    end if;
    raise;
  end;
  select * into v_thread from public.support_threads where id = v_resolution.thread_id;
  select * into v_ticket from public.support_tickets where id = v_resolution.ticket_id;
  if p_sender_role = 'buyer' and (
    p_user_id is null
    or (v_thread.participant_user_id is not null
      and p_user_id is distinct from v_thread.participant_user_id)
    or (v_thread.participant_user_id is null and not exists (
      select 1 from public.profiles profile
       where profile.id = p_user_id and profile.company_id = v_thread.company_id
    ))
  ) then raise exception 'email_inbound_user_thread_mismatch'; end if;
  if p_sender_role = 'staff' and (
    v_thread.participant_user_id is null
    or p_recipient_user_id is distinct from v_thread.participant_user_id
  ) then
    raise exception 'email_inbound_recipient_thread_mismatch';
  end if;
  if v_thread.company_id is not null then
    select * into v_company from public.companies where id = v_thread.company_id;
  end if;
  if v_thread.participant_user_id is not null then
    select * into v_profile from public.profiles where id = v_thread.participant_user_id;
  end if;

  select * into v_message from public.messages
   where source = 'email_reply' and external_message_id = p_external_message_id for update;
  if not found then
    select sender_role::text into v_previous_sender from public.messages
     where ticket_id = v_ticket.id order by created_at desc, id desc limit 1;
    v_alert_kind := case when p_sender_role = 'buyer' then case
      when v_previous_sender is null or v_resolution.ticket_status = 'resolved'
        then 'support_request'
      else 'message'
    end else null end;
    insert into public.messages (
      thread_id, ticket_id, company_id, user_id, recipient_user_id, sender_role, body,
      order_id, source, external_message_id, external_alert_kind,
      email_references, read_by_user, read_by_staff
    ) values (
      v_thread.id, v_ticket.id, v_thread.company_id,
      case when p_sender_role = 'buyer' then p_user_id else null end,
      case when p_sender_role = 'staff' then p_recipient_user_id else null end,
      p_sender_role::public.message_sender, btrim(p_body), p_order_id, 'email_reply',
      p_external_message_id, v_alert_kind, p_email_references,
      p_sender_role = 'buyer', p_sender_role = 'staff'
    ) on conflict do nothing returning * into v_message;
    v_inserted := found;
    if not found then
      select * into v_message from public.messages
       where source = 'email_reply' and external_message_id = p_external_message_id for update;
    end if;
  end if;
  if v_message.id is null or v_message.thread_id is distinct from v_thread.id
     or v_message.ticket_id is distinct from v_ticket.id
     or v_message.sender_role::text is distinct from p_sender_role
     or v_message.order_id is distinct from p_order_id
     or (p_sender_role = 'buyer' and v_message.user_id is distinct from p_user_id)
     or (p_sender_role = 'staff' and v_message.recipient_user_id is distinct from p_recipient_user_id) then
    raise exception 'email_inbound_message_identity_collision';
  end if;
  if v_previous_sender is null then
    select sender_role::text into v_previous_sender from public.messages
     where ticket_id = v_ticket.id
       and id <> v_message.id
       and created_at <= v_message.created_at
     order by created_at desc, id desc limit 1;
  end if;
  v_alert_kind := case when v_message.sender_role::text = 'buyer' then
    coalesce(v_message.external_alert_kind, case
      when v_previous_sender is null then 'support_request' else 'message' end)
    else null end;
  if v_inserted then
    update public.support_tickets set
      status = case
        when p_sender_role = 'buyer' and v_resolution.ticket_status = 'resolved' then 'open'
        else status end,
      resolved_at = case
        when p_sender_role = 'buyer' and v_resolution.ticket_status = 'resolved' then null
        else resolved_at end,
      first_response_at = case when p_sender_role = 'staff' then coalesce(first_response_at, v_message.created_at) else first_response_at end,
      last_message_at = case
        when last_message_at is null or last_message_at <= v_message.created_at then v_message.created_at
        else last_message_at end,
      last_message_body = case
        when last_message_at is null or last_message_at <= v_message.created_at then left(v_message.body, 500)
        else last_message_body end,
      last_sender_role = case
        when last_message_at is null or last_message_at <= v_message.created_at then p_sender_role
        else last_sender_role end,
      updated_at = greatest(updated_at, v_message.created_at, now()), version = version + 1
    where id = v_ticket.id returning * into v_ticket;
    if p_sender_role = 'buyer' and v_resolution.ticket_status = 'resolved' then
      insert into public.support_ticket_events (
        ticket_id, idempotency_key, event_type, from_value, to_value, detail
      ) values (
        v_ticket.id, 'ticket-reopened/' || v_message.id::text, 'status_changed',
        'resolved', 'open',
        jsonb_build_object('source', 'email_reply', 'message_id', v_message.id)
      );
    end if;
  else
    -- A response-loss retry must return the state committed by the original
    -- insert, not the pre-conflict ticket snapshot held by this invocation.
    select * into v_ticket from public.support_tickets
     where id = v_message.ticket_id;
  end if;
  return jsonb_build_object(
    'id', v_message.id, 'message_id', v_message.id, 'created_at', v_message.created_at,
    'thread_id', v_message.thread_id, 'thread_user_id', v_thread.participant_user_id,
    'company_id', v_message.company_id,
    'user_id', v_message.user_id, 'recipient_user_id', v_message.recipient_user_id,
    'sender_role', v_message.sender_role, 'body', v_message.body, 'order_id', v_message.order_id,
    'email_delivery_id', v_message.email_delivery_id,
    'email_message_id', v_message.email_message_id,
    'email_references', v_message.email_references, 'inserted', v_inserted,
    'previous_sender_role', v_previous_sender, 'ticket_id', v_ticket.id,
    'prior_thread_status', case when v_resolution.ticket_status = 'resolved' then 'complete' else 'open' end,
    'prior_ticket_status', v_resolution.ticket_status, 'alert_kind', v_alert_kind,
    'company_name', v_company.name, 'customer_name', v_profile.full_name,
    'ticket_number', v_ticket.ticket_number, 'ticket_status', v_ticket.status,
    'ticket', to_jsonb(v_ticket)
  );
end;
$$;

revoke all on function public.upsert_email_inbound_message(
  uuid, uuid, text, text, text, uuid, uuid, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.upsert_email_inbound_message(
  uuid, uuid, text, text, text, uuid, uuid, text, uuid, uuid
) to service_role;

drop function if exists public.create_order_support_request(uuid, text, text, jsonb, uuid, text, text);
drop function if exists public.create_order_support_request(uuid, text, text, jsonb, uuid, text, text, integer);

create or replace function public.create_order_support_request(
  p_order_id uuid,
  p_type text,
  p_reason text,
  p_line_items jsonb,
  p_requested_by uuid,
  p_requested_email text,
  p_message_body text,
  p_contract_version integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_request public.order_requests%rowtype;
  v_ticket public.support_tickets%rowtype;
  v_message jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_can_message boolean := false;
  v_contract_version integer;
begin
  if p_order_id is null or p_type not in ('cancel', 'return') or char_length(v_reason) < 8
     or char_length(v_reason) > 1000 or p_requested_by is null
     or jsonb_typeof(coalesce(p_line_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_line_items, '[]'::jsonb)) > 50 then
    raise exception 'invalid_order_support_request';
  end if;
  if p_contract_version is null or p_contract_version not in (1, 2) then
    raise exception 'invalid_order_support_request_contract_version';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  select version into v_contract_version from public.support_ticket_routing_contract
   where singleton = true for share;
  if p_contract_version = 1 and v_contract_version = 2 then
    raise exception 'support_ticket_v1_contract_retired';
  end if;
  v_can_message := v_order.user_id = p_requested_by or (v_order.company_id is not null and exists (
    select 1 from public.profiles where id = p_requested_by and company_id = v_order.company_id
  ));
  if not v_can_message then raise exception 'order_support_requester_mismatch'; end if;
  insert into public.order_requests (
    order_id, type, reason, line_items, requested_by, requested_email, ticket_id
  ) values (
    p_order_id, p_type, v_reason, coalesce(p_line_items, '[]'::jsonb), p_requested_by,
    nullif(left(btrim(coalesce(p_requested_email, '')), 320), ''), null
  ) on conflict (order_id, type) where status = 'open' do nothing returning * into v_request;
  if not found then
    select * into v_request from public.order_requests
     where order_id = p_order_id and type = p_type and status = 'open'
     order by created_at desc limit 1 for update;
    if v_request.ticket_id is not null and v_request.requested_by is not distinct from p_requested_by then
      select ticket.* into v_ticket
        from public.support_tickets ticket
        join public.support_threads thread on thread.id = ticket.thread_id
       where ticket.id = v_request.ticket_id
         and thread.participant_user_id = p_requested_by
         and (
           v_order.user_id = p_requested_by
           or (v_order.company_id is not null and thread.company_id = v_order.company_id)
         );
    end if;
    if v_ticket.id is null then
      return jsonb_build_object('duplicate', true, 'request', to_jsonb(v_request), 'message', null,
        'chat_linked', false, 'ticket_id', null, 'ticket', null,
        'ticket_mapping_state', 'unknown_legacy',
        'ticket_mapping_limit', 'No provable original ticket mapping exists for this duplicate request.');
    end if;
    return jsonb_build_object('duplicate', true, 'request', to_jsonb(v_request), 'message', null,
      'chat_linked', true, 'ticket_id', v_ticket.id, 'ticket_number', v_ticket.ticket_number,
      'ticket_status', v_ticket.status, 'ticket', to_jsonb(v_ticket), 'ticket_mapping_state', 'exact');
  end if;
  v_message := public.append_support_message(
    case when v_order.user_id = p_requested_by then null else v_order.company_id end,
    p_requested_by, 'buyer', p_message_body, p_order_id, 'order_request', true, null,
    p_requested_by, null, null, initcap(p_type) || ' request', 'order',
    v_contract_version = 2, p_contract_version
  );
  update public.order_requests
     set ticket_id = (v_message ->> 'ticket_id')::uuid
   where id = v_request.id
   returning * into v_request;
  return jsonb_build_object('duplicate', false, 'request', to_jsonb(v_request), 'message', v_message,
    'chat_linked', true, 'ticket_id', v_message ->> 'ticket_id',
    'ticket_number', v_message -> 'ticket' ->> 'ticket_number',
    'ticket_status', v_message -> 'ticket' ->> 'status', 'ticket', v_message -> 'ticket',
    'ticket_mapping_state', 'exact');
end;
$$;

revoke all on function public.create_order_support_request(uuid, text, text, jsonb, uuid, text, text, integer)
from public, anon, authenticated;
grant execute on function public.create_order_support_request(uuid, text, text, jsonb, uuid, text, text, integer)
to service_role;

drop function if exists public.update_support_ticket(uuid, integer, uuid, text, text);

create or replace function public.update_support_ticket(
  p_ticket_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_status text default null,
  p_priority text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_thread_id uuid;
  v_thread public.support_threads%rowtype;
  v_ticket public.support_tickets%rowtype;
  v_before_status text;
  v_before_priority text;
begin
  if p_ticket_id is null or p_expected_version is null or p_expected_version < 1 or p_actor_id is null
     or (p_status is null and p_priority is null)
     or (p_status is not null and p_status not in ('open', 'waiting_on_customer', 'resolved'))
     or (p_priority is not null and p_priority not in ('normal', 'high', 'urgent')) then
    raise exception 'invalid_support_ticket_update';
  end if;
  -- Read the parent identity without a ticket lock, then take the canonical
  -- thread lock before locking the ticket itself.
  select thread_id into v_thread_id from public.support_tickets where id = p_ticket_id;
  if not found then raise exception 'support_ticket_not_found'; end if;
  select * into v_thread from public.support_threads where id = v_thread_id for update;
  if not found then raise exception 'support_ticket_not_found'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'support_ticket_not_found'; end if;
  if v_ticket.version <> p_expected_version then raise exception 'ticket_version_conflict'; end if;
  v_before_status := v_ticket.status;
  v_before_priority := v_ticket.priority;
  update public.support_tickets set
    status = coalesce(p_status, status), priority = coalesce(p_priority, priority),
    resolved_at = case
      when coalesce(p_status, status) = 'resolved' then coalesce(resolved_at, now())
      when p_status is not null then null else resolved_at end,
    updated_at = now(), version = version + 1
  where id = v_ticket.id returning * into v_ticket;
  if v_before_status is distinct from v_ticket.status then
    insert into public.support_ticket_events (ticket_id, idempotency_key, actor_id, event_type, from_value, to_value)
    values (v_ticket.id, 'ticket-update/' || v_ticket.id::text || '/' || v_ticket.version::text || '/status',
      p_actor_id, 'status_changed', v_before_status, v_ticket.status);
  end if;
  if v_before_priority is distinct from v_ticket.priority then
    insert into public.support_ticket_events (ticket_id, idempotency_key, actor_id, event_type, from_value, to_value)
    values (v_ticket.id, 'ticket-update/' || v_ticket.id::text || '/' || v_ticket.version::text || '/priority',
      p_actor_id, 'priority_changed', v_before_priority, v_ticket.priority);
  end if;
  return to_jsonb(v_ticket);
end;
$$;

revoke all on function public.update_support_ticket(uuid, integer, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.update_support_ticket(uuid, integer, uuid, text, text) to service_role;

create or replace function public.deliver_quote_message_effect(
  p_effect_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_effect public.integration_effects%rowtype;
  v_company_id uuid;
  v_quote_id uuid;
  v_message jsonb;
  v_result jsonb;
  v_contract_version integer;
begin
  select * into v_effect from public.integration_effects where id = p_effect_id for update;
  if not found or v_effect.status <> 'processing' or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'quote_message' then raise exception 'invalid_quote_message_effect_lease'; end if;
  if v_effect.provider_succeeded_at is not null then return coalesce(v_effect.provider_result, '{}'::jsonb); end if;
  begin
    v_company_id := nullif(v_effect.payload ->> 'company_id', '')::uuid;
    v_quote_id := nullif(v_effect.payload ->> 'quote_id', '')::uuid;
  exception when invalid_text_representation then raise exception 'invalid_quote_message_effect'; end;
  if v_company_id is null or v_quote_id is null or not exists (
    select 1 from public.quotes where id = v_quote_id and payload ->> 'company_id' = v_company_id::text
  ) then raise exception 'invalid_quote_message_effect'; end if;
  select version into v_contract_version from public.support_ticket_routing_contract
   where singleton = true for share;
  v_message := public.append_support_message(
    v_company_id, null, 'staff',
    'Your requested pricing is ready to review and accept in the Orders workspace.',
    null, 'quote_offer', false, null, null, null, null, 'Quote ready', 'product', false, v_contract_version
  );
  v_result := jsonb_build_object('message_id', v_message ->> 'id', 'quote_id', v_quote_id,
    'inserted', true, 'ticket_id', v_message ->> 'ticket_id',
    'ticket_number', v_message -> 'ticket' ->> 'ticket_number',
    'ticket_status', v_message -> 'ticket' ->> 'status', 'ticket', v_message -> 'ticket');
  return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
end;
$$;

revoke all on function public.deliver_quote_message_effect(uuid, text)
from public, anon, authenticated;
grant execute on function public.deliver_quote_message_effect(uuid, text) to service_role;

create or replace function public.activate_support_ticket_routing(
  p_expected_version integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract public.support_ticket_routing_contract%rowtype;
begin
  if p_expected_version is distinct from 1 then
    raise exception 'invalid_support_ticket_routing_activation';
  end if;
  select * into v_contract from public.support_ticket_routing_contract
   where singleton = true for update;
  if v_contract.version <> p_expected_version then
    raise exception 'support_ticket_routing_version_conflict';
  end if;
  update public.support_ticket_routing_contract
     set version = 2, updated_at = now() where singleton = true
     returning * into v_contract;
  return jsonb_build_object('version', v_contract.version, 'updated_at', v_contract.updated_at);
end;
$$;

revoke all on function public.activate_support_ticket_routing(integer)
from public, anon, authenticated;
grant execute on function public.activate_support_ticket_routing(integer) to service_role;

notify pgrst, 'reload schema';

commit;
