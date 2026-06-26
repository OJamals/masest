# CRM Deal Pipeline (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the flat admin Quotes list into a value-weighted deal pipeline — 6 stages, drag kanban, forecast strip, won/lost capture, and a quote detail drawer reusing Slice 1's CRM panel.

**Architecture:** Extend the existing `quotes` table with pipeline columns (no new table). A pure `_lib/crm-pipeline.js` owns the stage machine + forecast math; `functions/api/admin/quotes.js` wires it into GET/POST; `js/admin/quotes.js` adds a List⇄Board toggle, kanban, forecast, and a `<dialog>` drawer that mounts Slice 1's `createCrmPanel(...).mount(el,'quote',id)`. Zero edits to `js/admin.js` / `admin.html` (the concurrent CMS agent owns those) — the CRM panel is imported directly into `quotes.js`.

**Tech Stack:** Cloudflare Pages Functions, Supabase Postgres, vanilla JS admin modules, `node --test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-25-crm-deal-pipeline-design.md`

---

## File Structure

- Create `supabase/schema-crm-pipeline.sql` — additive migration: 5 columns + stage CHECK + index.
- Create `functions/_lib/crm-pipeline.js` — pure stage machine, probabilities, `stagePatch`, `pipelineSummary`.
- Modify `functions/api/admin/quotes.js` — GET select + `?view=pipeline`; POST stage/value fields; convert→won.
- Modify `js/admin/quotes.js` — toggle, board, forecast, drawer; reuse `createCrmPanel`.
- Modify `css/components.css` — append `.pipe-*` board/card/forecast + `.adm-drawer` styles.
- Create `tests/admin-crm-pipeline-lib.test.mjs`, `tests/admin-crm-pipeline-schema.test.mjs`, `tests/admin-quotes-pipeline.test.mjs`.
- Create `tools/admin-crm-pipeline.spec.mjs` — Playwright board + drawer smoke.

## Validation Gates

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/admin-crm-pipeline-lib.test.mjs
npm run check
npm test
npm run build
```

---

## Task 1: Pipeline schema migration

**Files:** Create `supabase/schema-crm-pipeline.sql`, `tests/admin-crm-pipeline-schema.test.mjs`

- [ ] **Step 1: Failing schema test** — `tests/admin-crm-pipeline-schema.test.mjs`

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/schema-crm-pipeline.sql', import.meta.url), 'utf8');

test('adds the five pipeline columns', () => {
  for (const col of ['pipeline_stage', 'deal_value', 'expected_close', 'stage_changed_at', 'lost_reason']) {
    assert.match(sql, new RegExp(`add column if not exists ${col}\\b`));
  }
});

test('constrains stage to the six-stage allow-list', () => {
  assert.match(sql, /pipeline_stage in \('new','qualified','sample_audit','proposal','won','lost'\)/);
});

test('indexes the pipeline lookup', () => {
  assert.match(sql, /create index if not exists quotes_pipeline_stage_idx/);
});
```

- [ ] **Step 2: Run → fails ENOENT.** `node --test tests/admin-crm-pipeline-schema.test.mjs`

- [ ] **Step 3: Create `supabase/schema-crm-pipeline.sql`**

```sql
-- schema-crm-pipeline.sql — CRM slice 2: deal pipeline fields on quotes.
-- Additive + idempotent. quotes already grants service_role (schema-quotes.sql), so no new grants.
-- Apply once via the pooler (psql) or the Supabase SQL editor.

alter table public.quotes add column if not exists pipeline_stage   text not null default 'new';
alter table public.quotes add column if not exists deal_value       numeric(12,2);
alter table public.quotes add column if not exists expected_close   date;
alter table public.quotes add column if not exists stage_changed_at timestamptz;
alter table public.quotes add column if not exists lost_reason      text;

do $$ begin
  alter table public.quotes add constraint quotes_pipeline_stage_chk
    check (pipeline_stage in ('new','qualified','sample_audit','proposal','won','lost'));
exception when duplicate_object then null; end $$;

create index if not exists quotes_pipeline_stage_idx
  on public.quotes (pipeline_stage, stage_changed_at desc);

-- Optional backfill (owner-run, not automatic): map historical closed quotes.
-- update public.quotes set pipeline_stage='won'  where status='closed' and next_step ilike '%converted%';
-- update public.quotes set pipeline_stage='lost' where status='closed' and pipeline_stage='new';
```

