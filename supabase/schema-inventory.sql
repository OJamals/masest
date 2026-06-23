-- #98 low-stock reorder threshold. Additive — safe to re-run.
-- Per-variant reorder point; a variant at/below it shows in the low-stock view.
-- Default 10 matches the previous hardcoded threshold in admin stats.
alter table public.product_variants
  add column if not exists reorder_point int not null default 10;
