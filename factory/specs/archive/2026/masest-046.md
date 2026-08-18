---
id: masest-046
title: Deepen transactional Order reversal and status commands
agent: codex
risk: high
grill: completed
verification:
  - node --test tests/order-reversal.test.mjs tests/partial-refunds.test.mjs tests/refund.test.mjs tests/order-cancellation.test.mjs tests/order-lifecycle.test.mjs tests/money-flow-handlers.test.mjs tests/qbo-refund.test.mjs tests/integration-effects.test.mjs tests/admin-orders.test.mjs
  - npm run check
  - npm run build
  - npm run verify:site
  - npm audit --omit=dev
  - git diff --check
---

# Grill Gate

- Owner: finance/order staff with `order.write`; accounting treatment remains fail-closed when current QBO document state cannot prove the required reversal.
- Problem: direct refunds, cancellation approval, generic status writes, item replacement, inventory, QBO, and email are split across shallow non-atomic paths.
- Out of scope: changing payment terms, self-serve NET checkout, accountant chart-of-accounts selection, live Stripe/QBO mutation, and historical financial restatement.
- Review failure: a replay can refund twice; concurrent refunds can understate totals; line refunds cannot compute or can restock twice; confirmation executes a different cancellation plan; settled Orders enter impossible states; item-write failure deletes prior lines; a linked NET receivable remains collectible after final cancellation.
- Riskiest assumption: provider money succeeded before local finalization. Stable command identity and provider idempotency must make recovery safe.
- Smallest acceptable: immutable reversal commands/lines, atomic claims/finalization, version-bound cancellation, guarded Order commands, durable inventory/QBO/email effects, and explicit accounting-review state.

# Context

The generic integration event/effect ledger is canonical. Deepen an Order-reversal module around it. Replace direct money/status/item side effects; do not add wrappers around the old path.

# Acceptance Criteria

1. Add immutable Order reversal commands with unique client request identity, type, Order revision/snapshot hash, amount/currency, line allocations, reason, actor, status, provider identity/result, and timestamps. Service-only writes; staff reads through existing Order API.
2. Refund preflight loads `unit_price`, prior refunded quantities/amounts, and validates remaining refundable value. Line and amount refunds use integer minor units. The UI can submit exact line allocations and a stable request ID.
3. Atomically claim remaining Order/line refundable capacity before Stripe access. Use one stable Stripe idempotency key per command. Provider success is persisted before projection/effects; response loss/replay returns the same command/result.
4. Inventory restock, QBO reversal, notification, audit, and Order refund projections run as durable idempotent effects from the command snapshot. No worker rereads mutable current lines to decide what to restock.
5. Cancellation preflight persists an immutable plan containing Order revision/hash, all label operations, refund/NET accounting action, exact lines, amounts, reason, actor, and deterministic event identity. Confirmation requires that command identity and rejects stale Orders.
6. Replace generic status/payment/item writes with explicit guarded commands. Settled economic lines are immutable except through adjustment/reversal commands. Draft edits plus item replacement/inventory deltas execute in one transactional RPC or leave prior state unchanged.
7. NET cancellation cannot reach final `cancelled` while a linked QBO receivable remains actionable. Use a durable accounting-reversal effect based on authoritative linked document type/state; if exact treatment cannot be proven/configured, surface `accounting_review_required` and keep cancellation incomplete.
8. Remove direct inline refund/cancellation email and best-effort QBO/restock paths after parity. Delivery is durable, idempotent, visible, and auditable.
9. Add adversarial tests for identical replay, concurrent unequal refunds, same-line double refund, provider success/local failure, stale cancellation confirmation, item insert failure, invalid status edges, NET/QBO failure, and notification retry.

# Constraints

- Reuse `integration_events`/`integration_effects`; no second outbox.
- Preserve existing Order IDs, order numbers, Stripe/QBO/provider links, finance ledger, and authorized manual recovery behavior.
- No live Stripe refund, QBO posting, provider mutation, production write, commit, push, or deploy.
- Preserve unrelated dirty edits in Platform staff Order UI/tests.

# Review Notes

- Inspect integer arithmetic, command uniqueness, SQL locking/fencing, Stripe idempotency, line capacity, effect payload immutability, transition table completeness, NET terminal-state gating, and duplicate notification behavior.

# Acceptance Evidence

- Reversal core passed 41/41; surrounding cross-review suites passed 127/127; merged suite passed 2,234/2,234.
- Cross-review fixed accounting snapshots, refund projection races, unsettled payments, local delivery,
  cancellation TOCTOU, terminal-email ordering, review recovery, and Order/command lock order.
- Reversal migration applied to configured PostgreSQL and passed a second idempotency run.
- Live trigger/function/RLS/privilege/constraint checks passed with zero reversal commands created.
