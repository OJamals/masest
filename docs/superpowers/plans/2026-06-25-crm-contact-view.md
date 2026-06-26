# CRM Contact View (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polymorphic activity timeline + notes + tasks to the staff admin, surfaced as Timeline/Tasks/Notes sub-tabs inside the company detail drawer.

**Architecture:** Two additive Postgres tables (`crm_notes`, `crm_tasks`) keyed by `(subject_type, subject_id)`. Pure logic lives in `functions/_lib/crm.js` (validation, row builders, task transitions, timeline merge) so it is unit-testable against fake clients, mirroring `functions/_lib/quote-convert.js`. Three thin Cloudflare Pages Functions under `functions/api/admin/crm/` (guarded by `requireStaff`/`staffCanWrite`) do I/O and call the lib. The timeline is **virtual**: its endpoint queries existing per-company signals (orders, messages, shipment_events, audit_log, best-effort quotes) plus the two new tables and merges them at read time — no write-path instrumentation, no backfill. Client rendering lives in a new `js/admin/crm.js` module (native ESM, injected into `companies.js` via the existing DI pattern) so `companies.js` stays focused.

**Tech Stack:** Vanilla ES modules (no UI build step), Cloudflare Pages Functions, Supabase Postgres (service-role client), `node:test` (static source-assertion + executable pure-lib), Playwright (API-stubbed admin boot).

**Working dir:** isolated worktree `/Users/omar/Claude/Projects/masest-crm` on branch `feat/crm-contact-view` (node_modules symlinked). Run all commands there.

**Conventions locked from the codebase:**
- Import depth for `functions/api/admin/crm/*.js` → `../../../_lib/...` (verified against `functions/api/admin/qbo/*.js`).
- Guards: `const { user, staff, role } = await requireStaff(request, env); if (!user) return json(401,...); if (!staff) return json(403,...);` then write methods add `if (!staffCanWrite(role)) return json(403,...)`.
- Audit: `recordAudit(sb, { user, action, targetType, targetId, detail })` (best-effort).
- Missing-table tolerance: `if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { ..., needs_migration: true });` (pattern from `quotes.js`).
- Grants: every new table needs `grant all privileges on table ... to service_role;` + `grant usage, select on all sequences in schema public to service_role;` or inserts fail `42501`.
- Client helpers from `js/util.js`: `esc`, `dateTime` (aliased `date`), `confirmDialog`. Skeleton/empty injected as `admSkeleton(rows)` / `admEmpty(icon,title,body)`.

**Out of scope (later slices):** `quotes.pipeline_stage` + grouped board; a global cross-company follow-ups badge on the admin Overview (the tasks endpoint already supports `?scope=mine|overdue|open`, so it is a thin follow-up); quote-drawer CRM UI (schema is polymorphic and ready); note editing; CMS.

---

### Task 1: Schema — `crm_notes` + `crm_tasks`

**Files:**
- Create: `supabase/schema-crm.sql`
- Test: `tests/admin-crm-schema.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/admin-crm-schema.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/schema-crm.sql', import.meta.url), 'utf8');

test('schema-crm creates both tables idempotently', () => {
  assert.match(sql, /create table if not exists public\.crm_notes/i);
  assert.match(sql, /create table if not exists public\.crm_tasks/i);
});

test('schema-crm constrains subject, kind and status', () => {
  assert.match(sql, /subject_type\s+text\s+not null\s+check\s*\(subject_type in \('company','quote'\)\)/i);
  assert.match(sql, /kind\s+text\s+not null\s+default\s+'note'\s+check\s*\(kind in \('note','call','email','meeting'\)\)/i);
  assert.match(sql, /status\s+text\s+not null\s+default\s+'open'\s+check\s*\(status in \('open','done'\)\)/i);
});

test('schema-crm indexes subject and task scans', () => {
  assert.match(sql, /create index if not exists crm_notes_subject_idx/i);
  assert.match(sql, /create index if not exists crm_tasks_subject_idx/i);
  assert.match(sql, /create index if not exists crm_tasks_status_due_idx/i);
});

test('schema-crm enables RLS and grants service_role', () => {
  assert.match(sql, /alter table public\.crm_notes enable row level security/i);
  assert.match(sql, /alter table public\.crm_tasks enable row level security/i);
  assert.match(sql, /grant all privileges on table public\.crm_notes to service_role/i);
  assert.match(sql, /grant all privileges on table public\.crm_tasks to service_role/i);
  assert.match(sql, /grant usage, select on all sequences in schema public to service_role/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/admin-crm-schema.test.mjs`
Expected: FAIL — `ENOENT ... schema-crm.sql`.

- [ ] **Step 3: Write the schema**

Create `supabase/schema-crm.sql`:

```sql
-- CRM contact-view slice 1: polymorphic notes + tasks on a company or quote.
-- Additive + idempotent. Pooler-created tables need explicit service_role grants
-- (else inserts fail 42501). RLS on, no anon/authenticated policies (service-role
-- bypasses via grant), matching supabase/schema-audit-log.sql.

create table if not exists public.crm_notes (
  id            bigint generated always as identity primary key,
  subject_type  text not null check (subject_type in ('company','quote')),
  subject_id    text not null,
  kind          text not null default 'note' check (kind in ('note','call','email','meeting')),
  body          text not null,
  created_by    text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists crm_notes_subject_idx on public.crm_notes (subject_type, subject_id, created_at desc);

create table if not exists public.crm_tasks (
  id            bigint generated always as identity primary key,
  subject_type  text not null check (subject_type in ('company','quote')),
  subject_id    text not null,
  title         text not null,
  due_at        timestamptz,
  assigned_to   text,
  status        text not null default 'open' check (status in ('open','done')),
  created_by    text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  completed_by  text
);
create index if not exists crm_tasks_subject_idx on public.crm_tasks (subject_type, subject_id);
create index if not exists crm_tasks_status_due_idx on public.crm_tasks (status, due_at);

alter table public.crm_notes enable row level security;
alter table public.crm_tasks enable row level security;

grant all privileges on table public.crm_notes to service_role;
grant all privileges on table public.crm_tasks to service_role;
grant usage, select on all sequences in schema public to service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/admin-crm-schema.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/omar/Claude/Projects/masest-crm
git add supabase/schema-crm.sql tests/admin-crm-schema.test.mjs
git commit -m "feat(crm): schema-crm notes + tasks tables with grants"
```

---

