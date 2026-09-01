-- Repair the live inbound-email RPC without replaying the broader support schema.
-- PostgreSQL ARE repetition bounds cannot exceed 255. Preserve the existing
-- 510-character Message-ID allowance by composing two legal adjacent bounds.

begin;

do $migration$
declare
  v_function oid := to_regprocedure(
    'public.upsert_email_inbound_message(uuid,uuid,text,text,text,uuid,uuid,text)'
  )::oid;
  v_definition text;
  v_old_pattern constant text := '^(<[^<>[:space:]]{1,510}>)([[:space:]]+<[^<>[:space:]]{1,510}>)*$';
  v_new_pattern constant text := '^(<[^<>[:space:]]{1,255}[^<>[:space:]]{0,255}>)([[:space:]]+<[^<>[:space:]]{1,255}[^<>[:space:]]{0,255}>)*$';
begin
  if v_function is null then
    raise exception 'email_inbound_upsert_missing';
  end if;

  select pg_get_functiondef(v_function) into v_definition;
  if position(v_new_pattern in v_definition) > 0
     and position(v_old_pattern in v_definition) = 0 then
    return;
  end if;
  if position(v_old_pattern in v_definition) = 0 then
    raise exception 'unexpected_email_inbound_reference_regex';
  end if;

  execute replace(v_definition, v_old_pattern, v_new_pattern);
  select pg_get_functiondef(v_function) into v_definition;
  if position(v_new_pattern in v_definition) = 0
     or position(v_old_pattern in v_definition) > 0 then
    raise exception 'email_inbound_reference_regex_migration_failed';
  end if;
end;
$migration$;

revoke all on function public.upsert_email_inbound_message(uuid, uuid, text, text, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.upsert_email_inbound_message(uuid, uuid, text, text, text, uuid, uuid, text)
  to service_role;

commit;
