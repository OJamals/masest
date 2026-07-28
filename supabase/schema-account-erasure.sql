-- Account erasure transaction boundary.
-- Apply this migration before declaring account deletion operational. The API readiness
-- check intentionally fails closed until this SQL has been applied successfully.

begin;

create or replace function public.pseudonymize_orders_before_account_erasure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.orders
  where user_id = old.id
    and status = 'cart';

  update public.orders
  set
    user_id = null,
    customer_email = 'anon-' || old.id::text || '@deleted.invalid'
  where user_id = old.id;

  return old;
end;
$$;

revoke all on function public.pseudonymize_orders_before_account_erasure()
from public, anon, authenticated;

drop trigger if exists account_erasure_before_auth_delete on auth.users;
create trigger account_erasure_before_auth_delete
before delete on auth.users
for each row
execute function public.pseudonymize_orders_before_account_erasure();

create or replace function public.account_erasure_ready()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select true;
$$;

revoke all on function public.account_erasure_ready()
from public, anon, authenticated;
grant execute on function public.account_erasure_ready() to service_role;

commit;
