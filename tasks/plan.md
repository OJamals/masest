# Implementation Plan: Unified Order, Fulfillment, Finance, and Support Console

## Overview

Build one staff Orders console that becomes the primary operating surface for orders and quotes. It will prioritize work that needs attention, support independent inline expansion for multiple orders, expose most fulfillment and communication actions without leaving the queue, and retain a focused full-order record for uncommon or high-risk operations. The console will coordinate existing ShipEngine, Stripe, QuickBooks Online (QBO), Resend, CMS/CRM, and Customer Support capabilities rather than create parallel data paths.

This plan preserves the approved Concept A direction while fixing the expanded-row shading defect. Planning is intentionally separate from implementation. No production behavior changes until this plan is approved.

## Confirmed Product Contract

- Orders and quotes live in one Orders console. Default priority: paid/unshipped orders, fulfillment exceptions, unread order messages, then pending quotes.
- Clicking a row outside its quick-action controls toggles that row's inline details. Multiple rows may remain expanded. Opening one row never collapses another.
- Expanded details include customer/contact, shipping address, items, payment, shipment, tracking, provider timeline, messages, and common management actions.
- Expanded surface owns one continuous background/border across full row width. No overlay, fixed-height clipping, partial tint, or blocked later rows.
- `Manage` opens a full order record inside the admin application. Back navigation restores queue filters, scroll position, and expanded rows.
- Individual order records include direct messaging. Order-linked messages also appear in centralized Customer Support and generate both an order alert and Customer Support unread alert.
- Customer Support renders order-linked context as `[Order <reference>] / [User]` and normal chat as `[User / Email]`. Every order-linked message includes a direct order link.
- Admin/owner shared header removes cart and shows explicit links for User management, Admin, Orders, and Customer Support. Buyer navigation and cart remain unchanged.
- Provider health is a slim console-level Stripe/ShipEngine/QBO/Resend status strip. Green/yellow/red states always include text/icon. Provider controls open the existing detailed Integrations management surface; integrations are not an order-list column.
- Tracking is webhook-driven with controlled refresh/reconciliation. Cancellation automatically attempts label void and payment refund where eligible. General refunds remain explicit manual staff actions in this phase.

## Architecture Decisions

1. **One canonical order state, no UI-only status.** Orders, `order_shipments`, `shipment_events`, `order_financial_entries`, integration effects, and support `messages` remain authoritative. Queue badges are derived summaries.
2. **One canonical conversation.** `messages.order_id` supplies optional order context; no second order-chat table or disconnected thread system. Order and Customer Support views render the same records.
3. **Scoped unread semantics.** Opening an order message panel marks only buyer messages for that `order_id` as staff-read. Opening a full company thread may mark the company thread read. Clearing one order alert must not clear another order's alert.
4. **Stable deep links.** Canonical staff order link: `admin.html?order=<uuid>#orders`. Queue view: `admin.html?view=orders#orders`; quotes view: `admin.html?view=quotes#orders`. Legacy `#quotes` and `#integrations` routes remain compatible.
5. **Independent expansion state.** A `Set<orderId>` owns expanded rows. Refetch/rerender preserves IDs still present. Quick-action handlers stop row toggle propagation.
6. **Batched summaries.** Order alerts, unread counts, last message, shipment exception, and provider state are loaded in bounded/batched queries or a database RPC/view. No per-row API requests.
7. **Resumable lifecycle orchestration.** Cancellation uses an idempotent command plus existing integration effect/outbox/ledger mechanisms. Partial provider failure remains visible and retryable; never report all-cancelled when only one provider succeeded.
8. **Webhook-first tracking.** ShipEngine tracking webhooks update canonical shipment events. Manual refresh is a controlled reconciliation path, not periodic browser polling.
9. **Authoritative role check.** Staff header changes only when `/api/account/me` returns `can_admin === true`; never infer staff from client profile text or email alone.
10. **Incremental monolith reduction.** Extract small pure state/render/command modules from `js/admin/orders.js` as each slice lands. Remove replaced code in the same slice; do not create a second console beside the old one.
11. **Server-only provider credentials.** Stripe, ShipEngine, QBO, Resend, Supabase service credentials, webhook secrets, and restricted keys remain Cloudflare secrets/server environment only.
12. **Minimal artifacts.** `tasks/plan.md` and `tasks/todo.md` are the canonical implementation records. Replace these files as scope changes; do not accumulate extra planning logs or handoff directories.