### Task 2: Pure CRM lib — `functions/_lib/crm.js`

**Files:**
- Create: `functions/_lib/crm.js`
- Test: `tests/admin-crm-lib.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/admin-crm-lib.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { validSubject, noteRow, taskRow, taskPatch, mergeTimeline, NOTE_KINDS } from '../functions/_lib/crm.js';

test('validSubject accepts known types with an id', () => {
  assert.equal(validSubject('company', 'c1'), true);
  assert.equal(validSubject('quote', '42'), true);
  assert.equal(validSubject('user', 'x'), false);
  assert.equal(validSubject('company', ''), false);
});

test('noteRow validates and normalizes', () => {
  assert.equal(noteRow({ subject_type: 'x', subject_id: '1', body: 'hi' }).error, 'invalid_subject');
  assert.equal(noteRow({ subject_type: 'company', subject_id: '1', body: '   ' }).error, 'body_required');
  const ok = noteRow({ subject_type: 'company', subject_id: 1, kind: 'call', body: '  rang  ', actor: 'a@b.com' });
  assert.deepEqual(ok.row, { subject_type: 'company', subject_id: '1', kind: 'call', body: 'rang', created_by: 'a@b.com' });
  assert.equal(noteRow({ subject_type: 'company', subject_id: '1', kind: 'bogus', body: 'x' }).row.kind, 'note');
  assert.ok(NOTE_KINDS.includes('meeting'));
});

test('taskRow validates title, due date and assignee', () => {
  assert.equal(taskRow({ subject_type: 'company', subject_id: '1', title: '' }).error, 'title_required');
  assert.equal(taskRow({ subject_type: 'company', subject_id: '1', title: 'x', due_at: 'not-a-date' }).error, 'invalid_due_at');
  const ok = taskRow({ subject_type: 'company', subject_id: '1', title: ' call back ', due_at: '2026-07-01T10:00:00Z', assigned_to: ' a@b.com ', actor: 'me@x.com' });
  assert.equal(ok.row.title, 'call back');
  assert.equal(ok.row.due_at, '2026-07-01T10:00:00.000Z');
  assert.equal(ok.row.assigned_to, 'a@b.com');
  assert.equal(ok.row.status, 'open');
  assert.equal(ok.row.created_by, 'me@x.com');
  assert.equal(taskRow({ subject_type: 'company', subject_id: '1', title: 'x' }).row.due_at, null);
});

test('taskPatch transitions deterministically', () => {
  const now = new Date('2026-06-25T00:00:00Z');
  assert.deepEqual(taskPatch({ action: 'complete', actor: 'a@b.com' }, now).patch, { status: 'done', completed_at: '2026-06-25T00:00:00.000Z', completed_by: 'a@b.com' });
  assert.deepEqual(taskPatch({ action: 'reopen' }, now).patch, { status: 'open', completed_at: null, completed_by: null });
  assert.deepEqual(taskPatch({ action: 'reassign', assigned_to: ' x@y.com ' }, now).patch, { assigned_to: 'x@y.com' });
  assert.equal(taskPatch({ action: 'reassign', assigned_to: '' }, now).patch.assigned_to, null);
  assert.equal(taskPatch({ action: 'nope' }, now).error, 'invalid_action');
});

test('mergeTimeline normalizes, sorts newest-first and bounds', () => {
  const out = mergeTimeline({
    orders: [{ id: 7, status: 'paid', total: 12.5, currency: 'usd', created_at: '2026-06-20T00:00:00Z' }],
    messages: [{ id: 1, sender_role: 'buyer', body: 'hello', created_at: '2026-06-22T00:00:00Z' }],
    notes: [{ id: 3, kind: 'call', body: 'rang', created_by: 'a@b.com', created_at: '2026-06-23T00:00:00Z' }],
    tasks: [{ id: 9, title: 'follow up', assigned_to: 'a@b.com', created_at: '2026-06-21T00:00:00Z', completed_at: '2026-06-24T00:00:00Z', completed_by: 'a@b.com' }],
  });
  assert.equal(out[0].type, 'task_done', 'newest is the completion at 06-24');
  assert.equal(out[1].type, 'note:call');
  assert.equal(out.at(-1).type, 'order', 'oldest is the order at 06-20');
  assert.ok(out.every((i) => typeof i.at === 'string' && i.title));
  assert.equal(mergeTimeline({}).length, 0);
});

test('mergeTimeline respects the limit', () => {
  const orders = Array.from({ length: 50 }, (_, i) => ({ id: i, status: 'x', created_at: `2026-06-${String((i % 27) + 1).padStart(2, '0')}T00:00:00Z` }));
  assert.equal(mergeTimeline({ orders }, { limit: 10 }).length, 10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/admin-crm-lib.test.mjs`
Expected: FAIL — `Cannot find module ... functions/_lib/crm.js`.

- [ ] **Step 3: Write the lib**

Create `functions/_lib/crm.js`:

