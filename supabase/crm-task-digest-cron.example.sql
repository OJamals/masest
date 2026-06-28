-- CRM overdue task digest schedule template.
-- Replace <QUOTE_CRM_SECRET> before applying. Keep this value identical to the
-- Cloudflare Pages QUOTE_CRM_SECRET environment variable — the /api/admin/crm/tasks
-- handler verifies it directly (timing-safe) against that env var. This reuses the
-- SAME secret as the quote sweep cron (supabase/quote-sweep-cron.example.sql);
-- no new secret or env var is needed (owner applies this SQL once).
--
-- What it does: daily at 13:00 UTC (≈ 9am ET), POSTs { action:'sweep_due' } to the
-- CRM tasks endpoint. The handler emails each assignee their overdue open tasks as a
-- digest; unassigned/non-email tasks go to ADMIN_EMAILS. This is a stateless digest —
-- no crm_tasks rows are mutated (a task stays overdue until completed; re-send
-- frequency is controlled entirely by the cron schedule, not row state).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('crm-task-digest')
where exists (
  select 1 from cron.job where jobname = 'crm-task-digest'
);

select cron.schedule(
  'crm-task-digest',
  '0 13 * * *',
  $$
  select net.http_post(
    url := 'https://masest.co/api/admin/crm/tasks',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-quote-crm-secret', '<QUOTE_CRM_SECRET>'
    ),
    body := jsonb_build_object('action', 'sweep_due')
  );
  $$
);
