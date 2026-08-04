-- Normalized order shipment/package/rate lifecycle for plan 13.3c.
-- Additive and idempotent. Provider mutations are coordinated through
-- service-role-only RPCs; browser clients never write these tables directly.

alter table public.orders add column if not exists shipstation_order_shipment_id uuid;
alter table public.orders add column if not exists shipstation_shipment_revision integer;
alter table public.orders add column if not exists shipstation_package_hash text;
alter table public.orders add column if not exists shipstation_shipment_state text;

create table if not exists public.order_shipments (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references public.orders(id) on delete restrict,
  split_key               text not null default 'default'
                          check (split_key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  generation              integer not null default 0 check (generation >= 0),
  revision                integer not null default 0 check (revision >= 0),
  provider                text not null default 'shipstation' check (provider = 'shipstation'),
  provider_shipment_id    text,
  external_shipment_id    text not null check (length(external_shipment_id) between 1 and 50),
  package_hash            text check (package_hash is null or package_hash ~ '^[a-f0-9]{64}$'),
  status                  text not null default 'draft'
                          check (status in ('draft','rating','rated','updating','cancelling','cancelled','reconcile_required')),
  operation               text check (operation is null or operation in ('create','update','cancel')),
  operation_state         text not null default 'idle'
                          check (operation_state in ('idle','claimed','reconcile_required')),
  selected_rate_id        text,
  item_allocations        jsonb not null default '[]'::jsonb,
  pending_payload         jsonb not null default '{}'::jsonb,
  error_code              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (external_shipment_id)
);
alter table public.order_shipments add column if not exists generation integer not null default 0;
alter table public.order_shipments add column if not exists item_allocations jsonb not null default '[]'::jsonb;
comment on column public.order_shipments.status is
  'ShipStation provider-shipment operation state; distinct from company-visible orders.tracking_status.';
alter table public.order_shipments drop constraint if exists order_shipments_order_id_split_key_key;
create unique index if not exists order_shipments_split_generation_uidx
  on public.order_shipments (order_id, split_key, generation);
create unique index if not exists order_shipments_active_split_uidx
  on public.order_shipments (order_id, split_key)
  where status <> 'cancelled';
create unique index if not exists order_shipments_provider_id_uidx
  on public.order_shipments (provider, provider_shipment_id)
  where provider_shipment_id is not null;
create index if not exists order_shipments_order_idx
  on public.order_shipments (order_id, updated_at desc);

create table if not exists public.order_shipment_packages (
  id                    uuid primary key default gen_random_uuid(),
  order_shipment_id     uuid not null references public.order_shipments(id) on delete cascade,
  sequence              integer not null check (sequence between 1 and 20),
  package_code          text not null default 'package',
  weight_value          numeric(12,3) not null check (weight_value > 0 and weight_value <= 10000),
  weight_unit           text not null check (weight_unit in ('pound','ounce','gram','kilogram')),
  length_in             numeric(10,3) check (length_in is null or (length_in > 0 and length_in <= 1000)),
  width_in              numeric(10,3) check (width_in is null or (width_in > 0 and width_in <= 1000)),
  height_in             numeric(10,3) check (height_in is null or (height_in > 0 and height_in <= 1000)),
  package_hash          text not null check (package_hash ~ '^[a-f0-9]{64}$'),
  created_at            timestamptz not null default now(),
  unique (order_shipment_id, sequence),
  check (
    (length_in is null and width_in is null and height_in is null)
    or (length_in is not null and width_in is not null and height_in is not null)
  )
);
-- Upgrade path from pre-normalization previews: copy one duplicated package allocation
-- onto its owning shipment. Keep the legacy column until a separately staged cleanup
-- confirms every deployed environment has completed this backfill.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'order_shipment_packages'
       and column_name = 'item_allocations'
  ) then
    execute $backfill$
      update public.order_shipments shipment
         set item_allocations = allocation.item_allocations
        from (
          select distinct on (order_shipment_id) order_shipment_id, item_allocations
            from public.order_shipment_packages
           where jsonb_typeof(item_allocations) = 'array'
             and jsonb_array_length(item_allocations) > 0
           order by order_shipment_id, sequence
        ) allocation
       where shipment.id = allocation.order_shipment_id
         and shipment.item_allocations = '[]'::jsonb
    $backfill$;
  end if;