```js
// Pure CRM helpers (slice 1): subject validation, row builders, task transitions,
// and timeline merge. No I/O — route handlers pass Supabase results in and get
// normalized data out, so this is unit-testable against fake clients. Mirrors the
// functions/_lib/quote-convert.js pattern.

export const SUBJECT_TYPES = ['company', 'quote'];
export const NOTE_KINDS = ['note', 'call', 'email', 'meeting'];

export function validSubject(type, id) {
  return SUBJECT_TYPES.includes(String(type)) && String(id ?? '').trim().length > 0;
}

export function noteRow({ subject_type, subject_id, kind, body, actor }) {
  if (!validSubject(subject_type, subject_id)) return { error: 'invalid_subject' };
  const text = String(body ?? '').trim();
  if (!text) return { error: 'body_required' };
  return {
    row: {
      subject_type,
      subject_id: String(subject_id),
      kind: NOTE_KINDS.includes(kind) ? kind : 'note',
      body: text.slice(0, 4000),
      created_by: actor || null,
    },
  };
}

export function taskRow({ subject_type, subject_id, title, due_at, assigned_to, actor }) {
  if (!validSubject(subject_type, subject_id)) return { error: 'invalid_subject' };
  const name = String(title ?? '').trim();
  if (!name) return { error: 'title_required' };
  let due = null;
  if (due_at) {
    const d = new Date(due_at);
    if (Number.isNaN(d.getTime())) return { error: 'invalid_due_at' };
    due = d.toISOString();
  }
  return {
    row: {
      subject_type,
      subject_id: String(subject_id),
      title: name.slice(0, 200),
      due_at: due,
      assigned_to: assigned_to ? String(assigned_to).trim().slice(0, 160) : null,
      status: 'open',
      created_by: actor || null,
    },
  };
}

// `now` is injected so transitions are deterministic in tests.
export function taskPatch({ action, assigned_to, actor }, now) {
  const ts = (now || new Date()).toISOString();
  if (action === 'complete') return { patch: { status: 'done', completed_at: ts, completed_by: actor || null } };
  if (action === 'reopen') return { patch: { status: 'open', completed_at: null, completed_by: null } };
  if (action === 'reassign') return { patch: { assigned_to: assigned_to ? String(assigned_to).trim().slice(0, 160) : null } };
  return { error: 'invalid_action' };
}

// Normalize heterogeneous source rows into one timeline shape, newest first.
// Each source is an array; missing/failed sources pass []. Bounded to `limit`.
export function mergeTimeline({ orders = [], messages = [], shipments = [], audit = [], quotes = [], notes = [], tasks = [] }, { limit = 200 } = {}) {
  const items = [];
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  const cap = (s, n) => String(s ?? '').slice(0, n);
  for (const o of orders) items.push({ at: iso(o.created_at), type: 'order', title: `Order ${o.id} · ${o.status || 'pending'}`, detail: o.total != null ? `${String(o.currency || 'USD').toUpperCase()} ${Number(o.total).toFixed(2)}` : '', ref: { order: o.id } });
  for (const m of messages) items.push({ at: iso(m.created_at), type: 'message', title: `${m.sender_role === 'staff' ? 'Staff' : 'Buyer'} message`, detail: cap(m.body, 160), ref: { message: m.id } });
  for (const s of shipments) items.push({ at: iso(s.created_at), type: 'shipment', title: `Shipment ${s.status || ''}`.trim(), detail: [s.carrier, s.tracking_number].filter(Boolean).join(' '), ref: { order: s.order_id } });
  for (const a of audit) items.push({ at: iso(a.created_at), type: 'audit', title: a.action || 'audit', detail: a.actor_email || '', ref: { audit: true } });
  for (const q of quotes) items.push({ at: iso(q.created_at), type: 'quote', title: `Quote ${q.type || ''} · ${q.status || ''}`.replace(/ · $/, '').trim(), detail: q.product || '', ref: { quote: q.id } });
  for (const n of notes) {
    const k = n.kind || 'note';
    items.push({ at: iso(n.created_at), type: `note:${k}`, title: k.charAt(0).toUpperCase() + k.slice(1), detail: cap(n.body, 280), ref: { note: n.id }, by: n.created_by || '' });
  }
  for (const t of tasks) {
    items.push({ at: iso(t.created_at), type: 'task', title: `Task: ${t.title || ''}`.trim(), detail: t.assigned_to ? `→ ${t.assigned_to}` : 'unassigned', ref: { task: t.id }, by: t.created_by || '' });
    if (t.completed_at) items.push({ at: iso(t.completed_at), type: 'task_done', title: `Done: ${t.title || ''}`.trim(), detail: t.completed_by || '', ref: { task: t.id } });
  }
  return items
    .filter((i) => i.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/admin-crm-lib.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/crm.js tests/admin-crm-lib.test.mjs
git commit -m "feat(crm): pure lib for notes/tasks rows + virtual timeline merge"
```

---

### Task 3: Endpoints — notes / tasks / timeline

**Files:**
- Create: `functions/api/admin/crm/notes.js`
- Create: `functions/api/admin/crm/tasks.js`
- Create: `functions/api/admin/crm/timeline.js`
- Test: `tests/admin-crm-endpoints.test.mjs`

- [ ] **Step 1: Write the failing test (static source-assertion + import-depth)**

Create `tests/admin-crm-endpoints.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOTES = read('functions/api/admin/crm/notes.js');
const TASKS = read('functions/api/admin/crm/tasks.js');
const TIMELINE = read('functions/api/admin/crm/timeline.js');

for (const [name, src] of [['notes', NOTES], ['tasks', TASKS], ['timeline', TIMELINE]]) {
  test(`${name} uses the correct _lib import depth`, () => {
    assert.match(src, /from '\.\.\/\.\.\/\.\.\/_lib\/supabase\.js'/, 'crm subfolder must import _lib three levels up');
    assert.doesNotMatch(src, /from '\.\.\/\.\.\/_lib\//, 'two-level import would break the esbuild bundle');
  });
  test(`${name} is staff-guarded`, () => {
    assert.match(src, /requireStaff\(\s*request\s*,\s*env\s*\)/);
    assert.match(src, /if\s*\(\s*!user\s*\)\s*return\s+json\(\s*401/);
    assert.match(src, /if\s*\(\s*!staff\s*\)\s*return\s+json\(\s*403/);
    assert.match(src, /validSubject/);
  });
}

test('notes/tasks gate writes behind staffCanWrite and audit them', () => {
  for (const src of [NOTES, TASKS]) {
    assert.match(src, /staffCanWrite\(role\)/);
    assert.match(src, /recordAudit\(sb,/);
  }
  assert.match(NOTES, /noteRow\(/);
  assert.match(TASKS, /taskRow\(/);
  assert.match(TASKS, /taskPatch\(/);
});

test('notes DELETE is author-or-owner only', () => {
  assert.match(NOTES, /method\s*===\s*'DELETE'|request\.method === 'DELETE'/);
  assert.match(NOTES, /role === 'owner'/);
  assert.match(NOTES, /not_author/);
  assert.match(NOTES, /deleted_at/);
});

test('timeline merges sources virtually and tolerates missing tables', () => {
  assert.match(TIMELINE, /mergeTimeline\(/);
  assert.match(TIMELINE, /async function safe\(/);
  assert.match(TIMELINE, /from\('orders'\)/);
  assert.match(TIMELINE, /from\('messages'\)/);
  assert.match(TIMELINE, /from\('shipment_events'\)/);
  assert.match(TIMELINE, /from\('audit_log'\)/);
  assert.match(TIMELINE, /from\('quotes'\)/);
});

test('tasks endpoint supports global scopes', () => {
  assert.match(TASKS, /scope === 'mine'/);
  assert.match(TASKS, /scope === 'overdue'/);
  assert.match(TASKS, /scope === 'open'/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/admin-crm-endpoints.test.mjs`
Expected: FAIL — `ENOENT ... crm/notes.js`.

