# Catalog & pricing import — controlled launch (2026-06-17)

Loads the owner-approved VertKleen prices from `~/Desktop/masest/latest` into the commerce
catalog, in the audit's **controlled-launch** mode.

## What shipped
- **20 products / 100 variants** in `data/catalog.seed.json` (single source of truth).
- **33 buyable variants** — 1 / 2.5 / 5 gal of the 11 priced cleaning/degreasing products
  (HCR, CR, Descaler, CR-HD, CR-HD Low Foam, Neutral, MultiWash, Torque, AlumiBrite, Purgo, LAM3).
- **Quote-only** (never sold online): all 55 / 275 gal drums & totes (freight quoted post-order),
  WaterSafe60 / CR2 / SAR (small-pack price unconfirmed), and all 6 glycols.
- New catalog cards for CR-HD Low Foam, CR2, SAR. Editorial slug `crhd` aliases to commerce
  `cr-hd` in `product.html`. Product pages default to the 5 gal pail and show a read-only
  **drums & totes** reference block (`data/drum-pricing.json`) with a freight-quote CTA.
- **Services** (35 + 4 packages) loaded to a new `public.services` table, quote-only — no UI yet.

## Safety model
The live commerce table only ever sells fulfillable SKUs: quote-only variants are `active=false`,
so `/api/products` (RLS `active=true`) never returns them and `checkout.js` rejects them. No
checkout/schema change was needed. `tools/build-catalog.mjs` enforces this with a build-time
guardrail (no buyable variant ≥ 55 gal or null-priced) and `tests/catalog-seed.test.mjs` asserts it.

## Owner steps to go live (Supabase)
Site deploy is already safe before this — buy buttons stay hidden (graceful quote CTA) until the
DB is seeded. In the Supabase SQL editor, run in order:
1. `supabase/schema.sql` (only if products/product_variants not yet created)
2. `supabase/seed.sql` — 20 product parents
3. `supabase/variants_seed.sql` — 100 variants (33 active/buyable)
4. `supabase/services_seed.sql` — creates `services` table + grants + 39 rows

Alternative (after step 4 has created the `services` table): `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run seed`.

**Verify:** `/api/products` returns 20 products; a 5 gal pail (e.g. `VK-HCR-5`) shows Add-to-cart;
a quote-only SKU (e.g. `VK-WS60-5`, any 55/275) never appears as buyable.

## Regenerating
`data/catalog.seed.json` is the source of truth. Edit it, then run `node tools/build-catalog.mjs`
to re-emit `products.seed.json`, `seed.sql`, `variants_seed.sql`, and `drum-pricing.json` in sync.
To change what is buyable, edit `QUOTE_ONLY_SLUGS` in the generator.

## Still pending (owner decisions, not blockers)
Small-pack prices for WaterSafe60 / CR2 / SAR; glycol 1 / 2.5 / 275 gal prices; account-tier
price books; freight rules + per-variant weights; approved SDS/TDS/cert PDFs; services catalog UI.
