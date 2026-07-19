---
id: masest-035
title: Carry page and cart context from chat into quote handoff
agent: codex
risk: medium
grill: completed
verification:
  - node --test tests/customer-chat.test.mjs tests/cart.test.mjs tests/conversion-entry.test.mjs
  - playwright test tools/contact-prefill.spec.mjs --reporter=line
  - npm run check
  - npm run verify
---

# Grill Gate

- Owner: maintainer.
- Decision source: maintainer selected a bounded same-origin URL handoff; personal/session/history data and backend state are forbidden.
- Problem: guest/auth chat users must repeat product/cart context when moving to existing quote flow.
- Out of scope: DB context columns, admin conversion, chat history, auto-submit, personal prefill, and price/freight calculation.
- Review failure: sensitive/arbitrary data enters URL, context is invisible/uneditable, URL cap fails, primary chat actions regress, attribution conflicts, or gates fail.
- Riskiest assumption: product identity is inferable from stable page data/path and minimum useful context fits the URL cap.
- Smallest acceptable: a secondary chat action carrying bounded product, cart, path, and source into visible editable quote prefill.

# Context

Quote form already accepts product, message, industry, email, and type prefill. Add a shared bounded request-context contract without creating new backend state or weakening guest/auth primary actions.

# Acceptance Criteria

- Guest and authenticated chat states expose secondary “Request a quote with this context”.
- Handoff includes only current product/SKU from stable page data/path, up to eight cart SKU/quantity pairs, same-origin page path, and source `customer_chat`.
- Name, email, tokens, message history, pricing tier, and arbitrary query strings never enter the handoff.
- Malicious SKU/path/query content is normalized or rejected.
- URL length is capped; excess cart state becomes a count summary.
- Quote form visibly and editably shows prefilled product, volume, and notes and submits the existing payload plus allowed source.
- Existing Send/login actions remain primary; existing chat and quote behavior remains intact.
- Tests cover product/general/unknown pages, empty/oversized carts, guest/auth, malicious input, prefill/edit/submit, back navigation, and URL cap.
- All frontmatter verification commands pass; mark row 035 `DONE` afterward.

# Constraints

- Required process: read and use `/Users/omar/.codex/plugins/cache/agent-skills/agent-skills/1.0.0/skills/frontend-ui-engineering/SKILL.md`; use the repository codebase-memory graph before grep/glob/file discovery.
- Dependencies: `masest-019`, `masest-024`, and `masest-026` must be accepted first.
- Scope: new `js/request-context.js`, customer chat, engagement/quote consumption, minimal quote source/summary markup, chat CSS, focused tests, and row-035 status.
- Do not add backend context storage, send chat history, auto-submit, prefill personal data, or calculate pricing/freight.
- STOP if stable product identity is unavailable, business requires personal/history data, useful context cannot fit the cap, or source conflicts with CRM attribution.

# Review Notes

- Inspect every encoded field and same-origin/path validation.
- Review action hierarchy, editable prefill, URL leakage, back behavior, and mobile keyboard/focus flow.
