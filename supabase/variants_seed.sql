-- Example volume variants for the 6 buy SKUs (5 / 15 / 55 gal).
-- Idempotent: re-running will NOT overwrite owner-tuned prices.
-- Prices are illustrative — adjust per SKU in Supabase (Table editor or UPDATE).
insert into public.product_variants (vsku, product_sku, label, gallons, price, sort) values
  ('hcr-5g','hcr','5 gal',5,99.00,1),
  ('hcr-15g','hcr','15 gal',15,269.00,2),
  ('hcr-55g','hcr','55 gal drum',55,899.00,3),
  ('crhd-5g','crhd','5 gal',5,99.00,1),
  ('crhd-15g','crhd','15 gal',15,269.00,2),
  ('crhd-55g','crhd','55 gal drum',55,899.00,3),
  ('neutral-5g','neutral','5 gal',5,99.00,1),
  ('neutral-15g','neutral','15 gal',15,269.00,2),
  ('neutral-55g','neutral','55 gal drum',55,899.00,3),
  ('multiwash-5g','multiwash','5 gal',5,99.00,1),
  ('multiwash-15g','multiwash','15 gal',15,269.00,2),
  ('multiwash-55g','multiwash','55 gal drum',55,899.00,3),
  ('watersafe60-5g','watersafe60','5 gal',5,99.00,1),
  ('watersafe60-15g','watersafe60','15 gal',15,269.00,2),
  ('watersafe60-55g','watersafe60','55 gal drum',55,899.00,3),
  ('torque-5g','torque','5 gal',5,99.00,1),
  ('torque-15g','torque','15 gal',15,269.00,2),
  ('torque-55g','torque','55 gal drum',55,899.00,3)
on conflict (vsku) do nothing;
