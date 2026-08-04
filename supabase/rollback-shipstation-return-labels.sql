-- Roll back masest-042 return-label state. Existing outbound-label and finance
-- evidence remain intact. Run only after reverting the application release.
begin;

drop function if exists public.finalize_shipstation_return_label(uuid, text, text, numeric, text, text, text, text);
drop function if exists public.claim_shipstation_return_label(uuid, text);
drop function if exists public.finalize_shipstation_label_reconciliation(uuid, text, text, text, text, text, text, numeric, text, text, text, text, text, uuid, text, text);
drop index if exists public.orders_shipstation_return_label_uidx;
alter table public.orders drop constraint if exists orders_shipstation_return_status_check;
alter table public.orders drop constraint if exists orders_shipstation_return_currency_check;
alter table public.orders drop constraint if exists orders_shipstation_return_cost_nonnegative;
alter table public.orders drop column if exists shipstation_return_updated_at;
alter table public.orders drop column if exists shipstation_return_error;
alter table public.orders drop column if exists shipstation_return_tracking_number;
alter table public.orders drop column if exists shipstation_return_charge_event;
alter table public.orders drop column if exists shipstation_return_currency;
alter table public.orders drop column if exists shipstation_return_cost;
alter table public.orders drop column if exists shipstation_return_label_status;
alter table public.orders drop column if exists shipstation_return_label_id;

commit;
