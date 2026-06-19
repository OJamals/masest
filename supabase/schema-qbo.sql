-- QuickBooks Online sync support for MASEST commerce.
-- Apply with the Supabase SQL editor or your normal deployment path.

create table if not exists public.qbo_tokens (
  id smallint primary key default 1 check (id = 1),
  realm_id text,
  refresh_token text,
  access_token text,
  access_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.qbo_items (
  sku text primary key,
  qbo_item_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.qbo_customers (
  key text primary key,
  qbo_customer_id text not null,
  created_at timestamptz not null default now()
);

do $$ begin
  create type qbo_sync_status as enum ('pending','processing','synced','error','skipped');
exception
  when duplicate_object then null;
end $$;

alter table public.orders
  add column if not exists qbo_sync_status qbo_sync_status,
  add column if not exists qbo_doc_id text,
  add column if not exists qbo_doc_type text,
  add column if not exists qbo_payment_id text,
  add column if not exists qbo_synced_at timestamptz,
  add column if not exists qbo_error text,
  add column if not exists qbo_attempts int not null default 0,
  add column if not exists qbo_next_attempt_at timestamptz;

create index if not exists orders_qbo_pending_idx
  on public.orders (qbo_next_attempt_at)
  where qbo_sync_status in ('pending','error');

create or replace function public.claim_qbo_orders(batch int)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.orders o
  set qbo_sync_status = 'processing'
  where o.id in (
    select id
    from public.orders
    where qbo_sync_status = 'pending'
      and (qbo_next_attempt_at is null or qbo_next_attempt_at <= now())
    order by created_at
    limit batch
    for update skip locked
  )
  returning o.*;
end
$$;

grant select, insert, update on public.qbo_tokens to service_role;
grant select, insert, update on public.qbo_items to service_role;
grant select, insert, update on public.qbo_customers to service_role;
grant execute on function public.claim_qbo_orders(int) to service_role;
