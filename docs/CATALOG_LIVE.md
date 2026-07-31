# Catalog and pricing runtime authority

## Pricing

`Admin > Pricing` is the only operator-facing price source.

- Product variant tiers: `public.price_tiers` (`retail`, `hvac`, `wholesale`)
- Services and packages: `public.services.public_price`
- Program tiers: published `public.content_entries` rows with type `pricing_tier`

`GET /api/pricing` combines the public rows for website rendering. It excludes wholesale
pricing and sends `cache-control: no-store`, so a saved CMS change appears on the next
website request without a catalog rebuild or deploy.

Website pages, Markdown price tokens, comparison pages, program cards, segment tables,
resource tables, and service cards have no static numeric fallback. If live pricing is
unavailable, they omit the price or show the existing unavailable state instead of a stale
number.

`public.set_variant_pricing` writes variant tier cells atomically. Retail writes also update
the existing `product_variants.price` checkout mirror until checkout storage is migrated;
the CMS tier remains the operator authority.

## Metadata

`data/catalog.seed.json` owns product, variant, service, and package metadata only.
`data/segment-pricing.json` owns segment membership and copy only. Generated JSON and SQL
artifacts contain no prices.

Run:

```bash
node tools/build-catalog.mjs
npm run seed
```

`npm run seed` upserts metadata and removes stale catalog rows. It does not create, change,
or delete CMS price tiers or service prices.

## Database setup

Apply these tracked schemas:

1. `supabase/schema-pricing.sql`
2. `supabase/schema-services.sql`
3. `supabase/schema-cms-pricing.sql`

After setup, use `Admin > Pricing` for every future price change.
