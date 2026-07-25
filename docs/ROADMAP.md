# MASEST / VertKleen — Development Roadmap & Build Prompt

**Purpose:** A self-contained brief for any engineer or agent continuing work on the MASEST B2B
e-commerce platform (masest.co). It captures the live stack, conventions, current state, and all
remaining work across the e-commerce platform, the marketing site, CMS, lead generation, and the
conversion engine — split into **Scheduled** (committed/near-term) and **Potential** (strategic/optional).

---

## 0. Stack, conventions & gotchas (read first)

**Hosting / runtime**
- **Cloudflare Pages**, project `masest-commerce`, branch `main`. This is the LIVE host.
- Backend = **Cloudflare Pages Functions** (Workers runtime, Web `Request`/`Response`).
  - File-path routing under `functions/api/...`. Handlers: `export async function onRequest({ request, env })`
    or `onRequestGet` / `onRequestPost`. **No `process.env`** — env arrives via the per-request `env` binding.
  - Clean URLs: `/foo.html` 308-redirects to `/foo`.
  - `Date`/`fetch`/`crypto` are available in the Workers runtime (unlike the workflow sandbox).

**Data / services**
- **Supabase** (ref `mvfxzvkzcqmnwcoblvfc`, us-west-2): Postgres + Auth + RLS + Storage available.
  - Service-role client (`adminClient(env)` in `functions/_lib/supabase.js`) bypasses RLS — SERVER ONLY.
  - Auth gates signup+signin with a **Turnstile CAPTCHA**; confirm-email is ON.
  - DB migrations: apply via the **us-west-2 pooler** (`aws-1-us-west-2.pooler.supabase.com:5432`,
    user `postgres.mvfxzvkzcqmnwcoblvfc`) using the `pg` module. Direct host is IPv6-only (no sandbox egress).
- **Stripe** — hosted Checkout (SAQ-A), Customer Portal, subscriptions. Webhook at `functions/api/stripe-webhook.js`.
- **Resend** — transactional email. Verified sending domain is the **root `masest.co`**; `RESEND_FROM=MASEST <noreply@masest.co>`.
- **Klaviyo** — marketing/newsletter (`functions/api/newsletter.js`).
- **Turnstile** — CAPTCHA (sitekey in `js/config.js`).

**Shared helpers** (`functions/_lib/supabase.js`): `adminClient`, `userFromRequest`, `json`, `readBody`,
`companyForUser`, `requireStaff`, `companyEmails`, `sendEmail` (best-effort Resend; no-op without key),
`htmlEscape`. Reuse these — don't re-implement.

**Deploy / git**
- Canonical clone: `/tmp/masest-deploy` (HTTPS origin, push works). Commit explicit files →
  `git fetch origin -q && git rebase origin/main` → `git push origin HEAD:main`.
  Push triggers a Cloudflare Pages build. **Never touch `main`.**
- Concurrent Codex agents may edit the same tree — re-Read / re-grep anchors before editing, and rebase before push.

**Known gotchas (learned the hard way)**
- **Table/RPC privileges:** a table or function created via raw SQL on the pooler (role `postgres`)
  skips Supabase's auto-grant trigger. `service_role` bypasses RLS but NOT table/function GRANTs,
  while PostgreSQL grants new functions to `PUBLIC` by default. Grant tables/functions only to
  `service_role` unless a browser role truly needs direct RLS-mediated access, then re-run
  `supabase/schema-rpc-hardening.sql`.
- **Email deliverability:** Resend `last_event:"delivered"` means the recipient MX accepted at SMTP, NOT
  that it hit the inbox. `@masest.co` is behind **Proofpoint**; senders must be allow-listed there or mail
  is quarantined. (All current senders/recipients are now allow-listed.)
- **`sendEmail` swallows errors** (best-effort). To debug a missing email, hit the Resend API directly
  (`GET /domains`, `POST /emails`, `GET /emails/{id}` → `last_event`), not just the endpoint response.
- **Playwright screenshots:** pass `reducedMotion: 'reduce'` or `.reveal` sections render blank.
- **Glycol** is NOT a product card — its price list lives on `programs.html`.

---

## 1. Current state (what already exists — do NOT rebuild)

**Pages:** index, about, industries, products, product, programs, proof, resources, contact, cart,
order-confirmed, account, dashboard, business, admin, 404.

**Auth & accounts:** register (invite-aware, joins company via `company_invites` or creates one),
login, logout, password reset, email confirm, Turnstile. `account.html` is sign-in-first.