- [ ] **Step 4: Run → pass.** `node --test tests/admin-crm-pipeline-schema.test.mjs`
- [ ] **Step 5: Commit** `git add supabase/schema-crm-pipeline.sql tests/admin-crm-pipeline-schema.test.mjs && git commit -m "feat(crm): deal-pipeline schema on quotes"`

---

## Task 2: Pure pipeline lib

**Files:** Create `functions/_lib/crm-pipeline.js`, `tests/admin-crm-pipeline-lib.test.mjs`

- [ ] **Step 1: Failing lib test** — `tests/admin-crm-pipeline-lib.test.mjs`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PIPELINE_STAGES, STAGE_PROBABILITY, LOST_REASONS,
  validStage, isTerminal, stagePatch, pipelineSummary,
} from '../functions/_lib/crm-pipeline.js';

const NOW = new Date('2026-06-25T12:00:00.000Z');

test('six stages in funnel order', () => {
  assert.deepEqual(PIPELINE_STAGES, ['new', 'qualified', 'sample_audit', 'proposal', 'won', 'lost']);
});

test('validStage + isTerminal', () => {
  assert.equal(validStage('proposal'), true);
  assert.equal(validStage('bogus'), false);
  assert.equal(isTerminal('won'), true);
  assert.equal(isTerminal('lost'), true);
  assert.equal(isTerminal('new'), false);
});

test('stagePatch rejects invalid stage', () => {
  assert.deepEqual(stagePatch({ stage: 'bogus' }, NOW), { error: 'invalid_stage' });
});

test('stagePatch non-terminal sets stage + stamp only', () => {
  const { patch } = stagePatch({ stage: 'qualified' }, NOW);
  assert.equal(patch.pipeline_stage, 'qualified');
  assert.equal(patch.stage_changed_at, NOW.toISOString());
  assert.equal(patch.status, undefined);
});

test('stagePatch won closes the quote', () => {
  const { patch } = stagePatch({ stage: 'won', actor: 'a@b.co' }, NOW);
  assert.equal(patch.status, 'closed');
  assert.equal(patch.handled_by, 'a@b.co');
});

test('stagePatch lost captures reason (defaults to other) and closes', () => {
  assert.equal(stagePatch({ stage: 'lost', lost_reason: 'price' }, NOW).patch.lost_reason, 'price');
  assert.equal(stagePatch({ stage: 'lost' }, NOW).patch.lost_reason, 'other');
  assert.equal(stagePatch({ stage: 'lost' }, NOW).patch.status, 'closed');
});

test('pipelineSummary weights value by stage probability, excludes null values', () => {
  const s = pipelineSummary([
    { pipeline_stage: 'qualified', deal_value: 1000 },
    { pipeline_stage: 'proposal', deal_value: 2000 },
    { pipeline_stage: 'proposal', deal_value: null },
    { pipeline_stage: 'lost', deal_value: 5000 },
  ]);
  assert.equal(s.weighted, 1700);            // 1000*0.3 + 2000*0.7
  assert.equal(s.open_value, 3000);          // qualified+proposal, not lost
  const proposal = s.stages.find((x) => x.stage === 'proposal');
  assert.equal(proposal.count, 2);
  assert.equal(proposal.value, 2000);
});

