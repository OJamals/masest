-- Rollback step 2: first reapply supabase/schema-emailoctopus.sql.
-- Both steps are needed before rolling Worker/Pages code back to EmailOctopus.
begin;
do $$
begin
  if to_regclass('public.emailoctopus_contacts') is null then
    raise exception 'restore_emailoctopus_schema_first';
  end if;
end;
$$;
drop trigger if exists marketing_account_erasure_capture on auth.users;
drop function if exists public.capture_marketing_account_erasure();
commit;