- [ ] **Step 3a: Implement `functions/api/admin/crm/notes.js`**

```js
// /api/admin/crm/notes — staff CRM notes on a company or quote (slice 1).
import { adminClient, json, readBody, requireStaff } from '../../../_lib/supabase.js';
import { staffCanWrite } from '../../../_lib/authz.js';
import { recordAudit } from '../../../_lib/audit.js';
import { noteRow, validSubject } from '../../../_lib/crm.js';

const SELECT = 'id,subject_type,subject_id,kind,body,created_by,created_at';

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const subjectType = url.searchParams.get('subject_type');
    const subjectId = url.searchParams.get('subject_id');
    if (!validSubject(subjectType, subjectId)) return json(400, { error: 'invalid_subject' });
    const { data, error } = await sb.from('crm_notes').select(SELECT)
      .eq('subject_type', subjectType).eq('subject_id', String(subjectId))
      .is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(200);
    if (error) {
      if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { notes: [], needs_migration: true });
      return json(500, { error: error.message });
    }
    return json(200, { notes: data || [] });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    const built = noteRow({ ...body, actor: user.email || null });
    if (built.error) return json(400, { error: built.error });
    const { data, error } = await sb.from('crm_notes').insert(built.row).select(SELECT).single();
    if (error) return json(500, { error: error.message });
    await recordAudit(sb, { user, action: 'crm.note_add', targetType: built.row.subject_type, targetId: built.row.subject_id, detail: { kind: built.row.kind } });
    return json(200, { ok: true, note: data });
  }

  if (request.method === 'DELETE') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const id = url.searchParams.get('id');
    if (!id) return json(400, { error: 'id_required' });
    const { data: note, error: getErr } = await sb.from('crm_notes').select('id,created_by').eq('id', id).maybeSingle();
    if (getErr) return json(500, { error: getErr.message });
    if (!note) return json(404, { error: 'not_found' });
    if (role !== 'owner' && note.created_by !== (user.email || null)) return json(403, { error: 'not_author' });
    const { error } = await sb.from('crm_notes').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) return json(500, { error: error.message });
    await recordAudit(sb, { user, action: 'crm.note_delete', targetType: 'note', targetId: String(id) });
    return json(200, { ok: true });
  }

  return json(405, { error: 'method_not_allowed' });
}
```

- [ ] **Step 3b: Implement `functions/api/admin/crm/tasks.js`**

```js
// /api/admin/crm/tasks — staff CRM follow-up tasks on a company or quote (slice 1).
import { adminClient, json, readBody, requireStaff } from '../../../_lib/supabase.js';
import { staffCanWrite } from '../../../_lib/authz.js';
import { recordAudit } from '../../../_lib/audit.js';
import { taskRow, taskPatch, validSubject } from '../../../_lib/crm.js';

const SELECT = 'id,subject_type,subject_id,title,due_at,assigned_to,status,created_by,created_at,completed_at,completed_by';

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  const sb = adminClient(env);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const scope = url.searchParams.get('scope');
    let query = sb.from('crm_tasks').select(SELECT);
    if (scope === 'mine') query = query.eq('assigned_to', user.email || '').eq('status', 'open');
    else if (scope === 'overdue') query = query.eq('status', 'open').not('due_at', 'is', null).lte('due_at', new Date().toISOString());
    else if (scope === 'open') query = query.eq('status', 'open');
    else {
      const subjectType = url.searchParams.get('subject_type');
      const subjectId = url.searchParams.get('subject_id');
      if (!validSubject(subjectType, subjectId)) return json(400, { error: 'invalid_subject' });
      query = query.eq('subject_type', subjectType).eq('subject_id', String(subjectId));
    }
    const { data, error } = await query.order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(200);
    if (error) {
      if (/does not exist|relation|schema cache/i.test(error.message)) return json(200, { tasks: [], needs_migration: true });
      return json(500, { error: error.message });
    }
    return json(200, { tasks: data || [] });
  }

  if (request.method === 'POST') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    const built = taskRow({ ...body, actor: user.email || null });
    if (built.error) return json(400, { error: built.error });
    const { data, error } = await sb.from('crm_tasks').insert(built.row).select(SELECT).single();
    if (error) return json(500, { error: error.message });
    await recordAudit(sb, { user, action: 'crm.task_add', targetType: built.row.subject_type, targetId: built.row.subject_id, detail: { title: built.row.title } });
    return json(200, { ok: true, task: data });
  }

  if (request.method === 'PATCH') {
    if (!staffCanWrite(role)) return json(403, { error: 'forbidden', message: 'Read-only staff cannot make changes.' });
    const body = await readBody(request);
    if (!body.id) return json(400, { error: 'id_required' });
    const result = taskPatch({ action: body.action, assigned_to: body.assigned_to, actor: user.email || null }, new Date());
    if (result.error) return json(400, { error: result.error });
    const { data, error } = await sb.from('crm_tasks').update(result.patch).eq('id', body.id).select(SELECT).single();
    if (error) return json(500, { error: error.message });
    await recordAudit(sb, { user, action: 'crm.task_update', targetType: 'task', targetId: String(body.id), detail: { action: body.action } });
    return json(200, { ok: true, task: data });
  }

  return json(405, { error: 'method_not_allowed' });
}
```

- [ ] **Step 3c: Implement `functions/api/admin/crm/timeline.js`**

