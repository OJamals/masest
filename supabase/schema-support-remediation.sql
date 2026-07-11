-- Durable customer-support lifecycle, summaries, and expiring presence.
-- Additive/idempotent. Safe after schema-phase5.sql.

alter table public.profiles add column if not exists support_chat_seen_at timestamptz;
alter table public.profiles add column if not exists support_inbox_seen_at timestamptz;

alter table public.companies add column if not exists support_thread_status text not null default 'open';
alter table public.companies drop constraint if exists companies_support_thread_status_check;
alter table public.companies add constraint companies_support_thread_status_check
  check (support_thread_status in ('open', 'escalated', 'complete'));
alter table public.companies add column if not exists support_thread_completed_at timestamptz;
alter table public.companies add column if not exists support_thread_completed_by uuid references public.profiles(id) on delete set null;
alter table public.companies add column if not exists support_last_message_at timestamptz;
alter table public.companies add column if not exists support_last_message_body text;
alter table public.companies add column if not exists support_last_sender_role text;

with latest as (
  select distinct on (company_id) company_id, sender_role::text, body, created_at
  from public.messages
  order by company_id, created_at desc
)
update public.companies as company
set support_last_message_at = latest.created_at,
    support_last_message_body = latest.body,
    support_last_sender_role = latest.sender_role
from latest
where company.id = latest.company_id
  and (company.support_last_message_at is null or company.support_last_message_at < latest.created_at);

create index if not exists companies_support_last_message_idx
  on public.companies(support_thread_status, support_last_message_at desc);
