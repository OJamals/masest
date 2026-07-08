-- Post-delivery review-reminder sweep schedule template.
-- Replace <REVIEW_CRM_SECRET> before applying. Keep it identical to the Cloudflare Pages
-- REVIEW_CRM_SECRET env var — /api/admin/review-reminders verifies it timing-safe.
--
-- What it does: every day at 15:00 UTC, POSTs { action:'sweep_due', batch:25 } to the
-- review-reminders endpoint, which emails a "how did it work out" nudge to buyers whose
-- order was delivered/fulfilled ≥10 days ago and have not yet been reminded (stamping
-- orders.review_reminded_at so each order is only ever reminded once). Without this
-- schedule the sweep only runs if something external calls it.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('review-reminder')
where exists (
  select 1 from cron.job where jobname = 'review-reminder'
);

select cron.schedule(
  'review-reminder',
  '0 15 * * *',
  $$
  select net.http_post(
    url := 'https://masest.co/api/admin/review-reminders',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-review-crm-secret', '<REVIEW_CRM_SECRET>'
    ),
    body := jsonb_build_object('action', 'sweep_due', 'batch', 25)
  );
  $$
);
