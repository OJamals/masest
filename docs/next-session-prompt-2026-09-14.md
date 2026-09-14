# Next-session entry prompt — after 2026-09-14 session 6

Continue the MASEST website renovation — the overarching goal is transforming masest.co
from an informational site into a high-trust, conversion-optimized platform that sells the
VertKleen line, merging an Apple-grade aesthetic with industrial credibility.

Work in `/Users/omar/Claude/Projects/MASEST` on `main`. Codex and a parallel SEO session
may edit it live: `git fetch && git rebase origin/main` before every push, and re-read a
file before editing it. `.dev.vars` holds every credential you need, including
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`.

State: `origin/main` == **`437e1d41`** plus one docs-only commit, live on production and
verified by curl. **It was deployed by a local `wrangler pages deploy`, not by CI — the
GitHub Actions budget is drained. Do not trigger, re-run, or wait on any remote workflow
until you have done step 1 below.** Admin cache token `20260913c` is spent; public token
`20260913b`. There is no code work in progress.

Read `docs/handoff-2026-09-14.md` first — especially **Deploy mechanism**, **Deferred**,
**Pre-existing failures**, and **Traps**. Older handoffs are superseded on branch state;
their Traps sections remain accurate.

## Before anything else, verify the state instead of trusting this prompt

```sh
git fetch && git status --short && git log --oneline -3 origin/main
gh run list -R OJamals/masest --limit 5 --json name,status,conclusion,headSha,createdAt
```

Then confirm prod still serves `js/admin.js?v=20260913c` in `admin.html` (curl is
redirected by the context-mode hook in Bash; use `ctx_execute`).

## 1. Restore push → deploy without burning minutes (do this first)

The intended path is push → `Verify` workflow → `wrangler pages deploy`. Cloudflare Pages
never builds on its own (`production_deployments_enabled: false`). Two workflows consume
minutes: `Publish blog + content` on a **30-minute cron** (~48 one-minute runs a day, 27
counted by 14:36 UTC on 2026-09-14) and `Verify` (8–9 min per push). The repo is public,
where minutes are normally free, so first find out what is actually exhausted:

```sh
gh auth refresh -h github.com -s user          # billing endpoints need the user scope
gh api /users/OJamals/settings/billing/actions  # total_minutes_used, included_minutes
```

Then choose, and grill me before changing anything remote:

- **A. Stop the cron, keep the design.** Change `publish-blog.yml` to `repository_dispatch`
  + `workflow_dispatch` only (or a daily cron as a backstop). `verify.yml` already listens
  for `site-content-published`, and the Cloudflare production env already carries
  `GITHUB_DISPATCH_REPO` / `GITHUB_DISPATCH_TOKEN` / `CONTENT_PUBLISH_HOOK_URL` — **prove a
  CMS publish actually reaches the dispatch API before you remove the cron** (publish a
  draft blog post, watch `gh run list`). Cost: one Verify run to ship the change, nothing
  after. Push→deploy resumes as soon as the budget resets. This is my recommendation if the
  billing endpoint shows the cap is monthly and near reset.
- **B. Let Cloudflare build.** Flip the Pages source to `production_deployments_enabled:
  true` (build command is already `npm run build:content && npm run build`, destination
  `dist`; the build needs `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_ANON_KEY`
  in the Pages build environment). Zero Actions minutes, deploys on every push. Cost: the
  suite no longer gates the deploy — you must run `npm run verify:core` locally before each
  push, and `verify.yml` must drop its wrangler step or every push deploys twice. Keep
  Verify as a PR-only check. Choose this if the budget is a hard account cap with no reset
  in sight.
- **C. Stay manual** (the handoff's five-line wrangler recipe) until the budget resets.
  Zero risk, but nothing gates a push and every deploy depends on someone remembering
  `build:content` first.

Whatever you pick: docs-only commits go out with `[skip ci]` in the message; code never does.
Also raise `--retries=1` on the `web_vitals` job or investigate the cart CLS gate
(`tools/homepage-vitals.spec.mjs:234`) — it failed on the runner with two identical cold
samples and passes locally, and a flaky first job wastes a full re-run.

## 2. Deferred from session 6 — owner decisions, in value order

1. **Back exits the admin console.** `setTab` is `replaceState`-only by design
   (`js/admin.js:388`). If staff want Back to step through tabs, move to `pushState` with
   same-tab dedup and rework the dirty-guard cancel restore at `js/admin.js:382`. Ask me.
2. **Pre-disable gated order controls at template time.** ~86 ms window on a slow orders
   load where `order.write` buttons render enabled before `applyCapabilityUi`
   (`js/admin.js:341`). `js/admin/crm-prospects.js:147` shows the pattern.
3. **`prospect.delete`** is owner-only server-side (`functions/api/admin/crm/prospects.js:213`)
   with no client control. Wire a gated button or drop the branch.
4. **Measure the two phone-width surfaces the audit missed**: the CRM contact drawer and
   the support-console close control. Extend `tools/admin-responsive.spec.mjs`; open
   Accounts with an explicit `acctView` or `[data-au-open-company]`.
5. A failed feature `import()` only recovers by reload (browser module map). Leave it unless
   transient 500s show up in the integration health ledger.

## 3. Pre-existing failures — trace, do not paper over

- `tools/admin-quote-message-flows.spec.mjs:231` and `:288`: the support thread for
  `co-1` never renders. Reproduced on clean `2c881cc8`. Outside `verify:core`, so CI is
  blind to it. Suspect `3fb60bcb` (support conversation hidden in settings). Fix the
  console or the spec, with a mutation check, then add the spec to a gate CI runs.
- `tools/admin-content-cms.spec.mjs:114` (R2 viewer): red since `5ca20218`, cause untraced.
- Four unit tests fail **locally only** on a clean checkout while Verify passed them on
  `2c881cc8`: `tests/site-image-library.test.mjs:153` (`/img/updates/*.webp` unregistered),
  `tests/image-loading-strategy.test.mjs` (eager image), `tests/web-interface-guidelines.test.mjs`
  (alt/dimensions, h1 scale). Nothing untracked under `img/` or `updates/`. Find what the
  tests walk that differs between this machine and the runner (`dist/`, `.grok/`, a
  generated page) before touching any of them. Until then, run the unit suite knowing those
  four are red here.
- Known and closed, do not re-raise: the "SAFE ON SKIN AND EYES" label claim (EPA
  designation, owner-confirmed); Golf "Gym label"; product detail copy; Analytics + Finance
  stay separate tabs.

## How I want you to work

- Grill me on decisions rather than guessing. Give me what each answer costs before asking,
  and a recommendation when you have one.
- Where you are about to contradict a test-encoded decision or an approval I gave you, stop
  and say so — read the guard test's stated intent first.
- **Probe discipline.** Never regex a structured format: `tools/html-query.mjs` for HTML,
  `import` JS modules instead of scraping them. Mutation-test any probe whose number you
  will report. After a browser `fill`, read the value back. Ask the browser, not the
  stylesheet, which CSS rule wins.
- Use subagents (Sonnet, `model: sonnet` explicitly — the override does not cascade) for
  independent audits, give each its own port, and verify their headline claims yourself.
  Never run a Playwright suite while a Playwright subagent is live; never `npm test` beside
  Playwright.
- Admin specs: the auth stub must export `apiBlob`; strip `defaultBrowserType` from device
  profiles; register the `**/api/admin/**` catch-all route first.
- Never `npm run build` without `build:content` first; `git checkout -- sitemap.xml` after.
  Serve the tree with `python3 -m http.server`.
- `tests/website-language.test.mjs` bans the word "leg"+"acy" everywhere in js/ and html;
  `tests/build-architecture.test.mjs` pins the `qa:workspace-regressions` string; the admin
  cache token is pinned in `tests/auth-cache-release.test.mjs` — bump all of them together.
- Report honestly. If a spec claim is stale, say so; if a result is only partly explained,
  say which part is not.
