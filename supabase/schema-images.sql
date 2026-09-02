-- MASEST product-image metadata. Idempotent.
-- Public image bytes are owned by the Cloudflare R2 CONTENT_IMAGES binding;
-- Supabase stores only product URLs and gallery order.

alter table public.products
  add column if not exists gallery jsonb not null default '[]'::jsonb;
