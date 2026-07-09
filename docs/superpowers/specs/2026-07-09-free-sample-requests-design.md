# Free Sample Requests Design

## Goal

Make free sample requests available for every catalog product and route each request into the existing admin Quotes CRM pipeline as a lead.

## Architecture

Sample requests stay on the existing `/api/quote` intake and `quotes` table. A sample request is a quote-row lead with `type = "sample"`, sample details in `payload.samples`, product interest in `product`, and default CRM stage `sample_audit`.

Public product pages add a product-specific free-sample CTA that opens `contact?type=sample&product=<product name>`. The contact form preselects the product in the sample picker when possible, allows a single prefilled product for product-page requests, and still supports the existing 3-5 product sample-kit flow when no product is prefilled.

Admin CRM keeps using the Quotes tab. Sample leads are visually identified in list/board/drawer summaries, with requested samples and ship-to details rendered from `payload` so staff can qualify, follow up, and convert through the existing CRM workflow.

## Scope

- Add product-page free-sample CTA.
- Expand the sample picker to all active parent products from `data/products.seed.json`.
- Preserve existing quote, audit, technical document, and distributor behavior.
- Normalize sample intake into CRM stage `sample_audit`.
- Add sample request details to admin quote list and drawer.
- Add focused tests for public sample links, sample form behavior, intake normalization, and admin CRM display.

## Non-Goals

- No new `sample_requests` table.
- No new CRM subsystem.
- No changes to live third-party integrations beyond the existing quote/lead email and Klaviyo behavior.
- No changes to unrelated dashboard/business/admin files already dirty in the checkout.
