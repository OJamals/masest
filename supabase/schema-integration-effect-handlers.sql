-- Atomic local handlers for generic integration effects.
-- Apply after schema-integration-events.sql and before runtime cutover.

create or replace function public.apply_integration_stock_effect(
  p_effect_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.integration_effects%rowtype;
  v_order_id uuid;
  v_order_status public.order_status;
  v_line record;
  v_applied boolean;
  v_shorted text[] := array[]::text[];
  v_result jsonb;
begin
  select *
    into v_effect
    from public.integration_effects
   where id = p_effect_id
   for update;

  if not found
     or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'stock_decrement' then
    raise exception 'invalid_stock_effect_lease';
  end if;

  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{"shorted_skus":[]}'::jsonb);
  end if;

  begin
    v_order_id := nullif(v_effect.payload ->> 'order_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_stock_effect_order';
  end;
  if v_order_id is null then
    raise exception 'invalid_stock_effect_order';
  end if;

  select status
    into v_order_status
    from public.orders
   where id = v_order_id;
  if not found then
    raise exception 'invalid_stock_effect_order';
  end if;
  if v_order_status in ('cancelled', 'refunded') then
    v_result := jsonb_build_object(
      'shorted_skus', '[]'::jsonb,
      'skipped', 'order_terminal'
    );
    update public.integration_effects
       set provider_succeeded_at = now(),
           provider_result = v_result
     where id = p_effect_id;
    insert into public.integration_attempts (
      effect_id, attempt_number, action, outcome, worker_id, finished_at
    ) values (
      v_effect.id, v_effect.attempt_count, 'provider_succeeded', 'succeeded', p_worker_id, now()
    );
    return v_result;
  end if;

  for v_line in
    select item.sku, item.qty
      from public.order_items as item
     where item.order_id = v_order_id
       and item.sku is not null
       and item.qty > 0
       and coalesce(item.backordered, false) is false
     order by item.id
  loop
    select public.decrement_variant_stock(v_line.sku, v_line.qty)
      into v_applied;
    if v_applied is distinct from true then
      v_shorted := array_append(v_shorted, v_line.sku);
    end if;
  end loop;

  v_result := jsonb_build_object('shorted_skus', to_jsonb(v_shorted));
  update public.integration_effects
     set provider_succeeded_at = now(),
         provider_result = v_result
   where id = p_effect_id;
  insert into public.integration_attempts (
    effect_id, attempt_number, action, outcome, worker_id, finished_at
  ) values (
    v_effect.id, v_effect.attempt_count, 'provider_succeeded', 'succeeded', p_worker_id, now()
  );
  return v_result;
end;
$$;

create or replace function public.deliver_integration_notification_effect(
  p_effect_id uuid,
  p_worker_id text,
  p_notification jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.integration_effects%rowtype;
  v_order_id uuid;
  v_order_status public.order_status;
  v_company_id uuid;
  v_type text;
  v_title text;
  v_body text;
  v_link text;
begin
  select *
    into v_effect
    from public.integration_effects
   where id = p_effect_id
   for update;

  if not found
     or v_effect.status <> 'processing'
     or v_effect.lease_owner is distinct from p_worker_id
     or v_effect.effect_type <> 'company_notification' then
    raise exception 'invalid_notification_effect_lease';
  end if;

  if v_effect.provider_succeeded_at is not null then
    return coalesce(v_effect.provider_result, '{}'::jsonb);
  end if;

  if v_effect.payload ->> 'kind' in ('order_received', 'payment_cleared') then
    begin
      v_order_id := nullif(v_effect.payload ->> 'order_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_notification_effect_order';
    end;
    if v_order_id is null then
      raise exception 'invalid_notification_effect_order';
    end if;
    select status
      into v_order_status
      from public.orders
     where id = v_order_id;
    if not found then
      raise exception 'invalid_notification_effect_order';
    end if;
    if v_order_status in ('cancelled', 'refunded') then
      update public.integration_effects
         set provider_succeeded_at = now(),
             provider_result = jsonb_build_object('skipped', 'order_terminal')
       where id = p_effect_id;
      insert into public.integration_attempts (
        effect_id, attempt_number, action, outcome, worker_id, finished_at
      ) values (
        v_effect.id, v_effect.attempt_count, 'provider_succeeded', 'succeeded', p_worker_id, now()
      );
      return jsonb_build_object('skipped', 'order_terminal');
    end if;
  end if;

  if jsonb_typeof(p_notification) <> 'object' then
    raise exception 'invalid_notification';
  end if;
  begin
    v_company_id := nullif(p_notification ->> 'company_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_notification';
  end;
  v_type := p_notification ->> 'type';
  v_title := btrim(coalesce(p_notification ->> 'title', ''));
  v_body := btrim(coalesce(p_notification ->> 'body', ''));
  v_link := btrim(coalesce(p_notification ->> 'link', ''));
  if v_company_id is null
     or v_type is null
     or v_type not in ('order', 'offer', 'account')
     or v_title = ''
     or char_length(v_title) > 160
     or v_body = ''
     or char_length(v_body) > 500
     or v_link = ''
     or char_length(v_link) > 500 then
    raise exception 'invalid_notification';
  end if;

  insert into public.notifications (company_id, type, title, body, link)
  values (v_company_id, v_type::public.notification_type, v_title, v_body, v_link);

  update public.integration_effects
     set provider_succeeded_at = now(),
         provider_result = '{"inserted":true}'::jsonb
   where id = p_effect_id;
  insert into public.integration_attempts (
    effect_id, attempt_number, action, outcome, worker_id, finished_at
  ) values (
    v_effect.id, v_effect.attempt_count, 'provider_succeeded', 'succeeded', p_worker_id, now()
  );
  return jsonb_build_object('inserted', true);
end;
$$;

revoke all on function public.apply_integration_stock_effect(uuid, text) from public;
revoke all on function public.deliver_integration_notification_effect(uuid, text, jsonb) from public;
revoke execute on function public.apply_integration_stock_effect(uuid, text) from anon, authenticated;
revoke execute on function public.deliver_integration_notification_effect(uuid, text, jsonb) from anon, authenticated;
grant execute on function public.apply_integration_stock_effect(uuid, text) to service_role;
grant execute on function public.deliver_integration_notification_effect(uuid, text, jsonb) to service_role;
