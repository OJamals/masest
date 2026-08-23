# MASEST commerce automation and marine merchandising benchmark

Research date: 2026-08-23

Status: research sidecar; no production copy, source code, configuration, catalog data, labels, or existing documentation changed by this dossier

## Scope and evidence rules

This dossier covers:

1. Stripe Checkout, payment, webhook, and refund behavior relevant to MASEST orders.
2. ShipStation shipment, label, void, refund, return, and tracking behavior.
3. Resend transactional-email delivery and webhook behavior.
4. Marine-maintenance discovery, selection, merchandising, copy, and image patterns.
5. A recommended target workflow for the buyer experience, cart, order operations, CMS, status pages, tracking, email, and marine launch.

The named repository sources were reviewed before external research. External facts come from official provider documentation, official manufacturers and retailers describing their own sites and products, and government sources. Competitor product claims are not treated as evidence for VertKleen. Recommendations are separated from sourced facts. Proposed MASEST language is original and deliberately avoids unverified chemical, performance, safety, certification, and environmental claims.

This is not a fresh code-path or production-runtime audit. It defines a current benchmark and target contract. Existing canonical commerce seams should be preserved and deepened after their present implementation is reverified.

## Executive findings

1. **An order cannot be represented by one provider status.** Stripe payment/refund state, ShipStation shipment/label/tracking state, carrier label-credit state, and Resend delivery state are separate, asynchronous records. The MASEST order should remain canonical and display each effect independently.
2. **A successful API request is not necessarily the final business outcome.** Stripe refunds can remain pending or fail. A ShipStation label can be voided without the carrier credit having settled. A Resend message can be accepted or sent without being delivered.
3. **“Label created” is not “shipped.”** The customer-facing shipment milestone should be carrier acceptance or another clearly named handoff state. Label purchase belongs in the internal fulfillment timeline.
4. **MASEST has a marine exposure and identity gap.** The industry source presents eight marine marketing names, while the commerce catalog still presents the corresponding base VertKleen names. The marine source offers only four broad job paths. Buyers need an explicit identity bridge and a task/surface/system selector before they reach pack size or cart.
5. **Marine HVAC should remain a featured route, not the entire marine taxonomy.** The earlier research establishes a strong professional-service wedge. The expanded eight-product line now also needs visible routes for routine wash/finish, oil and grease, aluminum, drains and organic residue, mineral deposits, and label-directed antimicrobial cleaning.
6. **Purgo’s antimicrobial positioning is substantiated within a bounded scope.** First-party EMS material describes Purgo as a FIFRA section 25(b)-exempt minimum-risk antimicrobial and separately identifies Purgo N as EPA registered. Keep Marine Antimicrobial public using exact-product, label-directed language for control of odor-causing bacteria and other non-public-health microorganisms. Do not transfer Purgo N registration or broader EPA, universal-safety/environmental, or generic percentage-kill claims to VertKleen Purgo.
7. **Marine retailers reduce selection effort before asking for a purchase.** Their recurring pattern is job/category navigation, surface and soil filters, size and availability, comparison, directions, documents, and related products. Professional system-cleaning manufacturers add symptom, equipment, method, diagram, and expert-help routes.
8. **Images should prove category fit and method, not imply unsupported outcomes.** The highest-value set is authentic task photography, exact pack shots, material/system context, restrained diagrams, and clear document imagery. Generated visuals can explain a process when labeled as illustrations; they should not serve as performance evidence.

---

## Part I — Sourced facts

### 1. Repository baseline

These are observations from repository text, not external validation of product performance or compliance.

| Source | Observed state | Consequence for this brief |
| --- | --- | --- |
| [Copy voice](../COPY_VOICE.md) | The intended voice starts with the customer’s job, surface, equipment, result, price, and buying path. Exact certifications belong beside the exact product. | Marine copy should lead with selection and use context, then show only claim-scoped proof. |
| [Industry applications](../../data/industry-applications.json) | The marine entry presents eight marketing names mapped to eight base products: Scale Buster/HCR T16, SeaVap Coil Kleener/Descaler, Sea Drain Kleener/HVAC CR, MultiWash/MultiWash, Marine Degreaser/CRHD, AlumiBrite/AlumiBrite, Marine Wash & Wax/Torque, and Marine Antimicrobial/Purgo. It exposes four broad job paths: degrease, descale, fleet wash, and exterior biological grime. | Eight visible names need stable links to canonical products, and four routes are not enough to explain eight choices. |
| [Catalog seed](../../data/catalog.seed.json) | The commerce catalog uses base names and base slugs. Most mapped products offer 1, 2.5, and 5 gallon buyable variants and 55/275 gallon quote variants. HVAC CR offers 1 gallon buy plus 55/275 gallon quote; HVAC HCR offers 1 gallon buy plus 275 gallon quote. The marine source uses `crhd`, while the catalog uses `cr-hd`. | A buyer who enters through “Marine Degreaser” or “SeaVap Coil Kleener” needs an identity bridge through product, cart, checkout, order, email, and reorder. Alias resolution should not create a second SKU or line-item model. |
| [Prior marine/HVAC research](../MARINE_HVAC_MARKET_RESEARCH_2026-08-03.md) | The earlier strategy emphasizes marine HVAC/system maintenance, material compatibility, method documentation, contained washwater, and conservative claims. | Keep this as a featured expert route within a wider task-led marine storefront. |
| [Go-to-market kit](../../artifacts/marine-hvac-market-2026-08-03/GO_TO_MARKET_KIT.md) | The kit uses task cards, selector questions, service support, and method imagery. It treats generated images as illustrative rather than proof. | Reuse its decision structure and evidence discipline; expand it to all eight marine presentations. |
| [Purgo authority review](../PURGO_AFFILIATE_PRODUCT_AUTHORITY_REVIEW_2026-08-22.md) | Current project authority distinguishes Purgo from EPA-registered Purgo N, substantiates Purgo as a FIFRA section 25(b)-exempt minimum-risk antimicrobial, and identifies internal document revisions still needed. | Keep Marine Antimicrobial public with bounded, label-directed non-public-health microorganism language; reconcile document revisions internally without a customer-visible gate. |
| [Marine Antimicrobial label](../labels/marine/vertkleen-marine-antimicrobial-label.pdf) | The owner-approved marine label is the public product document. Broader EPA-adjacent, universal-safety/environmental, biodegradability, or percentage-kill language still requires exact-product authority and complete use conditions. | Link the exact label directly and keep surrounding marketing copy within the substantiated bounded scope. |

#### Repository-specific identity problem

The marine names are merchandising aliases for existing canonical SKUs, not separate commerce identities. That distinction should be visible to customers and explicit in CMS data:

```text
Marine display name
  -> canonical product slug
  -> canonical SKU and variant
  -> exact label/SDS/TDS revision
  -> allowed surfaces, soils, methods, and claims
  -> cart/order/reorder identity
```

