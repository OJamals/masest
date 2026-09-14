# Next-session entry prompt — after 2026-09-14 session 7

Continue the MASEST website renovation — transforming masest.co from an informational
site into a high-trust, conversion-optimized platform that sells the VertKleen line,
merging an Apple-grade aesthetic with industrial credibility.

Work in `/Users/omar/Claude/Projects/MASEST` on `main`. Codex may edit live:
`git fetch && git rebase origin/main` before every push; re-read a file before editing it.
`.dev.vars` holds the credentials.

Read `docs/handoff-2026-09-14b.md` first (Deploy mechanism, Open, Traps). It supersedes
`docs/handoff-2026-09-14.md` on branch state and on CI: **remote CI is allowed again** —
non-PR jobs run on the owner's self-hosted runner `masest-trusted`; PRs stay GitHub-hosted.

## Verify state before trusting this prompt

```sh
git fetch && git status --short && git log --oneline -3 origin/main
gh run list -R OJamals/masest --limit 5 --json name,status,conclusion,headSha,event
gh api /repos/OJamals/masest/actions/runners --jq '.runners[] | {name,status,labels:[.labels[].name]}'
```

Confirm prod serves `js/admin.js?v=20260914a` in `admin.html` (use `ctx_execute` for curl).

## 1. Open items, in value order

1. **Prove the CMS → GitHub dispatch.** It has never fired for Verify. Ask me to publish one
   harmless CMS change from the admin UI (or do it with me), then watch
   `gh run list --event repository_dispatch`. If nothing arrives, the Cloudflare secret
   `GITHUB_DISPATCH_TOKEN` is likely expired: say so, don't guess.
2. If a Verify run on `masest-trusted` fails on runner prerequisites (PostgreSQL, Chromium
   system libraries), fix the host with me — jobs have no root; never weaken the gate.
3. Then return to the renovation itself: conversion and trust work on the public site. Pick
   from `docs/decisions-pending-2026-09-10.md` and the latest audits, and propose before building.

## How I want you to work

- Grill me on decisions; give each option's cost and a recommendation.
- Probe discipline: never regex HTML (`tools/html-query.mjs`); mutation-test any probe whose
  number you report; sample timing at task granularity, not inside a microtask. Last session
  disproved an "86 ms" claim and two wrong suspect commits that came from inference.
- Subagents: Sonnet for audits/builds, Haiku for mechanical locate/compress work; pass
  `model` explicitly. One Playwright owner at a time; never `npm test` beside Playwright.
- Admin specs: auth stub exports `apiBlob`; strip `defaultBrowserType`; catch-all route first.
- Never `history.replaceState(null, …)` on admin.html — pass `history.state`.
- Never `npm run build` without `build:content` first; `git checkout -- sitemap.xml` after.
- The admin token is pinned in `tests/auth-cache-release.test.mjs`; the word "leg"+"acy" is
  banned in js/ and html; `tests/build-architecture.test.mjs` pins `qa:workspace-regressions`
  and the self-hosted runner guard.