test('LOST_REASONS + STAGE_PROBABILITY present', () => {
  assert.ok(LOST_REASONS.includes('competitor'));
  assert.equal(STAGE_PROBABILITY.won, 1);
});
```

- [ ] **Step 2: Run → fails (module missing).**

- [ ] **Step 3: Create `functions/_lib/crm-pipeline.js`**

```js
// Pure deal-pipeline helpers (slice 2): stage machine, probabilities, stage-patch
// builder, forecast summary. No I/O — functions/api/admin/quotes.js passes rows in,
// gets normalized data out. Mirrors functions/_lib/quote-convert.js.

export const PIPELINE_STAGES = ['new', 'qualified', 'sample_audit', 'proposal', 'won', 'lost'];

export const STAGE_LABELS = {
  new: 'New', qualified: 'Qualified', sample_audit: 'Sample / Audit',
  proposal: 'Proposal', won: 'Won', lost: 'Lost',
};

// Weighted-forecast probability per stage (v1 fixed constants).
export const STAGE_PROBABILITY = { new: 0.1, qualified: 0.3, sample_audit: 0.5, proposal: 0.7, won: 1, lost: 0 };

export const LOST_REASONS = ['price', 'competitor', 'spec', 'timing', 'no_decision', 'other'];

export function validStage(stage) { return PIPELINE_STAGES.includes(String(stage)); }
export function isTerminal(stage) { return stage === 'won' || stage === 'lost'; }

// Build the quotes patch for a stage move. `now` injected for deterministic tests.
// Terminal stages also close the quote; lost captures a reason (free text, capped).
export function stagePatch({ stage, lost_reason, actor } = {}, now) {
  if (!validStage(stage)) return { error: 'invalid_stage' };
  const ts = (now || new Date()).toISOString();
  const patch = { pipeline_stage: stage, stage_changed_at: ts };
  if (isTerminal(stage)) {
    patch.status = 'closed';
    patch.handled_at = ts;
    if (actor) patch.handled_by = actor;
  }
  if (stage === 'lost') patch.lost_reason = String(lost_reason || '').trim().slice(0, 280) || 'other';
  return { patch };
}

// Forecast over quote rows. Null/zero deal_value rows are counted but excluded from $ math.
export function pipelineSummary(rows = []) {
  const stages = PIPELINE_STAGES.map((stage) => ({ stage, count: 0, value: 0 }));
  const byStage = Object.fromEntries(stages.map((s) => [s.stage, s]));
  let weighted = 0;
  let openValue = 0;
  for (const row of rows) {
    const stage = validStage(row.pipeline_stage) ? row.pipeline_stage : 'new';
    const bucket = byStage[stage];
    bucket.count += 1;
    const value = Number(row.deal_value);
    if (Number.isFinite(value) && value > 0) {
      bucket.value = +(bucket.value + value).toFixed(2);
      weighted = +(weighted + value * (STAGE_PROBABILITY[stage] || 0)).toFixed(2);
      if (stage !== 'lost' && stage !== 'won') openValue = +(openValue + value).toFixed(2);
    }
  }
  return { stages, weighted, open_value: openValue };
}
```

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `git add functions/_lib/crm-pipeline.js tests/admin-crm-pipeline-lib.test.mjs && git commit -m "feat(crm): pure pipeline stage + forecast lib"`

---

## Task 3: Wire the lib into the quotes API

**Files:** Modify `functions/api/admin/quotes.js`; Create `tests/admin-quotes-pipeline.test.mjs`

- [ ] **Step 1: Failing source-contract test** — `tests/admin-quotes-pipeline.test.mjs`

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../functions/api/admin/quotes.js', import.meta.url), 'utf8');

test('imports the pure pipeline lib at the right depth', () => {
  assert.match(src, /from '\.\.\/\.\.\/_lib\/crm-pipeline\.js'/);
  assert.doesNotMatch(src, /from '\.\.\/_lib\/crm-pipeline/);
});
test('GET list selects the new pipeline columns', () => {
  assert.match(src, /pipeline_stage,deal_value,expected_close,stage_changed_at,lost_reason/);
});
test('serves a pipeline forecast view', () => {
  assert.match(src, /=== 'pipeline'/);
  assert.match(src, /pipelineSummary\(/);
});
test('POST validates stage + accepts deal fields', () => {
  assert.match(src, /stagePatch\(/);
  assert.match(src, /invalid_stage/);
  assert.match(src, /body\.deal_value/);
  assert.match(src, /body\.expected_close/);
});
test('convert marks the quote won', () => {
  assert.match(src, /pipeline_stage: 'won'/);
});
test('stays staff + write guarded', () => {
  assert.match(src, /requireStaff/);
  assert.match(src, /staffCanWrite\(role\)/);
});
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Edit `functions/api/admin/quotes.js`**

3a. Add the import after the `paginate` import:
```js
import { stagePatch, pipelineSummary } from '../../_lib/crm-pipeline.js';
```

3b. At the very top of the `if (request.method === 'GET') {` block, before the CSV check:
```js
    if (new URL(request.url).searchParams.get('view') === 'pipeline') {
      const { data, error } = await sb.from('quotes').select('id,pipeline_stage,deal_value').neq('status', 'spam').limit(5000);
      if (error) {
        if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { summary: pipelineSummary([]), needs_migration: true });
        return json(500, { error: error.message });
      }
      return json(200, { summary: pipelineSummary(data || []) });
    }
