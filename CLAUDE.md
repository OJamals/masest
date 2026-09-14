@AGENTS.md

## Deploy

masest.co on Cloudflare Pages (project `masest-commerce`); prod branch = `main`
(push to `OJamals/masest` → Verify workflow → Wrangler direct deploy). Since
2026-09-14 every non-PR job runs on the owner's self-hosted runner (label
`masest-trusted`); pull requests stay on GitHub-hosted Ubuntu so fork code never
reaches it (pinned by `tests/build-architecture.test.mjs`; fork-PR approval is
"all outside contributors"). `medicux/masest` was a private stand-in during an
OJamals account outage and is now retired. Cloudflare Pages still has a GitHub
source pointing at `OJamals/masest`, but with `production_deployments_enabled:false`
and previews `none`, so it never builds — deploys come only from the Verify
workflow's `wrangler pages deploy`. Live functions = `functions/api/*` only. Before every push:
`git fetch && git rebase origin/main` (Codex races the branch). Run tests with
`npm test`, not bare `node --test`.
