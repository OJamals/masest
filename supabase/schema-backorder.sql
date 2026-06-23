-- #27 backorder support. Additive — safe to re-run.
-- A variant opted into backorder can be ordered past zero stock; the line is flagged
-- so fulfillment ships it when restocked. Stock is NOT decremented for backordered lines.
alter table public.product_variants
  add column if not exists allow_backorder boolean not null default false;

alter table public.order_items
  add column if not exists backordered boolean not null default false;
