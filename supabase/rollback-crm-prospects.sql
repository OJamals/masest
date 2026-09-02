-- Emergency down migration for the isolated Prospect domain.
-- Deliberately refuses to run unless the operator explicitly opts in for this
-- database session: SET masest.confirm_prospect_rollback = 'DROP';

begin;

do $$
begin
  if current_setting('masest.confirm_prospect_rollback', true) is distinct from 'DROP' then
    raise exception 'prospect_rollback_confirmation_required';
  end if;
end;
$$;

drop table if exists public.prospect_source_records;
drop table if exists public.prospect_contacts;
drop table if exists public.prospect_organizations;
drop table if exists public.prospect_import_batches;

commit;