```js
// /api/admin/crm/timeline — virtual, read-time merge of a contact's activity.
// Queries existing per-company signals + crm_notes/crm_tasks; never instruments
// write paths. Each source is wrapped in safe() so a missing table degrades to [].
import { adminClient, json, requireStaff } from '../../../_lib/supabase.js';
import { mergeTimeline, validSubject } from '../../../_lib/crm.js';

async function safe(builder) {
  try {
    const { data, error } = await builder;
    return error ? [] : (data || []);
  } catch {
    return [];
  }
}

export async function onRequest({ request, env }) {
  const { user, staff } = await requireStaff(request, env);
  if (!user) return json(401, { error: 'unauthenticated' });
  if (!staff) return json(403, { error: 'forbidden' });
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const url = new URL(request.url);
  const subjectType = url.searchParams.get('subject_type');
  const subjectId = url.searchParams.get('subject_id');
  if (!validSubject(subjectType, subjectId)) return json(400, { error: 'invalid_subject' });

  const sb = adminClient(env);
  const id = String(subjectId);

  const notesP = safe(sb.from('crm_notes').select('id,kind,body,created_by,created_at').eq('subject_type', subjectType).eq('subject_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(200));
  const tasksP = safe(sb.from('crm_tasks').select('id,title,assigned_to,created_by,created_at,completed_at,completed_by').eq('subject_type', subjectType).eq('subject_id', id).limit(200));

  let extra = { orders: [], messages: [], shipments: [], audit: [], quotes: [] };
  if (subjectType === 'company') {
    const [orders, messages, audit, company] = await Promise.all([
      safe(sb.from('orders').select('id,status,total,currency,created_at').eq('company_id', id).order('created_at', { ascending: false }).limit(100)),
      safe(sb.from('messages').select('id,sender_role,body,created_at').eq('company_id', id).order('created_at', { ascending: false }).limit(100)),
      safe(sb.from('audit_log').select('action,actor_email,created_at').eq('target_type', 'company').eq('target_id', id).order('created_at', { ascending: false }).limit(100)),
      safe(sb.from('companies').select('name').eq('id', id).limit(1)),
    ]);
    const name = company[0]?.name;
    const orderIds = orders.map((o) => o.id);
    const [shipments, quotes] = await Promise.all([
      orderIds.length ? safe(sb.from('shipment_events').select('order_id,status,carrier,tracking_number,created_at').in('order_id', orderIds).order('created_at', { ascending: false }).limit(100)) : Promise.resolve([]),
      name ? safe(sb.from('quotes').select('id,type,status,product,created_at').ilike('company', name).order('created_at', { ascending: false }).limit(50)) : Promise.resolve([]),
    ]);
    extra = { orders, messages, audit, shipments, quotes };
  }

  const [notes, tasks] = await Promise.all([notesP, tasksP]);
  const timeline = mergeTimeline({ ...extra, notes, tasks });
  return json(200, { timeline });
}
```

- [ ] **Step 4: Run tests + import-resolve + check**

Run: `node --test tests/admin-crm-endpoints.test.mjs tests/functions-import-resolve.test.mjs`
Expected: PASS (endpoint assertions + every `functions/api/**` import resolves, proving the 3-level depth is right).

Run: `npm run check`
Expected: PASS (no syntax errors in the new files).

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin/crm/ tests/admin-crm-endpoints.test.mjs
git commit -m "feat(crm): staff notes/tasks/timeline endpoints"
```

---

### Task 4: Client module `js/admin/crm.js` + drawer wiring

**Files:**
- Create: `js/admin/crm.js`
- Modify: `js/admin.js` (instantiate `createCrmPanel`, inject into `createCompaniesTab`)
- Modify: `js/admin/companies.js` (accept `crm`, mount it in `openCompanyDetail`)
- Modify: `css/components.css` (append CRM panel styles)
- Test: `tests/admin-crm-ui.test.mjs`

- [ ] **Step 1: Write the failing test (static source-assertion)**

Create `tests/admin-crm-ui.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const CRM = read('js/admin/crm.js');
const ADMIN = read('js/admin.js');
const COMPANIES = read('js/admin/companies.js');
const CSS = read('css/components.css');

test('crm.js exposes a mountable panel with all three tabs', () => {
  assert.match(CRM, /export function createCrmPanel/);
  assert.match(CRM, /data-crm-tab="timeline"/);
  assert.match(CRM, /data-crm-tab="tasks"/);
  assert.match(CRM, /data-crm-tab="notes"/);
  assert.match(CRM, /function mount\(/);
});

test('crm.js calls all three endpoints', () => {
  assert.match(CRM, /\/api\/admin\/crm\/timeline\?subject_type=/);
  assert.match(CRM, /\/api\/admin\/crm\/notes/);
  assert.match(CRM, /\/api\/admin\/crm\/tasks/);
  assert.match(CRM, /method: 'DELETE'/);
  assert.match(CRM, /method: 'PATCH'/);
});

test('crm.js renders loading/empty states and is keyboard-operable', () => {
  assert.match(CRM, /admSkeleton/);
  assert.match(CRM, /admEmpty/);
  assert.match(CRM, /aria-pressed/);
  assert.match(CRM, /aria-live="polite"/);
});

test('admin.js wires the CRM panel into the companies tab', () => {
  assert.match(ADMIN, /import \{ createCrmPanel \} from '\.\/admin\/crm\.js'/);
  assert.match(ADMIN, /const crm = createCrmPanel\(\{[^}]*\}\)/);
  assert.match(ADMIN, /createCompaniesTab\(\{[^}]*crm[^}]*\}\)/);
});

test('companies drawer mounts the CRM panel', () => {
  assert.match(COMPANIES, /createCompaniesTab\(\{[^}]*crm[^}]*\}\)/);
  assert.match(COMPANIES, /crm\.mount\(box, 'company', company\.id/);
});

