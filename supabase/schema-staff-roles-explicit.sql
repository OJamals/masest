-- Retire legacy owner-by-default role resolution without locking out existing staff.
-- Production preflight on 2026-08-30 found one legacy staff row with a null role.
-- Idempotent: preserve that established operator as owner, then require explicit roles.

update public.profiles
set staff_role = 'owner'
where is_staff is true
  and staff_role is null;

alter table public.profiles
  drop constraint if exists profiles_staff_role_required_for_staff_chk;

alter table public.profiles
  add constraint profiles_staff_role_required_for_staff_chk
  check (is_staff is not true or staff_role is not null);