Recommended public treatment: show the marine name first on marine pages, followed by a quiet identity line such as “VertKleen Descaler marine application” or “Uses VertKleen Descaler · VK-DESC.” Final wording should be approved with brand and label owners. The cart, receipt, order, and reorder views should preserve both the selected marine context and canonical SKU.

### 2. Stripe: payment, Checkout, refund, and webhook facts

#### Sourced facts

| Fact | Operational meaning for MASEST | Primary source |
| --- | --- | --- |
| Stripe says fulfillment must rely on webhooks, not only the Checkout success page, because a customer may pay and never load that page. | The redirect page may retrieve and display a Checkout Session, but it cannot be the payment or fulfillment authority. | [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [custom success page](https://docs.stripe.com/payments/checkout/custom-success-page) |
| Stripe’s fulfillment pattern retrieves the Checkout Session with line items, verifies that it is paid, and makes fulfillment safe for repeated or concurrent calls. | Persist the MASEST order and one idempotent fulfillment transition; do not create duplicate orders or labels on webhook replay. | [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment) |
| Immediate and delayed payment methods have different event paths. Stripe identifies `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed` as relevant Checkout events. | “Checkout completed” must not be treated as settled payment when `payment_status` remains unpaid. | [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment) |
| Stripe requires webhook signature verification against the raw request body. It warns that events can be duplicated and delivered out of order, and recommends asynchronous handling with a quick `2xx` response. Live webhook deliveries are retried for up to three days. | Verify first, durably record/deduplicate, acknowledge, then process through a queue or claim/finalize worker. Reconcile missing predecessors from Stripe rather than assuming order. | [Stripe webhooks](https://docs.stripe.com/webhooks) |
| Stripe supports idempotency keys on `POST` requests. Reusing a key with changed parameters is rejected; API v1 keys can be pruned after at least 24 hours. | Use stable operation identities for Checkout/refund creation, while retaining MASEST’s own permanent effect ledger beyond Stripe’s retention window. | [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests) |
| Refund creation and refund settlement are separate. Stripe exposes refund lifecycle events and refund statuses including pending, succeeded, failed, canceled, and requires-action states where applicable. | “Refund requested” and “refund completed” must be separate order events. A failed or pending refund needs reconciliation and staff visibility. | [Stripe refunds](https://docs.stripe.com/refunds), [Refund object](https://docs.stripe.com/api/refunds/object) |
| Checkout Sessions can expire and Stripe supports a recovery URL for an expired session. Promotional follow-up requires the appropriate consent handling. | Cart recovery can be added, but it should be deduplicated, consent-aware, and distinct from order emails. | [Stripe abandoned carts](https://docs.stripe.com/payments/checkout/abandoned-carts) |

#### Facts that should not be collapsed

- Checkout Session created ≠ order paid.
- Checkout Session completed ≠ delayed payment settled.
- Refund API accepted ≠ money returned.
- Stripe redirect loaded ≠ webhook processed.
- Dispute created ≠ refund requested; disputes need their own exception path. Stripe documents dispute events separately in its [payment-event guidance](https://docs.stripe.com/webhooks/handling-payment-events).

### 3. ShipStation: order, shipment, label, void, credit, return, and tracking facts

#### Sourced facts

| Fact | Operational meaning for MASEST | Primary source |
| --- | --- | --- |
| ShipStation API v2 distinguishes sales orders from shipments. A shipment is mutable until a label is created; a label is not editable and must be voided and recreated when shipment details change. | Keep MASEST’s order and package plan canonical. Treat every label purchase/replacement as an immutable fulfillment attempt. | [ShipStation getting started](https://docs.shipstation.com/getting-started), [Create a shipment](https://docs.shipstation.com/shipments/create) |
| Shipment creation accepts merchant correlation fields such as `external_shipment_id`, `shipment_number`, and `external_order_id`; account-level uniqueness rules apply to external shipment IDs and shipment numbers. | Use a stable MASEST order ID plus a unique package/attempt identity. Do not reuse one external shipment ID across replacement labels. | [Create a shipment](https://docs.shipstation.com/shipments/create) |
| Buying a label produces a label object with provider IDs, status, tracking number, costs, and label documents. ShipStation warns that label documents have finite availability and should be stored when long-term access is required. | Persist provider IDs, normalized cost, tracking, package data, and a controlled copy/reference to the label document. | [Labels API](https://docs.shipstation.com/apis/openapi/labels), [ShipStation getting started](https://docs.shipstation.com/getting-started) |
| The v2 void endpoint returns an `approved` result and a carrier message. A request must also fit the carrier’s void window and rules. Some carriers do not support voiding. | “Void requested,” “void approved,” and “void denied” are distinct states. Capture the carrier explanation. | [Void labels API](https://docs.shipstation.com/void-labels), [ShipStation void-label guide](https://help.shipstation.com/hc/en-us/articles/360026157751-Void-Labels) |
| ShipStation explicitly distinguishes a voided label from a refunded label. Carrier refund timing and eligibility vary; scanned or otherwise used labels may be ineligible. | Carrier credit needs a separate ledger and reconciliation job. A voided flag must not be booked or displayed as a settled credit. | [ShipStation void-label guide](https://help.shipstation.com/hc/en-us/articles/360026157751-Void-Labels), [label charging](https://help.shipstation.com/hc/en-us/articles/360048748211-When-am-I-charged-for-the-labels-I-create) |
| Return-label billing varies by carrier: some labels charge at creation, while some carrier programs charge on use. | Return labels need their own cost and usage status, not a negative outbound-label record. | [Returns in ShipStation](https://help.shipstation.com/hc/en-us/articles/49977365632923-Returns-in-ShipStation) |
| The tracking API can return a normalized status, carrier tracking URL, estimated/actual delivery data, and event history. ShipStation’s webhook catalog includes tracking events. | Ingest tracking push events, retain the event history, and reconcile with a scheduled pull when events are late or missed. | [ShipStation tracking](https://docs.shipstation.com/tracking), [Labels API tracking operation](https://docs.shipstation.com/apis/openapi/labels), [webhooks](https://docs.shipstation.com/apis/openapi/webhooks) |
| ShipStation documentation currently describes API v2 as an early-release product with possible edge cases or missing features. | Wrap provider details behind MASEST’s adapter and maintain reconciliation/feature tests instead of coupling the UI directly to response shapes. | [ShipStation getting started](https://docs.shipstation.com/getting-started) |

#### Facts that should not be collapsed

- Shipment record created ≠ label purchased.
- Label purchased ≠ parcel handed to carrier.
- Tracking number assigned ≠ carrier acceptance.
- Label void approved ≠ carrier credit settled.
- Return label generated ≠ return label used.
- Tracking webhook received ≠ complete carrier event history.

### 4. Resend: transactional email and webhook facts

#### Sourced facts

| Fact | Operational meaning for MASEST | Primary source |
| --- | --- | --- |
| Resend supports idempotency keys for email and batch-email creation, retains them for 24 hours, requires the same payload for replay, and rejects conflicting concurrent use. | Key each lifecycle message by order, event, recipient, and template version; retain a permanent internal send ledger. | [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) |
| Resend webhooks are at-least-once. Duplicate deliveries can be identified by `svix-id`; events can arrive out of order; retries use a documented sequence if the endpoint does not return `200`. | Verify, deduplicate, store event timestamps, acknowledge quickly, then project the latest email state. | [Resend webhooks](https://resend.com/docs/webhooks/introduction) |
| Resend’s webhook verification requires the raw request body and the Svix ID, timestamp, and signature headers. | Do not parse and reserialize before signature verification. | [Verify Resend webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests) |
| Resend distinguishes message events such as sent, delivered, delivery delayed, bounced, complained, failed, and suppressed. | Accepted/sent is not delivered. Show communication failure without changing order or payment state. | [Resend event types](https://resend.com/docs/webhooks/event-types) |
| Email tags are included in webhook data and can carry application categories and identifiers. | Tag messages with non-sensitive order correlation and lifecycle type for admin filtering. | [Resend email tags](https://resend.com/docs/dashboard/emails/tags) |
| Resend maintains suppressions for hard bounces and complaints. Its deliverability guidance recommends a verified sending domain/subdomain, plain-text content, a monitored reply address, aligned links, and restrained tracking for transactional mail. | Surface suppression and delivery failures to staff; provide a customer-service fallback instead of silently retrying a permanently suppressed address. | [Email suppressions](https://resend.com/docs/dashboard/emails/email-suppressions), [deliverability insights](https://resend.com/docs/dashboard/emails/deliverability-insights), [domain setup](https://resend.com/docs/dashboard/domains/introduction) |

#### Facts that should not be collapsed

- Email API accepted ≠ message sent.
- Message sent ≠ delivered.
- Delivered ≠ read.
- Delivery failed ≠ order failed.
- Suppressed recipient ≠ permission to use another channel.

### 5. Marine commerce and product-selection patterns

The observations below describe the current information architecture and buying tools on official manufacturer/retailer pages. Their product claims are not adopted or validated.

#### Retail catalog patterns

- [West Marine’s maintenance department](https://www.westmarine.com/boat-maintenance/) and [boat-cleaning department](https://www.westmarine.com/boat-cleaning-supplies/) expose task categories before individual SKUs. Categories include routine wash/finish, bilge, hull, mold/mildew, metal, fabric, plastic, glass, and kits. Product lists add price, rating, size, comparison, and cart actions.
- West Marine’s [hull and surface cleaner guide](https://www.westmarine.com/boat-maintenance-guides/boat-hull-and-marine-surface-cleaners.html) uses surface and buildup as selector dimensions. This is a useful decision pattern, not chemical evidence for MASEST.
- [Defender’s boat-cleaning department](https://defender.com/en_us/boat-cleaning-supplies) uses a deep task taxonomy that includes bilge, soaps, canvas, deck, hull, inflatable, mold/mildew, multi-purpose, specialty, vinyl, wax, tools, and wood. Its product pages expose size, availability/fulfillment, shipping constraints, documents, and related categories.
- [Fisheries Supply’s cleaning category](https://www.fisheriessupply.com/maintenance/boat-cleaning-products) separates general, specialty, and surface-specific products and combines product type, size, stock, and education.

**Observed pattern:** broad marine stores answer “what job am I doing?” before “which bottle do I buy?” They then reduce uncertainty with filters, comparison, pack/availability, documents, and support.

#### Manufacturer product-page patterns

- [Star brite product pages](https://www.starbrite.com/products/star-brite-boat-wash-wax-blueberry-scent) use multiple images, separate surface-fit and soil/problem tags, offer sizes, and place features, directions, warnings, SDS, and related products in one page. Its [hull-cleaner page](https://www.starbrite.com/products/star-brite-instant-hull-cleaner-wipe-on-rinse-off-formula) shows the same structure for a narrower task.
- [3M Marine maintenance](https://www.3m.com/3M/en_US/marine-us/products/wax-and-maintenance/) divides the category into cleaners, waxes, material polishes, and accessories, then connects users to applications, SDS, and an expert-help path. Its [application hub](https://www.3m.com/3M/en_US/marine-us/applications/) uses visual job navigation.
- [TRAC Barnacle Buster](https://www.trac-online.com/products/descalers/trac-ecological-barnacle-buster) enters through a system symptom/application, then supplies pack sizes, material questions, technical documents, instructions, diagrams, and related system-cleaning products. [TRAC instructions](https://www.trac-online.com/get-support/instructions) and [illustrations](https://www.trac-online.com/get-support/illustrations) are organized around the job.
- [Dometic’s marine air-conditioning maintenance article](https://www.dometic.com/en-gb/article/marinejournal-how-to-properly-maintain-and-service-your-marine-air-conditioning-system) demonstrates a professional pattern: expert-authored maintenance guidance, a visible sequence, equipment context, and supporting imagery. Exact equipment manuals remain the authority for a specific system.

**Observed pattern:** focused manufacturers answer five questions on one path: what symptom/job, what asset/system, what material limits, what method/documents, and what to buy or whom to ask.

#### Image patterns

Across the official pages above, useful visual roles recur:

1. Category context: vessel, dock, bilge, deck, or service area.
2. Exact product pack shot: front label readable, size visible.
3. Surface or system context: what the product is being considered for.
4. Method: brush, circulation loop, controlled application, or another accurate step.
5. Diagram or instruction panel: useful where the system is hidden or complex.
6. Related-job imagery: a clear bridge to the next category, not generic lifestyle filler.

The strongest pages do not ask one hero image to perform all six jobs.

### 6. Marine environmental and claim constraints

#### Sourced facts

- EPA’s [national marina and boating management measures](https://www.epa.gov/nps/marinas-and-boating-national-management-measures) provide technical pollution-control guidance for marina and boating activities. Florida DEP’s [Clean Marina program](https://floridadep.gov/rcp/clean-marina/content/clean-marina-program) organizes current best-management-practice resources for marinas, boatyards, and retailers, including pressure-wash and recycling considerations.
- NOAA explains that cleaners, oils, paint, and other material carried by runoff can affect coastal water quality. Its practical boating guidance includes keeping oil and chemicals out of the water. See [NOAA ocean pollution activities](https://oceanservice.noaa.gov/education/tutorial_pollution/09activities.html) and [Florida Keys water quality](https://floridakeys.noaa.gov/ocean/waterquality.html).
- EPA’s [Safer Choice product search](https://www.epa.gov/saferchoice/products) is an exact-product listing. Outdoor/direct-release products are subject to the applicable [Safer Choice Standard](https://www.epa.gov/saferchoice/standard). A supplier, ingredient, or related product listing is not proof that a VertKleen SKU is certified.
- The FTC advises against broad, unqualified environmental-benefit claims. It also requires competent and reliable support for non-toxic claims as they relate to people and the environment. See the [FTC Green Guides summary](https://www.ftc.gov/business-guidance/resources/environmental-claims-summary-green-guides).
- EPA’s [minimum-risk pesticide conditions](https://www.epa.gov/minimum-risk-pesticides/conditions-minimum-risk-pesticides) define the conditions for a FIFRA section 25(b) exemption and prohibit label language that implies federal registration or EPA review. First-party [EMS product information](https://www.enviromfg.com/products1) and the [EMS Purgo technical sheet](https://www.enviromfg.com/s/Purgo-tds.pdf) distinguish Purgo from Purgo N and identify Purgo as a section 25(b)-exempt antimicrobial. EPA’s separate [Purgo N label](https://www3.epa.gov/pesticides/chem_search/ppls/082859-00002-20250512.pdf) carries EPA Reg. No. 82859-2; it does not establish registration or permitted claims for VertKleen Purgo.
- Florida’s regulator states that pesticide products offered for distribution or sale in the state must be registered, including minimum-risk pesticides. See [Florida pesticide product registration](https://www.fdacs.gov/Business-Services/Pesticide-Product-Registration).
- EPA’s [Vessel Incidental Discharge Act page](https://www.epa.gov/vessels-marinas-and-ports/vessel-incidental-discharge-act-vida) and [commercial vessel discharge standards](https://www.epa.gov/vessels-marinas-and-ports/commercial-vessel-discharge-standards) describe a specific commercial-vessel regulatory regime. It should not be generalized into a claim that a consumer cleaning product is discharge-approved.

#### Claim implications

1. “Marine,” “boatyard,” or “dock” context does not establish permission to discharge washwater or product to surface water.
2. “Biodegradable,” “non-toxic,” “safe for marine environments,” “EPA certified,” “EPA approved,” “disinfectant,” and percentage-kill claims each need exact-product, exact-condition authority.
3. Purgo N evidence must not be transferred to VertKleen Purgo.
4. Marine copy should state operational boundaries—follow the label, equipment/OEM instructions, site rules, and washwater controls—without implying regulatory approval.
5. Environmental practices can be taught as site-management guidance. They should not be converted into an unsupported product attribute.

---

## Part II — Recommendations

The following sections are recommendations, not claims about the current deployed implementation.

### 7. Target commerce architecture

#### 7.1 Preserve one canonical order, expose separate ledgers

Keep one MASEST order identity and one canonical line-item model. Project provider state into separate, append-only operational records:

| Ledger | Owns | Must not own |
| --- | --- | --- |
| Order | customer, lines, prices, tax, shipping plan, totals, customer-visible status | Raw provider state or email delivery |
| Payment | Stripe object IDs, payment method class, pending/succeeded/failed/disputed state | Shipment status |
| Customer refund | refund intent, amount, reason, Stripe refund ID/status, settlement/failure | Label-credit status |
| Fulfillment attempt | warehouse, immutable package plan, shipment/label IDs, label cost, label document, attempt status | Customer payment state |
| Label reversal/credit | void request, approval/denial, carrier message, expected credit, settled/denied credit | Customer-refund completion |
| Tracking | tracking number, carrier, normalized status, ETA, carrier URL, event history | Payment or refund state |
| Communication | lifecycle event, template version, recipient, Resend ID, sent/delivered/failed/suppressed state | Canonical order state |
| Audit/effect | actor, operation ID, request fingerprint, attempt count, provider response, retry/reconciliation state | Editable narrative replacing the actual records |

This allows the order page to say, for example: “Order canceled; customer refund pending; label void approved; carrier credit pending.” That is more accurate than one overloaded “refunded” status.

#### 7.2 Recommended customer-visible order states

Use a small, stable public vocabulary. Keep provider detail in the timeline and staff workspace.

| Public state | Entry condition | Customer explanation |
| --- | --- | --- |
| Order received | Canonical order exists; payment may still be pending | “We received your order.” Show payment state separately. |
| Payment pending | Delayed payment has not settled | “Payment is still processing. We will prepare fulfillment after confirmation.” |
| Paid / preparing | Payment is settled; fulfillment not handed to carrier | “Payment confirmed. We are preparing your order.” |
| Shipped | Carrier acceptance or approved equivalent handoff is recorded | Show carrier, tracking number, tracking link, latest scan, and ETA if supplied. |
| In transit | Carrier event indicates movement | Show latest scan and timestamp. |
| Delivery exception | Carrier reports exception/attempt/unknown route condition | Explain the latest carrier event and support path without guessing. |
| Delivered | Carrier reports delivery | Show delivery timestamp/location detail only when provided. |
| Cancellation requested | Request accepted for review but effects incomplete | Show which next step is pending. |
| Canceled | Canonical cancellation completed | Show refund state independently. |
| Refund pending | Stripe refund exists but is not settled | Show amount and initiation date; avoid promising an unsupported bank-posting date. |
| Refunded | Stripe refund succeeded | Show amount and completion date. |
| Refund needs attention | Stripe reports failure/requires action or reconciliation cannot resolve | Give a monitored support path and reference number. |

Do not send “shipped” merely because a label was purchased. Label purchase may trigger an internal fulfillment task, not the public shipment milestone.

#### 7.3 Recommended effect contract

Every external operation should have:

- stable internal operation ID;
- order/package/refund/message correlation;
- request fingerprint;
- provider idempotency key where supported;
- claimed, attempted, provider-accepted, reconciled, failed, and manually-resolved timestamps;
- retry classification: safe automatic retry, reconciliation only, or human decision;
- redacted request/response evidence;
- one actor and reason for consequential manual actions.

Return a fast success response to verified webhooks after durable ingestion. Process effects out of band. Webhook replay should become a no-op or a reconciliation signal, never a duplicate order, label, refund, or email.

#### 7.4 Recommended provider event projection

| Provider event/result | Canonical action | Customer action | Staff action |
| --- | --- | --- | --- |
| Stripe Checkout completed + paid | Mark payment settled once; release fulfillment | Payment-confirmed email/status | None unless totals/identity mismatch |
| Stripe Checkout completed + unpaid | Keep payment pending | Pending-payment status; no shipment promise | Monitor delayed-method outcome |
| Stripe async payment succeeded | Settle payment once; release fulfillment | Payment-confirmed email/status | Clear pending exception |
| Stripe async payment failed | Mark payment failed | Actionable failure email/status | Review inventory reservation/expiry |
| Stripe refund created/updated | Record refund pending/current status | Refund-initiated status/email once | Reconcile until terminal |
| Stripe refund succeeded | Mark exact amount settled | Refund-complete status/email once | Close refund effect |
| Stripe refund failed/requires action | Preserve failed state and reason | Support-oriented status; avoid provider jargon | Queue human action |
| ShipStation label completed | Persist label/tracking/cost and print task | Keep “preparing” | Show label-created event and print/reprint controls |
| ShipStation label void response | Record approval/denial and message | Usually no standalone email | Start carrier-credit reconciliation |
| ShipStation tracking accepted/in transit | Append event; update normalized state | Ship/in-transit status and applicable email | Show stale/missed-event timer |
| ShipStation exception/attempt | Append exact carrier event | Exception email only when actionable | Queue exception review |
| ShipStation delivered | Mark tracking delivered | Delivered status/email | Start post-delivery retention timer |
| Resend delivered/bounced/failed/suppressed | Update communication ledger only | No order-state mutation | Alert on critical unsent messages; offer manual contact workflow |

#### 7.5 Cancellation, refund, and label-credit sequence

Recommended decision sequence:

1. Lock one cancellation command with actor, reason, requested items/amount, and current fulfillment evidence.
2. Determine whether the parcel is unfulfilled, label-created, carrier-accepted, delivered, or already in return flow.
3. Stop future fulfillment work where still safe.
4. Request label void when eligible. Record approval/denial separately.
5. Queue the customer refund according to the approved cancellation policy. Do not present it as complete until Stripe reaches a terminal success state.
6. Reconcile the carrier label credit independently. A carrier credit failure should become an internal cost exception; it should not be mistaken for a failed customer refund.
7. Apply inventory/accounting effects exactly once after their approved trigger conditions.
8. Close the cancellation command only when all required customer-facing effects are terminal; keep non-customer carrier/accounting exceptions visible until resolved.

If a parcel has carrier acceptance or delivery evidence, require a human decision and, where appropriate, a distinct return authorization. Never silently void/recreate a label after handoff.

### 8. Admin CMS and order-operations workflow

#### 8.1 Separate content authority from transaction authority

Use one admin shell, but two explicit domains:

- **Catalog/content CMS:** canonical product, marine display alias, category/job routes, pack availability, claim records, labels/SDS/TDS, images, SEO, and publication workflow.
- **Commerce operations:** order, payment, package plan, label, tracking, refund, label credit, communication, reconciliation, and audit records.

CMS publication may change what future customers see. It must not rewrite historical order lines, labels, or receipts. Historical orders should retain a snapshot of the sold display name, canonical SKU, size, price, tax, shipping, and applicable document revision.

#### 8.2 Recommended product publication workflow

1. Select or create the canonical product/SKU owner.
2. Add a marine display name as a scoped alias; never create a second inventory identity solely for marketing.
3. Assign job, soil/deposit, surface/system, method, and “confirm first” fields from approved evidence.
4. Attach exact current label, SDS, TDS, tests, registrations/listings, revision dates, and source owner.
5. Build an allowed-claim set and prohibited-claim set. Each high-risk statement links to exact authority.
6. Add exact pack/quote availability and shipping constraints from commerce data.
7. Add required image roles and alt text; mark generated diagrams as illustrations.
8. Preview marine landing, product page, search, comparison, cart, checkout, receipt, and order page.
9. Require named marketing plus technical/regulatory approval for controlled claims.
10. Publish one version, regenerate dependent surfaces, and run link/image/structured-data/commerce smoke checks.
11. Keep rollback and an immutable publication audit.

Recommended CMS status vocabulary:

```text
draft -> evidence_incomplete -> technical_review -> marketing_review
      -> ready_to_publish -> published -> superseded
```

These CMS states are internal workflow controls only. Never surface them as customer-visible product gates. Keep published products—including Marine Antimicrobial—available while document revisions and broader-claim review proceed internally.

#### 8.3 Recommended order workspace

One order screen should contain:

1. **Header:** canonical order state, customer, total, age, risk/exception flags, owner.
2. **Items:** sold marine name, base VertKleen identity, SKU, size, quantity, lot if assigned, price, tax, fulfillment/refund quantity.
3. **Payment:** Stripe IDs, method class, paid/pending/failed/disputed state, exact refund amounts and states.
4. **Fulfillment:** signed checkout package plan, warehouse, address validation result, rate/service, package dimensions/weight, label attempts, document, cost.
5. **Tracking:** number, carrier URL, normalized status, latest scan, ETA, full event history, stale-event flag.
6. **Reversals:** cancellation command, label void, carrier credit, customer refund, restock, accounting effects.
7. **Communications:** expected lifecycle messages, Resend ID, sent/delivered/failed/suppressed state, safe resend action.
8. **Effect timeline:** immutable attempts, provider results, reconciliation, manual decisions, and audit actor.

#### 8.4 Admin action design

Consequential actions should open a preflight panel that shows:

- exact target order/items/amount/package;
- current payment and carrier state;
- eligibility and known blockers;
- effects that will be queued;
- effects that require later reconciliation;
- customer communications that will be sent;
- irreversible or carrier-dependent consequences;
- required reason and confirmation.

Actions should call canonical commands—purchase label, replace label, request cancellation, issue partial/full refund, create return label, resend lifecycle email—not let staff directly edit provider-derived status fields.

### 9. Product selection and cart management

#### 9.1 Selection before SKU

Ask the minimum questions needed to narrow safely:

1. **Job:** routine wash/finish, grease/oil, aluminum oxidation, drains/organic residue, mineral deposits, marine AC/coils, seawater circuit, or antimicrobial label-scoped use.
2. **Asset/system:** hull/topsides, non-skid/deck, bilge/engine area, trailer/lift/dock equipment, aluminum component, drain, coil, condenser/heat exchanger, or another named asset.
3. **Material/finish:** exact substrate and coating; include gelcoat, paint, aluminum alloy/finish, stainless, zincs, vinyl, rubber/sealants, glazing, and teak only as questions until compatibility is substantiated.
4. **Condition:** the soil/deposit and severity; no diagnostic certainty from a photograph alone.
5. **Operating context:** in-water versus hauled, washwater capture, site/yard rules, ventilation/access, and OEM instructions.
6. **Buying context:** one trial, recurring small pack, multiple vessels, or bulk/quote.

Return one of four outcomes: **recommended starting point**, **compare two candidates**, **expert-help path**, or **no supported match**. Keep all eight published products visible; do not force a product recommendation when material/system evidence is incomplete.

#### 9.2 Marine route model

The table below is a merchandising route derived from repository mappings. It is not independent proof of efficacy, material compatibility, environmental fit, or permitted claims.

| Buyer entry route | Marine display candidate | Canonical product | Required evidence before result copy |
| --- | --- | --- | --- |
| Mineral scale/rust job | Scale Buster | VertKleen HVAC HCR / VK-HCR-T16 | Exact marine assets, materials, dilution/method, deposit evidence, rinse/disposal limits |
| Marine AC/coil job | SeaVap Coil Kleener | VertKleen Descaler / VK-DESC | OEM/system method, metal compatibility, circulation/application procedure, exact finish condition |
| Drain/organic-residue job | Sea Drain Kleener | VertKleen HVAC CR / VK-CR2 | Exact drain use, soil scope, dilution/contact/rinse, material limits; no implied antimicrobial claim |
| Routine mixed-surface cleaning | MultiWash | VertKleen MultiWash / VK-MW | Exact approved surfaces, dilution, finish/rinse, exclusions |
| Oil/grease service-area job | Marine Degreaser | VertKleen CRHD / VK-CRHD | Exact soils/surfaces, containment, dilution/method, runoff handling |
| Aluminum cleaning/brightening job | AlumiBrite | VertKleen AlumiBrite / VK-ALB | Alloy/anodized/painted-surface limits, test-patch protocol, timing/rinse, finish evidence |
| Routine wash/finish job | Marine Wash & Wax | VertKleen Torque / VK-TRQ | Exact finishes, wash/finish method, compatibility, measurable/visible outcome support |
| Label-scoped antimicrobial job | Marine Antimicrobial | VertKleen Purgo / VK-PRG | Exact formula and current SDS/TDS/label, 25(b) conditions, state registration, named target/use/contact method, finished-product support |

#### 9.3 Product card contract

Every marine card should expose without a click:

- marine display name;
- canonical VertKleen identity and SKU;
- one approved job statement;
- “best for” asset/system tags;
- “works against” soil/deposit tags only when exact evidence supports them;
- “confirm first” material/OEM/environment note;
- available buyable sizes or clear bulk-quote status;
- price or starting price when purchasable;
- primary action: choose size/add, compare, or request technical help.

Avoid cards that rely on the name alone. “Scale Buster” does not tell a first-time buyer whether it is for a hull stain, an HVAC condenser, or a seawater circuit.

#### 9.4 Product detail contract

Recommended page order:

1. Display name, canonical identity, exact pack selector, price/quote, stock/lead-time state.
2. Approved job statement and one concise “choose this when” line.
3. Surface/system, soil/deposit, application method, and “confirm first” fields.
4. Three-to-five-step label-aligned starting method; OEM/manual gate where relevant.
5. Exact label, SDS, TDS, test/proof, certification/registration record, and revision date.
6. Pack yield/value only when dilution and job assumptions are sourced.
7. Authentic application images and clearly labeled diagrams.
8. Comparison against adjacent VertKleen options using factual selection dimensions, not unsupported superiority claims.
9. Related product or kit only when it solves a distinct next job.
10. Technical help, sample, and bulk quote paths.

#### 9.5 Cart contract

The cart should preserve the buyer’s selection context while transacting only canonical SKUs:

- marine display name plus base VertKleen product and SKU;
- size, quantity, unit price, line total, availability, and shipping class;
- the selector result or job label that led to the product;
- explicit quantity edit, remove, and short undo;
- persistent cart across navigation, authentication, refresh, and recoverable checkout errors;
- server-side revalidation of price, availability, address, shipping plan, tax, and quote-only rules before Checkout creation;
- no silent substitution or size change;
- estimated shipping with a clear finalization point;
- bulk variants routed to quote without destroying buyable lines;
- a clear policy when buyable and quote-only items coexist: split into “checkout now” and “quote request,” or intentionally convert all with customer consent;
- “save for later” and reorder only after a stable account identity exists;
- cross-sell limited to a verified adjacent job, never a conflicting chemical/application guess.

On Checkout failure or cancellation, restore the same validated cart and explain what changed. If Stripe recovery links are used, deduplicate reminders and apply marketing-consent rules.

### 10. Marine exposure strategy

#### 10.1 Information architecture

Recommended exposure hierarchy:

```text
Primary navigation: Industries -> Marine
Marine landing:
  1. Choose by job
  2. Featured marine HVAC and seawater-system route
  3. Shop all eight marine presentations
  4. Choose by surface/system
  5. Compare candidates
  6. Method, documents, washwater, and technical help
Product catalog:
  Marine filter + marine alias visible on mapped products
Product pages:
  Marine application module + canonical identity
Cart/order/reorder:
  Preserve marine display context + canonical SKU
Resources:
  Task guides, selector guides, OEM-gated system methods, case evidence
```

Expose marine in the main industry navigation, the product filter, applicable product pages, resource navigation, and search synonyms. Do not create duplicate product records or duplicate indexable pages with materially identical content. One canonical product can carry a distinct, useful marine application section and scoped alias.

#### 10.2 Landing-page sequence

1. **Hero:** selection promise, not universal product promise.
2. **Seven job cards:** wash/finish; oil/grease; aluminum; drains/organic residue; mineral deposits; marine AC and water-side systems; and label-directed antimicrobial cleaning.
3. **Featured system route:** marine HVAC/seawater maintenance with asset questions, OEM check, method overview, documents, and expert help.
4. **Eight-product grid:** display name, canonical identity, job, pack/quote, proof status, CTA.
5. **Surface/system selector:** material and equipment checks.
6. **Comparison:** adjacent choices and reasons to escalate.
7. **Method and environmental boundary:** test patch/OEM instructions/site rules/washwater control.
8. **Proof:** exact case records with starting condition, method, product revision, duration, and result; no unlabeled before/after images.
9. **Procurement:** small-pack trial, recurring supply, multi-vessel needs, bulk quote.
10. **Retention:** save selection, email a plan with consent, reorder, track, and ask for help.

#### 10.3 Original marine copy direction

The following language is original. It is a structural recommendation and still requires final product/brand review.

**Hero headline**

> Choose a marine cleaner by job, surface, and system.

**Hero body**

> Start with what you are cleaning: routine wash and finish, oily residue, aluminum, drains, mineral deposits, or marine AC and water-side equipment. Confirm the material and method, then choose an available size or request bulk pricing.

**Primary actions**

- Find my marine cleaner
- Shop all marine products
- Plan a marine HVAC clean
- Compare two products
- Get bulk pricing

**Selection reassurance**

> Not sure which route fits? Tell us the asset, material, buildup, current method, and whether the work is in the water or on the hard. We will identify a supported starting point—or tell you what must be checked first.

**Operational boundary**

> Follow the current product label, equipment-maker instructions, and site washwater rules. Test an inconspicuous area before wider use where the approved method requires it.

Do not publish generic “marine safe,” “eco-friendly,” “non-toxic,” “safe for all surfaces,” discharge-safe, certification, pathogen, or percentage-kill language without exact-product authority displayed near the statement.

#### 10.4 Retention without marketing friction

- Save the completed selector result to the account and order snapshot.
- Let customers compare two candidates and email/save the comparison with consent.
- Put “buy again” on delivered orders using the exact historical SKU/size, while revalidating current availability and price.
- Offer recurring-supply reminders after a completed order, not during high-risk selection.
- Provide one tracking page owned by MASEST with a carrier link as a secondary route.
- After delivery, ask whether the product matched the job before requesting a review or suggesting another product.
- Use support outcomes to improve selector questions; do not turn support notes into performance claims without evidence review.

### 11. Image strategy

#### 11.1 Image roles and acceptance criteria

| Role | Recommended subject | Acceptance criteria |
| --- | --- | --- |
| Marine hero | Real vessel, marina, or boatyard work context | Marine task immediately legible; no uncontrolled discharge; no false product use; useful crop at mobile/desktop sizes |
| Job card | One distinct job/asset per card | Wash, bilge/service grease, aluminum, drain, mineral/system scale, HVAC are visually distinguishable |
| Product pack shot | Exact current container and label | Label version correct; size clear; neutral background; color and proportions consistent |
| Application context | Exact approved asset/material | Method and PPE accurate; product not shown on an unapproved surface or energized equipment |
| System diagram | Marine AC/condenser/loop/drain route | Clearly labeled illustration; no implied OEM approval; flow and isolation points technically reviewed |
| Proof record | Documented before/method/after set | Same asset and framing; dates/method/product revision recorded; no generated or staged result passed off as field evidence |
| Procurement | Small packs, case/pallet/bulk context | Exact pack availability; no size shown as directly buyable when quote-only |

#### 11.2 Recommended image set

1. One authentic contained-wash hero at a boatyard or service area.
2. Six distinct task thumbnails matching the landing-page job routes.
3. Eight exact pack shots, one for each marine display presentation, tied to label revision metadata.
4. One marine HVAC system diagram plus one accurate service photo.
5. One controlled material-test image for aluminum and one for a finished marine surface.
6. One bilge/service-area image focused on containment and access, not product discharge.
7. One procurement image showing small-pack versus quote/bulk pathways accurately.
8. One documented case-evidence set only after the evidence record is complete.

#### 11.3 Image governance

- Store source, rights, date, subject, product/SKU, label revision, location, photographer/generator, edit history, and approval state.
- Generate responsive AVIF/WebP derivatives from one master; retain width/height to prevent layout shift.
- Write alt text for the task and decision value, not keyword repetition.
- Test focal crops at the actual card, hero, product-gallery, cart, and email sizes.
- Do not use one image for unrelated products merely because the colors match.
- Do not use generated foam, corrosion removal, brightening, microbial control, or before/after results as proof.
- Do not show chemicals entering surface water, an uncontained bilge, energized HVAC equipment, incorrect PPE, or an unidentified container.
- Use diagrams where hidden systems are hard to photograph; mark them “illustration” and have the method reviewed.

### 12. Order status, tracking, and lifecycle email plan

#### 12.1 Status-page requirements

The MASEST order-status page should show:

- order number and secure access control;
- sold item name plus canonical SKU/size;
- canonical public status and timestamp;
- payment and refund panels separated from fulfillment;
- package-level tracking number, carrier link, latest event, event time/location, ETA when supplied, and full scan history;
- label-created/preparing state distinct from shipped/carrier-accepted state;
- cancellation/return/refund progress with exact amounts;
- known exception and one support path;
- no internal provider errors, secrets, or speculative delivery promises.

If ShipStation or carrier tracking is stale, display the last confirmed event and timestamp. Do not invent movement or ETA. Run a reconciliation pull and show staff an age-based exception.

#### 12.2 Lifecycle email matrix

| Message | Send condition | Do not send when | Essential content |
| --- | --- | --- | --- |
| Order received | Canonical order persisted | Duplicate/replayed event | Lines, totals, address summary, payment state, status link |
| Payment pending | Delayed payment remains pending and notice is useful | Immediate paid order | What is pending; no shipment promise; status link |
| Payment confirmed | Payment becomes settled once | Checkout merely completed but unpaid | Amount, order, preparation state, status link |
| Payment failed | Terminal async failure | Transient webhook gap | Action path, cart/order reference, support |
| Shipped | Carrier acceptance/approved handoff, not label purchase alone | Only tracking number/label exists | Carrier, tracking, latest event, status link |
| Delivery exception | New actionable carrier exception | Same exception already communicated | Exact carrier language in plain terms, next step/support |
| Delivered | Carrier reports delivery | Unverified manual assumption | Delivery event/time where supplied, support, later feedback path |
| Cancellation requested | Command accepted | Cancellation already terminal | Requested scope, what happens next, status link |
| Order canceled | Canonical cancellation reaches customer-facing terminal state | Required customer effects unresolved | Canceled lines, refund state, status link |
| Refund initiated | Stripe refund exists | Internal draft only | Amount, initiation date, pending explanation, status link |
| Refund completed | Stripe refund succeeded | Refund only requested/pending | Amount and completion date; avoid unsupported bank timing |
| Refund problem | Stripe terminal failure/requires action | Automatic reconciliation still within normal window | Support route and reference; no provider stack trace |
| Return instructions/label | Approved return created | Return not authorized | Scope, steps, label/QR/document, carrier billing/use terms as applicable |

Use an idempotency identity such as `order:{order_id}:event:{event_id}:template:{version}:recipient:{recipient_hash}`. Keep sensitive values out of Resend tags; use order correlation and event category. Critical bounce, suppression, or failure should create a staff task without changing the order state.

### 13. Automation and reconciliation schedule

#### P0 — Integrity and bounded claims

1. Keep bounded Marine Antimicrobial positioning public; reconcile formula/SDS/TDS/label/state records internally and exclude unsupported EPA-adjacent, universal-safety/environmental, and generic kill claims from surrounding marketing copy.
2. Establish one order/effect state contract that explicitly separates payment, customer refund, fulfillment, label reversal/credit, tracking, and email.
3. Verify raw-body signatures, durable deduplication, fast acknowledgment, and replay handling for Stripe and Resend; verify equivalent ShipStation webhook authentication/correlation controls.
4. Confirm label-void and carrier-credit reconciliation by carrier/account billing model.
5. Prevent “label purchased” from producing a “shipped” customer state or email.

#### P1 — Selection, cart, and admin workflow

1. Add marine alias-to-canonical identity fields and enforce them through card, PDP, cart, order, email, and reorder.
2. Replace the four generic marine paths with the task/surface/system selector and eight-product comparison.
3. Add explicit mixed buy/quote cart behavior and preserve cart state after recoverable checkout failures.
4. Build the unified order workspace around commands, effect timelines, and reconciliation—not editable statuses.
5. Add internal claim/document/image publication states and named approvals to the catalog CMS; never expose those controls as customer-facing product gates.

#### P2 — Tracking, communication, and retention

1. Combine ShipStation tracking webhooks with scheduled stale-record reconciliation.
2. Publish the MASEST-owned order-status timeline and package-level tracking.
3. Implement the lifecycle email matrix with Resend idempotency and delivery telemetry.
4. Add save/compare/reorder flows and consented cart recovery.
5. Produce the authentic marine image set with rights, revision, and proof metadata.

#### P3 — Optimization

1. Measure selector start/completion, unsupported-match exits, marine card-to-PDP rate, comparison use, add-to-cart, quote start/completion, cart recovery, checkout completion, support contacts, reorder, and return/refund reasons.
2. Segment by job route and buyer type, not only page view.
3. Test hierarchy and wording only after identity, claims, and transaction telemetry are reliable.

### 14. Acceptance criteria for implementation work

#### Commerce and automation

- Duplicate, concurrent, delayed, and out-of-order Stripe/Resend events produce one canonical effect.
- Delayed payment cannot release fulfillment before settlement.
- Replayed label purchase cannot buy a second label.
- Label replacement preserves every attempt and never overwrites the prior provider record.
- Label void approval and carrier credit settlement are separately visible and reconcilable.
- Customer refund request, pending, success, and failure are separately visible.
- A label-only tracking number cannot trigger shipped state/email.
- Missed tracking webhook is repaired by reconciliation without duplicating customer emails.
- Resend bounce/suppression creates an admin exception without changing order status.
- Partial refund/cancel/return is item- and amount-bounded and safe on replay.
- Every manual resolution records actor, reason, evidence, and resulting effects.

#### Marine experience

- Every marine alias resolves to one canonical SKU across page, cart, Checkout, receipt, status, and reorder.
- Every product card answers job, candidate asset/system, pack path, and “confirm first” condition.
- The selector always leaves buyers with a clear adjacent-product or expert-help path without hiding any published marine product.
- Buyable and quote-only variants cannot be confused or silently mixed.
- Marine HVAC remains visible as a featured expert path while all eight presentations are discoverable.
- No high-risk claim publishes without exact-product authority and approval.
- No image implies discharge, compatibility, safety, efficacy, or proof beyond its evidence record.
- Mobile users can scan, compare, select a pack, preserve cart, and open tracking without horizontal overflow or hidden controls.

### 15. Recommended decision summary

#### Adopt now

- One canonical order plus separate provider/effect ledgers.
- Task/surface/system-first marine discovery.
- Marine alias plus canonical SKU on every transactional surface.
- Label-created versus carrier-accepted distinction.
- Separate customer refund and carrier label-credit workflows.
- Webhook ingestion plus scheduled reconciliation.
- Internal CMS claim/document/image controls.
- Authentic task photography and exact pack shots.

#### Hold pending evidence

- Claims beyond the bounded, label-directed Marine Antimicrobial positioning.
- EPA, certification, percentage-kill, universal-safety, biodegradability, non-toxic, or discharge-safe language.
- Material compatibility or OEM-fit language not tied to exact current authority.
- Before/after performance marketing without a complete case record.

#### Avoid

- Duplicate marine SKUs created only for marketing names.
- Provider status written directly into one overloaded order status.
- Marking an order shipped on label purchase.
- Marking a label credit complete on void approval.
- Marking a customer refund complete on refund creation.
- Treating Resend acceptance or send as delivery.
- Generic marine lifestyle imagery that does not help selection.
- Competitor or affiliate claims copied into VertKleen copy.

---

## Primary-source ledger

Sources were accessed 2026-08-23.

### Stripe

- [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Custom success page](https://docs.stripe.com/payments/checkout/custom-success-page)
- [Webhooks](https://docs.stripe.com/webhooks)
- [Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Refunds](https://docs.stripe.com/refunds)
- [Refund object](https://docs.stripe.com/api/refunds/object)
- [Abandoned carts](https://docs.stripe.com/payments/checkout/abandoned-carts)
- [Payment-event handling](https://docs.stripe.com/webhooks/handling-payment-events)

### ShipStation

- [Getting started](https://docs.shipstation.com/getting-started)
- [Create a shipment](https://docs.shipstation.com/shipments/create)
- [Labels API](https://docs.shipstation.com/apis/openapi/labels)
- [Void labels API](https://docs.shipstation.com/void-labels)
- [Void-label guide](https://help.shipstation.com/hc/en-us/articles/360026157751-Void-Labels)
- [Label charging](https://help.shipstation.com/hc/en-us/articles/360048748211-When-am-I-charged-for-the-labels-I-create)
- [Returns](https://help.shipstation.com/hc/en-us/articles/49977365632923-Returns-in-ShipStation)
- [Tracking](https://docs.shipstation.com/tracking)
- [Webhooks](https://docs.shipstation.com/apis/openapi/webhooks)

### Resend

- [Idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Webhook introduction](https://resend.com/docs/webhooks/introduction)
- [Webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Webhook event types](https://resend.com/docs/webhooks/event-types)
- [Email tags](https://resend.com/docs/dashboard/emails/tags)
- [Email suppressions](https://resend.com/docs/dashboard/emails/email-suppressions)
- [Deliverability insights](https://resend.com/docs/dashboard/emails/deliverability-insights)
- [Domain setup](https://resend.com/docs/dashboard/domains/introduction)

### Marine manufacturers and retailers

- [West Marine boat maintenance](https://www.westmarine.com/boat-maintenance/)
- [West Marine boat cleaning](https://www.westmarine.com/boat-cleaning-supplies/)
- [West Marine hull/surface selector guide](https://www.westmarine.com/boat-maintenance-guides/boat-hull-and-marine-surface-cleaners.html)
- [Defender boat-cleaning category](https://defender.com/en_us/boat-cleaning-supplies)
- [Fisheries Supply boat-cleaning category](https://www.fisheriessupply.com/maintenance/boat-cleaning-products)
- [Star brite Boat Wash + Wax](https://www.starbrite.com/products/star-brite-boat-wash-wax-blueberry-scent)
- [Star brite hull cleaner](https://www.starbrite.com/products/star-brite-instant-hull-cleaner-wipe-on-rinse-off-formula)
- [3M Marine wax and maintenance](https://www.3m.com/3M/en_US/marine-us/products/wax-and-maintenance/)
- [3M Marine applications](https://www.3m.com/3M/en_US/marine-us/applications/)
- [TRAC Barnacle Buster](https://www.trac-online.com/products/descalers/trac-ecological-barnacle-buster)
- [TRAC instructions](https://www.trac-online.com/get-support/instructions)
- [TRAC illustrations](https://www.trac-online.com/get-support/illustrations)
- [Dometic marine AC maintenance](https://www.dometic.com/en-gb/article/marinejournal-how-to-properly-maintain-and-service-your-marine-air-conditioning-system)
- [EMS product list](https://www.enviromfg.com/products1)
- [EMS Purgo technical sheet](https://www.enviromfg.com/s/Purgo-tds.pdf)

### Government and authoritative environmental sources

- [EPA marina and boating management measures](https://www.epa.gov/nps/marinas-and-boating-national-management-measures)
- [Florida DEP Clean Marina program](https://floridadep.gov/rcp/clean-marina/content/clean-marina-program)
- [NOAA ocean pollution activities](https://oceanservice.noaa.gov/education/tutorial_pollution/09activities.html)
- [NOAA Florida Keys water quality](https://floridakeys.noaa.gov/ocean/waterquality.html)
- [EPA Safer Choice products](https://www.epa.gov/saferchoice/products)
- [EPA Safer Choice Standard](https://www.epa.gov/saferchoice/standard)
- [FTC Green Guides summary](https://www.ftc.gov/business-guidance/resources/environmental-claims-summary-green-guides)
- [EPA minimum-risk pesticide conditions](https://www.epa.gov/minimum-risk-pesticides/conditions-minimum-risk-pesticides)
- [EPA Purgo N label](https://www3.epa.gov/pesticides/chem_search/ppls/082859-00002-20250512.pdf)
- [Florida pesticide product registration](https://www.fdacs.gov/Business-Services/Pesticide-Product-Registration)
- [EPA Vessel Incidental Discharge Act](https://www.epa.gov/vessels-marinas-and-ports/vessel-incidental-discharge-act-vida)
- [EPA commercial vessel discharge standards](https://www.epa.gov/vessels-marinas-and-ports/commercial-vessel-discharge-standards)
