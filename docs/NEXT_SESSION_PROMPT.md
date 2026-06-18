# MASEST - Next Session Prompt

Paste the block below to start the next development session.

```text
MASEST site. Work from /Users/omar/Claude/Projects/MASEST on main.

Rules:
- Run `git fetch origin` and check `git status --short --branch` before edits.
- Treat main as the deploy branch. Push only verified commits.
- Keep changes scoped; do not revert unrelated dirty work.
- For behavior changes, write/keep structural tests first.
- Use the visual guard for no-visual-change CSS/large frontend refactors.

Current state as of 2026-06-18:
- Latest feature state includes 32b9e66 (`feat(admin): show company setup gaps`); verify current HEAD before editing.
- main.js has been split into shared entrypoint modules.
- admin QBO controls have been split into js/admin/qbo.js.
- QBO auto-sync is implemented, with cron endpoint, staff manual sync, queue summary, and admin status.
- Buyer setup progress is returned from /api/account/me and shown in dashboard/business hub.
- Staff company setup gaps are shown in the admin companies table.
- Latest verification: `node --test --test-concurrency=1 tests/*.test.mjs` = 146 pass; admin Playwright smoke = 1 pass; `node tools/verify-seo.mjs` = pass; `git diff --check` = pass.

Recent commits:
- 32b9e66 feat(admin): show company setup gaps
- 94ffee9 feat(account): surface buyer setup progress
- f41cc0a feat(qbo): show sync queue summary
- 974b2a6 feat(qbo): add manual admin sync trigger
- cc810c3 refactor(admin): split qbo controls
- 69fcdb1 refactor(main): split commerce and interaction modules
- c50d23d refactor(main): split shared entrypoint modules

Good next work:
1. Continue admin.js split in small tested slices: orders, companies, products, quotes.
2. Add real admin browser smoke coverage for QBO manual sync and company setup rendering.
3. Add owner-facing deployment docs for QBO enablement: Supabase schema-qbo.sql, QBO env vars, pg_cron/pg_net cron, and first manual sync.
4. Optional frontend cleanup: replace inline admin overview layout styles with CSS classes, using visual guard where relevant.

Ops-only reminders:
- QBO production enablement requires owner secrets and Intuit account access.
- Live rate-limit verification requires deployed Cloudflare bindings.
```

## Current Verification

- `node --test --test-concurrency=1 tests/*.test.mjs` - 146 pass.
- `npx playwright test tools/admin-auth-gate.spec.mjs --reporter=line` - 1 pass.
- `node tools/verify-seo.mjs` - pass.
- `git diff --check` - pass.
