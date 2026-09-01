-- One transactional support-message seam for buyer chat, staff replies, and order requests.
-- Additive/idempotent. Apply after schema-phase5.sql, schema-order-operations.sql, and
-- schema-support-message-order-ownership.sql.

begin;

alter table public.messages
  add column if not exists recipient_user_id uuid,
  add column if not exists email_delivery_id text,
  add column if not exists email_message_id text,
  add column if not exists email_references text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_recipient_user_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_recipient_user_id_fkey
      foreign key (recipient_user_id)
      references public.profiles (id)
      on delete set null;
  end if;
end $$;

create index if not exists messages_recipient_user_idx
  on public.messages (recipient_user_id, created_at desc)
  where recipient_user_id is not null;
create unique index if not exists messages_email_delivery_id_idx
  on public.messages (email_delivery_id)
  where email_delivery_id is not null;
create unique index if not exists messages_email_message_id_idx
  on public.messages (email_message_id)
  where email_message_id is not null;

alter table public.companies
  add column if not exists support_last_order_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_support_last_order_company_fkey'
  ) then
    alter table public.companies
      add constraint companies_support_last_order_company_fkey
      foreign key (support_last_order_id, id)
      references public.orders (id, company_id)
      on delete set null (support_last_order_id);
  end if;
end $$;

with latest as (
  select distinct on (company_id) company_id, order_id, created_at
  from public.messages
  order by company_id, created_at desc, id desc
)
update public.companies as company
set support_last_order_id = latest.order_id
from latest
where company.id = latest.company_id
  and company.support_last_message_at = latest.created_at
  and company.support_last_order_id is distinct from latest.order_id;

create index if not exists companies_support_last_order_idx
  on public.companies (support_last_order_id)
  where support_last_order_id is not null;

-- Every producer writes the same durable message stream. Own its denormalized Company
-- summary here so specialized email/quote ingestion cannot leave stale order context.
create or replace function public.project_support_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.companies
     set support_last_message_at = new.created_at,
         support_last_message_body = new.body,
         support_last_sender_role = new.sender_role::text,
         support_last_order_id = new.order_id
   where id = new.company_id
     and (support_last_message_at is null or support_last_message_at <= new.created_at);
  return new;
end;
$$;

revoke all on function public.project_support_message() from public;
revoke execute on function public.project_support_message() from anon, authenticated;

drop trigger if exists messages_project_support_thread on public.messages;
create trigger messages_project_support_thread
after insert on public.messages
for each row execute function public.project_support_message();

drop function if exists public.append_support_message(uuid, uuid, text, text, uuid, text, boolean);

