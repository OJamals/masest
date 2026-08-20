-- Company account credit: append-only USD ledger plus Checkout reservations.
-- This is distinct from companies.credit_limit (NET purchasing capacity).
-- Apply through the service-only RPCs below; never calculate a writable balance in JS.

begin;

create table if not exists public.company_store_credit_reservations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  user_id            uuid references auth.users(id) on delete set null,
  intent_id          uuid not null,
  currency           text not null default 'usd' check (currency = 'usd'),
  max_amount_minor   bigint not null check (max_amount_minor > 0),
  amount_minor       bigint not null check (amount_minor > 0),
  status             text not null default 'reserved'
    check (status in ('reserved', 'attached', 'consumed', 'released')),
  stripe_session_id  text,
  order_id            uuid references public.orders(id) on delete restrict,
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, intent_id),
  unique (stripe_session_id)
);

create index if not exists company_store_credit_reservations_active_idx
  on public.company_store_credit_reservations (company_id, currency, status, expires_at);
create index if not exists company_store_credit_reservations_user_idx
  on public.company_store_credit_reservations (user_id);
create index if not exists company_store_credit_reservations_order_idx
  on public.company_store_credit_reservations (order_id);

create table if not exists public.company_store_credit_entries (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete restrict,
  amount_minor    bigint not null check (amount_minor <> 0),
  currency        text not null default 'usd' check (currency = 'usd'),
  kind            text not null check (kind in ('grant', 'adjustment', 'redemption', 'refund')),
  reason          text not null check (char_length(btrim(reason)) between 8 and 500),
  reservation_id  uuid references public.company_store_credit_reservations(id) on delete restrict,
  order_id         uuid references public.orders(id) on delete restrict,
  created_by       uuid references auth.users(id) on delete set null,
  request_id       text not null,
  created_at       timestamptz not null default now(),
  unique (request_id),
  unique (reservation_id, kind),
  check (
    (kind in ('redemption', 'refund') and reservation_id is not null and order_id is not null)
    or (kind in ('grant', 'adjustment') and reservation_id is null)
  )
);

create index if not exists company_store_credit_entries_company_idx
  on public.company_store_credit_entries (company_id, currency, created_at desc);
create index if not exists company_store_credit_entries_order_idx
  on public.company_store_credit_entries (order_id);
create index if not exists company_store_credit_entries_created_by_idx
  on public.company_store_credit_entries (created_by);

alter table public.company_store_credit_reservations enable row level security;
alter table public.company_store_credit_entries enable row level security;
revoke all on public.company_store_credit_reservations from public, anon, authenticated;
revoke all on public.company_store_credit_entries from public, anon, authenticated;
grant all privileges on public.company_store_credit_reservations to service_role;
grant all privileges on public.company_store_credit_entries to service_role;

create or replace function public.company_store_credit_entries_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = 'P0001', message = 'company_store_credit_entries_immutable';
end;
$$;

drop trigger if exists company_store_credit_entries_immutable on public.company_store_credit_entries;
create trigger company_store_credit_entries_immutable
before update or delete on public.company_store_credit_entries
for each row execute function public.company_store_credit_entries_immutable();

