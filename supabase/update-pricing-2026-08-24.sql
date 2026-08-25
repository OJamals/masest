-- VertKleen website publication replacement, reviewed 2026-08-24.
-- Source: VertKleen_Website_Publish_List_2026_EXTERNAL.xlsx
-- Version: v4.1 EXTERNAL
-- SHA-256: fc555e6ec410a20d945bc6e0635bdcda3ce1389bed47205f6696989fe8041d7e
--
-- Exact scope: 16 catalog products; 208 SKUs; 160 retail prices; 48 unpriced
-- bulk quote SKUs. Quart, half-gallon, and case rows retain their prices in CMS
-- but fail closed as inactive until exact parcel profiles are supplied.

begin;

alter table public.product_variants add column if not exists market text not null default 'industrial';
alter table public.product_variants add column if not exists package_kind text not null default 'unit';
alter table public.product_variants add column if not exists marketing_name text;
alter table public.product_variants add column if not exists units_per_case integer not null default 1;
alter table public.product_variants add column if not exists unit_vsku text;
alter table public.product_variants add column if not exists minimum_checkout_price numeric(12,2);
alter table public.product_variants add column if not exists intended_active boolean not null default true;
alter table public.product_variants add column if not exists activation_blocker text;
alter table public.product_variants add column if not exists requires_quote boolean not null default false;
alter table public.product_variants add column if not exists pricing_source_version text;

do $$ begin
  alter table public.product_variants add constraint product_variants_market_check
    check (market in ('industrial', 'marine'));
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.product_variants add constraint product_variants_package_kind_check
    check (package_kind in ('unit', 'case', 'bulk'));
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.product_variants add constraint product_variants_units_per_case_positive
    check (units_per_case > 0);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.product_variants add constraint product_variants_minimum_checkout_price_nonnegative
    check (minimum_checkout_price is null or minimum_checkout_price >= 0);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.product_variants add constraint product_variants_price_not_below_checkout_floor
    check (price is null or minimum_checkout_price is null or price >= minimum_checkout_price);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.product_variants add constraint product_variants_active_shipping_profile_complete
    check (
      not active or (
        shipping_weight_lb > 0
        and shipping_length_in > 0
        and shipping_width_in > 0
        and shipping_height_in > 0
      )
    ) not valid;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.product_variants add constraint product_variants_active_unblocked
    check (not active or activation_blocker is null);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.product_variants add constraint product_variants_bulk_quote_only
    check (package_kind <> 'bulk' or (active = false and requires_quote = true and price is null));
exception when duplicate_object then null;
end $$;

create or replace function public.set_variant_pricing(
  p_vsku text,
  p_tiers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_price numeric(12,2);
  v_floor numeric(12,2);
begin
  select minimum_checkout_price into v_floor
  from public.product_variants
  where vsku = p_vsku;

  if not found then
    raise exception 'variant_not_found' using errcode = 'P0002';
  end if;

  foreach v_tier in array array['retail', 'hvac', 'wholesale']
  loop
    if not (coalesce(p_tiers, '{}'::jsonb) ? v_tier) then
      continue;
    end if;

    if p_tiers -> v_tier = 'null'::jsonb then
      delete from public.price_tiers
      where vsku = p_vsku and tier = v_tier::pricing_tier;
      if v_tier = 'retail' then
        update public.product_variants set price = null where vsku = p_vsku;
      end if;
      continue;
    end if;

    v_price := (p_tiers ->> v_tier)::numeric(12,2);
    if v_price < 0 then
      raise exception 'price_must_be_non_negative' using errcode = '22003';
    end if;
    if v_floor is not null and v_price < v_floor then
      raise exception 'price_below_minimum_checkout' using errcode = '22003';
    end if;

    insert into public.price_tiers (vsku, tier, price, currency, updated_at)
    values (p_vsku, v_tier::pricing_tier, v_price, 'usd', now())
    on conflict (vsku, tier) do update set
      price = excluded.price,
      currency = excluded.currency,
      updated_at = now();

    if v_tier = 'retail' then
      update public.product_variants set price = v_price where vsku = p_vsku;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'vsku', p_vsku);
end;
$$;

revoke all on function public.set_variant_pricing(text, jsonb) from public;
revoke all on function public.set_variant_pricing(text, jsonb) from anon, authenticated;
grant execute on function public.set_variant_pricing(text, jsonb) to service_role;

create temporary table pricing_update_20260824 (
  vsku text primary key,
  product_sku text not null,
  label text not null,
  gallons numeric(8,2) not null,
  market text not null,
  package_kind text not null,
  marketing_name text not null,
  units_per_case integer not null,
  unit_vsku text,
  active boolean not null,
  intended_active boolean not null,
  activation_blocker text,
  requires_quote boolean not null,
  shipping_weight_lb numeric(10,3),
  shipping_length_in numeric(8,2),
  shipping_width_in numeric(8,2),
  shipping_height_in numeric(8,2),
  pricing_source_version text not null,
  retail_price numeric(12,2),
  minimum_checkout_price numeric(12,2),
  sort integer not null
) on commit drop;

