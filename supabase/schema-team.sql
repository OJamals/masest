-- MASEST commerce — team / multi-user company accounts. ADDITIVE. Run after schema.sql + schema-phase5.sql.
-- A company admin (profiles.role='admin') can invite teammates by email. When an invited email
-- registers, it joins the inviter's company (role buyer) instead of creating a new company.

create table if not exists public.company_invites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  email       text not null,
  role        profile_role not null default 'buyer',
  status      text not null default 'pending',   -- pending | accepted | revoked
  invited_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists company_invites_email_idx   on public.company_invites (lower(email));
create index if not exists company_invites_company_idx  on public.company_invites (company_id);
-- One live invite per (company, email).
create unique index if not exists company_invites_unique_pending
  on public.company_invites (company_id, lower(email)) where status = 'pending';

alter table public.company_invites enable row level security;
drop policy if exists invites_company on public.company_invites;
create policy invites_company on public.company_invites
  for select to authenticated using (company_id = public.current_company_id());

grant select on public.company_invites to authenticated;
grant select, insert, update, delete on public.company_invites to service_role;
