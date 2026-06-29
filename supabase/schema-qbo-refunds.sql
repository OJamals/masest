-- #22 — QBO credit memos for refunds.
-- A Stripe refund leaves the order's QBO Invoice(+Payment) standing, so the books
-- drift unless we post a reversing CreditMemo. Refunds get their OWN queue (not the
-- orders.qbo_* columns) because one order can have several partial refunds, each its
-- own CreditMemo. Mirrors the orders sync queue: pending → processing → synced/error
-- with capped backoff via nextSyncState(); the qbo-sync worker drains both.
-- Reuses the qbo_sync_status enum from schema-qbo.sql (run that first).

create table if not exists public.qbo_refunds (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id) on delete cascade,
  amount             numeric(12,2) not null,
  fully_refunded     boolean not null default false,
  qbo_sync_status    qbo_sync_status not null default 'pending',
  qbo_credit_memo_id text,
  qbo_attempts       int not null default 0,
  qbo_next_attempt_at timestamptz,
  qbo_error          text,
  created_at         timestamptz not null default now()
);

create index if not exists qbo_refunds_pending_idx
  on public.qbo_refunds (qbo_next_attempt_at)
  where qbo_sync_status in ('pending', 'error');

-- Same claim contract as claim_qbo_orders: atomically flip a batch to 'processing'
-- under FOR UPDATE SKIP LOCKED so concurrent workers never grab the same row.
create or replace function public.claim_qbo_refunds(batch int)
returns setof public.qbo_refunds
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.qbo_refunds r
  set qbo_sync_status = 'processing'
  where r.id in (
    select id
    from public.qbo_refunds
    where qbo_sync_status = 'pending'
      and (qbo_next_attempt_at is null or qbo_next_attempt_at <= now())
    order by created_at
    limit batch
    for update skip locked
  )
  returning r.*;
end
$$;

grant select, insert, update on public.qbo_refunds to service_role;
revoke all on function public.claim_qbo_refunds(int) from public;
grant execute on function public.claim_qbo_refunds(int) to service_role;
