-- supabase/schema-reviews.sql — customer product/service reviews.
-- Apply via Supabase SQL editor / pooler. Service-role auto-grant does NOT fire for
-- new tables, so the grant below is required (see schema-phase5.sql).

create table if not exists public.product_reviews (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null default 'product',   -- 'product' | 'service'
  sku               text not null,
  order_id          uuid references public.orders(id) on delete set null,
  user_id           uuid,
  author_name       text not null,
  author_email      text not null,                     -- private; never returned publicly
  rating            smallint not null check (rating between 1 and 5),
  title             text,
  body              text,
  verified_purchase boolean not null default false,
  source            text not null default 'customer',  -- 'customer' | 'staff_manual'
  status            text not null default 'pending',    -- 'pending' | 'approved' | 'rejected'
  staff_note        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One customer review per (order, sku); manual staff-entered rows (order_id null) are exempt.
create unique index if not exists product_reviews_order_sku_uq
  on public.product_reviews (order_id, sku) where order_id is not null;
create index if not exists product_reviews_public_idx
  on public.product_reviews (kind, sku, status);
create index if not exists product_reviews_moderation_idx
  on public.product_reviews (status, created_at desc);

alter table public.orders add column if not exists review_reminded_at timestamptz;

-- ---------- GRANTS (service-role auto-grant does not fire for new tables) ----------
grant all privileges on public.product_reviews to service_role;
grant usage, select on all sequences in schema public to service_role;
