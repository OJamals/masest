-- Move existing scheduler command to generic route without exposing or replacing secret.
-- Apply after generic runtime deploy, before dropping Stripe-only DB objects.

do $$
declare
  v_command text;
  v_schedule text;
  v_generic_command text;
begin
  select command, schedule
    into v_command, v_schedule
    from cron.job
   where jobname = 'stripe-effects';

  if v_command is null then
    if exists (select 1 from cron.job where jobname = 'integration-effects') then
      return;
    end if;
    raise exception 'stripe_effects_cron_missing';
  end if;
  if position('/api/admin/stripe-effects' in v_command) = 0
     or position('x-stripe-effects-secret' in v_command) = 0 then
    raise exception 'stripe_effects_cron_shape_mismatch';
  end if;

  v_generic_command := replace(
    replace(v_command, '/api/admin/stripe-effects', '/api/admin/integration-effects'),
    'x-stripe-effects-secret',
    'x-integration-effects-secret'
  );

  perform cron.unschedule('integration-effects')
   where exists (select 1 from cron.job where jobname = 'integration-effects');
  perform cron.schedule('integration-effects', v_schedule, v_generic_command);
  perform cron.unschedule('stripe-effects');
end;
$$;
