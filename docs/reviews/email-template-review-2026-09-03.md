# MASEST email-template review

Review date: 2026-09-03. Scope: support/chat, order lifecycle, newsletters, lead nurture, and product advertising. Implementation status: approved designs integrated locally; no live email sent and no deployment performed.

## Outcome

Keep the current provider boundary:

- Cloudflare Email Service owns required transactional mail: support/chat, orders, shipping, refunds, billing, account, and staff notices.
- Amazon SES owns optional marketing transport: newsletters, field notes, lead nurture, product updates, and promotions. Supabase owns consent, suppression, and queues.

Replace the single visual model with one shared safety/brand foundation and three purpose-built renderers:

1. Conversation renderer — latest reply first, bounded context, direct email reply, online thread link, optional linked-order link.
2. Commerce renderer — event-specific status, itemization, totals, shipment/refund facts, order-status link, no promotion.
3. Marketing renderer — editorial/product composition, one dominant CTA, site navigation, preference controls, unsubscribe, and postal identity.

This is consolidation, not a parallel email system. Delivery, sanitization, sender policy, observability, and transport remain shared.

## Current-state review

### What already works

- `functions/_lib/email-template.js` centralizes the MASEST logo, basic layout, CTA safety, HTML sanitization, and transactional-versus-marketing footer behavior.
- `functions/_lib/support-email.js` already carries the important threading contract: stable subjects, `In-Reply-To`, `References`, thread-scoped signed `Reply-To`, canonical chat persistence, and inbound email replies.
- `functions/_lib/order-email.js` already owns order-item and shipment fragments.
- `functions/_lib/marketing-email.js` fails closed when SES config, category, idempotency, or unsubscribe content is absent.
- `functions/_lib/blog-newsletter.js` already supports approved media from `media.masest.co`.
- `functions/api/account/notification-prefs.js` correctly keeps transactional email mandatory while marketing and support-alert preferences remain user-controlled.

### What needs refinement

- One generic visual shell cannot make a support reply feel conversational, an order message feel operational, and a campaign feel editorial. The transport is consolidated; the presentation is over-generalized.
- Support mail currently emphasizes one quoted block. It should promote the latest unread message, show sender/time, retain only bounded prior context, and make both reply-by-email and online continuation obvious.
- Order confirmation/update senders compose generic sections around `emailLayout`. They need one commerce renderer with explicit event states: confirmation, payment, shipped, delivery, cancellation, and refund.
- Order status, tracking, refunded amount, payment destination, partial fulfillment, and remaining balance should be first-class typed fields instead of prose assembled by each caller.
- Marketing needs a reusable base header/footer plus editorial, lead, and product modules. It should not reuse transactional density or copy.
- Marketing identity now uses the owner-confirmed public postal address: 1361 Grand Cayman Dr, Merritt Island, FL 32952.

## Prototype set

The local gallery at `prototypes/email-template-review/index.html` includes:

- Support thread
- Order confirmed
- Shipment sent
- Refund issued
- VertKleen field-notes newsletter
- VertKleen CRHD product spotlight

The gallery supports desktop/mobile frames, light/dark simulation, HTML/plain-text views, and images on/off. It contains realistic sample data, no send control, no live recipient, and no tracking pixel.

## Recommended production interface

```js
renderSupportEmail({ thread, message, priorMessages, participant, order, audience })

renderCommerceEmail({
  event: 'confirmed' | 'payment' | 'shipped' | 'delivery_update' | 'delivered' | 'canceled' | 'refunded',
  order,
  payment,
  fulfillment,
  refund,
})

renderMarketingEmail({
  kind: 'newsletter' | 'lead_nurture' | 'product' | 'promotion',
  campaign,
  modules,
  recipientContext,
})
```

All three consume shared primitives for brand tokens, safe URLs, escaped text, approved-media URLs, multipart bodies, header policy, and footer identity. They return `{ subject, previewText, html, text, headers }` to the existing delivery layer.

## Implemented integration

1. Shared email primitives now own official logo, safe URLs, responsive shell, required-service footer, provider-neutral marketing footer, and confirmed business identity.
2. Contract tests cover unsafe URLs/media, bounded support history, multipart output, order/refund facts, and SES one-click unsubscribe headers.
3. Support delivery now uses the conversation renderer while preserving signed reply routing, `In-Reply-To`, `References`, and canonical chat persistence.
4. Order confirmation, manual/automatic tracking, cancellation, refund, and return-label callers now use the commerce renderer.
5. Newsletter, blog, offer, and review-reminder callers now use the marketing renderer and authored plain text.
6. SES validation requires `{{unsubscribe_url}}`; browser copies use signed `{{web_view_url}}` links. Both bind to the exact recipient.
7. Remaining account, quote, billing, and internal notices inherit the upgraded provider-neutral transactional shell.
8. Consent-gated quote nurture uses durable scheduled rows; later messages stop automatically after opt-out.

## Research

See `docs/research/email-template-patterns-2026-09-03.md` for source-grounded patterns and delivery constraints.
