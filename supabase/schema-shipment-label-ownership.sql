-- Canonical split-shipment label ownership and durable ShipStation mutation attempts.
--
-- Apply after schema-commerce-integrations.sql, schema-shipstation.sql, and
-- schema-shipstation-shipments.sql, and before schema-provider-inbox.sql.
-- Order-level ShipStation columns remain a latest-action projection only.

begin;

-- Older production installations predate the generic Order update clock. The
-- legacy-label backfill uses it when available, so establish the additive column
-- before reading it instead of assuming schema-order-reversals already ran.
alter table public.orders
  add column if not exists updated_at timestamptz not null default now();

alter table public.shipment_events
  add column if not exists order_shipment_id uuid references public.order_shipments(id) on delete set null;
alter table public.shipment_events
  add column if not exists provider_label_id text;
create index if not exists shipment_events_order_shipment_idx
  on public.shipment_events (order_shipment_id, created_at desc)
  where order_shipment_id is not null;
create index if not exists shipment_events_provider_label_idx
  on public.shipment_events (provider, provider_label_id, created_at desc)
  where provider is not null and provider_label_id is not null;

-- Legacy installations may have a provider-confirmed label only in the Order
-- projection. Create one canonical active shipment only when no active shipment
-- exists. Re-running is safe through the active-split and external-id keys.
insert into public.order_shipments (
  order_id, split_key, generation, revision, provider, provider_shipment_id,
  external_shipment_id, package_hash, status, operation, operation_state,
  item_allocations, pending_payload, created_at, updated_at
)
select
  o.id,
  'default',
  coalesce((select max(history.generation) + 1
              from public.order_shipments history
             where history.order_id = o.id and history.split_key = 'default'), 0),
  greatest(coalesce(o.shipstation_shipment_revision, 0), 0),
  'shipstation',
  nullif(trim(o.shipstation_shipment_id), ''),
  'mst-' || replace(o.id::text, '-', '') || '-' || substr(md5('legacy-label:' || o.shipstation_label_id), 1, 12),
  case when coalesce(o.shipstation_package_hash, '') ~ '^[a-f0-9]{64}$'
       then o.shipstation_package_hash else null end,
  'rated',
  null,
  'idle',
  allocations.items,
  jsonb_build_object('items', allocations.items, 'legacy_label_backfill', true),
  coalesce(o.shipstation_updated_at, o.created_at, now()),
  coalesce(o.shipstation_updated_at, o.updated_at, now())
from public.orders o
cross join lateral (
  select coalesce(jsonb_agg(
    jsonb_build_object('sku', item.sku, 'quantity', item.qty)
    order by item.sku
  ), '[]'::jsonb) as items
    from public.order_items item
   where item.order_id = o.id
) allocations
where nullif(trim(o.shipstation_label_id), '') is not null
  and not exists (
    select 1 from public.order_shipments active
     where active.order_id = o.id and active.status <> 'cancelled'
  )
on conflict (external_shipment_id) do nothing;

-- Repair the projection's canonical shipment pointer without using the projection
-- as provider authority. Ambiguous multi-split rows are intentionally left alone.
with candidates as (
  select o.id as order_id, chosen.id as order_shipment_id
    from public.orders o
    left join public.order_provider_links existing_label
      on existing_label.order_id = o.id
     and existing_label.provider = 'shipstation'
     and existing_label.object_type = 'label'
     and existing_label.provider_object_id = o.shipstation_label_id
    join lateral (
      select shipment.id
        from public.order_shipments shipment
       where shipment.order_id = o.id
         and shipment.status <> 'cancelled'
         and (
           (
             coalesce(existing_label.metadata->>'order_shipment_id', '') <> ''
             and shipment.id::text = existing_label.metadata->>'order_shipment_id'
           )
           or (
             coalesce(existing_label.metadata->>'order_shipment_id', '') = ''
             and (
               shipment.id = o.shipstation_order_shipment_id
               or shipment.provider_shipment_id = nullif(trim(o.shipstation_shipment_id), '')
               or 1 = (select count(*) from public.order_shipments one
                        where one.order_id = o.id and one.status <> 'cancelled')
             )
           )
         )
       order by
         (shipment.id::text = existing_label.metadata->>'order_shipment_id') desc,
         (shipment.id = o.shipstation_order_shipment_id) desc,
         (shipment.provider_shipment_id = nullif(trim(o.shipstation_shipment_id), '')) desc,
         shipment.updated_at desc
       limit 1
    ) chosen on true
   where nullif(trim(o.shipstation_label_id), '') is not null
)
update public.orders target
   set shipstation_order_shipment_id = candidates.order_shipment_id
  from candidates
 where target.id = candidates.order_id
   and target.shipstation_order_shipment_id is distinct from candidates.order_shipment_id;

-- Once a label is attached to a canonical split, subsequent tracking/status
-- projection updates may enrich metadata but may never move that provider object
-- to another split or parent label.
create or replace function public.prevent_shipstation_label_relation_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.provider = 'shipstation' and old.object_type in ('label', 'return_label') then
    if (
      coalesce(old.metadata->>'order_shipment_id', '') <> ''
      and new.metadata->>'order_shipment_id' is distinct from old.metadata->>'order_shipment_id'
    ) or (
      old.object_type = 'label'
      and coalesce(old.metadata->>'shipment_id', '') <> ''
      and new.metadata->>'shipment_id' is distinct from old.metadata->>'shipment_id'
    ) or (
      old.object_type = 'return_label'
      and coalesce(old.metadata->>'outbound_label_id', '') <> ''
      and new.metadata->>'outbound_label_id' is distinct from old.metadata->>'outbound_label_id'
    ) then
      raise exception 'shipstation_label_relation_immutable';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists shipstation_label_relation_immutable on public.order_provider_links;
create trigger shipstation_label_relation_immutable
  before update of metadata on public.order_provider_links
  for each row execute function public.prevent_shipstation_label_relation_change();

-- Backfill/repair immutable provider identity using the canonical shipment relation.
do $$
declare
  linked record;
