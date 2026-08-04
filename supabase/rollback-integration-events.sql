-- Roll back additive generic integration ledger from schema-integration-events.sql.
-- Legacy stripe_webhook_effects and all Stripe-specific RPCs remain untouched.

drop function if exists public.ingest_integration_event(
  text, text, text, text, text, timestamptz, timestamptz, text, jsonb, jsonb
);
drop function if exists public.claim_integration_effects(text, integer, integer);
drop function if exists public.record_integration_effect_success(uuid, text, jsonb);
drop function if exists public.complete_integration_effect(uuid, text);
drop function if exists public.fail_integration_effect(uuid, text, text, integer, integer);
drop function if exists public.replay_integration_effect(uuid, text, text);
drop function if exists public.refresh_integration_event_state(uuid);

drop table if exists public.integration_attempts;
drop table if exists public.integration_effects;
drop table if exists public.integration_events;

drop function if exists public.integration_attempts_append_only();
drop function if exists public.touch_integration_updated_at();
drop function if exists public.guard_integration_effect_identity();
drop function if exists public.guard_integration_event_identity();
drop function if exists public.integration_json_has_forbidden_key(jsonb);