test('crm panel has styles', () => {
  assert.match(CSS, /\.crm-panel/);
  assert.match(CSS, /\.crm-feed/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/admin-crm-ui.test.mjs`
Expected: FAIL — `ENOENT ... js/admin/crm.js`.

- [ ] **Step 3a: Create `js/admin/crm.js`**

```js
// Admin CRM panel (slice 1): Timeline | Tasks | Notes sub-tabs inside the company
// detail drawer. Polymorphic — mount(container, subjectType, subjectId) drives all
// three from /api/admin/crm/*. Kept out of companies.js so that file stays focused
// (#36 split rule). Skeleton/empty helpers are injected; esc/date/confirmDialog come
// from util.js, matching the other per-tab modules.
import { esc, dateTime as date, confirmDialog } from '../util.js';

const KINDS = [['note', 'Note'], ['call', 'Call'], ['email', 'Email'], ['meeting', 'Meeting']];

export function createCrmPanel({ $, api, admSkeleton, admEmpty }) {
  const errRow = (msg) => `<p class="adm-status" data-state="err">${esc(msg || 'Could not load. Retry.')}</p>`;

  function panelShell(subjectType, subjectId) {
    return `<div class="crm-panel" data-crm-subject-type="${esc(subjectType)}" data-crm-subject-id="${esc(subjectId)}">
      <div class="crm-tabs" role="group" aria-label="Contact activity">
        <button class="btn btn-ghost btn-sm is-active" type="button" data-crm-tab="timeline" aria-pressed="true">Timeline</button>
        <button class="btn btn-ghost btn-sm" type="button" data-crm-tab="tasks" aria-pressed="false">Tasks</button>
        <button class="btn btn-ghost btn-sm" type="button" data-crm-tab="notes" aria-pressed="false">Notes</button>
      </div>
      <div class="crm-body" data-crm-body aria-live="polite">${admSkeleton(3)}</div>
    </div>`;
  }

  function timelineIcon(type) {
    if (type.startsWith('note')) return 'ph-note';
    if (type.startsWith('task')) return 'ph-check-square';
    return ({ order: 'ph-package', message: 'ph-chat-circle', shipment: 'ph-truck', audit: 'ph-shield', quote: 'ph-file-text' })[type] || 'ph-circle';
  }

  function renderTimeline(items) {
    if (!items.length) return admEmpty('ph-clock-counter-clockwise', 'No activity yet', 'Orders, messages, notes and tasks for this contact appear here.');
    return `<ul class="crm-feed">${items.map((i) => `<li class="crm-feed-item">
      <i class="ph ${timelineIcon(i.type)}" aria-hidden="true"></i>
      <div><div class="crm-feed-title">${esc(i.title)}</div>${i.detail ? `<div class="crm-feed-detail">${esc(i.detail)}</div>` : ''}</div>
      <time class="crm-feed-at muted">${esc(date(i.at))}</time></li>`).join('')}</ul>`;
  }

  function renderNotes(notes) {
    const composer = `<form class="crm-note-form" data-crm-note-form>
      <select class="adm-select" data-crm-note-kind aria-label="Note type">${KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <textarea class="adm-input" data-crm-note-body rows="2" placeholder="Log a note, call, email or meeting…" required></textarea>
      <button class="btn btn-primary btn-sm" type="submit">Add note</button>
    </form>`;
    const list = notes.length ? `<ul class="crm-feed">${notes.map((n) => `<li class="crm-feed-item">
      <i class="ph ph-note" aria-hidden="true"></i>
      <div><div class="crm-feed-title">${esc(n.kind)} <span class="muted">· ${esc(n.created_by || '')}</span></div>
      <div class="crm-feed-detail">${esc(n.body)}</div></div>
      <span class="crm-feed-at"><time class="muted">${esc(date(n.created_at))}</time>
      <button class="btn btn-ghost btn-sm" type="button" data-crm-note-del="${esc(n.id)}" aria-label="Delete note">Delete</button></span></li>`).join('')}</ul>`
      : admEmpty('ph-note', 'No notes', 'Log the first call, email or meeting.');
    return composer + list;
  }

  function renderTasks(tasks) {
    const overdue = (t) => t.due_at && new Date(t.due_at) < new Date();
    const composer = `<form class="crm-task-form" data-crm-task-form>
      <input class="adm-input" data-crm-task-title placeholder="Follow-up task…" required>
      <input class="adm-input" data-crm-task-due type="datetime-local" aria-label="Due date">
      <input class="adm-input" data-crm-task-assignee placeholder="Assign to (email)" aria-label="Assignee">
      <button class="btn btn-primary btn-sm" type="submit">Add task</button>
    </form>`;
    const row = (t) => `<li class="crm-task ${t.status === 'done' ? 'is-done' : ''}">
      <button class="btn btn-ghost btn-sm" type="button" data-crm-task-toggle="${esc(t.id)}" data-crm-task-status="${esc(t.status)}" aria-label="${t.status === 'done' ? 'Reopen' : 'Complete'} task">${t.status === 'done' ? '↺' : '✓'}</button>
      <div><div class="crm-feed-title">${esc(t.title)}</div>
      <div class="crm-feed-detail muted">${t.assigned_to ? `→ ${esc(t.assigned_to)}` : 'Unassigned'}${t.due_at ? ` · due ${esc(date(t.due_at))}` : ''}</div></div>
      ${t.status === 'open' && overdue(t) ? '<span class="badge badge-warning">Overdue</span>' : '<span></span>'}</li>`;
    const open = tasks.filter((t) => t.status === 'open');
    const done = tasks.filter((t) => t.status === 'done');
    const list = (open.length || done.length)
      ? `<ul class="crm-task-list">${open.map(row).join('')}${done.map(row).join('')}</ul>`
      : admEmpty('ph-check-square', 'No tasks', 'Add a follow-up so this contact never goes cold.');
    return composer + list;
  }

  async function load(body, subjectType, subjectId, tab) {
    body.innerHTML = admSkeleton(3);
    const sid = encodeURIComponent(subjectId);
    try {
      if (tab === 'timeline') {
        const { timeline } = await api(`/api/admin/crm/timeline?subject_type=${subjectType}&subject_id=${sid}`);
        body.innerHTML = renderTimeline(timeline || []);
      } else if (tab === 'notes') {
        const { notes } = await api(`/api/admin/crm/notes?subject_type=${subjectType}&subject_id=${sid}`);
        body.innerHTML = renderNotes(notes || []);
      } else {
        const { tasks } = await api(`/api/admin/crm/tasks?subject_type=${subjectType}&subject_id=${sid}`);
        body.innerHTML = renderTasks(tasks || []);
      }
    } catch (err) {
      body.innerHTML = errRow(err.data?.error);
    }
  }

  function mount(container, subjectType, subjectId) {
    container.insertAdjacentHTML('beforeend', panelShell(subjectType, subjectId));
    const panel = container.querySelector('.crm-panel');
    const body = panel.querySelector('[data-crm-body]');
    const show = (tab) => {
      panel.querySelectorAll('[data-crm-tab]').forEach((b) => {
        const on = b.dataset.crmTab === tab;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      load(body, subjectType, subjectId, tab);
    };

    panel.addEventListener('click', async (event) => {
      const tabBtn = event.target.closest('[data-crm-tab]');
      if (tabBtn) { show(tabBtn.dataset.crmTab); return; }

      const del = event.target.closest('[data-crm-note-del]');
      if (del) {
        if (!(await confirmDialog('Delete this note?', { confirmText: 'Delete', danger: true }))) return;
        del.disabled = true;
        try { await api(`/api/admin/crm/notes?id=${encodeURIComponent(del.dataset.crmNoteDel)}`, { method: 'DELETE' }); load(body, subjectType, subjectId, 'notes'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); del.disabled = false; }
        return;
      }

      const toggle = event.target.closest('[data-crm-task-toggle]');
      if (toggle) {
        toggle.disabled = true;
        const action = toggle.dataset.crmTaskStatus === 'done' ? 'reopen' : 'complete';
        try { await api('/api/admin/crm/tasks', { method: 'PATCH', body: { id: toggle.dataset.crmTaskToggle, action } }); load(body, subjectType, subjectId, 'tasks'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); toggle.disabled = false; }
      }
    });

    panel.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      if (form.matches('[data-crm-note-form]')) {
        const text = form.querySelector('[data-crm-note-body]').value.trim();
        if (!text) return;
        const kind = form.querySelector('[data-crm-note-kind]').value;
        try { await api('/api/admin/crm/notes', { method: 'POST', body: { subject_type: subjectType, subject_id: subjectId, kind, body: text } }); load(body, subjectType, subjectId, 'notes'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); }
      } else if (form.matches('[data-crm-task-form]')) {
        const title = form.querySelector('[data-crm-task-title]').value.trim();
        if (!title) return;
        const due = form.querySelector('[data-crm-task-due]').value;
        const assignee = form.querySelector('[data-crm-task-assignee]').value.trim();
        try { await api('/api/admin/crm/tasks', { method: 'POST', body: { subject_type: subjectType, subject_id: subjectId, title, due_at: due || null, assigned_to: assignee || null } }); load(body, subjectType, subjectId, 'tasks'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); }
      }
    });

    show('timeline');
  }

  return { mount };
}
```

- [ ] **Step 3b: Wire into `js/admin.js`**

Add the import near the other `./admin/*` imports (after line 13 `import { createCompaniesTab } ...`):

```js
import { createCrmPanel } from './admin/crm.js';
```

Then where the tabs are instantiated (the `createCompaniesTab({ ... })` line, currently line 367), insert the panel construction immediately before it and pass `crm` in:

```js
// CRM contact panel (timeline/tasks/notes) injected into the company drawer.
const crm = createCrmPanel({ $, api, admSkeleton, admEmpty });
// Companies tab extracted to ./admin/companies.js (#36 split). statusBadge + admListPager + primitives injected.
const { renderCompanies, wireCompanies } = createCompaniesTab({ $, api, state, admSkeleton, admEmpty, statusBadge, admListPager, crm });
```

- [ ] **Step 3c: Wire into `js/admin/companies.js`**

Change the factory signature (line 30) to accept `crm`:

```js
export function createCompaniesTab({ $, api, state, admSkeleton, admEmpty, statusBadge, admListPager, crm }) {
```

In `openCompanyDetail`, after the two existing `wire...` calls (currently lines 196–197), mount the panel:

```js
      wireCompanyDetailActions(company);
      wireCompanyUserActions(company);
      if (crm) crm.mount(box, 'company', company.id || id);
```

- [ ] **Step 3d: Append CRM styles to `css/components.css`**

Append at the end of the file:

```css
/* CRM contact panel (admin company drawer) — slice 1 */
.crm-panel { margin-top: 16px; border-top: 1px solid var(--border, #e5e7eb); padding-top: 12px; }
.crm-tabs { display: flex; gap: 4px; margin-bottom: 10px; }
.crm-tabs .is-active { background: var(--surface-2, #eef2f7); font-weight: 600; }
.crm-feed, .crm-task-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.crm-feed-item, .crm-task { display: grid; grid-template-columns: 20px 1fr auto; gap: 8px; align-items: start; }
.crm-feed-title { font-weight: 600; }
.crm-feed-detail { font-size: .85rem; color: var(--muted, #6b7280); white-space: pre-wrap; }
.crm-feed-at { font-size: .75rem; white-space: nowrap; display: inline-flex; gap: 6px; align-items: center; }
.crm-task.is-done .crm-feed-title { text-decoration: line-through; opacity: .6; }
.crm-note-form, .crm-task-form { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.crm-note-form textarea, .crm-task-form input { flex: 1 1 160px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/admin-crm-ui.test.mjs`
Expected: PASS (6 tests).

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/admin/crm.js js/admin.js js/admin/companies.js css/components.css tests/admin-crm-ui.test.mjs
git commit -m "feat(crm): company-drawer Timeline/Tasks/Notes panel"
```

---

### Task 5: Playwright drawer spec (API-stubbed)

**Files:**
- Create: `tools/admin-crm-drawer.spec.mjs`

This mirrors `tools/admin-quote-message-flows.spec.mjs`: boot admin past the sign-in gate by stubbing `/api/admin/stats=200`, stub the companies list + detail + CRM endpoints, drive the drawer, and assert the client sends the right note payload.

- [ ] **Step 1: Write the spec**

Create `tools/admin-crm-drawer.spec.mjs`:

```js
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test, expect } from '@playwright/test';

// E2e for the company-drawer CRM panel. No real Supabase session: we stub the admin
// API. /api/admin/stats=200 boots admin.js past the gate; the companies + crm routes
// return fixtures; the note POST body is captured to assert the client contract.
const PORT = 4188;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/admin.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error('static server did not start');
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, 'exit').catch(() => {});
  server.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
  server.kill('SIGKILL');
});

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const COMPANY = { id: 'co-1', name: 'Acme HVAC', status: 'approved', setup: { steps: [] } };

async function bootAsStaff(page) {
  // Make the Supabase client + token resolve without real network, and stub the
  // staff-only stats probe so admin.js boot() reveals the app instead of the gate.
  await page.addInitScript(() => {
    window.localStorage.setItem('sb-access-token', 'test-token');
  });
  await page.route('**/api/admin/stats*', (route) => route.fulfill(json({ ok: true })));
}

test('company drawer shows CRM tabs and posts a note', async ({ page }) => {
  await bootAsStaff(page);
  await page.route('**/api/admin/companies*', (route) => route.fulfill(json({ companies: [COMPANY], total: 1, has_more: false })));
  await page.route('**/api/admin/company?*', (route) => route.fulfill(json({ company: COMPANY, members: [], invites: [], orders: [], message_count: 0 })));
  await page.route('**/api/admin/crm/timeline*', (route) => route.fulfill(json({ timeline: [] })));
  await page.route('**/api/admin/crm/tasks*', (route) => route.fulfill(json({ tasks: [] })));

  let captured = null;
  await page.route('**/api/admin/crm/notes*', (route) => {
    const req = route.request();
    if (req.method() === 'POST') { captured = JSON.parse(req.postData() || '{}'); return route.fulfill(json({ ok: true, note: {} })); }
    return route.fulfill(json({ notes: [] }));
  });

  await page.goto(`${BASE_URL}/admin.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.location.hash = '#companies');

  await page.click('[data-open-company="co-1"]');
  await expect(page.locator('.crm-panel [data-crm-tab="timeline"]')).toBeVisible();
  await expect(page.locator('.crm-panel [data-crm-tab="tasks"]')).toBeVisible();
  await expect(page.locator('.crm-panel [data-crm-tab="notes"]')).toBeVisible();

  await page.click('.crm-panel [data-crm-tab="notes"]');
  await page.selectOption('[data-crm-note-kind]', 'call');
  await page.fill('[data-crm-note-body]', 'Called about NET terms');
  await page.click('.crm-note-form button[type="submit"]');

  await expect.poll(() => captured).not.toBeNull();
  expect(captured).toMatchObject({ subject_type: 'company', subject_id: 'co-1', kind: 'call', body: 'Called about NET terms' });
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test tools/admin-crm-drawer.spec.mjs --reporter=line`
Expected: PASS (1 test). If the boot-as-staff hook needs adjustment, open `tools/admin-quote-message-flows.spec.mjs` and copy its exact `bootAsStaff` implementation (token/localStorage key + any Supabase client shim) — match it verbatim, since that file is the source of truth for getting admin.js past the gate.

- [ ] **Step 3: Commit**

```bash
git add tools/admin-crm-drawer.spec.mjs
git commit -m "test(crm): playwright drawer tabs + note post contract"
```

---

### Task 6: Full verification + manual UI screenshot

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npm run check && npm test`
Expected: PASS — all prior tests (~649) plus the 4 new files green. If `npm test` reports a count, note it.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS — esbuild bundles `functions/` including the new `functions/api/admin/crm/*` with no import errors; `cf-build` copies `js/admin/crm.js` (git-tracked) into `dist/`.

- [ ] **Step 3: Manual UI screenshot (reduced motion)**

Start the server in the worktree: `npm run serve` (port 4195). With a Playwright/Puppeteer script using `reducedMotion: 'reduce'`, stub the admin API as in Task 5, open the company drawer, and screenshot the Timeline, Tasks, and Notes tabs. Confirm: tabs toggle, skeleton shows on load, empty-states render, the note composer and task composer are usable by keyboard (Tab to fields, Enter submits), and contrast on `.badge-warning`/text is legible. Save screenshots to the scratchpad and eyeball them.

- [ ] **Step 4: Commit (if screenshots prompted any CSS tweak)**

```bash
git add -A
git commit -m "fix(crm): drawer panel UI polish from screenshot review"
```

(Skip if nothing changed.)

---

### Task 7: PR + migration handoff

**Files:** none

- [ ] **Step 1: Rebase on latest origin/main (concurrent-editor safety)**

```bash
cd /Users/omar/Claude/Projects/masest-crm
git fetch origin main
git rebase origin/main
```
Resolve any conflicts (most likely `css/components.css` tail or `js/admin.js`). Re-run `npm test` after a rebase.

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feat/crm-contact-view
gh pr create --base main --title "feat(crm): contact-view slice 1 — timeline + notes + tasks" --body "$(cat <<'EOF'
## Summary
Slice 1 of the CRM contact view: a polymorphic activity **Timeline**, **Notes**, and **Tasks** surfaced as sub-tabs in the company detail drawer.

- `supabase/schema-crm.sql` — `crm_notes` + `crm_tasks` (additive, idempotent, service_role grants). **Owner must apply to prod.**
- `functions/_lib/crm.js` — pure validation / row builders / task transitions / virtual timeline merge (unit-tested).
- `functions/api/admin/crm/{notes,tasks,timeline}.js` — staff-guarded; timeline is read-time virtual (no write-path instrumentation).
- `js/admin/crm.js` + drawer wiring — Timeline/Tasks/Notes with loading/empty/error states, keyboard-operable.

## Verification
- `npm run check` / `npm test` / `npm run build` green.
- Playwright `tools/admin-crm-drawer.spec.mjs` (API-stubbed) + manual reduced-motion screenshots.

## Out of scope (later slices)
quotes pipeline stages + board; global Overview follow-ups badge (tasks endpoint already exposes `?scope=mine|overdue|open`); quote-drawer CRM UI (schema is ready).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2b: Owner migration note**

Tell the owner: apply `supabase/schema-crm.sql` to prod (additive/idempotent/re-runnable; includes the `service_role` grants required to avoid `42501`). The endpoints tolerate the pre-migration state (`needs_migration` / empty timeline) so deploying the code before the migration will not error.

- [ ] **Step 3: Record durable memory**

Add a file-memory entry summarizing: slice-1 shipped (branch/PR), the virtual-timeline decision, the `subject_type` polymorphic model, and the deferred slice-2 pipeline. Link `[[user-business-dashboard-split]]` and the ARCHITECTURE.md priority.

---

## Self-Review

**Spec coverage:** schema (Task 1) ✓; pure lib (Task 2) ✓; three endpoints with guards + missing-table tolerance (Task 3) ✓; client module + drawer tabs + loading/empty/error + a11y (Task 4) ✓; tests — schema/lib/endpoints/ui/playwright (Tasks 1–5) ✓; build + grants note (Tasks 6–7) ✓; virtual timeline + `crm_notes.kind` collapse, polymorphic subject, best-effort quote linkage all implemented per spec ✓. Deferred items (pipeline board, Overview global badge, quote-drawer UI) are explicitly out of scope and consistent between spec and plan.

**Placeholder scan:** every code step contains full file contents or an exact anchored edit; no TBD/TODO; the one "match the source-of-truth spec" instruction (Task 5 Step 2 boot hook) names the exact file to copy from rather than hand-waving.

**Type/name consistency:** `validSubject`, `noteRow`, `taskRow`, `taskPatch`, `mergeTimeline`, `NOTE_KINDS` used identically across lib (Task 2), endpoints (Task 3), and tests. `createCrmPanel({ $, api, admSkeleton, admEmpty })` → `{ mount(container, subjectType, subjectId) }` consistent across crm.js (Task 4a), admin.js wiring (4b), companies.js mount (4c), and the UI test (Task 4 Step 1). Data attributes (`data-crm-tab`, `data-crm-note-form`, `data-crm-note-kind`, `data-crm-note-body`, `data-crm-note-del`, `data-crm-task-form`, `data-crm-task-toggle`, `data-crm-body`) match between crm.js and the Playwright spec. Endpoint paths (`/api/admin/crm/{timeline,notes,tasks}`) match between client, endpoints, and both specs.
