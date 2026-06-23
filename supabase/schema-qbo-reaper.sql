-- #26 — reaper for stuck QBO sync rows.
-- claim_qbo_orders/claim_qbo_refunds flip rows to 'processing' under FOR UPDATE SKIP
-- LOCKED, but if the worker dies mid-batch the row stays 'processing' forever — the old
-- claim only looked at 'pending', so it was orphaned. Fix: treat qbo_next_attempt_at as
-- a visibility-timeout lease (SQS-style). On claim, stamp it now()+15min; a row is
-- claimable when its lease has expired, whether it's 'pending' (retry backoff elapsed)
-- or 'processing' (worker died, lease elapsed). markSynced clears it on success; a
-- handled failure resets it to a fresh backoff. No separate reaper job needed.
-- Run after schema-qbo.sql and schema-qbo-refunds.sql.

create or replace function public.claim_qbo_orders(batch int)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.orders o
  set qbo_sync_status = 'processing',
      qbo_next_attempt_at = now() + interval '15 minutes'
  where o.id in (
    select id
    from public.orders
    where qbo_sync_status in ('pending', 'processing')
      and (qbo_next_attempt_at is null or qbo_next_attempt_at <= now())
    order by created_at
    limit batch
    for update skip locked
  )
  returning o.*;
end
$$;

create or replace function public.claim_qbo_refunds(batch int)
returns setof public.qbo_refunds
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.qbo_refunds r
  set qbo_sync_status = 'processing',
      qbo_next_attempt_at = now() + interval '15 minutes'
  where r.id in (
    select id
    from public.qbo_refunds
    where qbo_sync_status in ('pending', 'processing')
      and (qbo_next_attempt_at is null or qbo_next_attempt_at <= now())
    order by created_at
    limit batch
    for update skip locked
  )
  returning r.*;
end
$$;

grant execute on function public.claim_qbo_orders(int) to service_role;
grant execute on function public.claim_qbo_refunds(int) to service_role;