```

3c. Extend the list `.select(...)` column string — append the five columns:
```js
      .select('id,created_at,type,name,email,company,phone,product,industry,location,message,payload,status,notes,handled_at,handled_by,priority,next_step,due_at,lead_score,assigned_to,assigned_at,pipeline_stage,deal_value,expected_close,stage_changed_at,lost_reason', { count: 'exact' })
```

3d. In the `convert` action, the `quotes.update({...})` call — add `pipeline_stage: 'won'`:
```js
      await sb.from('quotes').update({
        status: 'closed',
        pipeline_stage: 'won',
        handled_at: new Date().toISOString(),
        handled_by: user.email || null,
        next_step: 'Converted to order',
        due_at: null,
      }).eq('id', body.id);
```

3e. In the generic patch section, after the `next_step` line and before `const parsedDueAt`:
```js
    if (body.pipeline_stage !== undefined) {
      const res = stagePatch({ stage: body.pipeline_stage, lost_reason: body.lost_reason, actor: user.email || null });
      if (res.error) return json(400, { error: res.error });
      Object.assign(patch, res.patch);
    }
    if (body.deal_value !== undefined) {
      if (body.deal_value === null || body.deal_value === '') patch.deal_value = null;
      else {
        const v = Number(body.deal_value);
        if (!Number.isFinite(v) || v < 0) return json(400, { error: 'invalid_deal_value' });
        patch.deal_value = v;
      }
    }
    if (body.expected_close !== undefined) {
      patch.expected_close = body.expected_close ? String(body.expected_close).slice(0, 10) : null;
    }
```

3f. Extend BOTH returned `.select(...)` strings in the generic patch + followup updates to include pipeline fields:
```js
      .select('id,status,notes,handled_at,priority,next_step,due_at,lead_score,assigned_to,assigned_at,pipeline_stage,deal_value,expected_close,lost_reason')