begin
  for linked in
    select o.id as order_id, o.order_number, o.shipstation_label_id as label_id,
           shipment.id as order_shipment_id, shipment.split_key, shipment.generation,
           shipment.revision, shipment.provider_shipment_id,
           o.shipstation_rate_id, o.shipstation_label_status, o.tracking_number,
           o.tracking_status, o.carrier, o.shipstation_cost, lower(o.currency) as currency
      from public.orders o
      join public.order_provider_links label_link
        on label_link.order_id = o.id
       and label_link.provider = 'shipstation'
       and label_link.object_type = 'label'
       and label_link.provider_object_id = o.shipstation_label_id
      join public.order_shipments shipment
        on shipment.order_id = o.id
       and shipment.status <> 'cancelled'
       and (
         (
           coalesce(label_link.metadata->>'order_shipment_id', '') <> ''
           and shipment.id::text = label_link.metadata->>'order_shipment_id'
         )
         or (
           coalesce(label_link.metadata->>'order_shipment_id', '') = ''
           and shipment.id = o.shipstation_order_shipment_id
         )
       )
     where nullif(trim(o.shipstation_label_id), '') is not null
  loop
    perform public.link_order_provider_object(
      linked.order_id, 'shipstation', 'label', linked.label_id,
      jsonb_strip_nulls(jsonb_build_object(
        'order_number', linked.order_number,
        'order_shipment_id', linked.order_shipment_id,
        'split_key', linked.split_key,
        'generation', linked.generation,
        'revision', linked.revision,
        'shipment_id', linked.provider_shipment_id,
        'rate_id', linked.shipstation_rate_id,
        'status', coalesce(linked.shipstation_label_status, 'label_purchased'),
        'tracking_number', linked.tracking_number,
        'tracking_status', coalesce(linked.tracking_status, 'packing'),
        'carrier', linked.carrier,
        'cost', linked.shipstation_cost,
        'currency', linked.currency,
        'legacy_projection_backfill', true
      ))
    );
  end loop;

  for linked in
    select o.id as order_id, o.order_number,
           o.shipstation_return_label_id as return_label_id,
           o.shipstation_label_id as outbound_label_id,
           outbound.metadata->>'order_shipment_id' as order_shipment_id,
           o.shipstation_return_label_status as status,
           o.shipstation_return_tracking_number as tracking_number,
           o.shipstation_return_cost as cost,
           lower(coalesce(o.shipstation_return_currency, o.currency)) as currency,
           o.shipstation_return_charge_event as charge_event
      from public.orders o
      join public.order_provider_links outbound
        on outbound.order_id = o.id
       and outbound.provider = 'shipstation'
       and outbound.object_type = 'label'
       and outbound.provider_object_id = o.shipstation_label_id
     where nullif(trim(o.shipstation_return_label_id), '') is not null
  loop
    perform public.link_order_provider_object(
      linked.order_id, 'shipstation', 'return_label', linked.return_label_id,
      jsonb_strip_nulls(jsonb_build_object(
        'order_number', linked.order_number,
        'outbound_label_id', linked.outbound_label_id,
        'order_shipment_id', linked.order_shipment_id,
        'status', coalesce(linked.status, 'return_label_created'),
        'tracking_number', linked.tracking_number,
        'cost', linked.cost,
        'currency', linked.currency,
        'charge_event', linked.charge_event,
        'legacy_projection_backfill', true
      ))
    );
  end loop;
end
$$;

-- Deep, service-only ownership projection. It never joins labels through the Order
-- projection. Provider links own identity, order_shipments owns split identity, and
-- the append-only finance ledger owns cost/void evidence.
create or replace view public.order_shipment_label_ownership
with (security_barrier = true)
as
with outbound as (
  select
    link.id as provider_link_id,
    link.order_id,
    shipment.id as order_shipment_id,
    shipment.split_key,
    shipment.generation,
    shipment.revision,
    'outbound'::text as label_kind,
    link.provider_object_id as label_id,
    null::text as parent_label_id,
    coalesce(nullif(link.metadata->>'shipment_id', ''), shipment.provider_shipment_id) as provider_shipment_id,
    not (
      coalesce(link.metadata->>'status', '') in ('label_voided', 'voided')
      or exists (
        select 1 from public.order_financial_entries void_entry
         where void_entry.order_id = link.order_id
           and void_entry.source = 'shipstation'
           and void_entry.entry_type = 'postage_void_requested'
           and void_entry.provider_object_id = link.provider_object_id
      )
    ) as active,
    coalesce(nullif(link.metadata->>'status', ''), 'label_purchased') as label_status,
    nullif(link.metadata->>'tracking_number', '') as tracking_number,
    coalesce(nullif(link.metadata->>'tracking_status', ''), 'packing') as tracking_status,
    nullif(link.metadata->>'tracking_occurred_at', '')::timestamptz as tracking_occurred_at,
    nullif(link.metadata->>'carrier', '') as carrier,
    finance.id as financial_entry_id,
    finance.amount as financial_amount,
    finance.currency as financial_currency,
    finance.recognition_state as financial_recognition_state,
    link.created_at,
    link.updated_at
  from public.order_provider_links link
  join public.order_shipments shipment
    on shipment.order_id = link.order_id
   and shipment.status <> 'cancelled'
   and (
     shipment.id::text = link.metadata->>'order_shipment_id'
     or (
       coalesce(link.metadata->>'order_shipment_id', '') = ''
       and shipment.provider_shipment_id = link.metadata->>'shipment_id'
     )
   )
  left join lateral (
    select entry.id, entry.amount, entry.currency, entry.recognition_state
      from public.order_financial_entries entry
     where entry.order_id = link.order_id
       and entry.source = 'shipstation'
       and entry.entry_type = 'postage_purchase'
       and entry.provider_object_id = link.provider_object_id
     order by entry.created_at desc
     limit 1
  ) finance on true
  where link.provider = 'shipstation' and link.object_type = 'label'
), returns as (
  select
    link.id as provider_link_id,
    link.order_id,
    parent.order_shipment_id,
    parent.split_key,
    parent.generation,
    parent.revision,
    'return'::text as label_kind,
    link.provider_object_id as label_id,
    parent.label_id as parent_label_id,
    nullif(link.metadata->>'shipment_id', '') as provider_shipment_id,
    coalesce(link.metadata->>'status', '') not in ('label_voided', 'voided') as active,
    coalesce(nullif(link.metadata->>'status', ''), 'return_label_created') as label_status,
    nullif(link.metadata->>'tracking_number', '') as tracking_number,
    nullif(link.metadata->>'tracking_status', '') as tracking_status,
    nullif(link.metadata->>'tracking_occurred_at', '')::timestamptz as tracking_occurred_at,
    nullif(link.metadata->>'carrier', '') as carrier,
    finance.id as financial_entry_id,
    finance.amount as financial_amount,
    finance.currency as financial_currency,
    finance.recognition_state as financial_recognition_state,
    link.created_at,
    link.updated_at
  from public.order_provider_links link
  join outbound parent
    on parent.order_id = link.order_id
   and parent.label_id = link.metadata->>'outbound_label_id'
   and (
     coalesce(link.metadata->>'order_shipment_id', '') = ''
     or link.metadata->>'order_shipment_id' = parent.order_shipment_id::text
   )
  left join lateral (
    select entry.id, entry.amount, entry.currency, entry.recognition_state
      from public.order_financial_entries entry
     where entry.order_id = link.order_id
       and entry.source = 'shipstation'
       and entry.entry_type = 'postage_return_label'
       and entry.provider_object_id = link.provider_object_id
     order by entry.created_at desc
     limit 1
  ) finance on true
  where link.provider = 'shipstation' and link.object_type = 'return_label'
)
select * from outbound
union all
select * from returns;