end
$$;

create table if not exists public.order_shipment_rates (
  id                      uuid primary key default gen_random_uuid(),
  order_shipment_id       uuid not null references public.order_shipments(id) on delete cascade,
  shipment_revision       integer not null check (shipment_revision >= 0),
  provider_rate_id        text not null,
  provider_shipment_id    text not null,
  carrier_id              text,
  carrier_code            text,
  carrier_name            text,
  service_code            text,
  service_type            text,
  amount_minor            bigint not null check (amount_minor >= 0),
  currency                text not null check (currency ~ '^[a-z]{3}$'),
  currency_exponent       smallint not null check (currency_exponent between 0 and 3),
  package_hash            text not null check (package_hash ~ '^[a-f0-9]{64}$'),
  delivery_days           integer check (delivery_days is null or delivery_days >= 0),
  estimated_delivery_at   timestamptz,
  selected                boolean not null default false,
  invalidated_at          timestamptz,
  created_at              timestamptz not null default now(),
  unique (order_shipment_id, shipment_revision, provider_rate_id)
);
create unique index if not exists order_shipment_rates_one_selected_uidx
  on public.order_shipment_rates (order_shipment_id)
  where selected and invalidated_at is null;
create index if not exists order_shipment_rates_shipment_idx
  on public.order_shipment_rates (order_shipment_id, created_at desc);

create or replace function public.order_shipment_package_hash(p_packages jsonb)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(convert_to(coalesce(string_agg(
    array_to_string(array[
      package.ordinality::text,
      coalesce(package.value->>'package_code', 'package'),
      coalesce(package.value->'weight'->>'unit', ''),
      to_char((package.value->'weight'->>'value')::numeric, 'FM9999999990.000'),
      coalesce(package.value->'dimensions'->>'unit', ''),
      coalesce(to_char((package.value->'dimensions'->>'length')::numeric, 'FM9999999990.000'), ''),
      coalesce(to_char((package.value->'dimensions'->>'width')::numeric, 'FM9999999990.000'), ''),
      coalesce(to_char((package.value->'dimensions'->>'height')::numeric, 'FM9999999990.000'), '')
    ], '|', ''), E'\n' order by package.ordinality
  ), ''), 'UTF8'), 'sha256'), 'hex')
  from jsonb_array_elements(coalesce(p_packages, '[]'::jsonb)) with ordinality package(value, ordinality)
$$;
revoke all on function public.order_shipment_package_hash(jsonb) from public, anon, authenticated;
grant execute on function public.order_shipment_package_hash(jsonb) to service_role;

alter table public.order_shipments enable row level security;
alter table public.order_shipment_packages enable row level security;
alter table public.order_shipment_rates enable row level security;
revoke all on public.order_shipments from public, anon, authenticated;
revoke all on public.order_shipment_packages from public, anon, authenticated;
revoke all on public.order_shipment_rates from public, anon, authenticated;
grant select, insert, update, delete on public.order_shipments to service_role;
grant select, insert, update, delete on public.order_shipment_packages to service_role;
grant select, insert, update, delete on public.order_shipment_rates to service_role;

