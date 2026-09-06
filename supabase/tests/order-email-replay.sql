-- Disposable local proof; refuses any database except email_review.
-- psql -h /tmp/masest-email-pg-root/socket -p 55439 -d email_review -v ON_ERROR_STOP=1 -f supabase/tests/order-email-replay.sql
do $$ begin
  if current_database() <> 'email_review' or inet_server_addr() is not null then raise exception 'wrong database or non-local server'; end if;
end $$;
begin;
delete from public.integration_effects where event_id in (select id from public.integration_events where provider_event_id = 'return-label-email-se-return-order-email-proof');
delete from public.integration_events where provider_event_id = 'return-label-email-se-return-order-email-proof';
delete from public.order_provider_links where provider_object_id = 'se-outbound-order-email-proof';
delete from public.order_shipments where id = '00000000-0000-4000-8000-dddddddddddd';
delete from public.orders where id = '00000000-0000-4000-8000-eeeeeeeeeeee';
insert into public.orders (id, status, customer_email, currency, shipstation_label_id, shipstation_return_label_status, ship_address)
values ('00000000-0000-4000-8000-eeeeeeeeeeee', 'paid', 'proof@example.com', 'usd', 'se-outbound-order-email-proof', 'return_purchasing', '{"address":{"country":"US"}}'::jsonb);
insert into public.order_shipments (id, order_id, split_key, generation, revision, provider, external_shipment_id, status)
values ('00000000-0000-4000-8000-dddddddddddd', '00000000-0000-4000-8000-eeeeeeeeeeee', 'default', 0, 0, 'shipstation', 'se-shipment-order-email-proof', 'draft');
insert into public.order_provider_links (order_id, provider, object_type, provider_object_id, metadata)
values ('00000000-0000-4000-8000-eeeeeeeeeeee', 'shipstation', 'label', 'se-outbound-order-email-proof', '{"order_shipment_id":"00000000-0000-4000-8000-dddddddddddd"}'::jsonb);
commit;
begin;
select public.finalize_shipstation_return_label_with_email('00000000-0000-4000-8000-eeeeeeeeeeee', 'se-outbound-order-email-proof', 'se-return-order-email-proof', 9.87, 'usd', 'carrier_default', 'RET-PROOF', 'Customer requested return', 'https://labels.example/original.pdf');
commit;
create temp table order_email_replay_expected as
select id, occurred_at, metadata from public.integration_events
where provider_event_id = 'return-label-email-se-return-order-email-proof';
begin;
select public.finalize_shipstation_return_label_with_email('00000000-0000-4000-8000-eeeeeeeeeeee', 'se-outbound-order-email-proof', 'se-return-order-email-proof', 99.99, 'usd', 'carrier_default', 'RET-CHANGED', 'Changed retry request', 'https://labels.example/changed.pdf');
commit;
begin;
select public.finalize_shipstation_return_label_reconciliation_with_email('00000000-0000-4000-8000-eeeeeeeeeeee', 'se-outbound-order-email-proof', 'se-return-order-email-proof', 88.88, 'usd', 'carrier_default', 'RET-RECONCILE', 'Reconciliation retry', 'https://labels.example/reconcile.pdf');
commit;
do $$ declare n integer; m integer; v_metadata jsonb; expected record; begin
  select count(*) into n from public.integration_events where provider='masest' and environment_or_tenant='production' and provider_event_id='return-label-email-se-return-order-email-proof';
  select count(*) into m from public.integration_effects e join public.integration_events ev on ev.id=e.event_id where ev.provider_event_id='return-label-email-se-return-order-email-proof' and e.effect_key='return-label-email-se-return-order-email-proof';
  select ev.metadata into v_metadata from public.integration_events ev where ev.provider_event_id='return-label-email-se-return-order-email-proof';
  select * into expected from order_email_replay_expected;
  if n <> 1 or m <> 1 or v_metadata->>'label_url' <> 'https://labels.example/original.pdf' or v_metadata->>'cost' <> '9.87' or v_metadata->>'tracking_number' <> 'RET-PROOF' or (select occurred_at from public.integration_events where id=expected.id) is distinct from expected.occurred_at then raise exception 'replay proof failed %/% %', n, m, v_metadata; end if;
end $$;
do $$ begin
  begin
    perform public.enqueue_order_email_effect('return-label-email-se-return-order-email-proof', 'return_label_email', 'se-return-order-email-proof', 'return-label-email-se-return-order-email-proof', 'return_label_email', '00000000-0000-4000-8000-eeeeeeeeeeee', '{"order_id":"00000000-0000-4000-8000-eeeeeeeeeeee","changed":true}'::jsonb, '{}'::jsonb);
    raise exception 'changed payload unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%identity_collision%' then raise; end if;
  end;
end $$;
begin;
delete from public.integration_effects where event_id in (select id from public.integration_events where provider_event_id = 'return-label-email-se-return-order-email-proof');
delete from public.integration_events where provider_event_id = 'return-label-email-se-return-order-email-proof';
delete from public.order_provider_links where provider_object_id = 'se-outbound-order-email-proof';
delete from public.order_shipments where id = '00000000-0000-4000-8000-dddddddddddd';
delete from public.orders where id = '00000000-0000-4000-8000-eeeeeeeeeeee';
commit;
