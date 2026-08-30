-- Bounded staff customer-directory search. The API resolves Auth email only for
-- IDs in the returned page; complete email enumeration remains CSV-export only.
create or replace function public.admin_customer_directory(
  p_search text default null,
  p_role text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  full_name text,
  phone text,
  role text,
  company_id uuid,
  company_name text,
  company_status text,
  price_tier text,
  net_terms_days integer,
  total_count bigint
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with matched as (
    select
      p.id,
      p.full_name,
      p.phone,
      p.role::text as role,
      p.company_id,
      c.name as company_name,
      c.status::text as company_status,
      coalesce(c.price_tier, 'retail')::text as price_tier,
      coalesce(c.net_terms_days, 0)::integer as net_terms_days
    from public.profiles p
    left join public.companies c on c.id = p.company_id
    where (p_role is null or p.role::text = p_role)
      and (
        nullif(btrim(p_search), '') is null
        or concat_ws(' ', p.full_name, p.phone, p.role::text, c.name, c.status::text)
          ilike '%' || btrim(p_search) || '%'
      )
  )
  select
    m.id,
    m.full_name,
    m.phone,
    m.role,
    m.company_id,
    m.company_name,
    m.company_status,
    m.price_tier,
    m.net_terms_days,
    count(*) over() as total_count
  from matched m
  order by lower(coalesce(m.company_name, '')), lower(coalesce(m.full_name, '')), m.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke all on function public.admin_customer_directory(text, text, integer, integer) from public;
grant execute on function public.admin_customer_directory(text, text, integer, integer) to service_role;
