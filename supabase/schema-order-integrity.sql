-- Order integrity: atomic Stripe persistence + complete atomic/idempotent NET orders.
-- Apply in the Supabase SQL editor (pooler/service-role). Idempotent — safe to re-run.
--
-- Backs issues:
--   #8  Duplicate orders — unique guard on orders.stripe_payment_intent makes the
--       Stripe webhook idempotent under at-least-once / concurrent delivery.
--   #9  Credit-limit race — place_net_order() re-checks the limit while holding a row
--       lock on the company, closing the check-then-insert TOCTOU window in checkout.js.

-- ── #8 ─────────────────────────────────────────────────────────────────────────
-- Partial unique index: at most one order per Stripe PaymentIntent. NULL is allowed
-- for non-Stripe (NET) orders. A concurrent second webhook delivery now fails with
-- 23505 instead of inserting a duplicate; the webhook maps that to an idempotent 200.
create unique index if not exists orders_stripe_payment_intent_uniq
  on public.orders (stripe_payment_intent)
  where stripe_payment_intent is not null;

alter table public.orders
  add column if not exists shipping numeric(12,2) not null default 0;

alter table public.orders
  add column if not exists purchase_order_number text;

do $$ begin
  alter table public.orders
    add constraint orders_purchase_order_number_chk
    check (
      purchase_order_number is null
      or (
        char_length(purchase_order_number) between 1 and 64
        and purchase_order_number !~ '[[:cntrl:]]'
      )
    );
exception when duplicate_object then null; end $$;

-- Persist a Stripe order header and every historical line-item snapshot in one
-- transaction. Any malformed/invalid line rolls back the order header as well, so a
-- webhook retry can safely try again instead of finding a permanently header-only order.
-- The unique PaymentIntent index above is the concurrency/idempotency boundary.
create or replace function public.persist_stripe_order(
  p_order jsonb,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  insert into public.orders (
    company_id, status, payment_method, qbo_sync_status, subtotal, shipping, tax, total,
    currency, stripe_payment_intent, customer_email, purchase_order_number, ship_address
  ) values (
    nullif(p_order->>'company_id', '')::uuid,
    coalesce(nullif(p_order->>'status', ''), 'paid')::public.order_status,
    'stripe'::public.payment_method,
    nullif(p_order->>'qbo_sync_status', '')::public.qbo_sync_status,
    coalesce((p_order->>'subtotal')::numeric, 0),
    coalesce((p_order->>'shipping')::numeric, 0),
    coalesce((p_order->>'tax')::numeric, 0),
    coalesce((p_order->>'total')::numeric, 0),
    coalesce(nullif(p_order->>'currency', ''), 'usd'),
    nullif(p_order->>'stripe_payment_intent', ''),
    nullif(p_order->>'customer_email', ''),
    nullif(p_order->>'purchase_order_number', ''),
    p_order->'ship_address'
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, sku, product_sku, name, qty, unit_price, line_total, backordered
  )
  select
    v_order_id,
    item.sku,
    item.product_sku,
    item.name,
    item.qty,
    item.unit_price,
    item.line_total,
    coalesce(item.backordered, false)
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    sku text,
    product_sku text,
    name text,
    qty integer,
    unit_price numeric,
    line_total numeric,
    backordered boolean
  );

  return jsonb_build_object('id', v_order_id);
end;
$$;

revoke all on function public.persist_stripe_order(jsonb, jsonb) from public;
grant execute on function public.persist_stripe_order(jsonb, jsonb) to service_role;

