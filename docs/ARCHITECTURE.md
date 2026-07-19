# MASEST Architecture

MASEST is a static Cloudflare Pages commerce site with Pages Functions for server-side workflows and Supabase as the system of record. The structure should stay boring: static HTML/CSS for the buyer surface, small vanilla JavaScript modules for behavior, Pages Functions for privileged actions, and SQL migrations in `supabase/`.

## Runtime Boundaries

- Public pages: root `*.html`, `css/style.css`, `css/components.css`, and `js/main/*`.
- Commerce pages: `products.html`, `product.html`, `cart.html`, `js/cart.js`, and account/order APIs.
- Admin console: `admin.html`, `js/admin.js`, split modules under `js/admin/*`, and guarded `/api/admin/*` functions.
- Buyer dashboard: `dashboard.html`, `js/dashboard.js`, and `/api/account/*` functions.
- CMS: `js/admin/content.js` with asset/revision modules, guarded `/api/admin/content*` functions,
  Supabase content/storage tables, and build-time snapshots consumed by static public pages.
- Quote CRM: `/api/quote`, `/api/admin/quotes`, `/api/admin/crm/*`, the quote pipeline, contacts/tasks/timeline
  workspaces, buyer message handoff, and bounded server pagination for large admin directories.
- External services: Stripe for checkout/payment portal, Resend for transactional email, QuickBooks via QBO sync functions, and Supabase for auth/data.

## Target Structure

- Keep `js/main/*` as the pattern for public-site modules.
- Keep `js/admin/qbo.js` as the pattern for admin feature modules; new large admin areas should split out before growing `js/admin.js`.
- Keep Pages Functions thin and route-owned. Shared cross-route behavior belongs in `functions/_lib/*`.
- Keep schema changes additive and idempotent. Every raw SQL table or altered table needs service-role grants where relevant.
- Keep tests near behavior contracts: static structure in `tests/*.test.mjs`, browser smoke in `tools/*.spec.mjs`.

## Build And Verification

- `npm run check`: syntax-checks JavaScript entrypoints and tools.
- `npm test`: runs Node contract tests sequentially to avoid port collisions.
- `npm run build`: runs the Cloudflare Pages build script.
- `npm run verify:site`: checks generated/static site structure, references, and required routes.
- `npm run qa:commerce-smoke`: runs the focused Playwright commerce-state and checkout gate.
- `npm run qa:ui-critical`: runs the focused critical UI/accessibility/visual gate.
- `npm run verify`: runs `npm run check && npm test && npm run build && npm run verify:site && npm run qa:commerce-smoke && npm run qa:ui-critical`, in that order.
- `npm run serve`: starts the long-lived local static server on port 4195.
- `npm run smoke:admin`: optional Playwright smoke for admin auth and quote/message flows.
- `npm run smoke:cms`: optional focused Playwright content smoke.
- `npm run qa:admin-assurance`: optional focused Node and Playwright admin assurance gate.
- `npm run qa:remediation`: optional full Playwright remediation suite.

## Feature Priorities

- Keep the existing quote/CRM pipeline coherent across score, priority, owner, due date, follow-up, tasks, timeline, and buyer handoff.
- Keep commerce state clear: buyable, quote-only, not purchasable, stock, payment, order tracking, and invoice sync.
- Keep buyer dashboard operational: orders, messages, notifications, payment portal, profile, addresses, and team.
- Keep lead generation conversion-safe: contact/resources CTAs should route to quote/audit/sample flows without unsupported claims.

## Component And Layout Rules

- No redesign: preserve the procurement/commercial UI direction.
- Use `DESIGN.md` tokens and component classes before adding one-off CSS.
- Prefer dense, scannable admin controls over marketing layouts.
- Avoid nested cards, decorative gradients, and claims that exceed available evidence.
- Split large JavaScript by feature when a module owns distinct state, API calls, and rendering.
