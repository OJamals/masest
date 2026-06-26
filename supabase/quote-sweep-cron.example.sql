-- Due-quote follow-up sweep schedule template.
-- Replace <QUOTE_CRM_SECRET> before applying. Keep this value identical to the
-- Cloudflare Pages QUOTE_CRM_SECRET environment variable — the /api/admin/quotes
-- handler verifies it directly (timing-safe) against that env var, so unlike the
-- QBO template there is NO settings table to seed.
--
-- What it does: every 15 min, POSTs { action:'sweep_due', batch:10 } to the quotes
-- endpoint, which emails buyer reminders / staff alerts for follow-ups whose due_at
-- has passed and advances each lead's next due date. Without this schedule the sweep
-- only runs if something external calls it.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('quote-sweep')
where exists (
  select 1 from cron.job where jobname = 'quote-sweep'
);

select cron.schedule(
  'quote-sweep',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://masest.co/api/admin/quotes',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-quote-crm-secret', '<QUOTE_CRM_SECRET>'
    ),
    body := jsonb_build_object('action', 'sweep_due', 'batch', 10)
  );
  $$
);
