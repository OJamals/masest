-- MASEST commerce — privilege GRANTS. Run AFTER schema.sql (and seed). Safe to re-run.
-- Symptom this fixes: "permission denied for table ..." even with the correct service_role key.
-- Cause: Supabase normally auto-grants to its roles via default privileges; that did not happen
-- for these tables, so the roles have no table access. service_role bypasses RLS but still needs
-- table-level GRANTs; without them it is denied like anyone else.

-- service_role powers every serverless function (bypasses RLS, but needs table privileges).
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- Browser roles. RLS policies still govern WHICH ROWS each can see.
grant usage on schema public to anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.companies, public.profiles, public.addresses,
                public.orders, public.order_items to authenticated;
grant insert, update on public.addresses to authenticated;
