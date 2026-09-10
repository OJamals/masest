# Entry prompt for the next session

Copy everything below the line.

---

Continue the MASEST website renovation — the overarching goal is transforming masest.co
from an informational site into a high-trust, conversion-optimized platform that sells the
VertKleen line, merging an Apple-grade aesthetic with industrial credibility.

Work in the git worktree `/Users/omar/Claude/Projects/MASEST-design-system` on branch
`design-system-phase1`. **Never touch `/Users/omar/Claude/Projects/MASEST` — Codex edits it
live.**

State: 32 commits ahead of `origin/main`, 0 behind. Suite 2974/2974. Cache token
`20260910a`, unified and never deployed. **NOTHING IS PUSHED — do not push, and do not
deploy, without asking me first.**

Read `docs/handoff-2026-09-10.md` first — especially its "Traps" section, which is the
distilled cost of two sessions. Then `docs/decisions-pending-2026-09-10.md` for the
decision record, and `docs/site-quality-remediation-2026-09-07.md` for the spec, which is
annotated in place where findings turned out wrong.

**Do not re-raise SQ-06, SQ-08, SQ-13, SQ-16 or SQ-22.** All five were measured and
corrected; sixteen findings across this branch have turned out stale, misattributed, or
backwards. Measure before implementing, and measure the thing that actually ships.

## Start by resolving one decision I still owe you an answer on

Five comparison slugs serve **both** `/blog/X` and `/comparisons/X` as live 200s, each
self-canonicalizing, so neither defers to the other:
`beer-line-cleaner-cost-comparison`, `hcr-vs-rydlyme`, `lam3-vs-wet-forget`,
`cr-hd-vs-simple-green`, `vertkleen-hcr-vs-clr`.

This blocks two things: the consolidation plan for 27 posts, and whether two of the eight
expanded posts should ship at all (publishing them at 1,200 words deepens the
cannibalization). Put the choice to me with the trade-offs before doing anything that
depends on it.

## Then, in this order

1. **Apply what is already written and waiting.** Four documents in `docs/` are finished
   work that needs a human to land it, not more analysis:
   `sq24-25-expanded-posts` (8 posts → the CMS), `non-toxic-claim-fix` (9 CMS edits),
   `label-claim-review` (13 edits, 2 printed labels — needs regulatory sign-off),
   `blog-consolidation-map` (27 posts, includes the redirect mechanism). Ask me which I
   want moving and whether I have done the CMS side.
2. **D5 part B**, the remaining four flagged components in
   `docs/elevation-semantics-proposal-2026-09-10.md` — `.btn-primary`, `.shop-card`,
   `.job-plan-card`, `.product-comparison-link`. Verify each against the rendered result
   before proposing; that document's headline finding about `.bento-cell.ink` was wrong
   because it assumed a token that does not exist.
3. **Then open new ground on the core objective.** The remediation spec is nearly
   exhausted; what is left is conversion and craft rather than defect-fixing. Strong
   candidates, in rough value order:
   - **The purchase path end to end** — cart → checkout → confirmation, measured on real
     devices, not assumed. This is where revenue actually leaks.
   - **The `/products` and product-detail experience** — the card work stopped at height;
     nobody has looked at whether the grid actually sells.
   - **Mobile.** Almost everything this branch measured was desktop viewports.
   - **Perf on the real thing** — LCP/INP/CLS from production, not a local server.

## How I want you to work

- Grill me on decisions rather than guessing. Give measured numbers and what each answer
  costs before asking, and give a recommendation when I ask for one.
- Where I am about to contradict a test-encoded decision or delete owner-approved content,
  say so plainly and make me confirm.
- Report honestly. If a spec claim is stale, say so with the measurement instead of
  implementing around it. If you get something wrong, correct it in one line and move on.
- Use subagents for independent analysis to save wall-clock time — but verify their
  headline claims yourself. Both agents in the last session produced real findings **and**
  a confidently-wrong headline.
- Never `npm test` alongside Playwright. Never `npm run build` without `build:content`
  first. Read `NPM_TEST_EXIT` in the log rather than trusting a task notification's exit
  code.
