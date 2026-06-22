-- Admin audit log (issue #20). Apply in the Supabase SQL editor. Idempotent.
--
-- Immutable trail of staff mutations (role grants, account approvals/terms, refunds, …)
-- so there is a record of which staff did what. Written best-effort by _lib/audit.js
-- from the service-role client; never exposed to anon/authenticated clients.
create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  actor_user_id uuid,
  actor_email   text,
  action        text not null,
  target_type   text,
  target_id     text,
  detail        jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_action_idx  on public.audit_log (action);

-- RLS on with no anon/authenticated policies => clients cannot read or write it.
-- The service-role client (CF Functions) bypasses RLS but still needs table privileges.
alter table public.audit_log enable row level security;
grant select, insert on public.audit_log to service_role;
