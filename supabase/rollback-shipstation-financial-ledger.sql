-- Roll back masest-040 while retaining pre-existing ShipStation order fields.
drop function if exists public.claim_shipstation_label_void(uuid, text);
drop function if exists public.finalize_shipstation_label_void(uuid, text, text, text, text);
drop function if exists public.record_order_financial_entry(uuid, text, text, text, numeric, text, text, text, text, jsonb);
drop trigger if exists order_financial_entries_immutable on public.order_financial_entries;
drop function if exists public.prevent_order_financial_entry_mutation();
drop table if exists public.order_financial_entries;

update public.orders
   set shipstation_label_status = case shipstation_label_status
     when 'label_voided' then 'voided'
     when 'label_void_failed' then 'reconcile_required'
     when 'void_reconcile_required' then 'reconcile_required'
     when 'voiding' then 'reconcile_required'
     else shipstation_label_status
   end
 where shipstation_label_status in (
   'label_voided', 'label_void_failed', 'void_reconcile_required', 'voiding'
 );

alter table public.orders drop constraint if exists orders_shipstation_label_status_check;
alter table public.orders add constraint orders_shipstation_label_status_check
  check (
    shipstation_label_status is null
    or shipstation_label_status in (
      'rated', 'purchasing', 'label_pending', 'label_purchased',
      'reconcile_required', 'voided'
    )
  );

create or replace function public.claim_shipstation_label_purchase(
  p_order_id uuid,
  p_rate_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed uuid;
begin
  if p_rate_id is null or p_rate_id !~ '^se-[A-Za-z0-9_-]+$' then
    return false;
  end if;

  update public.orders
     set shipstation_label_status = 'purchasing',
         shipstation_rate_id = p_rate_id,
         shipstation_error = null,
         shipstation_updated_at = now()
   where id = p_order_id
     and status::text in ('paid', 'net_open', 'net_paid', 'fulfilled')
     and shipstation_shipment_id is not null
     and shipstation_label_id is null
     and shipstation_label_status is distinct from 'purchasing'
     and shipstation_label_status is distinct from 'reconcile_required'
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;
revoke all on function public.claim_shipstation_label_purchase(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_shipstation_label_purchase(uuid, text) to service_role;
