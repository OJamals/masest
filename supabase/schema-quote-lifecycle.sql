-- Canonical Quote intake, offer commit, delivery, and open-requisition invariants.
-- Apply after schema-quotes.sql, schema-crm-pipeline.sql, schema-integration-events.sql,
-- schema-provider-inbox.sql, and schema-integration-effect-handlers.sql.
begin;

alter table public.quotes add column if not exists intake_id uuid;
alter table public.quotes add column if not exists intake_fingerprint text;
alter table public.quotes add column if not exists offer_revision bigint not null default 0;
alter table public.quotes add column if not exists checkout_mutation_id uuid;
alter table public.quotes add column if not exists checkout_mutation_kind text;
alter table public.quotes add column if not exists checkout_mutation_order_id uuid;
alter table public.quotes add column if not exists checkout_mutation_offer_revision bigint;

update public.quotes
   set offer_revision = 1
 where offer_revision = 0
   and payload ? 'offer_order_id';

do $$ begin
  alter table public.quotes add constraint quotes_checkout_mutation_shape_chk check (
    (
      checkout_mutation_id is null
      and checkout_mutation_kind is null
      and checkout_mutation_order_id is null
      and checkout_mutation_offer_revision is null
    ) or (
      checkout_mutation_id is not null
      and checkout_mutation_kind in ('decline', 'revise')
      and checkout_mutation_order_id is not null
      and checkout_mutation_offer_revision is not null
      and checkout_mutation_offer_revision >= 1
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.quotes add constraint quotes_intake_identity_shape_chk check (
    (intake_id is null and intake_fingerprint is null)
    or (intake_id is not null and intake_fingerprint ~ '^[a-f0-9]{64}$')
  );
exception when duplicate_object then null; end $$;

create unique index if not exists quotes_intake_id_unique_idx
  on public.quotes (intake_id)
  where intake_id is not null;

-- Declined/expired/ordered and terminal pipeline rows release the requisition identity.
-- The stricter historical index guarantees this replacement cannot introduce duplicates.
drop index if exists public.quotes_open_requisition_unique_idx;
create unique index quotes_open_requisition_unique_idx
  on public.quotes ((payload ->> 'requisition_id'))
  where source = 'requisition'
    and status not in ('closed', 'spam')
    and coalesce(pipeline_stage, 'new') not in ('lost', 'won')
    and coalesce(payload ->> 'offer_status', '') not in ('declined', 'expired', 'ordered')
    and payload ? 'requisition_id';

create or replace function public.save_quote_intake(
  p_intake_id uuid,
  p_fingerprint text,
  p_quote jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.quotes%rowtype;
  v_quote public.quotes%rowtype;
begin
  if p_intake_id is null
     or coalesce(p_fingerprint, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_quote) <> 'object' then
    raise exception 'invalid_quote_intake';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_intake_id::text, 0));
  select * into v_existing
    from public.quotes
   where intake_id = p_intake_id
   for update;
  if found then
    if v_existing.intake_fingerprint is distinct from p_fingerprint then
      raise exception 'quote_intake_identity_collision';
    end if;
    return jsonb_build_object('quote_id', v_existing.id, 'duplicate', true);
  end if;

  insert into public.quotes (
    intake_id, intake_fingerprint, type, name, email, company, phone, product,
    industry, location, message, payload, source, status, lead_score, priority,
    pipeline_stage, next_step
  ) values (
    p_intake_id,
    p_fingerprint,
    left(coalesce(nullif(btrim(p_quote ->> 'type'), ''), 'quote'), 40),
    left(nullif(btrim(p_quote ->> 'name'), ''), 240),
    left(nullif(btrim(p_quote ->> 'email'), ''), 320),
    left(nullif(btrim(p_quote ->> 'company'), ''), 240),
    left(nullif(btrim(p_quote ->> 'phone'), ''), 80),
    left(nullif(btrim(p_quote ->> 'product'), ''), 500),
    left(nullif(btrim(p_quote ->> 'industry'), ''), 240),
    left(nullif(btrim(p_quote ->> 'location'), ''), 500),
    left(nullif(p_quote ->> 'message', ''), 4000),
    coalesce(p_quote -> 'payload', '{}'::jsonb),
    'contact',
    'new',
    greatest(0, least(100, coalesce((p_quote ->> 'lead_score')::integer, 0))),
    coalesce(nullif(p_quote ->> 'priority', ''), 'normal'),
    coalesce(nullif(p_quote ->> 'pipeline_stage', ''), 'new'),
    nullif(left(coalesce(p_quote ->> 'next_step', ''), 500), '')
  )
  returning * into v_quote;

  return jsonb_build_object('quote_id', v_quote.id, 'duplicate', false);
end;
$$;

revoke all on function public.save_quote_intake(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_quote_intake(uuid, text, jsonb) to service_role;

drop function if exists public.commit_quote_offer(
  uuid, text, text, text, uuid, jsonb, text, numeric, timestamptz, text, jsonb
);

create or replace function public.commit_quote_offer(
  p_quote_id uuid,
  p_expected_status text,
  p_expected_offer_order_id text,
  p_expected_offer_status text,
  p_offer_order_id uuid,
  p_payload jsonb,
  p_actor text,
  p_deal_value numeric,
  p_expires_at timestamptz,
  p_event_id text,
  p_effects jsonb,
  p_expected_offer_revision bigint,
  p_checkout_mutation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes%rowtype;
  v_event_id uuid;
  v_now timestamptz := now();
begin
  if p_quote_id is null
     or p_offer_order_id is null
     or p_expected_offer_revision is null
     or p_expected_offer_revision < 0
     or p_expires_at is null
     or p_expires_at <= v_now
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload ->> 'offer_order_id' is distinct from p_offer_order_id::text
     or coalesce(p_payload ->> 'offer_status', '') not in ('sent', 'revised')
     or (p_payload ->> 'offer_expires_at')::timestamptz is distinct from p_expires_at
     or btrim(coalesce(p_event_id, '')) = ''
     or char_length(p_event_id) > 512
     or jsonb_typeof(p_effects) <> 'array'
     or jsonb_array_length(p_effects) <> 3
     or (
       select count(distinct effect ->> 'effect_type')
         from jsonb_array_elements(p_effects) effect
        where effect ->> 'effect_type' in (
          'company_notification', 'quote_message', 'quote_offer_email'
        )
     ) <> 3 then
    raise exception 'invalid_quote_offer_commit';
  end if;

  select * into v_quote
    from public.quotes
   where id = p_quote_id
   for update;
  if not found
     or v_quote.status is distinct from p_expected_status
     or v_quote.offer_revision is distinct from p_expected_offer_revision
     or nullif(v_quote.payload ->> 'offer_order_id', '')
        is distinct from nullif(p_expected_offer_order_id, '')
     or nullif(v_quote.payload ->> 'offer_status', '')
        is distinct from nullif(p_expected_offer_status, '')
     or (
       nullif(p_expected_offer_order_id, '') is null
       and (p_checkout_mutation_id is not null or v_quote.checkout_mutation_id is not null)
     )
     or (
       nullif(p_expected_offer_order_id, '') is not null
       and (
         p_checkout_mutation_id is null
         or v_quote.checkout_mutation_id is distinct from p_checkout_mutation_id
         or v_quote.checkout_mutation_kind is distinct from 'revise'
         or v_quote.checkout_mutation_order_id::text is distinct from p_expected_offer_order_id
         or v_quote.checkout_mutation_offer_revision is distinct from p_expected_offer_revision
       )
     ) then
    return null;
  end if;

  v_event_id := public.ingest_integration_event(
    'masest',
    'production',
    p_event_id,
    'quote.offer.committed',
    p_quote_id::text,
    v_now,
    v_now,
    encode(extensions.digest(convert_to(
      jsonb_build_object(
        'quote_id', p_quote_id,
        'offer_order_id', p_offer_order_id,
        'expires_at', p_expires_at
      )::text,
      'UTF8'
    ), 'sha256'), 'hex'),
    jsonb_build_object('source', 'admin_quotes'),
    p_effects
  );

  update public.quotes
     set payload = p_payload || jsonb_build_object('offer_delivery_event_id', v_event_id),
         status = 'contacted',
         pipeline_stage = 'proposal',
         stage_changed_at = v_now,
         handled_at = v_now,
         handled_by = nullif(left(btrim(coalesce(p_actor, '')), 320), ''),
         deal_value = p_deal_value,
         next_step = 'Buyer review and checkout',
         due_at = null,
         offer_revision = v_quote.offer_revision + 1,
         checkout_mutation_id = null,
         checkout_mutation_kind = null,
         checkout_mutation_order_id = null,
         checkout_mutation_offer_revision = null
   where id = p_quote_id
  returning * into v_quote;

  return to_jsonb(v_quote);
end;
$$;

revoke all on function public.commit_quote_offer(
  uuid, text, text, text, uuid, jsonb, text, numeric, timestamptz, text, jsonb, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.commit_quote_offer(
  uuid, text, text, text, uuid, jsonb, text, numeric, timestamptz, text, jsonb, bigint, uuid
) to service_role;

-- Message delivery is a local integration effect. The insert, Company thread projection,
-- and provider-success marker share one transaction, so a lost worker response cannot
-- duplicate the Buyer message.
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
  v_message public.messages%rowtype;
  v_result jsonb;
begin
  select * into v_effect
    from public.integration_effects
   where id = p_effect_id
   for update;
  if not found
     or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'quote_message' then
    raise exception 'invalid_quote_message_effect_lease';
  end if;
  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{}'::jsonb);
  end if;

  begin
    v_company_id := nullif(v_effect.payload ->> 'company_id', '')::uuid;
    v_quote_id := nullif(v_effect.payload ->> 'quote_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_quote_message_effect';
  end;
  if v_company_id is null
     or v_quote_id is null
     or not exists (
       select 1 from public.quotes
        where id = v_quote_id
          and payload ->> 'company_id' = v_company_id::text
     ) then
    raise exception 'invalid_quote_message_effect';
  end if;

  insert into public.messages (
    company_id, sender_role, body, source, read_by_staff, read_by_user
  ) values (
    v_company_id,
    'staff',
    'Your requested pricing is ready to review and accept in the Orders workspace.',
    'quote_offer',
    true,
    false
  )
  returning * into v_message;

  update public.companies
     set support_last_message_at = v_message.created_at,
         support_last_message_body = v_message.body,
         support_last_sender_role = 'staff'
   where id = v_company_id
     and (support_last_message_at is null or support_last_message_at <= v_message.created_at);

  v_result := jsonb_build_object(
    'message_id', v_message.id,
    'quote_id', v_quote_id,
    'inserted', true
  );
  return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
end;
$$;

revoke all on function public.deliver_quote_message_effect(uuid, text)
from public, anon, authenticated;
grant execute on function public.deliver_quote_message_effect(uuid, text)
to service_role;

-- A Quote has at most one payable Stripe Checkout Session. The active row begins before
-- the provider call, so its UUID is the provider idempotency identity. `request_params`
-- exists only while provider acceptance is ambiguous and is cleared once the exact
-- Session is attached or terminal.
create table if not exists public.quote_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  quote_order_id uuid not null,
  requester_id uuid not null,
  company_id uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  request_params jsonb,
  status text not null default 'creating'
    check (status in ('creating', 'open', 'completed', 'expired', 'failed')),
  stripe_session_id text,
  stripe_session_url text,
  stripe_session_expires_at timestamptz,
  provider_status text,
  terminal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz,
  constraint quote_checkout_attempt_request_shape_chk check (
    (status = 'creating' and coalesce(jsonb_typeof(request_params) = 'object', false))
    or status <> 'creating'
  ),
  constraint quote_checkout_attempt_session_shape_chk check (
    status <> 'open'
    or (
      stripe_session_id is not null
      and stripe_session_url is not null
      and stripe_session_expires_at is not null
    )
  )
);

create unique index if not exists quote_checkout_attempts_active_quote_idx
  on public.quote_checkout_attempts (quote_id)
  where status in ('creating', 'open');
create unique index if not exists quote_checkout_attempts_stripe_session_idx
  on public.quote_checkout_attempts (stripe_session_id)
  where stripe_session_id is not null;
create index if not exists quote_checkout_attempts_quote_created_idx
  on public.quote_checkout_attempts (quote_id, created_at desc);

alter table public.quote_checkout_attempts enable row level security;
revoke all on table public.quote_checkout_attempts from public, anon, authenticated;
grant select, insert, update on table public.quote_checkout_attempts to service_role;

-- Checkout-attempt v2 cutover. The readiness row intentionally starts false: operators
-- enable it only after every pre-migration Quote Checkout Session is terminal. Until then,
-- legacy paid webhooks remain recoverable but no second payable Session can be created.
create table if not exists public.quote_checkout_attempt_cutover (
  singleton boolean primary key default true check (singleton),
  ready boolean not null default false,
  ready_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.quote_checkout_attempt_cutover (singleton, ready)
values (true, false)
on conflict (singleton) do nothing;
alter table public.quote_checkout_attempt_cutover enable row level security;
revoke all on table public.quote_checkout_attempt_cutover from public, anon, authenticated;
grant select, update on table public.quote_checkout_attempt_cutover to service_role;

alter table public.quote_checkout_attempts add column if not exists offer_revision bigint;
alter table public.quote_checkout_attempts add column if not exists order_snapshot jsonb;
alter table public.quote_checkout_attempts add column if not exists processing_event_id text;
alter table public.quote_checkout_attempts add column if not exists processing_lease_expires_at timestamptz;

create or replace function public.quote_checkout_order_snapshot(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'company_id', o.company_id,
    'user_id', o.user_id,
    'status', o.status,
    'requisition_name', o.requisition_name,
    'subtotal', o.subtotal,
    'total', o.total,
    'currency', lower(o.currency),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku', i.sku,
        'product_sku', i.product_sku,
        'name', i.name,
        'qty', i.qty,
        'unit_price', i.unit_price,
        'line_total', i.line_total
      ) order by i.sku, i.id)
      from public.order_items i
      where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_order_id
$$;

update public.quote_checkout_attempts a
   set offer_revision = q.offer_revision
  from public.quotes q
 where a.quote_id = q.id
   and a.offer_revision is null;
update public.quote_checkout_attempts
   set order_snapshot = public.quote_checkout_order_snapshot(quote_order_id)
 where order_snapshot is null;

alter table public.quote_checkout_attempts
  drop constraint if exists quote_checkout_attempts_status_check;
alter table public.quote_checkout_attempts
  drop constraint if exists quote_checkout_attempt_status_chk;
alter table public.quote_checkout_attempts
  add constraint quote_checkout_attempt_status_chk check (
    status in ('creating', 'open', 'provider_completed', 'processing', 'completed', 'expired', 'failed')
  );
alter table public.quote_checkout_attempts
  drop constraint if exists quote_checkout_attempt_revision_shape_chk;
alter table public.quote_checkout_attempts
  add constraint quote_checkout_attempt_revision_shape_chk check (
    status not in ('creating', 'open', 'provider_completed', 'processing')
    or (
      offer_revision is not null
      and offer_revision >= 1
      and coalesce(jsonb_typeof(order_snapshot) = 'object', false)
    )
  );

drop index if exists public.quote_checkout_attempts_active_quote_idx;
create unique index quote_checkout_attempts_active_quote_idx
  on public.quote_checkout_attempts (quote_id)
  where status in ('creating', 'open', 'provider_completed', 'processing');

create or replace function public.prevent_quote_checkout_attempt_identity_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.quote_id is distinct from old.quote_id
     or new.quote_order_id is distinct from old.quote_order_id
     or new.requester_id is distinct from old.requester_id
     or new.company_id is distinct from old.company_id
     or new.offer_revision is distinct from old.offer_revision
     or new.order_snapshot is distinct from old.order_snapshot
     or new.request_fingerprint is distinct from old.request_fingerprint
     or (old.stripe_session_id is not null
         and new.stripe_session_id is distinct from old.stripe_session_id) then
    raise exception 'quote_checkout_attempt_identity_immutable';
  end if;
  return new;
end
$$;

-- Serialize draft-line mutation with the claim's Order row lock. Once an exact webhook
-- owns `processing`, the paid Order path may remove the draft; before that, staff/direct
-- writes cannot alter the price snapshot behind a payable Session.
create or replace function public.prevent_active_quote_checkout_order_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
begin
  v_order_id := case
    when tg_table_name = 'orders' then old.id
    else coalesce(new.order_id, old.order_id)
  end;
  if tg_table_name = 'order_items' then
    perform 1 from public.orders where id = v_order_id for update;
  end if;
  if exists (
    select 1 from public.quote_checkout_attempts
     where quote_order_id = v_order_id
       and status in ('creating', 'open', 'provider_completed')
  ) or (
    not coalesce((
      select ready from public.quote_checkout_attempt_cutover where singleton = true
    ), false)
    and exists (
      select 1 from public.quotes q
       where q.payload ->> 'offer_order_id' = v_order_id::text
         and q.payload ->> 'offer_status' = 'accepted'
    )
    and not exists (
      select 1 from public.quote_checkout_attempts
       where quote_order_id = v_order_id
         and status = 'processing'
    )
  ) then
    raise exception 'quote_checkout_order_locked';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists orders_active_quote_checkout_guard on public.orders;
create trigger orders_active_quote_checkout_guard
  before update or delete on public.orders
  for each row execute function public.prevent_active_quote_checkout_order_mutation();
drop trigger if exists order_items_active_quote_checkout_guard on public.order_items;
create trigger order_items_active_quote_checkout_guard
  before insert or update or delete on public.order_items
  for each row execute function public.prevent_active_quote_checkout_order_mutation();

drop function if exists public.claim_quote_checkout_attempt(uuid,uuid,uuid,uuid,uuid,text,jsonb);
create or replace function public.claim_quote_checkout_attempt(
  p_candidate_id uuid,
  p_quote_id uuid,
  p_quote_order_id uuid,
  p_requester_id uuid,
  p_company_id uuid,
  p_offer_revision bigint,
  p_order_snapshot jsonb,
  p_request_fingerprint text,
  p_request_params jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes%rowtype;
  v_attempt public.quote_checkout_attempts%rowtype;
  v_latest public.quote_checkout_attempts%rowtype;
  v_offer_expires_at timestamptz;
  v_order_snapshot jsonb;
  v_action text;
begin
  if p_candidate_id is null
     or p_quote_id is null
     or p_quote_order_id is null
     or p_requester_id is null
     or p_company_id is null
     or p_offer_revision is null
     or p_offer_revision < 1
     or not coalesce(jsonb_typeof(p_order_snapshot) = 'object', false)
     or octet_length(p_order_snapshot::text) > 65536
     or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
     or not coalesce(jsonb_typeof(p_request_params) = 'object', false)
     or octet_length(p_request_params::text) > 65536 then
    raise exception 'quote_checkout_attempt_claim_invalid';
  end if;
  if not coalesce((
    select ready from public.quote_checkout_attempt_cutover where singleton = true
  ), false) then
    raise exception 'quote_checkout_cutover_pending';
  end if;

  select * into v_quote
    from public.quotes
   where id = p_quote_id
   for update;
  if not found
     or v_quote.source is distinct from 'requisition'
     or v_quote.status in ('closed', 'spam')
     or v_quote.pipeline_stage in ('lost', 'won')
     or v_quote.checkout_mutation_id is not null
     or v_quote.offer_revision is distinct from p_offer_revision
     or v_quote.payload ->> 'requester_id' is distinct from p_requester_id::text
     or v_quote.payload ->> 'company_id' is distinct from p_company_id::text
     or v_quote.payload ->> 'offer_order_id' is distinct from p_quote_order_id::text
     or v_quote.payload ->> 'offer_status' is distinct from 'accepted' then
    raise exception 'quote_checkout_unavailable';
  end if;
  begin
    v_offer_expires_at := nullif(v_quote.payload ->> 'offer_expires_at', '')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'quote_checkout_unavailable';
  end;
  if v_offer_expires_at is null or v_offer_expires_at <= now() then
    raise exception 'quote_checkout_unavailable';
  end if;

  perform 1 from public.orders
   where id = p_quote_order_id
     and company_id = p_company_id
     and user_id = p_requester_id
     and status = 'cart'
     and requisition_name is null
   for update;
  if not found then raise exception 'quote_checkout_unavailable'; end if;
  perform 1 from public.order_items where order_id = p_quote_order_id for update;
  v_order_snapshot := public.quote_checkout_order_snapshot(p_quote_order_id);
  if v_order_snapshot is distinct from p_order_snapshot then
    raise exception 'quote_checkout_order_revision_stale';
  end if;

  select * into v_attempt
    from public.quote_checkout_attempts
   where quote_id = p_quote_id
     and status in ('creating', 'open', 'provider_completed', 'processing')
   order by created_at desc
   limit 1
   for update;
  if found then
    if v_attempt.status in ('provider_completed', 'processing')
       or (v_attempt.status = 'creating'
           and v_attempt.created_at <= now() - interval '23 hours') then
      v_action := 'blocked';
    elsif v_attempt.quote_order_id is distinct from p_quote_order_id
       or v_attempt.offer_revision is distinct from p_offer_revision
       or v_attempt.order_snapshot is distinct from p_order_snapshot then
      v_action := 'reconcile';
    elsif v_attempt.request_fingerprint = p_request_fingerprint then
      if v_attempt.status = 'creating' then
        v_action := 'recover';
      elsif v_attempt.stripe_session_expires_at > now() then
        v_action := 'reuse';
      else
        v_action := 'reconcile';
      end if;
    else
      v_action := 'reconcile';
    end if;
    return jsonb_build_object(
      'action', v_action,
      'attempt_id', v_attempt.id,
      'status', v_attempt.status,
      'quote_id', v_attempt.quote_id,
      'quote_order_id', v_attempt.quote_order_id,
      'requester_id', v_attempt.requester_id,
      'company_id', v_attempt.company_id,
      'offer_revision', v_attempt.offer_revision,
      'request_fingerprint', v_attempt.request_fingerprint,
      'request_params', case when v_action in ('recover', 'reconcile')
        and v_attempt.status = 'creating' then v_attempt.request_params else null end,
      'stripe_session_id', v_attempt.stripe_session_id,
      'stripe_session_url', case when v_action = 'reuse' then v_attempt.stripe_session_url else null end,
      'stripe_session_expires_at', v_attempt.stripe_session_expires_at
    );
  end if;

  select * into v_latest
    from public.quote_checkout_attempts
   where quote_id = p_quote_id
   order by created_at desc
   limit 1
   for update;
  if found and v_latest.status = 'completed' then
    return jsonb_build_object('action', 'blocked', 'attempt_id', v_latest.id, 'status', v_latest.status);
  end if;

  insert into public.quote_checkout_attempts (
    id, quote_id, quote_order_id, requester_id, company_id, offer_revision,
    order_snapshot, request_fingerprint, request_params, status
  ) values (
    p_candidate_id, p_quote_id, p_quote_order_id, p_requester_id, p_company_id,
    p_offer_revision, p_order_snapshot, p_request_fingerprint, p_request_params, 'creating'
  ) returning * into v_attempt;
  return jsonb_build_object(
    'action', 'created',
    'attempt_id', v_attempt.id,
    'status', v_attempt.status,
    'quote_id', v_attempt.quote_id,
    'quote_order_id', v_attempt.quote_order_id,
    'requester_id', v_attempt.requester_id,
    'company_id', v_attempt.company_id,
    'offer_revision', v_attempt.offer_revision,
    'request_fingerprint', v_attempt.request_fingerprint,
    'request_params', v_attempt.request_params
  );
end;
$$;

drop function if exists public.attach_quote_checkout_session(uuid,uuid,uuid,text,text,timestamptz);
create or replace function public.attach_quote_checkout_session(
  p_attempt_id uuid,
  p_quote_id uuid,
  p_quote_order_id uuid,
  p_offer_revision bigint,
  p_stripe_session_id text,
  p_stripe_session_url text,
  p_stripe_session_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_attempt public.quote_checkout_attempts%rowtype;
begin
  if p_attempt_id is null or p_quote_id is null or p_quote_order_id is null
     or p_offer_revision is null or p_offer_revision < 1
     or coalesce(p_stripe_session_id, '') !~ '^cs_[A-Za-z0-9_]+$'
     or coalesce(p_stripe_session_url, '') !~ '^https://'
     or char_length(p_stripe_session_url) > 4096
     or p_stripe_session_expires_at is null
     or p_stripe_session_expires_at <= now() then
    raise exception 'quote_checkout_session_attach_invalid';
  end if;
  select * into v_attempt from public.quote_checkout_attempts
   where id = p_attempt_id and quote_id = p_quote_id
     and quote_order_id = p_quote_order_id and offer_revision = p_offer_revision
   for update;
  if not found then raise exception 'quote_checkout_attempt_not_found'; end if;
  if v_attempt.status = 'open' then
    if v_attempt.stripe_session_id is distinct from p_stripe_session_id then
      raise exception 'quote_checkout_session_identity_conflict';
    end if;
    return jsonb_build_object(
      'attempt_id', v_attempt.id, 'status', v_attempt.status,
      'stripe_session_id', v_attempt.stripe_session_id,
      'stripe_session_url', v_attempt.stripe_session_url,
      'stripe_session_expires_at', v_attempt.stripe_session_expires_at
    );
  end if;
  if v_attempt.status <> 'creating' or v_attempt.stripe_session_id is not null then
    raise exception 'quote_checkout_attempt_not_attachable';
  end if;
  update public.quote_checkout_attempts
     set status = 'open', stripe_session_id = p_stripe_session_id,
         stripe_session_url = p_stripe_session_url,
         stripe_session_expires_at = p_stripe_session_expires_at,
         provider_status = 'open', request_params = null, updated_at = now()
   where id = v_attempt.id
  returning * into v_attempt;
  return jsonb_build_object(
    'attempt_id', v_attempt.id, 'status', v_attempt.status,
    'stripe_session_id', v_attempt.stripe_session_id,
    'stripe_session_url', v_attempt.stripe_session_url,
    'stripe_session_expires_at', v_attempt.stripe_session_expires_at
  );
end;
$$;

drop function if exists public.finish_quote_checkout_attempt(uuid,uuid,uuid,text,text,text,text);
create or replace function public.finish_quote_checkout_attempt(
  p_attempt_id uuid,
  p_quote_id uuid,
  p_quote_order_id uuid,
  p_offer_revision bigint,
  p_stripe_session_id text,
  p_terminal_status text,
  p_provider_status text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_attempt public.quote_checkout_attempts%rowtype;
begin
  if p_attempt_id is null or p_quote_id is null or p_quote_order_id is null
     or p_offer_revision is null or p_offer_revision < 1
     or p_terminal_status not in ('provider_completed', 'completed', 'expired', 'failed')
     or (p_stripe_session_id is not null and p_stripe_session_id !~ '^cs_[A-Za-z0-9_]+$')
     or char_length(coalesce(p_provider_status, '')) > 80
     or char_length(coalesce(p_reason, '')) > 160 then
    raise exception 'quote_checkout_attempt_finish_invalid';
  end if;
  perform 1 from public.quotes where id = p_quote_id for update;
  if not found then raise exception 'quote_checkout_attempt_not_found'; end if;
  select * into v_attempt from public.quote_checkout_attempts
   where id = p_attempt_id and quote_id = p_quote_id
     and quote_order_id = p_quote_order_id and offer_revision = p_offer_revision
   for update;
  if not found then raise exception 'quote_checkout_attempt_not_found'; end if;
  if v_attempt.stripe_session_id is not null
     and v_attempt.stripe_session_id is distinct from p_stripe_session_id then
    raise exception 'quote_checkout_session_identity_conflict';
  end if;
  if p_stripe_session_id is null
     and not (v_attempt.status = 'creating' and p_terminal_status = 'failed') then
    raise exception 'quote_checkout_session_identity_required';
  end if;
  if v_attempt.status in ('expired', 'failed')
     and v_attempt.status is distinct from p_terminal_status then
    raise exception 'quote_checkout_attempt_terminal_conflict';
  end if;
  if v_attempt.status = 'completed'
     and p_terminal_status not in ('completed', 'failed') then
    raise exception 'quote_checkout_attempt_terminal_conflict';
  end if;
  update public.quote_checkout_attempts
     set status = p_terminal_status,
         stripe_session_id = coalesce(stripe_session_id, p_stripe_session_id),
         stripe_session_url = null,
         provider_status = nullif(left(coalesce(p_provider_status, ''), 80), ''),
         terminal_reason = nullif(left(coalesce(p_reason, ''), 160), ''),
         request_params = null,
         processing_event_id = case when p_terminal_status in ('completed', 'expired', 'failed')
           then null else processing_event_id end,
         processing_lease_expires_at = case when p_terminal_status in ('completed', 'expired', 'failed')
           then null else processing_lease_expires_at end,
         terminal_at = case when p_terminal_status in ('completed', 'expired', 'failed')
           then coalesce(terminal_at, now()) else terminal_at end,
         updated_at = now()
   where id = v_attempt.id
  returning * into v_attempt;
  if p_terminal_status in ('completed', 'failed') then
    update public.quotes
       set checkout_mutation_id = null, checkout_mutation_kind = null,
           checkout_mutation_order_id = null, checkout_mutation_offer_revision = null
     where id = v_attempt.quote_id
       and offer_revision = v_attempt.offer_revision
       and payload ->> 'offer_order_id' = v_attempt.quote_order_id::text;
  end if;
  return jsonb_build_object(
    'attempt_id', v_attempt.id, 'status', v_attempt.status,
    'stripe_session_id', v_attempt.stripe_session_id,
    'provider_status', v_attempt.provider_status,
    'terminal_reason', v_attempt.terminal_reason
  );
end;
$$;

create or replace function public.finish_legacy_quote_checkout_attempt(
  p_quote_id uuid,
  p_quote_order_id uuid,
  p_stripe_session_id text,
  p_terminal_status text,
  p_provider_status text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_attempt public.quote_checkout_attempts%rowtype;
begin
  if p_quote_id is null or p_quote_order_id is null
     or coalesce(p_stripe_session_id, '') !~ '^cs_[A-Za-z0-9_]+$'
     or p_terminal_status not in ('completed', 'expired', 'failed') then
    raise exception 'quote_checkout_attempt_finish_invalid';
  end if;
  select * into v_attempt from public.quote_checkout_attempts
   where stripe_session_id = p_stripe_session_id
     and quote_id = p_quote_id
     and quote_order_id = p_quote_order_id;
  if not found then return jsonb_build_object('skipped', 'legacy_session'); end if;
  return public.finish_quote_checkout_attempt(
    v_attempt.id,
    v_attempt.quote_id,
    v_attempt.quote_order_id,
    v_attempt.offer_revision,
    p_stripe_session_id,
    p_terminal_status,
    p_provider_status,
    p_reason
  );
end;
$$;

create or replace function public.claim_quote_checkout_webhook(
  p_attempt_id uuid,
  p_quote_id uuid,
  p_quote_order_id uuid,
  p_offer_revision bigint,
  p_stripe_session_id text,
  p_provider_event_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.quote_checkout_attempts%rowtype;
  v_quote public.quotes%rowtype;
begin
  if p_attempt_id is null or p_quote_id is null or p_quote_order_id is null
     or p_offer_revision is null or p_offer_revision < 1
     or coalesce(p_stripe_session_id, '') !~ '^cs_[A-Za-z0-9_]+$'
     or btrim(coalesce(p_provider_event_id, '')) = ''
     or char_length(p_provider_event_id) > 255 then
    raise exception 'quote_checkout_webhook_claim_invalid';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then raise exception 'quote_checkout_attempt_not_found'; end if;
  select * into v_attempt from public.quote_checkout_attempts
   where id = p_attempt_id and quote_id = p_quote_id
     and quote_order_id = p_quote_order_id and offer_revision = p_offer_revision
   for update;
  if not found then raise exception 'quote_checkout_attempt_not_found'; end if;
  if v_attempt.stripe_session_id is not null
     and v_attempt.stripe_session_id is distinct from p_stripe_session_id then
    raise exception 'quote_checkout_session_identity_conflict';
  end if;
  if v_attempt.status = 'completed' then
    return jsonb_build_object('action', 'duplicate', 'attempt_id', v_attempt.id);
  end if;
  if v_attempt.status = 'failed' then
    return jsonb_build_object('action', 'stale', 'attempt_id', v_attempt.id);
  end if;
  if v_attempt.status = 'expired' then
    raise exception 'quote_checkout_attempt_terminal_conflict';
  end if;
  if v_attempt.status = 'processing'
     and v_attempt.processing_event_id is distinct from p_provider_event_id
     and v_attempt.processing_lease_expires_at > now() then
    raise exception 'quote_checkout_webhook_busy';
  end if;
  if v_attempt.status <> 'processing' then
    if v_quote.offer_revision is distinct from p_offer_revision
       or v_quote.payload ->> 'offer_order_id' is distinct from p_quote_order_id::text
       or coalesce(v_quote.payload ->> 'offer_status', '') not in ('accepted', 'expired')
       or public.quote_checkout_order_snapshot(p_quote_order_id) is distinct from v_attempt.order_snapshot then
      raise exception 'quote_checkout_attempt_revision_conflict';
    end if;
  end if;
  update public.quote_checkout_attempts
     set status = 'processing', stripe_session_id = coalesce(stripe_session_id, p_stripe_session_id),
         stripe_session_url = null, request_params = null,
         provider_status = 'complete', processing_event_id = p_provider_event_id,
         processing_lease_expires_at = now() + interval '5 minutes', updated_at = now()
   where id = v_attempt.id
  returning * into v_attempt;
  return jsonb_build_object('action', 'process', 'attempt_id', v_attempt.id, 'status', v_attempt.status);
end;
$$;

create or replace function public.claim_legacy_quote_checkout_webhook(
  p_quote_id uuid,
  p_quote_order_id uuid,
  p_stripe_session_id text,
  p_provider_event_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes%rowtype;
  v_attempt public.quote_checkout_attempts%rowtype;
  v_requester_id uuid;
  v_company_id uuid;
  v_order_snapshot jsonb;
begin
  if p_quote_id is null or p_quote_order_id is null
     or coalesce(p_stripe_session_id, '') !~ '^cs_[A-Za-z0-9_]+$'
     or btrim(coalesce(p_provider_event_id, '')) = ''
     or char_length(p_provider_event_id) > 255 then
    raise exception 'quote_checkout_webhook_claim_invalid';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id for update;
  begin
    v_requester_id := nullif(v_quote.payload ->> 'requester_id', '')::uuid;
    v_company_id := nullif(v_quote.payload ->> 'company_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'quote_checkout_attempt_revision_conflict';
  end;
  if v_quote.id is null or v_quote.offer_revision < 1
     or v_requester_id is null or v_company_id is null
     or v_quote.payload ->> 'offer_order_id' is distinct from p_quote_order_id::text then
    raise exception 'quote_checkout_attempt_revision_conflict';
  end if;

  select * into v_attempt from public.quote_checkout_attempts
   where stripe_session_id = p_stripe_session_id
   for update;
  if found then
    if v_attempt.quote_id is distinct from p_quote_id
       or v_attempt.quote_order_id is distinct from p_quote_order_id
       or v_attempt.offer_revision is distinct from v_quote.offer_revision then
      raise exception 'quote_checkout_session_identity_conflict';
    end if;
    if v_attempt.status = 'completed' then
      return jsonb_build_object(
        'action', 'duplicate', 'attempt_id', v_attempt.id,
        'offer_revision', v_attempt.offer_revision
      );
    end if;
    if v_attempt.status = 'failed' then
      return jsonb_build_object(
        'action', 'stale', 'attempt_id', v_attempt.id,
        'offer_revision', v_attempt.offer_revision
      );
    end if;
    if v_attempt.status = 'expired' then
      raise exception 'quote_checkout_attempt_terminal_conflict';
    end if;
    if v_attempt.status = 'processing'
       and v_attempt.processing_event_id is distinct from p_provider_event_id
       and v_attempt.processing_lease_expires_at > now() then
      raise exception 'quote_checkout_webhook_busy';
    end if;
    update public.quote_checkout_attempts
       set status = 'processing', processing_event_id = p_provider_event_id,
           processing_lease_expires_at = now() + interval '5 minutes', updated_at = now()
     where id = v_attempt.id;
    return jsonb_build_object(
      'action', 'process', 'attempt_id', v_attempt.id,
      'offer_revision', v_attempt.offer_revision
    );
  end if;
  if coalesce(v_quote.payload ->> 'offer_status', '') not in ('accepted', 'expired') then
    raise exception 'quote_checkout_attempt_revision_conflict';
  end if;
  if exists (
    select 1 from public.quote_checkout_attempts
     where quote_id = p_quote_id
       and status in ('creating', 'open', 'provider_completed', 'processing')
  ) then
    raise exception 'quote_checkout_session_identity_conflict';
  end if;

  perform 1 from public.orders
   where id = p_quote_order_id and company_id = v_company_id and user_id = v_requester_id
     and status = 'cart' and requisition_name is null
   for update;
  if not found then raise exception 'quote_checkout_attempt_revision_conflict'; end if;
  perform 1 from public.order_items where order_id = p_quote_order_id for update;
  v_order_snapshot := public.quote_checkout_order_snapshot(p_quote_order_id);
  if v_order_snapshot is null then raise exception 'quote_checkout_attempt_revision_conflict'; end if;

  insert into public.quote_checkout_attempts (
    quote_id, quote_order_id, requester_id, company_id, offer_revision,
    order_snapshot, request_fingerprint, request_params, status,
    stripe_session_id, provider_status, processing_event_id,
    processing_lease_expires_at, updated_at
  ) values (
    p_quote_id, p_quote_order_id, v_requester_id, v_company_id, v_quote.offer_revision,
    v_order_snapshot,
    encode(extensions.digest(convert_to(
      jsonb_build_object('legacy_session_id', p_stripe_session_id)::text, 'UTF8'
    ), 'sha256'), 'hex'),
    null, 'processing', p_stripe_session_id, 'complete', p_provider_event_id,
    now() + interval '5 minutes', now()
  ) returning * into v_attempt;
  return jsonb_build_object(
    'action', 'process', 'attempt_id', v_attempt.id,
    'offer_revision', v_attempt.offer_revision
  );
end;
$$;

create or replace function public.begin_quote_checkout_mutation(
  p_candidate_id uuid,
  p_quote_id uuid,
  p_quote_order_id uuid,
  p_requester_id uuid,
  p_company_id uuid,
  p_offer_revision bigint,
  p_expected_offer_status text,
  p_kind text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes%rowtype;
  v_attempt public.quote_checkout_attempts%rowtype;
  v_mutation_id uuid;
begin
  if p_candidate_id is null or p_quote_id is null or p_quote_order_id is null
     or p_requester_id is null or p_company_id is null
     or p_offer_revision is null or p_offer_revision < 1
     or p_expected_offer_status not in ('sent', 'revised', 'accepted', 'declined', 'expired')
     or p_kind not in ('decline', 'revise') then
    raise exception 'quote_checkout_mutation_invalid';
  end if;
  if not coalesce((
    select ready from public.quote_checkout_attempt_cutover where singleton = true
  ), false) then
    raise exception 'quote_checkout_cutover_pending';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found
     or v_quote.source is distinct from 'requisition'
     or v_quote.offer_revision is distinct from p_offer_revision
     or v_quote.payload ->> 'offer_order_id' is distinct from p_quote_order_id::text
     or v_quote.payload ->> 'requester_id' is distinct from p_requester_id::text
     or v_quote.payload ->> 'company_id' is distinct from p_company_id::text
     or v_quote.payload ->> 'offer_status' is distinct from p_expected_offer_status then
    raise exception 'quote_checkout_unavailable';
  end if;
  if v_quote.checkout_mutation_id is not null then
    if v_quote.checkout_mutation_kind is distinct from p_kind
       or v_quote.checkout_mutation_order_id is distinct from p_quote_order_id
       or v_quote.checkout_mutation_offer_revision is distinct from p_offer_revision then
      raise exception 'quote_checkout_mutation_busy';
    end if;
    v_mutation_id := v_quote.checkout_mutation_id;
  else
    v_mutation_id := p_candidate_id;
    update public.quotes
       set checkout_mutation_id = v_mutation_id,
           checkout_mutation_kind = p_kind,
           checkout_mutation_order_id = p_quote_order_id,
           checkout_mutation_offer_revision = p_offer_revision
     where id = p_quote_id;
  end if;

  select * into v_attempt from public.quote_checkout_attempts
   where quote_id = p_quote_id
     and status in ('creating', 'open', 'provider_completed', 'processing')
   order by created_at desc limit 1 for update;
  if not found then
    return jsonb_build_object('action', 'ready', 'mutation_id', v_mutation_id);
  end if;
  if v_attempt.status in ('provider_completed', 'processing')
     or (v_attempt.status = 'creating'
         and v_attempt.created_at <= now() - interval '23 hours') then
    return jsonb_build_object('action', 'blocked', 'mutation_id', v_mutation_id,
      'attempt_id', v_attempt.id, 'status', v_attempt.status);
  end if;
  return jsonb_build_object(
    'action', 'reconcile', 'mutation_id', v_mutation_id,
    'attempt_id', v_attempt.id, 'status', v_attempt.status,
    'quote_id', v_attempt.quote_id, 'quote_order_id', v_attempt.quote_order_id,
    'requester_id', v_attempt.requester_id, 'company_id', v_attempt.company_id,
    'offer_revision', v_attempt.offer_revision,
    'request_params', case when v_attempt.status = 'creating' then v_attempt.request_params else null end,
    'stripe_session_id', v_attempt.stripe_session_id
  );
end;
$$;

create or replace function public.release_quote_checkout_mutation(
  p_mutation_id uuid,
  p_quote_id uuid,
  p_quote_order_id uuid,
  p_offer_revision bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_released uuid;
begin
  if p_mutation_id is null or p_quote_id is null or p_quote_order_id is null
     or p_offer_revision is null or p_offer_revision < 1 then
    raise exception 'quote_checkout_mutation_invalid';
  end if;
  update public.quotes
     set checkout_mutation_id = null, checkout_mutation_kind = null,
         checkout_mutation_order_id = null, checkout_mutation_offer_revision = null
   where id = p_quote_id
     and checkout_mutation_id = p_mutation_id
     and checkout_mutation_order_id = p_quote_order_id
     and checkout_mutation_offer_revision = p_offer_revision
  returning id into v_released;
  return jsonb_build_object('released', v_released is not null);
end;
$$;

revoke all on function public.quote_checkout_order_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.claim_quote_checkout_attempt(uuid,uuid,uuid,uuid,uuid,bigint,jsonb,text,jsonb)
from public, anon, authenticated;
revoke all on function public.attach_quote_checkout_session(uuid,uuid,uuid,bigint,text,text,timestamptz)
from public, anon, authenticated;
revoke all on function public.finish_quote_checkout_attempt(uuid,uuid,uuid,bigint,text,text,text,text)
from public, anon, authenticated;
revoke all on function public.finish_legacy_quote_checkout_attempt(uuid,uuid,text,text,text,text)
from public, anon, authenticated;
revoke all on function public.claim_quote_checkout_webhook(uuid,uuid,uuid,bigint,text,text)
from public, anon, authenticated;
revoke all on function public.claim_legacy_quote_checkout_webhook(uuid,uuid,text,text)
from public, anon, authenticated;
revoke all on function public.begin_quote_checkout_mutation(uuid,uuid,uuid,uuid,uuid,bigint,text,text)
from public, anon, authenticated;
revoke all on function public.release_quote_checkout_mutation(uuid,uuid,uuid,bigint)
from public, anon, authenticated;
grant execute on function public.quote_checkout_order_snapshot(uuid) to service_role;
grant execute on function public.claim_quote_checkout_attempt(uuid,uuid,uuid,uuid,uuid,bigint,jsonb,text,jsonb)
to service_role;
grant execute on function public.attach_quote_checkout_session(uuid,uuid,uuid,bigint,text,text,timestamptz)
to service_role;
grant execute on function public.finish_quote_checkout_attempt(uuid,uuid,uuid,bigint,text,text,text,text)
to service_role;
grant execute on function public.finish_legacy_quote_checkout_attempt(uuid,uuid,text,text,text,text)
to service_role;
grant execute on function public.claim_quote_checkout_webhook(uuid,uuid,uuid,bigint,text,text)
to service_role;
grant execute on function public.claim_legacy_quote_checkout_webhook(uuid,uuid,text,text)
to service_role;
grant execute on function public.begin_quote_checkout_mutation(uuid,uuid,uuid,uuid,uuid,bigint,text,text)
to service_role;
grant execute on function public.release_quote_checkout_mutation(uuid,uuid,uuid,bigint)
to service_role;

commit;
