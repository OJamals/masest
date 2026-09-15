-- Apply only after the SES-only Worker and Pages routes are deployed.
-- The connector tables must remain empty; abort if new contacts/events arrived.
-- Historical schema-emailoctopus.sql remains the rollback source.
begin;

lock table public.emailoctopus_contacts, public.emailoctopus_events in access exclusive mode;
do $$
begin
  if exists (select 1 from public.emailoctopus_contacts)
    or exists (select 1 from public.emailoctopus_events) then
    raise exception 'emailoctopus_retirement_requires_empty_tables';
  end if;
end;
$$;

-- Auth deletion still withdraws marketing consent after the companion is gone.
create or replace function public.capture_marketing_account_erasure()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from public.newsletter_recipients
    where email = lower(btrim(old.email))
  ) then
    perform public.set_marketing_email_preferences(
      jsonb_build_array(old.email), false, 'account_erasure', null, null, '{}'
    );
  end if;
  return old;
end;
$$;
revoke all on function public.capture_marketing_account_erasure()
  from public, anon, authenticated;

drop trigger if exists emailoctopus_account_erasure_capture on auth.users;
drop trigger if exists marketing_account_erasure_capture on auth.users;
create trigger marketing_account_erasure_capture before delete on auth.users
  for each row execute function public.capture_marketing_account_erasure();
drop trigger if exists emailoctopus_erasure_capture on public.newsletter_recipients;
drop trigger if exists emailoctopus_consent_capture on public.marketing_consent_events;
drop trigger if exists emailoctopus_suppression_capture on public.email_suppressions;

drop function if exists public.queue_emailoctopus_contact(text, boolean, boolean);
drop function if exists public.capture_emailoctopus_consent();
drop function if exists public.capture_emailoctopus_suppression();
drop function if exists public.capture_emailoctopus_erasure();
drop function if exists public.bind_emailoctopus_list(uuid);
drop function if exists public.claim_emailoctopus_contact(uuid);
drop function if exists public.finish_emailoctopus_contact(text, uuid, bigint, boolean, boolean, boolean, text);
drop function if exists public.apply_emailoctopus_event(text, text, text);
drop function if exists public.emailoctopus_status();

drop table public.emailoctopus_contacts;
drop table public.emailoctopus_events;
drop table public.emailoctopus_connection;
commit;
