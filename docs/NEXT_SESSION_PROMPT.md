# MASEST — Next Session Prompt

Paste the block below to start the next development session.

---

```
MASEST site — continue development. Site is feature-complete (5 phases + QBO P4
auto-sync, all shipped + verified). This session = code-health hardening.

CONTEXT (verify against memory + live repo first):
- Deploy branch = main, LIVE on Cloudflare Pages. A Codex process edits this repo
  concurrently and auto-pushes to main. ALWAYS `git fetch && git rebase origin/main`
  before editing; re-Read files before editing; prefer an isolated git worktree
  (external path, symlink node_modules) for any multi-step work. Role with Codex is
  VERIFY its live pushes, not parallel-build the same files (collides).
- Tests: `node --test tests/*.test.mjs` (123 green as of last session). Visual guard:
  `node tools/visual-css-guard.mjs baseline|capture <label>|diff <label>` (strict
  0-pixel-diff; baseline on old code, capture on new, diff).

PRIMARY TASK — split js/main.js (1629 lines, loaded via <script src> on 10+ pages):
  Brainstorm -> plan -> execute (use superpowers skills). Behavior-preserving refactor.
  Natural module boundaries already mapped:
    - catalog-data.js : data constants (PRODUCTS, CATALOG_ORDER/GROUPS, REPLACEMENT_MAP,
                        PRODUCT_CATALOG_COPY, PRODUCT_GALLERY)  ~L4-535
    - chrome.js       : pageName, renderChrome (nav/footer)     ~L537-747
    - commerce.js     : products grid, cart buttons, initShop   ~L811-1209
    - services.js     : service catalog                          ~L1210-1311
    - quote.js        : quote form, proof filters                ~L1331-1544
    - ui.js           : reveal, responsive tables, before/after, lightbox, fallbacks
  Decide split mechanism: multiple plain <script> tags (preserve global load order) vs
  ES modules (type="module"). Stay vanilla — NO bundler/build step (stack decision).
  Update every HTML page's <script> tags accordingly. VERIFY: full node suite green +
  visual-css-guard 0-px diff (baseline pre-split, capture post-split) across all pages.

SECONDARY (optional): js/admin.js (836 lines) split along the same principles.

ALREADY DONE last session (do NOT redo):
  - QBO P4 auto-sync complete + verified (123 tests green).
  - QBO polish nits: stale webhook TODO removed; qbo-sync.js secret compare is now
    constant-time; migration moved to supabase/schema-qbo.sql.
  - CSS visual refactor verified (0-px diff). checkout-connector verified.

NOT dev work (flag to owner, don't attempt): QBO enablement (pg_cron+pg_net, set
QBO_* secrets, run admin Connect flow sandbox->prod, apply supabase/schema-qbo.sql);
rate-limit live-verify (RATE_KV bound — confirm 429s against live); Phase-5 owner
steps (schema-phase5.sql, ADMIN_EMAILS, Stripe portal).

Start by confirming current main HEAD + that 123 tests still pass, then brainstorm
the main.js split.
```

---

## Priority rationale

1. **main.js split** (1629 lines) — largest JS file, standing follow-up, highest
   code-health value, behavior-preserving + verifiable (suite + visual guard).
2. **admin.js split** (836 lines) — same treatment, secondary.
3. **rate-limit live-verify** + **owner enablement** — ops, not coding.

## State at handoff (session-3, 2026-06-18)

- main HEAD: QBO feature complete (`2953cbc` + local polish commit).
- All 4 prior open items resolved: CSS refactor, checkout-connector, Codex root, QBO P4.
- 123/123 node tests green.
