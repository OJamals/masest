-- Fill the active 2.5-gallon parcel class that was left unrated.
-- Values deliberately overestimate a typical filled jug and packing clearance.
begin;

update public.product_variants
set shipping_weight_lb = 25,
    shipping_length_in = 10,
    shipping_width_in = 10,
    shipping_height_in = 15
where vsku ~ '-2\.5G$'
  and shipping_weight_lb is null
  and shipping_length_in is null
  and shipping_width_in is null
  and shipping_height_in is null;

do $$
begin
  if exists (
    select 1
    from public.product_variants variant
    join public.products product on product.sku = variant.product_sku
    where variant.active = true
      and product.active = true
      and product.mode = 'buy'
      and (
        variant.shipping_weight_lb is null
        or variant.shipping_length_in is null
        or variant.shipping_width_in is null
        or variant.shipping_height_in is null
      )
  ) then
    raise exception 'active_buy_variant_missing_shipping_profile';
  end if;
end;
$$;

commit;
