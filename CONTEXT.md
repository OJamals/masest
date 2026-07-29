# Ubiquitous Language

## Core domain terms

- **Buyer**  
  An industrial procurement user who is shopping or requesting services for a site.

- **Buyer account**  
  A registered person (`profiles`) tied to one **Company**. An account may be `buyer` or company `admin`.

- **Company**  
  The business entity in `public.companies`.  
  A company may be `pending`, `approved`, `rejected`, or `suspended`.

- **Company admin (company role)**  
  The company role `admin` on a profile (`role=admin`).  
  This is not the same as platform staff.

- **Platform staff**  
  Internal operators with access to `/api/admin/*` (`is_staff` / `ADMIN_EMAILS` / `staff_role`).

- **Platform staff role**  
  `owner`, `finance`, `support`, or `read_only` for staff permission checks.

- **Catalog product**  
  A purchasable or quote-initiated chemical product row from `public.products`.

- **Product mode**
  - `buy` — sold through checkout and creates paid order flow.
  - `quote` — handled via quote intake and follow-up.

- **Product variant**  
  A purchasable unit variant (`public.product_variants`) of a product, typically a volume size such as gallons.

- **Service**  
  A service catalog line (`public.services`, mode `quote_service`) that is quote-only, not stocked retail checkout.

- **Cart**  
  The buyer-assembled list of variant quantities, validated to produce sellable lines.

- **Saved requisition**
  A buyer-owned reusable `orders` row with `status='cart'`, a non-null
  `requisition_name`, and canonical `order_items`.

- **Checkout mode**
  - `pay` (default) — creates/redirects to Stripe payment.
  - `net` — creates a NET order on account.

- **NET terms**  
  Deferred-payment contract tied to an approved company (`net_terms_days` > 0, `credit_limit`, and open NET balance).

- **Order**  
  A sales record in `public.orders` with a finite lifecycle and payment method.
  - Statuses: `cart`, `pending_payment`, `paid`, `net_open`, `net_paid`, `fulfilled`, `cancelled`, `refunded`.
  - Payment method: `stripe` or `net`.

- **Shipment status**  
  Operational tracking state for a company-visible order flow (`processing`, `packing`, `shipped`, `delivered`, `blocked`) backed by `shipment_events`.

- **Quote request / Lead**  
  An inbound request in `public.quotes`, initiated by the public form or a saved requisition.
  Statuses include `new`, `contacted`, `closed`, `spam`.

- **Quote offer**
  Platform staff pricing attached to a requisition quote. The offer reuses a buyer-owned
  `orders` draft (`status='cart'`, null `requisition_name`) and canonical `order_items`;
  checkout creates the final tracked order. `quotes.payload` carries only the linkage and
  transition state (`sent`, `accepted`, `payment_pending`, `ordered`).

- **Lead score / Priority**  
  Internal urgency classifier used by lead handling workflows.

- **Team**  
  People joined under one company and managed via `/api/account/team` (`profiles` with the same `company_id`).

- **Invite**  
  A pending company invitation (`company_invites`) to add a new team member by email.

- **Content asset**
  A CMS-managed image in `content_assets`. Its storage object is immutable once referenced;
  replacement uploads a distinct asset.

- **Replace everywhere**
  A platform staff action that previews exact `payload` / `seo` field changes, binds approval
  to an impact hash, then saves each affected `content_entries` row through normal revisions.
  The prior asset remains available so existing revisions can restore its references.

- **Page workspace**
  The platform staff CMS editor for one content entry. Copy, SEO, images, draft preview,
  scheduling, publishing, locks, and revisions remain tabs of one workspace; they do not
  create separate content records or publication paths.

## Key rules in plain language

- A company must be `approved` to unlock checkout for the company buyer path.
- `NET` checkout is only valid when company approval is active and `net_terms_days` is set.
- A `quote` is expected for non-purchasable items (including `products.mode='quote'` and `services`).
- A saved requisition quote never creates a parallel line-item model: requisition, offer,
  checkout, and final order all use `orders` / `order_items`.
- Accepted quote checkout ignores client prices and requires the exact buyer, Company,
  quote, draft order, SKUs, and quantities before applying Platform staff pricing.
- Never overwrite a referenced content asset in place. Upload, preview the exact reference
  diff, confirm the unchanged impact hash, and preserve rollback through content revisions.
- `admin` means at least two concepts in code; always qualify whether it is **company admin** or **platform staff**.
