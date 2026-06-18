-- MASEST Phase 3 — product images via Supabase Storage. Idempotent.
-- products.image_url already exists; add a gallery array. Create a public bucket
-- that the admin upload endpoint writes to (service_role) and the storefront
-- reads via the public object path.

alter table public.products
  add column if not exists gallery jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images', 'product-images', true, 10485760,
  array['image/png','image/jpeg','image/webp','image/avif','image/gif']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
