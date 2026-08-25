# Catalog and pricing runtime authority

## 2026-08-24 publication

The reviewed one-time publication source is:

- Workbook: `VertKleen_Website_Publish_List_2026_EXTERNAL.xlsx`
- Version: `v4.1 EXTERNAL`
- SHA-256: `fc555e6ec410a20d945bc6e0635bdcda3ce1389bed47205f6696989fe8041d7e`
- Tracked capture: `data/vertkleen-website-publish-2026-v4.1.json`

The publication contains 208 unique SKUs: 96 single units, 64 cases, and 48
bulk quote-only rows. All 160 priced rows have exact retail and minimum-checkout
amounts. Bulk rows have no public price and cannot enter the cart.

Checkout readiness is deliberately narrower than publication:

- 48 one-gallon and 2.5-gallon SKUs are active with verified parcel profiles.
- 112 quart, half-gallon, and case SKUs retain their CMS prices but are inactive
  with `shipping_package_profile_missing` until exact packaged weights and
  dimensions are supplied.
- 48 bulk SKUs remain inactive and route to quote requests.

Policy: USD; recommended $75 order minimum; case prices are 10% below equivalent
single-unit totals; `VK5` is the only online promotion (5%); freight and applicable
tax are additional; terms are FOB Merritt Island, FL. The five older public bundle
offers are held because their approved prices predate this publication and cannot be
reconstructed from the new SKU model without a new commercial decision.

## Runtime pricing authority

The v4.1 migration performs the initial exact load. After that load, `Admin > Pricing`
is the operator-facing price authority.

- Product tier cells: `public.price_tiers` (`retail`, `hvac`, `wholesale`)
- Checkout mirror: `public.product_variants.price`
- Enforced floor: `public.product_variants.minimum_checkout_price`
- Services/packages: `public.services.public_price`
- Program tiers: published `public.content_entries` rows with type `pricing_tier`

`public.set_variant_pricing` changes tier cells atomically, mirrors retail into the
checkout row, and rejects any amount below the published checkout floor. Checkout
rechecks the floor after tier and promotion logic; approved quotes use their separately
approved price.

`GET /api/pricing` supplies public runtime prices and product-line metadata with
`cache-control: no-store`. Website pages, Markdown price tokens, comparisons, segment
tables, resource tables, and product controls have no static numeric fallback. If the
API is unavailable, they omit price or use the existing unavailable state.

Both public segment tables bind to `retail`. Wholesale stays non-public.

## Generated catalog artifacts

`data/catalog.seed.json` is metadata only: it owns projected products/variants, activation state,
parcel profiles, services, and packages. It intentionally contains no retail prices or
checkout floors. `data/segment-pricing.json` owns membership and copy, not prices.

Regenerate deterministic artifacts with:

```bash
node tools/build-catalog.mjs
node tools/build-segment-pricing.mjs
node tools/build-pricing-update-2026-08-24.mjs
```

The final command must byte-match `supabase/update-pricing-2026-08-24.sql`.

`npm run seed` is only for metadata reconciliation after the v4.1 database migration.
It does not create, change, or delete CMS tier prices.

## Safe production rollout order

1. Apply `supabase/expand-pricing-schema-2026-08-24.sql`. It adds compatibility
   columns and the floor-aware RPC only; it changes no rows or prices.
2. Deploy the compatible website, Functions, CMS, and checkout code.
3. Apply `supabase/update-pricing-2026-08-24.sql`. It replaces catalog/prices in one
   transaction, prunes retired rows, validates constraints, and fails closed unless
   exact counts and readback match.
4. Configure exactly one active Stripe promotion code: `VK5`, 5% off. Remove or
   deactivate competing online codes before enabling the promotion-entry UI.
5. Read back counts/source version, smoke-test public prices, cart, checkout floor,
   quote-only rows, market separation, CMS editing, and coupon behavior.

Do not reverse steps 1-3. Do not activate the 112 blocked parcel SKUs until verified
packaged `lb x L x W x H` values are available.

For a fresh database, apply the consolidated `supabase/schema.sql` plus the tracked
service and CMS pricing schemas before the v4.1 data migration.
