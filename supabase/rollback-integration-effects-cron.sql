-- Restore legacy scheduler route/header while preserving existing worker secret.
-- Apply after rollback-integration-effects-cutover.sql and before old runtime deploy.

do $$
declare
  v_command text;
  v_schedule text;
  v_legacy_command text;
begin
  select command, schedule
    into v_command, v_schedule
    from cron.job
   where jobname = 'integration-effects';

  if v_command is null then
    if exists (select 1 from cron.job where jobname = 'stripe-effects') then
      return;
    end if;
    raise exception 'integration_effects_cron_missing';
  end if;
  if position('/api/admin/integration-effects' in v_command) = 0
     or position('x-integration-effects-secret' in v_command) = 0 then
    raise exception 'integration_effects_cron_shape_mismatch';
  end if;

  v_legacy_command := replace(
    replace(v_command, '/api/admin/integration-effects', '/api/admin/stripe-effects'),
    'x-integration-effects-secret',
    'x-stripe-effects-secret'
  );

  perform cron.unschedule('stripe-effects')
   where exists (select 1 from cron.job where jobname = 'stripe-effects');
  perform cron.schedule('stripe-effects', v_schedule, v_legacy_command);
  perform cron.unschedule('integration-effects');
end;
$$;
