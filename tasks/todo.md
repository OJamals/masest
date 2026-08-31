# Unified Orders Console — Execution Checklist

Canonical detail: `tasks/plan.md`. Do not implement tasks out of dependency order. Keep tree clean; stage only owned paths.

## Active Slice — Unified Support and Order Messaging (2026-08-30)

- [x] **S1 — RED contracts**
  - [x] Atomic support append owns message + thread projection.
  - [x] Order request cannot return success when chat handoff fails.
  - [x] Order/company mismatch fails closed; scoped read/reply retains `order_id`.
  - [x] Buyer/Admin Orders entry points reuse existing chat/support consoles.
- [x] **S2 — Canonical DB/API seam** (`deps: S1`)
  - [x] Additive migration and shared server adapter.
  - [x] Account/Admin message APIs return normalized order context.
  - [x] Replace human-authored direct inserts; retain specialized transactional provider adapters.
- [x] **S3 — Buyer integration** (`deps: S2`)
  - [x] Orders action opens existing chat with active order context.
  - [x] Floating/full inbox sends `order_id` and renders order tags/clear context.
- [x] **S4 — Admin integration** (`deps: S2`)
  - [x] Support thread supports order scope, order links, and context-preserving replies.
  - [x] Orders opens same support console; open request queue visible/actionable.
- [x] **S5 — Verification and review** (`deps: S3,S4`)
  - [x] Focused Node tests and direct Playwright specs pass.
  - [x] `npm run verify` passes.
  - [x] Security, accessibility, performance, failure semantics, and code ownership reviewed.
- [ ] **S6 — Release and live QA** (`deps: S5`)
  - [x] DB backup + additive migration.
  - [ ] Commit, rebase, push; CI/Pages exact-commit parity proved.
  - [ ] Live API guards, responsive visuals, console/network, and authorized functional paths pass.

## Phase 1 — Contracts and Staff Navigation

- [ ] **T1 — Order-console state/deep links** (`deps: none`, `M`)
  - [ ] RED: URL, legacy route, independent expansion, refresh preservation, action exclusion.
  - [ ] GREEN: pure `order-console-state` module.
  - [ ] Verify: `node --test tests/order-console-state.test.mjs && npm run check`.
- [ ] **T2 — Explicit role-aware staff header** (`deps: T1`, `M`)
  - [ ] Staff: User management, Admin, Orders, Customer Support; no cart/duplicate Admin.
  - [ ] Buyers retain current menu/cart.
  - [ ] Verify tests + direct staff/buyer Chrome QA.

### Checkpoint A

- [ ] Focused tests/check pass.
- [ ] Desktop/mobile staff and buyer nav pass.
- [ ] Human review.

## Phase 2 — Priority Queue

- [ ] **T3 — Inline order-row shell** (`deps: T1`, `M`)
  - [ ] Full-width continuous expanded surface; shading defect gone.
  - [ ] 2+ rows remain expanded; later rows reachable.
  - [ ] Keyboard/mobile/loading/error states pass.
- [ ] **T4 — Batched priority/message summaries** (`deps: T1`, `M`)
  - [ ] One bounded response; no N+1.
  - [ ] Order-scoped unread counts and index/query-plan proof.
  - [ ] Paid/unshipped, exception, message, shipment inputs returned.
- [ ] **T5 — Priority/status/actions integration** (`deps: T3,T4`, `M`)
  - [ ] Deterministic attention-first sort and alternate sorts.
  - [ ] Compact payment/quote/shipping/tracking/message state.
  - [ ] Quick actions work without row collapse.

### Checkpoint B

- [ ] Focused tests pass.
- [ ] `npm run check && npm test && npm run build && npm run verify:site`.
- [ ] Direct Chrome: three open rows, shading, reachability, actions, filters/refetch.
- [ ] Replaced old renderer removed.

## Phase 3 — Order Messaging + Customer Support

- [ ] **T6 — Validated order context/scoped reads API** (`deps: T4`, `M`)
  - [ ] Validate order belongs to company.
  - [ ] Store one canonical order-linked message.
  - [ ] Clear only selected order unread state.
- [ ] **T7 — Shared order message panel/composer** (`deps: T5,T6`, `M`)
  - [ ] Inline/full record read + send.
  - [ ] Draft survives errors; duplicate send prevented.
  - [ ] Both Orders and Support alerts update.
