-- Retire the deployed legacy support-message email producer before installing
-- migrate-support-message-delivery-effects-2026-09-06.sql. Keep the support
-- write fence closed between these separately committed migrations.
begin;

-- The table lock drains any legacy trigger transaction before its ledger state
-- is inspected. Completed/dead history is deliberately preserved unchanged.
lock table public.messages in share row exclusive mode;

do $$
begin
  if exists (
    select 1
      from public.integration_effects effect
      join public.integration_events event on event.id = effect.event_id
     where effect.effect_type = 'support_message_email'
       and event.provider_event_type = 'support_message_created'
       and effect.effect_key = 'support-email'
       and effect.status in ('pending', 'processing')
  ) then
    raise exception 'support_message_legacy_effects_nonterminal';
  end if;
end;
$$;

drop trigger if exists messages_support_email_effect on public.messages;
drop trigger if exists messages_support_alert_kind on public.messages;

commit;