```

- [ ] **Step 4: Run focused + check** `node --test tests/admin-quotes-pipeline.test.mjs && npm run check`
- [ ] **Step 5: Commit** `git add functions/api/admin/quotes.js tests/admin-quotes-pipeline.test.mjs && git commit -m "feat(crm): quotes API stage moves + forecast view"`

---

## Task 4: Board + toggle + forecast + drawer (UI)

**Files:** Modify `js/admin/quotes.js` (extend `createQuotesTab`)

Implementation is a single rewrite of `js/admin/quotes.js` keeping the public shape
`createQuotesTab(...) → { renderQuotePipeline, wireQuotes }` (called unchanged from `js/admin.js`).
Full target source is in **Appendix A** of this plan. Key behaviors:

- [ ] **Step 1** Add imports: `money, confirmDialog, dateTime as date` from `../util.js`; `createCrmPanel` from `./crm.js`. Construct `const crm = createCrmPanel({ $, api, admSkeleton, admEmpty });` inside the factory.
- [ ] **Step 2** Inject a `.pipe-toggle` (List | Board) once into `#admQuotes`'s parent, above the list, in `renderQuotePipeline`; persist `state.quotesView` (default `'list'`). Route to `renderQuoteBoard` when `'board'`.
- [ ] **Step 3** `renderQuoteBoard()`: 6 `.pipe-col` columns (STAGE order) with header (label, count, column $); `.pipe-card[draggable]` per quote showing company/name, `fmtMoney(deal_value)`, priority badge, owner, overdue/`.is-stale` flags, and a keyboard `<select data-card-stage>`. Excludes `status==='spam'`.
- [ ] **Step 4** `renderForecast()`: fetch `GET /api/admin/quotes?view=pipeline`, render `.pipe-forecast` strip (open $, weighted $, per-stage chips) above the board.
- [ ] **Step 5** Drag: in `wireQuotes`, delegate `dragstart` on `[data-card-id]` (stash id via `dataTransfer`), `dragover` on `[data-col]` (preventDefault), `drop` → `moveStage(id, stage)`. Also delegate `change` on `[data-card-stage]` → `moveStage` (keyboard path).
- [ ] **Step 6** `moveStage(id, stage)`: if `stage==='lost'`, `confirmDialog` + reason `<select>` (LOST_REASONS) → POST `{id, pipeline_stage:'lost', lost_reason}`; if `stage==='won'`, `confirmDialog('Mark won? Use Convert to create the order.')` → POST `{id, pipeline_stage:'won'}`; else POST `{id, pipeline_stage}`. Re-render board + forecast.
- [ ] **Step 7** Drawer: `openQuoteDrawer(quote)` builds a `<dialog class="adm-drawer">` appended to `<body>` with a sub-tab strip Details | Timeline | Tasks | Notes. Details = the existing edit controls (status/priority/owner/next_step/due/notes/deal_value/expected_close/Save + convert block) extracted into `quoteDetailControls(quote)`. On selecting Timeline/Tasks/Notes, `crm.mount(tabBody, 'quote', quote.id)`. Card title click + a `[data-open-quote]` button open it. Dialog closes on backdrop/Esc/close button and is removed from DOM.
- [ ] **Step 8** Keep the existing list accordion (`renderQuotePipeline` list branch) as the default view, unchanged in behavior.
- [ ] **Step 9** Run `npm run check`.
- [ ] **Step 10: Commit** `git add js/admin/quotes.js && git commit -m "feat(crm): quotes kanban board, forecast strip, deal drawer"`

---

## Task 5: Board CSS

**Files:** Modify `css/components.css` (append only)

- [ ] **Step 1** Append the `.pipe-*` + `.adm-drawer` block from **Appendix B**. Reuse existing `.badge`/`.btn`/`.muted`/`.skeleton`/`.empty-state` tokens. AA contrast; visible focus rings; board scrolls horizontally under ~900px.
- [ ] **Step 2** `npm run build`
- [ ] **Step 3: Commit** `git add css/components.css && git commit -m "feat(crm): pipeline board + drawer styles"`

---

## Task 6: Playwright board + drawer smoke

**Files:** Create `tools/admin-crm-pipeline.spec.mjs` (model on `tools/admin-crm-drawer.spec.mjs`)

