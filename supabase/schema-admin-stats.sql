-- Admin dashboard order metrics (issue #38). Apply in the Supabase SQL editor. Idempotent.
--
-- stats.js computed revenue / AOV / order counts from the most-recent 1000 orders only,
-- so every money figure silently undercounts once total orders exceed 1000. This RPC
-- computes the aggregates DB-side over the full table. stats.js prefers it and falls back
-- to the legacy in-JS sample when it isn't deployed.
create or replace function public.admin_order_metrics()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'orders_total',      (select count(*)            from public.orders where status <> 'cart'),
    'orders_7d',         (select count(*)            from public.orders where status <> 'cart' and created_at >= now() - interval '7 days'),
    'paid_count',        (select count(*)            from public.orders where status in ('paid','net_paid','fulfilled')),
    'revenue_total',     (select coalesce(sum(total),0) from public.orders where status in ('paid','net_paid','fulfilled')),
    'revenue_7d',        (select coalesce(sum(total),0) from public.orders where status in ('paid','net_paid','fulfilled') and created_at >= now() - interval '7 days'),
    'revenue_30d',       (select coalesce(sum(total),0) from public.orders where status in ('paid','net_paid','fulfilled') and created_at >= now() - interval '30 days'),
    'fulfillment_queue', (select count(*)            from public.orders where status in ('paid','net_open')),
    'net_open_count',    (select count(*)            from public.orders where status = 'net_open'),
    'net_exposure',      (select coalesce(sum(total),0) from public.orders where status = 'net_open')
  );
$$;

grant execute on function public.admin_order_metrics() to service_role;
