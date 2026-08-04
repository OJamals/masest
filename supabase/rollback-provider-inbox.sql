-- Data-preserving rollback for schema-provider-inbox.sql.
-- Deploy runtime commit 4657c78b first. Audit/history tables and additive columns stay
-- intact; only new intake/projection entry points are disabled.

do $$
begin
  if exists (
    select 1
      from public.integration_effects effect
      join public.integration_events event on event.id = effect.event_id
     where event.provider in ('shipstation', 'resend', 'quickbooks')
       and effect.status in ('pending', 'processing')
  ) then
    raise exception 'provider_inbox_rollback_pending_effects';
  end if;
end;
$$;

drop function if exists public.apply_shipstation_tracking_integration_effect(uuid, text);
drop function if exists public.apply_resend_delivery_integration_effect(uuid, text);
drop function if exists public.apply_qbo_change_integration_effect(uuid, text);
drop function if exists public.upsert_resend_inbound_message(uuid, uuid, text, text);
drop function if exists public.provider_integration_dead_letters(text, integer, timestamptz, uuid);
drop function if exists public.provider_integration_health();
drop function if exists public.finish_integration_projection(uuid, text, jsonb);
drop function if exists public.ingest_qbo_provider_events(timestamptz, text, jsonb);
drop function if exists public.ingest_provider_event(
  text, text, text, text, text, timestamptz, timestamptz, text, jsonb, jsonb, text
);
