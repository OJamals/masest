# MASEST Architecture

MASEST is a static Cloudflare Pages commerce site with Pages Functions for server-side workflows and Supabase as the system of record. The structure should stay boring: static HTML/CSS for the buyer surface, small vanilla JavaScript modules for behavior, Pages Functions for privileged actions, and SQL migrations in `supabase/`.

## Runtime Boundaries

- Public pages: root `*.html`, `css/style.css`, `css/components.css`, and `js/main/*`.
- Commerce pages: `products.html`, `product.html`, `cart.html`, `js/cart.js`, and account/order APIs.
- Admin console: `admin.html`, `js/admin.js`, split modules under `js/admin/*`, and guarded `/api/admin/*` functions.
- Buyer dashboard: `dashboard.html`, `js/dashboard.js`, and `/api/account/*` functions.
- Quote CRM: `/api/quote`, `/api/admin/quotes`, admin quote inbox, buyer message handoff, and quote schema fields in `supabase/schema-quotes.sql`.
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
- `npm run verify`: runs check, tests, then build.
- `npm run serve`: starts the long-lived local static server on port 4195.
- `npm run smoke:admin`: optional Playwright smoke for admin auth and quote/message flows.

## Feature Priorities

- Convert quote CRM into a disciplined pipeline: score, priority, owner, due date, follow-up, automation, and buyer handoff.
- Keep commerce state clear: buyable, quote-only, not purchasable, stock, payment, order tracking, and invoice sync.
- Keep buyer dashboard operational: orders, messages, notifications, payment portal, profile, addresses, and team.
- Keep lead generation conversion-safe: contact/resources CTAs should route to quote/audit/sample flows without unsupported claims.

## Component And Layout Rules

- No redesign: preserve the procurement/commercial UI direction.
- Use `DESIGN.md` tokens and component classes before adding one-off CSS.
- Prefer dense, scannable admin controls over marketing layouts.
- Avoid nested cards, decorative gradients, and claims that exceed available evidence.
- Split large JavaScript by feature when a module owns distinct state, API calls, and rendering.
