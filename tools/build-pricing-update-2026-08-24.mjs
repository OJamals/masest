// Emit the one-time, transactional v4.1 catalog/pricing migration.
// Canonical input: data/vertkleen-website-publish-2026-v4.1.json.
// Usage: node tools/build-pricing-update-2026-08-24.mjs

import { readFile } from 'node:fs/promises';

const here = (path) => new URL(`../${path}`, import.meta.url);
const publication = JSON.parse(await readFile(
  here('data/vertkleen-website-publish-2026-v4.1.json'),
  'utf8',
));
const catalog = JSON.parse(await readFile(here('data/catalog.seed.json'), 'utf8'));

const priceRows = [
  ...publication.unit_variants,
  ...publication.case_variants,
  ...publication.bulk_variants,
];
const priceBySku = new Map(priceRows.map((row) => [row.sku, row]));
const variants = catalog.product_variants.map((variant) => {
  const price = priceBySku.get(variant.sku);
  if (!price) throw new Error(`publication row missing: ${variant.sku}`);
  return {
    ...variant,
    retail_price: price.online_price,
    minimum_checkout_price: price.minimum_checkout_price,
  };
});

if (priceRows.length !== 208 || variants.length !== 208 || priceBySku.size !== 208) {
  throw new Error('pricing publication must contain exactly 208 unique SKUs');
}

const productValues = catalog.products.map((product) => `(${[
  sqlString(product.slug),
  sqlString(product.name),
  sqlString(product.group_key),
  sqlString(product.hmis),
  sqlString(product.mode),
  sqlBoolean(product.hazmat),
  sqlBoolean(product.taxable),
  sqlBoolean(product.active),
  sqlNumber(product.sort),
].join(', ')})`).join(',\n');

const variantValues = variants.map((variant) => `(${[
  sqlString(variant.sku),
  sqlString(variant.product_slug),
  sqlString(variant.label),
  sqlNumber(variant.size_gal),
  sqlString(variant.market),
  sqlString(variant.package_kind),
  sqlString(variant.marketing_name),
  sqlNumber(variant.units_per_case),
  sqlNullableString(variant.unit_sku),
  sqlBoolean(variant.active),
  sqlBoolean(variant.intended_active),
  sqlNullableString(variant.activation_blocker),
  sqlBoolean(variant.requires_quote),
  sqlNullableNumber(variant.shipping_weight_lb),
  sqlNullableNumber(variant.shipping_length_in),
  sqlNullableNumber(variant.shipping_width_in),
  sqlNullableNumber(variant.shipping_height_in),
  sqlString(variant.pricing_source_version),
  sqlNullableNumber(variant.retail_price),
  sqlNullableNumber(variant.minimum_checkout_price),
  sqlNumber(variant.sort),
].join(', ')})`).join(',\n');

const source = publication.source;
const sql = `-- VertKleen website publication replacement, reviewed 2026-08-24.
-- Source: ${source.file}
-- Version: ${source.version}
-- SHA-256: ${source.sha256}
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
${variantValues};

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
${productValues}
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
where sku not in (${catalog.products.map((product) => sqlString(product.slug)).join(', ')});

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
`;

process.stdout.write(sql);

function sqlString(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function sqlNullableString(value) {
  return value == null || value === '' ? 'null' : sqlString(value);
}

function sqlNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`invalid SQL number: ${value}`);
  return String(number);
}

function sqlNullableNumber(value) {
  return value == null || value === '' ? 'null' : sqlNumber(value);
}

function sqlBoolean(value) {
  return value === true ? 'true' : 'false';
}
