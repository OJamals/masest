-- Make buyer-to-staff support email automatic by default. This one-time migration
-- upgrades existing staff from the legacy opt-in defaults; staff can still opt out
-- afterward in Customer Support settings. Active-inbox presence suppression remains.

begin;

alter table public.profiles
  alter column notify_admin_support_requests set default true;
alter table public.profiles
  alter column notify_admin_messages set default true;

update public.profiles
set notify_admin_support_requests = true,
    notify_admin_messages = true
where is_staff = true
  and (
    notify_admin_support_requests = false
    or notify_admin_messages = false
  );

commit;
