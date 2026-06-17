-- MASEST products seed. Run AFTER schema.sql, in the Supabase SQL editor.
-- Modes are PROVISIONAL (from SKU_COMMERCE_WORKSHEET.md) until SDS §14 is confirmed.
-- Prices are NULL on purpose; set them later. Re-running this does NOT overwrite a price you set.
insert into public.products (sku, name, group_key, hmis, mode, hazmat, taxable, price, sort) values
  ('hcr',         'VertKleen HCR',        'descale',  '0-0-0', 'buy',   false, true, null, 1),
  ('descaler',    'VertKleen Descaler',   'descale',  '0-0-0', 'quote', true,  true, null, 2),
  ('crs',         'VertKleen CRS',        'descale',  '0-0-0', 'quote', true,  true, null, 3),
  ('cr',          'VertKleen CR',         'degrease', '0-0-0', 'quote', true,  true, null, 4),
  ('crhd',        'VertKleen CRHD',       'degrease', '0-0-0', 'buy',   false, true, null, 5),
  ('neutral',     'VertKleen Neutral',    'degrease', '0-0-0', 'buy',   false, true, null, 6),
  ('multiwash',   'VertKleen MultiWash',  'degrease', '0-0-0', 'buy',   false, true, null, 7),
  ('watersafe60', 'WaterSafe60',          'water',    '0-0-0', 'buy',   false, true, null, 8),
  ('purgo',       'Purgo',                'water',    '0-0-0', 'quote', false, true, null, 9),
  ('dbnpa',       'DBNPA Tablet',         'water',    'low',   'quote', false, true, null, 10),
  ('lam3',        'VertKleen LAM3',       'exterior', '0-0-0', 'quote', false, true, null, 11),
  ('alumibrite',  'VertKleen AlumiBrite', 'exterior', '0-0-0', 'quote', true,  true, null, 12),
  ('torque',      'VertKleen Torque',     'exterior', '0-0-0', 'buy',   false, true, null, 13)
on conflict (sku) do update set
  name       = excluded.name,
  group_key  = excluded.group_key,
  hmis       = excluded.hmis,
  mode       = excluded.mode,
  hazmat     = excluded.hazmat,
  taxable    = excluded.taxable,
  sort       = excluded.sort,
  updated_at = now();
  -- NOTE: price intentionally NOT updated here, so owner-set prices survive a re-run.
