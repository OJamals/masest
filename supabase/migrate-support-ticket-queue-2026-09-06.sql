-- Paginated support-ticket queue and exact-ticket mutation contracts.
-- Apply only after migrate-support-message-delivery-effects-2026-09-06.sql.

begin;

create index if not exists support_tickets_queue_message_idx
  on public.support_tickets(last_message_at desc, id desc)
  where last_message_at is not null;
create index if not exists support_tickets_priority_message_idx
  on public.support_tickets(priority, last_message_at desc, id desc)
  where last_message_at is not null;
create index if not exists support_tickets_category_message_idx
  on public.support_tickets(category, last_message_at desc, id desc)
  where last_message_at is not null;

create or replace function public.support_ticket_matches_order(
  p_ticket_id uuid,
  p_primary_order_id uuid,
  p_order_id uuid
) returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select p_order_id is null
    or p_primary_order_id = p_order_id
    or (
      p_primary_order_id is null
      and exists (
        select 1
          from public.messages message
         where message.ticket_id = p_ticket_id
           and message.order_id = p_order_id
      )
    );
$$;

revoke all on function public.support_ticket_matches_order(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function public.select_active_support_ticket_id(
  p_thread_id uuid,
  p_order_id uuid default null
) returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select ticket.id
    from public.support_tickets ticket
   where ticket.thread_id = p_thread_id
     and ticket.status <> 'resolved'
     and public.support_ticket_matches_order(
       ticket.id, ticket.primary_order_id, p_order_id
     )
   order by ticket.updated_at desc, ticket.id desc
   limit 1;
$$;

revoke all on function public.select_active_support_ticket_id(uuid, uuid)
from public, anon, authenticated, service_role;

drop function if exists public.list_support_tickets(
  text, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid[],
  timestamptz, uuid, integer
);

create function public.list_support_tickets(
  p_queue text default 'needs_reply',
  p_assignee_mode text default null,
  p_assignee_id uuid default null,
  p_staff_id uuid default null,
  p_status text default null,
  p_priority text default null,
  p_category text default null,
  p_search text default null,
  p_company_id uuid default null,
  p_order_id uuid default null,
  p_thread_ids uuid[] default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_queue is null or p_queue not in (
    'all', 'active', 'needs_reply', 'mine', 'unassigned', 'waiting', 'resolved'
  ) then raise exception 'invalid_support_ticket_queue'; end if;
  if p_assignee_mode is not null and p_assignee_mode not in ('mine', 'unassigned', 'staff') then
    raise exception 'invalid_support_ticket_assignee_mode';
  end if;
  if p_assignee_mode = 'mine' and p_staff_id is null then
    raise exception 'invalid_support_ticket_staff_scope';
  end if;
  if p_assignee_mode = 'staff' and p_assignee_id is null then
    raise exception 'invalid_support_ticket_assignee';
  end if;
  if p_status is not null and p_status not in ('open', 'waiting_on_customer', 'resolved') then
    raise exception 'invalid_support_ticket_status';
  end if;
  if p_priority is not null and p_priority not in ('normal', 'high', 'urgent') then
    raise exception 'invalid_support_ticket_priority';
  end if;
  if p_category is not null and p_category not in (
    'general', 'product', 'order', 'shipping', 'billing', 'account', 'technical'
  ) then raise exception 'invalid_support_ticket_category'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_support_ticket_limit';
  end if;
  if (p_cursor_at is null) is distinct from (p_cursor_id is null) then
    raise exception 'invalid_support_ticket_cursor';
  end if;
  if p_search is not null and char_length(p_search) > 240 then
    raise exception 'invalid_support_ticket_search';
  end if;

  with common as (
    select
      ticket.*,
      case when thread.participant_user_id is null then 'company' else 'personal' end as scope,
      case when participant.id is null then null else jsonb_build_object(
        'id', participant.id,
        'name', participant.full_name
      ) end as participant,
      case when company.id is null then null else jsonb_build_object(
        'id', company.id,
        'name', company.name
      ) end as company,
      case when assignee.id is null then null else jsonb_build_object(
        'id', assignee.id,
        'name', assignee.full_name,
        'role', assignee.staff_role
      ) end as assignee,
      case when support_order.id is null then null else jsonb_build_object(
        'id', support_order.id,
        'reference', support_order.order_number,
        'status', support_order.status,
        'buyer_url', '/dashboard.html?order=' || support_order.id::text || '#orders',
        'admin_url', '/admin.html?order=' || support_order.id::text || '#orders'
      ) end as support_order
      from public.support_tickets ticket
      join public.support_threads thread on thread.id = ticket.thread_id
      left join public.profiles participant on participant.id = thread.participant_user_id
      left join public.companies company on company.id = thread.company_id
      left join public.profiles assignee on assignee.id = ticket.assigned_to
      left join public.orders support_order on support_order.id = ticket.primary_order_id
     where ticket.last_message_at is not null
       and (p_thread_ids is null or ticket.thread_id = any(p_thread_ids))
       and (p_priority is null or ticket.priority = p_priority)
       and (p_category is null or ticket.category = p_category)
       and (p_company_id is null or thread.company_id = p_company_id)
       and public.support_ticket_matches_order(
         ticket.id, ticket.primary_order_id, p_order_id
       )
       and (
         p_search is null or p_search = ''
         or ticket.subject ilike '%' || p_search || '%' escape '\'
         or ('MAS-' || lpad(ticket.ticket_number::text, 6, '0')) ilike '%' || p_search || '%' escape '\'
         or participant.full_name ilike '%' || p_search || '%' escape '\'
         or company.name ilike '%' || p_search || '%' escape '\'
         or support_order.order_number ilike '%' || p_search || '%' escape '\'
       )
  ), filtered as (
    select common.*
      from common
     where (p_status is null or common.status = p_status)
       and case p_assignee_mode
         when 'mine' then common.assigned_to = p_staff_id
         when 'unassigned' then common.assigned_to is null
         when 'staff' then common.assigned_to = p_assignee_id
         else true
       end
       and case p_queue
         when 'all' then true
         when 'active' then common.id = public.select_active_support_ticket_id(
           common.thread_id, p_order_id
         )
         when 'needs_reply' then common.status <> 'resolved' and common.last_sender_role = 'buyer'
         when 'mine' then common.status <> 'resolved' and common.assigned_to = p_staff_id
         when 'unassigned' then common.status <> 'resolved' and common.assigned_to is null
         when 'waiting' then common.status = 'waiting_on_customer'
         when 'resolved' then common.status = 'resolved'
       end
       and (
         p_cursor_at is null
         or common.last_message_at < p_cursor_at
         or (common.last_message_at = p_cursor_at and common.id < p_cursor_id)
       )
  ), page_plus as (
    select * from filtered
     order by last_message_at desc, id desc
     limit p_limit + 1
  ), page as (
    select * from page_plus
     order by last_message_at desc, id desc
     limit p_limit
  ), boundary as (
    select last_message_at, id from page
     order by last_message_at asc, id asc
     limit 1
  ), summary as (
    select jsonb_build_object(
      'open', count(*) filter (where status <> 'resolved'),
      'unanswered', count(*) filter (where status <> 'resolved' and last_sender_role = 'buyer'),
      'needs_reply', count(*) filter (where status <> 'resolved' and last_sender_role = 'buyer'),
      'mine', count(*) filter (where status <> 'resolved' and assigned_to = p_staff_id),
      'unassigned', count(*) filter (where status <> 'resolved' and assigned_to is null),
      'waiting', count(*) filter (where status = 'waiting_on_customer'),
      'resolved', count(*) filter (where status = 'resolved')
    ) as value from common
  )
  select jsonb_build_object(
    'tickets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'ticket_number', item.ticket_number,
        'thread_id', item.thread_id,
        'subject', item.subject,
        'status', item.status,
        'priority', item.priority,
        'category', item.category,
        'assigned_to', item.assigned_to,
        'assignee', item.assignee,
        'participant', item.participant,
        'company', item.company,
        'scope', item.scope,
        'primary_order_id', item.primary_order_id,
        'order', item.support_order,
        'first_response_at', item.first_response_at,
        'resolved_at', item.resolved_at,
        'last_message_at', item.last_message_at,
        'last_message_body', item.last_message_body,
        'last_sender_role', item.last_sender_role,
        'created_at', item.created_at,
        'updated_at', item.updated_at,
        'version', item.version
      ) order by item.last_message_at desc, item.id desc) from page item
    ), '[]'::jsonb),
    'summary', (select value from summary),
    'has_more', (select count(*) > p_limit from page_plus),
    'next_cursor', case when (select count(*) > p_limit from page_plus) then (
      select jsonb_build_object('timestamp', last_message_at, 'id', id) from boundary
    ) else null end
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.list_support_tickets(
  text, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid[],
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_support_tickets(
  text, text, uuid, uuid, text, text, text, text, uuid, uuid, uuid[],
  timestamptz, uuid, integer
) to service_role;

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
  v_selected_ticket_id uuid;
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

  if p_ticket_id is not null then
    select ticket.thread_id into v_exact_thread_id
      from public.support_tickets ticket where ticket.id = p_ticket_id;
    if not found then raise exception 'support_ticket_not_found'; end if;
  end if;

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
    v_selected_ticket_id := public.select_active_support_ticket_id(v_thread.id, p_order_id);
    if v_selected_ticket_id is not null then
      select * into v_ticket from public.support_tickets
       where id = v_selected_ticket_id for update;
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
  uuid, uuid, text, text, uuid, text, boolean, uuid, uuid, uuid, uuid,
  text, text, boolean, integer
);
drop function if exists public.append_support_message(
  uuid, uuid, text, text, uuid, text, boolean, uuid, uuid, uuid, uuid,
  text, text, boolean, integer, integer
);

