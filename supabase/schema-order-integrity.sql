-- Order integrity: atomic Stripe persistence + idempotency guard + atomic NET credit check.
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
    company_id, status, payment_method, qbo_sync_status, subtotal, tax, total,
    currency, stripe_payment_intent, customer_email, ship_address
  ) values (
    nullif(p_order->>'company_id', '')::uuid,
    coalesce(nullif(p_order->>'status', ''), 'paid')::public.order_status,
    'stripe'::public.payment_method,
    nullif(p_order->>'qbo_sync_status', '')::public.qbo_sync_status,
    coalesce((p_order->>'subtotal')::numeric, 0),
    coalesce((p_order->>'tax')::numeric, 0),
    coalesce((p_order->>'total')::numeric, 0),
    coalesce(nullif(p_order->>'currency', ''), 'usd'),
    nullif(p_order->>'stripe_payment_intent', ''),
    nullif(p_order->>'customer_email', ''),
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

-- CF Functions call this through the service-role client; without this grant the RPC
-- 404s and checkout.js silently falls back to the non-atomic pre-migration path.
revoke all on function public.place_net_order(uuid, uuid, text, numeric, text) from public;
grant execute on function public.place_net_order(uuid, uuid, text, numeric, text) to service_role;
