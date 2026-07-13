-- Atomic customer business creation. Apply before deploying the matching
-- Cloudflare Function. Requires supabase/schema-business-profile.sql.

create or replace function public.create_company_for_user(
  p_user_id uuid,
  p_company jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company public.companies%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_id_required' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_company->>'name', ''))) < 2 then
    raise exception 'company_name_required' using errcode = '22023';
  end if;

  insert into public.companies (
    name, status, tax_exempt, resale_cert_url,
    legal_name, dba, entity_type, tax_id, business_phone, business_email,
    website, industry, est_annual_volume, requested_net_terms,
    contact_name, contact_title, submitted_at
  ) values (
    trim(p_company->>'name'),
    'pending',
    coalesce((p_company->>'tax_exempt')::boolean, false),
    nullif(p_company->>'resale_cert_url', ''),
    nullif(p_company->>'legal_name', ''),
    nullif(p_company->>'dba', ''),
    nullif(p_company->>'entity_type', ''),
    nullif(p_company->>'tax_id', ''),
    nullif(p_company->>'business_phone', ''),
    nullif(p_company->>'business_email', ''),
    nullif(p_company->>'website', ''),
    nullif(p_company->>'industry', ''),
    nullif(p_company->>'est_annual_volume', ''),
    nullif(p_company->>'requested_net_terms', '')::int,
    nullif(p_company->>'contact_name', ''),
    nullif(p_company->>'contact_title', ''),
    coalesce(nullif(p_company->>'submitted_at', '')::timestamptz, now())
  )
  returning * into v_company;

  update public.profiles
  set company_id = v_company.id, role = 'admin'
  where id = p_user_id
    and company_id is null;

  if not found then
    raise exception 'profile_already_has_company' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'id', v_company.id,
    'name', v_company.name,
    'status', v_company.status,
    'tax_exempt', v_company.tax_exempt,
    'resale_cert_url', v_company.resale_cert_url
  );
end;
$$;

revoke all on function public.create_company_for_user(uuid, jsonb) from public;
grant execute on function public.create_company_for_user(uuid, jsonb) to service_role;
