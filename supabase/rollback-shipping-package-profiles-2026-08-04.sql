-- Roll back only the exact inferred 2.5-gallon profile from the paired update.
update public.product_variants
set shipping_weight_lb = null,
    shipping_length_in = null,
    shipping_width_in = null,
    shipping_height_in = null
where vsku ~ '-2\.5G$'
  and shipping_weight_lb = 25
  and shipping_length_in = 10
  and shipping_width_in = 10
  and shipping_height_in = 15;
