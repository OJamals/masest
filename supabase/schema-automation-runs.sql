-- Automation run ledger. Eight scheduled/secret-gated jobs run this site (content
-- publish, CRM task digest, review reminders, quote sweep, newsletter sweep, blog
-- newsletter, QBO sync, integration effects) and until now none of them recorded
-- that they ran. A cron that was never applied, whose secret drifted, or that
-- errors every night was indistinguishable from one working perfectly.
--
-- One row per run. The recorder is best-effort: a failure to write here must
-- never fail the sweep it is observing.
--
-- Additive + idempotent. Pooler-created tables need explicit service_role grants
-- (else inserts fail 42501). RLS on, no anon/authenticated policies (service-role
-- bypasses via grant), matching supabase/schema-crm.sql.

create table if not exists public.automation_runs (
  id           bigint generated always as identity primary key,
  job          text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  processed    integer not null default 0,
  error_code   text,
  detail       jsonb not null default '{}'::jsonb
);

-- The dashboard reads "latest run per job", so job + recency is the access path.
create index if not exists automation_runs_job_started_idx
  on public.automation_runs (job, started_at desc);

alter table public.automation_runs enable row level security;

grant all privileges on table public.automation_runs to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Latest run per job, for the Integrations "Automations" card. A job with no row
-- at all is the important case (never scheduled, or failing before it can even
-- record) — the admin API supplies the expected job list and treats a missing
-- row as "never run", so this view intentionally only covers jobs that have run.
create or replace view public.automation_run_latest as
select distinct on (job)
  job, started_at, finished_at, ok, processed, error_code
from public.automation_runs
order by job, started_at desc;

grant select on public.automation_run_latest to service_role;

-- Bounded retention: this is an operational signal, not an archive.
delete from public.automation_runs
where started_at < now() - interval '30 days';