**User dashboard** (`dashboard.html`/`js/dashboard.js`): overview + stats, orders (with reorder),
messages (live-polled), notifications (live-polled, mark-read), saved addresses, payment (Stripe portal),
profile, and business tools for company setup, approval status, team invites (company-admin only),
programs (Stripe subscription checkout with request-enrollment fallback), and bulk/standing-order requests.
30s visibility-aware polling syncs badges + new staff replies. `business.html` is a private compatibility
redirect into the dashboard business tab.

**Admin console** (`admin.html`/`js/admin.js`): role-aware workspaces for orders, companies/accounts,
products and variants, messages, offers, traffic, CMS content/assets/revisions/newsletters, and CRM.
The CRM includes quote list/board views, contacts, portal users, tasks, notes/timeline, ownership and
follow-up controls, plus server-paginated company, quote, contact, and account directories.

**Commerce:** catalog (`/api/products`), cart (guest + transfer to account), Stripe Checkout
(`/api/checkout`, `_lib/checkout-session.js`), webhook (records order, decrements stock, "order received"
notification, subscription branch + `customer.subscription.*` updates), branded order-confirmation email.

**Lead intake:** `/api/quote` (own endpoint, replaced Formspree) → persists to `quotes` table + Resend
sales-notify + buyer autoreply; honeypot + soft Turnstile. Surfaces in admin Quotes tab.

**Other:** newsletter (Klaviyo), pageview beacon (`/api/track` + `js/track.js`), notifications (in-app + email).

**Schema files (applied):** schema.sql, schema-phase5.sql, schema-team.sql, schema-programs.sql,
schema-quotes.sql, grants.sql, seed.sql, variants_seed.sql.

---

## 2. SCHEDULED — committed / near-term

### 2A. Owner configuration (blocks real selling — no code, but gates everything)
- [ ] **SKU prices** — set per-product prices (pending SDS/compliance sign-off) in the catalog + Stripe.
- [ ] **`PROGRAM_PRICES`** env (JSON tier→Stripe recurring price id) so programs charge online instead of falling back to a message.
- [ ] **Supabase Auth** — Site URL → `https://masest.co`, redirect allowlist `https://masest.co/**` (remove `*.pages.dev`).
- [ ] **Stripe** — enable webhook events incl. `customer.subscription.created/updated/deleted`; activate Customer Portal.
- [ ] **`ADMIN_EMAILS`** + **`SALES_EMAIL`** confirmed in CF env.
- [ ] **DMARC** tighten root `masest.co` `p=none → quarantine`; optionally add SPF TXT on the sending domain.

### 2B. E-commerce completion
- [ ] **Quote → Order conversion.** From the admin Quotes tab, convert an accepted quote into a draft
      order/cart (pre-filled line items + agreed pricing) the buyer can approve & pay. Add quote status
      `quoted`/`accepted`; generate a **quote PDF**. *Where:* `functions/api/admin/quotes.js`, new
      `functions/api/quote-accept.js`, dashboard surface. *Done:* buyer receives a payable link from a quote.
- [ ] **Tax at checkout.** Integrate **Stripe Tax** (preferred) or TaxJar; populate the existing `tax` field.
      Handle tax-exempt companies (`companies.tax_exempt`) with resale-cert upload. *Done:* checkout shows correct tax; exempt orders are zero-rated with cert on file.
- [ ] **Shipping / freight.** Chemicals = freight/hazmat. Add shipping options (flat, weight-based, or
      "freight quote — we'll call"), hazmat surcharge, lead-time display, and a PO-number + multiple ship-to selector at checkout.
      **Progress (2026-07-24):** staff manage active, ordered Stripe Shipping Rates through CMS Content;
      published entries override the `STRIPE_SHIPPING_RATE_IDS` fallback and pass into Checkout.
      Missing, disabled, or invalid effective configuration fails closed.
      Card and NET checkout now also capture, validate, persist, and expose an optional customer PO number
      through confirmations and accounting reconciliation. Remaining: hazmat surcharge/routing, lead-time
      display, and saved multi-ship selector.
- [ ] **NET-terms checkout.** For approved companies (`can_use_net_terms`), allow "Pay by invoice (NET-x)"
      → create order in `net_open`, generate invoice, optional QuickBooks Online sync (env `QBO_*` already stubbed).
- [ ] **Order lifecycle & fulfillment.** Add tracking number + carrier on status change, "shipped" email
      with tracking link, invoice/packing-slip PDF, and an RMA/returns request flow from the dashboard.
- [ ] **Subscription management UI.** In the dashboard, let buyers view/upgrade/cancel programs via the
      Stripe portal (program-aware), show next billing date + included services. *Where:* `dashboard.html` programs panel, `functions/api/programs/*`.