create or replace function public.company_store_credit_summary(
  p_company_id uuid,
  p_currency text default 'usd'
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Do not age active holds out here. A Session can complete before expires_at while its
  -- signed webhook arrives later; only a terminal provider event/reconciliation may release.
  with totals as (
    select
      coalesce((
        select sum(e.amount_minor)
        from public.company_store_credit_entries e
        where e.company_id = p_company_id and e.currency = lower(p_currency)
      ), 0)::bigint as balance_minor,
      coalesce((
        select sum(r.amount_minor)
        from public.company_store_credit_reservations r
        where r.company_id = p_company_id
          and r.currency = lower(p_currency)
          and r.status in ('reserved', 'attached')
      ), 0)::bigint as reserved_minor
  )
  select jsonb_build_object(
    'currency', lower(p_currency),
    'balance_minor', balance_minor,
    'reserved_minor', reserved_minor,
    'available_minor', greatest(0, balance_minor - reserved_minor)
  )
  from totals;
$$;

create or replace function public.adjust_company_store_credit(
  p_company_id uuid,
  p_amount_minor bigint,
  p_reason text,
  p_request_id uuid,
  p_actor_user_id uuid,
  p_currency text default 'usd'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_currency text := lower(coalesce(p_currency, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_request_key text := 'admin:' || p_request_id::text;
  v_existing public.company_store_credit_entries%rowtype;
  v_balance bigint;
  v_reserved bigint;
  v_entry_id uuid;
begin
  if p_request_id is null
    or p_actor_user_id is null
    or p_amount_minor = 0
    or p_amount_minor < -100000000
    or p_amount_minor > 100000000
    or v_currency <> 'usd'
    or char_length(v_reason) not between 8 and 500 then
    raise exception using errcode = 'P0001', message = 'invalid_store_credit_adjustment';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'store_credit_company_not_found';
  end if;

  select * into v_existing
  from public.company_store_credit_entries
  where request_id = v_request_key;
  if found then
    if v_existing.company_id is distinct from p_company_id
      or v_existing.amount_minor is distinct from p_amount_minor
      or v_existing.currency is distinct from v_currency
      or v_existing.reason is distinct from v_reason
      or v_existing.created_by is distinct from p_actor_user_id then
      raise exception using errcode = 'P0001', message = 'store_credit_request_identity_collision';
    end if;
    return public.company_store_credit_summary(p_company_id, v_currency)
      || jsonb_build_object('entry_id', v_existing.id, 'replay', true);
  end if;

  select coalesce(sum(amount_minor), 0)::bigint into v_balance
  from public.company_store_credit_entries
  where company_id = p_company_id and currency = v_currency;
  select coalesce(sum(amount_minor), 0)::bigint into v_reserved
  from public.company_store_credit_reservations
  where company_id = p_company_id
    and currency = v_currency
    and status in ('reserved', 'attached');

  if v_balance + p_amount_minor < v_reserved
    or v_balance + p_amount_minor > 100000000 then
    raise exception using errcode = 'P0001', message = 'store_credit_insufficient';
  end if;

  insert into public.company_store_credit_entries (
    company_id, amount_minor, currency, kind, reason, created_by, request_id
  ) values (
    p_company_id,
    p_amount_minor,
    v_currency,
    case when p_amount_minor > 0 then 'grant' else 'adjustment' end,
    v_reason,
    p_actor_user_id,
    v_request_key
  ) returning id into v_entry_id;

  return public.company_store_credit_summary(p_company_id, v_currency)
    || jsonb_build_object('entry_id', v_entry_id, 'replay', false);
end;
$$;

drop function if exists public.reserve_company_store_credit(uuid, uuid, uuid, bigint, text);
create or replace function public.reserve_company_store_credit(
  p_company_id uuid,
  p_user_id uuid,
  p_intent_id uuid,
  p_max_amount_minor bigint,
  p_expires_at timestamptz,
  p_currency text default 'usd'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_currency text := lower(coalesce(p_currency, ''));
  v_existing public.company_store_credit_reservations%rowtype;
  v_balance bigint;
  v_reserved bigint;
  v_amount bigint;
  v_id uuid;
begin
  if p_user_id is null
    or p_intent_id is null
    or p_max_amount_minor <= 0
    or p_expires_at is null
    or p_expires_at <= now() + interval '30 minutes'
    or p_expires_at > now() + interval '40 minutes'
    or v_currency <> 'usd' then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_invalid';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'store_credit_company_not_found';
  end if;

  select * into v_existing
  from public.company_store_credit_reservations
  where company_id = p_company_id and intent_id = p_intent_id;
  if found then
    if v_existing.user_id is distinct from p_user_id
      or v_existing.max_amount_minor is distinct from p_max_amount_minor
      or v_existing.currency is distinct from v_currency then
      raise exception using errcode = 'P0001', message = 'store_credit_request_identity_collision';
    end if;
    if v_existing.expires_at <= now() then
      raise exception using errcode = 'P0001', message = 'store_credit_reservation_expired';
    end if;
    if v_existing.status not in ('reserved', 'attached') then
      raise exception using errcode = 'P0001', message = 'store_credit_reservation_conflict';
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'amount_minor', v_existing.amount_minor,
      'currency', v_existing.currency,
      'status', v_existing.status,
      'stripe_session_id', v_existing.stripe_session_id,
      'expires_at', v_existing.expires_at,
      'replay', true
    );
  end if;

  select coalesce(sum(amount_minor), 0)::bigint into v_balance
  from public.company_store_credit_entries
  where company_id = p_company_id and currency = v_currency;
  select coalesce(sum(amount_minor), 0)::bigint into v_reserved
  from public.company_store_credit_reservations
  where company_id = p_company_id
    and currency = v_currency
    and status in ('reserved', 'attached');
  v_amount := least(p_max_amount_minor, greatest(0, v_balance - v_reserved));
  if v_amount <= 0 then
    raise exception using errcode = 'P0001', message = 'store_credit_insufficient';
  end if;

  insert into public.company_store_credit_reservations (
    company_id, user_id, intent_id, currency, max_amount_minor, amount_minor, expires_at
  ) values (
    p_company_id, p_user_id, p_intent_id, v_currency, p_max_amount_minor, v_amount, p_expires_at
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'amount_minor', v_amount,
    'currency', v_currency,
    'status', 'reserved',
    'stripe_session_id', null,
    'expires_at', p_expires_at,
    'replay', false
  );
end;
$$;

create or replace function public.attach_company_store_credit(
  p_reservation_id uuid,
  p_stripe_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation public.company_store_credit_reservations%rowtype;
begin
  select * into v_reservation
  from public.company_store_credit_reservations
  where id = p_reservation_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_not_found';
  end if;
  if nullif(btrim(coalesce(p_stripe_session_id, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_invalid';
  end if;
  if v_reservation.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_expired';
  end if;
  if v_reservation.status = 'attached' and v_reservation.stripe_session_id = p_stripe_session_id then
    return jsonb_build_object('id', v_reservation.id, 'status', v_reservation.status, 'replay', true);
  end if;
  if v_reservation.status <> 'reserved' or v_reservation.stripe_session_id is not null then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_conflict';
  end if;

  update public.company_store_credit_reservations
  set status = 'attached', stripe_session_id = p_stripe_session_id, updated_at = now()
  where id = p_reservation_id;
  return jsonb_build_object('id', p_reservation_id, 'status', 'attached', 'replay', false);
end;
$$;

create or replace function public.consume_company_store_credit(
  p_reservation_id uuid,
  p_stripe_session_id text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation public.company_store_credit_reservations%rowtype;
  v_company_id uuid;
  v_entry_id uuid;
begin
  if nullif(btrim(coalesce(p_stripe_session_id, '')), '') is null or p_order_id is null then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_invalid';
  end if;

  select company_id into v_company_id
  from public.company_store_credit_reservations
  where id = p_reservation_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_not_found';
  end if;
  perform 1 from public.companies where id = v_company_id for update;

  select * into v_reservation
  from public.company_store_credit_reservations
  where id = p_reservation_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_not_found';
  end if;
  if v_reservation.stripe_session_id is not null
    and v_reservation.stripe_session_id is distinct from p_stripe_session_id then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_conflict';
  end if;
  if v_reservation.status = 'consumed' and v_reservation.order_id = p_order_id then
    select id into v_entry_id from public.company_store_credit_entries
    where reservation_id = p_reservation_id and kind = 'redemption';
    return jsonb_build_object(
      'id', p_reservation_id,
      'entry_id', v_entry_id,
      'amount_minor', v_reservation.amount_minor,
      'currency', v_reservation.currency,
      'status', 'consumed',
      'replay', true
    );
  end if;
  if v_reservation.status not in ('reserved', 'attached') or v_reservation.order_id is not null then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_conflict';
  end if;
  if not exists (
    select 1 from public.orders
    where id = p_order_id and company_id = v_reservation.company_id
  ) then
    raise exception using errcode = 'P0001', message = 'store_credit_order_conflict';
  end if;

  insert into public.company_store_credit_entries (
    company_id, amount_minor, currency, kind, reason,
    reservation_id, order_id, created_by, request_id
  ) values (
    v_reservation.company_id,
    -v_reservation.amount_minor,
    v_reservation.currency,
    'redemption',
    'Applied to Checkout order',
    v_reservation.id,
    p_order_id,
    v_reservation.user_id,
    'redemption:' || v_reservation.id::text
  ) returning id into v_entry_id;

  update public.company_store_credit_reservations
  set status = 'consumed',
    stripe_session_id = coalesce(stripe_session_id, p_stripe_session_id),
    order_id = p_order_id,
    updated_at = now()
  where id = p_reservation_id;
  return jsonb_build_object(
    'id', p_reservation_id,
    'entry_id', v_entry_id,
    'amount_minor', v_reservation.amount_minor,
    'currency', v_reservation.currency,
    'status', 'consumed',
    'replay', false
  );
end;
$$;

create or replace function public.release_company_store_credit(
  p_reservation_id uuid,
  p_stripe_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation public.company_store_credit_reservations%rowtype;
begin
  select * into v_reservation
  from public.company_store_credit_reservations
  where id = p_reservation_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_not_found';
  end if;
  if p_stripe_session_id is not null
    and v_reservation.stripe_session_id is not null
    and v_reservation.stripe_session_id is distinct from p_stripe_session_id then
    raise exception using errcode = 'P0001', message = 'store_credit_reservation_conflict';
  end if;
  if v_reservation.status in ('released', 'consumed') then
    return jsonb_build_object('id', v_reservation.id, 'status', v_reservation.status, 'replay', true);
  end if;

  update public.company_store_credit_reservations
  set status = 'released',
    stripe_session_id = coalesce(stripe_session_id, p_stripe_session_id),
    updated_at = now()
  where id = p_reservation_id;
  return jsonb_build_object('id', p_reservation_id, 'status', 'released', 'replay', false);
end;
$$;

create or replace function public.restore_company_store_credit_on_terminal_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('cancelled', 'refunded')
    and old.status is distinct from new.status then
    insert into public.company_store_credit_entries (
      company_id, amount_minor, currency, kind, reason,
      reservation_id, order_id, created_by, request_id
    )
    select
      redemption.company_id,
      -redemption.amount_minor,
      redemption.currency,
      'refund',
      'Restored after full order reversal',
      redemption.reservation_id,
      new.id,
      null,
      'refund:' || redemption.reservation_id::text
    from public.company_store_credit_entries redemption
    where redemption.order_id = new.id and redemption.kind = 'redemption'
    on conflict (reservation_id, kind) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_restore_company_store_credit on public.orders;
create trigger orders_restore_company_store_credit
after update of status on public.orders
for each row execute function public.restore_company_store_credit_on_terminal_order();

revoke all on function public.company_store_credit_entries_immutable() from public, anon, authenticated;
revoke all on function public.company_store_credit_summary(uuid, text) from public, anon, authenticated;
revoke all on function public.adjust_company_store_credit(uuid, bigint, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reserve_company_store_credit(uuid, uuid, uuid, bigint, timestamptz, text) from public, anon, authenticated;
revoke all on function public.attach_company_store_credit(uuid, text) from public, anon, authenticated;
revoke all on function public.consume_company_store_credit(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.release_company_store_credit(uuid, text) from public, anon, authenticated;
revoke all on function public.restore_company_store_credit_on_terminal_order() from public, anon, authenticated;
grant execute on function public.company_store_credit_summary(uuid, text) to service_role;
grant execute on function public.adjust_company_store_credit(uuid, bigint, text, uuid, uuid, text) to service_role;
grant execute on function public.reserve_company_store_credit(uuid, uuid, uuid, bigint, timestamptz, text) to service_role;
grant execute on function public.attach_company_store_credit(uuid, text) to service_role;
grant execute on function public.consume_company_store_credit(uuid, text, uuid) to service_role;
grant execute on function public.release_company_store_credit(uuid, text) to service_role;

commit;
