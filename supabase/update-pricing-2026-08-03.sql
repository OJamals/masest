-- Product pricing update from the August 3, 2026 website workbook.
-- Source: VertKleen_Website_Pricing_WebDev_8:3.xlsx
-- SHA-256: 5af05df29fe8df8dac2e7002e597e031c916d0bc378f6c26998ab002206bc5c9
-- Cross-check: VertKleen_Master_Pricing - 8:3.xlsx
-- SHA-256: 77af5e7714696081d579c1d71ced85288e2555bc3b6f4789f3fe1e212ce3df11
--
-- The website workbook is the direct build handoff and covers all 66 catalog
-- variants. Its Website Price List feeds retail; HVAC & Facilities feeds HVAC.
-- VK-HCR-1G inherits the HCR jug-tier HVAC price per the workbook size note.
-- Services, service packages, and program tiers are intentionally unchanged:
-- no August 3 service/program source was supplied.

begin;

create temporary table pricing_update_20260803 (
  vsku text primary key,
  tiers jsonb not null
) on commit drop;

insert into pricing_update_20260803 (vsku, tiers)
values
  ('VK-CR-1G', '{"retail":19.27,"hvac":22.02}'::jsonb),
  ('VK-CR-2.5G', '{"retail":48.17,"hvac":55.05}'::jsonb),
  ('VK-CR-5G', '{"retail":96.34,"hvac":110.1}'::jsonb),
  ('VK-CR-55G', '{"retail":660.51,"hvac":660.51}'::jsonb),
  ('VK-CR-275G', '{"retail":2793.66,"hvac":2793.66}'::jsonb),
  ('VK-CR2-1G', '{"retail":18.25}'::jsonb),
  ('VK-CR2-55G', '{"retail":836.65}'::jsonb),
  ('VK-CR2-275G', '{"retail":3042.74}'::jsonb),
  ('VK-HCR-1G', '{"retail":21.63,"hvac":24.72}'::jsonb),
  ('VK-HCR-2.5G', '{"retail":54.08,"hvac":61.8}'::jsonb),
  ('VK-HCR-5G', '{"retail":108.15,"hvac":123.6}'::jsonb),
  ('VK-HCR-55G', '{"retail":925.44,"hvac":925.44}'::jsonb),
  ('VK-HCR-275G', '{"retail":3443.34,"hvac":3443.34}'::jsonb),
  ('VK-HCR-T16-1G', '{"retail":21.71}'::jsonb),
  ('VK-HCR-T16-275G', '{"retail":5969.91}'::jsonb),
  ('VK-DESC-1G', '{"retail":15.03,"hvac":17.18}'::jsonb),
  ('VK-DESC-2.5G', '{"retail":37.57,"hvac":42.94}'::jsonb),
  ('VK-DESC-5G', '{"retail":75.14,"hvac":85.88}'::jsonb),
  ('VK-DESC-55G', '{"retail":532.74,"hvac":532.74}'::jsonb),
  ('VK-DESC-275G', '{"retail":2360.53,"hvac":2360.53}'::jsonb),
  ('VK-CRHD-1G', '{"retail":10.61,"hvac":12.12}'::jsonb),
  ('VK-CRHD-2.5G', '{"retail":26.51,"hvac":30.3}'::jsonb),
  ('VK-CRHD-5G', '{"retail":53.03,"hvac":60.6}'::jsonb),
  ('VK-CRHD-55G', '{"retail":352.28,"hvac":352.28}'::jsonb),
  ('VK-CRHD-275G', '{"retail":1552.03,"hvac":1552.03}'::jsonb),
  ('VK-CRHD-LF-1G', '{"retail":10.61}'::jsonb),
  ('VK-CRHD-LF-2.5G', '{"retail":26.51}'::jsonb),
  ('VK-CRHD-LF-5G', '{"retail":53.03}'::jsonb),
  ('VK-CRHD-LF-55G', '{"retail":352.28}'::jsonb),
  ('VK-CRHD-LF-275G', '{"retail":1552.03}'::jsonb),
  ('VK-NEUT-1G', '{"retail":16.23,"hvac":18.54}'::jsonb),
  ('VK-NEUT-2.5G', '{"retail":40.56,"hvac":46.36}'::jsonb),
  ('VK-NEUT-5G', '{"retail":81.13,"hvac":92.71}'::jsonb),
  ('VK-NEUT-55G', '{"retail":892.24,"hvac":892.24}'::jsonb),
  ('VK-NEUT-275G', '{"retail":4226.61,"hvac":4226.61}'::jsonb),
  ('VK-MW-1G', '{"retail":14.69,"hvac":16.78}'::jsonb),
  ('VK-MW-2.5G', '{"retail":36.72,"hvac":41.96}'::jsonb),
  ('VK-MW-5G', '{"retail":73.43,"hvac":83.92}'::jsonb),
  ('VK-MW-55G', '{"retail":476.44,"hvac":476.44}'::jsonb),
  ('VK-MW-275G', '{"retail":2205.29,"hvac":2205.29}'::jsonb),
  ('VK-LAM3-1G', '{"retail":22.21,"hvac":22.21}'::jsonb),
  ('VK-LAM3-2.5G', '{"retail":55.52,"hvac":55.52}'::jsonb),
  ('VK-LAM3-5G', '{"retail":111.03,"hvac":111.03}'::jsonb),
  ('VK-LAM3-55G', '{"retail":825.3,"hvac":825.3}'::jsonb),
  ('VK-LAM3-275G', '{"retail":4299.75,"hvac":4299.75}'::jsonb),
  ('VK-PRG-1G', '{"retail":21.49,"hvac":21.49}'::jsonb),
  ('VK-PRG-2.5G', '{"retail":53.73,"hvac":53.73}'::jsonb),
  ('VK-PRG-5G', '{"retail":107.45,"hvac":107.45}'::jsonb),
  ('VK-PRG-55G', '{"retail":868.66,"hvac":868.66}'::jsonb),
  ('VK-PRG-275G', '{"retail":3941.44,"hvac":3941.44}'::jsonb),
  ('VK-ALB-1G', '{"retail":12.05,"hvac":13.77}'::jsonb),
  ('VK-ALB-2.5G', '{"retail":30.12,"hvac":34.43}'::jsonb),
  ('VK-ALB-5G', '{"retail":60.24,"hvac":68.85}'::jsonb),
  ('VK-ALB-55G', '{"retail":448.29,"hvac":448.29}'::jsonb),
  ('VK-ALB-275G', '{"retail":2024.89,"hvac":2024.89}'::jsonb),
  ('VK-TRQ-1G', '{"retail":10.4}'::jsonb),
  ('VK-TRQ-2.5G', '{"retail":25.99}'::jsonb),
  ('VK-TRQ-5G', '{"retail":51.98}'::jsonb),
  ('VK-TRQ-55G', '{"retail":379.71}'::jsonb),
  ('VK-TRQ-275G', '{"retail":1656.67}'::jsonb),
  ('VK-SAR-1G', '{"retail":15.13}'::jsonb),
  ('VK-SAR-55G', '{"retail":693.65}'::jsonb),
  ('VK-SAR-275G', '{"retail":2728.69}'::jsonb),
  ('VK-WS60-1G', '{"retail":16.88}'::jsonb),
  ('VK-WS60-55G', '{"retail":773.85}'::jsonb),
  ('VK-WS60-275G', '{"retail":3468.64}'::jsonb);

do $$
declare
  target record;
begin
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

commit;
