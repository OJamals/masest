-- Product pricing update from the August 3, 2026 workbook with the
-- July 31 across-the-board 10% increase preserved.
-- Effective source: VertKleen_Website_Pricing_WebDev.xlsx
-- SHA-256: 10fd5121dce990fdc37803b62ed7c8e31f7b0403ba6cd275cb51d1e54aefa831
-- August 3 basis: VertKleen_Website_Pricing_WebDev_8:3.xlsx
-- SHA-256: 5af05df29fe8df8dac2e7002e597e031c916d0bc378f6c26998ab002206bc5c9
--
-- The effective workbook applies the approved 10% increase to the August 3
-- basis and covers all 66 catalog variants. Website Price List feeds retail;
-- HVAC & Facilities feeds HVAC. VK-HCR-1G inherits the HCR jug-tier HVAC price.
-- Services, service packages, and program tiers are intentionally unchanged:
-- no August 3 service/program source was supplied.

do $$
declare
  target record;
begin
  create temporary table pricing_update_20260803 (
    vsku text primary key,
    tiers jsonb not null
  ) on commit drop;

  insert into pricing_update_20260803 (vsku, tiers)
  values
  ('VK-CR-1G', '{"retail":21.2,"hvac":24.22}'::jsonb),
  ('VK-CR-2.5G', '{"retail":52.99,"hvac":60.56}'::jsonb),
  ('VK-CR-5G', '{"retail":105.97,"hvac":121.11}'::jsonb),
  ('VK-CR-55G', '{"retail":726.56,"hvac":726.56}'::jsonb),
  ('VK-CR-275G', '{"retail":3073.03,"hvac":3073.03}'::jsonb),
  ('VK-CR2-1G', '{"retail":20.08}'::jsonb),
  ('VK-CR2-55G', '{"retail":920.32}'::jsonb),
  ('VK-CR2-275G', '{"retail":3347.01}'::jsonb),
  ('VK-HCR-1G', '{"retail":23.79,"hvac":27.19}'::jsonb),
  ('VK-HCR-2.5G', '{"retail":59.49,"hvac":67.98}'::jsonb),
  ('VK-HCR-5G', '{"retail":118.97,"hvac":135.96}'::jsonb),
  ('VK-HCR-55G', '{"retail":1017.98,"hvac":1017.98}'::jsonb),
  ('VK-HCR-275G', '{"retail":3787.67,"hvac":3787.67}'::jsonb),
  ('VK-HCR-T16-1G', '{"retail":23.88}'::jsonb),
  ('VK-HCR-T16-275G', '{"retail":6566.9}'::jsonb),
  ('VK-DESC-1G', '{"retail":16.53,"hvac":18.9}'::jsonb),
  ('VK-DESC-2.5G', '{"retail":41.33,"hvac":47.23}'::jsonb),
  ('VK-DESC-5G', '{"retail":82.65,"hvac":94.47}'::jsonb),
  ('VK-DESC-55G', '{"retail":586.01,"hvac":586.01}'::jsonb),
  ('VK-DESC-275G', '{"retail":2596.58,"hvac":2596.58}'::jsonb),
  ('VK-CRHD-1G', '{"retail":11.67,"hvac":13.33}'::jsonb),
  ('VK-CRHD-2.5G', '{"retail":29.16,"hvac":33.33}'::jsonb),
  ('VK-CRHD-5G', '{"retail":58.33,"hvac":66.66}'::jsonb),
  ('VK-CRHD-55G', '{"retail":387.51,"hvac":387.51}'::jsonb),
  ('VK-CRHD-275G', '{"retail":1707.23,"hvac":1707.23}'::jsonb),
  ('VK-CRHD-LF-1G', '{"retail":11.67}'::jsonb),
  ('VK-CRHD-LF-2.5G', '{"retail":29.16}'::jsonb),
  ('VK-CRHD-LF-5G', '{"retail":58.33}'::jsonb),
  ('VK-CRHD-LF-55G', '{"retail":387.51}'::jsonb),
  ('VK-CRHD-LF-275G', '{"retail":1707.23}'::jsonb),
  ('VK-NEUT-1G', '{"retail":17.85,"hvac":20.39}'::jsonb),
  ('VK-NEUT-2.5G', '{"retail":44.62,"hvac":51.0}'::jsonb),
  ('VK-NEUT-5G', '{"retail":89.24,"hvac":101.98}'::jsonb),
  ('VK-NEUT-55G', '{"retail":981.46,"hvac":981.46}'::jsonb),
  ('VK-NEUT-275G', '{"retail":4649.27,"hvac":4649.27}'::jsonb),
  ('VK-MW-1G', '{"retail":16.16,"hvac":18.46}'::jsonb),
  ('VK-MW-2.5G', '{"retail":40.39,"hvac":46.16}'::jsonb),
  ('VK-MW-5G', '{"retail":80.77,"hvac":92.31}'::jsonb),
  ('VK-MW-55G', '{"retail":524.08,"hvac":524.08}'::jsonb),
  ('VK-MW-275G', '{"retail":2425.82,"hvac":2425.82}'::jsonb),
  ('VK-LAM3-1G', '{"retail":24.43,"hvac":24.43}'::jsonb),
  ('VK-LAM3-2.5G', '{"retail":61.07,"hvac":61.07}'::jsonb),
  ('VK-LAM3-5G', '{"retail":122.13,"hvac":122.13}'::jsonb),
  ('VK-LAM3-55G', '{"retail":907.83,"hvac":907.83}'::jsonb),
  ('VK-LAM3-275G', '{"retail":4729.73,"hvac":4729.73}'::jsonb),
  ('VK-PRG-1G', '{"retail":23.64,"hvac":23.64}'::jsonb),
  ('VK-PRG-2.5G', '{"retail":59.1,"hvac":59.1}'::jsonb),
  ('VK-PRG-5G', '{"retail":118.2,"hvac":118.2}'::jsonb),
  ('VK-PRG-55G', '{"retail":955.53,"hvac":955.53}'::jsonb),
  ('VK-PRG-275G', '{"retail":4335.58,"hvac":4335.58}'::jsonb),
  ('VK-ALB-1G', '{"retail":13.26,"hvac":15.15}'::jsonb),
  ('VK-ALB-2.5G', '{"retail":33.13,"hvac":37.87}'::jsonb),
  ('VK-ALB-5G', '{"retail":66.26,"hvac":75.74}'::jsonb),
  ('VK-ALB-55G', '{"retail":493.12,"hvac":493.12}'::jsonb),
  ('VK-ALB-275G', '{"retail":2227.38,"hvac":2227.38}'::jsonb),
  ('VK-TRQ-1G', '{"retail":11.44}'::jsonb),
  ('VK-TRQ-2.5G', '{"retail":28.59}'::jsonb),
  ('VK-TRQ-5G', '{"retail":57.18}'::jsonb),
  ('VK-TRQ-55G', '{"retail":417.68}'::jsonb),
  ('VK-TRQ-275G', '{"retail":1822.34}'::jsonb),
  ('VK-SAR-1G', '{"retail":16.64}'::jsonb),
  ('VK-SAR-55G', '{"retail":763.02}'::jsonb),
  ('VK-SAR-275G', '{"retail":3001.56}'::jsonb),
  ('VK-WS60-1G', '{"retail":18.57}'::jsonb),
  ('VK-WS60-55G', '{"retail":851.24}'::jsonb),
  ('VK-WS60-275G', '{"retail":3815.5}'::jsonb);

  if (select count(*) from pricing_update_20260803) <> 66 then
    raise exception 'pricing_update_expected_66_variants';
  end if;

  if (
    select count(*)
    from pricing_update_20260803
    where tiers ? 'hvac'
  ) <> 45 then
    raise exception 'pricing_update_expected_45_hvac_tiers';
  end if;

  if exists (
    select 1
    from pricing_update_20260803 target_row
    left join public.product_variants variant on variant.vsku = target_row.vsku
    where variant.vsku is null
  ) then
    raise exception 'pricing_update_variant_missing';
  end if;

  for target in
    select vsku, tiers
    from pricing_update_20260803
    order by vsku
  loop
    perform public.set_variant_pricing(target.vsku, target.tiers);
  end loop;

  if exists (
    select 1
    from pricing_update_20260803 target_row
    cross join lateral jsonb_each_text(target_row.tiers) target_tier
    left join public.price_tiers current_tier
      on current_tier.vsku = target_row.vsku
      and current_tier.tier::text = target_tier.key
    where current_tier.price is distinct from target_tier.value::numeric
  ) then
    raise exception 'pricing_update_tier_verification_failed';
  end if;

  if exists (
    select 1
    from pricing_update_20260803 target_row
    join public.product_variants variant on variant.vsku = target_row.vsku
    where variant.price is distinct from (target_row.tiers ->> 'retail')::numeric
  ) then
    raise exception 'pricing_update_retail_mirror_failed';
  end if;
end;
$$;
