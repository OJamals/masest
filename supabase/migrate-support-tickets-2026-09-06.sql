-- Add independently managed support-work episodes beneath canonical support
-- threads. Runtime message routing remains thread-owned until its later cutover.
-- Additive/idempotent. Apply after migrate-support-participant-threads-2026-09-03.sql.

begin;

create table if not exists public.support_tickets (
  id                  uuid primary key default gen_random_uuid(),
  ticket_number       bigint generated always as identity unique,
  thread_id           uuid not null references public.support_threads(id) on delete cascade,
  subject             text not null,
  status              text not null default 'open',
  priority            text not null default 'normal',
  category            text not null default 'general',
  assigned_to         uuid references public.profiles(id) on delete set null,
  primary_order_id    uuid references public.orders(id) on delete set null,
  first_response_at   timestamptz,
  resolved_at         timestamptz,
  last_message_at     timestamptz,
  last_message_body   text,
  last_sender_role    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1 check (version >= 1),
  constraint support_tickets_id_thread_unique unique (id, thread_id),
  constraint support_tickets_number_positive check (ticket_number >= 1),
  constraint support_tickets_subject_check check (
    subject = btrim(subject) and char_length(subject) between 1 and 200
  ),
  constraint support_tickets_status_check check (
    status in ('open', 'waiting_on_customer', 'resolved')
  ),
  constraint support_tickets_priority_check check (
    priority in ('normal', 'high', 'urgent')
  ),
  constraint support_tickets_category_check check (
    category in ('general', 'product', 'order', 'shipping', 'billing', 'account', 'technical')
  ),
  constraint support_tickets_resolution_check check (
    resolved_at is null or status = 'resolved'
  ),
  constraint support_tickets_first_response_check check (
    first_response_at is null or first_response_at >= created_at
  ),
  constraint support_tickets_updated_check check (updated_at >= created_at),
  constraint support_tickets_last_message_body_check check (
    last_message_body is null or char_length(last_message_body) <= 500
  ),
  constraint support_tickets_last_sender_check check (
    last_sender_role is null or last_sender_role in ('buyer', 'staff')
  )
);

create index if not exists support_tickets_thread_created_idx
  on public.support_tickets(thread_id, created_at desc, id desc);
create index if not exists support_tickets_status_message_idx
  on public.support_tickets(status, last_message_at desc, id desc);
create index if not exists support_tickets_assignee_status_idx
  on public.support_tickets(assigned_to, status, last_message_at desc, id desc);
create index if not exists support_tickets_primary_order_idx
  on public.support_tickets(primary_order_id)
  where primary_order_id is not null;

create table if not exists public.support_ticket_events (
  id                  uuid primary key default gen_random_uuid(),
  ticket_id           uuid not null references public.support_tickets(id) on delete cascade,
  idempotency_key     text not null unique,
  actor_id            uuid references public.profiles(id) on delete set null,
  event_type          text not null,
  from_value          text,
  to_value            text,
  detail              jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  constraint support_ticket_events_key_check check (
    idempotency_key = btrim(idempotency_key)
    and char_length(idempotency_key) between 1 and 200
  ),
  constraint support_ticket_events_type_check check (
    event_type in ('created', 'status_changed', 'priority_changed', 'category_changed', 'assignment_changed', 'private_note_added')
  ),
  constraint support_ticket_events_from_check check (
    from_value is null or char_length(from_value) <= 200
  ),
  constraint support_ticket_events_to_check check (
    to_value is null or char_length(to_value) <= 200
  ),
  constraint support_ticket_events_detail_check check (
    jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 16384
  )
);

create index if not exists support_ticket_events_ticket_created_idx
  on public.support_ticket_events(ticket_id, created_at desc, id desc);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_events enable row level security;

-- Buyer access is API-mediated. Event DML is append-only for service_role;
-- deleting a parent thread for explicit account erasure still cascades its
-- tickets and private events rather than leaving undeletable personal data.
revoke all on public.support_tickets, public.support_ticket_events
  from public, anon, authenticated, service_role;
grant select, insert, update on public.support_tickets to service_role;
grant select, insert on public.support_ticket_events to service_role;

revoke all on sequence public.support_tickets_ticket_number_seq
  from public, anon, authenticated, service_role;
grant usage, select on sequence public.support_tickets_ticket_number_seq to service_role;

alter table public.messages
  add column if not exists ticket_id uuid;

create index if not exists messages_ticket_idx
  on public.messages(ticket_id, created_at desc, id desc);

