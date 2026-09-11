# Entry prompt for the next session

Copy everything below the line.

---

Continue the MASEST website renovation — the overarching goal is transforming masest.co
from an informational site into a high-trust, conversion-optimized platform that sells the
VertKleen line, merging an Apple-grade aesthetic with industrial credibility.

Work in the git worktree `/Users/omar/Claude/Projects/MASEST-design-system` on branch
`design-system-phase1`. **Never touch `/Users/omar/Claude/Projects/MASEST` — Codex edits it
live.** You may read `/Users/omar/Claude/Projects/MASEST/.dev.vars` for credentials; it
exists only there, not in the worktree.

State: `design-system-phase1` == `origin/main` == `62f4e07d`, clean, 0 ahead / 0 behind.
Suite 2940/2940. Everything through `62f4e07d` is **deployed and verified on production**.
**Nothing is pending — but do not push or deploy without asking me first.**

Read `docs/handoff-2026-09-11.md` first, especially its two trap sections — they are the
distilled cost of this session and the one before it. The older `docs/handoff-2026-09-10.md`
is superseded on branch state but its Traps section is still accurate.

**Do not re-raise SQ-06, SQ-08, SQ-13, SQ-16 or SQ-22**, and do not re-litigate whether
removing the homepage scrollybook was worth it — that was measured (80 ms versus removing
just its images) and decided.

## Start here

**Diagnose the `/services` FCP->LCP gap.** It is 700 ms — improved from 916 ms purely by the
`satoshi-07` preload that shipped for a different reason, but it should have closed much
further than it did. The heading is the LCP element and something still delays it. I gave a
partial explanation last session and said plainly it was incomplete; finish it. Measure
before proposing a fix.

The harness is `.qa-local/frontdoor/lcp-baseline.mjs` (gitignored). Production, real device
descriptors, CPU and network throttling, no scrolling, median of 3. Two traps in it are
documented in the handoff: `route.fulfill()` bypasses throttling, and `addInitScript`
accumulates per page.

## Then, in rough value order

1. **The purchase path end to end** — cart -> checkout -> confirmation, measured on real
   devices. This is where revenue actually leaks and it is still the biggest untouched
   surface. Drive a real purchase; the empty-cart checkout state measures nothing useful.
2. **`/products` and product detail** — the card work stopped at height. Nobody has asked
   whether the grid actually sells.
3. **`.product-comparison-link` elevation** — the last open item from D5 part B
   (`docs/elevation-semantics-proposal-2026-09-10.md`). 8/255 rest, 18/255 hover. Needs my
   decision, not analysis.
4. **The 23 consolidation MERGEs** — blocked by design, not effort: a redirect into a
   thinner page is content deletion, and 7 of 23 targets are smaller than their source.
   Multi-session content work. Ask before starting.

Do not start a new performance pass unless the numbers justify it. The homepage is at
1,780 ms mobile LCP and CLS 0.0003; `/blog`, `/proof` and `/industries` are text-LCP landing
at FCP. `/services` is the one page with a real gap left.

## Still owed to me, unblocked by nothing

- **Label PDFs.** `vertkleen-lam3-label-front.pdf` p.2 says "SAFE ON SKIN AND EYES" against
  an SDS that says "Causes eye irritation". The claim appears **nowhere on the web** — this
  is a printed-artwork and regulatory question, not a code one. Raise it, do not fix it.

## How I want you to work

- Grill me on decisions rather than guessing. Give measured numbers and what each answer
  costs before asking, and a recommendation when I ask for one.
- Where you are about to contradict a test-encoded decision or delete owner-approved
  content, say so plainly and make me confirm. This repo pins owner-approved claims in
  source-contract tests on purpose.
- Report honestly. If a spec claim is stale, say so with the measurement instead of
  implementing around it. If you get something wrong, correct it in one line and move on —
  and if a result is only partly explained, say which part is not.
- Use subagents for independent analysis to save wall-clock time, but **verify their
  headline claims yourself**. Across three sessions every agent has produced real findings
  and at least one confidently-wrong headline.
- Measure the thing that actually ships. Most of the wrong findings on this branch came
  from measuring a local server, a resized desktop window, or a stubbed response.
- Never `npm test` alongside Playwright — one suite at a time; a spec that shells out to a
  subprocess loses the race. Never `npm run build` without `build:content` first. Read the
  summary counts in the log rather than trusting a task notification's exit code.