- [ ] **Product depth.** Per-product **SDS/TDS/spec-sheet downloads**, certifications, variants (case packs,
      drum/tote/bulk), MOQ + quantity-break pricing, related/cross-sell products. *Where:* products schema + `product.html` + admin products.
- [ ] **Contract / customer-specific pricing.** Per-company price lists (negotiated) applied automatically when signed in.
- [ ] **Inventory.** Low-stock alerts to staff, backorder handling, optional multi-location stock.

### 2C. Hardening (do alongside features)
- [x] **Local test and verification baseline** — `npm test` runs the sequential Node contract suite;
      `npm run verify:site` checks the generated/static site; `npm run qa:commerce-smoke` and
      `npm run qa:ui-critical` run the focused Playwright gates. `npm run verify` runs syntax checks,
      Node tests, the Cloudflare Pages build, site verification, then both focused browser gates.
- [ ] **Coverage expansion** — add behavioral handler coverage for remaining support/admin routes and
      consolidate the broader Playwright suite around one shared server lifecycle.
- [ ] **Error tracking & logging** — Sentry (or CF-native) on functions + client; structured logs on webhook/payment paths.
- [ ] **Rate limiting & abuse** — limit `/api/quote`, `/api/newsletter`, auth endpoints (CF rules or KV counter).
- [ ] **RLS audit** — review every table's policies; confirm anon/authenticated cannot read others' orders/quotes/messages.
- [ ] **Accessibility & performance audit** — WCAG AA pass; Core Web Vitals budget; image optimization; lazy-load.
- [ ] **Backups/DR** — verify Supabase PITR; document restore.

---

## 3. CMS FEATURES

The repository has a native Supabase-backed CMS inside the existing static Pages architecture. These
checked foundations are current repository capability; unchecked items are the remaining CMS backlog.

- [x] **Structured content and publishing** — the admin Content workspace and
      `/api/admin/content` manage services, service packages, proof/resource/industry cards, industry
      sectors, FAQ blocks, page sections, page metadata, pricing tiers, and blog posts.
- [x] **Media library** — `/api/admin/content-assets` and `js/admin/content-assets.js` provide
      Supabase Storage upload, metadata, lifecycle controls, and reusable selection. Product images also
      support primary/gallery upload and ordering in the Products workspace.
- [x] **Resources / blog / news** — `blog_post` entries support Markdown, draft/publish scheduling,
      generated public blog pages, RSS, and sitemap output.
- [x] **Preview, draft, and revision workflow** — content has in-admin preview, draft/published states,
      scheduled publishing, and revision inspection through `/api/admin/content-revisions`.
- [x] **Structured industry content** — `industry_card`, `industry_sector`, and `page_section` entries
      drive editable industry and page content.
- [ ] **Product content CMS completion** — add rich descriptions, attached SDS/TDS documents,
      category/tag editing, and per-product SEO metadata beyond the existing image/gallery controls.
- [ ] **Case studies** — structured entries (industry, problem, result, metrics, downloadable PDF) feeding
      `proof.html` from the DB instead of hardcoded markup. (Existing PDFs in `docs/` become seed content.)
- [ ] **Industry recommendations** — connect managed industry content to per-industry product recommendations.
- [ ] **Site settings** — announcement/banner bar, nav/footer links, global contact details, feature flags.
- [ ] **SEO management completion** — extend current `page_meta` and generated sitemap support with editable
      titles, robots rules, broader JSON-LD, canonical controls, and a redirect manager.
- [ ] **Roles** — distinguish "content editor" from full admin (extend `requireStaff` with a role/permission column).

---

## 4. LEAD GENERATOR

`/api/quote` feeds an existing admin CRM across `js/admin/quotes.js`, `js/admin/crm.js`, and
`js/admin/crm-workspace.js`. CRM routes cover contacts, tasks, notes, and timelines; list APIs use
bounded server pagination. The unchecked items below remain top-of-funnel work.

- [ ] **Intent-specific flows** — the contact form already branches quote/audit/sample/distributor. Build the
      back half of each: **sample request** fulfillment + tracking; **distributor application** review/approval;
      **audit request** → booking.
- [ ] **Booking / scheduling** — let prospects book an audit/demo (embed Cal.com/Calendly, or build a
      slots table + confirmation email). Sync to the assigned rep.
- [ ] **Lead magnets / gated content** — SDS pack, savings whitepaper, compliance guide behind an email
      capture → push to Klaviyo + `quotes`/`leads` table; deliver via Resend.