- [ ] **Step 1** Spec: sign in as staff (reuse the existing admin-spec auth helper/env), open Quotes, click the Board toggle, assert 6 `.pipe-col` columns render; open a card, assert the drawer shows 4 sub-tabs; switch to Notes and assert the composer renders. Screenshots with `reducedMotion:'reduce'`. Skip cleanly when staff creds env is absent (match the existing spec's guard).
- [ ] **Step 2** Run `npm run smoke:admin` (or the project's Playwright runner) if creds available; else record the env blocker.
- [ ] **Step 3: Commit** `git add tools/admin-crm-pipeline.spec.mjs && git commit -m "test(crm): playwright pipeline board + drawer smoke"`

---

## Task 7: Full verification + handoff

- [ ] **Step 1** `npm run check && npm test && npm run build` — all green (Slice 1 count + the new tests).
- [ ] **Step 2** `git status --short` — only the files in File Structure; no stray `js/admin.js`/`admin.html`/CMS files.
- [ ] **Step 3** Push branch, open PR off `feat/crm-contact-view` (base), body links both specs + notes `schema-crm-pipeline.sql` owner-apply.
- [ ] **Step 4** Record durable decisions in file memory (`~/.claude/projects/.../memory/`): pipeline slice shipped, stage set, branch, prod-apply pending.

---

## Appendix A — full `js/admin/quotes.js`

The implementer writes the file to satisfy Task 4's behaviors. It MUST keep the exported
factory shape and the `renderQuotePipeline` / `wireQuotes` return so `js/admin.js` needs no
change. The board, forecast, drag handlers, `moveStage`, and `openQuoteDrawer` (mounting
`crm.mount(el,'quote',id)`) live here. `quoteDetailControls(quote)` is shared by the list
accordion body and the drawer Details tab (DRY). See Task 4 steps 1–8 for exact behavior.

## Appendix B — `css/components.css` append

```css
/* CRM deal pipeline (slice 2) */
.pipe-toggle { display:inline-flex; gap:4px; margin:0 0 12px; }
.pipe-forecast { display:flex; flex-wrap:wrap; gap:16px; align-items:baseline; margin:0 0 12px; padding:12px 14px; border:1px solid var(--border,#e5e7eb); border-radius:10px; background:var(--surface,#fff); }
.pipe-forecast b { font-size:1.1rem; }
.pipe-forecast .pipe-chip { font-size:.8rem; color:var(--muted,#6b7280); }
.pipe-board { display:flex; gap:12px; overflow-x:auto; padding-bottom:8px; align-items:flex-start; }
.pipe-col { flex:0 0 240px; background:var(--surface-2,#f7f7f8); border:1px solid var(--border,#e5e7eb); border-radius:10px; padding:8px; min-height:120px; }
.pipe-col.is-over { outline:2px dashed var(--accent,#7c3aed); outline-offset:-2px; }
.pipe-col-head { display:flex; justify-content:space-between; align-items:baseline; font-weight:600; padding:4px 6px 8px; }
.pipe-col-head .muted { font-weight:400; font-size:.8rem; }
.pipe-card { background:#fff; border:1px solid var(--border,#e5e7eb); border-radius:8px; padding:8px 10px; margin-bottom:8px; cursor:grab; display:grid; gap:4px; }
.pipe-card:focus-visible { outline:2px solid var(--accent,#7c3aed); outline-offset:1px; }
.pipe-card.is-dragging { opacity:.5; }
.pipe-card.is-stale { border-left:3px solid #d97706; }
.pipe-card-title { font-weight:600; }
.pipe-card-meta { display:flex; flex-wrap:wrap; gap:6px; align-items:center; font-size:.8rem; color:var(--muted,#6b7280); }
.pipe-card select { font-size:.75rem; }
.adm-drawer { border:none; border-radius:12px 0 0 12px; padding:0; width:min(560px,92vw); max-width:92vw; height:100vh; max-height:100vh; margin:0 0 0 auto; }
.adm-drawer::backdrop { background:rgba(0,0,0,.4); }
.adm-drawer-inner { padding:20px; display:grid; gap:12px; }
.adm-drawer-tabs { display:flex; gap:4px; border-bottom:1px solid var(--border,#e5e7eb); padding-bottom:8px; }
@media (max-width:900px){ .pipe-col{ flex-basis:200px; } }
```
