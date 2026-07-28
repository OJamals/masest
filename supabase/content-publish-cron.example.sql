-- Scheduled CMS publish sweep. Replace <CONTENT_PUBLISH_CRON_SECRET> before applying;
-- keep it identical to the Cloudflare Pages environment variable.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('content-publish')
where exists (select 1 from cron.job where jobname = 'content-publish');

select cron.schedule(
  'content-publish',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://masest.co/api/admin/content',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-content-publish-cron-secret', '<CONTENT_PUBLISH_CRON_SECRET>'
    ),
    body := jsonb_build_object('action', 'publish_scheduled')
  );
  $$
);
