-- Repair the shared Order/order_items quote-checkout guard. PL/pgSQL resolves record
-- fields at runtime, so a CASE expression that mentions new.order_id fails on orders,
-- even when its orders branch should select old.id.
begin;

create or replace function public.prevent_active_quote_checkout_order_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
begin
  if tg_table_name = 'orders' then
    v_order_id := old.id;
  elsif tg_op = 'DELETE' then
    v_order_id := old.order_id;
  else
    v_order_id := new.order_id;
  end if;
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

commit;
