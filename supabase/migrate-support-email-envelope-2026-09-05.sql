begin;

alter table public.integration_effects
  add column if not exists delivery_request jsonb;

create or replace function public.prepare_support_email_delivery(
  p_message_id uuid,
  p_envelope jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect_id uuid;
  v_existing jsonb;
begin
  if p_message_id is null or p_envelope is null or jsonb_typeof(p_envelope) <> 'object'
      or p_envelope->>'message_id' is distinct from p_message_id::text then
    raise exception 'support_email_envelope_invalid';
  end if;
  select e.id, e.delivery_request into v_effect_id, v_existing
    from public.integration_effects e
    join public.integration_events ev on ev.id = e.event_id
    where e.effect_type = 'support_message_email'
      and e.effect_key = 'support-email'
      and ev.provider = 'masest'
      and ev.environment_or_tenant = 'production'
      and ev.provider_event_type = 'support_message_created'
      and ev.provider_event_id = 'support-message-' || p_message_id::text
      and ev.provider_object_id = p_message_id::text
      and e.payload->>'message_id' = p_message_id::text
    order by e.created_at, e.id
    limit 1
    for update of e;
  if not found then raise exception 'support_email_effect_not_found'; end if;
  if v_existing is not null then return v_existing; end if;
  update public.integration_effects
    set delivery_request = p_envelope
    where id = v_effect_id
      and delivery_request is null
    returning delivery_request into v_existing;
  return v_existing;
end;
$$;

revoke all on function public.prepare_support_email_delivery(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.prepare_support_email_delivery(uuid,jsonb) to service_role;

commit;
