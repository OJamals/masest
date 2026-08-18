-- Immutable Order reversal commands and atomic capacity claims.
-- Apply after schema-integration-events.sql, schema-provider-inbox.sql,
-- schema-commerce-integrations.sql, schema-refunds.sql, schema-qbo.sql,
-- schema-qbo-refunds.sql, schema-order-operations.sql,
-- schema-shipment-label-ownership.sql, and schema-audit-log.sql.
begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.orders
  add column if not exists reversal_revision bigint not null default 0,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.order_reversal_commands (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  type text not null check (type in ('refund', 'cancel')),
  request_id text not null check (
    char_length(request_id) between 8 and 128
    and request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  ),
  expected_revision bigint not null check (expected_revision >= 0),
  plan_hash text not null check (plan_hash ~ '^[a-f0-9]{64}$'),
  amount_minor bigint not null default 0 check (amount_minor >= 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  reason text check (reason is null or char_length(reason) between 1 and 500),
  actor_user_id uuid,
  actor_email text check (actor_email is null or char_length(actor_email) <= 254),
  status text not null default 'planned' check (
    status in ('planned', 'queued', 'provider_succeeded', 'review_required', 'completed', 'failed', 'retired')
  ),
  provider_idempotency_key text check (
    provider_idempotency_key is null or char_length(provider_idempotency_key) between 8 and 255
  ),
  provider_object_id text check (
    provider_object_id is null or char_length(provider_object_id) between 1 and 255
  ),
  provider_result jsonb check (
    provider_result is null
    or (
      jsonb_typeof(provider_result) = 'object'
      and octet_length(provider_result::text) <= 4096
      and not public.integration_json_has_forbidden_key(provider_result)
    )
  ),
  accounting_result jsonb check (
    accounting_result is null
    or (
      jsonb_typeof(accounting_result) = 'object'
      and octet_length(accounting_result::text) <= 4096
      and not public.integration_json_has_forbidden_key(accounting_result)
    )
  ),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and octet_length(snapshot::text) <= 65536
  ),
  integration_event_id uuid references public.integration_events(id) on delete restrict,
  confirmed_at timestamptz,
  provider_succeeded_at timestamptz,
  completed_at timestamptz,
  retirement_reason text,
  retired_by_user_id uuid,
  retired_by_email text,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, request_id)
);

-- Keep this schema replayable over an installation that already has the first version
-- of the command table. A retired command is terminal evidence; it is not a failed
-- provider attempt and cannot be resumed or reused as a cancellation plan.
alter table public.order_reversal_commands
  add column if not exists retirement_reason text,
  add column if not exists retired_by_user_id uuid,
  add column if not exists retired_by_email text,
  add column if not exists retired_at timestamptz;
alter table public.order_reversal_commands
  drop constraint if exists order_reversal_commands_status_check;
alter table public.order_reversal_commands
  add constraint order_reversal_commands_status_check check (
    status in ('planned', 'queued', 'provider_succeeded', 'review_required', 'completed', 'failed', 'retired')
  );
alter table public.order_reversal_commands
  drop constraint if exists order_reversal_commands_retirement_check;
alter table public.order_reversal_commands
  add constraint order_reversal_commands_retirement_check check (
    (
      status = 'retired'
      and retired_at is not null
      and retired_by_user_id is not null
      and retirement_reason is not null
      and char_length(btrim(retirement_reason)) between 8 and 500
      and (retired_by_email is null or char_length(retired_by_email) <= 254)
    )
    or (
      status <> 'retired'
      and retirement_reason is null
      and retired_by_user_id is null
      and retired_by_email is null
      and retired_at is null
    )
  );

create table if not exists public.order_reversal_lines (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.order_reversal_commands(id) on delete restrict,
  sku text not null check (char_length(btrim(sku)) between 1 and 160),
  qty integer not null check (qty > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  line_amount_minor bigint not null check (line_amount_minor >= 0),
  restock_qty integer not null default 0 check (restock_qty between 0 and qty),
  created_at timestamptz not null default now(),
  unique (command_id, sku)
);

create index if not exists order_reversal_commands_order_idx
  on public.order_reversal_commands (order_id, created_at desc);
drop index if exists public.order_reversal_commands_status_idx;
create index order_reversal_commands_status_idx
  on public.order_reversal_commands (status, created_at)
  where status not in ('completed', 'retired');
drop index if exists public.order_reversal_one_active_cancel_uidx;
create unique index order_reversal_one_active_cancel_uidx
  on public.order_reversal_commands (order_id)
  where type = 'cancel' and status in ('queued', 'provider_succeeded', 'review_required', 'failed');
create index if not exists order_reversal_lines_command_idx
  on public.order_reversal_lines (command_id);

create or replace function public.guard_order_reversal_command()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'order_reversal_command_append_only';
  end if;
  if new.id is distinct from old.id
     or new.order_id is distinct from old.order_id
     or new.type is distinct from old.type
     or new.request_id is distinct from old.request_id
     or new.expected_revision is distinct from old.expected_revision
     or new.plan_hash is distinct from old.plan_hash
     or new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency
     or new.reason is distinct from old.reason
     or new.actor_user_id is distinct from old.actor_user_id
     or new.actor_email is distinct from old.actor_email
     or new.provider_idempotency_key is distinct from old.provider_idempotency_key
     or new.snapshot is distinct from old.snapshot
     or new.created_at is distinct from old.created_at then
    raise exception 'order_reversal_command_identity_immutable';
  end if;
  if old.status = 'retired' and new is distinct from old then
    raise exception 'order_reversal_command_terminal';
  end if;
  if old.status = 'completed' and new.status is distinct from old.status then
    raise exception 'order_reversal_command_terminal';
  end if;
  if new.status = 'retired' and old.status <> 'retired' then
    if old.type <> 'cancel'
       or old.status <> 'review_required'
       or old.integration_event_id is not null
       or old.confirmed_at is not null
       or old.provider_object_id is not null
       or old.provider_result is not null
       or old.accounting_result is not null
       or exists (
         select 1
           from public.integration_effects as effect
          where effect.payload @> jsonb_build_object('command_id', old.id::text)
       )
       or new.retired_at is null
       or new.retired_by_user_id is null
       or new.retirement_reason is null
       or not (char_length(btrim(new.retirement_reason)) between 8 and 500) then
      raise exception 'cancellation_review_has_side_effects';
    end if;
  elsif new.retirement_reason is distinct from old.retirement_reason
     or new.retired_by_user_id is distinct from old.retired_by_user_id
     or new.retired_by_email is distinct from old.retired_by_email
     or new.retired_at is distinct from old.retired_at then
    raise exception 'order_reversal_retirement_immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists order_reversal_command_guard on public.order_reversal_commands;
create trigger order_reversal_command_guard
before update or delete on public.order_reversal_commands
for each row execute function public.guard_order_reversal_command();

create or replace function public.reject_order_reversal_line_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'order_reversal_lines_append_only';
end;
$$;

drop trigger if exists order_reversal_lines_append_only on public.order_reversal_lines;
create trigger order_reversal_lines_append_only
before update or delete on public.order_reversal_lines
for each row execute function public.reject_order_reversal_line_mutation();

-- One write barrier owns the fulfillment/cancellation race for every Order writer,
-- including provider projections. The updating statement already holds the Order row
-- lock, so confirmation either observes this revision or publishes its active command
-- before this trigger checks it. No provider migration needs to know reversal tables.
create or replace function public.guard_order_reversal_fulfillment_projection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_projection_changed boolean;
  v_advances_fulfillment boolean;
begin
  v_projection_changed :=
    new.tracking_status is distinct from old.tracking_status
    or new.tracking_number is distinct from old.tracking_number
    or new.carrier is distinct from old.carrier
    or new.tracking_url is distinct from old.tracking_url
    or new.estimated_delivery_at is distinct from old.estimated_delivery_at
    or new.shipped_at is distinct from old.shipped_at
    or (
      new.status is distinct from old.status
      and (new.status::text = 'fulfilled' or old.status::text = 'fulfilled')
    );
  if not v_projection_changed then return new; end if;

  v_advances_fulfillment :=
    new.status::text = 'fulfilled'
    or coalesce(new.tracking_status::text, '') in (
      'shipped', 'in_transit', 'out_for_delivery', 'delivered'
    );
  if v_advances_fulfillment and exists (
    select 1
      from public.order_reversal_commands as command
     where command.order_id = old.id
       and command.type = 'cancel'
       and command.status in ('queued', 'provider_succeeded', 'review_required', 'failed')
  ) then
    raise exception 'order_cancellation_in_progress';
  end if;

  -- Explicit guarded writers may already advance the revision. Direct/provider writers
  -- inherit the same CAS invalidation without duplicating reversal knowledge.
  if new.reversal_revision = old.reversal_revision then
    new.reversal_revision := old.reversal_revision + 1;
  elsif new.reversal_revision < old.reversal_revision + 1 then
    raise exception 'invalid_reversal_revision';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_reversal_fulfillment_guard on public.orders;
create trigger orders_reversal_fulfillment_guard
before update of status, tracking_status, tracking_number, carrier, tracking_url,
  estimated_delivery_at, shipped_at on public.orders
for each row execute function public.guard_order_reversal_fulfillment_projection();

-- Validate allocations against immutable sold prices plus every already claimed line.
-- Caller holds the parent Order row lock, serializing concurrent unequal commands.
create or replace function public.validate_order_reversal_lines(
  p_order_id uuid,
  p_lines jsonb,
  p_allocation_type text default 'amount'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_sku text;
  v_qty integer;
  v_unit_price_minor bigint;
  v_line_amount_minor bigint;
  v_restock_qty integer;
  v_order_qty integer;
  v_order_restock_qty integer;
  v_min_unit_price_minor bigint;
  v_max_unit_price_minor bigint;
  v_claimed_qty integer;
  v_claimed_restock_qty integer;
begin
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_reversal_lines';
  end if;
  if p_allocation_type not in ('amount', 'line', 'full', 'cancel_unsettled') then
    raise exception 'invalid_reversal_allocation_type';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as line(value)
     group by btrim(line.value ->> 'sku')
    having count(*) > 1
  ) then
    raise exception 'duplicate_reversal_line';
  end if;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    if jsonb_typeof(v_line) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_line) as key(name)
          where key.name not in ('sku', 'qty', 'unit_price_minor', 'line_amount_minor', 'restock_qty')
       ) then
      raise exception 'invalid_reversal_line';
    end if;
    begin
      v_sku := btrim(v_line ->> 'sku');
      v_qty := (v_line ->> 'qty')::integer;
      v_unit_price_minor := (v_line ->> 'unit_price_minor')::bigint;
      v_line_amount_minor := (v_line ->> 'line_amount_minor')::bigint;
      v_restock_qty := coalesce((v_line ->> 'restock_qty')::integer, 0);
    exception when others then
      raise exception 'invalid_reversal_line';
    end;
    if v_sku = '' or char_length(v_sku) > 160 or v_qty <= 0
       or v_unit_price_minor < 0
       or v_line_amount_minor <> v_unit_price_minor * v_qty
       or v_restock_qty < 0 or v_restock_qty > v_qty then
      raise exception 'invalid_reversal_line';
    end if;

    select coalesce(sum(item.qty), 0)::integer,
           coalesce(sum(item.qty) filter (where coalesce(item.backordered, false) = false), 0)::integer,
           min(round(item.unit_price * 100)::bigint),
           max(round(item.unit_price * 100)::bigint)
      into v_order_qty, v_order_restock_qty, v_min_unit_price_minor, v_max_unit_price_minor
      from public.order_items as item
     where item.order_id = p_order_id
       and item.sku = v_sku;
    if v_order_qty <= 0
       or v_min_unit_price_minor is distinct from v_max_unit_price_minor
       or v_unit_price_minor is distinct from v_min_unit_price_minor then
      raise exception 'reversal_line_not_sold';
    end if;

    select coalesce(sum(line.qty), 0)::integer,
           coalesce(sum(line.restock_qty), 0)::integer
      into v_claimed_qty, v_claimed_restock_qty
      from public.order_reversal_lines as line
      join public.order_reversal_commands as command on command.id = line.command_id
     where command.order_id = p_order_id
       and line.sku = v_sku
       and command.status in ('queued', 'provider_succeeded', 'review_required', 'completed', 'failed');
    if v_qty > v_order_qty - v_claimed_qty
       or v_restock_qty > v_order_restock_qty - v_claimed_restock_qty then
      raise exception 'reversal_line_capacity_exceeded';
    end if;
  end loop;

  if p_allocation_type = 'line'
     and jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'refund_lines_required';
  end if;
  if p_allocation_type in ('full', 'cancel_unsettled') and exists (
    with sold as (
      select item.sku,
             sum(item.qty)::integer as qty,
             coalesce(sum(item.qty) filter (where coalesce(item.backordered, false) = false), 0)::integer as restock_qty
        from public.order_items item
       where item.order_id = p_order_id
       group by item.sku
    ), claimed as (
      select line.sku,
             sum(line.qty)::integer as qty,
             sum(line.restock_qty)::integer as restock_qty
        from public.order_reversal_lines line
        join public.order_reversal_commands command on command.id = line.command_id
       where command.order_id = p_order_id
         and command.status in ('queued', 'provider_succeeded', 'review_required', 'completed', 'failed')
       group by line.sku
    ), supplied as (
      select btrim(line.value ->> 'sku') as sku,
             sum((line.value ->> 'qty')::integer)::integer as qty,
             sum(coalesce((line.value ->> 'restock_qty')::integer, 0))::integer as restock_qty
        from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) line(value)
       group by btrim(line.value ->> 'sku')
    )
    select 1
      from sold
      left join claimed using (sku)
      left join supplied using (sku)
     where coalesce(supplied.qty, 0) <> greatest(sold.qty - coalesce(claimed.qty, 0), 0)
        or coalesce(supplied.restock_qty, 0) <> case
          when p_allocation_type = 'cancel_unsettled' then 0
          else greatest(sold.restock_qty - coalesce(claimed.restock_qty, 0), 0)
        end
  ) then
    raise exception 'reversal_full_allocation_required';
  end if;