insert into pricing_update_20260824 (
  vsku, product_sku, label, gallons, market, package_kind, marketing_name,
  units_per_case, unit_vsku, active, intended_active, activation_blocker,
  requires_quote, shipping_weight_lb, shipping_length_in, shipping_width_in,
  shipping_height_in, pricing_source_version, retail_price,
  minimum_checkout_price, sort
)
values
('WS60-QT', 'watersafe60', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen WaterSafe60', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 6.49, 4.99, 1),
('WS60-HG', 'watersafe60', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen WaterSafe60', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 11.49, 8.99, 2),
('WS60-1G', 'watersafe60', '1 gal', 1, 'industrial', 'unit', 'VertKleen WaterSafe60', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 18.99, 15.49, 3),
('WS60-25G', 'watersafe60', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen WaterSafe60', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 44.99, 36.49, 4),
('CR60-QT', 'cr60', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen CR60', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 6.99, 5.49, 1),
('CR60-HG', 'cr60', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen CR60', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 12.49, 9.99, 2),
('CR60-1G', 'cr60', '1 gal', 1, 'industrial', 'unit', 'VertKleen CR60', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 20.49, 16.49, 3),
('CR60-25G', 'cr60', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen CR60', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 48.49, 39.49, 4),
('PRG-QT', 'purgo', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen Purgo', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 13.99, 10.99, 1),
('PRG-HG', 'purgo', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen Purgo', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 25.99, 20.99, 2),
('PRG-1G', 'purgo', '1 gal', 1, 'industrial', 'unit', 'VertKleen Purgo', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 42.99, 34.99, 3),
('PRG-25G', 'purgo', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen Purgo', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 102.49, 83.49, 4),
('SAR-QT', 'sar', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen SAR', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 5.99, 4.49, 1),
('SAR-HG', 'sar', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen SAR', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 10.49, 8.49, 2),
('SAR-1G', 'sar', '1 gal', 1, 'industrial', 'unit', 'VertKleen SAR', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 16.99, 13.49, 3),
('SAR-25G', 'sar', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen SAR', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 39.99, 32.49, 4),
('HCR-QT', 'hcr-t16', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen HVAC HCR', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 9.49, 7.49, 1),
('HCR-HG', 'hcr-t16', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen HVAC HCR', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 17.49, 13.99, 2),
('HCR-1G', 'hcr-t16', '1 gal', 1, 'industrial', 'unit', 'VertKleen HVAC HCR', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 28.99, 23.49, 3),
('HCR-25G', 'hcr-t16', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen HVAC HCR', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 68.49, 55.99, 4),
('DSC-QT', 'descaler', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen Descaler', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 6.49, 4.99, 1),
('DSC-HG', 'descaler', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen Descaler', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 12.49, 9.99, 2),
('DSC-1G', 'descaler', '1 gal', 1, 'industrial', 'unit', 'VertKleen Descaler', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 20.49, 16.49, 3),
('DSC-25G', 'descaler', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen Descaler', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 47.99, 38.99, 4),
('CR-QT', 'cr2', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen HVAC CR', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 8.99, 6.99, 1),
('CR-HG', 'cr2', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen HVAC CR', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 15.49, 12.49, 2),
('CR-1G', 'cr2', '1 gal', 1, 'industrial', 'unit', 'VertKleen HVAC CR', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 25.99, 20.99, 3),
('CR-25G', 'cr2', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen HVAC CR', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 61.49, 49.99, 4),
('ND-QT', 'neutral', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen Neutral', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 7.49, 5.99, 1),
('ND-HG', 'neutral', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen Neutral', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 12.99, 10.49, 2),
('ND-1G', 'neutral', '1 gal', 1, 'industrial', 'unit', 'VertKleen Neutral', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 21.99, 17.99, 3),
('ND-25G', 'neutral', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen Neutral', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 51.49, 41.99, 4),
('HCRCIP-QT', 'hcr', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen CIP HCR', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 9.49, 7.49, 1),
('HCRCIP-HG', 'hcr', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen CIP HCR', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 17.49, 13.99, 2),
('HCRCIP-1G', 'hcr', '1 gal', 1, 'industrial', 'unit', 'VertKleen CIP HCR', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 28.99, 23.49, 3),
('HCRCIP-25G', 'hcr', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen CIP HCR', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 68.49, 55.99, 4),
('CRCIP-QT', 'cr', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen CIP CR', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 8.99, 6.99, 1),
('CRCIP-HG', 'cr', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen CIP CR', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 15.49, 12.49, 2),
('CRCIP-1G', 'cr', '1 gal', 1, 'industrial', 'unit', 'VertKleen CIP CR', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 25.99, 20.99, 3),
('CRCIP-25G', 'cr', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen CIP CR', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 61.49, 49.99, 4),
('CRHD-QT', 'cr-hd', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen CRHD', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 4.99, 3.99, 1),
('CRHD-HG', 'cr-hd', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen CRHD', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 8.49, 6.49, 2),
('CRHD-1G', 'cr-hd', '1 gal', 1, 'industrial', 'unit', 'VertKleen CRHD', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 14.49, 11.49, 3),
('CRHD-25G', 'cr-hd', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen CRHD', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 33.99, 27.49, 4),
('CRHDLF-QT', 'cr-hd-low-foam', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen CRHD Low Foam', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 4.99, 3.99, 1),
('CRHDLF-HG', 'cr-hd-low-foam', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen CRHD Low Foam', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 8.49, 6.49, 2),
('CRHDLF-1G', 'cr-hd-low-foam', '1 gal', 1, 'industrial', 'unit', 'VertKleen CRHD Low Foam', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 14.49, 11.49, 3),
('CRHDLF-25G', 'cr-hd-low-foam', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen CRHD Low Foam', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 33.99, 27.49, 4),
('MW-QT', 'multiwash', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen MultiWash', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 6.99, 5.49, 1),
('MW-HG', 'multiwash', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen MultiWash', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 11.99, 9.49, 2),
('MW-1G', 'multiwash', '1 gal', 1, 'industrial', 'unit', 'VertKleen MultiWash', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 19.99, 15.99, 3),
('MW-25G', 'multiwash', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen MultiWash', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 46.49, 37.99, 4),
('AB-QT', 'alumibrite', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen AlumiBrite', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 5.49, 4.49, 1),
('AB-HG', 'alumibrite', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen AlumiBrite', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 9.99, 7.99, 2),
('AB-1G', 'alumibrite', '1 gal', 1, 'industrial', 'unit', 'VertKleen AlumiBrite', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 16.49, 13.49, 3),
('AB-25G', 'alumibrite', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen AlumiBrite', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 38.49, 31.49, 4),
('LAM3-QT', 'lam3', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen Lam3', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 13.99, 10.99, 1),
('LAM3-HG', 'lam3', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen Lam3', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 24.49, 19.99, 2),
('LAM3-1G', 'lam3', '1 gal', 1, 'industrial', 'unit', 'VertKleen Lam3', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 40.99, 33.49, 3),
('LAM3-25G', 'lam3', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen Lam3', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 96.99, 78.99, 4),
('TW-QT', 'torque', '1/4 gal (quart)', 0.25, 'industrial', 'unit', 'VertKleen Torque', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 5.99, 4.49, 1),
('TW-HG', 'torque', '1/2 gal', 0.5, 'industrial', 'unit', 'VertKleen Torque', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 11.99, 9.49, 2),
('TW-1G', 'torque', '1 gal', 1, 'industrial', 'unit', 'VertKleen Torque', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 19.99, 15.99, 3),
('TW-25G', 'torque', '2.5 gal', 2.5, 'industrial', 'unit', 'VertKleen Torque', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 46.49, 37.99, 4),
('SB-QT', 'hcr-t16', '1/4 gal (32 oz)', 0.25, 'marine', 'unit', 'Scale Buster', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 13.49, 10.49, 1),
('SB-HG', 'hcr-t16', '1/2 gal', 0.5, 'marine', 'unit', 'Scale Buster', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 24.99, 19.99, 2),
('SB-1G', 'hcr-t16', '1 gal', 1, 'marine', 'unit', 'Scale Buster', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 44.99, 36.99, 3),
('SB-25G', 'hcr-t16', '2.5 gal', 2.5, 'marine', 'unit', 'Scale Buster', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 112.49, 91.99, 4),
('SVC-QT', 'descaler', '1/4 gal (32 oz)', 0.25, 'marine', 'unit', 'SeaVap Coil Kleener', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 10.49, 7.99, 1),
('SVC-HG', 'descaler', '1/2 gal', 0.5, 'marine', 'unit', 'SeaVap Coil Kleener', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 18.49, 14.49, 2),
('SVC-1G', 'descaler', '1 gal', 1, 'marine', 'unit', 'SeaVap Coil Kleener', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 31.99, 25.99, 3),
('SVC-25G', 'descaler', '2.5 gal', 2.5, 'marine', 'unit', 'SeaVap Coil Kleener', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 79.99, 64.49, 4),
('SDK-QT', 'cr2', '1/4 gal (32 oz)', 0.25, 'marine', 'unit', 'Sea Drain Kleener', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 12.49, 9.49, 1),
('SDK-HG', 'cr2', '1/2 gal', 0.5, 'marine', 'unit', 'Sea Drain Kleener', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 22.49, 17.99, 2),
('SDK-1G', 'cr2', '1 gal', 1, 'marine', 'unit', 'Sea Drain Kleener', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 39.99, 32.99, 3),
('SDK-25G', 'cr2', '2.5 gal', 2.5, 'marine', 'unit', 'Sea Drain Kleener', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 99.99, 81.99, 4),
('MWM-QT', 'multiwash', '1/4 gal (32 oz)', 0.25, 'marine', 'unit', 'MultiWash Marine', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 10.99, 8.49, 1),
('MWM-HG', 'multiwash', '1/2 gal', 0.5, 'marine', 'unit', 'MultiWash Marine', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 19.49, 15.49, 2),
('MWM-1G', 'multiwash', '1 gal', 1, 'marine', 'unit', 'MultiWash Marine', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 33.99, 27.99, 3),
('MWM-25G', 'multiwash', '2.5 gal', 2.5, 'marine', 'unit', 'MultiWash Marine', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 84.99, 69.49, 4),
('MDG-QT', 'cr-hd', '1/4 gal (32 oz)', 0.25, 'marine', 'unit', 'Marine Degreaser', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 8.99, 6.49, 1),
('MDG-HG', 'cr-hd', '1/2 gal', 0.5, 'marine', 'unit', 'Marine Degreaser', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 15.49, 11.99, 2),
('MDG-1G', 'cr-hd', '1 gal', 1, 'marine', 'unit', 'Marine Degreaser', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 25.99, 20.99, 3),
('MDG-25G', 'cr-hd', '2.5 gal', 2.5, 'marine', 'unit', 'Marine Degreaser', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 64.99, 51.99, 4),
('ABM-QT', 'alumibrite', '1/4 gal (32 oz)', 0.25, 'marine', 'unit', 'AlumiBrite Marine', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 8.99, 6.49, 1),
('ABM-HG', 'alumibrite', '1/2 gal', 0.5, 'marine', 'unit', 'AlumiBrite Marine', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 15.49, 11.99, 2),
('ABM-1G', 'alumibrite', '1 gal', 1, 'marine', 'unit', 'AlumiBrite Marine', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 25.99, 20.99, 3),
('ABM-25G', 'alumibrite', '2.5 gal', 2.5, 'marine', 'unit', 'AlumiBrite Marine', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 64.99, 51.99, 4),
('MWW-QT', 'torque', '1/4 gal (32 oz)', 0.25, 'marine', 'unit', 'Marine Wash & Wax', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 7.99, 5.99, 1),
('MWW-HG', 'torque', '1/2 gal', 0.5, 'marine', 'unit', 'Marine Wash & Wax', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 13.49, 10.49, 2),
('MWW-1G', 'torque', '1 gal', 1, 'marine', 'unit', 'Marine Wash & Wax', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 21.99, 17.99, 3),
('MWW-25G', 'torque', '2.5 gal', 2.5, 'marine', 'unit', 'Marine Wash & Wax', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 54.99, 44.49, 4),
('MAM-QT', 'purgo', '1/4 gal (32 oz)', 0.25, 'marine', 'unit', 'Marine Antimicrobial', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 16.99, 13.49, 1),
('MAM-HG', 'purgo', '1/2 gal', 0.5, 'marine', 'unit', 'Marine Antimicrobial', 1, null, false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 31.49, 25.49, 2),
('MAM-1G', 'purgo', '1 gal', 1, 'marine', 'unit', 'Marine Antimicrobial', 1, null, true, true, null, false, 10, 6, 6, 12, 'v4.1 EXTERNAL', 57.99, 47.99, 3),
('MAM-25G', 'purgo', '2.5 gal', 2.5, 'marine', 'unit', 'Marine Antimicrobial', 1, null, true, true, null, false, 25, 10, 10, 15, 'v4.1 EXTERNAL', 144.99, 119.49, 4),
('WS60-QT-CS', 'watersafe60', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen WaterSafe60', 12, 'WS60-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 70.09, 59.88, 5),
('WS60-HG-CS', 'watersafe60', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen WaterSafe60', 6, 'WS60-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 62.05, 53.94, 6),
('WS60-1G-CS', 'watersafe60', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen WaterSafe60', 4, 'WS60-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 68.36, 61.96, 7),
('WS60-25G-CS', 'watersafe60', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen WaterSafe60', 2, 'WS60-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 80.98, 72.98, 8),
('CR60-QT-CS', 'cr60', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen CR60', 12, 'CR60-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 75.49, 65.88, 5),
('CR60-HG-CS', 'cr60', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen CR60', 6, 'CR60-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 67.45, 59.94, 6),
('CR60-1G-CS', 'cr60', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen CR60', 4, 'CR60-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 73.76, 65.96, 7),
('CR60-25G-CS', 'cr60', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen CR60', 2, 'CR60-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 87.28, 78.98, 8),
('PRG-QT-CS', 'purgo', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen Purgo', 12, 'PRG-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 151.09, 131.88, 5),
('PRG-HG-CS', 'purgo', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen Purgo', 6, 'PRG-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 140.35, 125.94, 6),
('PRG-1G-CS', 'purgo', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen Purgo', 4, 'PRG-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 154.76, 139.96, 7),
('PRG-25G-CS', 'purgo', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen Purgo', 2, 'PRG-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 184.48, 166.98, 8),
('SAR-QT-CS', 'sar', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen SAR', 12, 'SAR-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 64.69, 53.88, 5),
('SAR-HG-CS', 'sar', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen SAR', 6, 'SAR-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 56.65, 50.94, 6),
('SAR-1G-CS', 'sar', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen SAR', 4, 'SAR-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 61.16, 53.96, 7),
('SAR-25G-CS', 'sar', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen SAR', 2, 'SAR-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 71.98, 64.98, 8),
('HCR-QT-CS', 'hcr-t16', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen HVAC HCR', 12, 'HCR-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 102.49, 89.88, 5),
('HCR-HG-CS', 'hcr-t16', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen HVAC HCR', 6, 'HCR-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 94.45, 83.94, 6),
('HCR-1G-CS', 'hcr-t16', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen HVAC HCR', 4, 'HCR-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 104.36, 93.96, 7),
('HCR-25G-CS', 'hcr-t16', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen HVAC HCR', 2, 'HCR-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 123.28, 111.98, 8),
('DSC-QT-CS', 'descaler', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen Descaler', 12, 'DSC-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 70.09, 59.88, 5),
('DSC-HG-CS', 'descaler', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen Descaler', 6, 'DSC-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 67.45, 59.94, 6),
('DSC-1G-CS', 'descaler', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen Descaler', 4, 'DSC-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 73.76, 65.96, 7),
('DSC-25G-CS', 'descaler', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen Descaler', 2, 'DSC-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 86.38, 77.98, 8),
('CR-QT-CS', 'cr2', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen HVAC CR', 12, 'CR-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 97.09, 83.88, 5),
('CR-HG-CS', 'cr2', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen HVAC CR', 6, 'CR-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 83.65, 74.94, 6),
('CR-1G-CS', 'cr2', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen HVAC CR', 4, 'CR-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 93.56, 83.96, 7),
('CR-25G-CS', 'cr2', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen HVAC CR', 2, 'CR-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 110.68, 99.98, 8),
('ND-QT-CS', 'neutral', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen Neutral', 12, 'ND-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 80.89, 71.88, 5),
('ND-HG-CS', 'neutral', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen Neutral', 6, 'ND-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 70.15, 62.94, 6),
('ND-1G-CS', 'neutral', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen Neutral', 4, 'ND-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 79.16, 71.96, 7),
('ND-25G-CS', 'neutral', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen Neutral', 2, 'ND-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 92.68, 83.98, 8),
('HCRCIP-QT-CS', 'hcr', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen CIP HCR', 12, 'HCRCIP-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 102.49, 89.88, 5),
('HCRCIP-HG-CS', 'hcr', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen CIP HCR', 6, 'HCRCIP-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 94.45, 83.94, 6),
('HCRCIP-1G-CS', 'hcr', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen CIP HCR', 4, 'HCRCIP-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 104.36, 93.96, 7),
('HCRCIP-25G-CS', 'hcr', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen CIP HCR', 2, 'HCRCIP-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 123.28, 111.98, 8),
('CRCIP-QT-CS', 'cr', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen CIP CR', 12, 'CRCIP-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 97.09, 83.88, 5),
('CRCIP-HG-CS', 'cr', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen CIP CR', 6, 'CRCIP-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 83.65, 74.94, 6),
('CRCIP-1G-CS', 'cr', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen CIP CR', 4, 'CRCIP-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 93.56, 83.96, 7),
('CRCIP-25G-CS', 'cr', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen CIP CR', 2, 'CRCIP-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 110.68, 99.98, 8),
('CRHD-QT-CS', 'cr-hd', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen CRHD', 12, 'CRHD-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 53.89, 47.88, 5),
('CRHD-HG-CS', 'cr-hd', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen CRHD', 6, 'CRHD-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 45.85, 38.94, 6),
('CRHD-1G-CS', 'cr-hd', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen CRHD', 4, 'CRHD-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 52.16, 45.96, 7),
('CRHD-25G-CS', 'cr-hd', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen CRHD', 2, 'CRHD-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 61.18, 54.98, 8),
('CRHDLF-QT-CS', 'cr-hd-low-foam', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen CRHD Low Foam', 12, 'CRHDLF-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 53.89, 47.88, 5),
('CRHDLF-HG-CS', 'cr-hd-low-foam', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen CRHD Low Foam', 6, 'CRHDLF-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 45.85, 38.94, 6),
('CRHDLF-1G-CS', 'cr-hd-low-foam', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen CRHD Low Foam', 4, 'CRHDLF-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 52.16, 45.96, 7),
('CRHDLF-25G-CS', 'cr-hd-low-foam', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen CRHD Low Foam', 2, 'CRHDLF-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 61.18, 54.98, 8),
('MW-QT-CS', 'multiwash', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen MultiWash', 12, 'MW-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 75.49, 65.88, 5),
('MW-HG-CS', 'multiwash', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen MultiWash', 6, 'MW-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 64.75, 56.94, 6),
('MW-1G-CS', 'multiwash', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen MultiWash', 4, 'MW-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 71.96, 63.96, 7),
('MW-25G-CS', 'multiwash', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen MultiWash', 2, 'MW-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 83.68, 75.98, 8),
('AB-QT-CS', 'alumibrite', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen AlumiBrite', 12, 'AB-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 59.29, 53.88, 5),
('AB-HG-CS', 'alumibrite', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen AlumiBrite', 6, 'AB-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 53.95, 47.94, 6),
('AB-1G-CS', 'alumibrite', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen AlumiBrite', 4, 'AB-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 59.36, 53.96, 7),
('AB-25G-CS', 'alumibrite', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen AlumiBrite', 2, 'AB-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 69.28, 62.98, 8),
('LAM3-QT-CS', 'lam3', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen Lam3', 12, 'LAM3-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 151.09, 131.88, 5),
('LAM3-HG-CS', 'lam3', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen Lam3', 6, 'LAM3-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 132.25, 119.94, 6),
('LAM3-1G-CS', 'lam3', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen Lam3', 4, 'LAM3-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 147.56, 133.96, 7),
('LAM3-25G-CS', 'lam3', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen Lam3', 2, 'LAM3-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 174.58, 157.98, 8),
('TW-QT-CS', 'torque', 'case of 12 × 1/4 gal (quart)', 3, 'industrial', 'case', 'VertKleen Torque', 12, 'TW-QT', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 64.69, 53.88, 5),
('TW-HG-CS', 'torque', 'case of 6 × 1/2 gal', 3, 'industrial', 'case', 'VertKleen Torque', 6, 'TW-HG', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 64.75, 56.94, 6),
('TW-1G-CS', 'torque', 'case of 4 × 1 gal', 4, 'industrial', 'case', 'VertKleen Torque', 4, 'TW-1G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 71.96, 63.96, 7),
('TW-25G-CS', 'torque', 'case of 2 × 2.5 gal', 5, 'industrial', 'case', 'VertKleen Torque', 2, 'TW-25G', false, true, 'shipping_package_profile_missing', false, null, null, null, null, 'v4.1 EXTERNAL', 83.68, 75.98, 8),
('SB-55D', 'hcr-t16', '55 gal drum', 55, 'marine', 'bulk', 'Scale Buster', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('SB-275T', 'hcr-t16', '275 gal tote', 275, 'marine', 'bulk', 'Scale Buster', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('SVC-55D', 'descaler', '55 gal drum', 55, 'marine', 'bulk', 'SeaVap Coil Kleener', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('SVC-275T', 'descaler', '275 gal tote', 275, 'marine', 'bulk', 'SeaVap Coil Kleener', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('SDK-55D', 'cr2', '55 gal drum', 55, 'marine', 'bulk', 'Sea Drain Kleener', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('SDK-275T', 'cr2', '275 gal tote', 275, 'marine', 'bulk', 'Sea Drain Kleener', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('MWM-55D', 'multiwash', '55 gal drum', 55, 'marine', 'bulk', 'MultiWash Marine', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('MWM-275T', 'multiwash', '275 gal tote', 275, 'marine', 'bulk', 'MultiWash Marine', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('MDG-55D', 'cr-hd', '55 gal drum', 55, 'marine', 'bulk', 'Marine Degreaser', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('MDG-275T', 'cr-hd', '275 gal tote', 275, 'marine', 'bulk', 'Marine Degreaser', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('ABM-55D', 'alumibrite', '55 gal drum', 55, 'marine', 'bulk', 'AlumiBrite Marine', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('ABM-275T', 'alumibrite', '275 gal tote', 275, 'marine', 'bulk', 'AlumiBrite Marine', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('MWW-55D', 'torque', '55 gal drum', 55, 'marine', 'bulk', 'Marine Wash & Wax', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('MWW-275T', 'torque', '275 gal tote', 275, 'marine', 'bulk', 'Marine Wash & Wax', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('MAM-55D', 'purgo', '55 gal drum', 55, 'marine', 'bulk', 'Marine Antimicrobial', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('MAM-275T', 'purgo', '275 gal tote', 275, 'marine', 'bulk', 'Marine Antimicrobial', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('WS60-55D', 'watersafe60', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen WaterSafe60', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('WS60-275T', 'watersafe60', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen WaterSafe60', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('CR60-55D', 'cr60', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen CR60', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('CR60-275T', 'cr60', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen CR60', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('PRG-55D', 'purgo', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen Purgo', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('PRG-275T', 'purgo', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen Purgo', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('SAR-55D', 'sar', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen SAR', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('SAR-275T', 'sar', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen SAR', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('HCR-55D', 'hcr-t16', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen HVAC HCR', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('HCR-275T', 'hcr-t16', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen HVAC HCR', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('DSC-55D', 'descaler', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen Descaler', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('DSC-275T', 'descaler', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen Descaler', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('CR-55D', 'cr2', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen HVAC CR', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('CR-275T', 'cr2', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen HVAC CR', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('ND-55D', 'neutral', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen Neutral', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('ND-275T', 'neutral', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen Neutral', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('HCRCIP-55D', 'hcr', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen CIP HCR', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('HCRCIP-275T', 'hcr', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen CIP HCR', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('CRCIP-55D', 'cr', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen CIP CR', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('CRCIP-275T', 'cr', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen CIP CR', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('CRHD-55D', 'cr-hd', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen CRHD', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('CRHD-275T', 'cr-hd', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen CRHD', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('CRHDLF-55D', 'cr-hd-low-foam', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen CRHD Low Foam', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('CRHDLF-275T', 'cr-hd-low-foam', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen CRHD Low Foam', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('MW-55D', 'multiwash', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen MultiWash', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('MW-275T', 'multiwash', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen MultiWash', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('AB-55D', 'alumibrite', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen AlumiBrite', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('AB-275T', 'alumibrite', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen AlumiBrite', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('LAM3-55D', 'lam3', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen Lam3', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('LAM3-275T', 'lam3', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen Lam3', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10),
('TW-55D', 'torque', '55 gal drum', 55, 'industrial', 'bulk', 'VertKleen Torque', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 9),
('TW-275T', 'torque', '275 gal tote', 275, 'industrial', 'bulk', 'VertKleen Torque', 1, null, false, false, null, true, null, null, null, null, 'v4.1 EXTERNAL', null, null, 10);

do $$
begin
  if (select count(*) from pricing_update_20260824) <> 208 then
    raise exception 'pricing_update_expected_208_variants';
  end if;
  if (select count(*) from pricing_update_20260824 where retail_price is not null) <> 160 then
    raise exception 'pricing_update_expected_160_priced_variants';
  end if;
  if (select count(*) from pricing_update_20260824 where package_kind = 'bulk' and retail_price is null and requires_quote) <> 48 then
    raise exception 'pricing_update_expected_48_quote_only_variants';
  end if;
  if (select count(*) from pricing_update_20260824 where active) <> 48 then
    raise exception 'pricing_update_expected_48_checkout_ready_variants';
  end if;
  if (select count(*) from pricing_update_20260824 where activation_blocker = 'shipping_package_profile_missing') <> 112 then
    raise exception 'pricing_update_expected_112_shipping_blocked_variants';
  end if;
  if exists (
    select 1 from pricing_update_20260824
    where active and (
      shipping_weight_lb is null or shipping_length_in is null
      or shipping_width_in is null or shipping_height_in is null
    )
  ) then
    raise exception 'shipping_package_profile_missing';
  end if;
end;
$$;

insert into public.products (sku, name, group_key, hmis, mode, hazmat, taxable, active, sort)
values
('cr', 'VertKleen CIP CR', 'cip_brewery', '0-0-0', 'buy', false, true, true, 1),
('cr2', 'VertKleen HVAC CR', 'water', '0-0-0', 'buy', false, true, true, 2),
('hcr', 'VertKleen CIP HCR', 'descale', '0-0-0', 'buy', false, true, true, 3),
('hcr-t16', 'VertKleen HVAC HCR', 'descale', '0-0-0', 'buy', false, true, true, 4),
('descaler', 'VertKleen Descaler', 'hvac_coils', '0-0-0', 'buy', false, true, true, 5),
('cr-hd', 'VertKleen CRHD', 'degrease', '0-0-0', 'buy', false, true, true, 6),
('cr-hd-low-foam', 'VertKleen CRHD Low Foam', 'degrease', '0-0-0', 'buy', false, true, true, 7),
('neutral', 'VertKleen Neutral', 'degrease', '0-0-0', 'buy', false, true, true, 8),
('multiwash', 'VertKleen MultiWash', 'softwash_exterior', '0-0-0', 'buy', false, true, true, 9),
('lam3', 'VertKleen Lam3', 'softwash_exterior', '0-0-0', 'buy', false, true, true, 10),
('purgo', 'VertKleen Purgo', 'water', '0-0-0', 'buy', false, true, true, 11),
('alumibrite', 'VertKleen AlumiBrite', 'marine', '0-0-0', 'buy', false, true, true, 12),
('torque', 'VertKleen Torque', 'marine', '0-0-0', 'buy', false, true, true, 13),
('sar', 'VertKleen SAR', 'specialty', '0-0-0', 'buy', false, true, true, 14),
('watersafe60', 'Watersafe60', 'water', '0-0-0', 'buy', false, true, true, 15),
('cr60', 'VertKleen CR60', 'water', '0-0-0', 'buy', false, true, true, 16)
on conflict (sku) do update set
  name = excluded.name,
  group_key = excluded.group_key,
  hmis = excluded.hmis,
  mode = excluded.mode,
  hazmat = excluded.hazmat,
  taxable = excluded.taxable,
  price = null,
  currency = 'usd',
  stripe_price_id = null,
  active = excluded.active,
  sort = excluded.sort;

insert into public.product_variants (
  vsku, product_sku, label, gallons, market, package_kind, marketing_name,
  units_per_case, unit_vsku, active, intended_active, activation_blocker,
  requires_quote, shipping_weight_lb, shipping_length_in, shipping_width_in,
  shipping_height_in, pricing_source_version, price, minimum_checkout_price,
  currency, sort
)
select
  vsku, product_sku, label, gallons, market, package_kind, marketing_name,
  units_per_case, unit_vsku, active, intended_active, activation_blocker,
  requires_quote, shipping_weight_lb, shipping_length_in, shipping_width_in,
  shipping_height_in, pricing_source_version, retail_price,
  minimum_checkout_price, 'usd', sort
from pricing_update_20260824
on conflict (vsku) do update set
  product_sku = excluded.product_sku,
  label = excluded.label,
  gallons = excluded.gallons,
  market = excluded.market,
  package_kind = excluded.package_kind,
  marketing_name = excluded.marketing_name,
  units_per_case = excluded.units_per_case,
  unit_vsku = excluded.unit_vsku,
  active = excluded.active,
  intended_active = excluded.intended_active,
  activation_blocker = excluded.activation_blocker,
  requires_quote = excluded.requires_quote,
  shipping_weight_lb = excluded.shipping_weight_lb,
  shipping_length_in = excluded.shipping_length_in,
  shipping_width_in = excluded.shipping_width_in,
  shipping_height_in = excluded.shipping_height_in,
  pricing_source_version = excluded.pricing_source_version,
  price = excluded.price,
  stripe_price_id = null,
  minimum_checkout_price = excluded.minimum_checkout_price,
  currency = excluded.currency,
  sort = excluded.sort;

delete from public.product_variants
where vsku not in (select vsku from pricing_update_20260824);

delete from public.products
where sku not in ('cr', 'cr2', 'hcr', 'hcr-t16', 'descaler', 'cr-hd', 'cr-hd-low-foam', 'neutral', 'multiwash', 'lam3', 'purgo', 'alumibrite', 'torque', 'sar', 'watersafe60', 'cr60');

-- The legacy catalog contains active rows without parcel profiles. Add this
-- constraint NOT VALID above, replace/prune those rows, then validate the exact
-- replacement. This keeps the migration transactional and deployable in place.
alter table public.product_variants
  validate constraint product_variants_active_shipping_profile_complete;

delete from public.price_tiers
where vsku in (select vsku from pricing_update_20260824);

insert into public.price_tiers (vsku, tier, price, currency, updated_at)
select vsku, 'retail'::pricing_tier, retail_price, 'usd', now()
from pricing_update_20260824
where retail_price is not null;

do $$
begin
  if (select count(*) from public.products) <> 16
    or (select count(*) from public.product_variants) <> 208
    or (select count(*) from public.price_tiers) <> 160
    or exists (
      select 1 from public.products current_product
      where current_product.price is not null
        or current_product.stripe_price_id is not null
        or current_product.currency <> 'usd'
    )
    or (
      select count(*) from public.price_tiers tier
      join pricing_update_20260824 target using (vsku)
      where tier.tier = 'retail' and tier.price = target.retail_price
    ) <> 160
  then
    raise exception 'pricing_update_exact_readback_failed';
  end if;

  if exists (
    select 1
    from pricing_update_20260824 target
    left join public.product_variants current on current.vsku = target.vsku
    where current.vsku is null
      or current.product_sku is distinct from target.product_sku
      or current.label is distinct from target.label
      or current.gallons is distinct from target.gallons
      or current.market is distinct from target.market
      or current.package_kind is distinct from target.package_kind
      or current.marketing_name is distinct from target.marketing_name
      or current.units_per_case is distinct from target.units_per_case
      or current.unit_vsku is distinct from target.unit_vsku
      or current.active is distinct from target.active
      or current.intended_active is distinct from target.intended_active
      or current.activation_blocker is distinct from target.activation_blocker
      or current.requires_quote is distinct from target.requires_quote
      or current.shipping_weight_lb is distinct from target.shipping_weight_lb
      or current.shipping_length_in is distinct from target.shipping_length_in
      or current.shipping_width_in is distinct from target.shipping_width_in
      or current.shipping_height_in is distinct from target.shipping_height_in
      or current.pricing_source_version is distinct from target.pricing_source_version
      or current.price is distinct from target.retail_price
      or current.stripe_price_id is not null
      or current.minimum_checkout_price is distinct from target.minimum_checkout_price
  ) then
    raise exception 'pricing_update_exact_readback_failed';
  end if;

  if exists (
    select 1
    from pricing_update_20260824 target
    left join public.price_tiers tier
      on tier.vsku = target.vsku and tier.tier = 'retail'
    where (target.retail_price is null and tier.vsku is not null)
       or (target.retail_price is not null and tier.price is distinct from target.retail_price)
  ) then
    raise exception 'pricing_update_exact_readback_failed';
  end if;
end;
$$;

commit;