create or replace function public.claim_order_shipment_operation(
  p_order_id uuid,
  p_order_shipment_id uuid,
  p_split_key text,
  p_expected_revision integer,
  p_operation text,
  p_package_hash text,
  p_pending_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_shipment public.order_shipments%rowtype;
  v_next_revision integer;
  v_external text;
  v_item jsonb;
  v_available integer;
  v_allocated integer;
  v_item_count integer;
  v_sku_count integer;
  v_split_generation integer;
begin
  if p_expected_revision is null or p_expected_revision < 0
     or p_operation not in ('create','update','cancel')
     or coalesce(trim(p_split_key), '') !~ '^[a-z0-9][a-z0-9_-]{0,39}$'
     or (p_package_hash is not null and p_package_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'order_shipment_claim_invalid';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_shipment_order_not_found';
  end if;
  if v_order.status::text not in ('paid','net_open','net_paid','fulfilled')
     or (v_order.shipstation_label_id is not null
         and coalesce(v_order.shipstation_label_status, '') not in ('label_voided','voided'))
     or coalesce(v_order.shipstation_label_status, '') in
        ('purchasing','reconcile_required','voiding','void_reconcile_required') then
    raise exception 'order_shipment_locked_by_label';
  end if;

  if p_operation = 'create' then
    select * into v_shipment
      from public.order_shipments
     where order_id = p_order_id
       and split_key = trim(p_split_key)
       and status <> 'cancelled'
     for update;
    if found then
      raise exception 'order_shipment_split_exists';
    else
      if p_expected_revision <> 0 then
        raise exception 'order_shipment_revision_stale';
      end if;
      select coalesce(max(generation), -1) + 1 into v_split_generation
        from public.order_shipments
       where order_id = p_order_id and split_key = trim(p_split_key);
      v_next_revision := 0;
      v_external := 'mst-' || replace(p_order_id::text, '-', '') || '-'
        || substr(md5(trim(p_split_key) || ':' || v_split_generation::text || ':0'), 1, 12);
      insert into public.order_shipments (
        order_id, split_key, generation, revision, external_shipment_id, package_hash,
        status, operation, operation_state, pending_payload
      ) values (
        p_order_id, trim(p_split_key), v_split_generation, v_next_revision, v_external, p_package_hash,
        'rating', 'create', 'claimed', coalesce(p_pending_payload, '{}'::jsonb)
      ) returning * into v_shipment;
    end if;
  else
    select * into v_shipment
      from public.order_shipments
     where id = p_order_shipment_id and order_id = p_order_id
     for update;
    if not found then
      raise exception 'order_shipment_not_found';
    end if;
    if v_shipment.revision <> p_expected_revision then
      raise exception 'order_shipment_revision_stale';
    end if;
    if v_shipment.operation_state <> 'idle' or v_shipment.status <> 'rated'
       or v_shipment.provider_shipment_id is null then
      raise exception 'order_shipment_operation_locked';
    end if;
    if exists (
      select 1
        from (
          select v_order.shipstation_label_id as label_id
           where v_order.shipstation_shipment_id = v_shipment.provider_shipment_id
          union
          select link.provider_object_id
            from public.order_provider_links link
           where link.order_id = p_order_id
             and link.provider = 'shipstation'
             and link.object_type = 'label'
             and link.metadata->>'shipment_id' = v_shipment.provider_shipment_id
          union
          select purchase.provider_object_id
            from public.order_financial_entries purchase
           where purchase.order_id = p_order_id
             and purchase.source = 'shipstation'
             and purchase.entry_type = 'postage_purchase'
             and purchase.metadata->>'shipment_id' = v_shipment.provider_shipment_id
        ) linked_labels
       where linked_labels.label_id is not null
         and not exists (
           select 1
             from public.order_financial_entries void_entry
            where void_entry.order_id = p_order_id
              and void_entry.source = 'shipstation'
              and void_entry.entry_type = 'postage_void_requested'
              and void_entry.provider_object_id = linked_labels.label_id
         )
    ) then
      raise exception 'order_shipment_locked_by_label';
    end if;
    update public.order_shipments
       set status = case p_operation when 'update' then 'updating' else 'cancelling' end,
           operation = p_operation,
           operation_state = 'claimed',
           pending_payload = coalesce(p_pending_payload, '{}'::jsonb)
             || jsonb_build_object(
               '_previous_package_hash', package_hash,
               '_previous_pending_payload', pending_payload
             ),
           error_code = null,
           updated_at = now()
     where id = v_shipment.id
     returning * into v_shipment;
  end if;

  if p_operation in ('create','update') then
    if jsonb_typeof(coalesce(p_pending_payload->'packages', 'null'::jsonb)) <> 'array'
       or p_package_hash is distinct from public.order_shipment_package_hash(p_pending_payload->'packages') then
      raise exception 'order_shipment_package_hash_mismatch';
    end if;
    if jsonb_typeof(coalesce(p_pending_payload->'items', 'null'::jsonb)) <> 'array'
       or jsonb_array_length(p_pending_payload->'items') = 0 then
      raise exception 'order_shipment_items_required';
    end if;
    select count(*), count(distinct value->>'sku')
      into v_item_count, v_sku_count
      from jsonb_array_elements(p_pending_payload->'items');
    if v_item_count <> v_sku_count then
      raise exception 'order_shipment_items_invalid';
    end if;
    for v_item in select value from jsonb_array_elements(p_pending_payload->'items')
    loop
      if coalesce(v_item->>'sku', '') = ''
         or coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]*$' then
        raise exception 'order_shipment_items_invalid';
      end if;
      select coalesce(sum(qty), 0)::integer into v_available
        from public.order_items
       where order_id = p_order_id and sku = v_item->>'sku';
      select coalesce(sum((allocated.value->>'quantity')::integer), 0)::integer into v_allocated
        from public.order_shipments existing
        cross join lateral jsonb_array_elements(coalesce(existing.pending_payload->'items', '[]'::jsonb)) allocated(value)
       where existing.order_id = p_order_id
         and existing.id <> v_shipment.id
         and existing.status <> 'cancelled'
         and allocated.value->>'sku' = v_item->>'sku';
      if v_available <= 0 or v_allocated + (v_item->>'quantity')::integer > v_available then
        raise exception 'order_shipment_item_conservation_failed';
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'claimed', true,
    'id', v_shipment.id,
    'generation', v_shipment.generation,
    'revision', v_shipment.revision,
    'provider_shipment_id', v_shipment.provider_shipment_id,
    'external_shipment_id', v_shipment.external_shipment_id,
    'operation', v_shipment.operation
  );
