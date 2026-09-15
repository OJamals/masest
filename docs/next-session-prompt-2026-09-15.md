# Next-session entry prompt — after 2026-09-15 session 8

Continue the MASEST website renovation — transforming masest.co from an informational
site into a high-trust, conversion-optimized platform that sells the VertKleen line,
merging an Apple-grade aesthetic with industrial credibility.

Work in `/Users/omar/Claude/Projects/MASEST` on `main`. Codex and other agents may edit
live: `git fetch && git rebase origin/main` before every push; re-read a file before editing
it; if the shared checkout holds someone else's uncommitted work, build in a `git worktree`
and commit by explicit path. `.dev.vars` holds the credentials.

Read `docs/handoff-2026-09-15.md` first (Branch state, Owner decisions, Open, Traps). It
supersedes `docs/handoff-2026-09-14b.md` on branch state and the CMS dispatch question.

## Verify state before trusting this prompt

```sh
git fetch && git status --short && git log --oneline -6 origin/main
gh run list -R OJamals/masest --limit 5 --json name,status,conclusion,headSha,event
gh api /repos/OJamals/masest/actions/runners --jq '.runners[] | {name,status,labels:[.labels[].name]}'
```

Confirm prod serves `css/style.css?v=20260915a` and `/shipping-returns` returns 200 (use
`ctx_execute` for curl). If `.claude/worktrees/trust-copy` still exists and its branch is
merged, remove it.

## 1. Open items, in value order

1. **Embed Stripe's Payment Element in checkout** so buyers stop retyping details on
   Stripe's hosted page. The business is pre-revenue — the cheapest moment to change the
   payment step. Spec first (Checkout Sessions with Elements keeps the session webhook and
   order persistence); ground every API claim in Stripe's current docs.
2. `MerchantReturnPolicy` / `OfferShippingDetails` structured data on Product offers, from
   the terms now published at `/shipping-returns`.
3. Blog trust and depth: a real author byline (ask me for Matthew's surname and bio), the
   29 stub posts, and `docs/blog-consolidation-map-2026-09-10.md`.
4. Link the shipping and returns page from the order-confirmation email.

## How I want you to work

- Grill me on decisions; give each option's cost and a recommendation. Policy and money
  calls are mine — never invent terms.
- Probe discipline: never regex HTML (`tools/html-query.mjs` or rendered measurement);
  mutation-test any probe whose number you report, and any guard test you add.
- Subagents: Sonnet for audits/builds, Haiku for mechanical work; pass `model` explicitly.
  One Playwright owner at a time; never `npm test` beside Playwright. Verify agent claims
  before repeating them.
- A push to `main` cancels an in-flight Verify, including a CMS-dispatch run. Check
  `gh run list` first. Pushing a range whose tip commit says `[skip ci]` runs no Verify.
- `npm test` skips `tools/*.spec.mjs`; `verify:core` does not. Before pushing, run the
  Playwright stages that cover what you changed (`qa:commerce-smoke`,
  `qa:ui-critical:interaction`, `qa:workspace-regressions`), and `git grep` the visible
  text you changed across `tools/*.spec.mjs` for pinned lists and strict locators.
- `tests/shipping-policy-copy.test.mjs` ties policy wording to `FULFILLMENT_POLICY`: change
  both together.
- Never `npm run build` without `build:content` first; `git checkout -- sitemap.xml` after,
  and commit only a genuinely new sitemap URL.
- Admin token `20260914a` is pinned in `tests/auth-cache-release.test.mjs`; the public token
  is `20260915a` — never reuse a spent token. The word "leg"+"acy" is banned in js/ and html.
