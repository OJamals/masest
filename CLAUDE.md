@AGENTS.md

## Deploy

masest.co on Cloudflare Pages (project `masest-commerce`); prod branch = `main`
(push → auto-deploy). Live functions = `functions/api/*` only. Before every push:
`git fetch && git rebase origin/main` (Codex races the branch). Run tests with
`npm test`, not bare `node --test`.
