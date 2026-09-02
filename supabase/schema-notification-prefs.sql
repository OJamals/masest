-- Notification preferences (#19). Per-user email opt-in/out. Apply in the Supabase
-- SQL editor / pooler. Idempotent. Default true = existing behaviour (everyone opted in).
alter table public.profiles add column if not exists notify_orders boolean not null default true;
alter table public.profiles add column if not exists notify_offers boolean not null default true;
alter table public.profiles add column if not exists notify_messages boolean not null default true;

-- Canonical customer-facing marketing consent. Default-on is product policy; users may
-- disable it at any time. Preserve every legacy offer opt-out during migration.
alter table public.profiles add column if not exists marketing_email_enabled boolean not null default true;
update public.profiles
set marketing_email_enabled = false
where notify_offers = false and marketing_email_enabled = true;
