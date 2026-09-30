-- Apply before the lead-acquisition application release. Additive and repeatable.
-- Public intake never writes this staff-owned flag. Existing RLS/grants stay intact.
alter table public.quotes
  add column if not exists reporting_excluded boolean not null default false;

comment on column public.quotes.reporting_excluded is
  'Staff marks an internal/test inquiry to exclude it from acquisition reporting without deleting the lead.';

notify pgrst, 'reload schema';
