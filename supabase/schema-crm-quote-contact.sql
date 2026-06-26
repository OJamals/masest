-- CRM slice 6: link a saved company contact to a quote/deal as its buyer.
-- Additive + idempotent. quotes already grants service_role (schema-quotes.sql),
-- so no new grants. Nullable bigint (loose coupling, no FK — soft-deleted contacts
-- shouldn't orphan a quote); resolved + displayed at read time.

alter table public.quotes add column if not exists contact_id bigint;
create index if not exists quotes_contact_idx on public.quotes (contact_id);
