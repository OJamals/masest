-- Notification preferences (#19). Per-user email opt-in/out. Apply in the Supabase
-- SQL editor / pooler. Idempotent. Default true = existing behaviour (everyone opted in).
alter table public.profiles add column if not exists notify_orders boolean not null default true;
alter table public.profiles add column if not exists notify_offers boolean not null default true;
alter table public.profiles add column if not exists notify_messages boolean not null default true;
