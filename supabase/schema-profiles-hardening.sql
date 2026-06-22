-- Profiles RLS hardening (issue #11). Apply in the Supabase SQL editor. Idempotent.
--
-- requireStaff() trusts profiles.is_staff = true as a platform-staff signal, and the
-- companies update policy trusts role = 'admin' as company-admin. The self-update policy
-- previously had only a USING clause and no WITH CHECK, so its safety depended entirely
-- on authenticated having no UPDATE grant on profiles. Add a WITH CHECK so a self-update
-- can never produce an is_staff/admin row — the protection no longer hinges on the grant.
--
-- Note: staff/admin profile management runs through the service-role client (bypasses
-- RLS), so this does not restrict any legitimate flow.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and is_staff is not true
    and (role is null or role <> 'admin')
  );
