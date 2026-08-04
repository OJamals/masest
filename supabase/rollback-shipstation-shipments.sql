-- Roll back plan 13.3c normalized shipment/package/rate lifecycle.
-- Does not alter provider objects or the immutable provider/financial ledgers.

drop function if exists public.verify_order_shipment_rate(uuid, uuid, integer, text, text);
drop function if exists public.claim_order_shipment_label_purchase(uuid, uuid, integer, text);
drop function if exists public.select_order_shipment_rate(uuid, uuid, integer, text);
drop function if exists public.finalize_order_shipment_operation(
  uuid, integer, text, text, text, jsonb, jsonb, uuid, text, text
);
drop function if exists public.fail_order_shipment_operation(uuid, integer, text);
drop function if exists public.release_order_shipment_operation(uuid, integer, text);
drop function if exists public.claim_order_shipment_operation(
  uuid, uuid, text, integer, text, text, jsonb
);
drop function if exists public.order_shipment_package_hash(jsonb);

drop table if exists public.order_shipment_rates;
drop table if exists public.order_shipment_packages;
drop table if exists public.order_shipments;

alter table public.orders drop column if exists shipstation_shipment_state;
alter table public.orders drop column if exists shipstation_package_hash;
alter table public.orders drop column if exists shipstation_shipment_revision;
alter table public.orders drop column if exists shipstation_order_shipment_id;
