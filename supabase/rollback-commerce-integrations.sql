-- Destructive rollback for schema-commerce-integrations.sql.
begin;

drop trigger if exists order_provider_links_identity_immutable on public.order_provider_links;
drop function if exists public.link_order_provider_object(uuid, text, text, text, jsonb);
drop function if exists public.prevent_order_provider_link_identity_change();
drop table if exists public.order_provider_links;

drop trigger if exists orders_order_number_immutable on public.orders;
drop function if exists public.prevent_order_number_change();
alter table public.orders drop constraint if exists orders_order_number_format_chk;
drop index if exists public.orders_order_number_uidx;
alter table public.orders drop column if exists order_number;
drop function if exists public.next_order_number();
drop sequence if exists public.masest_order_number_seq;

commit;
