# MASEST Admin Product Audit

Date: 2026-07-09  
Surface: authenticated production admin at `https://masest.co/admin`  
Evidence: production browser walkthrough, desktop and 390 x 844 responsive capture, source/API integration review, focused local tests.

## Overall verdict

The admin is technically substantial and much more complete than its light visual treatment suggests. It has real server-backed operations across orders, accounts, quotes, CRM, catalog, CMS, reviews, newsletters, reporting, and QuickBooks. Its strongest qualities are breadth, server-side authorization, useful empty/error states, keyboard-aware tab navigation, and cross-record CRM context.

The main problem is operational design. Daily work, configuration, infrastructure status, analytics, and destructive maintenance actions share the same hierarchy. Several screens are large editable documents rather than task-oriented workspaces. The CMS also exposes a critical semantic mismatch: **Publish writes to the CMS database, but public static pages still require a local export, Git commit, push, and deployment.**

Recommended posture: keep the backend and module structure; reorganize the product around an action inbox, clearer domain workspaces, role-aware controls, and honest publication states.

## Evidence steps

| Step | Surface | Health | Main observation |
|---|---|---|---|
| 1 | Overview | Needs restructuring | Good operational coverage, but priority work, QBO, exports, SEO, and analytics form one very long page. |
| 2 | Orders | Good foundation | Search, status filters, exports, saved views, manual creation, and server paging exist; empty state does not guide setup or testing. |
| 3 | Accounts | Mixed | User/business split and setup data are useful; an approved business still shows `Approve`, and destructive controls sit beside routine edits. |
| 4 | CRM follow-ups | Good foundation | Assignment, overdue scope, tasks, notes, activity, contacts, and offers are implemented; lead lifecycle and automation remain fragmented. |
| 5 | People directory | Good | Portal users and account contacts are unified, with account/history links; no visible source, consent, score, lifecycle, or next-action model. |
| 6 | Quotes | Strong feature set | List, board, reports, filters, ownership, due dates, priorities, and saved views exist; the empty state hides the intended conversion workflow. |
| 7 | Products | High friction | Inventory, products, variants, images, pricing, coupons, and bulk stock are integrated, but the page is an enormous always-editable form. |
| 8 | Website CMS | Strong editor, weak publishing contract | Revisions, scheduling, review, locks, assets, metadata, and many content types exist; public deployment is not completed by `Publish`. |
| 9 | Messages | Basic but integrated | Buyer threads connect to accounts and CRM, but there is no shared omnichannel inbox, SLA view, or triage controls. |
| 10 | Newsletter | Useful baseline | Compose/blog source, preview, recipients, test/send/schedule, and queue exist; segmentation, consent visibility, and outcome reporting are thin. |
| 11 | Mobile admin | Poor | The hero is clipped and the full navigation rail consumes the initial screen before any work content appears. |
| 12 | Blog CMS | Strong editor, misleading completion | Rich editor and workflow are solid, but the UI explicitly requires `npm run publish:blog` after publishing; duplicate fields and 1969 dates reduce trust. |

## What is implemented well

### Integration and reliability

- A modular admin client calls 36 tested `/api/admin/*` routes rather than relying on mock-only UI.
- Orders support server-side search/paging, manual creation, status changes, fulfillment/tracking, NET payment handling, refund/QBO recording, CSV export, and dirty-edit preservation.
- Accounts combine users, businesses, approvals, role assignment, staff roles, addresses, payment methods, orders, setup readiness, and account impersonation.
- CRM records support activity timelines, notes, tasks, owners, due dates, contacts, contact history, primary-contact selection, duplicate merge, and CSV import.
- Quotes support list/board/report views, ownership, priority, due dates, contacts, tasks, status changes, and conversion-oriented record detail.
- CMS/blog support drafts, scheduling, review, change requests, editor locks, revisions, assets, metadata, rich editing, and static export status.
- Newsletter supports composing from scratch or from a blog post, audience population selection, test sends, immediate sends, schedules, recurring campaigns, recipients, and a queue.
- QuickBooks exposes connection state, business linkage, order/program/refund sync queues, manual sync, retry, and disconnect/reconnect controls.
- Backend authorization has `owner`, `finance`, `support`, and `read_only` tiers, plus capability checks for sensitive mutations.

