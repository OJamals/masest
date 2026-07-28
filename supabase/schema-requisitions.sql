-- Buyer-saved requisitions reuse unplaced order carts and historical line snapshots.
begin;

alter table public.orders
  add column if not exists requisition_name text;

do $$ begin
  alter table public.orders
    add constraint orders_requisition_name_chk
    check (
      requisition_name is null
      or (
        char_length(btrim(requisition_name)) between 1 and 80
        and requisition_name !~ '[[:cntrl:]]'
      )
    );
exception when duplicate_object then null; end $$;

create index if not exists orders_requisitions_user_idx
  on public.orders (user_id, created_at desc)
  where status = 'cart' and requisition_name is not null;

create or replace function public.save_requisition(
  p_company_id uuid,
  p_user_id uuid,
  p_name text,
  p_items jsonb,
  p_subtotal numeric,
  p_currency text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_user_id and company_id = p_company_id
  ) then
    raise exception 'invalid_requisition_owner';
  end if;
  if jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_requisition_items';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if (
    select count(*) from public.orders
    where user_id = p_user_id and status = 'cart' and requisition_name is not null
  ) >= 25 then
    raise exception 'too_many_requisitions';
  end if;

  insert into public.orders (
    company_id, user_id, status, requisition_name, subtotal, total, currency
  ) values (
    p_company_id, p_user_id, 'cart', btrim(p_name), p_subtotal, p_subtotal, p_currency
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, sku, product_sku, name, qty, unit_price, line_total
  )
  select
    v_order_id, item.sku, item.product_sku, item.name,
    item.qty, item.unit_price, item.line_total
  from jsonb_to_recordset(p_items) as item(
    sku text,
    product_sku text,
    name text,
    qty integer,
    unit_price numeric,
    line_total numeric
  );

  return v_order_id;
end;
$$;

revoke all on function public.save_requisition(uuid, uuid, text, jsonb, numeric, text)
from public, anon, authenticated;
grant execute on function public.save_requisition(uuid, uuid, text, jsonb, numeric, text)
to service_role;

create or replace function public.pseudonymize_orders_before_account_erasure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.orders
  where user_id = old.id
    and status = 'cart';

  update public.orders
  set
    user_id = null,
    customer_email = 'anon-' || old.id::text || '@deleted.invalid'
  where user_id = old.id;

  return old;
end;
$$;

revoke all on function public.pseudonymize_orders_before_account_erasure()
from public, anon, authenticated;

commit;
