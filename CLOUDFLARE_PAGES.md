# Deploy MASEST commerce on Cloudflare Pages (free)

Free alternative to Netlify (no credit cap, commercial OK, serverless Functions + env vars,
custom domain). Static site + the 7 `/api/*` endpoints both run here. Same Supabase / Stripe /
Resend / Klaviyo backend — nothing about those changes. Netlify config is left intact so it can
deploy the same branch in parallel; this file and `wrangler.toml` are ignored by Netlify.

## What changed in the repo
- `functions/` — the 7 endpoints ported to Cloudflare Pages Functions (`onRequestGet/Post`,
  `env` bindings, Stripe fetch + SubtleCrypto for the Workers runtime). Routing is by file path:
  `functions/api/products.js` → `/api/products`, `functions/api/account/me.js` → `/api/account/me`.
- `functions/_lib/` — shared helpers (not routed).
- `tools/cf-build.mjs` — build step: assembles a clean static `dist/` (excludes backend/build dirs).
- `wrangler.toml` — `pages_build_output_dir = "dist"`, `compatibility_flags = ["nodejs_compat"]`.
- `netlify/`, `netlify.toml` — untouched (parallel Netlify deploy still works).

## One-time setup (Cloudflare dashboard)
1. **Workers & Pages → Create → Pages → Connect to Git** → repo `OJamals/masest`.
   - **Project name: `masest-commerce`** (must match `name` in `wrangler.toml`).
   - **Production branch: `netlify-commerce`**.
2. **Build settings**: Framework preset = **None**. Build command = **`node tools/cf-build.mjs`**.
   Build output directory is read from `wrangler.toml` (`dist`) — leave the field default.
3. **Settings → Environment variables → Production** — add all of these (Secret type):

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | `https://mvfxzvkzcqmnwcoblvfc.supabase.co` |
   | `SUPABASE_ANON_KEY` | (Supabase → Project Settings → API → anon public) |
   | `SUPABASE_SERVICE_ROLE_KEY` | (Supabase → API → service_role secret) |
   | `STRIPE_SECRET_KEY` | `sk_test_…` (or `sk_live_…`) |
   | `STRIPE_WEBHOOK_SECRET` | set in step 5 below |
   | `APP_URL` | your Pages URL, e.g. `https://masest-commerce.pages.dev` (or custom domain) |
   | `RESEND_API_KEY` | Resend API key |
   | `RESEND_FROM` | `MASEST Orders <orders@send.masest.co>` |
   | `ORDER_NOTIFY_EMAIL` | (optional) internal BCC address |
   | `KLAVIYO_PRIVATE_KEY` | Klaviyo private key |
   | `KLAVIYO_LIST_ID` | Klaviyo list id |

   `nodejs_compat` is already set via `wrangler.toml`; no compatibility flag to toggle by hand.
4. **Deploy** (first build runs automatically). Note the assigned `*.pages.dev` URL.
5. **Stripe webhook**: Stripe Dashboard → Developers → Webhooks → Add endpoint
   `https://<your-pages-url>/api/stripe-webhook`, event `checkout.session.completed`. Copy the
   endpoint's **Signing secret** into the `STRIPE_WEBHOOK_SECRET` env var, then redeploy.
6. **Supabase Auth → URL Configuration**: add the Pages URL to **Site URL** and **Redirect URLs**
   (so the confirm-email link returns to this host).
7. **Turnstile** (Cloudflare dashboard → Turnstile → the widget for site key
   `0x4AAAAAADmaD_pRgYim8QF5`): add the Pages hostname to the widget's allowed domains.

## Verify after deploy
- `GET /api/health` → `{ ok:true, … }` with `supabase_service` true once env vars are set.
- `GET /api/products` → products include nested `product_variants` (5/15/55 gal).
- `POST /api/checkout {"mode":"pay","items":[{"sku":"hcr-55g","qty":1}]}` → `{ url }` (Stripe).
  Unpriced/unknown vsku → `409 not_purchasable`.

## Custom domain (optional)
Pages → Custom domains. `masest.co` apex is GitHub Pages (the brochure site, branch `main`) — do
**not** repoint it. Use a subdomain such as `shop.masest.co` for the store, and set `APP_URL` to it.