### Accessibility and interaction strengths

- The primary admin navigation uses real `tablist`, `tab`, and `tabpanel` semantics with `aria-controls` and `aria-labelledby` wiring.
- Arrow keys, Home, and End are implemented with roving tabindex.
- Status and error regions commonly use `role=status` or `aria-live`.
- Destructive confirmations use native dialogs rather than browser alerts.
- Most visible admin controls meet a roughly 40px target-height baseline.

## Highest-impact risks

### P0 - Publishing state is misleading

`Publish` in Website content and Blog changes database workflow state, but the public site serves committed static snapshots. Operators must still run `npm run publish:content` or `npm run publish:blog`, review generated files, commit, push, and wait for deployment. This is not a complete CMS control plane.

**Fix:** either create a secure server-side export/deploy job with progress, failure, diff, actor, and live URL confirmation, or rename the current action to `Approve for deployment` and show a separate deployment state: `Approved`, `Export pending`, `Deploying`, `Live`, `Failed`.

### P0 - Catalog controls conflict with pricing governance

The Products surface allows direct edits to product and variant prices while the workbook and generated catalog artifacts are the established pricing source of truth. The UI offers no provenance, lock, sync direction, drift check, or warning that a direct edit may be overwritten by the next seed.

**Fix:** make price fields read-only when workbook-managed, show source and last-sync metadata, add a workbook-drift report, and route approved changes through the canonical import/reseed process.

### P0 - No unified lead-to-revenue lifecycle

Newsletter leads, portal users, account contacts, buyer messages, quote requests, CRM tasks, and orders are connected in pieces but not represented as one lifecycle. Staff cannot answer quickly: where did this lead come from, who owns it, what is the next action, what is its value, and did it become revenue?

**Fix:** add a first-class Lead/Opportunity record with source, campaign, lifecycle stage, owner, SLA, next action, expected value, linked contact/company, quotes, messages, samples, and order outcome. Make this the main CRM pipeline rather than another isolated screen.

### P1 - Information architecture mixes work with infrastructure

The Overview begins correctly with priority work, then continues into QuickBooks connection controls, exports, SEO checks, raw funnel tables, campaigns, paths, browsers, referrers, and daily trends. Daily operators must scan past configuration and analytics to find work.

**Fix:** keep Overview to `Needs attention`, `My work`, operational KPIs, and exceptions. Move QBO to `Integrations`, exports/financial reports to `Finance`, and SEO/traffic/funnel to `Analytics`.

### P1 - Product and account editing are too exposed

Products render dozens of editable fields and repeated Save/Remove actions at once. Accounts similarly place approval, credit, tier, edit, and delete actions together. This increases accidental-edit risk and makes scanning slow.

**Fix:** use list-first pages with compact rows/cards, explicit selection, record drawers, a single sticky save bar, unsaved-change count, field-level validation, change summaries, and destructive actions inside a separate menu.

### P1 - Mobile is not operationally usable

At 390px the heading is clipped under the header and the entire admin navigation appears before the selected workspace. A staff member must scroll through navigation before each task.

**Fix:** replace the mobile rail with a compact section selector or drawer, keep the selected section and urgent badge visible in a sticky toolbar, remove or collapse the marketing hero, and place work content immediately below the header.

## Additional opportunities