- [ ] **T8 — Canonical support context API** (`deps: T6`, `M`)
  - [ ] `[Order <reference>] / [User]` + direct URL.
  - [ ] `[User / Email]` for general chat.
  - [ ] Safe normalized response.
- [ ] **T9 — Order-aware Customer Support UI** (`deps: T7,T8`, `M`)
  - [ ] Shared label renderer.
  - [ ] Direct links on entries/messages.
  - [ ] Global and order unread behavior consistent.

### Checkpoint C

- [ ] API/UI tests pass.
- [ ] Cross-company access fails closed.
- [ ] Direct Chrome: order chat appears once in both surfaces; direct link/back works.
- [ ] Two-order + general-chat scoped read matrix passes.

## Phase 4 — Provider Health + Full Record + Quotes

- [ ] **T10 — Provider-health state contract** (`deps: none`, `M`)
  - [ ] Deterministic Stripe/ShipEngine/QBO/Resend green/yellow/red mapping.
  - [ ] Text/icon semantics; secret redaction retained.
- [ ] **T11 — Slim provider strip/deep links** (`deps: T1,T10`, `M`)
  - [ ] Console-level strip; no order integration column.
  - [ ] Provider click opens detailed actionable Integrations view.
  - [ ] Legacy route/back-forward compatibility.
- [ ] **T12 — Routable full-order record** (`deps: T5,T7,T11`, `M`)
  - [ ] Manage/direct link renders complete record.
  - [ ] Back restores queue state.
  - [ ] Invalid/unauthorized IDs fail closed.
- [ ] **T13 — Quotes nested in Orders** (`deps: T1,T5`, `M`)
  - [ ] Pending quotes prioritized.
  - [ ] Existing controller/API reused.
  - [ ] `#quotes` compatibility retained.

### Checkpoint D

- [ ] Routes/back-forward tests pass.
- [ ] Full automated suite/build/site verification passes.
- [ ] Direct Chrome IA/desktop/mobile QA passes.
- [ ] Human review before money/label automation.

## Phase 5 — Fulfillment + Finance Automation

- [ ] **T14 — Webhook-first tracking/reconciliation** (`deps: T5,T10`, `M`)
  - [ ] Signed, deduplicated, out-of-order-safe webhook ingestion.
  - [ ] Controlled one-shipment refresh; no browser polling.
  - [ ] Evidence/time/exception visible.
- [ ] **T15 — Idempotent cancellation command** (`deps: T10,T14`, `M`)
  - [ ] Label void + Stripe refund + QBO effect + Resend effect + audit.
  - [ ] Partial completion visible/retryable.
  - [ ] Replay cannot duplicate effects.
- [ ] **T16 — Cancellation preview/progress UI** (`deps: T12,T15`, `M`)
  - [ ] Exact consequence preview + reason + confirm.
  - [ ] Per-provider progress/error/retry.
  - [ ] Manual refunds remain separate.
- [ ] **T17 — Shared fulfillment/financial actions** (`deps: T12,T14,T16`, `M`)
  - [ ] Inline/full views use same command definitions.
  - [ ] Permission/audit/idempotency/in-flight gates.
  - [ ] Duplicate legacy handlers removed.

### Checkpoint E

- [ ] Provider success/failure/replay matrices pass.
- [ ] Tracking, label, cancellation, refund, QBO, Resend ledgers reconcile.
- [ ] Human approves production money/label mutation QA.

## Phase 6 — Cleanup + Release Gate

- [ ] **T18 — Remove replaced code/enforce boundaries** (`deps: T9,T11-T13,T17`, `M`)
  - [ ] Delete legacy cards/dialog/nav branches/duplicate formatters/handlers.
  - [ ] `orders.js` becomes orchestration.
  - [ ] Code-graph caller scan finds no orphaned replaced symbols.
- [ ] **T19 — Final QA/security/performance/accessibility review** (`deps: T18`, `M`)
  - [ ] 100-order performance fixture; bounded requests/no N+1.
  - [ ] Auth, idempotency, money arithmetic, XSS, webhooks, a11y reviewed.
  - [ ] Direct authenticated Chrome QA in user's open browser; no Playwright login/browser QA.

### Final Gate

- [ ] `npm run check`.
- [ ] `npm test`.
- [ ] `npm run build`.
- [ ] `npm run verify:site`.
- [ ] Staff/buyer direct Chrome golden paths pass with clean console/network.
- [ ] No secret/customer data/log/screenshot/generated QA artifact staged.
- [ ] Human separately authorizes commit, push, deployment, and destructive production QA.
