-- #99 shipment event history. Append-only, customer-visible timeline of an order's
-- shipment status changes (complements the staff-only audit_log). Carrier API / labels
-- are a later phase. Additive — safe to re-run.
create table if not exists public.shipment_events (
  id              bigint generated always as identity primary key,
  order_id        uuid not null references public.orders(id) on delete cascade,
  status          text not null,        -- processing|packing|shipped|delivered|blocked
  carrier         text,
  tracking_number text,
  note            text,                 -- optional, customer-visible
  created_at      timestamptz not null default now()
);
create index if not exists shipment_events_order_idx
  on public.shipment_events (order_id, created_at desc);

alter table public.shipment_events enable row level security;
-- Company members read their own orders' events; writes happen via the service-role
-- client (admin tracking updates), which bypasses RLS.
drop policy if exists shipment_events_company_read on public.shipment_events;
create policy shipment_events_company_read on public.shipment_events
  for select to authenticated using (
    exists (select 1 from public.orders o
            where o.id = shipment_events.order_id and o.company_id = public.current_company_id())
  );
grant select on public.shipment_events to authenticated;
grant select, insert on public.shipment_events to service_role;
