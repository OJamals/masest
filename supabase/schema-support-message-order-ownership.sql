-- Support messages may reference only orders owned by the same company.
-- Apply after the preflight below reports no mismatches. Idempotent.

do $$
begin
  if exists (
    select 1
    from public.messages m
    where m.order_id is not null
      and not exists (
        select 1
        from public.orders o
        where o.id = m.order_id
          and o.company_id = m.company_id
      )
  ) then
    raise exception 'support_message_order_company_mismatch'
      using errcode = '23514';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_id_company_id_key'
  ) then
    alter table public.orders
      add constraint orders_id_company_id_key unique (id, company_id);
  end if;
end $$;

alter table public.messages
  drop constraint if exists messages_order_id_fkey;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_order_company_fkey'
  ) then
    alter table public.messages
      add constraint messages_order_company_fkey
      foreign key (order_id, company_id)
      references public.orders (id, company_id)
      on delete set null (order_id);
  end if;
end $$;

create index if not exists messages_order_company_idx
  on public.messages(order_id, company_id)
  where order_id is not null;