end;
$$;

-- Bind an application-generated effect graph to the command created under lock. Only
-- command/order identity enters the outbox; money, lines, recipient, and accounting state
-- remain in the immutable service-only command snapshot.
create or replace function public.bind_order_reversal_effects(
  p_effects jsonb,
  p_command_id uuid,
  p_order_id uuid,
  p_command_type text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect jsonb;
  v_payload jsonb;
  v_type text;
  v_bound jsonb := '[]'::jsonb;
  v_command_snapshot jsonb;
  v_expected_label_ids text[];
  v_effect_label_ids text[];
  v_label_count integer;
begin
  if jsonb_typeof(coalesce(p_effects, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_reversal_effects';
  end if;
  select command.snapshot into v_command_snapshot
    from public.order_reversal_commands command
   where command.id = p_command_id
     and command.order_id = p_order_id
     and command.type = p_command_type;
  if not found then raise exception 'reversal_command_not_found'; end if;
  for v_effect in select value from jsonb_array_elements(coalesce(p_effects, '[]'::jsonb))
  loop
    v_payload := v_effect -> 'payload';
    v_type := v_effect ->> 'effect_type';
    if jsonb_typeof(v_effect) <> 'object'
       or jsonb_typeof(v_payload) <> 'object'
       or v_payload ->> 'order_id' is distinct from p_order_id::text
       or exists (
         select 1 from jsonb_object_keys(v_payload) as key(name)
          where key.name not in ('order_id', 'command_id', 'label_id', 'reason')
       ) then
      raise exception 'invalid_reversal_effect';
    end if;
    if p_command_type = 'refund'
       and v_type not in (
         'order_refund', 'order_restock', 'order_accounting_reversal',
         'order_refund_email', 'order_reversal_complete'
       ) then
      raise exception 'invalid_refund_effect';
    end if;
    if p_command_type = 'cancel'
       and v_type not in (
         'order_label_void', 'order_refund', 'order_restock', 'order_accounting_reversal',
         'order_cancelled', 'order_cancellation_email', 'order_reversal_complete'
       ) then
      raise exception 'invalid_cancellation_effect';
    end if;
    v_effect := jsonb_set(v_effect, '{payload,command_id}', to_jsonb(p_command_id::text), true);
    v_bound := v_bound || jsonb_build_array(v_effect);
  end loop;

  if p_command_type = 'refund' and (
    jsonb_array_length(v_bound) <> 5
    or (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_refund') <> 1
    or (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_restock') <> 1
    or (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_accounting_reversal') <> 1
    or (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_refund_email') <> 1
    or (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_reversal_complete') <> 1
  ) then
    raise exception 'incomplete_refund_effect_graph';
  end if;
  if p_command_type = 'refund' and exists (
    select 1 from jsonb_array_elements(v_bound) effect(value)
     where case effect.value ->> 'effect_type'
       when 'order_refund' then effect.value ->> 'effect_key' is distinct from 'stripe-refund'
         or effect.value ->> 'depends_on_effect_key' is not null
       when 'order_restock' then effect.value ->> 'effect_key' is distinct from 'order-restock'
         or effect.value ->> 'depends_on_effect_key' is distinct from 'stripe-refund'
       when 'order_accounting_reversal' then effect.value ->> 'effect_key' is distinct from 'accounting-reversal'
         or effect.value ->> 'depends_on_effect_key' is distinct from 'order-restock'
       when 'order_reversal_complete' then effect.value ->> 'effect_key' is distinct from 'reversal-complete'
         or effect.value ->> 'depends_on_effect_key' is distinct from 'accounting-reversal'
       when 'order_refund_email' then effect.value ->> 'effect_key' is distinct from 'refund-email'
         or effect.value ->> 'depends_on_effect_key' is distinct from 'reversal-complete'
       else true
     end
  ) then
    raise exception 'reversal_effect_dependency_invalid';
  end if;
  if p_command_type = 'cancel' and (
    (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_label_void') < 1
    or (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_refund') <> 1
    or (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_restock') <> 1
    or (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_accounting_reversal') <> 1
    or (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_cancelled') <> 1
    or (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_cancellation_email') <> 1
    or (select count(*) from jsonb_array_elements(v_bound) e where e ->> 'effect_type' = 'order_reversal_complete') <> 1
  ) then
    raise exception 'incomplete_cancellation_effect_graph';
  end if;
  if p_command_type = 'cancel' then
    select coalesce(array_agg(label_id order by label_id), array[]::text[])
      into v_expected_label_ids
      from (
        select distinct btrim(item ->> 'label_id') as label_id
          from jsonb_array_elements(coalesce(v_command_snapshot -> 'labels', '[]'::jsonb)) item
         where nullif(btrim(item ->> 'label_id'), '') is not null
      ) expected;
    select coalesce(array_agg(label_id order by label_id), array[]::text[])
      into v_effect_label_ids
      from (
        select distinct btrim(effect.value #>> '{payload,label_id}') as label_id
          from jsonb_array_elements(v_bound) effect(value)
         where effect.value ->> 'effect_type' = 'order_label_void'
           and nullif(btrim(effect.value #>> '{payload,label_id}'), '') is not null
      ) supplied;
    v_label_count := coalesce(array_length(v_expected_label_ids, 1), 0);
    if v_effect_label_ids is distinct from v_expected_label_ids
       or (select count(*) from jsonb_array_elements(v_bound) effect(value)
            where effect.value ->> 'effect_type' = 'order_label_void') <> greatest(v_label_count, 1) then
      raise exception 'cancellation_label_effect_mismatch';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(v_bound) with ordinality effect(value, position)
       where effect.value ->> 'effect_type' = 'order_label_void'
         and (
           effect.value ->> 'effect_key' is distinct from 'label-void-' || effect.position::text
           or effect.value ->> 'depends_on_effect_key' is distinct from case
             when effect.position = 1 then null
             else 'label-void-' || (effect.position - 1)::text
           end
         )
    ) or exists (
      select 1 from jsonb_array_elements(v_bound) effect(value)
       where case effect.value ->> 'effect_type'
         when 'order_label_void' then false
         when 'order_refund' then effect.value ->> 'effect_key' is distinct from 'stripe-refund'
           or effect.value ->> 'depends_on_effect_key' is distinct from 'label-void-' || greatest(v_label_count, 1)::text
         when 'order_restock' then effect.value ->> 'effect_key' is distinct from 'order-restock'
           or effect.value ->> 'depends_on_effect_key' is distinct from 'stripe-refund'
         when 'order_accounting_reversal' then effect.value ->> 'effect_key' is distinct from 'accounting-reversal'
           or effect.value ->> 'depends_on_effect_key' is distinct from 'order-restock'
         when 'order_cancelled' then effect.value ->> 'effect_key' is distinct from 'order-cancelled'
           or effect.value ->> 'depends_on_effect_key' is distinct from 'accounting-reversal'
         when 'order_cancellation_email' then effect.value ->> 'effect_key' is distinct from 'cancellation-email'
           or effect.value ->> 'depends_on_effect_key' is distinct from 'order-cancelled'
         when 'order_reversal_complete' then effect.value ->> 'effect_key' is distinct from 'reversal-complete'
           or effect.value ->> 'depends_on_effect_key' is distinct from 'cancellation-email'
         else true
       end
    ) then
      raise exception 'reversal_effect_dependency_invalid';
    end if;
  end if;
  return v_bound;
end;
$$;

create or replace function public.claim_order_refund_command(
  p_command_id uuid,
  p_order_id uuid,
  p_request_id text,
  p_expected_revision bigint,
  p_amount_minor bigint,
  p_currency text,
  p_plan_hash text,
  p_snapshot jsonb,
  p_lines jsonb,
  p_actor_user_id uuid,
  p_actor_email text,
  p_effects jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_command public.order_reversal_commands%rowtype;
  v_line jsonb;
  v_refunded_minor bigint;
  v_total_minor bigint;
  v_claimed_minor bigint;
  v_line_total_minor bigint;
  v_effects jsonb;
  v_event_id uuid;
  v_allocation_type text;
begin
  if p_command_id is null or p_order_id is null
     or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
     or p_expected_revision < 0 or p_amount_minor <= 0
     or p_currency !~ '^[a-z]{3}$'
     or p_plan_hash !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_snapshot) <> 'object'
     or coalesce(p_snapshot #>> '{accounting,action}', '') not in ('credit_memo', 'skip')
     or p_snapshot ->> 'order_id' is distinct from p_order_id::text then
    raise exception 'invalid_refund_command';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  select * into v_command
    from public.order_reversal_commands
   where order_id = p_order_id and request_id = p_request_id
   for update;
  if found then
    if v_command.type <> 'refund'
       or v_command.plan_hash <> p_plan_hash
       or v_command.amount_minor <> p_amount_minor
       or v_command.currency <> p_currency then
      raise exception 'reversal_request_identity_collision';
    end if;
    return to_jsonb(v_command);
  end if;

  if v_order.reversal_revision <> p_expected_revision then
    raise exception 'stale_order_revision';
  end if;
  if v_order.status::text not in ('paid', 'fulfilled')
     or v_order.payment_method::text <> 'stripe'
     or nullif(v_order.stripe_payment_intent, '') is null then
    raise exception 'order_not_refundable';
  end if;

  v_total_minor := round(v_order.total * 100)::bigint;
  v_refunded_minor := round(coalesce(v_order.refunded_amount, 0) * 100)::bigint;
  select coalesce(sum(command.amount_minor), 0)::bigint
    into v_claimed_minor
    from public.order_reversal_commands as command
   where command.order_id = p_order_id
     and command.amount_minor > 0
     -- provider_succeeded money is already present in orders.refunded_amount; counting
     -- that command here would reserve the same cents twice.
     and command.status in ('queued', 'review_required', 'failed');
  if p_amount_minor > v_total_minor - v_refunded_minor - v_claimed_minor then
    raise exception 'refund_capacity_exceeded';
  end if;
  if (p_snapshot ->> 'total_minor')::bigint is distinct from v_total_minor
     or (p_snapshot ->> 'refunded_before_minor')::bigint is distinct from v_refunded_minor
     or p_snapshot ->> 'stripe_payment_intent' is distinct from v_order.stripe_payment_intent then
    raise exception 'refund_snapshot_stale';
  end if;

  v_allocation_type := coalesce(nullif(p_snapshot ->> 'allocation_type', ''), 'amount');
  if p_amount_minor = v_total_minor - v_refunded_minor - v_claimed_minor
     and v_allocation_type <> 'full' then
    raise exception 'refund_full_balance_requires_full_command';
  end if;
  perform public.validate_order_reversal_lines(p_order_id, p_lines, v_allocation_type);
  if v_allocation_type = 'line' then
    select coalesce(sum((line.value ->> 'line_amount_minor')::bigint), 0)
      into v_line_total_minor
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as line(value);
    if v_line_total_minor <> p_amount_minor then
      raise exception 'refund_line_amount_mismatch';
    end if;
  end if;

  insert into public.order_reversal_commands (
    id, order_id, type, request_id, expected_revision, plan_hash, amount_minor, currency,
    actor_user_id, actor_email, status, provider_idempotency_key, snapshot, confirmed_at
  ) values (
    p_command_id, p_order_id, 'refund', p_request_id, p_expected_revision, p_plan_hash,
    p_amount_minor, p_currency, p_actor_user_id, nullif(lower(btrim(p_actor_email)), ''),
    'queued', 'order-refund:' || p_order_id::text || ':' || p_request_id, p_snapshot, now()
  ) returning * into v_command;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into public.order_reversal_lines (
      command_id, sku, qty, unit_price_minor, line_amount_minor, restock_qty
    ) values (
      v_command.id,
      btrim(v_line ->> 'sku'),
      (v_line ->> 'qty')::integer,
      (v_line ->> 'unit_price_minor')::bigint,
      (v_line ->> 'line_amount_minor')::bigint,
      coalesce((v_line ->> 'restock_qty')::integer, 0)
    );
  end loop;

  update public.orders
     set reversal_revision = reversal_revision + 1,
         updated_at = now()
   where id = p_order_id;

  v_effects := public.bind_order_reversal_effects(p_effects, v_command.id, p_order_id, 'refund');
  v_event_id := public.ingest_integration_event(
    'masest', 'production', 'order-reversal:' || v_command.id::text,
    'order.reversal.refund', v_command.id::text, now(), now(), p_plan_hash,
    jsonb_build_object('source', 'admin_order_command', 'command_type', 'refund'),
    v_effects
  );
  update public.order_reversal_commands
     set integration_event_id = v_event_id
   where id = v_command.id
  returning * into v_command;
  return to_jsonb(v_command);
end;
$$;

create or replace function public.create_order_cancellation_plan(
  p_command_id uuid,
  p_order_id uuid,
  p_request_id text,
  p_expected_revision bigint,
  p_amount_minor bigint,
  p_currency text,
  p_plan_hash text,
  p_snapshot jsonb,
  p_lines jsonb,
  p_reason text,
  p_actor_user_id uuid,
  p_actor_email text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_command public.order_reversal_commands%rowtype;
  v_line jsonb;
  v_total_minor bigint;
  v_refunded_minor bigint;
  v_expected_amount_minor bigint;
begin
  if p_command_id is null or p_order_id is null
     or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
     or p_expected_revision < 0 or p_amount_minor < 0
     or p_currency !~ '^[a-z]{3}$'
     or p_plan_hash !~ '^[a-f0-9]{64}$'
     or p_reason is null
     or not (char_length(btrim(p_reason)) between 8 and 500)
     or jsonb_typeof(p_snapshot) <> 'object'
     or p_snapshot ->> 'order_id' is distinct from p_order_id::text then
    raise exception 'invalid_cancellation_plan';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.reversal_revision <> p_expected_revision then raise exception 'stale_order_revision'; end if;
  if v_order.status in ('cart', 'cancelled', 'refunded') then raise exception 'order_not_cancellable'; end if;
  v_total_minor := round(v_order.total * 100)::bigint;
  v_refunded_minor := round(coalesce(v_order.refunded_amount, 0) * 100)::bigint;
  v_expected_amount_minor := case
    when v_order.payment_method::text = 'stripe'
      and v_order.status::text in ('paid', 'fulfilled')
      and nullif(v_order.stripe_payment_intent, '') is not null
      then v_total_minor - v_refunded_minor
    else 0
  end;
  if v_refunded_minor < 0 or v_refunded_minor > v_total_minor
     or p_amount_minor is distinct from v_expected_amount_minor
     or (p_snapshot ->> 'total_minor')::bigint is distinct from v_total_minor
     or (p_snapshot ->> 'refunded_before_minor')::bigint is distinct from v_refunded_minor
     or p_snapshot ->> 'status' is distinct from v_order.status::text
     or p_snapshot ->> 'payment_method' is distinct from v_order.payment_method::text then
    raise exception 'cancellation_refund_snapshot_stale';
  end if;

  select * into v_command
    from public.order_reversal_commands
   where order_id = p_order_id and request_id = p_request_id
   for update;
  if found then
    if v_command.type <> 'cancel' or v_command.plan_hash <> p_plan_hash then
      raise exception 'reversal_request_identity_collision';
    end if;
    return to_jsonb(v_command);
  end if;

  perform public.validate_order_reversal_lines(
    p_order_id,
    p_lines,
    case when v_order.status::text in ('paid', 'net_open', 'net_paid', 'fulfilled')
      then 'full' else 'cancel_unsettled' end
  );
  insert into public.order_reversal_commands (
    id, order_id, type, request_id, expected_revision, plan_hash, amount_minor, currency,
    reason, actor_user_id, actor_email, status, provider_idempotency_key, snapshot
  ) values (
    p_command_id, p_order_id, 'cancel', p_request_id, p_expected_revision, p_plan_hash,
    p_amount_minor, p_currency, nullif(left(btrim(p_reason), 500), ''),
    p_actor_user_id, nullif(lower(btrim(p_actor_email)), ''), 'planned',
    case when p_amount_minor > 0 then 'order-refund:' || p_order_id::text || ':' || p_request_id else null end,
    p_snapshot
  ) returning * into v_command;
  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into public.order_reversal_lines (
      command_id, sku, qty, unit_price_minor, line_amount_minor, restock_qty
    ) values (
      v_command.id, btrim(v_line ->> 'sku'), (v_line ->> 'qty')::integer,
      (v_line ->> 'unit_price_minor')::bigint, (v_line ->> 'line_amount_minor')::bigint,
      coalesce((v_line ->> 'restock_qty')::integer, 0)
    );
  end loop;
  return to_jsonb(v_command);
end;
$$;

create or replace function public.confirm_order_cancellation_command(
  p_command_id uuid,
  p_effects jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_command public.order_reversal_commands%rowtype;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_effects jsonb;
  v_event_id uuid;
  v_action text;
  v_planned_label_ids text[];
  v_active_label_ids text[];
begin
  -- Resolve the command's immutable owner without locking it, then follow the
  -- domain-wide Order-before-command lock order used by claim/create/replay paths.
  select command.order_id into v_order_id
    from public.order_reversal_commands as command
   where command.id = p_command_id and command.type = 'cancel';
  if not found then raise exception 'cancellation_command_not_found'; end if;

  select * into v_order from public.orders where id = v_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  select * into v_command
    from public.order_reversal_commands
   where id = p_command_id and order_id = v_order.id and type = 'cancel'
   for update;
  if not found then raise exception 'cancellation_command_not_found'; end if;
  if v_command.status in ('queued', 'provider_succeeded', 'completed') then
    return to_jsonb(v_command);
  end if;
  if v_command.status <> 'planned' then raise exception 'cancellation_command_not_confirmable'; end if;
  if v_order.reversal_revision <> v_command.expected_revision then raise exception 'stale_order_revision'; end if;
  if v_order.status in ('cart', 'cancelled', 'refunded') then raise exception 'order_not_cancellable'; end if;
  if (v_command.snapshot ->> 'refunded_before_minor')::bigint
       is distinct from round(coalesce(v_order.refunded_amount, 0) * 100)::bigint then
    raise exception 'cancellation_refund_snapshot_stale';
  end if;
  if exists (
    select 1 from public.order_reversal_commands as other
     where other.order_id = v_order.id and other.id <> v_command.id
       and other.status in ('queued', 'provider_succeeded', 'review_required', 'failed')
  ) then
    raise exception 'order_reversal_in_progress';
  end if;
  if v_order.status::text = 'fulfilled'
     or coalesce(v_order.tracking_status::text, '') in ('shipped', 'in_transit', 'out_for_delivery', 'delivered')
     or coalesce(v_command.snapshot -> 'blockers', '[]'::jsonb) ? 'shipment_in_transit' then
    raise exception 'shipment_in_transit';
  end if;

  -- The preview is immutable, but fulfillment can change between preview and confirm.
  -- Order locking serializes this check with shipment/label claims. Refuse any changed
  -- canonical label set or an in-flight purchase whose provider result is not yet linked;
  -- otherwise an unplanned label could remain active while money and stock reverse.
  select coalesce(array_agg(label_id order by label_id), array[]::text[])
    into v_planned_label_ids
    from (
      select distinct btrim(item ->> 'label_id') as label_id
        from jsonb_array_elements(coalesce(v_command.snapshot -> 'labels', '[]'::jsonb)) item
       where nullif(btrim(item ->> 'label_id'), '') is not null
    ) planned;
  select coalesce(array_agg(label_id order by label_id), array[]::text[])
    into v_active_label_ids
    from (
      select distinct ownership.label_id
        from public.order_shipment_label_ownership ownership
       where ownership.order_id = v_order.id
         and ownership.label_kind = 'outbound'
         and ownership.active
    ) active_labels;
  if v_planned_label_ids is distinct from v_active_label_ids
     or exists (
       select 1
         from public.shipstation_operation_attempts attempt
        where attempt.order_id = v_order.id
          and attempt.operation = 'label_purchase'
          and attempt.status in ('claimed', 'provider_succeeded', 'reconcile_required')
     ) then
    raise exception 'cancellation_label_set_stale';
  end if;

  v_action := v_command.snapshot #>> '{accounting,action}';
  if v_action = 'review' then
    update public.order_reversal_commands set status = 'review_required' where id = v_command.id
    returning * into v_command;
    return to_jsonb(v_command) || jsonb_build_object('error', 'accounting_review_required');
  end if;
  if v_action = 'skip_pending_invoice'
     and (v_order.qbo_sync_status::text = 'processing'
          or nullif(v_order.qbo_doc_id, '') is not null
          or nullif(v_order.qbo_payment_id, '') is not null) then
    update public.order_reversal_commands set status = 'review_required' where id = v_command.id
    returning * into v_command;
    return to_jsonb(v_command) || jsonb_build_object('error', 'accounting_review_required');
  end if;

  v_effects := public.bind_order_reversal_effects(p_effects, v_command.id, v_command.order_id, 'cancel');
  v_event_id := public.ingest_integration_event(
    'masest', 'production', 'order-reversal:' || v_command.id::text,
    'order.reversal.cancel', v_command.id::text, now(), now(), v_command.plan_hash,
    jsonb_build_object('source', 'admin_order_command', 'command_type', 'cancel'),
    v_effects
  );
  update public.orders
     set reversal_revision = reversal_revision + 1,
         updated_at = now()
   where id = v_order.id;
  update public.order_reversal_commands
     set status = 'queued', integration_event_id = v_event_id, confirmed_at = now()
   where id = v_command.id
  returning * into v_command;
  return to_jsonb(v_command);
end;
$$;

-- Accounting review is intentionally not resumable from a stale snapshot. Staff may
-- retire the untouched command after resolving or abandoning the accounting issue,
-- then must create a fresh plan against the current Order revision. The command and
-- its audit evidence remain append-only.
create or replace function public.retire_order_cancellation_review(
  p_order_id uuid,
  p_command_id uuid,
  p_reason text,
  p_actor_user_id uuid,
  p_actor_email text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_command public.order_reversal_commands%rowtype;
  v_order_id uuid;
begin
  if p_order_id is null
     or p_command_id is null
     or p_actor_user_id is null
     or not (char_length(btrim(coalesce(p_reason, ''))) between 8 and 500)
     or (p_actor_email is not null and char_length(btrim(p_actor_email)) > 254) then
    raise exception 'invalid_cancellation_review_retirement';
  end if;

  -- Resolve immutable ownership without taking a command lock, then use the domain-wide
  -- Order-before-command lock order. The append-only trigger and FK make this lookup stable.
  select command.order_id into v_order_id
    from public.order_reversal_commands as command
   where command.id = p_command_id
     and command.order_id = p_order_id
     and command.type = 'cancel';
  if not found then raise exception 'cancellation_command_not_found'; end if;

  select * into v_order
    from public.orders
   where id = v_order_id
   for update;
  if not found then raise exception 'order_not_found'; end if;

  select * into v_command
    from public.order_reversal_commands
   where id = p_command_id
     and order_id = v_order.id
     and type = 'cancel'
   for update;
  if not found then raise exception 'cancellation_command_not_found'; end if;
  if v_command.status = 'retired' then return to_jsonb(v_command); end if;
  if v_command.status <> 'review_required' then
    raise exception 'cancellation_review_not_retirable';
  end if;
  if coalesce(v_command.snapshot #>> '{accounting,action}', '') not in ('review', 'skip_pending_invoice')
     or v_command.integration_event_id is not null
     or v_command.confirmed_at is not null
     or v_command.provider_object_id is not null
     or v_command.provider_result is not null
     or v_command.accounting_result is not null
     or exists (
       select 1
         from public.integration_effects as effect
        where effect.payload @> jsonb_build_object('command_id', v_command.id::text)
     ) then
    raise exception 'cancellation_review_has_side_effects';
  end if;

  update public.order_reversal_commands
     set status = 'retired',
         retirement_reason = btrim(p_reason),
         retired_by_user_id = p_actor_user_id,
         retired_by_email = nullif(lower(btrim(p_actor_email)), ''),
         retired_at = now()
   where id = v_command.id
  returning * into v_command;

  update public.orders
     set reversal_revision = reversal_revision + 1,
         updated_at = now()
   where id = v_order.id;

  insert into public.audit_log (
    actor_user_id, actor_email, action, target_type, target_id, detail
  ) values (
    p_actor_user_id, nullif(lower(btrim(p_actor_email)), ''),
    'order.cancellation_review_retired', 'order', v_order.id::text,
    jsonb_build_object(
      'command_id', v_command.id,
      'previous_status', 'review_required',
      'reason', v_command.retirement_reason,
      'fresh_preflight_required', true
    )
  );
  return to_jsonb(v_command);
end;
$$;

create or replace function public.record_order_refund_provider_success(
  p_command_id uuid,
  p_stripe_refund_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_command public.order_reversal_commands%rowtype;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_refunded_minor bigint;
  v_total_minor bigint;
  v_result jsonb;
  v_refund_already_projected boolean;
begin
  if p_command_id is null
     or nullif(btrim(p_stripe_refund_id), '') is null
     or char_length(p_stripe_refund_id) > 255 then
    raise exception 'invalid_refund_provider_success';
  end if;

  select command.order_id into v_order_id
    from public.order_reversal_commands as command
   where command.id = p_command_id;
  if not found then raise exception 'invalid_refund_provider_success'; end if;

  select * into v_order from public.orders where id = v_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  select * into v_command
    from public.order_reversal_commands
   where id = p_command_id and order_id = v_order.id
   for update;
  if not found or v_command.status not in ('queued', 'provider_succeeded')
     or v_command.amount_minor <= 0 then
    raise exception 'invalid_refund_provider_success';
  end if;
  if v_command.provider_object_id is not null then
    if v_command.provider_object_id is distinct from btrim(p_stripe_refund_id) then
      raise exception 'refund_provider_identity_collision';
    end if;
    return coalesce(v_command.provider_result, '{}'::jsonb);
  end if;
  select exists (
    select 1
      from public.order_provider_links as link
     where link.order_id = v_order.id
       and link.provider = 'stripe'
       and link.object_type = 'refund'
       and link.provider_object_id = btrim(p_stripe_refund_id)
  ) into v_refund_already_projected;
  if v_refund_already_projected then
    -- charge.refunded links each refund before writing Stripe's aggregate projection.
    -- Never add the same refund twice; retain at least this command's claimed baseline
    -- while the webhook finishes its absolute aggregate update.
    v_refunded_minor := greatest(
      round(coalesce(v_order.refunded_amount, 0) * 100)::bigint,
      coalesce((v_command.snapshot ->> 'refunded_before_minor')::bigint, 0) + v_command.amount_minor
    );
  else
    v_refunded_minor := round(coalesce(v_order.refunded_amount, 0) * 100)::bigint + v_command.amount_minor;
  end if;
  v_total_minor := round(v_order.total * 100)::bigint;
  if v_refunded_minor > v_total_minor then raise exception 'refund_projection_exceeds_total'; end if;

  v_result := jsonb_build_object(
    'command_id', v_command.id,
    'stripe_refund_id', btrim(p_stripe_refund_id),
    'amount_minor', v_command.amount_minor,
    'fully_refunded', v_refunded_minor >= v_total_minor
  );
  update public.orders
     set refunded_amount = v_refunded_minor::numeric / 100,
         updated_at = now()
   where id = v_order.id;
  update public.order_reversal_commands
     set status = 'provider_succeeded',
         provider_object_id = btrim(p_stripe_refund_id),
         provider_result = v_result,
         provider_succeeded_at = now()
   where id = v_command.id;
  perform public.link_order_provider_object(
    v_order.id, 'stripe', 'refund', btrim(p_stripe_refund_id),
    jsonb_build_object('order_number', v_order.order_number, 'amount_minor', v_command.amount_minor)
  );
  return v_result;
end;
$$;

create or replace function public.record_order_accounting_reversal_success(
  p_command_id uuid,
  p_action text,
  p_provider_object_id text default null,
  p_result jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_command public.order_reversal_commands%rowtype;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_expected_action text;
  v_result jsonb;
begin
  select command.order_id into v_order_id
    from public.order_reversal_commands as command
   where command.id = p_command_id;
  if not found then raise exception 'invalid_accounting_reversal_command'; end if;

  select * into v_order from public.orders where id = v_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  select * into v_command
    from public.order_reversal_commands
   where id = p_command_id and order_id = v_order.id
   for update;
  if not found or v_command.status not in ('queued', 'provider_succeeded') then
    raise exception 'invalid_accounting_reversal_command';
  end if;
  v_expected_action := v_command.snapshot #>> '{accounting,action}';
  if p_action is distinct from v_expected_action
     or p_action not in ('credit_memo', 'void_invoice', 'skip_pending_invoice', 'skip')
     or jsonb_typeof(coalesce(p_result, '{}'::jsonb)) <> 'object'
     or public.integration_json_has_forbidden_key(coalesce(p_result, '{}'::jsonb)) then
    raise exception 'accounting_reversal_identity_collision';
  end if;
  if v_command.accounting_result is not null then return v_command.accounting_result; end if;

  if p_action = 'credit_memo' then
    if v_command.provider_object_id is null then raise exception 'refund_provider_identity_missing'; end if;
    insert into public.qbo_refunds (order_id, amount, fully_refunded, stripe_refund_id)
    values (
      v_order.id,
      v_command.amount_minor::numeric / 100,
      coalesce((v_command.provider_result ->> 'fully_refunded')::boolean, false),
      v_command.provider_object_id
    ) on conflict (stripe_refund_id) do nothing;
  elsif p_action = 'void_invoice' then
    if nullif(btrim(p_provider_object_id), '') is null
       or btrim(p_provider_object_id) is distinct from coalesce(v_order.qbo_doc_id, v_order.qbo_invoice_id)
       or nullif(v_order.qbo_payment_id, '') is not null then
      raise exception 'accounting_review_required';
    end if;
    update public.orders
       set qbo_sync_status = 'skipped', qbo_error = null, qbo_next_attempt_at = null, updated_at = now()
     where id = v_order.id;
    perform public.link_order_provider_object(
      v_order.id, 'quickbooks', 'invoice_void', btrim(p_provider_object_id),
      jsonb_build_object('command_id', v_command.id)
    );
  elsif p_action = 'skip_pending_invoice' then
    if v_order.qbo_sync_status::text = 'processing'
       or nullif(v_order.qbo_doc_id, '') is not null
       or nullif(v_order.qbo_payment_id, '') is not null then
      raise exception 'accounting_review_required';
    end if;
    update public.orders
       set qbo_sync_status = 'skipped', qbo_error = null, qbo_next_attempt_at = null, updated_at = now()
     where id = v_order.id;
  end if;

  v_result := jsonb_build_object(
    'command_id', v_command.id,
    'action', p_action,
    'provider_object_id', nullif(btrim(p_provider_object_id), ''),
    'result', coalesce(p_result, '{}'::jsonb)
  );
  update public.order_reversal_commands
     set accounting_result = v_result
   where id = v_command.id;
  return v_result;
end;
$$;

-- Manual Order creation is one transaction: header, historical lines, stock claim, and
-- any supplied QuickBooks identities either all commit or all roll back.
create or replace function public.create_manual_order_atomic(
  p_order jsonb,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_company_id uuid;
  v_status public.order_status;
  v_payment_method public.payment_method;
  v_subtotal numeric;
  v_shipping numeric;
  v_tax numeric;
  v_total numeric;
  v_currency text;
  v_customer_email text;
  v_invoice_id text;
  v_payment_id text;
  v_item jsonb;
  v_sku text;
  v_product_sku text;
  v_name text;
  v_qty integer;
  v_unit_price numeric;
  v_line_total numeric;
  v_backordered boolean;
  v_item_sum numeric := 0;
  v_stock record;
begin
  if coalesce(jsonb_typeof(p_order), '') <> 'object' then
    raise exception 'invalid_manual_order';
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' then
    raise exception 'invalid_manual_order_items';
  end if;
  if jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid_manual_order_items';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_order) as key(name)
     where key.name not in (
       'company_id', 'customer_email', 'status', 'payment_method', 'subtotal',
       'shipping', 'tax', 'total', 'currency', 'qbo_invoice_id', 'qbo_payment_id'
     )
  ) then
    raise exception 'invalid_manual_order';
  end if;

  begin
    v_company_id := nullif(p_order ->> 'company_id', '')::uuid;
    v_status := nullif(p_order ->> 'status', '')::public.order_status;
    v_payment_method := nullif(p_order ->> 'payment_method', '')::public.payment_method;
    v_subtotal := (p_order ->> 'subtotal')::numeric;
    v_shipping := coalesce((p_order ->> 'shipping')::numeric, 0);
    v_tax := coalesce((p_order ->> 'tax')::numeric, 0);
    v_total := (p_order ->> 'total')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_manual_order';
  end;
  v_currency := lower(btrim(coalesce(p_order ->> 'currency', '')));
  v_customer_email := nullif(lower(btrim(p_order ->> 'customer_email')), '');
  v_invoice_id := nullif(btrim(p_order ->> 'qbo_invoice_id'), '');
  v_payment_id := nullif(btrim(p_order ->> 'qbo_payment_id'), '');

  if v_status is null or v_payment_method is null
     or v_subtotal is null or v_shipping is null or v_tax is null or v_total is null
     or v_status::text not in ('pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled')
     or (v_payment_method::text = 'net' and v_status::text not in ('net_open', 'net_paid', 'fulfilled'))
     or (v_payment_method::text = 'stripe' and v_status::text not in ('pending_payment', 'paid', 'fulfilled'))
     or v_currency !~ '^[a-z]{3}$'
     or v_subtotal < 0 or v_shipping < 0 or v_tax < 0 or v_total < 0
     or v_subtotal <> round(v_subtotal, 2)
     or v_shipping <> round(v_shipping, 2)
     or v_tax <> round(v_tax, 2)
     or v_total <> round(v_total, 2)
     or v_total <> v_subtotal + v_shipping + v_tax
     or (v_customer_email is not null and (
       char_length(v_customer_email) > 254
       or v_customer_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     ))
     or (v_invoice_id is not null and char_length(v_invoice_id) > 80)
     or (v_payment_id is not null and char_length(v_payment_id) > 80) then
    raise exception 'invalid_manual_order';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_item) as key(name)
          where key.name not in (
            'sku', 'product_sku', 'name', 'qty', 'unit_price', 'line_total', 'backordered'
          )
       ) then
      raise exception 'invalid_manual_order_item';
    end if;
    begin
      v_sku := btrim(v_item ->> 'sku');
      v_product_sku := nullif(btrim(v_item ->> 'product_sku'), '');
      v_name := btrim(v_item ->> 'name');
      v_qty := (v_item ->> 'qty')::integer;
      v_unit_price := (v_item ->> 'unit_price')::numeric;
      v_line_total := (v_item ->> 'line_total')::numeric;
      v_backordered := coalesce((v_item ->> 'backordered')::boolean, false);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_manual_order_item';
    end;
    if v_sku is null or v_name is null or v_qty is null
       or v_unit_price is null or v_line_total is null
       or char_length(v_sku) not between 1 and 120
       or char_length(v_name) not between 1 and 220
       or v_sku ~ '[[:cntrl:]]' or v_name ~ '[[:cntrl:]]'
       or (v_product_sku is not null and (
         char_length(v_product_sku) > 120 or v_product_sku ~ '[[:cntrl:]]'
       ))
       or v_qty <= 0 or v_qty > 100000
       or v_unit_price < 0 or v_unit_price <> round(v_unit_price, 2)
       or v_line_total <> round(v_line_total, 2)
       or v_line_total <> v_unit_price * v_qty then
      raise exception 'invalid_manual_order_item';
    end if;
    v_item_sum := v_item_sum + v_line_total;
  end loop;
  if v_item_sum <> v_subtotal then
    raise exception 'manual_order_subtotal_mismatch';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) as item(value)
     group by lower(btrim(item.value ->> 'sku'))
    having count(*) > 1
  ) then
    raise exception 'duplicate_manual_order_item';
  end if;

  insert into public.orders (
    company_id, customer_email, status, payment_method, subtotal, shipping, tax, total,
    currency, qbo_invoice_id, qbo_doc_id, qbo_doc_type, qbo_payment_id,
    qbo_sync_status, qbo_synced_at
  ) values (
    v_company_id, v_customer_email, v_status, v_payment_method, v_subtotal, v_shipping,
    v_tax, v_total, v_currency, v_invoice_id, v_invoice_id,
    case when v_invoice_id is not null then 'invoice' else null end,
    v_payment_id,
    case when v_invoice_id is not null or v_payment_id is not null
      then 'synced'::public.qbo_sync_status else 'pending'::public.qbo_sync_status end,
    case when v_invoice_id is not null or v_payment_id is not null then now() else null end
  ) returning id into v_order_id;

  insert into public.order_items (
    order_id, sku, product_sku, name, qty, unit_price, line_total, backordered
  )
  select
    v_order_id,
    btrim(item.sku),
    nullif(btrim(item.product_sku), ''),
    btrim(item.name),
    item.qty,
    item.unit_price,
    item.line_total,
    coalesce(item.backordered, false)
  from jsonb_to_recordset(p_items) as item(
    sku text, product_sku text, name text, qty integer, unit_price numeric,
    line_total numeric, backordered boolean
  );

  for v_stock in
    select btrim(item.sku) as sku, sum(item.qty)::integer as qty
      from jsonb_to_recordset(p_items) as item(sku text, qty integer, backordered boolean)
     where coalesce(item.backordered, false) is false
     group by btrim(item.sku)
     order by btrim(item.sku)
  loop
    if not public.decrement_variant_stock(v_stock.sku, v_stock.qty) then
      raise exception 'manual_order_stock_unavailable';
    end if;
  end loop;

  select * into v_order from public.orders where id = v_order_id;
  if v_invoice_id is not null then
    perform public.link_order_provider_object(
      v_order_id, 'quickbooks', 'invoice', v_invoice_id,
      jsonb_build_object('order_number', v_order.order_number)
    );
  end if;
  if v_payment_id is not null then
    perform public.link_order_provider_object(
      v_order_id, 'quickbooks', 'payment', v_payment_id,
      jsonb_build_object('order_number', v_order.order_number)
    );
  end if;
  return to_jsonb(v_order);
end;
$$;

-- Only economically uncommitted Orders can replace lines. Row lock + revision fence +
-- deterministic stock deltas protect concurrent edits and preserve prior lines on failure.
create or replace function public.update_draft_order_atomic(
  p_order_id uuid,
  p_expected_revision bigint,
  p_order jsonb,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_status public.order_status;
  v_payment_method public.payment_method;
  v_company_id uuid;
  v_customer_email text;
  v_subtotal numeric;
  v_shipping numeric;
  v_tax numeric;
  v_total numeric;
  v_currency text;
  v_item jsonb;
  v_sku text;
  v_product_sku text;
  v_name text;
  v_qty integer;
  v_unit_price numeric;
  v_line_total numeric;
  v_backordered boolean;
  v_item_sum numeric := 0;
  v_stock record;
begin
  if p_order_id is null or p_expected_revision is null or p_expected_revision < 0
     or coalesce(jsonb_typeof(p_order), '') <> 'object' then
    raise exception 'invalid_draft_order_update';
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' then
    raise exception 'invalid_manual_order_items';
  end if;
  if jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid_manual_order_items';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_order) as key(name)
     where key.name not in (
       'company_id', 'customer_email', 'status', 'payment_method', 'subtotal',
       'shipping', 'tax', 'total', 'currency'
     )
  ) then
    raise exception 'invalid_draft_order_update';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.reversal_revision <> p_expected_revision then
    raise exception 'stale_order_revision';
  end if;
  if v_order.status::text not in ('cart', 'pending_payment')
     or nullif(v_order.stripe_payment_intent, '') is not null
     or nullif(v_order.qbo_doc_id, '') is not null
     or nullif(v_order.qbo_invoice_id, '') is not null
     or nullif(v_order.qbo_payment_id, '') is not null
     or exists (
       select 1 from public.order_provider_links as link where link.order_id = p_order_id
     )
     or exists (
       select 1 from public.order_financial_entries as entry where entry.order_id = p_order_id
     ) then
    raise exception 'settled_order_lines_immutable';
  end if;

  begin
    v_company_id := nullif(p_order ->> 'company_id', '')::uuid;
    v_status := nullif(p_order ->> 'status', '')::public.order_status;
    v_payment_method := nullif(p_order ->> 'payment_method', '')::public.payment_method;
    v_subtotal := (p_order ->> 'subtotal')::numeric;
    v_shipping := coalesce((p_order ->> 'shipping')::numeric, 0);
    v_tax := coalesce((p_order ->> 'tax')::numeric, 0);
    v_total := (p_order ->> 'total')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_draft_order_update';
  end;
  v_customer_email := nullif(lower(btrim(p_order ->> 'customer_email')), '');
  v_currency := lower(btrim(coalesce(p_order ->> 'currency', '')));
  if v_status is null or v_payment_method is null
     or v_subtotal is null or v_shipping is null or v_tax is null or v_total is null
     or v_status is distinct from v_order.status
     or v_payment_method is distinct from v_order.payment_method
     or v_currency !~ '^[a-z]{3}$'
     or v_subtotal < 0 or v_shipping < 0 or v_tax < 0 or v_total < 0
     or v_subtotal <> round(v_subtotal, 2)
     or v_shipping <> round(v_shipping, 2)
     or v_tax <> round(v_tax, 2)
     or v_total <> round(v_total, 2)
     or v_total <> v_subtotal + v_shipping + v_tax
     or (v_customer_email is not null and (
       char_length(v_customer_email) > 254
       or v_customer_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     )) then
    raise exception 'invalid_draft_order_update';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_item) as key(name)
          where key.name not in (
            'sku', 'product_sku', 'name', 'qty', 'unit_price', 'line_total', 'backordered'
          )
       ) then
      raise exception 'invalid_manual_order_item';
    end if;
    begin
      v_sku := btrim(v_item ->> 'sku');
      v_product_sku := nullif(btrim(v_item ->> 'product_sku'), '');
      v_name := btrim(v_item ->> 'name');
      v_qty := (v_item ->> 'qty')::integer;
      v_unit_price := (v_item ->> 'unit_price')::numeric;
      v_line_total := (v_item ->> 'line_total')::numeric;
      v_backordered := coalesce((v_item ->> 'backordered')::boolean, false);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_manual_order_item';
    end;
    if v_sku is null or v_name is null or v_qty is null
       or v_unit_price is null or v_line_total is null
       or char_length(v_sku) not between 1 and 120
       or char_length(v_name) not between 1 and 220
       or v_sku ~ '[[:cntrl:]]' or v_name ~ '[[:cntrl:]]'
       or (v_product_sku is not null and (
         char_length(v_product_sku) > 120 or v_product_sku ~ '[[:cntrl:]]'
       ))
       or v_qty <= 0 or v_qty > 100000
       or v_unit_price < 0 or v_unit_price <> round(v_unit_price, 2)
       or v_line_total <> round(v_line_total, 2)
       or v_line_total <> v_unit_price * v_qty then
      raise exception 'invalid_manual_order_item';
    end if;
    v_item_sum := v_item_sum + v_line_total;
  end loop;
  if v_item_sum <> v_subtotal then
    raise exception 'manual_order_subtotal_mismatch';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) as item(value)
     group by lower(btrim(item.value ->> 'sku'))
    having count(*) > 1
  ) then
    raise exception 'duplicate_manual_order_item';
  end if;

  for v_stock in
    with old_stock as (
      select item.sku, sum(item.qty)::integer as qty
        from public.order_items as item
       where item.order_id = p_order_id and coalesce(item.backordered, false) is false
       group by item.sku
    ), new_stock as (
      select btrim(item.sku) as sku, sum(item.qty)::integer as qty
        from jsonb_to_recordset(p_items) as item(sku text, qty integer, backordered boolean)
       where coalesce(item.backordered, false) is false
       group by btrim(item.sku)
    )
    select coalesce(new_stock.sku, old_stock.sku) as sku,
           coalesce(new_stock.qty, 0) - coalesce(old_stock.qty, 0) as delta
      from old_stock full join new_stock using (sku)
     order by coalesce(new_stock.sku, old_stock.sku)
  loop
    if v_stock.delta > 0
       and not public.decrement_variant_stock(v_stock.sku, v_stock.delta) then
      raise exception 'manual_order_stock_unavailable';
    elsif v_stock.delta < 0
       and not public.increment_variant_stock(v_stock.sku, -v_stock.delta) then
      raise exception 'manual_order_stock_restore_failed';
    end if;
  end loop;

  update public.orders
     set company_id = v_company_id,
         customer_email = v_customer_email,
         subtotal = v_subtotal,
         shipping = v_shipping,
         tax = v_tax,
         total = v_total,
         currency = v_currency,
         reversal_revision = reversal_revision + 1,
         updated_at = now()
   where id = p_order_id;
  delete from public.order_items where order_id = p_order_id;
  insert into public.order_items (
    order_id, sku, product_sku, name, qty, unit_price, line_total, backordered
  )
  select
    p_order_id,
    btrim(item.sku),
    nullif(btrim(item.product_sku), ''),
    btrim(item.name),
    item.qty,
    item.unit_price,
    item.line_total,
    coalesce(item.backordered, false)
  from jsonb_to_recordset(p_items) as item(
    sku text, product_sku text, name text, qty integer, unit_price numeric,
    line_total numeric, backordered boolean
  );
  select * into v_order from public.orders where id = p_order_id;
  return to_jsonb(v_order);
end;
$$;

create or replace function public.delete_draft_order_atomic(
  p_order_id uuid,
  p_expected_revision bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_order_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_draft_order_delete';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.reversal_revision <> p_expected_revision then
    raise exception 'stale_order_revision';
  end if;
  if v_order.status::text not in ('cart', 'pending_payment')
     or v_order.accepted_at is not null
     or nullif(v_order.stripe_payment_intent, '') is not null
     or nullif(v_order.qbo_doc_id, '') is not null
     or nullif(v_order.qbo_invoice_id, '') is not null
     or nullif(v_order.qbo_payment_id, '') is not null
     or exists (select 1 from public.order_provider_links where order_id = p_order_id)
     or exists (select 1 from public.order_financial_entries where order_id = p_order_id)
     or exists (select 1 from public.order_reversal_commands where order_id = p_order_id) then
    raise exception 'order_delete_forbidden';
  end if;
  delete from public.orders where id = p_order_id;
  return to_jsonb(v_order);
end;
$$;

-- Manual tracking is one guarded Order mutation. A planned cancellation becomes stale
-- through reversal_revision; a confirmed/failed reversal blocks any later fulfillment.
create or replace function public.update_order_tracking_guarded(
  p_order_id uuid,
  p_expected_status text,
  p_tracking_status text,
  p_carrier text default null,
  p_tracking_number text default null,
  p_tracking_url text default null,
  p_estimated_delivery_at timestamptz default null,
  p_shipped_at timestamptz default null,
  p_promote_fulfilled boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_order_id is null
     or p_tracking_status not in ('processing', 'packing', 'shipped', 'delivered', 'blocked')
     or char_length(coalesce(p_carrier, '')) > 80
     or char_length(coalesce(p_tracking_number, '')) > 120
     or char_length(coalesce(p_tracking_url, '')) > 500
     or (nullif(btrim(coalesce(p_tracking_url, '')), '') is not null
       and p_tracking_url !~* '^https?://') then
    raise exception 'invalid_tracking_update';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.status::text is distinct from p_expected_status then
    raise exception 'stale_order_status';
  end if;
  if v_order.status::text in ('cart', 'cancelled', 'refunded') then
    raise exception 'tracking_update_forbidden';
  end if;
  if exists (
    select 1 from public.order_reversal_commands command
     where command.order_id = v_order.id
       and command.type = 'cancel'
       and command.status in ('queued', 'provider_succeeded', 'review_required', 'failed')
  ) then
    raise exception 'order_cancellation_in_progress';
  end if;
  if p_promote_fulfilled and v_order.status::text not in ('paid', 'net_paid', 'fulfilled') then
    raise exception 'tracking_fulfillment_not_settled';
  end if;
  update public.orders
     set tracking_status = p_tracking_status,
         carrier = nullif(btrim(p_carrier), ''),
         tracking_number = nullif(btrim(p_tracking_number), ''),
         tracking_url = nullif(btrim(p_tracking_url), ''),
         estimated_delivery_at = p_estimated_delivery_at,
         shipped_at = p_shipped_at,
         status = case when p_promote_fulfilled then 'fulfilled'::public.order_status else v_order.status end,
         reversal_revision = reversal_revision + 1,
         updated_at = now()
   where id = v_order.id
  returning * into v_order;
  return to_jsonb(v_order);
end;
$$;

create or replace function public.apply_order_reversal_restock_effect(
  p_effect_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.integration_effects%rowtype;
  v_command public.order_reversal_commands%rowtype;
  v_line record;
  v_restored jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  select * into v_effect from public.integration_effects where id = p_effect_id for update;
  if not found or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'order_restock' then
    raise exception 'invalid_reversal_restock_lease';
  end if;
  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{}'::jsonb);
  end if;
  select * into v_command
    from public.order_reversal_commands
   where id = nullif(v_effect.payload ->> 'command_id', '')::uuid
     and order_id = nullif(v_effect.payload ->> 'order_id', '')::uuid
   for update;
  if not found or v_command.status not in ('queued', 'provider_succeeded') then
    raise exception 'invalid_reversal_restock_command';
  end if;
  if v_command.amount_minor > 0 and v_command.provider_object_id is null then
    raise exception 'refund_provider_identity_missing';
  end if;
  for v_line in
    select line.sku, line.restock_qty
      from public.order_reversal_lines as line
     where line.command_id = v_command.id and line.restock_qty > 0
     order by line.sku
  loop
    if not public.increment_variant_stock(v_line.sku, v_line.restock_qty) then
      raise exception 'order_restock_failed';
    end if;
    v_restored := v_restored || jsonb_build_object('sku', v_line.sku, 'qty', v_line.restock_qty);
  end loop;
  v_result := jsonb_build_object('command_id', v_command.id, 'restored', v_restored);
  return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
end;
$$;

create or replace function public.apply_order_reversal_cancellation_effect(
  p_effect_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.integration_effects%rowtype;
  v_command public.order_reversal_commands%rowtype;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_result jsonb;
begin
  select * into v_effect from public.integration_effects where id = p_effect_id for update;
  if not found or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'order_cancelled' then
    raise exception 'invalid_reversal_cancellation_lease';
  end if;
  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{}'::jsonb);
  end if;
  select command.order_id into v_order_id
    from public.order_reversal_commands as command
   where command.id = nullif(v_effect.payload ->> 'command_id', '')::uuid
     and command.type = 'cancel';
  if not found then raise exception 'cancellation_accounting_incomplete'; end if;

  select * into v_order from public.orders where id = v_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  select * into v_command
    from public.order_reversal_commands
   where id = nullif(v_effect.payload ->> 'command_id', '')::uuid
     and order_id = v_order.id
     and type = 'cancel'
   for update;
  if not found or v_command.accounting_result is null then
    raise exception 'cancellation_accounting_incomplete';
  end if;
  if v_order.status <> 'cancelled' then
    update public.orders
       set status = 'cancelled',
           cancelled_at = coalesce(cancelled_at, now()),
           cancel_reason = coalesce(v_command.reason, cancel_reason),
           updated_at = now()
     where id = v_order.id;
    insert into public.shipment_events (order_id, status, tracking_number, note, provider)
    values (
      v_order.id, 'blocked', nullif(v_order.tracking_number, ''),
      coalesce('Order cancelled: ' || v_command.reason, 'Order cancelled'), 'masest'
    ) on conflict do nothing;
  end if;
  v_result := jsonb_build_object(
    'command_id', v_command.id,
    'order_id', v_order.id,
    'previous_status', v_order.status::text,
    'status', 'cancelled'
  );
  return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
end;
$$;

create or replace function public.apply_order_reversal_complete_effect(
  p_effect_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.integration_effects%rowtype;
  v_command public.order_reversal_commands%rowtype;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_result jsonb;
begin
  select * into v_effect from public.integration_effects where id = p_effect_id for update;
  if not found or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'order_reversal_complete' then
    raise exception 'invalid_reversal_complete_lease';
  end if;
  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{}'::jsonb);
  end if;
  select command.order_id into v_order_id
    from public.order_reversal_commands as command
   where command.id = nullif(v_effect.payload ->> 'command_id', '')::uuid;
  if not found then raise exception 'reversal_command_not_found'; end if;

  select * into v_order from public.orders where id = v_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  select * into v_command
    from public.order_reversal_commands
   where id = nullif(v_effect.payload ->> 'command_id', '')::uuid
     and order_id = v_order.id
   for update;
  if not found then raise exception 'reversal_command_not_found'; end if;
  if v_command.type = 'refund'
     and round(coalesce(v_order.refunded_amount, 0) * 100)::bigint >= round(v_order.total * 100)::bigint then
    update public.orders set status = 'refunded', updated_at = now() where id = v_order.id;
  end if;
  update public.order_reversal_commands
     set status = 'completed', completed_at = coalesce(completed_at, now())
   where id = v_command.id;
  v_result := jsonb_build_object('command_id', v_command.id, 'status', 'completed');
  return public.finish_integration_projection(p_effect_id, p_worker_id, v_result);
end;
$$;

-- A pending NET invoice must not race past a confirmed cancellation command.
create or replace function public.claim_qbo_orders(batch int)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.orders as orders
     set qbo_sync_status = 'processing'
   where orders.id in (
     select candidate.id
       from public.orders as candidate
      where candidate.qbo_sync_status = 'pending'
        and (candidate.qbo_next_attempt_at is null or candidate.qbo_next_attempt_at <= now())
        and candidate.status not in ('cancelled', 'refunded')
        and not exists (
          select 1 from public.order_reversal_commands as command
           where command.order_id = candidate.id
             and command.type = 'cancel'
             and command.status in ('queued', 'provider_succeeded', 'review_required', 'failed')
        )
      order by candidate.created_at
      limit least(greatest(coalesce(batch, 10), 1), 25)
      for update skip locked
   )
  returning orders.*;
end;
$$;

alter table public.order_reversal_commands enable row level security;
alter table public.order_reversal_lines enable row level security;

revoke all on table public.order_reversal_commands from public, anon, authenticated;
revoke all on table public.order_reversal_lines from public, anon, authenticated;
grant select, insert, update on table public.order_reversal_commands to service_role;
grant select, insert on table public.order_reversal_lines to service_role;

revoke all on function public.validate_order_reversal_lines(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.bind_order_reversal_effects(jsonb, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.guard_order_reversal_fulfillment_projection() from public, anon, authenticated;
revoke all on function public.claim_order_refund_command(uuid, uuid, text, bigint, bigint, text, text, jsonb, jsonb, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_order_cancellation_plan(uuid, uuid, text, bigint, bigint, text, text, jsonb, jsonb, text, uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_order_cancellation_command(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.retire_order_cancellation_review(uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.record_order_refund_provider_success(uuid, text) from public, anon, authenticated;
revoke all on function public.record_order_accounting_reversal_success(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_manual_order_atomic(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.update_draft_order_atomic(uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.delete_draft_order_atomic(uuid, bigint) from public, anon, authenticated;
revoke all on function public.update_order_tracking_guarded(uuid, text, text, text, text, text, timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.apply_order_reversal_restock_effect(uuid, text) from public, anon, authenticated;
revoke all on function public.apply_order_reversal_cancellation_effect(uuid, text) from public, anon, authenticated;
revoke all on function public.apply_order_reversal_complete_effect(uuid, text) from public, anon, authenticated;

grant execute on function public.claim_order_refund_command(uuid, uuid, text, bigint, bigint, text, text, jsonb, jsonb, uuid, text, jsonb) to service_role;
grant execute on function public.create_order_cancellation_plan(uuid, uuid, text, bigint, bigint, text, text, jsonb, jsonb, text, uuid, text) to service_role;
grant execute on function public.confirm_order_cancellation_command(uuid, jsonb) to service_role;
grant execute on function public.retire_order_cancellation_review(uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.record_order_refund_provider_success(uuid, text) to service_role;
grant execute on function public.record_order_accounting_reversal_success(uuid, text, text, jsonb) to service_role;
grant execute on function public.create_manual_order_atomic(jsonb, jsonb) to service_role;
grant execute on function public.update_draft_order_atomic(uuid, bigint, jsonb, jsonb) to service_role;
grant execute on function public.delete_draft_order_atomic(uuid, bigint) to service_role;
grant execute on function public.update_order_tracking_guarded(uuid, text, text, text, text, text, timestamptz, timestamptz, boolean) to service_role;
grant execute on function public.apply_order_reversal_restock_effect(uuid, text) to service_role;
grant execute on function public.apply_order_reversal_cancellation_effect(uuid, text) to service_role;
grant execute on function public.apply_order_reversal_complete_effect(uuid, text) to service_role;

commit;