-- ── #9 ─────────────────────────────────────────────────────────────────────────
-- Atomic "place a NET order if within credit limit". Locks the company row, re-sums
-- the outstanding net_open balance inside the same transaction, and only inserts when
-- the new total stays within credit_limit. Two concurrent NET checkouts for the same
-- company therefore serialize on the row lock — they can no longer both pass the check
-- and jointly exceed the limit. credit_limit IS NULL means unlimited.
--
-- Returns JSON:
--   { rejected:false, order_id, outstanding, credit_limit }            on success
--   { rejected:true,  outstanding, credit_limit, available }           when over limit
create or replace function public.place_net_order(
  p_company_id uuid,
  p_user_id    uuid,
  p_email      text,
  p_subtotal   numeric,
  p_currency   text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit       numeric;
  v_outstanding numeric;
  v_order_id    uuid;
begin
  -- Serialize concurrent NET checkouts for this company.
  select credit_limit into v_limit
    from public.companies
   where id = p_company_id
   for update;

  select coalesce(sum(total), 0) into v_outstanding
    from public.orders
   where company_id = p_company_id
     and status = 'net_open';

  if v_limit is not null
     and round((v_outstanding + p_subtotal)::numeric, 2) > round(v_limit::numeric, 2) then
    return json_build_object(
      'rejected',     true,
      'outstanding',  v_outstanding,
      'credit_limit', v_limit,
      'available',    greatest(0, round((v_limit - v_outstanding)::numeric, 2))
    );
  end if;

  insert into public.orders (
    company_id, user_id, customer_email, status, payment_method,
    qbo_sync_status, subtotal, total, currency
  ) values (
    p_company_id, p_user_id, p_email, 'net_open', 'net',
    'pending', p_subtotal, p_subtotal, coalesce(nullif(p_currency, ''), 'usd')
  )
  returning id into v_order_id;

  return json_build_object(
    'rejected',     false,
    'order_id',     v_order_id,
    'outstanding',  v_outstanding,
    'credit_limit', v_limit
  );
end;
$$;

-- Retain v1 for migration compatibility. Current checkout uses service-role-only v2.
revoke all on function public.place_net_order(uuid, uuid, text, numeric, text) from public;
grant execute on function public.place_net_order(uuid, uuid, text, numeric, text) to service_role;

-- ── NET order v2 ────────────────────────────────────────────────────────────────
-- Complete NET ledger transaction + response-loss idempotency. v1 stays available
-- for migration compatibility, but application checkout fails closed unless v2 exists.
alter table public.orders
  add column if not exists net_request_key text;

alter table public.orders
  add column if not exists net_request_cart jsonb;

-- A request key identifies one logical cart attempt inside one Company. Different
-- companies may independently use the same generated key.
create unique index if not exists orders_company_net_request_key_uniq
  on public.orders (company_id, net_request_key)
  where net_request_key is not null;

create or replace function public.place_net_order_v2(
  p_company_id uuid,
  p_user_id uuid,
  p_email text,
  p_request_key text,
  p_items jsonb,
  p_subtotal numeric,
  p_currency text,
  p_probe boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_key text := btrim(coalesce(p_request_key, ''));
  v_currency text := lower(btrim(coalesce(p_currency, '')));
  v_item_count integer;
  v_distinct_item_count integer;
  v_items_valid boolean;
  v_cart jsonb;
  v_skus text[];
  v_subtotal numeric;
  v_sku text;
  v_qty integer;
  v_variant record;
  v_existing record;
  v_limit numeric;
  v_outstanding numeric;
  v_order_id uuid;
begin
  if p_company_id is null
     or p_user_id is null
     or v_request_key = ''
     or char_length(v_request_key) > 128
     or p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 50 then
    return jsonb_build_object('rejected', true, 'reason', 'invalid_request');
  end if;

  select
    count(*),
    count(distinct btrim(item.sku)),
    bool_and(
      item.sku is not null
      and btrim(item.sku) <> ''
      and char_length(btrim(item.sku)) <= 80
      and item.qty between 1 and 999
    ),
    jsonb_agg(
      jsonb_build_object('sku', btrim(item.sku), 'qty', item.qty)
      order by btrim(item.sku)
    ),
    array_agg(btrim(item.sku) order by btrim(item.sku))
    into
      v_item_count,
      v_distinct_item_count,
      v_items_valid,
      v_cart,
      v_skus
  from jsonb_to_recordset(p_items) as item(
    sku text,
    qty integer
  );

  if v_item_count <> jsonb_array_length(p_items)
     or v_distinct_item_count <> v_item_count
     or not coalesce(v_items_valid, false) then
    return jsonb_build_object('rejected', true, 'reason', 'invalid_request');
  end if;

  -- Serialize credit checks and same-key retries for this Company.
  select credit_limit
    into v_limit
    from public.companies
   where id = p_company_id
   for update;

  if not found then
    return jsonb_build_object('rejected', true, 'reason', 'invalid_company');
  end if;

  select id, net_request_cart, subtotal, total, currency
    into v_existing
    from public.orders
   where company_id = p_company_id
     and net_request_key = v_request_key
   limit 1;

  if found then
    if v_existing.net_request_cart = v_cart then
      return jsonb_build_object(
        'rejected', false,
        'duplicate', true,
        'order_id', v_existing.id,
        'subtotal', v_existing.subtotal,
        'total', v_existing.total,
        'currency', v_existing.currency
      );
    end if;
    return jsonb_build_object('rejected', true, 'reason', 'request_key_conflict');
  end if;

  if coalesce(p_probe, false) then
    return jsonb_build_object(
      'rejected', false,
      'duplicate', false,
      'probe', true
    );
  end if;

  if v_currency = ''
     or p_subtotal is null
     or p_subtotal < 0 then
    return jsonb_build_object('rejected', true, 'reason', 'invalid_request');
  end if;

  select
    bool_and(
      item.product_sku is not null
      and item.name is not null
      and item.unit_price is not null
      and item.unit_price >= 0
      and item.line_total is not null
      and round(item.line_total::numeric, 2)
          = round((item.unit_price * item.qty)::numeric, 2)
    ),
    round(sum(item.line_total)::numeric, 2)
    into v_items_valid, v_subtotal
  from jsonb_to_recordset(p_items) as item(
    sku text,
    product_sku text,
    name text,
    qty integer,
    unit_price numeric,
    line_total numeric
  );

  if not coalesce(v_items_valid, false)
     or round(p_subtotal::numeric, 2) <> v_subtotal then
    return jsonb_build_object('rejected', true, 'reason', 'invalid_request');
  end if;

  -- Every caller locks the same SKU set in the same lexical order, independent of
  -- request JSON order. This prevents cross-Company carts from deadlocking.
  foreach v_sku in array v_skus loop
    select item.qty
      into v_qty
      from jsonb_to_recordset(p_items) as item(sku text, qty integer)
     where btrim(item.sku) = v_sku;

    select vsku, currency, stock, track_stock, allow_backorder
      into v_variant
      from public.product_variants
     where vsku = v_sku
     for update;

    if not found then
      return jsonb_build_object(
        'rejected', true,
        'reason', 'variant_unavailable',
        'skus', jsonb_build_array(v_sku)
      );
    end if;

    if lower(coalesce(nullif(btrim(v_variant.currency), ''), 'usd')) <> v_currency then
      return jsonb_build_object(
        'rejected', true,
        'reason', 'currency_mismatch',
        'skus', jsonb_build_array(v_sku)
      );
    end if;

    if v_variant.track_stock is true
       and v_variant.stock is not null
       and v_variant.stock < v_qty
       and not coalesce(v_variant.allow_backorder, false) then
      return jsonb_build_object(
        'rejected', true,
        'reason', 'out_of_stock',
        'skus', jsonb_build_array(v_sku)
      );
    end if;
  end loop;

  select coalesce(sum(total), 0)
    into v_outstanding
    from public.orders
   where company_id = p_company_id
     and status = 'net_open';

  if v_limit is not null
     and round((v_outstanding + v_subtotal)::numeric, 2) > round(v_limit::numeric, 2) then
    return jsonb_build_object(
      'rejected', true,
      'reason', 'credit_limit_exceeded',
      'outstanding', v_outstanding,
      'credit_limit', v_limit,
      'available', greatest(0, round((v_limit - v_outstanding)::numeric, 2))
    );
  end if;

  insert into public.orders (
    company_id, user_id, customer_email, status, payment_method,
    qbo_sync_status, subtotal, total, currency, net_request_key, net_request_cart
  ) values (
    p_company_id, p_user_id, p_email, 'net_open', 'net',
    'pending', v_subtotal, v_subtotal, v_currency, v_request_key, v_cart
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, sku, product_sku, name, qty, unit_price, line_total, backordered
  )
  select
    v_order_id,
    btrim(item.sku),
    item.product_sku,
    item.name,
    item.qty,
    item.unit_price,
    item.line_total,
    (
      variant.track_stock is true
      and variant.stock is not null
      and variant.stock < item.qty
    )
  from jsonb_to_recordset(p_items) as item(
    sku text,
    product_sku text,
    name text,
    qty integer,
    unit_price numeric,
    line_total numeric
  )
  join public.product_variants as variant
    on variant.vsku = btrim(item.sku);

  -- Tracked + sufficient stock decrements. Backordered lines and untracked/null stock
  -- remain untouched, matching the existing checkout policy.
  update public.product_variants as variant
     set stock = variant.stock - item.qty
    from jsonb_to_recordset(p_items) as item(sku text, qty integer)
   where variant.vsku = btrim(item.sku)
     and variant.track_stock is true
     and variant.stock is not null
     and variant.stock >= item.qty;

  return jsonb_build_object(
    'rejected', false,
    'duplicate', false,
    'order_id', v_order_id,
    'outstanding', v_outstanding,
    'credit_limit', v_limit
  );
end;
$$;

revoke all on function public.place_net_order_v2(uuid, uuid, text, text, jsonb, numeric, text, boolean) from public;
revoke execute on function public.place_net_order_v2(uuid, uuid, text, text, jsonb, numeric, text, boolean) from anon, authenticated;
grant execute on function public.place_net_order_v2(uuid, uuid, text, text, jsonb, numeric, text, boolean) to service_role;

-- v3 adds an optional customer PO reference without duplicating the locked ledger
-- transaction. Calling v2 inside this function keeps order creation + PO persistence
-- atomic; any exception rolls the whole outer transaction back.
create or replace function public.place_net_order_v3(
  p_company_id uuid,
  p_user_id uuid,
  p_email text,
  p_request_key text,
  p_items jsonb,
  p_subtotal numeric,
  p_currency text,
  p_purchase_order_number text,
  p_probe boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_order_number text := nullif(btrim(coalesce(p_purchase_order_number, '')), '');
  v_existing_purchase_order_number text;
  v_result jsonb;
begin
  if v_purchase_order_number is not null
     and (
       char_length(v_purchase_order_number) > 64
       or v_purchase_order_number ~ '[[:cntrl:]]'
     ) then
    return jsonb_build_object('rejected', true, 'reason', 'invalid_request');
  end if;

  v_result := public.place_net_order_v2(
    p_company_id,
    p_user_id,
    p_email,
    p_request_key,
    p_items,
    p_subtotal,
    p_currency,
    p_probe
  );

  if coalesce((v_result->>'rejected')::boolean, false)
     or coalesce((v_result->>'probe')::boolean, false) then
    return v_result;
  end if;

  if coalesce((v_result->>'duplicate')::boolean, false) then
    select purchase_order_number
      into v_existing_purchase_order_number
      from public.orders
     where id = (v_result->>'order_id')::uuid;
    if not found
       or v_existing_purchase_order_number is distinct from v_purchase_order_number then
      return jsonb_build_object('rejected', true, 'reason', 'request_key_conflict');
    end if;
    return v_result;
  end if;

  update public.orders
     set purchase_order_number = v_purchase_order_number
   where id = (v_result->>'order_id')::uuid;
  if not found then
    raise exception 'net_order_po_persistence_failed';
  end if;

  return v_result;
end;
$$;

revoke all on function public.place_net_order_v3(uuid, uuid, text, text, jsonb, numeric, text, text, boolean) from public;
revoke execute on function public.place_net_order_v3(uuid, uuid, text, text, jsonb, numeric, text, text, boolean) from anon, authenticated;
grant execute on function public.place_net_order_v3(uuid, uuid, text, text, jsonb, numeric, text, text, boolean) to service_role;
