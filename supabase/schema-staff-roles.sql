-- Staff role tiers (#21). Apply in the Supabase SQL editor / pooler. Idempotent.
--
-- requireStaff() was binary: any platform-staff email could refund, change credit
-- limits, write products, and change member roles. This adds a per-staff role so
-- those capabilities can be narrowed (finance / support / read_only) while
-- ADMIN_EMAILS members and legacy is_staff rows keep full ('owner') access.
alter table public.profiles add column if not exists staff_role text;

alter table public.profiles drop constraint if exists profiles_staff_role_chk;
alter table public.profiles add constraint profiles_staff_role_chk
  check (staff_role is null or staff_role in ('owner', 'finance', 'support', 'read_only'));