end;
$$;
revoke all on function public.claim_order_shipment_operation(uuid, uuid, text, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_order_shipment_operation(uuid, uuid, text, integer, text, text, jsonb)
  to service_role;

create or replace function public.fail_order_shipment_operation(
  p_order_shipment_id uuid,
  p_expected_revision integer,
  p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.order_shipments
     set status = 'reconcile_required',
         operation_state = 'reconcile_required',
         error_code = left(coalesce(nullif(trim(p_error_code), ''), 'shipstation_request_failed'), 160),
         updated_at = now()
   where id = p_order_shipment_id
     and revision = p_expected_revision
     and operation_state = 'claimed'
  returning id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.fail_order_shipment_operation(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.fail_order_shipment_operation(uuid, integer, text)
  to service_role;

create or replace function public.release_order_shipment_operation(
  p_order_shipment_id uuid,
  p_expected_revision integer,
  p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.order_shipments
     set status = case when operation = 'create' then 'cancelled' else 'rated' end,
         package_hash = case
           when operation in ('update','cancel')
             then nullif(pending_payload->>'_previous_package_hash', '')
           else package_hash
         end,
         pending_payload = case
           when operation in ('update','cancel')
             then coalesce(pending_payload->'_previous_pending_payload', '{}'::jsonb)
           else pending_payload
         end,
         operation = null,
         operation_state = 'idle',
         error_code = left(coalesce(nullif(trim(p_error_code), ''), 'shipstation_request_failed'), 160),
         updated_at = now()
   where id = p_order_shipment_id
     and revision = p_expected_revision
     and operation_state = 'claimed'
  returning id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.release_order_shipment_operation(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.release_order_shipment_operation(uuid, integer, text)
  to service_role;

create or replace function public.finalize_order_shipment_operation(
  p_order_shipment_id uuid,
  p_expected_revision integer,
  p_provider_shipment_id text,
  p_status text,
  p_package_hash text,
  p_packages jsonb,
  p_rates jsonb,
  p_actor_id uuid,
  p_actor_email text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.order_shipments%rowtype;
  v_package jsonb;
  v_rate jsonb;
  v_sequence integer := 0;
  v_next_revision integer;
begin
  if p_expected_revision is null or p_expected_revision < 0
     or p_status not in ('rated','cancelled')
     or p_provider_shipment_id is null
     or p_provider_shipment_id !~ '^se-[A-Za-z0-9_-]+$'
     or (p_package_hash is not null and p_package_hash !~ '^[a-f0-9]{64}$')
     or jsonb_typeof(coalesce(p_packages, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_rates, '[]'::jsonb)) <> 'array' then
    raise exception 'order_shipment_finalize_invalid';
  end if;
  if p_status = 'rated' and (
    p_package_hash is null
    or jsonb_array_length(p_packages) = 0
    or jsonb_array_length(p_packages) > 20
  ) then
    raise exception 'order_shipment_packages_invalid';
  end if;
  if p_status = 'rated'
     and p_package_hash is distinct from public.order_shipment_package_hash(p_packages) then
    raise exception 'order_shipment_package_hash_mismatch';
  end if;
  select * into v_shipment
    from public.order_shipments
   where id = p_order_shipment_id
   for update;
  if not found or v_shipment.revision <> p_expected_revision
     or v_shipment.operation_state not in ('claimed','reconcile_required') then
    raise exception 'order_shipment_revision_stale';
  end if;
  if (p_status = 'cancelled' and v_shipment.operation <> 'cancel')
     or (p_status = 'rated' and v_shipment.operation not in ('create','update')) then
    raise exception 'order_shipment_finalize_mismatch';
  end if;
  v_next_revision := v_shipment.revision
    + case when v_shipment.operation in ('update','cancel') then 1 else 0 end;

  update public.order_shipment_rates
     set selected = false, invalidated_at = coalesce(invalidated_at, now())
   where order_shipment_id = v_shipment.id and invalidated_at is null;

  if p_status = 'rated' then
    delete from public.order_shipment_packages where order_shipment_id = v_shipment.id;
    for v_package in select value from jsonb_array_elements(p_packages)
    loop
      v_sequence := v_sequence + 1;
      if v_sequence > 20 then raise exception 'order_shipment_packages_invalid'; end if;
      insert into public.order_shipment_packages (
        order_shipment_id, sequence, package_code, weight_value, weight_unit,
        length_in, width_in, height_in, package_hash
      ) values (
        v_shipment.id, v_sequence, coalesce(nullif(v_package->>'package_code', ''), 'package'),
        (v_package->'weight'->>'value')::numeric, v_package->'weight'->>'unit',
        nullif(v_package->'dimensions'->>'length', '')::numeric,
        nullif(v_package->'dimensions'->>'width', '')::numeric,
        nullif(v_package->'dimensions'->>'height', '')::numeric,
        p_package_hash
      );
    end loop;
    for v_rate in select value from jsonb_array_elements(p_rates)
    loop
      insert into public.order_shipment_rates (
        order_shipment_id, shipment_revision, provider_rate_id, provider_shipment_id,
        carrier_id, carrier_code, carrier_name, service_code, service_type,
        amount_minor, currency, currency_exponent, package_hash,
        delivery_days, estimated_delivery_at
      ) values (
        v_shipment.id, v_next_revision, v_rate->>'rate_id', p_provider_shipment_id,
        nullif(v_rate->>'carrier_id', ''), nullif(v_rate->>'carrier_code', ''),
        nullif(v_rate->>'carrier_name', ''), nullif(v_rate->>'service_code', ''),
        nullif(v_rate->>'service_type', ''), (v_rate->>'amount_minor')::bigint,
        lower(v_rate->>'currency'), (v_rate->>'currency_exponent')::smallint,
        p_package_hash,
        nullif(v_rate->>'delivery_days', '')::integer,
        nullif(v_rate->>'estimated_delivery_date', '')::timestamptz
      ) on conflict (order_shipment_id, shipment_revision, provider_rate_id) do update
        set invalidated_at = null,
            selected = false,
            provider_shipment_id = excluded.provider_shipment_id,
            carrier_id = excluded.carrier_id,
            carrier_code = excluded.carrier_code,
            carrier_name = excluded.carrier_name,
            service_code = excluded.service_code,
            service_type = excluded.service_type,
            amount_minor = excluded.amount_minor,
            currency = excluded.currency,
            currency_exponent = excluded.currency_exponent,
            package_hash = excluded.package_hash,
            delivery_days = excluded.delivery_days,
            estimated_delivery_at = excluded.estimated_delivery_at;
    end loop;
  end if;

  update public.order_shipments
     set revision = v_next_revision,
         provider_shipment_id = p_provider_shipment_id,
         package_hash = coalesce(p_package_hash, package_hash),
         status = p_status,
         operation = null,
         operation_state = 'idle',
         selected_rate_id = null,
         item_allocations = case
           when p_status = 'rated' then coalesce(v_shipment.pending_payload->'items', '[]'::jsonb)
           else item_allocations
         end,
         pending_payload = pending_payload - '_previous_package_hash' - '_previous_pending_payload',
         error_code = null,
         updated_at = now()
   where id = v_shipment.id;

  perform public.link_order_provider_object(
    v_shipment.order_id, 'shipstation', 'shipment', p_provider_shipment_id,
    jsonb_strip_nulls(jsonb_build_object(
      'order_shipment_id', v_shipment.id,
      'split_key', v_shipment.split_key,
      'generation', v_shipment.generation,
      'revision', v_next_revision,
      'status', p_status,
      'package_hash', coalesce(p_package_hash, v_shipment.package_hash)
    ))
  );

  if v_shipment.split_key = 'default' then
    update public.orders
       set shipstation_order_shipment_id = v_shipment.id,
           shipstation_shipment_revision = v_next_revision,
           shipstation_package_hash = coalesce(p_package_hash, v_shipment.package_hash),
           shipstation_shipment_state = p_status,
           shipstation_shipment_id = case when p_status = 'cancelled' then null else p_provider_shipment_id end,
           shipstation_rate_id = null,
           shipstation_label_status = case when p_status = 'cancelled' then null else 'rated' end,
           shipstation_error = null,
           shipstation_updated_at = now()
     where id = v_shipment.order_id;
  end if;

  insert into public.audit_log (
    actor_user_id, actor_email, action, target_type, target_id, detail
  ) values (
    p_actor_id, nullif(trim(p_actor_email), ''),
    'shipstation_shipment_' || p_status,
    'order', v_shipment.order_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'order_shipment_id', v_shipment.id,
      'shipment_id', p_provider_shipment_id,
      'split_key', v_shipment.split_key,
      'revision', v_next_revision,
      'package_hash', coalesce(p_package_hash, v_shipment.package_hash),
      'reason', nullif(trim(p_reason), '')
    ))
  );

  return jsonb_build_object(
    'applied', true,
    'order_shipment_id', v_shipment.id,
    'shipment_id', p_provider_shipment_id,
    'revision', v_next_revision,
    'status', p_status
  );
end;
$$;
revoke all on function public.finalize_order_shipment_operation(uuid, integer, text, text, text, jsonb, jsonb, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_order_shipment_operation(uuid, integer, text, text, text, jsonb, jsonb, uuid, text, text)
  to service_role;

create or replace function public.select_order_shipment_rate(
  p_order_id uuid,
  p_order_shipment_id uuid,
  p_expected_revision integer,
  p_rate_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.order_shipments%rowtype;
  v_rate public.order_shipment_rates%rowtype;
begin
  select * into v_shipment
    from public.order_shipments
   where id = p_order_shipment_id and order_id = p_order_id
   for update;
  if not found or v_shipment.revision <> p_expected_revision
     or v_shipment.status <> 'rated' or v_shipment.operation_state <> 'idle' then
    raise exception 'order_shipment_revision_stale';
  end if;
  select * into v_rate
    from public.order_shipment_rates
   where order_shipment_id = v_shipment.id
     and provider_rate_id = p_rate_id
     and shipment_revision = v_shipment.revision
     and invalidated_at is null;
  if not found or v_rate.provider_shipment_id <> v_shipment.provider_shipment_id then
    raise exception 'order_shipment_rate_invalid';
  end if;
  update public.order_shipment_rates
     set selected = false
   where order_shipment_id = v_shipment.id and invalidated_at is null;
  update public.order_shipment_rates set selected = true where id = v_rate.id;
  update public.order_shipments set selected_rate_id = p_rate_id, updated_at = now()
   where id = v_shipment.id;
  if v_shipment.split_key = 'default' then
    update public.orders set shipstation_rate_id = p_rate_id, shipstation_updated_at = now()
     where id = p_order_id;
  end if;
  return jsonb_build_object(
    'selected', true,
    'order_shipment_id', v_shipment.id,
    'shipment_id', v_shipment.provider_shipment_id,
    'rate_id', p_rate_id,
    'revision', v_shipment.revision,
    'amount_minor', v_rate.amount_minor,
    'currency', v_rate.currency
  );
end;
$$;
revoke all on function public.select_order_shipment_rate(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.select_order_shipment_rate(uuid, uuid, integer, text)
  to service_role;

create or replace function public.claim_order_shipment_label_purchase(
  p_order_id uuid,
  p_order_shipment_id uuid,
  p_expected_revision integer,
  p_rate_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_shipment public.order_shipments%rowtype;
  v_rate public.order_shipment_rates%rowtype;
begin
  if p_expected_revision is null or p_expected_revision < 0
     or p_rate_id is null or p_rate_id !~ '^se-[A-Za-z0-9_-]+$' then
    return false;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status::text not in ('paid','net_open','net_paid','fulfilled')
     or coalesce(v_order.shipstation_label_status, '') in ('purchasing','reconcile_required') then
    return false;
  end if;

  select * into v_shipment
    from public.order_shipments
   where id = p_order_shipment_id and order_id = p_order_id
   for update;
  if not found or v_shipment.revision <> p_expected_revision
     or v_shipment.status <> 'rated' or v_shipment.operation_state <> 'idle'
     or v_shipment.provider_shipment_id is null
     or v_shipment.selected_rate_id is distinct from p_rate_id then
    return false;
  end if;

  select * into v_rate
    from public.order_shipment_rates
   where order_shipment_id = v_shipment.id
     and provider_rate_id = p_rate_id
     and provider_shipment_id = v_shipment.provider_shipment_id
     and shipment_revision = v_shipment.revision
     and package_hash = v_shipment.package_hash
     and selected
     and invalidated_at is null;
  if not found or v_rate.currency <> lower(v_order.currency) then return false; end if;

  -- An order may have one active label per split shipment. Legacy order columns
  -- are only a latest-action projection; provider/financial links prove ownership.
  if (
    v_order.shipstation_order_shipment_id = v_shipment.id
    and v_order.shipstation_label_id is not null
    and coalesce(v_order.shipstation_label_status, '') not in ('label_voided','voided')
  ) or exists (
    select 1
      from public.order_provider_links label_link
     where label_link.order_id = p_order_id
       and label_link.provider = 'shipstation'
       and label_link.object_type = 'label'
       and (
         label_link.metadata->>'order_shipment_id' = v_shipment.id::text
         or label_link.metadata->>'shipment_id' = v_shipment.provider_shipment_id
       )
       and not exists (
         select 1
           from public.order_financial_entries void_entry
          where void_entry.order_id = p_order_id
            and void_entry.source = 'shipstation'
            and void_entry.entry_type = 'postage_void_requested'
            and void_entry.provider_object_id = label_link.provider_object_id
       )
  ) then
    return false;
  end if;

  -- Split planning may be incremental, but charging postage may not begin until
  -- every ordered SKU is allocated exactly once across active shipments.
  if exists (
    select 1
      from (
        select sku, sum(qty)::integer as required_quantity
          from public.order_items
         where order_id = p_order_id
         group by sku
      ) required
      left join (
        select allocated.value->>'sku' as sku,
               sum((allocated.value->>'quantity')::integer)::integer as allocated_quantity
          from public.order_shipments existing
          cross join lateral jsonb_array_elements(
            coalesce(existing.pending_payload->'items', '[]'::jsonb)
          ) allocated(value)
         where existing.order_id = p_order_id
           and existing.status <> 'cancelled'
         group by allocated.value->>'sku'
      ) allocated using (sku)
     where coalesce(allocated.allocated_quantity, 0) <> required.required_quantity
  ) then
    raise exception 'order_shipment_item_conservation_failed';
  end if;

  update public.orders
     set shipstation_order_shipment_id = v_shipment.id,
         shipstation_shipment_revision = v_shipment.revision,
         shipstation_package_hash = v_shipment.package_hash,
         shipstation_shipment_state = v_shipment.status,
         shipstation_shipment_id = v_shipment.provider_shipment_id,
         shipstation_rate_id = p_rate_id,
         shipstation_label_status = 'purchasing',
         shipstation_label_id = null,
         shipstation_label_url = null,
         shipstation_cost = null,
         shipstation_carrier_id = null,
         shipstation_service_code = null,
         carrier = null,
         tracking_number = null,
         tracking_url = null,
         shipstation_return_label_id = null,
         shipstation_return_label_status = null,
         shipstation_return_cost = null,
         shipstation_return_currency = null,
         shipstation_return_charge_event = null,
         shipstation_return_tracking_number = null,
         shipstation_return_error = null,
         shipstation_return_updated_at = null,
         shipstation_error = null,
         shipstation_updated_at = now()
   where id = p_order_id;
  return true;
end;
$$;
revoke all on function public.claim_order_shipment_label_purchase(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_order_shipment_label_purchase(uuid, uuid, integer, text)
  to service_role;

drop function if exists public.verify_order_shipment_rate(uuid, text, text);
create or replace function public.verify_order_shipment_rate(
  p_order_id uuid,
  p_order_shipment_id uuid,
  p_expected_revision integer,
  p_shipment_id text,
  p_rate_id text
) returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'selected', true,
      'order_shipment_id', s.id,
      'shipment_id', s.provider_shipment_id,
      'rate_id', r.provider_rate_id,
      'revision', s.revision,
      'package_hash', r.package_hash,
      'amount_minor', r.amount_minor,
      'currency', r.currency,
      'currency_exponent', r.currency_exponent
    )
      from public.order_shipments s
      join public.orders o on o.id = s.order_id
      join public.order_shipment_rates r
        on r.order_shipment_id = s.id
     where s.order_id = p_order_id
       and s.id = p_order_shipment_id
       and s.revision = p_expected_revision
       and s.provider_shipment_id = p_shipment_id
       and s.selected_rate_id = p_rate_id
       and s.status = 'rated'
       and s.operation_state = 'idle'
       and r.provider_rate_id = p_rate_id
       and r.provider_shipment_id = p_shipment_id
       and r.shipment_revision = s.revision
       and r.package_hash = s.package_hash
       and r.currency = lower(o.currency)
       and r.selected
       and r.invalidated_at is null
     limit 1
  )::jsonb, '{"selected":false}'::jsonb);
$$;
revoke all on function public.verify_order_shipment_rate(uuid, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.verify_order_shipment_rate(uuid, uuid, integer, text, text)
  to service_role;
