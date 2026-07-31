-- CMS pricing authority.
-- Product retail/list prices and customer tier cells change atomically.
-- Service/program prices remain in their existing canonical tables.

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
begin
  if not exists (
    select 1 from public.product_variants where vsku = p_vsku
  ) then
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