create function public.append_support_message(
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
  p_contract_version integer default 1,
  p_expected_ticket_version integer default null
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
  v_prior_status text;
begin
  perform public.assert_support_writes_enabled();
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
  if p_expected_ticket_version is not null and (
    p_expected_ticket_version < 1 or p_sender_role <> 'staff' or p_ticket_id is null
  ) then raise exception 'invalid_support_ticket_reply_version'; end if;
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
  if p_expected_ticket_version is not null then
    if v_ticket.version <> p_expected_ticket_version then
      raise exception 'ticket_version_conflict';
    end if;
    if v_ticket.status = 'resolved' then
      raise exception 'support_ticket_reply_resolved';
    end if;
  end if;
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

  v_prior_status := v_ticket.status;
  update public.support_tickets set
    status = case
      when p_sender_role = 'buyer' and v_prior_status in ('waiting_on_customer', 'resolved') then 'open'
      when v_prior_status = 'resolved' and coalesce(p_reopen, false) then 'open'
      else status end,
    resolved_at = case
      when (p_sender_role = 'buyer' and v_prior_status in ('waiting_on_customer', 'resolved'))
        or (v_prior_status = 'resolved' and coalesce(p_reopen, false)) then null
      else resolved_at end,
    first_response_at = case when p_sender_role = 'staff'
      then coalesce(first_response_at, v_message.created_at) else first_response_at end,
    last_message_at = case
      when last_message_at is null or last_message_at <= v_message.created_at then v_message.created_at
      else last_message_at end,
    last_message_body = case
      when last_message_at is null or last_message_at <= v_message.created_at then left(v_message.body, 500)
      else last_message_body end,
    last_sender_role = case
      when last_message_at is null or last_message_at <= v_message.created_at then p_sender_role
      else last_sender_role end,
    updated_at = greatest(updated_at, v_message.created_at, now()),
    version = version + 1
  where id = v_ticket.id returning * into v_ticket;
  if v_prior_status is distinct from v_ticket.status then
    insert into public.support_ticket_events (
      ticket_id, idempotency_key, event_type, from_value, to_value, detail
    ) values (
      v_ticket.id,
      case when v_prior_status = 'resolved' then 'ticket-reopened/' else 'ticket-customer-replied/' end
        || v_message.id::text,
      'status_changed', v_prior_status, v_ticket.status,
      jsonb_build_object('source', v_source, 'message_id', v_message.id)
    );
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
  uuid, uuid, text, text, uuid, text, boolean, uuid, uuid, uuid, uuid,
  text, text, boolean, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.append_support_message(
  uuid, uuid, text, text, uuid, text, boolean, uuid, uuid, uuid, uuid,
  text, text, boolean, integer, integer
) to service_role;

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
  v_prior_status text;
begin
  perform public.assert_support_writes_enabled();
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
    v_prior_status := v_ticket.status;
    update public.support_tickets set
      status = case
        when p_sender_role = 'buyer' and v_prior_status in ('waiting_on_customer', 'resolved') then 'open'
        else status end,
      resolved_at = case
        when p_sender_role = 'buyer' and v_prior_status in ('waiting_on_customer', 'resolved') then null
        else resolved_at end,
      first_response_at = case when p_sender_role = 'staff'
        then coalesce(first_response_at, v_message.created_at) else first_response_at end,
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
    if v_prior_status is distinct from v_ticket.status then
      insert into public.support_ticket_events (
        ticket_id, idempotency_key, event_type, from_value, to_value, detail
      ) values (
        v_ticket.id,
        case when v_prior_status = 'resolved' then 'ticket-reopened/' else 'ticket-customer-replied/' end
          || v_message.id::text,
        'status_changed', v_prior_status, v_ticket.status,
        jsonb_build_object('source', 'email_reply', 'message_id', v_message.id)
      );
    end if;
  else
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
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_email_inbound_message(
  uuid, uuid, text, text, text, uuid, uuid, text, uuid, uuid
) to service_role;

drop function if exists public.update_support_ticket(uuid, integer, uuid, text, text);
drop function if exists public.update_support_ticket(uuid, integer, uuid, text, text, text, uuid, boolean);

create function public.update_support_ticket(
  p_ticket_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_status text default null,
  p_priority text default null,
  p_category text default null,
  p_assigned_to uuid default null,
  p_set_assigned_to boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_thread_id uuid;
  v_thread public.support_threads%rowtype;
  v_ticket public.support_tickets%rowtype;
  v_event_actor_id uuid;
  v_before_status text;
  v_before_priority text;
  v_before_category text;
  v_before_assigned_to uuid;
begin
  perform public.assert_support_writes_enabled();
  if p_ticket_id is null
     or p_expected_version is null
     or p_expected_version < 1
     or p_actor_id is null
     or p_set_assigned_to is null
     or (p_status is null and p_priority is null and p_category is null and not p_set_assigned_to)
     or (p_status is not null and p_status not in ('open', 'waiting_on_customer', 'resolved'))
     or (p_priority is not null and p_priority not in ('normal', 'high', 'urgent'))
     or (p_category is not null and p_category not in (
       'general', 'product', 'order', 'shipping', 'billing', 'account', 'technical'
     )) then
    raise exception 'invalid_support_ticket_update';
  end if;

  if p_set_assigned_to and p_assigned_to is not null and not exists (
    select 1
      from public.profiles profile
     where profile.id = p_assigned_to
       and profile.is_staff = true
       and profile.staff_role in ('owner', 'finance', 'support')
  ) then
    raise exception 'support_ticket_assignee_ineligible';
  end if;

  -- Environment-authorized operators need not be profile-backed. Preserve their
  -- mutation access while recording a nullable FK-safe event actor.
  select id into v_event_actor_id
    from public.profiles
   where id = p_actor_id;

  -- Preserve the canonical thread-before-ticket lock order shared with append.
  select thread_id into v_thread_id
    from public.support_tickets
   where id = p_ticket_id;
  if not found then raise exception 'support_ticket_not_found'; end if;

  select * into v_thread
    from public.support_threads
   where id = v_thread_id
   for update;
  if not found then raise exception 'support_ticket_not_found'; end if;

  select * into v_ticket
    from public.support_tickets
   where id = p_ticket_id
   for update;
  if not found then raise exception 'support_ticket_not_found'; end if;
  if v_ticket.version <> p_expected_version then
    raise exception 'ticket_version_conflict';
  end if;

  v_before_status := v_ticket.status;
  v_before_priority := v_ticket.priority;
  v_before_category := v_ticket.category;
  v_before_assigned_to := v_ticket.assigned_to;

  update public.support_tickets set
    status = coalesce(p_status, status),
    priority = coalesce(p_priority, priority),
    category = coalesce(p_category, category),
    assigned_to = case when p_set_assigned_to then p_assigned_to else assigned_to end,
    resolved_at = case
      when coalesce(p_status, status) = 'resolved' then coalesce(resolved_at, now())
      when p_status is not null then null
      else resolved_at
    end,
    updated_at = now(),
    version = version + 1
  where id = v_ticket.id
  returning * into v_ticket;

  if v_before_status is distinct from v_ticket.status then
    insert into public.support_ticket_events (
      ticket_id, idempotency_key, actor_id, event_type, from_value, to_value
    ) values (
      v_ticket.id,
      'ticket-update/' || v_ticket.id::text || '/' || v_ticket.version::text || '/status',
      v_event_actor_id,
      'status_changed',
      v_before_status,
      v_ticket.status
    );
  end if;
  if v_before_priority is distinct from v_ticket.priority then
    insert into public.support_ticket_events (
      ticket_id, idempotency_key, actor_id, event_type, from_value, to_value
    ) values (
      v_ticket.id,
      'ticket-update/' || v_ticket.id::text || '/' || v_ticket.version::text || '/priority',
      v_event_actor_id,
      'priority_changed',
      v_before_priority,
      v_ticket.priority
    );
  end if;
  if v_before_category is distinct from v_ticket.category then
    insert into public.support_ticket_events (
      ticket_id, idempotency_key, actor_id, event_type, from_value, to_value
    ) values (
      v_ticket.id,
      'ticket-update/' || v_ticket.id::text || '/' || v_ticket.version::text || '/category',
      v_event_actor_id,
      'category_changed',
      v_before_category,
      v_ticket.category
    );
  end if;
  if v_before_assigned_to is distinct from v_ticket.assigned_to then
    insert into public.support_ticket_events (
      ticket_id, idempotency_key, actor_id, event_type, from_value, to_value
    ) values (
      v_ticket.id,
      'ticket-update/' || v_ticket.id::text || '/' || v_ticket.version::text || '/assignment',
      v_event_actor_id,
      'assignment_changed',
      v_before_assigned_to::text,
      v_ticket.assigned_to::text
    );
  end if;

  return to_jsonb(v_ticket);
end;
$$;

revoke all on function public.update_support_ticket(
  uuid, integer, uuid, text, text, text, uuid, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.update_support_ticket(
  uuid, integer, uuid, text, text, text, uuid, boolean
) to service_role;

commit;
