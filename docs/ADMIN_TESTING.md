# Admin automation

Admin coverage has three layers. Keep them separate: deterministic CI tests prove code behavior, staging proves authenticated integration, and production proves only that the public gate stays closed.

## Default CI gate

`npm run verify:core` includes `npm run qa:admin-assurance`. This runs focused Node tests plus isolated Playwright coverage for platform-staff roles, admin APIs, finance, CRM, quotes, accounts, and CMS behavior. It uses controlled fixtures and does not need live credentials.

Run locally:

```sh
npm run qa:admin-assurance
```

## Authenticated staging E2E

`.github/workflows/admin-staging-e2e.yml` is manual-only and uses the protected GitHub Environment `admin-staging-e2e`. It creates one confirmed Supabase auth user and one `profiles` row with platform-staff role `owner`, opens all 12 admin panels in isolated Chromium, then deletes and verifies absence of both records.

Browser navigation is read-only: only `GET` and `HEAD` application API requests are allowed. Any attempted `POST`, `PUT`, `PATCH`, or `DELETE` is blocked and fails the run. The ephemeral bearer token remains in the Node/Playwright routing layer and is attached only to the exact staging origin; redirects or API requests to another origin fail closed. Page JavaScript receives only a non-secret proxy token. Each panel must also reach a sustained application-API idle window before the runner advances.

Required environment secrets:

- `ADMIN_E2E_BASE_URL`
- `ADMIN_E2E_SUPABASE_URL`
- `ADMIN_E2E_SUPABASE_ANON_KEY`
- `ADMIN_E2E_SUPABASE_SERVICE_ROLE_KEY`

The workflow supplies `ADMIN_E2E_ENABLE=staging-only` itself.

Staging requirements:

1. Use a separate disposable Supabase project with the current schema. Never reuse production.
2. Bind the staging/preview Pages deployment to that same Supabase URL and keys. `/api/health` must report the exact configured staging URL or the runner stops before creating a user.
3. Permit password-grant login in this disposable project. If production uses CAPTCHA, disable it only in this isolated staging project; never weaken production auth.
4. Protect the GitHub Environment with required reviewers. Store the service-role key only there.
5. Use a preview/staging origin. `masest.co`, its subdomains, and the production `masest-commerce.pages.dev` origin are rejected.

Manual local invocation uses the same five variables shown in `.env.example`:

```sh
npm run qa:admin-staging-e2e
```

Success means all panels opened without browser errors or failed admin API responses and cleanup verified both test records absent. A failed browser run uploads `test-results/admin-staging-e2e.png` for three days. If cleanup verification fails, treat the run as failed and remove the `admin-e2e-*@masest.test` identity from the staging project before retrying.

## Production post-deploy smoke

`npm run qa:admin-production-smoke` runs after the Cloudflare Pages production deploy. It uses no credentials and makes only two `GET` requests:

- `/admin` must contain the fail-closed auth gate and the exact `js/admin.js` release from the deployed commit.
- `/api/admin/stats` must return `401 {"error":"unauthenticated"}` with `cache-control: no-store`.

The command accepts only the canonical `https://masest.co` origin. It retries the HTML release check briefly for edge propagation, then checks the API gate once. Any anonymous success response fails deployment verification.
