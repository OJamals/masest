-- Per-stream email suppression: split the global block into 'all' (hard bounce /
-- complaint → blocks everything) vs 'marketing' (unsubscribe → blocks only marketing,
-- so order/billing receipts still send). Adds a `stream` dimension + composite PK.
-- Idempotent. Safe on the existing (empty) table; default 'all' keeps any prior rows hard.

alter table public.email_suppressions add column if not exists stream text not null default 'all';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'email_suppressions_pkey'
      and conrelid = 'public.email_suppressions'::regclass
  ) then
    alter table public.email_suppressions drop constraint email_suppressions_pkey;
  end if;
  alter table public.email_suppressions add constraint email_suppressions_pkey primary key (email, stream);
end $$;