create or replace function public.append_support_message(
  p_company_id uuid,
  p_user_id uuid,
  p_sender_role text,
  p_body text,
  p_order_id uuid default null,
  p_source text default 'dashboard',
  p_reopen boolean default null,
  p_recipient_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_message public.messages%rowtype;
  v_previous_sender text;
  v_body text := btrim(coalesce(p_body, ''));
  v_source text := btrim(coalesce(p_source, ''));
  v_reopen boolean;
begin
  if p_company_id is null
     or p_sender_role not in ('buyer', 'staff')
     or v_body = ''
     or char_length(v_body) > 4000
     or v_source = ''
     or char_length(v_source) > 64 then
    raise exception 'invalid_support_message';
  end if;

  select * into v_company
    from public.companies
   where id = p_company_id
   for update;
  if not found then
    raise exception 'support_company_not_found';
  end if;

  if p_sender_role = 'buyer' and (
    p_user_id is null or not exists (
      select 1
      from public.profiles
      where id = p_user_id
        and company_id = p_company_id
    )
  ) then
    raise exception 'support_user_company_mismatch';
  end if;

  if p_sender_role = 'staff' and (
    p_recipient_user_id is null or not exists (
      select 1
      from public.profiles
      where id = p_recipient_user_id
        and company_id = p_company_id
    )
  ) then
    raise exception 'support_recipient_company_mismatch';
  end if;

  if p_sender_role = 'buyer' and p_recipient_user_id is not null then
    raise exception 'support_buyer_recipient_invalid';
  end if;

  if p_order_id is not null and not exists (
    select 1
    from public.orders
    where id = p_order_id
      and company_id = p_company_id
  ) then
    raise exception 'support_order_company_mismatch';
  end if;

  select sender_role::text into v_previous_sender
    from public.messages
   where company_id = p_company_id
   order by created_at desc, id desc
   limit 1;

  insert into public.messages (
    company_id, user_id, recipient_user_id, sender_role, body, order_id, source,
    read_by_staff, read_by_user
  ) values (
    p_company_id,
    case when p_sender_role = 'buyer' then p_user_id else null end,
    case when p_sender_role = 'staff' then p_recipient_user_id else null end,
    p_sender_role::public.message_sender,
    v_body,
    p_order_id,
    v_source,
    p_sender_role = 'staff',
    p_sender_role = 'buyer'
  )
  returning * into v_message;

  v_reopen := coalesce(p_reopen, p_sender_role = 'buyer');
  if v_reopen then
    update public.companies
       set support_thread_status = 'open',
           support_thread_completed_at = null,
           support_thread_completed_by = null
     where id = p_company_id;
  end if;

  return jsonb_build_object(
    'id', v_message.id,
    'created_at', v_message.created_at,
    'company_id', v_message.company_id,
    'user_id', v_message.user_id,
    'recipient_user_id', v_message.recipient_user_id,
    'order_id', v_message.order_id,
    'sender_role', v_message.sender_role,
    'body', v_message.body,
    'source', v_message.source,
    'previous_sender_role', v_previous_sender,
    'prior_thread_status', v_company.support_thread_status,
    'company_name', v_company.name
  );
end;
$$;

revoke all on function public.append_support_message(uuid, uuid, text, text, uuid, text, boolean, uuid) from public;
revoke execute on function public.append_support_message(uuid, uuid, text, text, uuid, text, boolean, uuid) from anon, authenticated;
grant execute on function public.append_support_message(uuid, uuid, text, text, uuid, text, boolean, uuid) to service_role;

-- Email replies are another producer of the canonical support stream. This wrapper
-- adds provider identity/idempotency while preserving the same participant and order
-- ownership checks as dashboard messages.
drop function if exists public.upsert_resend_inbound_message(uuid, uuid, text, text);
drop function if exists public.upsert_resend_inbound_message(uuid, uuid, text, text, text, uuid, uuid);
drop function if exists public.upsert_email_inbound_message(uuid, uuid, text, text, text, uuid, uuid);

create or replace function public.upsert_email_inbound_message(
  p_company_id uuid,
  p_user_id uuid,
  p_external_message_id text,
  p_body text,
  p_sender_role text default 'buyer',
  p_recipient_user_id uuid default null,
  p_order_id uuid default null,
  p_email_references text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_message public.messages%rowtype;
  v_previous_sender text;
  v_alert_kind text;
  v_inserted boolean := false;
begin
  if p_company_id is null
     or p_sender_role not in ('buyer', 'staff')
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
  select * into v_company from public.companies where id = p_company_id for update;
  if not found then raise exception 'email_inbound_company_not_found'; end if;

  if p_sender_role = 'buyer' and (
    p_user_id is null or not exists (
      select 1 from public.profiles
       where id = p_user_id and company_id = p_company_id
    )
  ) then
    raise exception 'email_inbound_user_company_mismatch';
  end if;
  if p_sender_role = 'staff' and (
    p_recipient_user_id is null or not exists (
      select 1 from public.profiles
       where id = p_recipient_user_id and company_id = p_company_id
    )
  ) then
    raise exception 'email_inbound_recipient_company_mismatch';
  end if;
  if p_order_id is not null and not exists (
    select 1 from public.orders
     where id = p_order_id and company_id = p_company_id
  ) then
    raise exception 'email_inbound_order_company_mismatch';
  end if;

  select * into v_message
    from public.messages
   where source = 'email_reply' and external_message_id = p_external_message_id
   for update;
  if not found then
    select sender_role::text into v_previous_sender
      from public.messages
     where company_id = p_company_id
     order by created_at desc, id desc
     limit 1;
    v_alert_kind := case when p_sender_role = 'buyer' then case
      when v_previous_sender is null or v_company.support_thread_status = 'complete' then 'support_request'
      else 'message'
    end else null end;
    insert into public.messages (
      company_id, user_id, recipient_user_id, sender_role, body, order_id, source,
      external_message_id, external_alert_kind, email_references, read_by_user, read_by_staff
    ) values (
      p_company_id,
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
    )
    on conflict do nothing
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
     or v_message.company_id is distinct from p_company_id
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
     where company_id = p_company_id
       and id <> v_message.id
       and created_at <= v_message.created_at
     order by created_at desc, id desc
     limit 1;
  end if;
  v_alert_kind := case when v_message.sender_role::text = 'buyer' then
    coalesce(v_message.external_alert_kind, case
      when v_previous_sender is null then 'support_request' else 'message' end)
    else null end;

  -- Only a newly accepted reply changes lifecycle state. Provider retries return
  -- the existing row without reopening a conversation staff resolved later.
  if v_inserted then
    update public.companies
       set support_thread_status = 'open',
           support_thread_completed_at = null,
           support_thread_completed_by = null
     where id = p_company_id;
  end if;

  return jsonb_build_object(
    'id', v_message.id,
    'message_id', v_message.id,
    'created_at', v_message.created_at,
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
    'prior_thread_status', v_company.support_thread_status,
    'alert_kind', v_alert_kind,
    'company_name', v_company.name
  );
end;
$$;

revoke all on function public.upsert_email_inbound_message(uuid, uuid, text, text, text, uuid, uuid, text) from public;
revoke execute on function public.upsert_email_inbound_message(uuid, uuid, text, text, text, uuid, uuid, text) from anon, authenticated;
grant execute on function public.upsert_email_inbound_message(uuid, uuid, text, text, text, uuid, uuid, text) to service_role;

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
  if not found then
    raise exception 'order_not_found';
  end if;
  v_can_message := v_order.company_id is not null and exists (
    select 1
    from public.profiles
    where id = p_requested_by
      and company_id = v_order.company_id
  );
  if v_order.user_id is distinct from p_requested_by and not v_can_message then
    raise exception 'order_support_requester_mismatch';
  end if;

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
      'chat_linked', v_can_message
    );
  end if;

  if v_can_message then
    v_message := public.append_support_message(
      v_order.company_id,
      p_requested_by,
      'buyer',
      p_message_body,
      p_order_id,
      'order_request',
      true
    );
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'request', to_jsonb(v_request),
    'message', v_message,
    'chat_linked', v_can_message
  );
end;
$$;

revoke all on function public.create_order_support_request(uuid, text, text, jsonb, uuid, text, text) from public;
revoke execute on function public.create_order_support_request(uuid, text, text, jsonb, uuid, text, text) from anon, authenticated;
grant execute on function public.create_order_support_request(uuid, text, text, jsonb, uuid, text, text) to service_role;

commit;
