-- RPC privilege hardening. Apply after all schema files that create SECURITY DEFINER
-- helper functions. PostgreSQL grants EXECUTE on new functions to PUBLIC by default;
-- these RPCs are internal service-role entry points and must not be callable through
-- Supabase REST by anon/authenticated browser roles.

revoke all on function public.admin_order_metrics() from public;
revoke all on function public.claim_qbo_orders(int) from public;
revoke all on function public.claim_qbo_refunds(int) from public;
revoke all on function public.create_company_address(uuid, address_type, text, text, text, text, text, boolean) from public;
revoke all on function public.decrement_variant_stock(text, integer) from public;
revoke all on function public.increment_variant_stock(text, integer) from public;
revoke all on function public.place_net_order(uuid, uuid, text, numeric, text) from public;
revoke all on function public.current_company_id() from public;

grant execute on function public.admin_order_metrics() to service_role;
grant execute on function public.claim_qbo_orders(int) to service_role;
grant execute on function public.claim_qbo_refunds(int) to service_role;
grant execute on function public.create_company_address(uuid, address_type, text, text, text, text, text, boolean) to service_role;
grant execute on function public.decrement_variant_stock(text, integer) to service_role;
grant execute on function public.increment_variant_stock(text, integer) to service_role;
grant execute on function public.place_net_order(uuid, uuid, text, numeric, text) to service_role;
grant execute on function public.current_company_id() to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public';
  end if;
end $$;

revoke all on table public.quotes from anon, authenticated;
grant all on table public.quotes to service_role;
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;
