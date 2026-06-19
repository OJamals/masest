-- QBO auto-sync schedule template.
-- Replace <QBO_SYNC_SECRET> before applying. Keep this value identical to the
-- Cloudflare Pages QBO_SYNC_SECRET environment variable.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

insert into public.qbo_sync_settings (id, secret_sha256, updated_at)
values (1, encode(extensions.digest('<QBO_SYNC_SECRET>', 'sha256'), 'hex'), now())
on conflict (id) do update
set secret_sha256 = excluded.secret_sha256,
    updated_at = excluded.updated_at;

select cron.unschedule('qbo-sync')
where exists (
  select 1 from cron.job where jobname = 'qbo-sync'
);

select cron.schedule(
  'qbo-sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://masest.co/api/qbo-sync?batch=10',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-qbo-sync-secret', '<QBO_SYNC_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