1. **Role-aware UI:** server permissions are strong, but the client does not appear to consume the current staff capability set. Hide or disable unavailable controls with a reason before a user hits a 403.
2. **Global search / command palette:** search orders, companies, contacts, quotes, messages, products, and content from one shortcut.
3. **Unified exception inbox:** overdue CRM tasks, stalled quotes, QBO failures, email bounces, low stock, content approvals, and account setup gaps should share one triage queue with owner and SLA.
4. **Server-synced saved views:** current saved views are localStorage-only, so they do not follow staff across devices and cannot be shared.
5. **Automation:** add quote-response SLA reminders, abandoned-checkout follow-up, sample follow-up, stale-lead nudges, low-stock purchase tasks, and failed-sync escalation.
6. **Inventory operations:** add reorder points, vendor/lead time, purchase orders, inbound inventory, stock adjustments with reasons, and an audit trail.
7. **Commerce analytics:** tie campaign/lead source to quote, checkout, order, gross revenue, and repeat purchase; show conversion by source and product.
8. **Newsletter governance:** expose consent source/date, suppression and bounce state, segments/tags, sender/reply-to/domain health, preview recipients, send estimate, and campaign results.
9. **Admin audit log:** the backend records audit events, but there is no visible operator-facing audit history for product, account, pricing, role, order, or integration changes.
10. **True preview:** render CMS drafts in the actual public page shell and provide a shareable preview URL; the current field-check iframe is explicitly not the final layout.

## Specific UI and data-quality defects observed

- The mobile hero is visibly clipped under the fixed header.
- An approved business still presents an `Approve` action.
- The Blog editor exposes two fields named `Title` and repeats the `Blog editor` heading.
- Several published CMS/blog records show `12/31/1969`, which reads as a data defect rather than “unknown date.”
- Rich-editor icon buttons for basic formatting appear without accessible names in the accessibility tree.
- Muted labels and helper text are very light against white; contrast needs measurement.
- The public marketing header, account menu, and cart remain present in the staff console, consuming vertical space and distracting from operational work.
- Empty states explain what will appear but rarely provide a setup, import, create, or test action.
- Newsletter Settings currently contains only one automation toggle, leaving delivery and compliance configuration opaque.

## Recommended implementation sequence

### Phase 1 - Trust and safety

1. Correct CMS/blog publication language and add real deployment status.
2. Lock workbook-managed price fields and add pricing provenance/drift reporting.
3. Fix mobile clipping/navigation, approved-account action state, duplicate Blog fields, 1969 dates, and rich-editor accessible names.
4. Expose staff capabilities to the client and make controls role-aware.

### Phase 2 - Productivity

1. Split Overview into Action inbox, Analytics, Finance, and Integrations.
2. Convert Products and Accounts to list + record drawer editors.
3. Add global search and server-synced/shared views.
4. Add an admin audit-log screen and unified exception notifications.

### Phase 3 - Growth workflow

1. Introduce Lead/Opportunity lifecycle and pipeline.
2. Connect source/campaign, messages, tasks, quotes, samples, and orders.
3. Add lead/quote/checkout automation and outcome analytics.
4. Expand newsletter segmentation, consent, deliverability, and campaign reporting.

## Verification performed

- Production authenticated walkthrough without submitting mutations.
- Desktop and 390 x 844 responsive inspection.
- Source-level mapping of admin modules, API calls, authorization tiers, CMS static export path, and keyboard tab behavior.
- `npm run check`: 202 JavaScript files checked.
- 15 focused admin/CRM/CMS/newsletter/accessibility/role test files: zero failures.

## Evidence limits

- Production data was sparse for orders, quotes, messages, tasks, reviews, and newsletter recipients, so populated-row density, long-content behavior, error recovery, and destructive confirmation flows were not exercised.
- No mutations, sends, refunds, imports, deletes, role changes, QBO syncs, or public deployments were triggered.
- Screenshot and DOM inspection cannot establish full WCAG conformance. Contrast ratios, screen-reader announcements, focus return after every dynamic dialog, zoom at 200-400%, and all validation/error paths still need dedicated testing.
