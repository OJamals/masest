# Catalog: runtime source of truth (Phase 3)

As of Phase 3 the **Supabase database is the runtime source of truth** for the
catalog (products, variants, prices, tier prices, stock, images). The admin
console writes directly to it and changes go live immediately — no redeploy.

`data/catalog.seed.json` is now **bootstrap / disaster-reset only**, not the live
catalog. It is the canonical *initial* dataset and the input to the seed scripts.

## What lives where

| Data | Home | Edited via |
|---|---|---|
| Products, variants, base price, mode, stock | `products` / `product_variants` tables | Admin → Products & stock |
| Tier prices (retail/hvac/wholesale) | `price_tiers` table | Admin → Pricing |
| Company → tier, NET terms, credit | `companies` table | Admin → Accounts |
| Product images | Supabase Storage bucket `product-images` (public) + `products.image_url` / `products.gallery` | Admin → Products & stock (per-row upload) |

## Images

- Bucket `product-images` is **public-read**; uploads are server-only
  (`functions/api/admin/product-image.js` writes with the service-role key).
- Primary image → `products.image_url`; extra shots → `products.gallery` (jsonb array).
- Storefront (`product.html`) prefers the DB image, falling back to the static
  `img/products/*` asset when no DB image is set.
- Public URL form: `${SUPABASE_URL}/storage/v1/object/public/product-images/<sku>/<uuid>.<ext>`.

## Reseed / reset path (rare)

The seed scripts overwrite DB rows from the canonical JSON. Use only to bootstrap
a fresh project or recover from corruption — **this clobbers live admin edits**
to products/variants (it does NOT touch `price_tiers`, `companies`, or Storage).

```
# 1. (re)generate catalog.seed.json + SQL seeds from the source decks
node tools/build-catalog.mjs
# 2. push products + variants + services into Supabase
node tools/seed-products.mjs        # needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env
```

## Migrations applied

- `supabase/schema-pricing.sql` — tier pricing (Phase 2).
- `supabase/schema-images.sql` — `products.gallery` column + `product-images` bucket (Phase 3).

Both are idempotent and re-runnable.