- [ ] **ROI / cost-savings calculator** — interactive tool (chemical/water/energy savings vs incumbent) that
      captures inputs + email; strong B2B lead magnet and sales talking point.
- [ ] **Newsletter capture** — footer signup, exit-intent and scroll popups, post-purchase opt-in (Klaviyo lists).
- [x] **Customer chat** — first-party authenticated chat with direct handoff to the
      admin Messages thread; logged-out visitors are sent to sign up or log in.
- [x] **Admin CRM foundation** — quote lifecycle stages and board, owner/due-date follow-up, task inbox,
      notes/timeline, contacts and portal-user views, reporting/export helpers, and server-paginated search.
- [ ] **CRM sync (optional)** — HubSpot/Salesforce/Pipedrive connector if sales already uses one.
- [ ] **Attribution** — capture UTM/referrer/landing page on every lead (extend `/api/track` + quote payload) for source ROI.

---

## 5. CONVERSION ENGINE

Turn traffic and leads into orders and repeat revenue.

**Analytics & experimentation**
- [ ] **Event analytics** — extend `/api/track` from pageviews to events (view_item, add_to_cart, begin_checkout,
      form_start/submit, quote_request). Build a **funnel + conversion dashboard** in admin (drop-off by step).
- [ ] **A/B testing** — server-assigned variant cookie + variant rendering + conversion tracking; start with hero/CTA/PDP.
- [ ] **Retargeting pixels** — Meta, Google Ads, LinkedIn Insight (consent-gated); server-side events where possible.

**Lifecycle email automation** (Klaviyo flows, or Resend + a scheduled CF cron)
- [ ] **Cart abandonment** (guest + logged-in), **browse abandonment**, **quote follow-up** sequence,
      **post-purchase** (reorder reminder timed to consumption), **win-back**, **subscription renewal/dunning**.

**On-site conversion**
- [ ] **Social proof** — testimonials/reviews (collect post-delivery), customer logos, "recently viewed",
      case-study CTAs on PDPs.
- [ ] **Trust & urgency** — certifications/compliance badges, real stock levels, lead-time, "request a quote in 1 business day".
- [ ] **PDP/checkout optimization** — sticky add-to-cart / "Request quote", fewer checkout fields, express
      guest checkout, saved carts, clear B2B pricing (per-unit + case).
- [ ] **Recommendations** — "frequently bought with", industry-based bundles; later, personalized.
- [ ] **Personalization** — returning-visitor + account-based content (show contract pricing, NET terms, reorder shortcuts); industry-based landing content.

**Acquisition**
- [ ] **Campaign landing pages** — fast, single-goal pages per industry/ad campaign (paired with CMS + A/B).
- [ ] **Programmatic SEO / content** — industry + application pages targeting organic B2B search.
- [ ] **Referral / partner program** — distributor and customer referral incentives.

---

## 6. POTENTIAL — strategic / optional (evaluate later)

- [ ] **B2B procurement integration** — PunchOut (cXML/OCI) and EDI for large buyers (e.g. Walmart DC / distributors).
- [ ] **Customer-specific catalogs** — restricted product/pricing views per enterprise account.
- [ ] **Distributor / reseller portal** — tiered pricing, co-branded ordering, downstream order visibility.
- [ ] **PWA / mobile** — installable reorder app for repeat buyers; barcode reorder.
- [ ] **Internationalization** — multi-currency, multi-language, region tax/compliance.
- [ ] **AI features** — product/SDS Q&A assistant, smart reorder & demand forecasting, lead scoring, support-thread drafting.
- [ ] **Loyalty / rewards** — volume rebates, tiered loyalty for recurring buyers.
- [ ] **Marketplace** — third-party complementary products.
- [ ] **Advanced ops** — multi-warehouse routing, carrier integrations (freight APIs), automated hazmat documentation.

---

## 7. Suggested execution order

1. **Unblock selling:** §2A owner config + §2B tax + shipping → real checkout works end-to-end.
2. **Close the lead loop:** §2B Quote→Order + remaining §4 intent flows and booking → sales can transact on leads.
3. **Feed the funnel:** remaining §3 CMS work (case studies/product depth/SEO) + §5 event analytics + lifecycle emails.
4. **Optimize:** §5 on-site conversion, A/B, personalization.
5. **Scale:** §6 as the business demands.

Each task: implement on `main`, follow the CF Functions + `_lib` conventions, add the table
grant when creating tables, verify with `node --check` + a smoke call (expect 401 on gated endpoints), and
confirm email paths via the Resend API. Keep changes small and committed per-feature.
