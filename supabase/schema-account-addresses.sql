-- Account address safety helpers. Apply in Supabase SQL editor. Idempotent.
--
-- create_company_address() keeps "set default + insert address" in one database
-- transaction so a failed insert cannot leave a company without its previous
-- default address. Cloudflare Functions call it through the service-role client.

create or replace function public.create_company_address(
  p_company_id uuid,
  p_type address_type,
  p_line1 text,
  p_line2 text,
  p_city text,
  p_state text,
  p_zip text,
  p_is_default boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_is_default then
    update public.addresses
    set is_default = false
    where company_id = p_company_id
      and type = p_type;
  end if;

  insert into public.addresses (
    company_id,
    type,
    line1,
    line2,
    city,
    state,
    zip,
    country,
    is_default
  ) values (
    p_company_id,
    p_type,
    p_line1,
    nullif(p_line2, ''),
    p_city,
    p_state,
    p_zip,
    'US',
    p_is_default
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_company_address(uuid, address_type, text, text, text, text, text, boolean) to service_role;