## Dependency Graph

```text
Console URL/state contract
├── staff navigation
├── inline queue shell
│   ├── batched order summaries
│   ├── order-linked messages
│   ├── provider health strip
│   └── quotes subview
└── full order record
    ├── tracking/reconciliation
    ├── cancellation lifecycle
    └── fulfillment/returns actions

Message context contract
├── order alert counts
├── order composer
└── Customer Support labels + direct links

Lifecycle command contract
├── ShipEngine label void
├── Stripe refund
├── QBO reconciliation effect
└── Resend notification effect
```

## Provider Constraints

- ShipEngine recommends tracking webhooks instead of polling; webhook authenticity uses the documented signed-request flow. Source: [ShipEngine webhooks](https://www.shipengine.com/docs/webhooks/).
- Label void/refund eligibility is carrier-dependent and asynchronous. A successful void request is not equivalent to an immediate carrier refund. Source: [ShipEngine voiding labels](https://www.shipengine.com/docs/labels/voiding/).
- Stripe supports partial refunds up to the unrefunded payment total. Amounts use the currency's smallest unit. Source: [Stripe create refund](https://docs.stripe.com/api/refunds/create).
- Stripe mutation retries require stable idempotency keys. Source: [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).
- Stripe lifecycle changes must be reconciled from signed asynchronous webhooks, not browser success state. Source: [Stripe webhooks](https://docs.stripe.com/webhooks?lang=node).
- QBO webhook handlers should acknowledge quickly, process asynchronously, tolerate out-of-order delivery, and use Change Data Capture as reconciliation. Source: [QuickBooks Online webhook best practices](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/best-practices).
- Resend email creation supports idempotency keys; webhook ingestion should verify signatures and deduplicate event IDs. Sources: [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), [Resend webhook ingester](https://resend.com/docs/webhooks/ingester).

## Task List

### Phase 1: Contracts and Staff Navigation

## Task 1: Define order-console state and deep-link contract

**Description:** Add a small pure state module and RED tests for queue view, quote view, full-record route, independent expanded IDs, filter preservation, and action-click exclusion. This contract prevents URL and interaction rules from being scattered through `orders.js`.

**Acceptance criteria:**
- [ ] `?order=<uuid>#orders`, `?view=quotes#orders`, and legacy hashes resolve deterministically.
- [ ] Expansion state supports 2+ simultaneously open rows and survives data refresh for still-visible IDs.
- [ ] Row body clicks toggle one row; quick-action clicks never toggle it.

**Verification:**
- [ ] `node --test tests/order-console-state.test.mjs`
- [ ] `npm run check`

**Dependencies:** None

**Files likely touched:**
- `js/admin/order-console-state.js`
- `tests/order-console-state.test.mjs`
- `tests/admin-information-architecture.test.mjs`

**Estimated scope:** Medium (3 files)

## Task 2: Replace staff dropdown navigation with explicit role-aware header actions

**Description:** Render User management, Admin, Orders, and Customer Support as first-class header actions for staff. Remove cart and the nested Admin dropdown entry only for authoritative staff sessions. Preserve current buyer menu and cart.

**Acceptance criteria:**
- [ ] `can_admin === true` renders four explicit staff destinations, no cart, and no duplicate Admin dropdown entry.
- [ ] Non-staff signed-in and signed-out navigation remains unchanged, including cart behavior.
- [ ] Keyboard focus, active state, notification badges, mobile overflow, and accessible names remain usable.

**Verification:**
- [ ] `node --test tests/account-nav.test.mjs tests/admin-role-aware-ui.test.mjs`
- [ ] Direct Chrome QA at desktop and narrow viewport for staff and buyer sessions.

**Dependencies:** Task 1

**Files likely touched:**
- `js/account-nav.js`
- `js/main/chrome.js`
- `tests/account-nav.test.mjs`
- `tests/admin-role-aware-ui.test.mjs`

**Estimated scope:** Medium (4 files)

### Checkpoint A: Contracts and navigation

- [ ] Focused tests pass.
- [ ] `npm run check` passes.
- [ ] Buyer and staff Chrome sessions show correct, non-duplicated navigation.
- [ ] Human review before queue replacement.

### Phase 2: Priority Queue and Inline Management

## Task 3: Build accessible inline order-row shell

**Description:** Extract order row/surface rendering from the current card markup. Implement a full-width expanded shell using semantic controls and independent state. This slice fixes the approved prototype's shading defect before adding new data or actions.

**Acceptance criteria:**
- [ ] Expanded header, action region, and detail region share one continuous full-width surface and border.
- [ ] Two or more expanded orders remain open; subsequent orders remain visible, scrollable, and clickable.
- [ ] Loading, empty, error, focus, hover, selected, and reduced-motion states meet existing design tokens and WCAG keyboard expectations.

**Verification:**
- [ ] `node --test tests/order-console-state.test.mjs tests/admin-panel-spacing.test.mjs`
- [ ] Direct Chrome QA: open three rows, invoke quick actions, scroll to following orders, test 1440 px/1024 px/390 px widths.

**Dependencies:** Task 1

**Files likely touched:**
- `js/admin/order-queue.js`
- `js/admin/orders.js`
- `admin.html`
- `tests/admin-panel-spacing.test.mjs`

**Estimated scope:** Medium (4 files)

## Task 4: Add batched order-priority and unread-message summaries

**Description:** Extend the admin order list response with stable priority inputs: paid/unshipped state, fulfillment exception, unread order-message count, latest message snippet/time, pending quote relevance, and shipment attention. Add the missing order-message index. Keep list retrieval bounded and free of N+1 calls.

**Acceptance criteria:**
- [ ] One list request returns all fields required for queue sort and badges for up to the existing page limit.
- [ ] Unread counts are grouped by `order_id`; company messages without `order_id` do not become order alerts.
- [ ] Query plan uses an order-message index or bounded RPC/view and performs no per-order network requests.

**Verification:**
- [ ] `node --test tests/admin-orders-api.test.mjs tests/admin-order-message-summary.test.mjs`
- [ ] Apply migration to local/test database and inspect query plan against a seeded 100-order/5,000-message fixture.

**Dependencies:** Task 1

**Files likely touched:**
- `functions/_lib/admin-order-summaries.js`
- `functions/api/admin/orders.js`
- `supabase/schema-order-message-context.sql`
- `tests/admin-order-message-summary.test.mjs`
- `tests/admin-orders-api.test.mjs`

**Estimated scope:** Medium (5 files)

## Task 5: Connect priority sorting, quick status, and quick actions

**Description:** Feed Task 4 summaries into Task 3 queue. Default sort ranks paid/unshipped and exception orders first, then unread order messages, pending quotes, and recency. Preserve search/filter state and existing safe actions while moving them into the new row.

**Acceptance criteria:**
- [ ] Default priority is deterministic and visible; staff can switch to date/status sorting without losing filters.
- [ ] Compact row shows quote, payment/amount, fulfillment/shipping, tracking, and order-alert states without an integrations column.
- [ ] Existing label/rate/save/refund controls continue to work, show pending/success/error feedback, and do not collapse rows.

**Verification:**
- [ ] `node --test tests/order-console-state.test.mjs tests/admin-orders-ui.test.mjs`
- [ ] Direct Chrome QA with paid/unshipped, pending quote, unread-message, shipped, and exception fixtures.

**Dependencies:** Tasks 3, 4

**Files likely touched:**
- `js/admin/order-queue.js`
- `js/admin/orders.js`
- `js/admin.js`
- `tests/admin-orders-ui.test.mjs`

**Estimated scope:** Medium (4 files)

### Checkpoint B: Queue vertical slice

- [ ] Tasks 3-5 focused tests pass.
- [ ] `npm run check && npm test && npm run build && npm run verify:site` passes.
- [ ] Direct Chrome confirms multiple expansions, correct shading, reachable later rows, priority sort, and non-collapsing actions.
- [ ] Old card renderer removed where replaced; no duplicate queue implementation remains.

### Phase 3: Unified Order Messaging and Customer Support

## Task 6: Add validated order context and scoped read behavior to staff messaging API

**Description:** Extend the existing staff message endpoint to accept `order_id`, validate that the order belongs to the selected company, persist the context, and mark staff-read state by order when requested. Continue using the current company conversation and notification pipeline.

**Acceptance criteria:**
- [ ] Staff POST rejects missing/mismatched order-company relationships and stores valid `order_id` messages.
- [ ] Opening order messages marks only buyer messages for that order as staff-read; unrelated order and general chat alerts remain.
- [ ] One inserted order message can drive both order alert state and Customer Support activity without duplicate message rows.

**Verification:**
- [ ] `node --test tests/admin-messages-api.test.mjs tests/order-message-context.test.mjs`
- [ ] API smoke: general message, valid order message, cross-company order rejection, scoped read.

**Dependencies:** Task 4

**Files likely touched:**
- `functions/_lib/order-message-context.js`
- `functions/api/admin/messages.js`
- `functions/_lib/support-messages.js`
- `tests/order-message-context.test.mjs`
- `tests/admin-messages-api.test.mjs`

**Estimated scope:** Medium (5 files)

## Task 7: Add direct messaging to inline and full order views

**Description:** Add one shared order-message panel/composer used by expanded rows and full records. It loads scoped history, sends via the canonical staff message endpoint, exposes unread state, and offers a link to the centralized Customer Support thread.

**Acceptance criteria:**
- [ ] Staff can read/send order-linked messages from inline expansion and full record without duplicate submissions.
- [ ] Successful open/send updates order alert and Customer Support badge state consistently.
- [ ] Offline/error/retry state preserves draft text and uses an idempotent client request token.

**Verification:**
- [ ] `node --test tests/admin-order-messages-ui.test.mjs`
- [ ] Direct Chrome QA sends one order message and confirms it appears once in both order and Customer Support views.

**Dependencies:** Tasks 5, 6

**Files likely touched:**
- `js/admin/order-messages.js`
- `js/admin/order-queue.js`
- `js/admin/orders.js`
- `tests/admin-order-messages-ui.test.mjs`

**Estimated scope:** Medium (4 files)

## Task 8: Expose canonical support labels and direct order links in API

**Description:** Return a normalized message context from the admin support API: display user, email, optional order UUID/reference, canonical order URL, latest context, and unread counts. Keep raw identifiers separate from escaped display text.

**Acceptance criteria:**
- [ ] Order-linked entries provide `[Order <reference>] / [User]` data plus `admin.html?order=<uuid>#orders` URL.
- [ ] General entries provide `[User / Email]` data and no order URL.
- [ ] API redacts provider/security fields and escapes no data prematurely; UI remains responsible for safe rendering.

**Verification:**
- [ ] `node --test tests/admin-messages-api.test.mjs tests/support-message-context.test.mjs`

**Dependencies:** Task 6

**Files likely touched:**
- `functions/_lib/support-message-context.js`
- `functions/api/admin/messages.js`
- `tests/support-message-context.test.mjs`
- `tests/admin-messages-api.test.mjs`

**Estimated scope:** Medium (4 files)

## Task 9: Render order-aware centralized Customer Support

**Description:** Consume Task 8 context in the admin support drawer and staff support bubble through one shared formatter/renderer. Add direct order links to list entries and individual messages while preserving general-chat behavior.

**Acceptance criteria:**
- [ ] Order-linked list entries and messages show order/user context and open the associated order record.
- [ ] General chats show user/email only; no false order association.
- [ ] Customer Support unread alert and Orders unread alert update from the same message record and scoped read rules.

**Verification:**
- [ ] `node --test tests/admin-support-context-ui.test.mjs tests/admin-message-alerts.test.mjs`
- [ ] Direct Chrome QA: order message deep-link, general chat, two unread orders, scoped clearing, browser back.

**Dependencies:** Tasks 7, 8

**Files likely touched:**
- `js/admin/support-context.js`
- `js/admin/threads.js`
- `js/admin-support.js`
- `tests/admin-support-context-ui.test.mjs`
- `tests/admin-message-alerts.test.mjs`

**Estimated scope:** Medium (5 files)

### Checkpoint C: Messaging vertical slice

- [ ] One canonical message row appears in both surfaces.
- [ ] Order-scoped and global unread rules pass API/UI tests.
- [ ] Cross-company access tests fail closed.
- [ ] Direct Chrome confirms labels, deep links, badges, and draft/error behavior.

### Phase 4: Provider Health, Full Record, and Quotes

## Task 10: Normalize provider health states

**Description:** Extract a pure provider-health mapping from the existing Integrations implementation. Define green/yellow/red states from configuration, pending work, dead letters, unmatched events, and staleness. Preserve exact provider detail data and secret redaction.

**Acceptance criteria:**
- [ ] Stripe, ShipEngine, QBO, and Resend each map deterministically to status, short label, explanation, and management target.
- [ ] Yellow represents degraded/pending/stale; red represents failed/dead/unconfigured production dependency; green represents healthy.
- [ ] Status output contains text/icon semantics and never relies on color alone.

**Verification:**
- [ ] `node --test tests/admin-integration-health.test.mjs tests/admin-integrations-api.test.mjs`

**Dependencies:** None

**Files likely touched:**
- `js/admin/provider-health.js`
- `js/admin/integration-health.js`
- `tests/admin-integration-health.test.mjs`
- `tests/admin-integrations-api.test.mjs`

**Estimated scope:** Medium (4 files)

## Task 11: Add slim provider strip and preserve detailed management route

**Description:** Mount the provider strip at console level, outside all order shells. Provider buttons open the existing detailed Integrations surface focused on the provider. Remove Integrations as a sidebar column/tab only after legacy route compatibility exists.

**Acceptance criteria:**
- [ ] Strip remains visible and unaffected by expanded-order shading; no provider column appears in the order list.
- [ ] Clicking a provider opens its detailed status, dead-letter, retry, and configuration management controls.
- [ ] `#integrations` remains a valid direct link and browser back returns to the prior Orders state.

**Verification:**
- [ ] `node --test tests/admin-information-architecture.test.mjs tests/admin-integration-health.test.mjs`
- [ ] Direct Chrome QA of all four provider buttons, degraded state, keyboard navigation, and back/forward.

**Dependencies:** Tasks 1, 10

**Files likely touched:**
- `admin.html`
- `js/admin.js`
- `js/admin/provider-health.js`
- `tests/admin-information-architecture.test.mjs`

**Estimated scope:** Medium (4 files)

## Task 12: Replace order detail dialog with routable full-order record

**Description:** Decompose the existing detail dialog into an in-panel full-order record reached by `Manage` or direct order URL. Preserve existing financial, shipment, package, provider ledger, and timeline data while adding direct messaging and explicit return-to-queue behavior.

**Acceptance criteria:**
- [ ] Manage/direct URL loads the correct order with contact, addresses, items, payment, shipments, messages, returns, provider ledger, and audit timeline.
- [ ] Back returns to the same queue view, filters, scroll position, and expanded rows.
- [ ] Missing/unauthorized/deleted orders fail closed with a useful state and no leaked data.

**Verification:**
- [ ] `node --test tests/admin-order-record-ui.test.mjs tests/admin-orders-api.test.mjs`
- [ ] Direct Chrome QA: Manage, copied deep link, reload, back/forward, unauthorized order ID.

**Dependencies:** Tasks 5, 7, 11

**Files likely touched:**
- `js/admin/order-record.js`
- `js/admin/orders.js`
- `js/admin/order-console-state.js`
- `admin.html`
- `tests/admin-order-record-ui.test.mjs`

**Estimated scope:** Medium (5 files)

## Task 13: Nest quotes within Orders console

**Description:** Keep the mature quotes API/controller but mount it as an Orders subview. Pending quotes sort first and expose compact status/actions. Preserve legacy `#quotes` links by translating them to the Orders quotes view.

**Acceptance criteria:**
- [ ] Orders console switches between Orders and Quotes without a second sidebar destination or duplicated quote implementation.
- [ ] Pending/follow-up quotes sort before completed/expired quotes and show quick status/management.
- [ ] Existing quote links/actions, pagination, and customer context remain functional through legacy and new routes.

**Verification:**
- [ ] `node --test tests/admin-quotes-ui.test.mjs tests/admin-information-architecture.test.mjs`
- [ ] Direct Chrome QA: `#quotes` compatibility, pending sort, quote action, back to Orders.

**Dependencies:** Tasks 1, 5

**Files likely touched:**
- `js/admin/quotes.js`
- `js/admin/orders.js`
- `js/admin.js`
- `tests/admin-quotes-ui.test.mjs`
- `tests/admin-information-architecture.test.mjs`

**Estimated scope:** Medium (5 files)

### Checkpoint D: Console information architecture

- [ ] Orders, Quotes, provider health, full record, and Customer Support routes pass back/forward tests.
- [ ] `npm run check && npm test && npm run build && npm run verify:site` passes.
- [ ] Direct Chrome confirms all approved desktop/mobile interactions.
- [ ] Human review before automated money/label lifecycle actions.

### Phase 5: Fulfillment and Financial Automation

## Task 14: Harden tracking ingestion and reconciliation

**Description:** Treat signed ShipEngine webhooks as primary tracking input, deduplicate provider events, and expose one staff-triggered reconciliation command for stale or missing tracking. Do not add browser polling.

**Acceptance criteria:**
- [ ] Valid signed tracking events update canonical shipment/order status once; duplicate or replayed events are idempotent.
- [ ] Invalid signatures, unknown shipments, and out-of-order events are recorded safely without corrupting fulfillment state.
- [ ] Staff refresh reconciles one shipment, shows evidence/time, and rate-limits repeated requests.

**Verification:**
- [ ] `node --test tests/shipstation-webhook.test.mjs tests/admin-tracking-reconcile.test.mjs`
- [ ] Replay signed fixture events in order, duplicated, and out of order.

**Dependencies:** Tasks 5, 10

**Files likely touched:**
- `functions/api/shipstation-webhook.js`
- `functions/_lib/shipstation-orders.js`
- `functions/api/admin/order-tracking.js`
- `tests/shipstation-webhook.test.mjs`
- `tests/admin-tracking-reconcile.test.mjs`

**Estimated scope:** Medium (5 files)

## Task 15: Implement idempotent order-cancellation command

**Description:** Add one server command that validates cancellability, snapshots intended effects, voids eligible unused labels, requests the authorized Stripe refund, enqueues QBO reconciliation, queues Resend notification, and records partial completion for retry. Reuse existing label lifecycle and integration-effect ledgers.

**Acceptance criteria:**
- [ ] Repeating the same cancellation command cannot duplicate label void, Stripe refund, QBO effect, email, or audit entry.
- [ ] Partial provider failure yields `action_required` with per-effect status and safe retry; order is not falsely marked fully cancelled.
- [ ] Ineligible scanned labels, already-refunded payments, NET orders, and partially fulfilled orders produce explicit bounded outcomes.

**Verification:**
- [ ] `node --test tests/admin-order-cancellation.test.mjs tests/partial-refunds.test.mjs tests/shipstation-label-lifecycle.test.mjs`
- [ ] Provider fixture matrix: all succeed, label fails, Stripe fails, QBO delayed, Resend duplicate, command replay.

**Dependencies:** Tasks 10, 14

**Files likely touched:**
- `functions/_lib/order-cancellation.js`
- `functions/api/admin/order-cancellation.js`
- `functions/_lib/integration-effects.js`
- `tests/admin-order-cancellation.test.mjs`
- `tests/shipstation-label-lifecycle.test.mjs`

**Estimated scope:** Medium (5 files)

## Task 16: Add cancellation preview and progress UI

**Description:** Add a deliberate preview/confirm flow to inline and full order views. Show refundable payment amount, label eligibility, fulfillment impact, QBO/Resend effects, live progress, partial failure, and retry. Keep general refunds manual and separate.

**Acceptance criteria:**
- [ ] Preview shows exact consequences before confirmation and requires an explicit reason.
- [ ] Progress/result renders each provider effect independently and links to its audit/integration detail.
- [ ] Manual partial/full refund controls remain available with amount validation and are not auto-triggered outside cancellation.

**Verification:**
- [ ] `node --test tests/admin-order-cancellation-ui.test.mjs tests/partial-refunds.test.mjs`
- [ ] Direct Chrome QA using fixture outcomes from Task 15; verify keyboard focus and irreversible-action confirmation.

**Dependencies:** Tasks 12, 15

**Files likely touched:**
- `js/admin/order-cancellation.js`
- `js/admin/order-queue.js`
- `js/admin/order-record.js`
- `tests/admin-order-cancellation-ui.test.mjs`

**Estimated scope:** Medium (4 files)

## Task 17: Consolidate fulfillment, labels, returns, and financial actions

**Description:** Move remaining common actions into shared command definitions rendered by inline and full views: quote rates, buy/print/void label, mark shipped, tracking refresh, return label, manual refund, QBO retry, and customer notification. Remove duplicate handlers as each shared command replaces them.

**Acceptance criteria:**
- [ ] Inline and full views call the same action definitions and show the same eligibility/result semantics.
- [ ] Actions are permission-gated, audited, idempotent where applicable, and disabled while in flight.
- [ ] No stale duplicate handler, detail-dialog branch, or parallel provider mutation path remains.

**Verification:**
- [ ] `node --test tests/admin-order-actions-ui.test.mjs tests/admin-orders-api.test.mjs tests/qbo-financial-coverage.test.mjs`
- [ ] Direct Chrome smoke of every eligible action against provider fixtures; destructive live mutations require a dedicated approved QA order.

**Dependencies:** Tasks 12, 14, 16

**Files likely touched:**
- `js/admin/order-actions.js`
- `js/admin/order-queue.js`
- `js/admin/order-record.js`
- `js/admin/orders.js`
- `tests/admin-order-actions-ui.test.mjs`

**Estimated scope:** Medium (5 files)

### Checkpoint E: Lifecycle automation

- [ ] Tracking, cancellation, refund, label, return, QBO, and email matrices pass.
- [ ] Provider retries prove idempotency and partial-failure recovery.
- [ ] Audit/financial/provider ledgers reconcile to one order timeline.
- [ ] Human reviews money/label behavior before production deployment.

### Phase 6: Removal, Performance, Accessibility, and Production QA

## Task 18: Remove replaced code and enforce module boundaries

**Description:** Delete legacy order cards, detail dialog, duplicated support context formatting, obsolete Integrations/Quotes navigation branches, and dead handlers after route compatibility tests pass. Keep modules deep: state, queue rendering, record rendering, messaging, provider health, and commands.

**Acceptance criteria:**
- [ ] `js/admin/orders.js` becomes orchestration rather than owning render/state/provider logic.
- [ ] Static search and coverage prove removed selectors/handlers/routes have no callers.
- [ ] Net code change for replaced UI paths is neutral or negative where feasible; no temporary logs/reports/artifacts enter git.

**Verification:**
- [ ] `npm run check && npm test`
- [ ] Code-graph caller scan for removed symbols and manual diff review.

**Dependencies:** Tasks 9, 11-13, 17

**Files likely touched:**
- `js/admin/orders.js`
- `js/admin.js`
- `admin.html`
- `tests/admin-information-architecture.test.mjs`

**Estimated scope:** Medium (4 files)

## Task 19: Complete security, performance, accessibility, and production-readiness QA

**Description:** Run final automated gates, direct authenticated Chrome QA in the user's already-open browser, network/console inspection, performance profiling, and code review. Verify production configuration without exposing secret values. No commit/push/deploy occurs without a separate explicit instruction.

**Acceptance criteria:**
- [ ] Queue uses bounded requests, no N+1 behavior, no duplicate messages/effects, and acceptable interaction/loading performance with 100 orders.
- [ ] Keyboard, screen-reader naming, focus restoration, mobile layout, color semantics, reduced motion, and error recovery pass.
- [ ] Production smoke confirms staff/buyer role separation, live provider mode/status, signed webhooks, canonical `masest.co` URLs, and clean browser console/network results.

**Verification:**
- [ ] `npm run check && npm test && npm run build && npm run verify:site`
- [ ] Direct Chrome DevTools QA; do not use Playwright for authenticated login/browser validation.
- [ ] Independent code review of authorization, idempotency, money arithmetic, XSS/escaping, webhook verification, accessibility, and stale/dead code.

**Dependencies:** Task 18

**Files likely touched:**
- `tests/admin-orders-ui.test.mjs`
- `tests/admin-role-aware-ui.test.mjs`
- `tests/admin-message-alerts.test.mjs`
- `tests/admin-integration-health.test.mjs`
- Production source only if QA exposes a root-cause defect

**Estimated scope:** Medium (4 tests plus root-cause fixes only)

### Checkpoint F: Definition of Done

- [ ] All 19 task acceptance criteria and focused verification commands pass.
- [ ] `npm run check`, `npm test`, `npm run build`, and `npm run verify:site` pass from a clean tree.
- [ ] Direct Chrome authenticated QA passes staff and buyer golden paths, multiple expanded rows, order messaging, Customer Support deep links, quote routing, provider strip, full record, tracking, and cancellation fixtures.
- [ ] No secrets, production customer data, local logs, screenshots, generated QA reports, or unrelated files are staged.
- [ ] Final code-graph/static search shows no orphaned replaced UI paths.
- [ ] Human approves production money/label mutation QA, commit, push, and deployment as separate gates.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| `js/admin/orders.js` monolith causes regression blast radius | High | Extract one tested vertical slice at a time; remove replaced branch immediately; checkpoint every 2-3 tasks. |
| Company-wide reads clear unrelated order alerts | High | Add explicit `order_id`-scoped read operation and test two unread orders plus general chat. |
| Cancellation succeeds in one provider but fails in another | High | Persist effect state; expose partial completion; stable idempotency keys; retry only unfinished effects. |
| Carrier void accepted but refund delayed/denied | High | Separate `void_requested`, `void_confirmed`, and refund status; never book immediate refund from request alone. |
| Stripe refund and QBO accounting diverge | High | QBO effect references Stripe refund/order ledger IDs; provider reconciliation surfaces unresolved mismatch. |
| Webhook replay/out-of-order delivery corrupts state | High | Verify signatures, deduplicate provider event IDs, compare provider occurrence time, reconcile asynchronously. |
| Expanded row rerender loses state or blocks later rows | Medium | Central `Set<orderId>`, no overlay/fixed height, regression fixture with three open rows and refetch. |
| Header hides buyer cart incorrectly | High | Gate only on authoritative `can_admin === true`; retain non-staff regression tests. |
| Provider strip becomes cosmetic health theater | Medium | Map from canonical integration API/dead letters/staleness; buttons open actionable detail. |
| New summary query slows order list | Medium | Batched/RPC query, targeted index, 100-order/5,000-message query-plan fixture, no N+1. |
| Legacy bookmarks break | Medium | Route normalization tests for `#orders`, `#quotes`, `#integrations`, query deep links, back/forward. |
| Live QA mutates real money or labels | High | Use read-only paths and fixture responses first; require dedicated approved QA order before destructive production mutations. |

## Open Questions

No blocking product questions. Implementation uses these defaults unless changed during checkpoint review:

1. Orders console default view is Orders; Quotes is a nested segmented view.
2. Full order record stays within `admin.html` rather than creating a second HTML application.
3. One company conversation remains canonical; `order_id` is message context, not a separate thread.
4. General refunds remain manual. Cancellation may request the remaining refundable amount only after preview/confirmation.
5. Existing detailed Integrations surface remains available by deep link, but disappears from primary sidebar navigation.
6. Database change is limited to an order-message query index unless profiling proves a view/RPC is necessary.

## Approval Gate

Implementation starts only after human approval of this plan. First build slice: Tasks 1-3. Every checkpoint requires GREEN verification before the next phase.
