-- Reversible support-ingress fence. Install before support ticket migration 039.
-- The CREATE TRIGGER table lock drains message transactions that predate the
-- fence. After installation, the singleton row is the only lock protocol.
begin;

create table if not exists public.support_ingress_control (
  singleton boolean primary key default true check (singleton),
  accepting boolean not null default true,
  generation bigint not null default 1 check (generation >= 1),
  reason text,
  updated_at timestamptz not null default now(),
  constraint support_ingress_reason_check check (
    reason is null or (reason = btrim(reason) and char_length(reason) between 1 and 240)
  )
);

insert into public.support_ingress_control (singleton, accepting, generation)
values (true, true, 1)
on conflict (singleton) do nothing;

alter table public.support_ingress_control enable row level security;
revoke all on table public.support_ingress_control
  from public, anon, authenticated, service_role;

create or replace function public.assert_support_writes_enabled()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_accepting boolean;
begin
  select accepting into v_accepting
    from public.support_ingress_control
   where singleton = true
   for share;
  if not found or v_accepting is distinct from true then
    raise exception 'support_writes_paused';
  end if;
  return true;
end;
$$;

create or replace function public.guard_support_message_ingress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_support_writes_enabled();
  return new;
end;
$$;

-- DDL takes the one-time table lock that drains pre-fence message writers.
drop trigger if exists messages_support_ingress_fence on public.messages;
create trigger messages_support_ingress_fence
before insert on public.messages
for each row execute function public.guard_support_message_ingress();

create or replace function public.set_support_ingress_accepting(
  p_expected_generation bigint,
  p_accepting boolean,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.support_ingress_control%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_expected_generation is null or p_accepting is null then
    raise exception 'invalid_support_ingress_transition';
  end if;
  if p_accepting is false and (v_reason is null or char_length(v_reason) > 240) then
    raise exception 'support_ingress_reason_required';
  end if;

  select * into v_control
    from public.support_ingress_control
   where singleton = true
   for update;
  if not found then
    raise exception 'support_ingress_control_missing';
  end if;
  if v_control.generation <> p_expected_generation then
    raise exception 'support_ingress_generation_conflict';
  end if;

  update public.support_ingress_control
     set accepting = p_accepting,
         generation = generation + 1,
         reason = case when p_accepting then null else v_reason end,
         updated_at = now()
   where singleton = true
   returning * into v_control;

  return jsonb_build_object(
    'accepting', v_control.accepting,
    'generation', v_control.generation,
    'reason', v_control.reason,
    'updated_at', v_control.updated_at
  );
end;
$$;

revoke all on function public.assert_support_writes_enabled()
  from public, anon, authenticated;
grant execute on function public.assert_support_writes_enabled() to service_role;

revoke all on function public.guard_support_message_ingress()
  from public, anon, authenticated, service_role;
revoke all on function public.set_support_ingress_accepting(bigint, boolean, text)
  from public, anon, authenticated, service_role;

commit;
