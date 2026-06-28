-- CRM contact dedup: one active contact per (company, case-insensitive email).
-- Additive + idempotent. Kills the inbound-Crisp select-then-insert race
-- (functions/api/crisp/webhook.js syncChatLeadToCrm). The webhook's insert is
-- best-effort (try/catch), so a racing insert that loses to this index fails
-- harmlessly — the winning contact persists, no duplicate is created.
--
-- PRE-CHECK (run first): existing duplicates will block index creation. Find them:
--   select company_id, lower(email) e, count(*)
--   from public.crm_contacts
--   where email is not null and deleted_at is null
--   group by company_id, lower(email) having count(*) > 1;
-- Resolve dupes (merge/soft-delete) before applying if that returns rows.

create unique index if not exists crm_contacts_company_email_uniq
  on public.crm_contacts (company_id, lower(email))
  where email is not null and deleted_at is null;
