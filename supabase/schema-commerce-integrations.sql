-- Canonical commerce identity + cross-provider object registry.
-- Rerunnable; DDL and deterministic backfill commit atomically.
begin;

lock table public.orders in share row exclusive mode;

create sequence if not exists public.masest_order_number_seq
  as bigint minvalue 1 start with 1 increment by 1 no cycle;

alter table public.orders add column if not exists order_number text;

-- Keep already-issued numbers. Number legacy rows deterministically by creation time.
-- Never rewind a sequence that may have reserved numbers during an earlier run.
do $$
declare
  v_existing_max bigint := 0;
  v_sequence_value bigint := 0;
  v_sequence_called boolean := false;
  v_target bigint := 0;
begin
  select coalesce(max(substring(order_number from '^MST-([0-9]{8})$')::bigint), 0)
    into v_existing_max
    from public.orders
   where order_number ~ '^MST-[0-9]{8}$';

  with missing as (
    select id, row_number() over (order by created_at, id) as ordinal
      from public.orders
     where order_number is null
  )
  update public.orders as orders
     set order_number = 'MST-' || lpad((v_existing_max + missing.ordinal)::text, 8, '0')
    from missing
   where orders.id = missing.id;

  select last_value, is_called
    into v_sequence_value, v_sequence_called
    from public.masest_order_number_seq;
  select coalesce(max(substring(order_number from '^MST-([0-9]{8})$')::bigint), 0)
    into v_existing_max
    from public.orders;
  v_target := greatest(v_existing_max, case when v_sequence_called then v_sequence_value else 0 end);
  if v_target = 0 then
    perform setval('public.masest_order_number_seq', 1, false);
  else
    perform setval('public.masest_order_number_seq', v_target, true);
  end if;
end
$$;

create or replace function public.next_order_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_value bigint;
begin
  v_value := nextval('public.masest_order_number_seq');
  if v_value > 99999999 then
    raise exception using errcode = '22003', message = 'order_number_space_exhausted';
  end if;
  return 'MST-' || lpad(v_value::text, 8, '0');
end
$$;

alter table public.orders alter column order_number set default public.next_order_number();
alter table public.orders alter column order_number set not null;

create unique index if not exists orders_order_number_uidx
  on public.orders (order_number);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.orders'::regclass
       and conname = 'orders_order_number_format_chk'
  ) then
    alter table public.orders add constraint orders_order_number_format_chk
      check (order_number ~ '^MST-[0-9]{8}$');
  end if;
end
$$;

create or replace function public.prevent_order_number_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.order_number is distinct from old.order_number then
    raise exception using errcode = '23514', message = 'order_number_immutable';
  end if;
  return new;
end
$$;

drop trigger if exists orders_order_number_immutable on public.orders;
create trigger orders_order_number_immutable
before update of order_number on public.orders
for each row execute function public.prevent_order_number_change();

create table if not exists public.order_provider_links (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'shipstation', 'quickbooks', 'resend')),
  object_type text not null check (object_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  provider_object_id text not null check (length(provider_object_id) between 1 and 255),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, object_type, provider_object_id)
);

create index if not exists order_provider_links_order_idx
  on public.order_provider_links (order_id, provider, object_type);

create or replace function public.prevent_order_provider_link_identity_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.order_id is distinct from old.order_id
     or new.provider is distinct from old.provider
     or new.object_type is distinct from old.object_type
     or new.provider_object_id is distinct from old.provider_object_id then
    raise exception using errcode = '23514', message = 'order_provider_link_identity_immutable';
  end if;
  return new;
end
$$;

drop trigger if exists order_provider_links_identity_immutable on public.order_provider_links;
create trigger order_provider_links_identity_immutable
before update of order_id, provider, object_type, provider_object_id
on public.order_provider_links
for each row execute function public.prevent_order_provider_link_identity_change();

alter table public.order_provider_links enable row level security;

create or replace function public.link_order_provider_object(
  p_order_id uuid,
  p_provider text,
  p_object_type text,
  p_provider_object_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_order_id is null
     or p_provider not in ('stripe', 'shipstation', 'quickbooks', 'resend')
     or p_object_type !~ '^[a-z][a-z0-9_]{0,63}$'
     or nullif(btrim(p_provider_object_id), '') is null
     or length(p_provider_object_id) > 255
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_order_provider_link';
  end if;

  insert into public.order_provider_links (
    order_id, provider, object_type, provider_object_id, metadata
  ) values (
    p_order_id, p_provider, p_object_type, btrim(p_provider_object_id), coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (provider, object_type, provider_object_id) do update
     set metadata = public.order_provider_links.metadata || excluded.metadata,
         updated_at = now()
   where public.order_provider_links.order_id = excluded.order_id
  returning id into v_id;

  if v_id is null then
    raise exception using errcode = '23505', message = 'provider_object_already_claimed';
  end if;
  return v_id;
end
$$;

-- Backfill provider IDs already held on legacy order columns.
insert into public.order_provider_links (order_id, provider, object_type, provider_object_id)
select id, 'stripe', 'payment_intent', stripe_payment_intent from public.orders
 where stripe_payment_intent is not null and stripe_payment_intent <> ''
on conflict (provider, object_type, provider_object_id) do nothing;

insert into public.order_provider_links (order_id, provider, object_type, provider_object_id)
select id, 'quickbooks', 'invoice', qbo_invoice_id from public.orders
 where qbo_invoice_id is not null and qbo_invoice_id <> ''
on conflict (provider, object_type, provider_object_id) do nothing;

insert into public.order_provider_links (order_id, provider, object_type, provider_object_id)
select id, 'quickbooks', 'document', qbo_doc_id from public.orders
 where qbo_doc_id is not null and qbo_doc_id <> '' and qbo_invoice_id is null
on conflict (provider, object_type, provider_object_id) do nothing;

insert into public.order_provider_links (order_id, provider, object_type, provider_object_id)
select id, 'quickbooks', 'payment', qbo_payment_id from public.orders
 where qbo_payment_id is not null and qbo_payment_id <> ''
on conflict (provider, object_type, provider_object_id) do nothing;

insert into public.order_provider_links (order_id, provider, object_type, provider_object_id)
select id, 'shipstation', 'shipment', shipstation_shipment_id from public.orders
 where shipstation_shipment_id is not null and shipstation_shipment_id <> ''
on conflict (provider, object_type, provider_object_id) do nothing;

insert into public.order_provider_links (order_id, provider, object_type, provider_object_id)
select id, 'shipstation', 'label', shipstation_label_id from public.orders
 where shipstation_label_id is not null and shipstation_label_id <> ''
on conflict (provider, object_type, provider_object_id) do nothing;

insert into public.order_provider_links (order_id, provider, object_type, provider_object_id)
select id, 'shipstation', 'rate', shipstation_rate_id from public.orders
 where shipstation_rate_id is not null and shipstation_rate_id <> ''
on conflict (provider, object_type, provider_object_id) do nothing;

revoke all on function public.next_order_number() from public, anon, authenticated;
grant execute on function public.next_order_number() to service_role;
revoke all on function public.link_order_provider_object(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.link_order_provider_object(uuid, text, text, text, jsonb) to service_role;
revoke all on table public.order_provider_links from public, anon, authenticated;
grant select, insert, update, delete on table public.order_provider_links to service_role;

commit;
