-- Stripe webhook side-effect worker schedule template.
-- Replace <STRIPE_EFFECTS_WORKER_SECRET> before applying. Keep this value
-- identical to Cloudflare Pages STRIPE_EFFECTS_WORKER_SECRET.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('stripe-effects')
where exists (
  select 1 from cron.job where jobname = 'stripe-effects'
);

select cron.schedule(
  'stripe-effects',
  '*/1 * * * *',
  $$
  select net.http_post(
    url := 'https://masest.co/api/admin/stripe-effects?limit=25',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-stripe-effects-secret', '<STRIPE_EFFECTS_WORKER_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
