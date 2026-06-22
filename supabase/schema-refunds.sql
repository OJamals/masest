-- Refund status enum (issue #26 / live bug). Apply in the Supabase SQL editor. Idempotent.
--
-- BUG: admin/orders.js (deployed) sets status='refunded', but the order_status enum never
-- had that value — so every Stripe refund 500'd on the status update *after* Stripe had
-- already refunded the money (money out, order still 'paid'). Adding the value unbreaks it.
-- ALTER TYPE ... ADD VALUE must run on its own (cannot share a transaction block).
alter type order_status add value if not exists 'refunded';

-- Partial refunds (#22): track the cumulative refunded total so an order can be
-- refunded in pieces. status flips to 'refunded' only once refunded_amount >= total.
alter table public.orders add column if not exists refunded_amount numeric(12,2) not null default 0;

-- Re-increment tracked stock when refunded line items return to inventory.
-- Mirror of decrement_variant_stock (schema-phase5.sql); only touches tracked variants.
create or replace function public.increment_variant_stock(p_vsku text, p_qty integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_vsku is null or p_qty is null or p_qty <= 0 then
    return false;
  end if;

  update public.product_variants
     set stock = coalesce(stock, 0) + p_qty
   where vsku = p_vsku
     and track_stock is true;

  return found;
end;
$$;

grant execute on function public.increment_variant_stock(text, integer) to service_role;