-- Stable legacy IDs must keep pointing at their original thread. A rerun may
-- encounter a managed ticket, but it must never silently reparent that ticket.
do $$
begin
  if exists (
    select 1
      from public.support_threads thread,
           public.support_tickets ticket
     where ticket.id = thread.id
       and ticket.thread_id is distinct from thread.id
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
  thread.id,
  thread.id,
  'Legacy support conversation',
  case
    when thread.status = 'complete' then 'resolved'
    else 'open'
  end,
  case
    when thread.status = 'escalated' then 'high'
    else 'normal'
  end,
  'general',
  thread.last_order_id,
  case
    when thread.status = 'complete'
      then thread.completed_at
    else null
  end,
  thread.last_message_at,
  left(thread.last_message_body, 500),
  thread.last_sender_role,
  thread.created_at,
  greatest(thread.created_at, thread.updated_at),
  1
from public.support_threads thread
where not exists (
  select 1 from public.support_tickets existing
  where existing.id = thread.id
);

-- Preserve every existing non-null assignment. Reject missing/cross-thread
-- linkage instead of replacing it with the legacy ticket.
do $$
begin
  if exists (
    select 1
      from public.messages message
      left join public.support_tickets ticket on ticket.id = message.ticket_id
     where message.ticket_id is not null
       and (
         ticket.id is null
         or ticket.thread_id is distinct from message.thread_id
       )
  ) then
    raise exception 'support_message_ticket_identity_collision';
  end if;
end;
$$;

-- The pair FK prevents either side from drifting. Column-list SET NULL keeps
-- required messages.thread_id intact if a ticket is explicitly removed, while
-- the existing thread deletion cascade still erases both messages and tickets.
do $$
declare
  v_constraint record;
begin
  select
    constraint_row.contype,
    constraint_row.confrelid,
    constraint_row.confmatchtype,
    constraint_row.confupdtype,
    constraint_row.confdeltype,
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
    ) as referenced_columns,
    array(
      select attribute.attname::text
        from unnest(coalesce(constraint_row.confdelsetcols, '{}'::smallint[]))
             with ordinality key_column(attnum, position)
        join pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key_column.attnum
       order by key_column.position
    ) as delete_set_columns
    into v_constraint
    from pg_constraint constraint_row
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_ticket_thread_fkey';

  if found and (
    v_constraint.contype <> 'f'
    or v_constraint.confrelid <> 'public.support_tickets'::regclass
    or v_constraint.confmatchtype <> 's'
    or v_constraint.confupdtype <> 'a'
    or v_constraint.confdeltype <> 'n'
    or v_constraint.convalidated is not true
    or v_constraint.key_columns <> array['ticket_id', 'thread_id']::text[]
    or v_constraint.referenced_columns <> array['id', 'thread_id']::text[]
    or v_constraint.delete_set_columns <> array['ticket_id']::text[]
  ) then
    raise exception 'support_message_ticket_constraint_collision';
  end if;

  if not found then
    alter table public.messages
      add constraint messages_ticket_thread_fkey
      foreign key (ticket_id, thread_id)
      references public.support_tickets(id, thread_id)
      match simple
      on update no action
      on delete set null (ticket_id);
  end if;
end;
$$;

update public.messages message
set ticket_id = message.thread_id
where message.ticket_id is null;

-- A legacy event key is an immutable identity, not a conflict to swallow.
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
  ticket_id, idempotency_key, actor_id, event_type,
  from_value, to_value, detail, created_at
)
select
  thread.id,
  'legacy-created/' || thread.id::text,
  null,
  'created',
  null,
  ticket.status,
  jsonb_build_object(
    'source', 'legacy_thread_backfill',
    'thread_id', thread.id
  ),
  ticket.created_at
from public.support_threads thread
join public.support_tickets ticket
  on ticket.id = thread.id and ticket.thread_id = thread.id
where not exists (
  select 1 from public.support_ticket_events existing
  where existing.idempotency_key = 'legacy-created/' || thread.id::text
);

-- Source-level tests pin this verification; real PostgreSQL execution remains
-- a separate release gate. Counts make partial legacy coverage fail closed.
do $$
declare
  v_thread_count bigint;
  v_ticket_count bigint;
  v_message_count bigint;
  v_linked_message_count bigint;
  v_event_count bigint;
begin
  select count(*) into v_thread_count from public.support_threads;
  select count(*) into v_ticket_count
    from public.support_threads thread
    join public.support_tickets ticket
      on ticket.id = thread.id and ticket.thread_id = thread.id;
  if v_ticket_count <> v_thread_count then
    raise exception 'legacy_support_ticket_missing';
  end if;

  select count(*) into v_message_count from public.messages;
  select count(*) into v_linked_message_count
    from public.messages message
    join public.support_tickets ticket
      on ticket.id = message.ticket_id
     and ticket.thread_id = message.thread_id;
  if v_linked_message_count <> v_message_count then
    raise exception 'support_message_ticket_backfill_incomplete';
  end if;

  select count(*) into v_event_count
    from public.support_threads thread
    join public.support_ticket_events event
      on event.idempotency_key = 'legacy-created/' || thread.id::text
     and event.ticket_id = thread.id
     and event.event_type = 'created';
  if v_event_count <> v_thread_count then
    raise exception 'legacy_support_ticket_event_missing';
  end if;
end;
$$;

commit;