revoke all on public.order_shipment_label_ownership from public, anon, authenticated;
grant select on public.order_shipment_label_ownership to service_role;

create or replace function public.shipstation_operation_summary_is_safe(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  key_name text;
begin
  if p_value is null or pg_column_size(p_value) > 4096 then return false; end if;
  if jsonb_typeof(p_value) = 'string' then
    if trim(both '"' from p_value::text) ~* '(https?://|data:)' then return false; end if;
  elsif jsonb_typeof(p_value) = 'object' then
    for key_name, item in select key, value from jsonb_each(p_value)
    loop
      if key_name ~* '(^|_)(raw|body|payload|secret|token|api_key|authorization|url)(_|$)'
         or not public.shipstation_operation_summary_is_safe(item) then
        return false;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for item in select value from jsonb_array_elements(p_value)
    loop
      if not public.shipstation_operation_summary_is_safe(item) then return false; end if;
    end loop;
  end if;
  return true;
end
$$;

create table if not exists public.shipstation_operation_attempts (
  id                         uuid primary key default gen_random_uuid(),
  operation_key              text not null unique check (length(operation_key) between 1 and 512),
  operation                  text not null check (operation in (
                               'shipment_create', 'shipment_update', 'shipment_cancel',
                               'label_purchase', 'label_void', 'label_return'
                             )),
  order_id                   uuid not null references public.orders(id) on delete restrict,
  order_shipment_id          uuid references public.order_shipments(id) on delete restrict,
  provider_link_id           uuid references public.order_provider_links(id) on delete restrict,
  parent_provider_link_id    uuid references public.order_provider_links(id) on delete restrict,
  request_fingerprint        text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  status                     text not null default 'claimed' check (status in (
                               'claimed', 'provider_succeeded', 'completed',
                               'reconcile_required', 'released'
                             )),
  lease_owner                text,
  lease_expires_at           timestamptz not null,
  attempt_count              integer not null default 1 check (attempt_count > 0),
  provider_object_id         text check (provider_object_id is null or length(provider_object_id) between 1 and 255),
  result_summary             jsonb not null default '{}'::jsonb
                             check (public.shipstation_operation_summary_is_safe(result_summary)),
  error_code                 text check (error_code is null or length(error_code) <= 160),
  provider_succeeded_at      timestamptz,
  completed_at               timestamptz,
  released_at                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create index if not exists shipstation_operation_attempts_order_idx
  on public.shipstation_operation_attempts (order_id, created_at desc);
create index if not exists shipstation_operation_attempts_reconcile_idx
  on public.shipstation_operation_attempts (status, lease_expires_at)
  where status in ('claimed', 'provider_succeeded', 'reconcile_required');

-- Unknown pre-migration claims are never made retryable. Seed them directly into
-- reconciliation with deterministic legacy keys so the read-only repair paths can
-- adopt provider evidence without repeating a mutation.
insert into public.shipstation_operation_attempts (
  operation_key, operation, order_id, order_shipment_id, request_fingerprint,
  status, lease_expires_at, error_code, created_at, updated_at
)
select
  'legacy:shipment:' || shipment.id::text || ':' || shipment.revision::text || ':' || shipment.operation,
  'shipment_' || shipment.operation,
  shipment.order_id,
  shipment.id,
  encode(extensions.digest(convert_to(
    coalesce(shipment.pending_payload, '{}'::jsonb)::text, 'UTF8'
  ), 'sha256'), 'hex'),
  'reconcile_required',
  now(),
  'shipstation_legacy_operation_unknown',
  shipment.updated_at,
  now()
from public.order_shipments shipment
where shipment.operation in ('create','update','cancel')
  and shipment.operation_state in ('claimed','reconcile_required')
on conflict (operation_key) do nothing;

insert into public.shipstation_operation_attempts (
  operation_key, operation, order_id, order_shipment_id, provider_link_id,
  request_fingerprint, status, lease_expires_at, error_code, created_at, updated_at
)
select
  'legacy:label-purchase:' || o.id::text,
  'label_purchase',
  o.id,
  o.shipstation_order_shipment_id,
  null,
  encode(extensions.digest(convert_to(jsonb_build_object(
    'shipment_id', o.shipstation_shipment_id,
    'rate_id', o.shipstation_rate_id,
    'revision', o.shipstation_shipment_revision
  )::text, 'UTF8'), 'sha256'), 'hex'),
  'reconcile_required', now(), 'shipstation_legacy_operation_unknown',
  coalesce(o.shipstation_updated_at, o.updated_at, now()), now()
from public.orders o
where o.shipstation_label_status in ('purchasing','reconcile_required')
on conflict (operation_key) do nothing;

insert into public.shipstation_operation_attempts (
  operation_key, operation, order_id, order_shipment_id, provider_link_id,
  request_fingerprint, status, lease_expires_at, error_code, created_at, updated_at
)
select
  'legacy:label-void:' || o.id::text || ':' || o.shipstation_label_id,
  'label_void',
  o.id,
  ownership.order_shipment_id,
  link.id,
  encode(extensions.digest(convert_to(jsonb_build_object(
    'label_id', o.shipstation_label_id
  )::text, 'UTF8'), 'sha256'), 'hex'),
  'reconcile_required', now(), 'shipstation_legacy_operation_unknown',
  coalesce(o.shipstation_updated_at, o.updated_at, now()), now()
from public.orders o
join public.order_provider_links link
  on link.order_id = o.id and link.provider = 'shipstation'
 and link.object_type = 'label' and link.provider_object_id = o.shipstation_label_id
join public.order_shipment_label_ownership ownership
  on ownership.provider_link_id = link.id and ownership.label_kind = 'outbound'
where o.shipstation_label_status in ('voiding','void_reconcile_required')
on conflict (operation_key) do nothing;

insert into public.shipstation_operation_attempts (
  operation_key, operation, order_id, order_shipment_id, parent_provider_link_id,
  request_fingerprint, status, lease_expires_at, error_code, created_at, updated_at
)
select
  'legacy:label-return:' || o.id::text || ':' || o.shipstation_label_id,
  'label_return',
  o.id,
  ownership.order_shipment_id,
  link.id,
  encode(extensions.digest(convert_to(jsonb_build_object(
    'outbound_label_id', o.shipstation_label_id,
    'charge_event', 'carrier_default'
  )::text, 'UTF8'), 'sha256'), 'hex'),
  'reconcile_required', now(), 'shipstation_legacy_operation_unknown',
  coalesce(o.shipstation_return_updated_at, o.updated_at, now()), now()
from public.orders o
join public.order_provider_links link
  on link.order_id = o.id and link.provider = 'shipstation'
 and link.object_type = 'label' and link.provider_object_id = o.shipstation_label_id
join public.order_shipment_label_ownership ownership
  on ownership.provider_link_id = link.id and ownership.label_kind = 'outbound'
where o.shipstation_return_label_status in ('return_purchasing','return_reconcile_required')
on conflict (operation_key) do nothing;

create or replace function public.prevent_shipstation_operation_attempt_identity_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.operation_key is distinct from old.operation_key
     or new.operation is distinct from old.operation
     or new.order_id is distinct from old.order_id
     or new.request_fingerprint is distinct from old.request_fingerprint
     or (old.order_shipment_id is not null and new.order_shipment_id is distinct from old.order_shipment_id)
     or (old.provider_link_id is not null and new.provider_link_id is distinct from old.provider_link_id)
     or (old.parent_provider_link_id is not null and new.parent_provider_link_id is distinct from old.parent_provider_link_id)
     or (old.provider_object_id is not null and new.provider_object_id is distinct from old.provider_object_id)
     or ((new.order_shipment_id is distinct from old.order_shipment_id
          or new.provider_link_id is distinct from old.provider_link_id
          or new.parent_provider_link_id is distinct from old.parent_provider_link_id)
         and (old.status <> 'claimed' or old.provider_succeeded_at is not null)) then
    raise exception 'shipstation_operation_attempt_identity_immutable';
  end if;
  return new;
end
$$;
drop trigger if exists shipstation_operation_attempts_identity_immutable
  on public.shipstation_operation_attempts;
create trigger shipstation_operation_attempts_identity_immutable
  before update on public.shipstation_operation_attempts
  for each row execute function public.prevent_shipstation_operation_attempt_identity_change();

alter table public.shipstation_operation_attempts enable row level security;
revoke all on public.shipstation_operation_attempts from public, anon, authenticated;
grant select, insert, update on public.shipstation_operation_attempts to service_role;

create or replace function public.claim_shipstation_operation_attempt(
  p_operation_key text,
  p_operation text,
  p_order_id uuid,
  p_order_shipment_id uuid,
  p_provider_link_id uuid,
  p_parent_provider_link_id uuid,
  p_request_fingerprint text,
  p_lease_owner text,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  attempt public.shipstation_operation_attempts%rowtype;
begin
  if nullif(trim(p_operation_key), '') is null or length(p_operation_key) > 512
     or p_operation not in ('shipment_create','shipment_update','shipment_cancel','label_purchase','label_void','label_return')
     or p_order_id is null
     or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
     or length(trim(coalesce(p_lease_owner, ''))) not between 1 and 128
     or p_lease_seconds not between 30 and 600 then
    raise exception 'shipstation_operation_claim_invalid';
  end if;

  select * into attempt from public.shipstation_operation_attempts
   where operation_key = trim(p_operation_key) for update;
  if not found then
    insert into public.shipstation_operation_attempts (
      operation_key, operation, order_id, order_shipment_id, provider_link_id,
      parent_provider_link_id, request_fingerprint, status, lease_owner, lease_expires_at
    ) values (
      trim(p_operation_key), p_operation, p_order_id, p_order_shipment_id, p_provider_link_id,
      p_parent_provider_link_id, p_request_fingerprint, 'claimed', trim(p_lease_owner),
      now() + make_interval(secs => p_lease_seconds)
    ) returning * into attempt;
    return jsonb_build_object(
      'state', 'claimed', 'attempt_id', attempt.id,
      'lease_owner', attempt.lease_owner, 'lease_expires_at', attempt.lease_expires_at
    );
  end if;

  if attempt.operation is distinct from p_operation
     or attempt.order_id is distinct from p_order_id
     or attempt.request_fingerprint is distinct from p_request_fingerprint
     or (p_order_shipment_id is not null and attempt.order_shipment_id is distinct from p_order_shipment_id)
     or (p_provider_link_id is not null and attempt.provider_link_id is distinct from p_provider_link_id)
     or (p_parent_provider_link_id is not null and attempt.parent_provider_link_id is distinct from p_parent_provider_link_id) then
    raise exception 'shipstation_operation_attempt_identity_conflict';
  end if;

  if attempt.status = 'completed' then
    return jsonb_build_object('state', 'completed', 'attempt_id', attempt.id,
                              'result_summary', attempt.result_summary);
  elsif attempt.status in ('provider_succeeded', 'reconcile_required') then
    return jsonb_build_object('state', attempt.status, 'attempt_id', attempt.id,
                              'result_summary', attempt.result_summary,
                              'error_code', attempt.error_code);
  elsif attempt.status = 'claimed' and attempt.lease_expires_at <= now() then
    update public.shipstation_operation_attempts
       set status = 'reconcile_required', lease_owner = null,
           error_code = 'shipstation_operation_lease_expired', updated_at = now()
     where id = attempt.id returning * into attempt;
    -- Shipment reconciliation is gated by the canonical split row, not by the
    -- latest-label projection on orders. Move that exact split into the same
    -- fail-closed state as its expired provider-attempt lease so a retry can
    -- only enter the read-only reconciliation path.
    if attempt.operation in ('shipment_create','shipment_update','shipment_cancel')
       and attempt.order_shipment_id is not null then
      update public.order_shipments
         set status = 'reconcile_required',
             operation_state = 'reconcile_required',
             error_code = 'shipstation_operation_lease_expired',
             updated_at = now()
       where id = attempt.order_shipment_id
         and order_id = attempt.order_id
         and operation_state = 'claimed';
    end if;
    insert into public.audit_log (action, target_type, target_id, detail)
    values ('shipstation_operation_lease_expired', 'order', attempt.order_id::text,
            jsonb_build_object('attempt_id', attempt.id, 'operation', attempt.operation));
    return jsonb_build_object('state', 'reconcile_required', 'attempt_id', attempt.id,
                              'error_code', attempt.error_code);
  elsif attempt.status = 'claimed' then
    return jsonb_build_object(
      'state', case when attempt.lease_owner = trim(p_lease_owner) then 'claimed' else 'locked' end,
      'attempt_id', attempt.id, 'lease_owner', attempt.lease_owner,
      'lease_expires_at', attempt.lease_expires_at
    );
  end if;

  -- Only an audited, positively proven non-acceptance can create `released`.
  update public.shipstation_operation_attempts
     set status = 'claimed', lease_owner = trim(p_lease_owner),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempt_count = attempt_count + 1, error_code = null, released_at = null,
         updated_at = now()
   where id = attempt.id returning * into attempt;
  return jsonb_build_object(
    'state', 'claimed', 'attempt_id', attempt.id,
    'lease_owner', attempt.lease_owner, 'lease_expires_at', attempt.lease_expires_at
  );
end
$$;

create or replace function public.mark_shipstation_operation_provider_succeeded(
  p_operation_key text,
  p_lease_owner text,
  p_provider_object_id text,
  p_result_summary jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare attempt public.shipstation_operation_attempts%rowtype;
begin
  if not public.shipstation_operation_summary_is_safe(coalesce(p_result_summary, '{}'::jsonb)) then
    raise exception 'shipstation_operation_summary_invalid';
  end if;
  update public.shipstation_operation_attempts
     set status = 'provider_succeeded',
         provider_object_id = coalesce(nullif(trim(p_provider_object_id), ''), provider_object_id),
         result_summary = coalesce(p_result_summary, '{}'::jsonb),
         provider_succeeded_at = coalesce(provider_succeeded_at, now()),
         error_code = null, updated_at = now()
   where operation_key = trim(p_operation_key)
     and status in ('claimed', 'provider_succeeded')
     and lease_owner = trim(p_lease_owner)
  returning * into attempt;
  if not found then raise exception 'shipstation_operation_lease_not_owned'; end if;
  return jsonb_build_object('state', attempt.status, 'attempt_id', attempt.id,
                            'result_summary', attempt.result_summary);
end
$$;

create or replace function public.mark_shipstation_operation_reconcile_required(
  p_operation_key text,
  p_lease_owner text,
  p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.shipstation_operation_attempts
     set status = 'reconcile_required', lease_owner = null,
         error_code = left(coalesce(nullif(trim(p_error_code), ''), 'shipstation_operation_uncertain'), 160),
         updated_at = now()
   where operation_key = trim(p_operation_key)
     and status in ('claimed', 'provider_succeeded')
     and lease_owner = trim(p_lease_owner);
  return found;
end
$$;

create or replace function public.claim_shipstation_operation_reconciliation(
  p_operation_key text,
  p_lease_owner text,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare attempt public.shipstation_operation_attempts%rowtype;
begin
  if length(trim(coalesce(p_lease_owner, ''))) not between 1 and 128
     or p_lease_seconds not between 30 and 600 then
    raise exception 'shipstation_operation_reconcile_claim_invalid';
  end if;
  select * into attempt from public.shipstation_operation_attempts
   where operation_key = trim(p_operation_key) for update;
  if not found or attempt.status not in ('provider_succeeded', 'reconcile_required') then
    raise exception 'shipstation_operation_reconcile_not_required';
  end if;
  if attempt.lease_owner is not null and attempt.lease_expires_at > now()
     and attempt.lease_owner <> trim(p_lease_owner) then
    return jsonb_build_object('state', 'locked', 'attempt_id', attempt.id);
  end if;
  update public.shipstation_operation_attempts
     set lease_owner = trim(p_lease_owner),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where id = attempt.id returning * into attempt;
  return jsonb_build_object('state', 'claimed', 'attempt_id', attempt.id,
                            'operation', attempt.operation,
                            'result_summary', attempt.result_summary,
                            'lease_owner', attempt.lease_owner);
end
$$;

create or replace function public.complete_shipstation_operation_attempt(
  p_operation_key text,
  p_lease_owner text,
  p_result_summary jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare attempt public.shipstation_operation_attempts%rowtype;
begin
  if not public.shipstation_operation_summary_is_safe(coalesce(p_result_summary, '{}'::jsonb)) then
    raise exception 'shipstation_operation_summary_invalid';
  end if;
  update public.shipstation_operation_attempts
     set status = 'completed', result_summary = coalesce(p_result_summary, '{}'::jsonb),
         completed_at = coalesce(completed_at, now()), lease_owner = null, error_code = null,
         updated_at = now()
   where operation_key = trim(p_operation_key)
     and status in ('provider_succeeded', 'reconcile_required')
     and lease_owner = trim(p_lease_owner)
  returning * into attempt;
  if not found then
    select * into attempt from public.shipstation_operation_attempts
     where operation_key = trim(p_operation_key) and status = 'completed';
  end if;
  if not found then raise exception 'shipstation_operation_lease_not_owned'; end if;
  return jsonb_build_object('state', 'completed', 'attempt_id', attempt.id,
                            'result_summary', attempt.result_summary);
end
$$;

create or replace function public.release_shipstation_operation_attempt(
  p_operation_key text,
  p_lease_owner text,
  p_nonacceptance_evidence text,
  p_reason text,
  p_actor_id uuid default null,
  p_actor_email text default null,
  p_error_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare attempt public.shipstation_operation_attempts%rowtype;
begin
  if p_nonacceptance_evidence not in ('provider_not_found', 'provider_rejected', 'local_not_sent')
     or length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'shipstation_operation_release_evidence_required';
  end if;
  update public.shipstation_operation_attempts
     set status = 'released', lease_owner = null,
         error_code = left(coalesce(nullif(trim(p_error_code), ''), 'shipstation_operation_not_accepted'), 160),
         released_at = now(), updated_at = now()
   where operation_key = trim(p_operation_key)
     and status in ('claimed', 'reconcile_required')
     and lease_owner = trim(p_lease_owner)
     and provider_succeeded_at is null
  returning * into attempt;
  if not found then raise exception 'shipstation_operation_release_not_allowed'; end if;
  insert into public.audit_log (actor_user_id, actor_email, action, target_type, target_id, detail)
  values (
    p_actor_id, nullif(trim(p_actor_email), ''), 'shipstation_operation_released',
    'order', attempt.order_id::text,
    jsonb_build_object(
      'attempt_id', attempt.id, 'operation', attempt.operation,
      'nonacceptance_evidence', p_nonacceptance_evidence, 'reason', trim(p_reason)
    )
  );
  return jsonb_build_object('state', 'released', 'attempt_id', attempt.id);
end
$$;

-- Transactional wrappers couple the durable lease to the pre-existing domain lock.
create or replace function public.claim_order_shipment_operation_attempt(
  p_order_id uuid, p_order_shipment_id uuid, p_split_key text,
  p_expected_revision integer, p_operation text, p_package_hash text,
  p_pending_payload jsonb, p_operation_key text, p_request_fingerprint text,
  p_lease_owner text, p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  attempt jsonb;
  domain_claim jsonb;
  operation_name text;
  v_operation_key text := trim(p_operation_key);
  v_generation integer;
begin
  operation_name := 'shipment_' || p_operation;
  if p_operation = 'create' then
    -- The Order lock makes the active-or-next generation stable across the durable
    -- attempt claim and the domain claim. Retries reuse the active generation;
    -- creating after cancellation advances to a new mutation incarnation.
    perform 1 from public.orders where id = p_order_id for update;
    if not found then raise exception 'order_not_found'; end if;
    select generation into v_generation
      from public.order_shipments
     where order_id = p_order_id
       and split_key = trim(p_split_key)
       and status <> 'cancelled'
     order by generation desc
     limit 1;
    if v_generation is null then
      select coalesce(max(generation), -1) + 1 into v_generation
        from public.order_shipments
       where order_id = p_order_id and split_key = trim(p_split_key);
    end if;
    v_operation_key := left(trim(p_operation_key), 480)
      || ':generation:' || v_generation::text;
  end if;
  attempt := public.claim_shipstation_operation_attempt(
    v_operation_key, operation_name, p_order_id, p_order_shipment_id,
    null, null, p_request_fingerprint, p_lease_owner, p_lease_seconds
  );
  if attempt->>'state' <> 'claimed' then
    return attempt || jsonb_build_object('claimed', false, 'operation_key', v_operation_key);
  end if;
  domain_claim := public.claim_order_shipment_operation(
    p_order_id, p_order_shipment_id, p_split_key, p_expected_revision,
    p_operation, p_package_hash, p_pending_payload
  );
  update public.shipstation_operation_attempts
     set order_shipment_id = coalesce(order_shipment_id, (domain_claim->>'id')::uuid), updated_at = now()
   where operation_key = v_operation_key and lease_owner = p_lease_owner and status = 'claimed';
  return domain_claim || jsonb_build_object(
    'attempt_state', 'claimed', 'operation_key', v_operation_key, 'lease_owner', p_lease_owner
  );
end
$$;

create or replace function public.claim_order_shipment_label_purchase_attempt(
  p_order_id uuid, p_order_shipment_id uuid, p_expected_revision integer,
  p_rate_id text, p_operation_key text, p_request_fingerprint text,
  p_lease_owner text, p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  attempt jsonb;
  claimed boolean;
  cancellation_blocked boolean := false;
  v_operation_key text;
  v_provider_shipment_id text;
  v_purchase_generation bigint;
begin
  -- Serialize purchase claims with cancellation confirmation on the same canonical
  -- Order lock. Checking cancellation before this lock leaves a race where confirm
  -- queues while this transaction waits, then postage is purchased after cancellation.
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  select provider_shipment_id into v_provider_shipment_id
    from public.order_shipments
   where id = p_order_shipment_id and order_id = p_order_id;
  select count(*) into v_purchase_generation
    from public.order_provider_links link
   where link.order_id = p_order_id
     and link.provider = 'shipstation'
     and link.object_type = 'label'
     and (
       link.metadata->>'order_shipment_id' = p_order_shipment_id::text
       or (
         coalesce(link.metadata->>'order_shipment_id', '') = ''
         and nullif(v_provider_shipment_id, '') is not null
         and link.metadata->>'shipment_id' = v_provider_shipment_id
       )
     );
  v_operation_key := left(trim(p_operation_key), 480)
    || ':purchase:' || v_purchase_generation::text;
  attempt := public.claim_shipstation_operation_attempt(
    v_operation_key, 'label_purchase', p_order_id, p_order_shipment_id,
    null, null, p_request_fingerprint, p_lease_owner, p_lease_seconds
  );
  if attempt->>'state' <> 'claimed' then
    return attempt || jsonb_build_object('claimed', false, 'operation_key', v_operation_key);
  end if;
  -- This migration can be installed before Order reversals. Resolve the optional table
  -- dynamically, then refuse new provider charges once a confirmed cancellation owns the
  -- Order. A planned preview is intentionally excluded; confirm detects label-set drift.
  if to_regclass('public.order_reversal_commands') is not null then
    execute $query$
      select exists (
        select 1 from public.order_reversal_commands command
         where command.order_id = $1
           and command.type = 'cancel'
           and command.status in ('queued', 'provider_succeeded', 'review_required', 'failed')
      )
    $query$ into cancellation_blocked using p_order_id;
  end if;
  if cancellation_blocked then raise exception 'order_cancellation_in_progress'; end if;
  claimed := public.claim_order_shipment_label_purchase(
    p_order_id, p_order_shipment_id, p_expected_revision, p_rate_id
  );
  if not claimed then raise exception 'shipstation_label_purchase_locked'; end if;
  return attempt || jsonb_build_object('claimed', true, 'operation_key', v_operation_key);
end
$$;

create or replace function public.claim_shipstation_label_void_attempt(
  p_order_id uuid, p_label_id text, p_operation_key text, p_request_fingerprint text,
  p_lease_owner text, p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare attempt jsonb; claimed boolean; label_link record;
begin
  select ownership.* into label_link
    from public.order_shipment_label_ownership ownership
   where ownership.order_id = p_order_id
     and ownership.label_kind = 'outbound'
     and ownership.label_id = p_label_id;
  if not found then raise exception 'shipstation_label_order_mismatch'; end if;
  attempt := public.claim_shipstation_operation_attempt(
    p_operation_key, 'label_void', p_order_id,
    label_link.order_shipment_id,
    label_link.provider_link_id, null, p_request_fingerprint, p_lease_owner, p_lease_seconds
  );
  if attempt->>'state' <> 'claimed' then return attempt || jsonb_build_object('claimed', false); end if;
  claimed := public.claim_shipstation_label_void(p_order_id, p_label_id);
  if not claimed then raise exception 'shipstation_label_void_locked'; end if;
  return attempt || jsonb_build_object('claimed', true, 'operation_key', p_operation_key);
end
$$;

create or replace function public.claim_shipstation_return_label_attempt(
  p_order_id uuid, p_outbound_label_id text, p_operation_key text,
  p_request_fingerprint text, p_lease_owner text, p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare attempt jsonb; outbound public.order_provider_links%rowtype; owning_shipment public.order_shipments%rowtype;
begin
  select link.* into outbound
    from public.order_provider_links link
    join public.order_shipments shipment
      on shipment.order_id = link.order_id and shipment.status <> 'cancelled'
     and shipment.id::text = link.metadata->>'order_shipment_id'
   where link.order_id = p_order_id and link.provider = 'shipstation'
     and link.object_type = 'label' and link.provider_object_id = p_outbound_label_id
     and coalesce(link.metadata->>'status', '') not in ('label_voided', 'voided')
     and not exists (
       select 1 from public.order_financial_entries void_entry
        where void_entry.order_id = p_order_id and void_entry.source = 'shipstation'
          and void_entry.entry_type = 'postage_void_requested'
          and void_entry.provider_object_id = p_outbound_label_id
     );
  if not found then raise exception 'shipstation_return_outbound_not_owned'; end if;
  select * into strict owning_shipment from public.order_shipments
   where id::text = outbound.metadata->>'order_shipment_id' and order_id = p_order_id;
  if exists (
    select 1 from public.order_provider_links child
     where child.order_id = p_order_id and child.provider = 'shipstation'
       and child.object_type = 'return_label'
       and child.metadata->>'outbound_label_id' = p_outbound_label_id
  ) then raise exception 'shipstation_return_already_exists'; end if;

  attempt := public.claim_shipstation_operation_attempt(
    p_operation_key, 'label_return', p_order_id, owning_shipment.id,
    null, outbound.id, p_request_fingerprint, p_lease_owner, p_lease_seconds
  );
  if attempt->>'state' <> 'claimed' then return attempt || jsonb_build_object('claimed', false); end if;

  -- Latest-action projection only. Canonical history remains in provider links.
  update public.orders
     set shipstation_order_shipment_id = owning_shipment.id,
         shipstation_shipment_revision = owning_shipment.revision,
         shipstation_shipment_id = coalesce(outbound.metadata->>'shipment_id', owning_shipment.provider_shipment_id),
         shipstation_label_id = p_outbound_label_id,
         shipstation_label_status = coalesce(nullif(outbound.metadata->>'status', ''), 'label_purchased'),
         shipstation_return_label_id = null,
         shipstation_return_label_status = 'return_purchasing',
         shipstation_return_cost = null,
         shipstation_return_currency = null,
         shipstation_return_charge_event = null,
         shipstation_return_tracking_number = null,
         shipstation_return_error = null,
         shipstation_return_updated_at = now()
   where id = p_order_id and status::text in ('paid','net_open','net_paid','fulfilled');
  if not found then raise exception 'shipstation_return_locked'; end if;
  return attempt || jsonb_build_object('claimed', true, 'operation_key', p_operation_key);
end
$$;

-- Reconciliation finalizers restore the exact split into the latest-action
-- projection inside the same transaction, then reuse the established atomic
-- finance/history finalizers. Canonical ownership remains in provider links.
create or replace function public.finalize_shipstation_label_void_reconciliation(
  p_order_id uuid, p_label_id text, p_actor_id text, p_reason text,
  p_provider_message text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare label record; purchase public.order_financial_entries%rowtype;
begin
  select * into label from public.order_shipment_label_ownership
   where order_id = p_order_id and label_kind = 'outbound' and label_id = p_label_id;
  if not found then raise exception 'shipstation_label_void_reconcile_mismatch'; end if;
  select * into purchase from public.order_financial_entries
   where order_id = p_order_id and source = 'shipstation'
     and entry_type = 'postage_purchase' and provider_object_id = p_label_id;
  update public.orders
     set shipstation_order_shipment_id = label.order_shipment_id,
         shipstation_shipment_revision = label.revision,
         shipstation_shipment_id = label.provider_shipment_id,
         shipstation_label_id = p_label_id,
         shipstation_label_status = 'voiding',
         shipstation_cost = coalesce(purchase.amount, shipstation_cost),
         shipstation_error = null,
         shipstation_updated_at = now()
   where id = p_order_id and status::text in ('paid','net_open','net_paid','fulfilled');
  if not found then raise exception 'shipstation_label_void_reconcile_mismatch'; end if;
  return public.finalize_shipstation_label_void(
    p_order_id, p_label_id, p_actor_id, p_reason, p_provider_message
  );
end
$$;

create or replace function public.finalize_order_shipment_label_reconciliation(
  p_order_id uuid, p_order_shipment_id uuid, p_shipment_id text, p_label_id text,
  p_rate_id text, p_carrier_id text, p_service_code text, p_label_url text,
  p_cost numeric, p_currency text, p_label_status text, p_carrier text,
  p_tracking_number text, p_tracking_url text, p_actor_id uuid,
  p_actor_email text, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare shipment public.order_shipments%rowtype; result jsonb;
begin
  select * into shipment from public.order_shipments
   where id = p_order_shipment_id and order_id = p_order_id
     and status <> 'cancelled' and provider_shipment_id = p_shipment_id;
  if not found then raise exception 'shipstation_label_reconciliation_shipment_mismatch'; end if;
  result := public.finalize_shipstation_label_reconciliation(
    p_order_id, p_shipment_id, p_label_id, p_rate_id, p_carrier_id,
    p_service_code, p_label_url, p_cost, p_currency, p_label_status,
    p_carrier, p_tracking_number, p_tracking_url, p_actor_id, p_actor_email, p_reason
  );
  perform public.link_order_provider_object(
    p_order_id, 'shipstation', 'label', p_label_id,
    jsonb_strip_nulls(jsonb_build_object(
      'order_shipment_id', shipment.id,
      'split_key', shipment.split_key,
      'generation', shipment.generation,
      'revision', shipment.revision,
      'shipment_id', p_shipment_id,
      'rate_id', nullif(trim(p_rate_id), ''),
      'status', p_label_status,
      'tracking_number', nullif(trim(p_tracking_number), ''),
      'carrier', nullif(trim(p_carrier), ''),
      'cost', round(p_cost, 2),
      'currency', lower(trim(p_currency))
    ))
  );
  return result || jsonb_build_object('order_shipment_id', shipment.id);
end
$$;

create or replace function public.finalize_shipstation_return_label_reconciliation(
  p_order_id uuid, p_outbound_label_id text, p_return_label_id text,
  p_cost numeric, p_currency text, p_charge_event text,
  p_tracking_number text, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare outbound record;
begin
  select * into outbound from public.order_shipment_label_ownership
   where order_id = p_order_id and label_kind = 'outbound'
     and label_id = p_outbound_label_id and active;
  if not found then raise exception 'shipstation_return_reconcile_mismatch'; end if;
  update public.orders
     set shipstation_order_shipment_id = outbound.order_shipment_id,
         shipstation_shipment_revision = outbound.revision,
         shipstation_shipment_id = outbound.provider_shipment_id,
         shipstation_label_id = p_outbound_label_id,
         shipstation_label_status = outbound.label_status,
         shipstation_return_label_status = 'return_purchasing',
         shipstation_return_error = null,
         shipstation_return_updated_at = now()
   where id = p_order_id and status::text in ('paid','net_open','net_paid','fulfilled');
  if not found then raise exception 'shipstation_return_reconcile_mismatch'; end if;
  return public.finalize_shipstation_return_label(
    p_order_id, p_outbound_label_id, p_return_label_id, p_cost, p_currency,
    p_charge_event, p_tracking_number, p_reason
  );
end
$$;

revoke all on function public.prevent_shipstation_label_relation_change() from public, anon, authenticated;
revoke all on function public.prevent_shipstation_operation_attempt_identity_change() from public, anon, authenticated;
revoke all on function public.shipstation_operation_summary_is_safe(jsonb) from public, anon, authenticated;
revoke all on function public.claim_shipstation_operation_attempt(text,text,uuid,uuid,uuid,uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.mark_shipstation_operation_provider_succeeded(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.mark_shipstation_operation_reconcile_required(text,text,text) from public, anon, authenticated;
revoke all on function public.claim_shipstation_operation_reconciliation(text,text,integer) from public, anon, authenticated;
revoke all on function public.complete_shipstation_operation_attempt(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.release_shipstation_operation_attempt(text,text,text,text,uuid,text,text) from public, anon, authenticated;
revoke all on function public.claim_order_shipment_operation_attempt(uuid,uuid,text,integer,text,text,jsonb,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.claim_order_shipment_label_purchase_attempt(uuid,uuid,integer,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.claim_shipstation_label_void_attempt(uuid,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.claim_shipstation_return_label_attempt(uuid,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.finalize_shipstation_label_void_reconciliation(uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.finalize_order_shipment_label_reconciliation(uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,text,text,uuid,text,text) from public, anon, authenticated;
revoke all on function public.finalize_shipstation_return_label_reconciliation(uuid,text,text,numeric,text,text,text,text) from public, anon, authenticated;

grant execute on function public.claim_shipstation_operation_attempt(text,text,uuid,uuid,uuid,uuid,text,text,integer) to service_role;
grant execute on function public.shipstation_operation_summary_is_safe(jsonb) to service_role;
grant execute on function public.mark_shipstation_operation_provider_succeeded(text,text,text,jsonb) to service_role;
grant execute on function public.mark_shipstation_operation_reconcile_required(text,text,text) to service_role;
grant execute on function public.claim_shipstation_operation_reconciliation(text,text,integer) to service_role;
grant execute on function public.complete_shipstation_operation_attempt(text,text,jsonb) to service_role;
grant execute on function public.release_shipstation_operation_attempt(text,text,text,text,uuid,text,text) to service_role;
grant execute on function public.claim_order_shipment_operation_attempt(uuid,uuid,text,integer,text,text,jsonb,text,text,text,integer) to service_role;
grant execute on function public.claim_order_shipment_label_purchase_attempt(uuid,uuid,integer,text,text,text,text,integer) to service_role;
grant execute on function public.claim_shipstation_label_void_attempt(uuid,text,text,text,text,integer) to service_role;
grant execute on function public.claim_shipstation_return_label_attempt(uuid,text,text,text,text,integer) to service_role;
grant execute on function public.finalize_shipstation_label_void_reconciliation(uuid,text,text,text,text) to service_role;
grant execute on function public.finalize_order_shipment_label_reconciliation(uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,text,text,uuid,text,text) to service_role;
grant execute on function public.finalize_shipstation_return_label_reconciliation(uuid,text,text,numeric,text,text,text,text) to service_role;

commit;
