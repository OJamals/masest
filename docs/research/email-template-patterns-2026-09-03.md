# MASEST email-template patterns

Research date: 2026-09-03. Scope: visual/content patterns plus delivery contracts for support, commerce, and marketing email. Sources are standards or first-party vendor documentation. This is design/engineering guidance, not legal advice.

## Decisions

1. Build HTML prototypes, not OpenPencil mockups. Email HTML is the artifact: it exposes real table-layout, inline-CSS, dark-mode, image-blocking, mobile, and plain-text constraints. Put templates in a browser-only review harness; keep each email body production-compatible and free of review JavaScript.
2. One shared MASEST shell, three intentionally different systems:
   - **Conversation:** compact, person-to-person, email-replyable, thread-aware.
   - **Commerce:** status-first, itemized, factual, no promotion.
   - **Marketing:** editorial/product-led, image-rich but text-complete, one primary CTA, compliant preference controls.
3. Cloudflare sends support, order, account, and other transactional mail. Its Email Service is documented for transactional email and supports sending plus inbound routing. Keep newsletters, lead nurture, and ads in Klaviyo unless Cloudflare expressly permits bulk marketing later. [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)
4. Do not add product promotions to support/order mail. Gmail recommends separate sender addresses per message category and says not to mix content types; FTC treats mixed mail as commercial when subject/body presentation makes promotion primary. [Gmail sender guidelines](https://support.google.com/mail/answer/81126?hl=en) · [FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)

## 1. Support/chat notification

### Pattern

```text
[MASEST logo]

New message from Maya at MASEST                 [Order MST-00000005]
Re: Product compatibility for condenser coils

┌ Maya · Customer Support · 10:42 AM ────────────────┐
│ Yes—VertKleen 125 is compatible with ...           │
└─────────────────────────────────────────────────────┘

[ View conversation ]
Reply to this email to respond. Your reply appears in the same conversation.

Earlier in this conversation
  You · 10:31 AM
  Is this safe for aluminum coils?

Account  ·  Order MST-00000005  ·  Support
```

Use latest unread staff/customer message as focus. Show at most two prior messages as subdued context; never re-emit the entire growing transcript. Intercom includes a conversation summary, allows direct reply, groups bursts into one notification, and supports returning to the online conversation; this is the closest first-party reference pattern. [Intercom conversation notifications](https://www.intercom.com/help/en/articles/250-push-email-chat-and-post-notifications-for-customers) · [Intercom online-conversation link](https://www.intercom.com/help/en/articles/3527623-sending-email-notifications-without-conversation-content-or-history)

### Required delivery contract

- Initial subject: `MASEST Support · Order MST-00000005 · Product compatibility`. Follow-ups retain the subject; only genuine replies may use `Re:`. Gmail prohibits fake reply prefixes, while RFC 5322 permits `Re:` for an actual reply. [Gmail sender guidelines](https://support.google.com/mail/answer/81126?hl=en) · [RFC 5322 §3.6.5](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.5)
- Each outbound email gets a unique `Message-ID`; each reply supplies `In-Reply-To` with its parent ID and `References` with the chain. RFC 5322 defines these fields as the thread relationship. [RFC 5322 §3.6.4](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.4)
- Persist per support thread: `root_message_id`, `latest_message_id`, bounded `references`, recipient identity, and reply token. De-duplicate inbound messages by `Message-ID`.
- Use a thread-scoped `Reply-To`, e.g. `reply+<thread-id>.<signed-token>@reply.masest.co`, as routing fallback. Zendesk similarly combines RFC headers, an encoded ID, and an encoded reply address to recover the ticket reliably. [Zendesk threading logic](https://support.zendesk.com/hc/en-us/articles/4408821051034-Why-do-emails-thread-to-the-wrong-ticket)
- Cloudflare Email Service can set `In-Reply-To` and `References`, auto-generates `Message-ID`, returns `messageId` after send, and exposes inbound headers/raw MIME to Email Workers. `Reply-To` is a first-class send field. [Cloudflare header reference](https://developers.cloudflare.com/email-service/reference/headers/) · [Cloudflare Workers send API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) · [Cloudflare inbound Workers API](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/)
- Inbound acceptance must validate signed reply token, sender ↔ conversation participant, dedupe key, and thread/order ownership before writing. Store raw transport metadata separately from sanitized visible content. Strip quoted history/signature from the visible message, but retain raw MIME for diagnostics.
- `View conversation` deep-links to authenticated canonical support chat. Order chip links to that order. Email remains replyable; online view is an equal, not exclusive, path.
- Burst control: optional 1–3 minute debounce for consecutive unread messages from same thread, then send one digest. Intercom uses three minutes and consolidates replies; copy principle, not exact timing. [Intercom conversation notifications](https://www.intercom.com/help/en/articles/250-push-email-chat-and-post-notifications-for-customers)

No unsubscribe control belongs in support mail. It is mandatory transactional communication. Include `Manage email settings` only if its page clearly says support/order notices cannot be disabled.

## 2. Order lifecycle

Shopify uses event-specific notifications for order confirmation, shipping confirmation/update, cancellation, refund, out-for-delivery, and delivery. Default order/shipping templates link to an online order-status page. [Shopify customer notifications](https://help.shopify.com/en/manual/fulfillment/setup/notifications/customer-notifications) · [Shopify order-status links](https://help.shopify.com/en/manual/fulfillment/setup/order-status-page/setting-up-order-status-updates)

### Shared commerce anatomy

```text
[MASEST logo]                                      ORDER MST-00000005

[status eyebrow]
Clear outcome headline
One-sentence next step / expectation

[ View order / Track shipment / View refund ]

Order summary
[product image] Product name
                SKU · pack/size · Qty
                                                $0.00
Subtotal / shipping / tax / credit / total

Delivery or refund details
Ship-to / method / tracking / estimated date
or refunded amount / destination / expected timing

Need help? Reply to this email or [contact support].

MASEST · transactional notice · Privacy · Account
```

Order number and online-status CTA stay in every lifecycle email. Shopify makes status links standard in order, shipping-confirmation, and shipping-update templates; Stripe receipts likewise provide a browser link and immutable receipt number. [Shopify order-status links](https://help.shopify.com/en/manual/fulfillment/setup/order-status-page/setting-up-order-status-updates) · [Stripe receipts](https://docs.stripe.com/receipts)

### Prototype states

1. **Order confirmed** — `We received your order`; order date, payment state, all line items, totals, billing/shipping, chosen shipping method, order CTA. State clearly whether payment is captured, pending, NET terms, or quote-backed.
2. **Payment update / receipt** — amount, date, payment method tail, receipt/order numbers, `View receipt`. Avoid duplicate notices: MASEST owns order state; Stripe can own payment receipt. Stripe receipts reflect current charge/refund state and support a hosted browser view. [Stripe receipts](https://docs.stripe.com/receipts)
3. **Shipment sent** — `Your order is on the way`; carrier, tracking number, ETA/range, destination city/state, only items in this shipment, `Track shipment`. Support partial/multiple fulfillments rather than implying whole-order shipment; Shopify models multiple fulfillments on its order-status page. [Shopify order-status pages](https://help.shopify.com/en/manual/fulfillment/setup/order-status-page/understanding-order-status-pages)
4. **Shipping update / out for delivery / delivered** — lead with changed state and timestamp; retain tracking CTA; minimize repeated order detail.
5. **Canceled** — canceled items, reason when appropriate, payment/refund consequence, action needed, order CTA.
6. **Refund issued** — refunded items, exact amount, destination method, issued date, expected bank timing, remaining order total for partial refunds, receipt/order CTA. Stripe can automatically send refund receipts to original charge email. [Stripe receipts](https://docs.stripe.com/receipts)

Transactional footer: logo/name, support contact, privacy/account links, physical business identity if desired. No `Unsubscribe`, product carousel, coupon, or sales CTA. Gmail classifies receipts as transactional and recommends separating subscription and non-subscription sender addresses. [Gmail subscription guidelines](https://support.google.com/mail/answer/15263077?hl=en)

## 3. Newsletter, lead nurture, product/ad

### Base marketing shell

```text
Preheader: useful campaign-specific preview          [View in browser]
[MASEST logo]       Products · Industries · Resources

[optional editorial/product image]
Outcome-led headline
2–3 concise lines of proof-aware copy
[ Primary CTA ]

Supporting module(s):
- two product cards, OR
- one case/use application + one article, OR
- three-link newsletter digest

Need application help? [Talk to a specialist]

[MASEST logo]
Products · Website · Blog · Contact
Why you received this email + recipient/list identity
Manage email settings · Unsubscribe
Privacy · valid physical postal address
```

Klaviyo recommends a reusable base template with body placeholders plus footer containing unsubscribe, business address, privacy, website, social, and preference links. Its tags support `Manage preferences`, `Unsubscribe`, and `Web view`. [Klaviyo base template](https://help.klaviyo.com/hc/en-us/articles/115005083887) · [Klaviyo personalization tags](https://help.klaviyo.com/hc/en-us/articles/4408802648731)

### Prototype variants

- **Newsletter / field notes:** restrained editorial hero; three scannable stories: application insight, product/industry update, latest blog article. Primary CTA `Read field note`; each secondary story gets text link. No fake magazine density.
- **Product spotlight:** one product family; use-case headline, real product/application image, 3 factual benefits/spec anchors, pack/size or `Request quote`, primary `View product`; related article below.
- **Lead nurture:** problem → short technical insight → proof/source → `Talk to a specialist` or `Explore solution`; one relevant product/article pair. Avoid premature discount language.
- **Promotion/ad:** offer terms and expiration adjacent to headline/CTA; clear `Shop products`; concise product row. Subject and sender accurately identify promotion. FTC requires accurate headers/subject, ad identification, physical address, and visible opt-out. [FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)

Use logo and primary navigation links to `masest.co`, `/products`, and `/blog`; choose one dominant CTA. Mailchimp’s first-party guidance calls for branded header, concise/scannable hierarchy, whitespace, clear CTA, and compliant footer. [Mailchimp newsletter design](https://mailchimp.com/resources/email-newsletter-design/) · [Mailchimp email design](https://mailchimp.com/resources/email-design/)

### Footer + subscription contract

- Every marketing message: visible `Unsubscribe`, `Manage email settings`, reason/permission reminder, MASEST identity, valid physical postal address, website, privacy. Mailchimp requires unsubscribe + physical address and recommends permission/preference links. [Mailchimp footer requirements](https://mailchimp.com/help/about-campaign-footers/) · [Mailchimp custom footer](https://mailchimp.com/help/customize-your-footer-content/)
- Keep unsubscribe visible, normal-sized, and high-contrast. Klaviyo recommends easy-to-scan link text and accessibility contrast. [Klaviyo unsubscribe guidance](https://help.klaviyo.com/hc/en-us/articles/115006054267)
- Add RFC 8058 headers: `List-Unsubscribe: <https://...opaque-token...>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; DKIM must cover both. Endpoint accepts unauthenticated POST without cookies, redirects, or extra interaction. [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html)
- Gmail requires one-click plus a visible body link for bulk marketing, and recommends honoring within 48 hours. FTC requires opt-out within 10 business days and mechanism availability for at least 30 days. Process immediately. [Gmail sender guidelines](https://support.google.com/mail/answer/81126?hl=en) · [FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- Email settings page: transactional/support/order = visibly mandatory; marketing master toggle + newsletter/product/industry-interest controls. `Unsubscribe` disables marketing, never transactional.

## 4. Shared HTML/accessibility contract

- Centered single-column content, `max-width: 600px`; fluid width below it. Mailchimp designs templates at no more than 600px for broad client fit. [Mailchimp template widths](https://mailchimp.com/help/about-template-widths/)
- Presentation tables + inline critical CSS; no JavaScript; absolute HTTPS asset URLs. Many clients strip document-level elements/CSS and JavaScript. [Mailchimp HTML email](https://mailchimp.com/help/about-html-email/) · [Mailchimp HTML mistakes](https://mailchimp.com/help/common-html-mistakes/)
- Real text for all critical facts. Images support—not contain—the message. Every informative image gets concise alt text; decorative images use empty alt. Keep logical heading order, meaningful links, sufficient contrast. [Klaviyo accessibility](https://help.klaviyo.com/hc/en-us/articles/360034711931) · [Mailchimp accessibility](https://mailchimp.com/help/accessibility-in-email-marketing/)
- Multipart `text/html` + intentionally authored `text/plain`. Mailchimp documents multipart alternative as required for recipients/clients that cannot display HTML. [Mailchimp HTML email](https://mailchimp.com/help/about-html-email/)
- Dark-mode resilient: logo works on light/dark backgrounds, high-contrast text, solid-fill buttons, underlined text links, no border-only CTA, test client inversion. Klaviyo and Mailchimp both warn that clients transform dark mode differently. [Klaviyo dark mode](https://help.klaviyo.com/hc/en-us/articles/360049181631) · [Mailchimp dark mode](https://mailchimp.com/help/design-emails-dark-mode/)
- Body proposal: 16px/1.5; minimum 14px metadata; 44px-high CTA; 24px mobile side padding; web-safe fallback stack. Product image dimensions declared to reduce layout shifts.
- Set campaign-specific preview text so clients do not expose `View in browser` or footer copy as inbox preview. [Mailchimp preview text](https://mailchimp.com/help/about-preview-text/)

## 5. Prototype review page

Create one local, non-sending page with:

- Left rail: `Chat`, `Order confirmed`, `Payment`, `Shipped`, `Canceled`, `Refunded`, `Newsletter`, `Product`, `Lead nurture`, `Promotion`.
- Controls: desktop/mobile frame; light/dark preview; images on/off; HTML/plain text; data-state switch (paid vs NET, single vs partial shipment, full vs partial refund).
- Main pane: realistic MASEST sample rendered at 600px and 375px. Use official logo and existing site type/color tokens; use real product/blog imagery already approved in repo.
- Side pane: subject, preview text, From, Reply-To, category/provider, CTA destination, required headers, required variables.
- No send button, live recipients, tracking pixels, or remote mutations.

Recommended first review set: support thread, order confirmation, shipment, refund, newsletter digest, product spotlight. Remaining variants inherit approved shells.

## 6. QA gate before implementation

1. Validate every template with missing optional data, long names/addresses, 1/20 line items, partial fulfillment/refund, quote-only/NET terms.
2. Render 600px + 375px, light/dark, images disabled, 200% zoom.
3. Test Gmail web/mobile, Outlook web/Windows, Apple Mail/iOS, Yahoo; Shopify lists these families among supported commerce-notification clients. [Shopify supported clients](https://help.shopify.com/en/manual/fulfillment/setup/notifications/customer-notifications)
4. Confirm all CTAs, order/support ownership gates, signed expiring browser links, reply ingestion, duplicate suppression, and escaped user content.
5. Inspect raw message: SPF/DKIM/DMARC, unique `Message-ID`, correct `In-Reply-To`/`References`, thread `Reply-To`, multipart bodies; marketing adds DKIM-covered RFC 8058 headers.
6. Confirm accessibility: source order, headings, alt text, meaningful links, contrast, keyboard-reachable web destinations.
7. Send only to test inboxes after prototype approval; verify actual inbox threading and reply-to-chat registration end to end.
